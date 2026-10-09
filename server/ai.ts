// Generowanie i przerabianie przepisów przez Claude (structured outputs → szkic do przejrzenia → zapis)
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { all } from './store.ts';
import { HttpError } from './http.ts';
import { createProduct, createRecipe, getProfile, getRecipe, matchProduct, getProducts } from './catalog.ts';
import { round } from './text.ts';

const MODEL = process.env.POSILKOMAT_MODEL ?? 'claude-opus-5-5';

const SLOTS = ['breakfast', 'second_breakfast', 'lunch', 'dinner', 'snack'] as const;
const UNITS = ['sztuka', 'łyżka', 'łyżeczka', 'szczypta', 'szklanka', 'kromka', 'plaster', 'opakowanie', 'ząbek', 'garść', 'kostka', 'łodyga', 'listek', 'porcja'] as const;
const CATEGORIES = ['warzywa', 'owoce', 'pieczywo', 'nabial', 'mieso', 'ryby', 'roslinne', 'zboza', 'pieczenie', 'konserwy', 'orzechy', 'przyprawy', 'oleje_sosy', 'slodycze', 'produkty_proteinowe', 'napoje', 'mrozonki_gotowe', 'inne'] as const;
const ALLERGENS = ['gluten', 'mleko', 'jaja', 'orzechy', 'orzeszki_ziemne', 'soja', 'sezam', 'ryby', 'gorczyca', 'seler'] as const;

const Macros = z.object({ kcal: z.number(), protein_g: z.number(), fat_g: z.number(), carbs_g: z.number() });

const DraftSchema = z.object({
  name: z.string().describe('Krótka, apetyczna nazwa dania po polsku'),
  description: z.string().describe('1–2 zdania: co to za danie i dlaczego pasuje do prośby'),
  meal_slots: z.array(z.enum(SLOTS)),
  servings: z.number().int().describe('Na ile porcji są podane składniki (zwykle 1)'),
  prep_time_min: z.number().int(),
  ingredients: z.array(z.object({
    name: z.string().describe('Nazwa produktu – jeśli istnieje w katalogu, przepisz ją dokładnie'),
    amount_g: z.number().describe('Gramy na CAŁY przepis (wszystkie porcje)'),
    household_qty: z.number().nullable(),
    household_unit: z.enum(UNITS).nullable(),
    group: z.string().nullable().describe('Sekcja, np. "Sos" albo "Do podania"; null gdy brak'),
    new_product: z.object({
      category: z.enum(CATEGORIES),
      origin: z.enum(['plant', 'dairy', 'egg', 'honey', 'fish', 'meat']),
      allergens: z.array(z.enum(ALLERGENS)),
      per_100g: Macros.extend({ fiber_g: z.number() }),
    }).nullable().describe('Wypełnij TYLKO gdy produktu nie ma w katalogu; wartości na 100 g'),
  })),
  steps: z.array(z.string()),
  tags: z.array(z.string()).describe('2–4 krótkie tagi, np. "na ciepło", "meal prep"'),
  estimated_nutrition_per_serving: Macros,
});
export type Draft = z.infer<typeof DraftSchema>;

let client: Anthropic | null = null;
const ai = () => (client ??= new Anthropic());

let catalogText: string | null = null;
/** Lista nazw z katalogu pogrupowana po kategoriach. Budowana raz – stały tekst to stabilny prefiks promptu (cache). */
function catalog() {
  if (catalogText) return catalogText;
  const byCat = new Map<string, string[]>();
  for (const r of all(`SELECT p.name, c.name AS cat FROM products p JOIN product_categories c ON c.id = p.category_id
                       WHERE p.shoppable = 1 ORDER BY c.position, p.name`))
    byCat.set(r.cat, [...(byCat.get(r.cat) ?? []), r.name]);
  catalogText = [...byCat].map(([c, names]) => `## ${c}\n${names.join('; ')}`).join('\n');
  return catalogText;
}

