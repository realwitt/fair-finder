/* Menu text for booth cards. The fair's PRODUCT string is stored verbatim in products.
   newFood is only the first "NEW name: description" before a pipe, so extra
   "NEW …" items stay inside that description and the card used to print both. */
(function (root) {
  function clean(s) {
    let t = String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    t = t.replace(/([.!?])\s*,+\s*/g, '$1 ');
    t = t.replace(/\s+,/g, ',');
    t = t.replace(/,{2,}/g, ',');
    t = t.replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/^(?:[,|]+\s*)+|(?:\s*[,|]+)+$/g, '').trim();
    return t;
  }
  function parseNewBlocks(text) {
    const src = String(text || '').trim();
    if (!src) return [];
    const re = /(?:^|\s*,\s*)NEW\s+([^:]+?)\s*:\s*/g;
    const hits = [];
    let m;
    while ((m = re.exec(src))) hits.push({ name: clean(m[1]), descAt: re.lastIndex, at: m.index });
    if (!hits.length || hits[0].at > 0) return [];
    const items = [];
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
      let desc = src.slice(hits[i].descAt, end).trim().replace(/,\s*$/, '');
      desc = clean(desc);
      if (hits[i].name) items.push({ name: hits[i].name, description: desc });
    }
    return items;
  }
  function removeFlex(hay, needle) {
    if (!hay || !needle) return hay;
    const body = String(needle).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\s+/g, '\\s+').replace(/\s+/g, '\\s+');
    if (!body) return hay;
    return String(hay).replace(new RegExp(body, 'ig'), ' ');
  }
  function dedupeRest(rest, news) {
    let s = String(rest || '');
    for (let n = 0; n < news.length; n++) {
      const item = news[n];
      if (item.description && item.description.length > 24) s = removeFlex(s, item.description);
      s = removeFlex(s, 'NEW ' + item.name + ':');
      s = removeFlex(s, item.name + ':');
    }
    return clean(s);
  }
  function model(b) {
    const products = String((b && b.products) || '').trim();
    const pipe = products.indexOf('|');
    const head = pipe >= 0 ? products.slice(0, pipe).trim() : products;
    const tail = pipe >= 0 ? products.slice(pipe + 1).trim() : '';
    let news = parseNewBlocks(head);
    let rest = news.length ? tail : products;
    if (!news.length && b && b.newFood && (b.newFood.name || b.newFood.description)) {
      news = parseNewBlocks('NEW ' + String(b.newFood.name || '').trim() + ': ' + String(b.newFood.description || '').trim());
      if (news.length) rest = products;
    }
    rest = dedupeRest(rest, news);
    return { news: news, rest: rest };
  }
  function fullPlain(m) {
    const parts = [];
    for (let i = 0; i < m.news.length; i++) {
      const n = m.news[i];
      parts.push(n.name + (n.description ? ': ' + n.description : ''));
    }
    if (m.rest) parts.push(m.rest);
    return parts.join('\n');
  }
  function shortPlain(m) {
    const names = m.news.map(n => n.name);
    const bits = [];
    if (names.length) bits.push('New: ' + names.join(', '));
    if (m.rest) bits.push(m.rest);
    return bits.join(' · ');
  }
  // About three lines in the phone card (~32 characters a line).
  function isLong(m) {
    return fullPlain(m).length > 96;
  }
  const api = { clean, parseNewBlocks, model, fullPlain, shortPlain, isLong };
  if (typeof module !== 'undefined') module.exports = api; else root.Desc = api;
})(this);
