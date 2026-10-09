# Import przepisów z PDF

Jednorazowy import jadłospisów PDF do danych startowych (`data/seed/*.json`), z których `db/seed.ts` tworzy bazę SQLite.

```
pip install pypdf
python extract.py <katalog z dieta (N).pdf> txt   # PDF -> tekst
python parse.py txt raw.json                      # tekst -> surowe wystąpienia posiłków
python build.py raw.json ../../data/seed          # deduplikacja, katalog produktów, wartości odżywcze, przepisy bazowe, plany
python nutrition.py ../../data/seed               # raport: kalorie liczone z produktów vs podane w PDF
```

| Plik | Co robi |
|---|---|
| `products_rules.py` | scalanie nazw produktów, kategorie sklepowe, pochodzenie (diety), alergeny |
| `nutrition_values.py` | wartości odżywcze na 100 g dla każdego produktu (tabele referencyjne / szacunki) |
| `nutrition.py` | wyliczanie półproduktów z przepisów bazowych i „wsteczne” dopasowanie produktów markowych do makro z PDF |
| `base_recipes.py` | przepisy bazowe półproduktów (ciasto naleśnikowe ×3, focaccia ×2) |

Kalibracja (kalorie przepisu policzone z produktów względem PDF): mediana 0,995; 837/868 przepisów w ±10%, 726 w ±5%.
