// Podmiana pojedynczego składnika: lista wymienników z PDF + podobne produkty z katalogu, zapis jako wariant przepisu
import { all, get } from './store.ts';
import { HttpError } from './http.ts';
import { createRecipe, getProfile, getRecipe } from './catalog.ts';
import { patchMeal } from './planner.ts';
import { round } from './text.ts';

type Prod = { id: string; name: string; category_id: string; kcal: number; protein_g: number; fat_g: number; carbs_g: number; pantry_staple: number };

const PROD_COLS = 'p.id, p.name, p.category_id, p.kcal, p.protein_g, p.fat_g, p.carbs_g, p.pantry_staple';
const r5 = (g: number) => (g < 20 ? Math.round(g) : Math.round(g / 5) * 5);

/** odległość profili: udział energii z B/W/T + gęstość energetyczna */
function distance(a: Prod, b: Prod) {
  const share = (p: Prod) => {
    const e = p.protein_g * 4 + p.carbs_g * 4 + p.fat_g * 9 || 1;
    return [(p.protein_g * 4) / e, (p.carbs_g * 4) / e, (p.fat_g * 9) / e];
  };
  const [x, y] = [share(a), share(b)];
  const dens = Math.abs(Math.log((a.kcal + 10) / (b.kcal + 10)));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) + dens * 0.35;
}

