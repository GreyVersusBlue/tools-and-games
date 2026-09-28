import * as THREE from 'three';
import { groundHeight, trailPoint, trailInfo, TRAIL, LAYOUT } from './field.js';
import { makeAnimal } from './animals.js';

// The mountain's population: deer that watch you before they decide, small
// birds working the perches, crows above the canopy, a squirrel, an owl, and
// a fox that crosses the trail exactly once. Every one is a model from the
// animal pack (animals.js) driven by a timer-driven state machine — Golden
// Hour's dolphin pattern, seven times over. The dread system lives in dread.js; the line between them is that
// everything in THIS file is really there.

/* ----------------------------------------------------------------- makers */

// Each maker is the group its builder made, holding the pack's model in a seat
// (animals.js) rather than primitives. The group is what the creature code
// below moves and turns, in the builder's frame, exactly as before (#664).

function seated(animals, name) {
  const g = new THREE.Group();
  const a = makeAnimal(animals, name);
  g.add(a.seat);
  g.userData = { nodes: a.nodes, mixer: a.mixer, actions: a.actions };
  return g;
}

// The deer's head is a node: `graze` nods it while it grazes, and the game
// poses it for alert. The file rests in graze's first frame, head down (#673).
function makeDeer(animals) {
  const g = seated(animals, 'deer');
  g.userData.head = g.userData.nodes.head;
  g.userData.graze = g.userData.actions.graze;
  return g;
}

// Seven small birds, each its own group with wingR/wingL the game beats about
// the forward axis (#676). The builder's flap was a twist about the span.
function makeSmallBird(animals) {
  const g = seated(animals, 'small-bird');
  g.userData.wingR = g.userData.nodes.wingR;
  g.userData.wingL = g.userData.nodes.wingL;
  return g;
}

// The crow's model is at full size, so the group is no longer scaled 2.2; its
// wings are its `fly` clip (#676).
function makeCrow(animals) {
  const g = seated(animals, 'crow');
  g.userData.fly = g.userData.actions.fly;
  return g;
}

function makeSquirrel(animals) {
  return seated(animals, 'squirrel');
}

function makeOwl(animals) {
  const g = seated(animals, 'owl');
  g.userData.head = g.userData.nodes.head;
  return g;
}

function makeFox(animals) {
  return seated(animals, 'fox');
}

// `graze` from where the builder's sine would be at d.t: one period of
// 0.9 + 0.12 sin(0.4 t) is the clip's whole 15.7 s (#673).
function grazeFrom(d) {
  const a = d.g.userData.graze;
  a.reset().play();
  a.time = d.t % a.getClip().duration;
}

/* -------------------------------------------------------------------- build */

export function buildWildlife(scene, audio, animals) {
  // ---- deer ----
  const deer = [];
  for (let i = 0; i < 3; i++) {
    const d = makeDeer(animals);
    const c = LAYOUT.clearings[(i * 4 + 1) % LAYOUT.clearings.length];
    d.position.set(c.x, groundHeight(c.x, c.z), c.z);
    d.rotation.y = i * 2.1;
    scene.add(d);
    const rec = {
      g: d, state: 'graze', t: Math.random() * 10,
      graze: 0, respawn: 0, bolt: null,
    };
    grazeFrom(rec);
    deer.push(rec);
  }

  // ---- small birds ----
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const b = makeSmallBird(animals);
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
    const c = makeCrow(animals);
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
    // `fly` is one wingbeat of 0.5 rad, the builder's amplitude; it runs at
    // the builder's o.flap x 4 rad/s from the builder's phase (#676).
    const o = crows[i].orbit, fly = c.userData.fly, dur = fly.getClip().duration;
    fly.timeScale = o.flap * 4 * dur / (Math.PI * 2);
    fly.play();
    fly.time = ((o.phase / (Math.PI * 2)) % 1) * dur;
  }

  // ---- squirrel ----
  const squirrel = makeSquirrel(animals);
  squirrel.visible = false;
  scene.add(squirrel);
  const sq = { g: squirrel, state: 'hidden', timer: 20, tree: null, spiral: 0, hop: 0 };

  // ---- owl: on a low branch just off the trail's third quarter ----
  const owl = makeOwl(animals);
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
  const fox = makeFox(animals);
  fox.visible = false;
  scene.add(fox);
  const foxState = { done: false, timer: 240 + Math.random() * 180, active: false, t: 0, from: null, to: null };

  // ---- audio-only presence ----
  let elkTimer = 90;

  const state = { t: 0 };
  // The records the update below drives, for test/animals.mjs to read.
  state.animals = { deer, birds, crows, sq, owl: owlState, fox: foxState };

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
        d.g.userData.mixer.update(dt);
        if (Math.sin(d.t * 0.23) > 0.92) {
          const step = 0.25 * dt;
          d.g.position.x += Math.sin(d.g.rotation.y) * step;
          d.g.position.z += Math.cos(d.g.rotation.y) * step;
          d.g.position.y = groundHeight(d.g.position.x, d.g.position.z);
        }
        if (dist < 26) {
          d.state = 'alert';
          d.g.userData.graze.stop();
          audio.rustle(0.6);
        }
      } else if (d.state === 'alert') {
        // The freeze. Head up, facing you, absolutely still — the animal
        // deciding whether you are a problem. This is the spooky beat that
        // wildlife does for free.
        // The builder's -0.1, on a node turned a half turn (#673).
        d.g.userData.head.rotation.set(0.1, 0, 0);
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
          grazeFrom(d);
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
          grazeFrom(d);
        }
      }
    }

    // ---- small birds ----
    for (const b of birds) {
      if (b.state === 'perch') {
        b.timer -= dt;
        const flap = Math.max(0, Math.sin(state.t * 14 + b.flyT));
        b.g.userData.wingR.rotation.z = flap * 0.15;
        b.g.userData.wingL.rotation.z = -flap * 0.15;
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
        b.g.userData.wingR.rotation.z = flap * 0.8;
        b.g.userData.wingL.rotation.z = -flap * 0.8;
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
      // Along the circle's tangent, whichever way round it flies. The builder's
      // -a * dir + (dir > 0 ? π : 0) set a where the dir = -1 heading needs -a
      // (#670), which a body long across the wings never showed (#676).
      c.g.rotation.y = -a + (o.dir > 0 ? 0 : Math.PI);
      c.g.userData.mixer.update(dt);
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
        owl.userData.head.lookAt(tmpA);   // just the head. Just the head.
        owl.userData.head.rotateY(Math.PI);   // lookAt aims +Z; the beak is -Z (#675)
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
