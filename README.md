# Posiłkomat

Automat do jadłospisów: układa tydzień z 868 przepisów z dietetycznych jadłospisów PDF, podmienia posiłki jednym kliknięciem, robi listę zakupów ułożoną alejkami sklepu, a nowe dania wymyśla z Claude.

## Uruchomienie

Wymaga Node.js 24+ (wbudowany `node:sqlite`).

```bash
npm install
npm run dev
```

Otwórz http://localhost:5173. Przy pierwszym starcie serwer sam tworzy bazę `data/posilkomat.db` z danych startowych w `data/seed/`.

Kuchnia AI potrzebuje klucza do Claude API, który trzeba ustawić przed startem serwera:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Wersja produkcyjna (jeden serwer na porcie 5174, który serwuje też frontend):

```bash
npm run build
npm start
```

Pozostałe skrypty: `npm run db:reset` (baza od nowa z danych startowych) i `npm run typecheck`.

### Wersja online (GitHub Pages)

https://krzyhol.github.io/posilkomat/ – budowana automatycznie przy każdym pushu na `main` (`.github/workflows/pages.yml`).

Ta wersja działa bez serwera: ta sama logika API (`server/routes.ts`) uruchamia się w przeglądarce na bazie SQLite w WebAssembly (sql.js), a jadłospisy, listy zakupów i własne przepisy zapisują się w IndexedDB tej przeglądarki (Ustawienia → „Wyczyść moje dane”). Kuchnia AI jest tu wyłączona, bo strona statyczna nie może bezpiecznie trzymać klucza API.

Lokalny podgląd wersji statycznej: `npm run build:static && npm run preview:static` → http://localhost:4173/posilkomat/

## Co potrafi

| Ekran | Funkcje |
|---|---|
| **Dziś** | posiłki dnia jako bileciki z godzinami, linijka kalorii (zaplanowane / zjedzone / cel), paski makro, odhaczanie „ZJEDZONE”, pomijanie |
| **Jadłospis** | kreator: automatycznie pod cel kcal, dietę, alergeny i wybrane posiłki **albo** kopia jednego z 18 jadłospisów PDF z przeskalowaniem porcji; widok dnia i tygodnia; **gotowanie na zapas**: danie na 2+ porcje wraca kolejnego dnia jako resztki i nie jest liczone drugi raz w zakupach |
| **Podmiana** | ranking zamienników o podobnych kaloriach z powodami („−12 kcal”, „też na słodko”, „5 składników już na liście”, „już jest w tym tygodniu”), filtry, wyszukiwanie, „Wylosuj”; kaloryczność wyrównujemy porcją |
| **Przepisy** | wyszukiwanie pełnotekstowe po nazwie i składnikach (działa też bez polskich znaków), filtry: pora, smak, dieta, typ dania, kcal, źródło, ulubione; karta przepisu z przeliczaniem porcji, trybem gotowania (odhaczanie kroków), przepisami bazowymi, alergenami |
| **Własny przepis** | składniki z katalogu (podpowiedzi), gramy wyliczane z miar domowych, kalorie i makro liczone na żywo |
| **Kuchnia AI** | nowy przepis z opisu („coś z ciecierzycą do 20 minut”, „mam w lodówce…”) albo przeróbka istniejącego (wegańska, lżejsza, więcej białka); przed zapisem widzisz, które składniki są w katalogu, a które dojdą jako nowe produkty |
| **Zakupy** | lista z wybranych dni jadłospisu jako paragon: suma po produktach × liczba osób, półprodukty rozpisane na surowce, podpowiedzi „≈ 3 sztuki”, przyprawy zwinięte w „Pewnie masz w domu”, dopisywanie, kopiowanie do schowka |
| **Ustawienia** | cel kcal (z kalkulatorem Mifflina–St Jeora), liczba osób, dieta, wykluczone alergeny |

## Architektura

