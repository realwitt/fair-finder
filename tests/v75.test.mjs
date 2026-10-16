// Fair Finder v7.5 at 390x844: near me, favorites, amenities, search leftovers, heading paint.
import { chromium, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const b = await chromium.launch();
const ctx = await b.newContext({
  ...devices['iPhone 14 Pro'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  geolocation: ME,
  permissions: ['geolocation', 'accelerometer', 'magnetometer', 'gyroscope'],
});
await ctx.addInitScript(() => { window.__shared = []; navigator.share = async d => { window.__shared.push(d); }; });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.__ff && __ff.graph && __ff.dj && __ff.amenities && __ff.amenities.length === 34, null, { timeout: 25000 });

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(400);
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));

// 1. Near me sort
const sort = await p.evaluate(() => {
  const foods = __ff.booths.filter(b => b.food || b.kind === 'newfood').slice(0, 15)
    .map(b => ({ id: b.id, name: b.name, lat: b.lat, lon: b.lon, kind: 'food' }));
  const rides = __ff.rides.slice(0, 15).map(r => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, kind: 'ride' }));
  const am = __ff.amenities.map(a => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: a.amenityType }));
  const atms = __ff.atms.map(a => ({ id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: 'atm' }));
  const items = foods.concat(rides, am, atms);
  const all = FF.nearMe(__ff.me, items, { graph: __ff.graph, type: 'all', limit: 30 });
  const metersOk = all.every((r, i) => i === 0 || r.meters == null || all[i - 1].meters == null || all[i - 1].meters <= r.meters);
  const food = FF.nearMe(__ff.me, items, { graph: __ff.graph, type: 'food' });
  const ride = FF.nearMe(__ff.me, items, { graph: __ff.graph, type: 'rides' });
  const amen = FF.nearMe(__ff.me, items, { graph: __ff.graph, type: 'amenities' });
  const straight = items.map(it => ({ id: it.id, m: Geo.distanceM(__ff.me[0], __ff.me[1], it.lat, it.lon) }))
    .sort((a, b) => a.m - b.m).slice(0, 30).map(x => x.id).join(',');
  const walkIds = all.map(r => r.item.id).join(',');
  return {
    metersOk,
    kinds: food.every(r => r.item.kind === 'food') && ride.every(r => r.item.kind === 'ride') && amen.every(r => r.item.kind === 'amenity'),
    walked: all.some(r => r.straight === false),
    differ: straight !== walkIds,
    n: all.length,
  };
});
ok(sort.metersOk && sort.kinds && sort.walked && sort.differ, 'nearMe walks, filters, and is not straight-line order ' + JSON.stringify(sort));

await p.tap('#chipNear');
await p.waitForTimeout(400);
const nearUi = await p.evaluate(() => {
  const items = [];
  __ff.booths.filter(b => b.food || b.kind === 'newfood').forEach(b => items.push({ id: b.id, name: b.name, lat: b.lat, lon: b.lon, kind: 'food' }));
  __ff.rides.forEach(r => items.push({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, kind: 'ride', aliases: r.aliases }));
  __ff.amenities.forEach(a => items.push({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: a.amenityType }));
  __ff.atms.forEach(a => items.push({ id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: 'atm' }));
  const rows = FF.nearMe(__ff.me, items, { type: 'all', graph: __ff.graph, limit: 40 });
  const ids = [...document.querySelectorAll('#nearList li')].map(li => li.dataset.id);
  return {
    open: !document.getElementById('nearPanel').classList.contains('hidden'),
    n: ids.length,
    expect: rows.length,
    same: ids.length === rows.length && ids.every((id, i) => id === rows[i].item.id),
  };
});
ok(nearUi.open && nearUi.same, 'near panel lists the capped all-type walk order ' + JSON.stringify(nearUi));
await p.tap('#nearFilters [data-nt="rides"]');
await p.waitForTimeout(300);
const rideRows = await p.evaluate(() => {
  const ids = [...document.querySelectorAll('#nearList li')].map(li => li.dataset.id);
  const rideIds = new Set(__ff.rides.map(r => r.id));
  return ids.length > 0 && ids.every(id => rideIds.has(id));
});
ok(rideRows, 'near filter rides is only rides');
const rideId = await p.getAttribute('#nearList li', 'data-id');
await p.tap('#nearList li');
await p.waitForTimeout(600);
ok(await p.isVisible('#guide') && await p.evaluate(id => __ff.target && __ff.target.id === id, rideId), 'near row starts guide ' + rideId);
await p.evaluate(() => document.getElementById('closeGuide').click());
await p.waitForTimeout(300);

