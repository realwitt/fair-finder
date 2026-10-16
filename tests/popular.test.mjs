// v7.6 popular panel, anonymous posts, and badges. Playwright, 390x844, API mocked.
import { chromium, devices } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const Geo = require('../geo.js');

const FF = process.env.FF_URL || 'http://127.0.0.1:8765/';
const SH = process.env.FF_SHOTS || '/workspace/fair-finder-shots';
fs.mkdirSync(SH, { recursive: true });
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const boothsRaw = JSON.parse(fs.readFileSync(new URL('../data/booths.json', import.meta.url), 'utf8'));
const ridesRaw = JSON.parse(fs.readFileSync(new URL('../data/rides.json', import.meta.url), 'utf8'));
const rideIds = new Set(ridesRaw.rides.map(r => r.id));
const booths = boothsRaw.booths.filter(b => b.lat != null && !rideIds.has(b.id));

function dest(lat, lon, bearingDeg, distM) {
  const R = 6371008.8;
  const δ = distM / R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  let lon2 = (λ2 * 180 / Math.PI);
  lon2 = ((lon2 + 540) % 360) - 180;
  return { latitude: φ2 * 180 / Math.PI, longitude: lon2 };
}
let walk = null, bearing = 0, bestClear = -1;
for (const b of booths) {
  if (!b.food && b.kind !== 'vendor' && b.kind !== 'newfood' && b.kind !== 'sponsor') continue;
  for (let deg = 0; deg < 360; deg += 20) {
    const p10 = dest(b.lat, b.lon, deg, 10);
    let clear = Infinity;
    for (const o of booths) {
      if (o.id === b.id) continue;
      const d = Geo.distanceM(p10.latitude, p10.longitude, o.lat, o.lon);
      if (d < clear) clear = d;
    }
    if (clear > bestClear) { bestClear = clear; walk = b; bearing = deg; }
  }
  if (bestClear > 40) break;
}
ok(!!walk && bestClear > 20, 'walk booth ' + (walk && walk.id) + ' clear ' + Math.round(bestClear) + ' m');
const at60 = dest(walk.lat, walk.lon, bearing, 60);
const at10 = dest(walk.lat, walk.lon, bearing, 10);
const at80 = dest(walk.lat, walk.lon, bearing, 80);
const others = booths.filter(b => b.id !== walk.id).slice(0, 2);
const topItems = [{ id: walk.id, n: 9 }, { id: others[0].id, n: 8 }, { id: others[1].id, n: 7 }];

function phone(geo) {
  return {
    ...devices['iPhone 14 Pro'],
    viewport: { width: 390, height: 844 },
    geolocation: geo,
    permissions: ['geolocation'],
  };
}
async function boot(b, opts, optOut) {
  const posts = [];
  const ctx = await b.newContext(phone({ latitude: opts.latitude, longitude: opts.longitude, accuracy: opts.accuracy }));
  await ctx.addInitScript(off => {
    localStorage.setItem('ff.api', 'http://127.0.0.1:9');
    if (off) localStorage.setItem('ff.statsOptOut', '1');
  }, !!optOut);
  await ctx.route('http://127.0.0.1:9/**', route => {
    const req = route.request();
    if (req.method() === 'POST') posts.push({ url: req.url(), body: req.postData() || '' });
    if (opts.abort) return route.abort();
    const u = req.url();
    const items = opts.items == null ? topItems : opts.items;
    if (u.includes('/top-searches')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ window: 'now', items: opts.searches || [] }) });
    }
    if (u.includes('/top')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ window: 'now', items }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counted":true}' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => fails.push('pageerror ' + e.message));
  await p.goto(FF, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff && __ff.booths && __ff.booths.length > 100 && __ff.tracker, null, { timeout: 25000 });
  return { ctx, p, posts };
}
async function wiggle(ctx, p, point, times, gap) {
  for (let i = 0; i < times; i++) {
    const j = (i % 2) * 0.000004;
    await ctx.setGeolocation({ latitude: point.latitude + j, longitude: point.longitude, accuracy: 8 });
    await p.waitForTimeout(gap);
  }
}
function bodies(posts, part) {
  return posts.filter(x => x.url.includes(part)).map(x => x.body);
}

