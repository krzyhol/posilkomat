// Lista zakupów z jadłospisu: sumowanie po produktach, rozwijanie półproduktów, miary domowe, alejki sklepu
import { all, get, run, tx, qs } from './store.ts';
import { HttpError } from './http.ts';
import { getProfile } from './catalog.ts';
import { pantryCoverage } from './pantry.ts';

const COUNTABLE = ['sztuka', 'opakowanie', 'kromka', 'ząbek', 'plaster', 'kostka', 'łodyga', 'listek', 'szklanka'];

function unitForm(unit: string, qty: number) {
  const u = get('SELECT * FROM units WHERE id = ?', unit);
  if (!u) return unit;
  if (!Number.isInteger(qty)) return u.form_fraction;
  if (qty === 1) return u.form_one;
  const last = qty % 10, last2 = qty % 100;
  return last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14) ? u.form_few : u.form_many;
}

/** „≈ 3 sztuki”, „2 opakowania” – na podstawie wag miar produktu */
export function householdHint(productId: string, grams: number): string | null {
  const ms = all('SELECT unit_id, grams FROM product_measures WHERE product_id = ? ORDER BY position', productId)
    .filter((m) => COUNTABLE.includes(m.unit_id));
  if (!ms.length) return null;
  const pack = ms.find((m) => m.unit_id === 'opakowanie');
  const m = pack && grams >= pack.grams * 0.6 ? pack : ms[0];
  let q = grams / m.grams;
  q = m.unit_id === 'opakowanie' ? Math.ceil(q - 0.05) : q < 1 ? Math.ceil(q * 2) / 2 : Math.round(q * 2) / 2;
  if (q <= 0) return null;
  const qty = Number.isInteger(q) ? q : q;
  const shown = String(qty).replace('.', ',');
  return `${m.unit_id === 'opakowanie' ? '' : '≈ '}${shown} ${unitForm(m.unit_id, qty)}`;
}

type Need = { product_id: string; amount_g: number; from: Set<string> };

/** Rozwija półprodukty (ciasto naleśnikowe, focaccia) na składniki przepisu bazowego. */
function expand(needs: Map<string, Need>) {
  for (let pass = 0; pass < 3; pass++) {
    const bases = all(`SELECT p.id, p.base_recipe_id, r.yield_amount_g FROM products p JOIN recipes r ON r.id = p.base_recipe_id
                       WHERE p.id IN (${qs(needs.size || 1)})`, ...(needs.size ? [...needs.keys()] : ['']));
    if (!bases.length) return;
    for (const b of bases) {
      const n = needs.get(b.id)!;
      needs.delete(b.id);
      const factor = n.amount_g / b.yield_amount_g;
      for (const i of all('SELECT product_id, amount_g FROM recipe_ingredients WHERE recipe_id = ? AND amount_g IS NOT NULL', b.base_recipe_id)) {
        const cur = needs.get(i.product_id) ?? { product_id: i.product_id, amount_g: 0, from: new Set<string>() };
        cur.amount_g += i.amount_g * factor;
        n.from.forEach((f) => cur.from.add(f));
        needs.set(i.product_id, cur);
      }
    }
  }
}

export function createShoppingList(planId: string, input: { day_from?: number; day_to?: number; expand_base?: boolean; people?: number; use_pantry?: boolean }) {
  const plan = get('SELECT * FROM plans WHERE id = ?', planId);
  if (!plan) throw new HttpError(404, 'Nie ma takiego jadłospisu');
  const range = get('SELECT MIN(day_number) AS a, MAX(day_number) AS b FROM plan_days WHERE plan_id = ?', planId)!;
  const from = Math.max(range.a, input.day_from ?? range.a), to = Math.min(range.b, input.day_to ?? range.b);
  const people = input.people ?? plan.people ?? 1;

  const rows = all(`SELECT n.product_id, n.amount_g, r.name AS recipe
      FROM v_plan_product_needs n JOIN plan_meals m ON m.id = n.plan_meal_id JOIN recipes r ON r.id = m.recipe_id
      WHERE n.plan_id = ? AND n.day_number BETWEEN ? AND ?`, planId, from, to);
  const needs = new Map<string, Need>();
  for (const r of rows) {
    const n = needs.get(r.product_id) ?? { product_id: r.product_id, amount_g: 0, from: new Set<string>() };
    n.amount_g += r.amount_g * people;
    n.from.add(r.recipe);
    needs.set(r.product_id, n);
  }
  if (input.expand_base !== false) expand(needs);

  const prods = new Map(all(`SELECT id, name, category_id, shoppable FROM products WHERE id IN (${qs(needs.size || 1)})`,
    ...(needs.size ? [...needs.keys()] : [''])).map((p) => [p.id, p]));
  const dates = all('SELECT day_number, date FROM plan_days WHERE plan_id = ? AND day_number IN (?, ?)', planId, from, to);
  const pantry = input.use_pantry === false ? new Map<string, number | null>() : pantryCoverage();
  const id = `lista-${planId}-${Date.now().toString(36)}`;
  const r5 = (g: number) => (g < 10 ? Math.round(g * 2) / 2 : Math.round(g / 5) * 5);
  tx(() => {
    run(`INSERT INTO shopping_lists (id, plan_id, name, date_from, date_to) VALUES (?,?,?,?,?)`, id, planId,
      `${plan.name} · dni ${from}–${to}`, dates.find((d) => d.day_number === from)?.date ?? null, dates.find((d) => d.day_number === to)?.date ?? null);
    for (const n of needs.values()) {
      const p = prods.get(n.product_id);
      if (!p || !p.shoppable || n.amount_g < 0.5) continue;
      // spiżarnia pokrywa część (albo całość – pozycja „mam”, bez ilości)
      const stock = pantry.has(n.product_id) ? pantry.get(n.product_id) : undefined;
      const covered = stock === undefined ? 0 : stock === null ? n.amount_g : Math.min(stock, n.amount_g);
      const left = Math.max(0, n.amount_g - covered);
      run(`INSERT INTO shopping_items (list_id, product_id, amount_g, household_hint, category_id, need_g, pantry_g) VALUES (?,?,?,?,?,?,?)`,
        id, n.product_id, left < 0.5 ? 0 : r5(left), left < 0.5 ? null : householdHint(n.product_id, left), p.category_id,
        r5(n.amount_g), covered ? r5(covered) : null);
    }
  });
  return getShoppingList(id);
}

