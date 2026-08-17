import { makeRng } from '../lib/noise.js';

// The freaks are procedural down to the last vertex, so their noises are too:
// no samples, just oscillators, a white-noise buffer and envelopes. A voice is
// derived from the stats, the same way the body is derived from the parameters
// — a heavy creature is low and slow, a fanged one is sharp and dry.
//
// Nothing here plays on a timer of its own. The animator reports what the body
// just did — the breath turned, the jaw shut, a foot took the weight, the eyes
// blinked — and every creature noise is the answer to one of those. A sound
// that ran alongside the animation instead of out of it would drift against it
// within seconds, and drifting is exactly what makes a soundtrack feel bolted
// on.
//
// Nothing runs at all until the player switches sound on: browsers refuse to
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
  // what it is feeling: the ambient layer is entirely built out of this
  let feel = 'calm';
  let lastUi = -1;

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
  function tone(t, { dur, from, to, type = 'sawtooth', gain = 0.3, detune = 0, partial = true }) {
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

    // A phone speaker cannot move enough air for the low end: a heavy freak
    // roaring at 90 Hz is inaudible on one. Double the fundamental quietly
    // underneath so the voice still carries, without raising its pitch.
    if (partial && from < 190) {
      tone(t, { dur, from: from * 2, to: to * 2, type, gain: gain * 0.4, detune, partial: false });
    }
  }

  // What each motion sounds like. Everything is scaled by the voice, so the
  // same event on two creatures is two creatures — and by `p`, the strength the
  // animator measured, so a hard landing lands harder than a soft one.
  const CUES = {
    /** The breath turning inwards. Its shape is the mood, nothing else. */
    breathIn(t, p) {
      const d = 0.55 / voice.quick;
      if (feel === 'hostile') {
        // it never stops growling, it only gets louder on the way in
        tone(t, { dur: d * 1.7, from: voice.base * 0.64, to: voice.base * 0.5, gain: 0.1 });
        puff(t, { dur: d * 1.7, from: 340, to: 210, q: 1.1, gain: 0.06 * voice.grit });
      } else if (feel === 'spent') {
        puff(t, { dur: d, from: 700, to: 260, q: 1.8, gain: 0.16 });
      } else if (feel === 'wired') {
        puff(t, { dur: 0.15, from: 600, to: 1500, q: 2.5, gain: 0.16 });
        puff(t + 0.19, { dur: 0.15, from: 700, to: 1350, q: 2.5, gain: 0.13 });
      } else if (feel === 'alert') {
        puff(t, { dur: 0.28, from: 520, to: 1300, q: 2, gain: 0.15 });
      } else {
        puff(t, { dur: d, from: 380, to: 780, q: 1.4, gain: 0.1 });
      }
    },
    /** And back out. Quieter than the intake, and where the gut noises live. */
    breathOut(t, p) {
      const d = 0.5 / voice.quick;
      if (feel === 'spent') {
        puff(t, { dur: d, from: 800, to: 1700, q: 3.5, gain: 0.12 }); // the rasp
      } else if (feel === 'hostile') {
        tone(t, { dur: d, from: voice.base * 0.55, to: voice.base * 0.46, gain: 0.07 });
      } else {
        puff(t, { dur: d, from: 760, to: 330, q: 1.4, gain: 0.085 });
      }
      // a gut is a wet place; now and then it says so, on the way out
      if (Math.random() < 0.22) {
        const f = voice.base * 0.5;
        tone(t + 0.1, { dur: 0.5, from: f * 1.15, to: f * 0.7, gain: 0.07, type: 'sine' });
        puff(t + 0.1, { dur: 0.5, from: 280, to: 150, q: 3, gain: 0.05 });
      }
    },
    /** The jaw shutting. Teeth on a small one, a whole bite on a big one. */
    bite(t, p) {
      // squared, not linear: an idle chew ticks away in the background while a
      // real bite still snaps
      puff(t, { dur: 0.04 + p * 0.05, from: 2600 + voice.bite * 2600, to: 700, q: 1.6, gain: 0.04 + p * p * 0.26 });
      if (p > 0.3) {
        tone(t, { dur: 0.09, from: voice.base * 1.1, to: voice.base * 0.6, gain: 0.12 * p, type: 'triangle' });
      }
    },
    /**
     * The jaw opening wide. This is where a roar comes from: not from the
     * gesture being chosen, but from the mouth actually being open, so the
     * sound and the maw peak together however the gesture happens to be timed.
     */
    gape(t, p, act) {
      const yawn = act === 'stretch' || feel === 'spent';
      const d = (yawn ? 1.0 : 0.55 + voice.grit * 0.45) / voice.quick;
      const f = voice.base * (1 + p * 0.35);
      if (yawn) {
        tone(t, { dur: d, from: f * 0.8, to: f * 1.2, gain: 0.16 * p, type: 'triangle' });
        puff(t, { dur: d, from: 400, to: 900, q: 1.2, gain: 0.08 * p });
        return;
      }
      tone(t, { dur: d, from: f * 1.6, to: f * 0.55, gain: 0.16 * p });
      tone(t + 0.02, { dur: d, from: f * 1.58, to: f * 0.54, gain: 0.085 * p, detune: 14, type: 'square' });
      puff(t, { dur: d * 0.9, from: 900 + voice.bite * 1800, to: 320, q: 0.8, gain: 0.18 * voice.grit * p });
    },
    /** The body arriving back at its own height. */
    land(t, p) {
      tone(t, { dur: 0.16, from: voice.base * 0.9, to: voice.base * 0.28, gain: 0.12 + p * 0.22, type: 'sine' });
      puff(t, { dur: 0.11, from: 900, to: 180, q: 0.7, gain: 0.06 + p * 0.12 });
    },
    /** A foot taking the weight at the end of the sway. */
    step(t, p) {
      puff(t, { dur: 0.09, from: 620, to: 200, q: 1.4, gain: 0.05 + p * 0.07 });
    },
    /** Eyelids. Barely there, but a face with wet eyes is a face. */
    blink(t) {
      puff(t, { dur: 0.035, from: 2200, to: 1300, q: 4, gain: 0.05 });
    },
    /** Limbs and hair changing direction — the peak of any thrash. */
    rustle(t, p) {
      puff(t, { dur: 0.06 + p * 0.05, from: 1800 + p * 1400, to: 900, q: 3, gain: 0.05 + p * 0.1 });
    },

    /**
     * A new freak has just appeared. Its voice is already the new one, so the
     * cry is how you find out what this creature sounds like. The one creature
     * noise with no motion behind it — there is no body yet to make it.
     */
    spawn(t) {
      const f = voice.base;
      puff(t, { dur: 0.18, from: 340, to: 1600, q: 1.2, gain: 0.16 });
      tone(t + 0.06, { dur: 0.3, from: f * 0.8, to: f * 2.1, gain: 0.2, type: 'sawtooth' });
      tone(t + 0.3, { dur: 0.34, from: f * 2.1, to: f * 1.3, gain: 0.16, type: 'square', detune: 10 });
    },

    // played the moment sound is switched on: without it the first noise waits
    // for a gesture, and a silent button reads as a broken one
    hello(t) {
      tone(t, { dur: 0.1, from: voice.base * 1.6, to: voice.base * 2.4, gain: 0.22, type: 'triangle' });
      tone(t + 0.1, { dur: 0.16, from: voice.base * 2.4, to: voice.base * 3.2, gain: 0.22, type: 'triangle' });
    },
    poke(t, m) {
      tone(t, { dur: 0.16, from: voice.base * (2.1 + m), to: voice.base * 1.1, gain: 0.2, type: 'square' });
      puff(t, { dur: 0.1, from: 1800, to: 600, q: 1.4, gain: 0.12 });
    },
    /** A nose working. The one gesture with no motion channel of its own. */
    sniff(t) {
      for (let i = 0; i < 3; i++) {
        puff(t + 0.22 + i * 0.16, { dur: 0.13, from: 500, to: 2400, q: 3, gain: 0.2 });
      }
    },
  };

  // The panel's own noises. These are not the creature: they use fixed
  // frequencies rather than its voice, so a button sounds like a button no
  // matter which freak is on screen.
  const UI = {
    tap(t) {
      tone(t, { dur: 0.05, from: 660, to: 880, gain: 0.12, type: 'square', partial: false });
    },
    ok(t) {
      tone(t, { dur: 0.06, from: 780, to: 780, gain: 0.12, type: 'square', partial: false });
      tone(t + 0.07, { dur: 0.1, from: 1170, to: 1170, gain: 0.12, type: 'square', partial: false });
    },
    nope(t) {
      tone(t, { dur: 0.07, from: 420, to: 420, gain: 0.13, type: 'square', partial: false });
      tone(t + 0.08, { dur: 0.13, from: 280, to: 240, gain: 0.13, type: 'square', partial: false });
    },
    reset(t) {
      tone(t, { dur: 0.22, from: 900, to: 300, gain: 0.13, type: 'square', partial: false });
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
      // ramp instead of a jump: a gain that snaps to zero clicks
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.03);
      if (on) {
        ctx.resume();
        // iOS keeps a context asleep until something has actually played
        // inside the gesture that started it — one empty buffer wakes it
        const wake = ctx.createBufferSource();
        wake.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        wake.connect(ctx.destination);
        wake.start(0);
        CUES.hello(ctx.currentTime + 0.02);
      }
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

    /** A button in the panel. Not the creature's voice — the interface's own. */
    ui(id) {
      if (!on || !ctx || !UI[id]) return;
      // a colour picker fires while you drag inside it; without this the panel
      // turns into a machine gun
      if (ctx.currentTime - lastUi < 0.08) return;
      lastUi = ctx.currentTime;
      UI[id](ctx.currentTime + 0.01);
    },

    /** The mood the ambient layer should sound like. Cheap: called every frame. */
    setMood(id) {
      if (id) feel = id;
    },

    /**
     * Everything the body did this frame, straight from the animator. This is
     * the only way a creature noise ever gets made.
     */
    play(events) {
      if (!on || !ctx || !events.length) return;
      const now = ctx.currentTime + 0.01;
      for (const e of events) {
        const cue = CUES[e.id];
        if (cue) cue(now, clamp01(e.power ?? 1), e.act);
      }
    },

    /**
     * A gesture started, or the player jabbed it. `m` is 0..1 agitation.
     * `delay` pushes it into the future; only the offline level tests use it.
     */
    cue(id, m = 0, delay = 0) {
      if (!on || !ctx || !CUES[id]) return;
      CUES[id](ctx.currentTime + 0.01 + delay, clamp01(m));
    },

    dispose() {
      if (!ctx) return;
      ctx.close();
      ctx = null;
      on = false;
    },
  };
}
