import { useEffect, useRef, useState } from 'react';
import { api, type Product } from '../api.ts';
import { n } from '../format.ts';

/** Pole z podpowiedziami z katalogu produktów (nazwa + aliasy). */
export function ProductPicker({ value, onPick, placeholder = 'Zacznij pisać, np. „jogurt skyr”' }: {
  value: string; onPick: (p: Product) => void; placeholder?: string;
}) {
  const [q, setQ] = useState(value);
  const [items, setItems] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setQ(value), [value]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setItems([]); return; }
    const t = setTimeout(() => api<Product[]>(`/products?q=${encodeURIComponent(q)}&limit=8`).then((r) => { setItems(r); setHl(0); }), 180);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const choose = (p: Product) => { onPick(p); setQ(p.name); setOpen(false); };
  return (
    <div className="picker" ref={box}>
      <input className="input" value={q} placeholder={placeholder} onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(items.length - 1, h + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
          if (e.key === 'Enter' && items[hl]) { e.preventDefault(); choose(items[hl]); }
          if (e.key === 'Escape') setOpen(false);
        }} />
      {open && items.length > 0 && (
        <div className="menu" role="listbox">
          {items.map((p, i) => (
            <button key={p.id} type="button" className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)} onClick={() => choose(p)}>
              <span>{p.name}</span><small>{n(p.kcal, 0)} kcal/100 g</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
