import { useEffect, useState } from 'react';

/** Minimalny router na hashu: #/przepisy/abc?base=x */
export function useRoute() {
  const parse = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs = ''] = raw.split('?');
    return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => { location.hash = path; };
export const href = (path: string) => `#${path}`;
