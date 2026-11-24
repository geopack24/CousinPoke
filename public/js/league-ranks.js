// Claude-Rank: every league draft pick in the order Claude would take them, best first (a nod to the old Yahoo O-Rank).
// It is one opinion, written for the league's own rules rather than the 1999 game:
//   - any Energy pays any cost and a Double Colorless counts as two, so expensive attacks arrive on turn 2;
//   - Pokémon may evolve the turn they are played, so Stage 2s are fast and the cards that stop evolving or Trainers are brutal;
//   - Weakness is only +10 and Gust of Wind is banned, so Benched engines are safe and "drag it up" attacks are rare and valuable;
//   - every Colorless Pokémon is free (Wigglytuff does 60 for three Energy), so a pick has to beat that, survive it (70 HP or
//     more) or do something no Colorless Pokémon can; Psychic attackers lose 20 damage to most of those free Pokémon;
//   - a pick comes with everything it evolves from, so Gengar brings both Haunters and Dark Alakazam brings Dark Kadabra.
// The keys are the draft's pick names. A pick missing from this list sorts last; tests/engine.test.js keeps the list complete.
export const CLAUDE_RANK = [
  // the first two rounds
  'Charizard', 'Zapdos (Base Set)', 'Aerodactyl', 'Dark Vileplume', "Blaine's Arcanine", 'Alakazam', "Rocket's Zapdos", 'Blastoise',
  "Erika's Victreebel", 'Muk', 'Ninetales', 'Venusaur (Base Set)', 'Arcanine (Base Set)', 'Hitmonchan', 'Electabuzz (Base Set)', 'Mr. Mime',
  // strong starters and engines
  "Giovanni's Nidoking", 'Machamp (Base Set)', 'Gengar', 'Scyther (Jungle)', 'Zapdos (Fossil)', 'Dugtrio', 'Gyarados',
  "Lt. Surge's Raichu (Gym Heroes)", "Rocket's Mewtwo", "Giovanni's Machamp", "Sabrina's Gengar (Gym Challenge)", 'Poliwrath', 'Golduck',
  'Mewtwo (Promo 3)', 'Articuno (Fossil)', 'Dark Machamp', "Sabrina's Alakazam", 'Mewtwo (Promo 12)', "Rocket's Hitmonchan",
  "Misty's Gyarados", 'Dark Blastoise', 'Magmar (Fossil)', 'Dark Charizard', "Koga's Muk", 'Moltres (Promo)', 'Entei',
  "Blaine's Charizard", "Blaine's Ninetales", 'Hitmonlee', 'Nidoking', 'Venusaur (Promo)', 'Raichu (Base Set)', 'Electrode (Base Set)',
  // solid roster players
  'Dewgong', 'Dark Raichu', "Sabrina's Gengar (Gym Heroes)", "Giovanni's Gyarados", "Erika's Weepinbell (Gym Heroes 49)", "Misty's Golduck",
  'Dark Alakazam', "Blaine's Rapidash", 'Primeape', 'Dark Golduck', 'Victreebel', 'Machamp (Promo)', "Erika's Weepinbell (Gym Heroes 48)", 'Beedrill',
  "Koga's Beedrill", 'Vileplume', "Erika's Vileplume", "Giovanni's Nidoqueen", 'Articuno (Promo 48)', "Brock's Primeape", 'Dark Arbok',
  'Dark Muk', 'Dark Hypno', "Lt. Surge's Jolteon", "Brock's Onix (Gym Heroes 69)", 'Machoke', 'Kadabra', "Sabrina's Kadabra",
  'Haunter (Fossil)', "Sabrina's Haunter (Gym Challenge)", "Erika's Venusaur", 'Raichu (Fossil)', 'Rhydon', "Brock's Rhydon", 'Golem',
  'Dark Gyarados', "Brock's Sandslash (Gym Challenge)", 'Magneton (Base Set)', 'Magneton (Fossil)', 'Dark Magneton', "Lt. Surge's Electrode",
  "Misty's Starmie", "Misty's Dewgong", 'Suicune', 'Ho-oh', 'Exeggutor', 'Hypno', 'Dark Primeape', 'Mew (Promo 47)', 'Dark Golbat', 'Vaporeon',
  // depth
  "Lt. Surge's Raichu (Gym Challenge)", 'Dark Jolteon', "Erika's Ivysaur", "Misty's Tentacruel", 'Pinsir', "Giovanni's Pinsir",
  "Rocket's Scyther", 'Jolteon', "Brock's Golem", "Brock's Golbat", 'Moltres (Fossil)', 'Arcanine (Promo)', 'Magmar (Promo)',
  "Brock's Onix (Gym Heroes 21)", "Brock's Sandslash (Gym Heroes)", "Misty's Cloyster", 'Dark Kadabra', 'Haunter (Base Set)', 'Poliwhirl',
  'Flareon', 'Jynx', 'Mewtwo (Base Set)', "Giovanni's Machoke", 'Dark Machoke', 'Charmeleon', "Misty's Seadra", 'Rapidash (Jungle)',
  'Articuno (Promo 22)', 'Zapdos (Promo)', 'Scyther (Promo)', "Blaine's Moltres", "Brock's Dugtrio", 'Dark Vaporeon', 'Marowak',
  "Sabrina's Hypno", "Brock's Ninetales", "Koga's Arbok", "Giovanni's Nidorina", 'Arbok', "Lt. Surge's Magneton", 'Nidoqueen',
  "Koga's Weezing", "Misty's Poliwhirl", 'Dark Slowbro', 'Slowbro', 'Kabutops', "Lt. Surge's Electabuzz (Gym Heroes 6)", "Rocket's Moltres",
  'Magmar (Base Set)', 'Lapras', 'Weepinbell', 'Parasect', 'Butterfree', 'Dark Charmeleon', 'Mew (Promo 8)', "Sabrina's Jynx (Gym Heroes)",
  "Koga's Tangela", 'Tangela', "Blaine's Charmeleon", "Misty's Seaking",
  // late rounds and free agents
  "Giovanni's Nidorino", 'Nidorino', 'Nidorina', 'Wartortle', 'Metapod', 'Gloom', 'Tentacruel', 'Sandslash', 'Electabuzz (Promo 2)',
  "Erika's Gloom (Gym Heroes 45)", "Erika's Exeggutor", 'Dark Gloom', "Misty's Poliwrath", 'Omastar', 'Onix', 'Kingler', 'Starmie',
  'Dark Wartortle', "Sabrina's Slowbro", 'Dark Rapidash', 'Dark Flareon', "Erika's Gloom (Gym Heroes 46)", 'Graveler',
  "Brock's Graveler (Gym Heroes)", "Brock's Graveler (Gym Challenge)", 'Dark Weezing', 'Hitmontop', "Sabrina's Venomoth", "Koga's Golbat",
  'Dark Dugtrio', 'Venomoth', 'Golbat', 'Weezing', 'Electrode (Jungle)', 'Cloyster', 'Rapidash (Promo)', 'Ivysaur', 'Kakuna',
  'Electabuzz (Promo 46)', "Blaine's Magmar", "Lt. Surge's Electabuzz (Gym Heroes 27)", "Sabrina's Golduck", 'Dark Electrode', 'Seaking',
  'Seadra', "Koga's Kakuna", "Sabrina's Mr. Mime (Gym Challenge)", "Sabrina's Mr. Mime (Gym Heroes)", 'Celebi', "Blaine's Rhyhorn",
  "Erika's Tangela", 'Surfing Pikachu', "_____'s Pikachu", "Sabrina's Haunter (Gym Heroes)", 'Misdreavus', "Sabrina's Jynx (Gym Challenge)",
  "Erika's Paras", 'Marill', 'Flying Pikachu', 'Omanyte', 'Kabuto', "Blaine's Mankey", 'Unown [J]', 'Pichu',
];
