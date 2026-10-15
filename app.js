/* Fair Finder – NC State Fair 2026 */
(() => {
'use strict';
const FAIR_TILES = 'https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer/tile/{z}/{y}/{x}';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Official fair tile layer full extent (EPSG:3857) converted to lat/lon
const FAIR_BOUNDS = L.latLngBounds([35.79119, -78.72134], [35.79952, -78.70469]);
const CENTER = [35.7948, -78.7115];
const APP_VERSION = 'v4 · Oct 15 5:15 PM';
const $ = id => document.getElementById(id);
const LS_KEY = 'ff.guideTarget';
const state = { me: null, acc: null, gpsHeading: null, compass: null, compassAt: 0, target: null, booths: [], atms: [], results: [] };
window.__ff = state; // exposed for testing

// ---------- Map ----------
const map = L.map('map', { zoomControl: false, maxZoom: 21, minZoom: 14, preferCanvas: true, tap: true }).setView(CENTER, 17);
const canvas = L.canvas({ padding: 0.5, tolerance: 12 });
const base = {
  sat: L.tileLayer(SAT, { maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
  osm: L.tileLayer(OSM, { maxNativeZoom: 19, maxZoom: 21, attribution: '© OpenStreetMap contributors' }),
};
base.sat.addTo(map);
// The fair publishes its cartoon grounds map as a georeferenced Web Mercator tile cache
// (512px tiles, level L == Leaflet zoom L+1), so it lines up without manual control points.
const fair = L.tileLayer(FAIR_TILES, { tileSize: 512, zoomOffset: -1, minNativeZoom: 14, maxNativeZoom: 21, maxZoom: 21, bounds: FAIR_BOUNDS.pad(0.05), opacity: 0.85, attribution: 'Grounds map © NC State Fair / NCDA&CS', className: 'fairTiles' }).addTo(map);
const boothLayer = L.layerGroup().addTo(map), hitLayer = L.layerGroup().addTo(map);
const atmLayer = L.layerGroup(), drinkLayer = L.layerGroup();
const guideLine = L.polyline([], { color: '#e6007e', weight: 6, dashArray: '10 8', opacity: 0.95 }).addTo(map);
let meMarker = null, accCircle = null;

// ---------- Layers panel ----------
$('btnLayers').onclick = () => $('layersPanel').classList.toggle('hidden');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.add('hidden'));
$('tglFair').onchange = e => e.target.checked ? fair.addTo(map) : map.removeLayer(fair);
$('fairOpacity').oninput = e => { fair.setOpacity(e.target.value / 100); $('opVal').textContent = e.target.value + '%'; };
document.querySelectorAll('input[name=base]').forEach(r => r.onchange = () => {
  Object.values(base).forEach(l => map.removeLayer(l)); base[r.value].addTo(map); base[r.value].bringToBack();
});
$('tglFood').onchange = e => e.target.checked ? boothLayer.addTo(map) : map.removeLayer(boothLayer);
$('tglATM').onchange = e => e.target.checked ? atmLayer.addTo(map) : map.removeLayer(atmLayer);
$('tglDrinks').onchange = e => e.target.checked ? drinkLayer.addTo(map) : map.removeLayer(drinkLayer);

// ---------- Data ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function popupHtml(b) {
  return `<b>${esc(b.name)}</b>${b.kind === 'newfood' ? ' <span class="badge new">NEW 2026</span>' : ''}${b.location !== 'exact' ? ' <span class="badge approx">approx. location</span>' : ''}<br>
  <small>${esc(b.area)}${b.lot ? ' · ' + esc(b.lot) : ''}</small>
  ${b.newFood ? `<div><b>New:</b> ${esc(b.newFood.name)}: ${esc(b.newFood.description)}</div>` : ''}
  <div style="max-height:9em;overflow:auto">${esc(b.products || '(no menu listed)')}</div>
  <button class="go" data-id="${esc(b.id)}">➜ Guide me here</button>`;
}
function boothMarker(b, cls) {
  const color = cls === 'hit' ? '#e6007e' : b.kind === 'newfood' ? '#ffd400' : (b.drinks && !b.food ? '#00b3ff' : '#ff5a00');
  const m = L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: cls === 'hit' ? 11 : 7, color: '#000', weight: cls === 'hit' ? 3 : 2, fillColor: color, fillOpacity: 1 });
  m.bindPopup(() => popupHtml(b), { maxWidth: 300 });
  return m;
}
map.on('popupopen', e => { const btn = e.popup.getElement().querySelector('.go'); if (btn) btn.onclick = () => { map.closePopup(); startGuide(btn.dataset.id); }; });

