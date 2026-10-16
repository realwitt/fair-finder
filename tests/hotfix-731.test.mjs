// v7.3.1 hotfix checks at 390x844 (touch): dropdown above everything + capped + scrolls (2), suggestion opens card (3),
// dropdown never covers Stop ✕ / results ✕ while guiding (5), Rides chip near the front + toggle (8/9), likely matches.
import { chromium, devices } from 'playwright';
import fs from 'fs';
const URL = process.env.FF_URL || 'http://127.0.0.1:8765/';
const SH = (process.env.FF_SHOTS_HOTFIX || '/workspace/ff-hotfix-shots');
fs.mkdirSync(SH, { recursive: true });
const ME = { latitude: 35.7944, longitude: -78.7097, accuracy: 6 };
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: ME, permissions: ['geolocation'] });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const ready = () => p.waitForFunction(() => window.__ff && window.__ff.rides && window.__ff.rides.length >= 99 && window.__ff.suggestIndex);
const shot = n => p.screenshot({ path: `${SH}/${n}.png` });
const typeQ = async q => { await p.tap('#q'); await p.fill('#q', ''); await p.type('#q', q, { delay: 40 }); await p.waitForTimeout(450); };
// is the element's center the topmost hit (i.e. tappable)?
const hit = sel => p.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return false; const r = e.getBoundingClientRect(); if (!r.width) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20)); return !!t && (t === e || e.contains(t)); }, sel);

await p.goto(URL, { waitUntil: 'networkidle' }); await ready(); await p.waitForTimeout(500);
// 8: Rides chip on screen at load
const rc = await p.locator('.chip[data-q="rides"]').boundingBox();
ok(rc && rc.x >= 0 && rc.x + rc.width <= 390, `Rides chip visible at load (x ${Math.round(rc.x)}..${Math.round(rc.x + rc.width)})`);
await shot('08-rides-chip-front');
// 9: toggle + active state + fit bounds
await p.tap('.chip[data-q="rides"]'); await p.waitForTimeout(700);
ok(await p.isVisible('#results') && await p.locator('.chip[data-q="rides"].on').count() === 1 && await p.getAttribute('.chip[data-q="rides"]', 'aria-pressed') === 'true', 'Rides chip shows selected');
await p.tap('#rideSubs button[data-sub="thrill"]'); await p.waitForTimeout(500);
const thrillTxt = await p.locator('#resList').innerText();
ok(/Zipper/.test(thrillTxt) && /Mega Drop/.test(thrillTxt) && /Thrill \(est\.\)/.test(thrillTxt), 'Thrill includes Zipper + Mega Drop, labelled (est.)');
await shot('09-rides-thrill');
await p.tap('#rideSubs button[data-sub="all"]'); await p.waitForTimeout(400);
await p.tap('.chip[data-q="rides"]'); await p.waitForTimeout(400);
ok(!(await p.isVisible('#results')) && await p.locator('.chip.on').count() === 0, 'second tap on Rides chip turns it off');

// 2: long list fully reachable, above the results sheet, scrolls
await typeQ('corn dog');
const g = await p.evaluate(() => { const s = document.getElementById('suggest').getBoundingClientRect(), r = document.getElementById('results'); const rr = r.getBoundingClientRect(); return { sTop: s.top, sBot: s.bottom, rTop: rr.top, rVis: getComputedStyle(r).visibility === 'visible' && !r.classList.contains('hidden'), n: document.querySelectorAll('#suggest li').length, sh: document.getElementById('suggest').scrollHeight, ch: document.getElementById('suggest').clientHeight }; });
ok(g.n >= 6, 'corn dog: ' + g.n + ' suggestions');
ok(!g.rVis || g.sBot <= g.rTop + 1, `dropdown ends above the results sheet (dropdown ${Math.round(g.sTop)}-${Math.round(g.sBot)}, sheet top ${Math.round(g.rTop)}, sheet visible ${g.rVis})`);
await shot('02-corn-dog-dropdown');
let allHit = true;
for (let i = 0; i < g.n; i++) { const li = await p.locator('#suggest li').nth(i); await li.evaluate(e => e.scrollIntoView({ block: 'nearest' })); if (!(await hit(await li.elementHandle()))) { allHit = false; console.log('  not tappable: #' + i); } }
ok(allHit, 'every corn dog suggestion is tappable (list scrolls: ' + g.sh + '/' + g.ch + ')');
await shot('02-corn-dog-dropdown-scrolled');
const vvFit = await p.evaluate(() => { const s = document.getElementById('suggest').getBoundingClientRect(); return s.bottom <= visualViewport.offsetTop + visualViewport.height; });
ok(vvFit, 'dropdown within the visual viewport');

