import * as THREE from 'three';
import { groundHeight, riverX, PIER, pierDeckY } from '../field.js';

// The estuary's birds. A grey heron working the river edge — statue, strike,
// gulp, and a heavy offended departure if crowded — and a pair of cormorants
// out on the pier's unreachable stumps, holding their wings open to dry the
// way cormorants have stood since before anyone was watching.

/* ------------------------------------------------------------------- heron */

const HERON_SPOTS = [
  { x: () => riverX(44) + 4.5, z: 44 },
  { x: () => riverX(86) - 5, z: 86 },
];

function makeHeronMesh() {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x7d8894, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), grey);
  body.scale.set(1.6, 1, 0.8);
  body.position.y = 0.72;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 6), grey);
  neck.position.set(0.3, 1.1, 0);
  neck.rotation.z = -0.35;
  g.add(neck);
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), grey);
  head.add(skull);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.6 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.x = 0.22;
  head.add(beak);
  head.position.set(0.44, 1.42, 0);
  g.add(head);
  for (const sz of [-0.08, 0.08]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 4), grey);
    leg.position.set(0, 0.36, sz);
    g.add(leg);
  }
  g.userData = { head, body };
  return g;
}

export function makeHeron(scene, audio) {
  const heron = makeHeronMesh();
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
          state.mode = 'strike';
          state.t = 0.5;
        } else if (state.mode === 'strike') {
          // The dart: head drops fast, holds, comes up with the gulp.
          const p = 1 - state.t / 0.5;
          heron.userData.head.position.y = 1.42 - Math.sin(p * Math.PI) * 0.55;
          heron.userData.head.position.x = 0.44 + Math.sin(p * Math.PI) * 0.25;
          if (state.t <= 0) {
            state.mode = 'stand';
            state.t = 7 + Math.random() * 14;
            heron.userData.head.position.set(0.44, 1.42, 0);
          }
        }
      }
    }

    if (ctx.journal && state.mode !== 'fly') {
      ctx.journal.focus('heron', heron.position, dt, ctx.camera);
    }
  }

  return { group: heron, home, update };
}

/* -------------------------------------------------------------- cormorants */

function makeCormorantMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x232a2e, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 7), dark);
  body.scale.set(1.4, 1.1, 0.8);
  body.position.y = 0.2;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.34, 5), dark);
  neck.position.set(0.14, 0.48, 0);
  neck.rotation.z = -0.3;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), dark);
  head.position.set(0.24, 0.66, 0);
  g.add(head);
  const wings = [];
  for (const sx of [-1, 1]) {
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.2, 0, 0.05, 0.5, sx * 0.5, -0.15, 0.15, sx * 0.42,
    ], 3));
    wingGeo.computeVertexNormals();
    const w = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({
      color: 0x2c3438, roughness: 0.8, side: THREE.DoubleSide,
    }));
    g.add(w);
    wings.push(w);
  }
  g.userData = { wings };
  return g;
}

export function makeCormorants(scene, audio) {
  const group = new THREE.Group();
  scene.add(group);
  const home = { x: PIER.x, z: PIER.stumpEnd + 4, radius: 60 };

  const birds = [];
  for (const [sx, z] of [[-1, PIER.stumpEnd + 2], [1, PIER.stumpEnd + 6.5]]) {
    const b = makeCormorantMesh();
    const x = PIER.x + sx * (PIER.halfW - 0.25);
    // Stump tops sit around a metre under the deck line; the birds stand ON
    // them, not near them — a floating silhouette reads instantly as a bug.
    b.position.set(x, pierDeckY(z) - 0.95, z);
    b.rotation.y = Math.random() * 6.28;
    group.add(b);
    birds.push({ mesh: b, phase: Math.random() * 6.28 });
  }

  let t = 0;

  function update(dt, ctx) {
    // Wing-drying is the act. A slow half-fold and re-spread every so often is
    // all the animation it needs — cormorants are patient.
    t += dt;
    for (const b of birds) {
      const spread = 0.75 + Math.sin(t * 0.3 + b.phase) * 0.2;
      b.mesh.userData.wings[0].scale.set(spread, 1, spread);
      b.mesh.userData.wings[1].scale.set(spread, 1, spread);
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
