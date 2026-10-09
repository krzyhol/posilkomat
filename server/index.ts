import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './db.ts';
import { dispatch, route, need } from './http.ts';
import {
  getMeta, getProfile, saveProfile, searchProducts, createProduct, listRecipes, getRecipe, createRecipe, patchRecipe, calcNutrition,
} from './catalog.ts';
import { createPlan, listPlans, getPlan, deletePlan, getToday, patchMeal, addMeal, deleteMeal, swapCandidates } from './planner.ts';
import { createShoppingList, getShoppingList, listShoppingLists, patchItem, addItem, deleteItem, deleteList } from './shopping.ts';
import { generateDraft, saveDraft, aiStatus } from './ai.ts';

const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : undefined);

// ---------------------------------------------------------------- API
route('GET', '/api/meta', () => getMeta());
route('GET', '/api/settings', () => getProfile());
route('PUT', '/api/settings', ({ body }) => saveProfile(body ?? {}));

route('GET', '/api/products', ({ query }) => searchProducts(query.get('q') ?? '', num(query.get('limit')) ?? 20));
route('POST', '/api/products', ({ body }) => createProduct(body));
route('POST', '/api/nutrition', ({ body }) => calcNutrition(body?.ingredients ?? [], body?.servings ?? 1));

route('GET', '/api/recipes', ({ query }) => listRecipes({
  q: query.get('q') ?? undefined, slot: query.get('slot') ?? undefined, diet: query.get('diet') ?? undefined,
  dish: query.get('dish') ?? undefined, exclude: list(query.get('exclude')), source: query.get('source') ?? undefined,
  favorite: query.get('favorite') === '1', kcal_min: num(query.get('kcal_min')), kcal_max: num(query.get('kcal_max')),
  flavor: query.get('flavor') ?? undefined, feature: query.get('feature') ?? undefined,
  kind: (query.get('kind') as 'meal' | 'base') ?? undefined, limit: num(query.get('limit')), offset: num(query.get('offset')),
  sort: (query.get('sort') as any) ?? undefined,
}));
route('GET', '/api/recipes/:id', ({ params }) => need(getRecipe(params.id), 'Nie ma takiego przepisu'));
route('POST', '/api/recipes', ({ body }) => createRecipe(body));
route('PATCH', '/api/recipes/:id', ({ params, body }) => patchRecipe(params.id, body ?? {}));

route('GET', '/api/today', ({ query }) => getToday(query.get('date') ?? undefined));
route('GET', '/api/plans', () => listPlans());
route('POST', '/api/plans', ({ body }) => createPlan(body ?? {}));
route('GET', '/api/plans/:id', ({ params }) => getPlan(params.id));
route('DELETE', '/api/plans/:id', ({ params }) => deletePlan(params.id));
route('PATCH', '/api/plan-meals/:id', ({ params, body }) => patchMeal(Number(params.id), body ?? {}));
route('DELETE', '/api/plan-meals/:id', ({ params }) => deleteMeal(Number(params.id)));
route('POST', '/api/plan-days/:id/meals', ({ params, body }) => addMeal(Number(params.id), body));
route('GET', '/api/plan-meals/:id/swap', ({ params, query }) => swapCandidates(Number(params.id), {
  q: query.get('q') ?? undefined, flavor: query.get('flavor') ?? undefined, diet: query.get('diet') ?? undefined,
  feature: query.get('feature') ?? undefined, any_slot: query.get('any_slot') === '1', limit: num(query.get('limit')),
}));

route('GET', '/api/shopping-lists', () => listShoppingLists());
route('POST', '/api/plans/:id/shopping-list', ({ params, body }) => createShoppingList(params.id, body ?? {}));
route('GET', '/api/shopping-lists/:id', ({ params }) => getShoppingList(params.id));
route('DELETE', '/api/shopping-lists/:id', ({ params }) => deleteList(params.id));
route('POST', '/api/shopping-lists/:id/items', ({ params, body }) => addItem(params.id, body ?? {}));
route('PATCH', '/api/shopping-items/:id', ({ params, body }) => patchItem(Number(params.id), body ?? {}));
route('DELETE', '/api/shopping-items/:id', ({ params }) => deleteItem(Number(params.id)));

route('GET', '/api/ai/status', () => aiStatus());
route('POST', '/api/ai/draft', ({ body }) => generateDraft(body ?? {}));
route('POST', '/api/ai/save', ({ body }) => saveDraft(body ?? {}));

// ---------------------------------------------------------------- statyczny frontend (po `npm run build`)
const DIST = join(ROOT, 'web', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    if (!(await dispatch(req, res))) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Nie ma takiego adresu API' }));
    }
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('API działa. Frontend w trybie deweloperskim: npm run dev (http://localhost:5173). Wersja produkcyjna: npm run build.');
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const PORT = Number(process.env.PORT ?? 5174);
server.listen(PORT, () => console.log(`Posiłkomat API → http://localhost:${PORT}`));

