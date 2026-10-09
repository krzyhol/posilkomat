import { useState } from 'react';
import { api, useApi, STATIC, type PantryItem, type PantrySuggestion, type Product, type Slot } from '../api.ts';
import { SLOT_NAME, SLOT_ORDER, n, plural } from '../format.ts';
import { href } from '../router.tsx';
import { Chip, ErrorBox, Icon, Loading, Plate, Sheet, useToast } from '../components/ui.tsx';
import { ScanFlow } from '../components/Barcode.tsx';
import { ProductPicker } from '../components/ProductPicker.tsx';

export function ShopTabs({ on }: { on: 'lists' | 'pantry' }) {
  return (
    <div className="tabs" style={{ marginBottom: 18 }}>
      <button className={on === 'lists' ? 'on' : ''} onClick={() => (location.hash = '#/zakupy')}>Listy zakupów</button>
      <button className={on === 'pantry' ? 'on' : ''} onClick={() => (location.hash = '#/spizarnia')}>Spiżarnia</button>
    </div>
  );
}

const expiryLabel = (d: number | null) =>
  d === null ? null : d < 0 ? 'po terminie' : d === 0 ? 'termin dziś' : d === 1 ? 'termin jutro' : `termin za ${d} ${plural(d, 'dzień', 'dni', 'dni')}`;

