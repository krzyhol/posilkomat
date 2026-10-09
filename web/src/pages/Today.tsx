import { useState } from 'react';
import { api, useApi, type Plan, type PlanDay, type PlanMeal, type ExtraMeal } from '../api.ts';
import { dayMonth, n, todayIso, weekday } from '../format.ts';
import { href } from '../router.tsx';
import { ErrorBox, Icon, Loading } from '../components/ui.tsx';
import { ExtraMealSheet } from '../components/ExtraMeal.tsx';
import { MealTicket, SwapSheet } from '../components/meals.tsx';

type TodayRes = { date: string; plan: { id: string; name: string; target_kcal: number; people: number; days: number } | null; day: PlanDay | null; upcoming: { id: string; name: string; start: string } | null };

const GREETING = () => {
  const h = new Date().getHours();
  return h < 10 ? 'Dzień dobry' : h < 17 ? 'Smacznego dnia' : 'Dobry wieczór';
};

/** Linijka kalorii: zaplanowane (kreskowane), zjedzone (pomidor), cel (pionowa kreska) */
export function KcalRuler({ planned, eaten, target }: { planned: number; eaten: number; target: number }) {
  const max = Math.max(target * 1.2, planned, 500);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const ticks = [0, Math.round(max / 2 / 100) * 100, Math.round(max / 100) * 100];
  return (
    <div className="ruler" aria-label={`Zjedzone ${eaten} z ${target} kcal`}>
      <div className="track">
        <div className="plan" style={{ width: pct(planned) }} />
        <div className="eat" style={{ width: pct(eaten) }} />
      </div>
      <div className="target" style={{ left: pct(target) }} data-label={`cel ${target}`} />
      <div className="scale">{ticks.map((t) => <span key={t}>{t}</span>)}</div>
    </div>
  );
}

export function MacroBars({ day, target }: { day: PlanDay; target: number }) {
  // orientacyjne cele: 20% energii z białka, 50% z węglowodanów, 30% z tłuszczu
  const goals = { p: (target * 0.2) / 4, c: (target * 0.5) / 4, f: (target * 0.3) / 9 };
  const rows = [
    { label: 'Białko', v: day.totals.protein_g, g: goals.p, color: 'var(--p)' },
    { label: 'Węglowodany', v: day.totals.carbs_g, g: goals.c, color: 'var(--c)' },
    { label: 'Tłuszcze', v: day.totals.fat_g, g: goals.f, color: 'var(--f)' },
  ];
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.map((r) => (
        <div className="mbar" key={r.label}>
          <span>{r.label}</span>
          <div className="t"><div style={{ width: `${Math.min(100, (r.v / r.g) * 100)}%`, background: r.color }} /></div>
          <span className="v">{n(r.v, 0)} / {n(r.g, 0)} g</span>
        </div>
      ))}
    </div>
  );
}

const SOURCE: Record<ExtraMeal['source'], string> = { manual: 'wpisane', ai_text: 'z opisu · AI', ai_photo: 'ze zdjęcia · AI', barcode: 'z kodu kreskowego' };

/** Posiłki spoza planu + przycisk dodawania */
export function ExtrasSection({ day, onChanged }: { day: PlanDay; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="section">
      <div className="kicker">Poza planem</div>
      <div className="stack" style={{ gap: 8 }}>
        {(day.extras ?? []).map((e) => (
          <div key={e.id} className="card" style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center' }}>
            <div>
              <div>{e.name}</div>
              <small className="muted">{SOURCE[e.source]}{e.replaced_meal_id ? ' · zamiast posiłku z planu' : ''} · B {n(e.protein_g, 0)} W {n(e.carbs_g, 0)} T {n(e.fat_g, 0)}</small>
            </div>
            <span className="kcal">{n(e.kcal, 0)} <small>kcal</small></span>
            <button className="icon-btn" aria-label={`Usuń: ${e.name}`} onClick={async () => { await api(`/extras/${e.id}`, { method: 'DELETE' }); onChanged(); }}><Icon.x /></button>
          </div>
        ))}
        <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}><Icon.plus />Zjadłem coś spoza planu</button>
      </div>
      {open && day.date && <ExtraMealSheet date={day.date} meals={day.meals} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </section>
  );
}

export default function Today() {
  const { data, error, loading, setData, reload } = useApi<TodayRes>(`/today?date=${todayIso()}`);
  const [swap, setSwap] = useState<PlanMeal | null>(null);
  const onPlan = (plan: Plan) => {
    const day = plan.days.find((d) => d.date === data?.date) ?? null;
    if (data) setData({ ...data, day });
  };

  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading />;
  const date = data.date;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">{GREETING()} · {dayMonth(date)}</div>
          <h1 style={{ marginTop: 10 }}>Dziś jest <em>{weekday(date)}</em>.</h1>
          {data.plan
            ? <p className="lede">Jedziesz według: <a href={href(`/jadlospis/${data.plan.id}`)}>{data.plan.name}</a>.</p>
            : <p className="lede">Na dziś nie ma jeszcze jadłospisu.</p>}
        </div>
      </header>

      {!data.day && (
        <div className="empty">
          <h3>Co dziś jemy?</h3>
          <p>Ułóż jadłospis z ponad 860 przepisów albo zacznij od gotowego planu z PDF.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a className="btn tomato" href={href('/jadlospis/nowy')}>Ułóż jadłospis</a>
            <a className="btn ghost" href={href('/przepisy')}>Przeglądaj przepisy</a>
          </div>
          {data.upcoming && <p className="muted" style={{ marginTop: 16 }}>Najbliższy zaczyna się {dayMonth(data.upcoming.start)}: <a href={href(`/jadlospis/${data.upcoming.id}`)}>{data.upcoming.name}</a></p>}
        </div>
      )}

      {data.day && data.plan && (
        <>
          <section className="card pad">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="kcal" style={{ fontSize: 30, fontFamily: 'var(--display)', fontWeight: 560 }}>
                {n(data.day.totals.eaten_kcal, 0)} <small style={{ fontSize: 16 }}>/ {n(data.day.totals.kcal, 0)} kcal zjedzone</small>
              </div>
              <span className="muted mono" style={{ fontSize: 13 }}>
                zostało {n(Math.max(0, data.day.totals.kcal - data.day.totals.eaten_kcal), 0)} kcal
              </span>
            </div>
            <KcalRuler planned={data.day.totals.kcal} eaten={data.day.totals.eaten_kcal} target={data.plan.target_kcal} />
            <div style={{ marginTop: 16 }}><MacroBars day={data.day} target={data.plan.target_kcal} /></div>
          </section>

          <section className="section">
            <div className="kicker">Rozkład posiłków</div>
            <div className="stack">
              {data.day.meals.map((m, i) => <MealTicket key={m.id} meal={m} index={i} onChange={onPlan} onSwap={setSwap} />)}
            </div>
          </section>
          <ExtrasSection day={data.day} onChanged={reload} />
        </>
      )}
      {swap && <SwapSheet meal={swap} onClose={() => setSwap(null)} onSwapped={onPlan} />}
    </>
  );
}
