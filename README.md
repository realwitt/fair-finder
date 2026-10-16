# Fair Finder: NC State Fair 2026 food finder

A mobile-first static web app for finding food at the 2026 N.C. State Fair (Oct 15–25, Raleigh). Search a food, see matching booths nearest-first, and tap one to get a big guide arrow, a distance in feet, and a line on the map.

## Data (all from the fair's published sources and OpenStreetMap, nothing invented)
- **Booths and menus**: the fair's published *Food & Ride Finder* ArcGIS feature service (`StateFairFRFapp2026_WFL1_view`, layers 0 and 1), the data behind https://www.ncmhtd.com/foodandridefinder/. Every booth has the fair's own GIS point, so locations are exact. Run `python3 tools/build_data.py data/booths.json` to refresh.
- **Grounds map overlay**: the fair's own georeferenced tile cache of the 2026 grounds map (`Graphic_2026_WTL1`, Web Mercator, 512px tiles). It's the same artwork as the [grounds map PDF](https://www.ncagr.gov/divisions/nc-state-fair/grounds-map/open), already aligned by the fair, so no hand-picked control points are needed.
- **ATMs** (`data/atms.json`): the ATM ($) icons template-matched on the fair's published grounds map tiles (see `tools/atm_extract.py`). Positions are **approximate**, because they are icon positions on a cartoon map.
- **Drinks**: booths whose fair menu text mentions beverages. The fair does not publish water refill station locations, and the app says so.

## Dev
`python3 -m http.server` then open http://localhost:8000 (geolocation works on localhost; the deployed site needs HTTPS).

## Walking routes
`data/walkways.json` is built by `tools/build_walkways.py` from OpenStreetMap (ODbL): footways, service roads and paths inside the fairgrounds polygon (OSM way 267485236), densified to 12 m. Straight connectors (≤30 m) are added across open ground where they don't cross buildings or water, and segments near booth points cost more. The fair's ArcGIS org publishes no walkway layer (checked: only the Food & Ride Finder layers). Routing runs on the phone with A* for the route and one Dijkstra pass for walking-distance sorting. Routes are approximate because OSM doesn't show this year's temporary booth layout.

## v7
- Guide is a non-modal bottom sheet with two fixed-height snap points (collapsed 104 px bar / expanded). It slides with `transform` only; tap, drag or keyboard (Enter/Space, ↑/↓) on the handle; the last choice is remembered. The map is resized to the visible area, and each new route is fitted above the bar when collapsed.
- React Aria `Sheet` (react-aria-components 1.22) was evaluated: it's a modal Dialog (page underneath becomes inert) and adds ~92 KB gzip with React, so a small custom sheet is used instead.
- Arrow/hint fix: routes start at the snapped point on the walkway, the look-ahead stops at the next corner, and the hint is derived from the same bearing as the arrow.
- Landing page: `about/`. OSM is the default base map; satellite shows Esri attribution and is not in the offline download. OSM tiles are cached only as long as their own Cache-Control/Expires headers allow.

## Unofficial
Fair Finder is an independent, free project. It is not affiliated with, endorsed by, or sponsored by the N.C. State Fair or the N.C. Department of Agriculture & Consumer Services. For official information, see https://www.ncstatefair.org/.

## v7.3: rides + autocomplete
- **Rides** (`data/rides.json`, bundled like booths; rebuild with `python3 tools/build_rides.py`): the fair's Food & Ride Finder layer 0, `FEATURETYPE='Rides'` (99) plus OBJECTID 1335 "Super Slide". Names are `FoodRideAppName` (what the fair's app shows); lot/contract labels are search aliases. Tickets come from the fair's `TICKETS` field (-1 = "Cash Only"). Heights/categories in `tools/ride_details.json` come from the midway operator's (Powers Great American Midways) published lists and are shown as approximate, "per midway operator". Ride ids use the same `L0-<objectid>` scheme, so `?booth=` and `/b/<id>.html` share links work for rides.
- **Autocomplete** (`suggest.js`): booths, rides and foods as you type; normalized for case/spacing/hyphens/punctuation, prefix + token matching, light typo tolerance, aliases ranked below public names ("aka …").
