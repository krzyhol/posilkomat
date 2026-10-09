// Spiżarnia: zapasy, zużywanie przy „zjedzone”, przenoszenie zakupów i „co ugotuję z tego, co mam”
import { all, get, run, tx, now } from './store.ts';
import { HttpError } from './http.ts';
import { recipeSummaries, getProfile } from './catalog.ts';
import { todayIso } from './text.ts';

const daysTo = (iso: string | null) => {
  if (!iso) return null;
  return Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(todayIso() + 'T12:00:00Z')) / 86400000);
};

export function listPantry() {
  return all(`SELECT pi.product_id, pi.amount_g, pi.expires_on, pi.updated_at, p.name, p.category_id, c.name AS category_name,
      c.position AS category_position
    FROM pantry_items pi JOIN products p ON p.id = pi.product_id JOIN product_categories c ON c.id = p.category_id
    ORDER BY c.position, p.name COLLATE NOCASE`)
    .map((r) => ({ ...r, expires_in_days: daysTo(r.expires_on) }));
}

/** Ustawia stan produktu (amount_g = null → „mam”, bez liczenia). */
export function setPantryItem(productId: string, input: { amount_g?: number | null; expires_on?: string | null; add_g?: number }) {
  if (!get('SELECT 1 FROM products WHERE id = ?', productId)) throw new HttpError(404, 'Nie ma takiego produktu');
  const cur = get('SELECT amount_g, expires_on FROM pantry_items WHERE product_id = ?', productId);
  let amount = input.amount_g === undefined ? cur?.amount_g ?? null : input.amount_g;
  if (input.add_g) amount = cur && cur.amount_g === null ? null : (cur?.amount_g ?? 0) + input.add_g;
  if (amount !== null && amount < 0) amount = 0;
  const expires = input.expires_on === undefined ? cur?.expires_on ?? null : input.expires_on || null;
  run(`INSERT INTO pantry_items (product_id, amount_g, expires_on, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET amount_g = excluded.amount_g, expires_on = excluded.expires_on, updated_at = excluded.updated_at`,
    productId, amount === null ? null : Math.round(amount * 10) / 10, expires, now());
  return listPantry();
}

export function removePantryItem(productId: string) {
  run('DELETE FROM pantry_items WHERE product_id = ?', productId);
  return listPantry();
}

/** Zjedzony posiłek zużywa zapasy (sign = -1), cofnięcie „zjedzone” je oddaje (sign = +1). Pozycje „mam” bez ilości zostają. */
export function consumeForMeal(mealId: number, sign: -1 | 1) {
  const rows = all(`SELECT ri.product_id, ri.amount_g * m.portions / r.servings AS g
      FROM plan_meals m JOIN recipes r ON r.id = m.recipe_id JOIN recipe_ingredients ri ON ri.recipe_id = r.id
      JOIN pantry_items pi ON pi.product_id = ri.product_id
      WHERE m.id = ? AND ri.amount_g IS NOT NULL AND pi.amount_g IS NOT NULL`, mealId);
  for (const r of rows)
    run('UPDATE pantry_items SET amount_g = MAX(0, ROUND(amount_g + ?, 1)), updated_at = ? WHERE product_id = ?', sign * r.g, now(), r.product_id);
}

/** Kupione pozycje listy trafiają do spiżarni (raz – potem są oznaczone jako przeniesione). */
export function stockFromList(listId: string) {
  const items = all(`SELECT id, product_id, amount_g FROM shopping_items
                     WHERE list_id = ? AND checked = 1 AND stocked = 0 AND product_id IS NOT NULL AND amount_g > 0`, listId);
  tx(() => {
    for (const i of items) {
      setPantryItem(i.product_id, { add_g: i.amount_g });
      run('UPDATE shopping_items SET stocked = 1 WHERE id = ?', i.id);
    }
  });
  return { moved: items.length };
}

/** Ile każdego produktu pokrywa spiżarnia (do listy zakupów). */
export function pantryCoverage(): Map<string, number | null> {
  return new Map(all('SELECT product_id, amount_g FROM pantry_items').map((r) => [r.product_id, r.amount_g]));
}

/** „Co ugotuję z tego, co mam”: przepisy z największą częścią składników w spiżarni, wyżej te, które ratują produkty z krótkim terminem. */
export function pantrySuggestions(opts: { slot?: string; limit?: number; exclude_recipes?: Set<string> } = {}) {
  const pantry = all(`SELECT pi.product_id, pi.amount_g, pi.expires_on, p.name FROM pantry_items pi JOIN products p ON p.id = pi.product_id`);
  if (!pantry.length) return [];
  const have = new Map(pantry.map((p) => [p.product_id, p]));
  const rows = all(`SELECT ri.recipe_id, ri.product_id, ri.amount_g, r.servings, p.name
      FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id JOIN products p ON p.id = ri.product_id
      WHERE r.kind = 'meal' AND r.status = 'active' AND p.pantry_staple = 0 AND p.shoppable = 1
        ${opts.slot ? `AND r.id IN (SELECT recipe_id FROM recipe_slots WHERE slot_id = ?)` : ''}`, ...(opts.slot ? [opts.slot] : []));
  const prof = getProfile();
  const banned = prof.disliked_products ?? [];
  const bannedRecipes = new Set([...(prof.disliked_recipes ?? []),
    ...(banned.length ? all(`SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE product_id IN (${banned.map(() => '?').join(',')})`, ...banned).map((x) => x.recipe_id) : [])]);
  const byRecipe = new Map<string, typeof rows>();
  for (const r of rows) byRecipe.set(r.recipe_id, [...(byRecipe.get(r.recipe_id) ?? []), r]);

  const scored: { id: string; have: string[]; missing: string[]; expiring: string[]; score: number }[] = [];
  for (const [id, ings] of byRecipe) {
    if (opts.exclude_recipes?.has(id) || bannedRecipes.has(id)) continue;
    const hit: string[] = [], miss: string[] = [], expiring: string[] = [];
    for (const i of ings) {
      const p = have.get(i.product_id);
      const enough = p && (p.amount_g === null || i.amount_g === null || p.amount_g >= (i.amount_g / i.servings) * 0.8);
      if (enough) {
        hit.push(i.name);
        const d = daysTo(p!.expires_on);
        if (d !== null && d <= 3) expiring.push(i.name);
      } else miss.push(i.name);
    }
    if (!hit.length) continue;
    const ratio = hit.length / ings.length;
    scored.push({ id, have: hit, missing: miss, expiring, score: ratio * 10 + hit.length * 0.3 + expiring.length * 2 - miss.length * 0.4 });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, opts.limit ?? 12);
  const summaries = new Map(recipeSummaries(top.map((t) => t.id)).map((r) => [r.id, r]));
  return top.map((t) => ({ recipe: summaries.get(t.id), have: t.have, missing: t.missing, expiring: t.expiring }));
}
