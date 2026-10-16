import { BOOTH_IDS, CHIP_KEYS } from './allowlist.js';

const ORIGINS = new Set(['https://realwitt.github.io', 'https://fairfinder.birbol.com']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHIP_SET = new Set(CHIP_KEYS);
const THREE_H = 3 * 60 * 60 * 1000;
const THREE_D = 3 * 24 * 60 * 60 * 1000;
const TWO_H = 2 * 60 * 60 * 1000;
const WIN_MS = 600000;

function nyDay(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts));
  let y = '', m = '', d = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') d = p.value;
  }
  return y + '-' + m + '-' + d;
}

function utcDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function nowMs(env) {
  return Number(env && env.NOW_MS) || Date.now();
}

async function hmacRaw(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(message)));
  return new Uint8Array(sig);
}

async function hmacHex(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(message)));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(origin) {
  const h = new Headers();
  if (origin && ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

function json(status, body, origin, extra) {
  const h = corsHeaders(origin);
  h.set('Content-Type', 'application/json');
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function empty(status, origin) {
  return new Response(null, { status, headers: corsHeaders(origin) });
}

function keysExact(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const got = Object.keys(obj);
  if (got.length !== keys.length) return false;
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(obj, k)) return false;
  return true;
}

function parseK(k) {
  if (typeof k !== 'string') return null;
  if (k.startsWith('chip:')) {
    const key = k.slice(5);
    if (CHIP_SET.has(key)) return k;
    return null;
  }
  if (k.startsWith('booth:')) {
    const id = k.slice(6);
    if (BOOTH_IDS[id]) return k;
    return null;
  }
  return null;
}

async function rateLimit(env, request, now) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const dayKey = await hmacRaw(env.SALT_SECRET, utcDay(now));
  const ipk = await hmacHex(dayKey, ip);
  const win = Math.floor(now / WIN_MS);
  await env.DB.prepare(
    'INSERT INTO ratelimit (ipk, win, n) VALUES (?, ?, 1) ON CONFLICT(ipk, win) DO UPDATE SET n = n + 1'
  ).bind(ipk, win).run();
  const row = await env.DB.prepare('SELECT n FROM ratelimit WHERE ipk = ? AND win = ?').bind(ipk, win).first();
  return row != null && Number(row.n) > 60;
}

async function insertVisit(env, day, booth, dev, ts) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO visits (day, booth, dev, ts) VALUES (?, ?, ?, ?)'
  ).bind(day, booth, dev, ts).run();
  return res.meta.changes === 1;
}

async function insertSearch(env, day, k, dev, ts) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO searches (day, k, dev, ts) VALUES (?, ?, ?, ?)'
  ).bind(day, k, dev, ts).run();
  return res.meta.changes === 1;
}

async function handleWrite(request, env, origin, kind) {
  if (!env || !env.SALT_SECRET) return json(500, { ok: false }, origin);
  const now = nowMs(env);
  if (await rateLimit(env, request, now)) return json(429, { ok: false }, origin);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > 512) return json(413, { ok: false }, origin);
  const ct = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(ct.trim())) return json(415, { ok: false }, origin);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(buf)); }
  catch { return json(400, { ok: false }, origin); }
  const want = kind === 'visit' ? ['d', 'b'] : ['d', 'k'];
  if (!keysExact(body, want)) return json(400, { ok: false }, origin);
  if (typeof body.d !== 'string' || !UUID_RE.test(body.d)) return json(400, { ok: false }, origin);
  if (kind === 'visit') {
    if (typeof body.b !== 'string' || !BOOTH_IDS[body.b]) return json(400, { ok: false }, origin);
  } else if (!parseK(body.k)) return json(400, { ok: false }, origin);
  const dev = hex(await hmacRaw(env.SALT_SECRET, 'dev:' + body.d));
  const day = nyDay(now);
  const counted = kind === 'visit'
    ? await insertVisit(env, day, body.b, dev, now)
    : await insertSearch(env, day, body.k, dev, now);
  return json(200, { ok: true, counted }, origin);
}

async function handleTop(env, origin, url, table, col, outKey) {
  const win = url.searchParams.get('window');
  if (win !== 'now' && win !== 'day') return json(400, { ok: false }, origin);
  const now = nowMs(env);
  let sql, arg;
  if (win === 'now') {
    sql = 'SELECT ' + col + ' AS id, COUNT(DISTINCT dev) AS n FROM ' + table
      + ' WHERE ts >= ? GROUP BY ' + col + ' HAVING COUNT(DISTINCT dev) >= 5 ORDER BY n DESC, id ASC LIMIT 10';
    arg = now - THREE_H;
  } else {
    sql = 'SELECT ' + col + ' AS id, COUNT(DISTINCT dev) AS n FROM ' + table
      + ' WHERE day = ? GROUP BY ' + col + ' HAVING COUNT(DISTINCT dev) >= 5 ORDER BY n DESC, id ASC LIMIT 10';
    arg = nyDay(now);
  }
  const rows = await env.DB.prepare(sql).bind(arg).all();
  const items = (rows.results || []).map(r => {
    const item = { n: Number(r.n) };
    item[outKey] = r.id;
    return item;
  });
  return json(200, { window: win, items }, origin, { 'Cache-Control': 'public, max-age=60' });
}

export async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const origin = request.headers.get('Origin');
  const allowed = !!(origin && ORIGINS.has(origin));
  if ((method === 'POST' || method === 'OPTIONS') && !allowed) {
    return new Response(null, { status: 403 });
  }
  if (method === 'OPTIONS') return empty(204, origin);
  if (path === '/visit' || path === '/search') {
    if (method !== 'POST') return json(405, { ok: false }, origin);
    return handleWrite(request, env, origin, path === '/visit' ? 'visit' : 'search');
  }
  if (path === '/top') {
    if (method !== 'GET') return json(405, { ok: false }, origin);
    return handleTop(env, origin, url, 'visits', 'booth', 'id');
  }
  if (path === '/top-searches') {
    if (method !== 'GET') return json(405, { ok: false }, origin);
    return handleTop(env, origin, url, 'searches', 'k', 'k');
  }
  return json(404, { ok: false }, origin);
}

export async function handleScheduled(_event, env) {
  const now = nowMs(env);
  await env.DB.prepare('DELETE FROM visits WHERE ts < ?').bind(now - THREE_D).run();
  await env.DB.prepare('DELETE FROM searches WHERE ts < ?').bind(now - THREE_D).run();
  await env.DB.prepare('DELETE FROM ratelimit WHERE win * 600000 < ?').bind(now - TWO_H).run();
}

async function fetch(request, env, ctx) { return handleFetch(request, env, ctx); }
async function scheduled(event, env, ctx) { return handleScheduled(event, env, ctx); }
export default { fetch, scheduled };
