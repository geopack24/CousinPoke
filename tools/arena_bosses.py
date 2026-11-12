"""Turn the Arena bosses spreadsheet into public/js/arena-bosses.js.

    python tools/arena_bosses.py "path/to/Arena bosses.xlsx"

Tabs read: Bosses (one row per Colossal Pokémon; rows that share a Stage number are alternatives, and each run meets one of them), Attacks (one row per attack, with its Energy cost), Rules (shared settings).
Anything it can't understand stops the run with the tab, row and reason, and nothing is written.
"""
import json, re, sys
from pathlib import Path
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
SETS = {'base set': 'base1', 'base': 'base1', 'jungle': 'base2', 'fossil': 'base3', 'team rocket': 'base5', 'rocket': 'base5', 'gym heroes': 'gym1', 'gym challenge': 'gym2'}
TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless']
EFFECTS = {'': None, 'none': None, 'poisoned': 'PSN', 'burned': 'BRN', 'paralyzed': 'PAR', 'asleep': 'SLP', 'confused': 'CNF', 'discard energy': 'energy', 'heal itself': 'heal', 'force switch': 'switch'}
RULES = {  # label in the sheet -> (key, default)
    'knock outs the boss needs to win': ('kos', 6), 'most energy it can hold': ('energyMax', 5), 'energy it gains each turn': ('energyPerTurn', 1), 'energy it starts with': ('energyStart', 0), 'energy charge gains': ('energyCharge', 2), 'hp of each energy': ('energyHP', 20), 'hp of each energy crystal': ('energyHP', 20),
    'weak points on its bench': ('_old1', 0), 'extra damage when a weak point is hit': ('_old2', 0),  # from the first version of the sheet: read and ignored
    'biggest hit from one move': ('maxHit', 150), 'super fang, life drain and destiny bond do this much': ('percentHit', 40),
    'poisoned lasts (boss turns)': ('PSN', 2), 'burned lasts (boss turns)': ('BRN', 2), 'confused lasts (boss turns)': ('CNF', 2), 'asleep lasts (boss turns)': ('SLP', 1), 'paralyzed lasts (boss turns)': ('PAR', 1),
    'weakness and resistance count (1 = yes, 0 = no)': ('wr', 0),
}

def die(msg): sys.exit('STOPPED: ' + msg)
def text(v): return '' if v is None else str(v).strip()
def num(v, where, lo=0, hi=5000):
    if v is None or text(v) == '': return 0
    try: n = int(round(float(v)))
    except (TypeError, ValueError): die(f'{where}: "{v}" is not a number')
    if not lo <= n <= hi: die(f'{where}: {n} is outside {lo} to {hi}')
    return n
def rows(ws):
    head = [text(c.value).lower() for c in ws[1]]
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if any(text(v) for v in r): yield i, {head[k]: r[k] for k in range(min(len(head), len(r))) if head[k]}
def col(row, *names):
    for k, v in row.items():
        if any(k.startswith(n) for n in names): return v
    return None
def typ(v, where, allow_none=True):
    t = text(v).capitalize()
    if t in ('', 'None', '-'):
        if allow_none: return ''
        die(f'{where}: a type is needed')
    if t not in TYPES: die(f'{where}: "{v}" is not a type ({", ".join(TYPES)})')
    return t

