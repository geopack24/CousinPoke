// House rules and deck validation.
export const DEFAULT_RULES = {
  deckSize: 60, prizes: 6, handSize: 7, benchSize: 5, maxCopies: 4,
  firstTurnAttack: false,      // the player who goes first may attack on turn 1
  autoDraw: true,              // draw at the start of each turn
  mulliganDraw: 1,             // extra cards the opponent may draw per mulligan
  colorlessCosts: true,        // any energy pays any attack cost
  noAttackAfterRetreat: true,  // retreating ends your chance to attack this turn
  unlimitedTrainers: true,     // informational
  conditionsPersist: true,     // special conditions stay when a Pokémon is benched
  deckOutDamage: true,         // empty deck: 10 damage to your Active each turn instead of losing
  multiEvolve: true,           // a Pokémon may evolve more than once per turn
  confusedRetreatFlip: true,   // confused Pokémon flip to retreat (tails: self damage)
  confusionSelfDamage: 20,     // damage a Confused Pokémon does to itself on a failed flip
  banned: ["Imposter Oak's Revenge", 'Lass', 'Scoop Up', 'Gust of Wind'],
  limits: { 'Energy Removal': 2, 'Super Energy Removal': 2 },
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
