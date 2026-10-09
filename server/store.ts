// Dostęp do bazy niezależny od silnika: node:sqlite na serwerze, sql.js w przeglądarce (wersja na GitHub Pages).
export type Param = string | number | null;
export type Driver = {
  all(sql: string, params: Param[]): unknown[];
  get(sql: string, params: Param[]): unknown;
  run(sql: string, params: Param[]): { lastInsertRowid: number; changes: number };
  exec(sql: string): void;
};

let driver: Driver | null = null;
export const setDriver = (d: Driver) => { driver = d; };
const d = () => {
  if (!driver) throw new Error('Baza nie została zainicjalizowana');
  return driver;
};

// wiersze z bazy są dynamiczne – typujemy je luźno
export type Row = any;

export const all = <T = Row>(sql: string, ...p: Param[]): T[] => d().all(sql, p) as T[];
export const get = <T = Row>(sql: string, ...p: Param[]): T | undefined => (d().get(sql, p) ?? undefined) as T | undefined;
export const run = (sql: string, ...p: Param[]) => d().run(sql, p);

export function tx<T>(fn: () => T): T {
  d().exec('BEGIN');
  try {
    const out = fn();
    d().exec('COMMIT');
    return out;
  } catch (e) {
    d().exec('ROLLBACK');
    throw e;
  }
}

/** IN (?, ?, …) placeholder list */
export const qs = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
