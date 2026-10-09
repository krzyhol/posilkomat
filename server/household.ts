// Tryb rodzinny: wspólne menu, porcje skalowane do celu kalorii każdego domownika
import { all, get, run, tx } from './store.ts';
import { HttpError } from './http.ts';
import { getProfile } from './catalog.ts';

export const listHousehold = () => all('SELECT id, name, target_kcal, position FROM household_members ORDER BY position, id');

export function addMember(input: { name: string; target_kcal: number }) {
  if (!input.name?.trim()) throw new HttpError(400, 'Podaj imię');
  const kcal = Math.round(Number(input.target_kcal));
  if (!(kcal >= 600 && kcal <= 5000)) throw new HttpError(400, 'Cel kalorii: 600–5000 kcal');
  const pos = (get('SELECT MAX(position) AS p FROM household_members')?.p ?? 0) + 1;
  run('INSERT INTO household_members (name, target_kcal, position) VALUES (?, ?, ?)', input.name.trim(), kcal, pos);
  return listHousehold();
}

export function updateMember(id: number, input: { name?: string; target_kcal?: number }) {
  if (!get('SELECT 1 FROM household_members WHERE id = ?', id)) throw new HttpError(404, 'Nie ma takiego domownika');
  if (input.name !== undefined) run('UPDATE household_members SET name = ? WHERE id = ?', input.name.trim(), id);
  if (input.target_kcal !== undefined) run('UPDATE household_members SET target_kcal = ? WHERE id = ?', Math.round(input.target_kcal), id);
  return listHousehold();
}

export function deleteMember(id: number) {
  run('DELETE FROM household_members WHERE id = ?', id);
  return listHousehold();
}

const shareOf = (kcal: number, planKcal: number) => Math.max(0.25, Math.round((kcal / planKcal) * 20) / 20);

/** Zapisuje w jadłospisie, kto je (Ty + wybrani domownicy) i z jakim przelicznikiem porcji. */
export function snapshotMembers(planId: string, planKcal: number, memberIds?: number[] | null) {
  const profile = getProfile();
  const members = listHousehold().filter((m) => !memberIds || memberIds.includes(m.id));
  run('DELETE FROM plan_members WHERE plan_id = ?', planId);
  if (!members.length) return;
  const rows = [{ member_id: null, name: profile.name?.trim() || 'Ty', target_kcal: planKcal }, ...members.map((m) => ({ member_id: m.id, name: m.name, target_kcal: m.target_kcal }))];
  rows.forEach((r, i) => run('INSERT INTO plan_members (plan_id, position, member_id, name, target_kcal, share) VALUES (?,?,?,?,?,?)',
    planId, i, r.member_id, r.name, r.target_kcal, i === 0 ? 1 : shareOf(r.target_kcal, planKcal)));
  run('UPDATE plans SET people = ? WHERE id = ?', rows.length, planId);
}

export const planMembers = (planId: string) =>
  all('SELECT position, member_id, name, target_kcal, share FROM plan_members WHERE plan_id = ? ORDER BY position', planId);

/** Mnożnik porcji do zakupów i gotowania: suma przeliczników domowników, a bez nich – liczba osób. */
export function portionMultiplier(planId: string) {
  const m = planMembers(planId);
  if (m.length) return m.reduce((a, x) => a + x.share, 0);
  return get('SELECT people FROM plans WHERE id = ?', planId)?.people ?? 1;
}

export function syncPlanMembers(planId: string) {
  const plan = get('SELECT target_kcal FROM plans WHERE id = ?', planId);
  if (!plan) throw new HttpError(404, 'Nie ma takiego jadłospisu');
  tx(() => snapshotMembers(planId, plan.target_kcal));
  return planMembers(planId);
}
