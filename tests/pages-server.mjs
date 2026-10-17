// Cloudflare Pages static emulator: pretty-URL 308s, default headers, dist/_headers
// (query stripped, rules merge, same header name comma-joins, "! Name" detaches).
// Redirects run before _headers, so a 308 keeps the platform defaults (including ACAO: *).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULTS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      if (!cur) continue;
      const t = line.trim();
      if (t.startsWith('!')) cur.ops.push({ drop: t.slice(1).trim() });
      else {
        const i = t.indexOf(':');
        if (i > 0) cur.ops.push({ name: t.slice(0, i).trim(), value: t.slice(i + 1).trim() });
      }
    } else {
      cur = { pattern: line.trim(), ops: [] };
      rules.push(cur);
    }
  }
  return rules;
}

function matchPath(pattern, pathname) {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === pathname;
  const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
  if (!pathname.startsWith(pre) || !pathname.endsWith(post)) return false;
  return pathname.length >= pre.length + post.length;
}

export function headersFor(rules, pathname) {
  const h = new Map(Object.entries(DEFAULTS));
  const find = name => {
    for (const k of h.keys()) if (k.toLowerCase() === name.toLowerCase()) return k;
    return null;
  };
  for (const rule of rules) {
    if (!matchPath(rule.pattern, pathname)) continue;
    for (const op of rule.ops) {
      if (op.drop) { const k = find(op.drop); if (k) h.delete(k); }
      else {
        const k = find(op.name);
        if (k) h.set(k, h.get(k) + ', ' + op.value);
        else h.set(op.name, op.value);
      }
    }
  }
  return Object.fromEntries(h);
}

function loadRules(dir) {
  const f = path.join(dir, '_headers');
  try { return parseHeaders(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

function safeJoin(dir, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const full = path.resolve(dir, rel);
  if (full !== path.resolve(dir) && !full.startsWith(path.resolve(dir) + path.sep)) return null;
  return full;
}

function send(res, status, headers, body, method) {
  const h = { ...headers };
  if (body != null && method !== 'HEAD') h['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(status, h);
  res.end(method === 'HEAD' ? undefined : body);
}

export function handle(dir, req, res) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let u;
  try { u = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname.split('/').includes('..')) { res.writeHead(403); return res.end(); }
  const rules = loadRules(dir);
  const redir = (loc) => send(res, 308, { ...DEFAULTS, Location: loc + u.search }, '', method);

  if (pathname.endsWith('/index.html')) return redir(pathname.slice(0, -'index.html'.length) || '/');
  if (pathname.endsWith('.html')) return redir(pathname.slice(0, -'.html'.length));

  let file = null;
  if (pathname.endsWith('/')) {
    file = safeJoin(dir, pathname + 'index.html');
  } else {
    const direct = safeJoin(dir, pathname);
    if (!direct) { res.writeHead(403); return res.end(); }
    try {
      const st = fs.statSync(direct);
      if (st.isDirectory()) return redir(pathname + '/');
      if (st.isFile()) file = direct;
    } catch { /* fall through to path.html */ }
    if (!file) {
      const html = direct + '.html';
      try { if (fs.statSync(html).isFile()) file = html; } catch { /* 404 */ }
    }
  }
  if (!file) return send(res, 404, { ...DEFAULTS, 'Content-Type': 'text/plain; charset=utf-8' }, '404', method);
  let body;
  try { body = fs.readFileSync(file); } catch { return send(res, 404, { ...DEFAULTS, 'Content-Type': 'text/plain; charset=utf-8' }, '404', method); }
  const headers = headersFor(rules, pathname);
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type'))
    headers['Content-Type'] = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  send(res, 200, headers, body, method);
}

export function listen(dir, port = 0, host = '127.0.0.1') {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => handle(root, req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = path.resolve(process.argv[2] || 'dist');
  const port = Number(process.argv[3] || 9876);
  const server = await listen(dir, port);
  console.log('pages emulator http://127.0.0.1:' + server.address().port + '/  ' + dir);
}