export function ingredientSubstitutes(recipeId: string, position: number) {
  const r = get('SELECT id, servings, kcal, protein_g, carbs_g, fat_g FROM recipes WHERE id = ?', recipeId);
  if (!r) throw new HttpError(404, 'Nie ma takiego przepisu');
  const ing = get('SELECT position, product_id, name, amount_g FROM recipe_ingredients WHERE recipe_id = ? AND position = ?', recipeId, position);
  if (!ing) throw new HttpError(404, 'Nie ma takiego składnika');
  const orig = get<Prod>(`SELECT ${PROD_COLS} FROM products p WHERE p.id = ?`, ing.product_id)!;
  const profile = getProfile();
  const excluded = new Set([
    ...profile.excluded_allergens.length
      ? all(`SELECT product_id FROM product_allergens WHERE allergen_id IN (${profile.excluded_allergens.map(() => '?').join(',')})`, ...profile.excluded_allergens).map((x) => x.product_id)
      : [],
    ...(profile.disliked_products ?? []),
  ]);
  const pantry = new Set(all('SELECT product_id FROM pantry_items').map((x) => x.product_id));
  const amount = ing.amount_g ?? 0;

  const option = (p: Prod, grams: number, source: 'exchange' | 'similar', note?: string) => {
    const d = (k: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g') => ((p[k] * grams - orig[k] * amount) / 100) / r.servings;
    const allergens = all('SELECT allergen_id FROM product_allergens WHERE product_id = ?', p.id).map((x) => x.allergen_id);
    return {
      product_id: p.id, name: p.name, amount_g: grams, source, note: note ?? null, in_pantry: pantry.has(p.id), allergens,
      delta: { kcal: Math.round(d('kcal')), protein_g: round(d('protein_g')), fat_g: round(d('fat_g')), carbs_g: round(d('carbs_g')) },
      recipe_kcal: Math.round(r.kcal + d('kcal')),
    };
  };

  // 1) lista wymienników z jadłospisów (dietetyk)
  const exchange = [];
  for (const g of all(`SELECT g.id, g.name, g.mode, si.grams FROM substitution_items si JOIN substitution_groups g ON g.id = si.group_id
                       WHERE si.product_id = ?`, ing.product_id)) {
    for (const it of all(`SELECT si.grams, ${PROD_COLS} FROM substitution_items si JOIN products p ON p.id = si.product_id
                          WHERE si.group_id = ? AND si.product_id <> ? ORDER BY si.position`, g.id, ing.product_id)) {
      if (excluded.has(it.id) || it.kcal == null) continue;
      const grams = g.mode === 'equivalent_portions' && g.grams && it.grams ? r5((amount * it.grams) / g.grams) : amount;
      exchange.push(option(it, grams, 'exchange', g.name));
    }
  }

  // 2) podobne produkty z tej samej kategorii – gramatura wyrównuje kalorie
  const seen = new Set(exchange.map((o) => o.product_id));
  const similar = all<Prod>(`SELECT ${PROD_COLS} FROM products p WHERE p.category_id = ? AND p.id <> ? AND p.shoppable = 1 AND p.kcal IS NOT NULL`,
    orig.category_id, orig.id)
    .filter((p) => !seen.has(p.id) && !excluded.has(p.id))
    .map((p) => ({ p, dist: distance(orig, p) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8)
    .map(({ p }) => {
      // produkty białkowe wyrównujemy białkiem (porcja łososia → porcja pstrąga), resztę kaloriami
      const proteinFood = (orig.protein_g * 4) / (orig.kcal || 1) >= 0.3 && p.protein_g > 3;
      const ratio = proteinFood ? orig.protein_g / p.protein_g : orig.kcal > 20 && p.kcal > 20 ? orig.kcal / p.kcal : 1;
      const grams = r5(Math.min(amount * 2, Math.max(amount * 0.5, amount * ratio)));
      return option(p, grams, 'similar', proteinFood ? 'tyle samo białka' : 'tyle samo kcal');
    });

  return { recipe_id: r.id, position, original: { product_id: orig.id, name: ing.name, amount_g: ing.amount_g, kcal: orig.kcal }, exchange, similar };
}

/** Wariant przepisu z podmienionymi składnikami. Makro = wartości przepisu + różnica wyliczona z produktów. */
export function createVariant(recipeId: string, input: { replacements: { position: number; product_id: string; amount_g: number }[]; plan_meal_id?: number }) {
  const r = getRecipe(recipeId);
  if (!r) throw new HttpError(404, 'Nie ma takiego przepisu');
  if (!input.replacements?.length) throw new HttpError(400, 'Wybierz przynajmniej jedną podmianę');
  const repl = new Map(input.replacements.map((x) => [x.position, x]));
  const prods = new Map(all<Prod>(`SELECT ${PROD_COLS} FROM products p WHERE p.id IN (${[...new Set([...r.ingredients.map((i: any) => i.product_id), ...input.replacements.map((x) => x.product_id)])].map(() => '?').join(',')})`,
    ...new Set([...r.ingredients.map((i: any) => i.product_id), ...input.replacements.map((x) => x.product_id)])).map((p) => [p.id, p]));
  const delta = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const changes: string[] = [];
  const ingredients = r.ingredients.map((i: any) => {
    const x = repl.get(i.position);
    if (!x) return { product_id: i.product_id, name: i.name, amount_g: i.amount_g, household_qty: i.household_qty, household_unit: i.household_unit, group_name: i.group_name, note: i.note };
    const np = prods.get(x.product_id);
    if (!np) throw new HttpError(400, `Nieznany produkt: ${x.product_id}`);
    const op = prods.get(i.product_id)!;
    for (const k of Object.keys(delta) as (keyof typeof delta)[]) delta[k] += (np[k] * x.amount_g - op[k] * (i.amount_g ?? 0)) / 100 / r.servings;
    changes.push(`${np.name} zamiast: ${i.name}`);
    const m = get('SELECT grams FROM product_measures WHERE product_id = ? AND unit_id = ?', np.id, i.household_unit ?? '');
    return {
      product_id: np.id, name: np.name, amount_g: x.amount_g,
      household_qty: m ? Math.round((x.amount_g / m.grams) * 4) / 4 || null : null, household_unit: m ? i.household_unit : null,
      group_name: i.group_name, note: null,
    };
  });
  const short = changes.length === 1 ? ` (z: ${prods.get(input.replacements[0].product_id)!.name.toLowerCase()})` : ' – mój wariant';
  const recipe = createRecipe({
    name: `${r.name}${short}`.slice(0, 140),
    description: `Wariant przepisu „${r.name}”: ${changes.join('; ')}.`,
    slots: r.slots, servings: r.servings, prep_time_min: r.prep_time_min,
    ingredients, steps: r.steps.map((s: any) => ({ text: s.text, section: s.section })), tags: ['wariant'],
    nutrition: {
      kcal: Math.round(r.kcal + delta.kcal), protein_g: round(r.protein_g + delta.protein_g),
      carbs_g: round(r.carbs_g + delta.carbs_g), fat_g: round(r.fat_g + delta.fat_g),
    },
    source: { type: 'user', based_on_recipe_id: r.id },
  });
  if (input.plan_meal_id) patchMeal(input.plan_meal_id, { recipe_id: recipe!.id, portions: undefined });
  return recipe;
}
