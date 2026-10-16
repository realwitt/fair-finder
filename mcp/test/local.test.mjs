import worker from '../dist/worker.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultEnv = { RL: { limit: async () => ({ success: true }) }, SALT: 'test' };
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    process.stdout.write('PASS ' + name + '\n');
  } else {
    failed += 1;
    process.stdout.write('FAIL ' + name + (detail ? ' ' + detail : '') + '\n');
    process.exitCode = 1;
  }
}

async function raw(url, init, env) {
  const res = await worker.fetch(new Request(url, init), env || defaultEnv);
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { res, text, json };
}

async function rpc(msg, env, headers) {
  return raw('https://example.test/mcp', {
    method: 'POST',
    headers: Object.assign({
      'content-type': 'application/json',
      'CF-Connecting-IP': '203.0.113.50',
    }, headers || {}),
    body: typeof msg === 'string' ? msg : JSON.stringify(msg),
  }, env);
}

async function tool(name, args, env) {
  const out = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, env);
  const result = out.json && out.json.result;
  const sc = result && result.structuredContent; if (sc && sc.direct) sc.results = sc.direct.concat(sc.likely || []);
  return { ...out, result, sc };
}

const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
check('initialize echoes protocol',
  init.json && init.json.result && init.json.result.protocolVersion === '2025-03-26'
  && init.json.result.serverInfo && init.json.result.serverInfo.name === 'fair-finder-mcp'
  && String(init.json.result.instructions).includes('UNOFFICIAL')
  && init.res.headers.get('Mcp-Session-Id') == null);

const old = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
check('initialize fallback protocol', old.json && old.json.result && old.json.result.protocolVersion === '2025-06-18');

const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
check('notifications/initialized 202', note.res.status === 202 && note.text === '');

const list = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
const toolArr = list.json && list.json.result && list.json.result.tools || [];
const names = toolArr.map(t => t.name);
check('tools/list',
  names.includes('search') && names.includes('get_details') && names.includes('nearby') && names.length === 3
  && toolArr.every(t => t.inputSchema && t.inputSchema.properties && t.annotations && t.annotations.readOnlyHint === true));

const opt = await raw('https://example.test/anything', { method: 'OPTIONS' });
check('OPTIONS cors',
  opt.res.status === 204
  && opt.res.headers.get('Access-Control-Allow-Origin') === '*'
  && (opt.res.headers.get('Access-Control-Allow-Methods') || '').includes('POST')
  && (opt.res.headers.get('Access-Control-Allow-Headers') || '').includes('Content-Type')
  && (opt.res.headers.get('Access-Control-Allow-Headers') || '').includes('Mcp-Protocol-Version')
  && (opt.res.headers.get('Access-Control-Expose-Headers') || '').includes('Mcp-Session-Id')
  && opt.res.headers.get('Access-Control-Max-Age') === '86400');

const getMcp = await raw('https://example.test/mcp', { method: 'GET' });
check('GET /mcp 405', getMcp.res.status === 405 && (getMcp.res.headers.get('Allow') || '').includes('POST'));

const health = await raw('https://example.test/', { method: 'GET' });
check('GET / health', health.json && JSON.stringify(health.json.tools) === JSON.stringify(['search', 'get_details', 'nearby']));

const plain = await raw('https://example.test/mcp', {
  method: 'POST',
  headers: { 'content-type': 'text/plain', 'CF-Connecting-IP': '203.0.113.50' },
  body: '{}',
});
check('content-type 415', plain.res.status === 415);

const bad = await rpc('{');
check('parse error', bad.res.status === 400 && bad.json && bad.json.error && bad.json.error.code === -32700 && bad.json.id === null);

let limitedKey = '';
const limited = await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' }, {
  SALT: 'test',
  RL: { limit: async ({ key }) => { limitedKey = key; return { success: false }; } },
});
check('rate limit 429',
  limited.res.status === 429
  && limited.res.headers.get('Retry-After') === '60'
  && limited.json && limited.json.error && String(limited.json.error.message).includes('60 requests per minute')
  && /^[0-9a-f]{32}$/.test(limitedKey)
  && !limited.text.includes('203.0.113.50')
  && !limited.text.includes(limitedKey));

