import { readFileSync } from 'node:fs';
import { handleFetch, handleScheduled } from '../worker/src/index.js';
import { BOOTH_IDS } from '../worker/src/allowlist.js';
import { fakeD1 } from './fake-d1.mjs';

const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const ORIGIN = 'https://realwitt.github.io';
const ORIGIN2 = 'https://fairfinder.birbol.com';
const NOW = Date.parse('2026-10-15T16:00:00Z');
const IP = '203.0.113.44';
const DEV = '12345678-1234-4abc-8def-123456789abc';
const BOOTHS = Object.keys(BOOTH_IDS).sort();
const A = BOOTHS[0], B = BOOTHS[1], C = BOOTHS[2];

function dev(i) {
  return '00000000-0000-4000-8000-' + i.toString(16).padStart(12, '0');
}
function makeEnv(over) {
  return Object.assign({ DB: fakeD1(), SALT_SECRET: 'test-salt', NOW_MS: NOW }, over || {});
}
async function call(env, path, init) {
  const res = await handleFetch(new Request('https://stats.test' + path, init), env);
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { res, text, json };
}
function post(env, path, body, headers) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return call(env, path, {
    method: 'POST',
    headers: Object.assign({
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': IP,
    }, headers || {}),
    body: payload,
  });
}
async function dump(DB) {
  let s = '';
  for (const name of ['visits', 'searches', 'ratelimit', 'booths']) {
    const rows = await DB.prepare('SELECT * FROM ' + name).all();
    s += JSON.stringify(rows.results);
  }
  return s;
}
async function count(DB, table) {
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM ' + table).first();
  return Number(row.n);
}

ok(BOOTH_IDS['L0-1626'] === 1, 'vendor booth is allowlisted');
ok(!BOOTH_IDS['L0-1335'] && !BOOTH_IDS['L0-1149'], 'ride ids are not allowlisted');

