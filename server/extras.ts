// Posiłki spoza planu i wyrównywanie reszty dnia
import { all, get, run, tx } from './store.ts';
import { HttpError } from './http.ts';
import { round } from './text.ts';

export type ExtraInput = {
  date: string; slot?: string | null; name: string; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number;
  source?: 'manual' | 'ai_text' | 'ai_photo' | 'barcode'; note?: string | null; replaces_meal_id?: number | null; rebalance?: boolean;
};

export const extrasFor = (date: string) =>
  all(`SELECT id, date, slot_id AS slot, name, kcal, protein_g, carbs_g, fat_g, source, note, replaced_meal_id FROM extra_meals WHERE date = ? ORDER BY id`, date);

/** Zmniejsza (albo lekko zwiększa) porcje posiłków, które jeszcze przed Tobą, żeby dzień zmieścił się w celu. */
export function rebalanceDay(date: string) {
  const day = get(`SELECT d.id, p.target_kcal FROM plan_days d JOIN plans p ON p.id = d.plan_id
                   WHERE p.type = 'user' AND d.date = ? ORDER BY p.created_at DESC LIMIT 1`, date);
  if (!day) return [];
  const meals = all(`SELECT m.id, m.portions, m.status, m.slot_id, r.kcal, r.name FROM plan_meals m JOIN recipes r ON r.id = m.recipe_id
                     WHERE m.plan_day_id = ?`, day.id);
  const eaten = meals.filter((m) => m.status === 'eaten').reduce((a, m) => a + m.kcal * m.portions, 0);
  const extra = extrasFor(date).reduce((a, e) => a + e.kcal, 0);
  const left = meals.filter((m) => m.status === 'planned');
  const planned = left.reduce((a, m) => a + m.kcal * m.portions, 0);
  if (!left.length || planned <= 0) return [];
  const budget = Math.max(0, day.target_kcal - eaten - extra);
  const factor = Math.min(1.25, Math.max(0.5, budget / planned));
  if (Math.abs(factor - 1) < 0.05) return [];
  const changes = [];
  for (const m of left) {
    const portions = Math.min(2, Math.max(0.25, Math.round(m.portions * factor * 10) / 10));
    if (portions === m.portions) continue;
    run('UPDATE plan_meals SET portions = ? WHERE id = ?', portions, m.id);
    changes.push({ meal_id: m.id, slot: m.slot_id, name: m.name, from: m.portions, to: portions });
  }
  return changes;
}

export function addExtra(input: ExtraInput) {
  if (!input.name?.trim()) throw new HttpError(400, 'Napisz, co to było');
  const kcal = Number(input.kcal);
  if (!(kcal >= 0 && kcal < 5000)) throw new HttpError(400, 'Podaj kalorie');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) throw new HttpError(400, 'Nieprawidłowa data');
  return tx(() => {
    if (input.replaces_meal_id) {
      const m = get(`SELECT m.id FROM plan_meals m JOIN plan_days d ON d.id = m.plan_day_id WHERE m.id = ? AND d.date = ?`, input.replaces_meal_id, input.date);
      if (!m) throw new HttpError(400, 'Ten posiłek nie jest z tego dnia');
      run(`UPDATE plan_meals SET status = 'skipped' WHERE id = ?`, input.replaces_meal_id);
    }
    const id = run(`INSERT INTO extra_meals (date, slot_id, name, kcal, protein_g, carbs_g, fat_g, source, note, replaced_meal_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`,
      input.date, input.slot ?? null, input.name.trim(), Math.round(kcal), round(Number(input.protein_g) || 0), round(Number(input.carbs_g) || 0),
      round(Number(input.fat_g) || 0), input.source ?? 'manual', input.note ?? null, input.replaces_meal_id ?? null).lastInsertRowid;
    const adjustments = input.rebalance === false ? [] : rebalanceDay(input.date);
    return { id, adjustments };
  });
}

export function deleteExtra(id: number) {
  const e = get('SELECT date, replaced_meal_id FROM extra_meals WHERE id = ?', id);
  if (!e) throw new HttpError(404, 'Nie ma takiego wpisu');
  tx(() => {
    if (e.replaced_meal_id) run(`UPDATE plan_meals SET status = 'planned' WHERE id = ? AND status = 'skipped'`, e.replaced_meal_id);
    run('DELETE FROM extra_meals WHERE id = ?', id);
  });
  return { date: e.date };
}
