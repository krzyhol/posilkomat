import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useRoute, href } from './router.tsx';
import { STATIC } from './api.ts';
import { Icon, ToastProvider } from './components/ui.tsx';
import Today from './pages/Today.tsx';
import { PlansList, PlanDetail, PlanWizard } from './pages/Plans.tsx';
import { RecipesList, RecipeDetail } from './pages/Recipes.tsx';
import RecipeEditor from './pages/RecipeEditor.tsx';
import AiKitchen from './pages/AiKitchen.tsx';
import { ShoppingLists, ShoppingDetail } from './pages/Shopping.tsx';
import Settings from './pages/Settings.tsx';
import Pantry from './pages/Pantry.tsx';
import PrepDay from './pages/PrepDay.tsx';

const NAV = [
  { path: '/', label: 'Dziś', short: 'Dziś', icon: Icon.today, match: (p: string) => p === '/' },
  { path: '/jadlospis', label: 'Jadłospis', short: 'Plan', icon: Icon.plan, match: (p: string) => p.startsWith('/jadlospis') },
  { path: '/przepisy', label: 'Przepisy', short: 'Przepisy', icon: Icon.book, match: (p: string) => p.startsWith('/przepisy') },
  { path: '/ai', label: 'Kuchnia AI', short: 'AI', icon: Icon.spark, match: (p: string) => p.startsWith('/ai') },
  { path: '/zakupy', label: 'Zakupy', short: 'Zakupy', icon: Icon.cart, match: (p: string) => p.startsWith('/zakupy') || p.startsWith('/spizarnia') },
  { path: '/ustawienia', label: 'Ustawienia', short: 'Ty', icon: Icon.cog, match: (p: string) => p.startsWith('/ustawienia') },
];

function Page() {
  const { path, parts, query } = useRoute();
  const [a, b] = parts;
  let page;
  const [, , c] = parts;
  if (!a) page = <Today />;
  else if (a === 'jadlospis' && b && c === 'gotowanie') page = <PrepDay key={b} planId={b} />;
  else if (a === 'jadlospis') page = !b ? <PlansList /> : b === 'nowy' ? <PlanWizard templateId={query.get('template')} /> : <PlanDetail key={b} id={b} />;
  else if (a === 'przepisy') page = !b ? <RecipesList /> : b === 'nowy' ? <RecipeEditor /> : <RecipeDetail key={b} id={b} mealId={query.get('meal') ? Number(query.get('meal')) : null} />;
  else if (a === 'ai' && STATIC) page = <div className="empty"><h3>Kuchnia AI działa w wersji lokalnej</h3><p>Na GitHub Pages nie ma serwera, który mógłby bezpiecznie trzymać klucz do Claude API.</p><a className="btn" href={href('/przepisy')}>Przeglądaj przepisy</a></div>;
  else if (a === 'ai') page = <AiKitchen key={query.get('base') ?? ''} baseId={query.get('base')} initialPrompt={query.get('prompt')} initialPantry={query.get('pantry')} />;
  else if (a === 'zakupy') page = !b ? <ShoppingLists /> : <ShoppingDetail key={b} id={b} />;
  else if (a === 'spizarnia') page = <Pantry />;
  else if (a === 'ustawienia') page = <Settings />;
  else page = <div className="empty"><h3>Tu nic nie ma</h3><a href={href('/')}>Wróć na dziś</a></div>;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Główna nawigacja">
        <div className="brand">
          <div className="word">Posiłko<b>mat</b></div>
          <div className="sub">automat do jadłospisów</div>
        </div>
        {NAV.filter((n) => !(STATIC && n.path === '/ai')).map((n) => (
          <a key={n.path} href={href(n.path)} className={n.match(path) ? 'on' : ''} aria-current={n.match(path) ? 'page' : undefined}>
            <n.icon /><span className="lbl">{n.label}</span><span className="lbl-s">{n.short}</span>
          </a>
        ))}
        <div className="foot brand">{STATIC ? 'wersja w przeglądarce · dane zostają na tym urządzeniu' : 'przepisy z 18 jadłospisów PDF + Twoja kuchnia'}</div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><Page /></ToastProvider>
  </StrictMode>,
);
