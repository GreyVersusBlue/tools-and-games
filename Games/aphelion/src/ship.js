// Builds the whole 3D world: ship interior, props/interactables,
// ship exterior shell, starfield, and EVA points of interest.

import * as THREE from 'three';

const M = {
  wall:   new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.9 }),
  wallB:  new THREE.MeshStandardMaterial({ color: 0x232732, roughness: 0.9 }),
  floor:  new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.85 }),
  trim:   new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 }),
  panel:  new THREE.MeshStandardMaterial({ color: 0x11141b, roughness: 0.4, emissive: 0xffb367, emissiveIntensity: 0.25 }),
  panelLow: 0.06, panelOk: 0.25,
  metal:  new THREE.MeshStandardMaterial({ color: 0x565d6b, roughness: 0.5, metalness: 0.6 }),
  bed:    new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.95 }),
  blanket:new THREE.MeshStandardMaterial({ color: 0xc2703f, roughness: 0.95 }),
  soil:   new THREE.MeshStandardMaterial({ color: 0x2e2218, roughness: 1 }),
  leaf:   new THREE.MeshStandardMaterial({ color: 0x5fae63, roughness: 0.8 }),
  glass:  new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.5 }),
  hullExt:new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.7, metalness: 0.4 }),
  sat:    new THREE.MeshStandardMaterial({ color: 0x7d8494, roughness: 0.5, metalness: 0.7 }),
};

function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}

