import { useEffect, useRef, useState } from 'react';
import { api, ApiError, useMeta, type Product } from '../api.ts';
import { n } from '../format.ts';
import { ErrorBox, Icon, Loading } from './ui.tsx';
import { ProductPicker } from './ProductPicker.tsx';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** Natywny BarcodeDetector (Chrome/Android) albo ponyfill ZXing w WebAssembly (np. Safari) – plik .wasm hostujemy sami. */
async function makeDetector(): Promise<Detector> {
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
  const Native = (globalThis as any).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats?.())?.includes('ean_13')) return new Native({ formats });
  const [{ BarcodeDetector, setZXingModuleOverrides }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) });
  return new BarcodeDetector({ formats: formats as any }) as unknown as Detector;
}

/** Kamera + wykrywanie kodu; zawsze z możliwością wpisania kodu ręcznie. */
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'nocamera'>('starting');
  const [manual, setManual] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, timer = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('brak kamery');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return;
        video.current!.srcObject = stream;
        await video.current!.play();
        const detector = await makeDetector();
        setStatus('scanning');
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const code = codes.find((c) => /^\d{8,14}$/.test(c.rawValue))?.rawValue;
            if (code) { stop = true; navigator.vibrate?.(60); onCode(code); return; }
          } catch { /* klatka bez kodu */ }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch {
        setStatus('nocamera');
      }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="stack">
      {status !== 'nocamera' && (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <div className="scan-frame" />
          {status === 'starting' && <div className="scan-msg">Włączam aparat…</div>}
        </div>
      )}
      {status === 'nocamera' && <p className="note">Nie mam dostępu do aparatu – wpisz cyfry spod kodu kreskowego.</p>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input num" inputMode="numeric" placeholder="albo wpisz kod, np. 5900512320359" value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && manual.length >= 8 && onCode(manual)} />
        <button className="btn" disabled={manual.length < 8} onClick={() => onCode(manual)}>Szukaj</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Open Food Facts
type Off = { name: string; brand: string; kcal: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; package_g: number | null; allergens: string[]; category_id: string };

const ALLERGEN_MAP: Record<string, string> = {
  'en:gluten': 'gluten', 'en:milk': 'mleko', 'en:eggs': 'jaja', 'en:nuts': 'orzechy', 'en:peanuts': 'orzeszki_ziemne',
  'en:soybeans': 'soja', 'en:sesame-seeds': 'sezam', 'en:fish': 'ryby', 'en:mustard': 'gorczyca', 'en:celery': 'seler',
};
const CATEGORY_MAP: [RegExp, string][] = [
  [/en:(dairies|yogurts|cheeses|milks|eggs)/, 'nabial'], [/en:(beverages|juices|waters)/, 'napoje'], [/en:(breads|crispbreads)/, 'pieczywo'],
  [/en:(chocolates|biscuits|candies|snacks|sweet-snacks|confectioneries)/, 'slodycze'], [/en:(cereals|pastas|rices|breakfast-cereals)/, 'zboza'],
  [/en:(meats|sausages|hams)/, 'mieso'], [/en:(fishes|seafood)/, 'ryby'], [/en:(nuts|seeds|dried-fruits)/, 'orzechy'],
  [/en:(fruits)/, 'owoce'], [/en:(vegetables)/, 'warzywa'], [/en:(sauces|condiments|oils|spreads)/, 'oleje_sosy'],
  [/en:(canned|legumes)/, 'konserwy'], [/en:(frozen-foods|meals)/, 'mrozonki_gotowe'], [/en:(spices|herbs)/, 'przyprawy'],
  [/en:(plant-based|tofu|meat-analogues)/, 'roslinne'], [/en:(protein|dietary-supplements)/, 'produkty_proteinowe'],
];

async function fetchOff(code: string): Promise<Off | null> {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_pl,brands,nutriments,product_quantity,categories_tags,allergens_tags`);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product, nu = p.nutriments ?? {};
  const v = (k: string) => (typeof nu[k] === 'number' ? Math.round(nu[k] * 10) / 10 : null);
  const carbs = v('carbohydrates_100g'), fiber = v('fiber_100g');
  const cats: string = (p.categories_tags ?? []).join(' ');
  return {
    name: (p.product_name_pl || p.product_name || '').trim(), brand: (p.brands || '').split(',')[0].trim(),
    kcal: v('energy-kcal_100g'), protein_g: v('proteins_100g'), fat_g: v('fat_100g'),
    // u nas węglowodany ogółem = przyswajalne (etykieta UE) + błonnik
    carbs_g: carbs !== null ? Math.round((carbs + (fiber ?? 0)) * 10) / 10 : null, fiber_g: fiber,
    package_g: typeof p.product_quantity === 'number' || /^\d+(\.\d+)?$/.test(String(p.product_quantity ?? '')) ? Number(p.product_quantity) : null,
    allergens: [...new Set<string>((p.allergens_tags ?? []).map((a: string) => ALLERGEN_MAP[a]).filter(Boolean))],
    category_id: CATEGORY_MAP.find(([rx]) => rx.test(cats))?.[1] ?? 'inne',
  };
}

/** Pełny przepływ: skan → nasz katalog → Open Food Facts → formularz z etykiety. Kończy się produktem z katalogu. */
export function ScanFlow({ onProduct }: { onProduct: (p: Product) => void }) {
  const meta = useMeta();
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<'scan' | 'looking' | 'form'>('scan');
  const [form, setForm] = useState<Off & { name: string }>({ name: '', brand: '', kcal: null, protein_g: null, fat_g: null, carbs_g: null, fiber_g: null, package_g: null, allergens: [], category_id: 'inne' });
  const [fromOff, setFromOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lookup = async (c: string) => {
    setCode(c); setState('looking'); setErr(null);
    try {
      onProduct(await api<Product>(`/products/by-barcode/${c}`));
      return;
    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) { setErr((e as Error).message); setState('scan'); return; } }
    try {
      const off = await fetchOff(c);
      if (off) { setForm({ ...off, name: off.brand && !off.name.includes(off.brand) ? `${off.name} ${off.brand}`.trim() : off.name }); setFromOff(true); }
    } catch { /* bez internetu – formularz ręczny */ }
    setState('form');
  };
  const save = async () => {
    setErr(null);
    try {
      const p = await api<Product>('/products', {
        body: {
          name: form.name, category_id: form.category_id, allergens: form.allergens, barcode: code,
          kcal: form.kcal, protein_g: form.protein_g ?? 0, fat_g: form.fat_g ?? 0, carbs_g: form.carbs_g ?? 0, fiber_g: form.fiber_g ?? 0,
          origin: form.allergens.includes('mleko') ? 'dairy' : form.allergens.includes('jaja') ? 'egg' : form.allergens.includes('ryby') ? 'fish' : 'plant',
          nutrition_source: 'label', source_type: 'user', measures: form.package_g ? [{ unit: 'opakowanie', grams: form.package_g }] : [],
        },
      });
      onProduct(p);
    } catch (e: any) { setErr(e.message); }
  };
  const link = async (p: Product) => onProduct(await api<Product>(`/products/${p.id}/barcode`, { method: 'PUT', body: { barcode: code } }));
  const numField = (k: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g' | 'fiber_g' | 'package_g', label: string) => (
    <label className="field"><span>{label}</span>
      <input className="input num" inputMode="decimal" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} />
    </label>
  );

  if (state === 'scan') return <>{err && <ErrorBox error={err} />}<BarcodeScanner onCode={lookup} /></>;
  if (state === 'looking') return <Loading />;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Kod <span className="num">{code}</span> · {fromOff ? 'dane z Open Food Facts – sprawdź z etykietą' : 'nie znam tego produktu – przepisz wartości z etykiety (na 100 g)'}</p>
      <label className="field"><span>Nazwa</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {numField('kcal', 'kcal / 100 g')}{numField('protein_g', 'białko')}{numField('fat_g', 'tłuszcz')}
        {numField('carbs_g', 'węglowodany')}{numField('fiber_g', 'błonnik')}{numField('package_g', 'opakowanie (g)')}
      </div>
      <label className="field"><span>Kategoria w sklepie</span>
        <select className="select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
          {meta?.categories.filter((c) => c.id !== 'polprodukty').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {form.allergens.length > 0 && <div className="chips">{form.allergens.map((a) => <span key={a} className="chip tiny bad">{meta?.allergens.find((x) => x.id === a)?.name ?? a}</span>)}</div>}
      {err && <ErrorBox error={err} />}
      <div className="row">
        <button className="btn tomato" onClick={save} disabled={!form.name.trim() || form.kcal == null}><Icon.check />Zapisz produkt</button>
        <button className="btn link" onClick={() => setState('scan')}>Skanuj ponownie</button>
      </div>
      <div className="field"><span>…albo to produkt, który już jest w katalogu</span><ProductPicker value="" onPick={link} placeholder="np. Jogurt skyr" /></div>
      {form.kcal != null && form.package_g ? <small className="muted">Całe opakowanie ≈ {n((form.kcal * form.package_g) / 100, 0)} kcal</small> : null}
    </div>
  );
}
