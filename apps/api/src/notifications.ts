import { createSign } from "node:crypto";
import type { Game } from "@zkroll/shared";
import {
  deleteNotificationSubscriptionToken,
  disableGameNotifications,
  listGameNotificationSubscriptions,
  type GameNotificationSubscription
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
  const path = `/?game=${encodeURIComponent(game.id)}`;
  return webOrigin ? `${webOrigin.replace(/\/$/, "")}${path}` : path;
}

async function sendToSubscription(game: Game, subscription: GameNotificationSubscription, token: string) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token: subscription.fcmToken,
        notification: {
          title: "zkroll",
          body: `Game ${game.id} updated: ${game.status}`
        },
        data: {
          gameId: game.id,
          network: game.network,
          status: game.status,
          updatedAt: game.updatedAt,
          url: notificationUrl(game)
        },
        webpush: {
          fcm_options: {
            link: notificationUrl(game)
          }
        }
      }
    })
  });

  if (response.ok) return;

  const payload = (await response.json().catch(() => null)) as { error?: { status?: string } } | null;
  if (payload?.error?.status === "NOT_FOUND" || payload?.error?.status === "INVALID_ARGUMENT") {
    deleteNotificationSubscriptionToken(subscription.fcmToken);
  }
  throw new Error(`FCM send failed with HTTP ${response.status}`);
}

export async function notifyGameUpdated(game: Game) {
  const subscriptions = listGameNotificationSubscriptions(game.id);
  if (subscriptions.length === 0) return;

  if (firebaseConfigured()) {
    try {
      const token = await firebaseAccessToken();
      await Promise.allSettled(subscriptions.map((subscription) => sendToSubscription(game, subscription, token)));
    } catch (error) {
      console.warn(`Firebase notification skipped for game ${game.id}: ${(error as Error).message}`);
    }
  }

  if (terminalGameStatuses.has(game.status)) {
    disableGameNotifications(game.id);
  }
}
