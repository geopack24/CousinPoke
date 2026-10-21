#!/usr/bin/env python3
"""Add (or refresh) a card set from the PokemonTCG/pokemon-tcg-data JSON.

  python tools/import_set.py <set.json> <set id> "<set name>" <image cache dir>

<set.json> is cards/en/<set id>.json from https://github.com/PokemonTCG/pokemon-tcg-data.
Card images are downloaded once into <image cache dir> (from images.pokemontcg.io) and packed
into public/<set id>.webp, 12 cards per row at 240x330, the same layout as the other sheets.
public/cards.json gets the set entry and its cards (existing entries for that set are replaced).
"""
import json, os, re, sys, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W, H, COLS = 240, 330, 12

def num_key(c):
    m = re.match(r'(\d+)', str(c['number']))
    return (int(m.group(1)) if m else 9999, str(c['number']))

def damage_text(d):
    return (d or '').replace('x', '×')

def convert(c, set_id, i):
    st = c['supertype']
    subs = c.get('subtypes') or []
    if st == 'Pokémon':
        sub = next((s for s in subs if s in ('Basic', 'Stage 1', 'Stage 2', 'Baby')), subs[0] if subs else 'Basic')
    elif st == 'Trainer':
        sub = next((s for s in subs if s in ('Stadium', "Rocket's Secret Machine")), '')
    else:
        sub = 'Basic' if 'Basic' in subs else 'Special'
    out = {
        'id': f"{set_id}-{c['number']}", 'set': set_id, 'n': str(c['number']), 'i': i, 'name': c['name'],
        'st': st, 'sub': sub, 'hp': int(c['hp']) if str(c.get('hp', '')).isdigit() else None,
        'types': c.get('types'), 'ev': c.get('evolvesFrom'),
        'atk': [{'n': a['name'], 'c': a.get('cost') or [], 'd': damage_text(a.get('damage')), 't': a.get('text') or ''} for a in c['attacks']] if c.get('attacks') else None,
        'pw': [{'n': a['name'], 't': a.get('text') or '', **({'kind': a['type']} if a.get('type') and a['type'] != 'Pokémon Power' else {})} for a in c['abilities']] if c.get('abilities') else None,
        'wk': [w['type'] for w in c['weaknesses']] if c.get('weaknesses') else None,
        'rs': [r['type'] for r in c['resistances']] if c.get('resistances') else None,
        'rc': c.get('convertedRetreatCost') or 0,
        'txt': '\n'.join(c['rules']) if st != 'Pokémon' and c.get('rules') else None,
        'rar': c.get('rarity'),
    }
    return out

def main():
    src, set_id, set_name, cache = sys.argv[1:5]
    raw = json.load(open(src, encoding='utf-8'))
    raw = raw['data'] if isinstance(raw, dict) else raw
    raw.sort(key=num_key)
    os.makedirs(cache, exist_ok=True)
    rows = (len(raw) + COLS - 1) // COLS
    sheet = Image.new('RGB', (W * COLS, H * rows), (20, 20, 24))
    cards = []
    for i, c in enumerate(raw):
        path = os.path.join(cache, f"{c['number']}.png")
        if not os.path.exists(path):
            url = c['images']['small']
            req = urllib.request.Request(url, headers={'User-Agent': 'poke-table-import'})
            with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
                f.write(r.read())
        im = Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)
        sheet.paste(im, ((i % COLS) * W, (i // COLS) * H))
        cards.append(convert(c, set_id, i))
    sheet.save(os.path.join(ROOT, 'public', f'{set_id}.webp'), 'WEBP', quality=80, method=6)

    db_path = os.path.join(ROOT, 'public', 'cards.json')
    db = json.load(open(db_path, encoding='utf-8'))
    db['sets'] = [s for s in db['sets'] if s['id'] != set_id] + [{'id': set_id, 'name': set_name, 'count': len(cards), 'cols': COLS}]
    db['cards'] = [c for c in db['cards'] if c['set'] != set_id] + cards
    json.dump(db, open(db_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{set_id}: {len(cards)} cards, sheet {W * COLS}x{H * rows}')

if __name__ == '__main__':
    main()
