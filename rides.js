// Ride helpers. Browser: window.Rides. Node: module.exports.
(function (root) {
  function prepare(ride) {
    ride.kind = 'ride';
    ride.products = '';
    ride.items = [];
    return ride;
  }
  // 'Thrill (per midway operator)' or, for categories we estimated from the ride type, 'Thrill (est.)'.
  function catLabel(r) {
    if (!r || !r.category) return '';
    const c = r.category.charAt(0).toUpperCase() + r.category.slice(1);
    return c + (r.category_source === 'estimated' ? ' (est.)' : ' (per midway operator)');
  }
  function payText(r) {
    if (r.tickets != null) return r.tickets + ' ticket' + (r.tickets === 1 ? '' : 's');
    if (r.cashOnly) return 'Cash Only' + (r.cashPrice ? ' · ' + r.cashPrice : '');
    return '';
  }
  // Primary line is the fair's area + ticket count (or Cash Only + price). Height and category are secondary.
  function cardMeta(r) {
    const pay = payText(r);
    const lines = [];
    const head = [r.area, pay].filter(Boolean).join(' · ');
    if (head) lines.push(head);
    if (r.heightText) lines.push(r.heightText + ' (per midway operator)');
    if (r.category) lines.push(catLabel(r));
    return lines.join('\n');
  }
  function filter(rides, sub) {
    const list = rides || [];
    if (!sub || sub === 'all') return list.slice();
    const out = [];
    for (let i = 0; i < list.length; i++) if (list[i].category === sub) out.push(list[i]);
    return out;
  }
  const api = { prepare, cardMeta, filter, catLabel, payText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rides = api;
})(typeof window !== 'undefined' ? window : this);
