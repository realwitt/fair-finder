import { chromium, webkit, devices } from 'playwright';
const BASE = process.env.BASE || 'https://realwitt.github.io/fair-finder/';
const eng = process.env.FF_ENGINE === 'webkit' ? webkit : chromium;
const ID = 'L0-1387', OTHER = 'L0-1193';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 5 };
const b = await eng.launch(); const bad = [];
async function run(name, url, opts = {}) { const { perms = ['geolocation'], geo = ME, pre = null, grantLater = false } = opts;
  const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: geo, permissions: perms });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (pre) await pre(p, ctx);
  await p.goto(url); await p.waitForTimeout(4000);
  if (grantLater) { await ctx.grantPermissions(['geolocation']); await p.evaluate(() => 0); await p.waitForTimeout(3000); }
  const r = await p.evaluate(() => ({ href: location.href.replace(/^https?:\/\/[^/]+/, ''), target: window.__ff && __ff.target && __ff.target.id, guideVisible: !!document.getElementById('guide') && !document.getElementById('guide').classList.contains('hidden') && document.getElementById('guide').getBoundingClientRect().top < innerHeight - 50, hint: (document.getElementById('guideHint') || {}).textContent, mode: window.__ff && __ff.guide && __ff.guide.mode, sw: !!navigator.serviceWorker.controller, ver: (document.getElementById('version') || {}).textContent }));
  const good = r.target === ID && r.guideVisible && (!opts.wantRoute || r.mode === 'route');
  if (!good) bad.push(name); console.log((good ? 'OK   ' : 'BUG  ') + name.padEnd(46), JSON.stringify(r), errs.length ? 'ERR ' + errs.join(';') : '');
  await ctx.close(); return good;
}
const warm = async (p) => { await p.goto(BASE); await p.waitForTimeout(3500); await p.reload(); await p.waitForTimeout(2500); };
const warmGuiding = async (p) => { await warm(p); await p.goto(BASE + '?booth=' + OTHER); await p.waitForTimeout(3000); };
await run('fresh · share page', BASE + 'b/' + ID + '.html', { wantRoute: true });
await run('fresh · share page ?q=', BASE + 'b/' + ID + '.html?q=lemonade');
await run('fresh · ?booth=', BASE + '?booth=' + ID);
await run('fresh · no trailing slash', BASE.replace(/\/$/, '') + '?booth=' + ID);
await run('fresh · index.html?booth=', BASE + 'index.html?booth=' + ID);
await run('fresh · ?booth= + fbclid', BASE + '?booth=' + ID + '&fbclid=abc123');
await run('fresh · ?booth= trailing punctuation', BASE + '?booth=' + ID + '.');
await run('fresh · share page, location denied', BASE + 'b/' + ID + '.html', { perms: [] });
await run('fresh · share page, location granted later', BASE + 'b/' + ID + '.html', { perms: [], grantLater: true, wantRoute: true });
await run('fresh · share page, recipient far away', BASE + 'b/' + ID + '.html', { geo: { latitude: 35.9, longitude: -78.9, accuracy: 20 } });
await run('SW installed · share page', BASE + 'b/' + ID + '.html', { pre: warm });
await run('SW installed · ?booth=', BASE + '?booth=' + ID, { pre: warm });
await run('SW + already guiding other booth · share page', BASE + 'b/' + ID + '.html', { pre: warmGuiding });
await run('SW + already guiding other booth · ?booth=', BASE + '?booth=' + ID, { pre: warmGuiding });
await run('SW + offline · share page', BASE + 'b/' + ID + '.html', { pre: async (p, ctx) => { await warm(p); await ctx.setOffline(true); } });
// booth card (popup) open -> the page URL itself must carry the booth, and that URL must open it for a friend
{ const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], geolocation: ME, permissions: ['geolocation'] }); const p = await ctx.newPage();
  await p.goto(BASE + '?ll=35.79513,-78.71064&z=20'); await p.waitForTimeout(4000); await ctx.setGeolocation({ latitude: 35.7951274, longitude: -78.712, accuracy: 5 });
  const pt = await p.evaluate(id => { const b = __ff.booths.find(x => x.id === id); return window.__ffLL([b.lat, b.lon]); }, ID);
  await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(1200);
  const u = p.url(); const has = /[?&]booth=L0-1387(&|$)/.test(u); console.log((has ? 'OK   ' : 'BUG  ') + 'booth card open -> address bar has booth'.padEnd(46), u); if (!has) bad.push('card url');
  await ctx.close(); await run('friend opens the copied address-bar URL', u, { wantRoute: true }); }
await b.close();
console.log(bad.length ? 'BUGS: ' + bad.join(', ') : 'ALL OK'); process.exit(bad.length ? 1 : 0);
