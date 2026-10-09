import type { Slot } from './api.ts';

export const SLOT_NAME: Record<Slot, string> = {
  breakfast: 'Śniadanie', second_breakfast: 'II śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąska',
};
export const SLOT_ORDER: Slot[] = ['breakfast', 'second_breakfast', 'lunch', 'dinner', 'snack'];

const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

const d = (iso: string) => new Date(iso + 'T12:00:00');
export const weekday = (iso: string) => DAYS[d(iso).getDay()];
export const weekdayShort = (iso: string) => DAYS_SHORT[d(iso).getDay()];
export const dayMonth = (iso: string) => `${d(iso).getDate()} ${MONTHS_GEN[d(iso).getMonth()]}`;
export const dayNum = (iso: string) => d(iso).getDate();
export const todayIso = () => {
  const n = new Date();
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const addDays = (iso: string, k: number) => {
  const x = d(iso);
  x.setDate(x.getDate() + k);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** liczba po polsku: przecinek dziesiętny, bez zbędnych zer */
export const n = (v: number | null | undefined, digits = 1) =>
  v == null ? '–' : Number(v.toFixed(digits)).toLocaleString('pl-PL', { maximumFractionDigits: digits });

export const plural = (k: number, one: string, few: string, many: string) => {
  if (k === 1) return one;
  const l = k % 10, l2 = k % 100;
  return Number.isInteger(k) && l >= 2 && l <= 4 && !(l2 >= 12 && l2 <= 14) ? few : many;
};

export const SOURCE_LABEL: Record<string, string> = {
  pdf_import: 'z jadłospisu PDF', user: 'twój przepis', ai_generated: 'wymyślone z AI', ai_modified: 'przerobione z AI',
};

export const DIETS = ['wegetariańska', 'wegańska', 'pescowegetariańska', 'bez-glutenu', 'bez-laktozy'] as const;

export const unitLabel = (unit: string, qty: number, units: { id: string; form_one: string; form_few: string; form_many: string; form_fraction: string }[]) => {
  const u = units.find((x) => x.id === unit);
  if (!u) return unit;
  if (!Number.isInteger(qty)) return u.form_fraction;
  return plural(qty, u.form_one, u.form_few, u.form_many);
};

/** ilość domowa z ułamkami jak w kuchni: 0,5 → ½ */
export const qtyLabel = (q: number) => {
  const whole = Math.floor(q), frac = Math.round((q - whole) * 100) / 100;
  const F: Record<number, string> = { 0.25: '¼', 0.33: '⅓', 0.5: '½', 0.67: '⅔', 0.75: '¾' };
  if (frac && F[frac]) return `${whole || ''}${F[frac]}`;
  return n(q, 2);
};
