// render.js — three.js scene setup, procedural PBR-style materials, lighting,
// post-processing, and rebuilding building geometry from grid state.
//
// Textures are generated procedurally on canvas (the brief's fallback path,
// since real CC0 PBR sets can drop into /assets/textures later). Materials are
// MeshStandardMaterial so swapping in albedo/normal/roughness maps is a
// one-line change per material.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CELL, WALL_H, WALL_T, DOOR_W, DOOR_H, RAIL_H,
  EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL,
  FLOOR_H, computeLabels, floorBaseY, wallHeightOf, topOfBuilding,
} from './grid.js';
import {
  SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt,
  shapesOf, segEnds, segLength, shapeBBox, pointInShape, interiorPoint,
} from './shapes.js';
import { catalogEntry } from './catalog.js';
import {
  stairMetrics, stairsOf, openingRails,
  floorCuts, inFloorCut, cellCut, stairWidth,
} from './stairs.js';

// ---------- procedural textures ----------

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, size, n, colors, rMin = 0.5, rMax = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = rMin + Math.random() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Vinyl composite tile: 4x4 one-foot tiles per texture (= one 4ft cell)
function makeFloorAlbedo() {
  return canvasTex(512, (ctx, S) => {
    const tile = S / 4;
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const l = 78 + Math.random() * 6; // subtle per-tile value shift
        ctx.fillStyle = `hsl(40, 12%, ${l}%)`;
        ctx.fillRect(tx * tile, ty * tile, tile, tile);
      }
    }
    speckle(ctx, S, 2600, ['rgba(255,255,255,0.35)', 'rgba(120,110,95,0.30)', 'rgba(60,55,48,0.22)'], 0.4, 1.4);
    ctx.strokeStyle = 'rgba(30,28,24,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(S, i * tile); ctx.stroke();
    }
  });
}

function makeFloorRoughness() {
  const t = canvasTex(256, (ctx, S) => {
    ctx.fillStyle = 'rgb(115,115,115)'; // semi-gloss vinyl
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 900, ['rgb(160,160,160)', 'rgb(90,90,90)'], 0.5, 2);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Painted drywall with a dark cove base along the bottom. Texture maps one
// 4ft-wide x 10ft-tall wall segment.
function makeWallAlbedo() {
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#e9e6df';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 1500, ['rgba(255,255,255,0.18)', 'rgba(150,145,135,0.10)'], 0.4, 1.2);
    // faint roller streaks
    ctx.strokeStyle = 'rgba(190,185,175,0.10)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * S;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 12, S); ctx.stroke();
    }
    // vinyl cove base: bottom 6in of a 10ft wall = 5% of texture height
    const base = S * 0.05;
    ctx.fillStyle = '#4a4a4e';
    ctx.fillRect(0, S - base, S, base);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, S - base, S, 2);
  });
}

// Acoustic ceiling tile: 2x2 two-foot tiles per 4ft cell, with T-bar grid
function makeCeilingAlbedo() {
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#eeece6';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 4200, ['rgba(120,115,105,0.25)', 'rgba(90,88,80,0.2)'], 0.4, 1.1);
    const tile = S / 2;
    ctx.strokeStyle = 'rgba(160,155,148,0.9)';
    ctx.lineWidth = 5;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(S, i * tile); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(60,58,54,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile + 3, 0); ctx.lineTo(i * tile + 3, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile + 3); ctx.lineTo(S, i * tile + 3); ctx.stroke();
    }
  });
}

function makeGroundAlbedo() {
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = '#606266';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 6000, ['rgba(255,255,255,0.10)', 'rgba(20,20,22,0.25)', 'rgba(140,140,150,0.15)'], 0.4, 1.6);
  }, 40);
}

