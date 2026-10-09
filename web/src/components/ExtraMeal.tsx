import { useState, type ReactNode } from 'react';
import { api, STATIC, type PlanMeal } from '../api.ts';
import { SLOT_NAME, n } from '../format.ts';
import { ErrorBox, Icon, Sheet, useToast } from './ui.tsx';

type Estimate = {
  name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  items?: { name: string; grams: number; kcal: number }[]; confidence?: string; note?: string;
};
type Mode = 'text' | 'photo' | 'manual' | 'scan';

/** Zmniejsza zdjęcie do maks. 1024 px i zwraca base64 JPEG – szybciej i taniej dla AI. */
async function shrink(file: File): Promise<{ data: string; media_type: string; preview: string }> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.82);
  return { data: url.split(',')[1], media_type: 'image/jpeg', preview: url };
}

export function ExtraMealSheet({ date, meals, onClose, onSaved, scanSlot }: {
  date: string; meals: PlanMeal[]; onClose: () => void; onSaved: () => void;
  scanSlot?: (onFound: (e: Estimate) => void) => ReactNode;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(STATIC ? 'manual' : 'text');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ data: string; media_type: string; preview: string } | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [source, setSource] = useState<'manual' | 'ai_text' | 'ai_photo' | 'barcode'>('manual');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replaces, setReplaces] = useState<number | ''>('');
  const [rebalance, setRebalance] = useState(true);
  const planned = meals.filter((m) => m.status === 'planned');

  const estimate = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<Estimate>('/ai/estimate', { body: mode === 'photo' ? { text, image: photo && { data: photo.data, media_type: photo.media_type } } : { text } });
      setEst(r); setSource(mode === 'photo' ? 'ai_photo' : 'ai_text');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!est) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ adjustments: { name: string; slot: string; to: number }[] }>('/extras', {
        body: { date, name: est.name, kcal: est.kcal, protein_g: est.protein_g, carbs_g: est.carbs_g, fat_g: est.fat_g, source,
          note: est.note ?? null, replaces_meal_id: replaces || null, rebalance },
      });
      toast(r.adjustments.length
        ? `Zapisane. Wyrównaliśmy dzień: ${r.adjustments.map((a) => `${SLOT_NAME[a.slot as keyof typeof SLOT_NAME].toLowerCase()} ×${n(a.to)}`).join(', ')}.`
        : 'Zapisane.');
      onSaved(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const tabs: [Mode, string][] = [
    ...(STATIC ? [] : [['text', 'Opisz'], ['photo', 'Zdjęcie']] as [Mode, string][]),
    ...(scanSlot ? [['scan', 'Kod kreskowy']] as [Mode, string][] : []),
    ['manual', 'Wpisz kalorie'],
  ];
  const num = (k: keyof Estimate, v: string) => setEst((e) => ({ ...(e ?? { name: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [k]: k === 'name' ? v : Number(v.replace(',', '.')) || 0 }));

  return (
    <Sheet onClose={onClose} kicker="Poza planem" title="Co zjadłeś?">
      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map(([k, label]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setErr(null); if (k === 'manual') setSource('manual'); }}>{label}</button>)}
      </div>

      {mode === 'text' && !est && (
        <div className="stack">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="np. dwa kawałki pizzy margherity i cola zero; albo: kebab w bułce z sosem czosnkowym" autoFocus />
          <button className="btn plum" onClick={estimate} disabled={busy || !text.trim()}>{busy ? <span className="steam"><i /><i /><i /></span> : <Icon.spark />}{busy ? 'Liczę…' : 'Oszacuj kalorie'}</button>
        </div>
      )}
      {mode === 'photo' && !est && (
        <div className="stack">
          <label className="btn ghost" style={{ justifySelf: 'start' }}>
            <Icon.plus />{photo ? 'Inne zdjęcie' : 'Zrób albo wybierz zdjęcie'}
            <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await shrink(f)); }} />
          </label>
          {photo && <img src={photo.preview} alt="Zdjęcie posiłku" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 12, objectFit: 'cover' }} />}
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="dopisek (opcjonalnie), np. „zjadłem połowę”" />
          <button className="btn plum" onClick={estimate} disabled={busy || !photo}>{busy ? <span className="steam"><i /><i /><i /></span> : <Icon.spark />}{busy ? 'Patrzę na talerz…' : 'Oszacuj ze zdjęcia'}</button>
        </div>
      )}
      {mode === 'scan' && !est && scanSlot?.((e) => { setEst(e); setSource('barcode'); })}

      {(est || mode === 'manual') && (
        <div className="stack">
          {est?.items?.length ? (
            <div className="card" style={{ padding: 12 }}>
              <div className="kicker" style={{ marginBottom: 8 }}>Jak policzyliśmy{est.confidence ? ` · pewność ${est.confidence}` : ''}</div>
              {est.items.map((i, k) => <div key={k} className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>{i.name} · {n(i.grams, 0)} g</span><span className="num">{n(i.kcal, 0)} kcal</span></div>)}
              {est.note && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>{est.note}</p>}
            </div>
          ) : null}
          <label className="field"><span>Nazwa</span><input className="input" value={est?.name ?? ''} onChange={(e) => num('name', e.target.value)} placeholder="np. Kawałek sernika" /></label>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {(['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const).map((k) => (
              <label key={k} className="field"><span>{{ kcal: 'kcal', protein_g: 'B (g)', carbs_g: 'W (g)', fat_g: 'T (g)' }[k]}</span>
                <input className="input num" inputMode="decimal" value={est ? String(est[k]).replace('.', ',') : ''} onChange={(e) => num(k, e.target.value)} />
              </label>
            ))}
          </div>
          <label className="field"><span>Zamiast posiłku z planu</span>
            <select className="select" value={replaces} onChange={(e) => setReplaces(e.target.value ? Number(e.target.value) : '')}>
              <option value="">nie – dodatkowo</option>
              {planned.map((m) => <option key={m.id} value={m.id}>{SLOT_NAME[m.slot]}: {m.recipe.name}</option>)}
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={rebalance} onChange={(e) => setRebalance(e.target.checked)} />
            Wyrównaj resztę dnia – zmniejsz porcje posiłków, które jeszcze przed Tobą
          </label>
          <div className="row">
            <button className="btn tomato" onClick={save} disabled={busy || !est?.name?.trim() || !est?.kcal}><Icon.check />Zapisz</button>
            {est && mode !== 'manual' && <button className="btn link" onClick={() => setEst(null)}>Jeszcze raz</button>}
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 12 }}><ErrorBox error={err} /></div>}
    </Sheet>
  );
}
