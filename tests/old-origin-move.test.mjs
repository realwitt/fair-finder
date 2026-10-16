// Old installs after the move to fairfinder.birbol.com. Installs the exact v7.6.1 build (git 0edb3f2) at /fair-finder/ on
// origin A, then A 301s everything to origin B (no CORS header on the 301, ACAO:* on B, like GitHub Pages).
// Fast network: Chromium shows ERR_FAILED (old SW hands a followed redirect to a navigation) - documented, not fixable here.
// Slow network (>4 s): the old SW falls back to its cached page, which loads config.js through the redirect; v7.7.1's
// config.js must then unregister the old SW, drop its caches and move to the same URL on B.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execSync } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-old-')); execSync(`git -C "${ROOT}" archive 0edb3f2 | tar -x -C "${OLD}"`);
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
let PA, PB, flipped = false, slow = false;
function file(res, root, rel, extra, rewrite) { let f = path.join(root, decodeURIComponent(rel.split('?')[0])); try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); let b = fs.readFileSync(f); if (rewrite && f.endsWith('config.js')) b = Buffer.from(rewrite(b.toString()));
  res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', ...extra }); res.end(b); } catch { res.writeHead(404, extra); res.end('404'); } }
const A = http.createServer((q, r) => { if (!q.url.startsWith('/fair-finder')) { r.writeHead(404); return r.end(); } const rest = q.url.replace(/^\/fair-finder\/?/, '');
  if (flipped) { r.writeHead(301, { location: `http://localhost:${PB}/` + rest }); return r.end(); } file(r, OLD, '/' + rest); });
const B = http.createServer((q, r) => { const fromOldSW = q.headers.origin === `http://127.0.0.1:${PA}` && q.headers['sec-fetch-mode'] === 'cors';
  const send = () => file(r, ROOT, q.url, { 'access-control-allow-origin': '*' }, s => s.replace("'realwitt.github.io'", `'127.0.0.1:${PA}'`).replace("'https://fairfinder.birbol.com'", `'http://localhost:${PB}'`));
  if (slow && fromOldSW) setTimeout(send, 5000); else send(); });
await new Promise(z => A.listen(0, '127.0.0.1', z)); await new Promise(z => B.listen(0, '127.0.0.1', z)); PA = A.address().port; PB = B.address().port;
const ST = `http://127.0.0.1:${PA}/fair-finder/`;
const b = await chromium.launch();
async function oldInstall() { const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); await ctx.route(/workers\.dev|tile|arcgis/, r => r.abort()); const p = await ctx.newPage(); flipped = false;
  await p.goto(ST); await p.waitForFunction(() => navigator.serviceWorker.controller || new Promise(z => navigator.serviceWorker.addEventListener('controllerchange', () => z(true))), null, { timeout: 20000 });
  await p.reload(); await p.waitForTimeout(800); const v = await p.textContent('#version'); flipped = true; return { ctx, p, v }; }
async function go(p, u) { let err = null; try { await p.goto(u, { timeout: 20000 }); } catch (e) { err = e.message.split('\n')[0]; } await p.waitForTimeout(2500); return { landed: p.url(), err }; }
{ // fast network: the known failure (recorded, not asserted as a pass/fail of our code)
  const { ctx, p, v } = await oldInstall(); ok(v === 'v7.6.1 · Oct 16', 'old v7.6.1 installed (fast case) ' + v);
  const r = await go(p, ST + '?booth=L0-1387'); console.log('INFO fast network old install ->', JSON.stringify(r)); await ctx.close(); }
{ // slow network: cached page -> config.js moves the user
  const { ctx, p, v } = await oldInstall(); ok(v === 'v7.6.1 · Oct 16', 'old v7.6.1 installed (slow case) ' + v); slow = true;
  const r = await go(p, ST + '?booth=L0-1387'); await p.waitForTimeout(2000);
  const now = await p.evaluate(() => ({ url: location.href, ver: (document.getElementById('version') || {}).textContent, guiding: document.body.classList.contains('guiding') })).catch(e => ({ e: e.message }));
  ok(now.url && now.url.startsWith(`http://localhost:${PB}/?booth=L0-1387`) && /^v7\.7\.1/.test(now.ver || ''), 'slow-network old install moves to the new origin with ?booth kept ' + JSON.stringify({ r, now }));
  const p2 = await ctx.newPage(); slow = false; flipped = false; await p2.goto(`http://127.0.0.1:${PA}/fair-finder/robots-x`).catch(() => {});
  const regs = await p2.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).map(x => x.scope), caches: await caches.keys() }));
  ok(regs.regs.length === 0 && !regs.caches.some(k => k.startsWith('ff-shell-')), 'old-origin SW unregistered and app-shell cache removed (a tile cache recreated by in-flight tile requests may remain) ' + JSON.stringify(regs)); await ctx.close(); }
await b.close(); A.close(); B.close(); fs.rmSync(OLD, { recursive: true, force: true });
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
