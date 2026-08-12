import * as THREE from 'three';
import { groundHeight, mulberry32 } from './field.js';

// A small camp at the mouth of the dunes: stone ring, a tepee of sticks, two
// log seats, and a fire. The fire is the project's one added realtime light —
// budgeted deliberately, everything else that glows at night is an additive
// fake. Sitting is handled in main.js; this module owns the objects, the
// flicker, and the particles.

export const CAMP = { x: 20, z: 34 };   // read by main.js for the sit check

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 66, 3, 32, 56, 52);
  grad.addColorStop(0, 'rgba(255,240,190,0.95)');
  grad.addColorStop(0.35, 'rgba(255,170,70,0.55)');
  grad.addColorStop(0.7, 'rgba(230,80,25,0.18)');
  grad.addColorStop(1, 'rgba(180,40,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 96);
  return new THREE.CanvasTexture(c);
}

function emberTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,200,120,1)');
  grad.addColorStop(0.5, 'rgba(255,120,40,0.5)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
}

export function buildCampfire(scene) {
  const rnd = mulberry32(0xf19e);
  const group = new THREE.Group();
  const gy = groundHeight(CAMP.x, CAMP.z);
  group.position.set(CAMP.x, gy, CAMP.z);
  scene.add(group);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4442, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
  const charMat = new THREE.MeshStandardMaterial({ color: 0x1d1613, roughness: 1.0 });

  // Stone ring
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.08, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
    stone.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    stone.scale.y = 0.7;
    group.add(stone);
  }

  // Charred stick tepee
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.9, 5), i < 2 ? charMat : woodMat);
    stick.position.set(Math.cos(a) * 0.22, 0.36, Math.sin(a) * 0.22);
    stick.lookAt(group.position.x, group.position.y + 1.4, group.position.z);
    stick.rotateX(Math.PI / 2);
    group.add(stick);
  }

  // Two log seats, facing the fire and the sea beyond it
  for (const [lx, lz, yaw] of [[-1.5, 0.9, 0.55], [1.3, 1.2, -0.5]]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.9, 8), woodMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = yaw;
    const ly = groundHeight(CAMP.x + lx, CAMP.z + lz) - gy;
    log.position.set(lx, ly + 0.2, lz);
    group.add(log);
  }

  // The crumb tin by the seat — main.js hangs the scatter verb on it.
  const tin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.4, metalness: 0.6 }),
  );
  const tinY = groundHeight(CAMP.x - 1.8, CAMP.z + 1.4) - gy;
  tin.position.set(-1.8, tinY + 0.06, 1.4);
  group.add(tin);

  // The one realtime light. Warm, short range, flickered in update().
  const light = new THREE.PointLight(0xff8c3a, 0, 16, 2);
  light.position.set(0, 0.7, 0);
  group.add(light);

  // Flames: three additive sprites at slight offsets, jittered in scale.
  const flameTex = flameTexture();
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85,
    }));
    s.position.set((rnd() - 0.5) * 0.16, 0.5, (rnd() - 0.5) * 0.16);
    s.scale.set(0.55, 0.9, 1);
    group.add(s);
    flames.push({ sprite: s, phase: rnd() * 6.28, speed: 7 + rnd() * 5 });
  }

  // Embers: a small pool rising and wandering, respawning at the base.
  const emberTex = emberTexture();
  const embers = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: emberTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    s.scale.set(0.05, 0.05, 1);
    group.add(s);
    embers.push({ sprite: s, life: rnd() * 1 });
  }

  // Smoke: three faint grey sprites drifting up, normal blending.
  const smoke = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex, transparent: true, depthWrite: false,
      color: 0x2a2226, opacity: 0.0,
    }));
    group.add(s);
    smoke.push({ sprite: s, life: i / 3 });
  }

  const state = { group, light, t: 0 };

  state.update = (dt) => {
    state.t += dt;

    // Flicker: two sines at unrelated rates plus a slow breath. Reads as fire;
    // costs nothing.
    const f = Math.sin(state.t * 11.3) * 0.25 + Math.sin(state.t * 7.1 + 2) * 0.2 + Math.sin(state.t * 0.9) * 0.1;
    light.intensity = 2.1 + f;

    for (const fl of flames) {
      const j = Math.sin(state.t * fl.speed + fl.phase);
      fl.sprite.scale.set(0.5 + j * 0.07, 0.85 + j * 0.14, 1);
      fl.sprite.material.opacity = 0.75 + j * 0.15;
    }

    for (const em of embers) {
      em.life += dt * (0.5 + Math.abs(Math.sin(em.life * 5)) * 0.2);
      if (em.life >= 1) {
        em.life = 0;
        em.sprite.position.set((Math.random() - 0.5) * 0.2, 0.45, (Math.random() - 0.5) * 0.2);
      }
      const p = em.life;
      em.sprite.position.y = 0.45 + p * 2.2;
      em.sprite.position.x += Math.sin(state.t * 3 + p * 20) * dt * 0.15;
      em.sprite.material.opacity = (1 - p) * 0.8;
    }

    for (const sm of smoke) {
      sm.life += dt * 0.18;
      if (sm.life >= 1) sm.life = 0;
      const p = sm.life;
      sm.sprite.position.set(Math.sin(p * 5) * 0.2, 0.9 + p * 3.4, 0);
      sm.sprite.scale.setScalar(0.4 + p * 1.6);
      sm.sprite.material.opacity = Math.sin(p * Math.PI) * 0.10;
    }
  };

  return state;
}
