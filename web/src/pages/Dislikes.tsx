import { useState } from 'react';
import { api, useApi } from '../api.ts';
import { plural } from '../format.ts';
import { href } from '../router.tsx';
import { ErrorBox, Icon, Loading, useToast } from '../components/ui.tsx';
import { ProductPicker } from '../components/ProductPicker.tsx';
import { YouTabs } from './Settings.tsx';

type Info = {
  products: { id: string; name: string }[]; recipes: { id: string; name: string }[];
  suggestions: { id: string; name: string; times: number }[]; hidden_recipes: number;
};

export default function Dislikes() {
  const toast = useToast();
  const { data, error, reload } = useApi<Info>('/dislikes');
  const [k, setK] = useState(0);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const set = async (body: { product_id?: string; recipe_id?: string; on: boolean }, msg?: string) => {
    await api('/dislikes', { body });
    reload();
    if (msg) toast(msg);
  };
  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Ty</div>
          <h1 style={{ marginTop: 10 }}>Tego <em>nie jem</em>.</h1>
          <p className="lede">Dania z tymi produktami nie trafią do nowych jadłospisów, podmian, propozycji ze spiżarni ani do przepisów od AI.</p>
        </div>
      </header>
      <YouTabs on="dislikes" />

      <div className="two-col">
        <div className="stack" style={{ gap: 24 }}>
          <section>
            <div className="kicker" style={{ marginBottom: 10 }}>Produkty</div>
            <ProductPicker key={k} value="" placeholder="np. koperek, tuńczyk, kapusta kiszona…"
              onPick={(p) => { set({ product_id: p.id, on: true }, `${p.name} – omijamy.`); setK(k + 1); }} />
            <div className="chips" style={{ marginTop: 12 }}>
              {data.products.map((p) => (
                <button key={p.id} className="chip bad" onClick={() => set({ product_id: p.id, on: false })} aria-label={`Usuń z nielubianych: ${p.name}`}>{p.name} ×</button>
              ))}
              {!data.products.length && <span className="muted">Jeszcze nic – jesz wszystko.</span>}
            </div>
          </section>

          <section>
            <div className="kicker" style={{ marginBottom: 10 }}>Dania</div>
            <div className="chips">
              {data.recipes.map((r) => (
                <span key={r.id} className="chip bad" style={{ cursor: 'default' }}>
                  <a href={href(`/przepisy/${r.id}`)} style={{ color: 'inherit' }}>{r.name}</a>{' '}
                  <button className="icon-btn" style={{ padding: 0, color: 'inherit' }} onClick={() => set({ recipe_id: r.id, on: false })} aria-label={`Usuń z nielubianych: ${r.name}`}>×</button>
                </span>
              ))}
              {!data.recipes.length && <span className="muted">Danie dodasz przyciskiem „Nie lubię tego dania” na karcie przepisu.</span>}
            </div>
          </section>

          {data.suggestions.length > 0 && (
            <section>
              <div className="kicker" style={{ marginBottom: 10 }}>Często pomijasz albo podmieniasz</div>
              <div className="stack" style={{ gap: 8 }}>
                {data.suggestions.map((s) => (
                  <div key={s.id} className="card" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                    <span><a href={href(`/przepisy/${s.id}`)}>{s.name}</a> <small className="muted">· {s.times} {plural(s.times, 'raz', 'razy', 'razy')}</small></span>
                    <button className="btn small ghost" onClick={() => set({ recipe_id: s.id, on: true }, 'Nie zobaczysz go w nowych jadłospisach.')}>Nie lubię</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="card pad">
          <div className="kicker">Efekt</div>
          <p style={{ margin: '10px 0 0' }}>
            Omijamy <b className="num">{data.hidden_recipes}</b> {plural(data.hidden_recipes, 'danie', 'dania', 'dań')}.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            Jadłospisy, które już masz, zostają bez zmian – nielubiane danie podmienisz jednym kliknięciem. W przepisie możesz też podmienić sam składnik.
          </p>
          <a className="btn small ghost" href={href('/jadlospis/nowy')}><Icon.plan />Ułóż nowy jadłospis</a>
        </aside>
      </div>
    </>
  );
}
