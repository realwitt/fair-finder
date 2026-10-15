#!/usr/bin/env python3
"""Build data/walkways.json: a pedestrian graph for the NC State Fairgrounds.
Sources: OpenStreetMap (© OpenStreetMap contributors, ODbL) via the OSM API map call for the fairgrounds bbox,
plus the fair's published booth points (data/booths.json) used as soft obstacles.
- Edges: OSM highway=footway/path/steps/pedestrian/service/residential/unclassified/tertiary/cycleway/living_street/track/construction
  inside the fairgrounds polygon (way 267485236) buffered by 40 m (catches gate approaches).
- Segments whose midpoint is inside an OSM building or water area (the pond) are dropped (you can't walk through Dorton Arena).
- Sparse areas: extra straight 'connector' edges join graph nodes 6-30 m apart (max 2 per node, after densifying ways to 12 m) when the straight line crosses no building
  (lawns, plazas, parking lots turned midway). Cost x1.25 so real paths are preferred.
- Booth points: segments passing within 3 m of a booth point cost x2 (booth pads/trucks often sit on aisles).
- Only the largest connected component is kept."""
import json, math, os, sys, urllib.request, collections, datetime
OSM = "/workspace/route/osmmap.json"
if not os.path.exists(OSM):
    os.makedirs(os.path.dirname(OSM), exist_ok=True)
    urllib.request.urlretrieve("https://api.openstreetmap.org/api/0.6/map.json?bbox=-78.7225,35.7890,-78.7030,35.8010", OSM)
d = json.load(open(OSM)); booths = json.load(open("data/booths.json"))["booths"]
nodes = {e["id"]: (e["lat"], e["lon"]) for e in d["elements"] if e["type"] == "node"}
ways = [e for e in d["elements"] if e["type"] == "way"]
LAT0 = 35.795; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574
xy = lambda ll: ((ll[1] + 78.71) * KX, (ll[0] - LAT0) * KY)
def pip(pt, poly):
    x, y = pt; ins = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: ins = not ins
    return ins
def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)
def seg_cross(a, b, c, e):
    o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return (o(a, b, c) * o(a, b, e) < 0) and (o(c, e, a) * o(c, e, b) < 0)
fair = next(w for w in ways if w["id"] == 267485236); fpoly = [xy(nodes[n]) for n in fair["nodes"]]
def in_fair(p, buf=40):
    if pip(p, fpoly): return True
    return min(seg_dist(p, fpoly[i - 1], fpoly[i]) for i in range(len(fpoly))) < buf
buildings = []
for w in ways:
    t = w.get("tags", {})
    if ("building" in t or t.get("natural") == "water" or t.get("water") or t.get("landuse") == "basin") and w["nodes"][0] == w["nodes"][-1]:
        poly = [xy(nodes[n]) for n in w["nodes"] if n in nodes]
        if len(poly) > 3 and in_fair(poly[0], 80):
            xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
            buildings.append((poly, (min(xs), min(ys), max(xs), max(ys)), t.get("name")))
def in_building(p):
    return any(bb[0] <= p[0] <= bb[2] and bb[1] <= p[1] <= bb[3] and pip(p, poly) for poly, bb, _ in buildings)
def crosses_building(a, b):
    mnx, mxx, mny, mxy = min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])
    for poly, bb, _ in buildings:
        if bb[2] < mnx or bb[0] > mxx or bb[3] < mny or bb[1] > mxy: continue
        for i in range(len(poly)):
            if seg_cross(a, b, poly[i - 1], poly[i]): return True
        if pip(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), poly): return True
    return False
