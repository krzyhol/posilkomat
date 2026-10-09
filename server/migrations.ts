// Migracje schematu. Wersja w PRAGMA user_version – działa tak samo w node:sqlite i w sql.js (zapisuje się w pliku bazy).
// db/schema.sql to wersja 0; każda pozycja poniżej podnosi wersję o 1. Nigdy nie zmieniaj istniejących wpisów – dopisuj nowe.
export const MIGRATIONS: string[] = [
  // 1 – spiżarnia; ile produktu z listy zakupów pokrywają zapasy
  `CREATE TABLE pantry_items (
     product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
     amount_g   REAL,                                   -- NULL = „mam”, bez liczenia ilości
     expires_on TEXT,
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   );
   ALTER TABLE shopping_items ADD COLUMN pantry_g REAL;
   ALTER TABLE shopping_items ADD COLUMN need_g REAL;
   ALTER TABLE shopping_items ADD COLUMN stocked INTEGER NOT NULL DEFAULT 0;`,
  // 2 – dziennik wagi
  `CREATE TABLE weight_log (
     date       TEXT PRIMARY KEY,
     weight_kg  REAL NOT NULL CHECK (weight_kg > 20 AND weight_kg < 400),
     waist_cm   REAL,
     note       TEXT,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   );`,
];

type Exec = { exec(sql: string): void; version(): number };

export function migrate(db: Exec) {
  for (let v = db.version(); v < MIGRATIONS.length; v++) {
    try {
      db.exec(`BEGIN; ${MIGRATIONS[v]}; PRAGMA user_version = ${v + 1}; COMMIT;`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* transakcja już zamknięta */ }
      throw e;
    }
  }
}
