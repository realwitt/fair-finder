import { chromium, webkit, devices } from 'playwright';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await eng.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: process.env.FF_ENGINE === 'webkit' ? ['geolocation'] : ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage(); p.on('pageerror', e => fails.push('pageerror ' + e.message));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.graph && window.__ff.dj && window.__ff.me, null, { timeout: 20000 });
console.log('version', await p.textContent('#version'));
// 1. results sorted by WALKING distance
await p.fill('#q', 'turkey leg'); await p.waitForTimeout(600);
const rs = await p.evaluate(() => __ff.results.filter(r => r.tier === 0).map(r => ({ n: r.booth.name, d: r.d, walk: r.walk, s: Geo.distanceM(__ff.me[0], __ff.me[1], r.booth.lat, r.booth.lon) })));
ok(rs.every(r => r.walk) && rs.every((r, i) => !i || r.d >= rs[i - 1].d - 0.01), 'turkey leg results sorted by walking distance: ' + rs.slice(0, 4).map(r => `${r.n} ${Math.round(r.d * 3.28)}ft walk/${Math.round(r.s * 3.28)}ft straight`).join(' | '));
ok(rs.every(r => r.d >= r.s - 1), 'walking distance >= straight-line for all results');
ok(/🚶/.test(await p.textContent('#resList li')), 'list shows walking distance');
// 2. pick a booth whose route has a turn, start guidance
const pick = await p.evaluate(() => {
  const g = __ff.graph; let best = null;
  for (const b of __ff.booths.filter(b => b.food)) {
    const s = Geo.distanceM(__ff.me[0], __ff.me[1], b.lat, b.lon); if (s < 120 || s > 260) continue;
    const r = g.route(__ff.me, [b.lat, b.lon]); if (!r) continue;
    const t = Route.nextTurn(r.points, 0);
    if (t && t.inM > 25 && r.lengthM / s > 1.15 && (!best || r.lengthM / s > best.ratio)) best = { id: b.id, name: b.name, ratio: r.lengthM / s, len: r.lengthM };
  }
  return best;
});
ok(!!pick, 'found test booth with a turn: ' + JSON.stringify(pick));
await p.evaluate(id => { history.replaceState(null, '', '?booth=' + id); dispatchEvent(new PopStateEvent('popstate')); }, pick.id);
await p.waitForTimeout(1200);
let g = await p.evaluate(() => __ff.guide);
ok(g.mode === 'route' && Math.abs(g.remainingM - pick.len) < 5, `route mode, ${Math.round(g.remainingM)} m walk`);
ok(/~\d+ min walking · route is approximate/.test(await p.textContent('#guideRoute')), 'shows walk time + approximate label: ' + await p.textContent('#guideRoute'));
ok(await p.evaluate(() => __ff.route.points.length > 3), 'route polyline drawn with ' + await p.evaluate(() => __ff.route.points.length) + ' points');
await p.screenshot({ path: `${SH}/14-route-start.png` });
// 3. simulated walk along the route
const pts = await p.evaluate(() => { const R = __ff.route.points, L = Route.polyLen(R), out = []; for (let s = 0; s < L - 16; s += 7) out.push(Route.pointAt(R, s)); return out; });
let turnHints = 0, lookOk = 0, steps = 0, routeSteps = 0, lastRem = Infinity, monotone = true, differs = 0;
for (const [lat, lon] of pts) {
  await ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy: 5 }); await p.waitForTimeout(450);
  g = await p.evaluate(() => __ff.guide); steps++;
  const exp = await p.evaluate(([la, lo]) => { const R = __ff.route.points, G = __ff.guide, pr = Route.project(R, [la, lo]), look = G.lookahead || Route.pointAt(R, pr.along + 18), lp = Route.project(R, look);
    return { br: Geo.bearingDeg(la, lo, look[0], look[1]), straight: Geo.bearingDeg(la, lo, __ff.target.lat, __ff.target.lon), onRoute: lp.d < 0.5, ahead: lp.along - pr.along, capOk: !G.turn || lp.along - pr.along <= G.turn.inM + 4.5 }; }, [lat, lon]);
  if (g.mode === 'route') { routeSteps++; if (Math.abs(((g.bearing - exp.br + 540) % 360) - 180) < 2 && exp.onRoute && exp.ahead > 0 && exp.ahead <= 18.5 && exp.capOk) lookOk++; }
  if (Math.abs(((exp.br - exp.straight + 540) % 360) - 180) > 20) differs++;
  const hint = await p.textContent('#guideHint'); if (/(in \d+ ft, (turn|bear) (left|right))|((turn|bear) (left|right) now)/i.test(hint)) turnHints++;
  if (g.remainingM > lastRem + 3) monotone = false; lastRem = g.remainingM;
  if (steps === 4) { await p.screenshot({ path: `${SH}/15-route-walking.png` }); console.log('  hint at step 4:', hint); }
}
ok(lookOk === routeSteps && routeSteps >= steps - 2, `arrow points at look-ahead on route (≤18 m, capped at next turn) (${lookOk}/${routeSteps} route steps of ${steps}; last step(s) within 15 m = arrived)`);
ok(differs > 0, `look-ahead arrow differs from crow-flies bearing on ${differs}/${steps} steps`);
ok(turnHints > 0, `"In N ft turn left/right" hints shown on ${turnHints} steps`);
ok(monotone, 'remaining walk distance decreases while walking');
ok((await p.evaluate(() => __ff.reroutes || 0)) === 0, 'no reroute while on route');
// 4. off-route by ~40 m -> reroute
// move to a spot >= 30 m from every part of the route (try several back-steps and both sides)
await ctx.setGeolocation({ latitude: pts[3][0], longitude: pts[3][1], accuracy: 5 }); await p.waitForTimeout(600);
const off = await p.evaluate(() => { const R = __ff.route.points; let best = null;
  for (let s = 10; s < Route.polyLen(R) - 10; s += 5) for (const side of [90, -90]) for (const m of [35, 45]) {
    const a = Route.pointAt(R, s), bb = Route.pointAt(R, s + 5), rad = (Route.bearing(a, bb) + side) * Math.PI / 180;
    const q = [a[0] + m * Math.cos(rad) / 110574, a[1] + m * Math.sin(rad) / (111320 * Math.cos(a[0] * Math.PI / 180))];
    const d = Route.project(R, q).d; if (d > 30 && d < 50 && __ff.graph.snap(q[0], q[1], 40) && (!best || s < best.s)) best = { q, s, d };
  } return best && best.q; });
