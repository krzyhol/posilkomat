"""Base recipes (przepisy bazowe) for semi-finished products the diet PDFs use without describing.

Each one produces a product from the catalogue (`produces`); the product's nutrition is then calculated
from these ingredients, and a shopping list can expand the product into raw ingredients.
Amounts were chosen so the calculated nutrition matches what the PDF recipes imply
(e.g. pancake batter ≈ 130 kcal / 100 g, i.e. the PDFs weigh raw batter, ~90 g per pancake).
Ingredient tuples: (product name, grams, household qty | None, household unit | None)
"""

BASE_RECIPES = [
    {
        'produces': 'Ciasto do naleśników',
        'name': 'Ciasto do naleśników – przepis bazowy',
        'description': 'Klasyczne ciasto naleśnikowe na mleku. Z porcji wychodzi ok. 5 naleśników (ok. 90 g ciasta na sztukę).',
        'pieces': 5, 'piece_unit': 'sztuka',
        'ingredients': [
            ('Mąka pszenna typ 500', 100, 10, 'łyżka'),
            ('Mleko 1,5%', 250, 1, 'szklanka'),
            ('Jajko kurze całe', 56, 1, 'sztuka'),
            ('Woda', 50, 0.2, 'szklanka'),
            ('Olej rzepakowy', 5, 1, 'łyżeczka'),
            ('Sól', 0.25, 1, 'szczypta'),
        ],
        'steps': [
            'Do miski wbijamy jajko, dodajemy mleko, wodę i szczyptę soli. Roztrzepujemy trzepaczką.',
            'Stopniowo wsypujemy mąkę, cały czas mieszając, aż ciasto będzie gładkie i bez grudek. Na koniec dodajemy olej.',
            'Odstawiamy ciasto na 15 minut, żeby mąka napęczniała. Ciasto powinno mieć konsystencję płynnej śmietanki – jeżeli jest za gęste, dolewamy odrobinę wody.',
            'Rozgrzewamy patelnię do naleśników na średnim ogniu. Wlewamy ok. 90 g ciasta (niepełna chochla) i rozprowadzamy ruchem koła po całej powierzchni.',
            'Smażymy ok. 1–2 minuty, aż brzegi zaczną odchodzić od patelni, przewracamy i smażymy jeszcze ok. 30–60 sekund.',
        ],
    },
    {
        'produces': 'Ciasto do naleśników lekkostrawnych',
        'name': 'Ciasto do naleśników lekkostrawnych – przepis bazowy',
        'description': 'Cieńsze naleśniki z mniejszą ilością mąki i większą ilością jajek, smażone bez tłuszczu. Z porcji wychodzi ok. 6–7 naleśników (ok. 65 g ciasta na sztukę).',
        'pieces': 6, 'piece_unit': 'sztuka',
        'ingredients': [
            ('Mąka pszenna typ 500', 70, 7, 'łyżka'),
            ('Mleko 1,5%', 200, 0.8, 'szklanka'),
            ('Jajko kurze całe', 112, 2, 'sztuka'),
            ('Woda', 50, 0.2, 'szklanka'),
            ('Olej rzepakowy', 5, 1, 'łyżeczka'),
            ('Sól', 0.25, 1, 'szczypta'),
        ],
        'steps': [
            'Jajka roztrzepujemy z mlekiem, wodą i szczyptą soli.',
            'Stopniowo dodajemy mąkę, mieszając trzepaczką do uzyskania gładkiego, rzadkiego ciasta. Dodajemy olej i mieszamy.',
            'Odstawiamy na 10 minut.',
            'Smażymy na dobrze rozgrzanej patelni z powłoką nieprzywierającą, bez dodatku tłuszczu: wlewamy ok. 65 g ciasta, rozprowadzamy cienko i smażymy ok. 1 minuty z każdej strony.',
        ],
    },
    {
        'produces': 'Ciasto do naleśników wegańskie',
        'name': 'Ciasto do naleśników wegańskie – przepis bazowy',
        'description': 'Naleśniki na napoju sojowym, bez jajek, z dodatkiem mąki pełnoziarnistej. Z porcji wychodzi ok. 4 naleśników (ok. 106 g ciasta na sztukę).',
        'pieces': 4, 'piece_unit': 'sztuka',
        'ingredients': [
            ('Mąka pszenna pełnoziarnista', 50, 5, 'łyżka'),
            ('Mąka pszenna typ 500', 50, 5, 'łyżka'),
            ('Napój sojowy', 250, 1, 'szklanka'),
            ('Woda', 100, 0.4, 'szklanka'),
            ('Olej rzepakowy', 10, 1, 'łyżka'),
            ('Sól', 0.25, 1, 'szczypta'),
        ],
        'steps': [
            'Obie mąki mieszamy w misce ze szczyptą soli.',
            'Wlewamy napój sojowy i wodę, mieszamy trzepaczką do uzyskania gładkiego ciasta bez grudek. Dodajemy olej.',
            'Odstawiamy ciasto na 20 minut – mąka pełnoziarnista potrzebuje więcej czasu, żeby napęcznieć. Jeżeli ciasto zgęstnieje, dolewamy odrobinę wody.',
            'Smażymy na rozgrzanej patelni: wlewamy ok. 106 g ciasta, rozprowadzamy i smażymy ok. 2 minuty, aż spód się zetnie, a następnie przewracamy i smażymy jeszcze ok. 1 minuty. Wegańskie naleśniki są delikatniejsze – przewracamy je dopiero, gdy brzegi wyraźnie odchodzą od patelni.',
        ],
    },
    {
        'produces': 'Focaccia - przepis podstawowy',
        'name': 'Focaccia – przepis bazowy',
        'description': 'Prosta focaccia na suchych drożdżach. Gramatura w przepisach odnosi się do masy surowych składników (ok. 550 g, czyli 4 porcje po ok. 135 g).',
        'pieces': 4, 'piece_unit': 'porcja',
        'ingredients': [
            ('Mąka pszenna typ 550', 300, 2, 'szklanka'),
            ('Woda', 220, 0.9, 'szklanka'),
            ('Drożdże suszone', 5, 1, 'łyżeczka'),
            ('Oliwa z oliwek', 20, 2, 'łyżka'),
            ('Sól', 6, 1, 'łyżeczka'),
        ],
        'steps': [
            'W misce mieszamy mąkę z drożdżami i solą. Wlewamy letnią wodę oraz połowę oliwy i mieszamy łyżką, aż powstanie lepkie, luźne ciasto.',
            'Przykrywamy miskę i odstawiamy na ok. 1,5–2 godziny w ciepłe miejsce, aż ciasto podwoi objętość.',
            'Formę ok. 20 × 30 cm smarujemy połową pozostałej oliwy. Przekładamy ciasto i delikatnie rozciągamy je dłońmi do brzegów formy. Odstawiamy na kolejne 30 minut.',
            'Rozgrzewamy piekarnik do 220 stopni. Palcami robimy w cieście charakterystyczne dołki i skrapiamy resztą oliwy.',
            'Pieczemy ok. 20–25 minut, aż focaccia będzie złocista. Studzimy na kratce i kroimy na 4 porcje.',
        ],
    },
    {
        'produces': 'Focaccia z oliwkami, rozmarynem i skórką z cytryny',
        'name': 'Focaccia z oliwkami, rozmarynem i skórką z cytryny – przepis bazowy',
        'description': 'Wariant focaccii bazowej z dodatkami. Gramatura odnosi się do masy surowych składników (ok. 630 g, czyli 5 porcji po ok. 125 g).',
        'pieces': 5, 'piece_unit': 'porcja',
        'ingredients': [
            ('Mąka pszenna typ 550', 300, 2, 'szklanka'),
            ('Woda', 220, 0.9, 'szklanka'),
            ('Drożdże suszone', 5, 1, 'łyżeczka'),
            ('Oliwa z oliwek', 30, 3, 'łyżka'),
            ('Sól', 6, 1, 'łyżeczka'),
            ('Oliwki zielone', 60, 12, 'sztuka'),
            ('Rozmaryn suszony', 2, 1, 'łyżeczka'),
            ('Skórka z cytryny', 5, 1, 'łyżeczka'),
        ],
        'steps': [
            'Przygotowujemy ciasto jak w focaccii bazowej: mąkę mieszamy z drożdżami i solą, dodajemy letnią wodę i połowę oliwy, mieszamy i odstawiamy do wyrośnięcia na ok. 1,5–2 godziny.',
            'Oliwki kroimy na połówki. Skórkę z cytryny ścieramy na drobnej tarce (tylko żółtą część).',
            'Ciasto przekładamy do formy wysmarowanej oliwą, rozciągamy i odstawiamy na 30 minut.',
            'Robimy palcami dołki, wciskamy w nie oliwki, posypujemy rozmarynem i skórką z cytryny, skrapiamy resztą oliwy.',
            'Pieczemy w 220 stopniach przez ok. 20–25 minut, aż focaccia będzie złocista. Studzimy na kratce i kroimy na 5 porcji.',
        ],
    },
]
