import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.POSILKOMAT_DB ?? join(ROOT, 'data', 'posilkomat.db');

if (!existsSync(DB_PATH)) {
  console.log('Brak bazy – tworzę ją z danych startowych (data/seed)…');
  execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'db', 'seed.ts'), DB_PATH], { stdio: 'inherit' });
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');

type Params = (string | number | null)[];
// wiersze z node:sqlite są dynamiczne – typujemy je luźno
export type Row = any;

export const all = <T = Row>(sql: string, ...p: Params): T[] => db.prepare(sql).all(...p) as T[];
export const get = <T = Row>(sql: string, ...p: Params): T | undefined => db.prepare(sql).get(...p) as T | undefined;
export const run = (sql: string, ...p: Params) => db.prepare(sql).run(...p);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** IN (?, ?, …) placeholder list */
export const qs = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
