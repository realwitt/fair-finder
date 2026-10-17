// GPS stall/recovery: fake navigator.geolocation that can stall, emit errors, and counts watch/getCurrentPosition calls.
import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8768/fair-finder/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium; const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await eng.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], permissions: process.env.FF_ENGINE === 'webkit' ? [] : ['accelerometer', 'gyroscope', 'magnetometer'] });
await ctx.addInitScript(() => {
  const F = window.__fakeGeo = { pos: [35.79485, -78.7093], acc: 17, watches: new Map(), next: 1, starts: 0, clears: 0, gets: 0, mode: 'live', opts: [] };
  const fix = () => ({ coords: { latitude: F.pos[0], longitude: F.pos[1], accuracy: F.acc, heading: null, speed: null }, timestamp: Date.now() });
  setInterval(() => { if (F.mode === 'live') for (const [, w] of F.watches) w.ok(fix()); }, 1000);
  const geo = {
    watchPosition(ok, err, o) { const id = F.next++; F.starts++; F.opts.push(o); F.watches.set(id, { ok, err }); return id; },
    clearWatch(id) { F.clears++; F.watches.delete(id); },
    getCurrentPosition(ok, err, o) { F.gets++; if (F.mode !== 'dead') setTimeout(() => ok(fix()), 200); },
  };
  // 'stall' = existing watches go silent forever (the iOS bug); a NEW watch or getCurrentPosition works again
  F.stall = () => { F.mode = 'stalled'; F.stalledIds = new Set(F.watches.keys()); };
  setInterval(() => { if (F.mode === 'stalled') for (const [id, w] of F.watches) if (!F.stalledIds.has(id)) w.ok(fix()); }, 1000);
  F.error = code => { for (const [, w] of F.watches) w.err({ code, message: code === 3 ? 'Timeout expired' : 'Position unavailable' }); };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
});
await ctx.addInitScript(() => { try { localStorage.setItem('ff-title-seen','1'); } catch (e) {} }); const p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message));
await p.goto(URL + '?booth=L0-1387'); await p.waitForFunction(() => window.__ff && __ff.route && __ff.guide && __ff.guide.mode === 'route', null, { timeout: 25000 });
const F = () => p.evaluate(() => ({ starts: __fakeGeo.starts, gets: __fakeGeo.gets, opts: __fakeGeo.opts.at(-1), fixes: __ff.fixCount, rem: __ff.guide.remainingM, dist: document.getElementById('guideDist').textContent, upd: document.getElementById('guideUpd').textContent, why: __ff.lastRestartWhy, btn: document.getElementById('btnGpsRefresh').classList.contains('show'), stale: document.getElementById('meDot').classList.contains('stale') }));
let s0 = await F();
ok(s0.opts.enableHighAccuracy === true && s0.opts.maximumAge <= 1000 && s0.opts.timeout >= 10000, 'watch options ' + JSON.stringify(s0.opts));
// walk helper: move the fake position along the route
const R = await p.evaluate(() => { const R = __ff.route.points; return [0, 20, 40, 60, 80, 100].map(x => Route.pointAt(R, x)); });
const moveTo = i => p.evaluate(ll => { __fakeGeo.pos = ll; }, R[i]);
// 1. low-accuracy fixes (150 ft) are used, distance updates every fix
await p.evaluate(() => { __fakeGeo.acc = 46; }); await moveTo(1); await p.waitForTimeout(3500);
let s1 = await F(); ok(s1.rem < s0.rem - 5 && s1.fixes > s0.fixes, `±150 ft fixes accepted: remaining ${Math.round(s0.rem)} -> ${Math.round(s1.rem)} m`);
await p.evaluate(() => { __fakeGeo.acc = 6; });
// 2. stall: existing watch goes silent -> watchdog restarts + kicks within ~15 s, distance updates again
await p.evaluate(() => __fakeGeo.stall()); await moveTo(2);
const tStall = Date.now(); await p.waitForFunction(n => __fakeGeo.starts > n, s1.starts, { timeout: 20000 }).catch(() => {});
const s2 = await F(); const dt = (Date.now() - tStall) / 1000;
ok(s2.starts > s1.starts && s2.gets > s1.gets && s2.why === 'watchdog' && dt < 17, `stalled watch -> watchdog restart + getCurrentPosition kick after ${dt.toFixed(1)} s`);
await p.waitForTimeout(2500); const s2b = await F();
ok(s2b.rem < s1.rem - 5 && !/paused|updating/.test(s2b.upd), `after restart distance updates again (${Math.round(s1.rem)} -> ${Math.round(s2b.rem)} m)`);
// 3. error callbacks (TIMEOUT, POSITION_UNAVAILABLE) -> restart
await p.evaluate(() => { __fakeGeo.mode = 'live'; }); const s3a = await F();
await p.evaluate(() => __fakeGeo.error(3)); await p.waitForTimeout(1800); const s3 = await F();
ok(s3.starts === s3a.starts + 1 && /error 3/.test(s3.why), 'TIMEOUT error -> watch restarted (' + s3.why + ')');
await p.evaluate(() => __fakeGeo.error(2)); await p.waitForTimeout(1800); const s3c = await F();
ok(s3c.starts === s3.starts + 1, 'POSITION_UNAVAILABLE error -> watch restarted');
// 4. visibility hidden -> clearWatch; visible -> new watch
const c0 = await p.evaluate(() => __fakeGeo.clears);
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
const c1 = await p.evaluate(() => ({ clears: __fakeGeo.clears, live: __fakeGeo.watches.size }));
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
const s4 = await F();
ok(c1.clears > c0 && c1.live === 0 && s4.starts > s3c.starts && s4.why === 'visible', 'hidden -> watch cleared; visible -> watch restarted + kick');
// 5. pageshow (bfcache) and focus
await p.evaluate(() => { const e = new Event('pageshow'); e.persisted = true; window.dispatchEvent(e); }); const s5 = await F(); ok(s5.why === 'pageshow' && s5.starts > s4.starts, 'pageshow(persisted) -> restart');
// 6. location totally dead -> after 20 s "Location paused, tap to refresh" + grey marker; tap restarts
await p.evaluate(() => { __fakeGeo.mode = 'dead'; }); await p.waitForTimeout(23000);
const s6 = await F(); ok(s6.btn && /Location paused/.test(s6.upd) && s6.stale, `no fix 20 s -> "${s6.upd}", refresh button shown, marker grey`);
ok(s6.starts >= s5.starts + 1, `watchdog kept retrying while dead (${s6.starts - s5.starts} restarts)`);
await p.screenshot({ path: `${SH}/24-v7-gps-paused.png` });
await p.evaluate(() => { __fakeGeo.mode = 'live'; }); const n6 = s6.starts;
await p.click('#btnGpsRefresh'); await p.waitForTimeout(1500); const s7 = await F();
ok(s7.starts === n6 + 1 && s7.why === 'user' && !s7.btn && !s7.stale, 'tap refresh -> watch restarted, fix arrives, button hides, marker blue');
// 7. compass ticks don't block: 50 orientation events, fixes keep flowing and route isn't redrawn each tick
try { await p.click('#btnCompassMini', { timeout: 2000 }); } catch (e) {} await p.waitForTimeout(300);
const before = await p.evaluate(() => __ff.fixCount);
for (let i = 0; i < 50; i++) await p.evaluate(h => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; window.dispatchEvent(e); }, i * 7);
await p.waitForTimeout(2500); ok((await p.evaluate(() => __ff.fixCount)) > before, 'fixes keep arriving during compass event storm');
// 8. you-marker: pulse blips on each fix, beam rotates with compass
const mk = await p.evaluate(() => ({ blip: document.getElementById('mePulse').classList.contains('blip'), beam: document.getElementById('meBeam').style.transform, op: document.getElementById('meBeam').style.opacity, core: getComputedStyle(document.querySelector('.meCore')).backgroundColor }));
ok(mk.blip && /rotate/.test(mk.beam) && mk.op === '1' && mk.core === 'rgb(26, 115, 232)', 'you-marker: blue core, pulse blip, heading beam ' + JSON.stringify(mk));
await p.screenshot({ path: `${SH}/25-v7-you-marker.png` });
await b.close(); console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