const SYSTEM = `Jesteś dietetykiem i kucharzem aplikacji Posiłkomat – polskiej aplikacji do układania jadłospisów.
Tworzysz przepisy, które da się zrobić z produktów z polskiego supermarketu, w realistycznych ilościach.

Zasady:
- Gramatury podawaj dla całego przepisu (wszystkich porcji). Mięso, ryby, kasze, ryż i makaron – w wadze surowej / suchej.
- Kaloryczność i makro podaj na jedną porcję. Węglowodany = ogółem (z błonnikiem).
- Trzymaj się celu kalorycznego z prośby (±10%) i ograniczeń: dieta, wykluczone alergeny.
- Składniki nazywaj tak jak w katalogu poniżej – dokładnie tą samą nazwą. Tylko gdy czegoś w katalogu naprawdę brakuje, użyj nowej nazwy i wypełnij new_product (wartości odżywcze na 100 g, kategoria sklepowa, alergeny).
- Sól, pieprz i przyprawy podawaj z gramaturą (szczypta ≈ 0,25 g, łyżeczka przyprawy ≈ 2–3 g).
- Kroki pisz w 1. osobie liczby mnogiej, konkretnie, z czasem i mocą ognia („Na średnim ogniu smażymy 5–6 minut, aż…”). Każdy krok to jedna czynność lub krótka sekwencja.
- Odpowiadasz wyłącznie w formacie JSON zgodnym ze schematem.`;

const SLOT_PL: Record<string, string> = { breakfast: 'śniadanie', second_breakfast: 'II śniadanie', lunch: 'obiad', dinner: 'kolacja', snack: 'przekąska' };

export type GenerateInput = {
  prompt: string; slot?: string; target_kcal?: number; servings?: number; diet?: string | null;
  exclude_allergens?: string[]; pantry?: string; base_recipe_id?: string;
};

function describeRecipe(id: string) {
  const r = getRecipe(id);
  if (!r) throw new HttpError(404, 'Nie ma takiego przepisu');
  return {
    r,
    text: [
      `Nazwa: ${r.name} (porcje: ${r.servings}; na porcję ${Math.round(r.kcal)} kcal, B ${r.protein_g} g, T ${r.fat_g} g, W ${r.carbs_g} g)`,
      'Składniki (na cały przepis):',
      ...r.ingredients.map((i: any) => `- ${i.name}: ${i.amount_g ?? 'do smaku'} g${i.group_name ? ` [${i.group_name}]` : ''}`),
      'Kroki:',
      ...r.steps.map((s: any) => `${s.position}. ${s.text}`),
    ].join('\n'),
  };
}

