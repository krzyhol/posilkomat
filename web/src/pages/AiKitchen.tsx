import { useState } from 'react';
import { api, useApi, useMeta, type Product, type Recipe, type Slot } from '../api.ts';
import { SLOT_NAME, SLOT_ORDER, n } from '../format.ts';
import { go, href } from '../router.tsx';
import { Chip, ErrorBox, Icon, Macros, Plate, useToast } from '../components/ui.tsx';
import { ProductPicker } from '../components/ProductPicker.tsx';

type DraftIng = {
  name: string; amount_g: number; household_qty: number | null; household_unit: string | null; group: string | null;
  new_product: { category: string; per_100g: { kcal: number } } | null;
  match: { id: string; name: string; kcal: number } | null; confidence: 'exact' | 'close' | 'none'; product_id?: string | null;
};
type DraftRes = {
  draft: {
    name: string; description: string; meal_slots: Slot[]; servings: number; prep_time_min: number; steps: string[]; tags: string[];
    ingredients: DraftIng[]; estimated_nutrition_per_serving: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  };
  nutrition_calc: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  prompt: string | null; based_on_recipe_id: string | null; model: string;
};

const IDEAS = [
  'Wysokobiałkowe śniadanie na słodko, bez gotowania',
  'Obiad do pudełka do pracy, który dobrze znosi odgrzewanie',
  'Coś z ciecierzycą i szpinakiem, ok. 20 minut',
  'Lekka kolacja na ciepło po treningu',
  'Przekąska, która zaspokoi ochotę na czekoladę',
];

