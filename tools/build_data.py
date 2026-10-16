#!/usr/bin/env python3
"""Build data/booths.json from the N.C. State Fair 2026 Food & Ride Finder (fair's published booth data)
ArcGIS feature service (published by NCDA&CS, used by https://www.ncmhtd.com/foodandridefinder/).
Every booth, item and coordinate comes straight from that service. Nothing is invented."""
import json, re, sys, urllib.request, datetime
BASE = "https://services6.arcgis.com/3Sj1fiIDvQtFfbvg/arcgis/rest/services/StateFairFRFapp2026_WFL1_view/FeatureServer"
def fetch(layer):
    url = f"{BASE}/{layer}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "fair-finder"}), timeout=60) as r:
        return json.load(r)["features"]
DRINK = re.compile(r"lemonade|\btea\b|coffee|soda|drinks?\b|water|beverage|slush|smoothie|juice|shake|root beer|\bcoke\b|pepsi|milk|cider|wine|beer|mead|cocktail|frozen coffee|punch|limeade|agua", re.I)
# Whole tokens only. The old substring scan marked commercial exhibitors as food
# ("roll" in Rock 'N' Roll, "eat" in Leather, "kitchen" in Outdoor Kitchens).
_FOOD_WORDS = set("""food fried fries dog burger pizza bbq barbe chicken turkey sausage cake cream candy corn lemonade tea coffee soda drink water beverage taco empanada gyro pita donut doughnut churro cookie pie pickle fish shrimp oyster crab steak philly cheese nacho pretzel popcorn apple kettle smoothie slush juice shake wing rib pork beef rice noodle ramen kabob kebab sandwich biscuit ham bacon jerky fudge brownie waffle crepe sundae snow sno cone peanut cashew nut honey jam wine beer cider mead cocktail bakery bread roll potato tater onion mac wrap salad fruit banana strawberr chocolate caramel sweet treat snack tamale arepa curry jerk patties patty oxtail kdog corndog grill kitchen concession cafe meal plate dinner lunch breakfast vegan falafel hummus licorice milkshake hotdog funnelcake""".split())
_COMPOUND = ("corndog", "hotdog", "kdog", "milkshake", "funnelcake", "strawberr", "barbe")
_NAME_WEAK = {"roll", "water", "mac", "wing", "rib", "plate"}
def _stem_food(w):
    if w in _FOOD_WORDS: return w
    if w.startswith("winery") or w.startswith("wineries"): return "wine"
    if len(w) > 4 and w.endswith("ies") and (w[:-3] + "y") in _FOOD_WORDS: return w[:-3] + "y"
    if len(w) > 3 and w.endswith("es") and not w.endswith("ses"):
        if w[:-2] in _FOOD_WORDS: return w[:-2]
        if (w[:-2] + "e") in _FOOD_WORDS: return w[:-2] + "e"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss") and w[:-1] in _FOOD_WORDS: return w[:-1]
    for k in _COMPOUND:
        if k in w: return "strawberr" if k == "strawberr" else ("barbe" if k == "barbe" else k)
    return None
def _food_hits(text):
    ts = re.findall(r"[a-z0-9]+", (text or "").lower())
    out = []
    for i, t in enumerate(ts):
        key = _stem_food(t)
        if not key: continue
        prev = ts[i - 1] if i else ""
        if key == "roll" and prev in ("rock", "n", "and"): continue
        if key == "kitchen" and (prev == "outdoor" or "cookware" in ts): continue
        if key == "water" and "soil" in ts: continue
        if key == "fish" and any(x in ts for x in ("fishing", "hunting", "hiking", "kayaking")): continue
        if key == "dog" and any(x in ts for x in ("bandana", "bandanas", "treat", "treats")) and not any(x in ts for x in ("corn", "chili", "slaw", "hot", "cheese")): continue
        if key == "pie" and prev == "paper": continue
        if key == "wing" and ("swing" in t or prev == "soco"): continue
        out.append(key)
    if "hush" in ts and any(t.startswith("pupp") for t in ts): out.append("pie")
    return out
def is_food(name, products, kind):
    """Food when the name or menu has a real food word. newfood is not automatic (a blank new-food point stays out). Sponsors need it in the menu, not only the name."""
    prod_hits = _food_hits(products)
    if kind == "sponsor": return bool(prod_hits)
    name_hits = [h for h in _food_hits(name) if h not in _NAME_WEAK]
    return bool(prod_hits or name_hits)
def clean(s): return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip().strip(",").strip()
def split_items(s):
    parts = re.split(r"[,|;]|\s+&\s+(?=[A-Z])|\band\b(?=\s+[A-Z])|\.\s+", s or "")
    out = []
    for p in parts:
        p = clean(p).strip(".")
        if 1 < len(p) <= 80 and p.lower() not in ("null",): out.append(p)
    return out
