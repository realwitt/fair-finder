# Fair Finder: NC State Fair 2026 food finder

A mobile-first static web app for finding food at the 2026 N.C. State Fair (Oct 15–25, Raleigh). Search a food, see matching booths nearest-first, and tap one to get a big guide arrow, a distance in feet, and a line on the map.

## Data (all from official sources, nothing invented)
- **Booths and menus**: the fair's official *Food & Ride Finder* ArcGIS feature service (`StateFairFRFapp2026_WFL1_view`, layers 0 and 1), the data behind https://www.ncmhtd.com/foodandridefinder/. Every booth has the fair's own GIS point, so locations are exact. Run `python3 tools/build_data.py data/booths.json` to refresh.
- **Official map overlay**: the fair's own georeferenced tile cache of the 2026 grounds map (`Graphic_2026_WTL1`, Web Mercator, 512px tiles). It's the same artwork as the [grounds map PDF](https://www.ncagr.gov/divisions/nc-state-fair/grounds-map/open), already aligned by the fair, so no hand-picked control points are needed.
- **ATMs** (`data/atms.json`): the ATM ($) icons template-matched on the official map tiles (see `tools/atm_extract.py`). Positions are **approximate**, because they are icon positions on a cartoon map.
- **Drinks**: booths whose official menu text mentions beverages. The fair does not publish water refill station locations, and the app says so.

## Dev
`python3 -m http.server` then open http://localhost:8000 (geolocation works on localhost; the deployed site needs HTTPS).
