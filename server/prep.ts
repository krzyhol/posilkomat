// Dzień gotowania (meal prep): co ugotować z wyprzedzeniem, w jakiej kolejności i co do pudełek
import { all } from './store.ts';
import { HttpError } from './http.ts';
import { todayIso } from './text.ts';
import { getPlan } from './planner.ts';
import { portionMultiplier } from './household.ts';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

// typowe czasy gotowania baz (suchy produkt → ugotowany), minuty
const BASE_MINUTES: [RegExp, number, string][] = [
  [/^ryz/, 15, 'ryż'], [/^kasza-jeczmienna-peczak/, 35, 'pęczak'], [/^kasza-jeczmienna/, 25, 'kaszę'], [/^kasza-gryczana/, 15, 'kaszę'],
  [/^kasza-jaglana/, 15, 'kaszę'], [/^kasza-bulgur/, 12, 'bulgur'], [/^kasza-kuskus/, 5, 'kuskus'], [/^komosa/, 15, 'komosę'],
  [/^makaron/, 10, 'makaron'], [/^soczewica-(czerwona)$/, 15, 'soczewicę'], [/^soczewica-(zielona|czarna)$/, 25, 'soczewicę'],
  [/^ziemniaki/, 20, 'ziemniaki'], [/^batat/, 25, 'bataty'], [/^gnocchi|^kopytka/, 5, 'kluski'],
];
const PROTEIN = /^(mieso|udo-kurczaka|skrzydelka|schab|poledwica|wolowina|wieprzowina|losos-swiezy|dorsz|mintaj|pstrag-strumieniowy|tilapia|tofu-naturalne|tofu-wedzone|tempeh|seitan|granulat-sojowy)/;
const FISH = /^(losos|dorsz|mintaj|pstrag|tilapia|makrela|tunczyk|anchois)/;
const MEAT = /^(mieso|udo-kurczaka|skrzydelka|schab|poledwica|wolowina|wieprzowina|filet|szynka|boczek|parowki|frankfurterki|salami|wedlina)/;
const CHOP = /^(marchew|papryka-(czerwona|zolta)|cebula|seler|kalafior|brokul|cukinia|kapusta|por$|burak$|dynia|baklazan|pietruszka-korzen|rzodkiewka|fasola-szparagowa)/;
const SAUCE_GROUP = /sos|dip|dressing|hummus|pasta|guacamole|marynata|salsa|pesto/i;
// dania, które lepiej robić na świeżo, nawet jeśli wymagają gotowania
const FRESH_DISH = ['jajka', 'koktajl', 'placki', 'kanapki'];

type MealRow = { id: number; date: string; day_number: number; slot: string; recipe_id: string; portions: number; leftover_of_meal_id: number | null };

function stepMinutes(texts: string[]) {
  let total = 0;
  for (const t of texts) {
    let max = 0;
    for (const m of t.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?\s*min/g)) max = Math.max(max, Number(m[2] ?? m[1]));
    for (const m of t.matchAll(/(\d+(?:,\d+)?)\s*godz/g)) max = Math.max(max, Number(m[1].replace(',', '.')) * 60);
    total += max;
  }
  return Math.min(120, Math.max(10, total));
}

