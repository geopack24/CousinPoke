// Procedural sound effects (Web Audio): nothing recorded, everything synthesised, so there is no copyrighted audio.
// play(name, delayMs) schedules a named effect. Browsers only allow audio after the user has interacted with the page,
// so the context is created on the first click or key press and effects before that are skipped silently.

let ctx = null, master = null;
let volume = (() => { try { const v = localStorage.getItem('pt_sfx'); return v == null ? 0.6 : v === 'off' ? 0 : +v; } catch (e) { return 0.6; } })();
export const getVolume = () => volume;
export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); try { localStorage.setItem('pt_sfx', String(volume)); } catch (e) { /* ignore */ } if (master) master.gain.value = volume; }
export const isOn = () => volume > 0;

function unlock() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination); } catch (e) { return; } } if (ctx.state === 'suspended') ctx.resume(); }
if (typeof window !== 'undefined') for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });

const rnd = (a, b) => a + Math.random() * (b - a);
let noiseBuf = null;
function noiseBuffer() { if (noiseBuf) return noiseBuf; const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return noiseBuf; }

/** Oscillator note. o: {type, f, to (slide target), dur, a (attack), g (gain), lfo:{f, depth}, filter:{type,f}, shape (distortion amount)} */
function tone(t0, o) {
  const osc = ctx.createOscillator(); osc.type = o.type || 'square'; osc.frequency.setValueAtTime(o.f, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  const g = ctx.createGain(); const a = o.a || 0.005; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.g || 0.2, t0 + a); g.gain.setValueAtTime(o.g || 0.2, t0 + Math.max(a, o.dur * (o.hold || 0.3))); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let node = osc;
  if (o.lfo) { const l = ctx.createOscillator(); l.frequency.value = o.lfo.f; const lg = ctx.createGain(); lg.gain.value = o.lfo.depth; l.connect(lg); lg.connect(osc.frequency); l.start(t0); l.stop(t0 + o.dur + 0.05); }
  if (o.shape) { const ws = ctx.createWaveShaper(); const k = o.shape, n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); } ws.curve = c; node.connect(ws); node = ws; }
  if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter.type || 'lowpass'; f.frequency.value = o.filter.f; node.connect(f); node = f; }
  node.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + o.dur + 0.05);
}
/** Filtered noise burst. o: {dur, g, type (filter), f, to (filter sweep target), q, a} */
function noise(t0, o) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q || 1; f.frequency.setValueAtTime(o.f || 1000, t0); if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  const g = ctx.createGain(); const a = o.a || 0.01; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.g || 0.3, t0 + a); g.gain.setValueAtTime(o.g || 0.3, t0 + Math.max(a, o.dur * (o.hold || 0.2))); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + o.dur + 0.05);
}
const arp = (t0, notes, step, o) => notes.forEach((f, i) => tone(t0 + i * step, { type: 'square', f, dur: step * 1.6, g: 0.12, ...o }));

