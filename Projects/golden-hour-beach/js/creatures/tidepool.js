import * as THREE from 'three';
import { groundHeight, LAYOUT, mulberry32 } from '../field.js';

// What lives in the still water on the headland shelf: anemones swaying,
// starfish being spectacularly unhurried, and little shannies that dart for
// cover when your shadow falls over the pool. "Crouching at a pool" needs no
// new control — being close with the camera pitched well down is crouching.

export function makeTidepoolLife(scene, audio) {
  const rnd = mulberry32(0x71de);
  const group = new THREE.Group();
  scene.add(group);
  const pools = LAYOUT.headland.pools;
  const home = { x: pools[2].x, z: pools[2].z, radius: 80 };

  const anemones = [];
  const fish = [];
  const stars = [];

  const starMat = new THREE.MeshStandardMaterial({ color: 0xc4522e, roughness: 0.8 });
  const anemMat = new THREE.MeshStandardMaterial({ color: 0x3e6852, roughness: 0.7 });
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x54503e, roughness: 0.6 });

  for (const p of pools) {
    const floorY = groundHeight(p.x, p.z);
    const waterTop = floorY + p.depth * 0.55;

    // One anemone per pool: a squat cylinder with a cone-tentacle fringe.
    const an = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.08, 8), anemMat);
    an.add(base);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 4), anemMat);
      t.position.set(Math.cos(a) * 0.07, 0.07, Math.sin(a) * 0.07);
      t.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      an.add(t);
    }
    const ax = p.x + (rnd() - 0.5) * p.r * 0.7, az = p.z + (rnd() - 0.5) * p.r * 0.7;
    an.position.set(ax, floorY + 0.03, az);
    group.add(an);
    anemones.push({ mesh: an, phase: rnd() * 6.28 });

    // Starfish in a couple of pools only — rarity is what makes it a find.
    if (rnd() < 0.55) {
      const arms = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const arm = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), starMat);
        arm.rotation.z = Math.PI / 2;
        arm.rotation.y = (i / 5) * Math.PI * 2;
        arm.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.07, 0, -Math.sin((i / 5) * Math.PI * 2) * 0.07);
        arms.add(arm);
      }
      const sx = p.x + (rnd() - 0.5) * p.r * 0.5, szz = p.z + (rnd() - 0.5) * p.r * 0.5;
      arms.position.set(sx, floorY + 0.035, szz);
      arms.scale.setScalar(1.4);
      group.add(arms);
      stars.push(arms.position);
    }

    // Two shannies per pool.
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), fishMat);
      f.scale.set(2.2, 0.7, 0.6);
      group.add(f);
      fish.push({
        mesh: f, pool: p, y: waterTop - 0.05,
        a: rnd() * 6.28, speed: 0.5 + rnd() * 0.5, r: p.r * 0.45,
        hide: 0,
      });
    }
  }

  let plipT = 8;
  let clock = 0;
  const sight = new THREE.Vector3();

  function update(dt, ctx) {
    clock += dt;
    const t = clock;

    for (const an of anemones) {
      an.mesh.rotation.y = Math.sin(t * 0.5 + an.phase) * 0.15;
      const sway = 1 + Math.sin(t * 0.8 + an.phase) * 0.05;
      an.mesh.scale.set(sway, 1, sway);
    }

    const px = ctx.playerPos.x, pz = ctx.playerPos.z;
    const crouching = ctx.camera.rotation.x < -0.55;

    for (const f of fish) {
      const d = Math.hypot(f.pool.x - px, f.pool.z - pz);
      // Looming close and upright spooks them; a patient crouch does not.
      if (d < 2.2 && !crouching) f.hide = 2 + Math.random();
      if (f.hide > 0) {
        f.hide -= dt;
        // Bolt to the anemone side of the pool and hold still.
        f.mesh.position.x += (f.pool.x - f.mesh.position.x) * Math.min(1, dt * 6);
        f.mesh.position.z += (f.pool.z - f.mesh.position.z) * Math.min(1, dt * 6);
        f.mesh.position.y = groundHeight(f.pool.x, f.pool.z) + 0.05;
      } else {
        f.a += f.speed * dt;
        f.mesh.position.set(
          f.pool.x + Math.cos(f.a) * f.r,
          f.y,
          f.pool.z + Math.sin(f.a) * f.r * 0.8,
        );
        f.mesh.rotation.y = -f.a;
      }
    }

    plipT -= dt;
    if (plipT <= 0 && audio && Math.hypot(home.x - px, home.z - pz) < 25) {
      plipT = 10 + Math.random() * 14;
      audio.plink((Math.random() - 0.5) * 0.6, 0.15);
    }

    // Sightings track the NEAREST star and fish to the walker — crouching at
    // pool three while the focus watched pool one's starfish was the first
    // version of this, and it could never fire.
    if (ctx.journal && crouching) {
      let bestStar = null, bd = Infinity;
      for (const s of stars) {
        const d = (s.x - px) * (s.x - px) + (s.z - pz) * (s.z - pz);
        if (d < bd) { bd = d; bestStar = s; }
      }
      if (bestStar && bd < 36) ctx.journal.focus('starfish', bestStar, dt, ctx.camera);
      let bestFish = null; bd = Infinity;
      for (const f of fish) {
        if (f.hide > 0) continue;
        const d = (f.mesh.position.x - px) ** 2 + (f.mesh.position.z - pz) ** 2;
        if (d < bd) { bd = d; bestFish = f; }
      }
      if (bestFish && bd < 36) {
        sight.copy(bestFish.mesh.position);
        ctx.journal.focus('shanny', sight, dt, ctx.camera);
      }
    }
  }

  return { group, home, update };
}
