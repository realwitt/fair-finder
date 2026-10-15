/* Fair Finder – NC State Fair 2026 */
(() => {
'use strict';
const FAIR_TILES = 'https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer/tile/{z}/{y}/{x}';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Fair's published grounds-map tile layer full extent (EPSG:3857) converted to lat/lon
const FAIR_BOUNDS = L.latLngBounds([35.79119, -78.72134], [35.79952, -78.70469]);
const CENTER = [35.7948, -78.7115];
const APP_VERSION = 'v7.1 · Oct 15';
const $ = id => document.getElementById(id);
const LS_KEY = 'ff.guideTarget';
const state = { me: null, acc: null, gpsHeading: null, compass: null, compassAt: 0, target: null, booths: [], atms: [], results: [] };
window.__ff = state; // exposed for testing

// ---------- Map ----------
const map = L.map('map', { zoomControl: false, maxZoom: 21, minZoom: 14, preferCanvas: true, tap: true }).setView(CENTER, 17);
const canvas = L.canvas({ padding: 0.5, tolerance: 12 });
const base = {
  sat: L.tileLayer(SAT, { maxNativeZoom: 19, maxZoom: 21, attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> · Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community' }),
  osm: L.tileLayer(OSM, { maxNativeZoom: 19, maxZoom: 21, crossOrigin: true, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Report a map issue</a>' }),
};
base.osm.addTo(map); // OSM street map is the default base map
// The fair publishes its cartoon grounds map as a georeferenced Web Mercator tile cache
// (512px tiles, level L == Leaflet zoom L+1), so it lines up without manual control points.
const fair = L.tileLayer(FAIR_TILES, { tileSize: 512, zoomOffset: -1, minNativeZoom: 14, maxNativeZoom: 21, maxZoom: 21, bounds: FAIR_BOUNDS.pad(0.05), opacity: 0.85, attribution: 'Grounds map © N.C. Department of Agriculture &amp; Consumer Services', className: 'fairTiles' }).addTo(map);
const boothLayer = L.layerGroup().addTo(map), hitLayer = L.layerGroup().addTo(map);
const atmLayer = L.layerGroup(), drinkLayer = L.layerGroup();
const guideLine = L.polyline([], { color: '#e6007e', weight: 6, dashArray: '10 8', opacity: 0.95 }).addTo(map);
const routeLine = L.polyline([], { color: '#e6007e', weight: 8, opacity: 0.9, lineJoin: 'round' }).addTo(map);
const routeCasing = L.polyline([], { color: '#000', weight: 12, opacity: 0.6 }).addTo(map); routeCasing.bringToBack();
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

// ---------- URL state (shareable links) ----------
// ?q=<search>  ?new=1  ?booth=<id>  &ll=<lat>,<lon>&z=<zoom>. Booth ids are the fair GIS object ids (e.g. L0-1314).
const BASE_TITLE = document.title;
const SHARE_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function urlParams() { return new URLSearchParams(location.search); }
function buildUrl(over) {
  const p = urlParams();
  for (const [k, v] of Object.entries(over)) { if (v == null || v === '') p.delete(k); else p.set(k, v); }
  const qs = p.toString().replace(/%2C/g, ',');
  return location.pathname + (qs ? '?' + qs : '') + location.hash;
}
function setUrl(over, push) {
  const u = buildUrl(over);
  if (u === location.pathname + location.search + location.hash) return;
  try { history[push ? 'pushState' : 'replaceState']({ ff: over.booth ? 'booth' : 'view' }, '', u); } catch (e) {}
}
function shareUrlFor(t) {
  if (t && /^meet_/.test(t.id)) return location.origin + location.pathname.replace(/[^/]*$/, '') + '?booth=' + t.id;
  // /b/<id>.html carries Open Graph tags with the booth name and redirects to ?booth=<id>
  const root = location.origin + location.pathname.replace(/[^/]*$/, '');
  const q = urlParams().get('q');
  if (t) return root + 'b/' + encodeURIComponent(t.id) + '.html' + (q ? '?q=' + encodeURIComponent(q) : '');
  return location.href;
}
async function share(t) {
  const url = shareUrlFor(t), title = t ? `${t.name} · NC State Fair` : BASE_TITLE;
  const text = t && t.meet ? 'I’m here at the fair. Open this to walk to me with Fair Finder' : t ? `${t.name}${t.area ? ' (' + t.area + ')' : ''}: find it at the fair with Fair Finder` : 'Fair Finder';
  try { if (navigator.share) { await navigator.share({ title, text, url }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); return 'copied'; } catch (e) {}
  window.prompt('Copy this link', url); return 'prompt';
}
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2200); }
let mvT; map.on('moveend', () => { clearTimeout(mvT); mvT = setTimeout(() => { const c = map.getCenter(); setUrl({ ll: c.lat.toFixed(5) + ',' + c.lng.toFixed(5), z: map.getZoom() }); }, 400); });

// ---------- Legal text (shared with about/) ----------
const L_ = {"disc_t": "Unofficial guide", "disc": "Fair Finder is an independent, free project. It is not affiliated with, endorsed by, or sponsored by the N.C. State Fair or the N.C. Department of Agriculture &amp; Consumer Services. ‘N.C. State Fair’ is used only to describe the event this guide covers. For official information, see <a href=\"https://www.ncstatefair.org/\" target=\"_blank\" rel=\"noopener\">ncstatefair.org</a>.", "acc": "Booth locations and menus come from the fair’s published data and may change during the fair. ATM locations are approximate. Walking routes come from OpenStreetMap and don’t reflect temporary booths, closures or crowds. Follow posted signs and staff directions; use at your own risk. Provided as-is, with no warranty.", "priv": "Your location is used only on your device to show where you are and guide you. It is never sent to us or stored on a server. No accounts, no analytics, no tracking cookies. The app saves the booth you’re guiding to in your browser so it can resume, and whether the guide panel was open. The site is hosted on GitHub Pages, which logs visitor IP addresses for security. Map images load from OpenStreetMap, Esri and the fair’s ArcGIS server, which see normal web requests.", "cred": "<ul class=\"credits\"><li>Map data <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">© OpenStreetMap</a> contributors</li><li>Routes: OpenStreetMap data (ODbL) · <a href=\"https://www.openstreetmap.org/fixthemap\" target=\"_blank\" rel=\"noopener\">Report a map issue</a></li><li>Grounds map © N.C. Department of Agriculture &amp; Consumer Services</li><li>Booth data: N.C. State Fair Food &amp; Ride Finder</li><li>Satellite layer (optional): Powered by Esri · Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community</li></ul>"};
// ---------- Data ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function popupHtml(b) {
  return `<b>${esc(b.name)}</b>${b.kind === 'newfood' ? ' <span class="badge new">NEW 2026</span>' : ''}${b.location !== 'exact' ? ' <span class="badge approx">approx. location</span>' : ''}<br>
  <small>${esc(b.area)}${b.lot ? ' · ' + esc(b.lot) : ''}</small>
  ${b.newFood ? `<div><b>New:</b> ${esc(b.newFood.name)}: ${esc(b.newFood.description)}</div>` : ''}
  <div style="max-height:9em;overflow:auto">${esc(b.products || '(no menu listed)')}</div>
  <div class="popBtns"><button class="go" data-id="${esc(b.id)}">➜ Guide me here</button><button class="shareBooth" type="button" aria-label="Share ${esc(b.name)}">${SHARE_ICO}<span>Share</span></button></div>`;
}
function boothMarker(b, cls) {
  const color = cls === 'hit' ? '#e6007e' : b.kind === 'newfood' ? '#ffd400' : (b.drinks && !b.food ? '#00b3ff' : '#ff5a00');
  const m = L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: cls === 'hit' ? 11 : 7, color: '#000', weight: cls === 'hit' ? 3 : 2, fillColor: color, fillOpacity: 1 });
  m.bindPopup(() => popupHtml(b), { maxWidth: 300, autoPanPaddingTopLeft: [10, 170], autoPanPaddingBottomRight: [10, 20] });
  return m;
}
map.on('popupopen', e => {
  document.body.classList.add('popup');
  const el = e.popup.getElement(), btn = el.querySelector('.go'), sh = el.querySelector('.shareBooth'); if (!btn) return;
  const id = btn.dataset.id; e.popup._ffId = id;
  btn.onclick = () => { map.closePopup(); startGuide(id); };
  if (sh) sh.onclick = () => share(findTarget(id));
  // v7 share-link fix: an open booth card is part of the URL, so the browser's own Share / copied address bar
  // carries the booth (previously only ll/z were in the URL and the recipient got no booth).
  if (!state.target) setUrl({ booth: id });
});
map.on('popupclose', e => { document.body.classList.remove('popup'); if (e.popup._ffId && !state.target && urlBoothId() === e.popup._ffId) setUrl({ booth: null }); });

async function loadData() {
  const [bd, ad] = await Promise.all([fetch('data/booths.json').then(r => r.json()), fetch('data/atms.json').then(r => r.json()).catch(() => null)]);
  state.meta = bd;
  fetch('data/walkways.json').then(r => r.json()).then(g => { state.graph = new Route.Graph(g); state.graphMeta = g; refreshWalk(true); if (state.target) { state.route = null; updateGuide(); } }).catch(e => { state.graphError = e.message; });
  state.booths = bd.booths.filter(b => b.lat != null).map(FoodSearch.prepare);
  state.booths.filter(b => b.food || b.kind === 'newfood').forEach(b => boothMarker(b).addTo(boothLayer));
  state.booths.filter(b => b.drinks).forEach(b => L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: 8, color: '#000', weight: 2, fillColor: '#00b3ff', fillOpacity: 1 }).bindPopup(() => popupHtml(b)).addTo(drinkLayer));
  if (ad) {
    state.atms = ad.atms;
    const icon = L.divIcon({ className: '', html: '<div class="atmIcon">$</div>', iconSize: [30, 30] });
    ad.atms.forEach(a => L.marker([a.lat, a.lon], { icon, keyboard: false }).bindPopup(`<b>ATM</b> <span class="badge approx">approx. location</span><br><small>Position of the ATM icon on the fair’s published grounds map, so it may be off by 10–30 m.</small><div class="popBtns"><button class="go" data-id="${a.id}">➜ Guide me here</button><button class="shareBooth" type="button" aria-label="Share this ATM">${SHARE_ICO}<span>Share</span></button></div>`).addTo(atmLayer));
  }
  const nF = state.booths.filter(b => b.food || b.kind === 'newfood').length;
  setStatus(`${nF} food booths loaded`);
  buildAbout(bd, ad);
  applyUrl(true);
}
function applyUrl(initial) {
  const p = urlParams();
  const q = p.get('q'), booth = p.get('booth'), ll = p.get('ll'), z = +p.get('z');
  if (p.get('new') === '1') runSearch(true, true);
  else if (q) { $('q').value = q; runSearch(false, true); }
  else if (!initial) { $('q').value = ''; clearResults(); }
  const id = parseBoothId(booth);
  if (id && booth !== id) setUrl({ booth: id }); // tidy links mangled by chat apps (trailing '.', ')', spaces, case)
  if (id && findTarget(id)) {
    let saved = null; try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] || {}).type;
    state.fromLink = initial && saved !== id && nav !== 'reload' && nav !== 'back_forward'; // a link someone sent, not our own resume
    startGuide(id, false, true);
  }
  else if (!initial && state.target) stopGuide(true);
  else if (initial) {
    let saved = null; try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    if (saved && findTarget(saved)) { startGuide(saved, true, true); setUrl({ booth: saved }); }
    else if (ll && z) { const [a, b] = ll.split(',').map(Number); if (!isNaN(a) && !isNaN(b)) map.setView([a, b], Math.min(21, Math.max(14, z))); }
  }
}
window.addEventListener('popstate', () => applyUrl(false));
// Booth ids are L<layer>-<objectid> or atm<n>. Accept them anywhere in the value so 'L0-1387.', 'L0-1387)', 'l0-1387 ' still work.
function parseBoothId(v) {
  if (!v) return null;
  const mm = String(v).match(/meet_(-?\d{1,3}\.\d{3,7})_(-?\d{1,3}\.\d{3,7})/); if (mm) return 'meet_' + mm[1] + '_' + mm[2];
  const m = String(v).match(/\b(L\d-\d+|atm\d+)/i); if (!m) return null;
  return /^l/i.test(m[1]) ? 'L' + m[1].slice(1) : m[1].toLowerCase();
}
function urlBoothId() { return parseBoothId(urlParams().get('booth')); }