/* ---------- the effects ---------- */
const FX = {
  windup: (t) => tone(t, { type: 'square', f: 220, to: 520, dur: 0.14, g: 0.08 }),
  'fire.launch': (t) => { noise(t, { dur: 0.5, f: 300, to: 1600, g: 0.25, q: 0.8 }); tone(t, { type: 'sawtooth', f: 90, to: 160, dur: 0.45, g: 0.06, filter: { f: 600 } }); },
  'fire.impact': (t) => { noise(t, { dur: 0.45, type: 'lowpass', f: 900, to: 200, g: 0.5 }); tone(t, { type: 'sine', f: 130, to: 40, dur: 0.4, g: 0.4 }); noise(t + 0.1, { dur: 0.6, f: 2500, g: 0.08, q: 0.5 }); },
  'water.launch': (t) => { for (let i = 0; i < 6; i++) tone(t + i * 0.07, { type: 'sine', f: rnd(500, 900), to: rnd(900, 1400), dur: 0.09, g: 0.08 }); noise(t, { dur: 0.5, type: 'highpass', f: 2000, g: 0.08 }); },
  'water.impact': (t) => { noise(t, { dur: 0.5, f: 1800, to: 500, g: 0.35, q: 0.7 }); for (let i = 0; i < 4; i++) tone(t + 0.1 + i * 0.08, { type: 'sine', f: rnd(700, 1200), to: rnd(1200, 1800), dur: 0.08, g: 0.06 }); },
  'lightning.launch': (t) => { for (let i = 0; i < 8; i++) tone(t + i * 0.03, { type: 'sawtooth', f: rnd(1200, 2600), dur: 0.04, g: 0.1 }); noise(t, { dur: 0.3, type: 'highpass', f: 3000, g: 0.25 }); },
  'lightning.impact': (t) => { noise(t, { dur: 0.6, type: 'lowpass', f: 400, to: 80, g: 0.5 }); tone(t, { type: 'sine', f: 70, to: 35, dur: 0.5, g: 0.35 }); for (let i = 0; i < 5; i++) tone(t + i * 0.05, { type: 'square', f: rnd(2000, 4000), dur: 0.04, g: 0.07 }); },
  'grass.launch': (t) => { for (let i = 0; i < 5; i++) noise(t + i * 0.09, { dur: 0.1, f: rnd(2500, 4000), g: 0.15, q: 2 }); },
  'grass.impact': (t) => { noise(t, { dur: 0.25, f: 1200, to: 300, g: 0.3 }); tone(t, { type: 'triangle', f: 220, to: 110, dur: 0.2, g: 0.2 }); },
  'psychic.launch': (t) => { tone(t, { type: 'sine', f: 440, to: 880, dur: 0.5, g: 0.12, lfo: { f: 8, depth: 30 } }); tone(t, { type: 'triangle', f: 554, to: 1108, dur: 0.5, g: 0.06, lfo: { f: 6, depth: 20 } }); },
  'psychic.impact': (t) => { tone(t, { type: 'sine', f: 1400, to: 150, dur: 0.5, g: 0.25 }); tone(t + 0.05, { type: 'square', f: 700, to: 90, dur: 0.45, g: 0.07 }); },
  'fighting.impact': (t) => { noise(t, { dur: 0.12, type: 'lowpass', f: 700, g: 0.5, a: 0.003 }); tone(t, { type: 'sine', f: 170, to: 50, dur: 0.18, g: 0.45, a: 0.003 }); },
  'colorless.impact': (t) => { noise(t, { dur: 0.08, f: 2500, to: 1200, g: 0.3, q: 1.5, a: 0.003 }); noise(t + 0.12, { dur: 0.08, f: 2200, to: 1000, g: 0.3, q: 1.5, a: 0.003 }); },
  claw: (t) => { for (let i = 0; i < 3; i++) noise(t + i * 0.05, { dur: 0.07, type: 'highpass', f: 2500, to: 1200, g: 0.3, a: 0.002 }); },
  thump: (t) => { noise(t, { dur: 0.09, type: 'lowpass', f: 500, g: 0.35, a: 0.003 }); tone(t, { type: 'sine', f: 140, to: 60, dur: 0.14, g: 0.3, a: 0.003 }); },
  coin: (t, heads) => { for (let i = 0; i < 6; i++) tone(t + i * 0.08, { type: 'triangle', f: 2200 + (i % 2) * 400, dur: 0.06, g: 0.08 }); tone(t + 0.55, { type: 'square', f: heads ? 1319 : 440, dur: 0.25, g: 0.15 }); if (heads) tone(t + 0.62, { type: 'square', f: 1760, dur: 0.25, g: 0.12 }); },
  ko: (t) => { arp(t, [660, 550, 440, 330, 220], 0.1, { type: 'square', g: 0.14 }); noise(t, { dur: 0.5, type: 'lowpass', f: 1500, to: 200, g: 0.3 }); },
  heal: (t) => arp(t, [523, 659, 784, 1047, 1319], 0.07, { type: 'sine', g: 0.14 }),
  self: (t) => { noise(t, { dur: 0.15, type: 'lowpass', f: 400, g: 0.3 }); tone(t, { type: 'square', f: 200, to: 80, dur: 0.2, g: 0.1 }); },
  win: (t) => arp(t, [523, 659, 784, 1047, 784, 1047, 1319], 0.11, { type: 'square', g: 0.14 }),
  // Charizard's Fire Spin: charge, roar, stream, tornado, blast
  'firespin.charge': (t) => { tone(t, { type: 'sawtooth', f: 50, to: 220, dur: 0.6, g: 0.18, filter: { f: 900 }, shape: 8 }); noise(t, { dur: 0.6, type: 'highpass', f: 4000, to: 800, g: 0.12 }); },
  'firespin.roar': (t) => { tone(t, { type: 'sawtooth', f: 180, to: 90, dur: 0.6, g: 0.3, shape: 20, filter: { f: 1200 }, lfo: { f: 30, depth: 25 } }); noise(t, { dur: 0.3, type: 'lowpass', f: 300, g: 0.5 }); },
  'firespin.stream': (t) => { noise(t, { dur: 0.8, f: 500, g: 0.35, q: 0.6, hold: 0.8 }); tone(t, { type: 'sawtooth', f: 110, dur: 0.8, g: 0.1, hold: 0.8, filter: { f: 500 }, lfo: { f: 14, depth: 15 } }); },
  'firespin.tornado': (t) => { noise(t, { dur: 0.9, f: 900, to: 2200, g: 0.3, q: 1.2, hold: 0.7 }); tone(t, { type: 'square', f: 330, to: 990, dur: 0.9, g: 0.06, lfo: { f: 20, depth: 60 } }); tone(t, { type: 'sine', f: 90, to: 60, dur: 0.9, g: 0.3, hold: 0.8 }); },
  'firespin.blast': (t) => { noise(t, { dur: 1.2, type: 'lowpass', f: 1200, to: 100, g: 0.7, hold: 0.25 }); tone(t, { type: 'sine', f: 60, to: 30, dur: 1.0, g: 0.5 }); noise(t + 0.3, { dur: 1.0, type: 'highpass', f: 3000, g: 0.06 }); },
};

