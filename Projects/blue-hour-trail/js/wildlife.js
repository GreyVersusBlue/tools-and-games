import * as THREE from 'three';
import { groundHeight, trailPoint, trailInfo, TRAIL, LAYOUT } from './field.js';

// The mountain's population: deer that watch you before they decide, small
// birds working the perches, crows above the canopy, a squirrel, an owl, and
// a fox that crosses the trail exactly once. Everything is primitives and a
// timer-driven state machine — Golden Hour's dolphin pattern, seven times
// over. The dread system lives in dread.js; the line between them is that
// everything in THIS file is really there.

/* ----------------------------------------------------------------- makers */

function makeDeer() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5a4a3c });
  const pale = new THREE.MeshLambertMaterial({ color: 0x8a7a66 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  body.scale.set(0.62, 0.5, 1.05);
  body.position.y = 1.05;
  g.add(body);

  for (const [lx, lz] of [[-0.22, 0.55], [0.22, 0.55], [-0.22, -0.55], [0.22, -0.55]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 1.0, 5), mat);
    leg.position.set(lx, 0.5, lz);
    g.add(leg);
  }

  // Neck and head pivot together so grazing/alert is one rotation.
  const headG = new THREE.Group();
  headG.position.set(0, 1.3, 0.85);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.75, 6), mat);
  neck.position.set(0, 0.3, 0.08);
  neck.rotation.x = 0.35;
  headG.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.46), mat);
  head.position.set(0, 0.65, 0.3);
  headG.add(head);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), pale);
    ear.position.set(side * 0.13, 0.82, 0.18);
    ear.rotation.z = side * -0.5;
    headG.add(ear);
  }
  g.add(headG);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), pale);
  tail.position.set(0, 1.25, -1.0);
  g.add(tail);

  g.userData.headG = headG;
  return g;
}

function makeSmallBird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a3f45, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0.6, 0.06, 0.14, 0.6, 0.06, -0.14,
  ], 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, mat);
  const wR = new THREE.Mesh(wingGeo.clone(), mat);
  wR.scale.x = -1;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat);
  body.scale.set(1.7, 0.9, 0.9);
  g.add(wL, wR, body);
  g.userData = { wL, wR };
  return g;
}

function makeCrow() {
  const g = makeSmallBird();
  g.scale.setScalar(2.2);
  g.traverse(o => { if (o.material) o.material = new THREE.MeshBasicMaterial({ color: 0x14161a, side: THREE.DoubleSide }); });
  return g;
}

function makeSquirrel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a4a34 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), mat);
  body.scale.set(0.8, 0.8, 1.4);
  body.position.y = 0.12;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat);
  tail.scale.set(0.6, 1.8, 0.6);
  tail.position.set(0, 0.22, -0.2);
  g.add(tail);
  return g;
}

function makeOwl() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x4e463c });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 7), mat);
  body.scale.set(0.9, 1.25, 0.8);
  body.position.y = 0.24;
  g.add(body);
  const headG = new THREE.Group();
  headG.position.y = 0.52;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 7), mat);
  headG.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8c86a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 5, 4), eyeMat);
    eye.position.set(side * 0.06, 0.03, 0.11);
    headG.add(eye);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), mat);
    tuft.position.set(side * 0.09, 0.13, 0);
    headG.add(tuft);
  }
  g.add(headG);
  g.userData.headG = headG;
  return g;
}

function makeFox() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x7a4630 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat);
  body.scale.set(0.75, 0.65, 1.7);
  body.position.y = 0.34;
  g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), mat);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.42, 0.45);
  g.add(head);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat);
  tail.scale.set(0.7, 0.7, 2.2);
  tail.position.set(0, 0.36, -0.5);
  g.add(tail);
  for (const [lx, lz] of [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.22], [0.1, -0.22]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.32, 4), new THREE.MeshLambertMaterial({ color: 0x2e2019 }));
    leg.position.set(lx, 0.16, lz);
    g.add(leg);
  }
  return g;
}

/* -------------------------------------------------------------------- build */

