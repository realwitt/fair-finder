// Share buttons: popup, guide (expanded + bar), results list, share-my-spot; navigator.share and copy fallback.
import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8768/fair-finder/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium; const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await eng.launch();
async function page(withShare) {
  const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: process.env.FF_ENGINE === 'webkit' ? ['geolocation'] : ['geolocation', 'clipboard-read', 'clipboard-write', 'accelerometer', 'gyroscope', 'magnetometer'] });
  await ctx.addInitScript(ws => { window.__shared = []; if (ws) navigator.share = async d => { window.__shared.push(d); }; else { try { delete Navigator.prototype.share; } catch (e) {} navigator.share = undefined; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); } }, withShare);
  const p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message)); return p;
}
let p = await page(true);
await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__ff && __ff.dj, null, { timeout: 20000 });
// results list Share
await p.fill('#q', 'turkey leg'); await p.waitForTimeout(700);
const firstId = await p.getAttribute('#resList li', 'data-id');
ok(await p.isVisible('#resList li .rShare') && /Share/.test(await p.textContent('#resList li .rShare')), 'results rows have a labeled Share button');
await p.click('#resList li .rShare'); await p.waitForTimeout(300);
let sh = await p.evaluate(() => __shared.pop());
ok(sh && sh.url.endsWith('/b/' + firstId + '.html?q=turkey%20leg') && !(await p.evaluate(() => !!__ff.target)), 'results Share -> navigator.share with booth link, does not start guiding: ' + (sh && sh.url));
await p.screenshot({ path: `${SH}/21-v7-share-results.png` });
// guide panel Share (expanded) and bar Share (after compass)
await p.click('#resList li .r-name'); await p.waitForTimeout(600);
await p.evaluate(() => __ffSheet.set('expanded', false)); await p.waitForTimeout(300);
const bs = await p.evaluate(() => { const r = document.getElementById('btnShare').getBoundingClientRect(); return { w: r.width, h: r.height, bg: getComputedStyle(document.getElementById('btnShare')).backgroundColor, txt: document.getElementById('btnShare').textContent.trim(), svg: !!document.querySelector('#btnShare svg') }; });
ok(bs.txt === 'Share' && bs.svg && bs.h >= 44 && bs.w >= 100 && bs.bg === 'rgb(26, 115, 232)', 'guide panel has a primary Share button with icon + text ' + JSON.stringify(bs));
await p.click('#btnShare'); await p.waitForTimeout(300); sh = await p.evaluate(() => __shared.pop());
ok(sh && sh.url.endsWith('/b/' + firstId + '.html?q=turkey%20leg'), 'guide Share -> booth link ' + (sh && sh.url));
await p.evaluate(() => __ffSheet.set('collapsed', false)); await p.waitForTimeout(300);
try { await p.click('#btnCompassMini', { timeout: 2000 }); } catch (e) {}
await p.waitForFunction(() => __ff.compassListening, null, { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(300);
await p.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 30; window.dispatchEvent(e); }); await p.waitForTimeout(400);
console.log('  dbg', JSON.stringify(await p.evaluate(() => ({ on: __ff.compassOn, l: __ff.compassListening, vis: document.getElementById('btnShareBar').style.visibility, cm: document.getElementById('btnCompassMini').style.visibility, st: __ffSheet.state }))));
ok(await p.isVisible('#btnShareBar') && (await p.textContent('#btnShareBar')).trim() === 'Share', 'collapsed bar shows Share (icon + text) once the compass is on');
await p.click('#btnShareBar'); await p.waitForTimeout(300); sh = await p.evaluate(() => __shared.pop());
ok(sh && sh.url.includes('/b/' + firstId + '.html') && await p.evaluate(() => __ffSheet.state === 'collapsed'), 'bar Share shares the booth and does not toggle the sheet');
await p.screenshot({ path: `${SH}/22-v7-share-bar.png` });
await p.click('#closeGuide'); await p.waitForTimeout(300);
// popup Share
await p.evaluate(() => { document.getElementById('closeResults').click(); });
await p.goto(URL + '?ll=35.79513,-78.71064&z=20'); await p.waitForTimeout(3500); await p.context().setGeolocation({ latitude: 35.7951274, longitude: -78.712, accuracy: 5 });
const pt = await p.evaluate(() => { const b = __ff.booths.find(x => x.id === 'L0-1387'); return window.__ffLL([b.lat, b.lon]); });
await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(900);
ok(await p.isVisible('.leaflet-popup .shareBooth') && /Share/.test(await p.textContent('.leaflet-popup .shareBooth')), 'booth card has a labeled Share button next to Guide me here');
await p.screenshot({ path: `${SH}/23-v7-share-card.png` });
await p.click('.leaflet-popup .shareBooth'); await p.waitForTimeout(300); sh = await p.evaluate(() => __shared.pop());
ok(sh && sh.url.endsWith('/b/L0-1387.html'), 'card Share -> ' + (sh && sh.url));
// share my spot
await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('.leaflet-popup-close-button') && document.querySelector('.leaflet-popup-close-button').click());
await p.click('#btnShareMe'); await p.waitForTimeout(300); sh = await p.evaluate(() => __shared.pop());
ok(sh && /\?booth=meet_35\.79513_-78\.71200$/.test(sh.url) && /walk to me/.test(sh.text), 'Share my spot -> ' + (sh && sh.url));
const spot = sh && sh.url;
await p.context().close();
// friend opens the spot link -> guided to it
p = await page(true); await p.goto(spot.replace('https://realwitt.github.io/fair-finder/', URL)); await p.waitForTimeout(4000);
const g = await p.evaluate(() => ({ t: __ff.target && __ff.target.id, name: document.getElementById('guideName').textContent, mode: __ff.guide && __ff.guide.mode }));
ok(g.t === 'meet_35.79513_-78.71200' && /Shared spot/.test(g.name) && g.mode === 'route', 'friend opening the spot link is guided there: ' + JSON.stringify(g));
await p.context().close();
// no navigator.share -> copy + toast
p = await page(false); await p.goto(URL + '?booth=L0-1387'); await p.waitForTimeout(3500);
await p.evaluate(() => __ffSheet.set('expanded', false)); await p.click('#btnShare'); await p.waitForTimeout(250);
const cp = await p.evaluate(() => ({ c: window.__copied, t: document.getElementById('toast').textContent, v: !document.getElementById('toast').classList.contains('hidden') }));
ok(cp.c && cp.c.endsWith('/b/L0-1387.html') && cp.t === 'Link copied' && cp.v, 'no Web Share: link copied + "Link copied" toast (' + cp.c + ')');
await b.close(); console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