export default function Pantry() {
  const toast = useToast();
  const { data, error, setData } = useApi<PantryItem[]>('/pantry');
  const [slot, setSlot] = useState<Slot | ''>('');
  const sugg = useApi<PantrySuggestion[]>(`/pantry/suggestions?limit=9${slot ? `&slot=${slot}` : ''}&v=${data?.length ?? 0}`);
  const [pick, setPick] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const [scanning, setScanning] = useState(false);

  const add = async () => {
    if (!pick) return;
    setData(await api<PantryItem[]>(`/pantry/${pick.id}`, { method: 'PUT', body: { amount_g: amount ? Number(amount) : null, expires_on: expires || null } }));
    toast(`${pick.name} w spiżarni.`);
    setPick(null); setAmount(''); setExpires(''); setPickerKey((k) => k + 1);
  };
  const update = async (it: PantryItem, patch: Partial<PantryItem>) =>
    setData(await api<PantryItem[]>(`/pantry/${it.product_id}`, { method: 'PUT', body: { amount_g: it.amount_g, expires_on: it.expires_on, ...patch } }));
  const remove = async (it: PantryItem) => setData(await api<PantryItem[]>(`/pantry/${it.product_id}`, { method: 'DELETE' }));

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const groups = [...new Set(data.map((i) => i.category_name))];
  const expiring = data.filter((i) => i.expires_in_days !== null && i.expires_in_days <= 3);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Zakupy</div>
          <h1 style={{ marginTop: 10 }}>Co <em>już masz</em>.</h1>
          <p className="lede">Zapasy odejmujemy od list zakupów, a zjedzone posiłki same je zużywają. Bez ilości = „mam”, bez liczenia.</p>
        </div>
      </header>
      <ShopTabs on="pantry" />

      <section className="card pad stack" style={{ gap: 12 }}>
        <div className="kicker">Dodaj do spiżarni</div>
        <div className="row" style={{ alignItems: 'end' }}>
          <div style={{ flex: '2 1 240px' }}><ProductPicker key={pickerKey} value={pick?.name ?? ''} onPick={setPick} placeholder="np. jajka, ryż basmati, passata…" /></div>
          <input className="input num" style={{ flex: '0 1 110px' }} inputMode="decimal" placeholder="ile g" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} aria-label="Ilość w gramach" />
          <input className="input" style={{ flex: '0 1 160px' }} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Termin ważności" />
          <button className="btn" onClick={add} disabled={!pick}><Icon.plus />Dodaj</button>
          <button className="btn ghost" onClick={() => setScanning(true)}><Icon.scan />Skanuj kod</button>
        </div>
        {pick && pick.measures[0] && <small className="muted">1 {pick.measures[0].unit} ≈ {n(pick.measures[0].grams)} g</small>}
      </section>

      {scanning && (
        <Sheet onClose={() => setScanning(false)} kicker="Spiżarnia" title="Zeskanuj produkt">
          <ScanFlow onProduct={(p) => {
            setPick(p); setPickerKey((k) => k + 1);
            const pack = p.measures.find((m) => m.unit === 'opakowanie');
            setAmount(pack ? String(pack.grams) : '');
            setScanning(false);
            toast(`${p.name} – uzupełnij ilość i dodaj.`);
          }} />
        </Sheet>
      )}

      {expiring.length > 0 && (
        <p className="note" style={{ marginTop: 16 }}>Kończy się termin: <b>{expiring.map((i) => i.name).join(', ')}</b> – propozycje niżej biorą to pod uwagę.</p>
      )}

      {!data.length && <div className="empty" style={{ marginTop: 20 }}><h3>Spiżarnia jest pusta</h3><p>Dodaj produkty ręcznie albo odhacz zakupy na liście i przenieś je tutaj.</p></div>}
      {groups.map((g) => (
        <section className="section" key={g}>
          <div className="kicker">{g}</div>
          <div className="stack" style={{ gap: 8 }}>
            {data.filter((i) => i.category_name === g).map((i) => (
              <div key={i.product_id} className="card" style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
                <div>
                  <div>{i.name}</div>
                  {i.expires_on && <small className={i.expires_in_days !== null && i.expires_in_days <= 2 ? '' : 'muted'} style={i.expires_in_days !== null && i.expires_in_days <= 2 ? { color: 'var(--tomato-ink)' } : undefined}>{expiryLabel(i.expires_in_days)}</small>}
                </div>
                <input className="input num" style={{ width: 100, padding: '6px 10px' }} inputMode="decimal" placeholder="mam"
                  defaultValue={i.amount_g ?? ''} key={`${i.product_id}-${i.amount_g}`}
                  onBlur={(e) => { const v = e.target.value.replace(',', '.'); const next = v === '' ? null : Number(v); if (next !== i.amount_g) update(i, { amount_g: next }); }}
                  aria-label={`Ilość: ${i.name} (g)`} />
                <button className="icon-btn" onClick={() => remove(i)} aria-label={`Usuń ${i.name}`}><Icon.x /></button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="section">
        <div className="kicker">Co ugotuję z tego, co mam</div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="chips">{SLOT_ORDER.map((s) => <Chip key={s} on={slot === s} onClick={() => setSlot(slot === s ? '' : s)}>{SLOT_NAME[s]}</Chip>)}</div>
          {!STATIC && data.length > 0 && (
            <a className="btn plum small" href={href(`/ai?pantry=${encodeURIComponent(data.map((i) => i.name).join(', '))}`)}><Icon.spark />Wymyśl z AI z moich zapasów</a>
          )}
        </div>
        {sugg.loading && !sugg.data && <Loading />}
        {sugg.data && !sugg.data.length && <p className="muted">Dodaj kilka produktów, a podpowiemy, co z nich zrobić.</p>}
        <div className="recipe-grid">
          {sugg.data?.map((s) => (
            <a key={s.recipe.id} className="rcard" href={href(`/przepisy/${s.recipe.id}`)}>
              <Plate p={s.recipe.protein_g} c={s.recipe.carbs_g} f={s.recipe.fat_g} kcal={s.recipe.kcal} />
              <div style={{ minWidth: 0 }}>
                <h3>{s.recipe.name}</h3>
                <div className="chips" style={{ gap: 5, marginTop: 8 }}>
                  <span className="chip tiny good">masz {s.have.length} z {s.have.length + s.missing.length}</span>
                  {s.expiring.map((e) => <span key={e} className="chip tiny warn">ratuje: {e}</span>)}
                </div>
                {s.missing.length > 0 && <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>brakuje: {s.missing.join(', ')}</p>}
              </div>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
