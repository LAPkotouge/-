const CACHE = "taikai-voice-v21";
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["./","./index.html","./style.css?v=21","./app/app.js?v=20","./manifest.json"])).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)))});