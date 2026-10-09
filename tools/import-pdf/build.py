"""Build Posiłkomat data files (meta, products, recipes, plans) from raw parsed meals."""
import json, re, sys, os, statistics, collections, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from products_rules import canonical, classify, origin, allergens, CATEGORIES, PANTRY, NOT_SHOPPABLE
from nutrition_values import N
from nutrition import kcal, from_ingredients, solve, report
from base_recipes import BASE_RECIPES

RAW, OUT = sys.argv[1], sys.argv[2]
SCHEMA_VERSION = '1.0.0'
IMPORTED_AT = '2026-10-09'
DUPLICATE_FILES = {'20': '19'}  # dieta (20).pdf is byte-identical to dieta (19).pdf

raw = json.load(open(RAW))

# ---------------------------------------------------------------- helpers
PL = str.maketrans('ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')


def slug(s):
    s = s.translate(PL).lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s


def num(x):
    return int(x) if x is not None and float(x).is_integer() else x


SLOTS = [
    {'id': 'breakfast', 'name': 'Śniadanie', 'order': 1, 'default_time': {'from': '06:00', 'to': '09:00'}},
    {'id': 'second_breakfast', 'name': 'II śniadanie', 'order': 2, 'default_time': {'from': '10:00', 'to': '13:00'}},
    {'id': 'lunch', 'name': 'Obiad', 'order': 3, 'default_time': {'from': '14:00', 'to': '17:00'}},
    {'id': 'dinner', 'name': 'Kolacja', 'order': 4, 'default_time': {'from': '18:00', 'to': '21:00'}},
    {'id': 'snack', 'name': 'Przekąska', 'order': 5, 'default_time': None},
]
SLOT_BY_RAW = {1: 'breakfast', 2: 'second_breakfast', 3: 'lunch', 4: 'dinner', 'snack': 'snack'}

UNITS = [
    # id, short, forms (1 / 2-4 / 5+ / ułamek)
    ('sztuka', 'szt.', 'sztuka', 'sztuki', 'sztuk', 'sztuki'),
    ('łyżka', 'łyżka', 'łyżka', 'łyżki', 'łyżek', 'łyżki'),
    ('łyżeczka', 'łyżeczka', 'łyżeczka', 'łyżeczki', 'łyżeczek', 'łyżeczki'),
    ('szczypta', 'szczypta', 'szczypta', 'szczypty', 'szczypt', 'szczypty'),
    ('szklanka', 'szkl.', 'szklanka', 'szklanki', 'szklanek', 'szklanki'),
    ('kromka', 'kromka', 'kromka', 'kromki', 'kromek', 'kromki'),
    ('plaster', 'plaster', 'plaster', 'plastry', 'plastrów', 'plastra'),
    ('opakowanie', 'op.', 'opakowanie', 'opakowania', 'opakowań', 'opakowania'),
    ('ząbek', 'ząbek', 'ząbek', 'ząbki', 'ząbków', 'ząbka'),
    ('garść', 'garść', 'garść', 'garści', 'garści', 'garści'),
    ('kostka', 'kostka', 'kostka', 'kostki', 'kostek', 'kostki'),
    ('łodyga', 'łodyga', 'łodyga', 'łodygi', 'łodyg', 'łodygi'),
    ('listek', 'listek', 'listek', 'listki', 'listków', 'listka'),
    ('porcja', 'porcja', 'porcja', 'porcje', 'porcji', 'porcji'),
]
UNIT_FORMS = {}
for u in UNITS:
    for f in u[2:]:
        UNIT_FORMS[f] = u[0]
UNIT_FORMS.update({'ząbku': 'ząbek', 'plastra': 'plaster', 'listka': 'listek'})

# ---------------------------------------------------------------- dedupe recipes
def recipe_key(m):
    return (m['title'], m['servings'], tuple((i['name'], i['grams'], i.get('group')) for i in m['ingredients']))