// 3. Favorites (GPS still on)
await p.fill('#q', 'turkey leg');
await p.waitForTimeout(500);
const favId = await p.getAttribute('#resList li', 'data-id');
await p.locator('#resList li').first().click();
await p.waitForTimeout(500);
const star0 = await p.evaluate(() => {
  const b = document.getElementById('btnFav');
  return { pressed: b.getAttribute('aria-pressed'), txt: b.textContent, hidden: b.classList.contains('hidden') };
});
ok(star0.pressed === 'false' && star0.txt === '☆' && !star0.hidden, 'guide star starts empty ' + JSON.stringify(star0));
await p.evaluate(() => __ffSheet.set('expanded', false));
await p.waitForTimeout(250);
await p.click('#btnFav');
await p.waitForTimeout(200);
const star1 = await p.evaluate(id => {
  const b = document.getElementById('btnFav');
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('ff.favorites.v1') || '[]'); } catch (e) {}
  return { pressed: b.getAttribute('aria-pressed'), txt: b.textContent, saved };
}, favId);
ok(star1.pressed === 'true' && star1.txt === '★' && star1.saved.includes(favId), 'star saves favorite ' + JSON.stringify(star1));
await p.reload({ waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(400);
const still = await p.evaluate(id => JSON.parse(localStorage.getItem('ff.favorites.v1') || '[]').includes(id), favId);
ok(still, 'favorite survives reload');
await p.tap('#chipFav');
await p.waitForTimeout(300);
const favRow = await p.evaluate(id => {
  const li = document.querySelector('#favList li');
  if (!li) return null;
  return { id: li.dataset.id, text: li.innerText, dist: (li.querySelector('.r-dist') || {}).textContent };
}, favId);
ok(favRow && favRow.text.includes('Guide me here') && favRow.text.includes('Remove') && favRow.dist && favRow.dist !== '—' && favRow.id === favId, 'favorites row ' + JSON.stringify(favRow));
await p.locator('#favList button', { hasText: 'Guide me here' }).click();
await p.waitForTimeout(400);
ok(await p.evaluate(id => __ff.target && __ff.target.id === id, favId), 'Guide me here from favorites');
await p.tap('#chipFav');
await p.waitForTimeout(200);
await p.locator('#favList .favRemove').click();
await p.waitForTimeout(200);
const emptied = await p.evaluate(() => ({
  txt: document.getElementById('favEmpty').textContent,
  vis: !document.getElementById('favEmpty').classList.contains('hidden'),
  saved: localStorage.getItem('ff.favorites.v1'),
}));
ok(emptied.vis && /No favorites yet/.test(emptied.txt) && emptied.saved === '[]', 'favorites empty ' + JSON.stringify(emptied));
await p.evaluate(() => document.getElementById('closeGuide').click());
await p.waitForTimeout(200);

// 4. Nearest restroom (quick actions show only while the box is focused and empty)
await p.fill('#q', '');
await p.tap('#q');
await p.waitForTimeout(200);
await p.locator('#qaRestroom').click();
await p.waitForTimeout(700);
const nearest = await p.evaluate(() => {
  const items = __ff.amenities.filter(a => a.amenityType === 'restroom').map(a => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: 'restroom' }));
  const rows = FF.nearMe(__ff.me, items, { type: 'amenities', graph: __ff.graph });
  return {
    id: __ff.target && __ff.target.id,
    type: __ff.target && __ff.target.amenityType,
    best: rows[0] && rows[0].item.id,
    meta: document.getElementById('guideMeta2').textContent,
    mode: __ff.guide && __ff.guide.mode,
  };
});
ok(nearest.type === 'restroom' && nearest.id === nearest.best && /approximate/.test(nearest.meta) && (nearest.mode === 'route' || nearest.mode === 'straight'), 'nearest restroom guides ' + JSON.stringify(nearest));

