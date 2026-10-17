// v7.9 title gate: first visit, remembered tap, deep links skip it.
import { chromium, devices } from '/workspace/ff-node/node_modules/playwright/index.mjs';

const URL = process.env.FF_URL || 'http://127.0.0.1:8766/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const phone = { ...devices['iPhone 14 Pro'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const b = await chromium.launch();

async function gate(page) {
  return page.evaluate(() => {
    const el = document.getElementById('titleScreen');
    const cs = getComputedStyle(el);
    const h1 = document.querySelector('#titleScreen h1').textContent.replace(/\s+/g, ' ').trim();
    const note = document.getElementById('titleNote').textContent.trim();
    const btn = document.getElementById('openMap');
    const a = document.getElementById('titleCredit');
    const img = a.querySelector('img');
    const box = el.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    const ab = a.getBoundingClientRect();
    return {
      shown: cs.display !== 'none' && el.getClientRects().length > 0,
      h1, note, btn: btn.textContent.trim(),
      href: a.href, target: a.target, credit: a.textContent.replace(/\s+/g, ' ').trim(),
      src: img.getAttribute('src'),
      title: document.title,
      og: document.querySelector('meta[property="og:title"]').content,
      canonical: document.querySelector('link[rel="canonical"]').href,
      seen: localStorage.getItem('ff-title-seen'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      covers: box.width >= 380 && box.height >= 800,
      btnIn: bb.top >= 0 && bb.bottom <= 844 && bb.height >= 56,
      creditIn: ab.top >= 0 && ab.bottom <= 844 && ab.height > 0,
    };
  });
}

const ctx = await b.newContext(phone);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
let g = await gate(p);
ok(g.shown, 'title screen shows on first visit');
ok(g.h1 === 'Fair Finder: the unofficial NC State Fair guide', 'headline ' + g.h1);
ok(/unofficial/i.test(g.h1), 'headline contains unofficial');
ok(g.note === 'Not affiliated with or endorsed by the NC State Fair.', 'disclaimer ' + g.note);
ok(g.btn === 'Open the map', 'button ' + g.btn);
ok(g.href === 'https://birbol.com/' && g.target === '_blank' && g.credit === 'Made by birbol', 'birbol credit ' + g.href + ' ' + g.credit);
ok(g.src && g.src.startsWith('icons/birbol.svg') && !/^https?:/i.test(g.src), 'local logo ' + g.src);
ok(g.title.includes('Unofficial') && g.og.includes('Unofficial'), 'title and og:title ' + g.title);
ok(g.canonical === 'https://ncstatefair.app/', 'canonical ' + g.canonical);
ok(!g.overflow && g.covers && g.btnIn && g.creditIn, '390 layout ' + JSON.stringify({ overflow: g.overflow, covers: g.covers, btnIn: g.btnIn, creditIn: g.creditIn }));
ok(errs.length === 0, 'no pageerror ' + errs.join(' | '));
const logo = await p.evaluate(async (src) => {
  const r = await fetch(src);
  const t = await r.text();
  return { status: r.status, svg: t.includes('<svg') };
}, g.src);
ok(logo.status === 200 && logo.svg, 'logo precache path serves svg ' + logo.status);

await p.click('#openMap');
g = await gate(p);
ok(!g.shown && g.seen === '1', 'tap hides and remembers');
await p.reload({ waitUntil: 'domcontentloaded' });
g = await gate(p);
ok(!g.shown && g.seen === '1', 'reload stays in the app');
await ctx.close();

const deep = await b.newContext(phone);
const d = await deep.newPage();
await d.goto(URL + '?booth=L0-1387', { waitUntil: 'domcontentloaded' });
g = await gate(d);
ok(!g.shown && g.seen == null, 'booth deep link skips ' + g.seen);
await d.goto(URL + 'b/L0-1387.html', { waitUntil: 'domcontentloaded' });
await d.waitForURL(/booth=L0-1387/, { timeout: 10000 });
g = await gate(d);
ok(!g.shown, 'share page skips the title screen ' + d.url());
await deep.close();

const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });
const w = await desk.newPage();
await w.goto(URL, { waitUntil: 'domcontentloaded' });
const lay = await w.evaluate(() => {
  const h = document.querySelector('#titleScreen h1').getBoundingClientRect();
  const btn = document.getElementById('openMap').getBoundingClientRect();
  const a = document.getElementById('titleCredit').getBoundingClientRect();
  return {
    shown: getComputedStyle(document.getElementById('titleScreen')).display !== 'none',
    overflow: document.documentElement.scrollWidth > 1281,
    h: h.width > 200 && h.top >= 0 && h.bottom < 800,
    btn: btn.width >= 300 && btn.height >= 64 && btn.bottom < 800 && btn.top > h.bottom,
    credit: a.bottom <= 800 && a.top > btn.bottom,
  };
});
ok(lay.shown && !lay.overflow && lay.h && lay.btn && lay.credit, 'desktop layout ' + JSON.stringify(lay));
await desk.close();
await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
