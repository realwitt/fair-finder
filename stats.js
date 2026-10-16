// Anonymous arrival + daily-cap helpers. No network. UMD, same shape as geo.js.
(function (root) {
  const Geo = (typeof require === 'function') ? require('./geo.js') : root.Geo;
  const CHIP_KEYS = ['hot-dog', 'corn-dog', 'turkey-leg', 'funnel-cake', 'fried-cheeseburger', 'empanada', 'lemonade', 'ice-cream', 'bbq', 'new'];
  const Q_TO_KEY = {
    'hot dog': 'hot-dog',
    'corn dog': 'corn-dog',
    'turkey leg': 'turkey-leg',
    'funnel cake': 'funnel-cake',
    'fried cheeseburger': 'fried-cheeseburger',
    empanada: 'empanada',
    lemonade: 'lemonade',
    'ice cream': 'ice-cream',
    bbq: 'bbq',
    new: 'new',
  };
  const ARRIVE_M = 15, OUTSIDE_M = 30, MAX_ACC_M = 25, DWELL_MS = 8000, PREFILTER_M = 60;

  function chipKey(dataQ) {
    if (typeof dataQ !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(Q_TO_KEY, dataQ) ? Q_TO_KEY[dataQ] : null;
  }

  function localDay(ts) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ts));
    let y = '', m = '', d = '';
    for (const p of parts) {
      if (p.type === 'year') y = p.value;
      else if (p.type === 'month') m = p.value;
      else if (p.type === 'day') d = p.value;
    }
    return y + '-' + m + '-' + d;
  }

  function capPrefix(day) { return 'ff.cap.' + day + '.'; }

  function capPrune(storage, day) {
    const keep = capPrefix(day);
    const drop = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.indexOf('ff.cap.') === 0 && k.indexOf(keep) !== 0) drop.push(k);
    }
    for (let i = 0; i < drop.length; i++) storage.removeItem(drop[i]);
  }

  function capHas(storage, id, ts) {
    const day = localDay(ts);
    capPrune(storage, day);
    return storage.getItem(capPrefix(day) + id) === '1';
  }

  function capMark(storage, id, ts) {
    const day = localDay(ts);
    capPrune(storage, day);
    storage.setItem(capPrefix(day) + id, '1');
  }

  function filterCount(items) {
    const out = [];
    const list = items || [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it && typeof it.n === 'number' && it.n >= 5) out.push(it);
    }
    return out;
  }

  function panelMode(items) {
    return filterCount(items).length >= 3 ? 'live' : 'chips';
  }

  function createTracker(booths) {
    const list = [];
    for (const b of booths || []) {
      if (b && b.id && b.lat != null && b.lon != null) list.push(b);
    }
    const st = new Map();
    function slot(id) {
      let s = st.get(id);
      if (!s) { s = { armed: false, counted: false, dwellStart: null, fixes: 0 }; st.set(id, s); }
      return s;
    }
    function markOutside(s) {
      s.armed = true;
      s.counted = false;
      s.dwellStart = null;
      s.fixes = 0;
    }
    function onFix(lat, lon, acc, now) {
      if (typeof acc !== 'number' || !(acc <= MAX_ACC_M)) return null;
      let best = null, bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const d = Geo.distanceM(lat, lon, b.lat, b.lon);
        if (d > PREFILTER_M) {
          if (st.has(b.id)) markOutside(st.get(b.id));
          continue;
        }
        const s = slot(b.id);
        if (d > OUTSIDE_M) {
          markOutside(s);
          continue;
        }
        if (d > ARRIVE_M) {
          s.dwellStart = null;
          s.fixes = 0;
          continue;
        }
        if (!s.armed || s.counted) continue;
        if (s.dwellStart == null) { s.dwellStart = now; s.fixes = 1; continue; }
        s.fixes += 1;
        if (s.fixes >= 2 && now - s.dwellStart >= DWELL_MS) {
          s.counted = true;
          s.armed = false;
          s.dwellStart = null;
          s.fixes = 0;
          if (d < bestD) { bestD = d; best = b.id; }
        }
      }
      return best;
    }
    return { onFix: onFix };
  }

  const api = { CHIP_KEYS, chipKey, createTracker, localDay, capHas, capMark, filterCount, panelMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
