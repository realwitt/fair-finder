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
