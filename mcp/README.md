# Fair Finder MCP

Unofficial read-only guide to the 2026 N.C. State Fair (October 15–25, Raleigh). This server is not affiliated with or endorsed by the N.C. State Fair or NCDA&CS.

Official fair info: https://www.ncstatefair.org/

The map and walking directions live in the Fair Finder app: https://realwitt.github.io/fair-finder/

## Endpoint

`https://fair-finder-mcp.lively-shape-f373.workers.dev/mcp`

Stateless streamable HTTP. POST a JSON-RPC body and receive one JSON response. There is no SSE stream and no session id. `GET /mcp` returns 405. `GET /` returns a short health document. `POST /` is the same RPC endpoint as `POST /mcp`.

No account and no API key.

## Tools

`search` finds foods, booths, or rides by name or menu text. It tolerates typos, spacing, hyphens, and synonyms (`hotdog`, `sno cone`, `cherry slush`, `Tilt-A-Whirl`).

- `type: "food"` returns booths whose menu matches.
- `type: "booth"` matches booth and vendor names.
- `type: "ride"` matches public ride names and lot-label aliases.
- `type: "any"` (default) mixes them.

Each hit is `tier: "direct"` or `tier: "likely"`. Direct hits are exact or strong name and lot-label matches, plus menu matches on the user's own words (light typos, plurals, and spacing). Likely hits are matches that needed a synonym or concept expansion, or partial matches. `direct` is filled before `likely`. `limit` caps the two lists together (default 10, max 25).

`get_details` returns the full record for one id such as `L0-1099`. Matching is case-insensitive and ignores trailing punctuation.

`nearby` lists booths and rides within `radius_m` of a lat/lon, closest first (default 150 m, max 2000 m). `type: "food"` means booths with the food flag. A point more than 3 km from the fairgrounds returns an empty list.

Every hit includes `fair_finder_link` (`https://realwitt.github.io/fair-finder/?booth=` plus the id) so someone can open walking directions on their phone.

Menus and ticket counts come from the fair's published Food & Ride Finder and can change. Check the signs at the booth. Ride height and category, when present, are approximate and come from the midway operator.

`popular_now` is planned and is not a tool yet. It waits on FF-RANK.

## Privacy

No accounts. The worker does not log IPs, rate-limit keys, or query text. The client IP is combined with a secret salt and SHA-256-hashed only to form a rate-limit key. The limit is 60 requests per minute per client (IPv6 clients are counted per /64), enforced by the Workers rate-limiting binding plus an in-memory per-isolate backstop. Workers observability/logs are off for this script.

Set the salt before deploy:

```bash
npx wrangler secret put SALT
```

Do not put `SALT` in `wrangler.toml`.

## Build and deploy

From this directory:

```bash
node build.mjs
node test/local.test.mjs
```

`build.mjs` writes one self-contained file, `dist/worker.js`, plus `dist/meta.json`. If `../data/synonyms.json` exists, it is inlined and used as the concept map. Deploy with wrangler (or, as done for v7.4, by uploading `dist/worker.js` through the Cloudflare API with the `RL` ratelimit binding and a random `SALT` secret_text binding):

```bash
npx wrangler deploy
```
