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
  conditionsPersist: true,     // special conditions stay when a Pokémon is benched
  deckOutDamage: true,         // empty deck: 10 damage to your Active each turn instead of losing
  multiEvolve: true,           // a Pokémon may evolve more than once per turn
  confusedRetreatFlip: true,   // confused Pokémon flip to retreat (tails: self damage)
  confusionSelfDamage: 20,     // damage a Confused Pokémon does to itself on a failed flip
  conditionsStack: true,       // Asleep, Confused and Paralyzed can all be on one Pokémon at once
  evolveSameTurn: true,        // a Pokémon may evolve on the turn it was played (and on turn 1)
  benchRescue: true,           // no Pokémon left: draw until a Basic (max 7) and play it; the opponent draws as many; 7 misses loses
  anyVersionEvolves: true,     // an Evolution card may go on any version of its species (Blaine's Charmeleon on a plain Charmander)
  energyPickup: true,          // instead of attaching an Energy this turn, you may take a basic Energy off one of your Pokémon back to hand
  dceNoReturn: true,           // an attached Double Colorless never returns to hand: effects that would return it discard it instead
  charizardDoubleDiscard: true, // Base Set Charizard's Fire Spin may discard energy worth 2 (one Double Colorless) instead of 2 cards
  weaknessBonus: 10,           // Weakness adds this much damage (0 = official doubling)
  resistanceAmount: 20,        // Resistance takes this much off (official: 30)
  banned: ["Imposter Oak's Revenge", 'Impostor Professor Oak', 'Lass', 'Scoop Up', 'Gust of Wind'],
  limits: { 'Energy Removal': 2, 'Super Energy Removal': 2, 'Pokémon Center': 2 },
  notes: '',
};
export const R = (r) => Object.assign({}, DEFAULT_RULES, r || {});

export function isBasicLike(card) {
  return (card.st === 'Pokémon' && card.sub === 'Basic') || (card.st === 'Trainer' && /as if it were a Basic/i.test(card.txt || ''));
}

export function deckCount(cards) { return Object.values(cards || {}).reduce((a, b) => a + b, 0); }

/** Returns [{bad, good, m}] like the page shows. db: id -> card */
export function validateDeck(deck, rules, db) {
  rules = R(rules); const out = []; const n = deckCount(deck.cards);
  if (n !== rules.deckSize) out.push({ bad: true, m: `${n} of ${rules.deckSize} cards` }); else out.push({ good: true, m: `${n} cards` });
  const byName = {}; let basics = 0; const banned = rules.banned || []; const limits = rules.limits || {};
  for (const [cid, k] of Object.entries(deck.cards || {})) {
    const c = db[cid]; if (!c) { out.push({ bad: true, m: `Unknown card ${cid}` }); continue; }
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
