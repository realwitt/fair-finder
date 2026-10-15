const V = 'ff-shell-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'geo.js', 'search.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'data/booths.json', 'data/atms.json', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ff-shell-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const isTile = u => /\/tile\/\d+\/\d+\/\d+|tile\.openstreetmap\.org/.test(u);
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = req.url;
  if (isTile(url)) { // cache-first, then network (and store)
    e.respondWith(caches.open('ff-tiles-v1').then(async c => { const hit = await c.match(url); if (hit) return hit; try { const r = await fetch(req); if (r.ok) c.put(url, r.clone()); return r; } catch (err) { return new Response('', { status: 504 }); } }));
    return;
  }
  if (new URL(url).origin !== location.origin) return;
  // App shell + data: network-first with a 4s timeout, fall back to cache (keeps data fresh but works offline)
  e.respondWith((async () => {
    const c = await caches.open(V);
    try {
      const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      if (r.ok) c.put(req, r.clone()); return r;
    } catch (err) { return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error(); }
  })());
});
