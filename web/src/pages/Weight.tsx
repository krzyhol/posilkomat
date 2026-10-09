import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi, type Profile } from '../api.ts';
import { dayMonth, n, plural, todayIso } from '../format.ts';
import { Chip, ErrorBox, Icon, Loading, useToast } from '../components/ui.tsx';
import { YouTabs } from './Settings.tsx';

type Entry = { date: string; weight_kg: number; waist_cm: number | null; trend: number };
type WeightRes = {
  entries: Entry[];
  stats: {
    trend: number | null; rate_kg_week: number | null; goal_kg: number | null; goal_rate_kg_week?: number; weeks_to_goal: number | null; days_of_data: number;
    suggestion: { adjust: number; target_kcal: number; text: string } | null;
  };
};

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const short = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const dnum = (iso: string) => Date.parse(iso + 'T12:00:00Z') / 86400000;

/** Wykres wagi: pomiary (kropki) + trend (linia) + cel (linia odniesienia), z podglądem po najechaniu. */
function WeightChart({ entries, goal }: { entries: Entry[]; goal: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const H = 240, P = { l: 44, r: 64, t: 16, b: 28 };
  const xs = entries.map((e) => dnum(e.date));
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
  const vals = entries.flatMap((e) => [e.weight_kg, e.trend]);
  const showGoal = goal !== null && Math.abs(goal - entries[entries.length - 1].trend) <= 6;
  let y0 = Math.min(...vals, ...(showGoal ? [goal!] : [])), y1 = Math.max(...vals, ...(showGoal ? [goal!] : []));
  const step = y1 - y0 > 6 ? 2 : y1 - y0 > 2.5 ? 1 : 0.5;
  y0 = Math.floor((y0 - 0.2) / step) * step; y1 = Math.ceil((y1 + 0.2) / step) * step;
  const X = (d: number) => P.l + ((d - x0) / (x1 - x0)) * (w - P.l - P.r);
  const Y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const ticks = Array.from({ length: Math.round((y1 - y0) / step) + 1 }, (_, i) => y0 + i * step);
  const xticks = entries.length <= 1 ? entries.map((e) => e.date) : [0, 0.33, 0.66, 1].map((f) => {
    const target = x0 + f * (x1 - x0);
    return entries.reduce((best, e) => (Math.abs(dnum(e.date) - target) < Math.abs(dnum(best.date) - target) ? e : best)).date;
  }).filter((d, i, a) => a.indexOf(d) === i);
  const path = entries.map((e, i) => `${i ? 'L' : 'M'}${X(dnum(e.date)).toFixed(1)},${Y(e.trend).toFixed(1)}`).join(' ');
  const last = entries[entries.length - 1];
  const h = hover !== null ? entries[hover] : null;

  const onMove = (ev: React.PointerEvent<SVGRectElement>) => {
    const r = (ev.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = ev.clientX - r.left + P.l;
    let best = 0;
    entries.forEach((e, i) => { if (Math.abs(X(dnum(e.date)) - px) < Math.abs(X(dnum(entries[best].date)) - px)) best = i; });
    setHover(best);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <div className="row" style={{ gap: 16, fontSize: 13, marginBottom: 6 }} aria-hidden>
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="var(--wt-dot)" /></svg> pomiar</span>
        <span><svg width="18" height="12"><path d="M1 6h16" stroke="var(--tomato)" strokeWidth="2" strokeLinecap="round" /></svg> trend</span>
        {showGoal && <span><svg width="18" height="12"><path d="M1 6h16" stroke="var(--ink)" strokeWidth="1" strokeDasharray="3 3" /></svg> cel</span>}
      </div>
      <svg width={w} height={H} role="img" aria-label={`Wykres wagi: trend ${n(last.trend)} kg`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={w - P.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={P.l - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fontFamily="var(--mono)" fill="var(--muted)">{n(t, 1)}</text>
          </g>
        ))}
        {xticks.map((d) => <text key={d} x={X(dnum(d))} y={H - 8} textAnchor="middle" fontSize="11" fontFamily="var(--mono)" fill="var(--muted)">{short(d)}</text>)}
        {showGoal && <>
          <line x1={P.l} x2={w - P.r} y1={Y(goal!)} y2={Y(goal!)} stroke="var(--ink)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={w - P.r + 6} y={Y(goal!) + 4} fontSize="11" fontFamily="var(--mono)" fill="var(--ink)">cel {n(goal!)}</text>
        </>}
        {h && <line x1={X(dnum(h.date))} x2={X(dnum(h.date))} y1={P.t} y2={H - P.b} stroke="var(--line-2)" strokeWidth="1" />}
        {entries.length > 1 && <path d={path} fill="none" stroke="var(--tomato)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {entries.map((e, i) => (
          <circle key={e.date} cx={X(dnum(e.date))} cy={Y(e.weight_kg)} r={hover === i ? 6 : 4} fill="var(--wt-dot)" stroke="var(--card)" strokeWidth="2" />
        ))}
        <text x={X(dnum(last.date)) + 8} y={Y(last.trend) + 4} fontSize="12" fontWeight="600" fontFamily="var(--mono)" fill="var(--ink)">{n(last.trend)} kg</text>
        <rect x={P.l} y={P.t} width={Math.max(0, w - P.l - P.r)} height={H - P.t - P.b} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: Math.min(w - 170, Math.max(0, X(dnum(h.date)) - 80)), top: 18 }}>
          <b>{dayMonth(h.date)}</b>
          <div><span className="sw" style={{ background: 'var(--wt-dot)', borderRadius: '50%' }} />pomiar <b className="num">{n(h.weight_kg)} kg</b></div>
          <div><span className="sw" style={{ background: 'var(--tomato)', height: 2 }} />trend <b className="num">{n(h.trend)} kg</b></div>
          {h.waist_cm && <div className="muted">talia {n(h.waist_cm)} cm</div>}
        </div>
      )}
    </div>
  );
}

