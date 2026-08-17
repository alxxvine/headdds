// A creature that behaves the same whether you leave it alone or keep jabbing
// it is still a toy. This layer gives it an inner state that the player moves:
// four drives that rise and fall in real seconds, a mood read off them, and a
// posture the whole body carries while that mood lasts.
//
// The drives are continuous, so the posture blends by itself; the mood name is
// only a label for the panel and a bias on which gesture comes next.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** exponential approach — frame-rate independent, unlike a raw lerp */
const toward = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export const MOODS = {
  calm: { label: 'CALM', pace: 1 },
  alert: { label: 'ALERT', pace: 1.2 },
  wired: { label: 'WIRED', pace: 1.7 },
  hostile: { label: 'HOSTILE', pace: 1.45 },
  spent: { label: 'SPENT', pace: 0.55 },
};

// Which gestures a mood pulls towards and which it suppresses. Everything not
// listed keeps its natural weight, so a mood colours the behaviour instead of
// replacing it.
const BIAS = {
  calm: { slump: 1.7, lookAround: 1.2, fidget: 0.8, roar: 0.35, hop: 0.7 },
  alert: { lookAround: 2.4, sniff: 1.7, inspectHand: 1.3, slump: 0.2, chomp: 0.7 },
  wired: { fidget: 2.4, hop: 2.2, shake: 1.8, shiver: 1.4, slump: 0.1, stretch: 0.5 },
  hostile: { roar: 3.5, chomp: 2.2, shake: 1.5, lookAround: 0.5, stretch: 0.35, slump: 0.1, inspectHand: 0.2 },
  spent: { slump: 3, stretch: 1.5, shiver: 1.2, fidget: 0.4, hop: 0.1, roar: 0.2 },
};

// Enter a mood at the first threshold, leave it only at the second: without the
// gap a drive sitting on the line would flicker between two moods every frame.
const GATES = [
  // anger outranks exhaustion: a furious creature that is also worn out is
  // still, first of all, furious
  ['hostile', (d) => d.anger, 0.5, 0.3],
  ['spent', (d) => d.fatigue, 0.72, 0.5],
  ['wired', (d) => d.arousal, 0.62, 0.42],
  ['alert', (d) => Math.max(d.attention, d.arousal * 1.4), 0.42, 0.24],
];

export function createMood() {
  const d = { arousal: 0, anger: 0, fatigue: 0, attention: 0 };
  let id = 'calm';
  let sincePoke = 99;
  let streak = 0;

  return {
    drives: d,
    get id() { return id; },
    get label() { return MOODS[id].label; },
    get bias() { return BIAS[id]; },
    get pace() { return MOODS[id].pace; },

    reset() {
      d.arousal = d.anger = d.fatigue = d.attention = 0;
      id = 'calm';
      sincePoke = 99;
      streak = 0;
    },

    /**
     * A jab. Pokes that land in quick succession stack: one is a surprise,
     * five in a row is harassment, and a bold creature takes it worse.
     */
    poke(P) {
      streak = sincePoke < 1.6 ? Math.min(6, streak + 1) : 0;
      sincePoke = 0;
      d.arousal = clamp01(d.arousal + 0.5);
      d.anger = clamp01(d.anger + (0.1 + streak * 0.11) * (0.6 + (P?.boldness ?? 0.5)));
      d.fatigue = clamp01(d.fatigue + 0.012);
    },

    /** Anything short of a poke that gets its attention: a fast camera spin. */
    stir(amount) {
      d.arousal = clamp01(d.arousal + amount);
      d.attention = clamp01(d.attention + amount * 0.8);
    },

    /** `dt` is real seconds — mood must not speed up with a quick creature. */
    update(dt, sig, P) {
      const lazy = P?.laziness ?? 0.5;
      sincePoke += dt;

      d.attention = toward(d.attention, sig.hovering ? 1 : 0, sig.hovering ? 4 : 0.7, dt);
      // arousal always drains towards whatever attention is holding it at
      d.arousal = toward(d.arousal, d.attention * 0.28, 0.28 + (1 - lazy) * 0.28, dt);
      d.anger = toward(d.anger, 0, 0.12, dt);
      // Being worked up is tiring, standing about is not. The rates are per
      // second and deliberately small: it takes a minute or so of sustained
      // agitation to wear a creature out, and about as long to sleep it off.
      const load = d.arousal * 0.013 + (sig.acting ? 0.004 : 0) + d.anger * 0.012;
      d.fatigue = clamp01(d.fatigue + (load * (0.7 + lazy) - 0.028 * (1 - d.arousal)) * dt);

      for (const [name, read, enter, exit] of GATES) {
        const v = read(d);
        if (id === name ? v > exit : v > enter) { id = name; return; }
      }
      id = 'calm';
    },

    /**
     * The posture a mood holds between gestures. Written from the drives rather
     * than from the mood name, so it slides in and out instead of snapping, and
     * added to the same pose the gestures write — the animator still applies
     * every transform in one place.
     */
    posture(pose, t) {
      const { arousal, anger, fatigue, attention } = d;

      // riled up: hunched forward, arms out of the way, teeth showing
      pose.body.lean += anger * 0.2;
      pose.head.pitch += anger * 0.14;
      pose.arms[0].swing += anger * 0.3;
      pose.arms[1].swing += anger * 0.3;
      pose.arms[0].lift -= anger * 0.3;
      pose.arms[1].lift -= anger * 0.3;
      pose.eyes.squint += anger * 0.5;
      pose.jaw += anger * 0.5;
      pose.hair += anger * 1.4;

      // watching: drawn up, eyes open wide, hair on end
      const up = arousal * (1 - fatigue * 0.7);
      pose.body.lean -= up * 0.08;
      pose.head.pitch -= up * 0.09;
      pose.root.y += up * 0.012;
      pose.eyes.wide += (up + attention * 0.4) * 0.7;
      pose.hair += up * 0.5;

      // Worn out: everything sags and the eyes are half shut. The arms droop
      // only a little — the build leaves them just enough room to clear the
      // floor, and a gesture like `slump` spends most of it already.
      pose.body.lean += fatigue * 0.1;
      pose.head.pitch += fatigue * 0.22;
      pose.root.y -= fatigue * 0.03;
      pose.arms[0].lift += fatigue * 0.04;
      pose.arms[1].lift += fatigue * 0.04;
      pose.eyes.squint += fatigue * 0.55;

      // wound up and angry at the same time: a fine tremor no gesture produces
      const tremor = Math.min(arousal, 0.4 + anger) * arousal * 0.035;
      if (tremor > 0.001) {
        pose.head.roll += Math.sin(t * 31) * tremor;
        pose.root.x += Math.sin(t * 27) * tremor * 0.2;
      }
    },
  };
}
