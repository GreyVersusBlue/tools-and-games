import * as THREE from 'three';
import { createScreens } from './board.js';

function box(scene, registry, size, mat, pos, rotY = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rotY) m.rotation.y = rotY;
  scene.add(m);
  registry.add(m);
  return m;
}

export function buildRoom(scene, registry, mats, data) {
  for (const f of data.fixtures) {
    box(scene, registry, f.size, mats[f.mat], f.pos, f.rotY || 0);
  }

  const occluders = [];
  for (const o of data.occluders) {
    const [w, h, d] = o.size;
    const mesh = box(scene, registry, o.size, mats[o.mat], [o.pos[0], h / 2, o.pos[1]]);
    mesh.userData.label = o.label;
    mesh.userData.halfW = w / 2;
    mesh.userData.halfD = d / 2;
    occluders.push(mesh);
    for (let i = 0; i < (o.clutter || 0); i++) {
      box(scene, registry, [w * 0.78, 0.22, d * 0.72], mats.poster, [o.pos[0], 0.5 + i * 0.42, o.pos[1]]);
    }
  }

  for (const l of data.lights) {
    const color = Number(l.color);
    let light;
    if (l.type === 'ambient') light = new THREE.AmbientLight(color, l.intensity);
    else if (l.type === 'point') light = new THREE.PointLight(color, l.intensity, l.distance);
    else light = new THREE.DirectionalLight(color, l.intensity);
    if (l.pos) light.position.set(...l.pos);
    scene.add(light);
  }

  const screens = createScreens(scene, registry, data.screens || []);

  return { occluders, screens, bounds: data.bounds, teachingZone: data.teachingZone, spawn: data.spawn };
}
