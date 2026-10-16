// v7: guide sheet (collapse/expand, tap+drag+keyboard, remembered), no layout shift, route visible when collapsed,
// legal/compliance text, base map, landing page.
import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8766/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
const NAME = 'Fair Finder: Unofficial Guide to the 2026 N.C. State Fair';
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await eng.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: process.env.FF_ENGINE === 'webkit' ? ['geolocation'] : ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message));
await p.goto(URL + '?booth=L0-1387', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && __ff.route && __ff.guide && __ff.guide.mode === 'route', null, { timeout: 25000 });
await p.waitForTimeout(800);
const vh = await p.evaluate(() => innerHeight);
console.log('version', await p.textContent('#version'), 'viewport h', vh);
const box = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10).join(','); }, sel);
const snap = () => p.evaluate(() => ({ st: __ffSheet.state, exp: document.getElementById('sheetBar').getAttribute('aria-expanded'), inert: document.getElementById('guideMore').hasAttribute('inert'), top: document.getElementById('guide').getBoundingClientRect().top, mapH: document.getElementById('map').getBoundingClientRect().height }));
// 1. default collapsed, bar ~104 px
let s = await snap();
ok(s.st === 'expanded' && (await p.textContent('#guideName')) === 'Piche Concessions' && await p.isVisible('#btnShare'), 'opened from a shared link: booth card shown expanded (name, menu, Share)');
await p.click('#sheetBar', { position: { x: 196, y: 8 } }); await p.waitForTimeout(450);
s = await snap();
ok(s.st === 'collapsed' && s.exp === 'false' && s.inert, 'tap collapses to the bar (aria-expanded=false, expanded part inert)');
ok(Math.abs((vh - s.top) - 104) < 1.5, `collapsed bar visible height ${Math.round(vh - s.top)} px (target 90–110)`);
ok(Math.abs(s.mapH - (vh - 104)) < 1.5, `map sized to visible area above the bar (${Math.round(s.mapH)} px)`);
ok(await p.isVisible('#closeGuide') && (await p.textContent('#guideDist')).includes('walk') && (await p.textContent('#guideHint')).length > 5, 'bar shows distance, next-turn hint and Stop: "' + await p.textContent('#guideDist') + ' / ' + await p.textContent('#guideHint') + '"');
// 2. route visible above the bar when collapsed
const vis = await p.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect(), top = document.getElementById('guide').getBoundingClientRect().top; const lm = window.__ffMap; return null; });
const inView = await p.evaluate(() => { const path = document.querySelector('.leaflet-overlay-pane canvas, .leaflet-overlay-pane svg'); return true; });
const rv = await p.evaluate(() => { const top = document.getElementById('guide').getBoundingClientRect().top; const pts = __ff.route.points.concat([__ff.me]); const out = pts.map(ll => window.__ffLL(ll)); return { top, out: out.filter(([x, y]) => x < 0 || x > innerWidth || y < 0 || y > top).length, n: pts.length, maxY: Math.max(...out.map(q => q[1])) }; });
ok(rv.out === 0, `whole route + you inside the visible map above the bar (${rv.n} points, lowest at y=${Math.round(rv.maxY)} < bar top ${Math.round(rv.top)})`);
await p.screenshot({ path: `${SH}/18-v7-guide-collapsed.png` });
// 3. no layout shift across many GPS/hint/compass updates (collapsed)
const compass = h => p.evaluate(h => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; e.webkitCompassAccuracy = 10; window.dispatchEvent(e); }, h);
try { await p.click('#btnCompassMini', { timeout: 2000 }); } catch (e) {}
const R = await p.evaluate(() => { const R = __ff.route.points, L = Route.polyLen(R), o = []; for (let x = 0; x < L - 20; x += 9) o.push(Route.pointAt(R, x)); return o; });
async function shiftRun(label) {
  const sels = ['#guide', '#sheetBar', '#guideDist', '#guideHint', '#closeGuide', '#miniArrowWrap', '#guideMore', '#guideMenu', '#guideMeta', '#guideRoute', '#map'];
  const base = {}; for (const q of sels) base[q] = await box(q);
  const hints = new Set(); let moved = [];
  for (let i = 0; i < R.length; i++) {
    await ctx.setGeolocation({ latitude: R[i][0], longitude: R[i][1], accuracy: 4 + (i % 5) * 9 });
    await compass((i * 37) % 360); await p.waitForTimeout(260);
    hints.add(await p.textContent('#guideHint'));
    for (const q of sels) { const bx = await box(q); if (bx !== base[q]) moved.push(`${q} ${base[q]} -> ${bx}`); }
  }
  ok(moved.length === 0 && hints.size >= 4, `${label}: no layout shift over ${R.length} GPS+compass updates with ${hints.size} different hints` + (moved.length ? ': ' + moved.slice(0, 3).join(' | ') : ''));
}
await shiftRun('collapsed');
// 4. tap toggles
await p.click('#sheetBar', { position: { x: 196, y: 8 } }); await p.waitForTimeout(450);
s = await snap();
ok(s.st === 'expanded' && s.exp === 'true' && !s.inert && Math.abs(s.mapH - (vh - (vh - s.top))) < 1.5, `tap on bar expands (sheet top ${Math.round(s.top)}, map ${Math.round(s.mapH)} px)`);
ok(await p.isVisible('#guideMenu') && await p.evaluate(() => { const m = document.getElementById('guideMenu'); return getComputedStyle(m).overflowY === 'auto'; }), 'menu sits in its own scroll area');
await shiftRun('expanded');
await p.screenshot({ path: `${SH}/19-v7-guide-expanded.png` });
// 5. menu scroll doesn't move the sheet
const g0 = await box('#guide'); await p.evaluate(() => { document.getElementById('guideMenu').scrollTop = 200; }); ok(g0 === await box('#guide'), 'scrolling the menu does not move the sheet');
// 6. tap collapses; drag up expands; drag down collapses
await p.click('#sheetBar', { position: { x: 196, y: 8 } }); await p.waitForTimeout(450);
ok((await snap()).st === 'collapsed', 'second tap collapses');
const drag = async dy => { const t = (await snap()).top; await p.mouse.move(196, t + 10); await p.mouse.down(); for (let k = 1; k <= 8; k++) { await p.mouse.move(196, t + 10 + dy * k / 8); await p.waitForTimeout(30); } await p.mouse.up(); await p.waitForTimeout(450); };
await drag(-260); ok((await snap()).st === 'expanded', 'drag handle up -> expanded');
await drag(240); ok((await snap()).st === 'collapsed', 'drag handle down -> collapsed');
// 7. keyboard
await p.focus('#sheetBar'); await p.keyboard.press('Enter'); await p.waitForTimeout(350); ok((await snap()).st === 'expanded', 'Enter on focused handle expands');
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(350); ok((await snap()).st === 'collapsed', 'ArrowDown collapses');
// 8. remembered across reload
await p.keyboard.press('ArrowUp'); await p.waitForTimeout(350);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__ffSheet && __ffSheet.visible, null, { timeout: 20000 }); await p.waitForTimeout(600);
ok((await snap()).st === 'expanded', 'last choice (expanded) remembered after reload');
await p.keyboard.press('Escape'); await p.evaluate(() => __ffSheet.set('collapsed'));
// 9. compliance: name, wording, attribution, base map, about text, manifest
ok((await p.title()).includes('Fair Finder') && await p.evaluate(n => document.querySelector('meta[property="og:site_name"]').content === n, NAME), 'og:site_name is the full unofficial name');
await p.evaluate(() => __ff && document.getElementById('closeGuide').click()); await p.waitForTimeout(300);
ok(await p.title() === NAME, 'page title: ' + await p.title());
const man = await p.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).name); ok(man === NAME, 'manifest name: ' + man);
const bodyTxt = await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' '));
ok(!/(^|[^n])official/i.test(bodyTxt.replace(/For official information/g, '')), 'no "official" wording in the app UI');
ok(/Fair’s published grounds map/.test(await p.evaluate(() => document.body.textContent)) && /Menu \(from fair listing\)/.test(await p.evaluate(() => document.getElementById('guideMenu').innerHTML)), 'renamed labels present');
const attr = await p.evaluate(() => document.querySelector('.leaflet-control-attribution').innerHTML);
ok(/href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>© OpenStreetMap/.test(attr) && /fixthemap/.test(attr) && /Grounds map © N\.C\. Department of Agriculture &amp; Consumer Services/.test(attr), 'map attribution: OSM copyright link, Report a map issue, NCDA&CS grounds map');
ok(await p.evaluate(() => document.querySelector('input[name=base][value=osm]').checked && !!document.querySelector('img[src*="tile.openstreetmap.org"]') && !document.querySelector('img[src*="World_Imagery"]')), 'OSM street map is the default base map');
await p.evaluate(() => { const r = document.querySelector('input[name=base][value=sat]'); r.checked = true; r.dispatchEvent(new Event('change')); }); await p.waitForTimeout(800);
ok(/Powered by <a[^>]*>Esri<\/a>.*Imagery: Esri, Maxar, Earthstar Geographics/.test(await p.evaluate(() => document.querySelector('.leaflet-control-attribution').innerHTML)), 'satellite layer shows Powered by Esri + imagery attribution');
await p.evaluate(() => { const r = document.querySelector('input[name=base][value=osm]'); r.checked = true; r.dispatchEvent(new Event('change')); });
const tiles = await p.evaluate(() => { const u = []; document.getElementById('btnOffline'); return null; });
await p.click('#btnLayers'); await p.click('#aboutLink'); await p.waitForTimeout(300);
const ab = await p.textContent('#aboutBody');
ok(/not affiliated with, endorsed by, or sponsored by the N\.C\. State Fair or the N\.C\. Department of Agriculture & Consumer Services/.test(ab) && /ncstatefair\.org/.test(ab), 'About: disclaimer');
ok(/use at your own risk\. Provided as-is, with no warranty\./.test(ab) && /never sent to us or stored on a server/.test(ab) && /GitHub Pages, which logs visitor IP addresses/.test(ab), 'About: accuracy + privacy notes');
ok(/Routes: OpenStreetMap data \(ODbL\)/.test(ab) && /Report a map issue/.test(ab) && /Booth data: N\.C\. State Fair Food & Ride Finder/.test(ab), 'About: credits');
// offline download list excludes Esri/OSM
const offl = await p.evaluate(async () => { const src = await (await fetch('app.js')).text(); return /SAT\.replace\('\{z\}'/.test(src); });
ok(!offl, 'offline download no longer includes satellite tiles');
// share page title
const sp = await p.evaluate(async () => (await (await fetch('b/L0-1387.html')).text()).match(/<title>([^<]*)/)[1]);
ok(/· Fair Finder \(unofficial\)$/.test(sp), 'share page title: ' + sp);
// 10. landing page
const lp = await ctx.newPage(); lp.on('pageerror', e => fails.push('landing pageerror ' + e.message));
await lp.goto(URL + 'about/', { waitUntil: 'networkidle' });
const L = await lp.evaluate(() => ({ h1: document.querySelector('h1').textContent, cta: [...document.querySelectorAll('a.cta')].map(a => a.href), imgs: [...document.images].map(i => (i.scrollIntoView(), i.currentSrc)), feats: [...document.querySelectorAll('.feature h3')].map(h => h.textContent), og: ['og:title', 'og:description', 'og:image', 'og:url', 'og:site_name'].every(k => document.querySelector(`meta[property="${k}"]`)), txt: document.body.innerText, title: document.title }));
await lp.waitForTimeout(800);
const loaded = await lp.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
ok(/N\.C\. State Fair/.test(L.h1) && L.title === NAME, 'landing headline: ' + L.h1);
ok(L.cta.length >= 1 && L.cta.every(h => h === new globalThis.URL('../', URL + 'about/').href), 'Open the app button -> ' + L.cta[0]);
ok(L.feats.join('|') === 'Search any food|Live walking directions|Find an ATM|Share a booth link', 'feature blurbs: ' + L.feats.join(', '));
ok(L.imgs.length >= 4 && loaded, `${L.imgs.length} real app screenshots load`);
ok(L.og, 'landing OG tags');
ok(/Allow location/.test(L.txt) && /Enable compass/.test(L.txt) && /Add to Home Screen/.test(L.txt), 'how-to: location, compass, Add to Home Screen');
ok(/not affiliated with, endorsed by, or sponsored by/.test(L.txt) && /Food & Ride Finder/.test(L.txt) && /OpenStreetMap/.test(L.txt), 'landing footer disclaimer + credits');
ok(!/flyer|qr code|\bQR\b|poster/i.test(L.txt), 'landing page has no flyer/QR suggestions');
ok(!/\b\d(\.\d)?\s?(stars?|★)|reviews?\b|testimonial|users love|downloads/i.test(L.txt), 'no reviews/ratings/stats claims');
const ogimg = await lp.evaluate(async () => (await fetch(document.querySelector('meta[property="og:image"]').content.replace(/^https:\/\/(realwitt\.github\.io\/fair-finder|fairfinder\.birbol\.com)\//, location.href.replace(/about\/.*$/, '')))).status);
ok(ogimg === 200, 'og:image reachable');
await lp.screenshot({ path: `${SH}/20-v7-landing.png`, fullPage: true });
await lp.screenshot({ path: `${SH}/20-v7-landing-top.png` });
// default snap for a guide started in-app (fresh storage) is collapsed
{ const c2 = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: ['geolocation'] }); const q = await c2.newPage();
  await q.goto(URL, { waitUntil: 'networkidle' }); await q.waitForFunction(() => window.__ff && __ff.dj, null, { timeout: 20000 });
  await q.fill('#q', 'turkey leg'); await q.waitForTimeout(700); await q.click('#resList li'); await q.waitForTimeout(600);
  ok(await q.evaluate(() => __ffSheet.state === 'collapsed' && document.getElementById('sheetBar').getAttribute('aria-expanded') === 'false'), 'guide started from the list opens collapsed by default'); await c2.close(); }
await b.close();
console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
