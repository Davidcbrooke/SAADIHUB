// SAADI Team: lets phones install the app. Always fetches fresh pages (no offline copy of HR data).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
