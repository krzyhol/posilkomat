// Sterownik node:sqlite dla serwera
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDriver, type Param } from './store.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.POSILKOMAT_DB ?? join(ROOT, 'data', 'posilkomat.db');

if (!existsSync(DB_PATH)) {
  console.log('Brak bazy – tworzę ją z danych startowych (data/seed)…');
  execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'db', 'seed.ts'), DB_PATH], { stdio: 'inherit' });
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');

setDriver({
  all: (sql, p) => db.prepare(sql).all(...(p as Param[])),
  get: (sql, p) => db.prepare(sql).get(...(p as Param[])),
  run: (sql, p) => {
    const r = db.prepare(sql).run(...(p as Param[]));
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
  },
  exec: (sql) => db.exec(sql),
});
