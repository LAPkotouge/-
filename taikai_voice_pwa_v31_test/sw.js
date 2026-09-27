const CACHE = "lap-number-v31-test-ui8";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([
        "./style.css?v=29r7",
        "./app/app.js?v=31safe9",
        "./app/restore.js?v=31safe2",
        "./app/reliable.js?v=31safe2",
        "./manifest.json?v=31pwa1",
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
