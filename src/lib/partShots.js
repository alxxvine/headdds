import * as THREE from 'three';
import { buildCreature } from '../creature/build.js';
import { PARAM_BY_KEY } from '../creature/schema.js';

// The parts catalog as a FITTING ROOM: every kind of every part, rendered on
// the CURRENT freak — its colors, its skull, its skin — with just enough
// tweaked that the part in question is actually visible (hair needs hairs,
// teeth need an open mouth).
//
// Thumbnails are rendered lazily, one per tick, on a single offscreen
// renderer, cached per LOOK: each section keeps the shots for the creature as
// it is NOW. When the creature changes the old shots are dropped outright —
// a tile shows the placeholder until its fresh shot lands. Keeping the old
// ones as stand-ins read as the previous freak slowly mutating into the new.

const SHOT_W = 72;
const SHOT_H = 84;

// what the freak must wear for each family of parts to be legible;
// everything not mentioned stays the player's own, so the tiles read as
// THEIR creature with one thing swapped
const QUIET = { tendrils: 0, warts: 0, horns: 0, spores: 0 };
const BODY_SHOT = { ...QUIET, headRatio: 0.55, legLen: 1.0, armLen: 1.0 };

export const SECTIONS = [
  { key: 'armType', label: 'ARMS', frame: 'body', tweak: { ...BODY_SHOT, handType: 'ball' } },
  { key: 'handType', label: 'HANDS', frame: 'body', tweak: { ...BODY_SHOT, armType: 'stick', limbThick: 1.0 } },
  { key: 'legType', label: 'LEGS', frame: 'body', tweak: { ...BODY_SHOT, armType: 'none', legLen: 1.2 } },
  { key: 'footType', label: 'FEET', frame: 'body', tweak: { ...BODY_SHOT, armType: 'none', legLen: 1.2 } },
  { key: 'hairType', label: 'HAIR', frame: 'head', tweak: { ...QUIET, tendrils: 10, tendrilLen: 0.7 } },
  { key: 'eyeStyle', label: 'EYES', frame: 'head', tweak: { ...QUIET, eyeCount: 2, eyeSize: 0.2 } },
  { key: 'pupilShape', label: 'PUPILS', frame: 'head', tweak: { ...QUIET, eyeCount: 2, eyeSize: 0.3, pupilSize: 0.6 } },
  { key: 'mawShape', label: 'MAWS', frame: 'head', tweak: { ...QUIET, mouthWidth: 0.55, mouthOpen: 0.3 } },
  { key: 'toothType', label: 'TEETH', frame: 'head', tweak: { ...QUIET, mouthWidth: 0.55, mouthOpen: 0.4, teethTop: 8, teethBottom: 6, toothSize: 1.0 } },
  { key: 'noseType', label: 'NOSES', frame: 'head', tweak: { ...QUIET, noseSize: 0.22 } },
  { key: 'earType', label: 'EARS', frame: 'head', tweak: { ...QUIET, earSize: 0.42 } },
  { key: 'aura', label: 'AURAS', frame: 'full', tweak: { ...QUIET, spores: 90, auraSize: 0.5 } },
];

export const sectionOptions = (sec) => PARAM_BY_KEY[sec.key].options;

// ------------------------------------------------------------------ cache ---

// per section: the look its shots were taken of, and the shots themselves
const sections = new Map();

/**
 * The look fingerprint a section's tiles depend on. The section's OWN key is
 * left out: picking a tile changes that key, and the section's other tiles
 * must not re-bake because of it.
 */
function sectionRev(sec, params) {
  const base = { ...params };
  delete base[sec.key];
  const s = JSON.stringify(base);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function sectionState(sec, params) {
  const rev = sectionRev(sec, params);
  let st = sections.get(sec.key);
  if (!st || st.rev !== rev) {
    st = { rev, shots: new Map() };
    sections.set(sec.key, st);
  }
  return st;
}

/**
 * The thumbnail for the CURRENT look, or null. Checked against the live
 * params, so the moment the creature changes every tile goes back to the
 * placeholder instead of wearing the previous freak.
 */
export function peekShot(sec, params, value) {
  const st = sections.get(sec.key);
  if (!st || st.rev !== sectionRev(sec, params)) return null;
  return st.shots.get(value) || null;
}

// --------------------------------------------------------------- renderer ---

let ctx = null;
function ensureCtx() {
  if (ctx) return ctx;
  const canvas = document.createElement('canvas');
  canvas.width = SHOT_W;
  canvas.height = SHOT_H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  // the same light rig the stage uses, so a part looks in the catalog the way
  // it will look on a creature
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  scene.add(new THREE.HemisphereLight(0x8fa6c4, 0x241a2b, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 5, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7f6bb0, 0.9);
  fill.position.set(-5, 2, -3);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(34, SHOT_W / SHOT_H, 0.05, 100);
  ctx = { canvas, renderer, scene, camera };
  return ctx;
}

const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function renderShot(sec, base, value) {
  const { canvas, renderer, scene, camera } = ensureCtx();
  const params = { ...base, ...sec.tweak, [sec.key]: value };
  const built = buildCreature(params);
  scene.add(built.group);
  built.group.updateMatrixWorld(true);

  if (sec.frame === 'full') {
    _size.copy(built.fitSize);
    _center.copy(built.fitCenter);
  } else {
    const box = new THREE.Box3().setFromObject(
      sec.frame === 'head' ? built.rig.headPivot : built.rig.bodyPivot);
    box.getSize(_size);
    box.getCenter(_center);
  }
  const span = Math.max(_size.y, _size.x * (SHOT_H / SHOT_W) * 0.9, _size.z * 0.8);
  const dist = (span * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.3;
  camera.position.set(_center.x, _center.y + dist * 0.12, _center.z + dist);
  camera.lookAt(_center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  scene.remove(built.group);
  built.dispose();
  return url;
}

// ------------------------------------------------------------------ queue ---

// One shot per macrotask: a whole section takes a moment, but the panel never
// freezes and the tiles refresh one by one as they land.
const queue = [];
const queued = new Set();
let running = false;

function pump() {
  if (!queue.length) { running = false; return; }
  running = true;
  const job = queue.shift();
  queued.delete(job.id);
  // the creature changed while this job waited: the shot would be of a look
  // nobody is wearing any more
  const st = sections.get(job.sec.key);
  if (st === job.st && st.rev === job.rev && !st.shots.has(job.value)) {
    try {
      st.shots.set(job.value, renderShot(job.sec, job.base, job.value));
    } catch {
      // a lost WebGL context or an OOM: skip this tile rather than loop on it
      st.shots.set(job.value, null);
    }
    job.onShot?.();
  }
  setTimeout(pump, 16);
}

/** Queues every missing thumbnail of a section for the CURRENT look. */
export function ensureSection(sec, params, onShot) {
  const st = sectionState(sec, params);
  const base = { ...params };
  for (const o of sectionOptions(sec)) {
    const id = `${sec.key}:${st.rev}:${o.value}`;
    if (st.shots.has(o.value) || queued.has(id)) continue;
    queued.add(id);
    queue.push({ id, sec, st, rev: st.rev, base, value: o.value, onShot });
  }
  if (!running && queue.length) {
    running = true;
    setTimeout(pump, 0);
  }
}
