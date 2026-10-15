import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const START = { latitude: 35.79485, longitude: -78.7093, accuracy: 6 };
const fails = []; const ok = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } else if (process.env.V) console.log('PASS ' + m); };
const b = await eng.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: START, permissions: process.env.FF_ENGINE === 'webkit' ? ['geolocation'] : ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.booths.length > 100 && window.__ff.me);
const ver = await p.textContent('#version'); ok(/v\d+/.test(ver), 'version label: ' + ver); console.log('version label:', ver);
await p.fill('#q', 'turkey leg'); await p.waitForTimeout(500);
await p.locator('#resList li').nth(2).click(); await p.waitForTimeout(500);
const T = await p.evaluate(() => ({ id: __ff.target.id, lat: __ff.target.lat, lon: __ff.target.lon, name: __ff.target.name }));
console.log('target', T.name);
try { await p.click('#btnCompass', { timeout: 2000 }); } catch (e) {}
const visible = async (tag) => { const v = await p.locator('#guide').isVisible(); const id = await p.evaluate(() => __ff.target && __ff.target.id); ok(v && id === T.id, `guide visible + same target after: ${tag} [visible=${v} target=${id}]`); return v; };
const compass = h => p.evaluate(h => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; window.dispatchEvent(e); }, h);
const t0 = Date.now(); let i = 0, lastD = null, dChanged = 0;
const N = Number(process.env.STEPS || 62); // 62 steps x 2 s ≈ 124 s
while (i < N) {
  const f = i / N * 0.85; // walk 85% of the way toward the booth
  await ctx.setGeolocation({ latitude: START.latitude + (T.lat - START.latitude) * f + (i % 3) * 1e-6, longitude: START.longitude + (T.lon - START.longitude) * f, accuracy: i % 10 === 5 ? 60 : 6 });
  await compass((i * 7) % 360);
  if (i % 8 === 1) { const m = p.locator('#map'); const bb = await m.boundingBox(); await p.mouse.move(bb.x + 200, bb.y + 250); await p.mouse.down(); await p.mouse.move(bb.x + 120, bb.y + 200, { steps: 5 }); await p.mouse.up(); }
  if (i % 8 === 3) { if (await p.locator('#results').isVisible()) await p.click('#closeResults'); await p.mouse.click(60, 300); } // tap on bare map
  if (i % 8 === 5) { await p.fill('#q', ['lemonade', 'hot dog', 'pizza'][i % 3]); await p.waitForTimeout(300); }
  if (i % 8 === 6) await p.locator('.chip').nth(i % 5).click();
  if (i % 10 === 7) await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(2000);
  await visible(`step ${i} (${Math.round((Date.now() - t0) / 1000)}s)`);
  const g = await p.evaluate(() => __ff.guide); if (lastD != null && Math.abs(g.distanceM - lastD) > 0.05) dChanged++; lastD = g.distanceM;
  if (i === 20) await p.screenshot({ path: `${SH}/10-guide-while-searching.png` });
  i++;
}
const elapsed = (Date.now() - t0) / 1000; console.log('simulated walk seconds:', Math.round(elapsed));
ok(elapsed >= 120 || N < 62, 'ran for 2+ minutes'); ok(dChanged > N * 0.6, `distance updated live (${dChanged}/${N} steps)`);
const resumes = await p.evaluate(() => __ff.resumeCount || 0); ok(resumes >= 3, 'visibilitychange re-acquired GPS/compass x' + resumes);
// Stall: no updates for 13 s -> still visible with "updating"
const rotBefore = await p.evaluate(() => __ff.guide.arrowRotation);
await p.waitForTimeout(13000);
await visible('13s stall');
const upd = await p.textContent('#guideUpd'); ok(/updating/.test(upd), 'stall note: ' + upd);
const g2 = await p.evaluate(() => __ff.guide); ok(g2.headingSource !== 'north' && Math.abs(g2.arrowRotation - rotBefore) < 0.5, 'arrow kept last heading during stall');
await p.screenshot({ path: `${SH}/11-guide-stalled.png` });
// Arrive
await ctx.setGeolocation({ latitude: T.lat + 0.00005, longitude: T.lon, accuracy: 5 }); await p.waitForTimeout(2500);
await visible('arrived'); ok(await p.evaluate(() => document.getElementById('guide').classList.contains('arrived')), 'arrived state shown, not closed: ' + await p.textContent('#guideHint'));
await p.screenshot({ path: `${SH}/12-guide-arrived.png` });
// Reload resumes
await p.reload({ waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__ff && window.__ff.booths.length > 100); await p.waitForTimeout(1500);
await visible('page reload (localStorage resume)');
// Explicit stop is the only exit
await p.click('#closeGuide'); await p.waitForTimeout(300);
ok(!(await p.locator('#guide').isVisible()), 'Stop hides guide');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
ok(!(await p.locator('#guide').isVisible()), 'after Stop, reload does not resume');
await b.close();
console.log(fails.length ? `${fails.length} FAILURES` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
