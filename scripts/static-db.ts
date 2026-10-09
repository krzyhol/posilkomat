// Baza do wersji statycznej (GitHub Pages): node scripts/static-db.ts web/dist/posilkomat.db
// Tworzy świeżą bazę z danych startowych i przełącza ją z WAL na zwykły dziennik – sql.js czyta pojedynczy plik.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'web', 'dist', 'posilkomat.db');
execFileSync(process.execPath, ['--no-warnings', join(root, 'db', 'seed.ts'), out, '--force'], { stdio: 'inherit' });
const db = new DatabaseSync(out);
db.exec('PRAGMA journal_mode = DELETE; VACUUM;');
db.close();
for (const f of [`${out}-wal`, `${out}-shm`]) if (existsSync(f)) rmSync(f);
console.log(`Baza statyczna: ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