// ---------- render module ----------

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4e0);
  const walkFog = new THREE.Fog(0x9fc4e0, 220, 700);

  // --- lights ---
  const hemi = new THREE.HemisphereLight(0xbedcf5, 0x8a8474, 1.15);
  const ambient = new THREE.AmbientLight(0xbfd0e0, 0.35);
  scene.add(hemi, ambient);
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.15;
  scene.add(sun, sun.target);

  // --- materials ---
  const floorMat = new THREE.MeshStandardMaterial({
    map: makeFloorAlbedo(),
    roughnessMap: makeFloorRoughness(),
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: true,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    map: makeWallAlbedo(),
    roughness: 0.92,
    metalness: 0.0,
    vertexColors: true,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: makeCeilingAlbedo(),
    roughness: 0.95,
    metalness: 0.0,
  });
  const groundMat = new THREE.MeshStandardMaterial({
    map: makeGroundAlbedo(),
    roughness: 0.97,
    metalness: 0.0,
  });
  // recessed fluorescent troffers — emissive so bloom gives them a soft glow
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xf4f2ea,
    emissive: 0xfff6e2,
    emissiveIntensity: 1.5,
    roughness: 0.4,
  });
  // One material for every prop: each catalog type's geometry carries its own
  // baked-in vertex colors (same trick as the wall/door tinting above), so a
  // desk and a bookshelf can share a material and still look different.
  const propMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.04,
  });
  // Glazing. Transparent surfaces don't write depth — otherwise a pane hides
  // whatever is behind it from every later draw, which is exactly the thing a
  // window is for not doing — and they draw after the opaque pass.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe4ee,
    transparent: true,
    opacity: 0.26,
    roughness: 0.05,
    metalness: 0.0,
    reflectivity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Guardrails and handrails: brushed metal posts with a wood-toned cap, both
  // baked into the vertex colors the way props are.
  const railMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.65,
  });
  // Stair treads — poured concrete with a nosing strip, so a run reads as a
  // stair from across the building rather than as a ramp.
  const stairMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.0,
  });

  // Ghosted copies for the level below the one being edited — enough to line
  // up walls between storeys without the lower floor competing for attention.
  const floorMatGhost = floorMat.clone();
  const wallMatGhost = wallMat.clone();
  const glassMatGhost = glassMat.clone();
  const railMatGhost = railMat.clone();
  const stairMatGhost = stairMat.clone();
  for (const m of [floorMatGhost, wallMatGhost, railMatGhost, stairMatGhost]) {
    m.transparent = true;
    m.depthWrite = false;
    m.roughness = 1.0;
  }
  floorMatGhost.opacity = 0.30;
  wallMatGhost.opacity = 0.22;
  railMatGhost.opacity = 0.28;
  stairMatGhost.opacity = 0.30;
  glassMatGhost.opacity = 0.12;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  for (const m of [floorMat, wallMat, ceilMat, groundMat]) {
    if (m.map) m.map.anisotropy = Math.min(8, maxAniso);
  }

  // --- static ground ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- dynamic building content ---
  // Each of these holds one child Group per storey, indexed by floor number,
  // so a floor can be shown, ghosted or hidden without rebuilding geometry.
  const buildingGroup = new THREE.Group();
  const ceilingGroup = new THREE.Group();   // hidden in edit mode
  ceilingGroup.visible = false;             // starts in edit mode
  const labelGroup = new THREE.Group();
  scene.add(buildingGroup, ceilingGroup, labelGroup);

  let gridHelper = null;
  let built = null;         // last state passed to buildFromState
  let labelledFloor = -1;   // storey whose labels walk mode is currently showing

  // Phase 6 layers panel: what's drawn while editing. Ghosting the floor below
  // is the v1-through-5 default (it's what lines walls up between storeys);
  // ghosting the one above and hiding structure/props outright are new. None
  // of this touches walkthrough mode — there you're standing in the building,
  // not squinting at a cross-section of it, so the whole thing always shows.
  const layers = { structure: true, props: true, ghostBelow: true, ghostAbove: false };

  // --- cameras ---
  // far plane clears the top of an 8-storey building plus the camera's own
  // standoff (see editView.camY)
  const editCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
  editCamera.up.set(0, 0, -1);
  const walkCamera = new THREE.PerspectiveCamera(72, 1, 0.3, 1200);

  // edit view state (world-space center + view height in ft)
  const editView = { x: 0, z: 0, height: 140, camY: 200 };

  function fitEditView(state) {
    editView.x = (state.w * CELL) / 2;
    editView.z = (state.h * CELL) / 2;
    editView.height = state.h * CELL * 1.15;
    editView.camY = 200 + topOfBuilding(state);
  }

  function applyEditCamera() {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const halfH = editView.height / 2;
    editCamera.left = -halfH * aspect;
    editCamera.right = halfH * aspect;
    editCamera.top = halfH;
    editCamera.bottom = -halfH;
    editCamera.position.set(editView.x, editView.camY, editView.z);
    editCamera.lookAt(editView.x, 0, editView.z);
    editCamera.updateProjectionMatrix();
  }

  // --- post-processing ---
  let composer = null;
  let mode = 'edit';
  let fxEnabled = true;

  function buildComposer() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cam = mode === 'edit' ? editCamera : walkCamera;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, cam));
    if (mode === 'walk') {
      // SSAOShader assumes a perspective camera, so AO runs in walkthrough only
      const ssao = new SSAOPass(scene, cam, w, h, 24);
      ssao.kernelRadius = 2.2;
      ssao.minDistance = 0.0004;
      ssao.maxDistance = 0.05;
      composer.addPass(ssao);
    }
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.4, 0.88));
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
  }

  function setMode(m) {
    mode = m;
    const edit = m === 'edit';
    ceilingGroup.visible = !edit;
    if (gridHelper) gridHelper.visible = edit;
    scene.fog = edit ? null : walkFog;
    applyFloorVisibility();
    buildComposer();
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    walkCamera.aspect = w / Math.max(1, h);
    walkCamera.updateProjectionMatrix();
    applyEditCamera();
    buildComposer();
  }

  // In walkthrough, only label the storey the camera is standing on —
  // otherwise every room name on every floor stacks up in the same corridor.
  function updateWalkLabels() {
    if (!built) return;
    const ht = built.floorHt || FLOOR_H;
    const i = Math.min(built.floors.length - 1,
      Math.max(0, Math.floor((walkCamera.position.y + 1) / ht)));
    if (i === labelledFloor) return;
    labelledFloor = i;
    for (const g of labelGroup.children) g.visible = g.userData.floor === i;
  }

  function render() {
    if (mode === 'edit') applyEditCamera();
    else updateWalkLabels();
    if (fxEnabled && composer) composer.render();
    else renderer.render(scene, mode === 'edit' ? editCamera : walkCamera);
  }

  // ---------- geometry building ----------

  const _white = new THREE.Color(1, 1, 1);
  const _doorTint = new THREE.Color('#c98f5f');
  const _glassFrame = new THREE.Color('#8d949c');
  const _railPost = new THREE.Color('#9aa3ad');
  const _railCap = new THREE.Color('#8a5a3a');
  const _tread = new THREE.Color('#c8c6c0');
  const _nosing = new THREE.Color('#5d6067');

  // `color` is usually a shared THREE.Color the caller already has (_white,
  // _doorTint, a per-cell tmpColor); accepting a plain '#rrggbb' string too
  // means a catalog entry's `color` field can be passed straight through —
  // handing this a bare string without the isColor check silently bakes
  // `undefined` (color.r/g/b on a String) into the buffer as NaN, which reads
  // back as black and, worse, poisons an entire bloom pass downstream.
  function coloredGeo(geo, color) {
    const c = color && color.isColor ? color : new THREE.Color(color);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  // ---------- prop geometry ----------
  //
  // v1 for the prop layer is procedural primitives, same call the rest of the
  // scene makes: matches the existing canvas-texture approach, and a box/
  // cylinder kit gives enough shape variety per catalog entry without needing
  // an asset pipeline. `assets/models/` stays the upgrade path if glTF pieces
  // show up later — see its README.
  //
  // Every builder returns one merged, vertex-colored BufferGeometry sized to
  // the catalog entry's own w/d/h, sitting on the local XZ plane with its
  // bottom at local y=0 — so placing an instance is just translate(x, baseY +
  // prop.y, z) · rotateY(rotationY) · scale(prop.scale), no per-type offset.

  const _tintColor = new THREE.Color();
  function tint(hex, dl, ds = 0) {
    _tintColor.set(hex);
    const hsl = {};
    _tintColor.getHSL(hsl);
    return _tintColor.clone().setHSL(hsl.h, Math.min(1, Math.max(0, hsl.s + ds)), Math.min(1, Math.max(0, hsl.l + dl)));
  }

  function box(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  function cyl(rt, rb, h, segs, x, y, z, color) {
    const g = new THREE.CylinderGeometry(rt, rb, h, segs);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  // Rotating variants of the same two, for the parts a plain axis-aligned
  // primitive can't say: splayed stool legs, a tilted slide chute, a star
  // base's arms. Rotation order x, z, then y — tilt first, then turn.
  function boxT(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  function cylT(rt, rb, h, segs, x, y, z, color, rx = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(rt, rb, h, segs);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  function sph(r, x, y, z, color, segs = 14) {
    const g = new THREE.SphereGeometry(r, segs, Math.max(8, Math.round(segs * 0.7)));
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  // Torus, flat (axis Y) by default — a hoop rim, a stool's foot ring. Pass
  // rx: 0 for an upright ring (a bike-rack loop), arc for a partial one.
  function ring(r, tube, x, y, z, color, { arc = Math.PI * 2, rx = Math.PI / 2, rz = 0 } = {}) {
    const g = new THREE.TorusGeometry(r, tube, 8, 20, arc);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  // Surface of revolution from an [r, y] profile — plant pots, a globe stand.
  function lathe(profile, x, y, z, color, segs = 20) {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segs);
    g.translate(x, y, z);
    return coloredGeo(g, color);
  }

  // Horizontal slab extruded from a 2D outline — the table tops a box can't
  // make (trapezoid, kidney). Shape (x, y) lands at world (x, -z), so +y in
  // the outline is the prop's back; underside sits at yBottom.
  function slabGeo(shape, t, yBottom, color) {
    let g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 16 });
    // ExtrudeGeometry is non-indexed, and mergeGeometries refuses to mix it
    // with the indexed primitives everything else here is — welding it makes
    // it indexed (and keeps the hard edges, since normals differ per face).
    g = mergeVertices(g);
    g.rotateX(-Math.PI / 2);
    g.translate(0, yBottom, 0);
    return coloredGeo(g, color);
  }

  const buildDesk = (e) => {
    const legColor = tint(e.color, -0.28);
    const legT = 0.15, topT = 0.1;
    const parts = [box(e.w, topT, e.d, 0, e.h - topT / 2, 0, e.color)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(box(legT, e.h - topT, legT,
        sx * (e.w / 2 - legT), (e.h - topT) / 2, sz * (e.d / 2 - legT), legColor));
    }
    return mergeGeometries(parts);
  };

  // One chair builder, four silhouettes: `style` on the catalog row picks
  // basic (4 straight legs), stack (splayed tube-steel legs), task (5-star
  // rolling base with arms) or rocker (runners and armrests).
  const buildChair = (e) => {
    const style = e.style || 'basic';
    const legColor = tint(e.color, -0.25);
    const seatH = style === 'task' ? e.h * 0.45 : e.h * 0.52;
    const parts = [box(e.w, 0.12, e.d * 0.92, 0, seatH, 0.02, e.color)];
    if (style === 'stack') {
      parts.push(box(e.w * 0.94, (e.h - seatH) * 0.55, 0.1, 0, e.h - (e.h - seatH) * 0.3, -e.d / 2 + 0.06, tint(e.color, -0.06)));
    } else {
      parts.push(box(e.w * 0.94, e.h - seatH - 0.08, 0.1, 0, seatH + (e.h - seatH) / 2 + 0.04, -e.d / 2 + 0.05, tint(e.color, -0.08)));
    }
    if (style === 'task') {
      const base = Math.min(e.w, e.d) / 2 - 0.08;
      parts.push(cyl(0.07, 0.07, seatH - 0.2, 10, 0, (seatH - 0.2) / 2 + 0.2, 0, legColor));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(boxT(0.14, 0.1, base, Math.sin(a) * base * 0.45, 0.14, Math.cos(a) * base * 0.45, legColor, 0, a, 0));
        parts.push(sph(0.09, Math.sin(a) * base * 0.92, 0.09, Math.cos(a) * base * 0.92, tint(e.color, -0.35), 8));
      }
      for (const sx of [-1, 1]) {
        parts.push(box(0.12, 0.1, e.d * 0.5, sx * (e.w / 2 - 0.1), seatH + 0.55, 0, legColor));
        parts.push(box(0.12, 0.55, 0.12, sx * (e.w / 2 - 0.1), seatH + 0.27, e.d * 0.18, legColor));
      }
    } else if (style === 'rocker') {
      for (const sx of [-1, 1]) {
        parts.push(box(0.12, seatH - 0.08, 0.12, sx * (e.w / 2 - 0.12), (seatH - 0.08) / 2 + 0.14, e.d / 2 - 0.35, legColor));
        parts.push(box(0.12, seatH - 0.08, 0.12, sx * (e.w / 2 - 0.12), (seatH - 0.08) / 2 + 0.14, -e.d / 2 + 0.4, legColor));
        parts.push(box(0.1, 0.14, e.d * 1.05, sx * (e.w / 2 - 0.12), 0.07, 0, legColor));
        parts.push(box(0.1, 0.1, e.d * 0.55, sx * (e.w / 2 - 0.1), seatH + 0.75, -0.05, legColor));
      }
    } else if (style === 'stack') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        parts.push(cylT(0.05, 0.05, seatH + 0.05, 8, sx * (e.w / 2 - 0.12), seatH / 2, sz * (e.d / 2 - 0.12), legColor, sz * -0.07, sx * 0.07));
      }
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        parts.push(box(0.12, seatH, 0.12, sx * (e.w / 2 - 0.12), seatH / 2, sz * (e.d / 2 - 0.12), legColor));
      }
    }
    return mergeGeometries(parts);
  };

  // `front: 'doors'` swaps the drawer handles for a pair of tall doors — the
  // same body serves a file cabinet and a supply cabinet.
  const buildCabinet = (e) => {
    const parts = [box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color)];
    const handleColor = tint(e.color, -0.35);
    if (e.front === 'doors') {
      const doorColor = tint(e.color, 0.06);
      for (const sx of [-1, 1]) {
        parts.push(box(e.w / 2 - 0.08, e.h - 0.2, 0.05, sx * e.w / 4, e.h / 2, e.d / 2 + 0.02, doorColor));
        parts.push(box(0.07, 0.5, 0.07, sx * 0.15, e.h * 0.5, e.d / 2 + 0.07, handleColor));
      }
    } else {
      const drawers = Math.max(2, Math.round(e.h / 1.3));
      for (let i = 0; i < drawers; i++) {
        const y = (e.h / drawers) * (i + 0.85);
        parts.push(box(e.w * 0.5, 0.05, 0.06, 0, y, e.d / 2 + 0.01, handleColor));
      }
    }
    return mergeGeometries(parts);
  };

  const buildShelf = (e) => {
    const t = 0.08, sideColor = tint(e.color, -0.12), shelfColor = tint(e.color, 0.06);
    const parts = [
      box(t, e.h, e.d, -e.w / 2 + t / 2, e.h / 2, 0, sideColor),
      box(t, e.h, e.d, e.w / 2 - t / 2, e.h / 2, 0, sideColor),
      box(e.w, t, e.d, 0, t / 2, 0, sideColor),
      box(e.w - t * 2, t, e.d - 0.06, 0, e.h - t / 2, 0.03, shelfColor),
    ];
    const shelves = Math.max(2, Math.round(e.h / 1.4));
    for (let i = 1; i < shelves; i++) {
      const y = (e.h / shelves) * i;
      parts.push(box(e.w - t * 2, t, e.d - 0.06, 0, y, 0.03, shelfColor));
    }
    return mergeGeometries(parts);
  };

  // A shelf unit with vertical dividers added — reuses buildShelf's frame
  // wholesale (mergeGeometries is happy to merge an already-merged geometry
  // back into a bigger one).
  const buildCubby = (e) => {
    const parts = [buildShelf(e)];
    const cols = Math.max(2, Math.round(e.w / 1.3));
    const dividerColor = tint(e.color, -0.15);
    for (let i = 1; i < cols; i++) {
      const x = -e.w / 2 + (e.w / cols) * i;
      parts.push(box(0.06, e.h, e.d - 0.06, x, e.h / 2, 0.03, dividerColor));
    }
    // `bins: true` fills each opening with a colored tote, angled slightly out
    // of its slot — the same frame reads as a tote rack instead of shelving.
    if (e.bins) {
      const binColors = ['#b0503f', '#3f6fae', '#c99a3f', '#3f7a48'];
      const rows = Math.max(2, Math.round(e.h / 1.4));
      const cw = e.w / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = -e.w / 2 + cw * (c + 0.5);
          const y = (e.h / rows) * r + 0.14;
          parts.push(box(cw - 0.24, (e.h / rows) * 0.55, e.d - 0.2, x, y + (e.h / rows) * 0.28, 0.09,
            binColors[(r + c) % binColors.length]));
        }
      }
    }
    return mergeGeometries(parts);
  };

  const buildLamp = (e) => {
    const shadeColor = tint(e.color, 0.08);
    const poleColor = tint(e.color, -0.4);
    return mergeGeometries([
      cyl(e.w * 0.22, e.w * 0.28, 0.08, 16, 0, 0.04, 0, poleColor),
      cyl(0.045, 0.045, e.h - 0.7, 8, 0, (e.h - 0.7) / 2 + 0.08, 0, poleColor),
      cyl(e.w * 0.16, e.w * 0.36, 0.55, 16, 0, e.h - 0.3, 0, shadeColor),
    ]);
  };

  // Wall-mounted panel (TV, smart board, whiteboard): a slab whose face sits
  // at local z = +d/2 — the side propplace.js's wall snap turns to face the
  // room — with a thin bezel tint so it doesn't read as a flat color swatch.
  const buildPanel = (e) => mergeGeometries([
    box(e.w, e.h, e.d, 0, e.h / 2, 0, tint(e.color, -0.15)),
    box(e.w - 0.15, e.h - 0.15, e.d * 0.4, 0, e.h / 2, e.d * 0.2, e.color),
  ]);

  const buildRug = (e) => mergeGeometries([
    box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color),
    box(e.w - 0.7, e.h, e.d - 0.7, 0, e.h + 0.005, 0, tint(e.color, 0.14)),
  ]);

  const buildBin = (e) => cyl(e.w / 2 * 0.82, e.w / 2, e.h, 12, 0, e.h / 2, 0, e.color);

  const buildSink = (e) => {
    const cabColor = tint(e.color, -0.35);
    const counterH = e.h * 0.82;
    return mergeGeometries([
      box(e.w, counterH, e.d, 0, counterH / 2, 0, cabColor),
      box(e.w + 0.1, e.h - counterH, e.d + 0.1, 0, counterH + (e.h - counterH) / 2, 0, e.color),
      box(e.w * 0.55, (e.h - counterH) * 0.5, e.d * 0.5, 0, e.h - 0.02, -e.d * 0.15, tint(e.color, -0.2)),
      cyl(0.03, 0.03, 0.35, 6, 0, e.h + 0.15, -e.d / 2 + 0.15, cabColor),
    ]);
  };

  // ---------- Phase 1 builders: tables, seating, storage ----------

  // Generic table: seatless by design (seating composes from the chair/stool
  // types). `top` picks rect (default), round (pedestal base), trapezoid or
  // kidney (extruded outlines); `base: 'folding'` angles the leg pairs in.
  const buildTable = (e) => {
    const topT = 0.12, legColor = tint(e.color, -0.3);
    const parts = [];
    const top = e.top || 'rect';
    if (top === 'round') {
      parts.push(cyl(e.w / 2, e.w / 2, topT, 28, 0, e.h - topT / 2, 0, e.color));
      parts.push(cyl(0.15, 0.22, e.h - topT - 0.1, 12, 0, (e.h - topT) / 2, 0, legColor));
      parts.push(cyl(e.w * 0.2, e.w * 0.24, 0.12, 18, 0, 0.06, 0, legColor));
    } else {
      if (top === 'trapezoid') {
        const s = new THREE.Shape();
        const wTop = e.w * 0.55;
        s.moveTo(-e.w / 2, -e.d / 2); s.lineTo(e.w / 2, -e.d / 2);
        s.lineTo(wTop / 2, e.d / 2); s.lineTo(-wTop / 2, e.d / 2); s.closePath();
        parts.push(slabGeo(s, topT, e.h - topT, e.color));
      } else if (top === 'kidney') {
        const s = new THREE.Shape();
        const w = e.w / 2, d = e.d / 2;
        s.moveTo(-w, 0);
        s.bezierCurveTo(-w, d, w, d, w, 0);
        s.bezierCurveTo(w * 0.6, -d * 0.7, w * 0.25, -d * 0.15, 0, -d * 0.2);
        s.bezierCurveTo(-w * 0.25, -d * 0.15, -w * 0.6, -d * 0.7, -w, 0);
        parts.push(slabGeo(s, topT, e.h - topT, e.color));
      } else {
        parts.push(box(e.w, topT, e.d, 0, e.h - topT / 2, 0, e.color));
      }
      const inX = e.w / 2 - 0.35, inZ = e.d / 2 - 0.3;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (e.base === 'folding') {
          parts.push(cylT(0.06, 0.06, e.h - topT + 0.1, 8, sx * inX, (e.h - topT) / 2, sz * inZ, legColor, 0, sx * 0.18));
        } else {
          parts.push(cyl(0.07, 0.09, e.h - topT, 8, sx * inX, (e.h - topT) / 2, sz * inZ, legColor));
        }
      }
      if (e.base === 'folding') {
        parts.push(box(e.w * 0.8, 0.08, 0.1, 0, e.h * 0.4, 0, legColor));
      }
    }
    return mergeGeometries(parts);
  };

  // Desk with a device on top: monitor + keyboard, a 3D printer frame, or a
  // sewing machine. The desk half reuses buildDesk against a shorter row.
  const buildWorkstation = (e) => {
    const deskH = Math.min(2.5, e.h);
    const parts = [buildDesk({ ...e, h: deskH })];
    const dark = tint(e.color, -0.45, -0.2);
    if (e.device === 'printer') {
      const s = Math.min(e.w, e.d) * 0.72;
      parts.push(box(s, 0.12, s, 0, deskH + 0.06, 0, dark));
      for (const sx of [-1, 1]) parts.push(box(0.1, e.h - deskH - 0.2, s, sx * (s / 2 - 0.05), deskH + (e.h - deskH) / 2, 0, dark));
      parts.push(box(s - 0.2, 0.12, s, 0, e.h - 0.12, 0, dark));
      parts.push(box(0.5, 0.4, 0.5, 0, deskH + 0.45, 0, tint(e.color, 0.2)));
      parts.push(cylT(0.18, 0.18, 0.15, 12, 0, e.h - 0.3, -e.d * 0.1, '#d8d3c8', Math.PI / 2, 0));
    } else if (e.device === 'sewing') {
      parts.push(box(e.w * 0.42, 0.22, e.d * 0.5, -e.w * 0.08, deskH + 0.11, 0, dark));
      parts.push(box(0.24, 0.7, e.d * 0.32, -e.w * 0.25, deskH + 0.55, 0, dark));
      parts.push(box(e.w * 0.36, 0.2, e.d * 0.3, -e.w * 0.08, deskH + 1.0, 0, dark));
      parts.push(cyl(0.1, 0.1, 0.24, 10, e.w * 0.12, deskH + 0.34, 0, tint(e.color, 0.25)));
    } else {
      parts.push(box(e.w * 0.45, e.h * 0.35, 0.08, 0, deskH + e.h * 0.28, -e.d * 0.18, dark));
      parts.push(box(0.3, 0.28, 0.2, 0, deskH + 0.14, -e.d * 0.18, dark));
      parts.push(box(e.w * 0.32, 0.05, 0.5, 0, deskH + 0.03, e.d * 0.12, tint(e.color, 0.15)));
    }
    return mergeGeometries(parts);
  };

  // Study carrel: a desk wrapped in privacy panels on three sides.
  const buildCarrel = (e) => {
    const deskH = 2.5;
    const panelColor = tint(e.color, 0.12);
    return mergeGeometries([
      buildDesk({ ...e, h: deskH }),
      box(e.w, e.h - 0.4, 0.1, 0, (e.h - 0.4) / 2 + 0.4, -e.d / 2 + 0.05, panelColor),
      box(0.1, e.h - 0.4, e.d, -e.w / 2 + 0.05, (e.h - 0.4) / 2 + 0.4, 0, panelColor),
      box(0.1, e.h - 0.4, e.d, e.w / 2 - 0.05, (e.h - 0.4) / 2 + 0.4, 0, panelColor),
    ]);
  };

  const buildPodium = (e) => {
    const bodyColor = e.color;
    return mergeGeometries([
      box(e.w * 0.8, 0.15, e.d * 0.9, 0, 0.08, 0, tint(e.color, -0.2)),
      boxT(e.w * 0.7, e.h - 0.5, e.d * 0.55, 0, (e.h - 0.5) / 2 + 0.1, 0, bodyColor, 0.06, 0, 0),
      boxT(e.w, 0.12, e.d * 0.8, 0, e.h - 0.2, -0.1, tint(e.color, 0.08), -0.35, 0, 0),
    ]);
  };

  // Lab bench / demo table / robotics bench: base cabinets under a resistant
  // top. Robotics (`pegboard: true`) gets a tool board instead of a faucet.
  const buildLabbench = (e) => {
    const topColor = tint(e.color, -0.3), bodyColor = tint(e.color, 0.18);
    const parts = [
      box(e.w - 0.2, e.h - 0.35, e.d - 0.2, 0, (e.h - 0.35) / 2, 0, bodyColor),
      box(e.w, 0.2, e.d, 0, e.h - 0.1, 0, topColor),
    ];
    const doors = Math.max(2, Math.round(e.w / 1.6));
    for (let i = 0; i < doors; i++) {
      const x = -e.w / 2 + (e.w / doors) * (i + 0.5);
      parts.push(box(e.w / doors - 0.25, e.h - 0.7, 0.05, x, (e.h - 0.7) / 2 + 0.15, e.d / 2 - 0.06, tint(bodyColor, 0.06)));
      parts.push(box(0.3, 0.06, 0.08, x, e.h - 0.55, e.d / 2, tint(e.color, -0.1)));
    }
    if (e.pegboard) {
      parts.push(box(e.w, 1.6, 0.1, 0, e.h + 0.8, -e.d / 2 + 0.05, tint(e.color, 0.3)));
    } else {
      parts.push(cylT(0.05, 0.05, 0.6, 8, -e.w * 0.3, e.h + 0.28, -e.d * 0.2, '#b8bcc2', 0, 0));
      parts.push(cylT(0.05, 0.05, 0.35, 8, -e.w * 0.3 + 0.17, e.h + 0.55, -e.d * 0.2, '#b8bcc2', 0, Math.PI / 2));
    }
    return mergeGeometries(parts);
  };

  const buildStool = (e) => {
    const seatH = e.h - 0.1, legColor = tint(e.color, -0.2);
    const parts = [cyl(e.w / 2, e.w / 2 * 0.92, 0.18, 18, 0, seatH, 0, tint(e.color, 0.15))];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push(cylT(0.05, 0.05, seatH, 8, Math.sin(a) * (e.w / 2 - 0.14), seatH / 2, Math.cos(a) * (e.w / 2 - 0.14), legColor, Math.cos(a) * 0.12, Math.sin(a) * -0.12));
    }
    parts.push(ring(e.w / 2 - 0.16, 0.035, 0, seatH * 0.4, 0, legColor));
    return mergeGeometries(parts);
  };

  // Bench: slat seat on end legs; `back: true` adds a backrest (park bench).
  const buildBench = (e) => {
    const seatH = e.back ? e.h * 0.55 : e.h;
    const legColor = tint(e.color, -0.25);
    const parts = [];
    for (let i = 0; i < 3; i++) {
      parts.push(box(e.w, 0.1, (e.d * 0.8) / 3 - 0.05, 0, seatH - 0.05, -e.d * 0.4 + (e.d * 0.8) * (i + 0.5) / 3, tint(e.color, 0.06)));
    }
    for (const sx of [-1, 1]) {
      parts.push(box(0.15, seatH - 0.1, e.d * 0.8, sx * (e.w / 2 - 0.3), (seatH - 0.1) / 2, 0, legColor));
    }
    if (e.back) {
      for (let i = 0; i < 2; i++) {
        parts.push(boxT(e.w, 0.35, 0.08, 0, seatH + 0.45 + i * 0.55, -e.d / 2 + 0.12 + (i * 0.04), tint(e.color, 0.06), -0.12, 0, 0));
      }
      for (const sx of [-1, 1]) {
        parts.push(boxT(0.12, e.h - seatH + 0.3, 0.12, sx * (e.w / 2 - 0.3), seatH + (e.h - seatH) / 2 - 0.1, -e.d / 2 + 0.16, legColor, -0.12, 0, 0));
      }
    }
    return mergeGeometries(parts);
  };

  // Soft seating: beanbag (lathed blob), floor cushion, lounge chair, sofa.
  const buildSoftseat = (e) => {
    const kind = e.kind || 'sofa';
    if (kind === 'beanbag') {
      const r = e.w / 2;
      return mergeGeometries([
        lathe([[0.01, 0], [r * 0.92, 0.06], [r, e.h * 0.4], [r * 0.6, e.h * 0.85], [0.12, e.h]], 0, 0, 0, e.color, 22),
      ]);
    }
    if (kind === 'cushion') {
      return mergeGeometries([
        box(e.w, e.h * 0.75, e.d, 0, e.h * 0.375, 0, e.color),
        box(e.w * 0.85, e.h * 0.25, e.d * 0.85, 0, e.h * 0.87, 0, tint(e.color, 0.1)),
      ]);
    }
    // lounge / sofa share the frame; the sofa just has more seat cushions.
    const seatH = e.h * 0.55, armW = 0.45;
    const frame = tint(e.color, -0.12);
    const parts = [
      box(e.w, seatH * 0.55, e.d, 0, seatH * 0.28, 0, frame),
      box(e.w, e.h - seatH * 0.55, 0.5, 0, (e.h - seatH * 0.55) / 2 + seatH * 0.55, -e.d / 2 + 0.25, frame),
    ];
    const cushions = kind === 'sofa' ? Math.max(2, Math.round(e.w / 2)) : 1;
    const cw = (e.w - armW * 2) / cushions;
    for (let i = 0; i < cushions; i++) {
      const x = -e.w / 2 + armW + cw * (i + 0.5);
      parts.push(box(cw - 0.12, 0.35, e.d - 0.7, x, seatH * 0.55 + 0.17, 0.1, tint(e.color, 0.08)));
      parts.push(box(cw - 0.12, e.h - seatH - 0.3, 0.35, x, seatH + (e.h - seatH) / 2 - 0.05, -e.d / 2 + 0.55, tint(e.color, 0.05)));
    }
    for (const sx of [-1, 1]) {
      parts.push(box(armW, e.h * 0.75, e.d, sx * (e.w / 2 - armW / 2), e.h * 0.375, 0, frame));
    }
    return mergeGeometries(parts);
  };

  // Auditorium seat: fold-up-style seat pan, high back, shared-row armrests.
  const buildAudseat = (e) => {
    const dark = tint(e.color, -0.3);
    return mergeGeometries([
      boxT(e.w - 0.4, 0.5, e.d * 0.55, 0, e.h * 0.35, 0.1, e.color, -0.5, 0, 0),
      boxT(e.w - 0.4, e.h * 0.6, 0.25, 0, e.h * 0.62, -e.d / 2 + 0.3, e.color, -0.08, 0, 0),
      box(0.14, e.h * 0.42, 0.14, -e.w / 2 + 0.1, e.h * 0.21, -e.d * 0.1, dark),
      box(0.14, e.h * 0.42, 0.14, e.w / 2 - 0.1, e.h * 0.21, -e.d * 0.1, dark),
      box(0.2, 0.08, e.d * 0.55, -e.w / 2 + 0.1, e.h * 0.44, -e.d * 0.05, dark),
      box(0.2, 0.08, e.d * 0.55, e.w / 2 - 0.1, e.h * 0.44, -e.d * 0.05, dark),
    ]);
  };

  // Locker bank: `doors` across, `tiers` high (1 = full-height, 2 = stacked
  // half-lockers), each door with a vent stamp and a latch.
  const buildLocker = (e) => {
    const doors = Math.max(1, e.doors || Math.round(e.w));
    const tiers = Math.max(1, e.tiers || 1);
    const parts = [box(e.w, e.h, e.d, 0, e.h / 2, 0, tint(e.color, -0.18))];
    const dw = e.w / doors, th = (e.h - 0.2) / tiers;
    const doorColor = e.color, ventColor = tint(e.color, -0.3);
    for (let i = 0; i < doors; i++) {
      for (let t = 0; t < tiers; t++) {
        const x = -e.w / 2 + dw * (i + 0.5);
        const y0 = 0.1 + th * t;
        parts.push(box(dw - 0.12, th - 0.1, 0.05, x, y0 + th / 2, e.d / 2 + 0.01, doorColor));
        parts.push(box(dw * 0.5, 0.08, 0.03, x, y0 + th * 0.82, e.d / 2 + 0.05, ventColor));
        parts.push(box(dw * 0.5, 0.08, 0.03, x, y0 + th * 0.72, e.d / 2 + 0.05, ventColor));
        parts.push(box(0.1, 0.18, 0.06, x + dw * 0.28, y0 + th * 0.45, e.d / 2 + 0.04, ventColor));
      }
    }
    return mergeGeometries(parts);
  };

  const buildCoatrack = (e) => {
    const postColor = tint(e.color, -0.2);
    const parts = [
      box(0.5, 0.12, e.d, -e.w / 2 + 0.25, 0.06, 0, postColor),
      box(0.5, 0.12, e.d, e.w / 2 - 0.25, 0.06, 0, postColor),
      box(0.15, e.h - 0.4, 0.15, -e.w / 2 + 0.25, (e.h - 0.4) / 2 + 0.12, 0, postColor),
      box(0.15, e.h - 0.4, 0.15, e.w / 2 - 0.25, (e.h - 0.4) / 2 + 0.12, 0, postColor),
      cylT(0.05, 0.05, e.w - 0.3, 10, 0, e.h - 0.3, 0, tint(e.color, 0.1), 0, Math.PI / 2),
      box(e.w - 0.5, 0.08, 0.6, 0, e.h - 0.05, 0, e.color),
    ];
    const hangers = Math.max(3, Math.round(e.w * 1.5));
    for (let i = 0; i < hangers; i++) {
      const x = -e.w / 2 + 0.5 + ((e.w - 1) / (hangers - 1)) * i;
      parts.push(box(0.06, 0.5, 0.06, x, e.h - 0.55, 0, tint(e.color, 0.25)));
    }
    return mergeGeometries(parts);
  };

  const buildCart = (e) => {
    const frameColor = tint(e.color, -0.15);
    const parts = [];
    for (const level of [0.35, e.h * 0.55, e.h - 0.5]) {
      parts.push(box(e.w, 0.08, e.d, 0, level, 0, e.color));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(box(0.08, e.h - 0.5, 0.08, sx * (e.w / 2 - 0.06), (e.h - 0.5) / 2 + 0.15, sz * (e.d / 2 - 0.06), frameColor));
      parts.push(sph(0.14, sx * (e.w / 2 - 0.2), 0.14, sz * (e.d / 2 - 0.2), tint(e.color, -0.4), 8));
    }
    parts.push(cylT(0.045, 0.045, e.d, 8, e.w / 2 + 0.12, e.h - 0.25, 0, frameColor, Math.PI / 2, 0));
    return mergeGeometries(parts);
  };

  // Double-sided library stack: a center spine with shelves both sides,
  // closed off by end panels — two bookshelves standing back to back.
  const buildStack = (e) => {
    const t = 0.1, endColor = tint(e.color, -0.12), shelfColor = tint(e.color, 0.06);
    const parts = [
      box(e.w, e.h, t, 0, e.h / 2, 0, endColor),
      box(t, e.h, e.d, -e.w / 2 + t / 2, e.h / 2, 0, endColor),
      box(t, e.h, e.d, e.w / 2 - t / 2, e.h / 2, 0, endColor),
      box(e.w, 0.3, e.d, 0, 0.15, 0, endColor),
    ];
    const shelves = Math.max(3, Math.round(e.h / 1.2));
    for (let i = 1; i <= shelves; i++) {
      const y = (e.h / shelves) * i - 0.05;
      for (const sz of [-1, 1]) {
        parts.push(box(e.w - t * 2, t, e.d / 2 - t, 0, y, sz * (e.d / 4 + t / 4), shelfColor));
      }
    }
    return mergeGeometries(parts);
  };

  // Wall hook rail; `hung: true` dresses it with coats and backpacks.
  const buildHookrail = (e) => {
    const parts = [box(e.w, 0.35, 0.12, 0, e.h - 0.18, 0, e.color)];
    const hooks = Math.max(3, Math.round(e.w * 1.2));
    for (let i = 0; i < hooks; i++) {
      const x = -e.w / 2 + 0.3 + ((e.w - 0.6) / (hooks - 1)) * i;
      parts.push(box(0.06, 0.22, 0.18, x, e.h - 0.3, 0.12, tint(e.color, -0.3)));
      if (e.hung && i % 3 !== 2) {
        const coat = i % 3 === 0;
        const c = coat ? tint(e.color, 0.15, 0.1) : ['#b0503f', '#3f6fae', '#c99a3f'][i % 3];
        parts.push(box(coat ? 0.55 : 0.7, coat ? e.h - 0.6 : e.h * 0.55, coat ? 0.16 : 0.3, x, (coat ? (e.h - 0.6) / 2 : e.h * 0.35), 0.2, c));
      }
    }
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: fixtures ----------

  const buildClock = (e) => {
    const r = e.w / 2;
    return mergeGeometries([
      cylT(r, r, e.d * 0.6, 24, 0, e.h / 2, e.d * 0.3, tint(e.color, -0.35), Math.PI / 2, 0),
      cylT(r * 0.88, r * 0.88, 0.03, 24, 0, e.h / 2, e.d * 0.62, e.color, Math.PI / 2, 0),
      box(0.05, r * 0.55, 0.02, 0, e.h / 2 + r * 0.27, e.d * 0.64, '#22262c'),
      box(r * 0.4, 0.05, 0.02, r * 0.2, e.h / 2, e.d * 0.64, '#22262c'),
    ]);
  };

  // Pull-down screen or blinds: housing at the top, a sheet hanging below it
  // — `sheet` is how far down it's drawn (1 = fully, blinds sit partway).
  const buildPulldown = (e) => {
    const housingH = 0.4;
    const drop = (e.h - housingH) * (e.sheet ?? 1);
    const parts = [
      cylT(0.18, 0.18, e.w, 14, 0, e.h - housingH / 2, 0, tint(e.color, -0.4), 0, Math.PI / 2),
      box(e.w - 0.3, drop, 0.06, 0, e.h - housingH - drop / 2, 0.05, e.color),
      box(e.w - 0.3, 0.1, 0.1, 0, e.h - housingH - drop, 0.05, tint(e.color, -0.35)),
    ];
    return mergeGeometries(parts);
  };

  // Ceiling projector: a stem up to the slab, the body hanging under it.
  const buildProjector = (e) => {
    return mergeGeometries([
      cyl(0.06, 0.06, e.h - 0.6, 8, 0, e.h - (e.h - 0.6) / 2, 0, tint(e.color, -0.35)),
      box(e.w, 0.5, e.d, 0, 0.35, 0, e.color),
      cylT(0.14, 0.14, 0.1, 14, e.w * 0.25, 0.35, e.d / 2 + 0.04, '#2a2f36', Math.PI / 2, 0),
      box(e.w * 0.6, 0.04, e.d * 0.5, 0, 0.08, 0, tint(e.color, -0.2)),
    ]);
  };

  // Trophy case: base cabinet, framed "glass" (a pale baked tint — the one
  // shared prop material is opaque), lit shelves and a few trophies.
  const buildDisplaycase = (e) => {
    const frame = tint(e.color, -0.15), glass = '#b8ccd4';
    const baseH = 0.9;
    const parts = [
      box(e.w, baseH, e.d, 0, baseH / 2, 0, e.color),
      box(e.w, 0.12, e.d, 0, e.h - 0.06, 0, frame),
    ];
    for (const sx of [-1, 1]) parts.push(box(0.12, e.h - baseH, e.d, sx * (e.w / 2 - 0.06), baseH + (e.h - baseH) / 2, 0, frame));
    parts.push(box(e.w - 0.24, e.h - baseH - 0.12, 0.03, 0, baseH + (e.h - baseH) / 2, e.d / 2 - 0.05, glass));
    parts.push(box(e.w - 0.24, e.h - baseH - 0.12, 0.06, 0, baseH + (e.h - baseH) / 2, -e.d / 2 + 0.04, tint(e.color, 0.25)));
    const shelves = 2;
    for (let i = 1; i <= shelves; i++) {
      const y = baseH + ((e.h - baseH - 0.2) / (shelves + 1)) * i;
      parts.push(box(e.w - 0.3, 0.06, e.d - 0.3, 0, y, 0, glass));
      const across = Math.max(2, Math.round(e.w / 1.6));
      for (let j = 0; j < across; j++) {
        const x = -e.w / 2 + (e.w / across) * (j + 0.5);
        parts.push(cyl(0.06, 0.14, 0.5, 8, x, y + 0.28, 0, '#c9a227'));
        parts.push(sph(0.11, x, y + 0.62, 0, '#c9a227', 8));
      }
    }
    return mergeGeometries(parts);
  };

  const buildFountain = (e) => {
    const body = tint(e.color, -0.1);
    return mergeGeometries([
      box(e.w, e.h * 0.78, e.d, 0, e.h * 0.39, 0, body),
      box(e.w + 0.12, 0.3, e.d + 0.12, 0, e.h * 0.78 + 0.1, 0, e.color),
      box(e.w * 0.5, 0.1, e.d * 0.45, 0, e.h * 0.78 + 0.22, 0.05, tint(e.color, -0.3)),
      cylT(0.04, 0.04, 0.3, 8, -e.w * 0.2, e.h * 0.78 + 0.36, 0, tint(e.color, -0.35), 0.9, 0),
      box(e.w * 0.6, e.h * 0.22 + 0.2, 0.15, 0, e.h - (e.h * 0.22 + 0.2) / 2 + 0.15, -e.d / 2 + 0.08, body),
    ]);
  };

  // Generic wall cabinet/box; `style` stamps the front: 'fire' (white cross),
  // 'aed' (heart), 'grille' (speaker slats), default a plain door seam.
  const buildWallbox = (e) => {
    const parts = [box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color)];
    const front = e.d / 2 + 0.01;
    if (e.style === 'fire') {
      parts.push(box(e.w * 0.5, 0.14, 0.03, 0, e.h / 2, front, '#f4f4f2'));
      parts.push(box(0.14, e.h * 0.4, 0.03, 0, e.h / 2, front, '#f4f4f2'));
    } else if (e.style === 'aed') {
      parts.push(box(e.w * 0.45, e.h * 0.4, 0.03, 0, e.h / 2, front, '#c0392b'));
      parts.push(box(e.w * 0.6, 0.1, 0.03, 0, e.h * 0.85, front, '#c0392b'));
    } else if (e.style === 'grille') {
      for (let i = 0; i < 4; i++) {
        parts.push(box(e.w * 0.7, 0.06, 0.03, 0, e.h * (0.25 + i * 0.17), front, tint(e.color, -0.3)));
      }
    } else {
      parts.push(box(e.w * 0.85, e.h * 0.85, 0.03, 0, e.h / 2, front, tint(e.color, 0.08)));
      parts.push(box(0.06, 0.25, 0.05, e.w * 0.3, e.h / 2, front + 0.03, tint(e.color, -0.3)));
    }
    return mergeGeometries(parts);
  };

  // Flag on an angled wall bracket, cloth hanging along the pole.
  const buildFlagwall = (e) => {
    const poleColor = '#c9a227';
    const tiltZ = -0.7;
    return mergeGeometries([
      box(0.3, 0.5, 0.15, 0, 0.35, 0.07, tint(e.color, -0.3)),
      cylT(0.04, 0.05, e.h * 0.95, 8, e.d * 0.28, e.h * 0.42, e.d * 0.35, poleColor, tiltZ, 0),
      sph(0.08, e.d * 0.55, e.h * 0.78, e.d * 0.68, poleColor, 8),
      boxT(0.05, e.h * 0.55, e.d * 0.55, e.d * 0.3, e.h * 0.38, e.d * 0.42, e.color, tiltZ, 0, 0),
    ]);
  };

  const buildRadiator = (e) => {
    const parts = [
      box(e.w, 0.1, e.d, 0, e.h - 0.05, 0, tint(e.color, -0.1)),
      box(0.15, e.h - 0.1, e.d, -e.w / 2 + 0.08, (e.h - 0.1) / 2, 0, e.color),
      box(0.15, e.h - 0.1, e.d, e.w / 2 - 0.08, (e.h - 0.1) / 2, 0, e.color),
    ];
    const fins = Math.max(4, Math.round(e.w * 2.5));
    for (let i = 1; i < fins; i++) {
      const x = -e.w / 2 + (e.w / fins) * i;
      parts.push(box(0.08, e.h - 0.35, e.d * 0.8, x, (e.h - 0.35) / 2 + 0.1, 0, tint(e.color, 0.06)));
    }
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: subject rooms ----------

  const buildPiano = (e) => {
    const body = e.color, keyH = 2.3;
    return mergeGeometries([
      box(e.w, e.h, e.d * 0.6, 0, e.h / 2, -e.d * 0.2, body),
      box(e.w, 0.5, e.d * 0.95, 0, keyH + 0.25, 0, body),
      box(e.w - 0.5, 0.12, e.d * 0.42, 0, keyH + 0.06, e.d * 0.22, '#efefec'),
      ...Array.from({ length: 14 }, (_, i) => {
        const x = -e.w / 2 + 0.45 + ((e.w - 0.9) / 13) * i;
        return box(0.09, 0.08, e.d * 0.2, x, keyH + 0.16, e.d * 0.16, '#17181c');
      }),
      box(e.w * 0.5, 0.35, 0.1, 0, e.h - 0.6, -e.d * 0.49, tint(body, 0.15)),
      box(0.4, 0.08, 0.3, -0.3, 0.35, e.d * 0.32, '#c9a227'),
      box(0.4, 0.08, 0.3, 0.3, 0.35, e.d * 0.32, '#c9a227'),
      ...[-1, 1].map((sx) => box(0.3, 0.6, 0.25, sx * (e.w / 2 - 0.2), 0.3, e.d * 0.15, body)),
    ]);
  };

  const buildMusicstand = (e) => {
    const c = e.color;
    const parts = [cyl(0.04, 0.04, e.h * 0.55, 8, 0, e.h * 0.42, 0, c)];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(cylT(0.035, 0.035, 0.75, 6, Math.sin(a) * 0.35, 0.28, Math.cos(a) * 0.35, c, Math.cos(a) * 0.85, Math.sin(a) * -0.85));
    }
    parts.push(boxT(e.w * 0.85, e.h * 0.35, 0.05, 0, e.h * 0.82, -0.12, tint(c, 0.12), -0.4, 0, 0));
    parts.push(boxT(e.w * 0.85, 0.1, 0.16, 0, e.h * 0.66, -0.02, tint(c, 0.12), -0.4, 0, 0));
    return mergeGeometries(parts);
  };

  // Stepped platforms: a choir riser (shallow steps), a stage section
  // (rows: 1), or a bleacher (`seats: true` puts a plank on each step).
  const buildRiser = (e) => {
    const rows = Math.max(1, e.rows || 1);
    const parts = [];
    const stepD = e.d / rows, stepH = e.h / rows;
    const face = tint(e.color, -0.18);
    for (let i = 0; i < rows; i++) {
      const z = e.d / 2 - stepD * (i + 0.5);
      const h = stepH * (i + 1);
      parts.push(box(e.w, h, stepD, 0, h / 2, z, i % 2 ? tint(e.color, 0.05) : e.color));
      parts.push(box(e.w, h, 0.05, 0, h / 2, z + stepD / 2 - 0.02, face));
      if (e.seats) {
        parts.push(box(e.w, 0.15, stepD * 0.55, 0, h + 0.08, z - stepD * 0.1, tint(e.color, 0.2)));
      }
    }
    return mergeGeometries(parts);
  };

  const buildEasel = (e) => {
    const c = tint(e.color, -0.1);
    return mergeGeometries([
      boxT(0.12, e.h, 0.12, -e.w / 2 + 0.2, e.h / 2, e.d * 0.12, c, 0.18, 0, 0.1),
      boxT(0.12, e.h, 0.12, e.w / 2 - 0.2, e.h / 2, e.d * 0.12, c, 0.18, 0, -0.1),
      boxT(0.12, e.h * 0.95, 0.12, 0, e.h * 0.47, -e.d * 0.3, c, -0.35, 0, 0),
      boxT(e.w * 0.8, 0.12, 0.2, 0, e.h * 0.32, e.d * 0.2, c, 0.18, 0, 0),
      boxT(e.w * 0.75, e.h * 0.45, 0.06, 0, e.h * 0.6, e.d * 0.14, '#f4f4f2', 0.18, 0, 0),
    ]);
  };

  const buildDryrack = (e) => {
    const frame = tint(e.color, -0.2);
    const parts = [];
    for (const sx of [-1, 1]) {
      parts.push(box(0.1, e.h, 0.1, sx * (e.w / 2 - 0.05), e.h / 2, -e.d / 2 + 0.05, frame));
      parts.push(box(0.1, e.h, 0.1, sx * (e.w / 2 - 0.05), e.h / 2, e.d / 2 - 0.05, frame));
    }
    const shelves = 8;
    for (let i = 0; i < shelves; i++) {
      parts.push(box(e.w - 0.15, 0.05, e.d - 0.1, 0, 0.5 + ((e.h - 0.8) / (shelves - 1)) * i, 0, e.color));
    }
    return mergeGeometries(parts);
  };

  const buildKiln = (e) => {
    const r = Math.min(e.w, e.d) / 2 - 0.1;
    return mergeGeometries([
      cyl(r, r, e.h * 0.75, 8, 0, e.h * 0.42, 0, e.color),
      cyl(r + 0.06, r + 0.06, 0.2, 8, 0, e.h * 0.85, 0, tint(e.color, -0.2)),
      box(r, 0.35, 0.12, 0, e.h * 0.85, r * 0.9, tint(e.color, -0.35)),
      box(0.5, 0.7, 0.3, e.w / 2 - 0.2, e.h * 0.4, 0, '#3a3f45'),
      box(e.w, 0.15, e.d, 0, 0.08, 0, tint(e.color, -0.3)),
    ]);
  };

  const buildWheel = (e) => {
    return mergeGeometries([
      box(e.w * 0.7, e.h * 0.45, e.d * 0.8, -e.w * 0.1, e.h * 0.22, 0, e.color),
      cyl(0.55, 0.6, 0.12, 20, -e.w * 0.1, e.h * 0.55, 0, tint(e.color, -0.25)),
      cyl(0.62, 0.65, 0.18, 20, -e.w * 0.1, e.h * 0.42, 0, tint(e.color, 0.1)),
      box(0.5, e.h * 0.35, 0.4, e.w * 0.32, e.h * 0.55, 0, tint(e.color, -0.35)),
    ]);
  };

  const buildFumehood = (e) => {
    const body = e.color, glass = '#b8ccd4';
    return mergeGeometries([
      box(e.w, 3, e.d, 0, 1.5, 0, tint(body, -0.12)),
      box(e.w, 0.15, e.d, 0, 3.05, 0, '#20242a'),
      box(e.w, e.h - 3.4, 0.15, 0, 3.2 + (e.h - 3.4) / 2, -e.d / 2 + 0.08, body),
      ...[-1, 1].map((sx) => box(0.15, e.h - 3.4, e.d, sx * (e.w / 2 - 0.08), 3.2 + (e.h - 3.4) / 2, 0, body)),
      box(e.w, 0.5, e.d, 0, e.h - 0.25, 0, body),
      box(e.w - 0.4, e.h - 4.4, 0.05, 0, 3.4 + (e.h - 4.4) / 2, e.d / 2 - 0.1, glass),
      box(e.w - 0.3, 0.12, 0.12, 0, 3.4, e.d / 2 - 0.08, tint(body, -0.3)),
    ]);
  };

  const buildEyewash = (e) => {
    const c = e.color;
    return mergeGeometries([
      cyl(0.06, 0.08, e.h * 0.75, 10, 0, e.h * 0.37, 0, tint(c, -0.35)),
      cyl(e.w * 0.45, e.w * 0.32, 0.3, 16, 0, e.h * 0.78, 0.1, '#e8e6df'),
      sph(0.07, -0.15, e.h * 0.82, 0.1, c, 8),
      sph(0.07, 0.15, e.h * 0.82, 0.1, c, 8),
      box(0.5, 0.5, 0.05, 0, e.h - 0.2, -0.1, c),
    ]);
  };

  const buildSkeleton = (e) => {
    const bone = e.color;
    const parts = [
      cyl(e.w * 0.4, e.w * 0.45, 0.1, 14, 0, 0.05, 0, '#3a3f45'),
      cyl(0.05, 0.05, e.h - 0.8, 8, 0, (e.h - 0.8) / 2 + 0.1, -0.2, '#3a3f45'),
      cylT(0.05, 0.05, 0.4, 6, 0, e.h - 0.65, -0.08, '#3a3f45', 0.6, 0),
      sph(0.32, 0, e.h - 0.45, 0.05, bone, 12),
      cyl(0.06, 0.06, e.h * 0.35, 6, 0, e.h * 0.6, 0.05, bone),
    ];
    for (let i = 0; i < 4; i++) {
      const w = e.w * (0.55 - i * 0.06);
      parts.push(boxT(w, 0.09, 0.35, 0, e.h * 0.72 - i * 0.22, 0.05, bone, 0, 0, 0));
    }
    parts.push(box(e.w * 0.5, 0.3, 0.3, 0, e.h * 0.42, 0.05, bone));
    for (const sx of [-1, 1]) {
      parts.push(cylT(0.045, 0.045, e.h * 0.32, 6, sx * e.w * 0.33, e.h * 0.6, 0.05, bone, 0, sx * 0.12));
      parts.push(cyl(0.05, 0.05, e.h * 0.38, 6, sx * e.w * 0.12, e.h * 0.22, 0.05, bone));
    }
    return mergeGeometries(parts);
  };

  const buildGlobe = (e) => {
    const r = e.w / 2 - 0.15;
    return mergeGeometries([
      lathe([[0.01, 0], [e.w * 0.32, 0.04], [0.1, 0.12], [0.06, e.h - r * 2 - 0.2]], 0, 0, 0, '#7a6248', 16),
      ring(r + 0.12, 0.04, 0, e.h - r - 0.1, 0, '#c9a227', { arc: Math.PI * 1.25, rx: 0, rz: Math.PI * 0.62 }),
      sph(r, 0, e.h - r - 0.1, 0, e.color, 18),
      sph(r * 0.55, r * 0.5, e.h - r - 0.1 + r * 0.45, 0.1, '#3f7a48', 10),
    ]);
  };

  // ---------- Phase 1 builders: cafeteria, office machines, counters ----------

  // Boxy appliances: `style` picks copier, vending (lit front), commercial
  // fridge (two doors), or milk cooler (open chest).
  const buildMachine = (e) => {
    const parts = [];
    const dark = tint(e.color, -0.3), light = tint(e.color, 0.15);
    if (e.style === 'vending') {
      parts.push(box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color));
      parts.push(box(e.w * 0.55, e.h * 0.75, 0.05, -e.w * 0.14, e.h * 0.55, e.d / 2 + 0.02, '#cfe3ee'));
      parts.push(box(e.w * 0.22, e.h * 0.45, 0.05, e.w * 0.3, e.h * 0.65, e.d / 2 + 0.02, dark));
      parts.push(box(e.w * 0.5, 0.3, 0.06, -e.w * 0.14, e.h * 0.12, e.d / 2 + 0.03, dark));
    } else if (e.style === 'fridge') {
      parts.push(box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color));
      for (const sx of [-1, 1]) {
        parts.push(box(e.w / 2 - 0.15, e.h - 0.6, 0.06, sx * e.w / 4, e.h / 2 + 0.1, e.d / 2 + 0.02, light));
        parts.push(box(0.08, e.h * 0.5, 0.1, sx * 0.2, e.h / 2 + 0.1, e.d / 2 + 0.08, dark));
      }
      parts.push(box(e.w, 0.5, e.d, 0, 0.25, 0, dark));
    } else if (e.style === 'cooler') {
      parts.push(box(e.w, e.h, e.d, 0, e.h / 2, 0, e.color));
      parts.push(box(e.w - 0.2, 0.1, e.d - 0.2, 0, e.h - 0.05, 0, dark));
      parts.push(box(e.w, e.h * 0.4, 0.05, 0, e.h * 0.45, e.d / 2 + 0.02, '#3f6fae'));
    } else { // copier
      parts.push(box(e.w, e.h * 0.75, e.d, 0, e.h * 0.375, 0, e.color));
      parts.push(box(e.w, 0.2, e.d, 0, e.h * 0.75 + 0.1, 0, dark));
      parts.push(box(e.w * 0.7, 0.08, e.d * 0.5, 0, e.h * 0.55, e.d * 0.3, light));
      parts.push(boxT(e.w * 0.4, 0.05, e.d * 0.35, e.w * 0.1, e.h * 0.88, 0, light, 0.25, 0, 0));
    }
    return mergeGeometries(parts);
  };

  // Counters: base cabinets + a top. `guard: true` adds a sneeze guard
  // (serving line), `tier: 2` a raised transaction top, `style: 'tray'` an
  // open pass-through window.
  const buildCounter = (e) => {
    const counterH = e.tier === 2 ? e.h * 0.75 : e.style === 'tray' ? e.h * 0.6 : e.h;
    const topColor = tint(e.color, 0.12), body = e.color;
    const parts = [
      box(e.w, counterH - 0.15, e.d - 0.3, 0, (counterH - 0.15) / 2, 0.1, body),
      box(e.w + 0.15, 0.15, e.d, 0, counterH - 0.07, 0, topColor),
    ];
    if (e.guard) {
      for (const sx of [-0.8, 0, 0.8]) {
        parts.push(cyl(0.04, 0.04, 1.2, 8, sx * e.w / 2.2, counterH + 0.6, -e.d * 0.2, tint(body, -0.3)));
      }
      parts.push(boxT(e.w, 0.04, 0.9, 0, counterH + 1.1, -e.d * 0.05, '#b8ccd4', 0.5, 0, 0));
    }
    if (e.tier === 2) {
      parts.push(box(e.w, e.h - counterH - 0.1, 0.3, 0, counterH + (e.h - counterH) / 2 - 0.05, -e.d / 2 + 0.15, body));
      parts.push(box(e.w + 0.15, 0.12, 0.8, 0, e.h - 0.06, -e.d / 2 + 0.25, topColor));
    }
    if (e.style === 'tray') {
      for (const sx of [-1, 1]) parts.push(box(0.3, e.h - counterH, 0.3, sx * (e.w / 2 - 0.15), counterH + (e.h - counterH) / 2, -e.d * 0.1, body));
      parts.push(box(e.w, 0.25, 0.4, 0, e.h - 0.12, -e.d * 0.1, body));
      parts.push(box(e.w - 0.6, e.h - counterH - 0.5, 0.05, 0, counterH + (e.h - counterH) / 2, -e.d * 0.1, '#2a2f36'));
    }
    return mergeGeometries(parts);
  };

  const buildRecycle = (e) => {
    const binColors = ['#3f6fae', '#3f7a48', '#5a6068'];
    const bins = 3, bw = e.w / bins;
    const parts = [box(e.w, 0.15, e.d, 0, e.h - 0.55, 0, tint(e.color, -0.1))];
    for (let i = 0; i < bins; i++) {
      const x = -e.w / 2 + bw * (i + 0.5);
      parts.push(box(bw - 0.25, e.h - 0.8, e.d - 0.3, x, (e.h - 0.8) / 2, 0, binColors[i]));
      parts.push(box(bw - 0.2, 0.12, e.d - 0.25, x, e.h - 0.42, 0, tint(binColors[i], -0.15)));
      parts.push(cylT(0.28, 0.28, 0.14, 14, x, e.h - 0.34, 0, '#17181c', 0, 0));
    }
    for (const sx of [-1, 1]) parts.push(box(0.12, e.h - 0.4, 0.12, sx * (e.w / 2 - 0.06), (e.h - 0.4) / 2, -e.d / 2 + 0.06, tint(e.color, -0.1)));
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: gym & stage ----------

  // Basketball hoop. Wall mount: arms reach from the wall side (-z) to the
  // board. `pole: true` is the outdoor version — the whole thing rides a
  // pole, board near the top of `h`.
  const buildHoop = (e) => {
    const boardW = Math.min(e.w, 6), boardH = 3.5;
    const rimColor = '#c9563f', boardColor = e.color;
    const parts = [];
    let boardBase; // local y of the board's bottom edge
    if (e.pole) {
      parts.push(cyl(0.14, 0.16, e.h - 2, 10, 0, (e.h - 2) / 2, -e.d / 2 + 0.3, tint(boardColor, -0.3)));
      parts.push(cylT(0.1, 0.1, e.d * 0.7, 8, 0, e.h - 2, 0, tint(boardColor, -0.3), Math.PI / 2, 0));
      boardBase = e.h - boardH - 0.2;
    } else {
      for (const sx of [-1, 1]) {
        parts.push(cylT(0.07, 0.07, e.d * 0.9, 8, sx * boardW * 0.25, 1.6, 0, tint(boardColor, -0.35), Math.PI / 2, 0));
      }
      boardBase = 0.5;
    }
    parts.push(box(boardW, boardH, 0.15, 0, boardBase + boardH / 2, e.d / 2 - 0.1, boardColor));
    parts.push(box(boardW * 0.4, boardH * 0.35, 0.03, 0, boardBase + boardH * 0.35, e.d / 2 - 0.01, '#c9563f'));
    const rimY = boardBase + boardH * 0.18;
    parts.push(ring(0.75, 0.05, 0, rimY, e.d / 2 + 0.65, rimColor));
    parts.push(cyl(0.72, 0.45, 1.3, 12, 0, rimY - 0.68, e.d / 2 + 0.65, '#e8e6df'));
    return mergeGeometries(parts);
  };

  const buildVolleyball = (e) => {
    const postColor = e.color;
    const parts = [];
    for (const sx of [-1, 1]) {
      parts.push(cyl(0.1, 0.1, e.h, 10, sx * (e.w / 2 - 0.3), e.h / 2, 0, postColor));
      parts.push(cyl(0.5, 0.55, 0.15, 14, sx * (e.w / 2 - 0.3), 0.08, 0, tint(postColor, -0.2)));
    }
    parts.push(box(e.w - 1.2, 3, 0.04, 0, e.h - 1.6, 0, '#d8d3c8'));
    parts.push(box(e.w - 1.2, 0.12, 0.06, 0, e.h - 0.15, 0, '#f4f4f2'));
    return mergeGeometries(parts);
  };

  const buildBallrack = (e) => {
    const frame = tint(e.color, -0.15);
    const ballColors = ['#c9563f', '#3f6fae', '#c99a3f', '#3f7a48'];
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(box(0.08, e.h, 0.08, sx * (e.w / 2 - 0.05), e.h / 2, sz * (e.d / 2 - 0.05), frame));
    }
    for (const level of [0.4, e.h * 0.55]) {
      parts.push(box(e.w, 0.08, e.d, 0, level, 0, frame));
      const across = Math.max(3, Math.round(e.w / 1.1));
      for (let i = 0; i < across; i++) {
        const x = -e.w / 2 + (e.w / across) * (i + 0.5);
        parts.push(sph(Math.min(0.42, e.d / 2 - 0.15), x, level + 0.45, 0, ballColors[(i + (level > 1 ? 1 : 0)) % ballColors.length], 12));
      }
    }
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: restroom ----------

  const buildToiletstall = (e) => {
    const partition = tint(e.color, -0.15), fixture = '#e6e8ea';
    return mergeGeometries([
      box(e.w - 0.2, 4, 0.08, 0, 3, -e.d / 2 + 0.04, partition),
      box(0.08, 4, e.d, -e.w / 2 + 0.04, 3, 0, partition),
      box(0.08, 4, e.d, e.w / 2 - 0.04, 3, 0, partition),
      box(e.w * 0.55, 3.5, 0.06, -e.w * 0.18, 2.8, e.d / 2 - 0.04, tint(e.color, -0.05)),
      box(0.5, 1.2, 0.35, 0, 1.35, -e.d / 2 + 0.35, fixture),
      cyl(0.55, 0.4, 0.5, 14, 0, 1.15, -e.d / 2 + 1.0, fixture),
      cyl(0.6, 0.55, 0.1, 14, 0, 1.45, -e.d / 2 + 1.0, tint(fixture, -0.06)),
    ]);
  };

  const buildUrinal = (e) => {
    return mergeGeometries([
      box(e.w, e.h, e.d * 0.5, 0, e.h / 2, e.d * 0.1, e.color),
      boxT(e.w * 0.8, e.h * 0.45, e.d * 0.5, 0, e.h * 0.25, e.d * 0.32, tint(e.color, 0.05), 0.35, 0, 0),
      box(e.w * 0.3, 0.5, 0.15, 0, e.h + 0.4, 0, tint(e.color, -0.15)),
    ]);
  };

  const buildSinkcounter = (e) => {
    const counterH = e.h;
    const parts = [
      box(e.w, 0.15, e.d, 0, counterH - 0.08, 0, e.color),
      box(e.w, 0.5, 0.1, 0, counterH - 0.4, -e.d / 2 + 0.05, e.color),
      box(e.w, 0.35, e.d, 0, counterH - 0.3, 0, tint(e.color, -0.08)),
    ];
    const basins = Math.max(1, Math.round(e.w / 2.4));
    for (let i = 0; i < basins; i++) {
      const x = -e.w / 2 + (e.w / basins) * (i + 0.5);
      parts.push(box(1.1, 0.12, 0.9, x, counterH - 0.02, 0.1, tint(e.color, -0.25)));
      parts.push(cylT(0.045, 0.045, 0.45, 8, x, counterH + 0.2, -0.35, '#b8bcc2', 0, 0));
      parts.push(cylT(0.04, 0.04, 0.3, 8, x, counterH + 0.4, -0.22, '#b8bcc2', Math.PI / 2.4, 0));
    }
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: decor ----------

  const buildPlant = (e) => {
    const potR = e.w * 0.32;
    const parts = [
      lathe([[potR * 0.6, 0], [potR, e.h * 0.28], [potR * 0.85, e.h * 0.3]], 0, 0, 0, '#a9623f', 16),
    ];
    const fol = tint(e.color, 0.05);
    parts.push(cyl(0.04, 0.05, e.h * 0.3, 6, 0, e.h * 0.4, 0, '#7a5230'));
    parts.push(sph(e.w * 0.42, 0, e.h * 0.68, 0, e.color, 12));
    parts.push(sph(e.w * 0.3, e.w * 0.2, e.h * 0.52, e.w * 0.12, fol, 10));
    parts.push(sph(e.w * 0.28, -e.w * 0.22, e.h * 0.58, -e.w * 0.1, tint(e.color, -0.06), 10));
    return mergeGeometries(parts);
  };

  const buildAquarium = (e) => {
    const standH = e.h * 0.45;
    return mergeGeometries([
      box(e.w, standH, e.d, 0, standH / 2, 0, '#4a3a2e'),
      box(e.w - 0.15, e.h - standH - 0.15, e.d - 0.15, 0, standH + (e.h - standH) / 2, 0, e.color),
      box(e.w - 0.3, e.h - standH - 0.4, e.d - 0.3, 0, standH + (e.h - standH) / 2, 0, '#6fa8c9'),
      box(e.w - 0.25, 0.15, e.d - 0.25, 0, standH + 0.1, 0, '#c9a06a'),
      box(e.w, 0.1, e.d, 0, e.h - 0.05, 0, '#22262c'),
    ]);
  };

  const buildCage = (e) => {
    const standH = e.h * 0.45, frame = tint(e.color, -0.2);
    const parts = [
      box(e.w, standH, e.d, 0, standH / 2, 0, '#7a6248'),
      box(e.w - 0.2, 0.12, e.d - 0.2, 0, standH + 0.06, 0, frame),
      box(e.w - 0.2, 0.1, e.d - 0.2, 0, e.h - 0.05, 0, frame),
    ];
    const bars = Math.max(4, Math.round(e.w * 2.4));
    for (let i = 0; i <= bars; i++) {
      const x = -e.w / 2 + 0.12 + ((e.w - 0.24) / bars) * i;
      for (const sz of [-1, 1]) {
        parts.push(box(0.03, e.h - standH - 0.2, 0.03, x, standH + (e.h - standH) / 2, sz * (e.d / 2 - 0.12), e.color));
      }
    }
    parts.push(box(0.6, 0.35, 0.5, -e.w * 0.2, standH + 0.3, 0, '#c99a3f'));
    return mergeGeometries(parts);
  };

  const buildClutter = (e) => {
    const bookColors = [e.color, '#3f6fae', '#3f7a48'];
    const parts = [];
    for (let i = 0; i < 3; i++) {
      parts.push(boxT(0.9 - i * 0.08, 0.14, 0.65, -e.w * 0.22, 0.07 + i * 0.14, 0.05, bookColors[i], 0, i * 0.25, 0));
    }
    parts.push(box(0.55, 0.35, 0.4, e.w * 0.25, 0.18, -0.1, tint(e.color, -0.3)));
    parts.push(box(0.5, 0.06, 0.35, e.w * 0.25, 0.4, -0.1, '#f4f4f2'));
    return mergeGeometries(parts);
  };

  // ---------- Phase 1 builders: outdoor ----------

  // The one deliberate exception to "seating is separate": a picnic table's
  // benches are part of its structure.
  const buildPicnic = (e) => {
    const c = e.color, legColor = tint(c, -0.2);
    const parts = [box(e.w * 0.45, 0.15, e.d, 0, e.h - 0.08, 0, c)];
    for (const sx of [-1, 1]) {
      parts.push(box(e.w * 0.16, 0.12, e.d, sx * e.w * 0.4, e.h * 0.62, 0, c));
      parts.push(boxT(0.15, e.h + 0.3, 0.15, sx * e.w * 0.2, e.h / 2 - 0.05, e.d * 0.3, legColor, 0, 0, sx * 0.5));
      parts.push(boxT(0.15, e.h + 0.3, 0.15, sx * e.w * 0.2, e.h / 2 - 0.05, -e.d * 0.3, legColor, 0, 0, sx * 0.5));
    }
    parts.push(box(e.w * 0.75, 0.15, 0.15, 0, e.h * 0.6, e.d * 0.3, legColor));
    parts.push(box(e.w * 0.75, 0.15, 0.15, 0, e.h * 0.6, -e.d * 0.3, legColor));
    return mergeGeometries(parts);
  };

  const buildBikerack = (e) => {
    const parts = [];
    const loops = 3;
    for (let i = 0; i < loops; i++) {
      const x = -e.w / 2 + (e.w / loops) * (i + 0.5);
      parts.push(ring(e.h * 0.42, 0.06, x, e.h * 0.45, 0, e.color, { arc: Math.PI, rx: 0, rz: 0 }));
      for (const sz of [-1, 1]) {
        parts.push(cyl(0.06, 0.06, e.h * 0.45, 8, x + sz * e.h * 0.42, e.h * 0.225, 0, e.color));
      }
    }
    return mergeGeometries(parts);
  };

  const buildFlagpole = (e) => {
    return mergeGeometries([
      cyl(0.35, 0.45, 0.6, 12, 0, 0.3, 0, tint(e.color, -0.25)),
      cyl(0.05, 0.1, e.h - 0.8, 12, 0, (e.h - 0.8) / 2 + 0.6, 0, e.color),
      sph(0.14, 0, e.h - 0.1, 0, '#c9a227', 10),
      box(3, 1.9, 0.06, 1.6, e.h - 1.4, 0, '#8a2f3a'),
    ]);
  };

  const buildSlide = (e) => {
    const c = e.color, frame = tint(c, -0.25);
    const platH = e.h * 0.62;
    const parts = [
      box(2.2, 0.15, 2.2, -e.w / 2 + 1.3, platH, 0, frame),
      box(2.2, 1.5, 0.1, -e.w / 2 + 1.3, platH + 0.8, -1.05, frame),
      box(0.1, 1.5, 2.2, -e.w / 2 + 0.25, platH + 0.8, 0, frame),
    ];
    for (const sz of [-1, 1]) {
      parts.push(box(0.12, platH, 0.12, -e.w / 2 + 0.35, platH / 2, sz * 0.95, frame));
      parts.push(box(0.12, platH, 0.12, -e.w / 2 + 2.3, platH / 2, sz * 0.95, frame));
    }
    for (let i = 0; i < 4; i++) {
      parts.push(box(0.08, 0.08, 1.7, -e.w / 2 + 2.42, (platH / 5) * (i + 1), 0, frame));
    }
    const runL = e.w - 2.6;
    const ang = Math.atan2(platH - 0.4, runL);
    const cx = -e.w / 2 + 2.6 + runL / 2 - 0.2;
    parts.push(boxT(runL / Math.cos(ang), 0.12, 1.6, cx, (platH + 0.3) / 2 + 0.05, 0, c, 0, 0, ang));
    for (const sz of [-1, 1]) {
      parts.push(boxT(runL / Math.cos(ang), 0.35, 0.1, cx, (platH + 0.3) / 2 + 0.25, sz * 0.78, tint(c, 0.12), 0, 0, ang));
    }
    return mergeGeometries(parts);
  };

  const buildSwing = (e) => {
    const frame = e.color;
    const parts = [cylT(0.12, 0.12, e.w - 1, 10, 0, e.h - 0.15, 0, frame, 0, Math.PI / 2)];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(cylT(0.1, 0.12, e.h + 0.6, 10, sx * (e.w / 2 - 0.5), e.h / 2 - 0.1, sz * e.d * 0.32, frame, sz * 0.38, 0));
      }
    }
    for (const sx of [-1, 1]) {
      const x = sx * e.w * 0.16;
      for (const dz of [-0.75, 0.75]) {
        parts.push(box(0.05, e.h - 1.6, 0.05, x + dz * 0.45, (e.h - 1.6) / 2 + 1.3, 0, '#8a8f96'));
      }
      parts.push(box(1.3, 0.12, 0.5, x, 1.25, 0, '#22262c'));
    }
    return mergeGeometries(parts);
  };

  const buildDumpster = (e) => {
    const body = e.color;
    return mergeGeometries([
      box(e.w, e.h - 0.6, e.d, 0, (e.h - 0.6) / 2 + 0.35, 0, body),
      boxT(e.w, 0.12, e.d + 0.1, 0, e.h - 0.12, 0, tint(body, -0.15), -0.12, 0, 0),
      box(e.w, 0.3, 0.1, 0, e.h * 0.55, e.d / 2 + 0.04, tint(body, 0.1)),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
        cylT(0.16, 0.16, 0.12, 10, sx * (e.w / 2 - 0.4), 0.16, sz * (e.d / 2 - 0.3), '#17181c', 0, Math.PI / 2))),
      ...[-1, 1].map((sx) => box(0.5, 0.35, 0.25, sx * (e.w / 2 + 0.12), e.h * 0.4, 0, tint(body, -0.25))),
    ]);
  };

  const buildPolesign = (e) => {
    return mergeGeometries([
      cyl(0.05, 0.07, e.h - 0.2, 8, 0, (e.h - 0.2) / 2, 0, '#8a8f96'),
      boxT(1.8, 1.8, 0.06, 0, e.h - 1.3, 0.06, e.color, 0, 0, Math.PI / 4),
      box(1.4, 0.5, 0.06, 0, e.h - 2.6, 0.06, tint(e.color, 0.2)),
    ]);
  };

  const PROP_GEO_BUILDERS = {
    desk: buildDesk, chair: buildChair, cabinet: buildCabinet, shelf: buildShelf,
    cubby: buildCubby, lamp: buildLamp, panel: buildPanel, rug: buildRug,
    bin: buildBin, sink: buildSink,
    table: buildTable, workstation: buildWorkstation, carrel: buildCarrel,
    podium: buildPodium, labbench: buildLabbench,
    stool: buildStool, bench: buildBench, softseat: buildSoftseat,
    audseat: buildAudseat,
    locker: buildLocker, coatrack: buildCoatrack, cart: buildCart,
    stack: buildStack, hookrail: buildHookrail,
    clock: buildClock, pulldown: buildPulldown, projector: buildProjector,
    displaycase: buildDisplaycase, fountain: buildFountain,
    wallbox: buildWallbox, flagwall: buildFlagwall, radiator: buildRadiator,
    piano: buildPiano, musicstand: buildMusicstand, riser: buildRiser,
    easel: buildEasel, dryrack: buildDryrack, kiln: buildKiln,
    wheel: buildWheel, fumehood: buildFumehood, eyewash: buildEyewash,
    skeleton: buildSkeleton, globe: buildGlobe,
    machine: buildMachine, counter: buildCounter, recycle: buildRecycle,
    hoop: buildHoop, volleyball: buildVolleyball, ballrack: buildBallrack,
    toiletstall: buildToiletstall, urinal: buildUrinal, sinkcounter: buildSinkcounter,
    plant: buildPlant, aquarium: buildAquarium, cage: buildCage, clutter: buildClutter,
    picnic: buildPicnic, bikerack: buildBikerack, flagpole: buildFlagpole,
    slide: buildSlide, swing: buildSwing, dumpster: buildDumpster,
    polesign: buildPolesign,
  };

  // Cached per catalog type (not rebuilt on every edit like the structural
  // meshes) — a prop's geometry never changes shape, only its transform does.
  const propGeoCache = new Map();
  function getPropGeometry(entry) {
    let geo = propGeoCache.get(entry.type);
    if (geo) return geo;
    const build = PROP_GEO_BUILDERS[entry.geo] || buildDesk;
    geo = build(entry);
    propGeoCache.set(entry.type, geo);
    return geo;
  }

  // Recursive: these groups now nest one level deep (a subgroup per storey),
  // and a rebuild runs on every edit stroke, so nothing may be left behind.
  // Surface materials are shared and reused; only per-sprite ones are freed.
  function disposeGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.isGroup) { disposeGroup(child); continue; }
      // Prop instances share cached, per-type geometry (see getPropGeometry)
      // that outlives any single rebuild — freeing it here would leave every
      // other instance of that type pointing at disposed GPU buffers.
      if (child.geometry && !child.userData.sharedGeo) child.geometry.dispose();
      if (child.isSprite && child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }
  }

  function makeLabelSprite(text, color) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '600 44px system-ui, sans-serif';
    const tw = Math.ceil(ctx.measureText(text).width);
    c.width = tw + 64; c.height = 88;
    const g = c.getContext('2d');
    g.font = '600 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    // pill background
    const r = 34;
    g.fillStyle = 'rgba(22,25,32,0.82)';
    g.beginPath();
    g.roundRect(4, 10, c.width - 8, 68, r);
    g.fill();
    if (color) {
      g.fillStyle = color;
      g.beginPath(); g.arc(38, 44, 12, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#f2f4f8';
    g.fillText(text, color ? 62 : 32, 46);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    const hFt = 3.2;
    sprite.scale.set(hFt * (c.width / c.height), hFt, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  // A polygon room's slab and ceiling. Built in the XY plane and laid flat,
  // because that's what ShapeGeometry triangulates; `flip` picks which way the
  // face looks. ShapeGeometry emits world UVs (the shape's own coordinates), so
  // dividing by CELL lands the same texture scale the grid cells use.
  function shapeSlabGeometry(shape, flip, cuts = []) {
    const ring = (pts) => pts.map((p) => new THREE.Vector2(p.x, flip ? p.z : -p.z));
    const outline = new THREE.Shape(ring(shape.rings[0].pts));
    for (let i = 1; i < shape.rings.length; i++) {
      outline.holes.push(new THREE.Path(ring(shape.rings[i].pts)));
    }
    // A stair's opening is a hole in whatever room it lands in — the same thing
    // Phase 2's carved alcoves already are, arrived at from the other end. Only
    // cuts lying wholly inside the room are taken: one hanging half over the
    // edge of a slab isn't a hole in it, and a hole crossing the outline
    // triangulates into confetti.
    for (const cut of cuts) {
      if (!cut.every((c) => pointInShape(shape, c.x, c.z))) continue;
      outline.holes.push(new THREE.Path(ring(cut)));
    }
    const geo = new THREE.ShapeGeometry(outline);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / CELL, uv.getY(i) / CELL);
    geo.rotateX(flip ? Math.PI / 2 : -Math.PI / 2);
    return geo;
  }

  // Build one storey's merged geometry into `group` / `ceil` / `labels`.
  //
  // `ctx` is what the storey can't work out on its own: the holes cut in its
  // slab by stairs arriving from below (`cuts`), the holes in its ceiling from
  // stairs leaving it (`ceilCuts`), and the links themselves — the runs that
  // start here and the guardrails around the openings that land here.
  function buildFloor(floor, baseY, wallH, group, ceil, labels, ctx = {}) {
    const floorGeos = [], ceilGeos = [], wallGeos = [], fixtureGeos = [];
    const glassGeos = [], railGeos = [], stairGeos = [];
    const cuts = ctx.cuts || [];
    const ceilCuts = ctx.ceilCuts || [];
    const metrics = ctx.metrics || null;
    const tmpColor = new THREE.Color();

    for (let y = 0; y < floor.h; y++) {
      for (let x = 0; x < floor.w; x++) {
        const cell = floor.cells[y * floor.w + x];
        if (!cell) continue;
        // A cell under an opening isn't drawn at all — that is what makes the
        // hole a hole, rather than a stair pressed up against an intact slab.
        const cut = cellCut(cuts, x, y);
        const ceilCut = cellCut(ceilCuts, x, y);
        const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;

        if (!cut) {
          const f = new THREE.PlaneGeometry(CELL, CELL);
          f.rotateX(-Math.PI / 2);
          f.translate(cx, baseY, cz);
          // continuous tiling across cells
          const uv = f.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + x, uv.getY(i) + y);
          tmpColor.set(cell.color || _white);
          coloredGeo(f, tmpColor);
          floorGeos.push(f);
        }

        // The ceiling belongs to this storey but the hole in it belongs to the
        // one above — a stair leaving here opens both planes, or you'd climb
        // into a ceiling tile.
        if (!ceilCut) {
          const cg = new THREE.PlaneGeometry(CELL, CELL);
          cg.rotateX(Math.PI / 2);
          cg.translate(cx, baseY + WALL_H, cz);
          const cuv = cg.attributes.uv;
          for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) + x, cuv.getY(i) + y);
          ceilGeos.push(cg);

          // a 2x4ft light fixture on every other cell in both directions
          if (x % 2 === 1 && y % 2 === 1) {
            const fg = new THREE.BoxGeometry(3.6, 0.15, 1.6);
            fg.translate(cx, baseY + WALL_H - 0.1, cz);
            fixtureGeos.push(fg);
          }
        }
      }
    }

    // ---- walls, glazing and railings ----
    //
    // Four things can stand on a boundary: a wall, a doorway through one, a
    // glazed partition, a guardrail. The lattice and the polygon rooms say
    // *where* differently, but they want the same things built — so a grid edge
    // is handed to the same span builders as a polygon segment, as a run that
    // happens to be one cell long.

    const jamb = (CELL - DOOR_W) / 2;
    const GLASS_BAY = 5;       // ft between mullions
    const GLASS_SILL = 0.4;    // ft of solid under the pane
    const GLASS_HEAD = 0.5;    // ft of frame over it
    const POST_GAP = 4;        // ft between guardrail posts

    const addBox = (w, h, d, x, y, z, color) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      coloredGeo(g, color);
      wallGeos.push(g);
    };

    // A run of anything at any angle: the box is built along +X and turned to
    // face down the segment (see the rotation note in propplace.js — this is
    // the same convention, one axis over).
    const addOriented = (len, h, d, x, y, z, angle, color, target = wallGeos) => {
      const g = new THREE.BoxGeometry(len, h, d);
      // A grid wall is one cell wide and gets one tile of the wall texture; a
      // polygon wall is whatever length it is, so its long faces repeat per
      // cell instead of stretching one tile across the whole run. BoxGeometry
      // lays its faces out px, nx, py, ny, pz, nz — four vertices each — so
      // the two long faces are the last eight.
      const uv = g.attributes.uv;
      const repeat = len / CELL;
      for (let i = 16; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeat);
      g.rotateY(-angle);
      g.translate(x, y, z);
      coloredGeo(g, color);
      target.push(g);
    };

    // Glazing: sill, head, mullions every few feet, and one pane per bay. The
    // frame is ordinary wall geometry; only the pane goes in the transparent
    // pile, so glass costs one extra draw call per storey and no sorting
    // headaches for anything else.
    const glazedRun = (p0, p1, len, angle, h, y0 = baseY) => {
      const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
      addOriented(len, GLASS_SILL, WALL_T, cx, y0 + GLASS_SILL / 2, cz, angle, _glassFrame);
      addOriented(len, GLASS_HEAD, WALL_T, cx, y0 + h - GLASS_HEAD / 2, cz, angle, _glassFrame);
      const paneH = h - GLASS_SILL - GLASS_HEAD;
      if (paneH <= 0.2) return;
      const ux = (p1.x - p0.x) / len, uz = (p1.z - p0.z) / len;
      const bays = Math.max(1, Math.round(len / GLASS_BAY));
      for (let i = 1; i < bays; i++) {
        const t = (i / bays) * len;
        addOriented(0.25, paneH, WALL_T, p0.x + ux * t, y0 + GLASS_SILL + paneH / 2, p0.z + uz * t,
          angle, _glassFrame);
      }
      const pane = new THREE.BoxGeometry(len, paneH, WALL_T * 0.35);
      pane.rotateY(-angle);
      pane.translate(cx, y0 + GLASS_SILL + paneH / 2, cz);
      glassGeos.push(pane);
    };

    // A guardrail: posts, a cap you could put a hand on, and one mid rail so it
    // doesn't read as a row of sticks from across the building.
    const railRun = (p0, p1, len, angle, y0 = baseY) => {
      const ux = (p1.x - p0.x) / len, uz = (p1.z - p0.z) / len;
      const posts = Math.max(1, Math.round(len / POST_GAP));
      for (let i = 0; i <= posts; i++) {
        const t = (i / posts) * len;
        addOriented(0.16, RAIL_H, 0.16, p0.x + ux * t, y0 + RAIL_H / 2, p0.z + uz * t,
          angle, _railPost, railGeos);
      }
      const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
      addOriented(len, 0.18, 0.3, cx, y0 + RAIL_H, cz, angle, _railCap, railGeos);
      addOriented(len, 0.09, 0.09, cx, y0 + RAIL_H * 0.52, cz, angle, _railPost, railGeos);
    };

    // One full-height piece of boundary, whichever kind it is. Everything that
    // knows about doorways calls this and stays out of the material business.
    const fillSpan = (kind, p0, p1, angle, h) => {
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (len < 0.02) return;
      if (kind === SEG_RAIL) railRun(p0, p1, len, angle);
      else if (kind === SEG_GLASS) glazedRun(p0, p1, len, angle, h);
      else {
        addOriented(len, h, WALL_T, (p0.x + p1.x) / 2, baseY + h / 2, (p0.z + p1.z) / 2,
          angle, _white);
      }
    };

    // A boundary run with its doorways cut out of it. `kind` picks what the
    // solid stretches are made of; the header over an opening is the same
    // trimmed frame whatever the wall around it is, because that is what reads
    // as a door from thirty feet away.
    const buildSegWall = (a, b, openings, kind = SEG_WALL) => {
      const L = segLength(a, b);
      if (L < 0.01) return;
      const angle = Math.atan2(b.z - a.z, b.x - a.x);
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const h = kind === SEG_RAIL ? RAIL_H : wallH;
      const at = (t, pad = 0) => ({ x: a.x + ux * (t * L + pad), z: a.z + uz * (t * L + pad) });
      // Overhang the outer ends by half a wall thickness so corners close.
      const ends = (t0, t1, grow = 0) => [
        at(t0, (t0 <= 0 ? -WALL_T / 2 : 0) - grow),
        at(t1, (t1 >= 1 ? WALL_T / 2 : 0) + grow),
      ];
      const span = (t0, t1) => {
        const [p0, p1] = ends(t0, t1);
        fillSpan(kind, p0, p1, angle, h);
      };
      const header = (t0, t1, hh, cy, color, depth = WALL_T, grow = 0) => {
        const [p0, p1] = ends(t0, t1, grow);
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        if (len < 0.02) return;
        addOriented(len, hh, depth, (p0.x + p1.x) / 2, cy, (p0.z + p1.z) / 2, angle, color);
      };

      const cuts = openings
        .map((o) => {
          const half = o.w / 2 / L;
          return { t0: Math.max(0, o.t - half), t1: Math.min(1, o.t + half) };
        })
        .sort((p, q) => p.t0 - q.t0);

      const headH = h - DOOR_H;
      let cursor = 0;
      for (const c of cuts) {
        if (c.t0 > cursor) span(cursor, c.t0);
        // A gap in a railing is just a gap — there is nothing to hang a header
        // from, which is exactly what makes it the top of a stair.
        if (kind !== SEG_RAIL && headH > 0.05) {
          header(c.t0, c.t1, headH, baseY + DOOR_H + headH / 2, _doorTint);
          // door frame trim, a touch proud of the wall for readability
          header(c.t0, c.t1, 0.25, baseY + DOOR_H + 0.125, _doorTint, WALL_T + 0.2, 0.25);
        }
        cursor = Math.max(cursor, c.t1);
      }
      if (cursor < 1) span(cursor, 1);
    };

    // A lattice edge, expressed as a one-cell segment. The doorway is the one
    // case the grid still says its own way: an edge is a whole cell wide, so a
    // door in one is fixed at its middle rather than placed along it.
    const buildEdge = (val, cx, cz, horizontal) => {
      const L = CELL + WALL_T; // overlap so corners join cleanly
      const half = L / 2;
      const a = horizontal ? { x: cx - half, z: cz } : { x: cx, z: cz - half };
      const b = horizontal ? { x: cx + half, z: cz } : { x: cx, z: cz + half };
      const mid = baseY + wallH / 2;
      if (val === EDGE_WALL) {
        if (horizontal) addBox(L, wallH, WALL_T, cx, mid, cz, _white);
        else addBox(WALL_T, wallH, L, cx, mid, cz, _white);
      } else if (val === EDGE_GLASS) {
        glazedRun(a, b, L, horizontal ? 0 : Math.PI / 2, wallH);
      } else if (val === EDGE_RAIL) {
        railRun(a, b, L, horizontal ? 0 : Math.PI / 2);
      } else if (val === EDGE_DOOR) {
        const off = DOOR_W / 2 + jamb / 2 + WALL_T / 2;
        const jw = jamb + WALL_T;
        const headH = wallH - DOOR_H;
        const headY = baseY + DOOR_H + headH / 2;
        const trimY = baseY + DOOR_H + 0.125;
        if (horizontal) {
          addBox(jw, wallH, WALL_T, cx - off, mid, cz, _white);
          addBox(jw, wallH, WALL_T, cx + off, mid, cz, _white);
          addBox(DOOR_W, headH, WALL_T, cx, headY, cz, _doorTint);
          // thin door frame trim for readability
          addBox(DOOR_W + 0.5, 0.25, WALL_T + 0.2, cx, trimY, cz, _doorTint);
        } else {
          addBox(WALL_T, wallH, jw, cx, mid, cz - off, _white);
          addBox(WALL_T, wallH, jw, cx, mid, cz + off, _white);
          addBox(WALL_T, headH, DOOR_W, cx, headY, cz, _doorTint);
          addBox(WALL_T + 0.2, 0.25, DOOR_W + 0.5, cx, trimY, cz, _doorTint);
        }
      }
    };

    for (let y = 0; y <= floor.h; y++)
      for (let x = 0; x < floor.w; x++) {
        const v = floor.edgesH[y * floor.w + x];
        if (v) buildEdge(v, (x + 0.5) * CELL, y * CELL, true);
      }
    for (let y = 0; y < floor.h; y++)
      for (let x = 0; x <= floor.w; x++) {
        const v = floor.edgesV[y * (floor.w + 1) + x];
        if (v) buildEdge(v, x * CELL, (y + 0.5) * CELL, false);
      }

    // ---- stairs and floor openings ----
    //
    // The run is drawn with the storey it climbs *from*; the guardrail around
    // the hole is drawn with the storey the hole is *in*. Splitting them that
    // way means each piece hides, ghosts and lights with the level it belongs
    // to, without either floor needing to know about the other's geometry.

    // A box in the link's own frame — local +Z is up the run.
    const localBox = (link, w, h, d, lx, ly, lz, color, target) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(lx, ly, lz);
      g.rotateY(link.rotationY || 0);
      g.translate(link.x, baseY, link.z);
      coloredGeo(g, color);
      target.push(g);
    };

    const buildStairRun = (link) => {
      if (!metrics) return;
      const w = stairWidth(link);
      // Each step is a solid block from the slab up to its own tread, not a
      // floating board: overlapping boxes merge into one mass, so the run has
      // an underside when you walk past it on the floor below.
      for (let i = 0; i < metrics.steps; i++) {
        const top = (i + 1) * metrics.riser;
        const z0 = i * metrics.tread;
        localBox(link, w, top, metrics.tread, 0, top / 2, z0 + metrics.tread / 2, _tread, stairGeos);
        localBox(link, w, 0.09, 0.2, 0, top - 0.045, z0 + metrics.tread - 0.1, _nosing, stairGeos);
      }
      // Handrails: a sloped cap either side, on posts that grow with the run.
      const pitch = Math.atan2(metrics.rise, metrics.run);
      const slope = Math.hypot(metrics.run, metrics.rise);
      const posts = Math.max(2, Math.round(metrics.run / POST_GAP));
      for (const sx of [-1, 1]) {
        const lx = sx * (w / 2 - 0.12);
        for (let i = 0; i <= posts; i++) {
          const t = i / posts;
          localBox(link, 0.13, RAIL_H, 0.13, lx, t * metrics.rise + RAIL_H / 2, t * metrics.run,
            _railPost, railGeos);
        }
        const g = new THREE.BoxGeometry(0.18, 0.18, slope);
        g.rotateX(-pitch);
        g.translate(lx, RAIL_H + metrics.rise / 2, metrics.run / 2);
        g.rotateY(link.rotationY || 0);
        g.translate(link.x, baseY, link.z);
        coloredGeo(g, _railCap);
        railGeos.push(g);
      }
    };

    for (const link of ctx.risers || []) {
      if (link.type === 'stair') buildStairRun(link);
    }
    // Guardrails around every hole in *this* floor, minus the side a stair
    // arrives on — see openingRails() for why that one is left open.
    for (const link of ctx.guarded || []) {
      for (const seg of openingRails(link, metrics, floor)) {
        const len = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
        if (len < 0.05) continue;
        railRun(seg.a, seg.b, len, Math.atan2(seg.b.z - seg.a.z, seg.b.x - seg.a.x));
      }
    }

    // ---- polygon rooms ----
    // Same merged meshes as the grid: a polygon room is a different way of
    // describing a room, not a different kind of thing to draw.
    shapesOf(floor).forEach((shape, si) => {
      // Coincident planes: a polygon room drawn over grid cells, or over
      // another polygon room, needs somewhere to be. A fraction of an inch is
      // enough to settle the depth test and invisible at building scale.
      const lift = 0.02 + (si % 8) * 0.006;

      const slab = shapeSlabGeometry(shape, false, cuts);
      slab.translate(0, baseY + lift, 0);
      tmpColor.set(shape.color || _white);
      coloredGeo(slab, tmpColor);
      floorGeos.push(slab);

      const ceilGeo = shapeSlabGeometry(shape, true, ceilCuts);
      ceilGeo.translate(0, baseY + WALL_H - lift, 0);
      ceilGeos.push(ceilGeo);

      for (const ring of shape.rings) {
        for (let i = 0; i < ring.pts.length; i++) {
          if (!isBuilt(ring.walls[i])) continue;
          const [a, b] = segEnds(ring, i);
          buildSegWall(a, b, ring.openings.filter((o) => o.seg === i), ring.walls[i]);
        }
      }

      // Troffers on the same 8ft lattice the grid cells use, clipped to the
      // room — so a polygon room is lit like its rectangular neighbours.
      const bb = shapeBBox(shape);
      for (let z = Math.floor(bb.z0 / CELL) | 0; z <= Math.ceil(bb.z1 / CELL); z++) {
        for (let x = Math.floor(bb.x0 / CELL) | 0; x <= Math.ceil(bb.x1 / CELL); x++) {
          if (x % 2 !== 1 || z % 2 !== 1) continue;
          const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL;
          if (!pointInShape(shape, cx, cz)) continue;
          if (inFloorCut(ceilCuts, cx, cz)) continue;   // no troffer hanging over a stairwell
          const fg = new THREE.BoxGeometry(3.6, 0.15, 1.6);
          fg.translate(cx, baseY + WALL_H - 0.1, cz);
          fixtureGeos.push(fg);
        }
      }
    });

    if (floorGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(floorGeos), floorMat);
      mesh.receiveShadow = true;
      mesh.userData.mats = { solid: floorMat, ghost: floorMatGhost };
      group.add(mesh);
    }
    if (wallGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(wallGeos), wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.mats = { solid: wallMat, ghost: wallMatGhost };
      group.add(mesh);
    }
    if (glassGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(glassGeos), glassMat);
      mesh.renderOrder = 10;   // after the opaque pass, so it blends over it
      // A pane that cast a shadow would be a window that darkens the room it
      // lights. The frame around it, which is ordinary wall geometry, still does.
      mesh.userData.noShadow = true;
      mesh.userData.mats = { solid: glassMat, ghost: glassMatGhost };
      group.add(mesh);
    }
    if (railGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(railGeos), railMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.mats = { solid: railMat, ghost: railMatGhost };
      group.add(mesh);
    }
    if (stairGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(stairGeos), stairMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.mats = { solid: stairMat, ghost: stairMatGhost };
      group.add(mesh);
    }
    if (ceilGeos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(ceilGeos), ceilMat);
      mesh.receiveShadow = true;
      ceil.add(mesh);
    }
    if (fixtureGeos.length) {
      ceil.add(new THREE.Mesh(mergeGeometries(fixtureGeos), fixtureMat));
    }

    for (const l of computeLabels(floor)) {
      const sprite = makeLabelSprite(l.name, l.color);
      sprite.position.set(l.cx, baseY + WALL_H + 2.5, l.cz);
      labels.add(sprite);
    }
    // Polygon rooms label from the point deepest inside them — the centroid of
    // an L-shaped room can land in a wall, or outside the room altogether.
    for (const shape of shapesOf(floor)) {
      if (!shape.name) continue;
      const p = interiorPoint(shape);
      const sprite = makeLabelSprite(shape.name, shape.color);
      sprite.position.set(p.x, baseY + WALL_H + 2.5, p.z);
      labels.add(sprite);
    }
  }

  // One InstancedMesh per prop type present on the floor — cheap even with
  // hundreds of desks, since it's one draw call per type rather than one
  // Mesh per prop. Rebuilt alongside the structural meshes on every edit;
  // only the (cached, shared) geometry survives the rebuild.
  const _dummy = new THREE.Object3D();
  function buildPropsGroup(state, floorIndex, baseY, group) {
    const byType = new Map();
    for (const p of state.props) {
      if (p.floor !== floorIndex) continue;
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    for (const [type, list] of byType) {
      const entry = catalogEntry(type);
      if (!entry) continue; // an unknown type from a newer save — nothing to draw it with
      const mesh = new THREE.InstancedMesh(getPropGeometry(entry), propMat, list.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeo = true;
      list.forEach((p, idx) => {
        _dummy.position.set(p.x, baseY + (p.y || 0), p.z);
        _dummy.rotation.set(0, p.rotationY || 0, 0);
        const s = p.scale > 0 ? p.scale : 1;
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        mesh.setMatrixAt(idx, _dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  // Which storeys are drawn, and how. Editing is one floor at a time: the
  // level below shows through as a ghost for alignment, everything else is
  // out of the way. Walkthrough shows the whole building.
  function applyFloorVisibility() {
    if (!built) return;
    const edit = mode === 'edit';
    const cur = built.currentFloor;
    for (const g of buildingGroup.children) {
      const i = g.userData.floor;
      const isCurrent = i === cur;
      const ghost = edit && !isCurrent &&
        ((layers.ghostBelow && i === cur - 1) || (layers.ghostAbove && i === cur + 1));
      g.visible = !edit || isCurrent || ghost;
      const structureOn = !edit || layers.structure;
      for (const mesh of g.children) {
        if (!mesh.userData.mats) continue;
        mesh.material = ghost ? mesh.userData.mats.ghost : mesh.userData.mats.solid;
        mesh.castShadow = !ghost && !mesh.userData.noShadow;
        mesh.visible = structureOn;
      }
      // Props don't ghost — they just disappear below the storey you're
      // editing, the same as their labels do — and the props layer toggle
      // only applies to the storey you're actually on.
      if (g.userData.propsGroup) {
        g.userData.propsGroup.visible = isCurrent ? (!edit || layers.props) : !edit;
      }
    }
    for (const g of labelGroup.children) {
      g.visible = !edit || g.userData.floor === cur;
    }
    labelledFloor = -1;   // let walk mode recompute from the camera
    if (gridHelper) gridHelper.position.y = floorBaseY(built, cur) + 0.04;
  }

  function buildFromState(state) {
    built = state;
    disposeGroup(buildingGroup);
    disposeGroup(ceilingGroup);
    disposeGroup(labelGroup);

    const metrics = stairMetrics(state);
    const links = stairsOf(state);
    state.floors.forEach((floor, i) => {
      const group = new THREE.Group();
      const ceil = new THREE.Group();
      const labels = new THREE.Group();
      group.userData.floor = ceil.userData.floor = labels.userData.floor = i;
      buildFloor(floor, floorBaseY(state, i), wallHeightOf(state, i), group, ceil, labels, {
        metrics,
        cuts: floorCuts(state, i),
        ceilCuts: floorCuts(state, i + 1),
        risers: links.filter((l) => l.from === i),
        guarded: links.filter((l) => l.to === i),
      });
      const propsGroup = new THREE.Group();
      buildPropsGroup(state, i, floorBaseY(state, i), propsGroup);
      group.add(propsGroup);
      group.userData.propsGroup = propsGroup;
      buildingGroup.add(group);
      ceilingGroup.add(ceil);
      labelGroup.add(labels);
    });

    // grid helper + sun sized to the grid
    const gw = state.w * CELL, gh = state.h * CELL;
    if (!gridHelper || gridHelper.userData.w !== state.w || gridHelper.userData.h !== state.h) {
      if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); }
      const div = Math.max(state.w, state.h);
      gridHelper = new THREE.GridHelper(div * CELL, div, 0x33404f, 0x2a3340);
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.55;
      gridHelper.position.set((div * CELL) / 2, 0.04, (div * CELL) / 2);
      gridHelper.userData = { w: state.w, h: state.h };
      gridHelper.visible = mode === 'edit';
      scene.add(gridHelper);

      sun.position.set(gw * 0.5 - 120, 160, gh * 0.5 + 90);
      sun.target.position.set(gw * 0.5, 0, gh * 0.5);
      const span = Math.max(gw, gh) * 0.75 + 40;
      sun.shadow.camera.left = -span;
      sun.shadow.camera.right = span;
      sun.shadow.camera.top = span;
      sun.shadow.camera.bottom = -span;
      sun.shadow.camera.far = 500;
      sun.shadow.camera.updateProjectionMatrix();
    }

    editView.camY = 200 + topOfBuilding(state);
    applyFloorVisibility();
  }

  buildComposer();

  return {
    renderer, scene, editCamera, walkCamera, editView,
    buildFromState, applyFloorVisibility, fitEditView, applyEditCamera,
    setMode, resize, render,
    get mode() { return mode; },
    get fxEnabled() { return fxEnabled; },
    set fxEnabled(v) { fxEnabled = v; },
    // Layers panel: which parts of the design are drawn while editing. A
    // shallow copy out, a merge in — `applyFloorVisibility` re-derives every
    // mesh's visibility from it immediately, so a toggle takes effect the
    // same frame without a full rebuild.
    get layers() { return { ...layers }; },
    setLayers(patch) { Object.assign(layers, patch); applyFloorVisibility(); },
  };
}
