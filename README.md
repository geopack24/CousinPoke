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
- `functions/api/[[route]].js` — the API: `POST /api/sync`, plus `GET`/`PUT`/`DELETE` on `/api/{games|decks|players|leagues|arena}/{id}`.

Card data comes from the PokemonTCG/pokemon-tcg-data project and images.pokemontcg.io. Card art is © The Pokémon Company; this is a private fan project.

## Automated tables

Tables created in "auto" mode run a rules engine (`public/js/engine/`) with scripts for every card in all seven sets (`public/js/engine/cards/`; promos are in `promo.js`). Stadium cards sit in the middle bar; cards that can't be fully automated (Lt. Surge's Secret Plan, Sabrina's ESP re-flips, Chaos Gym's "opponent may use it" clause) are noted in the log and can be settled with the Fix menu.

- `npm test` runs the engine tests.
- `npm run smoke` runs every scripted attack, power and trainer with auto-answered prompts and reports crashes.

## Practice against the computer

New table → "Practice against the computer" puts a computer opponent in seat B with one of three built-in decks (Haymaker, Rain Dance, Charizard) or any of your own decks. It plays with the same rules engine. On its turn it tries each legal move on a copy of the game, plays the turn out (each attack averaged over a few coin flips of its own, never the real ones), scores the board (prizes, damage, energy where it is useful, evolutions, knockout threats, hand and deck sizes; it never looks at your hand) and keeps the best line. Its moves run in your browser one at a time, so you see every animation. `public/js/bot.js` holds the policy; prompts it cannot reason about get a sensible default answer.

## The Arena (single player)

Arena → Start a run. Make 40 picks, each 1 of 3 cards or a basic Energy instead: only the top of each evolution line is offered, and an evolved Pokémon brings its whole line (2 of each card). Every deck is also given 4 Bills (Bill is not in the draft), 1 Professor Oak and 15 basic Energy for its Pokémon's types, making 60. Then fight the Colossal Pokémon, one per win, until 7 wins or the first loss, which ends the run (see below). Runs and the leaderboard live in the `arena` collection (one document per player). `public/js/arena-draft.js` is the draft (pure, shared with the simulator); `public/js/arena.js` is the screen.

A Trainer whose text needs a Pokémon "with X in its name" (Brock's Training Method, Koga, The Boss's Way…) is only offered once the deck has a matching Pokémon. Every draftable card has a rarity tier (Common, Uncommon, Rare, Epic, Legendary). Each slot rolls a tier by its weight first, then a random card from that tier, so a tier's size never changes how often it comes up. Rare, Epic and Legendary cards glow blue, purple and orange when they are dealt, with a sound for each. A finished run pays Cousin Tokens by wins (`ARENA_REWARDS`: 0, 15, 30, 50, 75, 100, 150, 250), shown by opening a prize chest; a 7-win run also unlocks a gold holographic version of a random Pokémon the player doesn't have in gold yet. The balance and gold cards live in the player's `arena` document (`tokens`, `gold`). The tiers and weights come from a spreadsheet: `python tools/arena_tiers.py "Arena rarity tiers.xlsx"` rewrites `public/js/arena-tiers.js`.

### Colossal Pokémon (the Arena's bosses)

Each Arena game is against one Colossal Pokémon: a single giant with a large HP pool in seat B, no deck, hand or Prizes. `public/js/engine/boss.js` builds the game (`newBossGame`) and the boss cards; the rules live in `engine.js` behind `g.boss`.

