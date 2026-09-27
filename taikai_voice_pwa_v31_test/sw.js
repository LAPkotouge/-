const CACHE = "lap-number-v31-race2";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([
        "./style.css?v=29r3",
        "./app/app.js?v=31v13race1",
        "./app/restore.js?v=30r7",
        "./app/reliable.js?v=31v13race1",
        "./manifest.json?v=31race2"
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
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