{
  const env = makeEnv();
  const opt = await call(env, '/visit', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  ok(opt.res.status === 204
    && opt.res.headers.get('Access-Control-Allow-Origin') === ORIGIN
    && opt.res.headers.get('Vary') === 'Origin'
    && opt.res.headers.get('Access-Control-Allow-Methods') === 'GET, POST, OPTIONS'
    && opt.res.headers.get('Access-Control-Allow-Headers') === 'Content-Type'
    && opt.res.headers.get('Access-Control-Max-Age') === '86400', 'CORS preflight allow');
  const opt2 = await call(env, '/search', { method: 'OPTIONS', headers: { Origin: ORIGIN2 } });
  ok(opt2.res.status === 204 && opt2.res.headers.get('Access-Control-Allow-Origin') === ORIGIN2, 'second origin preflight');
  const denied = await call(env, '/visit', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  ok(denied.res.status === 403 && denied.res.headers.get('Access-Control-Allow-Origin') == null, 'CORS preflight deny');
  const postDeny = await post(env, '/visit', { d: DEV, b: A }, { Origin: 'http://127.0.0.1:8765' });
  ok(postDeny.res.status === 403 && postDeny.res.headers.get('Access-Control-Allow-Origin') == null, 'POST from another origin is 403');
  ok(await count(env.DB, 'visits') === 0 && await count(env.DB, 'ratelimit') === 0, 'disallowed origin does not write');
}

{
  const env = makeEnv();
  const good = await post(env, '/visit', { d: DEV, b: A }, { Origin: ORIGIN2 });
  ok(good.res.status === 200 && good.json && good.json.ok === true && good.json.counted === true
    && good.res.headers.get('Access-Control-Allow-Origin') === ORIGIN2, 'allowed POST counted');
  const dup = await post(env, '/visit', { d: DEV, b: A });
  ok(dup.res.status === 200 && dup.json.counted === false, 'duplicate same day counted false');
  const other = await post(env, '/visit', { d: dev(2), b: A }, { 'CF-Connecting-IP': '198.51.100.8' });
  ok(other.json.counted === true && await count(env.DB, 'visits') === 2, 'two devices');
  const row = await env.DB.prepare('SELECT day, dev FROM visits LIMIT 1').first();
  ok(row.day === '2026-10-15' && row.dev !== DEV && /^[0-9a-f]{64}$/.test(row.dev), 'NY day and hashed device');
  const blob = await dump(env.DB);
  ok(!blob.includes(IP) && !blob.includes(DEV) && !blob.includes(dev(2)), 'raw IP and raw device id are absent');
}

{
  const env = makeEnv();
  const badUuid = await post(env, '/visit', { d: 'NOT-A-UUID', b: A });
  ok(badUuid.res.status === 400, 'bad uuid');
  const upper = await post(env, '/visit', { d: DEV.toUpperCase(), b: A });
  ok(upper.res.status === 400, 'uppercase uuid rejected');
  const unknown = await post(env, '/visit', { d: DEV, b: 'L0-1335' });
  ok(unknown.res.status === 400, 'unknown booth');
  const free = await post(env, '/search', { d: DEV, k: 'secret words' });
  ok(free.res.status === 400, 'free-text k');
  const chip = await post(env, '/search', { d: DEV, k: 'chip:not-real' });
  ok(chip.res.status === 400, 'unknown chip');
  const extra = await post(env, '/visit', { d: DEV, b: A, note: 'secret words' });
  ok(extra.res.status === 400, 'extra field');
  const broken = await post(env, '/visit', '{');
  ok(broken.res.status === 400, 'bad JSON');
  const plain = await post(env, '/visit', { d: DEV, b: A }, { 'Content-Type': 'text/plain' });
  ok(plain.res.status === 415, 'wrong type');
  const big = JSON.stringify({ d: DEV, b: A, pad: 'x'.repeat(480) });
  ok(Buffer.byteLength(big) > 512, 'fixture is over 512 bytes');
  const over = await post(env, '/visit', big);
  ok(over.res.status === 413, 'oversize');
  ok(await count(env.DB, 'visits') === 0 && await count(env.DB, 'searches') === 0, 'invalid posts do not insert');
  const nosalt = makeEnv({ SALT_SECRET: '' });
  const miss = await post(nosalt, '/visit', { d: DEV, b: A });
  ok(miss.res.status === 500 && await count(nosalt.DB, 'visits') === 0 && await count(nosalt.DB, 'ratelimit') === 0, 'missing salt is 500 and writes nothing');
}

{
  const env = makeEnv();
  const method = await call(env, '/visit', { method: 'GET', headers: { Origin: ORIGIN } });
  ok(method.res.status === 405, 'GET /visit is 405');
  const postTop = await post(env, '/top?window=now', { d: DEV, b: A });
  ok(postTop.res.status === 405, 'POST /top is 405');
  const missing = await call(env, '/nope', { method: 'GET' });
  ok(missing.res.status === 404, 'unknown path');
  const badWin = await call(env, '/top?window=week', { method: 'GET', headers: { Origin: ORIGIN } });
  ok(badWin.res.status === 400 && badWin.res.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'bad window');
}

{
  const env = makeEnv();
  env.NOW_MS = NOW - 4 * 60 * 60 * 1000;
  for (let i = 0; i < 5; i++) await post(env, '/visit', { d: dev(100 + i), b: B }, { 'CF-Connecting-IP': '198.51.100.' + i });
  env.NOW_MS = NOW;
  for (let i = 0; i < 5; i++) await post(env, '/visit', { d: dev(200 + i), b: A }, { 'CF-Connecting-IP': '198.51.100.' + (10 + i) });
  for (let i = 0; i < 4; i++) await post(env, '/visit', { d: dev(300 + i), b: C }, { 'CF-Connecting-IP': '198.51.100.' + (20 + i) });
  for (let i = 0; i < 5; i++) await post(env, '/search', { d: dev(400 + i), k: 'chip:hot-dog' }, { 'CF-Connecting-IP': '198.51.100.' + (40 + i) });
  await post(env, '/search', { d: dev(2), k: 'booth:' + A }, { 'CF-Connecting-IP': '198.51.100.70' });
  const nowTop = await call(env, '/top?window=now', { method: 'GET' });
  ok(nowTop.res.status === 200 && nowTop.res.headers.get('Access-Control-Allow-Origin') == null
    && nowTop.res.headers.get('Cache-Control') === 'public, max-age=60', 'GET without Origin has data and no ACAO');
  const nowIds = (nowTop.json.items || []).map(it => it.id);
  ok(nowIds.includes(A) && !nowIds.includes(B) && !nowIds.includes(C)
    && nowTop.json.items.every(it => it.n >= 5) && nowTop.json.window === 'now', 'now window threshold');
  const dayTop = await call(env, '/top?window=day', { method: 'GET', headers: { Origin: ORIGIN } });
  const dayIds = (dayTop.json.items || []).map(it => it.id);
  ok(dayTop.res.headers.get('Access-Control-Allow-Origin') === ORIGIN
    && dayIds.includes(A) && dayIds.includes(B) && !dayIds.includes(C), 'day window keeps the older rows');
  const searches = await call(env, '/top-searches?window=now', { method: 'GET' });
  ok(searches.json.items.length === 1 && searches.json.items[0].k === 'chip:hot-dog' && searches.json.items[0].n === 5, 'top searches');
}

{
  const env = makeEnv();
  for (let i = 1; i <= 60; i++) {
    const body = i === 30 ? { d: 'nope', b: A } : { d: DEV, b: A };
    const r = await post(env, '/visit', body);
    if (r.res.status === 429) ok(false, 'rate limit tripped early at ' + i);
  }
  const r61 = await post(env, '/visit', { d: dev(9), b: B });
  ok(r61.res.status === 429, '61st POST returns 429');
  ok(await count(env.DB, 'visits') === 1, 'the 61st post did not insert');
  const blob = await dump(env.DB);
  ok(!blob.includes(IP) && !blob.includes(DEV), 'rate-limit table has no raw IP or device id');
}

{
  const env = makeEnv();
  env.NOW_MS = NOW - 4 * 24 * 60 * 60 * 1000;
  await post(env, '/visit', { d: DEV, b: A });
  await post(env, '/search', { d: DEV, k: 'chip:lemonade' });
  env.NOW_MS = NOW;
  await post(env, '/visit', { d: dev(2), b: B }, { 'CF-Connecting-IP': '198.51.100.99' });
  await handleScheduled({}, env);
  ok(await count(env.DB, 'visits') === 1, 'purge drops visits older than 3 days');
  ok(await count(env.DB, 'searches') === 0, 'purge drops old searches');
  const rl = await env.DB.prepare('SELECT win FROM ratelimit').all();
  const wins = (rl.results || []).map(r => r.win);
  const oldWin = Math.floor((NOW - 4 * 24 * 60 * 60 * 1000) / 600000);
  const newWin = Math.floor(NOW / 600000);
  ok(!wins.includes(oldWin) && wins.includes(newWin), 'purge drops rate-limit windows older than 2 hours');
}

const src = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
ok(!/console\./.test(src) && !src.includes('127.0.0.1'), 'worker source has no console and no localhost origin');

if (fails.length) {
  console.log(fails.length + ' FAILURES');
  process.exit(1);
}
console.log('ALL PASS');