export function buildWorld(scene, roomsData, systemDefs, poiData) {
  const refs = { interactables: [], roomLights: {}, panels: {}, plantGroup: null, windowMeshes: [] };
  const hull = roomsData.hull;
  const W = hull.max[0] - hull.min[0];   // 6
  const H = hull.max[1] - hull.min[1];   // 3
  const L = hull.max[2] - hull.min[2];   // 24
  const cz = (hull.min[2] + hull.max[2]) / 2;

  // ---------- Interior shell ----------
  const inner = new THREE.Group();
  inner.add(box(W, 0.2, L, M.floor, 0, -0.1, cz));                 // floor
  inner.add(box(W, 0.2, L, M.wallB, 0, H + 0.1, cz));              // ceiling
  inner.add(box(0.2, H, L, M.wall, hull.min[0] - 0.1, H / 2, cz)); // left wall
  inner.add(box(0.2, H, L, M.wall, hull.max[0] + 0.1, H / 2, cz)); // right wall
  inner.add(box(W, H, 0.2, M.wall, 0, H / 2, hull.max[2] + 0.1));  // aft wall

  // Cockpit forward wall with a big window
  inner.add(box(W, 0.8, 0.2, M.wall, 0, 0.4, hull.min[2] - 0.1));
  inner.add(box(W, 0.7, 0.2, M.wall, 0, H - 0.35, hull.min[2] - 0.1));
  inner.add(box(0.7, 1.5, 0.2, M.wall, -2.65, 1.55, hull.min[2] - 0.1));
  inner.add(box(0.7, 1.5, 0.2, M.wall, 2.65, 1.55, hull.min[2] - 0.1));
  const cockpitWindow = box(4.6, 1.5, 0.05, M.glass, 0, 1.55, hull.min[2] - 0.05);
  inner.add(cockpitWindow);
  refs.windowMeshes.push(cockpitWindow);

  // Partitions with doorways
  for (const pz of roomsData.partitions) {
    const dhw = roomsData.doorHalfWidth;
    const sideW = (W / 2) - dhw;
    inner.add(box(sideW, H, 0.15, M.wallB, -(dhw + sideW / 2), H / 2, pz));
    inner.add(box(sideW, H, 0.15, M.wallB,  (dhw + sideW / 2), H / 2, pz));
    inner.add(box(dhw * 2, 0.5, 0.15, M.wallB, 0, H - 0.25, pz)); // header
    inner.add(box(0.1, H, 0.25, M.trim, -dhw, H / 2, pz));        // door trim
    inner.add(box(0.1, H, 0.25, M.trim,  dhw, H / 2, pz));
  }

  // Side portholes in quarters
  for (const z of [0, 3]) {
    const pw = box(0.05, 0.9, 0.9, M.glass, hull.max[0] + 0.05, 1.6, z);
    inner.add(pw); refs.windowMeshes.push(pw);
  }
  scene.add(inner);

  // ---------- Room lights ----------
  scene.add(new THREE.AmbientLight(0x223, 1.2));
  for (const r of roomsData.rooms) {
    const li = new THREE.PointLight(parseInt(r.lightColor), 12, 9, 1.6);
    li.position.set(...r.lightPos);
    scene.add(li);
    refs.roomLights[r.id] = li;
  }

  // ---------- Cockpit props ----------
  const console_ = new THREE.Group();
  console_.add(box(4.4, 0.15, 1.0, M.metal, 0, 0.85, -12.8));
  console_.add(box(4.4, 0.7, 0.5, M.panel.clone(), 0, 0.5, -13.1));
  const seat = new THREE.Group();
  seat.add(box(0.8, 0.15, 0.8, M.bed, 0, 0.55, -11.6));
  seat.add(box(0.8, 0.9, 0.15, M.bed, 0, 1.05, -11.25));
  scene.add(console_, seat);
  // Desk lamp — a practical warm light
  const lamp = new THREE.PointLight(0xffca85, 3, 4, 2);
  lamp.position.set(-1.6, 1.3, -12.5);
  scene.add(lamp);

  // ---------- System panels ----------
  for (const s of systemDefs) {
    const mat = M.panel.clone();
    const p = box(0.08, 1.1, 1.4, mat, ...s.panel.pos);
    p.rotation.y = 0; // pos already against wall; thin axis is x
    scene.add(p);
    // little gauge strip
    const strip = box(0.02, 0.08, 1.0, new THREE.MeshBasicMaterial({ color: 0xffb367 }),
      s.panel.pos[0] + (s.panel.pos[0] > 0 ? -0.06 : 0.06), s.panel.pos[1] + 0.35, s.panel.pos[2]);
    scene.add(strip);
    refs.panels[s.id] = { mesh: p, mat, strip };
    refs.interactables.push({ mesh: p, type: 'system', id: s.id });
  }

  // Systems bay dressing: pipes and a workbench
  for (let i = 0; i < 4; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6), M.metal);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 2.7 - i * 0.16, -6.8);
    scene.add(pipe);
  }
  scene.add(box(1.8, 0.8, 0.7, M.metal, 2.0, 0.4, -7.4));

  // ---------- Quarters & hydroponics ----------
  const bed = new THREE.Group();
  bed.add(box(2.0, 0.35, 0.95, M.bed, -1.9, 0.28, 4.8));
  bed.add(box(1.6, 0.12, 0.9, M.blanket, -2.05, 0.5, 4.8));
  bed.add(box(0.4, 0.1, 0.6, M.wall, -1.2, 0.48, 4.8)); // pillow
  scene.add(bed);
  refs.interactables.push({ mesh: bed.children[0], type: 'bed' });

  // Curio shelf
  const shelf = box(1.4, 0.06, 0.35, M.trim, 2.5, 1.7, 4.8);
  scene.add(shelf);
  refs.curioShelf = new THREE.Group();
  refs.curioShelf.position.set(2.5, 1.82, 4.8);
  scene.add(refs.curioShelf);

  // Hydroponics tray
  const tray = new THREE.Group();
  tray.position.set(2.2, 0, 0.8);
  tray.add(box(1.6, 0.7, 0.8, M.metal, 0, 0.35, 0));
  tray.add(box(1.4, 0.12, 0.6, M.soil, 0, 0.76, 0));
  const growLight = new THREE.PointLight(0xd8b8ff, 2.5, 3, 2);
  growLight.position.set(2.2, 1.8, 0.8);
  scene.add(growLight);
  refs.growLight = growLight;
  const plantGroup = new THREE.Group();
  plantGroup.position.set(0, 0.82, 0);
  tray.add(plantGroup);
  refs.plantGroup = plantGroup;
  scene.add(tray);
  refs.interactables.push({ mesh: tray.children[1], type: 'plant' });

  // ---------- Airlock ----------
  const hatch = box(1.4, 2.0, 0.15, M.metal, 0, 1.1, 9.9);
  scene.add(hatch);
  scene.add(box(1.6, 0.15, 0.3, M.trim, 0, 2.2, 9.85));
  refs.interactables.push({ mesh: hatch, type: 'airlock-inner' });

  // ---------- Ship exterior (visible during EVA) ----------
  const ext = new THREE.Group();
  const body = box(W + 1, H + 1, L + 1.5, M.hullExt, 0, H / 2, cz);
  ext.add(body);
  ext.add(box(2.5, 1.2, 3.5, M.hullExt, 0, H + 1.2, -9));       // dorsal hump
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.1, 0.5, 16), M.sat);
  dish.position.set(0, H + 2.2, -9); ext.add(dish);
  for (const sx of [-1, 1]) {                                     // engine pods
    ext.add(box(1.2, 1.2, 4, M.hullExt, sx * 4.2, H / 2, 7));
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16),
      new THREE.MeshBasicMaterial({ color: 0x6fb7ff }));
    glow.position.set(sx * 4.2, H / 2, 9.05);
    ext.add(glow);
  }
  // Exterior hatch marker
  const extHatch = box(1.4, 2.0, 0.2, M.trim, 0, 1.1, 10.9);
  ext.add(extHatch);
  refs.interactables.push({ mesh: extHatch, type: 'airlock-outer' });
  scene.add(ext);
  refs.exterior = ext;

  // ---------- Starfield ----------
  const starGeo = new THREE.BufferGeometry();
  const N = 2600, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(180 + Math.random() * 60);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd8e8, size: 1.2, sizeAttenuation: true }));
  scene.add(stars);
  // A distant warm star
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffd9a8 }));
  sun.position.set(-90, 25, -140);
  scene.add(sun);
  const sunLight = new THREE.DirectionalLight(0xffe0b8, 0.8);
  sunLight.position.copy(sun.position);
  scene.add(sunLight);

  // ---------- Points of interest ----------
  refs.pois = {};
  for (const poi of poiData.pois) {
    const g = new THREE.Group();
    g.position.set(...poi.pos);
    const core = box(0.8, 0.8, 1.4, M.sat, 0, 0, 0);
    g.add(core);
    for (const sx of [-1, 1]) g.add(box(2.2, 0.05, 0.9, new THREE.MeshStandardMaterial({ color: 0x2a3d66, roughness: 0.3, metalness: 0.5 }), sx * 1.6, 0, 0));
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6), M.sat);
    ant.position.set(0, 1.0, 0); g.add(ant);
    g.rotation.set(0.4, 0.8, 0.15);
    scene.add(g);
    refs.pois[poi.id] = { group: g, def: poi };
    refs.interactables.push({ mesh: core, type: 'poi', id: poi.id });
  }

  scene.fog = null;
  scene.background = new THREE.Color(0x05070c);
  return refs;
}

