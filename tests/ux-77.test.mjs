// v7.6.1 UX nits at 390x844: privacy label and first-run note, search-focus row, fallback heading,
// collapsed guide distance, negation booths out of hot dog and corn dog.
import { chromium, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8766/';
const ME = { latitude: 35.7935, longitude: -78.7105, accuracy: 5 };
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const LABEL = 'Share booth visits & taps (random device id, no location)';
const NOTE = 'Fair Finder counts booth visits and food-chip taps with a random device id (no location, no typing). Turn it off in ☰ Layers.';

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
await ctx.route('**/*', route => {
  const u = route.request().url();
  if (/workers\.dev|127\.0\.0\.1:9/.test(u)) return route.abort();
  return route.continue();
});
await ctx.addInitScript(() => { try { localStorage.setItem('ff-title-seen','1'); } catch (e) {} }); const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.__ff && __ff.graph && __ff.me && __ff.booths && __ff.booths.length > 100, null, { timeout: 25000 });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(400);
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));

const note1 = await p.evaluate(() => {
  const el = document.getElementById('statsNote');
  const r = el.getBoundingClientRect();
  return {
    hidden: el.classList.contains('hidden'),
    text: (el.querySelector('p') || {}).textContent || '',
    got: (document.getElementById('statsNoteOk') || {}).textContent || '',
    settings: (document.getElementById('statsNoteSettings') || {}).textContent || '',
    top: r.top, bottom: r.bottom, right: r.right,
  };
});
ok(!note1.hidden && note1.text === NOTE && note1.got === 'Got it' && note1.settings === 'Settings', 'first-run note ' + JSON.stringify(note1));
ok(note1.right <= 390 && note1.bottom < 844, 'note stays on screen ' + JSON.stringify(note1));

await p.click('#statsNoteSettings');
await p.waitForTimeout(200);
const layers = await p.evaluate(() => {
  const panel = document.getElementById('layersPanel');
  const lab = document.querySelector('label input#tglStats');
  const text = lab ? lab.parentElement.innerText.replace(/\s+/g, ' ').trim() : '';
  return { open: panel && !panel.classList.contains('hidden'), text, checked: lab && lab.checked };
});
ok(layers.open && layers.text === LABEL && layers.checked, 'Settings opens Layers and the checkbox label is exact ' + JSON.stringify(layers));
await p.click('[data-close=layersPanel]');
await p.waitForTimeout(150);

await p.click('#statsNoteOk');
await p.waitForTimeout(100);
const dismissed = await p.evaluate(() => ({
  hidden: document.getElementById('statsNote').classList.contains('hidden'),
  seen: localStorage.getItem('ff.statsNoteSeen'),
}));
ok(dismissed.hidden && dismissed.seen === '1', 'Got it dismisses and stores ff.statsNoteSeen ' + JSON.stringify(dismissed));

await p.reload({ waitUntil: 'domcontentloaded' });
await ready();
await p.waitForTimeout(300);
const note2 = await p.evaluate(() => document.getElementById('statsNote').classList.contains('hidden') && localStorage.getItem('ff.statsNoteSeen') === '1');
ok(note2, 'note stays hidden after reload');

await p.tap('#q');
await p.waitForTimeout(400);
const focus = await p.evaluate(() => {
  const sf = document.getElementById('searchFocus');
  const pop = document.getElementById('popular');
  const btns = [...sf.querySelectorAll('button')].map(el => {
    const r = el.getBoundingClientRect();
    return { t: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  const sr = sf.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const head = (pop.querySelector('h3') || {}).textContent || '';
  const overflow = [...sf.querySelectorAll('*')].some(el => el.getBoundingClientRect().right > 390.5);
  return { hidden: sf.classList.contains('hidden'), btns, head, popTop: pr.top, sfBottom: sr.bottom, overflow, popHidden: pop.classList.contains('hidden') };
});
ok(!focus.hidden && !focus.popHidden && focus.head === 'Try searching', 'fallback heading Try searching ' + focus.head);
ok(focus.btns.length === 3 && !focus.btns.some(b => /Near me/.test(b.t)) && /restroom/i.test(focus.btns.map(b => b.t).join(' ')) && /ATM/.test(focus.btns.map(b => b.t).join(' ')) && /first aid/i.test(focus.btns.map(b => b.t).join(' ')), 'search focus keeps restroom, ATM, first aid and drops Near me ' + focus.btns.map(b => b.t).join(' | '));
ok(!focus.overflow && focus.btns.every(b => b.left >= -1 && b.right <= 390.5), 'search focus fits at 390 ' + JSON.stringify(focus.btns));
ok(focus.popTop >= focus.sfBottom - 2, 'popular sits under search focus ' + focus.popTop + ' >= ' + focus.sfBottom);

await p.keyboard.press('Escape');
await p.waitForTimeout(200);
await p.fill('#q', 'tilt a whirl');
await p.waitForTimeout(400);
await p.locator('#suggest li', { hasText: 'Tilt a Whirl' }).first().click();
await p.waitForTimeout(400);
await p.locator('.leaflet-popup button.go').click();
await p.waitForTimeout(700);
await p.evaluate(() => __ffSheet.set('collapsed'));
await p.tap('#chipNear');
await p.waitForTimeout(400);
const dist = await p.evaluate(() => {
  const el = document.getElementById('guideDist');
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()];
  const lines = rects.filter(r => r.width > 0 && r.height > 0);
  return {
    text: el.textContent,
    lines: lines.length,
    lineH: lines.reduce((m, r) => Math.max(m, r.height), 0),
    sh: el.scrollWidth,
    ch: el.clientWidth,
    boxH: el.getBoundingClientRect().height,
    near: !document.getElementById('nearPanel').classList.contains('hidden'),
    snap: window.__ffSheet.state,
  };
});
ok(dist.near && dist.snap === 'collapsed' && /walk/.test(dist.text) && dist.lines === 1 && dist.sh <= dist.ch + 1 && dist.boxH <= 33, 'collapsed distance is one line with Near me open ' + JSON.stringify(dist));

async function namesFor(q) {
  await p.fill('#q', q);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  return p.evaluate(() => [...document.querySelectorAll('#resList li[data-id]')].map(li => li.innerText));
}
const hotRows = await namesFor('hot dog');
ok(hotRows.length > 20 && !hotRows.some(t => /Demitiri|Lee, Dennis/.test(t)), 'hot dog UI excludes negation booths (' + hotRows.length + ')');
const cornRows = await namesFor('corn dog');
const cornRelated = cornRows.filter(t => /\brelated\b/i.test(t) && !/corn\s*dog|corndog|k-?dog/i.test(t));
ok(cornRows.length > 10 && !cornRows.some(t => /Demitiri|Lee, Dennis/.test(t)) && cornRelated.length === 0, 'corn dog UI excludes negation booths and hot-dog-only related rows (' + cornRows.length + ') ' + cornRelated.slice(0, 3).join(' || '));

await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
