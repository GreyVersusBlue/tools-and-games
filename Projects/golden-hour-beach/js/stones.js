import * as THREE from 'three';
import { groundHeight, LAYOUT, mulberry32 } from './field.js';

// Skipping stones. Three patches of flat stones live on the sand (field.js
// places them, so the smoke suite can check they sit above the waterline);
// pick one up, hold to wind up, release to send it out over the water. A
// shallow, fast stone skips — each touch a plink and a spreading ring — and a
// steep or slow one catches and sinks. There is deliberately no counter
// anywhere: the fourth skip is its own reward or it is nothing.
//
// The sea returns thrown stones to the patch; the patches never run out.

const GRAVITY = 9.8;

function makeStoneGeo(seed) {
  const rnd = mulberry32(seed);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const j = 0.85 + rnd() * 0.3;
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * 0.34, pos.getZ(i) * j);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildStones(scene, interact, controls, camera, audio, ocean) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a655e, roughness: 0.85 });

  // The patches as they lie on the sand.
  const patchGroup = new THREE.Group();
  let seed = 0x5107;
  for (const patch of LAYOUT.stones) {
    for (const s of patch.stones) {
      const m = new THREE.Mesh(makeStoneGeo(seed++), mat);
      m.scale.setScalar(s.s);
      m.position.set(s.x, groundHeight(s.x, s.z) + s.s * 0.3, s.z);
      m.rotation.y = s.yaw;
      patchGroup.add(m);
    }
  }
  scene.add(patchGroup);

  // The one stone in flight (or in hand). One is enough — nobody winds up a
  // second stone mid-flight, and a pool would just be this with bookkeeping.
  const flying = new THREE.Mesh(makeStoneGeo(0xcafe), mat.clone());
  flying.scale.setScalar(0.06);
  flying.visible = false;
  scene.add(flying);

  // Splash rings where a skip touches. Small pool, expanding and fading.
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.72, 1, 24);
  ringGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xfff4e0, transparent: true, opacity: 0, depthWrite: false,
    }));
    r.visible = false;
    scene.add(r);
    rings.push({ mesh: r, t: Infinity });
  }
  function ringAt(x, y, z) {
    const r = rings.find(r => !r.mesh.visible) || rings[0];
    r.mesh.position.set(x, y + 0.02, z);
    r.mesh.visible = true;
    r.t = 0;
  }

  const vel = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let holding = false, charging = false, charge = 0, inFlight = false, skips = 0;
  let restT = 0;

  const heldOverride = {
    label: () => {
      if (charging) return 'release to throw';
      return interact.isTouch ? 'hold here, release to throw' : 'hold click to wind up, release to throw';
    },
    use: () => {},   // the pill itself is the touch throw control, handled below
  };

  // Wind-up and release. Mouse anywhere (pointer lock or not); on touch the
  // hint pill is the throw control, so drag-look stays free.
  document.addEventListener('mousedown', () => { if (holding) charging = true; });
  document.addEventListener('mouseup', () => { if (holding && charging) throwStone(); });
  interact.hintEl.addEventListener('touchstart', e => {
    if (holding) { e.preventDefault(); charging = true; }
  }, { passive: false });
  interact.hintEl.addEventListener('touchend', e => {
    if (holding && charging) { e.preventDefault(); throwStone(); }
  }, { passive: false });

  function throwStone() {
    charging = false;
    holding = false;
    interact.clearOverride();
    inFlight = true;
    skips = 0;
    camera.getWorldDirection(dir);
    const speed = 9 + charge * 11;
    vel.copy(dir).multiplyScalar(speed);
    vel.y += speed * 0.12;   // a wrist's worth of lift over where you aimed
    flying.position.copy(camera.position).addScaledVector(dir, 0.5);
    flying.position.y -= 0.15;
    charge = 0;
  }

  // One interactable per patch.
  for (const patch of LAYOUT.stones) {
    interact.register({
      x: patch.x, z: patch.z, y: groundHeight(patch.x, patch.z), radius: 3.2,
      available: () => !holding && !inFlight,
      label: () => 'pick up a flat stone · E',
      use: () => {
        holding = true;
        charge = 0;
        interact.setOverride(heldOverride);
      },
    });
  }

  const state = {
    update(dt) {
      if (holding) {
        if (charging) charge = Math.min(1, charge + dt / 1.1);
        // Carried low and right, like a stone actually carried.
        camera.getWorldDirection(dir);
        flying.visible = true;
        flying.position.copy(camera.position).addScaledVector(dir, 0.55);
        flying.position.y -= 0.16 + charge * 0.05;
      } else if (inFlight) {
        flying.visible = true;
        vel.y -= GRAVITY * dt;
        flying.position.addScaledVector(vel, dt);
        flying.rotation.x += dt * 9;
        flying.rotation.z += dt * 7;

        const waterY = ocean.water.position.y;
        const gY = groundHeight(flying.position.x, flying.position.z);

        if (gY > waterY && flying.position.y <= gY + 0.03) {
          // Came down on sand: a soft thud and it lies there a moment.
          audio.thud();
          inFlight = false;
          restT = 2.5;
          flying.position.y = gY + 0.03;
        } else if (flying.position.y <= waterY) {
          const h = Math.hypot(vel.x, vel.z);
          if (-vel.y < h * 0.42 && h > 5 && skips < 8) {
            // Shallow and fast: skip. Kill a little speed, mirror the fall.
            skips++;
            vel.y = Math.abs(vel.y) * 0.55;
            vel.x *= 0.84; vel.z *= 0.84;
            flying.position.y = waterY + 0.01;
            const pan = THREE.MathUtils.clamp((flying.position.x - camera.position.x) / 60, -1, 1);
            audio.plink(pan, Math.max(0.25, 1 - skips * 0.09));
            ringAt(flying.position.x, waterY, flying.position.z);
          } else {
            // Steep or spent: caught and gone.
            audio.splash(0.10);
            ringAt(flying.position.x, waterY, flying.position.z);
            inFlight = false;
            flying.visible = false;
          }
        }
        if (flying.position.y < -6) { inFlight = false; flying.visible = false; }
      } else if (restT > 0) {
        restT -= dt;
        if (restT <= 0) flying.visible = false;
      }

      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const p = r.t / 0.9;
        if (p >= 1) { r.mesh.visible = false; continue; }
        r.mesh.scale.setScalar(0.25 + p * 1.6);
        r.mesh.material.opacity = (1 - p) * 0.5;
      }
    },
  };

  return state;
}