export async function generateDraft(input: GenerateInput) {
  if (!input.prompt?.trim() && !input.base_recipe_id) throw new HttpError(400, 'Napisz, na co masz ochotę');
  const profile = getProfile();
  const exclude = input.exclude_allergens ?? profile.excluded_allergens;
  const diet = input.diet === undefined ? profile.diet : input.diet;
  const base = input.base_recipe_id ? describeRecipe(input.base_recipe_id) : null;
  const target = input.target_kcal ?? (base ? Math.round(base.r.kcal) : undefined);

  const ask = [
    base ? `Przerób ten przepis zgodnie z prośbą. Zachowaj charakter dania, zmień tylko to, co trzeba.\n\n${base.text}\n` : null,
    `Prośba: ${input.prompt?.trim() || 'zaproponuj ciekawszą wersję tego dania'}`,
    input.slot ? `Pora posiłku: ${SLOT_PL[input.slot] ?? input.slot}` : null,
    target ? `Cel: ok. ${target} kcal na porcję` : null,
    `Liczba porcji: ${input.servings ?? base?.r.servings ?? 1}`,
    diet ? `Dieta: ${diet}` : null,
    exclude.length ? `Bez alergenów: ${exclude.join(', ')}` : null,
    profile.disliked_products?.length ? `Nie lubię i nie używaj: ${getProducts(profile.disliked_products).map((x: any) => x.name).join(', ')}` : null,
    input.pantry?.trim() ? `Mam w domu i chcę to wykorzystać: ${input.pantry.trim()}` : null,
  ].filter(Boolean).join('\n');

  let msg;
  try {
    msg = await ai().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(DraftSchema) },
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: `Katalog produktów (nazwy do użycia w przepisach):\n${catalog()}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: ask }],
    } as any);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new HttpError(503, 'Brak dostępu do Claude API. Ustaw ANTHROPIC_API_KEY (albo zaloguj się: `ant auth login`) i uruchom serwer ponownie.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Za dużo zapytań do AI – spróbuj za chwilę.');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(503, 'Nie udało się połączyć z Claude API.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude API: ${e.message}`);
    // brak poświadczeń zgłaszany przez SDK przed wysłaniem żądania
    if (e instanceof Error && /api key|apiKey|authToken|credentials/i.test(e.message))
      throw new HttpError(503, 'Brak klucza do Claude API. Ustaw ANTHROPIC_API_KEY (albo `ant auth login`) i uruchom serwer ponownie.');
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'AI odmówiło przygotowania tego przepisu. Spróbuj inaczej sformułować prośbę.');
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'Odpowiedź AI została ucięta – spróbuj prostszej prośby.');
  const draft = (msg as any).parsed_output as Draft | null;
  if (!draft) throw new HttpError(502, 'AI zwróciło odpowiedź w nieoczekiwanym formacie.');

  const ingredients = draft.ingredients.map((i) => {
    const m = matchProduct(i.name);
    return { ...i, match: m.product ? { id: m.product.id, name: m.product.name, kcal: m.product.kcal } : null, confidence: m.confidence };
  });
  return {
    draft: { ...draft, ingredients },
    nutrition_calc: draftNutrition(ingredients, draft.servings),
    prompt: input.prompt?.trim() || null,
    based_on_recipe_id: input.base_recipe_id ?? null,
    model: msg.model,
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cache_read: msg.usage.cache_read_input_tokens ?? 0 },
  };
}

type DraftIngredient = Draft['ingredients'][number] & { match?: { id: string } | null; product_id?: string | null };

function draftNutrition(ings: DraftIngredient[], servings: number) {
  const ids = ings.map((i) => i.product_id ?? i.match?.id).filter(Boolean) as string[];
  const prods = new Map(getProducts(ids).map((p: any) => [p.id, p]));
  const t = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  for (const i of ings) {
    const id = i.product_id ?? i.match?.id;
    const v = id ? prods.get(id) : i.new_product?.per_100g;
    if (!v) continue;
    const g = i.amount_g / 100 / Math.max(1, servings);
    t.kcal += v.kcal * g; t.protein_g += v.protein_g * g; t.fat_g += v.fat_g * g; t.carbs_g += v.carbs_g * g;
  }
  return { kcal: Math.round(t.kcal), protein_g: round(t.protein_g), fat_g: round(t.fat_g), carbs_g: round(t.carbs_g) };
}

