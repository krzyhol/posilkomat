import { useEffect, useMemo, useState } from 'react';
import { api, useApi, type Plan, type PlanMeal, type PlanListItem, type SwapResult, type Slot } from '../api.ts';
import { SLOT_NAME, SLOT_ORDER, n, plural, weekdayShort, dayNum } from '../format.ts';
import { href, go } from '../router.tsx';
import { Chip, ErrorBox, Icon, Loading, Macros, Plate, Sheet, useToast } from './ui.tsx';

/** Bilecik posiłku w jadłospisie */
export function MealTicket({ meal, index, onChange, onSwap }: {
  meal: PlanMeal; index: number; onChange: (plan: Plan) => void; onSwap: (meal: PlanMeal) => void;
}) {
  const toast = useToast();
  const r = meal.recipe;
  const setStatus = async (status: PlanMeal['status']) => {
    const plan = await api<Plan>(`/plan-meals/${meal.id}`, { method: 'PATCH', body: { status } });
    onChange(plan);
    if (status === 'eaten') toast('Smacznego! Odhaczone.');
  };
  return (
    <article className={`ticket ${meal.status}`}>
      <div className="stub">
        <span className="nr">{String(index + 1).padStart(2, '0')}</span>
        <span className="slot">{SLOT_NAME[meal.slot]}</span>
        <span className="time">{meal.time_from ? `${meal.time_from}–${meal.time_to}` : 'kiedy chcesz'}</span>
      </div>
      <div className="body">
        {meal.status === 'eaten' && <span className="stamp">ZJEDZONE</span>}
        <div className="row" style={{ alignItems: 'start', flexWrap: 'nowrap' }}>
          <Plate p={r.protein_g * meal.portions} c={r.carbs_g * meal.portions} f={r.fat_g * meal.portions} kcal={r.kcal * meal.portions} size={52} />
          <div style={{ minWidth: 0 }}>
            <a className="name" href={href(`/przepisy/${r.id}`)}>{r.name}</a>
            <div style={{ marginTop: 6 }}><Macros p={r.protein_g} c={r.carbs_g} f={r.fat_g} scale={meal.portions} /></div>
          </div>
        </div>
        <div className="chips">
          {meal.portions !== 1 && <span className="chip tiny warn">×{n(meal.portions)} porcji</span>}
          {meal.leftover_from_day && <span className="chip tiny good">z resztek · dzień {meal.leftover_from_day}</span>}
          {meal.leftovers > 0 && <span className="chip tiny good">gotujesz na zapas · +{meal.leftovers} {plural(meal.leftovers, 'dzień', 'dni', 'dni')}</span>}
          {meal.swapped_from_recipe_id && <span className="chip tiny">podmienione</span>}
          {r.tags.features.includes('bez-gotowania') && <span className="chip tiny">bez gotowania</span>}
          {r.tags.features.includes('lunchbox') && <span className="chip tiny">lunchbox</span>}
        </div>
        <div className="actions">
          {meal.status === 'eaten'
            ? <button className="btn small ghost" onClick={() => setStatus('planned')}>Cofnij</button>
            : <button className="btn small" onClick={() => setStatus('eaten')}><Icon.check />Zjedzone</button>}
          <button className="btn small ghost" onClick={() => onSwap(meal)}><Icon.swap />Podmień</button>
          {meal.status !== 'skipped'
            ? <button className="btn link small" onClick={() => setStatus('skipped')}>Pomiń</button>
            : <button className="btn link small" onClick={() => setStatus('planned')}>Przywróć</button>}
        </div>
      </div>
    </article>
  );
}

