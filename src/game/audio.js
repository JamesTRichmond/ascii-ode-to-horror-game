// Synthesised audio (WebAudio, no samples). Presentation only: it consumes simulation events and
// snapshots, and never feeds anything back into the simulation.
import { ET } from '../sim/sim.js';
import { roomAcoustics, impulseResponse } from './reverb.js';
import { relativePosition, occlusion, occlusionFilter } from './spatial.js';

// Per-chapter bed: root (Hz), drone interval ratios, noise colour (lowpass Hz), noise level, LFO rate
const BEDS = {
  1: { root: 55, ratios: [1, 1.5], noise: 700, level: 0.05, lfo: 0.09, surf: true },
  2: { root: 61.7, ratios: [1, 1.189, 1.5], noise: 400, level: 0.02, lfo: 0.2 },
  3: { root: 49, ratios: [1, 1.414], noise: 300, level: 0.035, lfo: 0.05 },
  4: { root: 41.2, ratios: [1, 1.059], noise: 250, level: 0.02, lfo: 0.33, breath: true },
  5: { root: 46.2, ratios: [1, 1.5, 2], noise: 900, level: 0.025, lfo: 0.12, crackle: true },
  6: { root: 65.4, ratios: [1, 1.26, 1.5], noise: 500, level: 0.03, lfo: 1.0, march: true },
  7: { root: 98, ratios: [1, 1.25, 1.5, 2], noise: 2400, level: 0.012, lfo: 0.07 },
  8: { root: 73.4, ratios: [1, 1.5, 2.25], noise: 1800, level: 0.03, lfo: 0.15 },
  9: { root: 82.4, ratios: [1, 1.25, 1.5, 2], noise: 1500, level: 0.04, lfo: 0.08, surf: true },
};
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
const VOICE = { [ET.FORSAKER]: 140, [ET.CROWNED]: 70, [ET.TRAMPLER]: 50, [ET.MIRTH]: 520, [ET.TRIUNE]: 62, [ET.HUSK]: 180, [ET.BUILDER]: 90, [ET.MARCHER]: 110, [ET.CHORISTER]: 660, [ET.COMER]: 330 };

