import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Stats = require('../stats.js');
const Geo = require('../geo.js');

const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

function mem() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const lat0 = 35.8, lon0 = -78.71;
function north(meters) {
  const guess = lat0 + meters / 111320;
  const d = Geo.distanceM(lat0, lon0, guess, lon0);
  return lat0 + (meters / 111320) * (meters / d);
}
const booth = { id: 'B1', lat: lat0, lon: lon0 };
const T = Date.parse('2026-10-15T16:00:00Z');

ok(Math.abs(Geo.distanceM(lat0, lon0, north(40), lon0) - 40) < 0.05, 'north offset is 40 m');
ok(Math.abs(Geo.distanceM(lat0, lon0, north(10), lon0) - 10) < 0.05, 'north offset is 10 m');
ok(Math.abs(Geo.distanceM(lat0, lon0, north(22), lon0) - 22) < 0.05, 'north offset is 22 m');

// outside then inside dwell counts once
{
  const tr = Stats.createTracker([booth, { id: 'FAR', lat: lat0 + 0.02, lon: lon0 }]);
  ok(tr.onFix(north(40), lon0, 10, T) === null, 'outside arms, no count');
  ok(tr.onFix(north(10), lon0, 10, T + 1000) === null, 'first inside fix starts dwell');
  ok(tr.onFix(north(10), lon0, 10, T + 1000 + 7999) === null, '7999 ms is short of the dwell');
  ok(tr.onFix(north(10), lon0, 10, T + 1000 + 8000) === 'B1', 'dwell of 8s and 2 fixes counts B1');
  ok(tr.onFix(north(10), lon0, 10, T + 30000) === null, 'same dwell does not count twice');
  ok(tr.onFix(north(40), lon0, 10, T + 40000) === null, 'back outside re-arms');
  ok(tr.onFix(north(10), lon0, 10, T + 41000) === null, 're-entry starts a new dwell');
  ok(tr.onFix(north(10), lon0, 10, T + 41000 + 8000) === 'B1', 'a later arrival can count again');
}

// opening already inside never counts
{
  const tr = Stats.createTracker([booth]);
  ok(tr.onFix(north(10), lon0, 8, T) === null, 'start inside does not count');
  ok(tr.onFix(north(8), lon0, 8, T + 20000) === null, 'staying inside still does not count');
  ok(tr.onFix(north(5), lon0, 5, T + 40000) === null, 'more inside fixes still do not count');
}

// accuracy > 25 is ignored
{
  const tr = Stats.createTracker([booth]);
  ok(tr.onFix(north(40), lon0, 26, T) === null, 'poor outside fix does not arm');
  ok(tr.onFix(north(10), lon0, 8, T + 1000) === null, 'inside without a good outside does not count');
  ok(tr.onFix(north(10), lon0, 8, T + 20000) === null, 'dwell without arm does not count');
  ok(tr.onFix(north(40), lon0, 10, T + 30000) === null, 'good outside arms');
  ok(tr.onFix(north(10), lon0, 8, T + 31000) === null, 'good inside starts dwell');
  ok(tr.onFix(north(10), lon0, 40, T + 36000) === null, 'bad accuracy inside is ignored');
  ok(tr.onFix(north(10), lon0, 25, T + 31000 + 8000) === 'B1', 'accuracy of 25 still counts; the bad fix did not reset the clock');
}

// hold at 20–25 m does not count
{
  const tr = Stats.createTracker([booth]);
  ok(tr.onFix(north(40), lon0, 10, T) === null, 'arm before the hold');
  let hit = null;
  for (let i = 1; i <= 12; i++) {
    const id = tr.onFix(north(22), lon0, 10, T + i * 2000);
    if (id) hit = id;
  }
  ok(hit === null, 'holding at 22 m does not count');
  ok(tr.onFix(north(10), lon0, 10, T + 30000) === null, 'entering after the hold starts a fresh dwell');
  ok(tr.onFix(north(10), lon0, 10, T + 30000 + 8000) === 'B1', 'a real arrival after the hold still counts');
}

// a guide or tap is not a tracker input
{
  const tr = Stats.createTracker([booth]);
  ok(typeof tr.onFix === 'function' && typeof tr.onGuide !== 'function' && typeof tr.startGuide !== 'function' && typeof tr.onTap !== 'function', 'tracker has no guide or tap helper');
  tr.onFix(north(50), lon0, 8, T);
  ok(tr.onFix(north(10), lon0, 8, T + 400) === null, 'one inside fix (a tap) does not count');
  ok(tr.onFix(north(10), lon0, 8, T + 400 + 8000) === 'B1', 'only later onFix calls move the tracker');
}

