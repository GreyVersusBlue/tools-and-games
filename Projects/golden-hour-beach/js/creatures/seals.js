import * as THREE from 'three';
import { groundHeight, shorelineZ, mulberry32 } from '../field.js';

// Harbour seals hauled out near the base of the headland's east flank. Mostly
// what a hauled-out seal does is breathe — a slow swell of the body, an
// occasional lifted head. Come in fast or close and they pour themselves into
// the sea and are gone for a long while. There is no prompt and no rule text:
// the seals themselves teach you to approach gently, or to watch from up on
// the cliff path instead.

const SPOTS = (() => {
  const rnd = mulberry32(0x5ea1);
  const out = [];
  for (const bx of [-436, -442, -448]) {
    const s = 1.2 + rnd() * 1.2;
    out.push({ x: bx + (rnd() - 0.5) * 3, z: shorelineZ(bx) + s, yaw: rnd() * 6.28 });
  }
  return out;
})();

function makeSeal(spot) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6e6258, roughness: 0.75 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 9), mat);
  body.scale.set(2.2, 0.75, 0.9);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mat);
  head.position.set(1.15, 0.18, 0);
  g.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 6), mat);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-1.25, 0.02, 0);
  g.add(tail);
  g.position.set(spot.x, groundHeight(spot.x, spot.z) + 0.32, spot.z);
  g.rotation.y = spot.yaw;
  g.userData = { body, head };
  return g;
}

export function makeSeals(scene, audio) {
  const group = new THREE.Group();
  scene.add(group);
  const home = { x: -442, z: shorelineZ(-442), radius: 60 };

  const seals = SPOTS.map(spot => {
    const mesh = makeSeal(spot);
    group.add(mesh);
    return {
      mesh, spot,
      mode: 'idle',        // idle | slide | gone
      t: Math.random() * 5,
      goneT: 0,
      breathe: Math.random() * 6.28,
      headUp: 0,
    };
  });

  let barkT = 25;

  function update(dt, ctx) {
    const px = ctx.playerPos.x, pz = ctx.playerPos.z;
    let anyVisible = false;

    for (const s of seals) {
      if (s.mode === 'gone') {
        s.goneT -= dt;
        if (s.goneT <= 0 && Math.hypot(s.spot.x - px, s.spot.z - pz) > 40) {
          // Haul back out, unobserved.
          s.mode = 'idle';
          s.mesh.visible = true;
          s.mesh.position.set(s.spot.x, groundHeight(s.spot.x, s.spot.z) + 0.32, s.spot.z);
          s.mesh.rotation.y = s.spot.yaw;
        }
        continue;
      }
      anyVisible = true;

      const d = Math.hypot(s.mesh.position.x - px, s.mesh.position.z - pz);
      if (s.mode === 'idle' && d < 9) {
        s.mode = 'slide';
        if (audio) audio.bark(THREE.MathUtils.clamp((s.mesh.position.x - px) / 20, -1, 1));
      }

      if (s.mode === 'slide') {
        // Pour seaward, nose down, splash, vanish.
        s.mesh.position.z -= 3.2 * dt;
        s.mesh.position.x += Math.sin(s.breathe) * 0.4 * dt;
        const g = groundHeight(s.mesh.position.x, s.mesh.position.z);
        s.mesh.position.y = g + 0.32;
        s.mesh.rotation.y = Math.atan2(1, Math.sin(s.breathe) * 0.12);
        s.mesh.rotation.z = -0.18;
        if (g + 0.2 < ctx.waterY) {
          s.mode = 'gone';
          s.goneT = 240 + Math.random() * 120;
          s.mesh.visible = false;
          if (audio) audio.splash(0.22);
        }
      } else {
        // Breathing, and the occasional raised head.
        s.breathe += dt * 0.7;
        const swell = 1 + Math.sin(s.breathe) * 0.035;
        s.mesh.userData.body.scale.set(2.2 * swell, 0.75 * swell, 0.9);
        s.t -= dt;
        if (s.t <= 0) {
          s.t = 4 + Math.random() * 9;
          s.headUp = 1.4;   // seconds of raised head
        }
        if (s.headUp > 0) s.headUp -= dt;
        const target = s.headUp > 0 ? 0.42 : 0.18;
        s.mesh.userData.head.position.y += (target - s.mesh.userData.head.position.y) * Math.min(1, dt * 4);
      }
    }

    barkT -= dt;
    if (barkT <= 0 && anyVisible && audio && Math.hypot(home.x - px, home.z - pz) < 90) {
      barkT = 30 + Math.random() * 40;
      audio.bark(THREE.MathUtils.clamp((home.x - px) / 60, -1, 1), 0.5);
    }

    if (ctx.journal && anyVisible) {
      const first = seals.find(s => s.mode !== 'gone');
      if (first) ctx.journal.focus('seal', first.mesh.position, dt, ctx.camera);
    }
  }

  return { group, home, update };
}