export function createAudio() {
  const A = { ctx: null, master: null, ready: false, volume: 0.7, bed: null, hum: null, heart: 0, chapter: 0, listener: { x: 0, z: 0, yaw: 0 }, sim: null, spatial: 'binaural', stats: { hrtf: 0, occluded: 0 } };
  const now = () => A.ctx.currentTime;
  let noiseBuf = null;
  const noise = () => { if (!noiseBuf) { noiseBuf = A.ctx.createBuffer(1, A.ctx.sampleRate * 2, A.ctx.sampleRate); const d = noiseBuf.getChannelData(0); let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } } const n = A.ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; return n; };

  A.start = () => {
    if (A.ctx) { A.ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
    A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.gain.value = A.volume;
    const comp = A.ctx.createDynamicsCompressor(); A.master.connect(comp); comp.connect(A.ctx.destination); A.ready = true;
    // room acoustics: a convolution send whose impulse response is derived from the current level's geometry
    A.reverb = A.ctx.createConvolver(); A.wet = A.ctx.createGain(); A.wet.gain.value = 0; A.master.connect(A.reverb); A.reverb.connect(A.wet); A.wet.connect(comp);
    if (A.room) A.setRoom(A.room);
    // the player's hum: a perfect fifth (G3 + D4) through a gentle formant filter
    const g = A.ctx.createGain(), f = A.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.8; g.gain.value = 0;
    const o1 = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(); o1.type = 'triangle'; o2.type = 'sine'; o1.frequency.value = 196; o2.frequency.value = 293.7;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(A.master); o1.start(); o2.start(); A.hum = { g, o1, o2 };
    if (A.chapter) A.setChapter(A.chapter);
  };
  /** Rebuild the reverb for a level: Sabine RT60 and early reflections from its tile map (see reverb.js). */
  A.setRoom = sim => {
    A.room = sim; if (!A.ready || !A.reverb) return;
    const room = roomAcoustics(sim), [L, R] = impulseResponse(room, A.ctx.sampleRate, (sim.def.id * 7919) ^ sim.w), buf = A.ctx.createBuffer(2, L.length, A.ctx.sampleRate);
    buf.copyToChannel(L, 0); buf.copyToChannel(R, 1); A.reverb.buffer = buf; A.wet.gain.setTargetAtTime(room.indoor ? 0.32 : 0.16, now(), 0.4); A.acoustics = room;
  };
  A.setVolume = v => { A.volume = v; if (A.master) A.master.gain.setTargetAtTime(v, now(), 0.05); };

  /** Crossfade to a chapter's ambient bed. */
  A.setChapter = id => {
    A.chapter = id; if (!A.ready) return;
    if (A.bed) { const old = A.bed; old.out.gain.setTargetAtTime(0, now(), 0.8); setTimeout(() => old.nodes.forEach(n => { try { n.stop(); } catch { /* already stopped */ } }), 4000); }
    const b = BEDS[id] || BEDS[1], out = A.ctx.createGain(), nodes = []; out.gain.value = 0; out.connect(A.master); out.gain.setTargetAtTime(1, now(), 1.2);
    const lfo = A.ctx.createOscillator(); lfo.frequency.value = b.lfo; lfo.start(); nodes.push(lfo); // depth is set per voice: 35% of that voice's own level
    b.ratios.forEach((r, i) => { const o = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = i ? 'sine' : 'sawtooth'; o.frequency.value = b.root * r; o.detune.value = (i - 1) * 4; const base = i ? 0.035 : 0.025, depth = A.ctx.createGain(); g.gain.value = base; depth.gain.value = base * 0.35; lfo.connect(depth); const lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + i * 140; o.connect(lp); lp.connect(g); g.connect(out); depth.connect(g.gain); o.start(); nodes.push(o); });
    const n = noise(), nf = A.ctx.createBiquadFilter(), ng = A.ctx.createGain(); nf.type = 'lowpass'; nf.frequency.value = b.noise; ng.gain.value = b.level; n.connect(nf); nf.connect(ng); ng.connect(out); n.start(); nodes.push(n);
    if (b.surf) { const sl = A.ctx.createOscillator(), sg = A.ctx.createGain(); sl.frequency.value = 0.11; sg.gain.value = b.level * 1.6; sl.connect(sg); sg.connect(ng.gain); sl.start(); nodes.push(sl); }
    A.bed = { out, nodes, def: b, beat: 0 };
  };

  /** Route a voice to the master bus. `at` is a number (stereo pan -1..1) or a place() result: then walls between
   *  the source and the listener low-pass and attenuate it, and in binaural mode an HRTF panner positions it in 3D. */
  const route = (g, at) => {
    if (typeof at !== 'object' || !at) { const p = A.ctx.createStereoPanner?.(); if (p) { p.pan.value = Math.max(-1, Math.min(1, at || 0)); g.connect(p); p.connect(A.master); } else g.connect(A.master); return; }
    let node = g; const f = occlusionFilter(at.occl);
    if (at.occl > 0) { const lp = A.ctx.createBiquadFilter(), og = A.ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = f.freq; lp.Q.value = 0.5; og.gain.value = f.gain; node.connect(lp); lp.connect(og); node = og; A.stats.occluded++; }
    if (A.spatial === 'binaural' && A.ctx.createPanner) {
      const pn = A.ctx.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'linear'; pn.rolloffFactor = 0; // distance gain is already in at.gain
      const { x, y, z } = at.pos; if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; } else pn.setPosition(x, y, z);
      node.connect(pn); pn.connect(A.master); A.stats.hrtf++; return;
    }
    const p = A.ctx.createStereoPanner?.(); if (p) { p.pan.value = Math.max(-1, Math.min(1, at.pan)); node.connect(p); p.connect(A.master); } else node.connect(A.master);
  };
  /** Short synthesised tone; `pan` is -1..1 or a place() result. */
  A.tone = (freq, dur = 0.2, type = 'sine', gain = 0.2, slide = 0, pan = 0, delay = 0) => {
    if (!A.ready) return; const t = now() + delay, o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); route(g, pan); o.start(t); o.stop(t + dur + 0.05);
  };
  A.hiss = (dur, freq, gain, pan = 0, sweep = 1) => {
    if (!A.ready) return; const t = now(), n = noise(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); route(g, pan); n.start(t); n.stop(t + dur + 0.05);
  };
  /** Stereo pan and distance gain of a world point (simulation units) relative to the listener. */
  const place = (x, z) => { const L = A.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) / 1024, side = (-dx * Math.sin(L.yaw) + dz * Math.cos(L.yaw)) / (Math.hypot(dx, dz) || 1);
    return { pan: side, gain: 1 / (1 + d * 0.35), pos: relativePosition(L, x, z), occl: A.sim ? occlusion(A.sim, L.x, L.z, x, z) : 0 }; };

  /** Per-frame continuous layers: hum level, heartbeat from threat proximity, march pulse. */
  /** Stop every continuous layer (hum, heartbeat, march); event stingers are unaffected. */
  A.silence = () => { if (!A.ready) return; A.hum.g.gain.setTargetAtTime(0, now(), 0.03); A.heart = 0; if (A.bed) A.bed.beat = 0; };
  /** `yaw` orients the listener (radians): the singer's facing when omitted, the camera azimuth under the dimetric camera. */
  A.update = (sim, pl, dt, active = true, yaw) => {
    if (!A.ready || !sim) return; const p = sim.p; A.sim = sim; A.listener = { x: p.x, z: p.z, yaw: yaw ?? (p.ang / 4096) * Math.PI * 2 };
    if (!active) { A.silence(); return; }
    A.hum.g.gain.setTargetAtTime(p.hum ? 0.12 : 0, now(), 0.06); A.hum.o1.detune.setTargetAtTime(p.breath < 200 ? -30 : 0, now(), 0.2);
    let near = 1e9; for (const e of sim.ents) { if (e.mode === 9 || e.type === ET.SLUMBERER || (e.type === ET.MARCHER && !p.marked) || (e.type === ET.HUSK && e.mode === 0) || ((e.type === ET.CHORISTER || e.type === ET.MIRTH) && sim.c.phase !== 1)) continue; near = Math.min(near, Math.hypot(e.x - p.x, e.z - p.z) / 1024); }
    const fear = Math.max(0, Math.min(1, 1 - near / 7)), rate = 0.9 + fear * 1.6; A.heart += dt * rate;
    if (fear > 0.05 && A.heart >= 1) { A.heart = 0; A.tone(48, 0.16, 'sine', 0.25 * fear + 0.05); A.tone(44, 0.14, 'sine', 0.18 * fear + 0.04, 0, 0, 0.18); } else if (A.heart >= 1) A.heart = 0;
    const b = A.bed?.def; if (b?.march) { A.bed.beat += dt; if (A.bed.beat >= 0.5) { A.bed.beat = 0; A.hiss(0.09, 180, p.marked ? 0.25 : 0.08); } }
    if (b?.breath && p.hold) A.hum.g.gain.setTargetAtTime(0, now(), 0.02);
  };

  A.event = e => {
    if (!A.ready) return; const at = place(e.x, e.z);
    switch (e.type) {
      case 'step': A.hiss(0.06, e.a ? 600 : 1100, (e.a ? 0.03 : 0.07) * at.gain, 0, 0.6); break;
      case 'measure': PENTA.slice(0, 3 + e.a).forEach((r, i) => A.tone(392 * r, 0.9, 'sine', 0.12, 0, (i - 1) * 0.3, i * 0.11)); break;
      case 'chord': [196, 247, 294, 392].forEach((f, i) => A.tone(f, 0.9, 'sawtooth', 0.07, 0.97, (i - 1.5) * 0.4)); A.hiss(0.6, 2000, 0.15, 0, 0.3); break;
      case 'hurt': A.tone(110, 0.35, 'square', 0.14, 0.4, at); A.hiss(0.25, 300, 0.2, at); break;
      case 'death': A.tone(220, 2.5, 'sawtooth', 0.12, 0.25); A.hiss(2.5, 4000, 0.2, 0, 0.05); break;
      case 'gate': [1, 1.5, 2].forEach((r, i) => A.tone(147 * r, 2.2, 'sine', 0.12, 1, 0, i * 0.2)); break;
      case 'alert': A.tone(VOICE[e.a] || 120, 0.8, e.a === ET.CHORISTER || e.a === ET.MIRTH ? 'triangle' : 'sawtooth', 0.12 * at.gain + 0.03, e.a === ET.MIRTH ? 1.6 : 0.7, at); break;
      case 'stagger': A.tone((VOICE[e.a] || 120) * 0.8, 0.4, 'triangle', 0.08, 0.5, at); break;
      case 'unwritten': A.hiss(1.2, 3000, 0.18 * at.gain, at, 0.1); A.tone((VOICE[e.a] || 200) * 2, 0.8, 'sine', 0.08, 0.3, at); break;
      case 'sigh': A.hiss(1.4, 400, 0.1 * at.gain, at, 0.5); break;
      case 'phaseWarn': A.tone(70, 1.5, 'sawtooth', 0.1, 1.3); break;
      case 'phase': A.hiss(1.2, 200, 0.25, 0, 8); A.tone(e.a ? 330 : 82, 1.2, 'sine', 0.12, e.a ? 1.5 : 0.7); break;
      case 'wall': A.hiss(0.8, 120, 0.25 * at.gain, at, 0.5); A.tone(55, 0.8, 'square', 0.06 * at.gain, 0.8, at); break;
      case 'trample': [0, 0.25, 0.5].forEach(d => A.tone(41, 0.4, 'square', 0.16, 0.5, at, d)); break;
      case 'surgeWarn': A.tone(440, 1.4, 'sawtooth', 0.09, 2.2); A.tone(660, 1.4, 'sawtooth', 0.06, 2.2, 0, 0.15); break;
      case 'surge': A.hiss(1.6, 6000, 0.2, 0, 0.5); break;
      case 'marked': A.hiss(1.2, 500, 0.3, 0, 1.6); A.tone(110, 1, 'sawtooth', 0.12, 1.1); break;
      case 'brazier': A.hiss(1.2, 1800, 0.2 * at.gain, at, 0.4); A.tone(294, 1.5, 'sine', 0.1, 1); break;
      case 'gutter': A.hiss(0.5, 2500, 0.15, 0, 0.2); break;
      case 'relight': A.hiss(0.6, 1500, 0.15, 0, 1.5); break;
      case 'gasp': A.hiss(0.5, 900, 0.3, 0, 1.8); break;
      case 'wake': A.tone(196 * PENTA[(e.a / 60) % 6 | 0], 1.2, 'sine', 0.1, 1, at); break;
      case 'ending': (e.a === 1 ? [1, 1.25, 1.5, 2, 2.5] : [1, 1.2, 1.5]).forEach((r, i) => A.tone(130.8 * r, 4, 'sine', 0.1, 1, (i - 2) * 0.3, i * 0.4)); break;
      default: break;
    }
  };
  return A;
}
