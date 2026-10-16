// v7.6 UX nits at 390x844: one expanded sheet, Near me food, Near me count / amenities / quick buttons.
import { chromium, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8766/';
const ME = { latitude: 35.7935, longitude: -78.7105, accuracy: 5 };
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
  permissions: ['geolocation'],
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.__ff && __ff.graph && __ff.me && __ff.amenities && __ff.amenities.length === 34, null, { timeout: 25000 });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(400);
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));

async function guideTilt() {
  await p.fill('#q', 'tilt a whirl');
  await p.waitForTimeout(400);
  await p.locator('#suggest li', { hasText: 'Tilt a Whirl' }).first().click();
  await p.waitForTimeout(500);
  await p.locator('.leaflet-popup button.go').click();
  await p.waitForTimeout(700);
}
function sheetState() {
  return p.evaluate(() => {
    const g = document.getElementById('guide');
    const near = document.getElementById('nearPanel').getBoundingClientRect();
    const fav = document.getElementById('favPanel').getBoundingClientRect();
    const res = document.getElementById('results').getBoundingClientRect();
    const open = id => !document.getElementById(id).classList.contains('hidden');
    return {
      snap: window.__ffSheet.state,
      guideOn: !g.classList.contains('hidden') && !!__ff.target,
      nearOn: open('nearPanel'), favOn: open('favPanel'), resOn: open('results'),
      nearH: near.height, favH: fav.height, resH: res.height,
    };
  });
}
await guideTilt();
await p.evaluate(() => __ffSheet.set('expanded'));
await p.waitForTimeout(300);
await p.tap('#chipNear');
await p.waitForTimeout(400);
let st = await sheetState();
ok(st.guideOn && st.snap === 'collapsed' && st.nearOn && !st.favOn && !st.resOn && st.nearH > 320, 'expanded guide collapses when Near me opens ' + JSON.stringify(st));

await p.evaluate(() => __ffSheet.set('expanded'));
await p.waitForTimeout(250);
await p.evaluate(() => { const id = __ff.target.id; if (!__ff.favs.includes(id)) document.getElementById('btnFav').click(); });
await p.tap('#chipFav');
await p.waitForTimeout(400);
st = await sheetState();
ok(st.guideOn && st.snap === 'collapsed' && st.favOn && !st.nearOn && st.favH > 150, 'expanded guide collapses when Favorites opens ' + JSON.stringify(st));

await p.evaluate(() => __ffSheet.set('expanded'));
await p.waitForTimeout(250);
await p.tap('.chip[data-q="rides"]');
await p.waitForTimeout(500);
st = await sheetState();
ok(st.guideOn && st.snap === 'collapsed' && st.resOn && st.resH > 280, 'expanded guide collapses when Rides opens ' + JSON.stringify(st));

await p.evaluate(() => __ffSheet.set('expanded'));
await p.waitForTimeout(250);
await p.fill('#q', 'bbq');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
st = await sheetState();
ok(st.guideOn && st.snap === 'collapsed' && st.resOn && /bbq/i.test(await p.textContent('#resCount')), 'expanded guide collapses when search results open ' + JSON.stringify(st));

// Near me food is food vendors. Commercial Dorton exhibitors stay out, including the fork list.
await p.tap('#chipNear');
await p.waitForTimeout(300);
await p.tap('#nearFilters [data-nt="food"]');
await p.waitForTimeout(300);
const food = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#nearList li')].map(li => ({ id: li.dataset.id, text: li.innerText, ico: (li.querySelector('.r-ico') || {}).textContent }));
  const bad = __ff.booths.filter(b => /Rock 'N' Roll Outlet|Choice Pool & Spa|Leon Leather/.test(b.name)).map(b => ({ id: b.id, name: b.name, food: !!b.food }));
  return { rows: rows.slice(0, 8), n: rows.length, bad, icons: rows.every(r => r.ico === '🍴') };
});
ok(food.n > 0 && food.icons && !food.rows.some(r => /Rock 'N' Roll|Choice Pool|Leon Leather/.test(r.text)), 'Near me Food rows are food ' + JSON.stringify(food.rows.map(r => r.text.split('\n')[0])));
ok(food.bad.length >= 4 && food.bad.every(b => b.food === false), 'commercial exhibitors are not b.food ' + JSON.stringify(food.bad));

await p.tap('#nearFilters [data-nt="all"]');
await p.waitForTimeout(300);
const all = await p.evaluate(() => {
  const lis = [...document.querySelectorAll('#nearList li')];
  const ids = lis.map(li => li.dataset.id);
  const head = document.getElementById('nearCount').textContent;
  const am = __ff.amenities.concat(__ff.atms.map(a => ({ id: a.id, amenityType: 'atm' })));
  const types = new Set(ids.map(id => {
    const a = __ff.amenities.find(x => x.id === id);
    if (a) return a.amenityType;
    if (/^atm\d+$/.test(id)) return 'atm';
    return '';
  }).filter(Boolean));
  const areas = __ff.amenities.map(a => a.area).concat(__ff.atms.map(a => a.area));
  const btns = [...document.querySelectorAll('#nearQuick .qa')].map(el => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  return { head, n: ids.length, types: [...types], areas, btns, odd: areas.filter(a => !a || a === 'Hv' || a.length < 3) };
});
ok(all.head === 'Near me · ' + all.n && all.n > 40, 'Near me header count ' + all.head);
ok(all.types.includes('restroom') && all.types.includes('atm') && all.types.includes('first_aid'), 'All list keeps a restroom, ATM and first aid ' + all.types.join(','));
ok(all.btns.length === 3 && all.btns.every(b => b.left >= -1 && b.right <= 391 && b.bottom <= 844), 'quick buttons fit at 390 ' + JSON.stringify(all.btns));
ok(all.odd.length === 0, 'amenity areas are real place names ' + JSON.stringify(all.odd));

await p.fill('#q', 'atm');
await p.waitForTimeout(450);
const atms = await p.evaluate(() => [...document.querySelectorAll('#suggest li[role="option"]')].map(li => li.innerText));
ok(atms.length >= 10 && new Set(atms).size === atms.length && atms.every(t => /\d/.test(t) && /ft|mi/.test(t) && !/Hv\b/.test(t) && !/published grounds map/.test(t)), 'ATM suggestions show area and distance ' + atms.slice(0, 3).join(' || '));

await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const atmRes = await p.evaluate(() => [...document.querySelectorAll('#resList li[data-id]')].slice(0, 6).map(li => li.innerText.replace(/\n/g, ' | ')));
ok(atmRes.length >= 3 && atmRes.every(t => /ft|mi/.test(t) && !/published grounds map/.test(t)), 'ATM results show a place and a distance ' + atmRes[0]);

const puppy = await p.evaluate(() => {
  const r = __ff.rides.find(x => x.name === 'Puppy Roll');
  return r ? { text: (window.rideNameText ? '' : ''), name: r.name, aliases: r.aliases } : null;
});
await p.fill('#q', 'rides');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const puppyRow = await p.evaluate(() => {
  const li = [...document.querySelectorAll('#resList li')].find(el => /Puppy Roll/.test(el.innerText));
  return li ? li.innerText : '';
});
ok(/Puppy Roll/.test(puppyRow) && !/aka Puppy Role/i.test(puppyRow) && puppy && puppy.aliases.includes('Puppy Role'), 'near-spelling alias hidden ' + puppyRow.replace(/\n/g, ' | '));

await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