export function prepPlan(planId: string, q: { day_from?: number; day_to?: number; prep_date?: string }) {
  const plan = getPlan(planId);
  if (plan.type !== 'user') throw new HttpError(400, 'Dzień gotowania liczymy dla Twojego jadłospisu z datami');
  const first = plan.days[0], last = plan.days[plan.days.length - 1];
  const from = Math.max(first.day_number, q.day_from ?? first.day_number);
  const to = Math.min(last.day_number, q.day_to ?? Math.min(last.day_number, from + 4));
  const startDate = plan.days.find((d: any) => d.day_number === from)!.date as string;
  let prepDate = q.prep_date ?? addDays(startDate, -1);
  if (!q.prep_date && prepDate < todayIso()) prepDate = todayIso();
  const people = portionMultiplier(planId);

  const meals = all<MealRow>(`SELECT m.id, d.date, d.day_number, m.slot_id AS slot, m.recipe_id, m.portions, m.leftover_of_meal_id
      FROM plan_meals m JOIN plan_days d ON d.id = m.plan_day_id
      WHERE d.plan_id = ? AND d.day_number BETWEEN ? AND ? AND m.status = 'planned' ORDER BY d.day_number`, planId, from, to);
  if (!meals.length) return { prep_date: prepDate, day_from: from, day_to: to, total_minutes: 0, steps: [], boxes: [], evening: [], fresh: [] };

  const ids = [...new Set(meals.map((m) => m.recipe_id))];
  const ph = ids.map(() => '?').join(',');
  const recipes = new Map(all(`SELECT id, name, servings FROM recipes WHERE id IN (${ph})`, ...ids).map((r) => [r.id, r]));
  const tags = all(`SELECT recipe_id, tag_type, tag FROM recipe_tags WHERE recipe_id IN (${ph})`, ...ids);
  const has = (id: string, type: string, tag: string) => tags.some((t) => t.recipe_id === id && t.tag_type === type && t.tag === tag);
  const ings = all(`SELECT ri.recipe_id, ri.product_id, ri.name, ri.amount_g, ri.group_name, p.category_id
      FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id IN (${ph}) AND ri.amount_g IS NOT NULL`, ...ids);
  const steps = all(`SELECT recipe_id, text FROM recipe_steps WHERE recipe_id IN (${ph}) ORDER BY position`, ...ids);

  const kind = (id: string) => {
    if (has(id, 'features', 'na-noc')) return 'evening';
    if (has(id, 'features', 'bez-gotowania')) return 'fresh';
    if (FRESH_DISH.some((d) => has(id, 'dish_type', d))) return 'fresh-cooked';
    return 'cook';
  };

  // porcje do ugotowania: posiłek + jego resztki (w zakresie dni)
  const cookGroups = new Map<string, { recipe_id: string; portions: number; dates: string[] }>();
  const evening: { date: string; slot: string; name: string; recipe_id: string }[] = [];
  const fresh: { date: string; slot: string; name: string; recipe_id: string; cooked: boolean }[] = [];
  for (const m of meals) {
    const k = kind(m.recipe_id);
    const name = recipes.get(m.recipe_id)!.name;
    if (k === 'evening') evening.push({ date: addDays(m.date, -1), slot: m.slot, name, recipe_id: m.recipe_id });
    else if (k !== 'cook') fresh.push({ date: m.date, slot: m.slot, name, recipe_id: m.recipe_id, cooked: k === 'fresh-cooked' });
    else {
      const g = cookGroups.get(m.recipe_id) ?? { recipe_id: m.recipe_id, portions: 0, dates: [] };
      g.portions += m.portions * people;
      g.dates.push(m.date);
      cookGroups.set(m.recipe_id, g);
    }
  }

  const factor = (rid: string) => (cookGroups.get(rid)!.portions) / recipes.get(rid)!.servings;
  const cooked = [...cookGroups.keys()];
  const sum = (filter: (i: any) => boolean, rids: string[], f = factor) => {
    const out = new Map<string, { name: string; grams: number; for: Set<string> }>();
    for (const i of ings) {
      if (!rids.includes(i.recipe_id) || !filter(i)) continue;
      const o = out.get(i.product_id) ?? { name: i.name, grams: 0, for: new Set<string>() };
      o.grams += i.amount_g * f(i.recipe_id);
      o.for.add(recipes.get(i.recipe_id)!.name);
      out.set(i.product_id, o);
    }
    return [...out.entries()].map(([id, o]) => ({ product_id: id, name: o.name, grams: Math.round(o.grams / 5) * 5 || Math.round(o.grams), for: [...o.for] }));
  };
  const minutesOf = (rid: string) => stepMinutes(steps.filter((s) => s.recipe_id === rid).map((s) => s.text));
  const forLabel = (names: string[]) => (names.length === 1 ? `do: ${names[0]}` : `do ${names.length} dań: ${names.join(', ')}`);

  type Step = { kind: string; title: string; minutes: number; parallel?: boolean; items: { text: string; sub?: string }[] };
  const out: Step[] = [];
  const oven = cooked.filter((rid) => has(rid, 'features', 'piekarnik'));
  if (oven.length) out.push({
    kind: 'oven', title: 'Piekarnik', parallel: true, minutes: Math.max(...oven.map(minutesOf)),
    items: [{ text: 'Rozgrzej piekarnik (180–220°C, zgodnie z przepisami) – wszystko, co się piecze, wkładasz razem na dwóch poziomach' },
      ...oven.map((rid) => ({ text: recipes.get(rid)!.name, sub: `${fmtPortions(cookGroups.get(rid)!.portions)} · ok. ${minutesOf(rid)} min` }))],
  });
  const bases = sum((i) => BASE_MINUTES.some(([rx]) => rx.test(i.product_id)), cooked);
  if (bases.length) out.push({
    kind: 'pots', title: 'Garnki: kasze, ryż, makaron', parallel: true,
    minutes: Math.max(...bases.map((b) => BASE_MINUTES.find(([rx]) => rx.test(b.product_id))![1])),
    items: bases.map((b) => {
      const [, min, what] = BASE_MINUTES.find(([rx]) => rx.test(b.product_id))!;
      return { text: `Ugotuj ${b.grams} g: ${b.name.toLowerCase()}`, sub: `${what} · ok. ${min} min · ${forLabel(b.for)}` };
    }),
  });
  const proteins = sum((i) => PROTEIN.test(i.product_id), cooked.filter((r) => !oven.includes(r)));
  if (proteins.length) out.push({
    kind: 'protein', title: 'Mięso, ryby, tofu', minutes: 20,
    items: proteins.map((p) => ({ text: `${p.name}: ${p.grams} g`, sub: `przypraw i usmaż / podsmaż według przepisu · ${forLabel(p.for)}` })),
  });
  const stove = cooked.filter((rid) => !oven.includes(rid));
  if (stove.length) out.push({
    kind: 'stove', title: 'Dania na płycie', minutes: Math.round(stove.reduce((a, r) => a + minutesOf(r), 0) * 0.6),
    items: stove.map((rid) => ({ text: recipes.get(rid)!.name, sub: `${fmtPortions(cookGroups.get(rid)!.portions)} · ok. ${minutesOf(rid)} min · bazy i białko masz już gotowe` })),
  });
  // sosy i dipy: z dań gotowanych i świeżych w pierwszych 4 dniach (świeże sosy trzymają się krócej)
  const soon = [...new Set([...cooked, ...fresh.filter((f) => diffDays(prepDate, f.date) <= 3).map((f) => f.recipe_id)])];
  const sauces = new Map<string, Set<string>>();
  for (const i of ings) if (soon.includes(i.recipe_id) && i.group_name && SAUCE_GROUP.test(i.group_name))
    sauces.set(`${i.group_name}|${i.recipe_id}`, (sauces.get(`${i.group_name}|${i.recipe_id}`) ?? new Set()).add(i.name));
  if (sauces.size) out.push({
    kind: 'sauce', title: 'Sosy, dipy i pasty', minutes: 5 * sauces.size,
    items: [...sauces].map(([key, names]) => {
      const [group, rid] = key.split('|');
      return { text: `${group} do: ${recipes.get(rid)!.name}`, sub: [...names].join(', ') + ' · w słoiczku, osobno od dania' };
    }),
  });
  const freshSoon = [...new Set(fresh.filter((f) => !f.cooked && diffDays(prepDate, f.date) <= 3).map((f) => f.recipe_id))];
  const chop = sum((i) => CHOP.test(i.product_id), [...new Set([...stove, ...freshSoon])], (rid) =>
    cookGroups.has(rid) ? factor(rid) : (fresh.filter((f) => f.recipe_id === rid && diffDays(prepDate, f.date) <= 3).length * people) / recipes.get(rid)!.servings);
  if (chop.length) out.push({
    kind: 'chop', title: 'Krojenie warzyw', minutes: Math.min(40, 4 * chop.length),
    items: chop.map((c) => ({ text: `${c.name}: ${c.grams} g`, sub: forLabel(c.for) })),
  });
  if (cooked.length) out.push({
    kind: 'pack', title: 'Studzenie i pakowanie', minutes: 15,
    items: [{ text: 'Studź dania maks. 2 godziny w temperaturze pokojowej, potem do lodówki' },
      { text: 'Pudełka opisz datą – etykiety masz niżej', sub: 'sałatki i sosy pakuj osobno, żeby nie rozmiękły' }],
  });

  // pudełka: każdy posiłek z ugotowanego dania; trwałość liczona od dnia gotowania
  const boxes = meals.filter((m) => cookGroups.has(m.recipe_id)).map((m) => {
    const rIngs = ings.filter((i) => i.recipe_id === m.recipe_id);
    const shelf = rIngs.some((i) => FISH.test(i.product_id)) ? 2 : rIngs.some((i) => MEAT.test(i.product_id)) ? 3 : 4;
    const age = diffDays(prepDate, m.date);
    const freezer = age > shelf;
    return {
      date: m.date, slot: m.slot, recipe_id: m.recipe_id, name: recipes.get(m.recipe_id)!.name, portions: m.portions * people,
      storage: freezer ? 'freezer' : 'fridge', shelf_days: shelf,
      eat_by: freezer ? null : addDays(prepDate, shelf), thaw_evening: freezer ? addDays(m.date, -1) : null,
    };
  });
  const total = out.reduce((a, s) => a + s.minutes, 0);
  return {
    prep_date: prepDate, day_from: from, day_to: to, people,
    total_minutes: Math.round(oven.length ? Math.max(total - out.find((s) => s.kind === 'oven')!.minutes * 0.7, total * 0.6) : total),
    steps: out, boxes, evening, fresh: fresh.map(({ date, slot, name, recipe_id, cooked: c }) => ({ date, slot, name, recipe_id, cooked: c })),
  };
}

const fmtPortions = (p: number) => {
  const r = Math.round(p * 10) / 10;
  const s = String(r).replace('.', ',');
  return `${s} ${r === 1 ? 'porcja' : Number.isInteger(r) && r % 10 >= 2 && r % 10 <= 4 && !(r % 100 >= 12 && r % 100 <= 14) ? 'porcje' : 'porcji'}`;
};

