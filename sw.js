// SAADI Business Hub: lets the app be installed and open quickly.
// Always tries the network first (checking with GitHub for a newer copy, never the browser's stale cache) so staff get the latest version; falls back to the cached copy if offline.
const CACHE = "saadi-hub-v16";
const FILES = ["index.html", "class-capacity.html", "business-plan.html", "calendar.html", "enquiry-desk.html", "term-renewals.html", "enquiry-core.js", "saadi-logo-white.png", "calendar-core.js", "hub.css", "hub-core.js", "firebase-config.js", "manifest.json", "icon-192.png", "icon-512.png", "favicon.ico", "favicon-32.png", "favicon-16.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Firebase traffic goes straight to the network
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