groups = collections.OrderedDict()
for m in raw['meals']:
    if m['file'] in DUPLICATE_FILES:
        continue
    groups.setdefault(recipe_key(m), []).append(m)

# ---------------------------------------------------------------- products
prod_occ = collections.defaultdict(list)   # canonical name -> list of ingredient dicts
raw_names = collections.defaultdict(set)
for key, occ in groups.items():
    for i in occ[0]['ingredients']:
        c = canonical(i['name'])
        prod_occ[c].append(i)
        raw_names[c].add(i['name'])

EXCHANGE_PRODUCTS = ['Olej z awokado', 'Olej kokosowy', 'Herbata', 'Kawa', 'Napary ziołowe']  # from the exchange list
BASE_RECIPE_PRODUCTS = ['Oliwki zielone']  # only needed by base recipes
EXTRA_PRODUCTS = EXCHANGE_PRODUCTS + BASE_RECIPE_PRODUCTS

products, prod_id = [], {}
for name in sorted(set(prod_occ) | set(EXTRA_PRODUCTS), key=lambda s: s.translate(PL).lower()):
    pid = slug(name)
    assert pid not in prod_id.values(), pid
    prod_id[name] = pid
    measures = collections.defaultdict(list)
    for i in prod_occ.get(name, []):
        if i.get('qty') and i.get('unit') and i['grams']:
            u = UNIT_FORMS.get(i['unit'])
            if u is None:
                print('UNKNOWN UNIT', i, file=sys.stderr)
                continue
            measures[u].append(i['grams'] / i['qty'])
    cat = classify(name)
    if name in ('Olej z awokado', 'Olej kokosowy'):
        cat = 'oleje_sosy'
    if name in ('Herbata', 'Kawa', 'Napary ziołowe'):
        cat = 'napoje'
    products.append({
        'id': pid,
        'name': name,
        'aliases': sorted(raw_names[name] - {name}),
        'category': cat,
        'origin': origin(name),
        'allergens': allergens(name),
        'pantry_staple': bool(PANTRY.match(name)),
        'shoppable': not NOT_SHOPPABLE.match(name),
        'measures': [
            {'unit': u, 'grams': num(round(statistics.median(v), 2))}
            for u, v in sorted(measures.items(), key=lambda kv: -len(kv[1]))
        ],
        'nutrition_per_100g': None,
        'source': {'type': 'pdf_import' if name in prod_occ else 'exchange_list' if name in EXCHANGE_PRODUCTS else 'ai_generated'},
    })
PROD = {p['id']: p for p in products}

