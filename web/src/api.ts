import { useCallback, useEffect, useRef, useState } from 'react';

export type Slot = 'breakfast' | 'second_breakfast' | 'lunch' | 'dinner' | 'snack';
export type Tags = { dish_type: string[]; protein: string[]; diet: string[]; features: string[]; custom: string[] };
export type RecipeSummary = {
  id: string; kind: 'meal' | 'base'; name: string; servings: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  flavor: 'słodki' | 'wytrawny' | null; prep_time_min: number | null; source_type: string; is_favorite: boolean; rating: number | null;
  slots: Slot[]; tags: Tags; allergens: string[]; ingredient_count: number;
};
export type Ingredient = {
  position: number; product_id: string; name: string; amount_g: number | null; household_qty: number | null; household_unit: string | null;
  group_name: string | null; note: string | null; product_name: string; category_id: string; base_recipe_id: string | null; pantry_staple: boolean;
};
export type Recipe = RecipeSummary & {
  description: string | null; notes: string | null;
  yield: { product_id: string; amount_g: number; pieces: number; piece_unit: string } | null;
  source: { type: string; files: string[]; model: string | null; prompt: string | null; based_on_recipe_id: string | null; nutrition_origin: string | null };
  ingredients: Ingredient[]; steps: { position: number; text: string; section: string | null }[];
  used_in: { id: string; name: string }[]; variants: { id: string; name: string }[];
  nutrition_check: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
};
export type PlanMeal = {
  id: number; slot: Slot; time_from: string | null; time_to: string | null; portions: number; status: 'planned' | 'eaten' | 'skipped';
  leftover_of_meal_id: number | null; leftover_from_day: number | null; leftovers: number; swapped_from_recipe_id: string | null;
  recipe: RecipeSummary;
};
export type PlanDay = {
  id: number; day_number: number; date: string | null;
  micros: { fiber_g: number; calcium_mg: number; magnesium_mg: number } | null;
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; eaten_kcal: number };
  meals: PlanMeal[];
};
export type Plan = {
  id: string; name: string; type: 'template' | 'user'; start_date: string | null; target_kcal: number; people: number;
  source_file: string | null; source_note: string | null; days: PlanDay[];
};
export type PlanListItem = Omit<Plan, 'days'> & { days: number; end_date: string | null };
export type Product = {
  id: string; name: string; category_id: string; kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number;
  measures: { unit: string; grams: number }[]; allergens: string[]; base_recipe_id: string | null; pantry_staple: boolean;
};
export type Meta = {
  slots: { id: Slot; name: string; position: number; time_from: string | null; time_to: string | null }[];
  slot_compat: Record<string, string[]>;
  categories: { id: string; name: string }[];
  units: { id: string; short: string; form_one: string; form_few: string; form_many: string; form_fraction: string }[];
  allergens: { id: string; name: string }[];
  dish_types: { tag: string; n: number }[];
  substitution_groups: { id: string; name: string; mode: string; note: string | null; items: { product_id: string; name: string; grams: number | null }[] }[];
};
export type Profile = {
  name: string | null; target_kcal: number; people: number; excluded_allergens: string[];
  diet: null | 'wegetariańska' | 'wegańska' | 'pescowegetariańska'; hide_pantry_staples: boolean;
  goal_weight_kg?: number | null; goal_rate_kg_week?: number | null;
  disliked_products?: string[]; disliked_recipes?: string[];
};
export type ShoppingItem = {
  id: number; product_id: string | null; name: string; amount_g: number | null; household_hint: string | null;
  category_id: string | null; checked: boolean; manual: boolean; pantry_staple: boolean;
  need_g: number | null; pantry_g: number | null; in_pantry: boolean; stocked: boolean;
};
export type PantryItem = {
  product_id: string; name: string; amount_g: number | null; expires_on: string | null; expires_in_days: number | null;
  category_id: string; category_name: string;
};
export type PantrySuggestion = { recipe: RecipeSummary; have: string[]; missing: string[]; expiring: string[] };
export type ShoppingList = {
  id: string; plan_id: string | null; name: string; date_from: string | null; date_to: string | null; created_at: string;
  total: number; checked: number; to_stock: number; groups: { id: string; name: string; items: ShoppingItem[] }[];
};
export type SwapResult = {
  current: RecipeSummary & { portions: number; kcal_total: number; slot: Slot };
  items: (RecipeSummary & { portions: number; kcal_total: number; score: number; new_items: number; reasons: { kind: string; text: string; good: boolean }[] })[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Wersja na GitHub Pages: bez serwera, baza w przeglądarce, bez Kuchni AI. */
export const STATIC = import.meta.env.VITE_STATIC === '1';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (STATIC) {
    const { localApi } = await import('./local/engine.ts');
    const r = await localApi(opts.method ?? (opts.body ? 'POST' : 'GET'), `/api${path}`, opts.body);
    if (r.status >= 400) throw new ApiError(r.status, (r.data as any)?.error ?? `Błąd ${r.status}`);
    return r.data as T;
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Błąd ${res.status}`);
  return data as T;
}

/** prosty hook do pobierania: { data, error, loading, reload, setData } */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (n === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(e.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load, setData };
}

// meta i profil są potrzebne wszędzie – trzymamy je w pamięci modułu
let metaCache: Promise<Meta> | null = null;
export const getMeta = () => (metaCache ??= api<Meta>('/meta'));
export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { getMeta().then(setMeta); }, []);
  return meta;
}
