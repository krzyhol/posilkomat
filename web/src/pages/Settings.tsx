import { useEffect, useState } from 'react';
import { api, useApi, useMeta, STATIC, type Profile } from '../api.ts';
import { DIETS, n } from '../format.ts';
import { Chip, ErrorBox, Loading, useToast } from '../components/ui.tsx';

export function YouTabs({ on }: { on: 'profile' | 'weight' | 'dislikes' | 'family' }) {
  const tabs = [['profile', 'Profil', '#/ustawienia'], ['weight', 'Waga', '#/ustawienia/waga'], ['dislikes', 'Nie lubię', '#/ustawienia/nie-lubie']] as const;
  return (
    <div className="tabs" style={{ marginBottom: 18 }}>
      {tabs.map(([k, label, h]) => <button key={k} className={on === k ? 'on' : ''} onClick={() => (location.hash = h)}>{label}</button>)}
    </div>
  );
}

export default function Settings() {
  const meta = useMeta();
  const toast = useToast();
  const { data, error } = useApi<Profile>('/settings');
  const ai = useApi<{ model: string; credentials: string }>(STATIC ? null : '/ai/status');
  const [p, setP] = useState<Profile | null>(null);
  // Mifflin–St Jeor jako podpowiedź – dane o ciele nie są zapisywane
  const [calc, setCalc] = useState({ sex: 'k', age: 30, weight: 65, height: 168, activity: 1.5 });
  useEffect(() => { if (data) setP(data); }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!p) return <Loading />;
  const save = async (patch: Partial<Profile>) => {
    const next = { ...p, ...patch };
    setP(next);
    setP(await api<Profile>('/settings', { method: 'PUT', body: next }));
    toast('Zapisano.');
  };
  const bmr = 10 * calc.weight + 6.25 * calc.height - 5 * calc.age + (calc.sex === 'm' ? 5 : -161);
  const tdee = Math.round((bmr * calc.activity) / 50) * 50;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Ustawienia</div>
          <h1 style={{ marginTop: 10 }}>Twoje <em>założenia</em>.</h1>
          <p className="lede">Z tych ustawień korzystają kreator jadłospisu, podmiana posiłków i AI.</p>
        </div>
      </header>
      <YouTabs on="profile" />
      <div className="two-col">
        <div className="stack" style={{ gap: 24 }}>
          <div className="field"><span>Cel dzienny · <b className="num">{p.target_kcal} kcal</b></span>
            <input type="range" min={1200} max={3500} step={50} value={p.target_kcal} onChange={(e) => setP({ ...p, target_kcal: +e.target.value })} onPointerUp={() => save({})} onKeyUp={() => save({})} style={{ accentColor: 'var(--tomato)' }} />
          </div>
          <label className="field" style={{ maxWidth: 200 }}><span>Gotujesz dla</span>
            <input type="number" min={1} max={12} className="input" value={p.people} onChange={(e) => save({ people: Math.max(1, +e.target.value) })} />
          </label>
          <div className="field"><span>Dieta</span>
            <div className="chips">
              <Chip on={!p.diet} onClick={() => save({ diet: null })}>wszystko jem</Chip>
              {DIETS.slice(0, 3).map((d) => <Chip key={d} on={p.diet === d} onClick={() => save({ diet: d as Profile['diet'] })}>{d}</Chip>)}
            </div>
          </div>
          <div className="field"><span>Nie jem (alergeny)</span>
            <div className="chips">{meta?.allergens.map((a) => {
              const on = p.excluded_allergens.includes(a.id);
              return <Chip key={a.id} on={on} onClick={() => save({ excluded_allergens: on ? p.excluded_allergens.filter((x) => x !== a.id) : [...p.excluded_allergens, a.id] })}>{a.name}</Chip>;
            })}</div>
            <small className="muted">Alergeny produktów są wyliczone automatycznie z nazw – przy produktach markowych sprawdzaj etykietę.</small>
          </div>
          <label className="toggle"><input type="checkbox" checked={p.hide_pantry_staples} onChange={(e) => save({ hide_pantry_staples: e.target.checked })} />
            Na liście zakupów zwijaj produkty, które zwykle są w domu (sól, oliwa, przyprawy)
          </label>
        </div>
        <aside className="stack">
          <div className="card pad stack" style={{ gap: 10 }}>
            <div className="kicker">Policz zapotrzebowanie</div>
            <div className="chips">
              <Chip on={calc.sex === 'k'} onClick={() => setCalc({ ...calc, sex: 'k' })}>kobieta</Chip>
              <Chip on={calc.sex === 'm'} onClick={() => setCalc({ ...calc, sex: 'm' })}>mężczyzna</Chip>
            </div>
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <label className="field"><span>wiek</span><input className="input num" type="number" value={calc.age} onChange={(e) => setCalc({ ...calc, age: +e.target.value })} /></label>
              <label className="field"><span>kg</span><input className="input num" type="number" value={calc.weight} onChange={(e) => setCalc({ ...calc, weight: +e.target.value })} /></label>
              <label className="field"><span>cm</span><input className="input num" type="number" value={calc.height} onChange={(e) => setCalc({ ...calc, height: +e.target.value })} /></label>
            </div>
            <select className="select" value={calc.activity} onChange={(e) => setCalc({ ...calc, activity: +e.target.value })}>
              <option value={1.3}>siedzący tryb</option><option value={1.5}>lekka aktywność</option><option value={1.7}>trening 3–4× w tygodniu</option><option value={1.9}>bardzo aktywnie</option>
            </select>
            <p style={{ margin: 0 }}>Utrzymanie wagi: <b className="num">~{n(tdee, 0)} kcal</b></p>
            <div className="row">
              <button className="btn small" onClick={() => save({ target_kcal: tdee })}>Ustaw jako cel</button>
              <button className="btn small ghost" onClick={() => save({ target_kcal: tdee - 300 })}>Redukcja −300</button>
            </div>
            <small className="muted">Wzór Mifflina–St Jeora – orientacyjnie, nie zastępuje dietetyka.</small>
          </div>
          {STATIC && (
            <div className="card pad">
              <div className="kicker">Twoje dane</div>
              <p style={{ margin: '10px 0 12px', fontSize: 14 }}>
                To wersja w przeglądarce: jadłospisy, listy zakupów i własne przepisy zapisują się tylko na tym urządzeniu. Kuchnia AI działa w wersji uruchamianej lokalnie.
              </p>
              <button className="btn small ghost" onClick={async () => {
                if (!confirm('Usunąć wszystkie Twoje jadłospisy, listy i własne przepisy z tej przeglądarki?')) return;
                const { resetLocalData } = await import('../local/engine.ts');
                await resetLocalData();
                location.hash = '#/';
                location.reload();
              }}>Wyczyść moje dane</button>
            </div>
          )}
          {!STATIC && <div className="card pad">
            <div className="kicker">AI</div>
            <p style={{ margin: '10px 0 0', fontSize: 14 }}>
              Model: <span className="mono">{ai.data?.model ?? '…'}</span><br />
              {ai.data?.credentials === 'env' ? 'Klucz API wykryty.' : <>Ustaw <span className="mono">ANTHROPIC_API_KEY</span> przed uruchomieniem serwera, żeby włączyć Kuchnię AI.</>}
            </p>
          </div>}
        </aside>
      </div>
    </>
  );
}
