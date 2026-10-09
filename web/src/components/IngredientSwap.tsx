import { useApi, useMeta } from '../api.ts';
import { n } from '../format.ts';
import { ErrorBox, Loading, Sheet } from './ui.tsx';

export type SubOption = {
  product_id: string; name: string; amount_g: number; source: 'exchange' | 'similar'; note: string | null; in_pantry: boolean;
  allergens: string[]; delta: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }; recipe_kcal: number;
};
type SubRes = { original: { product_id: string; name: string; amount_g: number | null }; exchange: SubOption[]; similar: SubOption[] };

const sign = (v: number, unit: string) => (v === 0 ? `±0 ${unit}` : `${v > 0 ? '+' : '−'}${n(Math.abs(v), unit === 'kcal' ? 0 : 1)} ${unit}`);

/** Arkusz zamienników jednego składnika (lista wymienników z PDF + podobne produkty). */
export function IngredientSwapSheet({ recipeId, position, onPick, onClose, onDislike }: {
  recipeId: string; position: number; onPick: (o: SubOption) => void; onClose: () => void; onDislike?: (productId: string, name: string) => void;
}) {
  const meta = useMeta();
  const { data, error } = useApi<SubRes>(`/recipes/${recipeId}/substitutes/${position}`);
  const row = (o: SubOption) => (
    <button key={o.product_id} className="cand" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => { onPick(o); onClose(); }}>
      <div>
        <h4>{o.name} <span className="mono muted" style={{ fontSize: 13 }}>{n(o.amount_g, 0)} g</span></h4>
        <div className="chips" style={{ gap: 5 }}>
          <span className={`chip tiny ${Math.abs(o.delta.kcal) <= 15 ? 'good' : 'warn'}`}>{sign(o.delta.kcal, 'kcal')}</span>
          <span className="chip tiny">{sign(o.delta.protein_g, 'g B')}</span>
          {o.note && <span className="chip tiny">{o.note}</span>}
          {o.in_pantry && <span className="chip tiny good">masz w spiżarni</span>}
          {o.allergens.map((a) => <span key={a} className="chip tiny bad">{meta?.allergens.find((x) => x.id === a)?.name ?? a}</span>)}
        </div>
      </div>
      <span className="kcal">{o.recipe_kcal} <small>kcal</small></span>
    </button>
  );
  return (
    <Sheet onClose={onClose} kicker="Podmień składnik" title={data ? data.original.name : '…'}>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="muted" style={{ marginTop: -6 }}>
            W przepisie: <span className="num">{n(data.original.amount_g ?? 0, 0)} g</span>. Gramaturę zamiennika dobieramy tak, żeby danie miało podobne kalorie (a przy mięsie, rybach i nabiale – podobne białko).
          </p>
          {data.exchange.length > 0 && (
            <section className="section" style={{ marginTop: 18 }}>
              <div className="kicker">Z listy wymienników dietetyka</div>
              {data.exchange.map(row)}
            </section>
          )}
          <section className="section" style={{ marginTop: 18 }}>
            <div className="kicker">Podobne produkty</div>
            {data.similar.length ? data.similar.map(row) : <p className="muted">Brak sensownych zamienników w tej kategorii.</p>}
          </section>
          {onDislike && (
            <div style={{ marginTop: 18 }}>
              <button className="btn link small" onClick={() => { onDislike(data.original.product_id, data.original.name); onClose(); }}>
                Nie lubię: {data.original.name} – omijaj w jadłospisach
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
