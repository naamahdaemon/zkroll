importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId")
};

if (Object.values(firebaseConfig).every(Boolean)) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const gameId = payload.data?.gameId;
    const status = payload.data?.status;
    const url = payload.data?.url || (gameId ? `/?game=${encodeURIComponent(gameId)}` : "/");
    self.registration.showNotification(payload.data?.title || "zkroll", {
      body: payload.data?.body || (gameId ? `Game ${gameId} updated${status ? `: ${status}` : ""}` : "Game updated"),
      icon: "/zkroll-logo.svg",
      badge: "/zkroll-logo.svg",
      tag: gameId ? `zkroll-game-${gameId}` : "zkroll-game",
      data: { url }
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        const targetUrl = new URL(url, self.location.origin);
        if (clientUrl.origin === targetUrl.origin && "focus" in client) {
          client.navigate(targetUrl.href);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
