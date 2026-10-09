// Wersja bez serwera (GitHub Pages): ta sama logika API co na serwerze, baza SQLite w WebAssembly (sql.js),
// a zmiany użytkownika zapisywane w IndexedDB tej przeglądarki.
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { setDriver, type Param } from '../../../server/store.ts';
import { handle } from '../../../server/http.ts';
import '../../../server/routes.ts';

const IDB_NAME = 'posilkomat';
const IDB_STORE = 'db';
const IDB_KEY = 'main';

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

let db: Database | null = null;
let ready: Promise<void> | null = null;

async function init() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | undefined;
  try { bytes = await idb<Uint8Array | undefined>('readonly', (s) => s.get(IDB_KEY)); } catch { /* prywatne okno – działamy bez zapisu */ }
  if (!bytes) {
    const res = await fetch(`${import.meta.env.BASE_URL}posilkomat.db`);
    if (!res.ok) throw new Error('Nie udało się pobrać bazy przepisów');
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  db = new SQL.Database(bytes);
  db.exec('PRAGMA foreign_keys = ON;');
  const d = db;
  const clean = (p: Param[]) => p.map((v) => (v === undefined ? null : v));
  setDriver({
    all(sql, p) {
      const st = d.prepare(sql);
      st.bind(clean(p));
      const out: unknown[] = [];
      while (st.step()) out.push(st.getAsObject());
      st.free();
      return out;
    },
    get(sql, p) {
      const st = d.prepare(sql);
      st.bind(clean(p));
      const row = st.step() ? st.getAsObject() : undefined;
      st.free();
      return row;
    },
    run(sql, p) {
      d.run(sql, clean(p));
      const changes = d.getRowsModified();
      const id = d.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
      return { lastInsertRowid: Number(id ?? 0), changes };
    },
    exec: (sql) => { d.exec(sql); },
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!db) return;
    idb('readwrite', (s) => s.put(db!.export(), IDB_KEY)).catch((e) => console.warn('Nie zapisano bazy w przeglądarce', e));
  }, 400);
}

export async function localApi(method: string, path: string, body?: unknown) {
  ready ??= init();
  await ready;
  const r = await handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  if (method !== 'GET' && r.status < 400) scheduleSave();
  // jak przez sieć: same dane, bez współdzielonych referencji
  return { status: r.status, data: r.data === undefined ? undefined : JSON.parse(JSON.stringify(r.data)) };
}

/** Usuwa dane zapisane w przeglądarce – następne otwarcie zacznie od czystej bazy przepisów. */
export async function resetLocalData() {
  await idb('readwrite', (s) => s.delete(IDB_KEY));
}
