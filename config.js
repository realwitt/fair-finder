// Anonymous counter base URL. Tests may override localStorage ff.api.
(function (root) {
  const DEFAULT_API = 'https://fair-finder-stats.lively-shape-f373.workers.dev';
  function apiBase() {
    let v = '';
    try { v = root.localStorage ? (root.localStorage.getItem('ff.api') || '') : ''; } catch (e) { v = ''; }
    if (typeof v === 'string' && (/^https:/.test(v) || /^http:\/\/127\.0\.0\.1/.test(v))) return v.replace(/\/$/, '');
    return DEFAULT_API;
  }
  root.FF_API = DEFAULT_API;
  root.ffApiBase = apiBase;
})(typeof window !== 'undefined' ? window : globalThis);

// Site moved (v7.7): https://realwitt.github.io/fair-finder/ now 301s to https://fairfinder.birbol.com/. A v7.6.x-or-older
// service worker at the old origin can still load its cached page (offline or slow network), and that page then pulls this
// file through the redirect. If so: drop the old service worker and caches and move to the same place on the new origin.
(function (root) {
  const OLD_HOST = 'realwitt.github.io', OLD_PATH = '/fair-finder', NEW_ORIGIN = 'https://fairfinder.birbol.com';
  if (typeof location === 'undefined' || location.host !== OLD_HOST) return;
  const dest = NEW_ORIGIN + (location.pathname.replace(new RegExp('^' + OLD_PATH + '(?=/|$)'), '') || '/') + location.search + location.hash;
  root.FF_MOVING = dest;
  const go = () => location.replace(dest);
  const t = setTimeout(go, 1500);
  Promise.all([
    root.navigator && navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))) : 0,
    root.caches ? caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ff-')).map(k => caches.delete(k)))) : 0,
  ]).catch(() => {}).then(() => { clearTimeout(t); go(); });
})(typeof window !== 'undefined' ? window : globalThis);
