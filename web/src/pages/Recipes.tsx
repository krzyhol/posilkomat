import { useEffect, useMemo, useState } from 'react';
import { api, useApi, useMeta, STATIC, type Profile, type Recipe, type RecipeSummary, type Slot } from '../api.ts';
import { DIETS, SLOT_NAME, SLOT_ORDER, SOURCE_LABEL, n, plural, qtyLabel, unitLabel } from '../format.ts';
import { go, href } from '../router.tsx';
import { Chip, ErrorBox, Icon, Loading, Macros, Plate, useToast } from '../components/ui.tsx';
import { AddToPlanSheet } from '../components/meals.tsx';
import { IngredientSwapSheet, type SubOption } from '../components/IngredientSwap.tsx';

export function RecipeCard({ r }: { r: RecipeSummary }) {
  return (
    <a className="rcard" href={href(`/przepisy/${r.id}`)}>
      <Plate p={r.protein_g} c={r.carbs_g} f={r.fat_g} kcal={r.kcal} />
      <div style={{ minWidth: 0 }}>
        <h3>{r.name}</h3>
        <div className="meta">
          <span>{r.slots.map((s) => SLOT_NAME[s]).join(' · ')}</span>
          <span>B{n(r.protein_g, 0)} W{n(r.carbs_g, 0)} T{n(r.fat_g, 0)}</span>
          {r.servings > 1 && <span>{r.servings} porcje</span>}
          {r.is_favorite && <span style={{ color: 'var(--mustard)' }}>★</span>}
          {r.source_type !== 'pdf_import' && <span style={{ color: 'var(--plum)' }}>{SOURCE_LABEL[r.source_type]}</span>}
        </div>
      </div>
    </a>
  );
}