const before = await p.evaluate(() => ({ n: __ff.reroutes || 0 }));
await ctx.setGeolocation({ latitude: off[0], longitude: off[1], accuracy: 5 }); await p.waitForTimeout(4200);
const after = await p.evaluate(() => ({ n: __ff.reroutes || 0, off: Route.project(__ff.route.points, __ff.me).d, mode: __ff.guide.mode }));
ok(after.n === before.n + 1 && after.off < 26 && after.mode === 'route', `off-route 40 m -> rerouted (reroutes ${after.n}, new route starts ${after.off.toFixed(1)} m from me)`);
await p.screenshot({ path: `${SH}/16-route-rerouted.png` });
// 4b. arrow/hint consistency after the reroute, for compass headings all the way round
const compass = h => p.evaluate(h => { const e = new Event('deviceorientation'); e.webkitCompassHeading = h; window.dispatchEvent(e); }, h);
try { await p.click('#btnCompassMini', { timeout: 2000 }); } catch (e) {}
let incons = [], checked = 0;
for (let hd = 0; hd < 360; hd += 15) {
  await compass(hd); await p.waitForTimeout(220);
  const r = await p.evaluate(() => ({ rel: __ff.guide.arrowRotation, hint: document.getElementById('guideHint').textContent, src: __ff.guide.headingSource, mode: __ff.guide.mode }));
  if (r.src !== 'compass' || r.mode !== 'route') continue; checked++;
  const a = Math.abs(r.rel), side = r.rel < 0 ? 'left' : 'right';
  const good = a > 120 ? /^Turn around/.test(r.hint) : a > 50 ? new RegExp('^Turn ' + side + ' to face').test(r.hint) : !/behind|Turn around|to face/.test(r.hint);
  if (!good || /behind you/.test(r.hint) && /turn (left|right)/i.test(r.hint)) incons.push(`${hd}°: rel ${r.rel.toFixed(0)} "${r.hint}"`);
}
ok(checked >= 20 && incons.length === 0, `after reroute, hint agrees with arrow for ${checked} compass headings` + (incons.length ? ': ' + incons.slice(0, 3).join(' | ') : ''));
// the exact v6 bug: just-rerouted near a corner must never say "turn X · now behind you"
ok(!/·\s*now behind you/.test(await p.textContent('#guideHint')), 'no contradictory "turn … · now behind you" hint');
// 5. arrival
await p.evaluate(() => 0); const tg = await p.evaluate(() => [__ff.target.lat, __ff.target.lon]);
await ctx.setGeolocation({ latitude: tg[0] + 0.00004, longitude: tg[1], accuracy: 5 }); await p.waitForTimeout(1500);
ok(await p.evaluate(() => document.getElementById('guide').classList.contains('arrived')) && await p.locator('#guide').isVisible(), 'arrived state, guide still open');
// 6. routing failure -> straight arrow, labeled
await ctx.setGeolocation({ latitude: 35.8105, longitude: -78.7400, accuracy: 5 }); await p.waitForTimeout(1800);
g = await p.evaluate(() => __ff.guide);
const lbl = await p.textContent('#guideRoute');
ok(g.mode === 'straight' && /Straight-line arrow/.test(lbl) && /^Straight line:/.test(await p.textContent('#guideHint')), 'no route (far off-grounds) -> straight arrow labeled: ' + lbl);
await p.screenshot({ path: `${SH}/17-route-fallback-straight.png` });
await b.close();
console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
