import * as THREE from 'three';
import { groundHeight, riverX, PIER, pierDeckY } from '../field.js';
import { makeAnimal } from '../animals.js';

// The estuary's birds. A grey heron working the river edge — statue, strike,
// gulp, and a heavy offended departure if crowded — and a pair of cormorants
// out on the pier's unreachable stumps, holding their wings open to dry the
// way cormorants have stood since before anyone was watching.

/* ------------------------------------------------------------------- heron */

const HERON_SPOTS = [
  { x: () => riverX(44) + 4.5, z: 44 },
  { x: () => riverX(86) - 5, z: 86 },
];

// The pack's heron. Its `strike` clip is the dart, one shot of half a second
// (LoopOnce), played from the top each time the heron strikes.
function makeHeronMesh(animals) {
  const g = new THREE.Group();
  const a = makeAnimal(animals, 'heron');
  g.add(a.seat);
  const strike = a.actions.strike;
  strike.setLoop(THREE.LoopOnce, 1);
  g.userData = { mixer: a.mixer, strike };
  return g;
}

export function makeHeron(scene, audio, animals) {
  const heron = makeHeronMesh(animals);
  scene.add(heron);
  const home = { x: riverX(60), z: 60, radius: 80 };

  let at = 0;
  place(at);
  function place(i) {
    const s = HERON_SPOTS[i];
    const x = s.x();
    heron.position.set(x, groundHeight(x, s.z) + 0.02, s.z);
    heron.rotation.y = Math.random() * Math.PI * 2;
  }

  const state = { mode: 'stand', t: 4, flyT: 0 };
  const from = new THREE.Vector3(), to = new THREE.Vector3();

  function update(dt, ctx) {
    const px = ctx.playerPos.x, pz = ctx.playerPos.z;

    if (state.mode === 'fly') {
      state.flyT += dt;
      const p = Math.min(1, state.flyT / 5);
      heron.position.lerpVectors(from, to, p);
      heron.position.y += Math.sin(p * Math.PI) * 6;
      heron.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
      heron.rotation.x = Math.sin(state.flyT * 4) * 0.1;   // heavy slow flaps, felt in the body
      if (p >= 1) {
        state.mode = 'stand';
        state.t = 6;
        heron.rotation.x = 0;
      }
    } else {
      const d = Math.hypot(heron.position.x - px, heron.position.z - pz);
      if (d < 9) {
        at = 1 - at;
        const s = HERON_SPOTS[at];
        from.copy(heron.position);
        to.set(s.x(), groundHeight(s.x(), s.z) + 0.02, s.z);
        state.mode = 'fly';
        state.flyT = 0;
        if (audio) audio.croak(THREE.MathUtils.clamp((heron.position.x - px) / 30, -1, 1));
      } else {
        state.t -= dt;
        if (state.mode === 'stand' && state.t <= 0) {
          // The dart: head drops fast, holds, comes up with the gulp.
          state.mode = 'strike';
          state.t = 0.5;
          heron.userData.strike.reset().play();
        } else if (state.mode === 'strike' && state.t <= 0) {
          state.mode = 'stand';
          state.t = 7 + Math.random() * 14;
        }
      }
    }

    heron.userData.mixer.update(dt);

    if (ctx.journal && state.mode !== 'fly') {
      ctx.journal.focus('heron', heron.position, dt, ctx.camera);
    }
  }

  return { group: heron, home, update };
}

/* -------------------------------------------------------------- cormorants */

// The pack's cormorant, wings open. Its `dry` clip is the slow half-fold and
// re-spread, one cycle at 0.3 rad/s.
function makeCormorantMesh(animals) {
  const g = new THREE.Group();
  const a = makeAnimal(animals, 'cormorant');
  g.add(a.seat);
  g.userData = { mixer: a.mixer, dry: a.actions.dry };
  return g;
}

export function makeCormorants(scene, audio, animals) {
  const group = new THREE.Group();
  scene.add(group);
  const home = { x: PIER.x, z: PIER.stumpEnd + 4, radius: 60 };

  const birds = [];
  for (const [sx, z] of [[-1, PIER.stumpEnd + 2], [1, PIER.stumpEnd + 6.5]]) {
    const b = makeCormorantMesh(animals);
    const x = PIER.x + sx * (PIER.halfW - 0.25);
    // Stump tops sit around a metre under the deck line; the birds stand ON
    // them, not near them — a floating silhouette reads instantly as a bug.
    b.position.set(x, pierDeckY(z) - 0.95, z);
    b.rotation.y = Math.random() * 6.28;
    group.add(b);
    const phase = Math.random() * 6.28;
    b.userData.dry.play();
    b.userData.dry.time = phase / 0.3;
    birds.push({ mesh: b, phase });
  }

  let t = 0;

  function update(dt, ctx) {
    // Wing-drying is the act. A slow half-fold and re-spread every so often is
    // all the animation it needs — cormorants are patient.
    t += dt;
    for (const b of birds) {
      b.mesh.userData.mixer.update(dt);
      b.mesh.rotation.y += Math.sin(t * 0.11 + b.phase) * dt * 0.05;
    }
    // Roost at deep night.
    group.visible = ctx.nightT < 0.85;
    if (group.visible && ctx.journal) {
      ctx.journal.focus('cormorant', birds[0].mesh.position, dt, ctx.camera);
    }
  }

  return { group, home, update };
}
