// House rules and deck validation.
export const DEFAULT_RULES = {
  deckSize: 60, prizes: 6, handSize: 7, benchSize: 5, maxCopies: 4,
  firstTurnAttack: false,      // the player who goes first may attack on turn 1
  autoDraw: true,              // draw at the start of each turn
  mulliganDraw: 1,             // extra cards the opponent may draw per mulligan (ignored when mulliganRescue is on)
  mulliganRescue: true,        // house mulligan: the opponent may mulligan too (no extra draw); a second miss draws one card at a time (max 5, opponent draws as many); 5 misses loses
  colorlessCosts: true,        // any energy pays any attack cost
  noAttackAfterRetreat: true,  // retreating ends your chance to attack this turn
  unlimitedTrainers: true,     // informational
  conditionsPersist: true,     // special conditions stay when a Pokémon is benched, and keep working there (poison/burn damage, wake-up flips)
  deckOutDamage: true,         // empty deck: 10 damage to your Active each turn instead of losing
  multiEvolve: true,           // a Pokémon may evolve more than once per turn
  confusedRetreatFlip: true,   // confused Pokémon flip to retreat (tails: self damage)
  confusionSelfDamage: 20,     // damage a Confused Pokémon does to itself on a failed flip
  conditionsStack: true,       // Asleep, Confused and Paralyzed can all be on one Pokémon at once
  evolveSameTurn: true,        // a Pokémon may evolve on the turn it was played (and on turn 1)
  benchRescue: true,           // no Pokémon left: a Basic in hand must be played (no drawing); otherwise draw until a Basic (max 7) and play it, and the opponent draws as many; 7 misses loses
  anyVersionEvolves: true,     // an Evolution card may go on any version of its species (Blaine's Charmeleon on a plain Charmander)
  askEveryChoice: true,        // the player makes every choice, even when there's only one option (nothing is picked automatically)
  basicEnergyAnyType: true,    // any basic Energy card counts as any type for card text (search, attach, discard, move, count); Colorless doesn't
  specialEnergyAnyType: true,  // an attached Double Colorless, Full Heal or Potion Energy counts as one Energy card of any type for card text ("discard a Fire Energy", "for each Fire Energy attached")
  energyPickup: true,          // instead of attaching an Energy this turn, you may take a basic Energy off one of your Pokémon back to hand
  dceCountsAsWater: true,      // Hydro Pump / Water Gun bonus: an attached Double Colorless counts as 2 Water
  dceNoReturn: true,           // an attached Double Colorless never returns to hand: effects that would return it discard it instead
  charizardDoubleDiscard: true, // Base Set Charizard's Fire Spin may discard energy worth 2 (one Double Colorless) instead of 2 cards
  weaknessBonus: 10,           // Weakness adds this much damage (0 = official doubling)
  resistanceAmount: 20,        // Resistance takes this much off (official: 30)
  banned: ["Imposter Oak's Revenge", 'Impostor Professor Oak', 'Lass', 'Scoop Up', 'Gust of Wind',
    // Pokémon that aren't among the original ones (the promos' Johto Pokémon); a banned Pokémon is also left out of the league and Arena drafts:
    'Scizor', 'Entei', 'Suicune', 'Ho-oh', 'Celebi', 'Marill', 'Togepi', 'Cleffa', 'Igglybuff', 'Pichu', 'Smeargle', 'Hitmontop', 'Misdreavus', 'Unown [J]',
    // and every Stadium card:
    "No Removal Gym", "The Rocket's Training Gym", "Celadon City Gym", "Cerulean City Gym", "Pewter City Gym", "Vermilion City Gym", "Narrow Gym", "Chaos Gym", "Resistance Gym", "Cinnabar City Gym", "Fuchsia City Gym", "Rocket's Minefield Gym", "Saffron City Gym", "Viridian City Gym", "Lucky Stadium", "Pokémon Tower"],
  // single printings that are out, by card id: the four promos printed in the later e-Reader frame, which looks like nothing
  // else in the game (Celebi, Rapidash, Ho-oh, Suicune). Jungle's Rapidash is untouched.
  bannedIds: ['basep-50', 'basep-51', 'basep-52', 'basep-53'],
  limits: { 'Energy Removal': 2, 'Super Energy Removal': 2, 'Pokémon Center': 2 },
  notes: '',
};
export const R = (r) => Object.assign({}, DEFAULT_RULES, r || {});

/** Is this card out of the game under these rules: by name, or this printing by id? */
export const isBannedCard = (rules, card) => !!card && ((rules.banned || []).includes(card.name) || (rules.bannedIds || []).includes(card.id));

export function isBasicLike(card) {
  return (card.st === 'Pokémon' && (card.sub === 'Basic' || card.sub === 'Baby')) || (card.st === 'Trainer' && /as if it were a Basic/i.test(card.txt || ''));
}

export function deckCount(cards) { return Object.values(cards || {}).reduce((a, b) => a + b, 0); }

/** Returns [{bad, good, m}] like the page shows. db: id -> card */
export function validateDeck(deck, rules, db) {
  rules = R(rules); const out = []; const n = deckCount(deck.cards);
  if (n !== rules.deckSize) out.push({ bad: true, m: `${n} of ${rules.deckSize} cards` }); else out.push({ good: true, m: `${n} cards` });
  const byName = {}; let basics = 0; const banned = rules.banned || []; const limits = rules.limits || {};
  for (const [cid, k] of Object.entries(deck.cards || {})) {
    const c = db[cid]; if (!c) { out.push({ bad: true, m: `Unknown card ${cid}` }); continue; }
    if ((rules.bannedIds || []).includes(cid) && !banned.includes(c.name)) { out.push({ bad: true, m: `${c.name} (this printing) is banned` }); continue; }
    if (isBasicLike(c)) basics += k;
    if (c.st === 'Energy' && c.sub === 'Basic') continue;
    byName[c.name] = (byName[c.name] || 0) + k;
  }
  for (const [nm, k] of Object.entries(byName)) {
    if (banned.includes(nm)) { out.push({ bad: true, m: `${nm} is banned` }); continue; }
    const max = limits[nm] != null ? Math.min(limits[nm], rules.maxCopies) : rules.maxCopies;
    if (k > max) out.push({ bad: true, m: `${k}× ${nm} (max ${max})` });
  }
  if (!basics) out.push({ bad: true, m: 'No Basic Pokémon' });
  return out;
}
