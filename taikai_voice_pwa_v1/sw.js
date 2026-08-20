const CACHE = "taikai-voice-v30-version4";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./style.css?v=29r3",
        "./app/app.js?v=26",
        "./app/restore.js",
        "./app/reliable.js",
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

  // V30追加機能を既存app.jsの末尾へ結合
  if (url.pathname.endsWith("/app/app.js")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const baseResponse = await fetch(event.request).catch(() => cache.match(event.request));
      const restoreResponse = await cache.match("./app/restore.js") || await fetch("./app/restore.js");
      const reliableResponse = await cache.match("./app/reliable.js") || await fetch("./app/reliable.js");

      if (!baseResponse) return reliableResponse || restoreResponse;

      const baseText = await baseResponse.text();
      const restoreText = restoreResponse ? await restoreResponse.text() : "";
      const reliableText = reliableResponse ? await reliableResponse.text() : "";

      return new Response(baseText + "\n\n" + restoreText + "\n\n" + reliableText, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" }
      });
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
