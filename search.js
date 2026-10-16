// Fuzzy food search with synonyms. Works in browser (window.FoodSearch) and Node.
(function (root) {
  const SYN = [
    ['hot dog', 'hotdog', 'hot dogs', 'hotdogs', 'frank', 'frankfurter', 'wiener', 'weiner', 'chili dog', 'slaw dog'],
    ['corn dog', 'corndog', 'corn dogs', 'corndogs', 'korean corn dog', 'kdog', 'k-dog', 'k dog'],
    ['funnel cake', 'funnel cakes', 'funnelcake'],
    ['turkey leg', 'turkey legs', 'smoked turkey'],
    ['cheeseburger', 'cheese burger', 'burger', 'burgers', 'hamburger', 'hamburgers'],
    ['fried cheeseburger', 'deep fried cheeseburger', 'krispy kreme burger'],
    ['empanada', 'empanadas', 'empenada'],
    ['bbq', 'barbecue', 'barbeque', 'bar-b-q', 'pulled pork', 'ribs', 'brisket'],
    ['fries', 'french fries', 'fry', 'ribbon fries', 'cheese fries', 'potato'],
    ['lemonade', 'lemonaid', 'limeade'],
    ['ice cream', 'icecream', 'soft serve', 'sundae', 'gelato', 'custard', 'frozen custard'],
    ['soda', 'pop', 'soft drink', 'coke', 'pepsi', 'cheerwine', 'root beer', 'drinks', 'drink', 'beverage'],
    ['water', 'bottled water', 'bottle water', 'water bottle'],
    ['coffee', 'iced coffee', 'frozen coffee', 'latte', 'espresso', 'cold brew'],
    ['donut', 'donuts', 'doughnut', 'doughnuts'],
    ['taco', 'tacos', 'burrito', 'quesadilla', 'mexican'],
    ['pizza', 'pizzas', 'slice'],
    ['chicken', 'fried chicken', 'chicken tenders', 'tenders', 'wings', 'chicken wings', 'nuggets'],
    ['sausage', 'italian sausage', 'polish sausage', 'bratwurst', 'brat', 'kielbasa'],
    ['philly', 'cheesesteak', 'cheese steak', 'philly cheesesteak', 'steak and cheese', 'steak & cheese'],
    ['gyro', 'gyros', 'pita', 'shawarma', 'kabob', 'kebab', 'souvlaki'],
    ['cotton candy', 'candy floss'],
    ['candy apple', 'candy apples', 'caramel apple', 'caramel apples'],
    ['sno cone', 'snow cone', 'sno-cone', 'shaved ice', 'snowball', 'slush', 'slushie', 'slushy'],
    ['churro', 'churros'],
    ['cheese curds', 'cheese curd', 'curds'],
    ['mac and cheese', 'mac & cheese', 'mac n cheese', 'macaroni', 'mac'],
    ['seafood', 'shrimp', 'fish', 'oyster', 'oysters', 'crab', 'fish and chips'],
    ['pickle', 'pickles', 'fried pickles', 'pickle on a stick'],
    ['onion', 'blooming onion', 'onion rings', 'onion ring'],
    ['peanuts', 'boiled peanuts', 'roasted peanuts', 'nuts', 'cashews', 'pecans'],
    ['popcorn', 'kettle corn', 'kettlecorn'],
    ['vegan', 'vegetarian', 'plant based', 'veggie'],
    ['sweet potato', 'sweet potatoes', 'yam'],
    ['ham biscuit', 'biscuit', 'biscuits', 'ham biscuits'],
    ['fried oreo', 'fried oreos', 'deep fried oreo'],
    ['egg roll', 'egg rolls', 'eggroll'],
    ['jerk chicken', 'jerk'], ['oxtail', 'oxtails'], ['beef patty', 'beef patties', 'patty', 'patties'],
    ['cider', 'apple cider', 'wine', 'beer', 'mead', 'alcohol'],
    ['tea', 'sweet tea', 'iced tea', 'bubble tea', 'boba'],
    ['milkshake', 'milk shake', 'shake', 'shakes', 'milk'],
    ['pretzel', 'pretzels'],
    ['cinnamon roll', 'cinnamon rolls', 'cinnamon bun'],
    ['crepe', 'crepes'], ['waffle', 'waffles'], ['fudge'], ['cookie', 'cookies', 'cookie dough'],
    ['arepa', 'arepas'], ['ramen', 'noodles', 'noodle', 'lo mein'], ['rice', 'fried rice'],
    ['corn', 'roasted corn', 'street corn', 'elote', 'corn on the cob'],
  ];
  // Related (weaker) matches: query group -> extra phrases at lower weight
  // Corn dog does not pull hot-dog stands. A corn dog is a different item; kdog stays a synonym above.
  const RELATED = { 'hot dog': ['corn dog', 'corndog', 'chili dog', 'sausage'], 'corn dog': ['kdog'], 'cheeseburger': ['krispy kreme burger'], 'drink': ['lemonade', 'tea', 'water', 'coffee', 'slush', 'smoothie', 'juice'], 'soda': ['lemonade', 'tea', 'water'] };
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const stem = w => w.length > 4 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const tokens = s => norm(s).split(' ').filter(Boolean).map(stem);
  const phraseKey = s => tokens(s).join(' ');
  const SYN_OF = new Map();
  SYN.forEach((g, i) => { for (const s of g) { const k = phraseKey(s); if (k && !SYN_OF.has(k)) SYN_OF.set(k, i); } });
  // "No <item> [/ <item> | or <item> …]" at a clause start or after "(". The phrase itself is not a match,
  // and each listed item (plus its synonym group) excludes the booth from that search.
  const NEG_RE = /(?:^|[(.;:,])\s*no\s+([a-z0-9][^.;:)(\n]{0,80})/gi;
  function negationItems(raw) {
    const s = String(raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`]/g, '');
    const out = [];
    NEG_RE.lastIndex = 0;
    let m;
    while ((m = NEG_RE.exec(s))) {
      for (let p of m[1].split(/\s*(?:\/|\bor\b|,)\s*/)) {
        p = p.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
        const toks = tokens(p);
        if (!toks.length || toks.length > 6) continue;
        out.push(toks.join(' '));
      }
    }
    return out;
  }
  function stripNegations(raw) {
    return String(raw || '').replace(/(?:^|[(.;:,])\s*no\s+[a-z0-9][^.;:)(\n]{0,80}/gi, ' ');
  }
  function addNegations(into, raw) {
    for (const k of negationItems(raw)) {
      into.add(k);
      const gi = SYN_OF.get(k);
      if (gi == null) continue;
      for (const s of SYN[gi]) { const sk = phraseKey(s); if (sk) into.add(sk); }
    }
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return max + 1; prev = cur;
    }
    return prev[b.length];
  }
  const groupsFor = q => { const nq = norm(q); return SYN.filter(g => g.some(s => norm(s) === nq || (nq.length > 3 && norm(s).includes(nq)) )); };
  // Phrase match: every token of phrase found (fuzzy) in the token list, in order-insensitive fashion
  // Edit budget for a query token. Length ≤ 8 needs the same first letter (keeps funel→funnel, blocks slush/plush).
  function editMax(len) { return len <= 8 ? 1 : 2; }
  function editOk(pt, dt) {
    const max = editMax(pt.length);
    if (pt.length <= 8 && pt[0] !== dt[0]) return false;
    return lev(pt, dt, max) <= max;
  }
  // Every token of the phrase must hit inside THIS field (one menu item or the name).
  // Callers pass a single item, so "corn" and "dog" in different dishes do not combine.
  function phraseScore(phraseToks, docToks, docJoined, allowFuzzy) {
    if (allowFuzzy == null) allowFuzzy = true;
    if (!phraseToks.length) return 0;
    if (docJoined.includes(' ' + phraseToks.join(' ') + ' ')) return 1;
    let hit = 0;
    for (const pt of phraseToks) {
      let ok = docToks.includes(pt);
      if (!ok && pt.length >= 4) ok = docToks.some(dt => dt.length >= 3 && (dt.startsWith(pt) || (allowFuzzy && editOk(pt, dt))));
      if (!ok && pt.length >= 5) ok = docJoined.replace(/ /g, '').includes(pt); // hotdog vs "hot dog"
      if (ok) hit++;
    }
    return hit === phraseToks.length ? 0.85 : 0;
  }
  function prepare(booth) {
    const neg = new Set();
    const srcs = [booth.name, booth.products, ...(booth.items || [])];
    if (booth.newFood) srcs.push(booth.newFood.name, booth.newFood.description);
    for (const s of srcs) addNegations(neg, s);
    booth._neg = neg;
    const fields = srcs.map(s => stripNegations(s || '')).join(' | ');
    const t = tokens(fields);
    booth._toks = t; booth._joined = ' ' + t.join(' ') + ' ';
    booth._nameToks = tokens(stripNegations(booth.name)); booth._nameJoined = ' ' + booth._nameToks.join(' ') + ' ';
    booth._items = (booth.items || []).map(it => { const tk = tokens(stripNegations(it)); return { raw: it, toks: tk, joined: ' ' + tk.join(' ') + ' ' }; });
    return booth;
  }
  // Returns {score, matched:[item strings]} or null.
  // opts.allowFuzzy === false skips edit distance. opts.synonymExpand === false skips SYN/RELATED phrases.
  function match(booth, query, opts) {
    opts = opts || {};
    const allowFuzzy = opts.allowFuzzy !== false;
    const synonymExpand = opts.synonymExpand !== false;
    const q = tokens(query); if (!q.length) return null;
    // Menu text that says "No hot dogs" (or "No hot dogs/sausage", "No hot dogs or burgers") is not a hit for those items.
    if (booth._neg && booth._neg.has(q.join(' '))) return null;
    const phrases = [{ toks: q, w: 1 }];
    if (synonymExpand) {
      for (const g of groupsFor(query)) {
        for (const s of g) { const t = tokens(s); if (t.join(' ') !== q.join(' ')) phrases.push({ toks: t, w: 0.9 }); }
        for (const s of (RELATED[g[0]] || [])) phrases.push({ toks: tokens(s), w: 0.6 });
      }
    }
    const ps = (toks, docToks, joined) => phraseScore(toks, docToks, joined, allowFuzzy);
    // Score each menu item and the name on its own. A multi-word chip ("corn dog")
    // must hit one item, not "corn" from one dish and "dog" from another.
    const fields = [{ toks: booth._nameToks, joined: booth._nameJoined }].concat(booth._items);
    // New-food blurbs are one paragraph. Score each clause so "frozen … cream" in a slush
    // writeup does not become ice cream, while "pulled pork" in that blurb still counts.
    if (booth.newFood && booth.newFood.description) {
      const bits = String(booth.newFood.description).split(/[,|;]|\.\s+|\s+\|\s+/);
      for (const bit of bits) {
        const nt = tokens(stripNegations(bit));
        if (nt.length) fields.push({ toks: nt, joined: ' ' + nt.join(' ') + ' ' });
      }
    }
    let best = 0;
    for (const f of fields) {
      for (const p of phrases) best = Math.max(best, p.w * ps(p.toks, f.toks, f.joined));
    }
    if (!best) return null;
    const matched = [];
    for (const it of booth._items) {
      if (phrases.some(p => ps(p.toks, it.toks, it.joined) > 0)) matched.push(it.raw);
    }
    let score = best + Math.min(matched.length, 3) * 0.05;
    if (phrases.some(p => ps(p.toks, booth._nameToks, booth._nameJoined) > 0)) score += 0.1;
    if (booth.newFood && phrases.some(p => { const nt = tokens(stripNegations(booth.newFood.name)); return ps(p.toks, nt, ' ' + nt.join(' ') + ' ') > 0; })) score += 0.1;
    return { score, matched };
  }
  function search(booths, query, opts) {
    const out = [];
    for (const b of booths) { const m = match(b, query, opts); if (m) out.push({ booth: b, ...m }); }
    return out;
  }
  const api = { prepare, match, search, norm, tokens, lev, SYN, negationItems, stripNegations };
  if (typeof module !== 'undefined') module.exports = api; else root.FoodSearch = api;
})(this);