# ---------------------------------------------------------------- recipe heuristics
DISH_TYPES = [
    ('owsianka', r'owsiank|jaglank|gryczank|amarantus|kaszk|kasza manna|manna|granola|musli|płatki|porridge'),
    ('kanapki', r'kanapk|tost|grzank|bułk|bruschett|chleb|pieczyw|sandwich|onigirazu'),
    ('sałatka', r'sałatk|surówk'),
    ('zupa', r'zup|krem z|krem ze|chłodnik|barszcz|rosół|bulion'),
    ('koktajl', r'koktajl|smoothie|shake|napój|sok |sok$|latte'),
    ('makaron', r'makaron|spaghetti|penne|tagliatell|lasagn|gnocchi|tortell|pierog|kopytk|kluski|kluska|orzo|noodle|chow mein'),
    ('wrap', r'wrap|tortill|burrito|quesadill|kebab|taco|nachos|fajit|pita|piadin'),
    ('bowl', r'bowl|miska'),
    ('placki', r'naleśnik|placki|placuszk|pancake|gofr|syrnik|racuch|crepe|roladki z naleśn'),
    ('jajka', r'omlet|jajecznic|jajk|szakszuk|frittat|shakshuk|tofucznic'),
    ('deser', r'deser|pudding|ciast|muffin|brownie|tiramisu|sernik|batonik|baton|kulki|lody|mus |mus$|budyń|galaretk|monte|princessa|tart[ae]|crumble|kruszon'),
    ('pasta-do-pieczywa', r'pasta z|pasta ze|pasta jajeczn|hummus|pasztet|twarożek|guacamole'),
    ('zapiekanka', r'zapiek|tarta|pizza|pinsa|focaccia|casserole'),
    ('burger', r'burger'),
    ('jogurt-lub-serek', r'jogurt|serek|skyr|twaróg|twarożek|kefir|maślank|kvarg'),
    ('danie-mięsne-lub-rybne', r'kurczak|kurczę|indyk|wołow|schab|wieprz|łoso|dorsz|ryb|pstrąg|tilapi|mintaj|makrel|tuńczyk|udk|bitki|kotlet|klops|pulpet|gulasz|filet|polędwic|karkówk|rostbef'),
    ('warzywa-pieczone-lub-grillowane', r'pieczon|grillowan|z grilla|duszon|frytki|chipsy'),
    ('przekąska-prosta', r'orzech|owoc|daktyl|popcorn|trufle|wafl|melon|jabłk|gruszk|banan|winogron|mandaryn|kiwi'),
    ('danie-z-kaszą-lub-ryżem', r'ryż|risotto|kasz[aąyę]|pęczak|kuskus|bulgur|komos|curry|gulasz|leczo|potrawk|stir|chili'),
]
PROTEIN_GROUPS = [
    ('drób', r'^(mieso-z-piersi-kurczaka|mieso-z-piersi-indyka|mieso-mielone-z-indyka|mieso-mielone-z-kurczaka|udo-kurczaka|skrzydelka|filet-wedzony|szynka-z-kurczaka|szynka-z-indyka|parowki)'),
    ('wołowina', r'^(wolowina|mieso-mielone-wolowe)'),
    ('wieprzowina', r'^(schab|poledwica-wieprzowa|wieprzowina|mieso-mielone-wieprzowe|boczek|salami|szynka-parmenska|frankfurterki|wedlina-schab)'),
    ('ryba', r'^(losos|dorsz|mintaj|pstrag|tilapia|makrela|tunczyk)'),
    ('tofu-soja', r'^(tofu|tempeh|granulat-sojowy|kotlety-sojowe|fasola-edamame|jogurt-skyr-sojowy|seitan)'),
    ('strączki', r'^(ciecierzyca|fasola-(biala|czarna|czerwona)|soczewica|hummus)'),
    ('jajka', r'^(jajko)'),
    ('nabiał', r'^(ser-|serek|twarog|twarozek|jogurt-skyr$|jogurt-grecki|skyr|kvarg|odzywka-bialkowa|high-protein|deser-twarogowy|ricotta|burrata|mozzarella)'),
]
HEAT = re.compile(r'smaż|gotuj|piecz|podgrz|piekarnik|patel|garn|grill|dusim|dusz|zagotow|blanszuj|opiek|toster|mikrofal|zapiek|rozgrzew|gotow[ay]ch|ugotowan|rondel|wrz', re.I)
OVEN = re.compile(r'piekarnik|pieczemy|zapiekamy|piec ', re.I)
SAVORY_PIDS = re.compile(r'^(pieprz|czosnek|cebula|sos-sojowy|musztarda|majonez|ketchup|kumin|curry|papryka-(slodka|wedzona|ostra)|oregano|zio|bazylia|tymianek|majeranek|rozmaryn|bulion)')


