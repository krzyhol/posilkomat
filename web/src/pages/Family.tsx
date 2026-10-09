import { useState } from 'react';
import { api, useApi, type Profile } from '../api.ts';
import { n } from '../format.ts';
import { href } from '../router.tsx';
import { ErrorBox, Icon, Loading, useToast } from '../components/ui.tsx';
import { YouTabs } from './Settings.tsx';

export type Member = { id: number; name: string; target_kcal: number; position: number };

export default function Family() {
  const toast = useToast();
  const { data, error, setData } = useApi<Member[]>('/household');
  const profile = useApi<Profile>('/settings');
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('2000');
  if (error) return <ErrorBox error={error} />;
  if (!data || !profile.data) return <Loading />;
  const me = profile.data.target_kcal;

  const add = async () => {
    setData(await api<Member[]>('/household', { body: { name, target_kcal: Number(kcal) } }));
    toast(`${name} dołącza do stołu.`);
    setName('');
  };
  const update = async (m: Member, patch: Partial<Member>) => setData(await api<Member[]>(`/household/${m.id}`, { method: 'PATCH', body: patch }));
  const remove = async (m: Member) => setData(await api<Member[]>(`/household/${m.id}`, { method: 'DELETE' }));
  const share = (k: number) => Math.max(0.25, Math.round((k / me) * 20) / 20);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">Ty</div>
          <h1 style={{ marginTop: 10 }}>Jeden garnek, <em>różne talerze</em>.</h1>
          <p className="lede">Wszyscy jedzą to samo, ale każdy dostaje porcję na miarę swojego celu kalorii. Lista zakupów i dzień gotowania liczą porcje całej rodziny.</p>
        </div>
      </header>
      <YouTabs on="family" />

      <div className="two-col">
        <section className="stack" style={{ gap: 10 }}>
          <div className="card" style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'center' }}>
            <div><b>{profile.data.name?.trim() || 'Ty'}</b> <small className="muted">· cel ustawiasz w Profilu</small></div>
            <span className="num">{me} kcal</span>
            <span className="chip tiny">×1</span>
          </div>
          {data.map((m) => (
            <div key={m.id} className="card" style={{ padding: '10px 16px', display: 'grid', gridTemplateColumns: '1fr 110px auto auto', gap: 12, alignItems: 'center' }}>
              <input className="input" defaultValue={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && update(m, { name: e.target.value })} aria-label="Imię" />
              <input className="input num" inputMode="numeric" defaultValue={m.target_kcal} key={`${m.id}-${m.target_kcal}`}
                onBlur={(e) => Number(e.target.value) !== m.target_kcal && update(m, { target_kcal: Number(e.target.value) })} aria-label={`Cel kalorii: ${m.name}`} />
              <span className="chip tiny">×{n(share(m.target_kcal), 2)}</span>
              <button className="icon-btn" onClick={() => remove(m)} aria-label={`Usuń: ${m.name}`}><Icon.x /></button>
            </div>
          ))}
          <div className="card pad row" style={{ alignItems: 'end' }}>
            <label className="field" style={{ flex: '1 1 160px' }}><span>Imię</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Ania" /></label>
            <label className="field" style={{ width: 130 }}><span>Cel (kcal)</span><input className="input num" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value.replace(/\D/g, ''))} /></label>
            <button className="btn" onClick={add} disabled={!name.trim() || !kcal}><Icon.plus />Dodaj</button>
          </div>
        </section>
        <aside className="card pad">
          <div className="kicker">Jak liczymy</div>
          <p style={{ fontSize: 14 }}>Przelicznik to cel domownika podzielony przez cel jadłospisu, zaokrąglony do 0,05 – np. 1800 / 2200 ≈ ×0,8.</p>
          <p className="muted" style={{ fontSize: 13 }}>Nowe jadłospisy zapamiętują domowników. W istniejącym jadłospisie kliknij „Odśwież domowników”. Ograniczenia (alergeny, „nie lubię”) dotyczą całego menu.</p>
          <a className="btn small ghost" href={href('/jadlospis/nowy')}><Icon.plan />Ułóż jadłospis dla rodziny</a>
        </aside>
      </div>
    </>
  );
}
