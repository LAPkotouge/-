const CACHE = "lap-number-v31-prod-ui15";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([
        "./style.css?v=31prod15",
        "./app/app.js?v=31prod15",
        "./app/restore.js?v=31prod15",
        "./app/reliable.js?v=31prod15",
        "./manifest.json?v=31prod15",
        "./icon-192.svg",
        "./icon-512.svg"
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, {cache:"no-store"})
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    fetch(event.request, {cache:"no-store"})
      .catch(() => caches.match(event.request))
  );
});
