import { makeRng } from '../lib/noise.js';

// The freaks are procedural down to the last vertex, so their noises are too:
// no samples, just oscillators, a buffer of white noise and filters.
//
// Two rules shape everything here.
//
// One: nothing plays on a timer of its own, and nothing plays for a motion you
// cannot see. The animator reports what the body just did — an arm swung, the
// head whipped round, it jumped, it blinked, the jaw shut — and every creature
// noise is the answer to one of those. A sound running alongside the animation
// instead of out of it drifts against it within seconds, and a noise with
// nothing visible behind it reads as the creature making sounds by itself.
//
// Two: a raw oscillator is a synthesiser, not an animal. Every voiced sound
// here goes through a throat — a resonant lowpass that tracks the pitch, two
// formant peaks, vibrato and a growl — and every envelope opens from silence
// rather than snapping on. That is most of the difference between a creature
// and a beep.
//
// Nothing runs at all until the player switches sound on: browsers refuse to
// start an AudioContext without a gesture, and a page that greets you with a
// roar is a page you close.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** gentle saturation — warmth, not a fuzz pedal */
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
  let voice = { base: 120, grit: 0.5, bite: 0.5, quick: 1 };
  let on = false;
  let feel = 'calm';   // the mood, which colours the timbre of everything
  let lastUi = -1;

  function start() {
    if (ctx) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();

    // two seconds of white noise, reused by every rush, scrape and footfall
    const len = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(0.12);
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 70;   // nothing below this survives a small speaker
    const tame = ctx.createBiquadFilter();
    tame.type = 'lowpass';
    tame.frequency.value = 5000;   // matches the render: nothing here is crisp
    master = ctx.createGain();
    master.gain.value = 0;

    master.connect(shaper).connect(rumble).connect(tame).connect(ctx.destination);
    return true;
  }

  /**
   * The envelope every sound uses: up from actual silence over `attack`, then
   * an exponential fall. Opening from 0.0001 with an exponential ramp — the
   * obvious way — starts with a click, and a few hundred of those an hour is
   * most of what makes a soundtrack sound cheap.
   */
  function env(t, dur, peak, attack = 0.012) {
    const g = ctx.createGain();
    const a = Math.min(attack, dur * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  const grain = (t, dur) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6; // never the same grain twice
    src.start(t);
    src.stop(t + dur + 0.05);
    return src;
  };

  /**
   * Air: noise through one band. Anything that is a rush rather than a voice —
   * a limb through the air, a scrape, a scuff. `to` defaults to `from`, because
   * a swept short noise burst is how you make a laser, not a creature.
   */
  function air(t, { dur, from, to = from, q = 1.4, gain = 0.1, attack = 0.02 }) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    grain(t, dur).connect(f).connect(env(t, dur, gain, attack)).connect(master);
  }

  /** An impact: a pitched drop with a scrap of noise on the front of it. */
  function knock(t, { dur = 0.18, f = 90, gain = 0.3, grit = 0.4 }) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, f * 0.5), t + dur * 0.7);
    o.connect(env(t, dur, gain, 0.004)).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (grit > 0) air(t, { dur: dur * 0.35, from: 500, q: 0.8, gain: gain * grit, attack: 0.002 });
  }

  /** A dry tap — teeth, an eyelid. Fixed band, no sweep, very short. */
  function tap(t, { dur = 0.035, f = 2400, q = 2.2, gain = 0.14 }) {
    air(t, { dur, from: f, q, gain, attack: 0.001 });
  }

  /**
   * A voice. A sawtooth is a buzz until it is given a throat: a resonant lowpass
   * riding the pitch, two formant peaks, a little vibrato so the pitch is never
   * perfectly steady, and — when it is angry — an amplitude flutter, which is
   * all a growl really is.
   */
  function say(t, { dur, f0, f1 = f0 * 0.7, gain = 0.2, growl = 0, breath = 0.25, open = 1 }) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, f1), t + dur);

    // vibrato, a fifth of a semitone or so. Without it a pitch sweep is a slide
    // whistle and the ear hears a machine.
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5 + Math.random() * 2.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 12 + Math.random() * 18;
    vib.connect(vibDepth).connect(o.detune);
    vib.start(t);
    vib.stop(t + dur + 0.05);

    // the throat: cutoff tracks the pitch, so the timbre stays voiced whatever
    // the note is instead of turning into a buzz at the bottom
    const throat = ctx.createBiquadFilter();
    throat.type = 'lowpass';
    throat.Q.value = 6;
    throat.frequency.setValueAtTime(f0 * (3 + open * 3), t);
    throat.frequency.exponentialRampToValueAtTime(Math.max(120, f1 * (2 + open * 2)), t + dur);

    const out = env(t, dur, gain, Math.min(0.05, dur * 0.18));
    const mix = ctx.createGain();
    o.connect(throat).connect(mix);

    // two resonances are enough for the ear to hear a mouth rather than a filter
    for (const [hz, q, level] of [[320 + open * 380, 8, 0.5], [1100 + open * 900, 10, 0.3]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = q;
      const lv = ctx.createGain();
      lv.gain.value = level;
      o.connect(bp).connect(lv).connect(mix);
    }

    if (growl > 0) {
      // a growl is amplitude flutter, nothing more exotic than that
      const am = ctx.createGain();
      am.gain.value = 1 - growl * 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 22 + growl * 26;
      const depth = ctx.createGain();
      depth.gain.value = growl * 0.5;
      lfo.connect(depth).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      mix.connect(am).connect(out);
    } else {
      mix.connect(out);
    }
    out.connect(master);

    o.start(t);
    o.stop(t + dur + 0.05);

    // breathiness, riding the same range the throat sits in
    if (breath > 0) air(t, { dur, from: f0 * 4, to: f1 * 3, q: 1, gain: gain * breath, attack: 0.03 });

    // a low voice on a phone speaker is no voice at all; an octave up carries it
    if (f0 < 190) {
      const up = ctx.createOscillator();
      up.type = 'triangle';
      up.frequency.setValueAtTime(f0 * 2, t);
      up.frequency.exponentialRampToValueAtTime(Math.max(48, f1 * 2), t + dur);
      up.connect(env(t, dur, gain * 0.3, Math.min(0.05, dur * 0.18))).connect(master);
      up.start(t);
      up.stop(t + dur + 0.05);
    }
  }

  // How the mood colours the voice: how much flutter, how far the throat opens,
  // where the pitch sits. The mood is not a sound of its own — it is the tone
  // of every other sound.
  const COLOUR = {
    calm: { growl: 0, open: 0.9, pitch: 1 },
    alert: { growl: 0.1, open: 1.1, pitch: 1.1 },
    wired: { growl: 0.2, open: 1.2, pitch: 1.2 },
    hostile: { growl: 0.75, open: 0.7, pitch: 0.85 },
    spent: { growl: 0.15, open: 0.5, pitch: 0.8 },
  };
  const colour = () => COLOUR[feel] ?? COLOUR.calm;

  // One entry per thing the body can do. `p` is how hard it did it.
  const CUES = {
    /** An arm swinging through the air, or hair whipping after it. */
    move(t, p) {
      const c = colour();
      air(t, {
        dur: 0.09 + p * 0.13,
        from: 500 + p * 700,
        to: 260 + p * 300,
        q: 1.1,
        gain: 0.06 + p * 0.11,
        attack: 0.03 + (1 - p) * 0.03, // a slow swing has no edge on it
      });
      // a heavy swing drags a little voice along with it
      if (p > 0.65) {
        say(t + 0.02, {
          dur: 0.16, f0: voice.base * 1.1 * c.pitch, f1: voice.base * 0.8,
          gain: 0.05 * p, growl: c.growl * 0.5, breath: 0.5, open: c.open,
        });
      }
    },
    /** The head whipping round. */
    turn(t, p) {
      air(t, { dur: 0.14 + p * 0.1, from: 380 + p * 420, to: 220, q: 0.9, gain: 0.07 + p * 0.1, attack: 0.035 });
    },
    /** Off the ground. */
    launch(t, p) {
      air(t, { dur: 0.1, from: 900, to: 1500, q: 1.6, gain: 0.07 + p * 0.08, attack: 0.008 });
    },
    /** And back onto it. */
    land(t, p) {
      knock(t, { dur: 0.16 + p * 0.08, f: voice.base * 0.75, gain: 0.12 + p * 0.16, grit: 0.45 });
    },
    /** An eyelid. Barely there, but a face with wet eyes is a face. */
    blink(t) {
      tap(t, { dur: 0.03, f: 1900, q: 3, gain: 0.12 });
    },
    /** The jaw shutting: teeth, from a dry tick to a real snap. */
    bite(t, p) {
      const c = colour();
      tap(t, { dur: 0.03 + p * 0.03, f: 1800 + voice.bite * 1500, q: 2, gain: 0.03 + p * p * 0.17 });
      if (p > 0.45) knock(t, { dur: 0.08, f: voice.base * 1.4, gain: 0.06 * p, grit: 0 });
      if (p > 0.8) {
        say(t, { dur: 0.12, f0: voice.base * c.pitch, f1: voice.base * 0.7, gain: 0.07, growl: c.growl, breath: 0.2, open: 0.5 });
      }
    },
    /**
     * The jaw opening wide — where the voice comes from. Not from a gesture
     * being chosen: from the mouth actually being open, so the sound and the
     * maw peak together however that gesture happens to be timed.
     */
    gape(t, p, act) {
      const c = colour();
      const f = voice.base * c.pitch;
      if (act === 'stretch' || feel === 'spent') {
        say(t, { dur: 0.9 / voice.quick, f0: f * 0.85, f1: f * 1.25, gain: 0.15 * p, growl: 0.08, breath: 0.7, open: 1.4 });
        return;
      }
      say(t, {
        dur: (0.5 + voice.grit * 0.4) / voice.quick,
        f0: f * 1.5, f1: f * 0.6, gain: 0.17 * p,
        growl: Math.max(c.growl, voice.grit * 0.5),
        breath: 0.3 + voice.grit * 0.3,
        open: c.open + 0.5,
      });
    },
    /** A jab from the player. Not a motion — the motion is the answer to it. */
    poke(t, m) {
      const c = colour();
      say(t, {
        dur: 0.22, f0: voice.base * (1.6 + m) * c.pitch, f1: voice.base * 1.1,
        gain: 0.16, growl: c.growl * 0.6, breath: 0.4, open: 1.2,
      });
    },
    /**
     * A new freak has just appeared. Its voice is already the new one, so the
     * cry is how you find out what this creature sounds like. The one creature
     * noise with no motion behind it — there is no body yet to make it.
     */
    spawn(t) {
      const f = voice.base;
      air(t, { dur: 0.2, from: 400, to: 1500, q: 1.2, gain: 0.1, attack: 0.05 });
      say(t + 0.05, { dur: 0.42, f0: f * 0.7, f1: f * 1.7, gain: 0.18, growl: 0.15, breath: 0.45, open: 1.3 });
      say(t + 0.42, { dur: 0.3, f0: f * 1.7, f1: f * 1.1, gain: 0.12, growl: 0.1, breath: 0.5, open: 1 });
    },
    /** Played the moment sound is switched on, so the button is obviously live. */
    hello(t) {
      const f = voice.base;
      say(t, { dur: 0.12, f0: f * 1.5, f1: f * 1.5, gain: 0.12, breath: 0.3, open: 1.1 });
      say(t + 0.13, { dur: 0.2, f0: f * 2.2, f1: f * 2.2, gain: 0.12, breath: 0.3, open: 1.1 });
    },
  };

  // The panel's own noises. Soft filtered triangles rather than the square-wave
  // blips they started as: next to a creature that breathes, a chiptune beep is
  // the one thing on the page that sounds like a computer.
  const beep = (t, f, dur, gain = 0.11) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = f * 3.5;
    o.connect(lp).connect(env(t, dur, gain, 0.006)).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  };

  const UI = {
    tap(t) { beep(t, 740, 0.06); },
    ok(t) { beep(t, 660, 0.07); beep(t + 0.075, 990, 0.11); },
    nope(t) { beep(t, 420, 0.08); beep(t + 0.085, 300, 0.14); },
    reset(t) { beep(t, 700, 0.07); beep(t + 0.07, 420, 0.16); },
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

    /** The mood. Not a sound of its own — the tone of every other sound. */
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
     * The handful of noises with no motion behind them: a birth, a jab.
     * `delay` pushes it into the future; only the offline level tests use it.
     */
    cue(id, m = 0, delay = 0) {
      if (!on || !ctx || !CUES[id]) return;
      CUES[id](ctx.currentTime + 0.01 + delay, clamp01(m));
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

    dispose() {
      if (!ctx) return;
      ctx.close();
      ctx = null;
      on = false;
    },
  };
}
