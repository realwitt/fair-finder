import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

let code = 0;
try { execFileSync('sh', ['tools/build_pages.sh'], { cwd: ROOT, stdio: 'inherit' }); }
catch (e) { code = e.status || 1; }
ok(code === 0, 'build_pages.sh exit 0');

const dist = path.join(ROOT, 'dist');
const built = fs.readFileSync(path.join(dist, '_headers'));
const src = fs.readFileSync(path.join(ROOT, 'pages', '_headers'));
ok(built.equals(src), 'dist/_headers byte-equals pages/_headers');

const files = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js', 'app.js', 'concepts.js', 'config.js', 'geo.js', 'heading.js', 'rides.js', 'route.js', 'search.js', 'stats.js', 'suggest.js'];
const dirs = ['data', 'vendor', 'icons', 'about', 'b'];
const top = fs.readdirSync(dist).sort();
const expect = [...files, '_headers', ...dirs].sort();
ok(JSON.stringify(top) === JSON.stringify(expect), 'top-level names ' + top.join(','));

for (const rel of ['b/L0-1387.html', 'about/img/og.png', 'data/booths.json', 'icons/icon-512.png'])
  ok(fs.existsSync(path.join(dist, rel)), 'exists ' + rel);

for (const name of ['CNAME', 'tests', 'tools', 'mcp', 'worker', 'node_modules', '.nojekyll', 'pages'])
  ok(!fs.existsSync(path.join(dist, name)), 'absent ' + name);

const bad = [];
(function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith('.md') || ent.name === 'package.json' || ent.name === 'package-lock.json') bad.push(path.relative(dist, p));
  }
})(dist);
ok(bad.length === 0, 'no markdown or package.json in dist ' + bad.join(','));

console.log(fails.length ? fails.length + ' FAILURES\n' + fails.join('\n') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
