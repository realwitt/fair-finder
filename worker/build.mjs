// Bundle one ES module with the allowlist inlined. Does not deploy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const allow = readFileSync(join(dir, 'src/allowlist.js'), 'utf8');
let src = readFileSync(join(dir, 'src/index.js'), 'utf8');
src = src.replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\/allowlist\.js['"];\s*/m, '');
const js = allow + '\n' + src;
mkdirSync(join(dir, 'dist'), { recursive: true });
const out = join(dir, 'dist/worker.js');
writeFileSync(out, js);
const bytes = Buffer.byteLength(js);
const sha256 = createHash('sha256').update(js).digest('hex');
writeFileSync(join(dir, 'dist/meta.json'), JSON.stringify({ sha256, bytes }) + '\n');
process.stdout.write('worker.js ' + bytes + ' bytes\n');