function buildAbout(bd, ad) {
  const c = bd.counts;
  $('aboutBody').innerHTML = `<p class="disc"><b>${esc(L_.disc_t)}</b></p><p>${L_.disc}</p>
  <h3>Accuracy</h3><p>${L_.acc}</p>
  <p><b>${state.booths.length}</b> booths from the fair’s published booth data (Food &amp; Ride Finder: ${c.vendor} vendors, ${c.newfood} “New Foods 2026” entries, ${c.sponsor} sponsor booths). Booth positions are the fair’s published map points. Data generated ${esc(bd.generated)}.</p>
  <p><b>ATMs:</b> ${ad ? ad.atms.length + ' read from the ATM icons on the fair’s published grounds map, so their positions are <b>approximate</b>.' : 'not loaded'}</p>
  <p><b>Drinks:</b> booths whose fair listing mentions drinks (lemonade, tea, soda, water…). The fair publishes no separate drink-station or water-refill layer.</p>
  <p><b>Walking routes:</b> computed on your phone over OpenStreetMap footways and service roads inside the fairgrounds, with buildings and the pond as obstacles. OSM shows the permanent grounds, not this year’s temporary booths, so routes are <b>approximate</b>.</p>
  <h3>Privacy</h3><p>${L_.priv}</p>
  <h3>Credits</h3>${L_.cred}
  <h3>Sources</h3><ul>${bd.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>
  <p><a href="about/">About Fair Finder</a></p>`;
}
$('aboutLink').onclick = e => { e.preventDefault(); $('layersPanel').classList.add('hidden'); $('about').classList.remove('hidden'); };