// 3: picking a ride suggestion opens its card with Guide me here + Share
await typeQ('tilt a whirl');
await p.locator('#suggest li', { hasText: 'Tilt a Whirl' }).first().tap(); await p.waitForTimeout(900);
const pop = p.locator('.leaflet-popup');
ok(await pop.isVisible() && /Tilt a Whirl/.test(await pop.innerText()) && await pop.locator('button.go').isVisible() && await pop.locator('.shareBooth').isVisible(), 'suggestion opens ride card with Guide me here + Share: ' + (await pop.isVisible() ? (await pop.innerText()).replace(/\n/g, ' | ') : 'no popup'));
ok(await pop.isVisible() && await hit('.leaflet-popup .go'), 'Guide me here tappable');
await shot('03-suggestion-opens-card');
// Bungee card shows cash price
await typeQ('bungee');
await p.locator('#suggest li[data-id="L0-1185"]').first().tap(); await p.waitForTimeout(800);
ok(/\$10/.test(await p.locator('.leaflet-popup').innerText()), 'Bungee card shows $10 cash price: ' + (await p.locator('.leaflet-popup').innerText()).replace(/\n/g, ' | '));
await shot('09-bungee-cash-price');
await p.locator('.leaflet-popup .go').tap(); await p.waitForTimeout(1200);
ok(await p.isVisible('#guide'), 'Guide me here from the card starts guidance');

// 5: while guiding, the dropdown doesn't cover Stop ✕ or results ✕
await p.fill('#q', ''); await p.evaluate(() => document.getElementById('q').blur()); await p.waitForTimeout(300);
await p.tap('#sheetBar', { position: { x: 196, y: 8 } }); await p.waitForTimeout(500); // expand guide
await typeQ('corn dog');
const stopOk = await hit('#closeGuide');
const resOpen = await p.evaluate(() => { const r = document.getElementById('results'); return !r.classList.contains('hidden') && getComputedStyle(r).visibility === 'visible'; });
const closeOk = !resOpen || await hit('#closeResults');
ok(stopOk, 'guiding + typing: Stop ✕ tappable');
ok(closeOk, 'guiding + typing: results ✕ tappable or sheet stepped aside (results visible ' + resOpen + ')');
const n5 = await p.locator('#suggest li').count(); let all5 = true;
for (let i = 0; i < n5; i++) { const li = p.locator('#suggest li').nth(i); await li.evaluate(e => e.scrollIntoView({ block: 'nearest' })); if (!(await hit(await li.elementHandle()))) all5 = false; }
ok(all5, 'guiding + typing: every suggestion tappable');
await shot('05-guiding-dropdown');
await p.tap('#closeGuide'); await p.waitForTimeout(500);
ok(!(await p.isVisible('#guide')), 'Stop ✕ works while the dropdown was open');
await shot('05-after-stop');

// likely matches
await p.goto(URL, { waitUntil: 'networkidle' }); await ready(); await p.evaluate(() => localStorage.removeItem('ff.guideTarget'));
await typeQ('pirate');
const sg = await p.$$eval('#suggest li', ls => ls.map(l => ({ t: l.innerText.replace(/\n/g, ' '), lik: l.classList.contains('likely'), sep: l.getAttribute('role') === 'presentation' })));
const iPI = sg.findIndex(s => /Pirate's Island/.test(s.t) && !s.lik), iSR = sg.findIndex(s => /Sea Ray Ship/.test(s.t) && s.lik);
const iSep = sg.findIndex(s => s.sep && /Likely matches/i.test(s.t));
ok(iPI >= 0 && iSep > iPI && iSR > iSep, 'pirate dropdown: Pirate\'s Island direct, then Likely matches incl. Sea Ray Ship: ' + sg.map(s => (s.sep ? 'sep ' : s.lik ? '~' : '') + s.t).join(' | '));
await shot('10-pirate-dropdown-likely');
await p.press('#q', 'Enter'); await p.waitForTimeout(700);
const rl = await p.$$eval('#resList li', ls => ls.map(l => ({ t: l.innerText.replace(/\n/g, ' '), lik: l.classList.contains('likely') })));
const fl = rl.findIndex(x => x.lik);
ok(fl > 0 && rl.slice(fl).every(x => x.lik) && rl.slice(fl).some(x => /Sea Ray Ship/.test(x.t)) && /Pirate's Island/.test(rl.slice(0, fl).map(x => x.t).join()), 'pirate results: direct first, then Likely matches group with Sea Ray Ship');
await shot('10-pirate-results-likely');
await typeQ('bumper cars'); await p.press('#q', 'Enter'); await p.waitForTimeout(700);
ok(/Dodgem Scooters/.test(await p.locator('#resList').innerText()), 'bumper cars results include Dodgem Scooters');
await typeQ('slushie'); await p.press('#q', 'Enter'); await p.waitForTimeout(700);
ok(/Moose Joose Slush/.test(await p.locator('#resList').innerText()), 'slushie results include a slush booth');
await shot('10-slushie-results');
await typeQ('Cococrissi'); await p.press('#q', 'Enter'); await p.waitForTimeout(700);
ok(/^1 result for/.test(await p.textContent('#resCount')), '1 result singular: ' + await p.textContent('#resCount'));
await typeQ('goldenkdog');
const gk = await p.$$eval('#suggest li', ls => ls.map(l => l.innerText.replace(/\n/g, ' ')));
ok(gk.length === 2 && gk[0] !== gk[1] && gk.every(t => /LOT I00/.test(t)), 'goldenkdog suggestions distinguishable: ' + gk.join(' | '));
await shot('07-goldenkdog-lots');
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
await b.close();
console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