// Rebuild the plant visuals for a growth stage (0..3)
export function updatePlantMesh(refs, stage, wilted) {
  const g = refs.plantGroup;
  while (g.children.length) g.remove(g.children[0]);
  const leafMat = M.leaf.clone();
  if (wilted) leafMat.color.set(0x8a8a52);
  const n = [0, 3, 6, 9][stage] + (stage > 0 ? 0 : 0);
  if (stage === 0) {
    for (let i = 0; i < 5; i++) {
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 5), leafMat);
      sprout.position.set(-0.5 + i * 0.25, 0.04, (i % 2) * 0.15 - 0.07);
      g.add(sprout);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const h = 0.1 + stage * 0.09 + (i % 3) * 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, h, 5), leafMat);
    stem.position.set(-0.55 + (i % 5) * 0.27, h / 2, Math.floor(i / 5) * 0.25 - 0.12);
    g.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05 + stage * 0.025, 6, 5), leafMat);
    leaf.position.set(stem.position.x, h + 0.03, stem.position.z);
    leaf.scale.y = 0.7;
    g.add(leaf);
    if (stage === 3) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xd96a4a, roughness: 0.6 }));
      fruit.position.set(stem.position.x + 0.05, h - 0.02, stem.position.z + 0.04);
      g.add(fruit);
    }
  }
}

// Add a little curio object to the shelf
export function addCurioMesh(refs, index) {
  const mats = [0x7fd4c1, 0xd9a15f, 0x9a86c9];
  const m = new THREE.Mesh(
    index % 2 ? new THREE.IcosahedronGeometry(0.09) : new THREE.BoxGeometry(0.12, 0.16, 0.1),
    new THREE.MeshStandardMaterial({ color: mats[index % 3], roughness: 0.4, metalness: 0.5 }));
  m.position.set(-0.5 + (index % 5) * 0.25, 0.1, 0);
  refs.curioShelf.add(m);
}
