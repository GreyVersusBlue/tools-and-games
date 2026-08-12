import * as THREE from 'three';
import { shorelineZ } from '../field.js';

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

function makePelican() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a7d6c, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat);
  body.scale.set(1.9, 0.75, 0.7);
  g.add(body);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 6), mat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(1.35, -0.05, 0);
  g.add(beak);
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 2.4, 0.1, 0.55, 2.4, 0.1, -0.55,
  ], 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({
    color: 0x6e6355, roughness: 0.9, side: THREE.DoubleSide,
  }));
  const wR = new THREE.Mesh(wingGeo.clone(), wL.material);
  wR.scale.x = -1;
  g.add(wL, wR);
  g.userData = { wL, wR };
  return g;
}

export function makePelicans(scene, audio) {
  const birds = [];
  const group = new THREE.Group();
  scene.add(group);
  for (let i = 0; i < COUNT; i++) {
    const b = makePelican();
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
      const flap = train ? Math.sin(flapClock * 9 + i * 0.7) * 0.55 : Math.sin(flapClock * 0.8 + i) * 0.06;
      b.userData.wL.rotation.x = flap;
      b.userData.wR.rotation.x = -flap;
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
