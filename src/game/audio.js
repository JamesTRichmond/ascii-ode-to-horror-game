// Synthesised audio (WebAudio, no samples). Presentation only: consumes simulation events.
export function createAudio() {
  const A = { ctx: null, master: null, hum: null, volume: 0.7, ready: false };
  A.start = () => {
    if (A.ctx) { A.ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
    A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.gain.value = A.volume; A.master.connect(A.ctx.destination); A.ready = true;
    const o = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = 196; o2.frequency.value = 294; g.gain.value = 0;
    o.connect(g); o2.connect(g); g.connect(A.master); o.start(); o2.start(); A.hum = { o, o2, g };
  };
  A.setVolume = v => { A.volume = v; if (A.master) A.master.gain.value = v; };
  A.tone = (freq, dur = 0.2, type = 'sine', gain = 0.2, slide = 0) => {
    if (!A.ready) return; const t = A.ctx.currentTime, o = A.ctx.createOscillator(), g = A.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.02);
  };
  A.update = (sim) => { if (!A.ready) return; A.hum.g.gain.setTargetAtTime(sim.p.hum ? 0.16 : 0, A.ctx.currentTime, 0.06); };
  A.event = e => {
    switch (e.type) {
      case 'step': A.tone(e.a ? 60 : 85, 0.07, 'triangle', e.a ? 0.03 : 0.09, 0.6); break;
      case 'measure': [392, 494, 587].forEach((f, i) => setTimeout(() => A.tone(f, 0.5, 'sine', 0.16), i * 110)); break;
      case 'chord': [196, 247, 294, 392].forEach(f => A.tone(f, 0.7, 'sawtooth', 0.08, 0.98)); break;
      case 'hurt': A.tone(110, 0.3, 'square', 0.14, 0.4); break;
      case 'gate': A.tone(147, 1.2, 'sine', 0.2, 2); break;
      default: break;
    }
  };
  return A;
}
