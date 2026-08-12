import * as THREE from 'three';
import { groundHeight, trailX, mulberry32 } from '../field.js';

// The dusk-and-dark set, small enough to share a file: fireflies in the dune
// hollows at half-light, an owl on a dead snag deeper in, bats stitching the
// air over the camp. Each is its own entity in the registry; they share only
// this module.

/* ---------------------------------------------------------------- fireflies */

export function makeFireflies(scene) {
  const COUNT = 40;
  const rnd = mulberry32(0xf1fe);
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const flies = [];
  for (let i = 0; i < COUNT; i++) {
    const z = 56 + rnd() * 50;
    const x = trailX(z) + (rnd() - 0.5) * 26;
    const y = groundHeight(x, z) + 0.4 + rnd() * 1.4;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    flies.push({
      x, y, z,
      blink: rnd() * 6.28, wander: rnd() * 6.28,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const home = { x: 30, z: 80, radius: 60 };
  let t = 0;
  const sight = new THREE.Vector3();

  function update(dt, ctx) {
    // The half-light window: risen at dusk, gone by deep night. Additive
    // points with black vertex colours are invisible, so the blink is free.
    const window_ = Math.max(0, Math.sin(Math.min(1, Math.max(0, (ctx.nightT - 0.15) / 0.55)) * Math.PI));
    points.visible = window_ > 0.02;
    if (!points.visible) return;

    t += dt;
    const posA = geo.attributes.position, colA = geo.attributes.color;
    for (let i = 0; i < COUNT; i++) {
      const f = flies[i];
      const wx = f.x + Math.sin(t * 0.31 + f.wander) * 1.6;
      const wy = f.y + Math.sin(t * 0.53 + f.wander * 2) * 0.5;
      const wz = f.z + Math.cos(t * 0.24 + f.wander) * 1.6;
      posA.setXYZ(i, wx, wy, wz);
      const on = Math.max(0, Math.sin(t * 1.7 + f.blink)) ** 6;
      const g = on * window_;
      colA.setXYZ(i, g * 0.75, g, g * 0.25);
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;

    if (ctx.journal && window_ > 0.4) {
      sight.set(home.x, groundHeight(home.x, home.z) + 1, home.z);
      ctx.journal.focus('firefly', sight, dt, ctx.camera);
    }
  }

  return { group: points, home, update };
}

/* --------------------------------------------------------------------- owl */

export function makeOwl(scene, audio) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = new THREE.MeshStandardMaterial({ color: 0x9a8a74, roughness: 0.9 });
  const snagMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });

  // Two dead snags; the owl moves between them if pressed.
  const perches = [
    { x: trailX(88) - 9, z: 88 },
    { x: trailX(64) + 11, z: 66 },
  ];
  for (const p of perches) {
    const g = groundHeight(p.x, p.z);
    const snag = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.4, 6), snagMat);
    snag.position.set(p.x, g + 1.7, p.z);
    snag.rotation.z = 0.06;
    group.add(snag);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 5), snagMat);
    arm.position.set(p.x + 0.4, g + 2.6, p.z);
    arm.rotation.z = 1.2;
    group.add(arm);
    p.y = g + 3.4;
  }

  const owl = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 7), mat);
  body.scale.set(1, 1.5, 1);
  owl.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat);
  head.position.y = 0.26;
  owl.add(head);
  for (const sx of [-1, 1]) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 4), mat);
    tuft.position.set(sx * 0.06, 0.36, 0);
    owl.add(tuft);
  }
  group.add(owl);
  owl.userData = { head };

  const home = { x: perches[0].x, z: perches[0].z, radius: 70 };
  let at = 0, flying = 0;
  const from = new THREE.Vector3(), to = new THREE.Vector3();

  owl.position.set(perches[0].x, perches[0].y, perches[0].z);

  function update(dt, ctx) {
    const out = ctx.nightT > 0.7;
    owl.visible = out;
    if (!out) return;

    const px = ctx.playerPos.x, pz = ctx.playerPos.z;

    if (flying > 0) {
      flying -= dt;
      const p = 1 - flying / 3;
      owl.position.lerpVectors(from, to, p);
      owl.position.y += Math.sin(p * Math.PI) * 2.2;
      owl.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
    } else {
      const d = Math.hypot(owl.position.x - px, owl.position.z - pz);
      if (d < 6.5) {
        // Silent flight to the other snag.
        at = 1 - at;
        from.copy(owl.position);
        to.set(perches[at].x, perches[at].y, perches[at].z);
        flying = 3;
      } else {
        // The head tracks the walker. That is the whole act, and it is enough.
        owl.userData.head.lookAt(px, owl.position.y + 0.26, pz);
      }
    }

    if (ctx.journal) ctx.journal.focus('owl', owl.position, dt, ctx.camera);
  }

  return { group, home, update };
}

/* -------------------------------------------------------------------- bats */

export function makeBats(scene) {
  const COUNT = 4;
  const rnd = mulberry32(0xba75);
  const group = new THREE.Group();
  scene.add(group);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a1418, side: THREE.DoubleSide });
  const bats = [];
  for (let i = 0; i < COUNT; i++) {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const wing = new THREE.BufferGeometry();
      wing.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, sx * 0.22, 0.03, 0.1, sx * 0.22, 0.03, -0.1,
      ], 3));
      wing.computeVertexNormals();
      const w = new THREE.Mesh(wing, mat);
      g.add(w);
      g.userData[sx < 0 ? 'wL' : 'wR'] = w;
    }
    group.add(g);
    bats.push({
      mesh: g,
      cx: 12 + rnd() * 24, cz: 40 + rnd() * 40,
      h: 4 + rnd() * 3,
      a: rnd() * 6.28, flap: 14 + rnd() * 6,
      jink: rnd() * 100,
    });
  }

  const home = { x: 25, z: 55, radius: 70 };
  let t = 0;

  function update(dt, ctx) {
    const out = ctx.nightT > 0.3;
    group.visible = out;
    if (!out) return;
    t += dt;
    for (const b of bats) {
      b.a += dt * 1.6;
      // A smooth orbit made jagged: high-frequency jinks layered on top is
      // what separates a bat from a bird at a glance.
      const jx = Math.sin(t * 7.3 + b.jink) * 0.8 + Math.sin(t * 13.7 + b.jink * 2) * 0.35;
      const jy = Math.sin(t * 9.1 + b.jink) * 0.6;
      const x = b.cx + Math.cos(b.a) * 6 + jx;
      const z = b.cz + Math.sin(b.a * 1.3) * 5 + jx * 0.5;
      const y = groundHeight(x, z) + b.h + jy;
      b.mesh.position.set(x, y, z);
      const flap = Math.sin(t * b.flap);
      b.mesh.userData.wL.rotation.x = flap * 0.9;
      b.mesh.userData.wR.rotation.x = -flap * 0.9;
    }
    // A bat cannot be watched for 1.6 s — that is the whole point of a bat.
    // One clean look at the nearest one counts (glimpse, like the meteors).
    if (ctx.journal) {
      let best = null, bd = Infinity;
      for (const b of bats) {
        const d = b.mesh.position.distanceToSquared(ctx.playerPos);
        if (d < bd) { bd = d; best = b; }
      }
      if (best && bd < 900) ctx.journal.glimpse('bat', best.mesh.position, ctx.camera);
    }
  }

  return { group, home, update };
}
