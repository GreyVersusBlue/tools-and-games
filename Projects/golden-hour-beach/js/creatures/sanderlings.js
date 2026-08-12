import * as THREE from 'three';
import { groundHeight, shorelineZ, beachSlope } from '../field.js';

// Sanderlings: the little birds that chase the edge of every wave out and
// sprint back in ahead of the next one. The signature piece of the bestiary,
// because everyone has watched the real thing — which is why the flock is
// driven by ctx.swashLevel, the same number the visible water rises and falls
// on, and not by any private clock. If the water and the birds ever disagree,
// the birds are wrong.
//
// One InstancedMesh, ten birds, one draw call. States live on the flock:
//   FORAGE  — track the waterline (out as it retreats, in ahead of run-up),
//             individual birds jittering, pausing, probing
//   FLUSH   — the player got within ~6 m: everybody up, a short low flight
//             30 m along the beach, land, resume
// Entity convention: { group, home, update(dt, ctx) }.

const COUNT = 10;

function birdGeometry() {
  const body = new THREE.SphereGeometry(0.09, 8, 6);
  body.scale(1.7, 0.9, 0.8);
  const head = new THREE.SphereGeometry(0.05, 6, 5);
  head.translate(0.13, 0.07, 0);
  const geos = [body, head].map(g => g.toNonIndexed());
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off);
    nor.set(g.attributes.normal.array, off);
    off += g.attributes.position.count * 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

export function makeSanderlings(scene, audio) {
  const mesh = new THREE.InstancedMesh(
    birdGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 }),
    COUNT,
  );
  scene.add(mesh);

  const home = { x: -70, z: -4, radius: 90 };

  // Per-bird offsets from the flock line, and their scratch state.
  const birds = [];
  for (let i = 0; i < COUNT; i++) {
    birds.push({
      ox: (Math.random() - 0.5) * 14,
      oz: (Math.random() - 0.5) * 1.6,
      phase: Math.random() * 6.28,
      x: home.x, z: home.z, y: 0,
      yaw: 0,
      peck: 0,
    });
  }

  const state = {
    mode: 'forage',
    cx: home.x,          // flock centre wanders the home stretch slowly
    drift: 8,
    flushT: 0,
    flushDir: 1,
    peepT: 2,
  };

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let ctxTime = 0;

  function update(dt, ctx) {
    // Sanderlings roost after dark.
    const active = ctx.nightT < 0.7;
    mesh.visible = active;
    if (!active) return;

    // Where the water's edge is right now, at the flock's x.
    const sz = shorelineZ(state.cx);
    const edgeZ = sz + ctx.waterY / beachSlope();

    // The flock line: just seaward of the edge as the water retreats
    // (swashLevel falling), a couple of metres inland of it as it runs up.
    const targetZ = edgeZ + 1.2 + ctx.swashLevel * 2.6;

    // Slow wander along the beach. Slow matters: the whole flock working the
    // same forty-metre stretch for a while is what real sanderlings do, and
    // it is also what lets a watcher actually watch them — at the first
    // tuning this drifted a metre a second and the journal's attention timer
    // could never catch the flock before it left the frame.
    state.cx += state.drift * dt * 0.04;
    if (state.cx > home.x + home.radius * 0.4) state.drift = -Math.abs(state.drift);
    if (state.cx < home.x - home.radius * 0.4) state.drift = Math.abs(state.drift);

    const px = ctx.playerPos.x, pz = ctx.playerPos.z;

    if (state.mode === 'forage') {
      const near = birds.some(b => Math.hypot(b.x - px, b.z - pz) < 6);
      if (near) {
        state.mode = 'flush';
        state.flushT = 0;
        state.flushDir = px > state.cx ? -1 : 1;   // away from the player
        if (audio) audio.peep(0, 1.2);
      }
    } else {
      state.flushT += dt;
      if (state.flushT > 4.5) {
        state.mode = 'forage';
        state.cx += state.flushDir * 30;
      }
    }

    // Occasional contact peeps while foraging.
    state.peepT -= dt;
    if (state.peepT <= 0 && audio) {
      state.peepT = 3 + Math.random() * 6;
      const pan = THREE.MathUtils.clamp((state.cx - px) / 40, -1, 1);
      audio.peep(pan, 0.5);
    }

    for (let i = 0; i < COUNT; i++) {
      const b = birds[i];
      let tx, tz, ty;
      if (state.mode === 'flush') {
        const t = Math.min(1, state.flushT / 4.5);
        tx = state.cx + b.ox + state.flushDir * t * 30;
        tz = targetZ + b.oz - 2;
        ty = groundHeight(tx, tz) + 0.1 + Math.sin(t * Math.PI) * (2.2 + Math.sin(b.phase) * 0.5);
        b.x += (tx - b.x) * Math.min(1, dt * 6);
        b.z += (tz - b.z) * Math.min(1, dt * 6);
        b.y = ty;
        b.yaw = state.flushDir > 0 ? 0 : Math.PI;
      } else {
        // Twinkle-legged run: quick pursuit of the moving line, with per-bird
        // jitter and probing pauses when the water is out.
        tx = state.cx + b.ox + Math.sin(ctxTime * 0.7 + b.phase) * 1.2;
        tz = targetZ + b.oz;
        const k = Math.min(1, dt * 3.2);
        b.x += (tx - b.x) * k;
        b.z += (tz - b.z) * k;
        b.y = groundHeight(b.x, b.z) + 0.1;
        const vx = tx - b.x, vz = tz - b.z;
        if (Math.hypot(vx, vz) > 0.05) b.yaw = Math.atan2(-vz, vx);
        // Probe-peck while the water is low.
        b.peck = ctx.swashLevel < 0.35 && Math.sin(ctxTime * 2.4 + b.phase * 3) > 0.75 ? 0.7 : 0;
      }
      p.set(b.x, b.y, b.z);
      e.set(b.peck, b.yaw, 0);
      q.setFromEuler(e);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    mesh.instanceMatrix.needsUpdate = true;

    // One sighting position for the whole flock.
    if (ctx.journal) {
      p.set(state.cx, groundHeight(state.cx, targetZ), targetZ);
      ctx.journal.focus('sanderling', p, dt, ctx.camera);
    }
    ctxTime += dt;
  }

  return { group: mesh, home, update };
}
