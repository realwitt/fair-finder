const V = 'ff-shell-v6';
const SHELL = ['./', 'index.html', 'style.css?v=6', 'app.js?v=6', 'geo.js?v=6', 'search.js?v=6', 'route.js?v=6', 'vendor/leaflet.js?v=6', 'vendor/leaflet.css?v=6', 'data/booths.json', 'data/atms.json', 'data/walkways.json', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
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
      const r = await Promise.race([fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      if (r.ok) c.put(req, r.clone()); return r;
    } catch (err) {
      if (req.mode === 'navigate') {
        // Offline share links: /b/<id>.html -> app with ?booth=<id>; any ?query URL -> cached index.html
        const m = new URL(url).pathname.match(/\/b\/([^/]+)\.html$/);
        if (m) return Response.redirect(new URL('../?booth=' + m[1], url).href, 302);
        return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      }
      return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
