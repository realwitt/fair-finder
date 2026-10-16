const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'Fair Finder is an independent, UNOFFICIAL guide to the 2026 N.C. State Fair (Oct 15-25, Raleigh). It is not affiliated with or endorsed by the N.C. State Fair or NCDA&CS. Data: the fair\'s published Food & Ride Finder booth and ride points (names, menus, ticket counts), plus approximate ride height/category from the midway operator. Use search to find foods, booths or rides; get_details for one item; nearby for things close to a lat/lon. Every result has a fair_finder_link the user can open on their phone to walk there with live directions. Menus and tickets can change; tell users to check posted signs. Official info: https://www.ncstatefair.org/';
const UNOFFICIAL_NOTE = 'Unofficial guide. Locations/menus from the fair\u2019s published data; may change.';
const DETAILS_SOURCE = 'Ticket counts come from the fair\u2019s published Food & Ride Finder. Heights and categories, when present, are per midway operator (approximate).';
const SRC = 'per midway operator (approximate)';
const STOP = new Set('a an the some any where wheres is find get me i can buy at fair food best near of for with and to want looking'.split(' '));
const FROZEN_SLUSH = ['slush','slushie','slushy','icee','italian ice','sno cone','snow cone','sno-ball','snowball','shaved ice','frozen lemonade','frozen drink','frozen slush'];
const FROZEN = {
  slush: FROZEN_SLUSH, slushie: FROZEN_SLUSH, slushy: FROZEN_SLUSH, slushies: FROZEN_SLUSH,
  icee: FROZEN_SLUSH, icees: FROZEN_SLUSH,
  lemonade: ['lemonade','frozen lemonade','lemon shake up','shake up','shake-up'],
};
const OUTSIDE_NOTE = 'That point is more than 3 km from the N.C. State Fairgrounds (Raleigh), so there is nothing nearby to show.';

function loadConceptGroups(SYNONYMS) {
  const groups = [];
  function push(arr) {
    if (!Array.isArray(arr)) return false;
    const phrases = [];
    for (const x of arr) {
      if (typeof x !== 'string') return false;
      const t = x.trim();
      if (t) phrases.push(t);
    }
    if (!phrases.length) return false;
    groups.push(phrases);
    return true;
  }
  if (Array.isArray(SYNONYMS)) {
    if (!SYNONYMS.length) return null;
    for (const g of SYNONYMS) {
      if (!Array.isArray(g) || !push(g)) return null;
    }
    return groups.length ? groups : null;
  }
  if (SYNONYMS && typeof SYNONYMS === 'object') {
    const named = Array.isArray(SYNONYMS.concepts) ? SYNONYMS.concepts
      : Array.isArray(SYNONYMS.groups) ? SYNONYMS.groups : null;
    if (named) {
      let ok = false;
      for (const g of named) {
        if (Array.isArray(g)) {
          if (push(g)) ok = true;
        } else if (g && typeof g === 'object') {
          const arr = Array.isArray(g.terms) ? g.terms : Array.isArray(g.words) ? g.words : Array.isArray(g.match) ? g.match : null;
          if (arr && push(arr)) ok = true;
        }
      }
      return ok ? groups : null;
    }
    const vals = Object.values(SYNONYMS);
    if (vals.length && vals.every(v => Array.isArray(v) && v.every(x => typeof x === 'string'))) {
      for (const [k, arr] of Object.entries(SYNONYMS)) push([k, ...arr]);
      return groups.length ? groups : null;
    }
  }
  return null;
}

