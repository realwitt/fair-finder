import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const FoodSearch = require('../search.js');
const Suggest = require('../suggest.js');
const Rides = require('../rides.js');

const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const boothsRaw = JSON.parse(fs.readFileSync(new URL('../data/booths.json', import.meta.url), 'utf8'));
const ridesRaw = JSON.parse(fs.readFileSync(new URL('../data/rides.json', import.meta.url), 'utf8'));
const rides = ridesRaw.rides.map(Rides.prepare);
const rideIds = new Set(rides.map(r => r.id));
const booths = boothsRaw.booths.filter(b => b.lat != null && !rideIds.has(b.id)).map(FoodSearch.prepare);
ok(!booths.some(b => b.id === 'L0-1335'), 'Super Slide booth removed when it is a ride id');
const index = Suggest.buildIndex({ booths, rides });

const forms = ['Tilt-A-Whirl', 'tilt a whirl', 'tiltawhirl', 'TILT A-WHIRL!'];
const compacts = forms.map(Suggest.compact);
ok(compacts.every(c => c === 'tiltawhirl'), 'norm/compact equivalence ' + compacts.join(','));
ok(Suggest.norm('Tilt-A-Whirl') === 'tilt a whirl' && Suggest.norm('tilt a whirl') === 'tilt a whirl', 'norm spaces ' + Suggest.norm('Tilt-A-Whirl'));

function first(q) { return Suggest.query(index, q, 8); }
let res = first('tilt a whirl');
ok(res[0] && res[0].type === 'ride' && res[0].id === 'L0-1099' && res[0].label === 'Tilt a Whirl', 'tilt a whirl first ' + (res[0] && res[0].id + ' ' + res[0].label));
const sc = res.find(r => r.id === 'L0-1097');
ok(!!sc && res.indexOf(sc) > 0 && sc.alias === 'Tilt-A-Whirl', 'super cyclone alias below ' + JSON.stringify(sc));

res = first('tiltawhirl');
ok(res[0] && res[0].id === 'L0-1099', 'tiltawhirl first ' + (res[0] && res[0].id));
res = first('Tilt-A-Whirl');
ok(res[0] && res[0].id === 'L0-1099', 'Tilt-A-Whirl first ' + (res[0] && res[0].id));
res = first('super cyclone');
ok(res[0] && res[0].id === 'L0-1097' && res[0].label === 'Super Cyclone', 'super cyclone first ' + (res[0] && res[0].id));
res = first('air raid');
ok(res[0] && res[0].id === 'L0-1099' && /air raid/i.test(res[0].alias || ''), 'air raid alias ' + JSON.stringify(res[0]));
res = first('tilt a whril');
ok(res.some(r => r.id === 'L0-1099'), 'typo tilt a whril hits Tilt a Whirl ' + res.map(r => r.label).join(' | '));
res = first('empanada');
ok(res.some(r => r.type === 'food'), 'empanada food ' + res.map(r => r.type + ':' + r.label).join(' | '));
const em = first('empan');
ok(em[0] && em[0].type === 'food', 'empan first is food ' + (em[0] && em[0].type + ' ' + em[0].label));

const kid = Rides.filter(rides, 'kiddie');
ok(kid.length > 0 && kid.length < rides.length && kid.every(r => r.category === 'kiddie'), 'kiddie filter ' + kid.length + '/' + rides.length);
ok(Rides.filter(rides, 'all').length === rides.length, 'filter all');
const tw = rides.find(r => r.id === 'L0-1099');
ok(Rides.cardMeta(tw) === 'Midway · 4 tickets', 'cardMeta tickets ' + JSON.stringify(Rides.cardMeta(tw)));
ok(tw.products === '' && Array.isArray(tw.items) && tw.kind === 'ride', 'prepare ride');
const cash = rides.find(r => r.cashOnly && r.area);
ok(Rides.cardMeta(cash).includes('Cash Only'), 'cardMeta cash ' + Rides.cardMeta(cash));
const cat = rides.find(r => r.category && r.heightText);
ok(cat && Rides.cardMeta(cat).includes('(per midway operator)') && Rides.cardMeta(cat).includes(cat.category), 'cardMeta height/category');

const qs = [];
const seeds = ['tilt', 'tilt a', 'super', 'super cyclone', 'emp', 'empanada', 'hot dog', 'ride', 'zzqq', 'funnel', 'air', 'whril', 'lemonade', 'bbq', 'tiltawhirl', 'tilt a whril', 'cyclone', 'kiddie', 'wheel', 'slide'];
for (let i = 0; i < 200; i++) qs.push(seeds[i % seeds.length]);
const t0 = Date.now();
for (let i = 0; i < qs.length; i++) Suggest.query(index, qs[i], 8);
const ms = Date.now() - t0;
ok(ms < 500, '200 queries in ' + ms + 'ms');

console.log(fails.length ? fails.length + ' FAILURES' : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
