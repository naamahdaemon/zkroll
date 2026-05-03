import { initializeApp, type FirebaseApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import type { GameStatus, NetworkId } from "@zkroll/shared";

type ForegroundGameUpdate = {
  kind?: "game_update" | "new_game";
  gameId: string;
  network?: NetworkId;
  status?: GameStatus;
  updatedAt?: string;
  url?: string;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

export function firebaseNotificationsConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId &&
      vapidKey
  );
}

export function browserNotificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function serviceWorkerUrl() {
  const params = new URLSearchParams(
    Object.entries(firebaseConfig).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

async function ensureMessaging() {
  if (!firebaseNotificationsConfigured()) {
    throw new Error("Firebase notifications are not configured.");
  }
  if (!browserNotificationsSupported()) {
    throw new Error("Push notifications are not supported by this browser.");
  }
  if (!(await isSupported())) {
    throw new Error("Firebase messaging is not supported by this browser.");
  }

  app ??= initializeApp(firebaseConfig);
  serviceWorkerRegistration ??= await navigator.serviceWorker.register(serviceWorkerUrl());
  messaging ??= getMessaging(app);
  return { messaging, serviceWorkerRegistration };
}

export async function requestFirebaseNotificationToken() {
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission was not granted.");
    }
  }

  const next = await ensureMessaging();
  return getToken(next.messaging, {
    vapidKey,
    serviceWorkerRegistration: next.serviceWorkerRegistration
  });
}

export async function listenForGameNotifications(callback: (update: ForegroundGameUpdate) => void) {
  const next = await ensureMessaging();
  return onMessage(next.messaging, (payload) => {
    const gameId = payload.data?.gameId;
    if (!gameId) return;
    callback({
      kind: payload.data?.kind as "game_update" | "new_game" | undefined,
      gameId,
      network: payload.data?.network as NetworkId | undefined,
      status: payload.data?.status as GameStatus | undefined,
      updatedAt: payload.data?.updatedAt,
      url: payload.data?.url
    });
  });
}
