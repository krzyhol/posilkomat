"""Product canonicalisation + classification rules (shopping category, origin, allergens)."""
import re

# explicit merges: raw ingredient name -> canonical product name
ALIASES = {
    'Czosnek świeży': 'Czosnek',
    'Curry przyprawa': 'Curry',
    'Gałka muszkatałowa': 'Gałka muszkatołowa',
    'Rogal croissaant z masłem': 'Rogal croissant z masłem',
    'Kasza gryczana niepalona (biała)': 'Kasza gryczana niepalona',
    'Kasza gryczana': 'Kasza gryczana palona',
    'Soczewica czerwona, nasiona suche': 'Soczewica czerwona',
    'Soczewica zielona, nasiona suche': 'Soczewica zielona',
    'Soczewica czarna, nasiona suche': 'Soczewica czarna',
    'Tahini klasyczne': 'Tahini',
    'Elios Tahini klasyczne': 'Tahini',
    'Fasolka szparagowa, mrożona': 'Fasola szparagowa',
    'Dorsz świeży': 'Dorsz',
    'Łosoś świeży (bez skóry)': 'Łosoś świeży',
    'Łosoś wędzony na zimno': 'Łosoś wędzony',
    'Pstrąg wędzony na zimno': 'Pstrąg wędzony',
    'Bulion warzywny (po rozrobieniu ze słoiczka)': 'Bulion warzywny',
    'Burak surowy': 'Burak',
    'Budyń w proszku (z cukrem)': 'Budyń w proszku',
    'Kakao gorzkie': 'Kakao',
    'Ser z niebieską pleśnią, Lazur': 'Ser z niebieską pleśnią',
    'Herbatniki pełnoziarniste Bonitki': 'Bonitki Kids Herbatniki',
    'Pudding proteinowy o smaku czekoladowym Go active': 'Pudding proteinowy o smaku czekoladowym Go Active',
    'Pudding proteinowy smak waniliowy Go active': 'Pudding proteinowy smak waniliowy Go Active',
    'Pudding proteinowy smak słony karmel Go active': 'Pudding proteinowy smak słony karmel Go Active',
    'Owolovo truskawkowo mus jabłkowo-truskawkowy': 'Owolovo truskawkowo mus jabłkowo-truskawkowy',
    'Koperek suszony': 'Koper suszony',
    'Kukurydza': 'Kukurydza (ziarno do popcornu)',  # used only in the popcorn recipe
    'Mąka pszenna, typ 550': 'Mąka pszenna typ 550',
    'Ser mozzarella kulka': 'Ser mozzarella',
    'Ser mozzarella kulka light': 'Ser mozzarella light',
    'Tapioka biała (Perełki)': 'Tapioka',
    'Skrobia ziemniaczana': 'Mąka ziemniaczana',
    'Wiśnie bez pestek, mrożone': 'Wiśnie',
    'Sok pomarańczowy świeży': 'Sok pomarańczowy',
    'Maślanka 1.5%': 'Maślanka 1,5%',
    'Kefir 1.5%': 'Kefir 1,5%',
    'Śmietanka 12%': 'Śmietana 12%',
    'Kumin': 'Kumin (kmin rzymski)',
    'Kminek mielony': 'Kumin (kmin rzymski)',
}

FRESH_FROZEN = re.compile(r',?\s+(śwież[aeyi]+|mrożon[aeyi]+)(\s+lub\s+(śwież|mrożon)[a-ząęóźżł]+)?$', re.I)


def canonical(name):
    n = ALIASES.get(name, name)
    n2 = FRESH_FROZEN.sub('', n).strip().rstrip(',')
    # keep meaningful "świeży"/"mrożony" distinctions (fresh vs dried, smoked fish, frozen-only products)
    if n2 in ('Bazylia', 'Kolendra', 'Tymianek', 'Łosoś', 'Pstrąg', 'Groszek', 'Mieszanka owocowa', 'Warzywa chińskie'):
        return n
    if n2 in ('Figi', 'Daktyle', 'Morele'):
        return n2 + ' świeże'
    if n2 == 'Ogórek':
        return 'Ogórek świeży'
    return ALIASES.get(n2, n2)


