// render.js — three.js scene setup, procedural PBR-style materials, lighting,
// post-processing, and rebuilding building geometry from grid state.
//
// Textures are generated procedurally on canvas (the brief's fallback path,
// since real CC0 PBR sets can drop into /assets/textures later). Materials are
// MeshStandardMaterial so swapping in albedo/normal/roughness maps is a
// one-line change per material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WALL_H, WALL_T, DOOR_W, DOOR_H, computeLabels } from './grid.js';

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
  const buildingGroup = new THREE.Group();
  const ceilingGroup = new THREE.Group();   // hidden in edit mode
  ceilingGroup.visible = false;             // starts in edit mode
  const labelGroup = new THREE.Group();
  scene.add(buildingGroup, ceilingGroup, labelGroup);

  let gridHelper = null;

  // --- cameras ---
  const editCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  editCamera.up.set(0, 0, -1);
  const walkCamera = new THREE.PerspectiveCamera(72, 1, 0.3, 1200);

  // edit view state (world-space center + view height in ft)
  const editView = { x: 0, z: 0, height: 140 };

  function fitEditView(state) {
    editView.x = (state.w * CELL) / 2;
    editView.z = (state.h * CELL) / 2;
    editView.height = state.h * CELL * 1.15;
  }

  function applyEditCamera() {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const halfH = editView.height / 2;
    editCamera.left = -halfH * aspect;
    editCamera.right = halfH * aspect;
    editCamera.top = halfH;
    editCamera.bottom = -halfH;
    editCamera.position.set(editView.x, 200, editView.z);
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

  function render() {
    if (mode === 'edit') applyEditCamera();
    if (fxEnabled && composer) composer.render();
    else renderer.render(scene, mode === 'edit' ? editCamera : walkCamera);
  }

  // ---------- geometry building ----------

  const _white = new THREE.Color(1, 1, 1);
  const _doorTint = new THREE.Color('#c98f5f');

  function coloredGeo(geo, color) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  function disposeGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material && child.material.map && child.isSprite) child.material.map.dispose();
      if (child.material && child.isSprite) child.material.dispose();
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

  function buildFromState(state) {
    disposeGroup(buildingGroup);
    disposeGroup(ceilingGroup);
    disposeGroup(labelGroup);

    const floorGeos = [], ceilGeos = [], wallGeos = [], fixtureGeos = [];

    // floors + ceilings
    const tmpColor = new THREE.Color();
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const cell = state.cells[y * state.w + x];
        if (!cell) continue;
        const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;

        const f = new THREE.PlaneGeometry(CELL, CELL);
        f.rotateX(-Math.PI / 2);
        f.translate(cx, 0, cz);
        // continuous tiling across cells
        const uv = f.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + x, uv.getY(i) + y);
        tmpColor.set(cell.color || _white);
        coloredGeo(f, tmpColor);
        floorGeos.push(f);

        const cg = new THREE.PlaneGeometry(CELL, CELL);
        cg.rotateX(Math.PI / 2);
        cg.translate(cx, WALL_H, cz);
        const cuv = cg.attributes.uv;
        for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) + x, cuv.getY(i) + y);
        ceilGeos.push(cg);

        // a 2x4ft light fixture on every other cell in both directions
        if (x % 2 === 1 && y % 2 === 1) {
          const fg = new THREE.BoxGeometry(3.6, 0.15, 1.6);
          fg.translate(cx, WALL_H - 0.1, cz);
          fixtureGeos.push(fg);
        }
      }
    }

    // walls & doors on edges
    const jamb = (CELL - DOOR_W) / 2;
    const addBox = (w, h, d, x, y, z, color) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      coloredGeo(g, color);
      wallGeos.push(g);
    };
    const buildEdge = (val, cx, cz, horizontal) => {
      // horizontal: wall runs along X at z=cz; vertical: along Z at x=cx
      const L = CELL + WALL_T; // overlap so corners join cleanly
      if (val === 1) {
        if (horizontal) addBox(L, WALL_H, WALL_T, cx, WALL_H / 2, cz, _white);
        else addBox(WALL_T, WALL_H, L, cx, WALL_H / 2, cz, _white);
      } else if (val === 2) {
        const off = DOOR_W / 2 + jamb / 2 + WALL_T / 2;
        const jw = jamb + WALL_T;
        const headH = WALL_H - DOOR_H;
        if (horizontal) {
          addBox(jw, WALL_H, WALL_T, cx - off, WALL_H / 2, cz, _white);
          addBox(jw, WALL_H, WALL_T, cx + off, WALL_H / 2, cz, _white);
          addBox(DOOR_W, headH, WALL_T, cx, DOOR_H + headH / 2, cz, _doorTint);
          // thin door frame trim for readability
          addBox(DOOR_W + 0.5, 0.25, WALL_T + 0.2, cx, DOOR_H + 0.125, cz, _doorTint);
        } else {
          addBox(WALL_T, WALL_H, jw, cx, WALL_H / 2, cz - off, _white);
          addBox(WALL_T, WALL_H, jw, cx, WALL_H / 2, cz + off, _white);
          addBox(WALL_T, headH, DOOR_W, cx, DOOR_H + headH / 2, cz, _doorTint);
          addBox(WALL_T + 0.2, 0.25, DOOR_W + 0.5, cx, DOOR_H + 0.125, cz, _doorTint);
        }
      }
    };
    for (let y = 0; y <= state.h; y++)
      for (let x = 0; x < state.w; x++) {
        const v = state.edgesH[y * state.w + x];
        if (v) buildEdge(v, (x + 0.5) * CELL, y * CELL, true);
      }
    for (let y = 0; y < state.h; y++)
      for (let x = 0; x <= state.w; x++) {
        const v = state.edgesV[y * (state.w + 1) + x];
        if (v) buildEdge(v, x * CELL, (y + 0.5) * CELL, false);
      }

    if (floorGeos.length) {
      const floor = new THREE.Mesh(mergeGeometries(floorGeos), floorMat);
      floor.receiveShadow = true;
      buildingGroup.add(floor);
    }
    if (wallGeos.length) {
      const walls = new THREE.Mesh(mergeGeometries(wallGeos), wallMat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      buildingGroup.add(walls);
    }
    if (ceilGeos.length) {
      const ceil = new THREE.Mesh(mergeGeometries(ceilGeos), ceilMat);
      ceil.receiveShadow = true;
      ceilingGroup.add(ceil);
    }
    if (fixtureGeos.length) {
      ceilingGroup.add(new THREE.Mesh(mergeGeometries(fixtureGeos), fixtureMat));
    }

    for (const l of computeLabels(state)) {
      const sprite = makeLabelSprite(l.name, l.color);
      sprite.position.set(l.cx, WALL_H + 2.5, l.cz);
      labelGroup.add(sprite);
    }

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
  }

  buildComposer();

  return {
    renderer, scene, editCamera, walkCamera, editView,
    buildFromState, fitEditView, applyEditCamera, setMode, resize, render,
    get mode() { return mode; },
    get fxEnabled() { return fxEnabled; },
    set fxEnabled(v) { fxEnabled = v; },
  };
}
