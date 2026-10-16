// v7.7.1: the first-run stats note stays visible and tappable above an open guide sheet (it was covered at z-index 800).
import { chromium, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8766/';
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: { latitude: 35.7935, longitude: -78.7105, accuracy: 5 }, permissions: ['geolocation'] });
await ctx.route(/workers\.dev/, r => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL + '?booth=L0-1387', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ff && __ff.graph && __ff.me && __ff.booths.length > 100 && document.body.classList.contains('guiding'), null, { timeout: 25000 });
await p.waitForTimeout(600);
const probe = () => p.evaluate(() => {
  const n = document.getElementById('statsNote'), r = n.getBoundingClientRect();
  const top = el => { const q = el.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!hit && (hit === el || el.contains(hit)); };
  return { hidden: n.classList.contains('hidden'), right: r.right, bottom: r.bottom, top: r.top, ok: top(document.getElementById('statsNoteOk')), settings: top(document.getElementById('statsNoteSettings')), text: (() => { const q = n.querySelector('p'); q.style.pointerEvents = 'auto'; const v = top(q); q.style.pointerEvents = ''; return v; })(), snap: window.__ffSheet && __ffSheet.state, sheetTop: document.getElementById('guide').getBoundingClientRect().top };
});
for (const snap of ['expanded', 'collapsed']) {
  await p.evaluate(s => __ffSheet.set(s), snap); await p.waitForTimeout(400);
  const r = await probe();
  ok(!r.hidden && r.ok && r.settings && r.text && r.right <= 390 && r.top >= 0, `note visible and tappable over the ${snap} guide sheet ` + JSON.stringify(r));
}
await p.evaluate(() => __ffSheet.set('expanded')); await p.waitForTimeout(300);
await p.tap('#statsNoteSettings'); await p.waitForTimeout(250);
ok(await p.evaluate(() => { const lp = document.getElementById('layersPanel'), r = lp.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 20, r.top + 20); return !lp.classList.contains('hidden') && lp.contains(hit); }), 'Settings opens Layers above the note');
await p.click('[data-close=layersPanel]'); await p.waitForTimeout(150);
await p.tap('#statsNoteOk'); await p.waitForTimeout(150);
ok(await p.evaluate(() => document.getElementById('statsNote').classList.contains('hidden') && localStorage.getItem('ff.statsNoteSeen') === '1'), 'Got it dismisses while guiding');
await p.screenshot({ path: (process.env.FF_SHOTS || '/tmp') + '/note-771-after-dismiss.png' }).catch(() => {});
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
