// Checks that the randomizer can actually reach what the panel offers:
//   node tools/roll-sweep.mjs [draws]
//
// Every parameter declares a range, and `randomize` may declare its own draw on
// top of it. When the two disagree nobody notices, because `sanitize` quietly
// clamps the result — so a draw that overshoots the bottom of the range does not
// error, it piles a slice of the whole population onto exactly the narrowest
// setting, and the far end of the panel is never generated at all. Six width
// sliders were doing both at once: 7.5% of creatures pinned to the minimum and
// the top tenth of the range never rolled.
//
// A draw that is deliberately lopsided is NOT a fault — half the freaks are
// meant to have no wear and no glow, and the style controls are meant to be
// fixed. So this measures the RAW draw against the range rather than the
// sanitized result: a bias is a choice, leaving the range is a bug.

import { PARAMS, randomize } from '../src/creature/schema.js';
import { makeRng } from '../src/lib/noise.js';

const N = Number(process.argv[2] || 20000);
const rng = makeRng(20260817);

let bad = 0;

for (const p of PARAMS) {
  if (!p.random || (p.type !== 'range' && p.type !== 'int')) continue;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < N; i++) {
    const v = p.random(rng, {});
    if (!Number.isFinite(v)) { console.log(`${p.key.padEnd(12)} rolled ${v}`); bad++; break; }
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const out = [];
  if (lo < p.min - 1e-9) out.push(`rolls down to ${lo.toFixed(3)}, range starts at ${p.min}`);
  if (hi > p.max + 1e-9) out.push(`rolls up to ${hi.toFixed(3)}, range ends at ${p.max}`);
  if (out.length) { bad++; console.log(`${p.key.padEnd(12)} ${out.join('; ')}`); }
}

// Selects have no clamp to hide behind — an option the randomizer never picks
// is a part nobody will ever see without finding the dropdown themselves.
const seen = new Map(PARAMS.filter((p) => p.type === 'select').map((p) => [p.key, new Map()]));
for (let i = 0; i < 4000; i++) {
  const c = randomize(i * 7 + 1);
  for (const p of PARAMS) {
    if (p.type !== 'select') continue;
    const m = seen.get(p.key);
    m.set(c[p.key], (m.get(c[p.key]) || 0) + 1);
  }
}
for (const p of PARAMS) {
  if (p.type !== 'select') continue;
  const m = seen.get(p.key);
  const missing = p.options.filter((o) => !m.has(o.value)).map((o) => o.value);
  const hog = [...m].find(([, n]) => n / 4000 > 0.55);
  const out = [];
  if (missing.length) out.push(`never rolled: ${missing.join(', ')}`);
  if (hog) out.push(`${hog[0]} takes ${(100 * hog[1] / 4000).toFixed(0)}%`);
  if (out.length) { bad++; console.log(`${p.key.padEnd(12)} ${out.join('; ')}`); }
}

console.log(`\n${PARAMS.length} parameters: ${bad
  ? `${bad} out of step with their own range`
  : 'every draw inside its range, every option reachable'}`);
