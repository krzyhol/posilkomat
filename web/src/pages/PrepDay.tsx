import { useState } from 'react';
import { useApi, type Plan, type Slot } from '../api.ts';
import { SLOT_NAME, dayMonth, plural, weekday, weekdayShort, dayNum } from '../format.ts';
import { href } from '../router.tsx';
import { ErrorBox, Icon, Loading } from '../components/ui.tsx';

type Prep = {
  prep_date: string; day_from: number; day_to: number; people: number; total_minutes: number;
  steps: { kind: string; title: string; minutes: number; parallel?: boolean; items: { text: string; sub?: string }[] }[];
  boxes: { date: string; slot: Slot; recipe_id: string; name: string; portions: number; storage: 'fridge' | 'freezer'; shelf_days: number; eat_by: string | null; thaw_evening: string | null }[];
  evening: { date: string; slot: Slot; name: string; recipe_id: string }[];
  fresh: { date: string; slot: Slot; name: string; recipe_id: string; cooked: boolean }[];
};

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}` : `${m} min`);

export default function PrepDay({ planId }: { planId: string }) {
  const plan = useApi<Plan>(`/plans/${planId}`);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [prepDate, setPrepDate] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries({ day_from: from, day_to: to, prep_date: prepDate }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const { data, error } = useApi<Prep>(`/plans/${planId}/prep?${qs}`);
  const [done, setDone] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setDone((d) => { const x = new Set(d); x.has(k) ? x.delete(k) : x.add(k); return x; });

  if (error) return <ErrorBox error={error} />;
  if (!data || !plan.data) return <Loading />;
  const days = plan.data.days;
  const label = (d: number) => { const x = days.find((y) => y.day_number === d); return x?.date ? `${weekdayShort(x.date)} ${dayNum(x.date)}` : `dzień ${d}`; };

  return (
    <>
      <div className="no-print"><a className="btn link" href={href(`/jadlospis/${planId}`)}><Icon.back />{plan.data.name}</a></div>
      <header className="page-head" style={{ marginTop: 10 }}>
        <div>
          <div className="kicker">Dzień gotowania · {weekday(data.prep_date)}, {dayMonth(data.prep_date)}</div>
          <h1 style={{ marginTop: 10 }}>Gotujesz raz, <em>jesz {data.day_to - data.day_from + 1} {plural(data.day_to - data.day_from + 1, 'dzień', 'dni', 'dni')}</em>.</h1>
          <p className="lede">Ok. <b>{hm(data.total_minutes)}</b> w kuchni{data.people > 1 ? ` · porcje × ${data.people} os.` : ''}. Najpierw to, co trwa najdłużej – w tym czasie robisz resztę.</p>
        </div>
        <button className="btn ghost no-print" onClick={() => window.print()}><Icon.copy />Drukuj</button>
      </header>

      <div className="row no-print" style={{ marginBottom: 22 }}>
        <label className="field"><span>Gotuję</span><input type="date" className="input" value={data.prep_date} onChange={(e) => setPrepDate(e.target.value)} /></label>
        <label className="field"><span>Na dni od</span>
          <select className="select" value={data.day_from} onChange={(e) => { setFrom(+e.target.value); if (+e.target.value > data.day_to) setTo(+e.target.value); }}>
            {days.map((d) => <option key={d.id} value={d.day_number}>{label(d.day_number)}</option>)}
          </select>
        </label>
        <label className="field"><span>do</span>
          <select className="select" value={data.day_to} onChange={(e) => setTo(+e.target.value)}>
            {days.filter((d) => d.day_number >= data.day_from).map((d) => <option key={d.id} value={d.day_number}>{label(d.day_number)}</option>)}
          </select>
        </label>
      </div>

      {!data.steps.length && <div className="empty"><h3>Nie ma czego gotować z wyprzedzeniem</h3><p>W tych dniach są same dania na świeżo albo bez gotowania.</p></div>}
      <ol className="prep">
        {data.steps.map((s, si) => (
          <li key={s.kind} className="card pad">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3><span className="prep-nr">{si + 1}</span>{s.title}</h3>
              <span className="chip tiny">{s.parallel ? 'równolegle · ' : ''}~{hm(s.minutes)}</span>
            </div>
            <ul>
              {s.items.map((it, k) => {
                const key = `${s.kind}-${k}`;
                return (
                  <li key={key} className={done.has(key) ? 'done' : ''}>
                    <label className="toggle" style={{ alignItems: 'start' }}>
                      <input type="checkbox" checked={done.has(key)} onChange={() => toggle(key)} />
                      <span><span className="t">{it.text}</span>{it.sub && <small className="muted" style={{ display: 'block' }}>{it.sub}</small>}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {data.boxes.length > 0 && (
        <section className="section">
          <div className="kicker">Pudełka · {data.boxes.length}</div>
          <div className="labels">
            {data.boxes.map((b, i) => (
              <a key={i} className={`label ${b.storage}`} href={href(`/przepisy/${b.recipe_id}`)}>
                <div className="l-top"><span>{weekdayShort(b.date)} {dayNum(b.date)}</span><span>{SLOT_NAME[b.slot]}</span></div>
                <div className="l-name">{b.name}</div>
                <div className="l-foot"><span>{b.storage === 'freezer' ? '❄ zamrażarka' : 'lodówka'}</span><span>{b.portions !== 1 ? `${String(Math.round(b.portions * 10) / 10).replace('.', ',')} porcji` : '1 porcja'}</span></div>
                <div className="l-note">{b.thaw_evening ? `do lodówki wieczorem ${dayMonth(b.thaw_evening)}` : b.eat_by ? `zjedz do ${dayMonth(b.eat_by)}` : ''}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      {data.evening.length > 0 && (
        <section className="section">
          <div className="kicker">Wieczór przed</div>
          <div className="stack" style={{ gap: 8 }}>
            {data.evening.map((e, i) => <div key={i} className="card" style={{ padding: '10px 14px' }}><b>{weekday(e.date)}, {dayMonth(e.date)}</b> – przygotuj na noc: <a href={href(`/przepisy/${e.recipe_id}`)}>{e.name}</a></div>)}
          </div>
        </section>
      )}

      {data.fresh.length > 0 && (
        <section className="section">
          <div className="kicker">Na świeżo, w dniu jedzenia</div>
          <div className="chips">
            {data.fresh.map((f, i) => <a key={i} className="chip" style={{ textDecoration: 'none' }} href={href(`/przepisy/${f.recipe_id}`)}>{weekdayShort(f.date)} {dayNum(f.date)} · {f.name}</a>)}
          </div>
        </section>
      )}
    </>
  );
}
