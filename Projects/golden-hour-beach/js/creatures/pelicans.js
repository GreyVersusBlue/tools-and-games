import * as THREE from 'three';
import { shorelineZ } from '../field.js';
import { makeAnimal } from '../animals.js';

// A pelican squadron: five heavy birds in a line, skimming the water just off
// the break, following the shoreline curve the whole length of the coast.
// This is where shorelineZ(x) pays for itself twice — the flight path is the
// shoreline offset seaward, and the wave-skimming altitude is just waterY + a
// couple of metres. The leader flies; the others sample the leader's path a
// few seconds behind (a position-history ring buffer), which is what makes a
// line of birds read as a line of birds.

const COUNT = 5;
const HISTORY = 240;             // ~4 s per follower gap at 60 fps
const GAP = 45;                  // history samples between birds

// The pack's pelican, wings across the body where the builder laid them fore
// and aft (#658). Its `fly` clip is the flap train's beat, 0.55 rad at 9 rad/s;
// between trains its weight fades to nothing and the wings rest flat, which is
// the glide (#662).
function makePelican(animals) {
  const g = new THREE.Group();
  const a = makeAnimal(animals, 'pelican');
  g.add(a.seat);
  g.userData = { mixer: a.mixer, fly: a.actions.fly, weight: 1 };
  return g;
}

export function makePelicans(scene, audio, animals) {
  const birds = [];
  const group = new THREE.Group();
  scene.add(group);
  for (let i = 0; i < COUNT; i++) {
    const b = makePelican(animals);
    // Each bird a beat behind the one ahead, as sin(t * 9 + i * 0.7) had it.
    b.userData.fly.play();
    b.userData.fly.time = (i * 0.7) / 9;
    group.add(b);
    birds.push(b);
  }

  const home = { x: 0, z: -30, radius: 900 };   // the whole coast — never culled

  const history = new Array(HISTORY).fill(null).map(() => new THREE.Vector3());
  let head = 0, filled = 0;
  let lx = -700, dir = 1;
  let flapClock = 0, croakT = 40;
  const sight = new THREE.Vector3();

  function leaderPos(x, waterY, out) {
    const z = shorelineZ(x) - 16 - Math.sin(x * 0.01) * 4;
    out.set(x, waterY + 2 + Math.sin(x * 0.05) * 0.5, z);
    return out;
  }

  function update(dt, ctx) {
    // Pelicans work the day shift.
    const active = ctx.nightT < 0.55;
    group.visible = active;
    if (!active) return;

    lx += dir * 10.5 * dt;
    if (lx > 720) dir = -1;
    if (lx < -720) dir = 1;

    leaderPos(lx, ctx.waterY, history[head]);
    head = (head + 1) % HISTORY;
    filled = Math.min(HISTORY, filled + 1);

    // Flap trains: everyone flaps for a few beats, then everyone glides.
    flapClock += dt;
    const train = (flapClock % 7) < 2.6;

    for (let i = 0; i < COUNT; i++) {
      const b = birds[i];
      const back = i * GAP;
      if (back >= filled) { b.visible = false; continue; }
      b.visible = true;
      const idx = ((head - 1 - back) % HISTORY + HISTORY) % HISTORY;
      const pos = history[idx];
      b.position.copy(pos);
      b.rotation.y = dir > 0 ? 0 : Math.PI;
      const u = b.userData;
      u.weight += ((train ? 1 : 0) - u.weight) * Math.min(1, dt * 5);
      u.fly.setEffectiveWeight(u.weight);
      u.mixer.update(dt);
    }

    croakT -= dt;
    if (croakT <= 0 && audio && Math.abs(lx - ctx.playerPos.x) < 120) {
      croakT = 50 + Math.random() * 60;
      audio.croak(THREE.MathUtils.clamp((lx - ctx.playerPos.x) / 100, -1, 1));
    }

    if (ctx.journal && birds[0].visible) {
      ctx.journal.focus('pelican', birds[0].position, dt, ctx.camera);
    }
  }

  return { group, home, update };
}
