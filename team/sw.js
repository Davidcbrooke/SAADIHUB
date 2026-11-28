// SAADI Team: lets phones install the app and receive notifications.
// Always fetches fresh pages (no offline copy of HR data).
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyDsPgYFcNMKx9eOV43A81CYkT47NQo68xA",
  authDomain: "saadi-financial-tracker.firebaseapp.com",
  projectId: "saadi-financial-tracker",
  storageBucket: "saadi-financial-tracker.firebasestorage.app",
  messagingSenderId: "643022190115",
  appId: "1:643022190115:web:9d7408f4f576dc44bb2396"
});
firebase.messaging(); // shows notifications that arrive while the app is closed
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", e => {
  const url = (e.notification.data && (e.notification.data.url || (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.data && e.notification.data.FCM_MSG.data.url))) || "./";
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(url));
    return w ? w.focus() : clients.openWindow(url);
  }));
});
