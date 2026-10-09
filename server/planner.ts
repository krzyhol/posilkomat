// Jadłospisy: układanie, szablony z PDF, podmiana posiłków, „dziś”
import { all, get, run, tx, qs, now, type Row } from './db.ts';
import { HttpError } from './http.ts';
import { ftsQuery, slug, plural } from './text.ts';
import { getProfile, recipeSummaries } from './catalog.ts';

const SLOT_SHARE: Record<string, number> = { breakfast: 0.225, second_breakfast: 0.225, lunch: 0.25, dinner: 0.22, snack: 0.08 };
const SLOT_ORDER = ['breakfast', 'second_breakfast', 'lunch', 'dinner', 'snack'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const plDate = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** porcja dopasowana do celu kcal: krok 0,1, zakres 0,5–2; ±8% zostawiamy 1 porcję */
export function fitPortions(recipeKcal: number, target: number) {
  const ratio = target / recipeKcal;
  if (Math.abs(ratio - 1) <= 0.08) return 1;
  return Math.min(2, Math.max(0.5, Math.round(ratio * 10) / 10));
}

function slotTimes() {
  return new Map(all('SELECT id, time_from, time_to FROM meal_slots').map((s) => [s.id, s]));
}

type PoolRecipe = { id: string; kcal: number; servings: number; flavor: string; dish: string[] };

function pool(slot: string, opts: { diet?: string | null; exclude: string[] }): PoolRecipe[] {
  const where = [`r.kind = 'meal'`, `r.status = 'active'`, `r.id IN (SELECT recipe_id FROM recipe_slots WHERE slot_id = ?)`];
  const p: string[] = [slot];
  if (opts.diet) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'diet' AND tag = ?)`); p.push(opts.diet); }
  if (opts.exclude.length) {
    where.push(`r.id NOT IN (SELECT recipe_id FROM recipe_allergens WHERE allergen_id IN (${qs(opts.exclude.length)}))`);
    p.push(...opts.exclude);
  }
  const rows = all(`SELECT r.id, r.kcal, r.servings, r.flavor,
      (SELECT group_concat(tag) FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag_type = 'dish_type') AS dish
    FROM recipes r WHERE ${where.join(' AND ')}`, ...p);
  return rows.map((r) => ({ id: r.id, kcal: r.kcal, servings: r.servings, flavor: r.flavor, dish: r.dish ? r.dish.split(',') : [] }));
}

export type NewPlan = {
  name?: string; start_date?: string; days?: number; target_kcal?: number; people?: number;
  mode?: 'auto' | 'template'; template_id?: string; slots?: string[]; diet?: string | null;
  exclude_allergens?: string[]; meal_prep?: boolean;
};

export function createPlan(input: NewPlan) {
  const profile = getProfile();
  const start = input.start_date ?? todayIso();
  const target = Math.round(input.target_kcal ?? profile.target_kcal);
  const people = Math.max(1, Math.round(input.people ?? profile.people));
  const exclude = input.exclude_allergens ?? profile.excluded_allergens;
  const diet = input.diet === undefined ? profile.diet : input.diet;
  const times = slotTimes();

  if (input.mode === 'template') {
    const tpl = get(`SELECT * FROM plans WHERE id = ? AND type = 'template'`, input.template_id ?? '');
    if (!tpl) throw new HttpError(404, 'Nie ma takiego szablonu');
    const tdays = all(`SELECT * FROM plan_days WHERE plan_id = ? ORDER BY day_number`, tpl.id);
    const n = Math.min(input.days ?? tdays.length, tdays.length);
    const scale = Math.abs(target / tpl.target_kcal - 1) <= 0.05 ? 1 : target / tpl.target_kcal;
    const id = uniquePlanId(input.name ?? `Jadłospis od ${start}`);
    tx(() => {
      run(`INSERT INTO plans (id, name, type, start_date, target_kcal, people, source_note) VALUES (?, ?, 'user', ?, ?, ?, ?)`,
        id, input.name?.trim() || `${tpl.name.replace(/ –.*/, '')} · od ${plDate(start)}`, start, target, people, `Na podstawie szablonu: ${tpl.name}`);
      tdays.slice(0, n).forEach((d, i) => {
        const dayId = Number(run(`INSERT INTO plan_days (plan_id, day_number, date, fiber_g, calcium_mg, magnesium_mg) VALUES (?,?,?,?,?,?)`,
          id, i + 1, addDays(start, i), d.fiber_g, d.calcium_mg, d.magnesium_mg).lastInsertRowid);
        for (const m of all(`SELECT * FROM plan_meals WHERE plan_day_id = ? ORDER BY position`, d.id))
          run(`INSERT INTO plan_meals (plan_day_id, position, slot_id, time_from, time_to, recipe_id, portions) VALUES (?,?,?,?,?,?,?)`,
            dayId, m.position, m.slot_id, m.time_from, m.time_to, m.recipe_id, Math.round(m.portions * scale * 10) / 10);
      });
    });
    return getPlan(id);
  }

  // ---- tryb automatyczny
  const days = Math.max(1, Math.min(28, Math.round(input.days ?? 7)));
  const slots = (input.slots?.length ? input.slots : SLOT_ORDER).filter((s) => SLOT_ORDER.includes(s));
  const shareSum = slots.reduce((a, s) => a + SLOT_SHARE[s], 0);
  const pools = new Map(slots.map((s) => [s, pool(s, { diet, exclude })]));
  for (const [s, p] of pools) if (p.length < 3) throw new HttpError(400, `Za mało przepisów dla pory „${s}” przy wybranych ograniczeniach – poluzuj filtry.`);

  const lastUsed = new Map<string, number>(); // recipe -> dzień ostatniego użycia
  type Planned = { slot: string; recipe: PoolRecipe; portions: number; leftoverOf?: { day: number; slot: string } };
  const grid: Planned[][] = Array.from({ length: days }, () => []);
  const taken = new Set<string>(); // "dzień|slot" zajęte przez resztki

  for (let d = 0; d < days; d++) {
    const flavorsToday: string[] = [];
    for (const slot of slots) {
      if (taken.has(`${d}|${slot}`)) continue;
      const slotTarget = (target * SLOT_SHARE[slot]) / shareSum;
      const scored = pools.get(slot)!.map((r) => {
        let s = Math.abs(r.kcal - slotTarget) / slotTarget;
        const lu = lastUsed.get(r.id);
        if (lu !== undefined) s += d - lu < 5 ? 2 : 0.5;
        if (slot !== 'snack' && flavorsToday.filter((f) => f === r.flavor).length >= 2) s += 0.15;
        return { r, s: s + Math.random() * 0.12 };
      }).sort((a, b) => a.s - b.s);
      const pick = scored[Math.floor(Math.random() * Math.min(6, scored.length))].r;
      const portions = fitPortions(pick.kcal, slotTarget);
      grid[d].push({ slot, recipe: pick, portions });
      lastUsed.set(pick.id, d);
      flavorsToday.push(pick.flavor);
      // gotowanie na zapas: kolejne porcje przepisu wieloporcjowego lądują w kolejnych dniach jako resztki
      if (input.meal_prep !== false && pick.servings > 1) {
        const extra = Math.min(2, Math.floor(pick.servings / portions) - 1);
        for (let k = 1; k <= extra && d + k < days; k++) {
          grid[d + k].push({ slot, recipe: pick, portions, leftoverOf: { day: d, slot } });
          taken.add(`${d + k}|${slot}`);
          lastUsed.set(pick.id, d + k);
        }
      }
    }
  }

  const id = uniquePlanId(input.name ?? `Jadłospis od ${start}`);
  tx(() => {
    run(`INSERT INTO plans (id, name, type, start_date, target_kcal, people, source_note) VALUES (?, ?, 'user', ?, ?, ?, ?)`,
      id, input.name?.trim() || `${days} dni od ${plDate(start)}`, start, target, people,
      [diet && `dieta: ${diet}`, exclude.length && `bez: ${exclude.join(', ')}`].filter(Boolean).join(' · ') || null);
    const mealIds = new Map<string, number>();
    grid.forEach((meals, d) => {
      const dayId = Number(run(`INSERT INTO plan_days (plan_id, day_number, date) VALUES (?,?,?)`, id, d + 1, addDays(start, d)).lastInsertRowid);
      meals.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)).forEach((m, k) => {
        const t = times.get(m.slot);
        const leftoverId = m.leftoverOf ? mealIds.get(`${m.leftoverOf.day}|${m.leftoverOf.slot}`) ?? null : null;
        const mid = Number(run(`INSERT INTO plan_meals (plan_day_id, position, slot_id, time_from, time_to, recipe_id, portions, leftover_of_meal_id)
                         VALUES (?,?,?,?,?,?,?,?)`, dayId, k + 1, m.slot, t?.time_from ?? null, t?.time_to ?? null, m.recipe.id, m.portions,
          leftoverId).lastInsertRowid);
        if (!m.leftoverOf) mealIds.set(`${d}|${m.slot}`, mid);
      });
    });
  });
  return getPlan(id);
}

function uniquePlanId(name: string) {
  const base = slug(name) || 'jadlospis';
  let id = base;
  for (let n = 2; get('SELECT 1 FROM plans WHERE id = ?', id); n++) id = `${base}-${n}`;
  return id;
}

export function listPlans() {
  const rows = all(`SELECT p.*, (SELECT COUNT(*) FROM plan_days d WHERE d.plan_id = p.id) AS days,
      (SELECT MAX(date) FROM plan_days d WHERE d.plan_id = p.id) AS end_date
    FROM plans p ORDER BY p.type DESC, p.created_at DESC, p.id`);
  return {
    user: rows.filter((r) => r.type === 'user'),
    templates: rows.filter((r) => r.type === 'template'),
  };
}

export function getPlan(id: string) {
  const plan = get('SELECT * FROM plans WHERE id = ?', id);
  if (!plan) throw new HttpError(404, 'Nie ma takiego jadłospisu');
  const days = all('SELECT * FROM plan_days WHERE plan_id = ? ORDER BY day_number', id);
  const meals = all(`SELECT m.* FROM plan_meals m JOIN plan_days d ON d.id = m.plan_day_id WHERE d.plan_id = ? ORDER BY m.position`, id);
  const recipes = new Map(recipeSummaries([...new Set(meals.map((m) => m.recipe_id))]).map((r) => [r.id, r]));
  const leftoverCount = new Map<number, number>();
  for (const m of meals) if (m.leftover_of_meal_id) leftoverCount.set(m.leftover_of_meal_id, (leftoverCount.get(m.leftover_of_meal_id) ?? 0) + 1);
  const dayOfMeal = new Map(meals.map((m) => [m.id, days.find((d) => d.id === m.plan_day_id)?.day_number]));
  return {
    ...plan,
    days: days.map((d) => {
      const dm = meals.filter((m) => m.plan_day_id === d.id).sort((a, b) => SLOT_ORDER.indexOf(a.slot_id) - SLOT_ORDER.indexOf(b.slot_id) || a.position - b.position);
      const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, eaten_kcal: 0 };
      for (const m of dm) {
        if (m.status === 'skipped') continue;
        const r = recipes.get(m.recipe_id)!;
        totals.kcal += r.kcal * m.portions; totals.protein_g += r.protein_g * m.portions;
        totals.carbs_g += r.carbs_g * m.portions; totals.fat_g += r.fat_g * m.portions;
        if (m.status === 'eaten') totals.eaten_kcal += r.kcal * m.portions;
      }
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = Math.round(totals[k]);
      return {
        id: d.id, day_number: d.day_number, date: d.date,
        micros: d.fiber_g != null ? { fiber_g: d.fiber_g, calcium_mg: d.calcium_mg, magnesium_mg: d.magnesium_mg } : null,
        totals,
        meals: dm.map((m) => ({
          id: m.id, slot: m.slot_id, time_from: m.time_from, time_to: m.time_to, portions: m.portions, status: m.status,
          leftover_of_meal_id: m.leftover_of_meal_id, leftover_from_day: m.leftover_of_meal_id ? dayOfMeal.get(m.leftover_of_meal_id) ?? null : null,
          leftovers: leftoverCount.get(m.id) ?? 0, swapped_from_recipe_id: m.swapped_from_recipe_id,
          recipe: recipes.get(m.recipe_id),
        })),
      };
    }),
  };
}

export function deletePlan(id: string) {
  const p = get('SELECT type FROM plans WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Nie ma takiego jadłospisu');
  if (p.type === 'template') throw new HttpError(400, 'Szablonów z PDF nie usuwamy.');
  run('DELETE FROM plans WHERE id = ?', id);
}

export function getToday(date = todayIso()) {
  const day = get(`SELECT d.id, d.plan_id FROM plan_days d JOIN plans p ON p.id = d.plan_id
                   WHERE p.type = 'user' AND d.date = ? ORDER BY p.created_at DESC LIMIT 1`, date);
  if (!day) {
    const upcoming = get(`SELECT p.id, p.name, MIN(d.date) AS start FROM plans p JOIN plan_days d ON d.plan_id = p.id
                          WHERE p.type = 'user' AND d.date > ? GROUP BY p.id ORDER BY start LIMIT 1`, date);
    return { date, plan: null, day: null, upcoming: upcoming ?? null };
  }
  const plan = getPlan(day.plan_id);
  const d = plan.days.find((x: Row) => x.id === day.id);
  return { date, plan: { id: plan.id, name: plan.name, target_kcal: plan.target_kcal, people: plan.people, days: plan.days.length }, day: d, upcoming: null };
}

function mealRow(id: number) {
  const m = get(`SELECT m.*, d.plan_id, d.day_number FROM plan_meals m JOIN plan_days d ON d.id = m.plan_day_id WHERE m.id = ?`, id);
  if (!m) throw new HttpError(404, 'Nie ma takiego posiłku w jadłospisie');
  return m;
}

export function patchMeal(id: number, patch: { recipe_id?: string; portions?: number; status?: string }) {
  const m = mealRow(id);
  tx(() => {
    if (patch.recipe_id && patch.recipe_id !== m.recipe_id) {
      const r = get(`SELECT id, kcal, servings FROM recipes WHERE id = ? AND kind = 'meal'`, patch.recipe_id);
      if (!r) throw new HttpError(404, 'Nie ma takiego przepisu');
      const old = get('SELECT kcal FROM recipes WHERE id = ?', m.recipe_id)!;
      const portions = patch.portions ?? fitPortions(r.kcal, old.kcal * m.portions);
      run(`UPDATE plan_meals SET recipe_id = ?, portions = ?, swapped_from_recipe_id = COALESCE(swapped_from_recipe_id, ?),
             leftover_of_meal_id = NULL, status = 'planned' WHERE id = ?`, r.id, portions, m.recipe_id, id);
      // resztki z podmienianego posiłku: idą za nowym przepisem, jeśli starczy porcji, inaczej stają się samodzielne
      const leftovers = all('SELECT id FROM plan_meals WHERE leftover_of_meal_id = ? ORDER BY id', id);
      const fits = Math.max(0, Math.floor(r.servings / portions) - 1);
      leftovers.forEach((l, i) => {
        if (i < fits) run('UPDATE plan_meals SET recipe_id = ?, portions = ? WHERE id = ?', r.id, portions, l.id);
        else run('UPDATE plan_meals SET leftover_of_meal_id = NULL WHERE id = ?', l.id);
      });
    } else if (patch.portions) {
      run('UPDATE plan_meals SET portions = ? WHERE id = ?', Math.min(4, Math.max(0.25, patch.portions)), id);
    }
    if (patch.status) {
      if (!['planned', 'eaten', 'skipped'].includes(patch.status)) throw new HttpError(400, 'Nieznany status');
      run('UPDATE plan_meals SET status = ? WHERE id = ?', patch.status, id);
    }
    run('UPDATE plans SET updated_at = ? WHERE id = ?', now(), m.plan_id);
  });
  return getPlan(m.plan_id);
}

export function addMeal(dayId: number, input: { slot: string; recipe_id: string; portions?: number }) {
  const d = get('SELECT * FROM plan_days WHERE id = ?', dayId);
  if (!d) throw new HttpError(404, 'Nie ma takiego dnia');
  const t = slotTimes().get(input.slot);
  if (!t) throw new HttpError(400, 'Nieznana pora posiłku');
  const pos = (get('SELECT MAX(position) AS p FROM plan_meals WHERE plan_day_id = ?', dayId)?.p ?? 0) + 1;
  run(`INSERT INTO plan_meals (plan_day_id, position, slot_id, time_from, time_to, recipe_id, portions) VALUES (?,?,?,?,?,?,?)`,
    dayId, pos, input.slot, t.time_from, t.time_to, input.recipe_id, input.portions ?? 1);
  return getPlan(d.plan_id);
}

export function deleteMeal(id: number) {
  const m = mealRow(id);
  run('DELETE FROM plan_meals WHERE id = ?', id);
  return getPlan(m.plan_id);
}

const GENERIC_DISH = ['przekąska-prosta', 'danie-z-kaszą-lub-ryżem', 'danie-mięsne-lub-rybne', 'zestaw-z-gotowych-produktów', 'warzywa-pieczone-lub-grillowane'];

/** Ranking zamienników dla posiłku w jadłospisie, z powodami do pokazania w UI. */
export function swapCandidates(mealId: number, q: { q?: string; flavor?: string; diet?: string; feature?: string; any_slot?: boolean; limit?: number }) {
  const m = mealRow(mealId);
  const profile = getProfile();
  const cur = recipeSummaries([m.recipe_id])[0];
  const targetKcal = cur.kcal * m.portions;
  const compat = all('SELECT compatible_slot_id AS id FROM slot_swap_compatibility WHERE slot_id = ? ORDER BY position', m.slot_id).map((r) => r.id);
  const where = [`r.kind = 'meal'`, `r.status = 'active'`, `r.id <> ?`, `r.kcal BETWEEN ? AND ?`];
  const p: (string | number)[] = [m.recipe_id, targetKcal * 0.45, targetKcal * 1.8];
  if (!q.any_slot) { where.push(`r.id IN (SELECT recipe_id FROM recipe_slots WHERE slot_id IN (${qs(compat.length)}))`); p.push(...compat); }
  const fq = q.q ? ftsQuery(q.q) : '';
  if (fq) { where.push(`r.id IN (SELECT recipe_id FROM recipes_fts WHERE recipes_fts MATCH ?)`); p.push(fq); }
  if (q.flavor) { where.push('r.flavor = ?'); p.push(q.flavor); }
  const diet = q.diet ?? profile.diet;
  if (diet) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'diet' AND tag = ?)`); p.push(diet); }
  if (q.feature) { where.push(`r.id IN (SELECT recipe_id FROM recipe_tags WHERE tag_type = 'features' AND tag = ?)`); p.push(q.feature); }
  if (profile.excluded_allergens.length) {
    where.push(`r.id NOT IN (SELECT recipe_id FROM recipe_allergens WHERE allergen_id IN (${qs(profile.excluded_allergens.length)}))`);
    p.push(...profile.excluded_allergens);
  }
  const ids = all(`SELECT r.id FROM recipes r WHERE ${where.join(' AND ')}`, ...p).map((r) => r.id);
  if (!ids.length) return { current: { ...cur, portions: m.portions, kcal_total: Math.round(targetKcal) }, items: [] };

  const cands = recipeSummaries(ids);
  // produkty już kupowane w tym jadłospisie (bez przypraw/oleju) – podmiana na coś z podobnych zakupów
  const planProducts = new Set(all(`SELECT DISTINCT ri.product_id FROM plan_meals pm JOIN plan_days d ON d.id = pm.plan_day_id
      JOIN recipe_ingredients ri ON ri.recipe_id = pm.recipe_id JOIN products pr ON pr.id = ri.product_id
      WHERE d.plan_id = ? AND pm.id <> ? AND pr.pantry_staple = 0 AND pr.shoppable = 1`, m.plan_id, mealId).map((r) => r.product_id));
  const candIng = all(`SELECT ri.recipe_id, ri.product_id, p.name FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id
      WHERE ri.recipe_id IN (${qs(ids.length)}) AND p.pantry_staple = 0 AND p.shoppable = 1`, ...ids);
  const usedInPlan = new Set(all(`SELECT pm.recipe_id FROM plan_meals pm JOIN plan_days d ON d.id = pm.plan_day_id WHERE d.plan_id = ?`, m.plan_id).map((r) => r.recipe_id));

  const scored = cands.map((c) => {
    const portions = fitPortions(c.kcal, targetKcal);
    const kcal = Math.round(c.kcal * portions);
    const delta = kcal - Math.round(targetKcal);
    const reasons: { kind: string; text: string; good: boolean }[] = [];
    let s = 0;
    const deltaPct = Math.abs(c.kcal - targetKcal) / targetKcal;
    s -= deltaPct * 6;
    reasons.push({ kind: 'kcal', text: delta === 0 ? 'te same kcal' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} kcal`, good: Math.abs(delta) <= targetKcal * 0.08 });
    if (portions !== 1) reasons.push({ kind: 'portions', text: `${String(portions).replace('.', ',')} porcji`, good: true });
    if (c.slots.includes(m.slot_id)) s += 1.5;
    if (c.flavor === cur.flavor) { s += 0.8; reasons.push({ kind: 'flavor', text: c.flavor === 'słodki' ? 'też na słodko' : 'też wytrawnie', good: true }); }
    const sharedDish = c.tags.dish_type.filter((t: string) => cur.tags.dish_type.includes(t) && !GENERIC_DISH.includes(t));
    if (sharedDish.length) { s += 0.5; reasons.push({ kind: 'dish', text: `też ${sharedDish[0].replace(/-/g, ' ')}`, good: true }); }
    const overlap = candIng.filter((i) => i.recipe_id === c.id && planProducts.has(i.product_id));
    const uniq = [...new Set(overlap.map((o) => o.name))];
    if (uniq.length) { s += Math.min(2, uniq.length * 0.4); reasons.push({ kind: 'shopping', text: uniq.length === 1 ? `${uniq[0]} już na liście` : `${uniq.length} ${plural(uniq.length, 'składnik', 'składniki', 'składników')} już na liście`, good: true }); }
    const newItems = new Set(candIng.filter((i) => i.recipe_id === c.id).map((i) => i.product_id)).size - uniq.length;
    if (usedInPlan.has(c.id)) { s -= 1.2; reasons.push({ kind: 'repeat', text: 'już jest w tym tygodniu', good: false }); }
    if (c.tags.features.includes('bez-gotowania')) reasons.push({ kind: 'feature', text: 'bez gotowania', good: true });
    if (c.is_favorite) { s += 0.7; reasons.push({ kind: 'fav', text: 'ulubione', good: true }); }
    return { ...c, portions, kcal_total: kcal, score: Math.round(s * 100) / 100, new_items: newItems, reasons };
  }).sort((a, b) => b.score - a.score);

  return { current: { ...cur, portions: m.portions, kcal_total: Math.round(targetKcal), slot: m.slot_id }, items: scored.slice(0, q.limit ?? 30) };
}
