// Tworzy bazę SQLite z danych startowych: node db/seed.ts [ścieżka.db] [--force]
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const dbPath = args.find((a) => !a.startsWith('--')) ?? join(root, 'data', 'posilkomat.db');

if (existsSync(dbPath)) {
  if (!force) {
    console.log(`Baza ${dbPath} już istnieje – pomijam (użyj --force, żeby utworzyć od nowa).`);
    process.exit(0);
  }
  rmSync(dbPath);
}
mkdirSync(dirname(dbPath), { recursive: true });

const seed = (name: string) => JSON.parse(readFileSync(join(root, 'data', 'seed', `${name}.json`), 'utf8'));
const meta = seed('meta');
const { products } = seed('products');
const { recipes } = seed('recipes');
const { plans } = seed('plans');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));

const bool = (b: boolean) => (b ? 1 : 0);
// to samo składanie tekstu stosuje serwer dla zapytań (server/text.ts): „Łosoś” ≡ „losos”
const fold = (t: string) => t.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const prep = (sql: string) => db.prepare(sql);

db.exec('BEGIN');
try {
  const kv = prep('INSERT INTO app_meta (key, value) VALUES (?, ?)');
  kv.run('schema_version', meta.schema_version);
  kv.run('seed_generated_at', meta.generated_at);

  const slot = prep('INSERT INTO meal_slots VALUES (?, ?, ?, ?, ?)');
  for (const s of meta.meal_slots) slot.run(s.id, s.name, s.order, s.default_time?.from ?? null, s.default_time?.to ?? null);
  const compat = prep('INSERT INTO slot_swap_compatibility VALUES (?, ?, ?)');
  for (const [from, list] of Object.entries(meta.slot_swap_compatibility) as [string, string[]][])
    list.forEach((to, i) => compat.run(from, to, i));
  const cat = prep('INSERT INTO product_categories VALUES (?, ?, ?)');
  for (const c of meta.product_categories) cat.run(c.id, c.name, c.order);
  const unit = prep('INSERT INTO units VALUES (?, ?, ?, ?, ?, ?)');
  for (const u of meta.units) unit.run(u.id, u.short, u.forms.one, u.forms.few, u.forms.many, u.forms.fraction);
  const alg = prep('INSERT INTO allergens VALUES (?, ?)');
  for (const a of meta.allergens) alg.run(a.id, a.name);

  const prod = prep(`INSERT INTO products (id, name, category_id, origin, pantry_staple, shoppable, kcal, protein_g, fat_g, carbs_g,
    fiber_g, nutrition_source, nutrition_recipes_used, base_recipe_id, source_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const alias = prep('INSERT INTO product_aliases VALUES (?, ?)');
  const palg = prep('INSERT INTO product_allergens VALUES (?, ?)');
  const meas = prep('INSERT INTO product_measures VALUES (?, ?, ?, ?)');
  for (const p of products) {
    const n = p.nutrition_per_100g ?? {};
    prod.run(p.id, p.name, p.category, p.origin, bool(p.pantry_staple), bool(p.shoppable), n.kcal ?? null, n.protein_g ?? null,
      n.fat_g ?? null, n.carbs_g ?? null, n.fiber_g ?? null, p.nutrition_source?.type ?? null,
      p.nutrition_source?.recipes_used ?? null, p.base_recipe_id ?? null, p.source.type);
    for (const a of p.aliases ?? []) alias.run(p.id, a);
    for (const a of p.allergens) palg.run(p.id, a);
    p.measures.forEach((m: any, i: number) => meas.run(p.id, m.unit, m.grams, i));
  }

  const rec = prep(`INSERT INTO recipes (id, kind, name, description, servings, kcal, protein_g, carbs_g, fat_g, flavor,
    prep_time_min, image, status, version, variant_group, yield_product_id, yield_amount_g, yield_pieces, yield_piece_unit,
    source_type, source_model, source_prompt, source_generated_at, source_imported_at, based_on_recipe_id, nutrition_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rfile = prep('INSERT INTO recipe_source_files VALUES (?, ?)');
  const rslot = prep('INSERT INTO recipe_slots VALUES (?, ?)');
  const rtag = prep('INSERT OR IGNORE INTO recipe_tags VALUES (?, ?, ?)');
  const ralg = prep('INSERT INTO recipe_allergens VALUES (?, ?)');
  const ring = prep(`INSERT INTO recipe_ingredients (recipe_id, position, product_id, name, amount_g, household_qty, household_unit,
    group_name, note, optional) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const rstep = prep('INSERT INTO recipe_steps VALUES (?, ?, ?, ?, ?)');
  const fts = prep('INSERT INTO recipes_fts (recipe_id, name, ingredients) VALUES (?, ?, ?)');
  for (const r of recipes) {
    const n = r.nutrition_per_serving, s = r.source, y = r.yield ?? {};
    rec.run(r.id, r.kind, r.name, r.description, r.servings, n.kcal, n.protein_g, n.carbs_g, n.fat_g, r.tags.flavor ?? null,
      r.prep_time_min, r.image, r.status, r.version, r.variant_group ?? null, y.product_id ?? null, y.amount_g ?? null,
      y.pieces ?? null, y.piece_unit ?? null, s.type, s.model ?? null, s.prompt ?? null, s.generated_at ?? null,
      s.imported_at ?? null, s.based_on_recipe_id ?? null, s.nutrition_origin ?? null);
    for (const f of s.files ?? []) rfile.run(r.id, f);
    for (const sl of r.meal_slots) rslot.run(r.id, sl);
    for (const type of ['dish_type', 'protein', 'diet', 'features', 'custom'])
      for (const t of r.tags[type] ?? []) rtag.run(r.id, type, t);
    for (const a of r.allergens) ralg.run(r.id, a);
    r.ingredients.forEach((i: any, k: number) => ring.run(r.id, k + 1, i.product_id, i.name, i.amount_g,
      i.household?.qty ?? null, i.household?.unit ?? null, i.group, i.note ?? null, bool(i.optional)));
    for (const st of r.steps) rstep.run(r.id, st.order, st.text, st.section, st.timer_min ?? null);
    fts.run(r.id, fold(r.name), fold(r.ingredients.map((i: any) => i.name).join(', ')));
  }

  const sg = prep('INSERT INTO substitution_groups VALUES (?, ?, ?, ?, ?)');
  const si = prep('INSERT INTO substitution_items VALUES (?, ?, ?, ?, ?, ?)');
  meta.substitution_groups.forEach((g: any, i: number) => {
    sg.run(g.id, g.name, g.mode, g.note ?? null, i);
    g.items.forEach((it: any, k: number) =>
      si.run(g.id, it.product_id, it.grams ?? null, it.household?.qty ?? null, it.household?.unit ?? null, k));
  });

  const plan = prep(`INSERT INTO plans (id, name, type, target_kcal, people, source_file, source_note) VALUES (?,?,?,?,1,?,?)`);
  const day = prep('INSERT INTO plan_days (plan_id, day_number, fiber_g, calcium_mg, magnesium_mg) VALUES (?,?,?,?,?)');
  const meal = prep(`INSERT INTO plan_meals (plan_day_id, position, slot_id, time_from, time_to, recipe_id, portions)
    VALUES (?,?,?,?,?,?,?)`);
  for (const p of plans) {
    const dup = p.source.duplicates?.length ? `Identyczny plik: ${p.source.duplicates.join(', ')}` : null;
    plan.run(p.id, p.name, p.type, p.target_kcal, p.source.file, dup);
    for (const d of p.days) {
      const t = d.totals;
      const { lastInsertRowid } = day.run(p.id, d.day, t.fiber_g, t.calcium_mg, t.magnesium_mg);
      d.meals.forEach((m: any, k: number) =>
        meal.run(lastInsertRowid, k + 1, m.slot, m.time?.from ?? null, m.time?.to ?? null, m.recipe_id, m.portions));
    }
  }

  const setting = prep('INSERT INTO user_settings VALUES (?, ?)');
  setting.run('profile', JSON.stringify({ name: null, target_kcal: 2200, people: 1, excluded_allergens: [], diet: null,
    hide_pantry_staples: true }));

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

const fk = db.prepare('PRAGMA foreign_key_check').all();
db.exec('PRAGMA optimize; VACUUM;');
db.close();
console.log(`Utworzono ${dbPath}`);
if (fk.length) {
  console.error('Błędy kluczy obcych:', fk.slice(0, 5));
  process.exit(1);
}
const db2 = new DatabaseSync(dbPath, { readOnly: true });
for (const t of ['products', 'recipes', 'recipe_ingredients', 'recipe_steps', 'plans', 'plan_meals'])
  console.log(`  ${t}: ${(db2.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n}`);
db2.close();
