// Pages emulator: headers, service worker install, offline share links, v7.7.1 -> v7.9.1 update.
import { chromium, webkit } from '/workspace/ff-node/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { handle } from './pages-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const REVALIDATE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

execFileSync('sh', ['tools/build_pages.sh'], { cwd: ROOT, stdio: 'inherit' });
const dist = path.join(ROOT, 'dist');

function plain(root, req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(u.pathname);
  let file = path.resolve(root, pathname.replace(/^\/+/, ''));
  if (file !== path.resolve(root) && !file.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const st = fs.statSync(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch { /* path.html or 404 */ }
  if (!fs.existsSync(file)) {
    try { if (fs.statSync(file + '.html').isFile()) file = file + '.html'; } catch { /* 404 */ }
  }
  try {
    const body = fs.readFileSync(file);
    const ext = path.extname(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('404'); }
}

let mode = 'pages';
let root = dist;
const server = http.createServer((req, res) => mode === 'pages' ? handle(root, req, res) : plain(root, req, res));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

async function headers(pathname) {
  const res = await fetch(base + pathname, { redirect: 'manual' });
  return { status: res.status, loc: res.headers.get('location'), cc: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin'), nosniff: res.headers.get('x-content-type-options'), referrer: res.headers.get('referrer-policy') };
}
function noAcao(h, label) { ok(h.acao == null, label + ' has no ACAO ' + h.acao); }
function isReval(h, label) { ok(h.cc === REVALIDATE && !/immutable/.test(h.cc || ''), label + ' revalidate ' + h.cc); noAcao(h, label); }
function isImm(h, label) { ok(h.cc === IMMUTABLE, label + ' immutable ' + h.cc); noAcao(h, label); }

{
  const sw = await headers('/sw.js');
  ok(sw.status === 200 && sw.cc === 'no-cache', 'sw.js no-cache ' + sw.cc);
  noAcao(sw, '/sw.js');
  isImm(await headers('/app.js?v=791'), '/app.js?v=791');
  isReval(await headers('/config.js'), '/config.js');
  isReval(await headers('/config.js?v=761'), '/config.js?v=761');
  isReval(await headers('/'), '/');
  isReval(await headers('/data/booths.json'), '/data/booths.json');
  isReval(await headers('/manifest.webmanifest'), '/manifest.webmanifest');
  isImm(await headers('/icons/icon-192.png'), '/icons/icon-192.png');
  const html = await headers('/b/L0-1387.html');
  ok(html.status === 308 && html.loc === '/b/L0-1387', 'share html 308 ' + html.status + ' ' + html.loc);
  const followed = await headers('/b/L0-1387');
  ok(followed.status === 200, 'extensionless share page 200 ' + followed.status);
  noAcao(followed, '/b/L0-1387');
  ok(followed.nosniff === 'nosniff' && followed.referrer === 'strict-origin-when-cross-origin', 'platform nosniff + referrer');
}

async function shellInfo(page) {
  return page.evaluate(async () => {
    const name = 'ff-shell-v7-9-1';
    const keys = await caches.keys();
    if (!keys.includes(name)) return { keys, entries: [] };
    const c = await caches.open(name);
    const entries = [];
    for (const k of await c.keys()) {
      const hit = await c.match(k);
      entries.push({ url: k.url, ok: hit.ok, redirected: hit.redirected, type: hit.type });
    }
    return { keys, entries };
  });
}

const GEO = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
function appErrors(errs) { return errs.filter(m => !/fair-finder-stats|access control checks/i.test(m)); }

async function online(engine, name) {
  const b = await engine.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', geolocation: GEO, permissions: ['geolocation'] });
  const errs = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('ff-title-seen','1'); } catch (e) {} }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  await p.waitForFunction(() => (document.getElementById('version') || {}).textContent === 'v7.9.1 · Oct 17', null, { timeout: 20000 });
  const info = await shellInfo(p);
  ok(info.entries.some(e => new URL(e.url).pathname === '/'), name + ' cache has / ' + JSON.stringify(info.entries.map(e => e.url)));
  ok(!info.entries.some(e => /\/index\.html$/.test(new URL(e.url).pathname) && (e.redirected || e.type === 'opaqueredirect' || !e.ok)), name + ' no redirected index.html');
  for (const u of ['/b/L0-1387.html', '/b/L0-1387']) {
    await p.goto(base + u, { waitUntil: 'domcontentloaded' });
    await p.waitForURL(/[?&]booth=L0-1387(?:&|$)/, { timeout: 15000 });
    ok(/[?&]booth=L0-1387(?:&|$)/.test(p.url()), name + ' online ' + u + ' -> ' + p.url());
  }
  ok(appErrors(errs).length === 0, name + ' no pageerror ' + appErrors(errs).join(' | '));
  await ctx.setOffline(true);
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (document.getElementById('version') || {}).textContent === 'v7.9.1 · Oct 17', null, { timeout: 15000 });
  ok((await p.textContent('#version')) === 'v7.9.1 · Oct 17', name + ' offline reload shows v7.9.1');
  for (const u of ['/b/L0-1387.html', '/b/L0-1387']) {
    await p.goto(base + u, { waitUntil: 'domcontentloaded' });
    await p.waitForURL(/[?&]booth=/, { timeout: 15000 });
    ok(/[?&]booth=L0-1387(?:&|$)/.test(p.url()), name + ' offline ' + u + ' -> ' + p.url());
  }
  await p.goto(base + '/about/', { waitUntil: 'domcontentloaded' });
  const h1 = await p.textContent('h1');
  ok(/Find any food at the 2026 N\.C\. State Fair/.test(h1 || ''), name + ' offline about heading ' + h1);
  await b.close();
}

async function update(engine, name) {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff771-'));
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive 8cd36e6 | tar -x -C "${oldDir}"`], { stdio: 'inherit' });
  mode = 'plain'; root = oldDir;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprof-'));
  const ctx = await engine.launchPersistentContext(prof, { viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', geolocation: GEO, permissions: ['geolocation'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('ff-title-seen','1'); } catch (e) {} });
  const p = ctx.pages()[0] || await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => navigator.serviceWorker.controller && (document.getElementById('version') || {}).textContent === 'v7.7.1 · Oct 16', null, { timeout: 20000 });
  ok((await p.textContent('#version')) === 'v7.7.1 · Oct 16', name + ' installed v7.7.1');
  mode = 'pages'; root = dist;
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (document.getElementById('version') || {}).textContent === 'v7.9.1 · Oct 17', null, { timeout: 20000 });
  await p.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.includes('v=791'), null, { timeout: 20000 });
  let shells = [];
  for (let i = 0; i < 40; i++) {
    shells = await p.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('ff-shell-')));
    if (shells.length === 1 && shells[0] === 'ff-shell-v7-9-1') break;
    await p.waitForTimeout(250);
  }
  ok(shells.length === 1 && shells[0] === 'ff-shell-v7-9-1', name + ' only ff-shell-v7-9-1 ' + JSON.stringify(shells));
  ok((await p.textContent('#version')) === 'v7.9.1 · Oct 17', name + ' updated to v7.9.1');
  await ctx.setOffline(true);
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (document.getElementById('version') || {}).textContent === 'v7.9.1 · Oct 17', null, { timeout: 15000 });
  ok((await p.textContent('#version')) === 'v7.9.1 · Oct 17', name + ' offline after update');
  ok(appErrors(errs).length === 0, name + ' update no pageerror ' + appErrors(errs).join(' | '));
  await ctx.close();
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.rmSync(prof, { recursive: true, force: true });
  mode = 'pages'; root = dist;
}

const engines = process.env.FF_ENGINE === 'webkit' ? [['webkit', webkit]] : process.env.FF_ENGINE === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
for (const [name, engine] of engines) {
  await online(engine, name);
  await update(engine, name);
}

server.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
