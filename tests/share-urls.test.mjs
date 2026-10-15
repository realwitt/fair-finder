import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 6 };
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await eng.launch();
const ready = p => p.waitForFunction(() => window.__ff && window.__ff.booths.length > 100);
// 1. search link
let ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: ['geolocation'] });
let p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message));
await p.goto(URL + '?q=empanada', { waitUntil: 'networkidle' }); await ready(p); await p.waitForTimeout(800);
ok(await p.inputValue('#q') === 'empanada' && await p.locator('#resList li').count() === 3 && await p.locator('#results').isVisible(), '?q=empanada restores search (3 results)');
ok(/v\d+/.test(await p.textContent('#version')), 'version ' + await p.textContent('#version'));
// 2. select result -> pushState booth, Back/Forward
await p.locator('#resList li').first().click(); await p.waitForTimeout(500);
const id = await p.evaluate(() => __ff.target.id);
ok(new globalThis.URL(p.url()).searchParams.get('booth') === id && p.url().includes('q=empanada'), 'URL after select: ' + p.url().replace(/^.*\?/, '?'));
ok((await p.title()).includes(await p.evaluate(() => __ff.target.name)), 'title has booth name: ' + await p.title());
await p.goBack(); await p.waitForTimeout(500);
ok(!(await p.locator('#guide').isVisible()) && !new globalThis.URL(p.url()).searchParams.get('booth') && await p.locator('#results').isVisible(), 'Back closes guide, keeps search');
await p.goForward(); await p.waitForTimeout(500);
ok(await p.locator('#guide').isVisible() && await p.evaluate(() => __ff.target && __ff.target.id) === id, 'Forward re-opens guide');
// 3. Share: navigator.share stub
await p.evaluate(() => { window.__shared = null; navigator.share = async d => { window.__shared = d; }; });
await p.evaluate(() => __ffSheet.set('expanded', false)); await p.waitForTimeout(300); await p.click('#btnShare'); await p.waitForTimeout(300);
const sh = await p.evaluate(() => window.__shared);
ok(sh && sh.url.includes('/b/' + id + '.html') && sh.title.includes(await p.evaluate(() => __ff.target.name)), 'navigator.share called: ' + (sh && sh.url));
// clipboard fallback
await p.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); window.__clip = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__clip = t; } }, configurable: true }); });
await p.click('#btnShare'); await p.waitForTimeout(300);
ok((await p.evaluate(() => window.__clip) || '').includes('/b/' + id + '.html') && await p.locator('#toast').isVisible(), 'clipboard fallback + "Link copied" toast');
// 4. map center in URL
await p.click('#closeGuide'); await p.waitForTimeout(900);
ok(/ll=35\.\d+,-78\.\d+/.test(p.url()) && /z=\d+/.test(p.url()) && !/booth=/.test(p.url()), 'Stop removes booth, URL keeps center/zoom: ' + p.url().replace(/^.*\?/, '?'));
// 5. share page redirect + OG
const page = await (await fetch(URL + 'b/' + id + '.html')).text();
ok(/og:title" content="[^"]+Fair Finder \(unofficial\)/.test(page), 'share page has og:title');
await p.goto(URL + 'b/' + id + '.html?q=empanada', { waitUntil: 'networkidle' }); await ready(p); await p.waitForTimeout(800);
ok(new globalThis.URL(p.url()).searchParams.get('booth') === id && await p.locator('#guide').isVisible() && await p.evaluate(() => __ff.guide && __ff.guide.distanceM > 0), 'shared /b/ link -> guide from my location');
// 6. offline query-string URL via service worker
await p.evaluate(async () => { await navigator.serviceWorker.ready; });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await ctx.setOffline(true);
await p.goto(URL + '?q=pizza&x=' + Date.now()).catch(e => fails.push('offline nav ' + e.message)); await ready(p).catch(() => {}); await p.waitForTimeout(800);
ok(await p.locator('#resList li').count() > 5, 'offline ?q=pizza served from SW: ' + await p.locator('#resList li').count());
await ctx.close();
// 7. location denied: shared booth link just shows the booth
ctx = await b.newContext({ ...devices['iPhone 14 Pro'] }); p = await ctx.newPage();
await p.goto(URL + '?booth=' + id, { waitUntil: 'networkidle' }); await ready(p); await p.waitForTimeout(2500);
const nl = await p.evaluate(() => ({ cls: document.getElementById('guide').className, hint: document.getElementById('guideHint').textContent, me: __ff.me }));
ok(!nl.me && /noloc/.test(nl.cls) && /Location is off/.test(nl.hint), 'no location permission: shows booth only: ' + nl.hint);
await p.screenshot({ path: '/workspace/fair-finder-shots/13-shared-link-no-location.png' });
await b.close();
console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