// 5. Search amenities
async function submit(q) {
  await p.fill('#q', q);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
}
await submit('bathroom');
const bath = await p.evaluate(() => [...document.querySelectorAll('#resList li[data-id]')].map(li => li.dataset.id));
ok(bath.some(id => id.startsWith('am-restroom-')) && !bath.some(id => id.startsWith('am-atm-')), 'bathroom hits restrooms ' + bath.filter(id => id.startsWith('am-')).slice(0, 4).join(','));
const bathOrder = await p.evaluate(() => {
  const rows = __ff.results.filter(r => String(r.booth.id).startsWith('am-restroom-'));
  const first = [...document.querySelectorAll('#resList li[data-id]')].map(li => li.dataset.id).find(id => id.startsWith('am-restroom-'));
  const nearest = rows.slice().sort((a, b) => (a.d == null ? 1 : b.d == null ? -1 : a.d - b.d))[0];
  return { first, nearest: nearest && nearest.booth.id };
});
ok(bathOrder.first && bathOrder.first === bathOrder.nearest, 'first restroom row is nearest ' + JSON.stringify(bathOrder));
await submit('atm');
const atmIds = await p.evaluate(() => [...document.querySelectorAll('#resList li[data-id]')].map(li => li.dataset.id));
const atmCount = await p.textContent('#resCount');
ok(atmIds.some(id => /^atm\d+$/.test(id)) && !atmIds.some(id => /^am-atm-/.test(id)) && !/am-atm-/.test(atmCount), 'atm search uses atmN once ' + atmIds.filter(id => /atm/i.test(id)).slice(0, 6).join(','));
await submit('first aid');
const aid = await p.evaluate(() => [...document.querySelectorAll('#resList li[data-id]')].some(li => li.dataset.id.startsWith('am-first-aid-')));
ok(aid, 'first aid hits an aid point');

// 6. list share is q-only; row and guide share stay /b/
await p.evaluate(() => { const li = document.querySelector('#resList li[data-id^="L0-"]'); if (li) li.click(); });
await p.waitForTimeout(400);
await p.fill('#q', 'corn dog');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
await p.click('#btnShareList');
await p.waitForTimeout(200);
const listShare = await p.evaluate(() => (window.__shared || []).slice(-1)[0]);
let listUrl = '';
try { listUrl = listShare && listShare.url; } catch (e) {}
const lu = listUrl ? new globalThis.URL(listUrl) : null;
ok(lu && (lu.searchParams.get('q') === 'corn dog') && !lu.searchParams.has('booth') && !lu.searchParams.has('ll') && !lu.searchParams.has('z'), 'list share is q only ' + listUrl);
const rowId = await p.getAttribute('#resList li .rShare', 'data-share');
await p.locator('#resList li .rShare').first().click();
await p.waitForTimeout(200);
await p.evaluate(() => __ffSheet.set('expanded', false));
await p.waitForTimeout(250);
await p.click('#btnShare');
await p.waitForTimeout(200);
const more = await p.evaluate(() => (window.__shared || []).slice(-2).map(s => s.url));
ok(more.length === 2 && more[0].includes('/b/' + rowId + '.html') && /\/b\/.+\.html/.test(more[1]), 'row and guide share stay on /b/ ' + more.join(' | '));

