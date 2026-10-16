#!/usr/bin/env python3
"""Build data/amenities.json from the researched /workspace/ff-amenities/amenities.json.

Rules (v7.5): use the fair's 2026 grounds-map icon points for every type; for the
restrooms that match a 2022 NCDA&CS GIS restroom point ("Likely same as: fandr22-…"),
use the more precise 2022 position. OSM building centroids are not used.
All positions are labelled 'approximate location'.
"""
import json, re, sys, datetime
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/ff-amenities/amenities.json'
OUT = 'data/amenities.json'
raw = json.load(open(SRC))
by_id = {a['id']: a for a in raw}
LABEL = {'restroom': 'Restrooms', 'atm': 'ATM', 'first_aid': 'First Aid', 'nursing_room': "Mothers' Room (nursing)",
         'information': 'Information', 'lost_and_found': 'Lost & Found (Reconnection Center)',
         'wheelchair_rental': 'Wheelchair & Stroller Rental'}
out, used22 = [], set()
for a in raw:
    if a['source'] != 'grounds_map_2026_icons':
        continue
    lat, lon, pos = a['lat'], a['lon'], 'grounds_map_2026'
    if a['type'] == 'restroom':
        m = re.search(r'(fandr22-restroom-\d+)', a.get('note', ''))
        if m and m.group(1) in by_id:
            assert m.group(1) not in used22, m.group(1)
            used22.add(m.group(1)); b = by_id[m.group(1)]; lat, lon, pos = b['lat'], b['lon'], 'ncda_gis_2022'
    area = re.search(r'Nearest booth area: ([^.]+)\.', a.get('note', ''))
    n = sum(1 for x in out if x['type'] == a['type']) + 1
    raw_area = area.group(1).strip() if area else ''
    # "Hv" and other 1–2 letter scraps are not place names. A later pass fills those from booths.
    if len(raw_area) < 3 or raw_area.lower() in ('hv', 'ch', 'l'): raw_area = ''
    out.append({'id': 'am-' + a['type'].replace('_', '-') + '-' + str(n), 'type': a['type'], 'name': LABEL[a['type']],
                'area': raw_area, 'lat': round(lat, 6), 'lon': round(lon, 6),
                'location': 'approximate', 'position_source': pos})
assert len(used22) == 10, used22
def _fill_areas(rows):
    """Blank or 'Hv' areas take the nearest booth or ride area that is a real place name."""
    import math
    bad = {'', 'hv', 'ch', 'l'}
    def ok(area):
        a = (area or '').strip()
        return len(a) >= 3 and a.lower() not in bad
    pool = []
    for path in ('data/booths.json', 'data/rides.json'):
        try:
            blob = json.load(open(path))
        except OSError:
            continue
        for row in blob.get('booths') or blob.get('rides') or []:
            if row.get('lat') is None or not ok(row.get('area')): continue
            pool.append(row)
    def meters(a, b):
        return math.hypot((a['lat'] - b['lat']) * 111320, (a['lon'] - b['lon']) * 111320 * math.cos(math.radians(a['lat'])))
    for row in rows:
        if ok(row.get('area')): continue
        near = min(pool, key=lambda p: meters(row, p), default=None)
        if near: row['area'] = near['area']
_fill_areas(out)
json.dump({'generated': datetime.date.today().isoformat(),
           'source': "Icons on the fair's published 2026 grounds map (Graphic_2026_WTL1); 10 restrooms use the NCDA&CS 2022 restroom GIS layer position. See tools/build_amenities.py.",
           'location': 'approximate', 'amenities': out}, open(OUT, 'w'), indent=1)
print(len(out), {t: sum(1 for x in out if x['type'] == t) for t in LABEL})
