import { chromium, devices } from 'playwright';
import fs from 'fs';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const ME = { latitude: 35.79485, longitude: -78.7093, accuracy: 6 };
const SHOTS = '/workspace/ff-rides-shots';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
const SHOTS_ALT = '/tmp/ff-rides-shots';
fs.mkdirSync(SHOTS_ALT, { recursive: true });
async function shot(page, name) {
  try { await page.screenshot({ path: SHOTS + '/' + name }); }
  catch (e) {
    if (!/EACCES|permission/i.test(String(e && e.message))) throw e;
    await page.screenshot({ path: SHOTS_ALT + '/' + name });
    console.log('screenshot wrote ' + SHOTS_ALT + '/' + name + ' (' + e.code + ' on ' + SHOTS + ')');
  }
}
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const errs = [];
const ctxOpts = { ...devices['iPhone 14 Pro'], viewport: { width: 390, height: 844 }, geolocation: ME, permissions: ['geolocation'] };
let ctx = await b.newContext(ctxOpts);
let p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
const ready = pg => pg.waitForFunction(() => window.__ff && window.__ff.rides && window.__ff.rides.length >= 99);
await p.goto(URL, { waitUntil: 'networkidle' });
await ready(p);
await p.waitForTimeout(400);
ok(await p.locator('.rideIcon').count() >= 99, 'ride icons ' + await p.locator('.rideIcon').count());

await p.click('#q');
await p.type('#q', 'tilt a whirl', { delay: 30 });
await p.waitForSelector('#suggest li', { timeout: 5000 });
ok(await p.locator('#suggest').isVisible() && /Tilt a Whirl/.test(await p.locator('#suggest li').first().innerText()), 'autocomplete first ' + await p.locator('#suggest li').first().innerText());
await shot(p, '01-autocomplete.png');
await p.locator('#suggest li').first().click();
await p.waitForSelector('.leaflet-popup', { timeout: 5000 });
await p.waitForTimeout(300);
const pop = await p.locator('.leaflet-popup').innerText();
ok(/Tilt a Whirl/.test(pop) && /4 tickets/.test(pop), 'popup ' + pop.replace(/\n/g, ' | '));
ok(new globalThis.URL(p.url()).searchParams.get('booth') === 'L0-1099', 'url booth ' + p.url());
await shot(p, '02-ride-card.png');
await p.locator('.leaflet-popup .go').click();
await p.waitForTimeout(400);
ok(await p.locator('#guide').isVisible(), 'guide visible');
ok(await p.evaluate(() => window.__ff.target && window.__ff.target.id) === 'L0-1099', 'target id');
ok((await p.textContent('#guideName')).trim() === 'Tilt a Whirl', 'guide name ' + await p.textContent('#guideName'));
await shot(p, '03-ride-guide.png');

await p.evaluate(() => { window.__shared = null; navigator.share = async d => { window.__shared = d; }; });
await p.evaluate(() => window.__ffSheet.set('expanded'));
await p.waitForTimeout(300);
await p.click('#btnShare');
await p.waitForTimeout(200);
const sh = await p.evaluate(() => window.__shared);
ok(sh && sh.url.includes('/b/L0-1099.html'), 'share url ' + (sh && sh.url));

let ctx2 = await b.newContext(ctxOpts);
let p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('fresh ' + e.message));
await p2.goto(URL + '?booth=L0-1099', { waitUntil: 'networkidle' });
await ready(p2);
await p2.waitForFunction(() => window.__ff.target && window.__ff.target.id === 'L0-1099');
ok((await p2.textContent('#guideName')).trim() === 'Tilt a Whirl', 'deep link guide ' + await p2.textContent('#guideName'));
await ctx2.close();

await p.goto(URL, { waitUntil: 'networkidle' });
await ready(p);
await p.click('.chip[data-q="rides"]');
await p.waitForTimeout(400);
const allN = await p.locator('#resList li').count();
ok(allN >= 99, 'rides chip count ' + allN);
await p.click('#rideSubs button[data-sub="kiddie"]');
await p.waitForTimeout(200);
const kidN = await p.locator('#resList li').count();
ok(kidN > 0 && kidN < allN, 'kiddie subfilter ' + kidN + ' < ' + allN);

await p.evaluate(() => localStorage.removeItem('ff.guideTarget'));
await p.goto(URL + '?q=rides', { waitUntil: 'networkidle' });
await ready(p);
await p.waitForTimeout(500);
ok(await p.locator('#resList li').count() >= 99 && await p.locator('#results').isVisible(), 'q=rides restores ' + await p.locator('#resList li').count() + ' vis=' + await p.locator('#results').isVisible());

await p.fill('#q', '');
await p.type('#q', 'super cyclone', { delay: 20 });
await p.waitForFunction(() => { const li = document.querySelector('#suggest li'); return li && /Super Cyclone/.test(li.textContent); });
ok(/Super Cyclone/.test(await p.locator('#suggest li').first().innerText()), 'super cyclone suggest ' + await p.locator('#suggest li').first().innerText());

await p.fill('#q', '');
await p.waitForFunction(() => document.getElementById('suggest').classList.contains('hidden'));
await p.type('#q', 'tilt-a-whirl', { delay: 20 });
await p.waitForFunction(() => { const li = document.querySelector('#suggest li'); return li && /Tilt a Whirl/.test(li.textContent); });
const listTxt = await p.locator('#suggest').innerText();
ok(/Tilt a Whirl/.test(await p.locator('#suggest li').first().innerText()), 'tilt-a-whirl first ' + await p.locator('#suggest li').first().innerText());
ok(/aka Tilt-A-Whirl/.test(listTxt), 'aka alias shown ' + listTxt.replace(/\n/g, ' | '));

await p.fill('#q', '');
await p.waitForFunction(() => document.getElementById('suggest').classList.contains('hidden'));
await p.type('#q', 'empan', { delay: 30 });
await p.waitForFunction(() => { const li = document.querySelector('#suggest li'); return li && li.getAttribute('data-type') === 'food' && /empan/i.test(li.textContent); });
await p.keyboard.press('ArrowDown');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
const kn = await p.locator('#resList li').count();
ok(await p.locator('#results').isVisible() && kn > 0 && kn < 40, 'keyboard empan results ' + kn + ' q=' + await p.inputValue('#q'));

ok(errs.length === 0, 'no pageerror ' + errs.join(' | '));
await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
