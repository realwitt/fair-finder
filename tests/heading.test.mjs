// v7.5 heading controller. Node only, no browser.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Heading = require('../heading.js');
const Geo = require('../geo.js');

const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }

// 1. course snaps on the first moving fix
let h = Heading.create();
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 1.2, heading: 90 }, 1000);
let c = h.current();
ok(c.source === 'course' && c.deg === 90, 'moving with heading 90 is course 90 ' + JSON.stringify(c));

// 2. stopped, no compass → null (no 2-minute stay)
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 0, heading: 90 }, 1500);
c = h.current();
ok(c.deg == null && c.source == null, 'stopped without compass is null ' + JSON.stringify(c));

// 3. compass while stopped, then stale at exactly 3000 ms
h = Heading.create();
h.onCompass(200, 2000, true);
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 0 }, 2000);
c = h.current();
ok(c.source === 'compass' && c.deg === 200, 'fresh compass while stopped ' + JSON.stringify(c));
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 0 }, 5000);
c = h.current();
ok(c.deg == null && c.source == null, 'compass age 3000 is stale ' + JSON.stringify(c));

// 4. course from two smoothed fixes ≥ 3 m apart; bad accuracy is not moving
h = Heading.create();
const lat1 = 35.795, lon1 = -78.71;
const lat2 = lat1 + 20 / 111320; // ~20 m north
h.onPosition({ latitude: lat1, longitude: lon1, accuracy: 10, speed: 2, heading: null }, 1000);
h.onPosition({ latitude: lat2, longitude: lon1, accuracy: 10, speed: 2, heading: null }, 2000);
const sm1 = { lat: lat1, lon: lon1 };
const sm2 = { lat: lat1 + 0.5 * (lat2 - lat1), lon: lon1 };
const expectBr = Geo.bearingDeg(sm1.lat, sm1.lon, sm2.lat, sm2.lon);
c = h.current();
ok(c.source === 'course' && c.deg != null && Math.abs(angDiff(expectBr, c.deg)) < 1, 'bearing between smoothed fixes ' + JSON.stringify(c) + ' expect ' + expectBr);
h.onPosition({ latitude: lat2, longitude: lon1, accuracy: 40, speed: 2, heading: null }, 3000);
c = h.current();
ok(c.source !== 'course', 'accuracy 40 is not moving ' + JSON.stringify(c));

// 5. speed and accuracy thresholds
h = Heading.create();
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 0.7, heading: 45 }, 1000);
ok(h.current().source !== 'course', 'speed 0.7 is not course ' + JSON.stringify(h.current()));
h = Heading.create();
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 25, speed: 1, heading: 45 }, 1000);
ok(h.current().source === 'course' && h.current().deg === 45, 'accuracy 25 speed 1 is course');
h = Heading.create();
h.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 25.1, speed: 1, heading: 45 }, 1000);
ok(h.current().source !== 'course', 'accuracy 25.1 is not course ' + JSON.stringify(h.current()));

// 6. shortest-angle smoothing 350 → 10, jitter under 2°
h = Heading.create();
h.onCompass(350, 1, true);
h.onCompass(10, 2, true);
c = h.current();
ok(Math.abs(c.deg - 355) < 0.01 && c.source === 'compass', '350 then 10 low-pass is 355 ' + c.deg);
let prevUnwrapped = 350;
let deg = c.deg;
let longWay = false;
for (let i = 0; i < 10; i++) {
  h.step(0.2);
  const now = h.current().deg;
  const step = angDiff(deg, now);
  const from350 = angDiff(350, now);
  if (from350 < -20) longWay = true;
  if (now != null) prevUnwrapped += angDiff(deg, now);
  deg = now;
  if (Math.abs(step) > 180) longWay = true;
}
ok(!longWay && (deg <= 12 || deg >= 350), 'steps move toward 10 the short way, deg ' + deg);
const before = Heading.create();
before.onCompass(10, 1, true);
before.onCompass(11, 2, true);
ok(before.current().deg === 10, 'jitter under 2° leaves deg at 10, got ' + before.current().deg);

// 7. readingFromEvent
ok(Heading.readingFromEvent({ webkitCompassHeading: 90 }, 0) === 90, 'webkit 90');
ok(Heading.readingFromEvent({ webkitCompassHeading: 90 }, 90) === 180, 'webkit 90 + screen 90');
ok(Heading.readingFromEvent({ alpha: 90, absolute: true }, 0) === 270, 'alpha 90 absolute');
ok(Heading.readingFromEvent({ alpha: 90, absolute: true }, 90) === 0, 'alpha 90 + screen 90');
ok(Heading.readingFromEvent({ alpha: 90, absolute: false }, 0) == null, 'relative alpha is null');
ok(Heading.readingFromEvent({ webkitCompassHeading: 10, alpha: 90, absolute: true }, 0) === 10, 'webkit wins over alpha');
ok(Heading.readingFromEvent({ type: 'deviceorientationabsolute', alpha: 0 }, 0) === 0, 'absolute event alpha 0');

// 8. walking: compass readings do not override GPS course; stopping hands over to compass
{
  const w = Heading.create();
  w.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 1.3, heading: 90 }, 1000);
  w.onCompass(250, 1100, true);
  ok(w.current().source === 'course' && w.current().deg === 90, 'walking: compass 250 ignored, course 90 kept ' + JSON.stringify(w.current()));
  w.onPosition({ latitude: 35.795, longitude: -78.71, accuracy: 8, speed: 0.1, heading: null }, 2000);
  w.onCompass(250, 2100, true);
  ok(w.current().source === 'compass', 'stopped: compass takes over ' + JSON.stringify(w.current()));
}

// 9. no coords.speed: speed and course come from fixes; a duplicate fix within 0.8 s does not stop the course
{
  const w = Heading.create();
  let lat = 35.795, lon = -78.71;
  for (let i = 0; i < 5; i++) { lat += 0.0000102; lon -= 0.0000125; w.onPosition({ latitude: lat, longitude: lon, accuracy: 5 }, 1000 + i * 1000); }
  w.onPosition({ latitude: lat, longitude: lon, accuracy: 5 }, 5300); // duplicate re-delivery
  w.onCompass(200, 5400, true);
  const c = w.current(5500);
  ok(c.source === 'course' && Math.abs(angDiff(315, c.deg)) < 15, 'derived course ~315 survives duplicate fix and compass ' + JSON.stringify(c));
}

console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