def main():
    feats, booths = [], []
    for layer, kind in ((0, None), (1, "sponsor")):
        for f in fetch(layer): feats.append((layer, kind, f))
    counts = {}
    for layer, kind, f in feats:
        p, g = f["properties"], f["geometry"]
        ft = p.get("FEATURETYPE")
        if ft in ("Rides", "Gates"): continue
        k = kind or ("newfood" if ft == "New Foods 2026" else "vendor")
        prod = clean(p.get("PRODUCT"))
        if prod.lower() == "null": prod = ""
        new = None
        if k == "newfood":
            m = re.match(r"^\s*NEW\s+(.+?):\s*(.*?)(?:\s*\|\s*(.*))?$", prod, re.S)
            if m: new = {"name": clean(m.group(1)), "description": clean(m.group(2))}; rest = clean(m.group(3) or "")
            else: rest = prod
            items = ([new["name"]] if new else []) + split_items(rest)
        else:
            items = split_items(prod)
        name = clean(p.get("FoodRideAppName")) or clean(p.get("NAMELABEL")) or clean(p.get("CONTRACT"))
        if not name and not prod:
            counts["skipped_blank"] = counts.get("skipped_blank", 0) + 1
            continue
        text = " ".join([name, prod])
        b = {
            "id": f"L{layer}-{p['OBJECTID']}",
            "name": name,
            "kind": k,
            "operator": clean(p.get("CONTRACT")),
            "lot": clean(p.get("EVENTPRO_LOT")) or clean(p.get("LOT_LOC")),
            "area": clean(p.get("LOC_NAME")).title(),
            "mapPage": clean(p.get("MAP_PAGE")),
            "products": prod,
            "items": items,
            "newFood": new,
            "food": is_food(name, prod, k),
            "drinks": bool(DRINK.search(prod)),
            "lat": round(g["coordinates"][1], 7) if g else None,
            "lon": round(g["coordinates"][0], 7) if g else None,
            "location": "exact" if g else "unknown",
            "locationSource": "Fair's published booth data (N.C. State Fair Food & Ride Finder feature service)" if g else "No coordinates published",
        }
        counts[k] = counts.get(k, 0) + 1
        booths.append(b)
    booths.sort(key=lambda b: b["name"].lower())
    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "fair": "2026 North Carolina State Fair, Oct 15-25, 2026, State Fairgrounds, 1025 Blue Ridge Rd, Raleigh NC",
        "sources": [
            {"name": "N.C. State Fair Food & Ride Finder (published by the fair / NCDA&CS)", "url": "https://www.ncmhtd.com/foodandridefinder/"},
            {"name": "Feature service layer 0: feature_Points_WM_2026 (Vendor, New Foods 2026, Rides)", "url": BASE + "/0"},
            {"name": "Feature service layer 1: sponsor_Points_WM_2026", "url": BASE + "/1"},
            {"name": "Fair's published grounds map (cartoon) tile layer, georeferenced by the fair", "url": "https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer"},
            {"name": "Fair's published grounds map PDF", "url": "https://www.ncagr.gov/divisions/nc-state-fair/grounds-map/open"},
            {"name": "Fair Foods page", "url": "https://www.ncagr.gov/divisions/nc-state-fair/fair-foods"},
        ],
        "notes": [
            "Booth names, menu text (PRODUCT field) and coordinates are copied verbatim from the fair's published feature service. 'items' is that menu text split on commas/pipes.",
            "location='exact' means the fair's own GIS point for the booth (WGS84, reprojected by the ArcGIS server). Those points are placed by the fair on its map, typically within a few meters of the booth.",
            "'food' and 'drinks' are keyword flags computed from the fair's menu text. They are not categories published by the fair. 'food' matches whole words (and simple plurals) in the menu or a strong word in the name, not substrings, so commercial exhibitors whose name merely contains roll/eat/kitchen are not food.",
            "Rides and gates are excluded, as are placeholder points with no name and no menu text (skipped_blank). Kinds: vendor = 'Vendor' features, newfood = 'New Foods 2026' features (separate points from the vendor list, often the same operator), sponsor = sponsor layer.",
        ],
        "counts": counts,
        "booths": booths,
    }
    json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "data/booths.json", "w"), ensure_ascii=False, indent=1)
    print(counts, len(booths), sum(b["food"] for b in booths), "food;", sum(b["drinks"] for b in booths), "drinks;", sum(b["location"]=="exact" for b in booths), "exact")
if __name__ == "__main__":
    main()