// 7. collapsed distance
await p.goto(URL + '?booth=L0-1099', { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForFunction(() => __ff.guide && __ff.target && __ff.target.id === 'L0-1099', null, { timeout: 20000 });
await p.evaluate(() => __ffSheet.set('collapsed', false));
await p.waitForTimeout(400);
const dist = await p.evaluate(() => {
  const el = document.getElementById('guideDist');
  const bar = document.getElementById('sheetBar');
  const cs = getComputedStyle(el);
  return {
    text: el.textContent,
    overflow: cs.textOverflow,
    sh: el.scrollHeight,
    ch: el.clientHeight,
    h: el.getBoundingClientRect().height,
    bar: bar.getBoundingClientRect().height,
  };
});
ok(/\d.*walk/.test(dist.text) && !dist.text.includes('…') && dist.overflow === 'clip' && dist.sh <= dist.ch + 1 && Math.abs(dist.h - 32) < 1 && Math.abs(dist.bar - 104) < 1, 'collapsed distance ' + JSON.stringify(dist));

// 8-11. slushie direct/likely
await p.fill('#q', 'slushie');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
const slushTxt = await p.locator('#resList').innerText();
ok(!/Deep Fried Korean Sushi Rolls/.test(slushTxt) && !/Plushipop/.test(slushTxt) && /slush/i.test(slushTxt), 'slushie skips sushi and plush ' + slushTxt.slice(0, 180));
const dup = await p.evaluate(() => {
  const dir = new Set([...document.querySelectorAll('#resList li[data-id]:not(.likely)')].map(li => li.dataset.id));
  const lik = [...document.querySelectorAll('#resList li.likely[data-id]')].map(li => li.dataset.id);
  return lik.filter(id => dir.has(id));
});
ok(dup.length === 0, 'no id in both direct and likely ' + dup.join(','));
const nHead = await p.evaluate(() => {
  const t = document.getElementById('resCount').textContent;
  const m = t.match(/·\s*(\d+)\s*likely/);
  const n = document.querySelectorAll('#resList li.likely').length;
  return { m: m && +m[1], n, t };
});
ok(nHead.m != null && nHead.m === nHead.n, 'likely count matches rows ' + JSON.stringify(nHead));
await p.fill('#q', '');
await p.fill('#q', 'slushie');
await p.waitForTimeout(400);
const nSug = await p.locator('#suggest li.likely').count();
ok(nSug === nHead.n, 'dropdown likely count matches header ' + nSug);

// 12. separator is not an option
const sep = await p.evaluate(() => {
  const el = document.querySelector('#suggest li.sgSep');
  if (!el) return null;
  return { role: el.getAttribute('role'), text: el.textContent, inside: !!el.closest('[role="option"]') };
});
ok(sep && sep.role === 'presentation' && sep.text === 'Likely matches · did you mean' && !sep.inside, 'separator ' + JSON.stringify(sep));
const before = await p.evaluate(() => __ff.target && __ff.target.id);
await p.locator('#suggest li.sgSep').click({ force: true });
await p.waitForTimeout(200);
ok(await p.evaluate(id => (__ff.target && __ff.target.id) === id, before), 'tapping the separator does not guide');
await p.focus('#q');
await p.keyboard.press('ArrowDown');
const active = await p.getAttribute('#q', 'aria-activedescendant');
const activeRole = active ? await p.getAttribute('#' + active, 'role') : '';
ok(activeRole === 'option' && active !== 'sgSep', 'ArrowDown lands on an option ' + active);

// 13. two Super Slides
await p.fill('#q', 'super slide');
await p.waitForTimeout(400);
const slides = await p.evaluate(() => {
  const sug = __ffSuggest.query('super slide');
  const dom = [...document.querySelectorAll('#suggest li[data-id="L0-1113"], #suggest li[data-id="L0-1335"]')].map(li => ({ id: li.dataset.id, text: li.innerText }));
  return { sug: sug.filter(s => s.id === 'L0-1113' || s.id === 'L0-1335'), dom };
});
const t1113 = (slides.dom.find(d => d.id === 'L0-1113') || {}).text || '';
const t1335 = (slides.dom.find(d => d.id === 'L0-1335') || {}).text || '';
const sugIds = slides.sug.map(s => s.id);
ok(sugIds.includes('L0-1113') && sugIds.includes('L0-1335') && /aka Large Slide/.test(t1335) && (/Kiddieland/.test(t1113) || /4 tickets/.test(t1113)) && t1113 !== t1335, 'super slides disambiguated ' + JSON.stringify(slides.dom));

// 14. deep link
await p.goto(URL + '?booth=am-restroom-3', { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(500);
const deep = await p.evaluate(() => ({
  id: __ff.target && __ff.target.id,
  vis: !document.getElementById('guide').classList.contains('hidden'),
  meta: document.getElementById('guideMeta2').textContent,
}));
ok(deep.id === 'am-restroom-3' && deep.vis && /approximate/.test(deep.meta), 'deep link amenity ' + JSON.stringify(deep));

// 15. heading paint
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForFunction(() => document.getElementById('meDot'), null, { timeout: 15000 });
await p.click('#btnLocate');
await p.waitForTimeout(200);
await p.evaluate(() => {
  const e = new Event('deviceorientation');
  e.webkitCompassHeading = 90;
  e.webkitCompassAccuracy = 8;
  window.dispatchEvent(e);
});
await p.waitForTimeout(300);
const arrow = await p.evaluate(() => {
  const dot = document.getElementById('meDot');
  const arrows = document.querySelectorAll('#meArrow');
  const tr = arrows[0] && getComputedStyle(arrows[0]).transform;
  return { has: dot.classList.contains('hasHead'), n: arrows.length, tr: arrows[0] && arrows[0].style.transform, cs: tr };
});
ok(arrow.has && arrow.n === 1 && /rotate/.test(arrow.tr || ''), 'arrow rotates ' + JSON.stringify(arrow));
await p.evaluate(() => {
  const now = Date.now();
  __ff.heading.onCompass(90, now - 5000, true);
});
await ctx.setGeolocation({ latitude: ME.latitude + 0.00002, longitude: ME.longitude, accuracy: 5 });
await p.waitForTimeout(600);
const stopped = await p.evaluate(() => {
  const dot = document.getElementById('meDot');
  const arrow = document.getElementById('meArrow');
  const cs = getComputedStyle(arrow);
  const circle = document.querySelector('.leaflet-overlay-pane path, .leaflet-overlay-pane canvas, .leaflet-interactive');
  return { has: dot.classList.contains('hasHead'), display: cs.display, circle: !!circle };
});
ok(!stopped.has && stopped.display === 'none' && stopped.circle, 'no heading hides the arrow, accuracy circle stays ' + JSON.stringify(stopped));

// 16. version + privacy
ok((await p.textContent('#version')) === 'v7.6 · Oct 15', 'version ' + await p.textContent('#version'));
await p.click('#btnLayers');
await p.click('#aboutLink');
await p.waitForTimeout(200);
const aboutIn = await p.textContent('#aboutBody');
ok(/stored only on this device \(localStorage\)/.test(aboutIn) && /never sent anywhere/.test(aboutIn), 'in-app privacy mentions on-device favorites');
const lp = await ctx.newPage();
await lp.goto(URL + 'about/', { waitUntil: 'domcontentloaded' });
const aboutTxt = await lp.locator('body').innerText();
ok(/stored only on this device \(localStorage\)/.test(aboutTxt) && /never sent anywhere/.test(aboutTxt), 'about page privacy mentions on-device favorites');
ok(!/\b\d(\.\d)?\s?(stars?|★)|reviews?\b|testimonial|users love|downloads/i.test(aboutTxt), 'about page has no ratings claims');

await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
