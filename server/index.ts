import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ROOT } from './db.ts';
import { dispatch, route } from './http.ts';
import './routes.ts';
import { generateDraft, saveDraft, aiStatus, estimateMeal } from './ai.ts';

route('GET', '/api/ai/status', () => aiStatus());
route('POST', '/api/ai/draft', ({ body }) => generateDraft(body ?? {}));
route('POST', '/api/ai/save', ({ body }) => saveDraft(body ?? {}));
route('POST', '/api/ai/estimate', ({ body }) => estimateMeal(body ?? {}));

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

