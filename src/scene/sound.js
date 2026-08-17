import { makeRng } from '../lib/noise.js';

// The freaks are procedural down to the last vertex, so their noises are too:
// no samples, just oscillators, a white-noise buffer and envelopes. A voice is
// derived from the stats, the same way the body is derived from the parameters
// — a heavy creature is low and slow, a fanged one is sharp and dry.
//
// Nothing here runs until the player switches sound on: browsers refuse to
// start an AudioContext without a gesture, and a page that greets you with a
// roar is a page you close.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** soft clip: gives the tone teeth without turning it into a fuzz pedal */
function driveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export function createSound() {
  let ctx = null;
  let master = null;
  let noise = null;
  let voice = { base: 120, grit: 0.5, bite: 0.5, quick: 1, wet: 0.4 };
  let on = false;

  function start() {
    if (ctx) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();

    // one second of white noise, reused by every breath, chomp and footfall
    const len = Math.floor(ctx.sampleRate);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(0.35);
    const tame = ctx.createBiquadFilter();
    tame.type = 'lowpass';
    tame.frequency.value = 5200; // matches the render: nothing here is crisp
    master = ctx.createGain();
    master.gain.value = 0;

    master.connect(shaper).connect(tame).connect(ctx.destination);
    return true;
  }

  /** white noise through a band, shaped by an envelope */
  function puff(t, { dur, from, to, q = 1, gain = 0.5, type = 'bandpass' }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** a pitched voice: one oscillator sweeping, with its own envelope */
  function tone(t, { dur, from, to, type = 'sawtooth', gain = 0.3, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Each gesture that makes a noise, and what that noise is. Everything is
  // scaled by the voice, so the same cue on two creatures is two creatures.
  const CUES = {
    roar(t, m) {
      const d = (0.75 + voice.grit * 0.5) / voice.quick;
      const f = voice.base * (1 + m * 0.35);
      tone(t, { dur: d, from: f * 1.6, to: f * 0.55, gain: 0.26 });
      tone(t + 0.02, { dur: d, from: f * 1.58, to: f * 0.54, gain: 0.15, detune: 14, type: 'square' });
      puff(t, { dur: d * 0.9, from: 900 + voice.bite * 1800, to: 320, q: 0.8, gain: 0.22 * voice.grit });
    },
    chomp(t) {
      // one bite per beat, each a dry click with a little meat under it
      for (let i = 0; i < 4; i++) {
        const at = t + i * (0.19 / voice.quick);
        puff(at, { dur: 0.07, from: 2600 + voice.bite * 2600, to: 700, q: 1.6, gain: 0.3 });
        tone(at, { dur: 0.09, from: voice.base * 1.1, to: voice.base * 0.6, gain: 0.12, type: 'triangle' });
      }
    },
    hop(t) {
      // the landing, not the jump
      const at = t + 0.34;
      tone(at, { dur: 0.16, from: voice.base * 0.9, to: voice.base * 0.28, gain: 0.32, type: 'sine' });
      puff(at, { dur: 0.11, from: 900, to: 180, q: 0.7, gain: 0.16 });
    },
    sniff(t) {
      for (let i = 0; i < 3; i++) {
        puff(t + 0.22 + i * 0.16, { dur: 0.13, from: 500, to: 2400, q: 3, gain: 0.2 });
      }
    },
    shiver(t) {
      for (let i = 0; i < 7; i++) {
        puff(t + i * 0.075, { dur: 0.06, from: 1500, to: 900, q: 5, gain: 0.13 });
      }
    },
    stretch(t) {
      const d = 0.9 / voice.quick;
      tone(t + 0.3, { dur: d, from: voice.base * 0.75, to: voice.base * 1.15, gain: 0.16, type: 'triangle' });
      puff(t + 0.3, { dur: d, from: 400, to: 900, q: 1.2, gain: 0.08 });
    },
    slump(t) {
      tone(t, { dur: 0.7 / voice.quick, from: voice.base * 0.95, to: voice.base * 0.5, gain: 0.15, type: 'triangle' });
    },
    shake(t) {
      puff(t, { dur: 0.3, from: 2200, to: 600, q: 2, gain: 0.16 });
    },
    scratch(t) {
      for (let i = 0; i < 5; i++) {
        puff(t + 0.25 + i * 0.1, { dur: 0.09, from: 3000, to: 1400, q: 2.5, gain: 0.11 });
      }
    },
    poke(t, m) {
      tone(t, { dur: 0.16, from: voice.base * (2.1 + m), to: voice.base * 1.1, gain: 0.2, type: 'square' });
      puff(t, { dur: 0.1, from: 1800, to: 600, q: 1.4, gain: 0.12 });
    },
  };

  return {
    get enabled() { return on; },

    /**
     * Must be called from a click: an AudioContext created without a gesture
     * is born suspended and never wakes.
     */
    toggle() {
      if (!start()) return null; // no WebAudio here at all
      on = !on;
      if (on) ctx.resume();
      // ramp instead of a jump: a gain that snaps to zero clicks
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.03);
      return on;
    },

    /** The creature's own voice, derived from its stats the way its body is. */
    setVoice(stats, seed) {
      const v = stats?.values ?? {};
      const n = (x) => clamp01(((x ?? 50) - 5) / 90);
      const rng = makeRng((seed >>> 0) ^ 0xa11d10);
      voice = {
        // a heavy creature is a low creature; the seed adds the last third
        base: 55 + (1 - n(v.vigor)) * 150 * (0.8 + rng() * 0.4),
        grit: 0.25 + n(v.dread) * 0.75,
        bite: n(v.bite),
        quick: 0.55 + n(v.speed) * 1.0,
      };
    },

    /** A gesture started, or the player jabbed it. `m` is 0..1 agitation. */
    cue(id, m = 0) {
      if (!on || !ctx || !CUES[id]) return;
      CUES[id](ctx.currentTime + 0.01, clamp01(m));
    },

    dispose() {
      if (!ctx) return;
      ctx.close();
      ctx = null;
      on = false;
    },
  };
}
