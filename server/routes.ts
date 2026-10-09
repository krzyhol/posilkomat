// Trasy API wspólne dla serwera Node i wersji przeglądarkowej (GitHub Pages)
import { route, need } from './http.ts';
import {
  getMeta, getProfile, saveProfile, toggleDislike, dislikesInfo, searchProducts, createProduct, productByBarcode, setBarcode, listRecipes, getRecipe, createRecipe, patchRecipe, calcNutrition,
} from './catalog.ts';
import { createPlan, listPlans, getPlan, deletePlan, getToday, patchMeal, addMeal, deleteMeal, swapCandidates } from './planner.ts';
import { ingredientSubstitutes, createVariant } from './substitutes.ts';
import { prepPlan } from './prep.ts';
import { weightLog, saveWeight, deleteWeight } from './weight.ts';
import { addExtra, deleteExtra } from './extras.ts';
import { listPantry, setPantryItem, removePantryItem, stockFromList, pantrySuggestions } from './pantry.ts';
import { createShoppingList, getShoppingList, listShoppingLists, patchItem, addItem, deleteItem, deleteList } from './shopping.ts';

const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : undefined);

// ---------------------------------------------------------------- API
route('GET', '/api/meta', () => getMeta());
route('GET', '/api/settings', () => getProfile());
route('PUT', '/api/settings', ({ body }) => saveProfile(body ?? {}));

route('GET', '/api/dislikes', () => dislikesInfo());
route('POST', '/api/dislikes', ({ body }) => toggleDislike(body ?? {}));
route('GET', '/api/products', ({ query }) => searchProducts(query.get('q') ?? '', num(query.get('limit')) ?? 20));
route('POST', '/api/products', ({ body }) => createProduct(body));
route('GET', '/api/products/by-barcode/:code', ({ params }) => need(productByBarcode(params.code), 'Nie znamy jeszcze tego kodu'));
route('PUT', '/api/products/:id/barcode', ({ params, body }) => setBarcode(params.id, String(body?.barcode ?? '')));
route('POST', '/api/nutrition', ({ body }) => calcNutrition(body?.ingredients ?? [], body?.servings ?? 1));

route('GET', '/api/recipes', ({ query }) => listRecipes({
  q: query.get('q') ?? undefined, slot: query.get('slot') ?? undefined, diet: query.get('diet') ?? undefined,
  dish: query.get('dish') ?? undefined, exclude: list(query.get('exclude')), source: query.get('source') ?? undefined,
  favorite: query.get('favorite') === '1', hide_disliked: query.get('hide_disliked') === '1', kcal_min: num(query.get('kcal_min')), kcal_max: num(query.get('kcal_max')),
  flavor: query.get('flavor') ?? undefined, feature: query.get('feature') ?? undefined,
  kind: (query.get('kind') as 'meal' | 'base') ?? undefined, limit: num(query.get('limit')), offset: num(query.get('offset')),
  sort: (query.get('sort') as any) ?? undefined,
}));
route('GET', '/api/recipes/:id', ({ params }) => need(getRecipe(params.id), 'Nie ma takiego przepisu'));
route('POST', '/api/recipes', ({ body }) => createRecipe(body));
route('PATCH', '/api/recipes/:id', ({ params, body }) => patchRecipe(params.id, body ?? {}));

route('GET', '/api/recipes/:id/substitutes/:position', ({ params }) => ingredientSubstitutes(params.id, Number(params.position)));
route('POST', '/api/recipes/:id/variant', ({ params, body }) => createVariant(params.id, body ?? {}));

route('GET', '/api/weight', () => weightLog());
route('POST', '/api/weight', ({ body }) => saveWeight(body ?? {}));
route('DELETE', '/api/weight/:date', ({ params }) => deleteWeight(params.date));

route('POST', '/api/extras', ({ body }) => addExtra(body ?? {}));
route('DELETE', '/api/extras/:id', ({ params }) => deleteExtra(Number(params.id)));

route('GET', '/api/today', ({ query }) => getToday(query.get('date') ?? undefined));
route('GET', '/api/plans', () => listPlans());
route('POST', '/api/plans', ({ body }) => createPlan(body ?? {}));
route('GET', '/api/plans/:id', ({ params }) => getPlan(params.id));
route('GET', '/api/plans/:id/prep', ({ params, query }) => prepPlan(params.id, {
  day_from: num(query.get('day_from')), day_to: num(query.get('day_to')), prep_date: query.get('prep_date') ?? undefined,
}));
route('DELETE', '/api/plans/:id', ({ params }) => deletePlan(params.id));
route('PATCH', '/api/plan-meals/:id', ({ params, body }) => patchMeal(Number(params.id), body ?? {}));
route('DELETE', '/api/plan-meals/:id', ({ params }) => deleteMeal(Number(params.id)));
route('POST', '/api/plan-days/:id/meals', ({ params, body }) => addMeal(Number(params.id), body));
route('GET', '/api/plan-meals/:id/swap', ({ params, query }) => swapCandidates(Number(params.id), {
  q: query.get('q') ?? undefined, flavor: query.get('flavor') ?? undefined, diet: query.get('diet') ?? undefined,
  feature: query.get('feature') ?? undefined, any_slot: query.get('any_slot') === '1', limit: num(query.get('limit')),
}));

route('GET', '/api/pantry', () => listPantry());
route('PUT', '/api/pantry/:product', ({ params, body }) => setPantryItem(params.product, body ?? {}));
route('DELETE', '/api/pantry/:product', ({ params }) => removePantryItem(params.product));
route('GET', '/api/pantry/suggestions', ({ query }) => pantrySuggestions({ slot: query.get('slot') ?? undefined, limit: num(query.get('limit')) }));
route('POST', '/api/shopping-lists/:id/to-pantry', ({ params }) => stockFromList(params.id));

route('GET', '/api/shopping-lists', () => listShoppingLists());
route('POST', '/api/plans/:id/shopping-list', ({ params, body }) => createShoppingList(params.id, body ?? {}));
route('GET', '/api/shopping-lists/:id', ({ params }) => getShoppingList(params.id));
route('DELETE', '/api/shopping-lists/:id', ({ params }) => deleteList(params.id));
route('POST', '/api/shopping-lists/:id/items', ({ params, body }) => addItem(params.id, body ?? {}));
route('PATCH', '/api/shopping-items/:id', ({ params, body }) => patchItem(Number(params.id), body ?? {}));
route('DELETE', '/api/shopping-items/:id', ({ params }) => deleteItem(Number(params.id)));
