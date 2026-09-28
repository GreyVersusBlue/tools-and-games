import * as THREE from 'three';
import { groundHeight, shorelineZ, mulberry32 } from '../field.js';
import { makeAnimal } from '../animals.js';

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

// The pack's seal. Its `breathe` clip swells it about the belly; its `head`
// node is the game's to raise, from where the file rests it.
function makeSeal(spot, animals) {
  const g = new THREE.Group();
  const a = makeAnimal(animals, 'seal');
  g.add(a.seat);
  g.position.set(spot.x, groundHeight(spot.x, spot.z) + 0.32, spot.z);
  g.rotation.y = spot.yaw;
  g.userData = { head: a.nodes.head, headRest: a.nodes.head.position.y, mixer: a.mixer, breathe: a.actions.breathe };
  return g;
}

export function makeSeals(scene, audio, animals) {
  const group = new THREE.Group();
  scene.add(group);
  const home = { x: -442, z: shorelineZ(-442), radius: 60 };

  const seals = SPOTS.map(spot => {
    const mesh = makeSeal(spot, animals);
    group.add(mesh);
    const breathe = Math.random() * 6.28;
    // The clip is one breath at 0.7 rad/s, so its clock is the old one's.
    mesh.userData.breathe.play();
    mesh.userData.breathe.time = breathe / 0.7;
    return {
      mesh, spot,
      mode: 'idle',        // idle | slide | gone
      t: Math.random() * 5,
      goneT: 0,
      breathe,
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
        s.mesh.userData.mixer.update(dt);
        s.t -= dt;
        if (s.t <= 0) {
          s.t = 4 + Math.random() * 9;
          s.headUp = 1.4;   // seconds of raised head
        }
        if (s.headUp > 0) s.headUp -= dt;
        // Raised 0.24 m, as the builder's head went from 0.18 to 0.42.
        const u = s.mesh.userData;
        const target = u.headRest + (s.headUp > 0 ? 0.24 : 0);
        u.head.position.y += (target - u.head.position.y) * Math.min(1, dt * 4);
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
