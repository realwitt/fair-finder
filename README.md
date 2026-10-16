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

## v7.3.1: hotfix (UX test findings)
- Every ride now has Kiddie/Family/Thrill. Rides the operator's lists don't categorize got one estimated from the well-known ride type (`category_source: "estimated"` in `tools/ride_details.json` / `data/rides.json`); cards show them as e.g. "Thrill (est.)". Cash Only rides show the fair's listed cash price (`cashPrice`, from the fair's `PRODUCT` field) where there is one.
- Autocomplete: the dropdown sits above every sheet, is capped to the visual viewport (above the iOS keyboard) and the guide sheet, and scrolls; the results sheet steps aside while it's open. Picking a booth/ride suggestion pans to it and opens its card (Guide me here / Share). Same-name booths show their lot.
- 🎡 Rides chip is first, shows as selected, and a second tap turns it off. "1 result" singular. The ride list fits the map to all listed rides.
- **Likely matches** (`concepts.js` + `data/synonyms.json`): a plain-JSON concept map, also meant for the MCP server. `ride_types` (type → label + terms, e.g. pirate ship, drop tower, ferris wheel, coaster, carousel, fun house, swings, bumper cars, slide, dark ride), `rides` (every ride id → its types, assigned by hand), `foods` (concept → synonyms/spellings, e.g. slush/slushie/icee/frozen drink). Search and autocomplete show direct hits first, then up to 5 "Likely matches" (30 if there are no direct hits) that aren't already direct, and none when the query is an exact name. Regenerated from the hand-reviewed lists in the commit (no build step at runtime).

## v7.4: AI connector (MCP)
`mcp/` is a read-only, no-auth remote MCP server (Cloudflare Worker) at https://mcp.fairfinder.birbol.com/mcp (also https://fair-finder-mcp.lively-shape-f373.workers.dev/mcp) with tools `search`, `get_details`, `nearby`, `popular_now`. It bundles the same `data/booths.json`, `data/rides.json`, `data/synonyms.json`, `search.js`, `suggest.js` and `concepts.js` at build time (`node mcp/build.mjs`), so the app and AI connectors agree (direct + likely tiers). See `mcp/README.md`.

## v7.5
Near me (walking-distance list of food, rides and amenities), Favorites (local only), amenities layer + search + "Nearest restroom / ATM / first aid" (data/amenities.json, built by tools/build_amenities.py from the fair's 2026 grounds-map icons; approximate), navigation arrow for the you-are-here marker (heading.js: GPS course while walking, compass when stopped), search tightening for exact synonym terms, list Share carries only q=. MCP 1.1.0 adds amenities.