# shopping categories, in a typical store-walk order
CATEGORIES = [
    ('warzywa', 'Warzywa i zioła świeże'),
    ('owoce', 'Owoce'),
    ('pieczywo', 'Pieczywo'),
    ('nabial', 'Nabiał i jaja'),
    ('mieso', 'Mięso i wędliny'),
    ('ryby', 'Ryby i owoce morza'),
    ('roslinne', 'Tofu, hummus i produkty roślinne'),
    ('zboza', 'Kasze, ryż, makarony i płatki'),
    ('pieczenie', 'Mąki, słodziki i do pieczenia'),
    ('konserwy', 'Strączki, konserwy i przetwory'),
    ('orzechy', 'Orzechy, nasiona i bakalie'),
    ('przyprawy', 'Przyprawy i zioła suszone'),
    ('oleje_sosy', 'Oleje, octy, sosy i smarowidła'),
    ('slodycze', 'Słodycze i przekąski'),
    ('produkty_proteinowe', 'Produkty gotowe: proteinowe, desery, smoothie'),
    ('napoje', 'Napoje i soki'),
    ('mrozonki_gotowe', 'Mrożonki i dania gotowe'),
    ('polprodukty', 'Półprodukty (przygotuj wg przepisu bazowego)'),
    ('inne', 'Inne'),
]

# ordered rules: first match wins. (regex on canonical name, category)
RULES = [
    (r'^(Woda|Lód, kostki|Napar z kawy)', 'napoje'),
    (r'^(Sok z cytryny|Sok z limonki)', 'owoce'),
    (r'^(Hummus|Mleko roślinne|Mleko migdałowe|Napój sojowy)', 'roslinne'),
    (r'^(Ciasto do naleśników|Focaccia)', 'polprodukty'),
    (r'^(Pudding proteinowy|Deser twarogowy High|High protein dessert|High Protein Serek|Kaszka|Napój (mleczny )?proteinowy|Odżywka białkowa|Drink this food|Koktajl odżywczy|Jogurt proteinowy|Jogurt high protein|Kvarg|Skyr waniliowy Fruvita|Jogurt skyr waniliowy Pilos|Danone YoPro|YoPro|Big milk|Mleko wysokobiałkowe|Alpro sojowe wysokobiałkowe|Riso Lubella|Owsianka |Proteinowa granola|Deli & fruits|Kajmak|Day up|FOODINI|Jogurt pitny|Tymbark Musly|Smoothie|Owsiane smoothie|Solevita|Fruvita pure|bio mus|Owolovo|Owolowo|Frulove|Smoothie baton|Granola)', 'produkty_proteinowe'),
    (r'^(Sok |Woda kokosowa|Kawa zbożowa|Herbata|Kawa|Napary)', 'napoje'),
    (r'^(Zupa|Warzywa chińskie mrożone|Mrożonka|Mieszanka owocowa mrożona|Groszek mrożony|Warzywa chińskie|Gnocchi|Kopytka|Kluski leniwe|Kluska na parze|Świeże tortel|Kotlety sojowe|Kiełbaski roślinne|Plastry wegańskie|Pinsa|Ciasto francuskie)', 'mrozonki_gotowe'),
    (r'^(Sok z cytryny|Sok z limonki)', 'owoce'),
    (r'^(Tofu|Tempeh|Seitan|Granulat sojowy|Jogurt roślinny|Jogurt skyr sojowy|Śmietana wegańska|Majonez wegański|Mleko roślinne|Napój sojowy|Płatki drożdżowe)', 'roslinne'),
    (r'^(Chleb|Bułka(?! tarta)|Bułki|Chałka|Tortilla|Placek pszenny|Półbagietka|Rogal|Papier ryżowy|Wafle ryżowe|Wafle kukurydziane$|Chleb chrupki)', 'pieczywo'),
    (r'^(Mleko|Jogurt|Kefir|Maślanka|Ser |Serek|Twaróg|Twarożek|Skyr|Śmietana|Masło extra|Margaryna|Jajko|Parmezan|Mascarpone|Ricotta|Burrata|Krem Jogurt)', 'nabial'),
    (r'^(Mięso|Filet|Szynka|Boczek|Salami|Polędwica|Schab|Wędlina|Wieprzowina|Wołowina|Udo kurczaka|Skrzydełka|Frankfurterki|Parówki)', 'mieso'),
    (r'^(Łosoś|Dorsz|Mintaj|Pstrąg|Tilapia|Makrela|Tuńczyk|Anchois|Sos rybny)', 'ryby'),
    (r'^(Kukurydza \(ziarno|Kasza|Ryż|Makaron|Płatki (owsiane|jaglane|gryczane|orkiszowe|ryżowe|żytnie|kukurydziane)|Komosa|Ekspandowane|Tapioka|Bułka tarta|Płatki Lion|Płatki Nesquik)', 'zboza'),
    (r'^(Mąka|Proszek do pieczenia|Soda|Drożdże|Budyń|Żelatyna|Galaretka|Aromat|Wanilia|Cukier|Erytrol|Ksylitol|Puder z erytrolu|Kakao|Mak )', 'pieczenie'),
    (r'^(Fasola|Ciecierzyca|Soczewica|Kukurydza konserwowa|Groszek zielony konserwowy|Pomidory z puszki|Passata|Koncentrat|Ogórek (kiszony|konserwowy|małosolny)|Kapusta kiszona|Kapary|Ćwikła|Przecier|Pomidory suszone|Pomidor suszony|Oliwki|Dżem|Żurawina do mięs|Mleczko kokosowe|Bulion|Buraki, gotowane)', 'konserwy'),
    (r'^(Orzechy|Migdały|Mieszanka orzechów|Mieszanka bakaliowa|Pestki|Nasiona|Siemię|Sezam|Czarnuszka|Wiórki|Płatki migdałów|Płatki kokosowe|Masło (orzechowe|migdałowe)|Tahini|Rodzynki|Żurawina suszona|Morele suszone|Śliwki suszone|Figi suszone|Daktyle, suszone|Jabłko suszone)', 'orzechy'),
    (r'^(Sól|Pieprz|Papryka (słodka|wędzona|ostra suszona)|Płatki chilli|Curry|Kurkuma|Kumin|Cynamon|Imbir mielony|Czosnek granulowany|Oregano|Bazylia suszona|Tymianek suszony|Rozmaryn|Majeranek|Zioła prowansalskie|Liść laurowy|Ziele angielskie|Gałka|Kardamon|Cząber|Kolendra suszona|Koper suszony|Przyprawa|Czarna sól|Matcha)', 'przyprawy'),
    (r'^(Oliwa|Olej|Ocet|Sos |Ketchup|Majonez|Musztarda|Miód|Syrop|Pesto|Chrzan|Pasta miso|Krem Biscoff|Nutella)', 'oleje_sosy'),
    (r'^(Czekolada|Baton|Anty ?baton|Antybaton|Mini baton|Ciast|Bonitki|Herbatniki|Biszkopty|Raffaello|Princessa|Michałki|Nachosy|Precelki|Wafle serowe)', 'slodycze'),
    (r'^(Ananas|Arbuz|Awokado|Banan|Borówki|Brzoskwinia|Cytryna|Czereśnie|Daktyle|Figi|Granat|Grejpfrut|Gruszka|Jabłko|Jagody|Jeżyny|Kaki|Kiwi|Limonka|Maliny|Mandarynki|Mango|Marakuja|Melon|Morele|Nektarynka|Pomarańcza|Porzeczki|Rabarbar|Skórka z|Śliwki|Truskawki|Winogrona|Wiśnie|Agrest)', 'owoce'),
    (r'^(Bakłażan|Batat|Biała rzodkiew|Brokuł|Brukselka|Bób|Burak|Cebula|Cukinia|Czosnek|Dynia|Fasola (Edamame|szparagowa)|Groszek cukrowy|Imbir|Jarmuż|Kalafior|Kapusta|Kiełki|Kolendra świeża|Koper posiekany|Kukurydza, kolba|Kurki|Marchew|Miks sałat|Mięta|Natka|Nori|Ogórek świeży|Papryka (czerwona|żółta)|Papryczka chilli|Pieczarki|Pietruszka korzeń|Pomidor|Por|Roszponka|Rukola|Rzodkiewka|Sałata|Seler|Szczypiorek|Szparagi|Szpinak|Ziemniaki|Bazylia świeża|Tymianek świeży)', 'warzywa'),
    (r'^(Woda|Napar)', 'napoje'),
]

