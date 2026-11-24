// All sound is synthesized with WebAudio: no audio files to load.
let ctx = null;
let master = null;
let enabled = true;
const last = {};

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f = 440, to, type = 'sine', dur = 0.15, vol = 0.2, at = 0, attack = 0.005 }) {
  const c = ensure();
  if (!c || !enabled) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const throttled = (name, ms, fn) => () => {
  const now = performance.now();
  if (now - (last[name] || 0) < ms) return;
  last[name] = now;
  fn();
};

export const sfx = {
  unlock: () => ensure(),
  setEnabled: (on) => { enabled = on; if (on) ensure(); },
  start: () => { tone({ f: 110, to: 440, type: 'sawtooth', dur: 0.5, vol: 0.12 }); tone({ f: 660, dur: 0.25, vol: 0.12, at: 0.45 }); },
  signal: throttled('signal', 70, () => tone({ f: 1500 + Math.random() * 500, type: 'triangle', dur: 0.05, vol: 0.035 })),
  recall: throttled('recall', 90, () => tone({ f: 520, to: 880, dur: 0.09, vol: 0.05 })),
  hold: throttled('hold', 120, () => { [523.25, 659.25, 783.99].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.28, vol: 0.16, at: i * 0.07 })); }),
  siloHold: throttled('siloHold', 120, () => { tone({ f: 392, type: 'triangle', dur: 0.2, vol: 0.09 }); }),
  takeover: throttled('takeover', 200, () => { tone({ f: 196, to: 82, type: 'sawtooth', dur: 0.7, vol: 0.26 }); tone({ f: 185, to: 78, type: 'square', dur: 0.7, vol: 0.1, at: 0.02 }); }),
  pattern: throttled('pattern', 150, () => { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ f, dur: 0.16, vol: 0.07, at: i * 0.045 })); }),
  finish: () => { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.5, vol: 0.14, at: i * 0.11 })); },
  click: () => tone({ f: 880, dur: 0.04, vol: 0.06 }),
};
