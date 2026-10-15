// Client-side pedestrian routing on data/walkways.json (A* / Dijkstra, no server). Browser: window.Route, Node: module.exports.
(function (root) {
  const LAT0 = 35.795, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
  const toXY = (lat, lon) => [(lon + 78.71) * KX, (lat - LAT0) * KY];
  const toLL = (x, y) => [y / KY + LAT0, x / KX - 78.71];
  const CELL = 25;
  function Graph(data) {
    const n = data.nodes.length;
    this.xy = data.nodes.map(([la, lo]) => toXY(la, lo));
    this.adj = Array.from({ length: n }, () => []);
    this.edges = [];
    this.grid = new Map();
    for (const e of data.edges) {
      const [a, b, len, f] = e, cost = len * (f || 1);
      this.adj[a].push([b, cost, len]); this.adj[b].push([a, cost, len]);
      const ei = this.edges.length; this.edges.push([a, b, cost, len]);
      const [ax, ay] = this.xy[a], [bx, by] = this.xy[b];
      for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++)
        for (let gy = Math.floor(Math.min(ay, by) / CELL); gy <= Math.floor(Math.max(ay, by) / CELL); gy++) {
          const k = gx + ',' + gy; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(ei);
        }
    }
  }
  // Snap a point to the nearest edge (projection). Returns {ei, t, x, y, d} or null if > maxD.
  Graph.prototype.snap = function (lat, lon, maxD = 80) {
    const [px, py] = toXY(lat, lon); let best = null;
    const r = Math.ceil(maxD / CELL), cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), seen = new Set();
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const l = this.grid.get((cx + dx) + ',' + (cy + dy)); if (!l) continue;
      for (const ei of l) {
        if (seen.has(ei)) continue; seen.add(ei);
        const [a, b] = this.edges[ei], [ax, ay] = this.xy[a], [bx, by] = this.xy[b];
        const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
        const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
        const x = ax + t * vx, y = ay + t * vy, d = Math.hypot(px - x, py - y);
        if (d <= maxD && (!best || d < best.d)) best = { ei, t, x, y, d };
      }
    }
    return best;
  };
  // Binary heap
  function Heap() { this.a = []; }
  Heap.prototype.push = function (k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } };
  Heap.prototype.pop = function () { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; };
  Heap.prototype.size = function () { return this.a.length; };
  // Seeds from a snap: the two endpoints of the snapped edge with partial costs.
  Graph.prototype.seeds = function (s) {
    const [a, b, cost, len] = this.edges[s.ei], f = len ? cost / len : 1;
    return [[a, s.t * len * f, s.t * len], [b, (1 - s.t) * len * f, (1 - s.t) * len]];
  };
  // Single-source Dijkstra from a snap: returns {cost: Float64Array, len: Float64Array}
  Graph.prototype.dijkstra = function (s) {
    const n = this.xy.length, cost = new Float64Array(n).fill(Infinity), len = new Float64Array(n).fill(Infinity), h = new Heap();
    for (const [v, c, l] of this.seeds(s)) if (c < cost[v]) { cost[v] = c; len[v] = l; h.push(c, v); }
    while (h.size()) { const [c, u] = h.pop(); if (c > cost[u]) continue; for (const [v, w, l] of this.adj[u]) { const nc = c + w; if (nc < cost[v]) { cost[v] = nc; len[v] = len[u] + l; h.push(nc, v); } } }
    return { cost, len };
  };
  // Walking distance (m) to a target snap given a Dijkstra result from the source snap
  Graph.prototype.walkLen = function (dj, src, dst) {
    let best = Infinity, bestCost = Infinity;
    for (const [v, c, l] of this.seeds(dst)) if (dj.cost[v] + c < bestCost) { bestCost = dj.cost[v] + c; best = dj.len[v] + l; }
    if (src.ei === dst.ei) { const [, , cost, len] = this.edges[src.ei]; const d = Math.abs(src.t - dst.t) * len; if (d * cost / len < bestCost) best = d; }
    return best + src.d + dst.d;
  };
  // A* route between two lat/lon points. Returns {points:[[lat,lon]...], lengthM, snapFrom, snapTo} or null.
  Graph.prototype.route = function (fromLL, toLL_, opt = {}) {
    const s = this.snap(fromLL[0], fromLL[1], opt.maxSnap || 80), t = this.snap(toLL_[0], toLL_[1], opt.maxSnap || 80);
    if (!s || !t) return null;
    // v7: the route starts AT the snap point on the walkway, not at the raw GPS fix. The perpendicular hop from a noisy
    // fix onto the path used to create a fake sharp corner a few metres ahead ("in under 30 ft turn left").
    const pts = [toLL(s.x, s.y)];
    if (s.ei !== t.ei) {
      const n = this.xy.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), h = new Heap(), [tx, ty] = [t.x, t.y];
      const H = v => Math.hypot(this.xy[v][0] - tx, this.xy[v][1] - ty);
      for (const [v, c] of this.seeds(s)) if (c < g[v]) { g[v] = c; h.push(c + H(v), v); }
      const goal = new Map(this.seeds(t).map(([v, c]) => [v, c]));
      let best = Infinity, bestV = -1;
      while (h.size()) {
        const [f, u] = h.pop(); if (f >= best) break;
        if (goal.has(u) && g[u] + goal.get(u) < best) { best = g[u] + goal.get(u); bestV = u; }
        for (const [v, w] of this.adj[u]) { const nc = g[u] + w; if (nc < g[v]) { g[v] = nc; prev[v] = u; h.push(nc + H(v), v); } }
      }
      if (bestV < 0) return null;
      const path = []; for (let v = bestV; v >= 0; v = prev[v]) path.push(v);
      path.reverse(); for (const v of path) pts.push(toLL(this.xy[v][0], this.xy[v][1]));
    }
    pts.push(toLL(t.x, t.y)); pts.push(toLL_);
    const clean = [pts[0]];
    for (const p of pts.slice(1)) { const q = clean[clean.length - 1]; if (dist(p, q) > 0.5) clean.push(p); }
    return { points: clean, lengthM: polyLen(clean), snapFrom: s, snapTo: t, startOffsetM: s.d };
  };
  function dist(a, b) { const [ax, ay] = toXY(a[0], a[1]), [bx, by] = toXY(b[0], b[1]); return Math.hypot(ax - bx, ay - by); }
  function polyLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; }
  // Project a point onto a polyline: {d (m off-route), along (m from start), seg}
  function project(poly, ll) {
    const [px, py] = toXY(ll[0], ll[1]); let best = { d: Infinity, along: 0, seg: 0 }, acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const [ax, ay] = toXY(poly[i - 1][0], poly[i - 1][1]), [bx, by] = toXY(poly[i][0], poly[i][1]);
      const vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy), t = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (L * L))) : 0;
      const d = Math.hypot(px - ax - t * vx, py - ay - t * vy);
      if (d < best.d) best = { d, along: acc + t * L, seg: i - 1 };
      acc += L;
    }
    return best;
  }
  // Like project(), but prefers the candidate near the previous along-position (stops the arrow jumping back to an
  // earlier, nearby leg of the route when the path doubles back). Going back > 12 m costs a 15 m penalty.
  function projectNear(poly, ll, prevAlong) {
    if (prevAlong == null) return project(poly, ll);
    const [px, py] = toXY(ll[0], ll[1]); let best = null, acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const [ax, ay] = toXY(poly[i - 1][0], poly[i - 1][1]), [bx, by] = toXY(poly[i][0], poly[i][1]);
      const vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy), t = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (L * L))) : 0;
      const d = Math.hypot(px - ax - t * vx, py - ay - t * vy), along = acc + t * L;
      const score = d + (along < prevAlong - 12 ? 15 : 0);
      if (!best || score < best.score) best = { d, along, seg: i - 1, score };
      acc += L;
    }
    return best;
  }
  function pointAt(poly, along) {
    let acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const L = dist(poly[i - 1], poly[i]);
      if (acc + L >= along) { const t = L ? (along - acc) / L : 0; return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * t, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * t]; }
      acc += L;
    }
    return poly[poly.length - 1];
  }
  function bearing(a, b) { const [ax, ay] = toXY(a[0], a[1]), [bx, by] = toXY(b[0], b[1]); return (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360; }
  // Next significant turn after 'along': {inM, turnDeg (+right), at} or null. Looks at heading change over ~8 m windows.
  function nextTurn(poly, along, minTurn = 35) {
    const total = polyLen(poly);
    for (let s = along + 6; s < total - 4; s += 3) {
      const a = pointAt(poly, s - 8 < along ? along : s - 8), m = pointAt(poly, s), b = pointAt(poly, Math.min(total, s + 8));
      if (dist(a, m) < 3 || dist(m, b) < 3) continue;
      const turn = ((bearing(m, b) - bearing(a, m) + 540) % 360) - 180;
      if (Math.abs(turn) >= minTurn) return { inM: s - along, turnDeg: turn, at: m };
    }
    return null;
  }
  function turnWord(t) { const a = Math.abs(t), side = t > 0 ? 'right' : 'left'; return a < 60 ? 'bear ' + side : a < 135 ? 'turn ' + side : 'make a U-turn'; }
  const api = { Graph, project, projectNear, pointAt, polyLen, nextTurn, turnWord, bearing, dist, toXY, toLL };
  if (typeof module !== 'undefined') module.exports = api; else root.Route = api;
})(this);
