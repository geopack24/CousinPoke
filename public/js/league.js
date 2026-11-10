// Ranked league: a yearly draft (snake order, one keeper per player, stop when everyone agrees),
// rosters, trades the commissioner approves, free-agent claims, and standings from ranked tables.
//
// Everything lives in one document, leagues/main:
//   { name, commish, members:[uid], current:'2026', seasons:{ '2026': Season }, trades:[Trade], results:{ key: Result }, log:[{at,s,t}] }
//   Season: { year, status:'setup'|'drafting'|'done', order:[uid], snake, keepersOn, keepers:{uid:name},
//             picks:[{i,uid,name,at,keeper?,by?}], own:{name:uid}, how:{name:'R3'|'K'|'trade'|'FA'|'comm'}, stopVotes:[uid] }
//   Trade: { id, s, from, to, give:[name], get:[name], note, status:'proposed'|'approval'|'done'|'declined'|'cancelled'|'vetoed', at, doneAt }
//   Result: { s, at, w, l, wd, ld, turns, name }
//
// Draft rule: you draft Pokémon by exact card name (Charizard, Dark Charizard and Blaine's Charizard are three picks).
// Pre-evolutions are free: owning a Pokémon lets you play everything it evolves from. Trainers and Energy are free for everyone.
import { playTurnChime } from './fx.js';
import * as sfx from './sfx.js';

// ?league=test (any short lowercase name) opens a separate practice league; the real one is 'main'.
const LID = (() => { try { const v = new URLSearchParams(location.search).get('league'); return v && /^[a-z0-9-]{1,24}$/.test(v) ? v : 'main'; } catch (e) { return 'main'; } })();
const testBanner = () => (LID === 'main' ? '' : `<div class="notice testlg"><b>Practice league "${LID}"</b>: separate from the real league. Picks, trades and results here don't count. <a href="${location.pathname}">Back to the real league</a></div>`);
const SETS_OK = new Set(['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2']); // no promos
const RAR = { 'Rare Holo': 0, Rare: 1, Uncommon: 2, Common: 3 };
const STAGES = ['Basic', 'Stage 1', 'Stage 2'];

let PT = null;
const V = { tab: 'overview', q: '', type: '', stage: '', avail: 'open', sort: 'name', season: null, tradeWith: '', give: new Set(), get: new Set(), note: '', busy: false, moveName: '' };
let POOL = null, BYNAME = null, PRE = null, FREE = null, BASE = null;
// FREE: Colorless Pokémon, usable by everyone and never drafted.
// BASE: Basic Pokémon that evolve into something; never drafted, playable through whatever they evolve into.
let clockKey = null;
let pickSeen = null; // 'season:count' of picks already shown, so only new picks get the reveal
const recording = new Set();

export function installLeague(pt) {
  PT = pt;
  return { render, lobbyPanel, lobbyFeature, onLeague, noteGames, legality, legalNames, keyOf, isMember, season, rankedOk, liveDraft, gameChip, tickerHTML };
}

/* ---------- helpers ---------- */
const L = () => PT.S.league || null;
const me = () => PT.uid();
const esc = (s) => PT.esc(s);
const nm = (uid) => (uid ? PT.nameOf(uid) : 'Free agent');
const clone = (o) => JSON.parse(JSON.stringify(o));
const thisYear = () => String(new Date().getFullYear());
export function season(l = L(), key) { return l && l.seasons ? l.seasons[key || l.current] || null : null; }
function isMember(uid = me(), l = L()) { return !!(l && (l.members || []).includes(uid)); }
const isCommish = (l = L()) => !!(l && l.commish === me());
const seasonKeys = (l = L()) => Object.keys((l && l.seasons) || {}).sort((a, b) => +a - +b);
function prevSeason(l, key) { const ks = seasonKeys(l).filter((k) => +k < +key); return ks.length ? l.seasons[ks[ks.length - 1]] : null; }

const SET_NAMES = { base1: 'Base Set', base2: 'Jungle', base3: 'Fossil', base5: 'Team Rocket', gym1: 'Gym Heroes', gym2: 'Gym Challenge' };
const SET_ORDER = Object.keys(SET_NAMES);
/** Same card = same HP, stage, type, evolution, attacks (name, cost, damage) and Pokémon Power names. Holo/non-holo prints match; Base Set and Fossil Zapdos don't. */
const cardSig = (c) => JSON.stringify([+c.hp || 0, c.sub || '', c.types || [], c.ev || '', (c.atk || []).map((a) => [a.n, a.c, a.d]), (c.pw || []).map((x) => x.n)]);
let KEYOF = null; // card id -> pick key