function foodConceptGroups(syn) {
  const out = [];
  const fd = syn && syn.foods && typeof syn.foods === 'object' ? syn.foods : null;
  if (fd) for (const k in fd) { const t = fd[k] && fd[k].terms; if (Array.isArray(t) && t.length) out.push(t.filter(x => typeof x === 'string')); }
  else { const g = loadConceptGroups(syn); if (g) out.push(...g); }
  for (const g of FoodSearch.SYN) out.push(g);
  const seenF = new Set();
  for (const k of Object.keys(FROZEN)) { const g = FROZEN[k]; if (!seenF.has(g)) { seenF.add(g); out.push([k, ...g]); } }
  return out;
}
const CONCEPT_GROUPS = foodConceptGroups(SYNONYMS);
// Same concept layer the app uses (concepts.js + data/synonyms.json): ride types ('pirate ship') and food concepts.
const CONCEPTS = (typeof Concepts !== 'undefined' && Concepts && SYNONYMS && SYNONYMS.foods) ? Concepts.create(SYNONYMS) : null;
const RIDE_INDEX = Suggest.buildIndex({ rides: DATA.rides });
const BOOTH_INDEX = Suggest.buildIndex({ booths: DATA.booths });
const RIDE_BY = new Map(DATA.rides.map(r => [r.id, r]));
const BOOTH_BY = new Map(DATA.booths.map(b => [b.id, b]));

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function ownForms(token) {
  const st = stem(token);
  const forms = [token, st];
  if (st.endsWith('y') && st.length > 3) forms.push(st.slice(0, -1) + 'ies');
  else forms.push(st + 's');
  const out = [];
  for (const f of forms) {
    const n = Suggest.norm(f);
    if (!n || out.includes(n)) continue;
    const w = n.split(' ').filter(Boolean);
    if (w.length === 1 && (w[0] === token || stem(w[0]) === st)) out.push(n);
  }
  return out;
}

function groupHas(group, token, st) {
  for (const phrase of group) {
    const words = Suggest.norm(phrase).split(' ').filter(Boolean);
    for (const w of words) if (w === token || stem(w) === st) return true;
  }
  return false;
}

const EXP_CACHE = new Map();
function expansions(token) {
  const hit = EXP_CACHE.get(token);
  if (hit) return hit;
  const out = new Set();
  const add = p => { const n = Suggest.norm(p); if (n) out.add(n); };
  for (const f of ownForms(token)) add(f);
  const st = stem(token);
  if (CONCEPT_GROUPS) {
    for (const group of CONCEPT_GROUPS) {
      if (groupHas(group, token, st)) for (const phrase of group) add(phrase);
    }
  } else {
    for (const group of FoodSearch.SYN) {
      const matched = group.some(phrase => Suggest.norm(phrase).split(' ').filter(Boolean)
        .some(w => w === token || stem(w) === st));
      if (matched) for (const phrase of group) add(phrase);
    }
    for (const key of Object.keys(FROZEN)) {
      if (token === key || st === stem(key)) for (const phrase of FROZEN[key]) add(phrase);
    }
  }
  const arr = [...out];
  EXP_CACHE.set(token, arr);
  return arr;
}

function wordEq(a, b) {
  if (a === b) return true;
  const sa = stem(a), sb = stem(b);
  if (sa === sb && sa.length >= 3) return true;
  return a.length >= 5 && b.length >= 5 && FoodSearch.lev(a, b, 1) <= 1;
}

