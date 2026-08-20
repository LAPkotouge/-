const CACHE = "taikai-voice-v30-version2";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./style.css?v=29r3",
        "./app/app.js?v=26",
        "./app/restore.js",
        "./manifest.json"
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
  const url = new URL(event.request.url);

  // V30復旧機能：既存app.jsの末尾にrestore.jsを結合して実行する
  if (url.pathname.endsWith("/app/app.js")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const baseResponse = await fetch(event.request).catch(() => cache.match(event.request));
      const restoreResponse = await cache.match("./app/restore.js") || await fetch("./app/restore.js");

      if (!baseResponse) return restoreResponse;

      const baseText = await baseResponse.text();
      const restoreText = restoreResponse ? await restoreResponse.text() : "";

      return new Response(baseText + "\n\n" + restoreText, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" }
      });
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