/** Zapis zaakceptowanego szkicu: brakujące produkty trafiają do katalogu (wartości szacowane przez AI). */
export function saveDraft(input: { draft: Omit<Draft, 'ingredients'> & { ingredients: DraftIngredient[] }; prompt?: string | null; based_on_recipe_id?: string | null; model?: string }) {
  const d = input.draft;
  if (!d?.ingredients?.length) throw new HttpError(400, 'Szkic nie ma składników');
  const ingredients = d.ingredients.map((i) => {
    let id = i.product_id ?? i.match?.id ?? null;
    if (!id) {
      if (!i.new_product) throw new HttpError(400, `Wybierz produkt z katalogu dla „${i.name}”`);
      const p = createProduct({
        name: i.name, category_id: i.new_product.category, origin: i.new_product.origin, allergens: i.new_product.allergens,
        ...i.new_product.per_100g, nutrition_source: 'ai_estimate', source_type: 'ai_generated',
        measures: i.household_unit && i.household_qty ? [{ unit: i.household_unit, grams: round(i.amount_g / i.household_qty) }] : [],
      });
      id = p.id;
    }
    return { product_id: id!, name: i.name, amount_g: i.amount_g, household_qty: i.household_qty, household_unit: i.household_unit, group_name: i.group };
  });
  return createRecipe({
    name: d.name, description: d.description, slots: d.meal_slots.length ? d.meal_slots : ['lunch'], servings: d.servings,
    prep_time_min: d.prep_time_min, ingredients, steps: d.steps.map((text) => ({ text })), tags: d.tags,
    source: {
      type: input.based_on_recipe_id ? 'ai_modified' : 'ai_generated', model: input.model ?? MODEL,
      prompt: input.prompt ?? undefined, based_on_recipe_id: input.based_on_recipe_id ?? undefined,
    },
  });
}

const EstimateSchema = z.object({
  name: z.string().describe('Krótka nazwa posiłku po polsku, np. "Pizza margherita, 2 kawałki"'),
  items: z.array(z.object({ name: z.string(), grams: z.number(), kcal: z.number() })),
  kcal: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(),
  confidence: z.enum(['niska', 'średnia', 'wysoka']),
  note: z.string().describe('Jedno zdanie: co założyłeś (wielkość porcji, sposób przyrządzenia)'),
});

/** Szacuje kalorie posiłku z opisu i/lub zdjęcia (posiłek spoza planu). */
export async function estimateMeal(input: { text?: string; image?: { data: string; media_type: string } }) {
  if (!input.text?.trim() && !input.image) throw new HttpError(400, 'Opisz posiłek albo dodaj zdjęcie');
  const content: any[] = [];
  if (input.image) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(input.image.media_type)) throw new HttpError(400, 'Obsługiwane zdjęcia: JPG, PNG, WebP');
    content.push({ type: 'image', source: { type: 'base64', media_type: input.image.media_type, data: input.image.data } });
  }
  content.push({ type: 'text', text: `Oszacuj kaloryczność i makro tego, co zjadłem.${input.text?.trim() ? `\nOpis: ${input.text.trim()}` : ''}\nPodaj realistyczne porcje typowe dla Polski, rozbij na składniki z gramaturą. Węglowodany ogółem.` });
  let msg;
  try {
    msg = await ai().beta.messages.parse({
      model: MODEL, max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(EstimateSchema) },
      system: 'Jesteś dietetykiem. Szacujesz kalorie posiłków na podstawie opisu lub zdjęcia. Gdy czegoś nie widać, przyjmij typową porcję i napisz to w note. Odpowiadasz wyłącznie JSON-em zgodnym ze schematem.',
      messages: [{ role: 'user', content }],
    } as any);
  } catch (e) {
    throw mapAiError(e);
  }
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'AI nie oszacowało tego posiłku – wpisz kalorie ręcznie.');
  const out = (msg as any).parsed_output as z.infer<typeof EstimateSchema> | null;
  if (!out) throw new HttpError(502, 'AI zwróciło odpowiedź w nieoczekiwanym formacie.');
  return out;
}

function mapAiError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new HttpError(503, 'Brak dostępu do Claude API. Ustaw ANTHROPIC_API_KEY (albo zaloguj się: `ant auth login`) i uruchom serwer ponownie.');
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'Za dużo zapytań do AI – spróbuj za chwilę.');
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(503, 'Nie udało się połączyć z Claude API.');
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Claude API: ${e.message}`);
  if (e instanceof Error && /api key|apiKey|authToken|credentials/i.test(e.message))
    return new HttpError(503, 'Brak klucza do Claude API. Ustaw ANTHROPIC_API_KEY (albo `ant auth login`) i uruchom serwer ponownie.');
  return e;
}

export function aiStatus() {
  const env = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
  return { model: MODEL, credentials: env ? 'env' : 'unknown' };
}
