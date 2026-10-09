import { useEffect, useMemo, useState } from 'react';
import { api, useApi, useMeta, type Plan, type PlanListItem, type PlanMeal, type Profile, type ShoppingList } from '../api.ts';
import { DIETS, SLOT_NAME, SLOT_ORDER, addDays, dayMonth, dayNum, n, plural, todayIso, weekday, weekdayShort } from '../format.ts';
import { go, href } from '../router.tsx';
import { Chip, ErrorBox, Icon, Loading, Sheet, useToast } from '../components/ui.tsx';
import { MealTicket, SwapSheet } from '../components/meals.tsx';
import { KcalRuler, MacroBars } from './Today.tsx';

// ------------------------------------------------------------------ lista
export function PlansList() {
  const { data, error, loading } = useApi<{ user: PlanListItem[]; templates: PlanListItem[] }>('/plans');
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading />;
  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Jadłospisy</div>
          <h1 style={{ marginTop: 10 }}>Plan na <em>cały tydzień</em>.</h1>
          <p className="lede">Ułóż własny z bazy przepisów albo weź gotowy z dietetycznych PDF-ów i dopasuj kalorie.</p>
        </div>
        <a className="btn tomato" href={href('/jadlospis/nowy')}><Icon.plus />Ułóż jadłospis</a>
      </header>

      {data.user.length > 0 && (
        <section className="section">
          <div className="kicker">Twoje</div>
          <div className="grid-2">
            {data.user.map((p) => (
              <a key={p.id} className="card pad" href={href(`/jadlospis/${p.id}`)} style={{ textDecoration: 'none' }}>
                <h3>{p.name}</h3>
                <p className="muted mono" style={{ fontSize: 13, margin: '8px 0 0' }}>
                  {p.start_date && `${dayMonth(p.start_date)} – ${p.end_date ? dayMonth(p.end_date) : ''}`} · {p.days} {plural(p.days, 'dzień', 'dni', 'dni')} · {n(p.target_kcal, 0)} kcal
                </p>
                {p.source_note && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>{p.source_note}</p>}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="kicker">Gotowe jadłospisy z PDF · {data.templates.length}</div>
        <div className="grid-2">
          {data.templates.map((p) => (
            <div key={p.id} className="card pad" style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 18 }}>{p.name.replace(/ – .*/, '')}</h3>
                <span className="chip tiny">{p.days} dni</span>
              </div>
              <div className="muted mono" style={{ fontSize: 12.5 }}>~{n(p.target_kcal, 0)} kcal · {p.source_file}</div>
              <div className="row">
                <a className="btn small" href={href(`/jadlospis/nowy?template=${p.id}`)}>Użyj</a>
                <a className="btn small ghost" href={href(`/jadlospis/${p.id}`)}>Podgląd</a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ kreator
export function PlanWizard({ templateId }: { templateId?: string | null }) {
  const meta = useMeta();
  const toast = useToast();
  const profile = useApi<Profile>('/settings');
  const templates = useApi<{ templates: PlanListItem[] }>('/plans');
  const [mode, setMode] = useState<'auto' | 'template'>(templateId ? 'template' : 'auto');
  const [tpl, setTpl] = useState(templateId ?? '');
  const [start, setStart] = useState(todayIso());
  const [days, setDays] = useState(7);
  const [kcal, setKcal] = useState(2200);
  const [people, setPeople] = useState(1);
  const [slots, setSlots] = useState<string[]>(SLOT_ORDER);
  const [diet, setDiet] = useState<string | null>(null);
  const [exclude, setExclude] = useState<string[]>([]);
  const [mealPrep, setMealPrep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data) return;
    setKcal(profile.data.target_kcal); setPeople(profile.data.people); setDiet(profile.data.diet); setExclude(profile.data.excluded_allergens);
  }, [profile.data]);
  useEffect(() => { if (!tpl && templates.data?.templates[0]) setTpl(templates.data.templates[0].id); }, [templates.data, tpl]);
  const tplInfo = templates.data?.templates.find((t) => t.id === tpl);
  useEffect(() => { if (mode === 'template' && tplInfo) setDays(tplInfo.days); }, [mode, tplInfo]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const plan = await api<Plan>('/plans', {
        body: mode === 'template'
          ? { mode, template_id: tpl, start_date: start, days, target_kcal: kcal, people }
          : { mode, start_date: start, days, target_kcal: kcal, people, slots, diet, exclude_allergens: exclude, meal_prep: mealPrep },
      });
      toast('Jadłospis gotowy.');
      go(`/jadlospis/${plan.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <>
      <header className="page-head">
        <div>
          <a className="btn link" href={href('/jadlospis')}><Icon.back />Jadłospisy</a>
          <h1 style={{ marginTop: 10 }}>Ułóż <em>jadłospis</em>.</h1>
        </div>
      </header>
      <div className="two-col">
        <div className="stack" style={{ gap: 22 }}>
          <div className="tabs">
            <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>Ułóż automatycznie</button>
            <button className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')}>Z gotowego PDF</button>
          </div>

          {mode === 'template' && (
            <label className="field"><span>Szablon</span>
              <select className="select" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}

          <div className="grid-2">
            <label className="field"><span>Od kiedy</span><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="field"><span>Dla ilu osób</span><input type="number" min={1} max={12} className="input" value={people} onChange={(e) => setPeople(+e.target.value)} /></label>
          </div>

          <div className="field"><span>Na ile dni</span>
            <div className="chips">
              {[3, 5, 7, 10, 14].filter((d) => mode === 'auto' || !tplInfo || d <= tplInfo.days).map((d) => <Chip key={d} on={days === d} onClick={() => setDays(d)}>{d} dni</Chip>)}
            </div>
          </div>

          <div className="field"><span>Kalorie na dzień · <b className="num">{kcal} kcal</b></span>
            <input type="range" min={1200} max={3500} step={50} value={kcal} onChange={(e) => setKcal(+e.target.value)} style={{ accentColor: 'var(--tomato)' }} />
            {mode === 'template' && tplInfo && <small className="muted">Szablon ma ~{n(tplInfo.target_kcal, 0)} kcal – porcje przeskalujemy.</small>}
          </div>

          {mode === 'auto' && (
            <>
              <div className="field"><span>Posiłki w ciągu dnia</span>
                <div className="chips">{SLOT_ORDER.map((s) => <Chip key={s} on={slots.includes(s)} onClick={() => setSlots(toggle(slots, s))}>{SLOT_NAME[s]}</Chip>)}</div>
              </div>
              <div className="field"><span>Dieta</span>
                <div className="chips">
                  <Chip on={!diet} onClick={() => setDiet(null)}>wszystko jem</Chip>
                  {DIETS.slice(0, 3).map((d) => <Chip key={d} on={diet === d} onClick={() => setDiet(d)}>{d}</Chip>)}
                </div>
              </div>
              <div className="field"><span>Bez alergenów</span>
                <div className="chips">{meta?.allergens.map((a) => <Chip key={a.id} on={exclude.includes(a.id)} onClick={() => setExclude(toggle(exclude, a.id))}>{a.name}</Chip>)}</div>
              </div>
              <label className="toggle"><input type="checkbox" checked={mealPrep} onChange={(e) => setMealPrep(e.target.checked)} />
                Gotuj na zapas – dania na 2+ porcje wracają następnego dnia jako resztki
              </label>
            </>
          )}
          {err && <ErrorBox error={err} />}
        </div>

        <aside className="card pad sticky-side">
          <div className="kicker">Podsumowanie</div>
          <p style={{ margin: '12px 0 4px', fontFamily: 'var(--display)', fontSize: 22, lineHeight: 1.2 }}>
            {days} {plural(days, 'dzień', 'dni', 'dni')} od {weekday(start)}, {dayMonth(start)}
          </p>
          <p className="muted" style={{ margin: 0 }}>do {dayMonth(addDays(start, days - 1))} · {kcal} kcal · {people} {plural(people, 'osoba', 'osoby', 'osób')}</p>
          <hr className="hr" />
          <button className="btn tomato" style={{ width: '100%' }} onClick={submit} disabled={busy || (mode === 'auto' && !slots.length)}>
            {busy ? <span className="spinner" /> : <Icon.pot />}{mode === 'auto' ? 'Ułóż jadłospis' : 'Skopiuj szablon'}
          </button>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Każdy posiłek możesz potem podmienić jednym kliknięciem.</p>
        </aside>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ szczegóły
export function PlanDetail({ id }: { id: string }) {
  const { data: plan, error, loading, setData } = useApi<Plan>(`/plans/${id}`);
  const toast = useToast();
  const [dayIdx, setDayIdx] = useState(0);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [swap, setSwap] = useState<PlanMeal | null>(null);
  const [shop, setShop] = useState(false);

  useEffect(() => {
    if (!plan) return;
    const i = plan.days.findIndex((d) => d.date === todayIso());
    if (i >= 0) setDayIdx(i);
  }, [plan?.id]);

  const avg = useMemo(() => plan ? Math.round(plan.days.reduce((a, d) => a + d.totals.kcal, 0) / plan.days.length) : 0, [plan]);
  if (error) return <ErrorBox error={error} />;
  if (loading || !plan) return <Loading />;
  const day = plan.days[dayIdx];
  const isTpl = plan.type === 'template';

  const remove = async () => {
    if (!confirm('Usunąć ten jadłospis? Listy zakupów zostaną.')) return;
    await api(`/plans/${plan.id}`, { method: 'DELETE' });
    toast('Usunięto jadłospis.');
    go('/jadlospis');
  };

  return (
    <>
      <header className="page-head">
        <div>
          <a className="btn link" href={href('/jadlospis')}><Icon.back />Jadłospisy</a>
          <h1 style={{ marginTop: 10, fontSize: 'clamp(28px, 5vw, 42px)' }}>{plan.name}</h1>
          <p className="lede mono" style={{ fontSize: 13 }}>
            cel {n(plan.target_kcal, 0)} kcal · średnio {n(avg, 0)} kcal · {plan.days.length} dni{plan.people > 1 ? ` · ${plan.people} os.` : ''}
            {plan.source_note ? ` · ${plan.source_note}` : ''}
          </p>
        </div>
        <div className="row">
          {isTpl
            ? <a className="btn tomato" href={href(`/jadlospis/nowy?template=${plan.id}`)}>Użyj tego planu</a>
            : <button className="btn tomato" onClick={() => setShop(true)}><Icon.cart />Lista zakupów</button>}
          <div className="tabs">
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Dzień</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Tydzień</button>
          </div>
        </div>
      </header>

      {view === 'week' && (
        <div className="week">
          <table>
            <thead><tr><th />{SLOT_ORDER.map((s) => <th key={s}>{SLOT_NAME[s]}</th>)}<th>kcal</th></tr></thead>
            <tbody>
              {plan.days.map((d, i) => (
                <tr key={d.id}>
                  <th style={{ whiteSpace: 'nowrap' }}>{d.date ? `${weekdayShort(d.date)} ${dayNum(d.date)}` : `Dzień ${d.day_number}`}</th>
                  {SLOT_ORDER.map((s) => {
                    const m = d.meals.find((x) => x.slot === s);
                    return (
                      <td key={s} className={m?.leftover_from_day ? 'lo' : ''} onClick={() => m && (isTpl ? go(`/przepisy/${m.recipe.id}`) : setSwap(m))}
                        title={isTpl ? 'Otwórz przepis' : 'Kliknij, żeby podmienić'}>
                        {m ? <>{m.recipe.name}<small>{Math.round(m.recipe.kcal * m.portions)} kcal{m.leftover_from_day ? ' · resztki' : ''}</small></> : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                  <td className="num" onClick={() => { setDayIdx(i); setView('day'); }}>{d.totals.kcal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'day' && (
        <>
          <div className="days">
            {plan.days.map((d, i) => (
              <button key={d.id} className={`day-pill ${i === dayIdx ? 'on' : ''} ${d.date === todayIso() ? 'today' : ''}`} onClick={() => setDayIdx(i)}>
                <span className="d">{d.date ? weekdayShort(d.date) : 'dzień'}</span>
                <span className="n">{d.date ? dayNum(d.date) : d.day_number}</span>
              </button>
            ))}
          </div>
          <section className="card pad" style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{day.date ? `${weekday(day.date)}, ${dayMonth(day.date)}` : `Dzień ${day.day_number}`}</h3>
              <span className="kcal">{day.totals.kcal} <small>kcal</small></span>
            </div>
            <KcalRuler planned={day.totals.kcal} eaten={day.totals.eaten_kcal} target={plan.target_kcal} />
            <div style={{ marginTop: 14 }}><MacroBars day={day} target={plan.target_kcal} /></div>
            {day.micros && (
              <p className="muted mono" style={{ fontSize: 12.5, margin: '12px 0 0' }}>
                z PDF: błonnik {day.micros.fiber_g} g · wapń {day.micros.calcium_mg} mg · magnez {day.micros.magnesium_mg} mg
              </p>
            )}
          </section>
          <div className="stack" style={{ marginTop: 16 }}>
            {day.meals.map((m, i) => isTpl
              ? <a key={m.id} className="rcard" href={href(`/przepisy/${m.recipe.id}`)} style={{ gridTemplateColumns: '1fr auto' }}>
                  <div><div className="kicker">{SLOT_NAME[m.slot]}</div><h3 style={{ marginTop: 6 }}>{m.recipe.name}</h3></div>
                  <span className="kcal">{Math.round(m.recipe.kcal)} <small>kcal</small></span>
                </a>
              : <MealTicket key={m.id} meal={m} index={i} onChange={setData} onSwap={setSwap} />)}
          </div>
        </>
      )}

      {!isTpl && <div style={{ marginTop: 40 }}><button className="btn link" onClick={remove}><Icon.trash />Usuń jadłospis</button></div>}
      {swap && <SwapSheet meal={swap} onClose={() => setSwap(null)} onSwapped={setData} />}
      {shop && <ShoppingSheet plan={plan} onClose={() => setShop(false)} />}
    </>
  );
}

function ShoppingSheet({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(plan.days.length, 7));
  const [expand, setExpand] = useState(true);
  const [busy, setBusy] = useState(false);
  const label = (d: number) => {
    const day = plan.days[d - 1];
    return day?.date ? `${weekdayShort(day.date)} ${dayNum(day.date)}` : `dzień ${d}`;
  };
  const create = async () => {
    setBusy(true);
    const list = await api<ShoppingList>(`/plans/${plan.id}/shopping-list`, { body: { day_from: from, day_to: to, expand_base: expand } });
    go(`/zakupy/${list.id}`);
  };
  return (
    <Sheet onClose={onClose} kicker="Lista zakupów" title="Na które dni robisz zakupy?">
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>Od</span>
            <select className="select" value={from} onChange={(e) => { setFrom(+e.target.value); if (+e.target.value > to) setTo(+e.target.value); }}>
              {plan.days.map((d) => <option key={d.id} value={d.day_number}>{label(d.day_number)}</option>)}
            </select>
          </label>
          <label className="field"><span>Do</span>
            <select className="select" value={to} onChange={(e) => setTo(+e.target.value)}>
              {plan.days.filter((d) => d.day_number >= from).map((d) => <option key={d.id} value={d.day_number}>{label(d.day_number)}</option>)}
            </select>
          </label>
        </div>
        <label className="toggle"><input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
          Rozpisz półprodukty (np. ciasto naleśnikowe) na mąkę, mleko i jajka
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Sumujemy składniki ze wszystkich posiłków{plan.people > 1 ? ` × ${plan.people} osoby` : ''}, resztek nie liczymy drugi raz,
          a produkty grupujemy w kolejności alejek w sklepie.
        </p>
        <button className="btn tomato" onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : <Icon.cart />}Zrób listę</button>
      </div>
    </Sheet>
  );
}