// ---------- Location ----------
function setStatus(t) { $('status').textContent = t; }
// Light 2-D Kalman-style smoothing: every fix is USED (no accuracy cut-off; 50–150 ft is normal at the fair),
// a poor fix just moves the estimate less. Position uncertainty grows with time at walking speed.
function fuse(lat, lon, acc) {
  const now = Date.now(), f = state.fused;
  if (!f || now - f.t > 15000 || acc < 8) { state.fused = { lat, lon, v: acc * acc, t: now }; return [lat, lon]; }
  const dt = (now - f.t) / 1000, vPrev = f.v + (2.5 * dt) ** 2, k = vPrev / (vPrev + acc * acc);
  f.lat += k * (lat - f.lat); f.lon += k * (lon - f.lon); f.v = (1 - k) * vPrev; f.t = now;
  return [f.lat, f.lon];
}
function onPos(p) {
  const { latitude: lat, longitude: lon, accuracy, heading, speed } = p.coords;
  state.raw = [lat, lon]; state.me = fuse(lat, lon, accuracy); state.acc = accuracy;
  state.fixCount = (state.fixCount || 0) + 1; state.lastFixAt = Date.now(); state.watchRestartsSinceFix = 0;
  if (heading != null && !isNaN(heading) && speed != null && speed > 0.7) { state.gpsHeading = heading; state.gpsHeadingAt = Date.now(); }
  if (!meMarker) {
    meMarker = L.marker(state.me, { icon: L.divIcon({ className: 'meIconWrap', html: '<div class="me" id="meDot"><div class="meBeam" id="meBeam"></div><div class="mePulse" id="mePulse"></div><div class="meCore"></div></div>', iconSize: [120, 120], iconAnchor: [60, 60] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(state.me, { radius: accuracy, color: '#1a73e8', weight: 1.5, opacity: 0.5, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
    if (FAIR_BOUNDS.pad(0.5).contains(state.me) && !state.target) map.setView(state.me, 18);
  } else { meMarker.setLatLng(state.me); accCircle.setLatLng(state.me).setRadius(accuracy); }
  blip();
  state.meAt = Date.now(); state.gpsError = null; refreshWalk();
  setStatus(`GPS ±${Math.round(accuracy * 3.28084)} ft`);
  // Refresh distances in the list WITHOUT touching guide visibility or the map view.
  if (state.results.length) renderResults(false, true);
  updateGuide(); meStyle();
}
// Map "you" marker: blue dot, pulse ring that blips on each fix, compass beam, grey when stale.
function blip() { const el = document.getElementById('mePulse'); if (!el) return; el.classList.remove('blip'); void el.offsetWidth; el.classList.add('blip'); }
function meStyle() {
  const d = document.getElementById('meDot'); if (!d) return;
  const stale = Date.now() - (state.lastFixAt || 0) > 20000; d.classList.toggle('stale', stale);
  const hd = currentHeading(), beam = document.getElementById('meBeam');
  if (hd.h == null || hd.src === 'north') { beam.style.opacity = '0'; return; }
  // unwrap so the CSS transition always takes the short way round
  const prev = state._beamDeg == null ? hd.h : state._beamDeg, delta = ((hd.h - (prev % 360) + 540) % 360) - 180;
  state._beamDeg = prev + delta; beam.style.transform = `rotate(${state._beamDeg}deg)`; beam.style.opacity = stale || hd.stale ? '0.35' : '1';
}
function onPosErr(e) {
  state.gpsError = e.message || String(e.code); state.gpsDenied = e.code === 1; state.lastErrAt = Date.now(); state.errCount = (state.errCount || 0) + 1;
  updateGuide(); setStatus(e.code === 1 ? 'Location blocked: allow it in Settings › Safari › Location' : 'Waiting for GPS… (' + e.message + ')');
  // iOS Safari often stops delivering after an error/timeout: restart the watch (not for a permission denial).
  if (e.code !== 1) restartSoon('error ' + e.code);
}
let watchId = null, restartT = null;
function restartSoon(why) { clearTimeout(restartT); restartT = setTimeout(() => startWatch(why), 1000); }
function startWatch(why) {
  if (!('geolocation' in navigator)) return setStatus('This browser has no geolocation');
  const g = navigator.geolocation;
  if (watchId != null) { try { g.clearWatch(watchId); } catch (e) {} watchId = null; }
  state.watchStarts = (state.watchStarts || 0) + 1; state.watchStartedAt = Date.now(); state.lastRestartWhy = why || 'start';
  // maximumAge small so we never get a cached fix; timeout bounds each attempt, and an error restarts the watch.
  watchId = g.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  // Kick: a one-shot request often wakes a stalled iOS location stream.
  if (why && why !== 'start') { state.kicks = (state.kicks || 0) + 1; try { g.getCurrentPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }); } catch (e) {} }
}
function stopWatch() { if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; } }
// Watchdog: no fix for > 12 s while visible -> restart + kick (backs off to every 30 s after repeated tries).
setInterval(() => {
  meStyle();
  if (document.visibilityState !== 'visible' || state.gpsDenied) return;
  const now = Date.now(), last = Math.max(state.lastFixAt || 0, state.watchStartedAt || 0);
  const wait = (state.watchRestartsSinceFix || 0) >= 4 ? 30000 : 12000;
  if (now - last > wait) { state.watchRestartsSinceFix = (state.watchRestartsSinceFix || 0) + 1; startWatch('watchdog'); }
}, 2000);
$('btnGpsRefresh').onclick = () => { state.gpsDenied = false; state.watchRestartsSinceFix = 0; startWatch('user'); toast('Refreshing location…'); };
startWatch();
// If location was denied and later allowed (Settings, or the permission prompt answered late), pick it up without a reload.
try { navigator.permissions && navigator.permissions.query({ name: 'geolocation' }).then(st => { st.onchange = () => { if (st.state !== 'denied') { state.gpsDenied = false; startWatch(); } }; }).catch(() => {}); } catch (e) {}
$('btnLocate').onclick = () => { if (state.me) return map.setView(state.me, Math.max(map.getZoom(), 18)); setStatus(state.gpsDenied ? 'Asking for location again…' : 'No GPS fix yet'); startWatch(); };

// ---------- Search ----------
let tmr;
$('q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(runSearch, 180); });
$('searchForm').onsubmit = e => { e.preventDefault(); runSearch(); $('q').blur(); };
$('clearQ').onclick = () => { $('q').value = ''; clearResults(); };
document.querySelectorAll('.chip').forEach(c => c.onclick = () => { $('q').value = c.dataset.q === 'new' ? '' : c.dataset.q; runSearch(c.dataset.q === 'new'); });
$('closeResults').onclick = clearResults;
function clearResults() { state.results = []; hitLayer.clearLayers(); $('results').classList.add('hidden'); setUrl({ q: null, new: null }); }
$('q').addEventListener('focus', () => document.body.classList.add('typing'));
$('q').addEventListener('blur', () => document.body.classList.remove('typing'));
function dist(b) {
  if (!state.me) return null;
  const w = walkDist(b); if (w != null) return w;
  return Geo.distanceM(state.me[0], state.me[1], b.lat, b.lon);
}
// Walking distance via one Dijkstra from the user's snapped position (recomputed when the user moves > 8 m).
function refreshWalk(force) {
  const g = state.graph; if (!g || !state.me) return;
  if (!force && state.walkFrom && Geo.distanceM(state.walkFrom[0], state.walkFrom[1], state.me[0], state.me[1]) < 8) return;
  const s = g.snap(state.me[0], state.me[1], 80);
  state.walkFrom = state.me.slice();
  if (!s) { state.dj = null; state.snapMe = null; return; }
  state.snapMe = s; state.dj = g.dijkstra(s);
}
function walkDist(b) {
  const g = state.graph; if (!g || !state.dj) return null;
  if (b._snap === undefined) b._snap = g.snap(b.lat, b.lon, 80);
  if (!b._snap) return null;
  const w = g.walkLen(state.dj, state.snapMe, b._snap);
  return isFinite(w) ? w : null;
}
function runSearch(newOnly, fromUrl) {
  const q = $('q').value.trim();
  if (!fromUrl) setUrl(newOnly === true ? { q: null, new: '1' } : { q: q.length >= 2 ? q : null, new: null });
  if (newOnly === true) state.results = state.booths.filter(b => b.kind === 'newfood').map(b => ({ booth: b, score: 1, matched: b.newFood ? [b.newFood.name] : [] }));
  else if (q.length < 2) return clearResults();
  else state.results = FoodSearch.search(state.booths, q);
  state.query = newOnly === true ? 'New foods 2026' : q;
  renderResults(true);
}
function renderResults(fit, quiet) {
  const rs = state.results;
  refreshWalk();
  rs.forEach(r => { r.d = dist(r.booth); r.walk = state.dj && r.d != null && walkDist(r.booth) != null; r.tier = r.score >= 0.85 ? 0 : 1; });
  rs.sort((a, b) => a.tier - b.tier || (a.d != null && b.d != null ? a.d - b.d : b.score - a.score));
  hitLayer.clearLayers();
  rs.forEach(r => boothMarker(r.booth, 'hit').addTo(hitLayer));
  $('resCount').textContent = rs.length ? `${rs.length} for “${state.query}”${state.me ? (state.dj ? ', nearest walk first' : ', nearest first') : ''}` : `No booths list “${state.query}”`;
  const hl = (s) => esc(s);
  $('resList').innerHTML = rs.slice(0, 80).map((r, i) => {
    const b = r.booth, items = (r.matched.length ? r.matched : (b.items || [])).slice(0, 4);
    return `<li data-id="${esc(b.id)}" data-i="${i}">
      <div class="r-top"><span class="r-name">${esc(b.name)}</span><span class="r-dist">${r.d != null ? (r.walk ? '🚶 ' : '') + Geo.fmtFeet(r.d) : ''}</span><button class="rShare" type="button" data-share="${esc(b.id)}" aria-label="Share ${esc(b.name)}">${SHARE_ICO}<span>Share</span></button></div>
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
$('resList').onclick = e => { const sb = e.target.closest('[data-share]'); if (sb) { e.stopPropagation(); share(findTarget(sb.dataset.share)); return; } const li = e.target.closest('li'); if (li) startGuide(li.dataset.id); };
// Share where I am: a link that guides a friend to my current GPS position.
function myspotId() { return state.me ? `meet_${state.me[0].toFixed(5)}_${state.me[1].toFixed(5)}` : null; }
$('btnShareMe').onclick = () => { const id = myspotId(); if (!id) { toast(state.gpsDenied ? 'Allow location first' : 'Waiting for GPS…'); return; } share(findTarget(id)); };

// ---------- Guide ----------
function findTarget(id) {
  const mt = /^meet_(-?\d+\.\d+)_(-?\d+\.\d+)$/.exec(id || '');
  if (mt) { const lat = +mt[1], lon = +mt[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { id, meet: true, name: '📍 Shared spot', lat, lon, location: 'approximate', area: 'A friend’s shared GPS position', products: '' }; }
  const b = state.booths.find(x => x.id === id); if (b) return b;
  const a = state.atms.find(x => x.id === id); if (a) return { id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, location: 'approximate', area: 'From the fair’s published grounds map', products: '' };
}
function startGuide(id, resume, fromUrl) {
  const t = findTarget(id); if (!t) return;
  const prev = state.target && state.target.id;
  state.target = t; state.arrivedShown = false; if (prev !== id) state.route = null;
  if (!fromUrl && prev !== id) setUrl({ booth: id }, true); // pushState so Back returns to the list/map
  document.title = `${t.name} · Fair Finder`;
  try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  $('results').classList.add('hidden'); $('guide').classList.remove('hidden');
  document.body.classList.add('guiding');
  requestWake();
  $('guideName').textContent = t.name;
  $('guideMenuBody').textContent = (t.newFood ? 'NEW: ' + t.newFood.name + ': ' + t.newFood.description + ' | ' : '') + (t.products || '(no menu listed)');
  $('guideMenu').style.visibility = t.products ? 'visible' : 'hidden';
  $('guideMenu').scrollTop = 0;
  compassUi();
  // Opened from a shared link: show the full booth card once (name, menu, Share) without changing the saved preference.
  if (fromUrl && state.fromLink) { state.fromLink = false; sheet.state = 'expanded'; }
  sheet.show();
  state.fittedRouteAt = null;
  const pts = [[t.lat, t.lon]]; if (state.me) pts.push(state.me);
  if (!resume || pts.length > 1) fitGuideView(true, pts);
  updateGuide();
}
// The ONLY way guide mode ends: the explicit Stop button.
function stopGuide(fromUrl) {
  routeLine.setLatLngs([]); routeCasing.setLatLngs([]); state.route = null; state._drawn = null;
  if (!fromUrl) setUrl({ booth: null });
  document.title = BASE_TITLE;
  state.target = null; state.guide = null; guideLine.setLatLngs([]);
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  sheet.hide(); document.body.classList.remove('guiding');
  releaseWake();
  if (state.results.length) $('results').classList.remove('hidden');
}
$('closeGuide').onclick = () => stopGuide();
$('btnShare').onclick = () => share(state.target);
$('btnShareBar').onclick = e => { e.stopPropagation(); share(state.target); };
$('btnShareList').onclick = () => share(null);
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
  const meta = `${t.area || ''}${t.lot ? ' · ' + t.lot : ''}${t.location !== 'exact' ? ' · approximate location' : ' · fair’s published booth data'}`;
  $('guideMeta2').textContent = meta;
  $('guide').classList.remove('hidden'); document.body.classList.add('guiding'); // guide never hides itself
  $('guide').classList.toggle('noloc', !state.me && !!state.gpsDenied);
  if (!state.me && state.gpsDenied) {
    $('guideDist').textContent = 'Location off'; $('guideHint').textContent = 'Here is the booth on the map. Allow location (tap ◎) for directions.'; $('guideMeta').textContent = 'Location off'; $('guideUpd').textContent = '';
    if (!state.shownNoLoc) { state.shownNoLoc = true; map.setView([t.lat, t.lon], 19); }
    return;
  }
  if (!state.me) { $('guideDist').textContent = '—'; $('guideHint').textContent = 'Waiting for your GPS position…'; $('guideMeta').textContent = 'GPS: waiting for a fix'; $('guideUpd').textContent = 'updating…'; return; }
  const d = Geo.distanceM(state.me[0], state.me[1], t.lat, t.lon);
  let br = Geo.bearingDeg(state.me[0], state.me[1], t.lat, t.lon);
  const { h, src } = currentHeading();
  // ---- walking route ----
  const R = ensureRoute(t);
  let mode = 'straight', remaining = d, turn = null, offRoute = null, look = null;
  if (R && d > 15) {
    const pr = Route.projectNear(R.points, state.me, R.lastAlong); R.lastAlong = pr.along; offRoute = pr.d;
    mode = 'route'; remaining = Math.max(0, R.lengthM - pr.along) + pr.d;
    turn = Route.nextTurn(R.points, pr.along);
    if (turn && turn.inM > R.lengthM - pr.along - 8) turn = null;
    // Look-ahead point: 18 m along the route, but never past the next corner (+4 m), so the arrow
    // and the turn hint always describe the same leg of the route.
    const ahead = turn ? Math.min(18, Math.max(8, turn.inM + 4)) : 18;
    look = Route.pointAt(R.points, pr.along + ahead);
    if (Route.dist(state.me, look) > 2) br = Geo.bearingDeg(state.me[0], state.me[1], look[0], look[1]);
  }
  const rot = h == null ? br : Geo.relativeDeg(br, h);
  state.guide = { distanceM: d, bearing: br, heading: h, headingSource: src, arrowRotation: rot, mode, remainingM: remaining, offRouteM: offRoute, lookahead: look, turn, reroutes: state.reroutes || 0 };
  $('arrow').style.transform = `rotate(${rot}deg)`; $('miniArrow').style.transform = `rotate(${rot}deg)`;
  $('northTag').style.visibility = h == null ? 'visible' : 'hidden'; $('miniNorth').style.visibility = h == null ? 'visible' : 'hidden';
  const mins = Math.max(1, Math.round(remaining / 1.1 / 60)); // ~1.1 m/s walking in fair crowds
  $('guideDist').textContent = mode === 'route' ? `${Geo.fmtFeet(remaining)} walk` : Geo.fmtFeet(d);
  $('guideRoute').textContent = mode === 'route' ? `~${mins} min walking · route is approximate (OSM paths, not this year's booth layout)` : (state.graph ? 'Straight-line arrow: no walking route found here' : 'Straight-line arrow (walking routes loading…)');
  $('guideRoute').className = mode === 'route' ? 'route' : 'straight';
  const arrived = d <= 15;
  $('guide').classList.toggle('arrived', arrived);
  let hintTxt = Geo.hint(d, br, h);
  if (mode === 'route') hintTxt = routeHint(br, h, turn, remaining);
  else if (state.graph) hintTxt = 'Straight line: ' + hintTxt;
  if (arrived) hintTxt = '✅ Arrived: it should be right around you';
  state.guide.hint = hintTxt;
  $('guideHint').textContent = hintTxt;
  const gpsAge = Date.now() - (state.meAt || 0), hd = currentHeading();
  const upd = [];
  const paused = state.meAt && gpsAge > 20000;
  if (paused) upd.push('Location paused (last fix ' + Math.round(gpsAge / 1000) + 's ago)');
  else if (gpsAge > 10000 || state.gpsError) upd.push('GPS updating… (last fix ' + Math.round(gpsAge / 1000) + 's ago)');
  $('btnGpsRefresh').classList.toggle('show', !!paused); state.guide.paused = !!paused;
  if (hd.stale) upd.push('compass updating…');
  state.guide.arrived = arrived; state.guide.stale = upd.length > 0;
  if (src === 'compass' && state.compassAcc != null && state.compassAcc > 30) upd.push('compass inaccurate: wave phone in a figure 8');
  $('guideUpd').textContent = upd.join(' · ');
  // Heading source, then the GPS accuracy radius from the current fix (coords.accuracy, metres → ft).
  const hs = src === 'compass' ? 'compass' + (state.compassAcc != null && state.compassAcc >= 0 ? ` ±${Math.round(state.compassAcc)}°` : '') + (hd.stale ? ' (stale)' : '')
    : src === 'gps' ? 'GPS walking direction' + (hd.stale ? ' (stale)' : '') : 'none, arrow is north-up';
  $('guideMeta').textContent = `Heading: ${hs} · GPS ±${Math.round(Geo.feet(state.acc || 0))} ft` + (offRoute != null && offRoute > 6 ? ` · ${Math.round(Geo.feet(offRoute))} ft from route` : '');
  state.guide.metaText = $('guideMeta').textContent;
  const drawKey = mode === 'route' ? 'r' + R.at : 's' + state.me.join(',') + t.id;
  if (state._drawn !== drawKey) {
    state._drawn = drawKey;
    if (mode === 'route') { routeLine.setLatLngs(R.points); routeCasing.setLatLngs(R.points); guideLine.setLatLngs([]); }
    else { routeLine.setLatLngs([]); routeCasing.setLatLngs([]); guideLine.setLatLngs([state.me, [t.lat, t.lon]]); }
  }
  // When collapsed, fit each new route (and you) into the visible map above the bar, once per route.
  if (mode === 'route' && sheet.state === 'collapsed' && state.fittedRouteAt !== R.at) { state.fittedRouteAt = R.at; fitGuideView(false); }
}
// One wording source for the hint, derived from the SAME bearing the arrow shows (br), so they can't disagree.
function routeHint(br, h, turn, remaining) {
  const ahead = turn ? (turn.inM < 9 ? cap(Route.turnWord(turn.turnDeg)) + ' now' : `In ${Geo.fmtFeet(turn.inM)}, ${Route.turnWord(turn.turnDeg)}`) : `Straight on for ${Geo.fmtFeet(remaining)}`;
  if (h == null) return `Head ${Geo.compassWord(br)} · ${ahead.charAt(0).toLowerCase() + ahead.slice(1)}`;
  const rel = Geo.relativeDeg(br, h), side = rel < 0 ? 'left' : 'right';
  if (Math.abs(rel) > 120) return 'Turn around: the route is behind you';
  if (Math.abs(rel) > 50) return `Turn ${side} to face the arrow`;
  return ahead;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
let userMovedAt = 0; map.on('dragstart', () => { userMovedAt = Date.now(); });
// Fit route + you (or given points) into the map area that is actually visible above the sheet.
function fitGuideView(force, pts) {
  if (!force && Date.now() - userMovedAt < 20000) return; // don't fight a user who is panning
  const t = state.target; if (!t) return;
  const R = state.route && state.route.targetId === t.id ? state.route : null;
  const all = pts || (R ? R.points.concat(state.me ? [state.me] : []) : [[t.lat, t.lon]].concat(state.me ? [state.me] : []));
  map.invalidateSize({ pan: false });
  map.fitBounds(L.latLngBounds(all), { maxZoom: 19, paddingTopLeft: [24, 150], paddingBottomRight: [80, 24] });
}
setInterval(updateGuide, 1000);
// Route cache with automatic reroute when > 25 m off the route (only on a decent GPS fix, at most every 3 s).
function ensureRoute(t) {
  const g = state.graph; if (!g || !state.me) return null;
  const now = Date.now();
  let R = state.route && state.route.targetId === t.id ? state.route : null;
  if (R) {
    const off = Route.project(R.points, state.me).d;
    if (off > 25 && (state.acc || 0) < 40 && now - R.at > 3000) { R = null; state.reroutes = (state.reroutes || 0) + 1; }
  }
  if (!R) {
    if (state.routeFailAt && state.routeFailFor === t.id && now - state.routeFailAt < 5000) return null;
    const r = g.route(state.me, [t.lat, t.lon], { maxSnap: 80 });
    if (!r) { state.route = null; state.routeFailAt = now; state.routeFailFor = t.id; return null; }
    R = state.route = { ...r, targetId: t.id, at: now };
  }
  return R;
}

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
  if (typeof e.webkitCompassAccuracy === 'number') state.compassAcc = e.webkitCompassAccuracy;
  if (!state._cui) { state._cui = true; compassUi(); }
  if (!state._lastG || Date.now() - state._lastG > 150) { state._lastG = Date.now(); updateGuide(); meStyle(); }
}
function startCompass() {
  window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient);
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
  window.addEventListener('deviceorientation', onOrient);
  state.compassListening = true;
}
function compassUi() {
  const v = state.compassOn ? 'hidden' : 'visible';
  $('btnCompass').style.visibility = v; $('btnCompassMini').style.visibility = v;
  $('btnShareBar').style.visibility = state.compassOn ? 'visible' : 'hidden'; // same slot: compass until enabled, then Share
}
$('btnCompassMini').onclick = e => { e.stopPropagation(); $('btnCompass').onclick(); };
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

// ---------- Guide sheet (non-modal bottom sheet, 2 snap points) ----------
// Fixed height; only transform changes, so nothing inside reflows when it slides or when the hint text changes.
const SHEET_KEY = 'ff.sheet';
const sheet = {
  el: $('guide'), bar: $('sheetBar'), more: $('guideMore'), visible: false,
  state: (() => { try { return localStorage.getItem(SHEET_KEY) === 'expanded' ? 'expanded' : 'collapsed'; } catch (e) { return 'collapsed'; } })(),
  heights() {
    if (this._sb == null) { const p = document.createElement('div'); p.style.cssText = 'position:fixed;visibility:hidden;height:env(safe-area-inset-bottom,0px)'; document.body.appendChild(p); this._sb = p.offsetHeight || 0; p.remove(); }
    const mini = 104 + this._sb, full = Math.round(Math.min(480 + this._sb, Math.max(mini + 260, window.innerHeight * 0.7)));
    return { full, mini };
  },
  offset(st) { const { full, mini } = this.heights(); return st === 'expanded' ? 0 : full - mini; },
  layout(anim) {
    const { full, mini } = this.heights(), root = document.documentElement.style;
    root.setProperty('--sheetFull', full + 'px'); root.setProperty('--sheetMini', mini + 'px');
    root.setProperty('--sheetVis', (this.visible ? (this.state === 'expanded' ? full : mini) : 0) + 'px');
    this.el.classList.toggle('no-anim', !anim);
    this.el.style.transform = `translate3d(0,${this.visible ? this.offset(this.state) : full + 20}px,0)`;
    this.el.dataset.snap = this.state;
    const exp = this.state === 'expanded';
    this.bar.setAttribute('aria-expanded', String(exp));
    this.bar.setAttribute('aria-label', exp ? 'Collapse guide panel' : 'Expand guide panel');
    if (exp) { this.more.removeAttribute('inert'); this.more.removeAttribute('aria-hidden'); }
    else { this.more.setAttribute('inert', ''); this.more.setAttribute('aria-hidden', 'true'); }
    clearTimeout(this._inv); this._inv = setTimeout(() => { map.invalidateSize({ pan: false }); }, 260);
  },
  set(st, anim = true) {
    this.state = st; try { localStorage.setItem(SHEET_KEY, st); } catch (e) {}
    this.layout(anim);
    if (st === 'collapsed' && state.target) setTimeout(() => fitGuideView(false), 280);
  },
  toggle() { this.set(this.state === 'expanded' ? 'collapsed' : 'expanded'); },
  show() { const was = this.visible; this.visible = true; this.el.classList.remove('hidden'); if (!was) { this.layout(false); requestAnimationFrame(() => this.layout(true)); } else this.layout(true); },
  hide() { this.visible = false; this.layout(true); setTimeout(() => { if (!this.visible) this.el.classList.add('hidden'); }, 260); },
};
(function sheetDrag() {
  const bar = sheet.bar; let st = null;
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    st = { y: e.clientY, t: performance.now(), base: sheet.offset(sheet.state), moved: false, id: e.pointerId, lastY: e.clientY, lastT: performance.now(), v: 0 };
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
  });
  bar.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const dy = e.clientY - st.y; if (Math.abs(dy) > 6) st.moved = true;
    if (!st.moved) return;
    const now = performance.now(); st.v = (e.clientY - st.lastY) / Math.max(1, now - st.lastT); st.lastY = e.clientY; st.lastT = now;
    const max = sheet.offset('collapsed'), y = Math.max(0, Math.min(max, st.base + dy));
    sheet.el.classList.add('no-anim'); sheet.el.style.transform = `translate3d(0,${y}px,0)`;
  });
  const end = e => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.moved) return sheet.toggle();
    const max = sheet.offset('collapsed'), y = Math.max(0, Math.min(max, s.base + (e.clientY - s.y)));
    sheet.set(Math.abs(s.v) > 0.4 ? (s.v > 0 ? 'collapsed' : 'expanded') : (y > max / 2 ? 'collapsed' : 'expanded'));
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', e => { if (st && e.pointerId === st.id) { st = null; sheet.layout(true); } });
  bar.addEventListener('keydown', e => {
    if (e.target !== bar) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.toggle(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sheet.set('expanded'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sheet.set('collapsed'); }
  });
  window.addEventListener('resize', () => { if (sheet.visible) sheet.layout(false); });
})();
window.__ffSheet = sheet;
window.__ffLL = ll => { const q = map.latLngToContainerPoint(ll), r = map.getContainer().getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; };

// ---------- Wake lock & lifecycle ----------
let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
function onResume(why) {
  // iOS suspends geolocation/orientation while locked or in another app: re-acquire, keep guide mode as-is.
  startWatch(why || 'resume');
  if (state.compassListening || state.compassGranted) startCompass();
  if (state.target) { requestWake(); sheet.show(); updateGuide(); }
  state.resumeCount = (state.resumeCount || 0) + 1;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onResume('visible'); else stopWatch(); });
window.addEventListener('pageshow', e => { if (e.persisted) onResume('pageshow'); });
window.addEventListener('pagehide', () => stopWatch());
window.addEventListener('focus', () => { if (state.target && !wakeLock) requestWake(); if (Date.now() - (state.lastFixAt || 0) > 5000) startWatch('focus'); });
window.addEventListener('online', () => startWatch('online'));

// ---------- Offline ----------
function tileList() {
  const urls = [];
  const lonToX = (lon, n) => Math.floor((lon + 180) / 360 * n), latToY = (lat, n) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const b = FAIR_BOUNDS;
  for (let lvl = 14; lvl <= 19; lvl++) { const n = 2 ** lvl; for (let x = lonToX(b.getWest(), n); x <= lonToX(b.getEast(), n); x++) for (let y = latToY(b.getNorth(), n); y <= latToY(b.getSouth(), n); y++) urls.push(FAIR_TILES.replace('{z}', lvl).replace('{y}', y).replace('{x}', x)); }
  // Only the fair's grounds-map tiles are saved. Esri imagery and OSM tiles are never bulk-downloaded (their terms forbid it).
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
  navigator.serviceWorker.register('sw.js?v=71', { updateViaCache: 'none' }).then(r => r.update && r.update()).catch(() => {});
}

loadData().catch(e => setStatus('Could not load booth data: ' + e.message));
})();