export default function AiKitchen({ baseId, initialPrompt, initialPantry }: { baseId?: string | null; initialPrompt?: string | null; initialPantry?: string | null }) {
  const meta = useMeta();
  const toast = useToast();
  const base = useApi<Recipe>(baseId ? `/recipes/${baseId}` : null);
  const [prompt, setPrompt] = useState(initialPrompt ?? (initialPantry ? 'Coś z tego, co mam w domu – jak najmniej dokupowania' : ''));
  const [slot, setSlot] = useState<Slot | ''>('');
  const [kcal, setKcal] = useState('');
  const [servings, setServings] = useState(1);
  const [pantry, setPantry] = useState(initialPantry ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<DraftRes | null>(null);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      setRes(await api<DraftRes>('/ai/draft', {
        body: {
          prompt, slot: slot || undefined, target_kcal: kcal ? Number(kcal) : undefined,
          servings: baseId ? undefined : servings, pantry: pantry || undefined, base_recipe_id: baseId ?? undefined,
        },
      }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const setMatch = (i: number, p: Product) => setRes((r) => r && ({
    ...r, draft: { ...r.draft, ingredients: r.draft.ingredients.map((x, j) => (j === i ? { ...x, product_id: p.id, match: { id: p.id, name: p.name, kcal: p.kcal }, confidence: 'exact' } : x)) },
  }));

  const save = async () => {
    if (!res) return;
    setSaving(true); setErr(null);
    try {
      const recipe = await api<Recipe>('/ai/save', { body: { draft: res.draft, prompt: res.prompt, based_on_recipe_id: res.based_on_recipe_id, model: res.model } });
      toast('Przepis w książce kucharskiej.');
      go(`/przepisy/${recipe.id}`);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  const d = res?.draft;
  const newCount = d?.ingredients.filter((i) => !i.match).length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Kuchnia AI · Claude</div>
          <h1 style={{ marginTop: 10 }}>{base.data ? <>Przerób <em>{base.data.name}</em>.</> : <>Powiedz, <em>na co masz ochotę</em>.</>}</h1>
          <p className="lede">AI ułoży przepis z produktów z katalogu. Zanim go zapiszesz, sprawdzisz składniki, kalorie i kroki.</p>
        </div>
      </header>

      <div className="two-col">
        <section className="card pad ai-panel stack" style={{ gap: 18 }}>
          <label className="field"><span>{base.data ? 'Co zmienić?' : 'Opisz danie'}</span>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder={base.data ? 'np. wersja wegańska, mniej kalorii, bez glutenu, z tym co mam w lodówce…' : 'np. ciepła kolacja z łososiem, bez nabiału, do 30 minut'} />
          </label>
          {!base.data && (
            <div className="chips">{IDEAS.map((i) => <Chip key={i} onClick={() => setPrompt(i)}>{i}</Chip>)}</div>
          )}
          {base.data && (
            <div className="chips">{['Wersja wegańska', 'O 150 kcal lżej', 'Więcej białka', 'Bez glutenu', 'Szybciej – max 15 minut'].map((i) => <Chip key={i} onClick={() => setPrompt(i)}>{i}</Chip>)}</div>
          )}
          <div className="grid-2">
            <label className="field"><span>Pora</span>
              <select className="select" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
                <option value="">dowolna</option>{SLOT_ORDER.map((s) => <option key={s} value={s}>{SLOT_NAME[s]}</option>)}
              </select>
            </label>
            <label className="field"><span>Kalorie na porcję</span><input className="input num" inputMode="numeric" placeholder={base.data ? String(Math.round(base.data.kcal)) : 'np. 500'} value={kcal} onChange={(e) => setKcal(e.target.value.replace(/\D/g, ''))} /></label>
            {!base.data && <label className="field"><span>Porcje</span><input type="number" min={1} max={8} className="input" value={servings} onChange={(e) => setServings(Math.max(1, +e.target.value))} /></label>}
          </div>
          <label className="field"><span>Mam w lodówce (opcjonalnie)</span><input className="input" value={pantry} onChange={(e) => setPantry(e.target.value)} placeholder="np. pół cukinii, feta, jajka" /></label>
          <button className="btn plum" onClick={generate} disabled={busy || (!prompt.trim() && !baseId)}>
            {busy ? <span className="steam"><i /><i /><i /></span> : <Icon.spark />}{busy ? 'Claude gotuje…' : 'Wymyśl przepis'}
          </button>
          {err && <ErrorBox error={err} />}
        </section>

        <aside className="stack sticky-side">
          <div className="card pad">
            <div className="kicker">Jak to działa</div>
            <ol style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 14, display: 'grid', gap: 8 }}>
              <li>AI zna cały katalog produktów, więc używa tych samych nazw co jadłospisy z PDF.</li>
              <li>Kalorie liczymy z produktów, nie z deklaracji AI.</li>
              <li>Nowe produkty dostają szacowane przez AI wartości i oznaczenie „szacunek AI”.</li>
            </ol>
          </div>
        </aside>
      </div>

      {d && res && (
        <section className="section">
          <div className="kicker">Propozycja</div>
          <article className="card pad">
            <div className="hero">
              <div>
                <h2 style={{ fontSize: 32 }}>{d.name}</h2>
                <p className="lede">{d.description}</p>
                <div className="chips" style={{ marginTop: 12 }}>
                  {d.meal_slots.map((s) => <span key={s} className="chip tiny">{SLOT_NAME[s]}</span>)}
                  <span className="chip tiny">{d.prep_time_min} min</span>
                  <span className="chip tiny">{d.servings} {d.servings === 1 ? 'porcja' : 'porcje'}</span>
                  {d.tags.map((t) => <span key={t} className="chip tiny ai">{t}</span>)}
                </div>
              </div>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
                <Plate p={res.nutrition_calc.protein_g} c={res.nutrition_calc.carbs_g} f={res.nutrition_calc.fat_g} kcal={res.nutrition_calc.kcal} size={130} />
                <Macros p={res.nutrition_calc.protein_g} c={res.nutrition_calc.carbs_g} f={res.nutrition_calc.fat_g} />
                <small className="muted mono">AI deklaruje: {d.estimated_nutrition_per_serving.kcal} kcal</small>
              </div>
            </div>
            <hr className="hr" />
            <div className="two-col">
              <div>
                <h3 style={{ marginBottom: 10 }}>Kroki</h3>
                <ol className="steps">{d.steps.map((s, i) => <li key={i}><p>{s}</p></li>)}</ol>
              </div>
              <div>
                <h3 style={{ marginBottom: 10 }}>Składniki</h3>
                {newCount > 0 && <p className="note" style={{ fontSize: 13 }}>{newCount} {newCount === 1 ? 'produktu' : 'produktów'} nie ma w katalogu – dodamy je z wartościami szacowanymi przez AI albo wybierz zamiennik.</p>}
                <div className="stack" style={{ gap: 8 }}>
                  {d.ingredients.map((i, k) => (
                    <div key={k} style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 8 }}>
                      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                        <span>{i.name}{i.group && <span className="muted"> · {i.group}</span>}</span>
                        <span className="num" style={{ fontSize: 13 }}>{n(i.amount_g)} g</span>
                      </div>
                      <div className="row" style={{ marginTop: 6, gap: 8, flexWrap: 'nowrap' }}>
                        <span className={`match ${i.match ? i.confidence : 'none'}`}>{i.match ? (i.confidence === 'exact' ? '✓ katalog' : '~ podobny') : '+ nowy'}</span>
                        <div style={{ flex: 1 }}>
                          <ProductPicker value={i.match?.name ?? ''} onPick={(p) => setMatch(k, p)} placeholder={i.match ? '' : 'wybierz z katalogu albo zostaw jako nowy'} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <hr className="hr" />
            <div className="row">
              <button className="btn tomato" onClick={save} disabled={saving}>{saving ? <span className="spinner" /> : <Icon.check />}Zapisz w przepisach</button>
              <button className="btn ghost" onClick={generate} disabled={busy}><Icon.dice />Inna propozycja</button>
              <span className="muted mono" style={{ fontSize: 12 }}>{res.model}</span>
            </div>
          </article>
        </section>
      )}
      {!res && !busy && meta && <p className="muted" style={{ marginTop: 28, fontSize: 14 }}>Wolisz wpisać przepis sam? <a href={href('/przepisy/nowy')}>Formularz przepisu</a>.</p>}
    </>
  );
}
