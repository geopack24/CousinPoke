// The Token Shop: play mats, card sleeves and coins bought with the Cousin Tokens that Arena runs pay out.
// What a player owns and has equipped lives in their Arena document (owned: [ids], equip: { mat, sleeve, coin }), which
// every player's page already receives, so both players at a table see each other's look. Everything is drawn in CSS
// (shop.css): no pictures of characters, nothing to download.
export const PRICE = 1250; // five perfect Arena runs (a 7-win run pays 250)

export const KINDS = {
  mat: { label: 'Play mats', one: 'Play mat', what: 'Your side of the table. Your opponent sees it too.' },
  sleeve: { label: 'Card sleeves', one: 'Card sleeves', what: 'The backs of your cards: your deck, your prizes, and your hand as your opponent sees it.' },
  coin: { label: 'Coins', one: 'Coin', what: 'The coin on screen whenever you flip.' },
};
export const SHOP = [
  { id: 'mat-inferno', kind: 'mat', name: 'Inferno', blurb: 'A field of living lava. The embers never stop rising.' },
  { id: 'mat-abyss', kind: 'mat', name: 'The Abyss', blurb: 'Sunlight ripples down from the surface, far overhead.' },
  { id: 'mat-storm', kind: 'mat', name: 'Thunderhead', blurb: 'Rain on the wind, and lightning when you least expect it.' },
  { id: 'mat-galaxy', kind: 'mat', name: 'Deep Space', blurb: 'Stars drift past a slow-turning nebula.' },
  { id: 'mat-prism', kind: 'mat', name: 'Prism', blurb: 'Holographic foil, the whole table wide.' },
  { id: 'sleeve-gold', kind: 'sleeve', name: 'Solid Gold', blurb: 'Brushed gold with a shine that never sits still.' },
  { id: 'sleeve-neon', kind: 'sleeve', name: 'Neon Grid', blurb: 'An arcade at midnight on the back of every card.' },
  { id: 'sleeve-scale', kind: 'sleeve', name: 'Dragonscale', blurb: 'Emerald scales that catch the light as they move.' },
  { id: 'sleeve-nova', kind: 'sleeve', name: 'Supernova', blurb: 'A star going off, over and over.' },
  { id: 'sleeve-ember', kind: 'sleeve', name: 'Wildfire', blurb: 'Flames lick up the card from the bottom edge.' },
  { id: 'coin-crown', kind: 'coin', name: 'Crown Jewel', blurb: 'Royal gold, with a crown for heads.' },
  { id: 'coin-bolt', kind: 'coin', name: 'Thunder Coin', blurb: 'Crackles blue every time it leaves your thumb.' },
  { id: 'coin-ember', kind: 'coin', name: 'Molten Coin', blurb: 'Still glowing from the forge.' },
  { id: 'coin-moon', kind: 'coin', name: 'Moonstone', blurb: 'Cool silver light and a crescent moon.' },
  { id: 'coin-prism', kind: 'coin', name: 'Prism Coin', blurb: 'Every colour at once, and then all the others.' },
].map((x) => ({ price: PRICE, ...x }));
const BY_ID = new Map(SHOP.map((x) => [x.id, x]));
export const item = (id) => BY_ID.get(id) || null;
export const ownedSet = (doc) => new Set(((doc && doc.owned) || []).filter((id) => BY_ID.has(id)));
/** What a player shows at the table: only things that exist and that they own. */
export function lookOf(doc) {
  const o = ownedSet(doc); const e = (doc && doc.equip) || {}; const out = {};
  for (const k of Object.keys(KINDS)) { const it = item(e[k]); if (it && it.kind === k && o.has(it.id)) out[k] = it.id; }
  return out;
}
/** CSS classes for a player's side of the table (mat and sleeves). */
export const sideClasses = (doc) => { const l = lookOf(doc); return [l.mat, l.sleeve].filter(Boolean).join(' '); };
export const coinClass = (doc) => lookOf(doc).coin || '';