def recipe_tags(name, ingredients, steps):
    low = name.lower()
    dish = [t for t, rx in DISH_TYPES if re.search(rx, low)]
    if ' + ' in name:
        dish.append('zestaw-z-gotowych-produktów')
    pids = [i['product_id'] for i in ingredients]
    proteins = []
    for t, rx in PROTEIN_GROUPS:
        g = sum((i['amount_g'] or 0) for i in ingredients if re.match(rx, i['product_id']))
        if g >= 30 or (t == 'jajka' and g > 0):
            proteins.append(t)
    origins = {PROD[p]['origin'] for p in pids}
    diet = []
    if not origins & {'meat', 'fish'}:
        diet.append('wegetariańska')
        if not origins & {'dairy', 'egg', 'honey'}:
            diet.append('wegańska')
    elif not origins & {'meat'}:
        diet.append('pescowegetariańska')
    alls = sorted({a for p in pids for a in PROD[p]['allergens']})
    if 'gluten' not in alls:
        diet.append('bez-glutenu')
    if 'mleko' not in alls:
        diet.append('bez-laktozy')
    text = ' '.join(s['text'] for s in steps)
    features = []
    if 'lunchbox' in text.lower():
        features.append('lunchbox')
    if not HEAT.search(text):
        features.append('bez-gotowania')
    if OVEN.search(text):
        features.append('piekarnik')
    if re.search(r'na noc|przez noc|całą noc', text, re.I):
        features.append('na-noc')
    savory = any(SAVORY_PIDS.match(p) for p in pids) or bool(origins & {'meat', 'fish'})
    flavor = 'wytrawny' if savory else 'słodki'
    return dish, proteins, diet, alls, features, flavor


# ---------------------------------------------------------------- recipes
recipes, rid_by_key, used_ids = [], {}, set()
FILE_NAME = lambda f: f'dieta ({f}).pdf'

for key, occ in groups.items():
    m = occ[0]
    base = slug(m['title'])[:80].rstrip('-')
    rid, n = base, 2
    while rid in used_ids:
        rid = f'{base}-{n}'; n += 1
    used_ids.add(rid)
    rid_by_key[key] = rid

    ingredients = []
    for i in m['ingredients']:
        c = canonical(i['name'])
        ing = {
            'product_id': prod_id[c],
            'name': i['name'],
            'amount_g': num(i['grams']),
            'household': ({'qty': num(i['qty']), 'unit': UNIT_FORMS[i['unit']]}
                          if i.get('qty') and i.get('unit') in UNIT_FORMS else None),
            'group': i.get('group'),
        }
        if i.get('to_taste'):
            ing['note'] = 'do smaku'
        ingredients.append(ing)

    steps = []
    for k, s in enumerate(m['steps'], 1):
        sec = s['section']
        if sec and sec.isupper():
            sec = sec.capitalize()
        steps.append({'order': k, 'text': s['text'], 'section': sec})

    slots = sorted({SLOT_BY_RAW[o['slot']] for o in occ}, key=lambda x: [s['id'] for s in SLOTS].index(x))
    dish, proteins, diet, alls, features, flavor = recipe_tags(m['title'], ingredients, steps)
    files = sorted({o['file'] for o in occ}, key=int)
    recipes.append({
        'id': rid,
        'kind': 'meal',
        'name': m['title'],
        'description': None,
        'meal_slots': slots,
        'servings': m['servings'],
        'nutrition_per_serving': {
            'kcal': m['kcal'], 'protein_g': num(m['protein']), 'carbs_g': num(m['carbs']), 'fat_g': num(m['fat']),
        },
        'ingredients': ingredients,
        'steps': steps,
        'tags': {
            'dish_type': dish,
            'protein': proteins,
            'diet': diet,
            'features': features,
            'flavor': flavor,
        },
        'allergens': alls,
        'prep_time_min': None,
        'image': None,
        'source': {
            'type': 'pdf_import',
            'files': [FILE_NAME(f) for f in files],
            'imported_at': IMPORTED_AT,
            'nutrition_origin': 'source_document',
        },
        'status': 'active',
        'version': 1,
    })

# recipes that differ only in step wording are merged above (key ignores steps); report same-name variants
names = collections.Counter(r['name'] for r in recipes)
for r in recipes:
    if names[r['name']] > 1:
        r['variant_group'] = slug(r['name'])