const cherry = await tool('search', { query: 'cherry slush', limit: 10 });
const top = cherry.sc && cherry.sc.results ? cherry.sc.results.slice(0, 5) : [];
const cherryItems = JSON.stringify((cherry.sc && cherry.sc.results && cherry.sc.results[0] && cherry.sc.results[0].matched_items) || []);
check('search cherry slush',
  cherry.sc && cherry.sc.results && cherry.sc.results[0]
  && cherry.sc.results[0].id === 'L0-1301'
  && cherry.sc.results[0].type === 'booth'
  && cherry.sc.results[0].tier === 'likely'
  && String(cherry.sc.results[0].fair_finder_link).includes('?booth=L0-1301')
  && /cherry/i.test(cherryItems)
  && /slush|icee|frozen/i.test(JSON.stringify(top))
  && cherry.sc.count === cherry.sc.direct.length + cherry.sc.likely.length
  && cherry.sc.likely[0].id === 'L0-1301'
  && !cherry.text.includes('203.0.113.50'));

const tilt = await tool('search', { query: 'Tilt-A-Whirl', type: 'ride' });
const cyclone = tilt.sc && tilt.sc.results && tilt.sc.results.find(r => r.id === 'L0-1097');
const tilt2 = await tool('search', { query: 'tilt a whirl', type: 'ride' });
const tilt3 = await tool('search', { query: 'tiltawhirl', type: 'ride' });
check('search Tilt-A-Whirl',
  tilt.sc && tilt.sc.results && tilt.sc.results[0] && tilt.sc.results[0].id === 'L0-1099'
  && tilt.sc.results[0].tier === 'direct'
  && String(tilt.sc.results[0].match_note || '').includes('Air Raid')
  && cyclone && String(cyclone.match_note).includes('Super Cyclone') && String(cyclone.match_note).includes('Tilt-A-Whirl')
  && tilt2.sc && tilt2.sc.results[0].id === 'L0-1099'
  && tilt3.sc && tilt3.sc.results[0].id === 'L0-1099');

const hotdog = await tool('search', { query: 'hotdog', type: 'food' });
check('search hotdog',
  hotdog.sc && hotdog.sc.count >= 3 && hotdog.sc.results.every(r => r.type === 'booth' && r.fair_finder_link.includes('?booth=')));

const funel = await tool('search', { query: 'funel cake' });
const funelFood = await tool('search', { query: 'funel cake', type: 'food' });
check('search funel cake',
  funel.sc && funel.sc.count >= 1
  && funelFood.sc && funelFood.sc.count >= 1
  && funelFood.sc.results[0].match === 'menu');

const det = await tool('get_details', { id: 'L0-1099' });
check('get_details L0-1099', det.sc && det.sc.tickets === 4 && det.sc.type === 'ride' && det.result.isError === false);

const det2 = await tool('get_details', { id: 'l0-1099.' });
check('get_details l0-1099.', det2.sc && det2.sc.id === 'L0-1099' && det2.sc.tickets === 4);

const nope = await tool('get_details', { id: 'nope' });
check('get_details nope', nope.result && nope.result.isError === true);

const slide = await tool('get_details', { id: 'L0-1335' });
check('ride wins L0-1335', slide.sc && slide.sc.type === 'ride' && slide.sc.tickets === 5);

const near = await tool('nearby', { lat: 35.79485, lon: -78.7093, radius_m: 200 });
let nearOk = !!(near.sc && near.sc.results && near.sc.results.length && near.sc.results[0].id === 'L0-1113');
if (nearOk) {
  let prev = -1;
  for (const row of near.sc.results) {
    if (row.distance_m < prev || row.distance_m > 200 || !String(row.fair_finder_link).includes('?booth=')) nearOk = false;
    prev = row.distance_m;
  }
}
check('nearby 200m', nearOk);

const nearRide = await tool('nearby', { lat: 35.79485, lon: -78.7093, radius_m: 200, type: 'ride' });
check('nearby rides',
  nearRide.sc && nearRide.sc.results.length > 0 && nearRide.sc.results.every(r => r.type === 'ride' && String(r.fair_finder_link).includes('?booth=')));

const workerPath = join(dirname(fileURLToPath(import.meta.url)), '../dist/worker.js');
const src = readFileSync(workerPath, 'utf8');
check('no console.', !src.includes('console.'));

if (failed) process.exitCode = 1;
