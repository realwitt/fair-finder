/* Fair Finder – NC State Fair 2026 */
(() => {
'use strict';
const FAIR_TILES = 'https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer/tile/{z}/{y}/{x}';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Fair's published grounds-map tile layer full extent (EPSG:3857) converted to lat/lon
const FAIR_BOUNDS = L.latLngBounds([35.79119, -78.72134], [35.79952, -78.70469]);
const CENTER = [35.7948, -78.7115];
const APP_VERSION = 'v7.9 · Oct 17';
const $ = id => document.getElementById(id);
const LS_KEY = 'ff.guideTarget';
const FAV_KEY = 'ff.favorites.v1';
const MAP_BEARING = 0;
function loadFavs() { try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; } catch (e) { return []; } }
function saveFavs(ids) { try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch (e) {} }
const state = { me: null, acc: null, gpsHeading: null, compass: null, compassAt: 0, target: null, booths: [], rides: [], atms: [], amenities: [], results: [], query: '', favs: [], nearType: 'all', pendingNearest: null, popular: new Set(), panelMode: 'chips', topBooths: [], topSearches: [] };
state.favs = loadFavs();
state.heading = Heading.create();
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
const rideLayer = L.layerGroup().addTo(map);
const atmLayer = L.layerGroup(), drinkLayer = L.layerGroup(), amenityLayer = L.layerGroup();
const rideIcon = L.divIcon({ className: '', html: '<div class="rideIcon">🎡</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
const rideHitIcon = L.divIcon({ className: '', html: '<div class="rideIcon hit">🎡</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
const POP = { maxWidth: 300, autoPanPaddingTopLeft: [10, 170], autoPanPaddingBottomRight: [10, 20] };
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
$('tglRides').onchange = e => e.target.checked ? rideLayer.addTo(map) : map.removeLayer(rideLayer);
$('tglATM').onchange = e => e.target.checked ? atmLayer.addTo(map) : map.removeLayer(atmLayer);
$('tglAmenities').onchange = e => e.target.checked ? amenityLayer.addTo(map) : map.removeLayer(amenityLayer);
$('tglDrinks').onchange = e => e.target.checked ? drinkLayer.addTo(map) : map.removeLayer(drinkLayer);
const tglStats = $('tglStats');
if (tglStats) {
  try { tglStats.checked = localStorage.getItem('ff.statsOptOut') !== '1'; } catch (e) {}
  tglStats.onchange = () => {
    try {
      if (tglStats.checked) localStorage.removeItem('ff.statsOptOut');
      else localStorage.setItem('ff.statsOptOut', '1');
    } catch (e) {}
    syncStatsNote();
  };
}
function dismissStatsNote() {
  const el = $('statsNote');
  if (el) { el.classList.add('hidden'); clearTimeout(el._t); }
  try { localStorage.setItem('ff.statsNoteSeen', '1'); } catch (e) {}
}
function syncStatsNote() {
  const el = $('statsNote');
  if (!el) return;
  let seen = false, on = true;
  try { seen = localStorage.getItem('ff.statsNoteSeen') === '1'; on = localStorage.getItem('ff.statsOptOut') !== '1'; } catch (e) { seen = true; }
  if (seen || !on) { el.classList.add('hidden'); clearTimeout(el._t); return; }
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(dismissStatsNote, 12000);
}
const statsNoteOk = $('statsNoteOk'), statsNoteSettings = $('statsNoteSettings');
if (statsNoteOk) statsNoteOk.onclick = () => dismissStatsNote();
if (statsNoteSettings) statsNoteSettings.onclick = e => {
  e.preventDefault();
  $('layersPanel').classList.remove('hidden');
};
syncStatsNote();

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
  // Results-header Share: q= only (or new=1). Never booth, ll, or z.
  const p = new URLSearchParams();
  if (state.query === 'New foods 2026') p.set('new', '1');
  else {
    const qq = ($('q').value || '').trim();
    if (qq) p.set('q', qq);
  }
  const qs = p.toString();
  return root + (qs ? '?' + qs : '');
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
const L_ = {"disc_t": "Unofficial guide", "disc": "Fair Finder is an independent, free project. It is not affiliated with, endorsed by, or sponsored by the N.C. State Fair or the N.C. Department of Agriculture &amp; Consumer Services. ‘N.C. State Fair’ is used only to describe the event this guide covers. For official information, see <a href=\"https://www.ncstatefair.org/\" target=\"_blank\" rel=\"noopener\">ncstatefair.org</a>.", "acc": "Booth locations and menus come from the fair’s published data and may change during the fair. ATM locations are approximate. Walking routes come from OpenStreetMap and don’t reflect temporary booths, closures or crowds. Follow posted signs and staff directions; use at your own risk. Provided as-is, with no warranty.", "priv": "Your location is used only on your device to show where you are and guide you. It is never sent to us or stored on a server. Unless you opt out, the app sends a random device id created on this device (the server stores only a salted hash of it), the booth id when your GPS shows you arriving within about 50 ft of a booth, and the food chip or booth you pick (never what you type). Your IP address is used only as a salted, daily-rotated hash for rate limiting; raw IP addresses are not stored, and those rate-limit rows are deleted in about 2 hours. Visit and tap rows are deleted after 3 days. A booth or search appears only after at least 5 different devices. No accounts, no ads, no tracking cookies. The app saves the booth you’re guiding to in your browser so it can resume, and whether the guide panel was open. Favorites are stored only on this device (localStorage) and are never sent anywhere. Opt out in the Layers panel, or clear this site's data in your browser (which also resets the device id). The site is hosted on GitHub Pages, which logs visitor IP addresses for security. Map images load from OpenStreetMap, Esri and the fair’s ArcGIS server, which see normal web requests. The optional AI connector (MCP server, hosted on Cloudflare Workers) serves only the same public booth and ride data and is read-only: no accounts, and no logging of what you search. To limit abuse it counts requests per minute using a salted, one-way hash of your IP address; raw IP addresses are not stored. The visit/tap counter also runs on Cloudflare Workers, so Cloudflare sees normal web requests to it.", "cred": "<ul class=\"credits\"><li>Map data <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">© OpenStreetMap</a> contributors</li><li>Routes: OpenStreetMap data (ODbL) · <a href=\"https://www.openstreetmap.org/fixthemap\" target=\"_blank\" rel=\"noopener\">Report a map issue</a></li><li>Grounds map © N.C. Department of Agriculture &amp; Consumer Services</li><li>Booth data: N.C. State Fair Food &amp; Ride Finder</li><li>Satellite layer (optional): Powered by Esri · Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community</li></ul>"};
// ---------- Data ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function isStarrable(b) {
  if (!b) return false;
  if (b.kind === 'ride') return true;
  if (b.food || b.kind === 'newfood' || b.kind === 'sponsor') return true;
  return false;
}
function favPressed(id) { return state.favs.indexOf(id) !== -1; }
function favBtnHtml(b) {
  if (!isStarrable(b)) return '';
  const on = favPressed(b.id);
  const label = on ? ('Remove ' + b.name + ' from favorites') : ('Save ' + b.name);
  return `<button type="button" class="fav" data-fav="${esc(b.id)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(label)}">${on ? '★' : '☆'}</button>`;
}
function paintFavBtn(btn, b) {
  if (!btn || !b) return;
  const on = favPressed(b.id);
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? ('Remove ' + b.name + ' from favorites') : ('Save ' + b.name));
}
function popBtns(b) {
  return `<div class="popBtns"><button class="go" data-id="${esc(b.id)}">➜ Guide me here</button><button class="shareBooth" type="button" aria-label="Share ${esc(b.name)}">${SHARE_ICO}<span>Share</span></button>${favBtnHtml(b)}</div>`;
}
const AM_ICON = { restroom: '🚻', first_aid: '⛑', nursing_room: '🍼', information: 'ℹ️', lost_and_found: '🧳', wheelchair_rental: '♿', atm: '💲' };
function amIcon(type) { return AM_ICON[type] || '📍'; }
function rideAliases(b) {
  return (b.aliases || []).filter(a => a && !(window.Suggest && Suggest.sameSpelling(b.name, a)));
}
function rideNameText(b) {
  const al = rideAliases(b);
  return (b.name || '') + (al.length ? ' · aka ' + al.join(', ') : '');
}
function popupHtml(b) {
  if (b.kind === 'amenity') {
    return `<b>${esc(b.name)}</b> <span class="badge approx">approximate location</span><br><small>${esc(b.area || '')}</small>${popBtns(b)}`;
  }
  if (b.kind === 'ride') {
    const pay = b.tickets != null ? `<div>🎟 ${b.tickets} tickets (fair’s listing)</div>` : (b.cashOnly ? `<div>💵 Cash Only${b.cashPrice ? ' · ' + esc(b.cashPrice) + ' (fair’s listing)' : ''}</div>` : '');
    const extra = [];
    if (b.heightText) extra.push(`<div>${esc(b.heightText)} (per midway operator)</div>`);
    if (b.category) extra.push(`<div class="rideCat">${esc(Rides.catLabel(b))}</div>`);
    const alias = b.aliases && b.aliases.length ? `<small>Lot label: ${esc(b.aliases.join(', '))}</small>` : '';
    return `<b>${esc(b.name)}</b> <span class="badge ride">RIDE</span><br><small>${esc(b.area || '')}</small>${pay}${extra.join('')}${alias ? '<br>' + alias : ''}${popBtns(b)}`;
  }
  return `<b>${esc(b.name)}</b>${popBadge(b.id)}${b.kind === 'newfood' ? ' <span class="badge new">NEW 2026</span>' : ''}${b.location !== 'exact' ? ' <span class="badge approx">approx. location</span>' : ''}<br>
  <small>${esc(b.area)}${b.lot ? ' · ' + esc(b.lot) : ''}</small>
  ${b.newFood ? `<div><b>New:</b> ${esc(b.newFood.name)}: ${esc(b.newFood.description)}</div>` : ''}
  <div style="max-height:9em;overflow:auto">${esc(b.products || '(no menu listed)')}</div>
  ${popBtns(b)}`;
}
function boothMarker(b, cls) {
  const color = cls === 'hit' ? '#e6007e' : b.kind === 'newfood' ? '#ffd400' : (b.drinks && !b.food ? '#00b3ff' : '#ff5a00');
  const m = L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: cls === 'hit' ? 11 : 7, color: '#000', weight: cls === 'hit' ? 3 : 2, fillColor: color, fillOpacity: 1 });
  m.bindPopup(() => popupHtml(b), POP);
  return m;
}
function rideMarker(r, hit) {
  const m = L.marker([r.lat, r.lon], { icon: hit ? rideHitIcon : rideIcon, keyboard: false });
  m.bindPopup(() => popupHtml(r), POP);
  return m;
}
map.on('popupopen', e => {
  document.body.classList.add('popup');
  const el = e.popup.getElement(), btn = el.querySelector('.go'), sh = el.querySelector('.shareBooth'), fv = el.querySelector('.fav'); if (!btn) return;
  const id = btn.dataset.id; e.popup._ffId = id;
  btn.onclick = () => { map.closePopup(); startGuide(id); };
  if (sh) sh.onclick = () => share(findTarget(id));
  if (fv) fv.onclick = () => { toggleFav(fv.dataset.fav); paintFavBtn(fv, findTarget(fv.dataset.fav)); };
  // v7 share-link fix: an open booth card is part of the URL, so the browser's own Share / copied address bar
  // carries the booth (previously only ll/z were in the URL and the recipient got no booth).
  if (!state.target) setUrl({ booth: id });
});
map.on('popupclose', e => { document.body.classList.remove('popup'); if (e.popup._ffId && !state.target && urlBoothId() === e.popup._ffId) setUrl({ booth: null }); });

async function loadData() {
  const [bd, ad, rd, syn, amn] = await Promise.all([
    fetch('data/booths.json').then(r => r.json()),
    fetch('data/atms.json').then(r => r.json()).catch(() => null),
    fetch('data/rides.json').then(r => r.json()).catch(() => null),
    fetch('data/synonyms.json').then(r => r.json()).catch(() => null),
    fetch('data/amenities.json').then(r => r.json()).catch(() => null),
  ]);
  state.meta = bd;
  state.rideMeta = rd;
  fetch('data/walkways.json').then(r => r.json()).then(g => { state.graph = new Route.Graph(g); state.graphMeta = g; refreshWalk(true); if (state.target) { state.route = null; updateGuide(); } }).catch(e => { state.graphError = e.message; });
  state.rides = ((rd && rd.rides) || []).filter(r => r.lat != null).map(Rides.prepare);
  const rideIds = new Set(state.rides.map(r => r.id));
  state.booths = bd.booths.filter(b => b.lat != null && !rideIds.has(b.id)).map(FoodSearch.prepare);
  state.tracker = window.Stats ? Stats.createTracker(state.booths) : null;
  loadTop();
  state.markers = new Map();
  state.booths.filter(b => b.food || b.kind === 'newfood').forEach(b => {
    const m = boothMarker(b).addTo(boothLayer);
    state.markers.set(b.id, m);
  });
  state.rides.forEach(r => {
    const m = rideMarker(r, false).addTo(rideLayer);
    state.markers.set(r.id, m);
  });
  state.suggestIndex = Suggest.buildIndex({ booths: state.booths, rides: state.rides });
  state.concepts = syn && window.Concepts ? Concepts.create(syn) : null;
  state.booths.filter(b => b.drinks).forEach(b => L.circleMarker([b.lat, b.lon], { renderer: canvas, radius: 8, color: '#000', weight: 2, fillColor: '#00b3ff', fillOpacity: 1 }).bindPopup(() => popupHtml(b)).addTo(drinkLayer));
  if (ad) {
    state.atms = ad.atms;
    const icon = L.divIcon({ className: '', html: '<div class="atmIcon">$</div>', iconSize: [30, 30] });
    ad.atms.forEach(a => L.marker([a.lat, a.lon], { icon, keyboard: false }).bindPopup(`<b>ATM</b> <span class="badge approx">approx. location</span><br><small>Position of the ATM icon on the fair’s published grounds map, so it may be off by 10–30 m.</small><div class="popBtns"><button class="go" data-id="${a.id}">➜ Guide me here</button><button class="shareBooth" type="button" aria-label="Share this ATM">${SHARE_ICO}<span>Share</span></button></div>`).addTo(atmLayer));
  }
  // ATMs come from data/atms.json (same machines, within ~1 m). Map the amenity ATM ids that the AI connector links to (am-atm-N) onto the nearest atms.json ATM.
  state.atmAlias = {};
  ((amn && amn.amenities) || []).filter(a => a.type === 'atm').forEach(a => {
    let best = null, bd = Infinity;
    (state.atms || []).forEach(x => { const d = Geo.distanceM(a.lat, a.lon, x.lat, x.lon); if (d < bd) { bd = d; best = x; } });
    if (best && bd < 40) state.atmAlias[a.id] = best.id;
  });
  const amRaw = (amn && amn.amenities) || [];
  state.amenities = amRaw.filter(a => a.type !== 'atm').map(a => ({
    id: a.id, name: a.name, area: properArea(a.area), lat: a.lat, lon: a.lon,
    location: 'approximate', kind: 'amenity', amenityType: a.type, products: ''
  }));
  const areaPool = state.booths.concat(state.rides);
  state.amenities.forEach(a => { if (!a.area) a.area = nearestProperArea(a.lat, a.lon, areaPool); });
  const amAtms = amRaw.filter(a => a.type === 'atm');
  (state.atms || []).forEach(atm => {
    let best = '', bd = Infinity;
    amAtms.forEach(s => {
      const area = properArea(s.area);
      if (!area) return;
      const d = Geo.distanceM(atm.lat, atm.lon, s.lat, s.lon);
      if (d < bd) { bd = d; best = area; }
    });
    atm.area = (best && bd < 80) ? best : nearestProperArea(atm.lat, atm.lon, areaPool);
  });
  state.amenities.forEach(a => {
    const icon = L.divIcon({ className: 'amenityIcon', html: `<div class="am am-${esc(a.amenityType)}">${amIcon(a.amenityType)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    const m = L.marker([a.lat, a.lon], { icon, keyboard: false });
    m.bindPopup(() => popupHtml(a), POP);
    m.addTo(amenityLayer);
    state.markers.set(a.id, m);
  });
  const nF = state.booths.filter(b => b.food || b.kind === 'newfood').length;
  setStatus(`${nF} food booths · ${state.rides.length} rides loaded`);
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
  const am = String(v).match(/am-[a-z0-9-]+/i); if (am) return am[0].toLowerCase();
  const m = String(v).match(/\b(L\d-\d+|atm\d+)/i); if (!m) return null;
  return /^l/i.test(m[1]) ? 'L' + m[1].slice(1) : m[1].toLowerCase();
}
function urlBoothId() { return parseBoothId(urlParams().get('booth')); }

function buildAbout(bd, ad) {
  const c = bd.counts;
  $('aboutBody').innerHTML = `<p class="disc"><b>${esc(L_.disc_t)}</b></p><p>${L_.disc}</p>
  <h3>Accuracy</h3><p>${L_.acc}</p>
  <p><b>${state.booths.length}</b> booths from the fair’s published booth data (Food &amp; Ride Finder: ${c.vendor} vendors, ${c.newfood} “New Foods 2026” entries, ${c.sponsor} sponsor booths). Booth positions are the fair’s published map points. Data generated ${esc(bd.generated)}.</p>
  <p><b>Rides:</b> ${state.rides.length} ride points from the fair’s published Food &amp; Ride Finder data (ride names as the fair’s app shows them; ticket counts from the fair’s listing, “Cash Only” where the fair lists no ticket price). Heights and categories, where shown, come from the midway operator’s published lists and are approximate.</p>
  <p><b>ATMs:</b> ${ad ? ad.atms.length + ' read from the ATM icons on the fair’s published grounds map, so their positions are <b>approximate</b>.' : 'not loaded'}</p>
  <p><b>Amenities:</b> ${state.amenities.length} approximate amenity points (restrooms, first aid, nursing rooms, information, lost and found, wheelchair rental). Positions are approximate. ATMs stay on the ATM layer.</p>
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
  if (state.tracker) {
    const arrived = state.tracker.onFix(state.me[0], state.me[1], accuracy, Date.now());
    if (arrived) postVisit(arrived);
  }
  state.fixCount = (state.fixCount || 0) + 1; state.lastFixAt = Date.now(); state.watchRestartsSinceFix = 0;
  if (heading != null && !isNaN(heading) && speed != null && speed > 0.7) { state.gpsHeading = heading; state.gpsHeadingAt = Date.now(); }
  state.heading.onPosition({ latitude: lat, longitude: lon, accuracy: accuracy, speed: speed, heading: heading }, Date.now());
  scheduleMeArrow();
  if (!meMarker) {
    meMarker = L.marker(state.me, { icon: L.divIcon({ className: 'meIconWrap', html: '<div class="me" id="meDot"><div class="meBeam" id="meBeam"></div><div class="mePulse" id="mePulse"></div><div class="meCore"></div><svg class="meArrow" id="meArrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 20 L12 15 L4 20 Z"/></svg></div>', iconSize: [120, 120], iconAnchor: [60, 60] }), interactive: false, keyboard: false, zIndexOffset: 100000 }).addTo(map);
    accCircle = L.circle(state.me, { radius: accuracy, color: '#1a73e8', weight: 1.5, opacity: 0.5, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
    if (FAIR_BOUNDS.pad(0.5).contains(state.me) && !state.target) map.setView(state.me, 18);
  } else { meMarker.setLatLng(state.me); accCircle.setLatLng(state.me).setRadius(accuracy); }
  blip();
  state.meAt = Date.now(); state.gpsError = null; refreshWalk();
  setStatus(`GPS ±${Math.round(accuracy * 3.28084)} ft`);
  // Refresh distances in the list WITHOUT touching guide visibility or the map view.
  if (state.results.length) renderResults(false, true);
  if ($('nearPanel') && !$('nearPanel').classList.contains('hidden')) renderNear();
  if ($('favPanel') && !$('favPanel').classList.contains('hidden')) renderFav();
  if (state.pendingNearest) { const pick = state.pendingNearest; state.pendingNearest = null; goNearest(pick); }
  updateGuide(); meStyle();
}
// Map "you" marker: blue dot, pulse ring that blips on each fix, compass beam, grey when stale.
function blip() { const el = document.getElementById('mePulse'); if (!el) return; el.classList.remove('blip'); void el.offsetWidth; el.classList.add('blip'); }
function normDeg(d) { return ((d % 360) + 360) % 360; }
let arrowLoop = false;
function scheduleMeArrow() {
  if (arrowLoop) return;
  arrowLoop = true;
  const loop = () => {
    if (!state.heading) { arrowLoop = false; return; }
    const moving = state.heading.step(1 / 60);
    meStyle();
    if (moving && state.heading.current(Date.now()).deg != null) requestAnimationFrame(loop); // stop once settled; new readings restart it
    else arrowLoop = false;
  };
  requestAnimationFrame(loop);
}
function meStyle() {
  const d = document.getElementById('meDot'); if (!d) return;
  const stale = Date.now() - (state.lastFixAt || 0) > 20000; d.classList.toggle('stale', stale);
  const beam = document.getElementById('meBeam'), arrow = document.getElementById('meArrow');
  const hd = state.heading ? state.heading.current(Date.now()) : { deg: null };
  if (hd.deg == null) {
    d.classList.remove('hasHead');
    if (beam) beam.style.opacity = '0';
    return;
  }
  d.classList.add('hasHead');
  const show = normDeg(hd.deg - MAP_BEARING);
  const prev = state._beamDeg == null ? show : state._beamDeg, delta = ((show - (prev % 360) + 540) % 360) - 180;
  state._beamDeg = prev + delta;
  const tr = `rotate(${state._beamDeg}deg)`;
  if (arrow) arrow.style.transform = tr;
  if (beam) { beam.style.transform = tr; beam.style.opacity = stale ? '0.35' : '1'; }
}
function onPosErr(e) {
  state.gpsError = e.message || String(e.code); state.gpsDenied = e.code === 1; state.lastErrAt = Date.now(); state.errCount = (state.errCount || 0) + 1;
  if (e.code === 1 && state.pendingNearest) { state.pendingNearest = null; toast('Allow location to find the nearest one'); }
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
$('btnLocate').onclick = () => { if (!state.compassOn && !state.compassGranted) $('btnCompass').onclick(); // tap also enables the compass beam (iOS needs a tap)
  if (state.me) return map.setView(state.me, Math.max(map.getZoom(), 18)); setStatus(state.gpsDenied ? 'Asking for location again…' : 'No GPS fix yet'); startWatch(); };

// ---------- Anonymous counts (visits and taps) ----------
function popBadge(id) {
  return state.popular && state.popular.has(id) ? '<span class="badge pop">🔥 Popular</span>' : '';
}
const CHIP_BUTTONS = [
  ['hot dog', 'Hot dog'],
  ['corn dog', 'Corn dog'],
  ['turkey leg', 'Turkey leg'],
  ['funnel cake', 'Funnel cake'],
  ['fried cheeseburger', 'Fried cheeseburger'],
  ['empanada', 'Empanada'],
  ['lemonade', 'Lemonade'],
  ['ice cream', 'Ice cream'],
  ['bbq', 'BBQ'],
  ['new', '⭐ New 2026'],
];
function chipLabel(key) {
  for (let i = 0; i < CHIP_BUTTONS.length; i++) {
    if (window.Stats && Stats.chipKey(CHIP_BUTTONS[i][0]) === key) return CHIP_BUTTONS[i];
  }
  return null;
}
function uuidFallback() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function deviceId() {
  let id = localStorage.getItem('ff.deviceId');
  if (id) return id;
  id = crypto.randomUUID ? crypto.randomUUID() : uuidFallback();
  localStorage.setItem('ff.deviceId', id);
  return id;
}
function boothAllowed(id) {
  return !!(id && state.booths && state.booths.some(b => b.id === id));
}
function searchAllowed(k) {
  if (typeof k !== 'string' || !window.Stats) return false;
  if (k.indexOf('chip:') === 0) return Stats.CHIP_KEYS.indexOf(k.slice(5)) !== -1;
  if (k.indexOf('booth:') === 0) return boothAllowed(k.slice(6));
  return false;
}
function postJSON(path, capId, fields) {
  try {
    if (localStorage.getItem('ff.statsOptOut') === '1') return;
    if (path === '/visit') { if (!boothAllowed(fields.b)) return; }
    else if (!searchAllowed(fields.k)) return;
    const now = Date.now();
    if (!window.Stats || Stats.capHas(localStorage, capId, now)) return;
    const d = deviceId();
    if (!d) return;
    Stats.capMark(localStorage, capId, now);
    const body = path === '/visit' ? { d: d, b: fields.b } : { d: d, k: fields.k };
    fetch(ffApiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      signal: AbortSignal.timeout(4000),
    }).then(function () {}, function () {});
  } catch (e) {}
}
function postVisit(id) { postJSON('/visit', id, { b: id }); }
function postSearch(k) { postJSON('/search', k, { k: k }); }
let topCache = null;
function applyTop(pack) {
  state.topBooths = pack.booths || [];
  state.topSearches = pack.searches || [];
  state.popular = new Set(state.topBooths.map(it => it.id));
  state.panelMode = window.Stats ? Stats.panelMode(state.topBooths.concat(state.topSearches)) : 'chips';
  renderPopular();
  if (state.results && state.results.length) renderResults(false, true);
}
async function loadTop() {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem('ff.top');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && now - saved.at < 120000) { applyTop(saved); return; }
    }
  } catch (e) {}
  if (topCache && now - topCache.at < 120000) { applyTop(topCache); return; }
  let base = '';
  try { base = ffApiBase(); } catch (e) { return; }
  try {
    const opts = { signal: AbortSignal.timeout(4000) };
    const vr = await fetch(base + '/top?window=now', opts);
    const sr = await fetch(base + '/top-searches?window=now', opts);
    if (!vr.ok || !sr.ok) return;
    const vj = await vr.json();
    const sj = await sr.json();
    const pack = {
      at: Date.now(),
      booths: window.Stats ? Stats.filterCount(vj.items) : [],
      searches: window.Stats ? Stats.filterCount(sj.items) : [],
    };
    topCache = pack;
    try { sessionStorage.setItem('ff.top', JSON.stringify(pack)); } catch (e) {}
    applyTop(pack);
  } catch (e) {}
}
function renderPopular() {
  const el = $('popular');
  if (!el) return;
  if (state.panelMode !== 'live') {
    el.innerHTML = '<h3>Try searching</h3>' + CHIP_BUTTONS.map(pair =>
      '<button type="button" class="popBtn" data-q="' + esc(pair[0]) + '">' + esc(pair[1]) + '</button>').join('');
    return;
  }
  let html = '<h3>Popular right now</h3>';
  for (const it of state.topBooths || []) {
    const b = state.booths.find(x => x.id === it.id);
    if (!b) continue;
    html += '<button type="button" class="popBtn" data-booth="' + esc(b.id) + '">' + esc(b.name) + (b.area ? ' <small>' + esc(b.area) + '</small>' : '') + '</button>';
  }
  for (const it of state.topSearches || []) {
    const k = it.k || '';
    if (k.indexOf('chip:') === 0) {
      const pair = chipLabel(k.slice(5));
      if (!pair) continue;
      html += '<button type="button" class="popBtn" data-q="' + esc(pair[0]) + '">' + esc(pair[1]) + '</button>';
    } else if (k.indexOf('booth:') === 0) {
      const id = k.slice(6);
      const b = state.booths.find(x => x.id === id);
      if (!b) continue;
      html += '<button type="button" class="popBtn" data-booth="' + esc(id) + '">' + esc(b.name) + '</button>';
    }
  }
  el.innerHTML = html;
}

// ---------- Search ----------
let tmr, sgT, sgActive = -1, pinPick = false, suppressAc = false, lastSuggest = [], pickAt = 0;
$('q').addEventListener('input', () => {
  clearTimeout(tmr);
  if (pinPick) { pinPick = false; return; }
  tmr = setTimeout(runSearch, 180);
});
$('searchForm').onsubmit = e => { e.preventDefault(); hideSuggest(); runSearch(); $('q').blur(); };
$('clearQ').onclick = () => { $('q').value = ''; hideSuggest(); clearResults(); };
function onChipClick(c) {
  hideSuggest();
  const q = c.dataset.q;
  if (q === 'near') { openNear(); return; }
  if (q === 'favorites') { openFav(); return; }
  if (c.classList.contains('on') && !$('results').classList.contains('hidden')) { $('q').value = ''; clearResults(); return; } // second tap toggles off
  const key = window.Stats && Stats.chipKey(q);
  if (key) postSearch('chip:' + key);
  $('q').value = q === 'new' ? '' : q;
  runSearch(q === 'new');
  syncSearchFocus();
}
document.querySelectorAll('#chips .chip').forEach(c => { c.onclick = () => onChipClick(c); });
const popEl = $('popular');
if (popEl) {
  popEl.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
  popEl.addEventListener('mousedown', e => e.preventDefault());
  popEl.addEventListener('click', e => {
    const chip = e.target.closest('button[data-q]');
    if (chip) { onChipClick(chip); return; }
    const row = e.target.closest('button[data-booth]');
    if (!row) return;
    const id = row.dataset.booth;
    if (boothAllowed(id)) postSearch('booth:' + id);
    popEl.classList.add('hidden');
    $('q').blur();
    startGuide(id);
  });
}
// Chip looks selected while its search is the one showing.
function syncChips() {
  const open = !$('results').classList.contains('hidden') && !!state.query;
  const q = String(state.query || '').toLowerCase();
  document.querySelectorAll('.chip').forEach(c => {
    let on;
    if (c.dataset.q === 'near') on = !$('nearPanel').classList.contains('hidden');
    else if (c.dataset.q === 'favorites') on = !$('favPanel').classList.contains('hidden');
    else on = open && (c.dataset.q === 'new' ? q === 'new foods 2026' : c.dataset.q === 'rides' ? q === 'rides' : q === c.dataset.q);
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
$('closeResults').onclick = clearResults;
function clearResults() {
  state.results = []; state.query = '';
  hitLayer.clearLayers(); $('results').classList.add('hidden');
  const subs = $('rideSubs'); if (subs) subs.classList.add('hidden');
  setUrl({ q: null, new: null });
  syncChips(); fitSuggest();
}
$('q').addEventListener('focus', () => { document.body.classList.add('typing'); syncSearchFocus(); });
$('q').addEventListener('blur', () => { document.body.classList.remove('typing'); setTimeout(() => { hideSuggest(); syncSearchFocus(); }, 250); });
function syncSearchFocus() {
  const el = $('searchFocus'); if (!el) return;
  const q = $('q');
  const show = document.activeElement === q && !(q.value || '').trim() && $('suggest').classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  const pop = $('popular');
  if (!pop || pop.dataset.ffAc) return;
  pop.classList.toggle('hidden', !show);
}
function dist(b) {
  if (!state.me) return null;
  const w = walkDist(b); if (w != null) return w;
  return Geo.distanceM(state.me[0], state.me[1], b.lat, b.lon);
}
function properArea(area) {
  const a = String(area || '').trim();
  if (!a || a.length < 3 || /^(hv|ch|l)$/i.test(a)) return '';
  if (/published grounds map/i.test(a)) return '';
  return a;
}
function nearestProperArea(lat, lon, pool) {
  let best = '', bd = Infinity;
  for (const p of pool) {
    const area = properArea(p.area);
    if (!area || p.lat == null || p.lon == null) continue;
    const d = Geo.distanceM(lat, lon, p.lat, p.lon);
    if (d < bd) { bd = d; best = area; }
  }
  return best;
}
function amenityPlace(t) {
  if (!t) return '';
  const area = properArea(t.area);
  let away = '';
  if (state.me && t.lat != null && t.lon != null) {
    refreshWalk();
    const w = walkDist(t);
    away = w != null ? ('🚶 ' + Geo.fmtFeet(w)) : Geo.fmtFeet(Geo.distanceM(state.me[0], state.me[1], t.lat, t.lon));
  }
  return [area, away].filter(Boolean).join(' · ');
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
// Pure nearest list. Does not read state. pos is [lat, lon] or null. kind is food | ride | amenity.
function nearMe(pos, items, opts) {
  opts = opts || {};
  const type = opts.type || 'all';
  const limit = opts.limit == null ? 40 : opts.limit;
  const graph = opts.graph;
  let list = items || [];
  if (type === 'food') list = list.filter(i => i.kind === 'food');
  else if (type === 'rides') list = list.filter(i => i.kind === 'ride');
  else if (type === 'amenities') list = list.filter(i => i.kind === 'amenity');
  let snapMe = null, dj = null;
  if (graph && pos) {
    snapMe = graph.snap(pos[0], pos[1], 80);
    if (snapMe) dj = graph.dijkstra(snapMe);
  }
  const rows = list.map(item => {
    let meters = null, straight = false;
    if (dj && snapMe && graph) {
      if (item._snap === undefined) item._snap = graph.snap(item.lat, item.lon, 80);
      if (item._snap) {
        const w = graph.walkLen(dj, snapMe, item._snap);
        if (isFinite(w)) meters = w;
      }
    }
    if (meters == null && pos) {
      meters = Geo.distanceM(pos[0], pos[1], item.lat, item.lon);
      straight = true;
    }
    const minutes = meters == null ? null : Math.max(1, Math.round(meters / 1.1 / 60));
    return { item, meters, minutes, straight };
  });
  rows.sort((a, b) => {
    if (a.meters == null && b.meters == null) return String(a.item.name || '').localeCompare(String(b.item.name || ''));
    if (a.meters == null) return 1;
    if (b.meters == null) return -1;
    if (a.meters !== b.meters) return a.meters - b.meters;
    return String(a.item.name || '').localeCompare(String(b.item.name || ''));
  });
  if (type === 'all') {
    // Keep the nearest restroom, ATM and first aid on the list even when food fills the cap.
    const head = rows.slice(0, limit);
    const extras = [];
    for (const t of ['restroom', 'atm', 'first_aid']) {
      if (head.some(r => r.item.amenityType === t)) continue;
      const hit = rows.find(r => r.item.amenityType === t);
      if (hit) extras.push(hit);
    }
    if (!extras.length) return head;
    const merged = head.concat(extras);
    merged.sort((a, b) => {
      if (a.meters == null && b.meters == null) return String(a.item.name || '').localeCompare(String(b.item.name || ''));
      if (a.meters == null) return 1;
      if (b.meters == null) return -1;
      if (a.meters !== b.meters) return a.meters - b.meters;
      return String(a.item.name || '').localeCompare(String(b.item.name || ''));
    });
    return merged;
  }
  return rows.slice(0, limit);
}
function nearItems() {
  const out = [];
  for (const b of state.booths) if (b.food || b.kind === 'newfood') out.push({ id: b.id, name: b.name, lat: b.lat, lon: b.lon, kind: 'food' });
  for (const r of state.rides) out.push({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, kind: 'ride', aliases: r.aliases, area: r.area, tickets: r.tickets });
  for (const a of state.amenities) out.push({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: a.amenityType, area: a.area });
  for (const a of state.atms || []) out.push({ id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, kind: 'amenity', amenityType: 'atm', area: a.area || '' });
  return out;
}
function nearDistText(row) {
  if (row.meters == null) return '—';
  if (row.straight) return Geo.fmtFeet(row.meters);
  return '🚶 ' + Geo.fmtFeet(row.meters) + ' · ' + row.minutes + ' min';
}
function rowIcon(item) {
  if (item.kind === 'food') return '🍴';
  if (item.kind === 'ride') return '🎡';
  return amIcon(item.amenityType);
}
function collapseGuideForSheet() {
  if (state.target && sheet.visible && sheet.state === 'expanded') sheet.set('collapsed');
}
function openNear() {
  hideSuggest();
  collapseGuideForSheet();
  $('favPanel').classList.add('hidden'); $('results').classList.add('hidden'); // one sheet at a time
  $('nearPanel').classList.remove('hidden');
  state.nearType = 'all';
  document.querySelectorAll('#nearFilters .rideSub').forEach(b => {
    const on = b.dataset.nt === 'all';
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderNear();
  syncChips();
}
function renderNear() {
  const gps = $('nearGps'), list = $('nearList');
  if (!state.me) {
    gps.classList.remove('hidden');
    gps.innerHTML = 'Turn on location to see what’s closest. Tap ◎, or the button below. <button type="button" id="nearLocate" aria-label="Turn on location">Turn on location</button>';
    $('nearLocate').onclick = () => $('btnLocate').onclick();
    list.innerHTML = '';
    $('nearCount').textContent = 'Near me';
    syncChips();
    return;
  }
  gps.classList.add('hidden');
  refreshWalk();
  const rows = nearMe(state.me, nearItems(), { type: state.nearType || 'all', graph: state.graph });
  $('nearCount').textContent = 'Near me · ' + rows.length;
  const seen = {}; rows.forEach(r => { seen[r.item.name] = (seen[r.item.name] || 0) + 1; });
  list.innerHTML = rows.map(row => {
    const it = row.item;
    const name = it.kind === 'ride' ? rideNameText(it) : it.name;
    // Same-name neighbours (e.g. a booth and its seating area) get the lot + menu hint so they're distinguishable.
    const src = it.kind === 'food' ? (state.booths.find(b => b.id === it.id) || {}) : it;
    const sub = [src.area || '', seen[it.name] > 1 ? [String(src.lot || '').replace(/^LOT\s*/i, 'Lot '), String(src.products || '').slice(0, 28)].filter(Boolean).join(' · ') : '', it.kind === 'amenity' ? 'approx.' : ''].filter(Boolean).join(' · ');
    return `<li data-id="${esc(it.id)}"><span class="r-ico" aria-hidden="true">${rowIcon(it)}</span><span class="r-name">${esc(name)}${sub ? `<small class="r-sub">${esc(sub)}</small>` : ''}</span><span class="r-dist">${esc(nearDistText(row))}</span></li>`;
  }).join('');
  syncChips();
}
function goNearest(pick) {
  let list;
  if (pick === 'restroom') list = state.amenities.filter(a => a.amenityType === 'restroom');
  else if (pick === 'first_aid') list = state.amenities.filter(a => a.amenityType === 'first_aid');
  else list = (state.atms || []).map(a => ({ id: a.id, lat: a.lat, lon: a.lon }));
  if (!state.me) { state.pendingNearest = pick; startWatch('nearest'); toast('Finding your location…'); return; }
  refreshWalk();
  let best = null, bestD = Infinity;
  for (const c of list) {
    const w = walkDist(c);
    const d = w != null ? w : Geo.distanceM(state.me[0], state.me[1], c.lat, c.lon);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best) startGuide(best.id);
}
function toggleFav(id) {
  const i = state.favs.indexOf(id);
  if (i >= 0) state.favs.splice(i, 1); else state.favs.push(id);
  saveFavs(state.favs);
  document.querySelectorAll('.fav[data-fav="' + CSS.escape(id) + '"]').forEach(btn => paintFavBtn(btn, findTarget(id)));
  syncGuideFav();
  if ($('favPanel') && !$('favPanel').classList.contains('hidden')) renderFav();
}
function favDistText(t) {
  if (!state.me || !t) return '—';
  const d = dist(t);
  if (d == null) return '—';
  const w = walkDist(t);
  return (w != null ? '🚶 ' : '') + Geo.fmtFeet(d);
}
function openFav() {
  hideSuggest();
  collapseGuideForSheet();
  $('nearPanel').classList.add('hidden'); $('results').classList.add('hidden'); // one sheet at a time
  $('favPanel').classList.remove('hidden');
  renderFav();
  syncChips();
}
function renderFav() {
  const keep = [];
  const rows = [];
  for (const id of state.favs) {
    const t = findTarget(id);
    if (!t || !isStarrable(t)) continue;
    keep.push(id);
    rows.push(t);
  }
  if (keep.length !== state.favs.length) { state.favs = keep; saveFavs(keep); }
  const empty = $('favEmpty');
  if (!rows.length) {
    empty.classList.remove('hidden');
    $('favList').innerHTML = '';
    $('favCount').textContent = '★ Favorites';
    return;
  }
  empty.classList.add('hidden');
  $('favCount').textContent = '★ Favorites';
  $('favList').innerHTML = rows.map(t => {
    const name = t.kind === 'ride' ? rideNameText(t) : t.name;
    return `<li data-id="${esc(t.id)}"><span class="r-name">${esc(name)}</span><span class="r-dist">${esc(favDistText(t))}</span><span class="favActs"><button type="button" class="favGo" data-id="${esc(t.id)}">Guide me here</button><button type="button" class="favRemove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.name)}">Remove</button></span></li>`;
  }).join('');
}
function syncGuideFav() {
  const btn = $('btnFav'); if (!btn) return;
  const t = state.target;
  const show = isStarrable(t);
  btn.classList.toggle('hidden', !show);
  if (show) paintFavBtn(btn, t);
}
function ridesMatching(q) {
  const qc = Suggest.compact(q);
  if (qc.length < 2) return [];
  const out = [];
  for (let i = 0; i < state.rides.length; i++) {
    const r = state.rides[i];
    let hit = Suggest.compact(r.name).indexOf(qc) >= 0;
    const al = r.aliases || [];
    for (let j = 0; !hit && j < al.length; j++) if (Suggest.compact(al[j]).indexOf(qc) >= 0) hit = true;
    if (hit) out.push(r);
  }
  return out;
}
function isRidesQuery(q) { const n = String(q || '').trim().toLowerCase(); return n === 'rides' || n === 'ride'; }
function amenityDirect(q) {
  if (!state.concepts) return [];
  const ks = state.concepts.match(q).filter(k => k.kind === 'amenity');
  const out = [], seen = new Set();
  for (const k of ks) {
    if (k.id === 'atm') {
      for (const a of state.atms || []) {
        const t = findTarget(a.id);
        if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
      }
    } else {
      for (const a of state.amenities) if (a.amenityType === k.id && !seen.has(a.id)) { seen.add(a.id); out.push(a); }
    }
  }
  return out;
}
// One classification for the results list and the dropdown. Direct wins over likely (by id).
function packQuery(q) {
  // Exact concept terms skip edit-distance (that is what pulled "slushie" onto sushi/plush).
  // Food chips still expand their synonym group, which is the v7.3.1 recall; a typed exact term like "slushie" does not.
  const exact = !!(state.concepts && state.concepts.exactTerm(q));
  const chip = !!(window.Stats && Stats.chipKey(q));
  const opts = { allowFuzzy: !exact, synonymExpand: !exact || chip };
  const direct = [];
  const seen = new Set();
  function push(item, extra) {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    direct.push(Object.assign({ booth: item, score: extra.score, matched: extra.matched || [], likely: false }, extra));
  }
  if (!isRidesQuery(q)) {
    FoodSearch.search(state.booths, q, opts).forEach(h => push(h.booth, { score: h.score, matched: h.matched }));
    ridesMatching(q).forEach(r => push(r, { score: 1, matched: [] }));
    amenityDirect(q).forEach(a => push(a, { score: 1, matched: [], amenity: true }));
  }
  let likely = [];
  if (state.concepts && !isRidesQuery(q)) {
    const qc = Suggest.compact(q);
    const exactName = state.rides.some(r => Suggest.compact(r.name) === qc)
      || state.booths.some(b => b.food && Suggest.compact(b.name) === qc);
    if (!exactName) {
      likely = state.concepts.likely(q, {
        rides: state.rides, booths: state.booths, exclude: seen, limit: 5
      }).map(l => ({ booth: l.item, score: 0.5, matched: [], likely: true, why: l.why }));
    }
  }
  return { direct, likely };
}
function runSearch(newOnly, fromUrl) {
  const q = $('q').value.trim();
  const ridesQ = !newOnly && isRidesQuery(q);
  if (!fromUrl) setUrl(newOnly === true ? { q: null, new: '1' } : { q: (ridesQ || q.length >= 2) ? q : null, new: null });
  if (newOnly === true) {
    state.pack = null;
    state.results = state.booths.filter(b => b.kind === 'newfood').map(b => ({ booth: b, score: 1, matched: b.newFood ? [b.newFood.name] : [] }));
    state.query = 'New foods 2026';
  } else if (ridesQ) {
    state.pack = null;
    state.query = 'Rides';
    state.rideSub = 'all';
    document.querySelectorAll('#rideSubs .rideSub').forEach(b => b.classList.toggle('on', b.dataset.sub === 'all'));
    state.results = state.rides.map(r => ({ booth: r, score: 1, matched: [] }));
  } else if (q.length < 2) return clearResults();
  else {
    const pack = packQuery(q);
    state.pack = pack;
    state.results = pack.direct.concat(pack.likely);
    state.query = q;
  }
  renderResults(true);
}
function renderResults(fit, quiet) {
  const rs = state.results;
  refreshWalk();
  rs.forEach(r => { r.d = dist(r.booth); r.walk = state.dj && r.d != null && walkDist(r.booth) != null; r.tier = r.likely ? 2 : r.score >= 0.85 ? 0 : 1; });
  rs.sort((a, b) => a.tier - b.tier || (a.d != null && b.d != null ? a.d - b.d : b.score - a.score));
  hitLayer.clearLayers();
  rs.forEach(r => (r.booth.kind === 'ride' ? rideMarker(r.booth, true) : boothMarker(r.booth, 'hit')).addTo(hitLayer));
  const dirs = rs.filter(r => !r.likely), liks = rs.filter(r => r.likely);
  const nLik = liks.length, nDir = dirs.length;
  const near = state.me ? (state.dj ? ', nearest walk first' : ', nearest first') : '';
  $('resCount').textContent = !rs.length ? `No results for “${state.query}”`
    : nDir ? `${nDir} result${nDir === 1 ? '' : 's'} for “${state.query}”${near}${nLik ? ` · ${nLik} likely` : ''}`
    : `No direct results for “${state.query}” · ${nLik} likely match${nLik === 1 ? '' : 'es'}${near}`;
  const subs = $('rideSubs'); if (subs) subs.classList.toggle('hidden', state.query !== 'Rides');
  const hl = (s) => esc(s);
  const cap = state.query === 'Rides' ? rs.length : 80;
  const shown = state.query === 'Rides' ? rs : dirs.slice(0, cap).concat(liks);
  let sep = false;
  $('resList').innerHTML = shown.map((r, i) => {
    const b = r.booth;
    const why = r.likely && r.why ? `<span class="badge likely">${esc(r.why)}</span>` : '';
    const head = (r.likely && !sep) ? (sep = true, '<li class="likelyHead" role="presentation">Likely matches</li>') : '';
    if (b.kind === 'ride') {
      const pay = [Rides.payText(b), b.category ? Rides.catLabel(b).replace(' (per midway operator)', '') : ''].filter(Boolean).join(' · ');
      return `${head}<li data-id="${esc(b.id)}" data-i="${i}"${r.likely ? ' class="likely"' : ''}>
        <div class="r-top"><span class="r-name">🎡 ${esc(rideNameText(b))}</span><span class="r-dist">${r.d != null ? (r.walk ? '🚶 ' : '') + Geo.fmtFeet(r.d) : ''}</span><button class="rShare" type="button" data-share="${esc(b.id)}" aria-label="Share ${esc(b.name)}">${SHARE_ICO}<span>Share</span></button></div>
        <div class="r-items">${esc(pay)}</div>
        <div class="r-meta">${why}${esc(b.area || '')}</div></li>`;
    }
    const items = (r.matched.length ? r.matched : (b.items || [])).slice(0, 4);
    const label = b.kind === 'amenity' && b.area ? (b.name + ' · ' + b.area) : b.name;
    return `${head}<li data-id="${esc(b.id)}" data-i="${i}"${r.likely ? ' class="likely"' : ''}>
      <div class="r-top"><span class="r-name">${esc(label)}</span><span class="r-dist">${r.d != null ? (r.walk ? '🚶 ' : '') + Geo.fmtFeet(r.d) : ''}</span><button class="rShare" type="button" data-share="${esc(b.id)}" aria-label="Share ${esc(b.name)}">${SHARE_ICO}<span>Share</span></button></div>
      <div class="r-items">${items.map(it => r.matched.length ? `<mark>${hl(it)}</mark>` : hl(it)).join(', ')}</div>
      <div class="r-meta">${popBadge(b.id)}${why}${b.kind === 'newfood' ? '<span class="badge new">NEW 2026</span>' : ''}${r.tier === 1 ? '<span class="badge">related</span>' : ''}${b.location !== 'exact' ? '<span class="badge approx">approx.</span>' : ''}${esc(b.area || '')}${b.lot ? ' · ' + esc(b.lot) : ''}</div></li>`;
  }).join('');
  if (!quiet) { collapseGuideForSheet(); $('nearPanel').classList.add('hidden'); $('favPanel').classList.add('hidden'); }
  if (!quiet) $('results').classList.remove('hidden'); // guide stays up, collapsed: one expanded sheet at a time
  fitSuggest();
  document.body.classList.toggle('guiding', !!state.target);
  if (fit && rs.length) {
    const rideList = state.query === 'Rides';
    const pts = (rideList ? rs : (rs.some(r => !r.likely) ? rs.filter(r => !r.likely) : rs).slice(0, 5)).map(r => [r.booth.lat, r.booth.lon]); if (state.me && !rideList) pts.push(state.me);
    map.fitBounds(L.latLngBounds(pts).pad(rideList ? 0.05 : 0.2), { maxZoom: rideList ? 18 : 19, paddingBottomRight: [0, window.innerHeight * 0.45] });
  }
  syncChips();
}
$('resList').onclick = e => {
  const sb = e.target.closest('[data-share]');
  if (sb) { e.stopPropagation(); share(findTarget(sb.dataset.share)); return; }
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  if (state.booths.some(b => b.id === id)) postSearch('booth:' + id);
  startGuide(id);
};
const rideSubsEl = $('rideSubs');
if (rideSubsEl) rideSubsEl.onclick = e => {
  const b = e.target.closest('.rideSub');
  if (!b || state.query !== 'Rides') return;
  state.rideSub = b.dataset.sub;
  rideSubsEl.querySelectorAll('.rideSub').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
  state.results = Rides.filter(state.rides, state.rideSub).map(r => ({ booth: r, score: 1, matched: [] }));
  renderResults(true);
};

// ---------- Autocomplete ----------
function hideSuggest() {
  clearTimeout(sgT);
  const el = $('suggest');
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
  sgActive = -1;
  $('q').setAttribute('aria-expanded', 'false');
  $('q').removeAttribute('aria-activedescendant');
  document.body.classList.remove('ac', 'acCover');
  syncSearchFocus();
  const pop = $('popular');
  if (pop && pop.dataset.ffAc) {
    delete pop.dataset.ffAc;
    const q = $('q');
    const restore = document.activeElement === q && !(q.value || '').trim() && $('suggest').classList.contains('hidden');
    if (restore) pop.classList.remove('hidden');
    else pop.classList.add('hidden');
  }
}
// Cap the dropdown to what's visible: the visual viewport (so it ends above the iOS keyboard) and, while guiding,
// the top of the guide sheet (so its Stop ✕ stays tappable). The list scrolls inside.
function fitSuggest() {
  const el = $('suggest');
  if (!el || el.classList.contains('hidden')) { document.body.classList.remove('acCover'); return; }
  const vv = window.visualViewport;
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const below = id => { const s = $(id); if (s && !s.classList.contains('hidden')) { const t = s.getBoundingClientRect().top; if (t > 0 && t < bottom) bottom = t; } };
  below('guide');
  const top = el.getBoundingClientRect().top, beforeRes = bottom;
  below('results');
  below('nearPanel');
  below('favPanel');
  const cover = bottom - top < 150; // no room above the results sheet: let the dropdown use the space, sheet steps aside
  document.body.classList.toggle('acCover', cover);
  if (cover) bottom = beforeRes;
  el.style.maxHeight = Math.max(96, Math.floor(bottom - top - 8)) + 'px';
}
if (window.visualViewport) { visualViewport.addEventListener('resize', fitSuggest); visualViewport.addEventListener('scroll', fitSuggest); }
window.addEventListener('resize', fitSuggest);
function sgTag(type, it) {
  if (type === 'ride') return '🎡 Ride';
  if (type === 'booth') return '🍴 Booth';
  if (type === 'amenity') {
    const w = { restroom: 'Restroom', atm: 'ATM', first_aid: 'First aid', nursing_room: 'Nursing', information: 'Info', lost_and_found: 'Lost & found', wheelchair_rental: 'Rental' };
    return amIcon(it && it.amenityType) + ' ' + (w[it && it.amenityType] || 'Amenity');
  }
  return '🍽 Food';
}
function renderSuggest() {
  const raw = $('q').value;
  if (!raw.trim() || !state.suggestIndex) { hideSuggest(); syncSearchFocus(); return; }
  const pack = packQuery(raw);
  const noFuzzy = !!(state.concepts && state.concepts.exactTerm(raw));
  let items = Suggest.query(state.suggestIndex, raw, 8, { noFuzzy: noFuzzy });
  const am = pack.direct.filter(d => d.amenity).slice().sort((a, b) => {
    const da = dist(a.booth), db = dist(b.booth);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  const have = new Set(items.map(it => it.type + '\0' + it.id));
  const prepend = [];
  for (const a of am) {
    const key = 'amenity\0' + a.booth.id;
    if (have.has(key)) continue;
    have.add(key);
    prepend.push({ type: 'amenity', id: a.booth.id, label: a.booth.name, sub: amenityPlace(a.booth), score: 95, amenityType: a.booth.amenityType });
  }
  items = prepend.concat(items);
  const likelyItems = pack.likely.map(l => ({
    type: l.booth.kind === 'ride' ? 'ride' : (l.booth.kind === 'amenity' ? 'amenity' : 'booth'),
    id: l.booth.id, label: l.booth.name, sub: l.booth.area || '', likely: true, why: l.why, amenityType: l.booth.amenityType
  }));
  items = items.concat(likelyItems);
  lastSuggest = items;
  const el = $('suggest');
  if (!items.length) { hideSuggest(); syncSearchFocus(); return; }
  sgActive = -1;
  let seenLikely = false;
  el.innerHTML = items.map((it, i) => {
    const aka = it.alias && !(window.Suggest && Suggest.sameSpelling(it.label, it.alias)) ? ` <small>aka ${esc(it.alias)}</small>` : '';
    const subText = it.type === 'amenity' ? amenityPlace(findTarget(it.id) || it) : (it.sub || '');
    const sub = subText ? ` <small>${esc(subText)}</small>` : '';
    const head = it.likely && !seenLikely ? (seenLikely = true, '<li class="sgSep" role="presentation">Likely matches · did you mean</li>') : '';
    const why = it.likely && it.why ? ` <small class="sgWhy">${esc(it.why)}</small>` : '';
    return `${head}<li role="option" id="sg-${i}" data-i="${i}" data-type="${esc(it.type)}" data-id="${esc(it.id)}"${it.likely ? ' class="likely"' : ''}>${''}<span class="sgTag">${sgTag(it.type, it)}</span> ${esc(it.label)}${aka}${sub}${why}</li>`;
  }).join('');
  el.classList.remove('hidden');
  $('q').setAttribute('aria-expanded', 'true');
  document.body.classList.add('ac');
  syncSearchFocus();
  fitSuggest();
  const pop = $('popular');
  if (pop && !pop.classList.contains('hidden')) { pop.classList.add('hidden'); pop.dataset.ffAc = '1'; }
}
// Suggestion pick: pan to the item and open its card (Guide me here / Share).
function openTarget(id) {
  const t = findTarget(id);
  const m = state.markers && state.markers.get(id);
  $('results').classList.add('hidden'); syncChips();
  map.stop(); // cancel a search fitBounds animation that would pull the zoom back down
  if (!t) return;
  map.setView([t.lat, t.lon], 19, { animate: false });
  if (m && map.hasLayer(m)) m.openPopup();
  else if (t.kind === 'ride' || t.kind === 'amenity' || t.food || t.kind === 'newfood' || t.kind === 'sponsor') L.popup(POP).setLatLng([t.lat, t.lon]).setContent(popupHtml(t)).openOn(map); // layer hidden: still show the card
  else startGuide(id);
}
function selectSuggest(li) {
  const now = Date.now();
  if (now - pickAt < 350) return;
  pickAt = now;
  const it = lastSuggest[+li.dataset.i];
  if (!it) return;
  clearTimeout(tmr);
  hideSuggest();
  if (it.type === 'food') {
    suppressAc = true;
    $('q').value = it.label;
    runSearch();
    return;
  }
  if (it.type === 'booth' && state.booths.some(b => b.id === it.id)) postSearch('booth:' + it.id);
  pinPick = true;
  suppressAc = true;
  $('q').value = it.label;
  $('q').blur();
  openTarget(it.id);
}
$('q').addEventListener('input', () => {
  clearTimeout(sgT);
  if (suppressAc) { suppressAc = false; hideSuggest(); return; }
  if (!$('q').value.trim()) { hideSuggest(); syncSearchFocus(); return; }
  syncSearchFocus();
  sgT = setTimeout(renderSuggest, 60);
});
$('q').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Escape') {
    const pop = $('popular');
    if (pop && !pop.classList.contains('hidden')) { e.preventDefault(); pop.classList.add('hidden'); }
  }
  const el = $('suggest');
  if (!el || el.classList.contains('hidden')) return;
  const lis = el.querySelectorAll('li[role="option"]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!lis.length) return;
    if (e.key === 'ArrowDown') sgActive = sgActive + 1 >= lis.length ? lis.length - 1 : sgActive + 1;
    else sgActive = sgActive <= 0 ? 0 : sgActive - 1;
    for (let i = 0; i < lis.length; i++) {
      const on = i === sgActive;
      lis[i].classList.toggle('active', on);
      if (on) lis[i].setAttribute('aria-selected', 'true'); else lis[i].removeAttribute('aria-selected');
    }
    const cur = lis[sgActive];
    if (cur) { $('q').setAttribute('aria-activedescendant', cur.id); try { cur.scrollIntoView({ block: 'nearest' }); } catch (err) {} }
  } else if (e.key === 'Enter') {
    if (sgActive >= 0 && lis[sgActive]) { e.preventDefault(); selectSuggest(lis[sgActive]); }
  } else if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); }
});
$('suggest').addEventListener('pointerdown', e => { if (e.target.closest('li[role="option"]')) e.preventDefault(); }); // keep focus; pick on click so touch can scroll the list
$('suggest').addEventListener('mousedown', e => e.preventDefault());
$('suggest').addEventListener('click', e => {
  const li = e.target.closest('li[role="option"]');
  if (li) selectSuggest(li);
});
window.__ffSuggest = { query: q => state.suggestIndex ? Suggest.query(state.suggestIndex, q) : [] };

// Share where I am: a link that guides a friend to my current GPS position.
function myspotId() { return state.me ? `meet_${state.me[0].toFixed(5)}_${state.me[1].toFixed(5)}` : null; }
$('btnShareMe').onclick = () => { const id = myspotId(); if (!id) { toast(state.gpsDenied ? 'Allow location first' : 'Waiting for GPS…'); return; } share(findTarget(id)); };

// ---------- Guide ----------
function findTarget(id) {
  const mt = /^meet_(-?\d+\.\d+)_(-?\d+\.\d+)$/.exec(id || '');
  if (mt) { const lat = +mt[1], lon = +mt[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { id, meet: true, name: '📍 Shared spot', lat, lon, location: 'approximate', area: 'A friend’s shared GPS position', products: '' }; }
  const r = (state.rides || []).find(x => x.id === id); if (r) return r;
  const b = state.booths.find(x => x.id === id); if (b) return b;
  const am = (state.amenities || []).find(x => x.id === id); if (am) return am;
  if (state.atmAlias && state.atmAlias[id]) id = state.atmAlias[id];
  const a = (state.atms || []).find(x => x.id === id); if (a) return { id: a.id, name: 'ATM', lat: a.lat, lon: a.lon, location: 'approximate', kind: 'amenity', amenityType: 'atm', area: a.area || '', products: '' };
}
function startGuide(id, resume, fromUrl) {
  hideSuggest();
  const t = findTarget(id); if (!t) return;
  const prev = state.target && state.target.id;
  state.target = t; state.arrivedShown = false; if (prev !== id) state.route = null;
  if (!fromUrl && prev !== id) setUrl({ booth: id }, true); // pushState so Back returns to the list/map
  document.title = `${t.name} · Fair Finder`;
  try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  $('results').classList.add('hidden'); $('nearPanel').classList.add('hidden'); $('favPanel').classList.add('hidden'); $('guide').classList.remove('hidden');
  document.body.classList.add('guiding');
  requestWake();
  $('guideName').textContent = t.name;
  const menu = $('guideMenu'), h3 = menu.querySelector('h3');
  if (t.kind === 'ride') {
    if (h3) h3.textContent = 'Ride (from fair listing)';
    menu.setAttribute('aria-label', 'Ride, from fair listing');
    const lines = [];
    if (t.tickets != null) lines.push(t.tickets + ' tickets (fair’s listing)');
    else if (t.cashOnly) lines.push('Cash Only' + (t.cashPrice ? ' · ' + t.cashPrice + ' (fair’s listing)' : ''));
    if (t.heightText) lines.push(t.heightText + ' (per midway operator)');
    if (t.category) lines.push(Rides.catLabel(t));
    if (t.aliases && t.aliases.length) lines.push('Lot label: ' + t.aliases.join(', '));
    $('guideMenuBody').textContent = lines.join('\n') || Rides.cardMeta(t) || '(no details listed)';
    menu.style.visibility = 'visible';
  } else {
    if (h3) h3.textContent = 'Menu (from fair listing)';
    menu.setAttribute('aria-label', 'Menu, from fair listing');
    $('guideMenuBody').textContent = (t.newFood ? 'NEW: ' + t.newFood.name + ': ' + t.newFood.description + ' | ' : '') + (t.products || '(no menu listed)');
    menu.style.visibility = t.products ? 'visible' : 'hidden';
  }
  $('guideMenu').scrollTop = 0;
  compassUi();
  // Opened from a shared link: show the full booth card once (name, menu, Share) without changing the saved preference.
  if (fromUrl && state.fromLink) { state.fromLink = false; sheet.state = 'expanded'; }
  sheet.show();
  syncGuideFav();
  syncChips();
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
  const tail = t.kind === 'ride' ? ' · fair’s published ride data' : (t.location !== 'exact' ? ' · approximate location' : ' · fair’s published booth data');
  const meta = `${t.area || ''}${t.lot ? ' · ' + t.lot : ''}${tail}`;
  $('guideMeta2').textContent = meta;
  $('guide').classList.remove('hidden'); document.body.classList.add('guiding'); // guide never hides itself
  $('guide').classList.toggle('noloc', !state.me && !!state.gpsDenied);
  if (!state.me && state.gpsDenied) {
    $('guideDist').textContent = 'Location off'; $('guideHint').textContent = 'Here is the booth on the map. Allow location (tap ◎) for directions.'; $('guideMeta').textContent = 'Location off'; $('guideUpd').textContent = '';
    if (!state.shownNoLoc) { state.shownNoLoc = true; map.setView([t.lat, t.lon], 19); }
    fitGuideDist();
    return;
  }
  if (!state.me) { $('guideDist').textContent = '—'; $('guideHint').textContent = 'Waiting for your GPS position…'; $('guideMeta').textContent = 'GPS: waiting for a fix'; $('guideUpd').textContent = 'updating…'; fitGuideDist(); return; }
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
  $('guideDist').textContent = mode === 'route' ? (Geo.fmtFeet(remaining) + ' walk · ' + mins + ' min') : (Geo.fmtFeet(d) + ' walk');
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
  fitGuideDist();
}
function fitGuideDist() {
  const el = $('guideDist');
  if (!el) return;
  const apply = () => {
    if (el.clientWidth < 20) return;
    let size = 16;
    el.style.fontSize = size + 'px';
    while (size > 10 && el.scrollWidth > el.clientWidth) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
    }
  };
  apply();
  if (el.clientWidth < 20) requestAnimationFrame(apply);
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
  const deg = Heading.readingFromEvent(e, screenAngle());
  if (deg == null) return;
  state.compass = deg; state.compassAt = Date.now(); state.compassOn = true;
  state.heading.onCompass(deg, state.compassAt, true);
  if (typeof e.webkitCompassAccuracy === 'number') state.compassAcc = e.webkitCompassAccuracy;
  if (!state._cui) { state._cui = true; compassUi(); }
  if (!state._lastG || Date.now() - state._lastG > 150) { state._lastG = Date.now(); updateGuide(); scheduleMeArrow(); }
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
$('closeNear').onclick = () => { $('nearPanel').classList.add('hidden'); syncChips(); };
$('closeFav').onclick = () => { $('favPanel').classList.add('hidden'); syncChips(); };
$('nearFilters').onclick = e => {
  const b = e.target.closest('[data-nt]'); if (!b) return;
  state.nearType = b.dataset.nt;
  $('nearFilters').querySelectorAll('.rideSub').forEach(x => {
    const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderNear();
};
$('nearList').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) startGuide(li.dataset.id); };
$('favList').onclick = e => {
  const rm = e.target.closest('.favRemove');
  if (rm) { toggleFav(rm.dataset.id); return; }
  const b = e.target.closest('button[data-id]');
  if (b) startGuide(b.dataset.id);
};
$('qaRestroom').onclick = () => goNearest('restroom');
$('qaAtm').onclick = () => goNearest('atm');
$('qaAid').onclick = () => goNearest('first_aid');
$('nearQaRestroom').onclick = () => goNearest('restroom');
$('nearQaAtm').onclick = () => goNearest('atm');
$('nearQaAid').onclick = () => goNearest('first_aid');
$('btnFav').onclick = () => { if (state.target) toggleFav(state.target.id); };
$('searchFocus').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
window.FF = { nearMe };
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js?v=79', { updateViaCache: 'none' }).then(r => r.update && r.update()).catch(() => {});
}

renderPopular();
loadData().catch(e => setStatus('Could not load booth data: ' + e.message));
})();
