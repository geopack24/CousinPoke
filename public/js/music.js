// Match-start music. An original four-channel chiptune (two pulse waves, triangle bass, noise drums) in the spirit
// of handheld battle themes, played for ~10 seconds and faded out. If a file named battle.mp3 exists next to
// index.html it is played instead (same fade), so a table can use its own music.
import { audio } from './sfx.js';

const BPM = 160, STEP = 60 / BPM / 4; // sixteenth notes
const NOTE = (n) => { const m = /^([A-G])(#?)(\d)$/.exec(n); if (!m) return 0; const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0); return 440 * Math.pow(2, (idx - 9 + (+m[3] - 4) * 12) / 12); };
// Tracks are strings: note tokens separated by spaces; a token is Name+octave, '-' for rest, '~' to tie the previous note one more step.
const parse = (s) => { const out = []; for (const tok of s.trim().split(/\s+/)) { if (tok === '~' && out.length) out[out.length - 1].len++; else out.push({ f: tok === '-' ? 0 : NOTE(tok), len: 1 }); } return out; };

// E minor, original. Intro (2 bars) then an 8-bar loop. Each bar = 16 steps.
const INTRO_LEAD = 'E5 ~ ~ D#5 ~ ~ D5 ~ ~ C#5 ~ ~ C5 ~ B4 ~   E5 ~ ~ D#5 ~ ~ D5 ~ ~ C#5 ~ ~ C5 B4 A#4 A4';
const INTRO_BASS = 'E2 ~ E2 ~ E2 ~ E2 ~ E2 ~ E2 ~ E2 ~ E2 ~   E2 ~ E2 ~ E2 ~ E2 ~ D2 ~ D2 ~ C2 ~ B1 ~';
const LEAD = [
  'E5 ~ G5 ~ B5 ~ A5 G5 F#5 ~ E5 ~ D5 ~ E5 ~',
  'C5 ~ E5 ~ G5 ~ F#5 E5 D5 ~ F#5 ~ A5 ~ G5 F#5',
  'E5 ~ G5 ~ B5 ~ A5 G5 F#5 ~ E5 ~ D5 ~ E5 ~',
  'B4 ~ D5 ~ F#5 ~ E5 D5 E5 ~ ~ ~ - - E5 F#5',
  'G5 ~ ~ F#5 G5 ~ ~ A5 B5 ~ ~ ~ A5 ~ G5 ~',
  'F#5 ~ ~ E5 F#5 ~ ~ G5 A5 ~ ~ ~ G5 ~ F#5 ~',
  'E5 ~ B5 ~ E6 ~ D6 B5 C6 ~ B5 ~ A5 ~ G5 ~',
  'F#5 ~ A5 ~ D6 ~ C6 A5 B5 ~ ~ ~ ~ ~ - -',
].join(' ');
const HARMONY = [
  'E4 G4 B4 G4 E4 G4 B4 G4 E4 G4 B4 G4 D4 F#4 A4 F#4',
  'C4 E4 G4 E4 C4 E4 G4 E4 D4 F#4 A4 F#4 D4 F#4 A4 F#4',
  'E4 G4 B4 G4 E4 G4 B4 G4 E4 G4 B4 G4 D4 F#4 A4 F#4',
  'B3 D4 F#4 D4 B3 D4 F#4 D4 E4 G4 B4 G4 E4 G4 B4 G4',
  'C4 E4 G4 E4 C4 E4 G4 E4 D4 F#4 A4 F#4 D4 F#4 A4 F#4',
  'B3 D4 F#4 D4 B3 D4 F#4 D4 E4 G4 B4 G4 E4 G4 B4 G4',
  'C4 E4 G4 E4 C4 E4 G4 E4 A3 C4 E4 C4 A3 C4 E4 C4',
  'B3 D4 F#4 D4 B3 D4 F#4 D4 B3 D4 F#4 D4 B3 D#4 F#4 D#4',
].join(' ');
const BASS = [
  'E2 ~ E2 ~ E3 ~ E2 ~ E2 ~ E2 ~ E3 ~ E2 ~',
  'C2 ~ C2 ~ C3 ~ C2 ~ D2 ~ D2 ~ D3 ~ D2 ~',
  'E2 ~ E2 ~ E3 ~ E2 ~ E2 ~ E2 ~ E3 ~ E2 ~',
  'B1 ~ B1 ~ B2 ~ B1 ~ E2 ~ E2 ~ E3 ~ E2 ~',
  'C2 ~ C2 ~ C3 ~ C2 ~ D2 ~ D2 ~ D3 ~ D2 ~',
  'B1 ~ B1 ~ B2 ~ B1 ~ E2 ~ E2 ~ E3 ~ E2 ~',
  'C2 ~ C2 ~ C3 ~ C2 ~ A1 ~ A1 ~ A2 ~ A1 ~',
  'B1 ~ B1 ~ B2 ~ B1 ~ B1 ~ B2 ~ B1 B1 B2 B2',
].join(' ');
// drums: k kick, s snare, h hat, '-' rest
const DRUMS_INTRO = 'k - h - k - h - k - h - k - h -   k - h - k - h - k k s s k k s s';
const DRUMS = 'k - h h s - h h k - h h s - h h k - h h s - h h k - h h s - s s';

let current = null;
function pulse(ctx, out, f, t, dur, width, gain) {
  // a square with a pulse-width feel: two detuned squares, one inverted and offset, is close enough for a chiptune lead
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.setValueAtTime(gain, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = width;
  o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02); return o;
}
function tri(ctx, out, f, t, dur, gain) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02); }
let nb = null;
function drum(ctx, out, kind, t) {
  if (!nb) { const n = ctx.sampleRate; nb = ctx.createBuffer(1, n, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  const src = ctx.createBufferSource(); src.buffer = nb; const f = ctx.createBiquadFilter(); const g = ctx.createGain();
  const spec = { k: ['lowpass', 180, 0.5, 0.12], s: ['bandpass', 1800, 0.35, 0.1], h: ['highpass', 7000, 0.12, 0.04] }[kind]; if (!spec) return;
  f.type = spec[0]; f.frequency.value = spec[1]; g.gain.setValueAtTime(spec[2], t); g.gain.exponentialRampToValueAtTime(0.0001, t + spec[3]);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + spec[3] + 0.02);
  if (kind === 'k') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.1); const og = ctx.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.14); }
}
function schedule(ctx, out, t0, lead, harmony, bass, drums, leadGain) {
  let t = t0; for (const n of parse(lead)) { if (n.f) pulse(ctx, out, n.f, t, n.len * STEP * 0.95, 2600, leadGain); t += n.len * STEP; }
  t = t0; for (const n of parse(harmony)) { if (n.f) pulse(ctx, out, n.f, t, n.len * STEP * 0.6, 1800, leadGain * 0.45); t += n.len * STEP; }
  t = t0; for (const n of parse(bass)) { if (n.f) tri(ctx, out, n.f, t, n.len * STEP * 0.9, 0.5); t += n.len * STEP; }
  t = t0; for (const d of drums.trim().split(/\s+/)) { if (d !== '-') drum(ctx, out, d, t); t += STEP; }
}

