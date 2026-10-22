# Cousin Pokémon League

A tabletop-style site for playing the original Pokémon TCG sets (Base Set, Jungle, Fossil, Team Rocket, Gym Heroes, Gym Challenge, and the Wizards Black Star Promos) with family on separate devices. Deck builder, house rules per table, shared game board with a move log.

The site runs on Cloudflare Pages. The static page lives in `public/`, and a single Pages Function in `functions/api/` stores tables, decks and player names in a Cloudflare D1 database. Players poll the server every couple of seconds while at a table, so moves show up for everyone within a moment.

## Deploying on Cloudflare (one-time setup)

1. Push this repo to GitHub (private is fine).
2. In the Cloudflare dashboard: **Compute → Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
   Build command: leave empty. Build output directory: `public`. Deploy.
3. **Storage & databases → D1 → Create database**, name it `poke-table`.
4. Back in the Pages project: **Settings → Bindings → Add → D1 database**. Variable name `DB`, choose the `poke-table` database. Save.
5. **Deployments → Retry deployment** (or push a commit) so the binding takes effect.

The database tables are created automatically on first use. No SQL to run by hand.

## Everyday use

- Open the `*.pages.dev` link (or your custom domain), set your name, build a deck, create a table.
- Anyone with the link can sit down. There are no accounts; keep the link within the family.
- Push to the `main` branch to redeploy.

## Layout

- `public/index.html` — the whole app (lobby, deck builder, game table).
- `public/cards.json` — card data for the six sets. `public/*.webp` — card art sprite sheets and the card back.
- `functions/api/[[route]].js` — the API: `POST /api/sync`, plus `GET`/`PUT`/`DELETE` on `/api/{games|decks|players}/{id}`.

Card data comes from the PokemonTCG/pokemon-tcg-data project and images.pokemontcg.io. Card art is © The Pokémon Company; this is a private fan project.

## Automated tables

Tables created in "auto" mode run a rules engine (`public/js/engine/`) with scripts for every card in all seven sets (`public/js/engine/cards/`; promos are in `promo.js`). Stadium cards sit in the middle bar; cards that can't be fully automated (Lt. Surge's Secret Plan, Sabrina's ESP re-flips, Chaos Gym's "opponent may use it" clause) are noted in the log and can be settled with the Fix menu.

- `npm test` runs the engine tests.
- `npm run smoke` runs every scripted attack, power and trainer with auto-answered prompts and reports crashes.

## Practice against the computer

New table → "Practice against the computer" puts a computer opponent in seat B with one of three built-in decks (Haymaker, Rain Dance, Charizard) or any of your own decks. It plays with the same rules engine, choosing from the table's legal actions: it benches Basics, evolves, attaches energy where it is needed, draws with Bill, Oak and Computer Search, uses PlusPower, Defender and Energy Removal when they matter, retreats a stuck Active, and picks the strongest attack, going for knockouts. Its moves run in your browser one at a time, so you see every animation. `public/js/bot.js` holds the policy; prompts it cannot reason about get a sensible default answer.

## Playing from another device

Decks belong to a player id stored in the browser. To carry yours to a phone or another PC, open "Set your name", enter a PIN or passphrase and press "Set PIN"; on the other device enter the same PIN and press "Sign in with PIN". That device then plays as you, with your name and decks. The PIN itself is never stored, only a hash that points at your player.

## Phones, drag and drop

Under 700px wide the table switches to a compact layout that fits one phone screen: smaller cards, the opponent's piles as a row of counters, your hand as a sideways-scrolling strip, the log behind a Log button. On any screen you can drag a hand card onto one of your Pokémon to attach energy or evolve it, drag a Basic onto your bench to play it, drag a Trainer onto the board to play it, or drag a benched Pokémon onto your Active spot to retreat into it or promote it. Valid drop targets light up while you drag; tapping a card still opens its menu for attacks and everything else.

## Sound

`public/js/sfx.js` synthesises every sound with the Web Audio API (square and triangle chiptune tones plus filtered noise), so there are no recorded clips and nothing copyrighted. Each type has a launch and an impact sound, physical hits have swishes and thuds, and coins, knockouts, heals and Charizard's Fire Spin have their own. Browsers keep audio muted until the player has clicked something on the page once. Volume is under More… (on/off) and as a slider in the animation lab; it is remembered per device.

## Match-start music

When both players are ready and the first turn begins, `public/js/music.js` plays an original four-channel chiptune battle intro (two pulse waves, triangle bass, noise drums) for 10 seconds and fades it out. To use your own track instead, put a file named `battle.mp3` in `public/`; if it exists the game plays it with the same fade. The lab has a button to preview either.

Each Pokémon can have its own track too: drop `charizard.mp3` (or `.ogg`, `.wav`, `.m4a`) into `public/music/` and it plays for 10 seconds, then fades, whenever a Charizard becomes a player's Active Pokémon. File names are the card name in lowercase with punctuation and spaces as dashes (`blaines-charizard.mp3`, `mr-mime.mp3`, `nidoran-f.mp3`); `public/music/README.txt` has the rule and the lab shows the exact name for any card.

## Attack animations

`public/js/fx.js` draws attacks on a canvas over the board. Every attack gets a default animation for the attacker's type (Fire fireball, Water stream, Lightning strike, Grass leaves, Psychic rings, Fighting impact, Colorless slashes) after the attacking card jiggles. Signature moves live in `MOVE_FX` in the same file, keyed by attack name (`'Fire Spin'`) or by card and attack (`'base1-4|Fire Spin'`), and win over the type default. To add one, write a function `(fx, scene) => ({ impact, done })` using the toolkit on `fx` (`particle`, `burst`, `ring`, `bolt`, `beam`, `flash`, `glowSpot`, `slash`, `text`, `emitter`, `shake`, `at`). `scene.from` and `scene.targets[0]` are the attacker and defender rectangles. Both players' screens animate: the acting client stores the attack's events on the table document (`doc.fx`) and the other client plays them when it syncs. Players can turn animations off under More…. `/fx-lab.html` is a standalone page for trying animations: pick any two cards, click an attack, a type default or a signature move, and press space to replay.

Local testing: `python tools/devserver.py public 8766`, then `node tools/seed-dev.mjs` seeds a ready-to-attack table and `node tools/act-dev.mjs fxtest b '{"type":"attack","index":0}'` plays the other seat's move.

## Adding a set

`tools/import_set.py` adds a set from the [pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) JSON: it converts the cards into `public/cards.json`, downloads the card images once and packs them into `public/<set>.webp`. Then write the set's scripts in `public/js/engine/cards/` and register them in `index.js`; `npm run smoke` shows anything that crashes.

```
python tools/import_set.py basep.json basep "Wizards Black Star Promos" <image cache folder>
```

The promos brought a few rules from later sets: Baby Pokémon (played like Basics; attacks on them need heads; Cleffa, Pichu and Igglybuff evolve into Clefairy, Pikachu and Jigglypuff), the Burned condition (flip between turns, tails is 20 damage), and Poké-Bodies (Suicune). Unown [J]'s [Join] needs other Unown that aren't in these sets yet, so it can't be used.

