import { createSign } from "node:crypto";
import type { Game } from "@zkroll/shared";
import {
  deleteNotificationSubscriptionToken,
  disableGameNotifications,
  listGameNotificationSubscriptions,
  listNewGameNotificationSubscriptions,
  type GameNotificationSubscription,
  type NewGameNotificationSubscription
} from "./db.js";

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
const webOrigin = process.env.ZKROLL_WEB_ORIGIN;
const terminalGameStatuses = new Set(["settled", "refunded", "failed", "cancelled"]);

let accessTokenCache: { token: string; expiresAt: number } | null = null;

function firebaseConfigured() {
  return Boolean(firebaseProjectId && firebaseClientEmail && firebasePrivateKey);
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function firebaseAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) return accessTokenCache.token;
  if (!firebaseConfigured()) throw new Error("Firebase Cloud Messaging is not configured");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: firebaseClientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const unsignedJwt = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  const signature = base64Url(signer.sign(firebasePrivateKey!));
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Firebase OAuth failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { access_token: string; expires_in?: number };
  accessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };
  return payload.access_token;
}

function notificationUrl(game: Game) {
  const params = new URLSearchParams({
    network: game.network,
    game: game.id,
    notification: game.updatedAt
  });
  const path = `/?${params.toString()}`;
  return webOrigin ? `${webOrigin.replace(/\/$/, "")}${path}` : path;
}

type NotificationPayload = {
  title: string;
  body: string;
  data: Record<string, string>;
  link: string;
};

async function sendToToken(fcmToken: string, payload: NotificationPayload, token: string) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        data: {
          ...payload.data,
          title: payload.title,
          body: payload.body
        },
        webpush: {
          fcm_options: {
            link: payload.link
          }
        }
      }
    })
  });

  if (response.ok) return;

  const errorPayload = (await response.json().catch(() => null)) as { error?: { status?: string } } | null;
  if (errorPayload?.error?.status === "NOT_FOUND" || errorPayload?.error?.status === "INVALID_ARGUMENT") {
    deleteNotificationSubscriptionToken(fcmToken);
  }
  throw new Error(`FCM send failed with HTTP ${response.status}`);
}

async function sendToGameSubscription(game: Game, subscription: GameNotificationSubscription, token: string) {
  return sendToToken(
    subscription.fcmToken,
    {
      title: "zkroll",
      body: `Game ${game.id} updated: ${game.status}`,
      data: {
        kind: "game_update",
        gameId: game.id,
        network: game.network,
        status: game.status,
        updatedAt: game.updatedAt,
        url: notificationUrl(game)
      },
      link: notificationUrl(game)
    },
    token
  );
}

async function sendToNewGameSubscription(game: Game, subscription: NewGameNotificationSubscription, token: string) {
  const link = notificationUrl(game);
  return sendToToken(
    subscription.fcmToken,
    {
      title: "zkroll",
      body: `New ${game.network} game available: ${game.creatorPseudo}`,
      data: {
        kind: "new_game",
        gameId: game.id,
        network: game.network,
        status: game.status,
        updatedAt: game.updatedAt,
        url: link
      },
      link
    },
    token
  );
}

export async function notifyGameUpdated(game: Game) {
  const subscriptions = listGameNotificationSubscriptions(game.id);
  if (subscriptions.length === 0) return;

  if (firebaseConfigured()) {
    try {
      const token = await firebaseAccessToken();
      await Promise.allSettled(subscriptions.map((subscription) => sendToGameSubscription(game, subscription, token)));
    } catch (error) {
      console.warn(`Firebase notification skipped for game ${game.id}: ${(error as Error).message}`);
    }
  }

  if (terminalGameStatuses.has(game.status)) {
    disableGameNotifications(game.id);
  }
}

export async function notifyNewGameCreated(game: Game) {
  const subscriptions = listNewGameNotificationSubscriptions(game.network).filter(
    (subscription) => subscription.publicKey !== game.creatorPublicKey
  );
  if (subscriptions.length === 0 || !firebaseConfigured()) return;

  try {
    const token = await firebaseAccessToken();
    await Promise.allSettled(subscriptions.map((subscription) => sendToNewGameSubscription(game, subscription, token)));
  } catch (error) {
    console.warn(`Firebase new game notification skipped for game ${game.id}: ${(error as Error).message}`);
  }
}
