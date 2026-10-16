// The SW must not trap or break users when the site moves (GitHub Pages custom-domain 301s every
// /fair-finder/* URL, including sw.js, to the new origin and sends Access-Control-Allow-Origin: *).
// Serves this repo at /fair-finder/ on origin A; after the "flip", A 301s to origin B (repo at root).
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
function serveFile(res, rel) {
  let f = path.join(ROOT, decodeURIComponent(rel.split('?')[0]));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); const body = fs.readFileSync(f);
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
}
let flipped = false;
const B = http.createServer((q, res) => serveFile(res, q.url)); await new Promise(r => B.listen(0, '127.0.0.1', r));
const bURL = 'http://localhost:' + B.address().port + '/';
const A = http.createServer((q, res) => {
  if (!q.url.startsWith('/fair-finder/')) { res.writeHead(404); return res.end(); }
  const rest = q.url.slice('/fair-finder/'.length);
  if (flipped) { res.writeHead(301, { location: bURL + rest, 'access-control-allow-origin': '*' }); return res.end(); }
  serveFile(res, '/' + rest);
}); await new Promise(r => A.listen(0, '127.0.0.1', r));
const aURL = 'http://127.0.0.1:' + A.address().port + '/fair-finder/';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route(/workers\.dev/, r => r.abort());
const p = await ctx.newPage();
await p.goto(aURL); await p.waitForFunction(() => navigator.serviceWorker.controller || new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', () => r(true))), null, { timeout: 20000 });
await p.reload(); await p.waitForTimeout(800);
ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'SW controls the old origin before the move');
flipped = true;
for (const [u, want] of [['', bURL], ['?booth=L0-1387', bURL + '?booth=L0-1387'], ['about/', bURL + 'about/'], ['b/L0-1387.html', bURL + '?booth=L0-1387']]) {
  let err = null; try { await p.goto(aURL + u, { timeout: 15000 }); } catch (e) { err = e.message.split('\n')[0]; }
  await p.waitForTimeout(600);
  ok(!err && p.url().startsWith(want), 'old ' + (u || '/') + ' -> ' + p.url() + (err ? ' ERR ' + err : ''));
}
const p2 = await ctx.newPage(); await p2.goto('http://127.0.0.1:' + A.address().port + '/x').catch(() => {});
const regs = await p2.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope));
ok(!regs.some(s => s.includes('/fair-finder/')), 'old-origin SW unregistered itself after the move ' + JSON.stringify(regs));
await b.close(); A.close(); B.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