- **Reward.** After each win the player is shown 3 cards (`makeSwapOffer`) and may swap one into the deck in place of a pick of the same size: a single card for a single card, an evolution line for a line of the same length. A size the deck has none of is never offered, and what leaves the deck is gone for good.
- **Winning and losing.** Knock it Out to win. It wins when it has Knocked Out 6 of your Pokémon (Clefairy Doll and Mysterious Fossil don't count). You take a Prize for each sixth of its HP you knock off.
- **Energy.** It starts with none and gains 1 at the start of each of its turns (up to 5). Each attack has an Energy cost, all of which is used up. It works through its attack pattern in order: when it can pay for the next attack it uses it, otherwise it spends the turn charging. The table shows what is coming and how much Energy it has for it.
- **Its Energy is on its Bench.** Each Energy is a Bench target with 20 HP and is also attached to the boss as an Energy card. Knock one Out (attacks that hit the Bench) or discard one (Energy Removal, attacks that discard Energy) and it is gone, which holds the boss's attacks back. No Prize for it.
- **Its attacks** get past Pokémon Powers that prevent damage (Invisible Wall).
- **No Weakness or Resistance.** Neither counts in a boss fight, for your Pokémon or the boss.
- **Special Conditions.** Poison, Burn and Confusion wear off after 2 of its turns. It can't be Asleep or Paralyzed, and effects that stop it attacking, move it, copy it or return it to hand do nothing.
- **Limits.** No single move takes more than 150 off it. Super Fang, Life Drain and Destiny Bond do a fixed 40 instead.
- **Traits.** A boss may have armor (less damage from each attack), strike back (damage to whatever hits it) and an enrage bonus at half HP.

The bosses, their attacks and the shared settings come from a spreadsheet: `python tools/arena_bosses.py "Arena bosses.xlsx"` rewrites `public/js/arena-bosses.js`. Left out of the draft: Trainers that do nothing against a boss (Sleep!, Pokémon Flute…) or that have the opponent draw cards (Erika, Blaine's Quizzes, Misty's Duel, Sabrina's Gaze), and Mr. Mime, Clefable (with its Clefairy) and Sabrina's Jynx, which are too strong against one huge Pokémon. A card effect that gives the opponent a Prize (Electrode's Buzzap) counts as a Knock Out for the boss.

## Ranked league

The League tab (`public/js/league.js`) runs a yearly draft and the standings for ranked play. Everything is one document, `leagues/main`; whoever sets the league up is the commissioner.

- **Draft.** Every Pokémon name is its own pick: Charizard, Dark Charizard and Blaine's Charizard are three different players' Pokémon. Snake order, set by the commissioner. The draft keeps going until every player presses "I'm done drafting" (or the commissioner ends it); whatever is left becomes a free agent that any player can claim. Whoever is on the clock hears the turn chime.
- **Free cards.** Owning a Pokémon lets you play everything it evolves from (own Charizard, play Charmander and Charmeleon). Colorless Pokémon, Trainers and Energy are free for everyone; Colorless Pokémon aren't in the draft, and neither are Basic Pokémon that evolve (they come with their evolutions). Cards that share a name but play differently are separate picks, labelled by set: Zapdos (Base Set) and Zapdos (Fossil). Holo and non-holo prints of the same card are one pick. That leaves 196 picks. Promo printings aren't allowed.
- **Practice league.** Add `?league=test` (any short lowercase name) to the address to use a separate practice league with its own draft, rosters and results. The real league is untouched.
- **Keepers.** From the second season on, each player can keep one Pokémon from last season's roster; it uses their round 1 pick. Turning keepers off for a season is a keeper reset.
- **Trades.** Offer Pokémon for Pokémon on the Trades tab. When the other player accepts, the commissioner approves it (trades involving the commissioner go through on acceptance). The commissioner can veto, undo picks, move Pokémon between rosters and start the next season.
- **Major Championships.** Four majors a year (Winter Opener, Spring Invitational, Summer Championship, Fall Classic), each a double-elimination bracket for three players: Game 1 is two players, Game 2 is Game 1's loser against the third, Game 3 is the pair that hasn't met; two losses and you're out, and the last two play the final. If everyone is 1-1 after three games, the previous major's winner gets a bye into the final. Matches are played at Major match tables (only the two scheduled players can sit, decks are checked against rosters, standard league rules) and results go into the bracket automatically; the commissioner starts each major and can enter, undo or reset results. Each winner gets that major's resplendent Poké Ball (`public/art/ball-*.svg`); most majors in a year is the league champion. The deck builder has a "My league roster" filter and shows whether a deck is league-legal.

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