# ---------------------------------------------------------------- base recipes (półprodukty)
base_recipes = []
for b in BASE_RECIPES:
    pid = prod_id[b['produces']]
    rid = slug(b['name'])
    ingredients = [{
        'product_id': prod_id[canonical(n)], 'name': n, 'amount_g': num(g),
        'household': {'qty': num(q), 'unit': u} if q else None, 'group': None,
    } for n, g, q, u in b['ingredients']]
    steps = [{'order': k, 'text': t, 'section': None} for k, t in enumerate(b['steps'], 1)]
    dish, proteins, diet, alls, features, flavor = recipe_tags(b['name'], ingredients, steps)
    yield_g = sum(i['amount_g'] for i in ingredients)
    base_recipes.append({
        'id': rid,
        'kind': 'base',
        'name': b['name'],
        'description': b['description'],
        'meal_slots': [],
        'servings': b['pieces'],
        'yield': {'product_id': pid, 'amount_g': num(round(yield_g, 2)), 'pieces': b['pieces'], 'piece_unit': b['piece_unit']},
        'nutrition_per_serving': None,  # filled after product nutrition is known
        'ingredients': ingredients,
        'steps': steps,
        'tags': {'dish_type': [], 'protein': [], 'diet': diet, 'features': features, 'flavor': flavor},
        'allergens': alls,
        'prep_time_min': None,
        'image': None,
        'source': {'type': 'ai_generated', 'model': 'claude-opus-5-5', 'generated_at': IMPORTED_AT + 'T12:00:00Z',
                   'prompt': 'Przepis bazowy dla półproduktu używanego w jadłospisach PDF bez rozpisanych składników',
                   'nutrition_origin': 'calculated'},
        'status': 'active',
        'version': 1,
    })
    PROD[pid]['base_recipe_id'] = rid
    if not any(m['unit'] == b['piece_unit'] for m in PROD[pid]['measures']):  # PDF measure wins if present
        PROD[pid]['measures'].append({'unit': b['piece_unit'], 'grams': num(round(yield_g / b['pieces'], 1))})
recipes.extend(base_recipes)

# ---------------------------------------------------------------- product nutrition
table = dict(N)
for b in base_recipes:  # semi-finished products: calculated from their base recipe
    table[b['yield']['product_id']] = from_ingredients([(i['product_id'], i['amount_g']) for i in b['ingredients']], table)
solved = solve(table, recipes)
SOURCE_TYPE = {'r': 'reference', 'e': 'estimate', 'd': 'derived_from_recipes', 'c': 'calculated_from_base_recipe'}
for p in products:
    v = table[p['id']]
    p['nutrition_per_100g'] = {
        'kcal': round(kcal(v)), 'protein_g': v[0], 'fat_g': v[1],
        'carbs_g': round(v[2] + v[3], 1), 'fiber_g': v[3],
    }
    src = {'type': SOURCE_TYPE[v[4]]}
    if v[4] == 'd':
        src['recipes_used'] = solved[p['id']]
    if v[4] == 'c':
        src['base_recipe_id'] = p['base_recipe_id']
    p['nutrition_source'] = src
for b in base_recipes:
    v = table[b['yield']['product_id']]; g = b['yield']['amount_g'] / b['servings'] / 100
    b['nutrition_per_serving'] = {'kcal': round(kcal(v) * g), 'protein_g': round(v[0] * g, 1),
                                  'carbs_g': round((v[2] + v[3]) * g, 1), 'fat_g': round(v[1] * g, 1)}
print('--- nutrition calibration (computed from products vs PDF) ---', file=sys.stderr)
_stdout = sys.stdout; sys.stdout = sys.stderr
report(recipes, table, 8)
sys.stdout = _stdout

# ---------------------------------------------------------------- plans (original diets as templates)
plans = []
days_meta = {(d['file'], d['day']): d for d in raw['days']}
by_file = collections.defaultdict(lambda: collections.defaultdict(list))
for m in raw['meals']:
    if m['file'] in DUPLICATE_FILES:
        continue
    by_file[m['file']][m['day']].append(m)
