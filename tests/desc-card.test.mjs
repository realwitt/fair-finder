// v7.9.1: long booth menus are deduped, punctuation from ", NEW" joins is cleaned,
// and the phone card keeps its header and actions on screen.
import { createRequire } from 'module';
import fs from 'fs';
import { chromium } from '/workspace/ff-node/node_modules/playwright/index.mjs';

const require = createRequire(import.meta.url);
const Desc = require('../desc.js');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const booths = JSON.parse(fs.readFileSync(new URL('../data/booths.json', import.meta.url), 'utf8')).booths;

function count(hay, needle) {
  let n = 0, i = 0;
  const h = hay.toLowerCase(), nd = needle.toLowerCase();
  while (nd && (i = h.indexOf(nd, i)) !== -1) { n++; i += nd.length; }
  return n;
}

const red = booths.find(b => b.id === 'L0-1314');
const birria = booths.find(b => b.id === 'L0-1422');
const redM = Desc.model(red), birriaM = Desc.model(birria);
ok(redM.news.map(n => n.name).join(' | ') === 'Cookies N Cream KDog | Blue Heat Taki K-Dog | Tosti-Elote', 'Red Carpet new names ' + redM.news.map(n => n.name).join(' | '));
ok(count(Desc.fullPlain(redM), 'Cookies N Cream KDog') === 1, 'Red Carpet name once');
ok(count(Desc.fullPlain(redM), 'An all-cheese K-Dog dipped') === 1, 'Red Carpet blurb once');
ok(!Desc.fullPlain(redM).includes('Takis!,'), 'Red Carpet drops Takis!,');
ok(Desc.fullPlain(redM).includes('Takis!'), 'Red Carpet keeps Takis!');
ok(/Fried Dough/.test(redM.rest) && !/NEW /.test(redM.rest), 'Red Carpet rest is the regular menu');
ok(!Desc.shortPlain(redM).includes('crushed Oreos'), 'Red Carpet short list hides the blurb');
ok(Desc.isLong(redM), 'Red Carpet is long');

ok(birriaM.news.map(n => n.name).join(' | ') === 'Birria Egg Rolls with Consome Soup | California Style Birria Cheetos Balls', 'birria names ' + birriaM.news.map(n => n.name).join(' | '));
ok(count(Desc.fullPlain(birriaM), 'California Style Birria Cheetos Balls') === 1, 'birria second item once');
ok(count(Desc.fullPlain(birriaM), 'slow fire to perfection') === 1, 'birria perfection once');
ok(!Desc.fullPlain(birriaM).includes('perfection.,'), 'birria drops perfection.,');
ok(/tacos/i.test(birriaM.rest) && /aguas frescas/i.test(birriaM.rest), 'birria rest keeps the pipe menu');
ok(!Desc.shortPlain(birriaM).includes('dried chili'), 'birria short list is names');

const fake = Desc.model({ products: 'NEW A: Done!, NEW B: Wow. | soda, water' });
ok(fake.news.length === 2 && fake.news[0].description === 'Done!' && fake.news[1].description === 'Wow.' && fake.rest === 'soda, water', 'fake join ' + JSON.stringify(fake));
ok(!/[,|]\s*$/.test(fake.news[0].description) && !Desc.fullPlain(fake).includes('!,'), 'fake punctuation');

let multi = 0, dirty = 0;
for (const b of booths) {
  const m = Desc.model(b);
  const full = Desc.fullPlain(m);
  if (/[.!?],/.test(full)) dirty++;
  if ((b.products || '').includes(', NEW ')) {
    multi++;
    if (m.news.length < 2) fails.push('expected 2+ new items ' + b.id + ' ' + b.name);
    for (const n of m.news) {
      if (n.description && count(full, n.description) !== 1) fails.push('description repeated ' + b.id + ' ' + n.name);
    }
  }
}
ok(dirty === 0, 'no joined punctuation left in ' + booths.length + ' booths (' + dirty + ')');
ok(multi >= 10, 'checked multi-NEW booths ' + multi);

const plain = Desc.model({ products: 'Funnel cakes, soda & water' });
ok(!Desc.isLong(plain) && plain.news.length === 0 && plain.rest.startsWith('Funnel cakes'), 'short menu stays short');

const APP = process.env.FF_URL || 'http://127.0.0.1:8766/';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  geolocation: { latitude: 35.7935, longitude: -78.7105, accuracy: 8 },
  permissions: ['geolocation'],
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ff-title-seen', '1');
    localStorage.setItem('ff.statsNoteSeen', '1');
    localStorage.setItem('ff.sheet', 'collapsed');
  } catch (e) {}
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(APP + '?ll=35.79587,-78.70980&z=19', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ff && __ff.booths && __ff.booths.length > 100 && window.Desc, null, { timeout: 20000 });
await page.waitForTimeout(400);