/** Arkusz podmiany: ranking zamienników z powodami + losowanie */
export function SwapSheet({ meal, onClose, onSwapped }: { meal: PlanMeal; onClose: () => void; onSwapped: (plan: Plan) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [flavor, setFlavor] = useState<string>('');
  const [feature, setFeature] = useState<string>('');
  const [anySlot, setAnySlot] = useState(false);
  const [rolling, setRolling] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const params = new URLSearchParams({ limit: '30', ...(debounced && { q: debounced }), ...(flavor && { flavor }), ...(feature && { feature }), ...(anySlot && { any_slot: '1' }) });
  const { data, error, loading } = useApi<SwapResult>(`/plan-meals/${meal.id}/swap?${params}`);

  const pick = async (recipeId: string, portions: number) => {
    const plan = await api<Plan>(`/plan-meals/${meal.id}`, { method: 'PATCH', body: { recipe_id: recipeId, portions } });
    onSwapped(plan);
    toast('Podmienione.');
    onClose();
  };

  // „Wylosuj”: krótka animacja przeskakiwania po najlepszych propozycjach, potem wybór
  const roll = () => {
    const top = data?.items.slice(0, 8) ?? [];
    if (!top.length) return;
    const target = Math.floor(Math.random() * top.length);
    let i = 0, steps = 10 + target;
    const tick = () => {
      setRolling(i % top.length);
      if (i++ < steps) setTimeout(tick, 60 + i * 8);
      else setTimeout(() => setRolling(null), 500);
    };
    tick();
  };

  return (
    <Sheet onClose={onClose} kicker={`${SLOT_NAME[meal.slot]} · zamiast`} title={meal.recipe.name}>
      <p className="muted" style={{ marginTop: -6 }}>
        Szukam dań o podobnej kaloryczności (<span className="num">{Math.round(meal.recipe.kcal * meal.portions)} kcal</span>).
        Wyżej są te, które pasują smakiem i korzystają z produktów, które i tak kupujesz.
      </p>
      <div className="stack" style={{ margin: '14px 0' }}>
        <div className="search"><Icon.search /><input className="input" placeholder="Na co masz ochotę? np. kurczak, owsianka…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <div className="chips">
          <Chip on={flavor === 'słodki'} onClick={() => setFlavor(flavor === 'słodki' ? '' : 'słodki')}>na słodko</Chip>
          <Chip on={flavor === 'wytrawny'} onClick={() => setFlavor(flavor === 'wytrawny' ? '' : 'wytrawny')}>wytrawnie</Chip>
          <Chip on={feature === 'bez-gotowania'} onClick={() => setFeature(feature ? '' : 'bez-gotowania')}>bez gotowania</Chip>
          <Chip on={anySlot} onClick={() => setAnySlot(!anySlot)}>z każdej pory dnia</Chip>
          <button className="btn small tomato" onClick={roll} disabled={!data?.items.length || rolling !== null}><Icon.dice />Wylosuj</button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && !data.items.length && <div className="empty"><h3>Nic nie pasuje</h3>Poluzuj filtry albo szukaj w innych porach dnia.</div>}
      <div>
        {data?.items.map((c, i) => (
          <button key={c.id} className={`cand ${rolling === i ? 'rolling' : ''}`} style={rolling === i ? { background: 'var(--card)', borderColor: 'var(--tomato)' } : undefined}
            onClick={() => pick(c.id, c.portions)}>
            <Plate p={c.protein_g} c={c.carbs_g} f={c.fat_g} kcal={c.kcal_total} size={48} />
            <div>
              <h4>{c.name}</h4>
              <div className="chips" style={{ gap: 5 }}>
                {c.reasons.map((r, k) => <span key={k} className={`chip tiny ${r.good ? 'good' : 'bad'}`}>{r.text}</span>)}
              </div>
            </div>
            <span className="muted" aria-hidden><Icon.swap /></span>
          </button>
        ))}
      </div>
      {rolling === null && data && data.items.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Kliknij danie, żeby podmienić. Kaloryczność dopasujemy porcją.</p>
      )}
    </Sheet>
  );
}

/** „Dodaj do jadłospisu” z karty przepisu */
export function AddToPlanSheet({ recipeId, recipeName, slots, onClose }: { recipeId: string; recipeName: string; slots: Slot[]; onClose: () => void }) {
  const toast = useToast();
  const plans = useApi<{ user: PlanListItem[] }>('/plans');
  const [planId, setPlanId] = useState<string>('');
  const plan = useApi<Plan>(planId ? `/plans/${planId}` : null);
  const [dayId, setDayId] = useState<number | null>(null);
  const [slot, setSlot] = useState<Slot>(slots[0] ?? 'lunch');
  useEffect(() => { if (!planId && plans.data?.user[0]) setPlanId(plans.data.user[0].id); }, [plans.data, planId]);
  useEffect(() => { if (plan.data && !dayId) setDayId(plan.data.days[0]?.id ?? null); }, [plan.data, dayId]);
  const day = useMemo(() => plan.data?.days.find((d) => d.id === dayId), [plan.data, dayId]);
  const existing = day?.meals.find((m) => m.slot === slot);

  const save = async (mode: 'replace' | 'add') => {
    if (!dayId) return;
    if (mode === 'replace' && existing) await api(`/plan-meals/${existing.id}`, { method: 'PATCH', body: { recipe_id: recipeId } });
    else await api(`/plan-days/${dayId}/meals`, { body: { slot, recipe_id: recipeId } });
    toast(`„${recipeName}” w jadłospisie.`);
    onClose();
  };

  return (
    <Sheet onClose={onClose} kicker="Dodaj do jadłospisu" title={recipeName}>
      {plans.loading && <Loading />}
      {plans.data && !plans.data.user.length && (
        <div className="empty"><h3>Nie masz jeszcze jadłospisu</h3><p>Najpierw ułóż jadłospis.</p><button className="btn" onClick={() => go('/jadlospis/nowy')}>Ułóż jadłospis</button></div>
      )}
      {plans.data && plans.data.user.length > 0 && (
        <div className="stack">
          <label className="field"><span>Jadłospis</span>
            <select className="select" value={planId} onChange={(e) => { setPlanId(e.target.value); setDayId(null); }}>
              {plans.data.user.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {plan.data && (
            <div className="field"><span>Dzień</span>
              <div className="days" style={{ margin: 0, padding: 0 }}>
                {plan.data.days.map((d) => (
                  <button key={d.id} className={`day-pill ${d.id === dayId ? 'on' : ''}`} onClick={() => setDayId(d.id)}>
                    <span className="d">{d.date ? weekdayShort(d.date) : `D${d.day_number}`}</span><span className="n">{d.date ? dayNum(d.date) : d.day_number}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field"><span>Pora</span>
            <div className="chips">{SLOT_ORDER.map((s) => <Chip key={s} on={slot === s} onClick={() => setSlot(s)}>{SLOT_NAME[s]}</Chip>)}</div>
          </div>
          {existing && <div className="note">W tej porze jest już: <b>{existing.recipe.name}</b>.</div>}
          <div className="row">
            {existing && <button className="btn" onClick={() => save('replace')}><Icon.swap />Zamień</button>}
            <button className={`btn ${existing ? 'ghost' : ''}`} onClick={() => save('add')}><Icon.plus />{existing ? 'Dodaj obok' : 'Dodaj'}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
