import { useState } from 'react';
import { api, useApi, type ShoppingList, type ShoppingItem } from '../api.ts';
import { dayMonth, n, plural } from '../format.ts';
import { go, href } from '../router.tsx';
import { ErrorBox, Icon, Loading, useToast } from '../components/ui.tsx';

type ListRow = { id: string; name: string; created_at: string; total: number; checked: number; date_from: string | null; date_to: string | null };

export function ShoppingLists() {
  const { data, error } = useApi<ListRow[]>('/shopping-lists');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Zakupy</div>
          <h1 style={{ marginTop: 10 }}>Listy <em>zakupów</em>.</h1>
          <p className="lede">Listę robisz z jadłospisu – wybierasz dni, a my sumujemy składniki i układamy je alejkami.</p>
        </div>
        <a className="btn tomato" href={href('/jadlospis')}><Icon.plan />Wybierz jadłospis</a>
      </header>
      {!data.length && <div className="empty"><h3>Jeszcze nic nie kupujesz</h3><p>Otwórz jadłospis i kliknij „Lista zakupów”.</p></div>}
      <div className="grid-2">
        {data.map((l) => (
          <a key={l.id} className="card pad" href={href(`/zakupy/${l.id}`)} style={{ textDecoration: 'none' }}>
            <h3 style={{ fontSize: 18 }}>{l.name}</h3>
            <p className="muted mono" style={{ fontSize: 12.5, margin: '8px 0 10px' }}>
              {l.date_from && l.date_to ? `${dayMonth(l.date_from)} – ${dayMonth(l.date_to)} · ` : ''}{l.checked}/{l.total} w koszyku
            </p>
            <div className="mbar" style={{ gridTemplateColumns: '1fr' }}><div className="t"><div style={{ width: `${(l.checked / Math.max(1, l.total)) * 100}%`, background: 'var(--dill)' }} /></div></div>
          </a>
        ))}
      </div>
    </>
  );
}

const amount = (i: ShoppingItem) => (i.amount_g == null ? '' : i.amount_g >= 1000 ? `${n(i.amount_g / 1000, 2)} kg` : `${n(i.amount_g, i.amount_g < 10 ? 1 : 0)} g`);

export function ShoppingDetail({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, setData } = useApi<ShoppingList>(`/shopping-lists/${id}`);
  const [extra, setExtra] = useState('');
  const [showPantry, setShowPantry] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const toggle = async (it: ShoppingItem) => {
    // optymistycznie – odhaczanie w sklepie musi być natychmiastowe
    setData({
      ...data, checked: data.checked + (it.checked ? -1 : 1),
      groups: data.groups.map((g) => ({ ...g, items: g.items.map((x) => (x.id === it.id ? { ...x, checked: !x.checked } : x)) })),
    });
    await api(`/shopping-items/${it.id}`, { method: 'PATCH', body: { checked: !it.checked } });
  };
  const add = async () => {
    if (!extra.trim()) return;
    setData(await api<ShoppingList>(`/shopping-lists/${id}/items`, { body: { name: extra } }));
    setExtra('');
  };
  const copy = async () => {
    const text = data.groups.filter((g) => g.id !== 'pantry').map((g) =>
      `${g.name.toUpperCase()}\n${g.items.filter((i) => !i.checked).map((i) => `☐ ${i.name}${i.amount_g ? ` – ${amount(i)}` : ''}${i.household_hint ? ` (${i.household_hint})` : ''}`).join('\n')}`,
    ).join('\n\n');
    await navigator.clipboard.writeText(`${data.name}\n\n${text}`);
    toast('Skopiowane – wklej do SMS-a albo notatki.');
  };
  const remove = async () => {
    if (!confirm('Usunąć tę listę?')) return;
    await api(`/shopping-lists/${id}`, { method: 'DELETE' });
    go('/zakupy');
  };
  const pantry = data.groups.find((g) => g.id === 'pantry');

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <a className="btn link" href={href('/zakupy')}><Icon.back />Listy</a>
        <div className="row">
          <button className="btn small ghost" onClick={copy}><Icon.copy />Kopiuj</button>
          <button className="icon-btn" onClick={remove} aria-label="Usuń listę"><Icon.trash /></button>
        </div>
      </div>
      <div className="receipt">
        <div className="top">
          <div className="t">POSIŁKOMAT</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>{data.name}</div>
          {data.date_from && data.date_to && <div style={{ fontSize: 12 }}>{dayMonth(data.date_from)} – {dayMonth(data.date_to)}</div>}
        </div>
        {data.groups.filter((g) => g.id !== 'pantry').map((g) => (
          <section key={g.id}>
            <h4>{g.name}</h4>
            {g.items.map((i) => (
              <label key={i.id} className={`ritem ${i.checked ? 'done' : ''}`}>
                <input type="checkbox" checked={i.checked} onChange={() => toggle(i)} />
                <span className="nm">{i.name}</span>
                <span className="dots" />
                <span className="amt">{amount(i)}{i.household_hint && <small>{i.household_hint}</small>}</span>
              </label>
            ))}
          </section>
        ))}
        {pantry && (
          <section>
            <h4 style={{ cursor: 'pointer' }} onClick={() => setShowPantry(!showPantry)}>{pantry.name} · {pantry.items.length} {showPantry ? '▴' : '▾'}</h4>
            {showPantry && pantry.items.map((i) => (
              <label key={i.id} className={`ritem ${i.checked ? 'done' : ''}`}>
                <input type="checkbox" checked={i.checked} onChange={() => toggle(i)} />
                <span className="nm">{i.name}</span><span className="dots" /><span className="amt">{amount(i)}</span>
              </label>
            ))}
          </section>
        )}
        <div className="row" style={{ marginTop: 18, flexWrap: 'nowrap' }}>
          <input className="input" style={{ fontFamily: 'var(--sans)' }} placeholder="Dopisz, np. papier do pieczenia" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn small" onClick={add} aria-label="Dopisz"><Icon.plus /></button>
        </div>
        <div className="sum">
          <span>W KOSZYKU</span>
          <span>{data.checked}/{data.total} {plural(data.total, 'POZYCJA', 'POZYCJE', 'POZYCJI')}</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11.5, marginTop: 16, color: 'var(--muted)' }}>*** DZIĘKUJEMY, SMACZNEGO ***</div>
      </div>
    </>
  );
}
