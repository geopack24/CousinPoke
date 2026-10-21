// Attack animations: a canvas layer over the board plus a few DOM nudges.
//
// How it picks an animation (first match wins):
//   1. MOVE_FX['<cardId>|<Attack Name>']   e.g. 'base1-4|Fire Spin'   (one card's version of a move)
//   2. MOVE_FX['<Attack Name>']            e.g. 'Fire Spin'            (every card with that attack)
//   3. TYPE_FX[<attacker type>]            Fire / Water / Lightning / Grass / Psychic / Fighting / Colorless
//
// Every animation is a function (fx, scene) => { impact, done } where times are in ms from the start.
// `scene` = { type, name, cardId, from: rect, targets: [rect], board: {w,h} } with rects {x,y,w,h,cx,cy} in board pixels.
// `fx` is the drawing toolkit below (particles, rings, bolts, beams, flashes, shake, text) plus fx.at(ms, fn) for timing.
// Add a new custom move by adding one entry to MOVE_FX; the default type animation is used until then.

import * as sfx from './sfx.js';

const PAL = {
  Fire: ['#ffdd55', '#ff9a1f', '#ff5a1f', '#e8321f'],
  Water: ['#bfe9ff', '#6fcbff', '#2d8dff', '#1b5fd0'],
  Lightning: ['#ffffff', '#fff6a0', '#ffe03a', '#ffb300'],
  Grass: ['#d9ff9a', '#8fe05a', '#4dbd3a', '#2b8a2b'],
  Psychic: ['#ffd2ff', '#e58bff', '#b44cff', '#7a1fd0'],
  Fighting: ['#ffffff', '#ffd27a', '#e0953a', '#9a5a1f'],
  Colorless: ['#ffffff', '#e8e8f0', '#c7c7d6', '#9a9ab0'],
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

let enabledFlag = (() => { try { return localStorage.getItem('pt_fx') !== 'off'; } catch (e) { return true; } })();
export { getVolume as soundVolume, setVolume as setSoundVolume, isOn as soundOn } from './sfx.js';
export const isEnabled = () => enabledFlag && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
export function setEnabled(v) { enabledFlag = v; try { localStorage.setItem('pt_fx', v ? 'on' : 'off'); } catch (e) { /* ignore */ } }

/* ---------- the canvas layer ---------- */
class Layer {
  constructor(board) {
    this.board = board; this.items = []; this.timers = new Set(); this.running = false; this.last = 0; this.sz = 1;
    let c = board.querySelector(':scope > canvas.fxlayer');
    if (!c) { c = document.createElement('canvas'); c.className = 'fxlayer'; board.appendChild(c); }
    this.canvas = c; this.ctx = c.getContext('2d'); this.resize();
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = this.board.clientWidth, h = this.board.clientHeight;
    this.w = w; this.h = h; this.dpr = dpr;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
  }
  add(item) { this.items.push(item); this.start(); return item; }
  at(ms, fn) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); return t; }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.frame(t)); }
  frame(now) {
    const dt = Math.min(50, now - this.last); this.last = now; const ctx = this.ctx; this.resize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    this.items = this.items.filter((it) => { it.t += dt; if (it.t > it.life) return false; ctx.save(); it.draw(ctx, it.t / it.life, dt); ctx.restore(); return true; });
    if (this.items.length || this.timers.size) requestAnimationFrame((t) => this.frame(t)); else { this.running = false; ctx.clearRect(0, 0, this.w, this.h); }
  }
  /* --- primitives: each adds an item {t, life, draw} --- */
  particle(o) {
    const z = this.sz; const p = { t: 0, life: o.life || 600, x: o.x, y: o.y, vx: (o.vx || 0) * z, vy: (o.vy || 0) * z, g: o.g || 0, drag: o.drag == null ? 1 : o.drag, size: (o.size || 4) * this.sz, color: o.color || '#fff', shape: o.shape || 'circle', rot: o.rot || 0, vr: o.vr || 0, glow: o.glow || 0, shrink: o.shrink !== false, alpha: o.alpha == null ? 1 : o.alpha, fadeIn: o.fadeIn || 0 };
    p.draw = (ctx, k, dt) => {
      const s = dt / 16.7; p.vy += p.g * s; p.vx *= Math.pow(p.drag, s); p.vy *= Math.pow(p.drag, s); p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
      const a = p.alpha * (1 - k) * (p.fadeIn ? Math.min(1, p.t / p.fadeIn) : 1); const sz = p.shrink ? p.size * (1 - k * 0.7) : p.size;
      ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = p.color; ctx.strokeStyle = p.color; if (p.glow) { ctx.shadowBlur = p.glow; ctx.shadowColor = p.color; }
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === 'spark') { ctx.lineWidth = Math.max(1, sz / 2); ctx.lineCap = 'round'; ctx.rotate(-p.rot); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * 2.5, -p.vy * 2.5); ctx.stroke(); }
      else if (p.shape === 'leaf') { ctx.beginPath(); ctx.ellipse(0, 0, sz * 1.6, sz * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha *= 0.5; ctx.fillStyle = '#1f5a1f'; ctx.fillRect(-sz * 1.4, -0.5, sz * 2.8, 1); }
      else if (p.shape === 'shard') { ctx.beginPath(); ctx.moveTo(sz * 1.8, 0); ctx.lineTo(-sz, sz * 0.8); ctx.lineTo(-sz * 0.4, 0); ctx.lineTo(-sz, -sz * 0.8); ctx.closePath(); ctx.fill(); }
      else if (p.shape === 'drop') { ctx.beginPath(); ctx.ellipse(0, 0, sz * 0.7, sz * 1.2, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === 'star') { ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? sz * 0.45 : sz; const a2 = (i / 10) * Math.PI * 2; ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r); } ctx.closePath(); ctx.fill(); }
      else if (p.shape === 'rect') { ctx.fillRect(-sz, -sz * 0.6, sz * 2, sz * 1.2); }
      else if (p.shape === 'flake') { ctx.lineWidth = 1.2; for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(sz, 0); ctx.stroke(); } }
    };
    return this.add(p);
  }
  burst(x, y, o = {}) {
    const n = o.n || 30; const cols = o.colors || PAL.Colorless;
    for (let i = 0; i < n; i++) { const a = o.angle != null ? o.angle + rnd(-o.spread, o.spread) : rnd(0, Math.PI * 2); const sp = rnd(o.speed ? o.speed * 0.3 : 1, o.speed || 5); this.particle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (o.lift || 0), g: o.g || 0, drag: o.drag || 0.95, life: rnd((o.life || 600) * 0.6, o.life || 600), size: rnd((o.size || 5) * 0.5, o.size || 5), color: pick(cols), shape: o.shape || 'circle', glow: o.glow || 0, rot: rnd(0, 6.3), vr: rnd(-0.3, 0.3) }); }
  }
  ring(x, y, o = {}) { const z = this.sz; const r0 = (o.r0 || 4) * z, r1 = (o.r1 || 80) * z; return this.add({ t: 0, life: o.life || 500, draw: (ctx, k) => { ctx.globalAlpha = (1 - k) * (o.alpha || 0.9); ctx.strokeStyle = o.color || '#fff'; ctx.lineWidth = (o.width || 6) * z * (1 - k * 0.6); if (o.glow) { ctx.shadowBlur = o.glow; ctx.shadowColor = o.color || '#fff'; } ctx.beginPath(); ctx.arc(x, y, lerp(r0, r1, ease(k)), 0, Math.PI * 2); ctx.stroke(); } }); }
  flash(o = {}) { return this.add({ t: 0, life: o.life || 150, draw: (ctx, k) => { ctx.globalAlpha = (o.alpha || 0.5) * (1 - k); ctx.fillStyle = o.color || '#fff'; ctx.fillRect(0, 0, this.w, this.h); } }); }
  glowSpot(x, y, o = {}) { const z = this.sz; return this.add({ t: 0, life: o.life || 400, draw: (ctx, k) => { const r = (o.r || 60) * z * (o.grow ? 0.3 + k : 1); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, o.color || '#fff'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = (o.alpha || 0.6) * Math.sin(k * Math.PI); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); } }); }
  bolt(x0, y0, x1, y1, o = {}) {
    const segs = o.segments || 12; let pts = []; let last = 0; const z = this.sz; o = { ...o, width: (o.width || 6) * z, jitter: (o.jitter || 18) * z };
    const gen = () => { pts = [[x0, y0]]; for (let i = 1; i < segs; i++) { const t = i / segs; const nx = lerp(x0, x1, t), ny = lerp(y0, y1, t); const j = (o.jitter || 18) * Math.sin(t * Math.PI); pts.push([nx + rnd(-j, j), ny + rnd(-j, j)]); } pts.push([x1, y1]); };
    gen();
    return this.add({ t: 0, life: o.life || 260, draw: (ctx, k) => { if (performance.now() - last > 45) { gen(); last = performance.now(); } ctx.globalAlpha = 1 - k * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowBlur = 18; ctx.shadowColor = o.color || '#ffe03a'; for (const [w, c] of [[(o.width || 6), o.color || '#ffe03a'], [(o.width || 6) * 0.4, '#fff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); } } });
  }
  beam(x0, y0, x1, y1, o = {}) {
    o = { ...o, width: (o.width || 22) * this.sz }; return this.add({ t: 0, life: o.life || 500, draw: (ctx, k) => { const grow = Math.min(1, k * 4); const ex = lerp(x0, x1, grow), ey = lerp(y0, y1, grow); const pulse = 1 + 0.15 * Math.sin(k * 40); ctx.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1; ctx.lineCap = 'round'; ctx.shadowBlur = 24; ctx.shadowColor = o.color || '#fff'; for (const [w, c] of [[(o.width || 22) * pulse, o.color || '#fff'], [(o.width || 22) * 0.45, o.core || '#fff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke(); } } });
  }
  slash(x, y, o = {}) { const len = (o.len || 90) * this.sz, ang = o.angle == null ? -0.6 : o.angle; o = { ...o, width: (o.width || 7) * this.sz }; return this.add({ t: 0, life: o.life || 260, draw: (ctx, k) => { const n = Math.min(1, k * 2.5); ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) * 2.5; ctx.strokeStyle = o.color || '#fff'; ctx.lineCap = 'round'; ctx.shadowBlur = 12; ctx.shadowColor = o.color || '#fff'; ctx.lineWidth = (o.width || 7) * (1 - k * 0.5); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.arc(0, len * 0.6, len, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 0.5 * n); ctx.stroke(); } }); }
  text(x, y, str, o = {}) { return this.add({ t: 0, life: o.life || 900, draw: (ctx, k) => { ctx.globalAlpha = k < 0.2 ? k * 5 : 1 - (k - 0.2) / 0.8; ctx.font = `900 ${Math.round((o.size || 34) * this.sz)}px "Bangers", "Impact", sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.fillStyle = o.color || '#fff'; const yy = y - k * 40; ctx.strokeText(str, x, yy); ctx.fillText(str, x, yy); } }); }
  /** Moving emitter: `path(t)` gives a point for t in 0..1 over `life` ms; `spawn(x,y)` makes particles. */
  emitter(o) { let acc = 0; return this.add({ t: 0, life: o.life || 500, draw: (ctx, k, dt) => { const p = o.path(ease(k)); acc += dt; const every = 1000 / (o.rate || 60); while (acc > every) { acc -= every; o.spawn(p.x, p.y, k); } if (o.head) o.head(ctx, p.x, p.y, k); } }); }
  /** Nudge a DOM element (the board or a card) for `ms`. */
  shake(el, ms = 400, amp = 6) { const t0 = performance.now(); const step = () => { const b = this.board; const k = (performance.now() - t0) / ms; if (k >= 1) { b.style.transform = ''; return; } const a = amp * (1 - k); b.style.transform = `translate(${rnd(-a, a)}px,${rnd(-a, a)}px)`; requestAnimationFrame(step); }; step(); }
  clear() { this.items = []; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
}

/* ---------- shared pieces ---------- */
function fireballPath(from, to, arcUp = 40) { return (t) => ({ x: lerp(from.cx, to.cx, t), y: lerp(from.cy, to.cy, t) - Math.sin(t * Math.PI) * arcUp }); }
let SZ = 1;
const head = (color, r0, glow) => (ctx, x, y) => { const r = r0 * SZ; ctx.globalAlpha = 1; ctx.shadowBlur = glow || 25; ctx.shadowColor = color; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill(); };
function fireball(fx, from, to, opts = {}) {
  const dur = opts.dur || 480; const C = PAL.Fire;
  fx.emitter({ life: dur, path: fireballPath(from, to, opts.arc == null ? 30 : opts.arc), rate: 220, head: head('#ff8a1f', opts.r || 15), spawn: (x, y) => fx.particle({ x: x + rnd(-8, 8), y: y + rnd(-8, 8), vx: rnd(-1.2, 1.2), vy: rnd(-2.4, -0.6), size: rnd(4, 10), color: pick(C), life: rnd(300, 520), glow: 12 }) });
  fx.at(dur, () => { fx.glowSpot(to.cx, to.cy, { color: '#ff9a1f', r: 90, life: 350 }); fx.burst(to.cx, to.cy, { n: opts.n || 44, colors: C, speed: 7, g: -0.08, drag: 0.93, size: 8, life: 700, glow: 10 }); for (let i = 0; i < 14; i++) fx.particle({ x: to.cx + rnd(-to.w / 2, to.w / 2), y: to.cy + rnd(0, to.h / 3), vy: rnd(-3, -1.2), vx: rnd(-0.4, 0.4), size: rnd(5, 11), color: pick(C), life: rnd(400, 800), glow: 12 }); });
  return dur;
}
function waterStream(fx, from, to, opts = {}) {
  const dur = opts.dur || 520; const C = PAL.Water;
  fx.emitter({ life: dur, path: fireballPath(from, to, 60), rate: opts.rate || 110, spawn: (x, y) => fx.particle({ x, y, vx: rnd(-1.2, 1.2), vy: rnd(-1, 1), g: 0.12, size: rnd(3, 6), color: pick(C), shape: 'drop', life: rnd(300, 520), glow: 6 }) });
  fx.at(dur, () => { fx.ring(to.cx, to.cy, { r0: 6, r1: 70, color: '#8fd6ff', width: 8, life: 450, glow: 10 }); fx.burst(to.cx, to.cy + 10, { n: opts.n || 30, colors: C, speed: 6, g: 0.18, size: 5, shape: 'drop', life: 700, lift: -3, glow: 6 }); });
  return dur;
}
function lightningStrike(fx, to, opts = {}) {
  const n = opts.bolts || 2; const top = opts.fromY == null ? -10 : opts.fromY;
  fx.flash({ life: 140, alpha: 0.45, color: '#fff8c0' });
  for (let i = 0; i < n; i++) fx.at(i * 90, () => { fx.bolt(to.cx + rnd(-80, 80), top, to.cx + rnd(-10, 10), to.cy, { life: 240, jitter: 22, width: 6 }); fx.burst(to.cx, to.cy, { n: 16, colors: PAL.Lightning, speed: 7, shape: 'spark', size: 4, life: 350, drag: 0.9 }); });
  fx.at(n * 90, () => { fx.glowSpot(to.cx, to.cy, { color: '#fff3a0', r: 80, life: 300 }); fx.burst(to.cx, to.cy, { n: 20, colors: PAL.Lightning, speed: 5, size: 4, life: 450, glow: 8 }); });
  return 120;
}

/* ---------- default animation per attacker type ---------- */
export const TYPE_FX = {
  Fire(fx, s) { const t = s.targets[0]; const impact = fireball(fx, s.from, t, {}); return { impact, done: impact + 700 }; },
  Water(fx, s) { const t = s.targets[0]; const impact = waterStream(fx, s.from, t); return { impact, done: impact + 700 }; },
  Lightning(fx, s) { const t = s.targets[0]; const impact = lightningStrike(fx, t); return { impact, done: 700 }; },
  Grass(fx, s) {
    const t = s.targets[0]; const C = PAL.Grass; const dur = 560;
    fx.emitter({ life: dur, path: fireballPath(s.from, t, 50), rate: 70, spawn: (x, y, k) => fx.particle({ x: x + rnd(-14, 14), y: y + rnd(-14, 14), vx: rnd(-1.5, 1.5), vy: rnd(-1.5, 1.5), size: rnd(4, 7), color: pick(C), shape: 'leaf', rot: rnd(0, 6.3), vr: rnd(-0.35, 0.35), life: rnd(300, 500), drag: 0.97 }) });
    fx.at(dur, () => { fx.glowSpot(t.cx, t.cy, { color: '#9fe86a', r: 80, life: 320 }); fx.burst(t.cx, t.cy, { n: 30, colors: C, speed: 5, shape: 'leaf', size: 6, life: 700, g: 0.05, drag: 0.96 }); });
    return { impact: dur, done: dur + 700 };
  },
  Psychic(fx, s) {
    const t = s.targets[0]; const C = PAL.Psychic;
    for (let i = 0; i < 3; i++) fx.at(i * 110, () => fx.ring(s.from.cx, s.from.cy, { r0: 10, r1: 70, color: C[2], width: 5, life: 420, glow: 14 }));
    const dur = 520;
    fx.emitter({ life: dur, path: fireballPath(s.from, t, 0), rate: 60, head: head(C[2], 9, 30), spawn: (x, y) => fx.particle({ x: x + rnd(-10, 10), y: y + rnd(-10, 10), size: rnd(2, 4), color: pick(C), shape: 'star', life: 400, glow: 12, vr: 0.2 }) });
    fx.at(dur, () => { fx.flash({ life: 220, alpha: 0.28, color: C[2] }); for (let i = 0; i < 3; i++) fx.at(i * 90, () => fx.ring(t.cx, t.cy, { r0: 90, r1: 8, color: C[1], width: 6, life: 380, glow: 16 })); fx.burst(t.cx, t.cy, { n: 24, colors: C, speed: 4, shape: 'star', size: 5, life: 600, glow: 10 }); });
    return { impact: dur, done: dur + 650 };
  },
  Fighting(fx, s) {
    const t = s.targets[0]; const C = PAL.Fighting; const impact = 260;
    fx.at(impact, () => { fx.shake(s.boardEl, 350, 7); fx.glowSpot(t.cx, t.cy, { color: '#fff1c0', r: 70, life: 220 }); fx.burst(t.cx, t.cy, { n: 26, colors: C, speed: 9, shape: 'shard', size: 7, life: 450, drag: 0.9 }); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; fx.particle({ x: t.cx + Math.cos(a) * 20, y: t.cy + Math.sin(a) * 20, vx: Math.cos(a) * 10, vy: Math.sin(a) * 10, shape: 'spark', size: 6, color: '#fff', life: 260 }); } fx.text(t.cx, t.cy - 30, pick(['POW!', 'WHAM!', 'SMACK!']), { color: '#ffd27a', size: 30 }); });
    return { impact, done: impact + 600 };
  },
  Colorless(fx, s) {
    const t = s.targets[0]; const C = PAL.Colorless; const impact = 300;
    fx.at(200, () => fx.slash(t.cx - 10, t.cy - 10, { angle: -0.7, len: 70 }));
    fx.at(impact, () => { fx.slash(t.cx + 10, t.cy - 6, { angle: 0.8, len: 70 }); fx.burst(t.cx, t.cy, { n: 18, colors: C, speed: 5, size: 5, life: 500, drag: 0.92 }); });
    return { impact, done: impact + 500 };
  },
};

/* ---------- signature moves (keyed by attack name, or 'cardId|Attack Name') ---------- */
export const MOVE_FX = {
  // Charizard's own Fire Spin: charge-up, roar, flame stream with spiralling ribbons, fire tornado, white-out.
  'base1-4|Fire Spin'(fx, s) {
    const f = s.from, t = s.targets[0]; const C = PAL.Fire; const b = s.boardEl;
    if (s.fromEl) { s.fromEl.classList.add('charge'); fx.at(700, () => s.fromEl.classList.remove('charge')); }
    // the table dims for the whole thing
    fx.add({ t: 0, life: 2900, draw: (ctx, k) => { const env = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1; ctx.globalAlpha = 0.5 * env; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, fx.w, fx.h); } });
    // 1. charge: embers get pulled into Charizard
    fx.glowSpot(f.cx, f.cy, { color: '#ff6a00', r: 130, life: 700, grow: true, alpha: 0.8 });
    fx.emitter({ life: 560, path: () => ({ x: f.cx, y: f.cy }), rate: 170, spawn: (x, y) => { const a = rnd(0, 6.3), r = rnd(70, 150); fx.particle({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * r / 18, vy: -Math.sin(a) * r / 18, size: rnd(3, 6), color: pick(C), life: 300, glow: 10, shrink: false }); } });
    // 2. roar
    fx.at(600, () => { fx.flash({ life: 240, alpha: 0.55, color: '#ff9a1f' }); fx.shake(b, 1700, 6); fx.ring(f.cx, f.cy, { r0: 10, r1: 170, color: '#ffb347', width: 10, life: 420, glow: 20 }); fx.text(fx.w / 2, fx.h / 2 - 10, 'FIRE SPIN!', { size: 46, color: '#ffd27a', life: 1200 }); });
    // 3. flame stream with two ribbons spiralling around it
    const dx = t.cx - f.cx, dy = t.cy - f.cy, L = Math.hypot(dx, dy) || 1, px = -dy / L, py = dx / L;
    fx.at(640, () => {
      fx.beam(f.cx, f.cy, t.cx, t.cy, { life: 760, width: 44, color: '#ff7a1f', core: '#fff3c0' });
      fx.add({ t: 0, life: 760, draw: () => { for (let i = 0; i < 7; i++) { const u = Math.random(); const ph = u * 16 + performance.now() / 60; const off = 36 * Math.sin(ph) * (i % 2 ? 1 : -1); fx.particle({ x: f.cx + dx * u + px * off, y: f.cy + dy * u + py * off, vx: px * Math.cos(ph) * 2 + rnd(-1, 1), vy: -1.5 + rnd(-1, 1), size: rnd(5, 11), color: pick(C), life: rnd(240, 420), glow: 12 }); } } });
    });
    // 4. impact and fire tornado around the defender
    fx.at(1300, () => {
      fx.flash({ life: 200, alpha: 0.45, color: '#fff' }); fx.glowSpot(t.cx, t.cy, { color: '#ff9a1f', r: 180, life: 1000, alpha: 0.8 });
      fx.burst(t.cx, t.cy, { n: 70, colors: C, speed: 10, g: -0.1, size: 9, life: 900, glow: 10 });
      for (let i = 0; i < 4; i++) fx.at(i * 120, () => fx.ring(t.cx, t.cy, { r0: 10, r1: 150, color: pick(C), width: 9, life: 520, glow: 16 }));
      fx.add({ t: 0, life: 900, draw: (ctx, k) => { for (let i = 0; i < 5; i++) { const a = k * 30 + i * 1.26; const r = 90 * (1 - k * 0.3); fx.particle({ x: t.cx + Math.cos(a) * r, y: t.cy + Math.sin(a) * r * 0.55 - k * 110 + rnd(-30, 30), vx: -Math.sin(a) * 2.5, vy: -2.5, size: rnd(6, 13), color: pick(C), life: 420, glow: 14 }); } } });
    });
    // 5. white-out explosion and smoke
    fx.at(2200, () => { fx.flash({ life: 380, alpha: 0.9, color: '#fff' }); fx.shake(b, 550, 12); fx.ring(t.cx, t.cy, { r0: 20, r1: 320, color: '#ffd27a', width: 24, life: 700, glow: 24 }); fx.burst(t.cx, t.cy, { n: 100, colors: C.concat(['#fff']), speed: 14, size: 10, life: 1100, glow: 10, drag: 0.94 }); for (let i = 0; i < 26; i++) fx.particle({ x: t.cx + rnd(-60, 60), y: t.cy + rnd(-20, 40), vx: rnd(-0.6, 0.6), vy: rnd(-1.8, -0.6), size: rnd(10, 22), color: pick(['#444', '#666', '#888']), life: rnd(900, 1500), alpha: 0.6, fadeIn: 200 }); });
    return { impact: 1300, done: 3300 };
  },
  'Fire Spin'(fx, s) {
    const t = s.targets[0]; const C = PAL.Fire; const dur = 900;
    fireball(fx, s.from, t, { dur: 380, n: 10, r: 11 });
    fx.at(380, () => fx.add({ t: 0, life: dur - 380, draw: (ctx, k, dt) => { for (let i = 0; i < 4; i++) { const a = k * 22 + i * 1.57; const r = 70 * (1 - k * 0.5); fx.particle({ x: t.cx + Math.cos(a) * r, y: t.cy + Math.sin(a) * r * 0.6, vx: -Math.sin(a) * 2, vy: -1.8, size: rnd(5, 10), color: pick(C), life: 380, glow: 12 }); } } }));
    fx.at(dur, () => { fx.shake(s.boardEl, 400, 6); fx.flash({ life: 200, alpha: 0.35, color: '#ff9a1f' }); fx.glowSpot(t.cx, t.cy, { color: '#ffb347', r: 130, life: 450 }); fx.burst(t.cx, t.cy, { n: 60, colors: C, speed: 9, g: -0.08, size: 8, life: 800, glow: 10 }); });
    return { impact: dur, done: dur + 800 };
  },
  'Fire Blast'(fx, s) {
    const t = s.targets[0]; const C = PAL.Fire; fireball(fx, s.from, t, { dur: 420, n: 10 });
    fx.at(420, () => { fx.flash({ life: 160, alpha: 0.3, color: '#ff9a1f' }); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * Math.PI * 2; fx.emitter({ life: 420, path: (k) => ({ x: t.cx + Math.cos(a) * 110 * k, y: t.cy + Math.sin(a) * 110 * k }), rate: 120, spawn: (x, y) => fx.particle({ x, y, vx: rnd(-1, 1), vy: rnd(-2, -0.5), size: rnd(5, 10), color: pick(C), life: 400, glow: 12 }) }); } fx.burst(t.cx, t.cy, { n: 40, colors: C, speed: 5, size: 7, life: 700, glow: 10 }); });
    return { impact: 420, done: 1100 };
  },
  Flamethrower(fx, s) {
    const t = s.targets[0]; const C = PAL.Fire; const dur = 700;
    fx.emitter({ life: dur, path: () => ({ x: s.from.cx, y: s.from.cy }), rate: 220, spawn: (x, y) => { const k = rnd(0, 1); fx.particle({ x: lerp(s.from.cx, t.cx, 0.05), y: lerp(s.from.cy, t.cy, 0.05), vx: (t.cx - s.from.cx) / 22 + rnd(-1.5, 1.5), vy: (t.cy - s.from.cy) / 22 + rnd(-1.5, 1.5), size: rnd(5, 12), color: pick(C), life: rnd(300, 420), glow: 12, drag: 0.995 }); } });
    fx.at(260, () => { fx.glowSpot(t.cx, t.cy, { color: '#ff9a1f', r: 100, life: 500 }); fx.burst(t.cx, t.cy, { n: 30, colors: C, speed: 5, g: -0.08, size: 7, life: 600, glow: 8 }); });
    return { impact: 300, done: dur + 400 };
  },
  Thunder(fx, s) { const t = s.targets[0]; lightningStrike(fx, t, { bolts: 4 }); fx.at(120, () => fx.shake(s.boardEl, 500, 8)); fx.at(200, () => fx.flash({ life: 220, alpha: 0.5, color: '#fff8c0' })); return { impact: 180, done: 900 }; },
  Thunderbolt(fx, s) { const t = s.targets[0]; fx.bolt(s.from.cx, s.from.cy, t.cx, t.cy, { life: 320, jitter: 26, width: 8 }); fx.at(60, () => fx.bolt(s.from.cx, s.from.cy, t.cx, t.cy, { life: 300, jitter: 30, width: 5 })); lightningStrike(fx, t, { bolts: 2 }); fx.at(120, () => fx.shake(s.boardEl, 350, 6)); return { impact: 150, done: 800 }; },
  'Hydro Pump'(fx, s) { const t = s.targets[0]; const C = PAL.Water; fx.beam(s.from.cx, s.from.cy, t.cx, t.cy, { life: 650, width: 30, color: '#4fb0ff', core: '#e8f7ff' }); fx.emitter({ life: 650, path: () => ({ x: t.cx, y: t.cy }), rate: 160, spawn: (x, y) => fx.particle({ x, y, vx: rnd(-6, 6), vy: rnd(-7, 1), g: 0.25, size: rnd(3, 7), color: pick(C), shape: 'drop', life: 600, glow: 6 }) }); fx.at(180, () => { fx.shake(s.boardEl, 500, 5); fx.ring(t.cx, t.cy, { r0: 10, r1: 110, color: '#bfe9ff', width: 10, life: 600, glow: 12 }); }); return { impact: 200, done: 1000 }; },
  Blizzard(fx, s) {
    const t = s.targets[0]; const C = PAL.Water; const dur = 900;
    fx.emitter({ life: dur, path: () => ({ x: t.cx, y: t.cy - 140 }), rate: 130, spawn: (x, y) => fx.particle({ x: x + rnd(-120, 120), y: y + rnd(-20, 20), vx: rnd(-2.5, -0.5), vy: rnd(2, 4), size: rnd(3, 6), color: pick(['#fff', '#dff4ff', '#bfe9ff']), shape: 'flake', life: 700, vr: 0.1 }) });
    fx.at(350, () => { fx.flash({ life: 300, alpha: 0.3, color: '#dff4ff' }); fx.burst(t.cx, t.cy, { n: 30, colors: C, speed: 7, shape: 'shard', size: 7, life: 700, drag: 0.93 }); fx.ring(t.cx, t.cy, { r0: 10, r1: 100, color: '#e6f7ff', width: 8, life: 500 }); });
    return { impact: 350, done: dur + 300 };
  },
  Solarbeam(fx, s) { return MOVE_FX['Solar Beam'](fx, s); },
  'Solar Beam'(fx, s) {
    const t = s.targets[0]; const dur = 520;
    fx.emitter({ life: dur, path: () => ({ x: s.from.cx, y: s.from.cy }), rate: 90, spawn: (x, y) => { const a = rnd(0, 6.3), r = rnd(50, 90); fx.particle({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * r / 25, vy: -Math.sin(a) * r / 25, size: rnd(2, 5), color: pick(['#fff9c0', '#ffe66a', '#c8ff6a']), life: 420, glow: 10, shrink: false }); } });
    fx.at(dur, () => { fx.flash({ life: 180, alpha: 0.4, color: '#fff9c0' }); fx.beam(s.from.cx, s.from.cy, t.cx, t.cy, { life: 520, width: 34, color: '#b8ff5a', core: '#ffffe0' }); fx.shake(s.boardEl, 450, 6); fx.at(120, () => fx.burst(t.cx, t.cy, { n: 40, colors: ['#fff9c0', '#d9ff9a', '#8fe05a'], speed: 7, size: 6, life: 700, glow: 10 })); });
    return { impact: dur + 120, done: dur + 900 };
  },
  'Hyper Beam'(fx, s) { const t = s.targets[0]; fx.glowSpot(s.from.cx, s.from.cy, { color: '#ffb347', r: 70, life: 400, grow: true }); fx.at(380, () => { fx.flash({ life: 200, alpha: 0.45, color: '#fff' }); fx.beam(s.from.cx, s.from.cy, t.cx, t.cy, { life: 600, width: 40, color: '#ff9a3a', core: '#fff' }); fx.shake(s.boardEl, 600, 9); fx.at(100, () => fx.burst(t.cx, t.cy, { n: 50, colors: PAL.Fire, speed: 9, size: 7, life: 800, glow: 10 })); }); return { impact: 480, done: 1200 }; },
  Psychic(fx, s) { const t = s.targets[0]; const C = PAL.Psychic; fx.flash({ life: 500, alpha: 0.3, color: C[3] }); for (let i = 0; i < 5; i++) fx.at(i * 80, () => fx.ring(t.cx, t.cy, { r0: 140, r1: 6, color: pick(C), width: 7, life: 450, glow: 18 })); fx.at(380, () => { fx.shake(s.boardEl, 350, 4); fx.burst(t.cx, t.cy, { n: 40, colors: C, speed: 6, shape: 'star', size: 6, life: 700, glow: 12 }); }); return { impact: 380, done: 1000 }; },
  Earthquake(fx, s) { fx.shake(s.boardEl, 900, 10); for (let i = 0; i < 6; i++) fx.at(i * 120, () => { for (const t of s.targets) fx.burst(t.cx + rnd(-t.w / 2, t.w / 2), t.cy + t.h / 2, { n: 10, colors: ['#c9a06a', '#9a7347', '#6b4f2e'], speed: 4, lift: -4, g: 0.15, size: 6, life: 600 }); }); return { impact: 300, done: 1100 }; },
  Selfdestruct(fx, s) { return MOVE_FX.Explosion(fx, s); },
  'Self-destruct'(fx, s) { return MOVE_FX.Explosion(fx, s); },
  'Big Explosion'(fx, s) { return MOVE_FX.Explosion(fx, s); },
  Explosion(fx, s) { const f = s.from; fx.glowSpot(f.cx, f.cy, { color: '#fff', r: 60, life: 300, grow: true }); fx.at(280, () => { fx.flash({ life: 350, alpha: 0.8, color: '#fff' }); fx.shake(s.boardEl, 800, 12); fx.ring(f.cx, f.cy, { r0: 10, r1: Math.max(s.board.w, s.board.h), color: '#ffb347', width: 30, life: 700, glow: 20 }); fx.burst(f.cx, f.cy, { n: 90, colors: PAL.Fire.concat(['#fff']), speed: 14, size: 9, life: 1000, glow: 10, drag: 0.94 }); }); return { impact: 330, done: 1300 }; },
  'Seismic Toss'(fx, s) { const t = s.targets[0]; fx.emitter({ life: 520, path: (k) => ({ x: lerp(s.from.cx, t.cx, k), y: lerp(s.from.cy, t.cy, k) - Math.sin(k * Math.PI) * 160 }), rate: 50, head: (ctx, x, y) => { ctx.globalAlpha = 0.8; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y, 22, 14, 0, 0, 6.3); ctx.fill(); }, spawn: (x, y) => fx.particle({ x, y, size: 3, color: '#fff', life: 200 }) }); fx.at(520, () => { fx.shake(s.boardEl, 500, 10); fx.burst(t.cx, t.cy, { n: 36, colors: PAL.Fighting, speed: 9, shape: 'shard', size: 7, life: 500 }); fx.text(t.cx, t.cy - 30, 'SLAM!', { color: '#ffd27a', size: 32 }); }); return { impact: 520, done: 1100 }; },
};

/* ---------- plain physical moves (Scratch, Tackle...) ---------- */
// A physical-sounding attack name plays a basic hit instead of the attacker's type effect, unless it has a signature entry.
const CLAW_WORDS = /\b(scratch|slash|claw|claws|cut|swipe|swipes|fury swipes|rake|shred)\b/i;
const PHYSICAL_WORDS = /\b(tackle|pound|bite|slam|headbutt|quick attack|peck|wing attack|fury attack|double kick|jab|punch|kick|horn attack|stomp|body slam|take down|double-edge|lick|gnaw|rage|thrash|karate chop|low kick|ram|lunge|sting|tail slap|flail|wrap|bind|clamp|crabhammer|vicegrip|vice grip|skull bash|hyper fang|super fang|drill peck|leek slap|pot smash|horn drill|rapid spin|rollout|dizzy punch|cross chop|submission|counter|strength|smack|headlock|lariat|ambush|rend|chop|strike|attack|hit|press|crush|squeeze|whip|hook|toss|throw|charge|tail|horn|fang|beak|needle|stab|collapse|retaliate|retaliation)\b/i;
const ELEMENTAL_WORDS = /\b(fire|flame|flames|thunder|lightning|electric|electro|shock|spark|ice|icy|frost|blizzard|water|hydro|aqua|bubble|psy|psychic|psyshot|mind|dream|night|shadow|leaf|razor leaf|vine|solar|blaze|burn|heat|lava|magma|poison|toxic|sludge|acid|gas|smog|powder|spore|hypno|confuse|mystic|magic|curse|rock|stone|earth|quake|sand|mud)\b/i;
export function physicalKind(name) {
  if (!name || ELEMENTAL_WORDS.test(name)) return null;
  if (CLAW_WORDS.test(name)) return 'claw';
  if (PHYSICAL_WORDS.test(name)) return 'thump';
  return null;
}
export const BASIC_FX = {
  claw(fx, s) {
    const t = s.targets[0]; const impact = 220;
    [-1, 0, 1].forEach((i, n) => fx.at(impact + n * 45, () => fx.slash(t.cx + i * 16 - 6, t.cy - 14 + i * 4, { angle: -0.85, len: 50, width: 5, color: '#ffffff', life: 300 })));
    fx.at(impact, () => fx.burst(t.cx, t.cy, { n: 8, colors: ['#ffffff', '#dddddd', '#aaaaaa'], speed: 3, size: 3, life: 350, drag: 0.9 }));
    return { impact, done: impact + 420 };
  },
  thump(fx, s) {
    const t = s.targets[0]; const impact = 230;
    fx.at(impact, () => { fx.ring(t.cx, t.cy, { r0: 4, r1: 34, color: '#ffffff', width: 4, life: 260, alpha: 0.7 }); fx.burst(t.cx, t.cy + 6, { n: 10, colors: ['#ffffff', '#e6e6e6', '#bdbdbd'], speed: 3.5, size: 3, life: 380, drag: 0.9, g: 0.05 }); });
    return { impact, done: impact + 420 };
  },
};
/** Which animation a scene resolves to: { fn, key, label } */
export function resolveFx(scene) {
  const byCard = `${scene.cardId}|${scene.name}`;
  if (MOVE_FX[byCard]) return { fn: MOVE_FX[byCard], key: byCard, label: 'card-specific ' + byCard };
  if (MOVE_FX[scene.name]) return { fn: MOVE_FX[scene.name], key: scene.name, label: 'signature move ' + scene.name };
  const kind = physicalKind(scene.name); if (kind) return { fn: BASIC_FX[kind], key: 'basic:' + kind, label: 'basic physical hit (' + kind + ')' };
  const type = TYPE_FX[scene.type] ? scene.type : 'Colorless'; return { fn: TYPE_FX[type], key: 'type:' + type, label: 'type default ' + type };
}

/* ---------- entry points ---------- */
let LAYER = null;
/** Keep the (single) canvas on the current board element; call after every re-render so running animations stay visible. */
export function attachLayer(board) { if (board) layerFor(board); }
function layerFor(board) { if (!LAYER) LAYER = new Layer(board); else if (LAYER.board !== board) { LAYER.board = board; board.appendChild(LAYER.canvas); LAYER.resize(); } return LAYER; }

/** Play the attack described by `scene` on `boardEl`. Resolves timings {impact, done} immediately. */
export function playAttack(boardEl, scene) {
  const res = resolveFx(scene);
  if (!isEnabled() || !boardEl || !scene.from || !scene.targets.length) { sfx.attack(res.key, scene.type, { impact: 300 }); return { impact: 300, done: 600 }; }
  const fx = layerFor(boardEl); scene.boardEl = boardEl; scene.board = { w: fx.w, h: fx.h };
  SZ = fx.sz = Math.max(0.9, Math.min(2.4, (scene.targets[0].w || 100) / 62)); // effects scale with the card size on screen
  const anim = res.fn;
  // wind-up: the attacker card jiggles
  if (scene.fromEl) { scene.fromEl.classList.add('windup'); setTimeout(() => scene.fromEl.classList.remove('windup'), 450); }
  let times; try { times = anim(fx, scene) || { impact: 300, done: 800 }; } catch (e) { console.warn('fx failed', e); times = { impact: 0, done: 0 }; }
  sfx.attack(res.key, scene.type, times);
  // secondary targets (bench hits) get a small puff at impact
  for (const t of scene.targets.slice(1)) fx.at(times.impact, () => fx.burst(t.cx, t.cy, { n: 12, colors: PAL[scene.type] || PAL.Colorless, speed: 4, size: 5, life: 450 }));
  return times;
}
export function playTurnChime() { sfx.play('turn'); }
export function playKO(boardEl, rect) { sfx.play('ko'); if (!isEnabled() || !boardEl || !rect) return; const fx = layerFor(boardEl); fx.burst(rect.cx, rect.cy, { n: 30, colors: ['#222', '#555', '#999', '#fff'], speed: 7, size: 6, life: 700, g: 0.1 }); fx.ring(rect.cx, rect.cy, { r0: 10, r1: 90, color: '#fff', width: 4, life: 400 }); fx.text(rect.cx, rect.cy - 20, 'KO', { color: '#ff5a5a', size: 40, life: 1100 }); }
export function playHeal(boardEl, rect) { sfx.play('heal'); if (!isEnabled() || !boardEl || !rect) return; const fx = layerFor(boardEl); for (let i = 0; i < 16; i++) fx.particle({ x: rect.cx + rnd(-rect.w / 2, rect.w / 2), y: rect.cy + rnd(-rect.h / 3, rect.h / 3), vy: rnd(-1.6, -0.6), size: rnd(2, 5), color: pick(['#c6ffd0', '#7ae58a', '#fff']), shape: 'star', life: rnd(500, 900), glow: 8, vr: 0.1 }); }
export function playSelfHit(boardEl, rect) { sfx.play('self'); if (!isEnabled() || !boardEl || !rect) return; const fx = layerFor(boardEl); fx.burst(rect.cx, rect.cy, { n: 16, colors: ['#ff5a5a', '#ffb0b0', '#fff'], speed: 5, size: 5, life: 500 }); }
/** A Confused attack that failed: ??? swirl around the attacker, then the "huh?" sound. Returns ms until the self-hit lands. */
export function playConfused(boardEl, rect) {
  if (!boardEl || !rect) { sfx.play('confused'); return 0; }
  if (!isEnabled()) { sfx.play('confused'); return 300; }
  const n = 6;
  for (let i = 0; i < n; i++) {
    const q = document.createElement('div'); q.className = 'confq'; q.textContent = '?';
    const a = (i / n) * Math.PI * 2, r = Math.max(rect.w, rect.h) * 0.55;
    q.style.left = `${rect.cx + Math.cos(a) * r * 0.6}px`; q.style.top = `${rect.cy + Math.sin(a) * r * 0.6}px`;
    q.style.setProperty('--dx', `${Math.cos(a + 1.4) * r * 0.5}px`); q.style.setProperty('--dy', `${Math.sin(a + 1.4) * r * 0.5 - 12}px`);
    q.style.setProperty('--rot', `${(i % 2 ? 1 : -1) * 35}deg`); q.style.animationDelay = `${i * 70}ms`;
    q.style.fontSize = `${Math.max(16, Math.round(rect.w * 0.28))}px`;
    boardEl.appendChild(q); setTimeout(() => q.remove(), 1400);
  }
  setTimeout(() => sfx.play('confused'), 450);
  return 1000;
}
/** End of game: confetti over the whole board, a banner with the winner's name, and the fanfare. */
export function playWin(boardEl, name, opts = {}) {
  if (!opts.quiet) sfx.play('win'); // quiet when a victory track is playing instead if (!isEnabled() || !boardEl) return;
  const fx = layerFor(boardEl); fx.sz = 1; const C = ['#ffcb05', '#ff5a5a', '#4fb0ff', '#7ae58a', '#e58bff', '#ffffff'];
  for (let i = 0; i < 24; i++) fx.at(i * 120, () => { for (let k = 0; k < 10; k++) fx.particle({ x: rnd(0, fx.w), y: -10, vx: rnd(-1, 1), vy: rnd(1.5, 3.5), g: 0.04, drag: 0.995, size: rnd(4, 8), color: pick(C), shape: 'rect', rot: rnd(0, 6.3), vr: rnd(-0.25, 0.25), life: rnd(2200, 3200), shrink: false }); });
  fx.at(300, () => { fx.flash({ life: 300, alpha: 0.35, color: '#fff' }); fx.burst(fx.w / 2, fx.h / 2, { n: 80, colors: C, speed: 12, size: 7, shape: 'rect', life: 1500, g: 0.08, drag: 0.96 }); });
  const old = boardEl.querySelector('.winbanner'); if (old) old.remove();
  const el = document.createElement('div'); el.className = 'winbanner'; el.innerHTML = `<div class="wb-name">${String(name).replace(/[<>&]/g, '')}</div><div class="wb-wins">WINS!</div>`; boardEl.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
/** Spinning coin(s) in the middle of the board; returns the ms it takes. */
export function playCoins(boardEl, results) {
  results.slice(0, 6).forEach((h, i) => sfx.play('coin', i * 150, h));
  if (!isEnabled() || !boardEl || !results.length) return 0; const fx = layerFor(boardEl); const n = Math.min(results.length, 6); const dur = 650;
  results.slice(0, n).forEach((heads, i) => { const x = fx.w / 2 + (i - (n - 1) / 2) * 56, y = fx.h / 2; fx.add({ t: 0, life: dur + 500, draw: (ctx, k) => { const kk = Math.min(1, (k * (dur + 500)) / dur); const spin = Math.cos(kk * Math.PI * 6) * (1 - kk) + (kk >= 1 ? 1 : 0); const sx = Math.max(0.08, Math.abs(spin) || 0.08); const lift = Math.sin(kk * Math.PI) * 50; ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1; ctx.translate(x, y - lift); ctx.scale(sx, 1); ctx.fillStyle = kk >= 1 ? (heads ? '#ffd84a' : '#9aa0b0') : '#e0c25a'; ctx.shadowBlur = 10; ctx.shadowColor = '#000'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.3); ctx.fill(); ctx.scale(1 / sx, 1); if (kk >= 1) { ctx.fillStyle = '#222'; ctx.font = '900 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(heads ? 'H' : 'T', 0, 1); } } }); });
  return dur;
}
