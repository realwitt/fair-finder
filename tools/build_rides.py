#!/usr/bin/env python3
"""Build data/rides.json from the fair's published Food & Ride Finder layer (FEATURETYPE='Rides' + OBJECTID 1335 'Super Slide').
Public name = FoodRideAppName (what the official app shows). Lot/contract labels become search aliases.
TICKETS=-1 means 'Cash Only'. Optional details (category, height) are merged from tools/ride_details.json
(midway operator Powers Great American Midways' published lists; approximate, shown as 'per midway operator').
category_source: 'operator' (from those lists) or 'estimated' (v7.3.1: assigned from the well-known ride type for rides the
operator lists don't categorize; shown as e.g. 'Thrill (est.)'). cashPrice: the fair's PRODUCT price for Cash Only rides."""
import json, re, sys, urllib.request, urllib.parse, datetime, os
SVC = "https://services6.arcgis.com/3Sj1fiIDvQtFfbvg/arcgis/rest/services/StateFairFRFapp2026_WFL1_view/FeatureServer/0"
q = urllib.parse.urlencode({"where": "FEATURETYPE='Rides' OR OBJECTID=1335", "outFields": "OBJECTID,FoodRideAppName,NAMELABEL,CONTRACT,LOC_NAME,LOT_LOC,TICKETS,PRODUCT,FEATURETYPE,MAP_PAGE", "outSR": 4326, "f": "geojson"})
g = json.load(urllib.request.urlopen(SVC + "/query?" + q, timeout=60))
here = os.path.dirname(os.path.abspath(__file__))
det = json.load(open(os.path.join(here, "ride_details.json")))
nrm = lambda s: re.sub(r"[^a-z0-9]+", "", (s or "").lower())
title = lambda s: re.sub(r"[a-z]+", lambda m: m.group(0).capitalize(), " ".join((s or "").lower().split()))
rides = []
for f in g["features"]:
    p = f["properties"]; oid = p["OBJECTID"]; lon, lat = f["geometry"]["coordinates"]
    name = (p.get("FoodRideAppName") or p.get("NAMELABEL") or "").strip()
    if not name: continue
    d = det.get(str(oid), {})
    aliases = []
    for a in (p.get("NAMELABEL"), p.get("CONTRACT")):
        a = (a or "").strip()
        if a and nrm(a) != nrm(name) and nrm(a) not in [nrm(x) for x in aliases]: aliases.append(title(a))
    t = p.get("TICKETS")
    rides.append({"id": f"L0-{oid}", "name": name, "kind": "ride", "aliases": aliases,
        "area": d.get("area") or title(p.get("LOC_NAME")), "lot": None,
        "tickets": t if isinstance(t, (int, float)) and t > 0 else None, "cashOnly": t == -1,
        "category": d.get("category"), "category_source": d.get("category_source") if d.get("category") else None,
        "cashPrice": d.get("cashPrice") if t == -1 else None, "heightText": d.get("heightText"),
        "lat": round(lat, 7), "lon": round(lon, 7), "location": "exact"})
rides.sort(key=lambda r: r["name"].lower())
out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "source": {"name": "N.C. State Fair Food & Ride Finder, layer 0 (FEATURETYPE='Rides', plus OBJECTID 1335 'Super Slide')", "url": SVC},
       "detailsSource": {"name": "Powers Great American Midways ride lists (midway operator; approximate)", "url": "https://powersgreatamericanmidways.com/qr/measure-up.htm"},
       "rides": rides}
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "data/rides.json", "w"), indent=1, ensure_ascii=False)
print(len(rides), "rides")
