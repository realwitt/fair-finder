// Autocomplete index. Browser: window.Suggest. Node: module.exports.
// Hot path is plain loops: normalization happens once per query, not per entry.
(function (root) {
  function norm(s) {
    let x = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    x = x.replace(/&/g, 'and').replace(/[’'`]/g, '');
    let out = '', sp = false;
    for (let i = 0; i < x.length; i++) {
      const c = x.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) { out += x[i]; sp = false; }
      else if (!sp) { out += ' '; sp = true; }
    }
    if (out.charCodeAt(0) === 32) out = out.slice(1);
    if (out.charCodeAt(out.length - 1) === 32) out = out.slice(0, -1);
    return out;
  }
  function compactFromNorm(n) {
    let o = '';
    for (let i = 0; i < n.length; i++) if (n.charCodeAt(i) !== 32) o += n[i];
    return o;
  }
  function compact(s) { return compactFromNorm(norm(s)); }
  function tokensFromNorm(n) {
    const out = [];
    let cur = '';
    for (let i = 0; i < n.length; i++) {
      if (n.charCodeAt(i) === 32) { if (cur) { out.push(cur); cur = ''; } }
      else cur += n[i];
    }
    if (cur) out.push(cur);
    return out;
  }
  // Levenshtein of a[0..aLen) vs b[bOff..bOff+bLen), abort above max. No allocations.
  function levWithin(a, b, bOff, bLen, max) {
    const n = a.length;
    if (n - bLen > max || bLen - n > max) return max + 1;
    const prev = new Uint16Array(bLen + 1);
    for (let j = 0; j <= bLen; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      let diag = prev[0];
      prev[0] = i;
      let best = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= bLen; j++) {
        const down = prev[j];
        const cost = ai === b.charCodeAt(bOff + j - 1) ? 0 : 1;
        let v = diag + cost;
        if (down + 1 < v) v = down + 1;
        if (prev[j - 1] + 1 < v) v = prev[j - 1] + 1;
        diag = down;
        prev[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
    }
    return prev[bLen];
  }
  function entry(type, id, label, source, extra) {
    const n = norm(source);
    const e = {
      type: type, id: id, label: label, n: n, c: compactFromNorm(n), toks: tokensFromNorm(n),
      isAlias: !!(extra && extra.isAlias), alias: (extra && extra.alias) || '',
      sub: (extra && extra.sub) || '', weight: type === 'ride' ? 2 : type === 'booth' ? 1 : 0,
    };
    return e;
  }
  function getFS() {
    if (root && root.FoodSearch && root.FoodSearch.SYN) return root.FoodSearch;
    if (typeof require === 'function') { try { return require('./search.js'); } catch (e) { return null; } }
    return null;
  }
  function buildIndex(opts) {
    opts = opts || {};
    const booths = opts.booths || [], rides = opts.rides || [], extraFoods = opts.foods || [];
    const entries = [];
    for (let i = 0; i < rides.length; i++) {
      const r = rides[i];
      if (!r || !r.name) continue;
      entries.push(entry('ride', r.id, r.name, r.name, { sub: r.area || '' }));
      const al = r.aliases || [];
      for (let j = 0; j < al.length; j++) {
        if (!al[j]) continue;
        entries.push(entry('ride', r.id, r.name, al[j], { isAlias: true, alias: al[j], sub: r.area || '' }));
      }
    }
    const isB = b => b && b.name && (b.food || b.kind === 'newfood' || b.kind === 'sponsor');
    const nameN = new Map(); // same-name booths (e.g. two 'Goldenkdog' in I Lot) also show their lot to tell them apart
    for (let i = 0; i < booths.length; i++) if (isB(booths[i])) { const k = compact(booths[i].name); nameN.set(k, (nameN.get(k) || 0) + 1); }
    for (let i = 0; i < booths.length; i++) {
      const b = booths[i];
      if (!isB(b)) continue;
      const dup = nameN.get(compact(b.name)) > 1;
      const sub = dup ? [b.area, b.lot || b.id].filter(Boolean).join(' · ') : (b.area || '');
      entries.push(entry('booth', b.id, b.name, b.name, { sub: sub }));
    }
    const best = new Map();
    function considerFood(raw) {
      if (!raw || typeof raw !== 'string') return;
      const n = norm(raw);
      const c = compactFromNorm(n);
      if (!c) return;
      const prev = best.get(c);
      if (!prev || raw.length < prev.length) best.set(c, raw);
    }
    for (let i = 0; i < booths.length; i++) {
      const items = (booths[i] && booths[i].items) || [];
      for (let j = 0; j < items.length; j++) considerFood(items[j]);
    }
    for (let i = 0; i < extraFoods.length; i++) considerFood(extraFoods[i]);
    const foods = [];
    best.forEach(text => foods.push(text));
    foods.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    if (foods.length > 1500) foods.length = 1500;
    const kept = new Set();
    for (let i = 0; i < foods.length; i++) {
      entries.push(entry('food', foods[i], foods[i], foods[i]));
      kept.add(compact(foods[i]));
    }
    const FS = getFS();
    const syn = FS && FS.SYN;
    if (syn) {
      for (let i = 0; i < syn.length; i++) {
        const head = syn[i] && syn[i][0];
        if (!head) continue;
        const c = compact(head);
        if (!c || kept.has(c)) continue;
        kept.add(c);
        entries.push(entry('food', head, head, head));
      }
    }
    return { entries: entries };
  }
  function toksPrefix(qtoks, etoks) {
    if (!qtoks.length) return false;
    for (let i = 0; i < qtoks.length; i++) {
      const qt = qtoks[i];
      let ok = false;
      for (let j = 0; j < etoks.length; j++) {
        if (etoks[j].startsWith(qt)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }
  function fuzzy(e, qc, qtoks) {
    if (qc.length < 4) return 0;
    const max = qc.length >= 7 ? 2 : 1;
    if (e.c.length >= qc.length && levWithin(qc, e.c, 0, qc.length, max) <= max) return 40;
    if (qtoks.length === 1) {
      const toks = e.toks;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.length >= qc.length) {
          if (levWithin(qc, t, 0, qc.length, max) <= max) return 40;
        } else if (qc.length - t.length <= max && levWithin(qc, t, 0, t.length, max) <= max) return 40;
      }
    }
    return 0;
  }
  function scoreEntry(e, qn, qc, qtoks) {
    let s = 0;
    if (e.c === qc) s = 100;
    else if (e.c.startsWith(qc)) s = 90;
    else if (e.n.startsWith(qn)) s = 88;
    else if (toksPrefix(qtoks, e.toks)) s = 75;
    else if (qc.length >= 3 && e.c.indexOf(qc) !== -1) s = 60;
    else s = fuzzy(e, qc, qtoks);
    if (!s) return 0;
    if (e.isAlias) s -= 15;
    return s;
  }
  function typeRank(t) { return t === 'ride' ? 2 : t === 'booth' ? 1 : 0; }
  function query(index, q, limit) {
    const entries = (index && index.entries) || [];
    const qn = norm(q), qc = compactFromNorm(qn);
    if (qc.length < 1) return [];
    if (limit == null) limit = 8;
    const qtoks = tokensFromNorm(qn);
    const scored = [];
    for (let i = 0; i < entries.length; i++) {
      const s = scoreEntry(entries[i], qn, qc, qtoks);
      if (s > 0) scored.push(entries[i], s);
    }
    const order = [];
    for (let i = 0; i < scored.length; i += 2) order.push(i);
    order.sort((ia, ib) => {
      const sa = scored[ia + 1], sb = scored[ib + 1];
      if (sb !== sa) return sb - sa;
      const ea = scored[ia], eb = scored[ib];
      const tr = typeRank(eb.type) - typeRank(ea.type);
      if (tr) return tr;
      if (ea.label.length !== eb.label.length) return ea.label.length - eb.label.length;
      return ea.label < eb.label ? -1 : ea.label > eb.label ? 1 : 0;
    });
    const seen = new Set(), out = [];
    for (let k = 0; k < order.length && out.length < limit; k++) {
      const e = scored[order[k]], s = scored[order[k] + 1];
      const key = e.type + '\0' + e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const o = { type: e.type, id: e.id, label: e.label, score: s };
      if (e.isAlias && e.alias) o.alias = e.alias;
      if (e.sub) o.sub = e.sub;
      out.push(o);
    }
    return out;
  }
  const api = { norm, compact, buildIndex, query };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Suggest = api;
})(typeof window !== 'undefined' ? window : this);
