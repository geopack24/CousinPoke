// Registry of card scripts. Sets are added here as they get automated.
import { base1 } from './base1.js';

export const CARD_SCRIPTS = Object.assign({}, base1);

/** Which cards of a set are fully automated: those with no text, or with a script. */
export function automationReport(db) {
  const out = {};
  for (const c of Object.values(db)) {
    const s = CARD_SCRIPTS[c.id];
    let needs = false, has = true;
    if (c.st === 'Pokémon') {
      for (const a of c.atk || []) { if (a.t || !/^\d+$/.test(a.d || '')) { needs = true; if (!(s && s.attacks && s.attacks[a.n])) has = false; } }
      for (const p of c.pw || []) { needs = true; if (!(s && ((s.powers && s.powers[p.n]) || s.passive))) has = false; }
    } else if (c.st === 'Trainer') { needs = true; if (!(s && (s.trainer || s.asPokemon))) has = false; }
    else if (c.st === 'Energy' && c.sub !== 'Basic') { needs = true; if (!(s && s.energy)) has = false; }
    out[c.id] = needs ? (has ? 'scripted' : 'missing') : 'plain';
  }
  return out;
}
