/** „Składa” tekst do porównań i wyszukiwania: małe litery, bez ogonków, ł→l (tak samo jak indeks FTS w db/seed.ts). */
export const fold = (t: string) =>
  t.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export const slug = (t: string) =>
  t.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => PL[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** zapytanie FTS5: każde słowo jako prefiks, cudzysłowy chronią przed składnią FTS */
export const ftsQuery = (q: string) =>
  fold(q)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w}"*`)
    .join(' ');

/** odmiana liczebnika: 1 składnik, 2 składniki, 5 składników */
export const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const l = n % 10, l2 = n % 100;
  return l >= 2 && l <= 4 && !(l2 >= 12 && l2 <= 14) ? few : many;
};

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export { round };