/** The draft pool. A pick is one distinct card: its key is the card name, plus the set (and number, if needed) when one name covers different cards. */
function pool() {
  if (POOL) return POOL;
  // name-level facts: evolution links, Colorless, Basics that evolve
  const names = new Map();
  for (const id of Object.keys(PT.CARDS)) {
    const c = PT.CARDS[id];
    if (c.st !== 'Pokémon' || !SET_NAMES[c.set]) continue;
    let e = names.get(c.name);
    if (!e) names.set(c.name, (e = { name: c.name, cards: [], types: new Set(), stages: new Set(), ev: new Set() }));
    e.cards.push(c); (c.types || []).forEach((t) => e.types.add(t)); e.stages.add(c.sub || 'Basic'); if (c.ev) e.ev.add(c.ev);
  }
  const into = new Map();
  for (const e of names.values()) for (const f of e.ev) { if (!into.has(f)) into.set(f, new Set()); into.get(f).add(e.name); }
  PRE = new Map();
  const walk = (n, seen) => { const e = names.get(n); if (e) for (const f of e.ev) if (!seen.has(f) && names.has(f)) { seen.add(f); walk(f, seen); } return seen; };
  for (const n of names.keys()) PRE.set(n, walk(n, new Set()));
  FREE = new Set([...names.values()].filter((e) => e.types.size > 0 && [...e.types].every((t) => t === 'Colorless')).map((e) => e.name));
  BASE = new Set([...names.values()].filter((e) => !FREE.has(e.name) && !e.stages.has('Stage 1') && !e.stages.has('Stage 2') && into.has(e.name)).map((e) => e.name));
  // card-level entries
  BYNAME = new Map(); KEYOF = new Map();
  const ord = (c) => SET_ORDER.indexOf(c.set) * 1000 + (parseInt(c.n, 10) || 0);
  for (const ne of names.values()) {
    const groups = new Map();
    for (const c of ne.cards.slice().sort((x, y) => ord(x) - ord(y))) { const k = cardSig(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const gs = [...groups.values()];
    const firstSets = gs.map((g) => g[0].set);
    for (const g of gs) {
      const f = g[0];
      const key = gs.length === 1 ? ne.name : firstSets.filter((x) => x === f.set).length > 1 ? `${ne.name} (${SET_NAMES[f.set]} ${f.n})` : `${ne.name} (${SET_NAMES[f.set]})`;
      const ids = g.map((c) => c.id).sort((x, y) => (RAR[PT.CARDS[x].rar] ?? 4) - (RAR[PT.CARDS[y].rar] ?? 4));
      const types = new Set(f.types || []);
      const e = { name: key, base: ne.name, ids, rep: ids[0], types, type: [...types][0] || 'Colorless', stage: f.sub || 'Basic', hp: +f.hp || 0, next: [...(into.get(ne.name) || [])].sort() };
      BYNAME.set(key, e);
      for (const id of ids) KEYOF.set(id, key);
    }
  }
  POOL = [...BYNAME.values()].filter((e) => !FREE.has(e.base) && !BASE.has(e.base)).sort((x, y) => x.name.localeCompare(y.name));
  return POOL;
}
const baseOf = (key) => (BYNAME && BYNAME.get(key) ? BYNAME.get(key).base : key);
const keyOf = (cid) => { pool(); return KEYOF.get(cid) || (PT.CARDS[cid] || {}).name; };
/** Why a pick key can't be drafted, or null if it can. */
function notDraftable(key) {
  pool();
  const e = BYNAME.get(key);
  if (!e) return 'Unknown Pokémon';
  if (FREE.has(e.base)) return `${e.base} is Colorless, so it's free for everyone and can't be drafted`;
  if (BASE.has(e.base)) return `${e.base} evolves, so it isn't drafted. Own one of its evolutions to play it`;
  return null;
}

/** Names a player may put in a ranked deck: their roster plus everything those Pokémon evolve from, plus every Colorless Pokémon. */
function legalNames(uid, l = L()) {
  pool();
  const s = season(l), out = new Set();
  for (const n of FREE) { out.add(n); for (const p of PRE.get(n) || []) out.add(p); }
  if (!s) return out;
  for (const [n, o] of Object.entries(s.own || {})) if (o === uid) { out.add(n); for (const p of PRE.get(baseOf(n)) || []) out.add(p); }
  return out;
}
/** Which Pokémon in a deck the player can't use in ranked play. */
function legality(cards, uid, l = L()) {
  const ok = legalNames(uid, l), bad = new Set();
  for (const cid of Object.keys(cards || {})) {
    const c = PT.CARDS[cid];
    if (!c || c.st !== 'Pokémon') continue;
    if (!SETS_OK.has(c.set)) bad.add(c.name + ' (promo)');
    else if (!ok.has(keyOf(cid)) && !ok.has(c.name)) bad.add(keyOf(cid));
  }
  return { ok: !bad.size, bad: [...bad] };
}

const order = (s) => s.order || [];
function pickerAt(s, i) { const o = order(s), n = o.length; if (!n) return null; const r = Math.floor(i / n), p = i % n; return s.snake !== false && r % 2 ? o[n - 1 - p] : o[p]; }
function indexFor(s, round, col) { const n = order(s).length; return round * n + (s.snake !== false && round % 2 ? n - 1 - col : col); }
function nextIndex(s) { const used = new Set((s.picks || []).map((p) => p.i)); let i = 0; while (used.has(i)) i++; return i; }
function onClock(s) { return s && s.status === 'drafting' ? pickerAt(s, nextIndex(s)) : null; }
function liveDraft() { const s = season(); return !!(s && s.status === 'drafting'); }
function rankedOk() { const l = L(), s = season(l); if (!l || !s) return 'No league yet'; if (!isMember()) return 'You are not in the league'; if (s.status !== 'done') return 'Ranked games start after the draft'; return true; }
function logTx(doc, t) { doc.log = doc.log || []; doc.log.push({ at: Date.now(), s: doc.current, t }); if (doc.log.length > 400) doc.log = doc.log.slice(-400); }
function newSeason(year, members, keepersOn) { return { year, status: 'setup', order: members.slice(), snake: true, keepersOn: !!keepersOn, keepers: {}, picks: [], own: {}, how: {}, stopVotes: [], createdAt: Date.now() }; }
function fail(m) { throw new Error(m); }

/* ---------- saving: every change re-reads the latest league and retries on a conflict ---------- */
async function mutate(fn, okMsg, quiet) {
  if (V.busy && !quiet) return false;
  if (!quiet) V.busy = true;
  try {
    let cur = L();
    for (let tries = 0; tries < 5; tries++) {
      const doc = cur ? clone(cur) : {};
      const ver = cur ? cur.version : 0;
      delete doc.id; delete doc.version;
      let res;
      try { res = fn(doc); } catch (e) { if (!quiet) PT.toast(e.message || 'That did not work'); return false; }
      if (res === false) return false;
      doc.updatedAt = Date.now();
      const r = await PT.api('PUT', 'leagues/' + LID, { data: doc, ifVersion: ver });
      if (r && r.conflict) { cur = r.doc; PT.S.league = r.doc; continue; }
      PT.S.league = { id: LID, version: r.version, ...doc };
      try { onLeague(); } catch (e) { /* cosmetic */ }
      if (okMsg) PT.toast(okMsg);
      return true;
    }
    if (!quiet) PT.toast('The league changed a few times at once. Try again.');
    return false;
  } catch (e) {
    if (!quiet) PT.toast('Could not save (' + (e.code || 'error') + ')');
    return false;
  } finally {
    if (!quiet) V.busy = false;
    if (PT.S.screen === 'league' || PT.S.screen === 'lobby') PT.render();
  }
}

/* ---------- sync hooks ---------- */
/** Called by the page whenever a new copy of the league arrives: announce when the draft comes to you. */
function onLeague() {
  const s = season();
  const nav = document.querySelector('#nav-league');
  if (nav) nav.classList.toggle('drafting', !!(s && s.status === 'drafting'));
  if (s) {
    const real = (s.picks || []).filter((p) => !p.keeper);
    const sig = L().current + ':' + real.length;
    if (pickSeen && pickSeen !== sig && pickSeen.split(':')[0] === L().current && real.length > +pickSeen.split(':')[1]) {
      const last = real.reduce((a, b) => (b.at > a.at ? b : a));
      if (PT.S.screen !== 'game') revealPick(s, last);
    }
    pickSeen = sig;
  }
  const key = s && s.status === 'drafting' && onClock(s) === me() ? L().current + ':' + nextIndex(s) : null;
  if (key && key !== clockKey) {
    try { playTurnChime(); } catch (e) { /* audio locked */ }
    PT.toast("You're on the clock! Make your draft pick.");
    if (document.hidden) {
      const t0 = document.title.replace(/^🔔 [^·]+· /, '');
      document.title = '🔔 Your pick! · ' + t0;
      const back = () => { if (!document.hidden) { document.title = t0; document.removeEventListener('visibilitychange', back); } };
      document.addEventListener('visibilitychange', back);
    }
  }
  clockKey = key;
}
/** Finished ranked tables I played at get their result written to the league (once per game). */
function noteGames(games) {
  const l = L();
  if (!l) return;
  for (const g of games || []) {
    if (!g || !g.ranked || g.status !== 'done' || !g.winner || !g.seats) continue;
    const a = g.seats.a || {}, b = g.seats.b || {};
    if (a.uid !== me() && b.uid !== me()) continue;
    const key = g.id + '_' + (g.startedAt || 0);
    if ((l.results || {})[key] || recording.has(key)) continue;
    recording.add(key);
    const w = g.seats[g.winner], lo = g.seats[g.winner === 'a' ? 'b' : 'a'];
    mutate((doc) => {
      doc.results = doc.results || {};
      if (doc.results[key]) return false;
      if (!(doc.members || []).includes(w.uid) || !(doc.members || []).includes(lo.uid)) return false;
      doc.results[key] = { s: (g.ranked && g.ranked.season) || doc.current, at: Date.now(), w: w.uid, l: lo.uid, wd: w.deckName || '', ld: lo.deckName || '', turns: (g.state && g.state.turnNo) || null, name: g.name || '' };
      logTx(doc, `${nm(w.uid)} beat ${nm(lo.uid)} in a ranked game`);
    }, null, true).finally(() => recording.delete(key));
  }
}

/* ---------- actions ---------- */
const A = {
  create: () => mutate((doc) => {
    if (doc.commish) fail('There is already a league');
    const y = thisYear();
    Object.assign(doc, { name: 'Cousin Pokémon League', commish: me(), members: [me()], current: y, seasons: { [y]: newSeason(y, [me()], false) }, trades: [], results: {}, log: [] });
    logTx(doc, `${nm(me())} started the league and is the commissioner`);
  }, 'League created. You are the commissioner.'),

  addMember: (uid) => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can add players');
    if (doc.members.includes(uid)) return false;
    const s = season(doc);
    if (s && s.status === 'drafting') fail('Add players before the draft starts or after it ends');
    doc.members.push(uid);
    if (s && s.status === 'setup') s.order.push(uid);
    logTx(doc, `${nm(uid)} joined the league`);
  }, 'Player added'),

  removeMember: (uid) => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can remove players');
    if (uid === doc.commish) fail("The commissioner can't be removed");
    const s = season(doc);
    if (s && s.status === 'drafting') fail("Players can't leave during the draft");
    doc.members = doc.members.filter((x) => x !== uid);
    if (s) { s.order = s.order.filter((x) => x !== uid); delete s.keepers[uid]; for (const [n, o] of Object.entries(s.own)) if (o === uid) { delete s.own[n]; delete s.how[n]; } s.stopVotes = (s.stopVotes || []).filter((x) => x !== uid); }
    logTx(doc, `${nm(uid)} left the league; their Pokémon became free agents`);
  }, 'Player removed'),

  shuffleOrder: () => mutate((doc) => {
    const s = season(doc);
    if (s.status !== 'setup') fail('The order is locked once the draft starts');
    for (let i = s.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.order[i], s.order[j]] = [s.order[j], s.order[i]]; }
    logTx(doc, `Draft order randomized: ${s.order.map(nm).join(', ')}`);
  }),

  moveOrder: (uid, d) => mutate((doc) => {
    const s = season(doc);
    if (s.status !== 'setup') fail('The order is locked once the draft starts');
    const i = s.order.indexOf(uid), j = i + d;
    if (i < 0 || j < 0 || j >= s.order.length) return false;
    [s.order[i], s.order[j]] = [s.order[j], s.order[i]];
  }),

  setSnake: (on) => mutate((doc) => { const s = season(doc); if (s.status !== 'setup') fail('Locked once the draft starts'); s.snake = !!on; }),
  setKeepersOn: (on) => mutate((doc) => {
    const s = season(doc);
    if (s.status !== 'setup') fail('Locked once the draft starts');
    s.keepersOn = !!on; if (!on) s.keepers = {};
    logTx(doc, on ? 'Keepers are on this season' : 'Keeper reset: no keepers this season');
  }),

  setKeeper: (uid, name) => mutate((doc) => {
    const s = season(doc);
    if (s.status !== 'setup') fail('Keepers are locked once the draft starts');
    if (uid !== me() && doc.commish !== me()) fail('You can only pick your own keeper');
    if (!name) { delete s.keepers[uid]; return; }
    const prev = prevSeason(doc, doc.current);
    if (!prev || (prev.own || {})[name] !== uid) fail(`${name} wasn't on that roster last season`);
    s.keepers[uid] = name;
  }, name ? 'Keeper saved' : 'Keeper cleared'),

  startDraft: () => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can start the draft');
    const s = season(doc);
    if (s.status !== 'setup') fail('The draft already started');
    if (s.order.length < 2) fail('Add at least two players first');
    s.status = 'drafting'; s.startedAt = Date.now(); s.picks = []; s.own = {}; s.how = {}; s.stopVotes = [];
    if (s.keepersOn) for (const uid of s.order) {
      const k = s.keepers[uid];
      if (!k) continue;
      const i = indexFor(s, 0, s.order.indexOf(uid));
      s.picks.push({ i, uid, name: k, at: Date.now(), keeper: true }); s.own[k] = uid; s.how[k] = 'K';
    }
    logTx(doc, `The ${doc.current} draft started. Order: ${s.order.map(nm).join(', ')}${s.picks.length ? `. Keepers: ${s.picks.map((p) => `${nm(p.uid)} kept ${p.name}`).join(', ')}` : ''}`);
  }, 'The draft is on!'),

  pick: (name) => mutate((doc) => {
    pool();
    const s = season(doc);
    if (s.status !== 'drafting') fail('The draft is not running');
    { const why = notDraftable(name); if (why) fail(why); }
    if (s.own[name]) fail(`${name} is already taken`);
    const i = nextIndex(s), who = pickerAt(s, i);
    if (who !== me() && doc.commish !== me()) fail(`It's ${nm(who)}'s pick`);
    s.picks.push({ i, uid: who, name, at: Date.now(), ...(who !== me() ? { by: me() } : {}) });
    s.own[name] = who; s.how[name] = 'R' + (Math.floor(i / s.order.length) + 1);
    logTx(doc, `Round ${Math.floor(i / s.order.length) + 1}: ${nm(who)} drafted ${name}${who !== me() ? ` (picked by ${nm(me())})` : ''}`);
  }),

  undoPick: () => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can undo picks');
    const s = season(doc);
    const real = (s.picks || []).filter((p) => !p.keeper);
    if (!real.length) fail('No picks to undo');
    const last = real.reduce((a, b) => (b.at > a.at ? b : a));
    s.picks = s.picks.filter((p) => p !== last);
    if (s.own[last.name] === last.uid) { delete s.own[last.name]; delete s.how[last.name]; }
    if (s.status === 'done') { s.status = 'drafting'; s.stopVotes = []; }
    logTx(doc, `Commissioner undid ${nm(last.uid)}'s pick of ${last.name}`);
  }, 'Pick undone'),

  voteStop: () => mutate((doc) => {
    const s = season(doc);
    if (s.status !== 'drafting') fail('The draft is not running');
    if (!doc.members.includes(me())) fail('Only league players vote');
    const v = new Set(s.stopVotes || []);
    if (v.has(me())) v.delete(me()); else v.add(me());
    s.stopVotes = [...v];
    if (s.order.every((u) => v.has(u))) {
      s.status = 'done'; s.endedAt = Date.now();
      logTx(doc, `Everyone agreed to stop. The ${doc.current} draft is over after ${s.picks.length} picks; everything left is a free agent`);
    }
  }),

  endDraft: () => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can end the draft');
    const s = season(doc);
    if (s.status !== 'drafting') return false;
    s.status = 'done'; s.endedAt = Date.now();
    logTx(doc, `Commissioner ended the ${doc.current} draft after ${s.picks.length} picks`);
  }, 'Draft ended'),

  reopenDraft: () => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can reopen the draft');
    const s = season(doc);
    if (s.status !== 'done') return false;
    s.status = 'drafting'; s.stopVotes = [];
    logTx(doc, 'Commissioner reopened the draft');
  }, 'Draft reopened'),

  claim: (name) => mutate((doc) => {
    pool();
    const s = season(doc);
    if (s.status !== 'done') fail('Free agents open up after the draft');
    if (!doc.members.includes(me())) fail('Only league players can claim');
    { const why = notDraftable(name); if (why) fail(why); }
    if (s.own[name]) fail(`${nm(s.own[name])} already has ${name}`);
    s.own[name] = me(); s.how[name] = 'FA';
    logTx(doc, `${nm(me())} claimed ${name} from free agents`);
  }, `${name} is yours`),

  release: (name) => mutate((doc) => {
    const s = season(doc);
    if (s.status === 'drafting') fail("You can't release Pokémon during the draft");
    if (s.own[name] !== me()) fail(`${name} isn't yours`);
    delete s.own[name]; delete s.how[name];
    logTx(doc, `${nm(me())} released ${name} to free agents`);
  }, `${name} released`),

  move: (name, to) => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can move Pokémon');
    pool();
    { const why = notDraftable(name); if (why) fail(why); }
    const s = season(doc), from = s.own[name] || null;
    if (from === (to || null)) return false;
    if (to) { s.own[name] = to; s.how[name] = 'comm'; } else { delete s.own[name]; delete s.how[name]; }
    logTx(doc, `Commissioner moved ${name}: ${nm(from)} → ${nm(to)}`);
  }, 'Moved'),

  nextSeason: () => mutate((doc) => {
    if (doc.commish !== me()) fail('Only the commissioner can start a new season');
    const s = season(doc);
    if (s.status !== 'done') fail('Finish this season\'s draft first');
    const y = String(Math.max(+doc.current + 1, +thisYear()));
    if (doc.seasons[y]) fail(`The ${y} season already exists`);
    doc.seasons[y] = newSeason(y, doc.members, true);
    doc.seasons[y].order = s.order.filter((u) => doc.members.includes(u)).concat(doc.members.filter((u) => !s.order.includes(u)));
    doc.current = y;
    logTx(doc, `The ${y} season is set up. Keepers are on: everyone may keep one Pokémon from last season`);
  }, 'New season ready'),

  propose: (to, give, get, note) => mutate((doc) => {
    const s = season(doc);
    if (s.status === 'setup') fail('Trades open once the draft starts');
    if (!doc.members.includes(me()) || !doc.members.includes(to) || to === me()) fail('Pick another league player');
    if (!give.length && !get.length) fail('Choose at least one Pokémon');
    for (const n of give) if (s.own[n] !== me()) fail(`${n} isn't yours`);
    for (const n of get) if (s.own[n] !== to) fail(`${nm(to)} doesn't have ${n}`);
    doc.trades = doc.trades || [];
    doc.trades.push({ id: 't' + Date.now().toString(36), s: doc.current, from: me(), to, give, get, note: note || '', status: 'proposed', at: Date.now() });
    logTx(doc, `${nm(me())} offered ${nm(to)} a trade`);
  }, 'Trade offer sent'),

  answerTrade: (id, how) => mutate((doc) => {
    const t = (doc.trades || []).find((x) => x.id === id);
    if (!t) fail('That trade is gone');
    const s = doc.seasons[t.s];
    const open = t.status === 'proposed' || t.status === 'approval';
    if (!open) fail('That trade is already settled');
    const exec = () => {
      for (const n of t.give) if (s.own[n] !== t.from) fail(`${nm(t.from)} no longer has ${n}`);
      for (const n of t.get) if (s.own[n] !== t.to) fail(`${nm(t.to)} no longer has ${n}`);
      for (const n of t.give) { s.own[n] = t.to; s.how[n] = 'trade'; }
      for (const n of t.get) { s.own[n] = t.from; s.how[n] = 'trade'; }
      t.status = 'done'; t.doneAt = Date.now();
      logTx(doc, `Trade: ${nm(t.from)} sends ${t.give.join(', ') || 'nothing'} to ${nm(t.to)} for ${t.get.join(', ') || 'nothing'}`);
    };
    if (how === 'accept') {
      if (t.to !== me() || t.status !== 'proposed') fail('Only the other player can accept');
      if (doc.commish === t.from || doc.commish === t.to) exec();
      else { t.status = 'approval'; logTx(doc, `${nm(t.to)} accepted ${nm(t.from)}'s trade; waiting for the commissioner`); }
    } else if (how === 'approve') {
      if (doc.commish !== me() || t.status !== 'approval') fail('Only the commissioner approves trades');
      exec();
    } else if (how === 'decline') {
      if (t.to !== me()) fail('Only the other player can decline');
      t.status = 'declined'; t.doneAt = Date.now(); logTx(doc, `${nm(t.to)} declined ${nm(t.from)}'s trade`);
    } else if (how === 'cancel') {
      if (t.from !== me()) fail('Only the player who offered it can cancel');
      t.status = 'cancelled'; t.doneAt = Date.now();
    } else if (how === 'veto') {
      if (doc.commish !== me()) fail('Only the commissioner can veto');
      t.status = 'vetoed'; t.doneAt = Date.now(); logTx(doc, `Commissioner vetoed the trade between ${nm(t.from)} and ${nm(t.to)}`);
    }
  }, { accept: 'Trade accepted', approve: 'Trade approved', decline: 'Trade declined', cancel: 'Offer cancelled', veto: 'Trade vetoed' }[how]),
};