function phraseIn(phrase, words) {
  const pw = phrase.split(' ').filter(Boolean);
  if (!pw.length || !words.length) return false;
  for (let i = 0; i + pw.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < pw.length; j++) if (!wordEq(pw[j], words[i + j])) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

function prepareBooth(booth) {
  const nf = booth.newFood ? ((booth.newFood.name || '') + ' ' + (booth.newFood.description || '')) : '';
  const words = Suggest.norm([booth.name, booth.products, nf, ...(booth.items || [])].join(' ')).split(' ').filter(Boolean);
  const items = (booth.items || []).map(raw => {
    const text = String(raw);
    return { raw: text, words: Suggest.norm(text).split(' ').filter(Boolean) };
  });
  return { booth, words, items };
}

const DOCS = DATA.booths.map(prepareBooth);

function contentTokens(query) {
  return Suggest.norm(query).split(' ').filter(t => t && !STOP.has(t));
}

function phraseKind(phrase, token, words) {
  if (!phraseIn(phrase, words)) return null;
  const pw = phrase.split(' ').filter(Boolean);
  const st = stem(token);
  if (pw.length === 1 && (pw[0] === token || stem(pw[0]) === st)) return 'orig';
  if (pw.length === 1) {
    const w = pw[0];
    const exact = words.some(doc => doc === w || (stem(doc) === stem(w) && stem(w).length >= 3));
    if (!exact) return (w.length >= 5 && ownForms(token).includes(w)) ? 'typo' : null; // typo tolerance only on the user's own word
  }
  return 'syn';
}

function tokenHit(token, phrases, words) {
  let best = null;
  const rank = { orig: 3, syn: 2, typo: 1 };
  for (const phrase of phrases) {
    const kind = phraseKind(phrase, token, words);
    if (kind && (!best || rank[kind] > rank[best])) best = kind;
  }
  return best;
}

function ownPhraseHit(token, words) {
  return ownForms(token).some(f => phraseIn(f, words));
}

function newFoodHit(booth, phrases) {
  if (!booth.newFood) return false;
  const nf = booth.newFood;
  const words = Suggest.norm((nf.name || '') + ' ' + (nf.description || '')).split(' ').filter(Boolean);
  return phrases.some(p => phraseIn(p, words));
}

function collectItems(doc, tokens, phrases) {
  const orig = [];
  const rest = [];
  const seen = new Set();
  for (const it of doc.items) {
    if (seen.has(it.raw)) continue;
    if (!phrases.some(p => phraseIn(p, it.words))) continue;
    seen.add(it.raw);
    if (tokens.some(t => ownPhraseHit(t, it.words))) orig.push(it.raw);
    else rest.push(it.raw);
  }
  return orig.concat(rest);
}

function snippet(products, phrases) {
  const raw = String(products || '');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  let at = -1;
  for (const p of phrases) {
    const i = lower.indexOf(p);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return raw.slice(0, 160);
  const start = Math.max(0, at - 60);
  return raw.slice(start, start + 160);
}

function isCategoryToken(token) {
  const st = stem(token);
  if (CONCEPT_GROUPS) return CONCEPT_GROUPS.some(g => groupHas(g, token, st));
  for (const key of Object.keys(FROZEN)) {
    if (token === key || st === stem(key)) return true;
  }
  for (const group of FoodSearch.SYN) {
    for (const phrase of group) {
      for (const w of Suggest.norm(phrase).split(' ').filter(Boolean)) {
        if (w === token || stem(w) === st) return true;
      }
    }
  }
  return false;
}

function expansionHitCount(token) {
  const phrases = expansions(token);
  let n = 0;
  for (const doc of DOCS) if (phrases.some(p => phraseIn(p, doc.words))) n++;
  return n;
}

function fallbackToken(tokens) {
  const cats = [];
  const rest = [];
  for (let i = 0; i < tokens.length; i++) {
    (isCategoryToken(tokens[i]) ? cats : rest).push({ token: tokens[i], i });
  }
  const pool = cats.length ? cats : tokens.map((token, i) => ({ token, i }));
  let best = pool[0];
  let bestN = expansionHitCount(best.token);
  for (let k = 1; k < pool.length; k++) {
    const n = expansionHitCount(pool[k].token);
    if (n < bestN || (n === bestN && pool[k].i > best.i)) {
      best = pool[k];
      bestN = n;
    }
  }
  return best.token;
}

function partialNote(tokens, chosen) {
  const set = new Set(tokens);
  if (set.has('cherry') && set.has('slush')) {
    return 'No listing mentions both "cherry" and "slush"; these sell slush/frozen drinks; ask for flavors.';
  }
  return 'No listing mentions all of the words; showing matches for "' + chosen + '".';
}

function link(id) { return 'https://realwitt.github.io/fair-finder/?booth=' + id; }

function new2026String(nf) {
  if (!nf) return '';
  const name = nf.name || '';
  const desc = nf.description || '';
  if (name && desc) return name + ': ' + desc;
  return name || desc;
}

function rideSummary(ride, match, quality, note) {
  const row = {
    id: ride.id,
    type: 'ride',
    name: ride.name,
    area: ride.area || '',
    lat: ride.lat,
    lon: ride.lon,
    fair_finder_link: link(ride.id),
    lot_labels: ride.aliases || [],
    tickets: ride.tickets ?? null,
    cash_only: !!ride.cashOnly,
    match,
    match_quality: quality,
  };
  if (note) row.match_note = note;
  if (ride.heightText) row.height = { text: ride.heightText, source: SRC };
  if (ride.category) row.category = { name: ride.category, source: SRC };
  return row;
}

function boothSummary(booth, match, quality, note, items) {
  const row = {
    id: booth.id,
    type: 'booth',
    name: booth.name,
    area: booth.area || '',
    lat: booth.lat,
    lon: booth.lon,
    fair_finder_link: link(booth.id),
    match,
    match_quality: quality,
    menu_summary: String(booth.products || '').slice(0, 200),
  };
  if (note) row.match_note = note;
  if (items && items.length) row.matched_items = items;
  const nf = new2026String(booth.newFood);
  if (nf) row.new_2026 = nf;
  return row;
}

function rideHits(query) {
  const qc = Suggest.compact(query);
  const raw = Suggest.query(RIDE_INDEX, query, 25);
  const byName = DATA.rides.filter(r => Suggest.compact(r.name) === qc);
  const byAlias = DATA.rides.filter(r => (r.aliases || []).some(a => Suggest.compact(a) === qc));
  const out = [];
  for (const hit of raw) {
    if (hit.type !== 'ride') continue;
    const ride = RIDE_BY.get(hit.id);
    if (!ride) continue;
    let note;
    if (hit.alias) {
      const other = byName.find(r => r.id !== ride.id);
      note = other
        ? 'Lot label "' + hit.alias + '" belongs to this ride; the fair publicly calls it "' + ride.name + '". If you mean the ride the fair lists as "' + other.name + '", that is ' + other.id + '.'
        : 'Matched lot label "' + hit.alias + '". The fair publicly calls this ride "' + ride.name + '".';
    } else if (byAlias.some(r => r.id !== ride.id) && (ride.aliases || []).length) {
      note = 'Its lot label is "' + ride.aliases.join('", "') + '".';
    }
    const base = hit.score + (hit.alias ? 15 : 0);
    const quality = !hit.alias && base >= 100 ? 'exact'
      : (base >= 88 || hit.alias) ? 'strong'
      : hit.score >= 60 ? 'partial' : 'fuzzy';
    const row = rideSummary(ride, hit.alias ? 'lot_label' : 'name', quality, note);
    row.score = hit.score;
    row.tier = (quality === 'partial' || quality === 'fuzzy') ? 'likely' : 'direct';
    out.push(row);
  }
  return out;
}

function boothNameHits(query) {
  const raw = Suggest.query(BOOTH_INDEX, query, 25);
  const out = [];
  for (const hit of raw) {
    if (hit.type !== 'booth') continue;
    const booth = BOOTH_BY.get(hit.id);
    if (!booth) continue;
    const base = hit.score + (hit.alias ? 15 : 0);
    const quality = !hit.alias && base >= 100 ? 'exact'
      : (base >= 88 || hit.alias) ? 'strong'
      : hit.score >= 60 ? 'partial' : 'fuzzy';
    const row = boothSummary(booth, 'name', quality);
    row.score = hit.score;
    row.tier = (quality === 'partial' || quality === 'fuzzy') ? 'likely' : 'direct';
    out.push(row);
  }
  return out;
}

function scoreFood(hits, matchedLen, booth, phrases) {
  let score = 0;
  for (const h of hits) score += h === 'orig' ? 10 : h === 'syn' ? 4 : 2;
  score += Math.min(matchedLen, 5);
  if (newFoodHit(booth, phrases)) score += 3;
  return score;
}

function foodHits(query) {
  const tokens = contentTokens(query);
  if (!tokens.length) return { fail: 'Say a food, booth, or ride.' };
  const full = [];
  for (const doc of DOCS) {
    const per = tokens.map(t => ({ token: t, phrases: expansions(t), hit: null }));
    let miss = false;
    for (const p of per) {
      p.hit = tokenHit(p.token, p.phrases, doc.words);
      if (!p.hit) { miss = true; break; }
    }
    if (miss) continue;
    const hits = per.map(p => p.hit);
    const viaSyn = hits.some(h => h === 'syn');
    const allOrig = hits.every(h => h === 'orig');
    const anyTypo = hits.some(h => h === 'typo');
    const quality = allOrig ? 'exact' : anyTypo ? 'fuzzy' : 'strong';
    const phrases = per.flatMap(p => p.phrases);
    const matched = collectItems(doc, tokens, phrases);
    const row = boothSummary(doc.booth, 'menu', quality, undefined, matched.slice(0, 5));
    if (!row.matched_items) {
      const snip = snippet(doc.booth.products, phrases);
      if (snip) row.matched_items = [snip];
    }
    row.score = scoreFood(hits, matched.length, doc.booth, phrases);
    row.tier = viaSyn ? 'likely' : 'direct';
    full.push(row);
  }
  full.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (full.length >= 3 || tokens.length < 2) return full;
  const fullIds = new Set(full.map(r => r.id));

  const chosen = fallbackToken(tokens);
  const note = partialNote(tokens, chosen);
  const phrases = expansions(chosen);
  const partial = [];
  for (const doc of DOCS) {
    const hit = tokenHit(chosen, phrases, doc.words);
    if (!hit || fullIds.has(doc.booth.id)) continue;
    const matched = collectItems(doc, [chosen], phrases);
    const row = boothSummary(doc.booth, 'menu', 'partial', note, matched.slice(0, 5));
    if (!row.matched_items) {
      const snip = snippet(doc.booth.products, phrases);
      if (snip) row.matched_items = [snip];
    }
    row.score = scoreFood([hit], matched.length, doc.booth, phrases);
    row.tier = 'likely';
    partial.push(row);
  }
  partial.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return full.concat(partial);
}

function capTiers(rows, limit) {
  const direct = [];
  const likely = [];
  for (const row of rows) {
    const o = Object.assign({}, row);
    delete o.score;
    delete o._viaSyn;
    if (o.tier !== 'likely') o.tier = 'direct';
    if (o.tier === 'likely') likely.push(o);
    else direct.push(o);
  }
  const d = direct.slice(0, limit);
  const l = likely.slice(0, Math.max(0, limit - d.length));
  const results = d.concat(l);
  return { direct: d, likely: l, results, count: results.length };
}

function mergeAny(rides, names, foods) {
  const named = rides.concat(names);
  const strong = named.filter(x => x.tier === 'direct' && (x.match_quality === 'exact' || x.match_quality === 'strong'))
    .sort((a, b) => b.score - a.score);
  const weak = named.filter(x => x.tier === 'direct' && x.match_quality !== 'exact' && x.match_quality !== 'strong')
    .sort((a, b) => b.score - a.score);
  const directFood = foods.filter(x => x.tier !== 'likely');
  const likelyFood = foods.filter(x => x.tier === 'likely');
  const likelyName = named.filter(x => x.tier === 'likely').sort((a, b) => b.score - a.score);
  const ordered = strong.concat(directFood, weak, likelyFood, likelyName);
  const out = [];
  const seen = new Set();
  for (const x of ordered) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function fail(text) { return { fail: text }; }

function parseEnum(v, allowed) {
  if (v == null || v === '') return { value: 'any' };
  if (typeof v !== 'string' || !allowed.includes(v.trim())) {
    return { error: 'type must be any, food, booth, or ride.' };
  }
  return { value: v.trim() };
}

function parseLimit(v, min, max) {
  if (v == null || v === '') return { value: null };
  if (typeof v === 'boolean' || typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    return { error: 'limit must be an integer from ' + min + ' to ' + max + '.' };
  }
  return { value: v };
}

function searchTool(args) {
  args = args || {};
  if (typeof args.query !== 'string') return fail('query is required and must be a string of 1 to 100 characters.');
  const query = args.query.trim();
  if (query.length < 1 || query.length > 100) return fail('query is required and must be a string of 1 to 100 characters.');
  const typeP = parseEnum(args.type, ['any', 'food', 'booth', 'ride']);
  if (typeP.error) return fail(typeP.error);
  const limP = parseLimit(args.limit, 1, 25);
  if (limP.error) return fail(limP.error);
  const type = typeP.value;
  const limit = limP.value == null ? 10 : limP.value;
  if (!contentTokens(query).length) return fail('Say a food, booth, or ride.');
  let rows;
  if (type === 'ride') rows = rideHits(query);
  else if (type === 'booth') rows = boothNameHits(query);
  else if (type === 'food') {
    const foods = foodHits(query);
    if (foods.fail) return foods;
    rows = foods;
  } else {
    const foods = foodHits(query);
    if (foods.fail) return foods;
    rows = mergeAny(rideHits(query), boothNameHits(query), foods);
  }
  if (CONCEPTS) {
    const have = new Set(rows.map(r => r.id));
    const extra = CONCEPTS.likely(query, {
      rides: type === 'any' || type === 'ride' ? DATA.rides : [],
      booths: type === 'any' || type === 'food' ? DATA.booths : [],
      exclude: have, limit: 10,
    });
    for (const x of extra) {
      const note = 'Likely match: ' + x.why + (x.type === 'ride' ? ' (ride type from Fair Finder\u2019s concept map).' : ' (menu mentions it).');
      const row = x.type === 'ride' ? rideSummary(x.item, 'concept', 'likely', note) : boothSummary(x.item, 'concept', 'likely', note);
      row.tier = 'likely'; row.score = 0;
      rows.push(row);
    }
  }
  const packed = capTiers(rows, limit);
  return { query, type, count: packed.count, direct: packed.direct, likely: packed.likely, note: UNOFFICIAL_NOTE + ' direct = matches your words; likely = related items found via synonyms/concepts or partial matches.' };
}

function parseId(v) {
  const m = String(v == null ? '' : v).match(/\b(L\d-\d+|atm\d+)/i);
  if (!m) return null;
  return /^l/i.test(m[1]) ? 'L' + m[1].slice(1) : m[1].toLowerCase();
}

function getDetails(args) {
  args = args || {};
  if (args.id == null || String(args.id).trim() === '') {
    return fail('id is required. Ids look like L0-1099. Use search to find a booth or ride.');
  }
  const id = parseId(args.id);
  if (!id) return fail('Could not read an id from "' + String(args.id) + '". Ids look like L0-1099. Use search to find a booth or ride.');
  const ride = RIDE_BY.get(id);
  if (ride) {
    return {
      id: ride.id,
      type: 'ride',
      name: ride.name,
      lot_labels: ride.aliases || [],
      area: ride.area || '',
      lot: ride.lot ?? null,
      lat: ride.lat,
      lon: ride.lon,
      tickets: ride.tickets ?? null,
      cash_only: !!ride.cashOnly,
      height: ride.heightText ? { text: ride.heightText, source: SRC } : null,
      category: ride.category ? { name: ride.category, source: SRC } : null,
      details_source: DETAILS_SOURCE,
      fair_finder_link: link(ride.id),
    };
  }
  const booth = BOOTH_BY.get(id);
  if (booth) {
    return {
      id: booth.id,
      type: 'booth',
      name: booth.name,
      kind: booth.kind || '',
      area: booth.area || '',
      lot: booth.lot ?? null,
      lat: booth.lat,
      lon: booth.lon,
      food: !!booth.food,
      drinks: !!booth.drinks,
      products: booth.products || '',
      items: booth.items || [],
      new_2026: booth.newFood || null,
      fair_finder_link: link(booth.id),
    };
  }
  return fail('No booth or ride with id "' + id + '". Ids look like L0-1099. Use search to find one.');
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearbySummary(entry, meters) {
  const base = entry.type === 'ride'
    ? rideSummary(entry, 'name', 'exact')
    : boothSummary(entry, 'name', 'exact');
  delete base.match;
  delete base.match_quality;
  base.distance_m = Math.round(meters);
  base.distance_ft = Math.round(meters * 3.28084);
  return base;
}

function nearbyTool(args) {
  args = args || {};
  if (typeof args.lat !== 'number' || typeof args.lon !== 'number' || !Number.isFinite(args.lat) || !Number.isFinite(args.lon)) {
    return fail('lat and lon are required numbers.');
  }
  let radius = 150;
  if (args.radius_m != null && args.radius_m !== '') {
    if (typeof args.radius_m === 'boolean' || typeof args.radius_m !== 'number' || !Number.isFinite(args.radius_m) || args.radius_m < 10 || args.radius_m > 2000) {
      return fail('radius_m must be a number from 10 to 2000.');
    }
    radius = args.radius_m;
  }
  const limP = parseLimit(args.limit, 1, 50);
  if (limP.error) return fail(limP.error);
  const limit = limP.value == null ? 15 : limP.value;
  const typeP = parseEnum(args.type, ['any', 'food', 'booth', 'ride']);
  if (typeP.error) return fail(typeP.error);
  const type = typeP.value;
  const distFair = haversine(args.lat, args.lon, DATA.fair.lat, DATA.fair.lon);
  if (distFair > 3000) {
    return { lat: args.lat, lon: args.lon, radius_m: radius, type, count: 0, results: [], note: OUTSIDE_NOTE };
  }
  const rows = [];
  if (type === 'any' || type === 'ride') {
    for (const ride of DATA.rides) {
      const meters = haversine(args.lat, args.lon, ride.lat, ride.lon);
      if (meters <= radius) rows.push({ meters, row: nearbySummary(Object.assign({ type: 'ride' }, ride), meters) });
    }
  }
  if (type === 'any' || type === 'booth' || type === 'food') {
    for (const booth of DATA.booths) {
      if (type === 'food' && booth.food !== true) continue;
      const meters = haversine(args.lat, args.lon, booth.lat, booth.lon);
      if (meters <= radius) rows.push({ meters, row: nearbySummary(booth, meters) });
    }
  }
  rows.sort((a, b) => a.meters - b.meters || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
  const results = rows.slice(0, limit).map(x => x.row);
  return { lat: args.lat, lon: args.lon, radius_m: radius, type, count: results.length, results, note: UNOFFICIAL_NOTE };
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function toolOk(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
    structuredContent: result,
    isError: false,
  };
}

function tools() {
  const ann = (title) => ({ readOnlyHint: true, openWorldHint: false, idempotentHint: true, title });
  return [
    {
      name: 'search',
      title: 'Search the fair',
      description: 'Find foods, food booths, or rides at the 2026 N.C. State Fair by name or menu text. Tolerates typos, spacing, hyphens, and synonyms (hotdog, sno cone, cherry slush, Tilt-A-Whirl). type food returns booths whose menu matches. type booth matches booth and vendor names. type ride matches public ride names and lot-label aliases. Every hit includes fair_finder_link. Results are split into direct (the user\'s own words, including light typos and plurals) and likely (synonym, concept, or partial matches). direct is filled before likely.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 100, description: 'Food, booth, or ride text to look up. 1 to 100 characters.' },
          type: { type: 'string', enum: ['any', 'food', 'booth', 'ride'], description: 'any (default) mixes name and menu hits. food is menu matches. booth is vendor names. ride is public names and lot labels.' },
          limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Max hits across direct and likely combined. Default 10.' },
        },
        required: ['query'],
      },
      annotations: ann('Search the fair'),
    },
    {
      name: 'get_details',
      title: 'Get one booth or ride',
      description: 'Full record for one fair id such as L0-1099. Case-insensitive. Trailing punctuation is ignored.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Fair id such as L0-1099. Case-insensitive. Extra trailing characters are ignored.' },
        },
        required: ['id'],
      },
      annotations: ann('Get one booth or ride'),
    },
    {
      name: 'nearby',
      title: 'What is near a point',
      description: 'Booths and rides within radius_m of a lat/lon, closest first. type food means booths with the food flag. type booth means booths. type ride means rides. A point more than 3 km from the fairgrounds returns an empty list.',
      inputSchema: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude of the point.' },
          lon: { type: 'number', description: 'Longitude of the point.' },
          radius_m: { type: 'number', minimum: 10, maximum: 2000, description: 'Search radius in meters. Default 150. Min 10, max 2000.' },
          type: { type: 'string', enum: ['any', 'food', 'booth', 'ride'], description: 'any (default), food (booths with the food flag), booth, or ride.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max rows. Default 15.' },
        },
        required: ['lat', 'lon'],
      },
      annotations: ann('What is near a point'),
    },
  ];
}

