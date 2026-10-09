// Słowniki, ustawienia, produkty i przepisy
import { all, get, run, tx, qs, now, type Row } from './store.ts';
import { fold, searchClause, searchText, slug, round } from './text.ts';
import { HttpError } from './http.ts';

// ------------------------------------------------------------------ meta i ustawienia
export function getMeta() {
  return {
    slots: all('SELECT id, name, position, time_from, time_to FROM meal_slots ORDER BY position'),
    slot_compat: Object.fromEntries(
      all('SELECT id FROM meal_slots').map((s) => [
        s.id,
        all('SELECT compatible_slot_id AS id FROM slot_swap_compatibility WHERE slot_id = ? ORDER BY position', s.id).map((r) => r.id),
      ]),
    ),
    categories: all('SELECT id, name, position FROM product_categories ORDER BY position'),
    units: all('SELECT * FROM units'),
    allergens: all('SELECT id, name FROM allergens'),
    dish_types: all(`SELECT tag, COUNT(*) AS n FROM recipe_tags WHERE tag_type = 'dish_type' GROUP BY tag ORDER BY n DESC`),
    substitution_groups: all('SELECT * FROM substitution_groups ORDER BY position').map((g) => ({
      ...g,
      items: all(`SELECT si.product_id, p.name, si.grams, si.household_qty, si.household_unit
                  FROM substitution_items si JOIN products p ON p.id = si.product_id WHERE group_id = ? ORDER BY si.position`, g.id),
    })),
  };
}

export type Profile = {
  name: string | null;
  target_kcal: number;
  people: number;
  excluded_allergens: string[];
  diet: null | 'wegetariańska' | 'wegańska' | 'pescowegetariańska';
  hide_pantry_staples: boolean;
  disliked_products?: string[];
  disliked_recipes?: string[];
};

export function getProfile(): Profile {
  const r = get(`SELECT value FROM user_settings WHERE key = 'profile'`);
  return JSON.parse(r?.value ?? '{}');
}

export function saveProfile(patch: Partial<Profile>): Profile {
  const p = { ...getProfile(), ...patch };
  p.target_kcal = Math.max(1000, Math.min(5000, Math.round(Number(p.target_kcal) || 2200)));
  p.people = Math.max(1, Math.min(12, Math.round(Number(p.people) || 1)));
  run(`INSERT INTO user_settings (key, value) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(p));
  return p;
}

// ------------------------------------------------------------------ produkty
const PRODUCT_COLS = `p.id, p.name, p.category_id, p.origin, p.pantry_staple, p.shoppable, p.kcal, p.protein_g, p.fat_g,
  p.carbs_g, p.fiber_g, p.nutrition_source, p.base_recipe_id, p.source_type`;

function withMeasures(rows: Row[]) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const m = all(`SELECT product_id, unit_id, grams FROM product_measures WHERE product_id IN (${qs(ids.length)}) ORDER BY position`, ...ids);
  const a = all(`SELECT product_id, allergen_id FROM product_allergens WHERE product_id IN (${qs(ids.length)})`, ...ids);
  return rows.map((r) => ({
    ...r,
    pantry_staple: !!r.pantry_staple,
    shoppable: !!r.shoppable,
    measures: m.filter((x) => x.product_id === r.id).map(({ unit_id, grams }) => ({ unit: unit_id, grams })),
    allergens: a.filter((x) => x.product_id === r.id).map((x) => x.allergen_id),
  }));
}

export function searchProducts(q: string, limit = 20) {
  const f = fold(q);
  if (!f) return withMeasures(all(`SELECT ${PRODUCT_COLS} FROM products p ORDER BY p.name LIMIT ?`, limit));
  // dopasowanie po nazwie i aliasach; najpierw te, które zaczynają się od frazy
  const rows = all(`SELECT ${PRODUCT_COLS}, (SELECT COUNT(*) FROM recipe_ingredients ri WHERE ri.product_id = p.id) AS uses
                    FROM products p`);
  const aliases = all('SELECT product_id, alias FROM product_aliases');
  const scored = rows
    .map((r) => {
      const names = [r.name, ...aliases.filter((a) => a.product_id === r.id).map((a) => a.alias)].map(fold);
      let s = 0;
      for (const n of names) {
        if (n === f) s = Math.max(s, 100);
        else if (n.startsWith(f)) s = Math.max(s, 60);
        else if (n.split(/\s+/).some((w) => w.startsWith(f))) s = Math.max(s, 40);
        else if (n.includes(f)) s = Math.max(s, 20);
      }
      return { r, s: s ? s + Math.min(10, Math.log2(1 + r.uses)) : 0 };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ r }) => {
      const { uses, ...rest } = r;
      return rest;
    });
  return withMeasures(scored);
}

export function getProducts(ids: string[]) {
  if (!ids.length) return [];
  return withMeasures(all(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id IN (${qs(ids.length)})`, ...ids));
}

