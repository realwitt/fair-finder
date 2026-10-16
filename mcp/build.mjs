import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpDir = dirname(fileURLToPath(import.meta.url));
const repo = join(mcpDir, '..');
const FIELDS = ['id','name','kind','area','lot','products','items','newFood','food','drinks','lat','lon'];

function slim() {
  const boothFile = JSON.parse(readFileSync(join(repo, 'data/booths.json'), 'utf8'));
  const rideFile = JSON.parse(readFileSync(join(repo, 'data/rides.json'), 'utf8'));
  const details = JSON.parse(readFileSync(join(repo, 'tools/ride_details.json'), 'utf8'));
  const rideIds = new Set(rideFile.rides.map(r => r.id));
  const booths = [];
  for (const b of boothFile.booths) {
    if (b.lat == null || b.lon == null) continue;
    if (rideIds.has(b.id)) continue;
    const s = {};
    for (const k of FIELDS) s[k] = b[k];
    booths.push(s);
  }
  const rides = rideFile.rides.map(r => {
    const num = String(r.id).split('-').pop();
    const d = details[num] || {};
    return {
      id: r.id, name: r.name, aliases: r.aliases || [],
      area: r.area || d.area || '', lot: r.lot ?? null,
      tickets: r.tickets ?? null, cashOnly: !!r.cashOnly,
      category: r.category || d.category || null,
      heightText: r.heightText || d.heightText || null,
      lat: r.lat, lon: r.lon,
    };
  });
  return { booths, rides, fair: { lat: 35.7948, lon: -78.7115 } };
}

const DATA = slim();
const searchJs = readFileSync(join(repo, 'search.js'), 'utf8');
const suggestJs = readFileSync(join(repo, 'suggest.js'), 'utf8');
const conceptsJs = existsSync(join(repo, 'concepts.js')) ? readFileSync(join(repo, 'concepts.js'), 'utf8') : '';
const serverJs = readFileSync(join(mcpDir, 'src/server.js'), 'utf8');

let synonymsJs = 'null';
const synPath = join(repo, 'data/synonyms.json');
if (existsSync(synPath)) {
  const raw = readFileSync(synPath, 'utf8').trim();
  try {
    JSON.parse(raw);
    synonymsJs = raw;
  } catch {
    synonymsJs = 'null';
  }
}

const prelude = `const __root = {};
(function () {
${searchJs}
}).call(__root);
(function () {
${suggestJs}
}).call(__root);
(function () {
${conceptsJs}
}).call(__root);
const FoodSearch = __root.FoodSearch;
const Concepts = __root.Concepts;
const Suggest = __root.Suggest;
const DATA = ${JSON.stringify(DATA)};
const SYNONYMS = ${synonymsJs};
`;
const js = prelude + '\n' + serverJs;
mkdirSync(join(mcpDir, 'dist'), { recursive: true });
const outPath = join(mcpDir, 'dist/worker.js');
writeFileSync(outPath, js);
const bytes = Buffer.byteLength(js);
const sha256 = createHash('sha256').update(js).digest('hex');
writeFileSync(join(mcpDir, 'dist/meta.json'), JSON.stringify({
  built: new Date().toISOString(), bytes, sha256,
  booths: DATA.booths.length, rides: DATA.rides.length,
}));
process.stdout.write('worker.js ' + bytes + ' bytes\n');
