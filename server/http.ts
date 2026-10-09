import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Ctx = {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
};
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];

export function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Nieprawidłowy JSON w treści żądania');
  }
}

export function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** Obsługuje /api/*; zwraca false, jeśli żaden route nie pasuje. */
export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? await readBody(req) : undefined;
      const out = await r.handler({ req, params, query: url.searchParams, body });
      send(res, out === undefined ? 204 : 200, out ?? null);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e?.message ?? 'Błąd serwera' });
    }
    return true;
  }
  return false;
}

export const need = <T>(v: T | undefined | null, what = 'Nie znaleziono'): T => {
  if (v === undefined || v === null) throw new HttpError(404, what);
  return v;
};