/* ---------- hype: the pick reveal and the lobby ticker ---------- */
function revealPick(s, p) {
  pool();
  const e = BYNAME.get(p.name);
  if (!e) return;
  const n = order(s).length || 1;
  document.querySelectorAll('.reveal').forEach((x) => x.remove());
  const el = document.createElement('div');
  el.className = 'reveal';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="rv-in"><div class="rv-top">Round ${Math.floor(p.i / n) + 1} · Pick ${(p.i % n) + 1}</div>
    <div class="rv-who">${p.uid === me() ? 'You select' : `${esc(nm(p.uid))} selects`}</div>
    <div class="rv-card">${PT.cardHTML(e.rep, 0.86)}</div>
    <div class="rv-name">${esc(p.name)}</div><div class="rv-sub">tap to continue</div></div>`;
  document.body.appendChild(el);
  try { sfx.play('draw'); sfx.play('coin', 650); sfx.play('win', 760); } catch (err) { /* audio locked */ }
  let gone = false;
  const close = () => { if (gone) return; gone = true; el.classList.add('out'); setTimeout(() => el.remove(), 380); };
  el.addEventListener('click', close);
  setTimeout(close, 3600);
}
/** A sports-style ticker of league news for the lobby (empty when there's nothing to say). */
function tickerHTML() {
  const l = L(), s = season(l);
  if (!l || !s) return '';
  const items = [];
  if (s.status === 'drafting') { const c = onClock(s); items.push(`<b>DRAFT LIVE</b> · ${c === me() ? "<b>you're</b>" : esc(nm(c))} on the clock`); }
  if (s.status === 'setup') items.push(`The <b>${esc(s.year)}</b> draft is coming. ${s.order.length} players: ${s.order.map((u) => esc(nm(u))).join(', ')}`);
  const st = standings(l, l.current).rows.filter((r) => r.g);
  if (st[0]) items.push(`👑 <b>${esc(nm(st[0].uid))}</b> leads ${esc(s.year)} at ${st[0].w}–${st[0].l}`);
  for (const r of st) { const k = parseInt(String(r.streak).slice(1), 10); if (r.streak[0] === 'W' && k >= 2) items.push(`🔥 <b>${esc(nm(r.uid))}</b> has won ${k} straight`); }
  const res = Object.values(l.results || {}).sort((a, b) => b.at - a.at).slice(0, 4);
  for (const r of res) items.push(`<b>${esc(nm(r.w))}</b> def. ${esc(nm(r.l))}${r.wd ? ` with ${esc(r.wd)}` : ''}`);
  const picks = (s.picks || []).slice().sort((a, b) => b.at - a.at).slice(0, 5);
  for (const p of picks) items.push(`${esc(nm(p.uid))} ${p.keeper ? 'kept' : 'drafted'} <b>${esc(p.name)}</b>`);
  const trades = (l.trades || []).filter((t) => t.status === 'done').sort((a, b) => b.doneAt - a.doneAt).slice(0, 2);
  for (const t of trades) items.push(`TRADE: ${esc(nm(t.from))} sends ${esc(t.give.join(', ') || 'nothing')} to ${esc(nm(t.to))} for ${esc(t.get.join(', ') || 'nothing')}`);
  if (!items.length) return '';
  const run = items.map((x) => `<span>${x}</span>`).join('');
  const dur = Math.max(24, items.length * 7);
  const d = -((Date.now() / 1000) % dur);
  return `<div class="ticker" data-league="1" role="marquee" aria-label="League news"><div class="tk-tag">⚡ LEAGUE</div><div class="tk-track"><div class="tk-run" style="--dur:${dur}s;--d:${d.toFixed(2)}s">${run}${run}</div></div></div>`;
}

/* ---------- stats ---------- */
function standings(l, key) {
  const rows = new Map();
  const res = Object.values(l.results || {}).filter((r) => !key || r.s === key).sort((a, b) => a.at - b.at);
  const row = (u) => { if (!rows.has(u)) rows.set(u, { uid: u, w: 0, l: 0, seq: [] }); return rows.get(u); };
  const members = key && l.seasons[key] ? (l.seasons[key].order.length ? l.seasons[key].order : l.members) : l.members;
  for (const u of members) row(u);
  for (const r of res) { const w = row(r.w), lo = row(r.l); w.w++; w.seq.push('W'); lo.l++; lo.seq.push('L'); }
  const out = [...rows.values()].map((r) => {
    const g = r.w + r.l; let k = 0; const last = r.seq[r.seq.length - 1];
    for (let i = r.seq.length - 1; i >= 0 && r.seq[i] === last; i--) k++;
    return { ...r, g, pct: g ? r.w / g : 0, streak: last ? last + k : '–', last5: r.seq.slice(-5) };
  });
  out.sort((a, b) => (b.g > 0) - (a.g > 0) || b.w - a.w || b.pct - a.pct || a.l - b.l);
  return { rows: out, res };
}
function h2h(res, members) {
  const m = {};
  for (const a of members) { m[a] = {}; for (const b of members) m[a][b] = [0, 0]; }
  for (const r of res) { if (m[r.w] && m[r.w][r.l]) m[r.w][r.l][0]++; if (m[r.l] && m[r.l][r.w]) m[r.l][r.w][1]++; }
  return m;
}

/* ---------- rendering ---------- */
const when = (t) => { const d = new Date(t); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const TCOL = { Grass: '#4caf50', Fire: '#f4511e', Water: '#2196f3', Lightning: '#fdd835', Psychic: '#9c27b0', Fighting: '#a1887f', Colorless: '#e0e0e0' };
const typeDot = (t) => `<i class="tydot" style="background:${TCOL[t] || '#999'}"></i>`;

function lobbyPanel() {
  const l = L();
  { const nav = document.querySelector('#nav-league'); if (nav) nav.classList.toggle('drafting', liveDraft()); }
  if (!l) return `<div class="panel lgpanel"><div class="scene castle"></div><div class="row"><h2 class="grow">Ranked league</h2><button class="sec" type="button" data-league="1">Open</button></div><p class="small muted" style="margin:6px 0 0">Yearly draft, keepers, trades and standings. Not set up yet.</p></div>`;
  const s = season(l);
  const clock = s && s.status === 'drafting' ? onClock(s) : null;
  const mine = clock && clock === me();
  const pend = (l.trades || []).filter((t) => (t.status === 'proposed' && t.to === me()) || (t.status === 'approval' && l.commish === me())).length;
  const line = !s ? '' : s.status === 'setup' ? `${s.year} draft hasn't started` : s.status === 'drafting' ? (mine ? "<b>You're on the clock!</b>" : `Draft live · ${esc(nm(clock))} is picking`) : (() => { const st = standings(l, l.current).rows[0]; return st && st.g ? `${s.year} leader: <b>${esc(nm(st.uid))}</b> (${st.w}–${st.l})` : `${s.year} season · draft done`; })();
  return `<div class="panel lgpanel${mine ? ' hot' : ''}"><div class="scene castle"></div><div class="row"><h2 class="grow">Ranked league</h2><button class="${mine ? 'pri' : 'sec'}" type="button" data-league="1">${mine ? 'Pick now' : 'Open'}</button></div>
    <p class="small" style="margin:6px 0 0">${line}${pend ? ` · <b>${pend} trade${pend === 1 ? '' : 's'} waiting on you</b>` : ''}</p></div>`;
}
/** The lobby's Ranked League section: the castle, this season's status and a standings preview. */
function lobbyFeature() {
  { const nav = document.querySelector('#nav-league'); if (nav) nav.classList.toggle('drafting', liveDraft()); }
  const l = L();
  const head = (btn) => `<header class="realm-head castle"><div class="rh-copy"><span class="kicker">Championship Castle</span><h2>Ranked League</h2></div>${btn}</header>`;
  if (!l) return `<section class="realm realm-league">${head('<button class="pri" type="button" data-league="1">Visit the League</button>')}<div class="realm-body"><p>A yearly draft where every Pokémon name is its own pick, one keeper per player, trades, and standings from ranked games.</p><p class="small muted">Not set up yet. Whoever sets it up becomes the commissioner.</p></div></section>`;
  const s = season(l);
  const clock = s && s.status === 'drafting' ? onClock(s) : null;
  const mine = clock && clock === me();
  const pend = (l.trades || []).filter((t) => (t.status === 'proposed' && t.to === me()) || (t.status === 'approval' && l.commish === me())).length;
  const rows = s ? standings(l, l.current).rows : [];
  const played = rows.some((r) => r.g);
  const status = !s ? '' : s.status === 'setup' ? `The ${esc(s.year)} draft hasn't started` : s.status === 'drafting' ? (mine ? "<b>You're on the clock!</b>" : `Draft live · <b>${esc(nm(clock))}</b> is picking`) : `Draft complete · ${s.picks.length} picks`;
  const top = rows.slice(0, 3).map((r, i) => `<div class="lp-row${r.uid === me() ? ' me' : ''}"><span class="lp-rank">${r.g ? `<img src="art/badge-${['champion', 'silver', 'bronze'][i]}.webp" alt="${i + 1}" title="${['1st', '2nd', '3rd'][i]} place">` : `<i>${i + 1}</i>`}</span><span class="lp-name">${esc(nm(r.uid))}</span><span class="lp-rec">${r.g ? `${r.w}–${r.l}` : 'no games'}</span></div>`).join('');
  return `<section class="realm realm-league${mine ? ' hot' : ''}">${LID !== 'main' ? `<div class="testtag">Practice league: ${LID}</div>` : ''}${head(`<button class="pri" type="button" data-league="1">${mine ? 'Pick now' : 'View the League'}</button>`)}<div class="realm-body">
    <div class="season-plate"><span class="kicker">${esc(s ? s.year : '')} season</span><div class="sp-status">${status}</div><div class="sp-meta">${l.members.length} players · commissioner ${esc(nm(l.commish))}</div></div>
    <div class="lp"><div class="lp-title">Standings</div>${top}</div>
    ${!played ? '<p class="small muted lp-note">Rank badges appear once ranked games are played.</p>' : ''}
    ${pend ? `<p class="small lp-note"><b>${pend} trade${pend === 1 ? '' : 's'} waiting on you</b></p>` : ''}</div></section>`;
}
function gameChip(g) { return g && g.ranked ? '<span class="rkchip" title="Ranked league game">Ranked</span>' : ''; }