// ------------------------------------------------------------------ przeglądarka
export function RecipesList() {
  const meta = useMeta();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [slot, setSlot] = useState<Slot | ''>('');
  const [diet, setDiet] = useState('');
  const [flavor, setFlavor] = useState('');
  const [dish, setDish] = useState('');
  const [source, setSource] = useState('');
  const [fav, setFav] = useState(false);
  const [showDisliked, setShowDisliked] = useState(false);
  const [kcal, setKcal] = useState('');
  const [limit, setLimit] = useState(48);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setLimit(48), [dq, slot, diet, flavor, dish, source, fav, kcal, showDisliked]);
  const [kmin, kmax] = kcal ? kcal.split('-') : ['', ''];
  const params = new URLSearchParams(Object.entries({ q: dq, slot, diet, flavor, dish, source, favorite: fav ? '1' : '', hide_disliked: showDisliked ? '' : '1', kcal_min: kmin, kcal_max: kmax, limit: String(limit) }).filter(([, v]) => v) as [string, string][]);
  const { data, error } = useApi<{ total: number; items: RecipeSummary[] }>(`/recipes?${params}`);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Książka kucharska</div>
          <h1 style={{ marginTop: 10 }}>Przepisy, <em>z których</em> układasz dni.</h1>
        </div>
        <div className="row">
          {!STATIC && <a className="btn plum" href={href('/ai')}><Icon.spark />Wymyśl z AI</a>}
          <a className="btn ghost" href={href('/przepisy/nowy')}><Icon.plus />Dodaj własny</a>
        </div>
      </header>

      <div className="stack" style={{ marginBottom: 22 }}>
        <div className="search"><Icon.search /><input className="input" placeholder="Szukaj po nazwie lub składniku – „łosoś”, „owsianka z malinami”…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="chips">
          {SLOT_ORDER.map((s) => <Chip key={s} on={slot === s} onClick={() => setSlot(slot === s ? '' : s)}>{SLOT_NAME[s]}</Chip>)}
          <span style={{ width: 8 }} />
          <Chip on={flavor === 'słodki'} onClick={() => setFlavor(flavor === 'słodki' ? '' : 'słodki')}>słodkie</Chip>
          <Chip on={flavor === 'wytrawny'} onClick={() => setFlavor(flavor === 'wytrawny' ? '' : 'wytrawny')}>wytrawne</Chip>
          <Chip on={fav} onClick={() => setFav(!fav)}>★ ulubione</Chip>
          <Chip on={showDisliked} onClick={() => setShowDisliked(!showDisliked)}>pokaż też nielubiane</Chip>
        </div>
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={diet} onChange={(e) => setDiet(e.target.value)}>
            <option value="">każda dieta</option>{DIETS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={dish} onChange={(e) => setDish(e.target.value)}>
            <option value="">każde danie</option>{meta?.dish_types.map((d) => <option key={d.tag} value={d.tag}>{d.tag.replace(/-/g, ' ')} ({d.n})</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={kcal} onChange={(e) => setKcal(e.target.value)}>
            <option value="">każda kaloryczność</option><option value="0-250">do 250 kcal</option><option value="250-450">250–450 kcal</option>
            <option value="450-550">450–550 kcal</option><option value="550-5000">ponad 550 kcal</option>
          </select>
          <select className="select" style={{ width: 'auto' }} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">wszystkie źródła</option><option value="pdf">z jadłospisów PDF</option><option value="mine">moje i z AI</option>
          </select>
        </div>
      </div>

      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="muted mono" style={{ fontSize: 13 }}>{data.total} {plural(data.total, 'przepis', 'przepisy', 'przepisów')}</p>
          {data.items.length === 0
            ? <div className="empty"><h3>Nic nie znalazłem</h3><p>Spróbuj innego słowa{STATIC ? '.' : ' albo poproś AI o przepis.'}</p>{!STATIC && <a className="btn plum" href={href(`/ai?prompt=${encodeURIComponent(q)}`)}><Icon.spark />Wymyśl „{q || 'coś'}” z AI</a>}</div>
            : <div className="recipe-grid">{data.items.map((r) => <RecipeCard key={r.id} r={r} />)}</div>}
          {data.items.length < data.total && (
            <div style={{ textAlign: 'center', marginTop: 24 }}><button className="btn ghost" onClick={() => setLimit(limit + 48)}>Pokaż więcej</button></div>
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ karta przepisu
export function RecipeDetail({ id, mealId }: { id: string; mealId?: number | null }) {
  const meta = useMeta();
  const toast = useToast();
  const { data: r, error, loading, setData } = useApi<Recipe>(`/recipes/${id}`);
  const profile = useApi<Profile>('/settings');
  const [servings, setServings] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [swapPos, setSwapPos] = useState<number | null>(null);
  const [subs, setSubs] = useState<Map<number, SubOption>>(new Map());
  const [savingVariant, setSavingVariant] = useState(false);
  useEffect(() => { setServings(null); setDone(new Set()); setSubs(new Map()); }, [id]);

  const groups = useMemo(() => {
    const g: { name: string | null; items: Recipe['ingredients'] }[] = [];
    for (const i of r?.ingredients ?? []) {
      const last = g[g.length - 1];
      if (last && last.name === i.group_name) last.items.push(i); else g.push({ name: i.group_name, items: [i] });
    }
    return g;
  }, [r]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !r) return <Loading />;
  const s = servings ?? r.servings;
  const scale = s / r.servings;
  const check = r.nutrition_check;
  const diff = r.kcal ? Math.abs(check.kcal - r.kcal) / r.kcal : 0;

  const subKcal = [...subs.values()].reduce((a, o) => a + o.delta.kcal, 0);
  const saveVariant = async () => {
    setSavingVariant(true);
    try {
      const v = await api<Recipe>(`/recipes/${r.id}/variant`, {
        body: { replacements: [...subs].map(([position, o]) => ({ position, product_id: o.product_id, amount_g: o.amount_g })), plan_meal_id: mealId ?? undefined },
      });
      toast(mealId ? 'Wariant zapisany i podmieniony w jadłospisie.' : 'Wariant zapisany w Twoich przepisach.');
      go(`/przepisy/${v.id}`);
    } finally { setSavingVariant(false); }
  };

  const disliked = !!r && (profile.data?.disliked_recipes ?? []).includes(r.id);
  const dislike = async (body: { product_id?: string; recipe_id?: string; on: boolean }, msg: string) => {
    profile.setData(await api<Profile>('/dislikes', { body }));
    toast(msg);
  };

  const fav = async () => {
    const out = await api<Recipe>(`/recipes/${r.id}`, { method: 'PATCH', body: { is_favorite: !r.is_favorite } });
    setData(out);
    toast(out.is_favorite ? 'Dodano do ulubionych.' : 'Usunięto z ulubionych.');
  };
  const archive = async () => {
    if (!confirm('Usunąć ten przepis z książki? Zostanie w jadłospisach, w których już jest.')) return;
    await api(`/recipes/${r.id}`, { method: 'PATCH', body: { status: 'archived' } });
    toast('Przepis usunięty.');
    go('/przepisy');
  };

  return (
    <>
      <a className="btn link" href={href('/przepisy')}><Icon.back />Przepisy</a>
      <div className="hero" style={{ marginTop: 14 }}>
        <div>
          <div className="kicker">
            {r.kind === 'base' ? 'Przepis bazowy · półprodukt' : r.slots.map((x) => SLOT_NAME[x]).join(' · ')}
            {' · '}{SOURCE_LABEL[r.source.type]}{r.source.files[0] ? ` · ${r.source.files.join(', ')}` : ''}
          </div>
          <h1 style={{ marginTop: 12, fontSize: 'clamp(30px, 5.5vw, 48px)' }}>{r.name}</h1>
          {r.description && <p className="lede">{r.description}</p>}
          <div className="chips" style={{ marginTop: 16 }}>
            {[...r.tags.diet, ...r.tags.dish_type, ...r.tags.features, ...r.tags.custom].map((t) => <span key={t} className="chip tiny">{t.replace(/-/g, ' ')}</span>)}
            {r.allergens.map((a) => <span key={a} className="chip tiny bad">{meta?.allergens.find((x) => x.id === a)?.name ?? a}</span>)}
          </div>
          {r.kind === 'meal' && (
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn tomato" onClick={() => setAdding(true)}><Icon.plan />Do jadłospisu</button>
              <button className="btn ghost" onClick={fav} aria-pressed={r.is_favorite}><Icon.star on={r.is_favorite} />{r.is_favorite ? 'Ulubione' : 'Do ulubionych'}</button>
              {!STATIC && <a className="btn ghost" href={href(`/ai?base=${r.id}`)}><Icon.spark />Przerób z AI</a>}
              <button className="btn link small" onClick={() => dislike({ recipe_id: r.id, on: !disliked }, disliked ? 'Wraca do jadłospisów.' : 'Nie zobaczysz go w nowych jadłospisach.')}>
                {disliked ? 'Jednak lubię' : 'Nie lubię tego dania'}
              </button>
            </div>
          )}
        </div>
        <div className="card pad" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
          <Plate p={r.protein_g} c={r.carbs_g} f={r.fat_g} kcal={r.kcal} size={150} />
          <div className="kicker">na 1 porcję</div>
          <Macros p={r.protein_g} c={r.carbs_g} f={r.fat_g} />
        </div>
      </div>

      {r.kind === 'meal' && r.source.type === 'pdf_import' && diff > 0.15 && (
        <p className="note" style={{ marginTop: 20 }}>
          Policzone z produktów wychodzi {check.kcal} kcal ({n(check.protein_g, 0)}/{n(check.carbs_g, 0)}/{n(check.fat_g, 0)} g) – w PDF podano {Math.round(r.kcal)} kcal.
          Pokazujemy wartość z PDF.
        </p>
      )}

      <div className="two-col" style={{ marginTop: 32 }}>
        <section>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2>Przygotowanie</h2>
            <span className="muted mono" style={{ fontSize: 12.5 }}>dotknij kroku, żeby go odhaczyć</span>
          </div>
          <ol className="steps">
            {r.steps.map((st, i) => (
              <li key={st.position} className={done.has(i) ? 'done' : ''}
                onClick={() => setDone((d) => { const x = new Set(d); x.has(i) ? x.delete(i) : x.add(i); return x; })}>
                <div>
                  {st.section && (i === 0 || r.steps[i - 1].section !== st.section) && <div className="sec">{st.section}</div>}
                  <p>{st.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {r.used_in.length > 0 && (
            <div className="section">
              <div className="kicker">Używane w {r.used_in.length} {plural(r.used_in.length, 'przepisie', 'przepisach', 'przepisach')}</div>
              <div className="chips">{r.used_in.map((u) => <a key={u.id} className="chip" href={href(`/przepisy/${u.id}`)} style={{ textDecoration: 'none' }}>{u.name}</a>)}</div>
            </div>
          )}
          {r.variants.length > 0 && <p className="muted" style={{ marginTop: 20 }}>Inna wersja: {r.variants.map((v) => <a key={v.id} href={href(`/przepisy/${v.id}`)}>{v.name}</a>)}</p>}
          {r.source.prompt && <p className="note" style={{ marginTop: 20 }}>Prośba do AI: „{r.source.prompt}”{r.source.model ? ` · ${r.source.model}` : ''}</p>}
          {r.source.type !== 'pdf_import' && r.kind === 'meal' && <div style={{ marginTop: 28 }}><button className="btn link" onClick={archive}><Icon.trash />Usuń przepis</button></div>}
        </section>

        <aside className="card pad sticky-side">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Składniki</h3>
            <div className="stepper" aria-label="Liczba porcji">
              <button onClick={() => setServings(Math.max(1, s - 1))} aria-label="Mniej porcji">−</button>
              <span>{s} {plural(s, 'porcja', 'porcje', 'porcji')}</span>
              <button onClick={() => setServings(Math.min(12, s + 1))} aria-label="Więcej porcji">+</button>
            </div>
          </div>
          {r.yield && <p className="muted" style={{ fontSize: 13 }}>Wychodzi ok. {Math.round(r.yield.amount_g * scale)} g · {Math.round(r.yield.pieces * scale)} {meta ? unitLabel(r.yield.piece_unit, Math.round(r.yield.pieces * scale), meta.units) : ''}</p>}
          <ul className="ing">
            {groups.map((g, gi) => (
              <li key={gi} style={{ display: 'block', border: 0, padding: 0 }}>
                {g.name && <div className="group">{g.name}</div>}
                <ul className="ing">
                  {g.items.map((i) => {
                    const sub = subs.get(i.position);
                    return (
                      <li key={i.position}>
                        <span>
                          {sub ? <><s className="muted">{i.name}</s> <b style={{ color: 'var(--dill)' }}>{sub.name}</b></> : i.name}
                          {i.base_recipe_id && <> · <a href={href(`/przepisy/${i.base_recipe_id}`)} style={{ fontSize: 13 }}>przepis bazowy</a></>}
                        </span>
                        <span className="lead" />
                        <span className="q">
                          {sub ? `${n(sub.amount_g * scale, 0)} g` : i.amount_g == null ? 'do smaku' : `${n(i.amount_g * scale, i.amount_g * scale < 10 ? 2 : 0)} g`}
                          {!sub && i.household_qty && i.household_unit && meta && (
                            <small>{qtyLabel(i.household_qty * scale)} {unitLabel(i.household_unit, i.household_qty * scale, meta.units)}</small>
                          )}
                        </span>
                        {r.kind === 'meal' && i.amount_g != null && !i.pantry_staple && i.category_id !== 'przyprawy' && (
                          sub
                            ? <button className="icon-btn" style={{ padding: 2 }} onClick={() => setSubs((m) => { const x = new Map(m); x.delete(i.position); return x; })} aria-label={`Cofnij podmianę: ${i.name}`}><Icon.x /></button>
                            : <button className="icon-btn" style={{ padding: 2 }} onClick={() => setSwapPos(i.position)} aria-label={`Podmień składnik: ${i.name}`} title="Podmień składnik"><Icon.swap /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {subs.size > 0 && (
            <div className="note" style={{ marginTop: 14 }}>
              <div><b>{subs.size} {plural(subs.size, 'podmiana', 'podmiany', 'podmian')}</b> · {Math.round(r.kcal + subKcal)} kcal na porcję ({subKcal >= 0 ? '+' : '−'}{Math.abs(subKcal)})</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small tomato" onClick={saveVariant} disabled={savingVariant}>
                  {savingVariant ? <span className="spinner" /> : <Icon.check />}{mealId ? 'Zapisz i podmień w jadłospisie' : 'Zapisz jako mój wariant'}
                </button>
                <button className="btn small link" onClick={() => setSubs(new Map())}>Cofnij wszystko</button>
              </div>
            </div>
          )}
        </aside>
      </div>
      {swapPos !== null && (
        <IngredientSwapSheet recipeId={r.id} position={swapPos} onClose={() => setSwapPos(null)}
          onPick={(o) => setSubs((m) => new Map(m).set(swapPos, o))}
          onDislike={(pid, name) => dislike({ product_id: pid, on: true }, `${name} – omijamy w nowych jadłospisach.`)} />
      )}
      {adding && <AddToPlanSheet recipeId={r.id} recipeName={r.name} slots={r.slots} onClose={() => setAdding(false)} />}
    </>
  );
}