async function loadData() {
  const [bd, ad] = await Promise.all([fetch('data/booths.json').then(r => r.json()), fetch('data/atms.json').then(r => r.json()).catch(() => null)]);
  state.meta = bd;
  state.booths = bd.booths.filter(b => b.lat != null).map(FoodSearch.prepare);
  state.booths.filter(b => b.food || b.kind === 'newfood').forEach(b => boothMarker(b).addTo(boothLayer));
  state.booths.filter(b => b.drinks).forEach(b => L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: 8, color: '#000', weight: 2, fillColor: '#00b3ff', fillOpacity: 1 }).bindPopup(() => popupHtml(b)).addTo(drinkLayer));
  if (ad) {
    state.atms = ad.atms;
    const icon = L.divIcon({ className: '', html: '<div class="atmIcon">$</div>', iconSize: [30, 30] });
    ad.atms.forEach(a => L.marker([a.lat, a.lon], { icon, keyboard: false }).bindPopup(`<b>ATM</b> <span class="badge approx">approx. location</span><br><small>Position of the ATM icon on the official fair map, so it may be off by 10–30 m.</small><button class="go" data-id="${a.id}">➜ Guide me here</button>`).addTo(atmLayer));
  }
  const nF = state.booths.filter(b => b.food || b.kind === 'newfood').length;
  setStatus(`${nF} food booths loaded`);
  buildAbout(bd, ad);
  const q = new URLSearchParams(location.search).get('q'); if (q) { $('q').value = q; runSearch(); }
  let saved = null; try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
  if (saved && findTarget(saved)) startGuide(saved, true);
}

function buildAbout(bd, ad) {
  const c = bd.counts;
  $('aboutBody').innerHTML = `<p><b>${state.booths.length}</b> booths from the fair's official Food &amp; Ride Finder data (${c.vendor} vendors, ${c.newfood} “New Foods 2026” entries, ${c.sponsor} sponsor booths). <b>All booth positions are the fair's own GIS points.</b> Data generated ${esc(bd.generated)}.</p>
  <p><b>ATMs:</b> ${ad ? ad.atms.length + ' read from the ATM icons on the official grounds map, so their positions are <b>approximate</b>.' : 'not loaded'}</p>
  <p><b>Drinks:</b> booths whose official menu text mentions drinks (lemonade, tea, soda, water…). The fair publishes no separate drink-station or water-refill layer.</p>
  <p>Menus and locations can change during the fair. Food/drink tags are keyword matches on the official menu text.</p>
  <ul>${bd.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>`;
}
$('aboutLink').onclick = e => { e.preventDefault(); $('layersPanel').classList.add('hidden'); $('about').classList.remove('hidden'); };

