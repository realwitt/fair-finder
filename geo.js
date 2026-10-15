// Pure geo helpers (no DOM). Also loadable in Node for tests.
(function (root) {
  const R = 6371008.8, toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  function distanceM(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  // Initial great-circle bearing, degrees clockwise from true north, 0..360
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  // Signed relative angle -180..180 (positive = target is to the right)
  function relativeDeg(bearing, heading) { return ((bearing - heading + 540) % 360) - 180; }
  const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  function compassWord(b) { return COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }
  function directionHint(rel) {
    const a = Math.abs(rel), side = rel < 0 ? 'left' : 'right';
    if (a <= 12) return 'straight ahead';
    if (a <= 35) return 'ahead and slightly ' + side;
    if (a <= 70) return 'ahead to your ' + side;
    if (a <= 110) return 'to your ' + side;
    if (a <= 160) return 'behind you to the ' + side;
    return 'behind you';
  }
  function feet(m) { return m * 3.28084; }
  function fmtFeet(m) {
    const ft = feet(m);
    if (ft < 30) return 'under 30 ft';
    if (ft < 1000) return (Math.round(ft / 10) * 10) + ' ft';
    return (ft / 5280).toFixed(ft < 5280 ? 2 : 1) + ' mi';
  }
  function hint(m, bearing, heading) {
    const d = 'about ' + fmtFeet(m);
    if (heading == null || isNaN(heading)) return d + ', to the ' + compassWord(bearing);
    return d + ', ' + directionHint(relativeDeg(bearing, heading));
  }
  const api = { distanceM, bearingDeg, relativeDeg, compassWord, directionHint, feet, fmtFeet, hint };
  if (typeof module !== 'undefined') module.exports = api; else root.Geo = api;
})(this);