OK = {"footway", "path", "steps", "pedestrian", "service", "residential", "unclassified", "tertiary", "cycleway", "living_street", "track", "construction"}
bpts = [xy((b["lat"], b["lon"])) for b in booths if b["lat"]]
grid = collections.defaultdict(list)
for p in bpts: grid[(int(p[0] // 10), int(p[1] // 10))].append(p)
def near_booth(a, b, r=3):
    cx0, cx1 = int(min(a[0], b[0]) // 10) - 1, int(max(a[0], b[0]) // 10) + 1
    cy0, cy1 = int(min(a[1], b[1]) // 10) - 1, int(max(a[1], b[1]) // 10) + 1
    return any(seg_dist(p, a, b) < r for gx in range(cx0, cx1 + 1) for gy in range(cy0, cy1 + 1) for p in grid.get((gx, gy), ()))
edges = {}; used = set(); kinds = collections.Counter()
for w in ways:
    t = w.get("tags", {}); hw = t.get("highway")
    if hw not in OK or t.get("access") in ("no",) or t.get("foot") == "no": continue
    ns = [n for n in w["nodes"] if n in nodes]
    for a, b in zip(ns, ns[1:]):
        pa, pb = xy(nodes[a]), xy(nodes[b]); mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
        if not (in_fair(pa) or in_fair(pb)): continue
        if in_building(mid) and t.get("indoor") != "yes": continue
        # densify to <=12 m pieces so connectors and snapping can attach mid-segment
        Ltot = math.hypot(pa[0] - pb[0], pa[1] - pb[1]); k = max(1, math.ceil(Ltot / 12)); prev = a
        for j in range(1, k + 1):
            if j == k: cur = b
            else:
                cur = ("v", a, b, j); nodes[cur] = (nodes[a][0] + (nodes[b][0] - nodes[a][0]) * j / k, nodes[a][1] + (nodes[b][1] - nodes[a][1]) * j / k)
            p1, p2 = xy(nodes[prev]), xy(nodes[cur]); L = math.hypot(p1[0] - p2[0], p1[1] - p2[1])
            f = 2.0 if near_booth(p1, p2) else 1.0
            edges[(prev, cur)] = (L, f, hw); used.update((prev, cur)); prev = cur
        kinds[hw] += 1
# connectors for sparse areas
U = list(used); P = {n: xy(nodes[n]) for n in U}
cg = collections.defaultdict(list)
for n in U: cg[(int(P[n][0] // 30), int(P[n][1] // 30))].append(n)
adj = collections.defaultdict(set)
for a, b in edges: adj[a].add(b); adj[b].add(a)
# connectors only from nodes that are not on the same OSM way run (avoid pointless shortcuts): skip if already 2 hops apart
nconn = 0
for n in U:
    gx, gy = int(P[n][0] // 30), int(P[n][1] // 30)
    cand = [m for dx in (-1, 0, 1) for dy in (-1, 0, 1) for m in cg.get((gx + dx, gy + dy), ()) if str(m) > str(n) and m not in adj[n]]
    cand.sort(key=lambda m: math.hypot(P[n][0] - P[m][0], P[n][1] - P[m][1]))
    k = 0
    for m in cand:
        L = math.hypot(P[n][0] - P[m][0], P[n][1] - P[m][1])
        if L > 30 or k >= 2: break
        if L < 6: continue
        if any(m in adj[x] for x in adj[n]) or crosses_building(P[n], P[m]) or not in_fair(((P[n][0] + P[m][0]) / 2, (P[n][1] + P[m][1]) / 2), 10): continue
        edges[(n, m)] = (L, 1.25 * (2.0 if near_booth(P[n], P[m]) else 1.0), "connector"); adj[n].add(m); adj[m].add(n); k += 1; nconn += 1
# largest component
seen = {}; comps = []
for n in adj:
    if n in seen: continue
    st = [n]; seen[n] = len(comps); c = [n]
    while st:
        x = st.pop()
        for y in adj[x]:
            if y not in seen: seen[y] = len(comps); st.append(y); c.append(y)
    comps.append(c)
big = set(max(comps, key=len))
idx = {}; out_nodes = []
for n in sorted(big, key=str): idx[n] = len(out_nodes); out_nodes.append([round(nodes[n][0], 6), round(nodes[n][1], 6)])
out_edges = [[idx[a], idx[b], round(L, 1), f] + ([1] if hw == "connector" else []) for (a, b), (L, f, hw) in edges.items() if a in big and b in big]
out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
  "source": "OpenStreetMap contributors (ODbL), OSM API map call for bbox -78.7225,35.7890,-78.7030,35.8010; fairgrounds polygon = OSM way 267485236. Booth points from the fair's published booth data used as soft obstacles.",
  "approximate": True,
  "notes": ["OSM paths reflect the permanent fairgrounds, not this year's temporary booth layout, so routes are approximate.",
            "Edge format: [nodeA, nodeB, length_m, costFactor, (1 = straight connector across open ground)]. costFactor 2 = passes within 3 m of a booth point."],
  "stats": {"nodes": len(out_nodes), "edges": len(out_edges), "connectors": sum(1 for e in out_edges if len(e) > 4), "osmSegmentsByType": dict(kinds), "components": len(comps), "buildingsAsObstacles": len(buildings)},
  "nodes": out_nodes, "edges": out_edges}
json.dump(out, open("data/walkways.json", "w"), separators=(",", ":"))
print(out["stats"], os.path.getsize("data/walkways.json") // 1024, "KB")