async function openCard(id) {
  await page.evaluate(id => {
    const m = __ff.markers && __ff.markers.get(id);
    if (m) m.openPopup();
  }, id);
  await page.waitForSelector('.leaflet-popup .popCard', { timeout: 8000 });
  await page.waitForTimeout(450);
}
function box() {
  return page.evaluate(() => {
    const pop = document.querySelector('.leaflet-popup');
    const fab = document.getElementById('fab').getBoundingClientRect();
    const top = document.getElementById('top').getBoundingClientRect();
    const guide = document.getElementById('guide');
    const g = guide && !guide.classList.contains('hidden') ? guide.getBoundingClientRect() : null;
    const pr = pop.getBoundingClientRect();
    const go = pop.querySelector('.go').getBoundingClientRect();
    const share = pop.querySelector('.shareBooth').getBoundingClientRect();
    const x = pop.querySelector('.leaflet-popup-close-button').getBoundingClientRect();
    const title = pop.querySelector('.popTitle').getBoundingClientRect();
    const body = pop.querySelector('.popBody');
    const br = body.getBoundingClientRect();
    const overlap = (a, b) => {
      if (!a || !b) return false;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 1 && h > 1;
    };
    const vh = window.innerHeight;
    const vis = (r) => r.top >= top.bottom - 1 && r.bottom <= vh + 1 && r.height > 16 && r.width > 16;
    return {
      text: pop.innerText,
      underTop: pr.top < top.bottom - 1,
      underFab: overlap(pr, fab),
      underGuide: g && g.top < vh - 2 ? overlap(pr, g) : false,
      go: vis(go), share: vis(share), x: vis(x) && x.top >= top.bottom - 1, title: vis(title),
      bodyScroll: body.scrollHeight > body.clientHeight + 2,
      more: (pop.querySelector('.descToggle') || {}).textContent || '',
      expanded: (pop.querySelector('.popText') || {}).getAttribute('data-open'),
      goBottom: Math.round(go.bottom), popBottom: Math.round(pr.bottom), popTop: Math.round(pr.top),
      topBottom: Math.round(top.bottom), fabLeft: Math.round(fab.left), popRight: Math.round(pr.right),
    };
  });
}

await openCard('L0-1314');
let c = await box();
ok(!c.underTop && !c.underFab && c.go && c.share && c.x && c.title, 'Red Carpet collapsed fits ' + JSON.stringify({ underTop: c.underTop, underFab: c.underFab, go: c.go, share: c.share, x: c.x, title: c.title, popTop: c.popTop, popBottom: c.popBottom, popRight: c.popRight, fabLeft: c.fabLeft, topBottom: c.topBottom }));
ok(c.more === 'More' && c.expanded === '0', 'More button collapsed ' + c.more);
ok(count(c.text, 'Cookies N Cream KDog') === 1 && !c.text.includes('crushed Oreos') && !c.text.includes('Takis!,'), 'collapsed text is the short list');
await page.click('.leaflet-popup .descToggle');
await page.waitForTimeout(350);
c = await box();
ok(c.more === 'Less' && c.expanded === '1' && c.text.includes('crushed Oreos') && count(c.text, 'An all-cheese K-Dog dipped') === 1, 'More shows the blurb once ' + (c.text.includes('crushed Oreos') ? 'has blurb' : c.text.slice(0, 180)));
ok(!c.underTop && !c.underFab && c.go && c.share && c.title && c.x, 'Red Carpet expanded still fits ' + JSON.stringify({ underTop: c.underTop, underFab: c.underFab, go: c.go, share: c.share, bodyScroll: c.bodyScroll, popBottom: c.popBottom }));

await page.click('.leaflet-popup .go');
await page.waitForFunction(() => window.__ff && __ff.target && __ff.target.id === 'L0-1314', null, { timeout: 8000 });
await page.waitForTimeout(500);
await openCard('L0-1314');
c = await box();
ok(!c.underTop && !c.underFab && !c.underGuide && c.go && c.share, 'card clears the guide sheet ' + JSON.stringify({ underGuide: c.underGuide, underFab: c.underFab, underTop: c.underTop, go: c.go, popBottom: c.popBottom, goBottom: c.goBottom }));

const toggle = page.locator('#resList .descToggle').first();
await page.fill('#q', 'birria');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForSelector('#resList .descToggle', { timeout: 8000 });
const row = await page.evaluate(() => {
  const li = document.querySelector('#resList .descToggle').closest('li');
  const btn = li.querySelector('.descToggle');
  return { name: li.querySelector('.r-name').textContent, more: btn.textContent, tag: btn.tagName, expanded: btn.getAttribute('aria-expanded') };
});
ok(row.tag === 'BUTTON' && row.more === 'More' && row.expanded === 'false', 'results More is a button ' + JSON.stringify(row));
const before = await page.locator('#guide').evaluate(el => el.classList.contains('hidden'));
await toggle.click();
await page.waitForTimeout(200);
const after = await page.evaluate(() => {
  const btn = document.querySelector('#resList .descToggle');
  const text = document.getElementById(btn.getAttribute('aria-controls'));
  return { more: btn.textContent, open: text.getAttribute('data-open'), guideHidden: document.getElementById('guide').classList.contains('hidden') };
});
ok(after.more === 'Less' && after.open === '1' && after.guideHidden === before, 'results More expands in place ' + JSON.stringify(after));
ok(errs.length === 0, 'no pageerror ' + errs.join(' | '));
await browser.close();

console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