export function buildWildlife(scene, audio) {
  // ---- deer ----
  const deer = [];
  for (let i = 0; i < 3; i++) {
    const d = makeDeer();
    const c = LAYOUT.clearings[(i * 4 + 1) % LAYOUT.clearings.length];
    d.position.set(c.x, groundHeight(c.x, c.z), c.z);
    d.rotation.y = i * 2.1;
    scene.add(d);
    deer.push({
      g: d, state: 'graze', t: Math.random() * 10,
      graze: 0, respawn: 0, bolt: null,
    });
  }

  // ---- small birds ----
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const b = makeSmallBird();
    const p = LAYOUT.perches[i % LAYOUT.perches.length];
    b.position.set(p.x, groundHeight(p.x, p.z) + p.h, p.z);
    scene.add(b);
    birds.push({
      g: b, state: 'perch', timer: 2 + Math.random() * 10,
      from: b.position.clone(), to: b.position.clone(), flyT: 0, flyDur: 1,
    });
  }

  // ---- crows ----
  const crows = [];
  for (let i = 0; i < 3; i++) {
    const c = makeCrow();
    scene.add(c);
    crows.push({
      g: c,
      orbit: {
        t: 0.15 + i * 0.3,       // where along the trail their circle sits
        r: 16 + Math.random() * 10,
        h: 17 + Math.random() * 8,
        speed: 0.2 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
        dir: Math.random() < 0.5 ? 1 : -1,
        flap: 1.1 + Math.random() * 0.6,
      },
      cawTimer: 15 + Math.random() * 40,
    });
  }

  // ---- squirrel ----
  const squirrel = makeSquirrel();
  squirrel.visible = false;
  scene.add(squirrel);
  const sq = { g: squirrel, state: 'hidden', timer: 20, tree: null, spiral: 0, hop: 0 };

  // ---- owl: on a low branch just off the trail's third quarter ----
  const owl = makeOwl();
  {
    const p = trailPoint(0.66);
    // nearest near-tier conifer to a spot off the trail's left shoulder
    let best = null, bestD = Infinity;
    for (const t of LAYOUT.trees) {
      if (t.tier !== 'near' || t.species !== 'conifer') continue;
      const d = Math.hypot(t.x - (p.x + -p.dz * 6), t.z - (p.z + p.dx * 6));
      if (d < bestD) { bestD = d; best = t; }
    }
    const bx = best ? best.x : p.x + 6, bz = best ? best.z : p.z;
    owl.position.set(bx + 0.8, groundHeight(bx, bz) + 3.6, bz);
  }
  scene.add(owl);
  const owlState = { hootTimer: 20, fled: false, fleeT: 0, from: null, to: null };

  // ---- fox: crosses once, somewhere in the middle third ----
  const fox = makeFox();
  fox.visible = false;
  scene.add(fox);
  const foxState = { done: false, timer: 240 + Math.random() * 180, active: false, t: 0, from: null, to: null };

  // ---- audio-only presence ----
  let elkTimer = 90;

  const state = { t: 0 };

  const tmpA = new THREE.Vector3();

  state.update = (dt, camera, controls, fogT) => {
    state.t += dt;
    const px = controls.pos.x, pz = controls.pos.z;

    // ---- deer ----
    for (const d of deer) {
      d.t += dt;
      const dist = Math.hypot(d.g.position.x - px, d.g.position.z - pz);
      if (d.state === 'graze') {
        // head down, drifting a step at a time
        d.g.userData.headG.rotation.x = 0.9 + Math.sin(d.t * 0.4) * 0.12;
        if (Math.sin(d.t * 0.23) > 0.92) {
          const step = 0.25 * dt;
          d.g.position.x += Math.sin(d.g.rotation.y) * step;
          d.g.position.z += Math.cos(d.g.rotation.y) * step;
          d.g.position.y = groundHeight(d.g.position.x, d.g.position.z);
        }
        if (dist < 26) {
          d.state = 'alert';
          audio.rustle(0.6);
        }
      } else if (d.state === 'alert') {
        // The freeze. Head up, facing you, absolutely still — the animal
        // deciding whether you are a problem. This is the spooky beat that
        // wildlife does for free.
        d.g.userData.headG.rotation.x = -0.1;
        tmpA.set(px, d.g.position.y, pz);
        d.g.lookAt(tmpA);
        if (dist < 13) {
          d.state = 'bolt';
          d.bolt = {
            dx: (d.g.position.x - px) / dist,
            dz: (d.g.position.z - pz) / dist,
            t: 0,
          };
          d.g.rotation.y = Math.atan2(d.bolt.dx, d.bolt.dz);
          audio.deerThump();
        } else if (dist > 34) {
          d.state = 'graze';
        }
      } else if (d.state === 'bolt') {
        d.bolt.t += dt;
        const speed = 9;
        d.g.position.x += d.bolt.dx * speed * dt;
        d.g.position.z += d.bolt.dz * speed * dt;
        d.g.position.y = groundHeight(d.g.position.x, d.g.position.z);
        d.g.position.y += Math.abs(Math.sin(d.bolt.t * 8)) * 0.25;   // bounding
        if (d.bolt.t > 4) {                       // the fog has taken it
          d.g.visible = false;
          d.state = 'hidden';
          d.respawn = 60 + Math.random() * 80;
        }
      } else {   // hidden
        d.respawn -= dt;
        if (d.respawn <= 0) {
          // Reappear in a clearing 30–60 m from wherever the walker is now.
          const options = LAYOUT.clearings.filter(c => {
            const cd = Math.hypot(c.x - px, c.z - pz);
            return cd > 30 && cd < 60;
          });
          const c = options[(Math.random() * options.length) | 0] || LAYOUT.clearings[0];
          d.g.position.set(c.x, groundHeight(c.x, c.z), c.z);
          d.g.rotation.set(0, Math.random() * 6.28, 0);
          d.g.visible = true;
          d.state = 'graze';
        }
      }
    }

    // ---- small birds ----
    for (const b of birds) {
      if (b.state === 'perch') {
        b.timer -= dt;
        const flap = Math.max(0, Math.sin(state.t * 14 + b.flyT));
        b.g.userData.wL.rotation.x = flap * 0.15;
        b.g.userData.wR.rotation.x = -flap * 0.15;
        if (b.timer <= 0) {
          // pick another perch within earshot of the walker
          const near = LAYOUT.perches.filter(p =>
            Math.hypot(p.x - px, p.z - pz) < 60 &&
            Math.hypot(p.x - b.g.position.x, p.z - b.g.position.z) > 4);
          const p = near[(Math.random() * near.length) | 0];
          if (p) {
            b.from.copy(b.g.position);
            b.to.set(p.x, groundHeight(p.x, p.z) + p.h, p.z);
            b.flyDur = 1 + b.from.distanceTo(b.to) / 14;
            b.flyT = 0;
            b.state = 'fly';
          } else {
            b.timer = 3;
          }
        }
      } else {
        b.flyT += dt;
        const f = Math.min(1, b.flyT / b.flyDur);
        b.g.position.lerpVectors(b.from, b.to, f);
        b.g.position.y += Math.sin(f * Math.PI) * 3;      // over, not through
        b.g.lookAt(b.to.x, b.g.position.y, b.to.z);
        const flap = Math.sin(b.flyT * 26);
        b.g.userData.wL.rotation.x = flap * 0.8;
        b.g.userData.wR.rotation.x = -flap * 0.8;
        if (f >= 1) {
          b.state = 'perch';
          b.timer = 4 + Math.random() * 11;
          if (Math.random() < 0.5) audio.bird('chirp');
        }
      }
    }

    // ---- crows: circling somewhere over the walker's stretch of trail ----
    for (const c of crows) {
      const o = c.orbit;
      const anchor = trailPoint(o.t);
      const a = state.t * o.speed * o.dir + o.phase;
      c.g.position.set(
        anchor.x + Math.cos(a) * o.r,
        groundHeight(anchor.x, anchor.z) + o.h + Math.sin(state.t * 0.3 + o.phase) * 1.5,
        anchor.z + Math.sin(a) * o.r);
      c.g.rotation.y = -a * o.dir + (o.dir > 0 ? Math.PI : 0);
      const flap = Math.sin(state.t * o.flap * 4 + o.phase);
      c.g.userData.wL.rotation.x = flap * 0.5;
      c.g.userData.wR.rotation.x = -flap * 0.5;
      c.cawTimer -= dt;
      if (c.cawTimer <= 0) {
        c.cawTimer = 18 + Math.random() * 45;
        audio.crowCaw();
      }
    }

    // ---- squirrel ----
    if (sq.state === 'hidden') {
      sq.timer -= dt;
      if (sq.timer <= 0) {
        // appear on the trail edge a little ahead of the walker
        const pt = trailInfo(px, pz);
        const ahead = trailPoint(Math.min(0.98, pt.t + 12 / TRAIL.length));
        sq.g.position.set(ahead.x + -ahead.dz * 2.5, 0, ahead.z + ahead.dx * 2.5);
        sq.g.position.y = groundHeight(sq.g.position.x, sq.g.position.z);
        sq.g.visible = true;
        sq.state = 'ground';
      }
    } else if (sq.state === 'ground') {
      sq.hop += dt * 3;
      sq.g.position.y = groundHeight(sq.g.position.x, sq.g.position.z) + Math.abs(Math.sin(sq.hop)) * 0.08;
      const dist = Math.hypot(sq.g.position.x - px, sq.g.position.z - pz);
      if (dist < 8) {
        // nearest near tree, then up it
        let best = null, bestD = Infinity;
        for (const t of LAYOUT.trees) {
          if (t.tier !== 'near') continue;
          const d = Math.hypot(t.x - sq.g.position.x, t.z - sq.g.position.z);
          if (d < bestD) { bestD = d; best = t; }
        }
        sq.tree = best;
        sq.spiral = 0;
        sq.state = 'climb';
        audio.rustle(1.2);
      }
    } else if (sq.state === 'climb' && sq.tree) {
      sq.spiral += dt;
      const th = sq.spiral * 9;
      const h = sq.spiral * 2.4;
      sq.g.position.set(
        sq.tree.x + Math.cos(th) * 0.28,
        groundHeight(sq.tree.x, sq.tree.z) + h,
        sq.tree.z + Math.sin(th) * 0.28);
      if (h > 6) {
        sq.g.visible = false;
        sq.state = 'hidden';
        sq.timer = 40 + Math.random() * 50;
      }
    }

    // ---- owl ----
    if (!owlState.fled) {
      const od = Math.hypot(owl.position.x - px, owl.position.z - pz);
      if (od < 20) {
        tmpA.set(px, owl.position.y, pz);
        owl.userData.headG.lookAt(tmpA);   // just the head. Just the head.
      }
      owlState.hootTimer -= dt;
      if (owlState.hootTimer <= 0) {
        owlState.hootTimer = 25 + Math.random() * 35;
        if (od < 70) audio.owlHoot();
      }
      if (od < 6) {
        owlState.fled = true;
        owlState.fleeT = 0;
        owlState.from = owl.position.clone();
        owlState.to = owl.position.clone().add(new THREE.Vector3(
          (owl.position.x - px) * 3, 6, (owl.position.z - pz) * 3).setLength(50));
        audio.rustle(1.5);
      }
    } else if (owlState.fleeT < 1) {
      owlState.fleeT += dt / 5;
      owl.position.lerpVectors(owlState.from, owlState.to, owlState.fleeT);
      owl.lookAt(owlState.to);
      if (owlState.fleeT >= 1) owl.visible = false;
    }

    // ---- fox ----
    if (!foxState.done) {
      if (!foxState.active) {
        foxState.timer -= dt;
        if (foxState.timer <= 0 && controls.enabled) {
          const pt = trailInfo(px, pz);
          const cross = trailPoint(Math.min(0.97, pt.t + 22 / TRAIL.length));
          const perp = { x: -cross.dz, z: cross.dx };
          foxState.from = new THREE.Vector3(cross.x + perp.x * 14, 0, cross.z + perp.z * 14);
          foxState.to = new THREE.Vector3(cross.x - perp.x * 14, 0, cross.z - perp.z * 14);
          foxState.active = true;
          foxState.t = 0;
          fox.visible = true;
        }
      } else {
        foxState.t += dt / 3.2;
        fox.position.lerpVectors(foxState.from, foxState.to, foxState.t);
        fox.position.y = groundHeight(fox.position.x, fox.position.z);
        fox.lookAt(foxState.to.x, fox.position.y, foxState.to.z);
        fox.position.y += Math.abs(Math.sin(foxState.t * 26)) * 0.1;
        if (foxState.t >= 1) {
          fox.visible = false;
          foxState.done = true;
          audio.rustle(0.8);
        }
      }
    }

    // ---- the herd you never see ----
    elkTimer -= dt;
    if (elkTimer <= 0 && controls.enabled) {
      elkTimer = 180 + Math.random() * 120;
      audio.elkBugle();
    }
  };

  return state;
}
