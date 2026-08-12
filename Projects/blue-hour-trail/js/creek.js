import * as THREE from 'three';
import { CREEK, creekX, creekWaterY, LAYOUT } from './field.js';

// The creek: a dark ribbon of water following the carve in field.js, the
// waterfall pouring off the rock step at its head, and the spray mist at the
// fall's base. Three draw calls.

function streakTexture(vertical = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 64;
    const len = 30 + Math.random() * 120;
    const y = Math.random() * 256;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    const a = vertical ? 0.5 + Math.random() * 0.4 : 0.16 + Math.random() * 0.2;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(235,244,250,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1.2 + Math.random() * 2.2, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function softDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(235,242,246,0.55)');
  grad.addColorStop(0.5, 'rgba(225,235,242,0.22)');
  grad.addColorStop(1, 'rgba(220,230,238,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildCreek(scene) {
  // ---- water ribbon ----
  const N = 26;
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= N; i++) {
    const z = CREEK.headZ + (i / N) * (CREEK.endZ - CREEK.headZ);
    const x = creekX(z);
    const y = creekWaterY(z);
    // perpendicular to the flow (the creek runs mostly along z)
    const slope = 14 * 0.05 * Math.cos(z * 0.05);
    const len = Math.hypot(1, slope);
    const px = 1 / len, pz = -slope / len;
    const hw = 1.7;
    positions.push(x - px * hw, y, z - pz * hw, x + px * hw, y, z + pz * hw);
    uvs.push(0, i / 3, 1, i / 3);
    if (i < N) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();

  const flowTex = streakTexture(false);
  const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x18242b,
    roughness: 0.15,
    metalness: 0.45,
    map: flowTex,
    transparent: true,
    opacity: 0.88,
  }));
  scene.add(water);

  // ---- waterfall ----
  const wf = LAYOUT.waterfall;
  const fallH = wf.topY - wf.baseY + 1.2;
  const fallTexA = streakTexture(true);
  const fallTexB = streakTexture(true);
  const falls = [];
  [[fallTexA, 2.4, 0.0, 0.45], [fallTexB, 2.0, 0.35, 0.3]].forEach(([tex, w, zOff, op]) => {
    const plane = new THREE.PlaneGeometry(w, fallH);
    plane.translate(0, 0, 0);
    const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    }));
    mesh.position.set(wf.x, wf.baseY + fallH / 2 - 0.6, wf.z + 0.4 + zOff);
    scene.add(mesh);
    falls.push({ mesh, tex, speed: 0.5 + zOff });
  });

  // ---- spray at the base ----
  const spray = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 2.6),
    new THREE.MeshBasicMaterial({
      map: softDiscTexture(), transparent: true, opacity: 0.35,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    }));
  spray.position.set(wf.x, wf.baseY + 0.9, wf.z + 1.6);
  scene.add(spray);

  let t = 0;
  return {
    update(dt) {
      t += dt;
      flowTex.offset.y -= dt * 0.35;
      for (const f of falls) f.tex.offset.y += dt * f.speed;
      spray.material.opacity = 0.28 + Math.sin(t * 1.7) * 0.07;
      spray.rotation.y = Math.sin(t * 0.13) * 0.2;   // slow wander, not a billboard
    },
  };
}
