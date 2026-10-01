import * as THREE from 'three';
import { groundHeight, mulberry32 } from '../field.js';
import {
  FIREFLY, fireflyField, fireflyAnchor, owlPerches, HUNT, huntTarget, huntReturn, huntPos,
} from './nightpaths.js';
import { makeAnimal } from '../animals.js';

// The dusk-and-dark set, small enough to share a file: fireflies in the dune
// hollows at half-light, some of them drifting down to the fire as it gets
// dark; an owl on a dead snag deeper in, which hunts the dunes now and then;
// bats stitching the air over the camp. Each is its own entity in the
// registry; they share only this module. Where the fireflies and the owl go is
// nightpaths.js, which the Node suite can read.

/* ---------------------------------------------------------------- fireflies */

export function makeFireflies(scene) {
  const COUNT = FIREFLY.count;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  // The fourteen nearest the camp drift in to the fire as the dark comes
  // down (nightpaths.js); the rest keep to the hollows.
  const flies = fireflyField();
  flies.forEach((f, i) => { pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z; });
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
  const anchor = {};

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
      const a = fireflyAnchor(f, ctx.nightT, anchor);
      const w = a.k ? FIREFLY.wanderHome + (FIREFLY.wanderFire - FIREFLY.wanderHome) * a.k : FIREFLY.wanderHome;
      const wx = a.x + Math.sin(t * 0.31 + f.wander) * w;
      const wy = a.y + Math.sin(t * 0.53 + f.wander * 2) * 0.5;
      const wz = a.z + Math.cos(t * 0.24 + f.wander) * w;
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

export function makeOwl(scene, audio, animals) {
  const group = new THREE.Group();
  scene.add(group);

  const snagMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });

  // Two dead snags; the owl moves between them if pressed.
  const perches = owlPerches();
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
  }

  // The pack's owl; the snags stay built here. Its `head` node is the game's.
  const owl = new THREE.Group();
  const model = makeAnimal(animals, 'owl');
  owl.add(model.seat);
  group.add(owl);
  owl.userData = { head: model.nodes.head };

  const home = { x: perches[0].x, z: perches[0].z, radius: 70 };
  let at = 0, flying = 0;
  const from = new THREE.Vector3(), to = new THREE.Vector3();

  owl.position.set(perches[0].x, perches[0].y, perches[0].z);
  owl.name = 'owl';     // for the ?debug beat, which reads it off the scene graph

  // The hunt (nightpaths.js): a clock, not a steered flight, so the ?debug
  // hook can start one at any point of it and the suite can read where it is.
  const rnd = mulberry32(0x0071);
  const hunt = { on: false, t: 0, from: null, target: null, to: 0, count: 0 };
  let huntTimer = HUNT.firstLo + rnd() * (HUNT.firstHi - HUNT.firstLo);
  let out = false;
  const hp = {};
  let lastPlayer = { x: 0, z: 0 };

  function startHunt(p0) {
    const target = huntTarget(perches[at], lastPlayer, rnd);
    if (!target) return null;
    hunt.on = true;
    hunt.t = p0 * HUNT.dur;
    hunt.from = perches[at];
    hunt.target = target;
    hunt.to = huntReturn(perches, target);
    hunt.count++;
    flying = 0;
    return target;
  }

  function update(dt, ctx) {
    out = ctx.nightT > 0.7;
    owl.visible = out;
    if (!out) {
      // Back on the snag by first light, and the first hunt of the next night
      // waits its turn like the first one did.
      if (hunt.on) { hunt.on = false; owl.position.set(perches[at].x, perches[at].y, perches[at].z); }
      huntTimer = HUNT.firstLo + rnd() * (HUNT.firstHi - HUNT.firstLo);
      return;
    }

    const px = ctx.playerPos.x, pz = ctx.playerPos.z;
    lastPlayer.x = px; lastPlayer.z = pz;

    if (hunt.on) {
      hunt.t += dt;
      const p = Math.min(1, hunt.t / HUNT.dur);
      const was = hp.x === undefined ? null : { x: hp.x, z: hp.z };
      huntPos(hunt.from, hunt.target, perches[hunt.to], p, hp);
      owl.position.set(hp.x, hp.y, hp.z);
      if (was && (hp.x !== was.x || hp.z !== was.z)) {
        owl.rotation.y = Math.atan2(-(hp.z - was.z), hp.x - was.x);
      }
      if (p >= 1) {
        hunt.on = false;
        at = hunt.to;
        huntTimer = HUNT.everyLo + rnd() * (HUNT.everyHi - HUNT.everyLo);
      }
    } else if (flying > 0) {
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
        // The head tracks the walker. Most of the night that is the whole
        // act, and it is enough.
        // lookAt points a node's +Z; the model's face is its -Z, so half round.
        owl.userData.head.lookAt(px, owl.position.y + 0.26, pz);
        owl.userData.head.rotateY(Math.PI);
        huntTimer -= dt;
        if (huntTimer <= 0) {
          huntTimer = HUNT.everyLo + rnd() * (HUNT.everyHi - HUNT.everyLo);
          startHunt(0);
        }
      }
    }
    if (!hunt.on) { hp.x = undefined; }

    if (ctx.journal) ctx.journal.focus('owl', owl.position, dt, ctx.camera);
  }

  // For the ?debug hook and nothing else: start a hunt now, `p` of the way
  // through (0 to 1). Refused (false) by day, when the owl is not out.
  function forceHunt(p = 0) {
    if (!out) return false;
    return startHunt(Math.max(0, Math.min(1, p))) || false;
  }
  const info = () => ({
    out, hunting: hunt.on, hunts: hunt.count, perch: at,
    target: hunt.target && { ...hunt.target }, returnTo: hunt.to,
    perches: perches.map(p => ({ x: p.x, y: p.y, z: p.z })),
  });

  return { group, home, update, forceHunt, info };
}

/* -------------------------------------------------------------------- bats */

export function makeBats(scene, animals) {
  const COUNT = 4;
  const rnd = mulberry32(0xba75);
  const group = new THREE.Group();
  scene.add(group);
  const bats = [];
  for (let i = 0; i < COUNT; i++) {
    // The pack's bat: no clip (#659), two wing nodes the loop below beats.
    const g = new THREE.Group();
    const model = makeAnimal(animals, 'bat');
    g.add(model.seat);
    g.userData = { wingR: model.nodes.wingR, wingL: model.nodes.wingL };
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
      // A beat about the forward axis, tips up and down together (#663).
      const flap = Math.sin(t * b.flap);
      b.mesh.userData.wingR.rotation.z = flap * 0.9;
      b.mesh.userData.wingL.rotation.z = -flap * 0.9;
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