// daily cap
{
  const store = mem();
  const day1 = Date.parse('2026-10-15T16:00:00Z');
  const day2 = Date.parse('2026-10-16T16:00:00Z');
  ok(Stats.localDay(Date.parse('2026-10-15T03:30:00Z')) === '2026-10-14', 'NY day before midnight UTC-4');
  ok(Stats.localDay(Date.parse('2026-10-15T04:30:00Z')) === '2026-10-15', 'NY day after midnight');
  ok(Stats.localDay(day1) === '2026-10-15', 'localDay Oct 15');
  ok(!Stats.capHas(store, 'L0-1', day1), 'cap empty');
  Stats.capMark(store, 'L0-1', day1);
  ok(Stats.capHas(store, 'L0-1', day1), 'same local day cap blocks');
  ok(store.getItem('ff.cap.2026-10-15.L0-1') === '1', 'cap key uses the NY day');
  Stats.capMark(store, 'chip:hot-dog', day1);
  ok(Stats.capHas(store, 'chip:hot-dog', day1), 'search key cap');
  ok(!Stats.capHas(store, 'L0-1', day2), 'next day allows');
  ok(store.getItem('ff.cap.2026-10-15.L0-1') == null, 'other days are pruned');
}
// capHas on day2 does not mark. The assertion above is wrong if capHas doesn't mark.
// Fix: next-day allow check must not require the key to be written. Re-check below.

{
  const store = mem();
  const day1 = Date.parse('2026-10-15T16:00:00Z');
  const day2 = Date.parse('2026-10-16T16:00:00Z');
  Stats.capMark(store, 'L0-9', day1);
  ok(!Stats.capHas(store, 'L0-9', day2), 'next day capHas is clear');
  ok(store.getItem('ff.cap.2026-10-15.L0-9') == null, 'previous day key pruned');
  ok(store.getItem('ff.cap.2026-10-16.L0-9') == null, 'capHas does not mark');
  Stats.capMark(store, 'L0-9', day2);
  ok(Stats.capHas(store, 'L0-9', day2), 'mark on the next day allows a new count');
}

ok(Stats.chipKey('hot dog') === 'hot-dog', 'hot dog');
ok(Stats.chipKey('ice cream') === 'ice-cream', 'ice cream');
ok(Stats.chipKey('fried cheeseburger') === 'fried-cheeseburger', 'fried cheeseburger');
ok(Stats.chipKey('new') === 'new', 'new');
ok(Stats.chipKey('bbq') === 'bbq', 'bbq');
ok(Stats.CHIP_KEYS.length === 10 && Stats.CHIP_KEYS[0] === 'hot-dog', 'ten chip keys');
ok(Stats.chipKey('near') === null && Stats.chipKey('favorites') === null && Stats.chipKey('rides') === null, 'near, favorites, rides are not chips');
ok(Stats.chipKey('secret words') === null && Stats.chipKey('hot-dog') === null && Stats.chipKey('') === null, 'free-text keys are rejected');

const low = [{ id: 'a', n: 4 }, { id: 'b', n: 5 }, { k: 'chip:bbq', n: 9 }, { id: 'c', n: 2 }];
const kept = Stats.filterCount(low);
ok(kept.length === 2 && kept[0].id === 'b' && kept[1].k === 'chip:bbq', 'n < 5 is dropped');
ok(Stats.panelMode(kept) === 'chips', 'fewer than 3 items means chips');
ok(Stats.panelMode([{ n: 5 }, { n: 5 }, { n: 4 }]) === 'chips', 'only qualifying items count toward 3');
ok(Stats.panelMode([{ n: 5 }, { n: 6 }, { n: 7 }]) === 'live', '3 qualifying items is live');
ok(Stats.panelMode([{ n: 5 }, { n: 5 }, { n: 5 }, { n: 1 }]) === 'live', 'extra low rows do not hide a live panel');


// v7.6.1 dense booths: standing at A with neighbours B (5 m) and C (11 m) counts only A, once per stop
{
  const A = { id: 'A', lat: 35.795, lon: -78.71 }, Bn = { id: 'B', lat: 35.795 + 5 / 111320, lon: -78.71 }, Cn = { id: 'C', lat: 35.795 - 11 / 111320, lon: -78.71 };
  const tr = Stats.createTracker([A, Bn, Cn]); const at = m => 35.795 + m / 111320; const T0 = 1e12; const got = [];
  tr.onFix(at(-50), -78.71, 8, T0);
  for (let t = 1; t <= 30; t++) { const r = tr.onFix(at(1), -78.71, 8, T0 + t * 1000); if (r) got.push(r); }
  ok(got.length === 1 && got[0] === 'A', 'dense row: only the nearest booth counts, once per stop ' + JSON.stringify(got));
  const tr2 = Stats.createTracker([A, Bn]); const got2 = [];
  tr2.onFix(at(-50), -78.71, 8, T0);
  for (let t = 1; t <= 20; t++) { const r = tr2.onFix(at(t % 2 ? 1 : 4), -78.71, 8, T0 + t * 1000); if (r) got2.push(r); }
  ok(got2.length === 0, 'GPS flipping between two neighbours never reaches dwell (undercount rather than double count) ' + JSON.stringify(got2));
}
if (fails.length) {
  console.log(fails.length + ' FAILURES');
  process.exit(1);
}
console.log('ALL PASS');
