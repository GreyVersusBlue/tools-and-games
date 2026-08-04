import * as THREE from 'three';
import { createScreens } from './board.js';
import { tiled } from './materials.js';
import { fitFootprint, fitPlane, loadTexture, registerModel } from './models.js';

function box(scene, registry, mats, matKey, size, pos, rotY = 0) {
  const [w, h, d] = size;
  // A box's UVs are 0..1 per face no matter how big that face really is —
  // tiled() wants the two dimensions that make up the visible face, which
  // for every fixture here (floor, walls, rug — all thin slabs) are just
  // whichever two of the three are the largest.
  const dims = [w, h, d].sort((a, b) => b - a);
  const mat = tiled(mats, matKey, dims[0], dims[1]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rotY) m.rotation.y = rotY;
  scene.add(m);
  registry.add(m);
  return m;
}

// Swap a hand-built box for a loaded model, purely as a visual upgrade: the
// box stays exactly where it was (position, collision/occluder userData,
// registry entry) and is just hidden, so nothing that reads its geometry or
// its halfW/halfD (input.js's movement collision, sightlines.js's raycast-
// on-paper) has to change. If the model fails to load, the box just stays
// visible — CLAUDE.md's "startup errors surface, nothing dies quietly" spirit,
// applied to a missing asset instead of a missing data file.
async function dressWithModel(scene, registry, loader, path, box, footprint, thermalHex, label) {
  if (!loader || !path) return false;
  try {
    const model = await loader.loadStatic(path);
    fitFootprint(model, footprint[0], footprint[1]);
    model.position.x += box.position.x;
    model.position.z += box.position.z;
    registerModel(model, registry, thermalHex);
    scene.add(model);
    box.visible = false;
    return true;
  } catch (err) {
    console.warn(`Model for ${label} failed to load, keeping the placeholder box.`, err);
    return false;
  }
}

// A framed painting: the model has its own ornate-frame material plus a
// separate "canvas" submesh meant to carry whatever image goes inside it.
// Object3D.clone() shares materials by reference, so the canvas's material
// has to be cloned per instance — otherwise every painting hung from the
// same frame model would show whichever texture was assigned last.
async function dressPoster(scene, registry, loader, framePath, paintingPath, box, thermalHex) {
  if (!loader || !framePath || !paintingPath) return false;
  try {
    const frame = await loader.loadStatic(framePath);
    fitPlane(frame, box.geometry.parameters.width, box.geometry.parameters.height);
    frame.position.copy(box.position);
    frame.rotation.y = box.rotation.y;

    const canvas = frame.getObjectByName('fancy_picture_frame_01_canvas');
    if (canvas) {
      canvas.material = canvas.material.clone();
      canvas.material.map = loadTexture(paintingPath);
      canvas.material.needsUpdate = true;
    }

    registerModel(frame, registry, thermalHex);
    scene.add(frame);
    box.visible = false;
    return true;
  } catch (err) {
    console.warn(`Art frame failed to load (${paintingPath}), keeping the placeholder poster.`, err);
    return false;
  }
}

// Pure set dressing — a clock, a fire alarm, a plant, whatever the manifest
// lists. Nothing in the game reads these (no collision, no sightline math),
// so a missing one is just skipped rather than falling back to a box; there
// is no "flavor version" of a potted plant worth drawing. They get a cool,
// room-temperature thermal color rather than a bright one — under Withitness
// the point is to notice kids, not have the clutter compete for attention.
const PROP_THERMAL = 0x0A1420;

async function buildProps(scene, registry, loader, propPaths, props = []) {
  await Promise.all(props.map(async p => {
    const path = propPaths[p.asset];
    if (!loader || !path) return;
    try {
      const model = await loader.loadStatic(path);
      if (p.wall) fitPlane(model, p.footprint[0], p.footprint[1]);
      else fitFootprint(model, p.footprint[0], p.footprint[1]);

      model.position.x += p.pos[0];
      model.position.z += p.pos[1];
      model.position.y += p.y || 0;
      if (p.rotY) model.rotation.y += p.rotY;

      registerModel(model, registry, PROP_THERMAL);
      scene.add(model);
    } catch (err) {
      console.warn(`Prop "${p.id}" failed to load, skipping it.`, err);
    }
  }));
}

export async function buildRoom(scene, registry, mats, data, opts = {}) {
  const { loader, assets } = opts;
  const modelPaths = assets?.models || {};

  const fixtureMeshes = {};
  for (const f of data.fixtures) {
    fixtureMeshes[f.id] = box(scene, registry, mats, f.mat, f.size, f.pos, f.rotY || 0);
  }

  // The teacher's desk is two fixtures (a wood top, a metal body) that one
  // desk.glb replaces at once.
  const deskTop = fixtureMeshes.teacherDeskTop, deskBody = fixtureMeshes.teacherDeskBody;
  if (deskTop && deskBody) {
    const footW = Math.max(deskTop.geometry.parameters.width, deskBody.geometry.parameters.width);
    const footD = Math.max(deskTop.geometry.parameters.depth, deskBody.geometry.parameters.depth);
    const thermalHex = mats.wood.userData.thermal.color.getHex();
    const dressed = await dressWithModel(
      scene, registry, loader, modelPaths.teacherDesk, deskBody, [footW, footD], thermalHex, 'teacherDesk'
    );
    if (dressed) deskTop.visible = false;
  }

  // Real paintings, where the manifest names one for a given poster fixture.
  const artCfg = assets?.art;
  if (artCfg?.frame && artCfg?.paintings) {
    const thermalHex = mats.poster.userData.thermal.color.getHex();
    await Promise.all(Object.entries(artCfg.paintings).map(([posterId, paintingPath]) => {
      const posterBox = fixtureMeshes[posterId];
      if (!posterBox) return null;
      return dressPoster(scene, registry, loader, artCfg.frame, paintingPath, posterBox, thermalHex);
    }));
  }

  const occluders = [];
  for (const o of data.occluders) {
    const [w, h, d] = o.size;
    const mesh = box(scene, registry, mats, o.mat, o.size, [o.pos[0], h / 2, o.pos[1]]);
    mesh.userData.label = o.label;
    mesh.userData.halfW = w / 2;
    mesh.userData.halfD = d / 2;
    occluders.push(mesh);

    const thermalHex = mats[o.mat]?.userData.thermal?.color.getHex() ?? 0x102438;
    const dressed = await dressWithModel(scene, registry, loader, modelPaths[o.id], mesh, [w, d], thermalHex, o.id);
    if (!dressed) {
      // No model (or it failed) — fall back to the original clutter-boxes
      // trick so a real bookshelf still reads as one, even empty-handed.
      for (let i = 0; i < (o.clutter || 0); i++) {
        box(scene, registry, mats, 'poster', [w * 0.78, 0.22, d * 0.72], [o.pos[0], 0.5 + i * 0.42, o.pos[1]]);
      }
    }
  }

  await buildProps(scene, registry, loader, assets?.props || {}, data.props || []);

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
