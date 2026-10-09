"""Product nutrition: reference table + calculation from base recipes + back-solving from PDF recipe totals.

Run directly for a calibration report:  python nutrition.py ../../data
"""
import json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nutrition_values import N

# back-solved values rejected because the PDF entry is internally inconsistent (kcal vs macros)
REJECT_SOLVE = {'wafle-serowe-wk-dzik', 'owsianka-drugie-sniadanie-z-truskawka'}
MIN_SHARE = 0.30  # product must supply >= 30% of a recipe's energy to be solved from it


def kcal(v):
    """v = (protein, fat, carbs_available, fiber, source[, kcal_override])"""
    return v[5] if len(v) > 5 else 4 * v[0] + 9 * v[1] + 4 * v[2] + 2 * v[3]


def contributions(r, table):
    """Per-serving contribution of each product: [kcal, protein, fat, carbs_total, grams]."""
    out = {}
    for i in r['ingredients']:
        v = table[i['product_id']]
        g = (i['amount_g'] or 0) / 100 / r['servings']
        c = out.setdefault(i['product_id'], [0, 0, 0, 0, 0])
        c[0] += kcal(v) * g; c[1] += v[0] * g; c[2] += v[1] * g; c[3] += (v[2] + v[3]) * g; c[4] += g * 100
    return out


def from_ingredients(ingredients, table):
    """Nutrition per 100 g of a mixture [(product_id, grams)]."""
    tot = sum(g for _, g in ingredients)
    acc = [0, 0, 0, 0, 0]
    for pid, g in ingredients:
        v = table[pid]
        for k in range(4):
            acc[k] += v[k] * g / tot
        acc[4] += kcal(v) * g / tot
    return (round(acc[0], 1), round(acc[1], 1), round(acc[2], 1), round(acc[3], 1), 'c', round(acc[4]))


def solve(table, recipes):
    """Back-solve 'e' products from recipes where they are the only uncertain ingredient. Mutates table."""
    solved = {}
    uncertain = {k for k, v in table.items() if v[4] == 'e' and k not in REJECT_SOLVE}
    for _ in range(3):
        cand = {}
        for r in recipes:
            if r.get('kind') == 'base':
                continue
            n = r['nutrition_per_serving']
            con = contributions(r, table)
            total = sum(c[0] for c in con.values()) or 1
            unk = [p for p in con if p in uncertain and p not in solved]
            if len(unk) != 1:
                continue
            x = unk[0]; cx = con[x]
            if cx[4] < 15 or cx[0] / total < MIN_SHARE:
                continue
            others = [sum(c[k] for p, c in con.items() if p != x) for k in (1, 2, 3)]
            g = cx[4] / 100
            cand.setdefault(x, []).append((max(0, (n['protein_g'] - others[0]) / g),
                                           max(0, (n['fat_g'] - others[1]) / g),
                                           max(0, (n['carbs_g'] - others[2]) / g)))
        if not cand:
            break
        for x, rows in cand.items():
            fib = table[x][3]
            p = statistics.median(r[0] for r in rows)
            f = statistics.median(r[1] for r in rows)
            ct = statistics.median(r[2] for r in rows)
            table[x] = (round(p, 1), round(f, 1), round(max(0, ct - fib), 1), fib, 'd')
            solved[x] = len(rows)
    return solved


def predict(r, table):
    con = contributions(r, table)
    return {k: sum(c[i] for c in con.values()) for i, k in enumerate(('kcal', 'protein_g', 'fat_g', 'carbs_g'))}


def report(recipes, table, top=15):
    meals = [r for r in recipes if r.get('kind', 'meal') == 'meal']
    rows = []
    for r in meals:
        t = predict(r, table); n = r['nutrition_per_serving']
        rows.append((t['kcal'] / n['kcal'], t, n, r))
    ratios = sorted(x[0] for x in rows)
    q = lambda a, k: a[int(k * (len(a) - 1))]
    print('kcal calc/pdf  p10 %.3f  median %.3f  p90 %.3f' % (q(ratios, .1), q(ratios, .5), q(ratios, .9)))
    for k in ('protein_g', 'fat_g', 'carbs_g'):
        d = sorted(x[1][k] - x[2][k] for x in rows)
        print(f'{k:10s} diff g: p10 {q(d, .1):+.1f}  median {q(d, .5):+.1f}  p90 {q(d, .9):+.1f}')
    print('within ±10%%: %d/%d   within ±5%%: %d/%d' % (
        sum(0.9 <= x <= 1.1 for x in ratios), len(ratios), sum(0.95 <= x <= 1.05 for x in ratios), len(ratios)))
    for ratio, t, n, r in sorted(rows, key=lambda x: abs(x[0] - 1), reverse=True)[:top]:
        print(f"  {ratio:.2f}  pdf {n['kcal']:4d}  calc {t['kcal']:4.0f}  {r['name'][:70]}")


if __name__ == '__main__':
    data = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'data')
    recipes = json.load(open(os.path.join(data, 'recipes.json')))['recipes']
    products = json.load(open(os.path.join(data, 'products.json')))['products']
    table = {}
    for p in products:
        n = p['nutrition_per_100g']
        table[p['id']] = (n['protein_g'], n['fat_g'], n['carbs_g'] - (n.get('fiber_g') or 0), n.get('fiber_g') or 0, 'x', n['kcal'])
    report(recipes, table, int(sys.argv[2]) if len(sys.argv) > 2 else 15)
