// In-memory D1 over node:sqlite. prepare().bind().run()/all()/first().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../worker/schema.sql'), 'utf8');

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      function bound(args) {
        return {
          run() {
            const info = stmt.run(...args);
            return { success: true, meta: { changes: Number(info && info.changes != null ? info.changes : 0) } };
          },
          all() {
            return { results: stmt.all(...args) };
          },
          first() {
            const row = stmt.get(...args);
            return row == null ? null : row;
          },
        };
      }
      return {
        bind(...args) { return bound(args); },
        run(...args) { return bound(args).run(); },
        all(...args) { return bound(args).all(); },
        first(...args) { return bound(args).first(); },
      };
    },
  };
}
