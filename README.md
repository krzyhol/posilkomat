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
| **Spiżarnia** | zapasy z ilością (albo „mam”) i terminem; lista zakupów odejmuje to, co masz, a „kupione → do spiżarni” uzupełnia zapasy; zjedzone posiłki zużywają je same; **„co ugotuję z tego, co mam”** – przepisy z największą częścią składników w spiżarni, wyżej te ratujące produkty z krótkim terminem (+ AI z zapasów) |
| **Podmiana składnika** | przy każdym składniku przepisu: zamienniki z listy wymienników dietetyka i podobne produkty z katalogu; gramatura wyrównuje kalorie (a przy mięsie, rybach i nabiale – białko); kilka podmian naraz → „mój wariant” z makro z PDF + różnica; otwarte z jadłospisu podmienia od razu posiłek |
| **Dzień gotowania** | z dni jadłospisu: piekarnik i garnki równolegle, kasze/ryż gotowane razem dla kilku dań, białko, dania na płycie, sosy, krojenie; etykiety pudełek – lodówka albo zamrażarka wg trwałości (ryby 2, mięso 3, reszta 4 dni) z datą rozmrożenia; owsianki na noc „wieczór przed”; wydruk |
| **Waga** | pomiary wagi i talii, trend (średnia wykładnicza), tempo z regresji 3 tygodni, czas do celu i **korekta celu kalorii** (7700 kcal/kg, maks. ±300 kcal naraz); wykres z podglądem |
| **Poza planem** | „zjadłem coś spoza planu”: opis albo zdjęcie (AI szacuje kalorie i makro), kod kreskowy albo ręcznie; „zamiast posiłku” i **wyrównanie reszty dnia** – porcje pozostałych posiłków dopasowują się do celu |
| **Skaner kodów** | aparat (BarcodeDetector albo ZXing w WebAssembly) albo wpisany kod → katalog → Open Food Facts → wartości z etykiety; w spiżarni i przy posiłku spoza planu |
| **Nie lubię** | produkty i dania omijane w nowych jadłospisach, podmianach, propozycjach i przez AI; podpowiedzi z często pomijanych i podmienianych dań |
| **Rodzina** | domownicy z własnym celem kalorii – wspólne menu, porcje każdej osoby na bileciku; zakupy i dzień gotowania liczą sumę porcji |
| **Ty** | cel kcal (z kalkulatorem Mifflina–St Jeora), dieta, wykluczone alergeny; zakładki Waga, Nie lubię, Rodzina |

## Architektura

```
data/seed/*.json        dane startowe (przepisy, produkty, jadłospisy PDF, słowniki) – wynik importu PDF
db/schema.sql           schemat SQLite (wyszukiwanie po nazwie i składnikach, widoki sum dziennych i zapotrzebowania)
db/seed.ts              JSON → SQLite
server/migrations.ts    migracje (PRAGMA user_version) – także dla bazy zapisanej w przeglądarce
server/                 API (TypeScript uruchamiany bezpośrednio przez Node)
  store.ts              dostęp do bazy niezależny od silnika (node:sqlite / sql.js)
  routes.ts             trasy API – wspólne dla serwera i wersji w przeglądarce
  catalog.ts            produkty, przepisy, wyszukiwanie, wyliczanie makro/diet/alergenów
  planner.ts            układanie jadłospisów, szablony, resztki, ranking podmian
  shopping.ts           lista zakupów: sumowanie, rozwijanie półproduktów, miary domowe, alejki, spiżarnia
  pantry.ts             spiżarnia i „co ugotuję z tego, co mam”
  substitutes.ts        podmiana składnika i warianty przepisów
  prep.ts               dzień gotowania
  weight.ts             dziennik wagi, trend, korekta celu
  extras.ts             posiłki spoza planu, wyrównanie dnia
  household.ts          tryb rodzinny
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

Zrobione z poprzedniej listy: spiżarnia, podmiana składnika, dzień gotowania, dziennik wagi, posiłek spoza planu, skaner kodów, „nie lubię”, tryb rodzinny. Dalej:

1. **Budżet** – szacowany koszt tygodnia i tańsze zamienniki (ceny z marketów), sortowanie podmian po cenie.
2. **Tryb gotowania** na pełnym ekranie z minutnikami w krokach (pole `timer_min` jest w schemacie) i blokadą wygaszania ekranu.
3. **Nawyki i wyzwania** – woda, warzywa w każdym posiłku, 30-dniowe serie.
4. **PWA offline + przypomnienia** („wyjmij z zamrażarki”, „namocz daktyle”) i eksport jadłospisu do PDF.
5. **Synchronizacja** wersji z GitHub Pages między urządzeniami (eksport/import pliku bazy albo konto).
6. **Cele i alergeny per domownik** – np. jedno dziecko bez orzechów, a reszta bez ograniczeń (warianty dania tylko dla niej).

## Uwagi o danych

- Kategorie sklepowe, alergeny, tagi diet i smaku są wyliczane regułami z nazw produktów (`tools/import-pdf/products_rules.py`). Przy produktach markowych warto sprawdzić etykietę.
- Wartości odżywcze produktów ogólnych pochodzą z tabel referencyjnych. Produkty markowe są dopasowane do makro przepisów z PDF albo oszacowane.
- Przepisy bazowe półproduktów (ciasto naleśnikowe, focaccia) dopisało AI, z proporcjami dobranymi do wartości z PDF.
