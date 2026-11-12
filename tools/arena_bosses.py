"""Turn the Arena bosses spreadsheet into public/js/arena-bosses.js.

    python tools/arena_bosses.py "path/to/Arena bosses.xlsx"

Tabs read: Bosses (one row per Colossal Pokémon, in fight order), Attacks (one row per attack), Rules (shared settings).
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
    'knock outs the boss needs to win': ('kos', 6), 'weak points on its bench': ('parts', 3), 'extra damage when a weak point is hit': ('partBonus', 0),
    'biggest hit from one move': ('maxHit', 150), 'super fang, life drain and destiny bond do this much': ('percentHit', 40),
    'poisoned lasts (boss turns)': ('PSN', 2), 'burned lasts (boss turns)': ('BRN', 2), 'confused lasts (boss turns)': ('CNF', 2), 'asleep lasts (boss turns)': ('SLP', 0), 'paralyzed lasts (boss turns)': ('PAR', 0),
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
        a = {'name': name, 'dmg': num(col(r, 'damage'), w + ' damage', 0, 300)}
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
        bosses.append({'n': len(bosses) + 1, 'name': card['name'], 'card': card['id'], 'hp': hp,
                       'type': typ(col(r, 'type'), w + ' type') or (card.get('types') or ['Colorless'])[0], 'wk': typ(col(r, 'weakness'), w + ' weakness'), 'rs': typ(col(r, 'resistance'), w + ' resistance'),
                       'armor': num(col(r, 'armor'), w + ' armor', 0, 100), 'thorns': num(col(r, 'strikes back'), w + ' strikes back', 0, 100), 'enrage': num(col(r, 'enrage'), w + ' enrage', 0, 100),
                       'pattern': pat, 'attacks': [mine[k] for k in sorted(mine)]})
    if attacks: die('the Attacks tab has rows for ' + ', '.join(sorted(attacks)) + ', which is not on the Bosses tab')
    if not bosses: die('the Bosses tab is empty')
    if len({b['name'] for b in bosses}) != len(bosses): die('each boss must be a different Pokémon')

    rules = {key: d for key, d in RULES.values()}; seen = set()
    for i, r in rows(wb['Rules']):
        label = text(col(r, 'setting')).lower().rstrip(':')
        if label not in RULES: die(f'Rules row {i}: "{col(r, "setting")}" is not a setting this tool knows')
        key = RULES[label][0]; rules[key] = num(col(r, 'value'), f'Rules row {i}', 0, 1000); seen.add(key)
    if rules['kos'] < 1: die('Rules: the boss needs at least 1 Knock Out to win')

    js = lambda v: json.dumps(v, ensure_ascii=False)
    def atk(a):
        parts = [f"name: {js(a['name'])}", f"dmg: {a['dmg']}"] + [f"{k}: {js(a[k])}" for k in ('flips', 'bench', 'effect', 'chance', 'amount') if k in a]
        return '{ ' + ', '.join(parts) + ' }'
    out = ['// GENERATED by tools/arena_bosses.py from "' + Path(sys.argv[1]).name + '". Don\'t edit by hand: edit the spreadsheet and run the tool.',
           '// The Colossal Pokémon of the Arena, in the order they are fought, and the rules they share.',
           'export const BOSS_RULES = {',
           f"  kos: {rules['kos']},          // Knock Outs the Colossal Pokémon needs to win",
           f"  parts: {rules['parts']},        // weak points on its Bench (damage done to one is done to the Colossal Pokémon)",
           f"  partBonus: {rules['partBonus']},    // extra damage each time a weak point is hit",
           f"  maxHit: {rules['maxHit']},     // the most a single move can take off it",
           f"  percentHit: {rules['percentHit']},  // what Super Fang, Life Drain and Destiny Bond do to it instead",
           f"  wr: {rules['wr']},           // 1 = Weakness and Resistance count in boss fights; 0 = they don't, for either side",
           f"  conditions: {{ PSN: {rules['PSN']}, BRN: {rules['BRN']}, CNF: {rules['CNF']}, SLP: {rules['SLP']}, PAR: {rules['PAR']} }}, // how many of its own turns a Special Condition lasts on it (0 = immune)",
           '};', 'export const BOSSES = [']
    for b in bosses:
        out.append(f"  {{ n: {b['n']}, name: {js(b['name'])}, card: {js(b['card'])}, hp: {b['hp']}, type: {js(b['type'])}, wk: {js(b['wk'])}, rs: {js(b['rs'])}, armor: {b['armor']}, thorns: {b['thorns']}, enrage: {b['enrage']}, pattern: {js(b['pattern'])},")
        out.append('    attacks: [' + ', '.join(atk(a) for a in b['attacks']) + '] },')
    out.append('];')
    (ROOT / 'public' / 'js' / 'arena-bosses.js').write_text('\n'.join(out) + '\n', encoding='utf-8', newline='')
    for b in bosses:
        cyc = len(b['pattern']); dmg = sum(b['attacks'][k - 1]['dmg'] * (b['attacks'][k - 1].get('flips', 2) / 2 if b['attacks'][k - 1].get('flips') else 1) for k in b['pattern'] if k)
        print(f"{b['n']}. Colossal {b['name']:<10} {b['hp']:>4} HP   {len(b['attacks'])} attacks   pattern of {cyc} turns, about {dmg / cyc:.0f} damage a turn")
    print(f"wrote public/js/arena-bosses.js ({len(bosses)} bosses)")

main()
