"""Parse extracted diet PDF text into raw meal records (one per occurrence)."""
import json, re, sys, glob, os

TXT_DIR = sys.argv[1]
OUT = sys.argv[2]

SLOT_RE = re.compile(r'^(Posiłek (\d) /|Przekąska /)\s*$')
DAY_RE = re.compile(r'^Dzień (\d+)\s*$')
DAYNUT_RE = re.compile(r'^\((\d+) g błonnika, (\d+) mg wapnia, (\d+) mg magnezu\)')
NUM_RE = re.compile(r'^\d+$')
G_RE = re.compile(r'^(\d+(?:\.\d+)?) g$')
ING_COMPLETE = re.compile(r' – .*(\(\s*\d+(?:\.\d+)? g\)|\d+(?:\.\d+)? g)$')
ING_RE = re.compile(r'^(?P<name>.+?) – (?:(?P<qty>\d+(?:\.\d+)?) (?P<unit>[^\d(]+?) \((?P<g1>\d+(?:\.\d+)?) g\)|(?P<g2>\d+(?:\.\d+)?) g)$')
PORTIONS_RE = re.compile(r'\s*\(liczba porcji: (\d+)\)\s*$')


def clean_lines(text):
    out = []
    for l in text.split('\n'):
        l = l.rstrip()
        if l.startswith('=====PAGE') or l.strip() == 'Plan diety' or l.strip() == '':
            continue
        out.append(l)
    return out


def join(parts):
    s = ''
    for p in parts:
        p = p.strip()
        if not s:
            s = p
        elif s.endswith('-') and not s.endswith(' -'):
            s += p  # hyphenated word break
        else:
            s += ' ' + p
    return re.sub(r'\s+', ' ', s).strip()


def parse_ingredients(lines, warn):
    groups, cur_group, buf = [], None, []
    items = []

    def flush():
        nonlocal buf
        if not buf:
            return
        s = join(buf)
        m = ING_RE.match(s)
        if not m:
            warn('ING?: ' + s)
            items.append({'raw': s, 'group': cur_group})
        else:
            g = m.group('g1') or m.group('g2')
            items.append({
                'name': m.group('name').strip(),
                'qty': float(m.group('qty')) if m.group('qty') else None,
                'unit': m.group('unit').strip() if m.group('unit') else None,
                'grams': float(g),
                'group': cur_group,
            })
        buf = []

    for idx, l in enumerate(lines):
        st = l.strip()
        if not buf and st.endswith(':') and ' – ' not in st:
            cur_group = st[:-1].strip()
            cur_group = cur_group[0].upper() + cur_group[1:]
            continue
        nxt = lines[idx + 1].strip() if idx + 1 < len(lines) else ''
        if not buf and st.lower() in ('sos', 'krem'):  # group header printed without colon
            cur_group = st.capitalize()
            continue
        if not buf and st in ('Pieprz czarny', 'Sól') and ' – ' in nxt:  # listed without amount
            items.append({'name': st, 'qty': None, 'unit': None, 'grams': None, 'group': cur_group, 'to_taste': True})
            continue
        buf.append(st)
        if ING_COMPLETE.search(join(buf)):
            flush()
    flush()
    return items


def parse_steps(lines):
    steps, cur = [], None
    i = 0
    while i < len(lines):
        st = lines[i].strip()
        if NUM_RE.match(st) and i + 1 < len(lines) and lines[i + 1].strip() == '.':
            if cur is not None:
                steps.append(join(cur))
            cur = []
            i += 2
            continue
        if (st.endswith(':') and len(st) < 60 and i + 2 < len(lines)
                and NUM_RE.match(lines[i + 1].strip()) and lines[i + 2].strip() == '.'):
            if cur:
                steps.append(join(cur))
            steps.append(st)  # section header, converted below
            cur = None
            i += 1
            continue
        if cur is None:
            cur = []
        cur.append(st)
        i += 1
    if cur is not None:
        steps.append(join(cur))
    # convert section headers ("Salsa pomidorowa:") into section labels
    out, section = [], None
    for s in steps:
        if s.endswith(':') and len(s) < 60:
            section = s[:-1].strip()
            continue
        out.append({'text': s, 'section': section})
    return out


def parse_meal(block, warn):
    # block[0] = slot line, block[1] = time window line
    m = SLOT_RE.match(block[0].strip())
    slot = int(m.group(2)) if m.group(2) else 'snack'
    window = block[1].strip()
    i = 2
    title = []
    while i < len(block) and not (NUM_RE.match(block[i].strip()) and i + 1 < len(block) and block[i + 1].strip() == 'Kcal'):
        title.append(block[i])
        i += 1
    title = join(title)
    kcal = int(block[i]); i += 2
    macros = {}
    for key in ('B', 'W', 'T'):
        g = G_RE.match(block[i].strip())
        assert g and block[i + 1].strip() == key, (title, block[i:i + 2])
        macros[key] = float(g.group(1)); i += 2
    # ingredients until first "N" + "." pair
    j = i
    while j < len(block) and not (NUM_RE.match(block[j].strip()) and j + 1 < len(block) and block[j + 1].strip() == '.'):
        j += 1
    ingredients = parse_ingredients(block[i:j], warn)
    steps = parse_steps(block[j:])
    servings = 1
    pm = PORTIONS_RE.search(title)
    if pm:
        servings = int(pm.group(1))
        title = PORTIONS_RE.sub('', title)
    return {
        'slot': slot, 'window': window, 'title': title, 'servings': servings,
        'kcal': kcal, 'protein': macros['B'], 'carbs': macros['W'], 'fat': macros['T'],
        'ingredients': ingredients, 'steps': steps,
    }


records, days = [], []
for path in sorted(glob.glob(os.path.join(TXT_DIR, 'd*.txt'))):
    fid = os.path.basename(path)[1:3].lstrip('0')
    lines = clean_lines(open(path).read())
    day, block = None, None
    blocks = []
    for l in lines:
        dm = DAY_RE.match(l.strip())
        if dm:
            if block: blocks.append((day, block)); block = None
            day = int(dm.group(1))
            days.append({'file': fid, 'day': day})
            continue
        nm = DAYNUT_RE.match(l.strip())
        if nm and block is None or (nm and len(block) > 0 and l.strip().startswith('(') and 'błonnika' in l):
            days[-1].update(fiber_g=int(nm.group(1)), calcium_mg=int(nm.group(2)), magnesium_mg=int(nm.group(3)))
            continue
        if SLOT_RE.match(l.strip()):
            if block: blocks.append((day, block))
            block = [l]
            continue
        if block is not None:
            block.append(l)
        else:
            print('ORPHAN', fid, day, l, file=sys.stderr)
    if block: blocks.append((day, block))
    for day, b in blocks:
        def warn(msg, fid=fid, day=day):
            print(f'[{fid} d{day}] {msg}', file=sys.stderr)
        r = parse_meal(b, warn)
        r.update(file=fid, day=day)
        records.append(r)

json.dump({'days': days, 'meals': records}, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(len(records), 'meal occurrences;', len(days), 'days', file=sys.stderr)
