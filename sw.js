// Network-first service worker: always tries the network (so updates are never stale),
// falls back to the last cached copy when offline. Cross-origin requests (proxies, fonts) pass through.
var CACHE = 'pecal-v1';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); var key = req.url.split('?')[0]; caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req.url.split('?')[0]).then(function (r) { return r || caches.match(new URL('./', self.location).href); });
  }));
});
