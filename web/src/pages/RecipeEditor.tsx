import { useEffect, useState } from 'react';
import { api, useMeta, STATIC, type Product, type Recipe, type Slot } from '../api.ts';
import { SLOT_NAME, SLOT_ORDER, n } from '../format.ts';
import { go, href } from '../router.tsx';
import { Chip, ErrorBox, Icon, Macros, Plate, useToast } from '../components/ui.tsx';
import { ProductPicker } from '../components/ProductPicker.tsx';

type Row = { key: number; product: Product | null; amount: string; unit: string; qty: string; group: string };
let k = 0;
const emptyRow = (): Row => ({ key: ++k, product: null, amount: '', unit: '', qty: '', group: '' });

/** Formularz własnego przepisu – makro liczy się na żywo z katalogu produktów. */
export default function RecipeEditor() {
  const meta = useMeta();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slots, setSlots] = useState<Slot[]>(['lunch']);
  const [servings, setServings] = useState(1);
  const [time, setTime] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [steps, setSteps] = useState<string[]>(['', '']);
  const [nutri, setNutri] = useState({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filled = rows.filter((r) => r.product && Number(r.amount) > 0);
  useEffect(() => {
    const t = setTimeout(() => {
      api('/nutrition', { body: { servings, ingredients: filled.map((r) => ({ product_id: r.product!.id, amount_g: Number(r.amount) })) } }).then(setNutri);
    }, 200);
    return () => clearTimeout(t);
  }, [JSON.stringify(filled.map((r) => [r.product?.id, r.amount])), servings]);

  const upd = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // gramatura z miary domowej, gdy znamy wagę miary produktu
  const fromHousehold = (r: Row, qty: string, unit: string) => {
    const m = r.product?.measures.find((x) => x.unit === unit);
    const patch: Partial<Row> = { qty, unit };
    if (m && Number(qty) > 0) patch.amount = String(Math.round(m.grams * Number(qty) * 10) / 10);
    upd(r.key, patch);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const recipe = await api<Recipe>('/recipes', {
        body: {
          name, description: description || null, slots, servings, prep_time_min: time ? Number(time) : null,
          ingredients: filled.map((r) => ({
            product_id: r.product!.id, name: r.product!.name, amount_g: Number(r.amount),
            household_qty: r.qty ? Number(r.qty) : null, household_unit: r.unit || null, group_name: r.group || null,
          })),
          steps: steps.filter((s) => s.trim()).map((text) => ({ text })),
        },
      });
      toast('Przepis zapisany.');
      go(`/przepisy/${recipe.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <a className="btn link" href={href('/przepisy')}><Icon.back />Przepisy</a>
      <header className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1>Twój <em>przepis</em>.</h1>
          <p className="lede">Wybieraj składniki z katalogu – kalorie i makro policzą się same.{!STATIC && <> Wolisz opisać danie słowami? <a href={href('/ai')}>Poproś AI</a>.</>}</p>
        </div>
      </header>
      <div className="two-col">
        <div className="stack" style={{ gap: 22 }}>
          <label className="field"><span>Nazwa</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Owsianka mamy z jabłkiem i cynamonem" /></label>
          <label className="field"><span>Krótki opis (opcjonalnie)</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="field"><span>Pora posiłku</span>
            <div className="chips">{SLOT_ORDER.map((s) => <Chip key={s} on={slots.includes(s)} onClick={() => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s])}>{SLOT_NAME[s]}</Chip>)}</div>
          </div>
          <div className="grid-2">
            <label className="field"><span>Porcje</span><input type="number" min={1} max={12} className="input" value={servings} onChange={(e) => setServings(Math.max(1, +e.target.value))} /></label>
            <label className="field"><span>Czas (min, opcjonalnie)</span><input type="number" min={0} className="input" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>

          <div className="field"><span>Składniki – ilości na cały przepis</span>
            <div className="stack" style={{ gap: 10 }}>
              {rows.map((r) => (
                <div key={r.key} className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
                  <div className="ing-row">
                    <ProductPicker value={r.product?.name ?? ''} onPick={(p) => upd(r.key, { product: p, unit: p.measures[0]?.unit ?? '' })} />
                    <input className="input num" inputMode="decimal" placeholder="g" value={r.amount} onChange={(e) => upd(r.key, { amount: e.target.value.replace(',', '.') })} aria-label="Gramy" />
                    <button className="icon-btn" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Usuń składnik"><Icon.x /></button>
                  </div>
                  {r.product && (
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input num" style={{ width: 70 }} inputMode="decimal" placeholder="ile" value={r.qty} onChange={(e) => fromHousehold(r, e.target.value.replace(',', '.'), r.unit)} aria-label="Ilość w mierze domowej" />
                      <select className="select" style={{ width: 'auto' }} value={r.unit} onChange={(e) => fromHousehold(r, r.qty, e.target.value)}>
                        <option value="">miara…</option>
                        {meta?.units.map((u) => {
                          const m = r.product!.measures.find((x) => x.unit === u.id);
                          return <option key={u.id} value={u.id}>{u.form_one}{m ? ` (${n(m.grams)} g)` : ''}</option>;
                        })}
                      </select>
                      <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="sekcja, np. Sos" value={r.group} onChange={(e) => upd(r.key, { group: e.target.value })} />
                    </div>
                  )}
                </div>
              ))}
              <button className="btn ghost small" onClick={() => setRows([...rows, emptyRow()])} style={{ justifySelf: 'start' }}><Icon.plus />Składnik</button>
            </div>
          </div>

          <div className="field"><span>Kroki</span>
            <div className="stack" style={{ gap: 10 }}>
              {steps.map((s, i) => (
                <div key={i} className="row" style={{ alignItems: 'start', flexWrap: 'nowrap' }}>
                  <span style={{ font: 'italic 600 26px/1.4 var(--display)', color: 'var(--tomato)', width: 28 }}>{i + 1}</span>
                  <textarea className="textarea" style={{ minHeight: 64 }} value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} placeholder="np. Płatki zalewamy mlekiem i gotujemy 5 minut na małym ogniu." />
                  <button className="icon-btn" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Usuń krok"><Icon.x /></button>
                </div>
              ))}
              <button className="btn ghost small" onClick={() => setSteps([...steps, ''])} style={{ justifySelf: 'start' }}><Icon.plus />Krok</button>
            </div>
          </div>
          {err && <ErrorBox error={err} />}
        </div>

        <aside className="card pad sticky-side" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
          <div className="kicker">na 1 porcję</div>
          <Plate p={nutri.protein_g} c={nutri.carbs_g} f={nutri.fat_g} kcal={nutri.kcal} size={140} />
          <Macros p={nutri.protein_g} c={nutri.carbs_g} f={nutri.fat_g} />
          <hr className="hr" style={{ width: '100%', margin: '6px 0' }} />
          <button className="btn tomato" style={{ width: '100%' }} onClick={save} disabled={busy || !name.trim() || !filled.length || !slots.length}>
            {busy ? <span className="spinner" /> : <Icon.check />}Zapisz przepis
          </button>
        </aside>
      </div>
    </>
  );
}