function render(main) {
  const l = L();
  pool();
  { const nav = document.querySelector('#nav-league'); if (nav) nav.classList.toggle('drafting', liveDraft()); }
  if (!l) {
    main.innerHTML = `<div class="lg"><div class="panel" style="max-width:640px;margin:0 auto"><h2>Ranked league</h2>
      <p>A yearly draft where each Pokémon name is its own pick (Charizard, Dark Charizard and Blaine's Charizard are three different picks), one keeper per player, trades, and standings from ranked games.</p>
      <ul class="small"><li>Pre-evolutions are free: if you own Charizard you can play Charmander and Charmeleon.</li><li>Colorless Pokémon (Chansey, Snorlax, Dragonite…) are free for everyone and aren't in the draft.</li><li>Basic Pokémon that evolve (Charmander, Pikachu, Abra…) aren't in the draft either: own one of their evolutions to play them.</li><li>Trainers and Energy are free for everyone.</li><li>The draft ends when everyone agrees to stop; whatever is left becomes a free agent anyone can claim.</li></ul>
      <p class="small muted">Whoever sets up the league becomes its commissioner.</p>
      <button class="pri" type="button" data-a="create">Set up the league</button></div></div>`;
    bind(main);
    return;
  }
  const s = season(l);
  const comm = isCommish(l);
  const pend = (l.trades || []).filter((t) => (t.status === 'proposed' && t.to === me()) || (t.status === 'approval' && comm)).length;
  const tabs = [['overview', 'Standings'], ['draft', s && s.status === 'done' ? 'Draft & free agents' : 'Draft'], ['rosters', 'Rosters'], ['trades', 'Trades' + (pend ? ` <b class="badge">${pend}</b>` : '')], ...(comm ? [['commish', 'Commissioner']] : [])];
  if (!tabs.some((t) => t[0] === V.tab)) V.tab = 'overview';
  const keepFocus = document.activeElement && document.activeElement.id === 'lq';
  const body = V.tab === 'draft' ? draftTab(l, s) : V.tab === 'rosters' ? rostersTab(l) : V.tab === 'trades' ? tradesTab(l, s) : V.tab === 'commish' ? commishTab(l, s) : overviewTab(l, s);
  main.innerHTML = `<div class="lg">
    ${testBanner()}<div class="lghead"><img class="lgcrest" src="art/crest.webp" alt="" width="301" height="194"><div class="grow"><h1>${esc(l.name || 'Ranked league')}</h1><div class="ornate" aria-hidden="true"></div><div class="small muted">${esc(s ? s.year : '')} season · <img class="cbadge" src="art/badge-purple.webp" alt="">commissioner ${esc(nm(l.commish))} · ${l.members.map((u) => esc(nm(u))).join(', ')}</div></div>
      ${!isMember(me(), l) ? '<span class="chip">Watching (not in the league)</span>' : ''}</div>
    <div class="lgtabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="tag ${V.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
    ${body}</div>`;
  if (keepFocus) { const q = main.querySelector('#lq'); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* ignore */ } } }
  bind(main);
}