// ---------- Location ----------
function setStatus(t) { $('status').textContent = t; }
function onPos(p) {
  const { latitude: lat, longitude: lon, accuracy, heading, speed } = p.coords;
  state.me = [lat, lon]; state.acc = accuracy;
  if (heading != null && !isNaN(heading) && speed != null && speed > 0.7) { state.gpsHeading = heading; state.gpsHeadingAt = Date.now(); }
  if (!meMarker) {
    meMarker = L.marker(state.me, { icon: L.divIcon({ className: '', html: '<div class="youDot"></div>', iconSize: [22, 22] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(state.me, { radius: accuracy, color: '#1a73e8', weight: 2, fillColor: '#1a73e8', fillOpacity: 0.15, interactive: false }).addTo(map);
    if (FAIR_BOUNDS.pad(0.5).contains(state.me)) map.setView(state.me, 18);
  } else { meMarker.setLatLng(state.me); accCircle.setLatLng(state.me).setRadius(accuracy); }
  state.meAt = Date.now(); state.gpsError = null;
  setStatus(`GPS ±${Math.round(accuracy * 3.28084)} ft`);
  // Refresh distances in the list WITHOUT touching guide visibility or the map view.
  if (state.results.length) renderResults(false, true);
  updateGuide();
}
function onPosErr(e) { state.gpsError = e.message || String(e.code); updateGuide(); setStatus(e.code === 1 ? 'Location blocked: allow it in Settings › Safari › Location' : 'Waiting for GPS… (' + e.message + ')'); }
let watchId = null;
function startWatch() {
  if (!('geolocation' in navigator)) return setStatus('This browser has no geolocation');
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  // A timeout error does not stop watchPosition, and guide state is never cleared by GPS problems.
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
startWatch();
$('btnLocate').onclick = () => state.me ? map.setView(state.me, Math.max(map.getZoom(), 18)) : setStatus('No GPS fix yet');

// ---------- Search ----------
let tmr;
$('q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(runSearch, 180); });
$('searchForm').onsubmit = e => { e.preventDefault(); runSearch(); $('q').blur(); };
$('clearQ').onclick = () => { $('q').value = ''; clearResults(); };
document.querySelectorAll('.chip').forEach(c => c.onclick = () => { $('q').value = c.dataset.q === 'new' ? '' : c.dataset.q; runSearch(c.dataset.q === 'new'); });
$('closeResults').onclick = clearResults;
function clearResults() { state.results = []; hitLayer.clearLayers(); $('results').classList.add('hidden'); }
$('q').addEventListener('focus', () => document.body.classList.add('typing'));
$('q').addEventListener('blur', () => document.body.classList.remove('typing'));
function dist(b) { return state.me ? Geo.distanceM(state.me[0], state.me[1], b.lat, b.lon) : null; }
function runSearch(newOnly) {
  const q = $('q').value.trim();
  if (newOnly === true) state.results = state.booths.filter(b => b.kind === 'newfood').map(b => ({ booth: b, score: 1, matched: b.newFood ? [b.newFood.name] : [] }));
  else if (q.length < 2) return clearResults();
  else state.results = FoodSearch.search(state.booths, q);
  state.query = newOnly === true ? 'New foods 2026' : q;
  renderResults(true);
}
function renderResults(fit, quiet) {
  const rs = state.results;
  rs.forEach(r => { r.d = dist(r.booth); r.tier = r.score >= 0.85 ? 0 : 1; });
  rs.sort((a, b) => a.tier - b.tier || (a.d != null && b.d != null ? a.d - b.d : b.score - a.score));
  hitLayer.clearLayers();
  rs.forEach(r => boothMarker(r.booth, 'hit').addTo(hitLayer));
  $('resCount').textContent = rs.length ? `${rs.length} for “${state.query}”${state.me ? ', nearest first' : ''}` : `No booths list “${state.query}”`;
  const hl = (s) => esc(s);
  $('resList').innerHTML = rs.slice(0, 80).map((r, i) => {
    const b = r.booth, items = (r.matched.length ? r.matched : (b.items || [])).slice(0, 4);
    return `<li data-id="${esc(b.id)}" data-i="${i}">
      <div class="r-top"><span class="r-name">${esc(b.name)}</span><span class="r-dist">${r.d != null ? Geo.fmtFeet(r.d) : ''}</span></div>
      <div class="r-items">${items.map(it => r.matched.length ? `<mark>${hl(it)}</mark>` : hl(it)).join(', ')}</div>
      <div class="r-meta">${b.kind === 'newfood' ? '<span class="badge new">NEW 2026</span>' : ''}${r.tier ? '<span class="badge">related</span>' : ''}${b.location !== 'exact' ? '<span class="badge approx">approx.</span>' : ''}${esc(b.area)}${b.lot ? ' · ' + esc(b.lot) : ''}</div></li>`;
  }).join('');
  if (!quiet) $('results').classList.remove('hidden'); // guide stays up: it sits on top of the results sheet
  document.body.classList.toggle('guiding', !!state.target);
  if (fit && rs.length) {
    const pts = rs.slice(0, 5).map(r => [r.booth.lat, r.booth.lon]); if (state.me) pts.push(state.me);
    map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 19, paddingBottomRight: [0, window.innerHeight * 0.45] });
  }
}
$('resList').onclick = e => { const li = e.target.closest('li'); if (li) startGuide(li.dataset.id); };

// ---------- Guide ----------
function findTarget(id) {
  const b = state.booths.find(x => x.id === id); if (b) return b;
  const a = state.atms.find(x => x.id === id); if (a) return { id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, location: 'approximate', area: 'From the official map icon', products: '' };
}
function startGuide(id, resume) {
  const t = findTarget(id); if (!t) return;
  state.target = t; state.arrivedShown = false;
  try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  $('results').classList.add('hidden'); $('guide').classList.remove('hidden');
  document.body.classList.add('guiding');
  requestWake();
  $('guideName').textContent = t.name;
  $('guideMenuBody').textContent = (t.newFood ? 'NEW: ' + t.newFood.name + ': ' + t.newFood.description + ' | ' : '') + (t.products || '(no menu listed)');
  $('guideMenu').classList.toggle('hidden', !t.products);
  $('btnCompass').classList.toggle('hidden', !!state.compassOn);
  const pts = [[t.lat, t.lon]]; if (state.me) pts.push(state.me);
  if (!resume || pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 19, paddingBottomRight: [0, window.innerHeight * 0.45] });
  updateGuide();
}
// The ONLY way guide mode ends: the explicit Stop button.
function stopGuide() {
  state.target = null; state.guide = null; guideLine.setLatLngs([]);
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  $('guide').classList.add('hidden'); document.body.classList.remove('guiding');
  releaseWake();
  if (state.results.length) $('results').classList.remove('hidden');
}
$('closeGuide').onclick = stopGuide;
$('btnShowList').onclick = () => { if (state.results.length) $('results').classList.toggle('hidden'); else $('q').focus(); };
function currentHeading() {
  const now = Date.now();
  if (state.compass != null && now - state.compassAt < 3000) return { h: state.compass, src: 'compass' };
  if (state.gpsHeading != null && now - state.gpsHeadingAt < 8000) return { h: state.gpsHeading, src: 'gps' };
  // Stalled: keep the last heading we had (up to 2 min) rather than flipping the arrow to north-up.
  if (state.compass != null && now - state.compassAt < 120000) return { h: state.compass, src: 'compass', stale: true };
  if (state.gpsHeading != null && now - state.gpsHeadingAt < 120000) return { h: state.gpsHeading, src: 'gps', stale: true };
  return { h: null, src: 'north' };
}
function updateGuide() {
  const t = state.target; if (!t) return;
  const meta = `${t.area || ''}${t.lot ? ' · ' + t.lot : ''}${t.location !== 'exact' ? ' · approximate location' : ' · official GIS point'}`;
  $('guide').classList.remove('hidden'); document.body.classList.add('guiding'); // guide never hides itself
  if (!state.me) { $('guideDist').textContent = '—'; $('guideHint').textContent = 'Waiting for your GPS position…'; $('guideMeta').textContent = meta; $('guideUpd').textContent = 'updating…'; return; }
  const d = Geo.distanceM(state.me[0], state.me[1], t.lat, t.lon), br = Geo.bearingDeg(state.me[0], state.me[1], t.lat, t.lon);
  const { h, src } = currentHeading();
  const rot = h == null ? br : Geo.relativeDeg(br, h);
  state.guide = { distanceM: d, bearing: br, heading: h, headingSource: src, arrowRotation: rot };
  $('arrow').style.transform = `rotate(${rot}deg)`;
  $('northTag').classList.toggle('hidden', h != null);
  $('guideDist').textContent = Geo.fmtFeet(d);
  const arrived = d <= 15;
  $('guide').classList.toggle('arrived', arrived);
  $('guideHint').textContent = arrived ? '✅ Arrived: it should be right around you' : Geo.hint(d, br, h);
  const gpsAge = Date.now() - (state.meAt || 0), hd = currentHeading();
  const upd = [];
  if (gpsAge > 10000 || state.gpsError) upd.push('GPS updating… (last fix ' + Math.round(gpsAge / 1000) + 's ago)');
  if (hd.stale) upd.push('compass updating…');
  $('guideUpd').textContent = upd.join(' · ');
  state.guide.arrived = arrived; state.guide.stale = upd.length > 0;
  $('guideMeta').textContent = meta + ` · heading: ${src === 'compass' ? 'compass' : src === 'gps' ? 'GPS (walking direction)' : 'none, arrow is north-up'} · GPS ±${Math.round(state.acc * 3.28)} ft`;
  guideLine.setLatLngs([state.me, [t.lat, t.lon]]);
  document.documentElement.style.setProperty('--guideH', $('guide').offsetHeight + 'px');
}
setInterval(updateGuide, 1000);

// Compass: iOS needs a user gesture to request permission; Android gives absolute alpha.
function screenAngle() {
  // Portrait is by far the common case. Some engines report a bogus angle, so trust the viewport shape first.
  if (window.innerHeight >= window.innerWidth) return 0;
  if (typeof window.orientation === 'number' && window.orientation !== 0) return window.orientation;
  return (screen.orientation && screen.orientation.angle) || 90;
}
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // already corrected for screen on iOS? (relative to device top)
  else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = (360 - e.alpha) % 360;
  if (h == null) return;
  h = (h + screenAngle() + 360) % 360;
  state.compass = h; state.compassAt = Date.now(); state.compassOn = true;
  $('btnCompass').classList.add('hidden');
  if (!state._lastG || Date.now() - state._lastG > 150) { state._lastG = Date.now(); updateGuide(); }
}
function startCompass() {
  window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient);
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
  window.addEventListener('deviceorientation', onOrient);
  state.compassListening = true;
}
$('btnCompass').onclick = async () => {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { $('guideHint').textContent = 'Compass permission denied. Using walking direction or a north-up arrow.'; return; }
    }
    startCompass(); state.compassGranted = true;
    setTimeout(() => { if (!state.compassOn) $('guideMeta').textContent = 'No compass data from this device. Walk a few steps for a GPS heading, or use the north-up arrow.'; }, 2500);
  } catch (err) { $('guideHint').textContent = 'Compass unavailable: ' + err.message; }
};
// Non-iOS browsers don't need permission, so start listening right away.
if (!(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')) startCompass();

// ---------- Wake lock & lifecycle ----------
let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
function onResume() {
  // iOS suspends geolocation/orientation while locked or in another app: re-acquire, keep guide mode as-is.
  startWatch();
  if (state.compassListening || state.compassGranted) startCompass();
  if (state.target) { requestWake(); $('guide').classList.remove('hidden'); updateGuide(); }
  state.resumeCount = (state.resumeCount || 0) + 1;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onResume(); });
window.addEventListener('pageshow', e => { if (e.persisted) onResume(); });
window.addEventListener('focus', () => { if (state.target && !wakeLock) requestWake(); });

// ---------- Offline ----------
function tileList() {
  const urls = [];
  const lonToX = (lon, n) => Math.floor((lon + 180) / 360 * n), latToY = (lat, n) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const b = FAIR_BOUNDS;
  for (let lvl = 14; lvl <= 19; lvl++) { const n = 2 ** lvl; for (let x = lonToX(b.getWest(), n); x <= lonToX(b.getEast(), n); x++) for (let y = latToY(b.getNorth(), n); y <= latToY(b.getSouth(), n); y++) urls.push(FAIR_TILES.replace('{z}', lvl).replace('{y}', y).replace('{x}', x)); }
  for (let z = 15; z <= 19; z++) { const n = 2 ** z; for (let x = lonToX(b.getWest(), n); x <= lonToX(b.getEast(), n); x++) for (let y = latToY(b.getNorth(), n); y <= latToY(b.getSouth(), n); y++) urls.push(SAT.replace('{z}', z).replace('{y}', y).replace('{x}', x)); }
  return urls;
}
$('btnOffline').onclick = async () => {
  const urls = tileList(); let done = 0, fail = 0;
  const msg = $('offlineMsg');
  const cache = await caches.open('ff-tiles-v1');
  const q = urls.slice();
  async function worker() { while (q.length) { const u = q.shift(); try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); else fail++; } } catch (e) { fail++; } done++; if (done % 10 === 0) msg.textContent = `Saving map… ${done}/${urls.length}`; } }
  await Promise.all(Array.from({ length: 6 }, worker));
  msg.textContent = `Saved ${done - fail}/${urls.length} map tiles for offline use.`;
};
$('version').textContent = APP_VERSION;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js?v=4', { updateViaCache: 'none' }).then(r => r.update && r.update()).catch(() => {});
}

loadData().catch(e => setStatus('Could not load booth data: ' + e.message));
})();