/* ---------- changes to an Arena document (called inside the Arena's own save) ---------- */
export function buy(doc, id) {
  const it = item(id); if (!it) throw new Error('That is not in the shop');
  doc.owned = doc.owned || [];
  if (doc.owned.includes(id)) throw new Error('You already own that');
  if ((doc.tokens || 0) < it.price) throw new Error(`You need ${it.price - (doc.tokens || 0)} more Cousin Tokens`);
  doc.tokens -= it.price; doc.spent = (doc.spent || 0) + it.price; doc.owned.push(id);
  doc.equip = { ...(doc.equip || {}), [it.kind]: id }; // new things go straight on
  doc.bought = [...(doc.bought || []), { id, at: Date.now(), price: it.price }];
}
export function equip(doc, kind, id) {
  if (!KINDS[kind]) throw new Error('Unknown kind');
  doc.equip = { ...(doc.equip || {}) };
  if (!id) { delete doc.equip[kind]; return; }
  const it = item(id); if (!it || it.kind !== kind) throw new Error('That is not in the shop');
  if (!(doc.owned || []).includes(id)) throw new Error("You don't own that yet");
  doc.equip[kind] = id;
}

/* ---------- drawing ---------- */
const backs = (n, s) => Array.from({ length: n }, (_, i) => `<i class="cd back" style="--s:${s};--i:${i}"></i>`).join('');
/** A live preview of an item: the real thing, small. */
export function previewHTML(it, big) {
  if (it.kind === 'mat') return `<div class="shop-prev shop-mat"><div class="side ${it.id}"><span class="shop-matrow">${backs(1, big ? 0.3 : 0.2)}<i class="shop-slot"></i><i class="shop-slot"></i><i class="shop-slot"></i></span></div></div>`;
  if (it.kind === 'sleeve') return `<div class="shop-prev shop-sleeve ${it.id}"><span class="shop-fan">${backs(3, big ? 0.5 : 0.34)}</span></div>`;
  return `<div class="shop-prev shop-coin"><span class="cf-coin ${it.id} demo" aria-hidden="true"><span class="cf-face"></span></span></div>`;
}
/** The shop page. doc: the player's Arena document (or null). */
export function shopHTML(doc, esc) {
  const own = ownedSet(doc); const look = lookOf(doc); const tokens = (doc && doc.tokens) || 0;
  const tile = (it) => {
    const has = own.has(it.id), on = look[it.kind] === it.id, can = tokens >= it.price;
    const btn = on ? `<button type="button" class="sm" data-shop-off="${it.kind}">Take off</button>`
      : has ? `<button type="button" class="pri sm" data-shop-on="${it.id}">Use this</button>`
        : `<button type="button" class="pri sm shop-buy" data-shop-buy="${it.id}"${can ? '' : ' disabled'}><span aria-hidden="true">🪙</span> ${it.price.toLocaleString()}</button>`;
    return `<article class="shop-item ${it.kind}${has ? ' owned' : ''}${on ? ' on' : ''}${!has && can ? ' can' : ''}">
      <button type="button" class="shop-look" data-shop-look="${it.id}" aria-label="Look at ${esc(it.name)}">${previewHTML(it)}</button>
      ${on ? '<span class="shop-tag on">Equipped</span>' : has ? '<span class="shop-tag">Owned</span>' : ''}
      <h3>${esc(it.name)}</h3><p class="small">${esc(it.blurb)}</p>
      ${btn}${!has && !can ? `<span class="shop-need small">${(it.price - tokens).toLocaleString()} more to go</span>` : ''}</article>`;
  };
  const rows = Object.entries(KINDS).map(([k, K]) => `<section class="shop-row"><div class="shop-rowhead"><h2>${K.label}</h2><p class="small muted">${K.what}</p></div><div class="shop-grid">${SHOP.filter((x) => x.kind === k).map(tile).join('')}</div></section>`).join('');
  return `<div class="shop"><div class="shop-hero"><div class="shop-rays" aria-hidden="true"></div>
      <div><span class="kicker">Spend your winnings</span><h1>The Token Shop</h1>
      <p>Play mats, card sleeves and coins. Each one costs <b>${PRICE.toLocaleString()}</b> Cousin Tokens, about five perfect Arena runs, and everyone you play sees it.</p></div>
      <div class="shop-purse"><span aria-hidden="true">🪙</span><b>${tokens.toLocaleString()}</b><em>Cousin Tokens</em><small>${own.size} of ${SHOP.length} collected</small></div></div>
    ${rows}</div>`;
}