/** Play the battle intro: `seconds` of music, then a 2.5 s fade. Returns false if audio isn't unlocked yet. */
export async function playBattleIntro(seconds = 10) {
  stopMusic();
  const a = audio(); if (!a) { console.log('battle intro: audio is locked or muted'); return false; } const { ctx, master } = a;
  const out = ctx.createGain(); out.gain.value = 0.55; out.connect(master);
  const t0 = ctx.currentTime + 0.05; const fadeAt = t0 + seconds, end = fadeAt + 2.5;
  out.gain.setValueAtTime(0.55, fadeAt); out.gain.linearRampToValueAtTime(0.0001, end);
  // custom file next to index.html wins
  if (await playFile('battle.mp3', out, ctx, seconds)) { console.log('battle intro: playing battle.mp3'); return true; }
  console.log('battle intro: playing the built-in chiptune');
  const barLen = 16 * STEP; let t = t0;
  schedule(ctx, out, t, INTRO_LEAD, '- '.repeat(32), INTRO_BASS, DRUMS_INTRO, 0.16); t += 2 * barLen;
  while (t < end + 1) { schedule(ctx, out, t, LEAD, HARMONY, BASS, (DRUMS + ' ').repeat(8), 0.16); t += 8 * barLen; }
  current = { stop: () => out.disconnect(), timer: setTimeout(() => stopMusic(), (seconds + 2.6) * 1000) };
  return true;
}
/** Play an audio file through `out` for `seconds` then let the caller's fade finish. False if the file isn't there. */
const fileCache = {};
async function fileExists(url) {
  if (url in fileCache) return fileCache[url];
  try { const r = await fetch(url, { method: 'HEAD' }); fileCache[url] = r.ok && /audio/.test(r.headers.get('content-type') || ''); } catch (e) { fileCache[url] = false; }
  return fileCache[url];
}
/** Optional music/start-times.json: { "battle": 42, "charizard": "1:05" } — where each track starts (seconds or m:ss).
 *  Keys are the file name without its extension. A missing or broken file just means "start at the beginning". */