export function getShoppingList(id: string) {
  const list = get('SELECT * FROM shopping_lists WHERE id = ?', id);
  if (!list) throw new HttpError(404, 'Nie ma takiej listy');
  const profile = getProfile();
  const items = all(`SELECT i.*, COALESCE(p.name, i.custom_name) AS name, p.pantry_staple, c.name AS category_name, c.position AS category_position
      FROM shopping_items i LEFT JOIN products p ON p.id = i.product_id LEFT JOIN product_categories c ON c.id = i.category_id
      WHERE i.list_id = ? ORDER BY COALESCE(c.position, 99), name COLLATE NOCASE`, id)
    .map((i) => ({ ...i, checked: !!i.checked, manual: !!i.manual, pantry_staple: !!i.pantry_staple, stocked: !!i.stocked,
      in_pantry: !!i.pantry_g && !(i.amount_g > 0) }));
  const groups: { id: string; name: string; items: typeof items }[] = [];
  for (const it of items) {
    const key = it.in_pantry ? 'stock' : it.pantry_staple && profile.hide_pantry_staples ? 'pantry' : it.category_id ?? 'inne';
    let g = groups.find((x) => x.id === key);
    const name = key === 'stock' ? 'Masz w spiżarni' : key === 'pantry' ? 'Pewnie masz w domu' : it.category_name ?? 'Dopisane';
    if (!g) groups.push((g = { id: key, name, items: [] }));
    g.items.push(it);
  }
  const tail = (id: string) => (id === 'stock' ? 1 : id === 'pantry' ? 2 : 0);
  groups.sort((a, b) => tail(a.id) - tail(b.id));
  const toBuy = items.filter((i) => !i.in_pantry);
  return { ...list, total: toBuy.length, checked: toBuy.filter((i) => i.checked).length,
    to_stock: items.filter((i) => i.checked && !i.stocked && i.product_id && i.amount_g > 0).length, groups };
}

export function listShoppingLists() {
  return all(`SELECT l.*, (SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id) AS total,
      (SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id AND i.checked = 1) AS checked
    FROM shopping_lists l ORDER BY l.created_at DESC LIMIT 30`);
}

export function patchItem(id: number, patch: { checked?: boolean }) {
  const it = get('SELECT list_id FROM shopping_items WHERE id = ?', id);
  if (!it) throw new HttpError(404, 'Nie ma takiej pozycji');
  if (patch.checked !== undefined) run('UPDATE shopping_items SET checked = ? WHERE id = ?', patch.checked ? 1 : 0, id);
  return { ok: true };
}

export function addItem(listId: string, input: { name: string; product_id?: string }) {
  if (!get('SELECT 1 FROM shopping_lists WHERE id = ?', listId)) throw new HttpError(404, 'Nie ma takiej listy');
  if (!input.name?.trim() && !input.product_id) throw new HttpError(400, 'Wpisz, co dopisać');
  const cat = input.product_id ? get('SELECT category_id FROM products WHERE id = ?', input.product_id)?.category_id : null;
  run(`INSERT INTO shopping_items (list_id, product_id, custom_name, category_id, manual) VALUES (?,?,?,?,1)`,
    listId, input.product_id ?? null, input.product_id ? null : input.name.trim(), cat ?? null);
  return getShoppingList(listId);
}

export function deleteItem(id: number) {
  const it = get('SELECT list_id FROM shopping_items WHERE id = ?', id);
  if (!it) throw new HttpError(404, 'Nie ma takiej pozycji');
  run('DELETE FROM shopping_items WHERE id = ?', id);
  return getShoppingList(it.list_id);
}

export function deleteList(id: string) {
  run('DELETE FROM shopping_lists WHERE id = ?', id);
}
