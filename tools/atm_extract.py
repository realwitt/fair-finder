#!/usr/bin/env python3
"""Locate ATM ($) icons on the official 2026 fair map tiles -> data/atms.json.
Requires opencv-python-headless, numpy, pillow. Run tools/atm_stitch.py first (writes stitch.png, level 17, 0.6 m/px).
Template: ATM icon from level-17 tile 17/51562/36878, x162 y229, 44x45 px. Matches with score >= 0.6, non-max suppressed."""
import cv2, numpy as np, math, json, urllib.request, datetime
U = "https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer/tile/17/51562/36878"
t = cv2.imdecode(np.frombuffer(urllib.request.urlopen(U).read(), np.uint8), cv2.IMREAD_COLOR)
tpl = t[229:274, 162:206]; h, w = tpl.shape[:2]
im = cv2.imread("stitch.png")
r = cv2.matchTemplate(im, tpl, cv2.TM_CCOEFF_NORMED)
ys, xs = np.where(r > 0.6); pts = []
for sc, px, py in sorted(zip(r[ys, xs], xs, ys), reverse=True):
    if all((px - qx) ** 2 + (py - qy) ** 2 > (w * 0.8) ** 2 for _, qx, qy in pts): pts.append((sc, px, py))
Z, tx0, ty0 = 17, 36874, 51560; R = 6378137; O = math.pi * R; res = 2 * O / 512 / 2 ** Z
atms = []
for i, (sc, px, py) in enumerate(pts):
    X = (tx0 * 512 + px + w / 2) * res - O; Y = O - (ty0 * 512 + py + h / 2) * res
    atms.append({"id": f"atm{i+1}", "lat": round(math.degrees(2 * math.atan(math.exp(Y / R)) - math.pi / 2), 6), "lon": round(math.degrees(X / R), 6), "location": "approximate", "matchScore": round(float(sc), 3)})
print(len(atms), "ATMs")
json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "location": "approximate",
  "source": "ATM ($) icons on the official 2026 NC State Fair grounds map tile layer (Graphic_2026_WTL1), georeferenced by the fair.",
  "method": "Template match of the ATM icon on level-17 tiles. Icon centers converted to lat/lon. Approximate (~10-30 m).", "atms": atms}, open("atms.json", "w"), indent=1)