```
data/seed/*.json        dane startowe (przepisy, produkty, jadłospisy PDF, słowniki) – wynik importu PDF
db/schema.sql           schemat SQLite (wyszukiwanie po nazwie i składnikach, widoki sum dziennych i zapotrzebowania)
db/seed.ts              JSON → SQLite
server/                 API (TypeScript uruchamiany bezpośrednio przez Node)
  store.ts              dostęp do bazy niezależny od silnika (node:sqlite / sql.js)
  routes.ts             trasy API – wspólne dla serwera i wersji w przeglądarce
  catalog.ts            produkty, przepisy, wyszukiwanie, wyliczanie makro/diet/alergenów
  planner.ts            układanie jadłospisów, szablony, resztki, ranking podmian
  shopping.ts           lista zakupów: sumowanie, rozwijanie półproduktów, miary domowe, alejki
  ai.ts                 Claude (claude-opus-5-5, structured outputs, fallback przy odmowie, cache katalogu)
web/                    React + Vite (web/src/local – silnik dla wersji bez serwera)
schema/                 JSON Schema danych startowych i formatu odpowiedzi AI (RecipeDraft)
tools/import-pdf/       import PDF → data/seed (Python)
```

Konwencje danych:
- Gramy są źródłem prawdy. Ilości w przepisie są na cały przepis, makro przepisu na 1 porcję, makro produktu na 100 g.
- Węglowodany są podawane ogółem (z błonnikiem), tak jak w PDF.
- Każdy produkt ma źródło wartości odżywczych: `reference`, `derived_from_recipes`, `estimate`, `calculated_from_base_recipe` albo `ai_estimate`.

## Kolejne funkcjonalności – propozycje

Inspiracje z Respo, Lifesum, Dr Lifestyle, Diet & Training by Ann i Fit Foczek, dopasowane do tego, co już jest w danych:

1. **Spiżarnia i „co ugotuję z tego, co mam”.** Stan lodówki odejmowany od listy zakupów, podmiany preferujące produkty, które się kończą, a AI dostaje zawartość spiżarni w prompcie.
2. **Podmiana pojedynczego składnika.** Lista wymienników z PDF jest już w bazie (`substitution_groups`). Podmiana „orzechy włoskie → pestki dyni” z przeliczeniem makro.
3. **Dzień gotowania (meal prep).** Z jadłospisu z resztkami generujemy jeden plan na niedzielę: co ugotować, w jakiej kolejności, co do pudełek.
4. **Dziennik wagi i obwodów** z linią trendu i podpowiedzią korekty celu kcal co 2 tygodnie.
5. **Posiłek spoza planu.** Szybkie „zjadłem pizzę na mieście”: AI szacuje kalorie z opisu lub zdjęcia, a jadłospis wyrównuje resztę dnia.
6. **Skaner kodów kreskowych** (Open Food Facts) do dodawania produktów markowych z etykietą zamiast szacunku.
7. **Lista „nie lubię”.** Wykluczanie produktów (np. koperek, tuńczyk) w układaniu i podmianach oraz nauka z ocen i pominiętych posiłków.
8. **Tryb rodzinny.** Wspólne menu, ale porcje skalowane do celu każdego domownika; współdzielona lista zakupów na żywo.
9. **Budżet.** Szacowany koszt tygodnia i tańsze zamienniki (ceny Biedronka/Lidl).
10. **Tryb gotowania** na pełnym ekranie z minutnikami w krokach (pole `timer_min` jest już w schemacie) i blokadą wygaszania ekranu.
11. **Nawyki i wyzwania**: woda, warzywa w każdym posiłku, 30-dniowe serie.
12. **PWA offline + przypomnienia** („wyjmij mięso z zamrażarki”, „namocz daktyle na jutro”) i eksport jadłospisu do PDF.

## Uwagi o danych

- Kategorie sklepowe, alergeny, tagi diet i smaku są wyliczane regułami z nazw produktów (`tools/import-pdf/products_rules.py`). Przy produktach markowych warto sprawdzić etykietę.
- Wartości odżywcze produktów ogólnych pochodzą z tabel referencyjnych. Produkty markowe są dopasowane do makro przepisów z PDF albo oszacowane.
- Przepisy bazowe półproduktów (ciasto naleśnikowe, focaccia) dopisało AI, z proporcjami dobranymi do wartości z PDF.