const b = await chromium.launch();
try {
  // Fallback when the counter is unreachable.
  {
    const { ctx, p, posts } = await boot(b, { latitude: 35.0, longitude: -78.0, accuracy: 100, abort: true, items: [] });
    await p.tap('#q');
    await p.waitForTimeout(400);
    const txt = await p.locator('#popular').innerText();
    ok(/Popular foods/.test(txt) && await p.locator('#popular button[data-q="hot dog"]').count() === 1, 'abort falls back to food chips');
    ok(await p.locator('#searchFocus').isVisible(), 'search focus stays visible with the fallback');
    ok(posts.length === 0, 'abort sends no posts');
    await p.screenshot({ path: SH + '/v76-fallback.png' });
    await ctx.close();
  }

  // Live panel, taps, chips, suggest, badge. GPS too coarse to count an arrival.
  {
    const { ctx, p, posts } = await boot(b, { latitude: 35.7948, longitude: -78.7115, accuracy: 100, items: topItems, searches: [{ k: 'chip:lemonade', n: 6 }] });
    await p.waitForTimeout(600);
    await p.tap('#q');
    await p.waitForTimeout(400);
    const live = await p.locator('#popular').innerText();
    ok(/Popular right now/.test(live) && await p.locator('#popular button[data-booth="' + walk.id + '"]').count() === 1, 'mocked top renders Popular right now');
    ok(await p.locator('#searchFocus').isVisible(), 'quick actions show with the live panel');
    await p.screenshot({ path: SH + '/v76-popular.png' });
    await p.locator('#popular button[data-booth="' + walk.id + '"]').tap();
    await p.waitForTimeout(800);
    ok(await p.locator('#guide').isVisible() && (await p.locator('#guideName').innerText()).includes(walk.name), 'tap starts the guide');
    const boothPosts = bodies(posts, '/search').filter(s => s.includes('booth:' + walk.id));
    ok(boothPosts.length === 1, 'popular booth row sends booth:' + walk.id);
    await p.screenshot({ path: SH + '/v76-guide.png' });
    await p.tap('#closeGuide');
    await p.waitForTimeout(300);

    const beforeChip = posts.length;
    await p.locator('#chips .chip[data-q="hot dog"]').tap();
    await p.waitForTimeout(400);
    const chipPosts = bodies(posts, '/search').filter(s => s.includes('chip:hot-dog'));
    ok(chipPosts.length === 1 && posts.length === beforeChip + 1, 'hot-dog chip sends one POST /search');

    const afterChip = posts.length;
    await p.locator('#chips .chip[data-q="rides"]').tap();
    await p.waitForTimeout(300);
    await p.tap('#chipNear');
    await p.waitForTimeout(200);
    await p.tap('#chipFav');
    await p.waitForTimeout(200);
    ok(posts.length === afterChip, 'Near me, Favorites, and Rides send no search');

    await p.fill('#q', 'secret words');
    await p.press('#q', 'Enter');
    await p.waitForTimeout(400);
    ok(posts.every(x => !x.body.includes('secret words')), 'free text is not in any /search body');

    await p.fill('#q', '');
    await p.tap('#q');
    const suggestBooth = booths.find(x => x.food && x.name && x.name.length > 8 && x.name.length < 22 && !/secret/i.test(x.name));
    await p.type('#q', suggestBooth.name.slice(0, 12), { delay: 30 });
    await p.waitForTimeout(500);
    const sug = p.locator('#suggest li[data-type="booth"][data-id="' + suggestBooth.id + '"]');
    const sugCount = await sug.count();
    if (sugCount) await sug.first().tap();
    await p.waitForTimeout(400);
    ok(sugCount > 0 && bodies(posts, '/search').some(s => s.includes('booth:' + suggestBooth.id)), 'booth picked from #suggest sends booth:' + suggestBooth.id);

    const beforeRide = posts.length;
    await p.fill('#q', '');
    await p.type('#q', 'tilt a whirl', { delay: 30 });
    await p.waitForTimeout(500);
    const ride = p.locator('#suggest li[data-type="ride"]').first();
    const rideId = await ride.getAttribute('data-id');
    await ride.tap();
    await p.waitForTimeout(400);
    ok(posts.length === beforeRide && !posts.some(x => rideId && x.body.includes(rideId)), 'a ride pick does not send a search');

    await p.fill('#q', walk.name);
    await p.press('#q', 'Enter');
    await p.waitForTimeout(700);
    const badge = p.locator('#resList li[data-id="' + walk.id + '"] .badge.pop');
    ok(await badge.count() === 1 && (await badge.first().innerText()).trim() === '🔥 Popular', 'badge shows on a /top booth');
    await p.screenshot({ path: SH + '/v76-badge.png' });

    await p.click('#btnLayers');
    await p.click('#aboutLink');
    await p.waitForTimeout(200);
    const appSrc = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    const pm = appSrc.match(/"priv": "((?:\\.|[^"\\])*)"/);
    const priv = JSON.parse('"' + pm[1] + '"');
    const inApp = await p.locator('#aboutBody h3', { hasText: 'Privacy' }).locator('xpath=following-sibling::p[1]').innerText();
    ok(inApp === priv, 'in-app privacy equals L_.priv');
    const lp = await ctx.newPage();
    await lp.goto(FF + 'about/', { waitUntil: 'domcontentloaded' });
    const aboutP = await lp.locator('h3', { hasText: 'Privacy' }).locator('xpath=following-sibling::p[1]').innerText();
    ok(aboutP === priv, 'about privacy text equals L_.priv');
    await lp.screenshot({ path: SH + '/v76-about.png' });
    await ctx.close();
  }

  // Opt-out sends nothing.
  {
    const { ctx, p, posts } = await boot(b, { latitude: 35.0, longitude: -78.0, accuracy: 8, items: [] }, true);
    await p.click('#btnLayers');
    ok(!(await p.isChecked('#tglStats')), 'opt-out leaves the checkbox off');
    await p.click('[data-close=layersPanel]');
    await p.locator('#chips .chip[data-q="lemonade"]').tap();
    await p.waitForTimeout(400);
    ok(posts.length === 0, 'opt-out sends no POSTs');
    await ctx.close();
  }

  // Walk from 60 m to 10 m. Accuracy 8 m. One visit, then the daily cap blocks a second arrival.
  {
    const { ctx, p, posts } = await boot(b, { latitude: at60.latitude, longitude: at60.longitude, accuracy: 8, items: [] });
    await wiggle(ctx, p, at60, 3, 400);
    await wiggle(ctx, p, at10, 18, 1000);
    const visits = () => bodies(posts, '/visit');
    let v = visits();
    ok(v.length === 1, 'one POST /visit after the walk (' + v.length + ')');
    if (v.length) {
      let body = {};
      try { body = JSON.parse(v[0]); } catch (e) { body = {}; }
      ok(body.b === walk.id && UUID_RE.test(body.d || ''), 'visit body is that booth id and a UUID d');
      ok(!v[0].includes(String(at10.latitude)) && !/secret words/.test(v[0]), 'visit body has no coordinates');
    } else ok(false, 'missing visit body');
    await wiggle(ctx, p, at80, 10, 1000);
    await wiggle(ctx, p, at10, 12, 1000);
    ok(visits().length === 1, 'second arrival the same day sends no POST');
    await p.screenshot({ path: SH + '/v76-walk.png' });
    await ctx.close();
  }
} finally {
  await b.close();
}

if (fails.length) {
  console.log(fails.length + ' FAILURES\n' + fails.join('\n'));
  process.exit(1);
}
console.log('ALL PASS');