# products that most kitchens already have — app may hide them from the shopping list by default
PANTRY = re.compile(r'^(Sól|Pieprz|Woda|Lód|Oliwa z oliwek|Olej rzepakowy|Ocet$|Papryka (słodka|wędzona)|Czosnek granulowany|Oregano|Bazylia suszona|Tymianek suszony|Zioła prowansalskie|Liść laurowy|Ziele angielskie|Majeranek|Kurkuma|Curry|Kumin|Cynamon|Proszek do pieczenia|Soda|Mąka pszenna typ 500|Erytrol|Ksylitol|Sos sojowy|Musztarda|Miód|Wanilia ekstrakt|Kakao$)')

# never added to a shopping list
NOT_SHOPPABLE = re.compile(r'^(Woda$|Lód, kostki|Napar z kawy)')

# origin drives vegan / vegetarian detection
ORIGIN_RULES = [
    (r'^(Mięso|Filet|Szynka(?! z)|Szynka z|Boczek|Salami|Polędwica wieprzowa|Schab|Wędlina|Wieprzowina|Wołowina|Udo kurczaka|Skrzydełka|Frankfurterki|Parówki|Żelatyna|Galaretka)', 'meat'),
    (r'^(Łosoś|Dorsz|Mintaj|Pstrąg|Tilapia|Makrela|Tuńczyk|Anchois|Sos rybny)', 'fish'),
    (r'^(Jajko|Ciasto do naleśników$|Ciasto do naleśników lekkostrawnych|Biszkopty|Kluski leniwe|Kopytka|Majonez$|Majonez light)', 'egg'),
    (r'^(Mleko(?! (roślinne|migdałowe|kokosowe))|Jogurt(?! (roślinny|skyr sojowy|pitny Oatjogu))|Kefir|Maślanka|Ser|Serek|Twaróg|Twarożek|Skyr|Śmietana(?! wegańska)|Masło extra|Parmezan|Mascarpone|Ricotta|Burrata|Krem Jogurt|Deser twarogowy|High|Kvarg|Danone|YoPro|Big milk|Kaszka|Napój mleczny|Kajmak|Pudding proteinowy|Napój proteinowy Go Active|Baton wysokobiałkowy|Koktajl odżywczy|Riso|Odżywka białkowa|Czekolada mleczna|Czekolada biała|Rogal|Chałka|Świeże tortel|Owsianka|Ciasteczka|Ciastka oreo|Raffaello|Princessa|Michałki|Nutella|Wafle serowe|Budyń|Pesto|Drink this food)', 'dairy'),
    (r'^(Miód)', 'honey'),
]

