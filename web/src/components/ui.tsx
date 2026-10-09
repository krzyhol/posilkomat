import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { n } from '../format.ts';

// ------------------------------------------------------------------ ikony (rysowane ręcznie, jedna grubość kreski)
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const Icon = {
  today: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 1.5v2M12 20.5v2" /></svg>,
  plan: () => <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4M7.5 13.5h3M7.5 16.5h6" /></svg>,
  book: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z" /><path d="M5 16.5a3 3 0 0 1 3-3h10.5M9 8.5h5" /></svg>,
  cart: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 3.5h12l-1 17H7z" /><path d="M9 7.5h6M9 11.5h6M9 15.5h3" /></svg>,
  spark: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" /><path d="M19 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" /></svg>,
  cog: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></svg>,
  swap: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></svg>,
  check: () => <svg viewBox="0 0 24 24" {...P}><path d="m4.5 12.5 4.5 4.5 10.5-11" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  minus: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 12h14" /></svg>,
  x: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  search: () => <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>,
  star: ({ on }: { on?: boolean }) => <svg viewBox="0 0 24 24" {...P} fill={on ? 'currentColor' : 'none'}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" /></svg>,
  dice: () => <svg viewBox="0 0 24 24" {...P}><rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="9" r=".9" fill="currentColor" /><circle cx="15" cy="15" r=".9" fill="currentColor" /><circle cx="15" cy="9" r=".9" fill="currentColor" /><circle cx="9" cy="15" r=".9" fill="currentColor" /></svg>,
  back: () => <svg viewBox="0 0 24 24" {...P}><path d="M15 5l-7 7 7 7" /></svg>,
  copy: () => <svg viewBox="0 0 24 24" {...P}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>,
  trash: () => <svg viewBox="0 0 24 24" {...P}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></svg>,
  pot: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 10.5h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" /><path d="M2 10.5h20M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" /></svg>,
};

// ------------------------------------------------------------------ talerz makro
/** Okrągły „talerz”: łuki pokazują udział energii z białka, węglowodanów i tłuszczu. */
export function Plate({ p, c, f, kcal, size = 64, label = true }: { p: number; c: number; f: number; kcal?: number; size?: number; label?: boolean }) {
  const e = [p * 4, c * 4, f * 9];
  const tot = e.reduce((a, b) => a + b, 0) || 1;
  const R = 15.5, C = 2 * Math.PI * R, gap = 1.4;
  let off = 0;
  const colors = ['var(--p)', 'var(--c)', 'var(--f)'];
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={`Białko ${n(p)} g, węglowodany ${n(c)} g, tłuszcze ${n(f)} g`}>
      <circle cx="20" cy="20" r="19" fill="var(--card)" stroke="var(--line-2)" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="11.3" fill="none" stroke="var(--line)" strokeWidth="0.5" />
      {e.map((v, i) => {
        const len = Math.max(0, (v / tot) * C - gap);
        const el = (
          <circle key={i} cx="20" cy="20" r={R} fill="none" stroke={colors[i]} strokeWidth="4.6" strokeLinecap="round"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 20 20)" />
        );
        off += (v / tot) * C;
        return el;
      })}
      {label && kcal != null && (
        <text x="20" y="21.5" textAnchor="middle" fontFamily="var(--mono)" fontWeight="600" fontSize={kcal >= 1000 ? 6.2 : 7.4} fill="var(--ink)">{Math.round(kcal)}</text>
      )}
      {label && kcal != null && <text x="20" y="27" textAnchor="middle" fontFamily="var(--mono)" fontSize="3.6" fill="var(--muted)">kcal</text>}
    </svg>
  );
}

export function Macros({ p, c, f, scale = 1 }: { p: number; c: number; f: number; scale?: number }) {
  return (
    <div className="macros">
      <span><i style={{ background: 'var(--p)' }} />B <b>{n(p * scale, 0)}</b> g</span>
      <span><i style={{ background: 'var(--c)' }} />W <b>{n(c * scale, 0)}</b> g</span>
      <span><i style={{ background: 'var(--f)' }} />T <b>{n(f * scale, 0)}</b> g</span>
    </div>
  );
}

// ------------------------------------------------------------------ arkusz, ładowanie, błędy, toast
export function Sheet({ title, kicker, onClose, children }: { title: ReactNode; kicker?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head">
          <div>
            {kicker && <div className="kicker" style={{ marginBottom: 6 }}>{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><Icon.x /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Loading = () => <div className="loading"><span className="spinner" /></div>;
export const ErrorBox = ({ error }: { error: string }) => <div className="err">{error}</div>;

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export function Chip({ on, onClick, children, className = '' }: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return <button type="button" className={`chip ${on ? 'on' : ''} ${className}`} onClick={onClick} aria-pressed={on}>{children}</button>;
}
