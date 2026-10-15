import { chromium, webkit, devices } from 'playwright';
const SHOTS = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
// Mock position: in front of Dorton Arena, between the Midway and Kiddieland (official GIS area)
const ME = { latitude: 35.79485, longitude: -78.70930, accuracy: 6 };
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const engine = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: process.env.FF_ENGINE === 'webkit' ? ['geolocation'] : ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'] });
const page = await ctx.newPage();
page.on('pageerror', e => fails.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ff && window.__ff.booths.length > 100 && window.__ff.me);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/01-start-overlay.png` });
const st = await page.evaluate(() => ({ n: __ff.booths.length, me: __ff.me, atms: __ff.atms.length }));
ok(st.n > 400, `booths loaded: ${st.n}`); ok(Math.abs(st.me[0] - ME.latitude) < 1e-6, 'mock geolocation received');
ok(await page.locator('.youDot').count() === 1, 'blue dot shown');
ok(await page.locator('.fairTiles img').count() > 0, 'official fair tiles rendered: ' + await page.locator('.fairTiles img').count());

// Search
for (const q of ['empanada', 'hotdog', 'turkey leg', 'funel cake', 'fried cheeseburger']) {
  await page.fill('#q', q); await page.waitForTimeout(400);
  const res = await page.evaluate(() => __ff.results.map(r => ({ name: r.booth.name, d: r.d, tier: r.tier, matched: r.matched })));
  ok(res.length > 0, `search "${q}" -> ${res.length} results; first: ${res[0]?.name} (${Math.round((res[0]?.d || 0) * 3.28)} ft) [${res[0]?.matched.slice(0, 2).join('; ')}]`);
  const t0 = res.filter(r => r.tier === 0); ok(t0.every((r, i) => i === 0 || r.d >= t0[i - 1].d), `"${q}" direct matches sorted by distance`);
}
await page.fill('#q', 'hot dog'); await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/02-search-hotdog.png` });
await page.fill('#q', 'empanada'); await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/03-search-empanada.png` });

// Guide (no compass -> north-up)
await page.fill('#q', 'turkey leg'); await page.waitForTimeout(500);
await page.locator('#resList li').nth(1).click(); await page.waitForTimeout(800);
const g = await page.evaluate(() => __ff.guide);
const t = await page.evaluate(() => ({ lat: __ff.target.lat, lon: __ff.target.lon, name: __ff.target.name }));
// independent bearing check (flat-earth approximation is fine at this scale)
const dy = (t.lat - ME.latitude) * 111320, dx = (t.lon - ME.longitude) * 111320 * Math.cos(ME.latitude * Math.PI / 180);
const approxBr = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, approxD = Math.hypot(dx, dy);
ok(Math.abs(((g.bearing - approxBr + 540) % 360) - 180) < 1, `bearing ${g.bearing.toFixed(1)}° vs independent ${approxBr.toFixed(1)}° to ${t.name}`);
ok(Math.abs(g.distanceM - approxD) / approxD < 0.01, `distance ${g.distanceM.toFixed(1)} m vs ${approxD.toFixed(1)} m`);
ok(g.headingSource === 'north' && Math.abs(g.arrowRotation - g.bearing) < 0.01, 'no compass: north-up arrow = bearing');
ok(await page.locator('#guide').isVisible(), 'guide visible: ' + await page.textContent('#guideHint'));
await page.screenshot({ path: `${SHOTS}/04-guide-northup.png` });

// Simulated compass via deviceorientation with webkitCompassHeading (iOS style); button tap requests permission like on iPhone
await page.click('#btnCompass'); await page.waitForTimeout(300);
await page.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 90; e.alpha = 0; window.dispatchEvent(e); });
await page.waitForTimeout(500);
const g2 = await page.evaluate(() => __ff.guide);
const expRel = ((g2.bearing - 90 + 540) % 360) - 180;
ok(g2.headingSource === 'compass' && Math.abs(g2.arrowRotation - expRel) < 0.01, `compass heading 90°: arrow ${g2.arrowRotation.toFixed(1)}° (expected ${expRel.toFixed(1)}°), hint "${await page.textContent('#guideHint')}"`);
const line = await page.evaluate(() => document.querySelectorAll('path.leaflet-interactive').length);
await page.screenshot({ path: `${SHOTS}/05-guide-compass.png` });

// Unit checks of the bearing/hint math
const unit = await page.evaluate(() => [
  Geo.bearingDeg(35.79, -78.71, 35.80, -78.71), Geo.bearingDeg(35.79, -78.71, 35.79, -78.70), Geo.bearingDeg(35.79, -78.71, 35.78, -78.71), Geo.bearingDeg(35.79, -78.70, 35.79, -78.71),
  Geo.relativeDeg(10, 350), Geo.relativeDeg(350, 10), Geo.hint(91.44, 340, 0), Geo.hint(91.44, 100, 0), Geo.hint(91.44, 180, 0)]);
ok(Math.abs(unit[0]) < 0.01 && Math.abs(unit[1] - 90) < 0.1 && Math.abs(unit[2] - 180) < 0.01 && Math.abs(unit[3] - 270) < 0.1, 'cardinal bearings N/E/S/W: ' + unit.slice(0, 4).map(x => x.toFixed(2)).join(','));
ok(unit[4] === 20 && unit[5] === -20, 'relative angle wraps across north');
ok(unit[6] === 'about 300 ft, ahead and slightly left' && unit[7] === 'about 300 ft, to your right' && unit[8] === 'about 300 ft, behind you', 'hints: ' + unit.slice(6).join(' | '));

// Layers
await page.click('#closeGuide');
await page.click('#btnLayers'); await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/06-layers-panel.png` });
await page.check('#tglATM'); await page.check('#tglDrinks');
await page.fill('#fairOpacity', '40'); await page.dispatchEvent('#fairOpacity', 'input');
const op = await page.evaluate(() => getComputedStyle(document.querySelector('.fairTiles')).opacity);
ok(Math.abs(op - 0.4) < 0.01, 'opacity slider -> ' + op);
await page.click('[data-close=layersPanel]');
await page.evaluate(() => { const m = window.__ff; }); await page.waitForTimeout(300);
const atmN = await page.locator('.atmIcon').count(); ok(atmN >= 10, 'ATM markers visible: ' + atmN);
await page.screenshot({ path: `${SHOTS}/07-atms-drinks.png` });
await page.click('#btnLayers'); await page.uncheck('#tglFair'); await page.uncheck('#tglATM'); await page.click('[data-close=layersPanel]');
ok(await page.locator('.fairTiles').count() === 0 && await page.locator('.atmIcon').count() === 0, 'fair map + ATM toggles off');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SHOTS}/08-satellite-only.png` });
// Service worker
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }).catch(e => 'err ' + e.message);
ok(sw === true, 'service worker active');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES:\n` + fails.join('\n') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