let startTimes = null;
export function parseTime(v) {
  if (typeof v === 'number') return v > 0 ? v : 0;
  const m = String(v || '').trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); if (!m) return 0;
  return (m[1] ? +m[1] * 60 : 0) + +m[2];
}
async function startTimeFor(url) {
  if (!startTimes) { try { const r = await fetch('music/start-times.json', { cache: 'no-store' }); startTimes = /json/.test(r.headers.get('content-type') || '') ? await r.json() : {}; } catch (e) { startTimes = {}; } }
  const key = url.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  return parseTime(startTimes[key]);
}
async function playFile(url, out, ctx, seconds) {
  if (!(await fileExists(url))) return false;
  try {
    const at = await startTimeFor(url);
    const el = new Audio(at ? `${url}#t=${at}` : url); el.volume = 1; const src = ctx.createMediaElementSource(el); src.connect(out);
    if (at) await new Promise((res) => { const go = () => { try { if (Math.abs(el.currentTime - at) > 0.5) el.currentTime = at; } catch (e) { /* */ } res(); }; if (el.readyState >= 1) go(); else { el.addEventListener('loadedmetadata', go, { once: true }); setTimeout(res, 3000); } });
    await el.play();
    current = { stop: () => { try { el.pause(); } catch (e) { /* */ } out.disconnect(); }, timer: setTimeout(() => stopMusic(), (seconds + 2.6) * 1000) };
    return true;
  } catch (e) { out.disconnect(); return false; }
}
/** File name for a Pokémon's music: "Blaine's Charizard" -> music/blaines-charizard.mp3, "Nidoran ♀" -> music/nidoran-f.mp3 */
export function musicFileFor(cardName) {
  const slug = cardName.toLowerCase().replace(/['’]/g, '').replace(/♀/g, ' f').replace(/♂/g, ' m').replace(/é/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `music/${slug}.mp3`;
}
/** Play music/<pokemon>.mp3 if the player dropped one in; 10 s then a fade. Resolves false when there is no file. */
export async function playPokemonMusic(cardName, seconds = 10) {
  const base = musicFileFor(cardName).replace(/\.mp3$/, ''); let url = null;
  for (const ext of ['mp3', 'ogg', 'wav', 'm4a']) { if (await fileExists(`${base}.${ext}`)) { url = `${base}.${ext}`; break; } }
  if (!url) return false;
  stopMusic(); const a = audio(); if (!a) return false; const { ctx, master } = a;
  const out = ctx.createGain(); out.gain.value = 0.55; out.connect(master);
  const t0 = ctx.currentTime + 0.05; const fadeAt = t0 + seconds; out.gain.setValueAtTime(0.55, fadeAt); out.gain.linearRampToValueAtTime(0.0001, fadeAt + 2.5);
  return playFile(url, out, ctx, seconds);
}
export function stopMusic() { if (current) { clearTimeout(current.timer); try { current.stop(); } catch (e) { /* */ } current = null; } }
