const V = 'ff-shell-v7-9-1';
const SHELL = ['./', 'style.css?v=791', 'app.js?v=791', 'desc.js?v=791', 'geo.js?v=791', 'search.js?v=791', 'rides.js?v=791', 'suggest.js?v=791', 'concepts.js?v=791', 'route.js?v=791', 'config.js?v=791', 'stats.js?v=791', 'vendor/leaflet.js?v=791', 'vendor/leaflet.css?v=791', 'data/booths.json', 'data/rides.json', 'data/synonyms.json', 'data/atms.json', 'data/walkways.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/birbol.svg?v=791', 'about/', 'about/about.css?v=791', 'heading.js?v=791', 'data/amenities.json'];
function shellOk(r) { return r.ok && !r.redirected && r.type !== 'opaqueredirect'; }
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    for (const u of SHELL) {
      const r = await fetch(u, { cache: 'reload', redirect: 'manual' });
      if (!shellOk(r)) throw new Error('shell ' + u);
      await c.put(u, r);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ff-shell-') && k !== V).map(k => caches.delete(k))))
  .then(() => caches.open('ff-tiles-v1')).then(async c => { for (const r of await c.keys()) if (!isTile(r.url)) await c.delete(r); }) // purge OSM/Esri tiles cached by v1–v6
  .then(() => self.clients.claim())); });
// Fair grounds-map tiles (the fair's own ArcGIS tile cache) are cache-first. Esri imagery is never cached by us.
const isTile = u => /tiles\.arcgis\.com\/tiles\/3Sj1fiIDvQtFfbvg\//.test(u);
const isOsm = u => /^https:\/\/tile\.openstreetmap\.org\//.test(u);
const OSM_CACHE = 'ff-osm-v1';
// Freshness from the tile's own headers: Cache-Control max-age (counted from when we fetched it), else Expires.
// Cross-origin responses can't expose Date, so we stamp the fetch time ourselves (x-ff-fetched).
function life(r) {
  const cc = (r.headers.get('cache-control') || '').toLowerCase(), at = +r.headers.get('x-ff-fetched') || 0;
  if (/no-store|no-cache/.test(cc)) return { fresh: 0, staleErr: 0 };
  const ma = cc.match(/(?:^|[,\s])max-age=(\d+)/), sie = cc.match(/stale-if-error=(\d+)/);
  let fresh = ma && at ? at + (+ma[1]) * 1000 : Date.parse(r.headers.get('expires') || '') || 0;
  return { fresh, staleErr: fresh + (sie ? +sie[1] * 1000 : 0) };
}
async function stamp(r) {
  const h = new Headers(); for (const k of ['content-type', 'cache-control', 'expires', 'last-modified']) { const v = r.headers.get(k); if (v) h.set(k, v); }
  h.set('x-ff-fetched', String(Date.now()));
  return new Response(await r.blob(), { status: r.status, headers: h });
}
async function osmTile(req) {
  const c = await caches.open(OSM_CACHE), hit = await c.match(req.url), now = Date.now();
  if (hit && life(hit).fresh > now) return hit;                   // still fresh per its own headers
  try {
    const r = await fetch(req);                                    // expired or missing: network (browser HTTP cache rules apply too)
    if (r.ok && r.type === 'cors') { const s = await stamp(r.clone()); if (life(s).fresh > now) await c.put(req.url, s); else await c.delete(req.url); }
    return r;
  } catch (err) {
    if (hit && life(hit).staleErr > now) return hit;               // offline: only within the tile's stale-if-error window
    if (hit) await c.delete(req.url);
    return new Response('', { status: 504 });
  }
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = req.url;
  if (isOsm(url)) { e.respondWith(osmTile(req)); return; }
  if (isTile(url)) { // cache-first, then network (and store)
    e.respondWith(caches.open('ff-tiles-v1').then(async c => { const hit = await c.match(url); if (hit) return hit; try { const r = await fetch(req); if (r.ok) c.put(url, r.clone()); return r; } catch (err) { return new Response('', { status: 504 }); } }));
    return;
  }
  if (new URL(url).origin !== location.origin) return;
  // App shell + data: network-first with a 4s timeout, fall back to cache (keeps data fresh but works offline)
  e.respondWith((async () => {
    const c = await caches.open(V);
    try {
      const nav = req.mode === 'navigate';
      // Navigations use redirect:'manual' so a server redirect (e.g. the Pages custom-domain 301 to another origin)
      // goes back to the browser as an opaque redirect it follows itself. A *followed* redirect handed to a navigation
      // is a network error in Chrome, and a cross-origin follow without CORS would fall back to a stale cached shell.
      const r = await Promise.race([fetch(nav ? req.url : req, nav ? { cache: 'no-cache', redirect: 'manual' } : { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      if (r.type === 'opaqueredirect') {
        // The app's own start page redirects: the site has moved. Step aside (unregister + drop our caches) so this
        // origin is no longer served from a stale shell; the browser follows the redirect to the new home.
        if (new URL(url).pathname === new URL(self.registration.scope).pathname)
          e.waitUntil(self.registration.unregister().then(() => caches.keys()).then(ks => Promise.all(ks.filter(k => k.startsWith('ff-')).map(k => caches.delete(k)))));
        return r;
      }
      if (r.redirected || (r.status >= 300 && r.status < 400)) return nav ? Response.redirect(r.url, 302) : r; // never cache a redirect
      if (r.ok && !r.redirected && r.type !== 'opaqueredirect') await c.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === 'navigate') {
        // Offline share links: /b/<id> and /b/<id>.html -> app with ?booth=<id>; /about/ -> cached about page
        const path = new URL(url).pathname;
        const m = path.match(/\/b\/([^/]+)$/);
        if (m) { let id = m[1]; if (id.endsWith('.html')) id = id.slice(0, -5); return Response.redirect(new URL('../?booth=' + id, url).href, 302); }
        if (/\/about\/?(index\.html)?$/.test(path)) { const a = await c.match('about/', { ignoreSearch: true }); if (a) return a; }
        for (const key of ['./', 'index.html']) {
          const hit = await c.match(key);
          if (hit && hit.ok && !hit.redirected && hit.type !== 'opaqueredirect') return hit;
        }
        return Response.error();
      }
      return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