function overviewTab(l, s) {
  const { rows, res } = standings(l, l.current);
  const all = seasonKeys(l).length > 1 ? standings(l, null) : null;
  const members = s.order.length ? s.order : l.members;
  const hh = h2h(res, members);
  const recent = Object.values(l.results || {}).sort((a, b) => b.at - a.at).slice(0, 12);
  const clock = onClock(s);
  const status = s.status === 'setup' ? `The ${s.year} draft hasn't started yet.` : s.status === 'drafting' ? `The ${s.year} draft is live. ${clock === me() ? "<b>You're on the clock.</b>" : `${esc(nm(clock))} is picking.`}` : `Draft finished: ${s.picks.length} picks. Ranked games count toward these standings.`;
  const table = (rs) => `<table class="lgt"><thead><tr><th>#</th><th class="l">Player</th><th>W</th><th>L</th><th>Win %</th><th>Streak</th><th class="l">Last 5</th></tr></thead><tbody>
    ${rs.map((r, i) => `<tr class="${r.uid === me() ? 'me' : ''}${i === 0 && r.g ? ' lead' : ''}"><td>${r.g && i < 3 ? `<img class="rankb" src="art/badge-${['champion', 'silver', 'bronze'][i]}.webp" alt="${i + 1}" title="${['1st', '2nd', '3rd'][i]} place">` : i + 1}</td><td class="l"><b>${esc(nm(r.uid))}</b>${r.uid === l.commish ? ' <span class="small muted">(commish)</span>' : ''}</td><td>${r.w}</td><td>${r.l}</td><td>${r.g ? Math.round(r.pct * 100) + '%' : '–'}</td><td>${r.streak}${r.streak[0] === 'W' && parseInt(r.streak.slice(1), 10) >= 3 ? ' <span class="fire">🔥</span>' : ''}</td><td class="l">${r.last5.map((x) => `<span class="wl ${x}">${x}</span>`).join('') || '<span class="muted small">no games</span>'}</td></tr>`).join('')}</tbody></table>`;
  const leader = rows.find((r) => r.g);
  const done = (l.trades || []).filter((t) => t.status === 'done' && t.s === l.current).length;
  const champs = seasonKeys(l).filter((k) => +k < +l.current).reverse().map((k) => { const top = standings(l, k).rows.find((r) => r.g); return top ? { k, top } : null; }).filter(Boolean);
  const glance = `<div class="glance">
    <div class="gtile gold"><span class="gl">${esc(s.year)} leader</span><span class="gv">${leader ? esc(nm(leader.uid)) : '—'}</span><span class="gs">${leader ? `${leader.w}–${leader.l}` : 'no ranked games yet'}</span><img src="art/badge-champion.webp" alt=""></div>
    <div class="gtile"><span class="gl">Draft</span><span class="gv">${s.status === 'setup' ? 'Not started' : s.status === 'drafting' ? 'Live' : `${s.picks.length} picks`}</span><span class="gs">${s.status === 'drafting' ? `${esc(nm(clock))} is picking` : s.status === 'done' ? 'free agents open' : `${order(s).length} players`}</span><img src="art/badge-purple.webp" alt=""></div>
    <div class="gtile"><span class="gl">Ranked games</span><span class="gv">${res.length}</span><span class="gs">this season</span><img src="art/badge-blue.webp" alt=""></div>
    <div class="gtile"><span class="gl">Trades</span><span class="gv">${done}</span><span class="gs">completed this season</span><img src="art/badge-silver.webp" alt=""></div></div>`;
  const podium = `<div class="podium">${[1, 0, 2].map((i) => { const r = rows[i]; const earned = !!(r && r.g); const badge = ['champion', 'silver', 'bronze'][i];
    return `<div class="pod p${i + 1}${earned ? '' : ' preview'}"><img src="art/badge-${badge}.webp" alt="" width="109" height="109"><div class="pod-place">${['1st place', '2nd place', '3rd place'][i]}</div>${earned ? `<div class="pod-name">${esc(nm(r.uid))}</div><div class="pod-rec">${r.w}–${r.l} · ${Math.round(r.pct * 100)}%</div>` : `<div class="pod-name">Unclaimed</div><div class="pod-rec">${r ? 'play ranked games to claim it' : 'needs more players'}</div>`}</div>`; }).join('')}</div>`;
  return `${glance}
    <section class="hall"><div class="frame-head"><h2>${esc(s.year)} Standings</h2></div>
      ${podium}
      <div class="panel lb"><div class="row lb-top"><p class="small muted grow">${status}</p>${s.status !== 'setup' ? `<button class="sm" type="button" data-tab="draft">${s.status === 'drafting' ? 'Go to the draft' : 'Draft board'}</button>` : ''}</div>${table(rows)}
        <p class="small muted" style="margin:10px 0 0">Start a ranked game from the lobby: Create Table → Ranked league game. Decks may only use Pokémon on your roster and anything they evolve from.</p></div></section>
    ${champs.length ? `<div class="panel"><h2>Champions</h2><div class="champs">${champs.map((c) => `<div class="champ"><img src="art/badge-red.webp" alt=""><div><b>${esc(nm(c.top.uid))}</b><div class="small muted">${esc(c.k)} champion · ${c.top.w}–${c.top.l}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="grid2 lg-mid">
      ${members.length > 1 ? `<div class="panel"><h2>Head to Head</h2><table class="lgt hh"><thead><tr><th></th>${members.map((u) => `<th>${esc(nm(u))}</th>`).join('')}</tr></thead><tbody>${members.map((a) => `<tr><th class="l">${esc(nm(a))}</th>${members.map((b) => (a === b ? '<td class="muted">–</td>' : `<td>${hh[a][b][0]}–${hh[a][b][1]}</td>`)).join('')}</tr>`).join('')}</tbody></table><p class="small muted" style="margin:8px 0 0">Row player's record against the column player this season.</p></div>` : ''}
      <div class="panel"><h2>Recent Ranked Matches</h2>${recent.length ? `<div class="list">${recent.map((r) => `<div class="item match"><img src="art/badge-champion.webp" alt="" class="mw"><div class="grow"><b>${esc(nm(r.w))}</b> beat ${esc(nm(r.l))}<div class="small muted">${esc(r.wd || 'deck')} vs ${esc(r.ld || 'deck')}${r.turns ? ` · ${r.turns} turns` : ''} · ${when(r.at)}</div></div></div>`).join('')}</div>` : '<p class="muted small">No ranked games yet.</p>'}</div>
    </div>
    ${all ? `<div class="panel"><h2>All-time</h2>${table(all.rows)}</div>` : ''}
    <div class="panel"><h2>League Activity</h2><div class="lglog">${(l.log || []).slice(-40).reverse().map((e) => `<div><span class="t">${when(e.at)}</span> ${esc(e.t)}</div>`).join('') || '<span class="muted small">Nothing yet.</span>'}</div></div>`;
}

function filteredPool(s) {
  const q = V.q.trim().toLowerCase();
  let list = pool().filter((e) => {
    if (V.avail === 'open' && s.own[e.name]) return false;
    if (V.avail === 'taken' && !s.own[e.name]) return false;
    if (V.stage && e.stage !== V.stage) return false;
    if (V.type && !e.types.has(V.type)) return false;
    if (q) { const hay = (e.name + ' ' + e.ids.map((id) => { const c = PT.CARDS[id]; return (c.atk || []).map((a) => a.n + ' ' + a.t).join(' ') + ' ' + (c.pw || []).map((p) => p.n + ' ' + p.t).join(' '); }).join(' ')).toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
  if (V.sort === 'hp') list = list.slice().sort((a, b) => b.hp - a.hp || a.name.localeCompare(b.name));
  else if (V.sort === 'stage') list = list.slice().sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || a.name.localeCompare(b.name));
  return list;
}

function poolGrid(l, s, mode) {
  const list = filteredPool(s);
  const clock = onClock(s), mine = clock === me(), comm = isCommish(l), member = isMember(me(), l);
  const TYPES = Object.keys(TCOL).filter((t) => t !== 'Colorless');
  const filters = `<div class="filters">
      <input type="text" id="lq" placeholder="Search name, attack or power" value="${esc(V.q)}" style="flex:1;min-width:160px">
      <select id="lavail"><option value="open" ${V.avail === 'open' ? 'selected' : ''}>${mode === 'fa' ? 'Free agents' : 'Still available'}</option><option value="taken" ${V.avail === 'taken' ? 'selected' : ''}>Taken</option><option value="all" ${V.avail === 'all' ? 'selected' : ''}>All Pokémon</option></select>
      <select id="lstage"><option value="">Any stage</option>${STAGES.map((x) => `<option ${V.stage === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <select id="lsort"><option value="name" ${V.sort === 'name' ? 'selected' : ''}>A–Z</option><option value="stage" ${V.sort === 'stage' ? 'selected' : ''}>Evolved first</option><option value="hp" ${V.sort === 'hp' ? 'selected' : ''}>Most HP</option></select>
    </div>
    <div class="filters"><div class="chips">${TYPES.map((t) => `<button type="button" class="tag ty ${V.type === t ? 'on' : ''}" data-ltype="${t}"><i style="background:${TCOL[t]}"></i>${t}</button>`).join('')}</div></div>`;
  const tiles = list.map((e) => {
    const owner = s.own[e.name];
    let btn = '';
    if (!owner) {
      if (mode === 'draft' && mine) btn = `<button class="pri sm" type="button" data-pick="${esc(e.name)}">Draft</button>`;
      else if (mode === 'draft' && comm && clock) btn = `<button class="sm" type="button" data-pick="${esc(e.name)}" title="Make this pick for ${esc(nm(clock))}">Draft for ${esc(nm(clock))}</button>`;
      else if (mode === 'fa' && member) btn = `<button class="sec sm" type="button" data-claim="${esc(e.name)}">Claim</button>`;
    }
    const pre = [...(PRE.get(e.base) || [])];
    return `<div class="tile ltile${owner ? ' taken' : ''}${owner === me() ? ' mine' : ''}" style="--tc:${TCOL[e.type] || '#ffcb05'}"><div class="cd click" style="${PT.cardStyle(e.rep)}" data-view="${e.rep}" role="img" aria-label="${esc(e.name)}">${owner ? `<span class="own">${esc(nm(owner))}</span>` : ''}</div>
      <div class="nm" title="${esc(e.name)}">${esc(e.name)}</div>
      <div class="meta small muted">${typeDot(e.type)}${e.stage}${e.ids.length > 1 ? ` · <span class="vers">${e.ids.map((id, k) => `<a href="#" data-view="${id}" title="${esc(PT.CARDS[id].set)}">v${k + 1}</a>`).join(' ')}</span>` : ''}</div>
      ${pre.length ? `<div class="meta small muted" title="Free with this pick">+ ${esc(pre.join(', '))}</div>` : ''}
      ${btn}</div>`;
  }).join('');
  return `${filters}<div class="small muted" style="margin:0 0 8px">${list.length} Pokémon</div><div class="cdgrid lgrid">${tiles || '<p class="muted">Nothing matches.</p>'}</div>`;
}

function boardHTML(l, s) {
  const o = order(s), n = o.length;
  if (!n) return '';
  const byI = new Map((s.picks || []).map((p) => [p.i, p]));
  const next = s.status === 'drafting' ? nextIndex(s) : -1;
  const maxI = Math.max(next, ...[...byI.keys()], 0);
  const rounds = Math.max(1, Math.floor(maxI / n) + 1);
  let rows = '';
  for (let r = rounds - 1; r >= 0; r--) {
    rows += `<tr><th>R${r + 1}</th>${o.map((u, c) => { const i = indexFor(s, r, c); const p = byI.get(i); const cls = i === next ? 'now' : p && p.keeper ? 'kp' : ''; return `<td class="${cls}">${p ? `<a href="#" data-view="${(BYNAME.get(p.name) || {}).rep || ''}">${esc(p.name)}</a>${p.keeper ? ' <span class="k" title="Keeper">K</span>' : ''}` : i === next ? 'on the clock' : ''}</td>`; }).join('')}</tr>`;
  }
  return `<div class="boardwrap"><table class="lgt dboard"><thead><tr><th></th>${o.map((u) => `<th class="${u === me() ? 'me' : ''}">${esc(nm(u))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function draftTab(l, s) {
  const comm = isCommish(l);
  if (s.status === 'setup') {
    const prev = prevSeason(l, l.current);
    const keeperRow = (u) => {
      if (!s.keepersOn) return '';
      const opts = prev ? Object.entries(prev.own || {}).filter(([, o]) => o === u).map(([n]) => n).sort() : [];
      const can = u === me() || comm;
      return `<div class="small">Keeper: ${can && opts.length ? `<select data-keeper="${u}"><option value="">None</option>${opts.map((n) => `<option ${s.keepers[u] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<b>${esc(s.keepers[u] || (opts.length ? 'not chosen' : 'none (no roster last season)'))}</b>`}</div>`;
    };
    return `<div class="panel" style="max-width:760px"><div class="scene sunset tall"><span class="scene-cap">The ${esc(s.year)} draft</span></div>
      <h2>${esc(s.year)} draft: getting ready</h2>
      <p class="small muted">Each Pokémon name is its own pick; Colorless Pokémon are free for everyone, and Basics that evolve come free with their evolutions, so neither is drafted. ${s.snake !== false ? 'Snake order: the order reverses every round.' : 'Same order every round.'} ${s.keepersOn ? 'Keepers are on: your keeper takes your round 1 pick.' : 'No keepers this season.'} The draft keeps going until every player presses “I'm done drafting”.</p>
      <ol class="lgorder">${order(s).map((u) => `<li><b>${esc(nm(u))}</b>${keeperRow(u)}</li>`).join('')}</ol>
      ${comm ? `<div class="row"><button class="pri" type="button" data-a="startDraft" ${order(s).length < 2 ? 'disabled' : ''}>Start the draft</button><button type="button" data-tab="commish">Order, players &amp; keepers</button></div>${order(s).length < 2 ? '<p class="small muted">Add at least one more player on the Commissioner tab.</p>' : ''}` : `<p class="small muted">Waiting for ${esc(nm(l.commish))} to start the draft.</p>`}
    </div>`;
  }
  const votes = new Set(s.stopVotes || []);
  if (s.status === 'drafting') {
    const clock = onClock(s), i = nextIndex(s), n = order(s).length;
    const voted = votes.has(me());
    return `<div class="clock${clock === me() ? ' mine' : ''}"><div class="grow"><div class="big">${clock === me() ? "You're on the clock!" : `${esc(nm(clock))} is on the clock`}</div><div class="small">Round ${Math.floor(i / n) + 1}, pick ${(i % n) + 1} · ${s.picks.length} picks made</div></div>
        ${comm ? `<button class="sm" type="button" data-a="undoPick">Undo last pick</button>` : ''}</div>
      <div class="panel stopbar"><div class="grow"><b>Ready to stop?</b> <span class="small muted">The draft ends when everyone agrees. Undrafted Pokémon become free agents.</span>
        <div class="votes">${order(s).map((u) => `<span class="vote ${votes.has(u) ? 'on' : ''}">${votes.has(u) ? '✓' : '…'} ${esc(nm(u))}</span>`).join('')}</div></div>
        ${isMember(me(), l) ? `<button type="button" class="${voted ? '' : 'sec'}" data-a="voteStop">${voted ? 'Keep drafting' : "I'm done drafting"}</button>` : ''}</div>
      <div class="lgsplit"><div class="panel">${poolGrid(l, s, 'draft')}</div><div class="panel"><h3>Draft board</h3>${boardHTML(l, s)}</div></div>`;
  }
  return `<div class="lgsplit"><div class="panel"><div class="scene moon"></div><h2>Free agents</h2><p class="small muted">The draft is over. Anything nobody drafted can be claimed by any player, first come first served.</p>${poolGrid(l, s, 'fa')}</div>
    <div class="panel"><h3>${esc(s.year)} draft board</h3><p class="small muted">${s.picks.length} picks${s.endedAt ? ', finished ' + when(s.endedAt) : ''}.</p>${boardHTML(l, s)}</div></div>`;
}

const HOW = { K: 'Keeper', trade: 'Trade', FA: 'Free agent', comm: 'Commissioner' };
function rostersTab(l) {
  const key = V.season && l.seasons[V.season] ? V.season : l.current;
  const s = l.seasons[key];
  const members = s.order.length ? s.order : l.members;
  const cur = key === l.current;
  return `<div class="row" style="margin-bottom:10px"><span class="small muted">Season</span><select id="lseason">${seasonKeys(l).map((k) => `<option ${k === key ? 'selected' : ''}>${k}</option>`).join('')}</select><span class="small muted">Pre-evolutions of your Pokémon and every Colorless Pokémon are free, so they aren't listed.</span></div>
    <div class="rostgrid">${members.map((u) => {
      const names = Object.entries(s.own || {}).filter(([, o]) => o === u).map(([n]) => n).sort((a, b) => { const ea = BYNAME.get(a), eb = BYNAME.get(b); return STAGES.indexOf((eb || {}).stage) - STAGES.indexOf((ea || {}).stage) || a.localeCompare(b); });
      const free = new Set(); for (const n of names) for (const p of PRE.get(baseOf(n)) || []) if (!names.includes(p)) free.add(p);
      return `<div class="panel"><div class="row"><h3 class="grow">${esc(nm(u))}${u === me() ? ' (you)' : ''}</h3><span class="chip">${names.length}</span></div>
        ${names.length ? `<div class="rlist">${names.map((n) => { const e = BYNAME.get(n) || {}; const h = (s.how || {})[n] || ''; return `<div class="ritem"><div class="cd click" style="${PT.cardStyle(e.rep)}" data-view="${e.rep}"></div><div class="grow"><b>${esc(n)}</b><div class="small muted">${typeDot(e.type)}${e.stage || ''}${h ? ' · ' + esc(HOW[h] || (h[0] === 'R' ? 'Round ' + h.slice(1) : h)) : ''}</div></div>${cur && u === me() && s.status === 'done' ? `<button class="sm ghost" type="button" data-release="${esc(n)}" title="Release to free agents">Release</button>` : ''}</div>`; }).join('')}</div>` : '<p class="muted small">No Pokémon yet.</p>'}
        ${free.size ? `<p class="small muted" style="margin:8px 0 0">Also playable (pre-evolutions): ${esc([...free].sort().join(', '))}</p>` : ''}</div>`;
    }).join('')}</div>`;
}

function tradesTab(l, s) {
  const comm = isCommish(l), member = isMember(me(), l);
  const trades = (l.trades || []).slice().sort((a, b) => b.at - a.at);
  const open = trades.filter((t) => t.status === 'proposed' || t.status === 'approval');
  const past = trades.filter((t) => !(t.status === 'proposed' || t.status === 'approval')).slice(0, 30);
  const tradeLine = (t) => `<b>${esc(nm(t.from))}</b> gives ${t.give.length ? esc(t.give.join(', ')) : '<i>nothing</i>'} · <b>${esc(nm(t.to))}</b> gives ${t.get.length ? esc(t.get.join(', ')) : '<i>nothing</i>'}`;
  const btns = (t) => {
    const b = [];
    if (t.status === 'proposed' && t.to === me()) b.push(`<button class="pri sm" type="button" data-trade="${t.id}" data-how="accept">Accept</button>`, `<button class="sm" type="button" data-trade="${t.id}" data-how="decline">Decline</button>`);
    if (t.status === 'approval' && comm) b.push(`<button class="pri sm" type="button" data-trade="${t.id}" data-how="approve">Approve</button>`);
    if (t.from === me()) b.push(`<button class="sm" type="button" data-trade="${t.id}" data-how="cancel">Cancel offer</button>`);
    if (comm && t.from !== me()) b.push(`<button class="sm dng ghost" type="button" data-trade="${t.id}" data-how="veto">Veto</button>`);
    return b.join('');
  };
  let form = '';
  if (member && s.status !== 'setup') {
    const others = l.members.filter((u) => u !== me());
    if (!others.includes(V.tradeWith)) { V.tradeWith = others[0] || ''; V.get.clear(); }
    const mine = Object.entries(s.own).filter(([, o]) => o === me()).map(([n]) => n).sort();
    const theirs = V.tradeWith ? Object.entries(s.own).filter(([, o]) => o === V.tradeWith).map(([n]) => n).sort() : [];
    for (const n of [...V.give]) if (!mine.includes(n)) V.give.delete(n);
    for (const n of [...V.get]) if (!theirs.includes(n)) V.get.delete(n);
    const box = (n, set, k) => `<label class="tchk"><input type="checkbox" data-${k}="${esc(n)}" ${set.has(n) ? 'checked' : ''}> ${esc(n)}</label>`;
    form = `<div class="panel"><h2>Propose a trade</h2>
      <div class="row"><span class="small">Trade with</span><select id="ltwith">${others.map((u) => `<option value="${u}" ${u === V.tradeWith ? 'selected' : ''}>${esc(nm(u))}</option>`).join('')}</select></div>
      <div class="grid2" style="margin-top:10px"><div><div class="lbl">You give (${V.give.size})</div><div class="tbox">${mine.map((n) => box(n, V.give, 'give')).join('') || '<span class="muted small">Your roster is empty.</span>'}</div></div>
        <div><div class="lbl">You get (${V.get.size})</div><div class="tbox">${theirs.map((n) => box(n, V.get, 'get')).join('') || '<span class="muted small">Their roster is empty.</span>'}</div></div></div>
      <input type="text" id="ltnote" maxlength="200" placeholder="Note (optional)" value="${esc(V.note)}" style="width:100%;margin-top:10px">
      <div class="row" style="margin-top:10px"><button class="pri" type="button" data-a="propose" ${V.give.size + V.get.size ? '' : 'disabled'}>Send offer</button><span class="small muted">${comm ? 'Trades with you go through when the other player accepts.' : `After the other player accepts, ${esc(nm(l.commish))} approves it as commissioner.`}</span></div></div>`;
  } else if (s.status === 'setup') form = '<div class="panel muted">Trades open once the draft starts.</div>';
  const label = { proposed: 'Waiting for the other player', approval: 'Waiting for the commissioner', done: 'Completed', declined: 'Declined', cancelled: 'Cancelled', vetoed: 'Vetoed' };
  return `<div class="grid2"><div class="stack">${form}</div><div class="stack">
    <div class="panel"><h3>Open offers</h3>${open.length ? `<div class="list">${open.map((t) => `<div class="item"><div class="grow">${tradeLine(t)}${t.note ? `<div class="small">“${esc(t.note)}”</div>` : ''}<div class="small muted">${label[t.status]} · ${when(t.at)}</div></div><div class="row">${btns(t)}</div></div>`).join('')}</div>` : '<p class="muted small">No open offers.</p>'}</div>
    <div class="panel"><h3>Trade history</h3>${past.length ? `<div class="list">${past.map((t) => `<div class="item"><div class="grow">${tradeLine(t)}<div class="small muted">${label[t.status]} · ${when(t.doneAt || t.at)}</div></div></div>`).join('')}</div>` : '<p class="muted small">No trades yet.</p>'}</div>
  </div></div>`;
}

function commishTab(l, s) {
  const cands = Object.entries(PT.S.players || {}).filter(([id, p]) => /^p_[a-z0-9]{8,}$/.test(id) && p && p.name && id !== 'p_bot000000000001' && !l.members.includes(id)).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const setup = s.status === 'setup';
  const allNames = pool().map((e) => e.name);
  return `<div class="grid2"><div class="stack">
    <div class="panel"><h2>Players</h2>
      <div class="list">${l.members.map((u) => `<div class="item"><div class="grow"><b>${esc(nm(u))}</b>${u === l.commish ? ' <span class="small muted">commissioner</span>' : ''}</div>${u !== l.commish && s.status !== 'drafting' ? `<button class="sm dng ghost" type="button" data-remove="${u}">Remove</button>` : ''}</div>`).join('')}</div>
      ${s.status !== 'drafting' ? `<div class="row" style="margin-top:10px"><select id="laddp"><option value="">Add a player…</option>${cands.map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join('')}</select><button class="sm" type="button" data-a="addMember">Add</button></div><p class="small muted">Players show up here once they've opened the site and set their name.</p>` : '<p class="small muted">Players can be added before the draft starts or after it ends.</p>'}</div>
    <div class="panel"><h2>${esc(s.year)} draft</h2>
      ${setup ? `<div class="lbl">Draft order</div><ol class="lgorder">${order(s).map((u, i) => `<li><span class="grow"><b>${esc(nm(u))}</b></span><button class="sm" type="button" data-up="${u}" ${i ? '' : 'disabled'}>↑</button><button class="sm" type="button" data-down="${u}" ${i < order(s).length - 1 ? '' : 'disabled'}>↓</button></li>`).join('')}</ol>
        <div class="row"><button class="sm" type="button" data-a="shuffleOrder">Randomize order</button></div>
        <label class="chk"><input type="checkbox" id="lsnake" ${s.snake !== false ? 'checked' : ''}> Snake order (reverses each round)</label>
        <label class="chk"><input type="checkbox" id="lkeep" ${s.keepersOn ? 'checked' : ''} ${prevSeason(l, l.current) ? '' : 'disabled'}> Keepers this season (one per player, costs their round 1 pick)${prevSeason(l, l.current) ? '' : ' <span class="muted">· from next season</span>'}</label>
        <p class="small muted">Turning keepers off is a keeper reset.</p>
        <div class="row"><button class="pri" type="button" data-a="startDraft" ${order(s).length < 2 ? 'disabled' : ''}>Start the draft</button></div>`
      : s.status === 'drafting' ? `<p class="small">Live: ${s.picks.length} picks. On the Draft tab you can make the pick for whoever is on the clock.</p><div class="row"><button type="button" data-a="undoPick">Undo last pick</button><button class="dng" type="button" data-a="endDraft">End the draft now</button></div>`
      : `<p class="small">Finished with ${s.picks.length} picks.</p><div class="row"><button type="button" data-a="reopenDraft">Reopen the draft</button><button type="button" data-a="undoPick">Undo last pick</button></div>`}
    </div></div>
    <div class="stack">
      <div class="panel"><h2>Move a Pokémon</h2><p class="small muted">Fix mistakes: give a Pokémon to a player or make it a free agent.</p>
        <div class="row"><input type="text" id="lmove" list="lnames" placeholder="Pokémon name" value="${esc(V.moveName)}" style="flex:1;min-width:140px"><datalist id="lnames">${allNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <select id="lmoveto"><option value="">→ Free agent</option>${l.members.map((u) => `<option value="${u}">→ ${esc(nm(u))}</option>`).join('')}</select><button class="sm" type="button" data-a="move">Move</button></div>
        ${V.moveName && s.own ? `<p class="small muted">${esc(V.moveName)} is ${s.own[V.moveName] ? 'owned by ' + esc(nm(s.own[V.moveName])) : 'a free agent'}.</p>` : ''}</div>
      <div class="panel"><h2>Seasons</h2><p class="small">Current: <b>${esc(l.current)}</b>. Seasons so far: ${seasonKeys(l).join(', ')}.</p>
        ${s.status === 'done' ? `<button type="button" data-a="nextSeason">Set up the next season</button><p class="small muted">Starts a fresh draft with empty rosters. Keepers are on by default; each player keeps one Pokémon from this season's roster.</p>` : '<p class="small muted">You can set up the next season once this draft is finished.</p>'}</div>
    </div></div>`;
}

/* ---------- events ---------- */
function bind(main) {
  const rer = () => PT.render();
  const q = main.querySelector('#lq');
  if (q) { let t = null; q.oninput = (e) => { V.q = e.target.value; clearTimeout(t); t = setTimeout(rer, 200); }; }
  const sel = (id, f) => { const el = main.querySelector(id); if (el) el.onchange = (e) => f(e.target); };
  sel('#lavail', (el) => { V.avail = el.value; rer(); });
  sel('#lstage', (el) => { V.stage = el.value; rer(); });
  sel('#lsort', (el) => { V.sort = el.value; rer(); });
  sel('#lseason', (el) => { V.season = el.value; rer(); });
  sel('#ltwith', (el) => { V.tradeWith = el.value; V.get.clear(); rer(); });
  sel('#lsnake', (el) => A.setSnake(el.checked));
  sel('#lkeep', (el) => A.setKeepersOn(el.checked));
  const note = main.querySelector('#ltnote'); if (note) note.oninput = (e) => { V.note = e.target.value; };
  const mv = main.querySelector('#lmove'); if (mv) mv.onchange = (e) => { V.moveName = e.target.value.trim(); rer(); };
  main.querySelectorAll('select[data-keeper]').forEach((el) => { el.onchange = () => A.setKeeper(el.dataset.keeper, el.value); });
  main.querySelectorAll('input[data-give],input[data-get]').forEach((el) => { el.onchange = () => { const set = el.dataset.give != null ? V.give : V.get; const n = el.dataset.give != null ? el.dataset.give : el.dataset.get; if (el.checked) set.add(n); else set.delete(n); rer(); }; });
  main.onclick = (e) => {
    const t = e.target.closest('[data-tab],[data-a],[data-pick],[data-claim],[data-release],[data-trade],[data-remove],[data-up],[data-down],[data-ltype],[data-view]');
    if (!t) return;
    if (t.tagName === 'A') e.preventDefault();
    const d = t.dataset;
    if (d.tab) { V.tab = d.tab; rer(); window.scrollTo(0, 0); return; }
    if (d.ltype) { V.type = V.type === d.ltype ? '' : d.ltype; rer(); return; }
    if (d.pick) { const s = season(); const who = onClock(s); if (who !== me()) { PT.showModal('Draft for ' + nm(who) + '?', `<p>You're making ${esc(nm(who))}'s pick: <b>${esc(d.pick)}</b>.</p>`, '<button class="pri" id="lok" type="button">Draft it</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.pick(d.pick); }; }); } else A.pick(d.pick); return; }
    if (d.claim) { A.claim(d.claim); return; }
    if (d.release) { PT.showModal('Release ' + d.release + '?', '<p>It becomes a free agent that anyone can claim.</p>', '<button class="dng" id="lok" type="button">Release</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.release(d.release); }; }); return; }
    if (d.trade) { A.answerTrade(d.trade, d.how); return; }
    if (d.remove) { PT.showModal('Remove ' + nm(d.remove) + '?', '<p>Their Pokémon this season become free agents. Past results stay.</p>', '<button class="dng" id="lok" type="button">Remove</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.removeMember(d.remove); }; }); return; }
    if (d.up) { A.moveOrder(d.up, -1); return; }
    if (d.down) { A.moveOrder(d.down, 1); return; }
    if (d.view) { if (d.view) PT.viewCard(d.view); return; }
    const a = d.a;
    if (a === 'create') A.create();
    else if (a === 'addMember') { const v = main.querySelector('#laddp').value; if (v) A.addMember(v); }
    else if (a === 'shuffleOrder') A.shuffleOrder();
    else if (a === 'startDraft') PT.showModal('Start the draft?', `<p>Order: ${order(season()).map((u) => esc(nm(u))).join(' → ')}${season().snake !== false ? ' (snake)' : ''}. The order and keepers lock once it starts.</p>`, '<button class="pri" id="lok" type="button">Start</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.startDraft(); }; });
    else if (a === 'undoPick') A.undoPick();
    else if (a === 'voteStop') A.voteStop();
    else if (a === 'endDraft') PT.showModal('End the draft now?', '<p>Everything not drafted becomes a free agent. You can reopen it later.</p>', '<button class="dng" id="lok" type="button">End draft</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.endDraft(); }; });
    else if (a === 'reopenDraft') A.reopenDraft();
    else if (a === 'nextSeason') PT.showModal('Set up the next season?', '<p>Rosters start empty for a new draft. Everyone can pick one keeper from this season first.</p>', '<button class="pri" id="lok" type="button">Set it up</button>', (m) => { m.querySelector('#lok').onclick = () => { PT.closeModal(); A.nextSeason(); }; });
    else if (a === 'move') { const n = (main.querySelector('#lmove').value || '').trim(); const to = main.querySelector('#lmoveto').value || null; pool(); const hit = POOL.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (!hit) { PT.toast('Type a Pokémon name from the list'); return; } V.moveName = hit.name; A.move(hit.name, to); }
    else if (a === 'propose') A.propose(V.tradeWith, [...V.give], [...V.get], V.note.trim()).then((ok) => { if (ok) { V.give.clear(); V.get.clear(); V.note = ''; PT.render(); } });
  };
}
