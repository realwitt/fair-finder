// You-are-here heading: GPS course while moving, compass while stopped.
// Browser: window.Heading. Node: module.exports. No DOM.
(function (root) {
  const Geo = (root && root.Geo) || (typeof require === 'function' ? require('./geo.js') : null);
  function norm(d) { return ((d % 360) + 360) % 360; }
  function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }
  function finite(n) { return typeof n === 'number' && isFinite(n); }

  function readingFromEvent(e, screenAngle) {
    if (!e) return null;
    let h = null;
    if (finite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && finite(e.alpha)) h = (360 - e.alpha) % 360;
    if (h == null) return null;
    return norm(h + (screenAngle || 0));
  }

  function create() {
    const self = {
      disp: null, target: null, pos: null, prevRaw: null, courseFix: null,
      courseActive: false, courseAt: 0, compassAt: 0, compassDeg: null, t: 0,
    };
    function setTarget(deg, source, t) {
      deg = norm(deg);
      self.target = deg;
      if (source === 'course') { self.courseActive = true; self.courseAt = t; }
      if (source === 'compass') { self.compassDeg = deg; self.compassAt = t; }
      self.t = t;
      if (self.disp == null) { self.disp = deg; return; }
      const d = angDiff(self.disp, deg);
      if (Math.abs(d) < 2) return;
      self.disp = norm(self.disp + 0.25 * d);
    }
    function onPosition(coords, t) {
      coords = coords || {};
      const lat = coords.latitude, lon = coords.longitude;
      const acc = finite(coords.accuracy) ? coords.accuracy : Infinity;
      if (!self.pos) self.pos = { lat: lat, lon: lon };
      else { self.pos.lat += 0.5 * (lat - self.pos.lat); self.pos.lon += 0.5 * (lon - self.pos.lon); }
      let speed = 0;
      if (finite(coords.speed)) speed = coords.speed;
      else if (self.prevRaw) {
        const dt = (t - self.prevRaw.t) / 1000;
        // A fix re-delivered within 0.8 s (watch restarts, duplicate callbacks) says nothing about speed: keep the current state.
        if (dt < 0.8) { self.t = t; return; }
        speed = Geo.distanceM(self.prevRaw.lat, self.prevRaw.lon, lat, lon) / dt;
      }
      self.prevRaw = { lat: lat, lon: lon, t: t };
      self.t = t;
      const moving = speed > 0.7 && acc <= 25;
      if (moving) {
        if (finite(coords.heading)) setTarget(coords.heading, 'course', t);
        else if (self.courseFix && Geo.distanceM(self.courseFix.lat, self.courseFix.lon, self.pos.lat, self.pos.lon) >= 3) {
          setTarget(Geo.bearingDeg(self.courseFix.lat, self.courseFix.lon, self.pos.lat, self.pos.lon), 'course', t);
          self.courseFix = { lat: self.pos.lat, lon: self.pos.lon };
        } else if (!self.courseFix) self.courseFix = { lat: self.pos.lat, lon: self.pos.lon };
      } else self.courseActive = false;
    }
    function onCompass(deg, t, absolute) {
      if (absolute === false) return;
      if (!finite(deg)) return;
      if (self.courseActive) { self.compassDeg = norm(deg); self.compassAt = t; return; } // walking: GPS course wins
      setTarget(deg, 'compass', t);
    }
    function current(now) {
      const t = finite(now) ? now : self.t;
      if (self.courseActive && self.disp != null && t - self.courseAt < 15000) return { deg: self.disp, source: 'course' };
      if (self.compassDeg != null && t - self.compassAt < 3000 && self.disp != null) return { deg: self.disp, source: 'compass' };
      return { deg: null, source: null };
    }
    function step(dtSeconds) {
      if (self.disp == null || self.target == null) return;
      const d = angDiff(self.disp, self.target);
      if (Math.abs(d) < 2) return false;
      self.disp = norm(self.disp + d * (1 - Math.exp(-dtSeconds / 0.25)));
      return true; // still easing
    }
    return { onPosition, onCompass, current, step };
  }

  const api = { create, readingFromEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Heading = api;
})(typeof window !== 'undefined' ? window : this);
