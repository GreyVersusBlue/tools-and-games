import * as THREE from 'three';
import { groundHeight, mulberry32 } from '../field.js';

// Ghost crabs, out along the wrack line from dusk. Mostly still — the thing a
// ghost crab does best is not be seen — then a fast sideways scuttle away from
// a walker, and a vanish into a burrow. They re-emerge once you have moved on.

const COUNT = 7;

function makeCrab() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcabc9d, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
  body.scale.set(1.5, 0.55, 1.1);
  g.add(body);
  for (const sx of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), mat);
    claw.position.set(sx * 0.13, 0.01, 0.08);
    g.add(claw);
  }
  return g;
}

export function makeCrabs(scene, audio) {
  const rnd = mulberry32(0xc4ab);
  const crabs = [];
  const group = new THREE.Group();
  scene.add(group);
  const home = { x: 40, z: -1, radius: 110 };

  for (let i = 0; i < COUNT; i++) {
    const mesh = makeCrab();
    const x = home.x - 100 + rnd() * 200;
    const z = -2 + rnd() * 4;
    mesh.position.set(x, groundHeight(x, z) + 0.05, z);
    group.add(mesh);
    crabs.push({
      mesh, homeX: x, homeZ: z,
      mode: 'idle',       // idle | wander | flee | buried
      t: rnd() * 4,
      buriedT: 0,
      tx: x, tz: z,
    });
  }

  const sight = new THREE.Vector3();

  function update(dt, ctx) {
    // Day: all buried, nothing to see.
    const out = ctx.nightT > 0.2;
    group.visible = out;
    if (!out) { for (const c of crabs) if (c.mode !== 'buried') c.mode = 'idle'; return; }

    const px = ctx.playerPos.x, pz = ctx.playerPos.z;
    let nearest = null, nearestD = Infinity;

    for (const c of crabs) {
      c.t -= dt;
      const d = Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz);
      if (c.mode !== 'buried' && d < nearestD) { nearestD = d; nearest = c; }

      if (c.mode === 'buried') {
        c.buriedT -= dt;
        if (c.buriedT <= 0 && d > 8) {
          c.mode = 'idle';
          c.mesh.visible = true;
          c.mesh.scale.setScalar(1);
          c.t = 1 + Math.random() * 3;
        }
        continue;
      }

      if (d < 4.5 && c.mode !== 'flee') {
        c.mode = 'flee';
        // Straight away from the player, with a burrow at the end of the run.
        const ax = c.mesh.position.x - px, az = c.mesh.position.z - pz;
        const al = Math.hypot(ax, az) || 1;
        c.tx = c.mesh.position.x + (ax / al) * (6 + Math.random() * 4);
        c.tz = THREE.MathUtils.clamp(c.mesh.position.z + (az / al) * 4, -3, 5);
      }

      if (c.mode === 'flee') {
        const dx = c.tx - c.mesh.position.x, dz = c.tz - c.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.15) {
          c.mode = 'buried';
          c.buriedT = 20 + Math.random() * 10;
          c.mesh.visible = false;   // into the burrow
        } else {
          c.mesh.position.x += (dx / dist) * 4.2 * dt;
          c.mesh.position.z += (dz / dist) * 4.2 * dt;
          c.mesh.position.y = groundHeight(c.mesh.position.x, c.mesh.position.z) + 0.05;
          // Crabs run sideways: body perpendicular to travel.
          c.mesh.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2;
        }
      } else if (c.t <= 0) {
        // A small unhurried reposition, then stillness again.
        c.mode = 'wander';
        c.tx = c.homeX + (Math.random() - 0.5) * 3;
        c.tz = THREE.MathUtils.clamp(c.homeZ + (Math.random() - 0.5) * 2, -3, 5);
        c.t = 2.5 + Math.random() * 5;
      }
      if (c.mode === 'wander') {
        const dx = c.tx - c.mesh.position.x, dz = c.tz - c.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.08) c.mode = 'idle';
        else {
          c.mesh.position.x += (dx / dist) * 0.8 * dt;
          c.mesh.position.z += (dz / dist) * 0.8 * dt;
          c.mesh.position.y = groundHeight(c.mesh.position.x, c.mesh.position.z) + 0.05;
          c.mesh.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2;
        }
      }
    }

    if (ctx.journal && nearest && nearestD < 12) {
      sight.copy(nearest.mesh.position);
      ctx.journal.focus('crab', sight, dt, ctx.camera);
    }
  }

  return { group, home, update };
}
