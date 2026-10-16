// Concept ("likely match") layer over search + autocomplete, driven by data/synonyms.json.
// Direct hits always come first; this only adds a capped "Likely matches" group after them.
// Browser: window.Concepts. Node: module.exports. Needs Suggest (norm/compact) and FoodSearch (tokens).
(function (root) {
  const dep = (name, file) => (root && root[name]) || (typeof require === 'function' ? require(file) : null);
  function create(data) {
    const S = dep('Suggest', './suggest.js'), FS = dep('FoodSearch', './search.js');
    const concepts = [];
    const add = (kind, id, label, terms) => {
      const ts = [];
      for (const t of terms || []) { const n = S.norm(t), c = S.compact(t); if (c) ts.push({ n, c, ftoks: ' ' + FS.tokens(t).join(' ') + ' ' }); }
      concepts.push({ kind, id, label, terms: ts });
    };
    const rt = (data && data.ride_types) || {}, fd = (data && data.foods) || {};
    const am = (data && data.amenities) || {};
    for (const id in rt) add('ride', id, rt[id].label || id, rt[id].terms);
    for (const id in fd) add('food', id, fd[id].label || (fd[id].terms && fd[id].terms[0]) || id, fd[id].terms);
    for (const id in am) add('amenity', id, am[id].label || id, am[id].terms);
    const rideTypes = {};
    const rd = (data && data.rides) || {};
    for (const id in rd) rideTypes[id] = rd[id].types || [];
    // Concepts the query names. Only the best match level is kept: exact term > query is a term's prefix (still typing)
    // > query contains the term as a phrase. So 'bumper cars' means bumper cars, not also 'cars'.
    function exactTerm(q) {
      const qc = S.compact(q);
      if (!qc) return false;
      for (const k of concepts) for (const t of k.terms) {
        if (t.c === qc || t.c + 's' === qc || t.c === qc + 's') return true;
      }
      return false;
    }
    function match(q) {
      const qn = S.norm(q), qc = S.compact(q);
      if (qc.length < 2) return [];
      let best = 0, out = [];
      for (const k of concepts) {
        if (qc.length === 2 && k.kind !== 'amenity') continue;
        let lv = 0;
        for (const t of k.terms) {
          let l = 0;
          if (t.c === qc || t.c + 's' === qc || t.c === qc + 's') l = 3;
          else if (qc.length >= 3 && t.c.startsWith(qc)) l = 2;
          else if (t.c.length >= 4 && (' ' + qn + ' ').indexOf(' ' + t.n + ' ') !== -1) l = 1;
          if (l > lv) lv = l;
        }
        if (!lv) continue;
        if (lv > best) { best = lv; out = []; }
        if (lv === best) out.push(k);
      }
      return out;
    }
    function boothHas(b, k) {
      if (b._joined == null && FS.prepare) FS.prepare(b);
      if (b._cj == null) b._cj = (b._joined || '').replace(/ /g, '');
      for (const t of k.terms) {
        if (b._joined.indexOf(t.ftoks) !== -1) return true;
        if (t.c.length >= 6 && t.n.indexOf(' ') !== -1 && b._cj.indexOf(t.c) !== -1) return true;
      }
      return false;
    }
    // -> [{ type:'ride'|'booth', item, why }] not in exclude (Set of ids), capped at limit.
    function likely(q, opts) {
      opts = opts || {};
      const ks = match(q); if (!ks.length) return [];
      const ex = opts.exclude || new Set(), limit = opts.limit == null ? 5 : opts.limit, out = [], seen = new Set();
      const rideKs = ks.filter(k => k.kind === 'ride'), foodKs = ks.filter(k => k.kind === 'food');
      for (const r of opts.rides || []) {
        if (out.length >= limit) break;
        if (ex.has(r.id) || seen.has(r.id)) continue;
        const ts = rideTypes[r.id] || [];
        const k = rideKs.find(k => ts.indexOf(k.id) !== -1);
        if (k) { seen.add(r.id); out.push({ type: 'ride', item: r, why: k.label }); }
      }
      if (foodKs.length) for (const b of opts.booths || []) {
        if (out.length >= limit) break;
        if (!b || !(b.food || b.kind === 'newfood' || b.kind === 'sponsor') || ex.has(b.id) || seen.has(b.id)) continue;
        const k = foodKs.find(k => boothHas(b, k));
        if (k) { seen.add(b.id); out.push({ type: 'booth', item: b, why: k.label }); }
      }
      return out;
    }
    return { match, likely, rideTypes, exactTerm };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Concepts = api;
})(typeof window !== 'undefined' ? window : this);