/** Dopasowanie nazwy z AI / formularza do katalogu: dokładna nazwa lub alias, potem najlepszy wynik wyszukiwania. */
export function matchProduct(name: string): { product: Row | null; confidence: 'exact' | 'close' | 'none' } {
  const f = fold(name);
  const exact = all(`SELECT p.id, p.name FROM products p`).find((p) => fold(p.name) === f)
    ?? all(`SELECT p.id, p.name FROM product_aliases a JOIN products p ON p.id = a.product_id`).find((p) => fold(p.name) === f);
  const aliasHit = get(`SELECT product_id FROM product_aliases WHERE alias = ? COLLATE NOCASE`, name);
  const id = exact?.id ?? aliasHit?.product_id;
  if (id) return { product: getProducts([id])[0], confidence: 'exact' };
  const best = searchProducts(name, 1)[0];
  if (best) {
    const words = f.split(/\s+/).filter((w) => w.length > 2);
    const bn = fold(best.name);
    const overlap = words.filter((w) => bn.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
    if (words.length && overlap / words.length >= 0.5) return { product: best, confidence: 'close' };
  }
  return { product: null, confidence: 'none' };
}

export function createProduct(p: {
  name: string; category_id: string; origin?: string; allergens?: string[];
  kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g?: number;
  nutrition_source?: string; source_type?: string; measures?: { unit: string; grams: number }[];
}) {
  if (!p.name?.trim()) throw new HttpError(400, 'Podaj nazwę produktu');
  let id = slug(p.name);
  for (let n = 2; get('SELECT 1 FROM products WHERE id = ?', id); n++) id = `${slug(p.name)}-${n}`;
  tx(() => {
    run(`INSERT INTO products (id, name, category_id, origin, kcal, protein_g, fat_g, carbs_g, fiber_g, nutrition_source, source_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, p.name.trim(), p.category_id || 'inne', p.origin ?? 'plant', p.kcal, p.protein_g, p.fat_g, p.carbs_g, p.fiber_g ?? 0,
      p.nutrition_source ?? 'user', p.source_type ?? 'user');
    for (const a of p.allergens ?? []) run('INSERT OR IGNORE INTO product_allergens VALUES (?, ?)', id, a);
    (p.measures ?? []).forEach((m, i) => run('INSERT OR IGNORE INTO product_measures VALUES (?, ?, ?, ?)', id, m.unit, m.grams, i));
  });
  return getProducts([id])[0];
}

// ------------------------------------------------------------------ przepisy
export type RecipeFilter = {
  q?: string; slot?: string; diet?: string; dish?: string; exclude?: string[]; source?: string;
  favorite?: boolean; kcal_min?: number; kcal_max?: number; flavor?: string; feature?: string;
  kind?: 'meal' | 'base'; limit?: number; offset?: number; sort?: 'mix' | 'name' | 'kcal' | 'protein' | 'new';
};

const SUMMARY_COLS = `r.id, r.kind, r.name, r.servings, r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.flavor, r.prep_time_min,
  r.source_type, r.is_favorite, r.rating, r.variant_group, r.created_at`;

function decorate(rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = qs(ids.length);
  const slots = all(`SELECT recipe_id, slot_id FROM recipe_slots WHERE recipe_id IN (${ph})`, ...ids);
  const tags = all(`SELECT recipe_id, tag_type, tag FROM recipe_tags WHERE recipe_id IN (${ph})`, ...ids);
  const alg = all(`SELECT recipe_id, allergen_id FROM recipe_allergens WHERE recipe_id IN (${ph})`, ...ids);
  const ing = all(`SELECT recipe_id, COUNT(*) AS n FROM recipe_ingredients WHERE recipe_id IN (${ph}) GROUP BY recipe_id`, ...ids);
  return rows.map((r) => {
    const t = tags.filter((x) => x.recipe_id === r.id);
    const by = (k: string) => t.filter((x) => x.tag_type === k).map((x) => x.tag);
    return {
      ...r,
      is_favorite: !!r.is_favorite,
      slots: slots.filter((x) => x.recipe_id === r.id).map((x) => x.slot_id),
      tags: { dish_type: by('dish_type'), protein: by('protein'), diet: by('diet'), features: by('features'), custom: by('custom') },
      allergens: alg.filter((x) => x.recipe_id === r.id).map((x) => x.allergen_id),
      ingredient_count: ing.find((x) => x.recipe_id === r.id)?.n ?? 0,
    };
  });
}

export function listRecipes(f: RecipeFilter) {
  const where: string[] = [`r.status = 'active'`, `r.kind = ?`];
  const p: (string | number)[] = [f.kind ?? 'meal'];
  const s = f.q ? searchClause(f.q) : null;
  if (s) { where.push(s.sql); p.push(...s.params); }
  if (f.slot) { where.push(`r.id IN (SELECT recipe_id FROM recipe_slots WHERE slot_id = ?)`); p.push(f.slot); }
  if (f.diet) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'diet' AND tag = ?)`); p.push(f.diet); }
  if (f.dish) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'dish_type' AND tag = ?)`); p.push(f.dish); }
  if (f.feature) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'features' AND tag = ?)`); p.push(f.feature); }
  if (f.flavor) { where.push(`r.flavor = ?`); p.push(f.flavor); }
  if (f.exclude?.length) {
    where.push(`r.id NOT IN (SELECT recipe_id FROM recipe_allergens WHERE allergen_id IN (${qs(f.exclude.length)}))`);
    p.push(...f.exclude);
  }
  if (f.source === 'pdf') where.push(`r.source_type = 'pdf_import'`);
  if (f.source === 'mine') where.push(`r.source_type IN ('user', 'ai_generated', 'ai_modified')`);
  if (f.favorite) where.push(`r.is_favorite = 1`);
  if (f.kcal_min) { where.push(`r.kcal >= ?`); p.push(f.kcal_min); }
  if (f.kcal_max) { where.push(`r.kcal <= ?`); p.push(f.kcal_max); }
  // mix = stałe „przetasowanie” (te same wyniki przy kolejnych stronach), żeby lista nie zaczynała się od przekąsek na „A”
  const order = { mix: '(r.rowid * 7919) % 1009, r.rowid', name: 'r.name COLLATE NOCASE', kcal: 'r.kcal', protein: 'r.protein_g DESC', new: 'r.created_at DESC, r.name' }[f.sort ?? (f.q ? 'name' : 'mix')];
  const total = get(`SELECT COUNT(*) AS n FROM recipes r WHERE ${where.join(' AND ')}`, ...p)!.n;
  const rows = all(`SELECT ${SUMMARY_COLS} FROM recipes r WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...p, Math.min(f.limit ?? 40, 200), f.offset ?? 0);
  return { total, items: decorate(rows) };
}

export function recipeSummaries(ids: string[]) {
  if (!ids.length) return [];
  return decorate(all(`SELECT ${SUMMARY_COLS} FROM recipes r WHERE r.id IN (${qs(ids.length)})`, ...ids));
}

export function getRecipe(id: string) {
  const r = get(`SELECT * FROM recipes WHERE id = ?`, id);
  if (!r) return null;
  const [summary] = decorate([r]);
  const ingredients = all(`SELECT ri.position, ri.product_id, ri.name, ri.amount_g, ri.household_qty, ri.household_unit, ri.group_name,
      ri.note, ri.optional, p.name AS product_name, p.category_id, p.kcal AS product_kcal, p.base_recipe_id, p.pantry_staple
    FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id = ? ORDER BY ri.position`, id);
  const steps = all(`SELECT position, text, section, timer_min FROM recipe_steps WHERE recipe_id = ? ORDER BY position`, id);
  const files = all(`SELECT file FROM recipe_source_files WHERE recipe_id = ?`, id).map((x) => x.file);
  const usedIn = r.kind === 'base' && r.yield_product_id
    ? all(`SELECT DISTINCT r2.id, r2.name FROM recipe_ingredients ri JOIN recipes r2 ON r2.id = ri.recipe_id
           WHERE ri.product_id = ? AND r2.status = 'active' ORDER BY r2.name LIMIT 30`, r.yield_product_id)
    : [];
  const variants = r.variant_group
    ? all(`SELECT id, name FROM recipes WHERE variant_group = ? AND id <> ?`, r.variant_group, id) : [];
  return {
    ...summary,
    description: r.description,
    notes: r.notes,
    yield: r.yield_product_id ? { product_id: r.yield_product_id, amount_g: r.yield_amount_g, pieces: r.yield_pieces, piece_unit: r.yield_piece_unit } : null,
    source: {
      type: r.source_type, files, model: r.source_model, prompt: r.source_prompt, generated_at: r.source_generated_at,
      based_on_recipe_id: r.based_on_recipe_id, nutrition_origin: r.nutrition_origin,
    },
    ingredients: ingredients.map((i) => ({ ...i, optional: !!i.optional, pantry_staple: !!i.pantry_staple })),
    steps,
    used_in: usedIn,
    variants,
    nutrition_check: calcNutrition(ingredients.map((i) => ({ product_id: i.product_id, amount_g: i.amount_g })), r.servings),
  };
}

/** Makro na porcję policzone z produktów (do formularza, AI i kontroli danych z PDF). */
export function calcNutrition(items: { product_id: string; amount_g: number | null }[], servings: number) {
  const ids = [...new Set(items.map((i) => i.product_id))];
  const prods = new Map(all(`SELECT id, kcal, protein_g, fat_g, carbs_g, fiber_g FROM products WHERE id IN (${qs(ids.length || 1)})`, ...(ids.length ? ids : [''])).map((p) => [p.id, p]));
  const t = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 };
  const missing: string[] = [];
  for (const i of items) {
    const p = prods.get(i.product_id);
    if (!p || p.kcal == null) { missing.push(i.product_id); continue; }
    const g = (i.amount_g ?? 0) / 100 / Math.max(1, servings);
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += (p[k] ?? 0) * g;
  }
  return { kcal: Math.round(t.kcal), protein_g: round(t.protein_g), fat_g: round(t.fat_g), carbs_g: round(t.carbs_g), fiber_g: round(t.fiber_g), missing };
}

const HEAT = /smaż|gotuj|piecz|podgrz|piekarnik|patel|garn|grill|dusim|dusz|zagotow|blanszuj|opiek|toster|mikrofal|zapiek|rozgrzew|rondel|wrz/i;
const SAVORY = /^(pieprz|czosnek|cebula|sos-sojowy|musztarda|majonez|ketchup|kumin|curry|papryka-(slodka|wedzona|ostra)|oregano|zio|bazylia|tymianek|majeranek|rozmaryn|bulion)/;

export type RecipeInput = {
  name: string; description?: string | null; slots: string[]; servings: number; prep_time_min?: number | null;
  ingredients: { product_id: string; name?: string; amount_g: number | null; household_qty?: number | null; household_unit?: string | null; group_name?: string | null; note?: string | null }[];
  steps: { text: string; section?: string | null }[];
  tags?: string[];
  nutrition?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  source?: { type: 'user' | 'ai_generated' | 'ai_modified'; model?: string; prompt?: string; based_on_recipe_id?: string };
};

/** Zapisuje przepis użytkownika / AI. Makro liczone z produktów; tagi diety i alergeny wyliczane z katalogu. */
export function createRecipe(input: RecipeInput) {
  if (!input.name?.trim()) throw new HttpError(400, 'Podaj nazwę posiłku');
  if (!input.ingredients?.length) throw new HttpError(400, 'Dodaj przynajmniej jeden składnik');
  if (!input.slots?.length) throw new HttpError(400, 'Wybierz porę posiłku');
  const servings = Math.max(1, Math.round(input.servings || 1));
  const prods = new Map(getProducts([...new Set(input.ingredients.map((i) => i.product_id))]).map((p: Row) => [p.id, p]));
  for (const i of input.ingredients) if (!prods.has(i.product_id)) throw new HttpError(400, `Nieznany produkt: ${i.product_id}`);

  // makro: podane wprost (np. wariant przepisu z PDF = wartości PDF + różnica) albo policzone z produktów
  const n = input.nutrition ?? calcNutrition(input.ingredients, servings);
  const origins = new Set([...prods.values()].map((p: Row) => p.origin));
  const allergens = [...new Set([...prods.values()].flatMap((p: Row) => p.allergens as string[]))].sort();
  const diet: string[] = [];
  if (!origins.has('meat') && !origins.has('fish')) {
    diet.push('wegetariańska');
    if (!origins.has('dairy') && !origins.has('egg') && !origins.has('honey')) diet.push('wegańska');
  } else if (!origins.has('meat')) diet.push('pescowegetariańska');
  if (!allergens.includes('gluten')) diet.push('bez-glutenu');
  if (!allergens.includes('mleko')) diet.push('bez-laktozy');
  const text = input.steps.map((s) => s.text).join(' ');
  const features: string[] = [];
  if (!HEAT.test(text)) features.push('bez-gotowania');
  if (/piekarnik|pieczemy|zapiekamy/i.test(text)) features.push('piekarnik');
  if (/lunchbox/i.test(text)) features.push('lunchbox');
  const flavor = input.ingredients.some((i) => SAVORY.test(i.product_id)) || origins.has('meat') || origins.has('fish') ? 'wytrawny' : 'słodki';

  let id = slug(input.name);
  for (let k = 2; get('SELECT 1 FROM recipes WHERE id = ?', id); k++) id = `${slug(input.name)}-${k}`;
  const src = input.source ?? { type: 'user' };
  const ts = now();
  tx(() => {
    run(`INSERT INTO recipes (id, kind, name, description, servings, kcal, protein_g, carbs_g, fat_g, flavor, prep_time_min,
           source_type, source_model, source_prompt, source_generated_at, based_on_recipe_id, nutrition_origin, created_at, updated_at)
         VALUES (?, 'meal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated', ?, ?)`,
      id, input.name.trim(), input.description ?? null, servings, n.kcal, n.protein_g, n.carbs_g, n.fat_g, flavor,
      input.prep_time_min ?? null, src.type, src.model ?? null, src.prompt ?? null, src.type === 'user' ? null : ts,
      src.based_on_recipe_id ?? null, ts, ts);
    for (const s of input.slots) run('INSERT INTO recipe_slots VALUES (?, ?)', id, s);
    for (const d of diet) run(`INSERT INTO recipe_tags VALUES (?, 'diet', ?)`, id, d);
    for (const f of features) run(`INSERT INTO recipe_tags VALUES (?, 'features', ?)`, id, f);
    for (const t of new Set(input.tags ?? [])) run(`INSERT OR IGNORE INTO recipe_tags VALUES (?, 'custom', ?)`, id, t);
    for (const a of allergens) run('INSERT INTO recipe_allergens VALUES (?, ?)', id, a);
    input.ingredients.forEach((i, k) =>
      run(`INSERT INTO recipe_ingredients (recipe_id, position, product_id, name, amount_g, household_qty, household_unit, group_name, note)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        id, k + 1, i.product_id, i.name?.trim() || prods.get(i.product_id)!.name, i.amount_g, i.household_qty ?? null,
        i.household_unit ?? null, i.group_name ?? null, i.note ?? null));
    input.steps.filter((s) => s.text?.trim()).forEach((s, k) => run('INSERT INTO recipe_steps VALUES (?, ?, ?, ?, NULL)', id, k + 1, s.text.trim(), s.section ?? null));
    run('INSERT INTO recipe_search (recipe_id, text) VALUES (?, ?)', id,
      searchText(`${input.name} ${input.ingredients.map((i) => i.name ?? prods.get(i.product_id)!.name).join(' ')}`));
  });
  return getRecipe(id);
}

export function patchRecipe(id: string, patch: { is_favorite?: boolean; rating?: number | null; notes?: string | null; status?: string }) {
  const r = get('SELECT source_type FROM recipes WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Nie ma takiego przepisu');
  if (patch.status === 'archived' && r.source_type === 'pdf_import') throw new HttpError(400, 'Przepisów z jadłospisów PDF nie można usuwać – możesz je ukryć z ulubionych.');
  const sets: string[] = [], p: (string | number | null)[] = [];
  if (patch.is_favorite !== undefined) { sets.push('is_favorite = ?'); p.push(patch.is_favorite ? 1 : 0); }
  if (patch.rating !== undefined) { sets.push('rating = ?'); p.push(patch.rating); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); p.push(patch.notes); }
  if (patch.status) { sets.push('status = ?'); p.push(patch.status); }
  if (sets.length) run(`UPDATE recipes SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...p, now(), id);
  return getRecipe(id);
}