export default function Weight() {
  const toast = useToast();
  const { data, error, setData } = useApi<WeightRes>('/weight');
  const profile = useApi<Profile>('/settings');
  const [date, setDate] = useState(todayIso());
  const [kg, setKg] = useState('');
  const [waist, setWaist] = useState('');
  const [range, setRange] = useState<30 | 90 | 0>(90);
  const [goalInput, setGoalInput] = useState('');
  useEffect(() => { if (profile.data?.goal_weight_kg) setGoalInput(String(profile.data.goal_weight_kg).replace('.', ',')); }, [profile.data]);

  const shown = useMemo(() => {
    if (!data) return [];
    if (!range || !data.entries.length) return data.entries;
    const end = dnum(data.entries[data.entries.length - 1].date);
    return data.entries.filter((e) => end - dnum(e.date) <= range);
  }, [data, range]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !profile.data) return <Loading />;
  const s = data.stats;
  const p = profile.data;

  const save = async () => {
    const v = Number(kg.replace(',', '.'));
    setData(await api<WeightRes>('/weight', { body: { date, weight_kg: v, waist_cm: waist ? Number(waist.replace(',', '.')) : null } }));
    setKg(''); setWaist('');
    toast('Zapisane.');
  };
  const saveGoal = async (patch: Partial<Profile>) => {
    profile.setData(await api<Profile>('/settings', { method: 'PUT', body: { ...p, ...patch } }));
    setData(await api<WeightRes>('/weight'));
  };
  const apply = async () => {
    if (!s.suggestion) return;
    await saveGoal({ target_kcal: s.suggestion.target_kcal });
    toast(`Nowy cel: ${s.suggestion.target_kcal} kcal. Nowe jadłospisy użyją go automatycznie.`);
  };
  const rate = s.rate_kg_week;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Ty</div>
          <h1 style={{ marginTop: 10 }}>Waga, <em>a nie wahania</em>.</h1>
          <p className="lede">Codzienne pomiary skaczą o kilogram przez wodę i sól. Patrz na linię trendu – to ona mówi, czy cel kalorii działa.</p>
        </div>
      </header>
      <YouTabs on="weight" />

      <section className="card pad">
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field"><span>Data</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 120 }}><span>Waga (kg)</span><input className="input num" inputMode="decimal" placeholder="72,4" value={kg} onChange={(e) => setKg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && kg && save()} /></label>
          <label className="field" style={{ width: 120 }}><span>Talia (cm)</span><input className="input num" inputMode="decimal" placeholder="opcjonalnie" value={waist} onChange={(e) => setWaist(e.target.value)} /></label>
          <button className="btn tomato" onClick={save} disabled={!kg}><Icon.check />Zapisz</button>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Najlepiej rano, po toalecie, przed śniadaniem – codziennie albo co 2–3 dni.</p>
      </section>

      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><span className="kicker">trend</span><b>{s.trend !== null ? `${n(s.trend)} kg` : '–'}</b></div>
        <div className="stat"><span className="kicker">tempo</span><b>{rate !== null ? `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${n(Math.abs(rate), 2)} kg/tydz.` : '–'}</b>
          {rate === null && <small className="muted">potrzeba ok. 2 tygodni pomiarów</small>}</div>
        <div className="stat"><span className="kicker">do celu</span><b>{s.goal_kg !== null && s.trend !== null ? `${n(Math.abs(s.trend - s.goal_kg))} kg` : '–'}</b>
          {s.weeks_to_goal !== null && <small className="muted">ok. {s.weeks_to_goal} {plural(s.weeks_to_goal, 'tydzień', 'tygodnie', 'tygodni')} w tym tempie</small>}</div>
        <div className="stat"><span className="kicker">cel kalorii</span><b>{p.target_kcal} kcal</b></div>
      </div>

      {s.suggestion && (
        <div className="note" style={{ marginTop: 16, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>{s.suggestion.text}</span>
          {s.suggestion.adjust !== 0 && <button className="btn small" onClick={apply}>Ustaw {s.suggestion.target_kcal} kcal</button>}
        </div>
      )}

      <section className="section">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="kicker" style={{ margin: 0 }}>Wykres</div>
          <div className="chips">{([30, 90, 0] as const).map((r) => <Chip key={r} on={range === r} onClick={() => setRange(r)}>{r ? `${r} dni` : 'wszystko'}</Chip>)}</div>
        </div>
        {shown.length >= 2
          ? <div className="card pad"><WeightChart entries={shown} goal={s.goal_kg} /></div>
          : <div className="empty"><h3>Za mało pomiarów na wykres</h3><p>Zapisz wagę przez kilka dni – linia trendu pojawi się od drugiego pomiaru.</p></div>}
      </section>

      <div className="two-col section">
        <section>
          <div className="kicker">Pomiary</div>
          {!data.entries.length && <p className="muted">Jeszcze nic.</p>}
          <table className="table">
            <thead><tr><th>Data</th><th>Waga</th><th>Trend</th><th>Talia</th><th /></tr></thead>
            <tbody>
              {[...data.entries].reverse().slice(0, 60).map((e) => (
                <tr key={e.date}>
                  <td>{dayMonth(e.date)}</td><td className="num">{n(e.weight_kg)} kg</td><td className="num">{n(e.trend)} kg</td>
                  <td className="num">{e.waist_cm ? `${n(e.waist_cm)} cm` : ''}</td>
                  <td><button className="icon-btn" onClick={async () => setData(await api<WeightRes>(`/weight/${e.date}`, { method: 'DELETE' }))} aria-label={`Usuń pomiar z ${dayMonth(e.date)}`}><Icon.x /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="card pad stack" style={{ gap: 12 }}>
          <div className="kicker">Cel</div>
          <label className="field"><span>Waga docelowa (kg)</span>
            <input className="input num" inputMode="decimal" value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
              onBlur={() => saveGoal({ goal_weight_kg: goalInput ? Number(goalInput.replace(',', '.')) : null })} />
          </label>
          <label className="field"><span>Tempo</span>
            <select className="select" value={p.goal_rate_kg_week ?? ''} onChange={(e) => saveGoal({ goal_rate_kg_week: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">automatycznie z celu</option>
              <option value="-0.75">−0,75 kg / tydzień</option>
              <option value="-0.5">−0,5 kg / tydzień</option>
              <option value="-0.25">−0,25 kg / tydzień</option>
              <option value="0">utrzymanie</option>
              <option value="0.25">+0,25 kg / tydzień</option>
            </select>
          </label>
          <small className="muted">Korekta liczy się z ostatnich 3 tygodni (≈ 7700 kcal na 1 kg), najwyżej ±300 kcal naraz. To podpowiedź, nie zalecenie lekarskie.</small>
        </aside>
      </div>
    </>
  );
}