/** Schedule a named effect `delayMs` from now. Extra args pass through (coin heads/tails). */
export function play(name, delayMs = 0, ...args) {
  if (!ctx || !isOn() || ctx.state !== 'running') return;
  const f = FX[name]; if (!f) return;
  try { f(ctx.currentTime + delayMs / 1000, ...args); } catch (e) { console.warn('sfx failed:', name, e); }
}
/** Sounds for an attack animation, given the key resolveFx picked ('type:Fire', 'basic:claw', 'Fire Spin', 'base1-4|Fire Spin'...). */
export function attack(key, type, times) {
  const lower = (type || 'Colorless').toLowerCase();
  play('windup', 0);
  if (key === 'base1-4|Fire Spin') { play('firespin.charge', 0); play('firespin.roar', 600); play('firespin.stream', 640); play('firespin.tornado', 1300); play('firespin.blast', 2200); return; }
  if (key === 'basic:claw') return play('claw', times.impact);
  if (key === 'basic:thump') return play('thump', times.impact);
  if (['Thunder', 'Thunderbolt'].includes(key)) { play('lightning.launch', 0); play('lightning.impact', times.impact); play('lightning.impact', times.impact + 250); return; }
  if (['Explosion', 'Selfdestruct', 'Self-destruct', 'Big Explosion', 'Hyper Beam', 'Solar Beam', 'Solarbeam', 'Hydro Pump'].includes(key)) { play('firespin.charge', 0); play('fire.impact', times.impact); play('fire.impact', times.impact + 120); return; }
  if (key === 'Earthquake') { play('lightning.impact', 0); play('lightning.impact', 400); play('fighting.impact', times.impact); return; }
  if (['fire', 'water', 'lightning', 'grass', 'psychic'].includes(lower)) { play(lower + '.launch', 0); play(lower + '.impact', times.impact); if (key.startsWith('Fire') || key === 'Blizzard' || key === 'Psychic') play(lower + '.impact', times.impact + 200); return; }
  play((lower === 'fighting' ? 'fighting' : 'colorless') + '.impact', times.impact);
}