ALLERGEN_RULES = {
    'gluten': r'^(Chleb|Bułk|Chałka|Tortilla(?! bezglutenowa)|Placek|Półbagietka|Rogal|Kasza (bulgur|jęczmienna|kuskus|manna)|Makaron(?! (ryżowy|Go Vege|świderki z mąki z soczewicy))|Mąka (pszenna|orkiszowa|owsiana)|Płatki (owsiane|orkiszowe|żytnie|Lion|Nesquik)|Owsianka|Bułka tarta|Seitan|Ciasto|Gnocchi|Kopytka|Kluski|Kluska|Świeże tortel|Pinsa|Focaccia|Biszkopty|Ciast|Bonitki|Herbatniki|Precelki|Proteinowa granola|Granola|Kawa zbożowa|Jęczmień|Tymbark Musly|Wafle serowe|Owsiane smoothie|Jogurt pitny|Riso|Krem Biscoff)',
    'mleko': r'^(Mleko(?! (roślinne|migdałowe|kokosowe))|Jogurt(?! (roślinny|skyr sojowy|pitny Oatjogu))|Kefir|Maślanka|Ser|Serek|Twaróg|Twarożek|Skyr|Śmietana(?! wegańska)|Masło extra|Parmezan|Mascarpone|Ricotta|Burrata|Deser twarogowy|High|Kvarg|Danone|YoPro|Big milk|Kaszka|Napój mleczny|Kajmak|Pudding proteinowy|Napój proteinowy Go Active|Baton wysokobiałkowy|Koktajl odżywczy|Riso|Odżywka białkowa|Czekolada (mleczna|biała)|Rogal|Świeże tortel|Kluski leniwe|Ciasto do naleśników$|Ciasto do naleśników lekkostrawnych|Nutella|Raffaello|Princessa|Wafle serowe|Pesto|Budyń|Drink this food)',
    'jaja': r'^(Jajko|Ciasto do naleśników$|Ciasto do naleśników lekkostrawnych|Biszkopty|Kluski leniwe|Kopytka|Majonez$|Majonez light)',
    'orzechy': r'^(Orzechy(?! arachidowe)|Migdały|Mieszanka orzechów|Mieszanka bakaliowa|Płatki migdałów|Masło migdałowe|Mleko migdałowe|Aromat migdałowy|Anty ?baton|Antybaton|Baton orzechowy|Mini batonik|Mini batoniki|Nutella|Raffaello|Pesto)',
    'orzeszki_ziemne': r'^(Orzechy arachidowe|Masło orzechowe)',
    'soja': r'^(Tofu|Tempeh|Granulat sojowy|Kotlety sojowe|Jogurt skyr sojowy|Alpro sojowe|Napój sojowy|Sos sojowy|Pasta miso|Fasola Edamame|Kiełki soi)',
    'sezam': r'^(Sezam|Tahini|Olej sezamowy|Hummus)',
    'ryby': r'^(Łosoś|Dorsz|Mintaj|Pstrąg|Tilapia|Makrela|Tuńczyk|Anchois|Sos rybny)',
    'gorczyca': r'^(Musztarda)',
    'seler': r'^(Seler|Bulion warzywny)',
}


def classify(name):
    for rx, cat in RULES:
        if re.match(rx, name):
            return cat
    return 'inne'


def origin(name):
    for rx, o in ORIGIN_RULES:
        if re.match(rx, name):
            return o
    return 'plant'


def allergens(name):
    return [a for a, rx in ALLERGEN_RULES.items() if re.match(rx, name)]
