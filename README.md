# Poké Table

A tabletop-style site for playing the original Pokémon TCG sets (Base Set, Jungle, Fossil, Team Rocket, Gym Heroes, Gym Challenge) with family on separate devices. Deck builder, house rules per table, shared game board with a move log.

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