def main():
    if len(sys.argv) < 2: die('give the spreadsheet path')
    wb = load_workbook(sys.argv[1], data_only=True)
    for tab in ('Bosses', 'Attacks', 'Rules'):
        if tab not in wb.sheetnames: die(f'the workbook has no "{tab}" tab')
    cards = json.loads((ROOT / 'public' / 'cards.json').read_text(encoding='utf-8'))['cards']

    attacks = {}
    for i, r in rows(wb['Attacks']):
        w = f'Attacks row {i}'; boss = text(col(r, 'boss')).lower(); k = num(col(r, '#', 'attack #', 'no'), w + ' attack number', 1, 9)
        name = text(col(r, 'attack name', 'name'))
        if not boss or not name: die(f'{w}: needs a boss and an attack name')
        eff = text(col(r, 'effect')).lower()
        if eff not in EFFECTS: die(f'{w}: effect "{col(r, "effect")}" is not one of {", ".join(k.title() for k in EFFECTS if k)}')
        chance = text(col(r, 'chance', 'effect chance')).lower()
        cost = col(r, 'energy cost', 'energy', 'cost')
        a = {'name': name, 'cost': 1 if cost is None or text(cost) == '' else num(cost, w + ' energy cost', 0, 5), 'dmg': num(col(r, 'damage'), w + ' damage', 0, 300)}
        flips = num(col(r, 'coin flips'), w + ' coin flips', 0, 6); bench = num(col(r, 'bench damage'), w + ' bench damage', 0, 100)
        if flips: a['flips'] = flips
        if bench: a['bench'] = bench
        if EFFECTS[eff]:
            a['effect'] = EFFECTS[eff]
            if chance.startswith('coin') or chance == 'flip': a['chance'] = 'flip'
            if EFFECTS[eff] == 'heal':
                a['amount'] = num(col(r, 'heal amount', 'heal'), w + ' heal amount', 0, 300)
                if not a['amount']: die(f'{w}: "Heal itself" needs a heal amount')
        if a['dmg'] % 10 or bench % 10: die(f'{w}: damage must be a multiple of 10')
        if k in attacks.setdefault(boss, {}): die(f'{w}: {col(r, "boss")} already has an attack {k}')
        attacks[boss][k] = a

    bosses = []
    for i, r in rows(wb['Bosses']):
        w = f'Bosses row {i}'; name = text(col(r, 'pokémon', 'pokemon', 'name'))
        if not name: die(f'{w}: needs a Pokémon name')
        want = text(col(r, 'set')).lower()
        if want and want not in SETS: die(f'{w}: set "{col(r, "set")}" is not one of Base Set, Jungle, Fossil, Team Rocket, Gym Heroes, Gym Challenge')
        pool = [c for c in cards if c['name'].lower() == name.lower() and c['st'] == 'Pokémon' and c['set'] in SETS.values() and (not want or c['set'] == SETS[want])]
        if not pool: die(f'{w}: no card called "{name}"' + (f' in {col(r, "set")}' if want else '') + ' (it is used for the picture)')
        card = pool[0]
        mine = attacks.pop(name.lower(), None)
        if not mine: die(f'{w}: {name} has no rows on the Attacks tab')
        if sorted(mine) != list(range(1, len(mine) + 1)): die(f'{w}: {name}\'s attacks must be numbered 1, 2, 3 with none missing')
        pat = []
        for tok in re.split(r'[,\s]+', text(col(r, 'attack pattern', 'pattern')).lower()):
            if not tok: continue
            if tok in ('rest', 'r', '0', '-'): pat.append(0)
            elif tok.isdigit() and int(tok) in mine: pat.append(int(tok))
            else: die(f'{w}: pattern entry "{tok}" is not "rest" or one of {name}\'s attack numbers')
        if not any(pat): die(f'{w}: the attack pattern needs at least one attack')
        hp = num(col(r, 'hp'), w + ' HP', 10, 5000)
        if hp % 10: die(f'{w}: HP must be a multiple of 10')
        st = col(r, 'stage', 'order'); stage = num(st, w + ' stage', 1, 20) if st is not None and text(st) != '' else len(bosses) + 1
        bosses.append({'n': len(bosses) + 1, 'stage': stage, 'name': card['name'], 'card': card['id'], 'hp': hp,
                       'type': typ(col(r, 'type'), w + ' type') or (card.get('types') or ['Colorless'])[0], 'wk': typ(col(r, 'weakness'), w + ' weakness'), 'rs': typ(col(r, 'resistance'), w + ' resistance'),
                       'armor': num(col(r, 'armor'), w + ' armor', 0, 100), 'thorns': num(col(r, 'strikes back'), w + ' strikes back', 0, 100), 'enrage': num(col(r, 'enrage'), w + ' enrage', 0, 100),
                       'pattern': pat, 'attacks': [mine[k] for k in sorted(mine)]})
    if attacks: die('the Attacks tab has rows for ' + ', '.join(sorted(attacks)) + ', which is not on the Bosses tab')
    if not bosses: die('the Bosses tab is empty')
    # a boss keeps the number it already has in arena-bosses.js (games in progress refer to it); a new boss gets the next free one
    target = ROOT / 'public' / 'js' / 'arena-bosses.js'
    old = dict((m.group(2), int(m.group(1))) for m in re.finditer(r'\{ n: (\d+), (?:stage: \d+, )?name: "([^"]+)"', target.read_text(encoding='utf-8'))) if target.exists() else {}
    used = {old[b['name']] for b in bosses if b['name'] in old}; free = (k for k in range(1, 1000) if k not in used)
    for b in bosses: b['n'] = old[b['name']] if b['name'] in old else next(free)
    if len({b['name'] for b in bosses}) != len(bosses): die('each boss must be a different Pokémon')
    stages = sorted({b['stage'] for b in bosses})
    if stages != list(range(1, len(stages) + 1)): die(f'the stages must run 1, 2, 3 with none missing (found {stages})')

    rules = {key: d for key, d in RULES.values()}; seen = set()
    for i, r in rows(wb['Rules']):
        label = text(col(r, 'setting')).lower().rstrip(':')
        if label not in RULES: die(f'Rules row {i}: "{col(r, "setting")}" is not a setting this tool knows')
        key = RULES[label][0]; rules[key] = num(col(r, 'value'), f'Rules row {i}', 0, 1000); seen.add(key)
    if rules['kos'] < 1: die('Rules: the boss needs at least 1 Knock Out to win')
    if not 1 <= rules['energyMax'] <= 5: die('Rules: the most Energy it can hold must be 1 to 5 (the Bench has 5 places)')
    if rules['energyHP'] < 10 or rules['energyHP'] % 10: die('Rules: the HP of each Energy Crystal must be a multiple of 10')
    for b in bosses:
        for a in b['attacks']:
            if a['cost'] > rules['energyMax']: die(f"{b['name']}: {a['name']} costs {a['cost']} Energy, more than it can ever hold ({rules['energyMax']})")

    js = lambda v: json.dumps(v, ensure_ascii=False)
    def atk(a):
        parts = [f"name: {js(a['name'])}", f"cost: {a['cost']}", f"dmg: {a['dmg']}"] + [f"{k}: {js(a[k])}" for k in ('flips', 'bench', 'effect', 'chance', 'amount') if k in a]
        return '{ ' + ', '.join(parts) + ' }'
    out = ['// GENERATED by tools/arena_bosses.py from "' + Path(sys.argv[1]).name + '". Don\'t edit by hand: edit the spreadsheet and run the tool.',
           '// The Colossal Pokémon of the Arena, in the order they are fought, and the rules they share.',
           'export const BOSS_RULES = {',
           f"  kos: {rules['kos']},          // Knock Outs the Colossal Pokémon needs to win",
           f"  energyMax: {rules['energyMax']},    // the most Energy it can hold (each one sits on its Bench)",
           f"  energyPerTurn: {rules['energyPerTurn']}, // Energy it gains at the start of each of its turns",
           f"  energyStart: {rules['energyStart']},  // Energy it starts the fight with",
           f"  energyCharge: {rules['energyCharge']}, // Energy Charge: extra Energy it gains on a turn it can't pay for its next attack (0 = off: it uses its 0-cost basic attack instead, or rests)",
           f"  energyHP: {rules['energyHP']},    // HP of each Energy on its Bench",
           f"  maxHit: {rules['maxHit']},     // the most a single move can take off it",
           f"  percentHit: {rules['percentHit']},  // what Super Fang, Life Drain and Destiny Bond do to it instead",
           f"  wr: {rules['wr']},           // 1 = Weakness and Resistance count in boss fights; 0 = they don't, for either side",
           f"  conditions: {{ PSN: {rules['PSN']}, BRN: {rules['BRN']}, CNF: {rules['CNF']}, SLP: {rules['SLP']}, PAR: {rules['PAR']} }}, // how many of its own turns a Special Condition lasts on it (0 = immune)",
           '};', 'export const BOSSES = [']
    for b in bosses:
        out.append(f"  {{ n: {b['n']}, stage: {b['stage']}, name: {js(b['name'])}, card: {js(b['card'])}, hp: {b['hp']}, type: {js(b['type'])}, wk: {js(b['wk'])}, rs: {js(b['rs'])}, armor: {b['armor']}, thorns: {b['thorns']}, enrage: {b['enrage']}, pattern: {js(b['pattern'])},")
        out.append('    attacks: [' + ', '.join(atk(a) for a in b['attacks']) + '] },')
    out.append('];')
    (ROOT / 'public' / 'js' / 'arena-bosses.js').write_text('\n'.join(out) + '\n', encoding='utf-8', newline='')
    for b in sorted(bosses, key=lambda x: x['stage']):
        hit = lambda a: a['dmg'] * (a['flips'] / 2 if a.get('flips') else 1)
        free = [a for a in b['attacks'] if a['cost'] == 0]; jab = max(free, key=hit) if free else None
        en = rules['energyStart']; step = 0; total = 0; turns = 120
        for _ in range(turns):
            en = min(rules['energyMax'], en + rules['energyPerTurn']); k = b['pattern'][step % len(b['pattern'])]
            if not k: step += 1; continue
            a = b['attacks'][k - 1]
            if en >= a['cost']: total += hit(a); en -= a['cost']; step += 1
            elif rules['energyCharge']: en = min(rules['energyMax'], en + rules['energyCharge'])
            elif jab: total += hit(jab)
        print(f"stage {b['stage']}: Colossal {b['name']:<10} {b['hp']:>4} HP   {len(b['attacks'])} attacks   about {total / turns:.0f} damage a turn")
    print(f"wrote public/js/arena-bosses.js ({len(bosses)} bosses in {len(stages)} stages)")

main()