function callTool(name, args) {
  let result;
  if (name === 'search') result = searchTool(args);
  else if (name === 'get_details') result = getDetails(args);
  else if (name === 'nearby') result = nearbyTool(args);
  else return toolError('Unknown tool "' + String(name) + '". Tools are search, get_details, and nearby.');
  if (result && result.fail) return toolError(result.fail);
  return toolOk(result);
}

function rpcOk(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function handleRpc(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { body: rpcErr(null, -32600, 'Invalid Request') };
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const method = typeof msg.method === 'string' ? msg.method : '';
  if (!method) {
    if (!hasId) return { notification: true };
    return { body: rpcErr(msg.id, -32600, 'Invalid Request') };
  }
  if (!hasId || method.startsWith('notifications/')) return { notification: true };
  const params = msg.params || {};
  if (method === 'initialize') {
    const requested = params && params.protocolVersion;
    return { body: rpcOk(msg.id, {
      protocolVersion: PROTOCOLS.includes(requested) ? requested : '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'fair-finder-mcp', title: 'Fair Finder (unofficial NC State Fair 2026 guide)', version: VERSION },
      instructions: INSTRUCTIONS,
    }) };
  }
  if (method === 'ping') return { body: rpcOk(msg.id, {}) };
  if (method === 'tools/list') return { body: rpcOk(msg.id, { tools: tools() }) };
  if (method === 'tools/call') {
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    return { body: rpcOk(msg.id, callTool(params.name, args)) };
  }
  if (method === 'resources/list') return { body: rpcOk(msg.id, { resources: [] }) };
  if (method === 'prompts/list') return { body: rpcOk(msg.id, { prompts: [] }) };
  return { body: rpcErr(msg.id, -32601, 'Method not found') };
}

function cors(extra) {
  const h = new Headers(extra || {});
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
  return h;
}

function json(status, body, extra) {
  const h = cors(extra);
  h.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function empty(status, extra) {
  return new Response(null, { status, headers: cors(extra) });
}

async function rateLimit(request, env) {
  if (!env || !env.RL || typeof env.RL.limit !== 'function') return null;
  const material = String(env.SALT || '') + ':' + String(request.headers.get('CF-Connecting-IP') || '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = hex.slice(0, 32);
  const { success } = await env.RL.limit({ key });
  if (!success) {
    return json(429, rpcErr(null, -32000, 'Rate limit exceeded: 60 requests per minute per client. Please slow down.'), { 'Retry-After': '60' });
  }
  return null;
}

async function handlePost(request, env) {
  const limited = await rateLimit(request, env);
  if (limited) return limited;
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return json(415, rpcErr(null, -32000, 'Content-Type must be application/json'));
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > 65536) return json(413, rpcErr(null, -32000, 'Body exceeds 64 KB'));
  let msg;
  try { msg = JSON.parse(new TextDecoder().decode(buf)); }
  catch { return json(400, rpcErr(null, -32700, 'Parse error')); }
  if (Array.isArray(msg)) {
    const bodies = [];
    for (const one of msg) {
      const r = handleRpc(one);
      if (!r.notification) bodies.push(r.body);
    }
    if (!bodies.length) return empty(202);
    return json(200, bodies);
  }
  if (!msg || typeof msg !== 'object') return json(200, rpcErr(null, -32600, 'Invalid Request'));
  const r = handleRpc(msg);
  if (r.notification) return empty(202);
  return json(200, r.body);
}

function health() {
  return {
    name: 'fair-finder-mcp',
    version: VERSION,
    endpoint: '/mcp',
    tools: ['search', 'get_details', 'nearby'],
    unofficial: INSTRUCTIONS,
    privacy: 'No account. The worker does not log IPs, rate-limit keys, or query text. The client IP is salted and SHA-256-hashed only as a rate-limit key.',
  };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
        'Access-Control-Max-Age': '86400',
      }),
    });
  }
  if (method === 'GET' && path === '/mcp') return empty(405, { Allow: 'POST, OPTIONS' });
  if (method === 'DELETE' && path === '/mcp') return empty(405, { Allow: 'POST, OPTIONS' });
  if (method === 'GET' && (path === '/' || path === '/health')) return json(200, health());
  if (method === 'POST' && (path === '/mcp' || path === '/')) return handlePost(request, env);
  return json(404, { error: 'Not found' });
}

export default { async fetch(request, env, ctx) { return handle(request, env); } };
