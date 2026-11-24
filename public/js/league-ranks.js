// Claude-Rank: a strength score from 1 to 100 for every league draft pick (a nod to the old Yahoo O-Rank).
// It is one opinion, written for the league's own rules rather than the 1999 game:
//   - a deck needs few Basic Pokémon: a hand with no Basic costs nothing much, and a player with no Pokémon left draws into
//     a new one instead of losing. So decks are mostly draw Trainers around one or two lines, which favours the Pokémon that
//     reward a full hand (Charizard, Rain Dance Blastoise, attackers that refuel from the discard pile) and makes the cards
//     that stop Trainers or evolving (Dark Vileplume, Aerodactyl) the best answers. Opponents' Benches are small, so Bench
//     damage and "drag it up" effects are worth less than they look;
//   - any Energy pays any cost and a Double Colorless counts as two, so expensive attacks arrive on turn 2;
//   - Pokémon may evolve the turn they are played, so Stage 2s are fast;
//   - Weakness is only +10 and Gust of Wind is banned, so a Benched engine (Alakazam, Blastoise, Muk) is safe;
//   - every Colorless Pokémon is free (Wigglytuff does 60 for three Energy), so a pick has to beat that, survive it (70 HP or
//     more) or do something no Colorless Pokémon can; Psychic attackers lose 20 damage to most of those free Pokémon;
//   - a pick comes with everything it evolves from, so Gengar brings both Haunters and Dark Alakazam brings Dark Kadabra.
// The keys are the draft's pick names. A pick missing from this list sorts last; tests/engine.test.js keeps the list complete.
export const CLAUDE_SCORE = {
  // 85 and up: the picks decks are built around, and the ones that shut those decks down
  // (after the commissioner's read of the league's own games: Rain Dance and Energy Trans are better here than anywhere, and
  //  Dark Vileplume is a Stage 2 that a whole deck has to be built around, with its own Trainers switched off too)
  Charizard: 99, Blastoise: 97, Aerodactyl: 95, 'Zapdos (Base Set)': 93, 'Venusaur (Base Set)': 91, "Blaine's Arcanine": 89,
  'Dark Vileplume': 88, Alakazam: 87, Muk: 85, "Rocket's Zapdos": 85,
  // 75 to 84: strong attackers and engines
  'Mr. Mime': 84, 'Arcanine (Base Set)': 82, Ninetales: 81, Hitmonchan: 81, "Giovanni's Nidoking": 80,
  'Electabuzz (Base Set)': 80, 'Machamp (Base Set)': 79, Gengar: 78, Poliwrath: 78, "Lt. Surge's Raichu (Gym Heroes)": 78,
  "Erika's Victreebel": 77, 'Mewtwo (Promo 3)': 77, Gyarados: 77, 'Scyther (Jungle)': 76, Dugtrio: 76, Golduck: 76,
  "Giovanni's Machamp": 76, "Rocket's Mewtwo": 75, "Sabrina's Gengar (Gym Challenge)": 75,
  // 65 to 74: good roster players
  "Sabrina's Alakazam": 74, 'Dark Charizard': 74, "Rocket's Hitmonchan": 73, 'Articuno (Fossil)': 73, 'Dark Blastoise': 73,
  "Blaine's Charizard": 73, "Misty's Gyarados": 72, 'Magmar (Fossil)': 72, "Koga's Muk": 72, 'Electrode (Base Set)': 72,
  "Blaine's Ninetales": 71, 'Zapdos (Fossil)': 70, 'Moltres (Promo)': 70, Nidoking: 70, 'Raichu (Base Set)': 69, Hitmonlee: 68,
  'Mewtwo (Promo 12)': 68, 'Venusaur (Promo)': 68, Dewgong: 67, "Misty's Golduck": 67, "Sabrina's Gengar (Gym Heroes)": 66,
  'Dark Alakazam': 66, 'Dark Golduck': 66, "Blaine's Rapidash": 65, Primeape: 65,
  // 50 to 64: playable, with a job to do
  Beedrill: 63, "Koga's Beedrill": 63, "Lt. Surge's Jolteon": 63, 'Dark Machamp': 62, 'Dark Raichu': 62, "Giovanni's Gyarados": 62,
  'Machamp (Promo)': 62, Vileplume: 62, "Erika's Vileplume": 61, "Giovanni's Nidoqueen": 61, 'Dark Arbok': 61, 'Articuno (Promo 48)': 60,
  "Brock's Primeape": 60, 'Dark Muk': 59, Victreebel: 58, "Brock's Onix (Gym Heroes 69)": 58, 'Mew (Promo 47)': 58, Rhydon: 57,
  Golem: 56, 'Dark Gyarados': 56, "Brock's Sandslash (Gym Challenge)": 56, "Erika's Venusaur": 55, "Brock's Rhydon": 55,
  'Magneton (Base Set)': 55, 'Magneton (Fossil)': 55, 'Dark Magneton': 55, "Misty's Starmie": 55, Exeggutor: 55, 'Raichu (Fossil)': 54,
  "Lt. Surge's Electrode": 54, "Misty's Dewgong": 54, 'Dark Primeape': 53, 'Dark Hypno': 52, Hypno: 52, Vaporeon: 52,
  "Lt. Surge's Raichu (Gym Challenge)": 51, 'Dark Jolteon': 51, 'Dark Golbat': 50, "Misty's Tentacruel": 50, Pinsir: 50,
  // 35 to 49: depth
  "Giovanni's Pinsir": 49, "Rocket's Scyther": 49, Jolteon: 49, 'Arcanine (Promo)': 49, "Brock's Golem": 48, 'Magmar (Promo)': 48,
  'Moltres (Fossil)': 47, 'Mewtwo (Base Set)': 47, "Brock's Sandslash (Gym Heroes)": 46, "Misty's Cloyster": 46, Flareon: 46, Jynx: 46,
  "Brock's Onix (Gym Heroes 21)": 45, "Misty's Seadra": 45, 'Rapidash (Jungle)': 45, "Brock's Golbat": 44, 'Scyther (Promo)': 44,
  "Blaine's Moltres": 44, 'Dark Vaporeon': 44, 'Articuno (Promo 22)': 43, "Brock's Dugtrio": 43, "Lt. Surge's Electabuzz (Gym Heroes 6)": 43,
  'Zapdos (Promo)': 42, Marowak: 42, "Brock's Ninetales": 42, "Koga's Arbok": 42, "Sabrina's Hypno": 41, Arbok: 41, Nidoqueen: 41,
  'Dark Slowbro': 41, "Lt. Surge's Magneton": 40, "Koga's Weezing": 40, Kabutops: 39, Slowbro: 38, "Rocket's Moltres": 38,
  'Magmar (Base Set)': 38, Lapras: 38, Parasect: 38, Butterfree: 37, 'Mew (Promo 8)': 37, "Sabrina's Jynx (Gym Heroes)": 36,
  "Koga's Tangela": 36, Tangela: 35,
  // under 35: late rounds and free agents
  "Misty's Seaking": 34, Tentacruel: 34, Sandslash: 33, 'Electabuzz (Promo 2)': 33, "Erika's Exeggutor": 32, "Misty's Poliwrath": 32,
  Omastar: 31, Onix: 31, Kingler: 31, Starmie: 30, "Sabrina's Slowbro": 29, 'Dark Rapidash': 28, 'Dark Flareon': 27, 'Dark Weezing': 26,
  "Sabrina's Venomoth": 26, "Koga's Golbat": 25, Venomoth: 25, 'Dark Dugtrio': 24, Golbat: 23, Weezing: 22, 'Electrode (Jungle)': 22,
  "Blaine's Magmar": 22, Cloyster: 21, 'Rapidash (Promo)': 21, 'Electabuzz (Promo 46)': 19, "Lt. Surge's Electabuzz (Gym Heroes 27)": 18,
  "Sabrina's Golduck": 17, 'Dark Electrode': 16, Seaking: 15, Seadra: 15, "Sabrina's Mr. Mime (Gym Challenge)": 14,
  "Sabrina's Mr. Mime (Gym Heroes)": 14, "Blaine's Rhyhorn": 12, "Erika's Tangela": 12, 'Surfing Pikachu': 10, "_____'s Pikachu": 10,
  "Sabrina's Jynx (Gym Challenge)": 8, "Erika's Paras": 8, 'Flying Pikachu': 6, "Blaine's Mankey": 4,
};
/** Pick names from the highest score down; equal scores keep the order they are written in above. */
export const CLAUDE_RANK = Object.keys(CLAUDE_SCORE).map((k, i) => [k, i]).sort((a, b) => CLAUDE_SCORE[b[0]] - CLAUDE_SCORE[a[0]] || a[1] - b[1]).map((x) => x[0]);