for f in sorted(by_file, key=int):
    days = []
    for d in sorted(by_file[f]):
        meals = by_file[f][d]
        dm = days_meta[(f, d)]
        entries = []
        for m in meals:
            slot = SLOT_BY_RAW[m['slot']]
            t = m['window'].split('-') if m['slot'] != 'snack' else None
            entries.append({
                'slot': slot,
                'time': {'from': t[0].zfill(5), 'to': t[1].zfill(5)} if t else None,
                'recipe_id': rid_by_key[recipe_key(m)],
                'portions': 1,
            })
        days.append({
            'day': d,
            'meals': entries,
            'totals': {
                'kcal': sum(m['kcal'] for m in meals),
                'protein_g': num(sum(m['protein'] for m in meals)),
                'carbs_g': num(sum(m['carbs'] for m in meals)),
                'fat_g': num(sum(m['fat'] for m in meals)),
                'fiber_g': dm.get('fiber_g'),
                'calcium_mg': dm.get('calcium_mg'),
                'magnesium_mg': dm.get('magnesium_mg'),
            },
        })
    avg = round(statistics.mean(dd['totals']['kcal'] for dd in days))
    plans.append({
        'id': f'dieta-{int(f):02d}',
        'name': f'Dieta {f} – {len(days)} dni (~{avg} kcal)',
        'type': 'template',
        'source': {'type': 'pdf_import', 'file': FILE_NAME(f), 'duplicates': [FILE_NAME(k) for k, v in DUPLICATE_FILES.items() if v == f]},
        'target_kcal': avg,
        'days': days,
    })

# ---------------------------------------------------------------- meta (dictionaries + exchange list)
P = lambda name: prod_id[canonical(name)]
substitution_groups = [
    {
        'id': 'tluszcze-orzechy-nasiona', 'name': 'Źródła tłuszczu – orzechy, nasiona, pestki', 'mode': 'equal_weight',
        'items': [{'product_id': P(n)} for n in [
            'Orzechy włoskie', 'Orzechy nerkowca', 'Orzechy laskowe', 'Orzechy pistacjowe niesolone', 'Orzechy pinii',
            'Orzechy pekan', 'Orzechy arachidowe', 'Siemię lniane', 'Sezam nasiona', 'Nasiona słonecznika', 'Pestki dyni',
            'Wiórki kokosowe', 'Masło orzechowe', 'Nasiona chia']],
    },
    {
        'id': 'tluszcze-oleje', 'name': 'Źródła tłuszczu – oleje i masło', 'mode': 'equal_weight',
        'items': [{'product_id': P(n)} for n in ['Oliwa z oliwek', 'Olej rzepakowy', 'Olej z awokado', 'Olej kokosowy', 'Masło extra']],
    },
    {
        'id': 'napoje-bez-kalorii', 'name': 'Napoje', 'mode': 'equal_weight',
        'items': [{'product_id': P(n)} for n in ['Woda', 'Herbata', 'Kawa', 'Napary ziołowe']],
        'note': 'np. mięta, pokrzywa, melisa',
    },
    {
        'id': 'owoce', 'name': 'Zamienniki owoców (porcje równoważne)', 'mode': 'equivalent_portions',
        'items': [{'product_id': P(n), 'grams': g, 'household': {'qty': q, 'unit': 'sztuka' if u == 's' else 'garść'} if q else None}
                  for n, g, q, u in [
                      ('Banan', 120, 1, 's'), ('Jabłko', 170, 1, 's'), ('Pomarańcza', 240, 1, 's'), ('Kaki', 125, 0.5, 's'),
                      ('Mandarynki', 195, 3, 's'), ('Brzoskwinia świeża lub mrożona', 180, 2, 's'), ('Gruszka', 170, 1, 's'),
                      ('Kiwi', 160, 2, 's'), ('Maliny świeże lub mrożone', 210, 3, 'g'), ('Truskawki, świeże lub mrożone', 280, 4, 'g'),
                      ('Winogrona', 140, 2, 'g'), ('Grejpfrut', 220, 1, 's'), ('Mango świeże lub mrożone', 140, 0.5, 's'),
                      ('Śliwki, świeże lub mrożone', 210, 7, 's'), ('Ananas świeży lub mrożony', 200, None, None),
                      ('Borówki amerykańskie', 175, 4, 'g'), ('Czereśnie', 160, 2, 'g')]],
    },
]
for g in substitution_groups:
    for it in g['items']:
        if it.get('household') is None:
            it.pop('household', None)

