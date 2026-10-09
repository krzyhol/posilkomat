// Dziennik wagi: trend (wygładzanie wykładnicze), tempo zmian i korekta celu kalorii
import { all, run } from './store.ts';
import { HttpError } from './http.ts';
import { getProfile } from './catalog.ts';
import { round, todayIso } from './text.ts';

const KCAL_PER_KG = 7700;
const day = (iso: string) => Date.parse(iso + 'T12:00:00Z') / 86400000;

export function weightLog() {
  const rows = all<{ date: string; weight_kg: number; waist_cm: number | null; note: string | null }>(
    'SELECT date, weight_kg, waist_cm, note FROM weight_log ORDER BY date');
  // trend: średnia wykładnicza (α = 0,1 na dzień) – odporna na wahania wody i różne odstępy między pomiarami
  let trend: number | null = null, prev: string | null = null;
  const entries = rows.map((r) => {
    if (trend === null) trend = r.weight_kg;
    else {
      const a = 1 - Math.pow(0.9, Math.max(1, day(r.date) - day(prev!)));
      trend = trend + a * (r.weight_kg - trend);
    }
    prev = r.date;
    return { ...r, trend: round(trend, 2) };
  });
  return { entries, stats: stats(entries) };
}

function stats(entries: { date: string; weight_kg: number; trend: number }[]) {
  const profile = getProfile();
  const goal = profile.goal_weight_kg ?? null;
  const last = entries[entries.length - 1];
  if (!last) return { trend: null, rate_kg_week: null, goal_kg: goal, suggestion: null, weeks_to_goal: null, days_of_data: 0 };
  // tempo: regresja liniowa pomiarów z ostatnich 21 dni (trend wykładniczy się opóźnia, więc nie z niego)
  const recent = entries.filter((e) => day(last.date) - day(e.date) <= 21);
  const span = recent.length ? day(last.date) - day(recent[0].date) : 0;
  let rate: number | null = null;
  if (recent.length >= 4 && span >= 10) {
    const xs = recent.map((e) => day(e.date)), ys = recent.map((e) => e.weight_kg);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    rate = round(slope * 7, 2);
  }
  // cel tempa: z ustawień albo domyślnie −0,5 kg/tydz. przy redukcji, +0,25 przy budowaniu, 0 przy utrzymaniu
  const goalRate = profile.goal_rate_kg_week ?? (goal === null ? 0 : goal < last.trend - 0.5 ? -0.5 : goal > last.trend + 0.5 ? 0.25 : 0);
  let suggestion = null;
  if (rate !== null) {
    const diff = rate - goalRate; // kg/tydz. za szybko (+) albo za wolno (−) względem celu
    let adjust = -Math.round(((diff * KCAL_PER_KG) / 7) / 50) * 50;
    adjust = Math.max(-300, Math.min(300, adjust));
    const target = profile.target_kcal + adjust;
    const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toString().replace('.', ',')} kg/tydz.`;
    suggestion = Math.abs(adjust) < 50
      ? { adjust: 0, target_kcal: profile.target_kcal, text: `Tempo ${fmt(rate)} zgadza się z celem (${fmt(goalRate)}) – trzymaj kurs.` }
      : { adjust, target_kcal: Math.max(1200, target),
          text: `Tempo ${fmt(rate)}, a cel to ${fmt(goalRate)} – ${adjust < 0 ? 'zmniejsz' : 'zwiększ'} cel o ${Math.abs(adjust)} kcal dziennie.` };
  }
  const weeks = goal !== null && rate && Math.sign(goal - last.trend) === Math.sign(rate) ? Math.round(Math.abs((goal - last.trend) / rate)) : null;
  return { trend: last.trend, rate_kg_week: rate, goal_kg: goal, goal_rate_kg_week: goalRate, suggestion, weeks_to_goal: weeks, days_of_data: Math.round(span) };
}

export function saveWeight(input: { date?: string; weight_kg: number; waist_cm?: number | null; note?: string | null }) {
  const w = Number(input.weight_kg);
  if (!(w > 20 && w < 400)) throw new HttpError(400, 'Podaj wagę w kg, np. 72,4');
  const date = input.date ?? todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Nieprawidłowa data');
  run(`INSERT INTO weight_log (date, weight_kg, waist_cm, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg, waist_cm = excluded.waist_cm, note = excluded.note`,
    date, round(w, 2), input.waist_cm ? Number(input.waist_cm) : null, input.note ?? null);
  return weightLog();
}

export function deleteWeight(date: string) {
  run('DELETE FROM weight_log WHERE date = ?', date);
  return weightLog();
}
