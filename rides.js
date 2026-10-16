// Ride helpers. Browser: window.Rides. Node: module.exports.
(function (root) {
  function prepare(ride) {
    ride.kind = 'ride';
    ride.products = '';
    ride.items = [];
    return ride;
  }
  // Primary line is the fair's area + ticket count (or Cash Only). Height and category are secondary.
  function cardMeta(r) {
    const pay = r.tickets != null ? (r.tickets + ' ticket' + (r.tickets === 1 ? '' : 's')) : (r.cashOnly ? 'Cash Only' : '');
    const lines = [];
    const head = [r.area, pay].filter(Boolean).join(' · ');
    if (head) lines.push(head);
    if (r.heightText) lines.push(r.heightText + ' (per midway operator)');
    if (r.category) lines.push(r.category + ' (per midway operator)');
    return lines.join('\n');
  }
  function filter(rides, sub) {
    const list = rides || [];
    if (!sub || sub === 'all') return list.slice();
    const out = [];
    for (let i = 0; i < list.length; i++) if (list[i].category === sub) out.push(list[i]);
    return out;
  }
  const api = { prepare, cardMeta, filter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rides = api;
})(typeof window !== 'undefined' ? window : this);