meta = {
    'schema_version': SCHEMA_VERSION,
    'generated_at': IMPORTED_AT,
    'meal_slots': SLOTS,
    'product_categories': [{'id': c, 'name': n, 'order': k} for k, (c, n) in enumerate(CATEGORIES, 1)],
    'units': [{'id': u[0], 'short': u[1], 'forms': {'one': u[2], 'few': u[3], 'many': u[4], 'fraction': u[5]}} for u in UNITS],
    'product_origins': [
        {'id': 'plant', 'name': 'roślinne'}, {'id': 'dairy', 'name': 'nabiał'}, {'id': 'egg', 'name': 'jaja'},
        {'id': 'honey', 'name': 'miód'}, {'id': 'fish', 'name': 'ryby'}, {'id': 'meat', 'name': 'mięso / żelatyna'},
    ],
    'allergens': [
        {'id': 'gluten', 'name': 'Gluten'}, {'id': 'mleko', 'name': 'Mleko (laktoza)'}, {'id': 'jaja', 'name': 'Jaja'},
        {'id': 'orzechy', 'name': 'Orzechy'}, {'id': 'orzeszki_ziemne', 'name': 'Orzeszki ziemne'}, {'id': 'soja', 'name': 'Soja'},
        {'id': 'sezam', 'name': 'Sezam'}, {'id': 'ryby', 'name': 'Ryby'}, {'id': 'gorczyca', 'name': 'Gorczyca'}, {'id': 'seler', 'name': 'Seler'},
    ],
    'tag_vocabulary': {
        'dish_type': [t for t, _ in DISH_TYPES] + ['zestaw-z-gotowych-produktów'],
        'protein': [t for t, _ in PROTEIN_GROUPS],
        'diet': ['wegetariańska', 'wegańska', 'pescowegetariańska', 'bez-glutenu', 'bez-laktozy'],
        'features': ['lunchbox', 'bez-gotowania', 'piekarnik', 'na-noc'],
        'flavor': ['słodki', 'wytrawny'],
    },
    'slot_swap_compatibility': {
        'breakfast': ['breakfast', 'second_breakfast', 'dinner'],
        'second_breakfast': ['second_breakfast', 'breakfast', 'snack'],
        'lunch': ['lunch', 'dinner'],
        'dinner': ['dinner', 'lunch', 'breakfast'],
        'snack': ['snack', 'second_breakfast'],
    },
    'substitution_groups': substitution_groups,
}

# ---------------------------------------------------------------- recipe counts on products
cnt = collections.Counter(i['product_id'] for r in recipes for i in r['ingredients'])
for p in products:
    p['recipe_count'] = cnt.get(p['id'], 0)

os.makedirs(OUT, exist_ok=True)
def dump(name, obj):
    with open(os.path.join(OUT, name), 'w') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')

dump('meta.json', meta)
dump('products.json', {'schema_version': SCHEMA_VERSION, 'products': products})
dump('recipes.json', {'schema_version': SCHEMA_VERSION, 'recipes': recipes})
dump('plans.json', {'schema_version': SCHEMA_VERSION, 'plans': plans})
print(f'{len(recipes)} recipes, {len(products)} products, {len(plans)} plans', file=sys.stderr)
