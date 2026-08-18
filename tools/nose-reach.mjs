// Measures how far each kind of nose actually hangs below where it is planted:
//   node tools/nose-reach.mjs [creatures]
//
// features.js reserves room above the mouth for the nose from a table of
// reaches, one number per kind. The table was written by reading the code, and
// every entry in it was wrong — some by a factor of three — because the mesh
// that gets built is scaled by proportions and a warp roll the reader was not
// holding in their head. This builds the creatures and measures the noses.
// Feed the output back into NOSE_REACH.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { faceLimits } from '../src/creature/features.js';
const N = Number(process.argv[2] || 4000);
const worst = new Map();
for (let i=0;i<N;i++){
  const p = randomize(i*7+5);
  if (p.noseType==='none') continue;
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const hm = c.rig.headPivot.children[0];
  const L = faceLimits(p);
  let lo = Infinity;
  c.rig.headPivot.traverse(o=>{
    if(!o.isMesh||o.material?.side===THREE.BackSide||!o.userData.nose) return;
    const box=new THREE.Box3().setFromObject(o);
    lo = Math.min(lo, hm.worldToLocal(new THREE.Vector3(0,box.min.y,0)).y);
  });
  if (lo!==Infinity) {
    const reach = (L.noseY - lo) / L.noseSize;
    const e = worst.get(p.noseType) ?? { max:-9, n:0 };
    e.n++; e.max = Math.max(e.max, reach);
    worst.set(p.noseType, e);
  }
  c.dispose();
}
for (const [k,v] of [...worst].sort()) console.log(k.padEnd(8), 'n', String(v.n).padStart(4), 'max reach', v.max.toFixed(2));
