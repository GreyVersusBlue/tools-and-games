// render.js — three.js scene setup, procedural PBR-style materials, lighting,
// post-processing, and rebuilding building geometry from grid state.
//
// Textures are generated procedurally on canvas (the brief's fallback path,
// since real CC0 PBR sets can drop into /assets/textures later). Materials are
// MeshStandardMaterial so swapping in albedo/normal/roughness maps is a
// one-line change per material.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { skyState, defaultEnv, mixHex } from './sky.js';
import {
  budgetFor, spillAmbient, emitOf, LUMENS_TO_CANDELA, MAX_DYNAMIC_LIGHTS,
} from './lights.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DepthOfFieldPass } from 'three/addons/postprocessing/DepthOfFieldPass.js';
import {
  CELL, WALL_H, WALL_T, WALL_T_EXT, DOOR_H, RAIL_H,
  EDGE_GLASS, EDGE_RAIL, EDGE_WINDOW, isDoorEdge,
  FLOOR_H, computeLabels, floorBaseY, wallHeightOf, topOfBuilding,
} from './grid.js';
import {
  SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt,
  shapesOf, segEnds, segLength, shapeBBox, pointInShape, interiorPoint,
  floorSolidAt, openingSpec,
} from './shapes.js';
import { catalogEntry, propColor, variantKey } from './catalog.js';
import {
  stairMetrics, stairsOf, openingRails, runMetrics,
  elevatorSize, elevatorDoorWidth, elevatorsOn,
  floorCuts, inFloorCut, cellCut, stairWidth,
} from './stairs.js';
import { wallProbe, solidBeside } from './walls.js';
import { overlaySize, showsOn } from './overlay.js';
import { floorBounds, unionBounds, footprintMask } from './shadow.js';
import {
  finishEntry, wallPaint, DEFAULT_FINISH, DEFAULT_PAINT,
  facadeEntry, ROOF_MEMBRANE, ROOF_SHINGLE,
} from './finish.js';
import { terrainField, groundAt, emptyField } from './terrain.js';
import { regionsOf, surfaceEntry, markingsFor } from './site.js';
import { roofPlan, roofTop, PARAPET_H, COPING_T } from './roof.js';
// --- Phase 9 ---
import { loadModel, writeGLB, FT_TO_M } from './gltf.js';
import { modelBytes, modelsOf } from './models.js';
import { REFERENCE_SPACES, XR_MODE, rigPosition } from './xr.js';
import {
  collectDoorLeaves, leafAngle, mullionPositions, gridOpeningWidth,
  gridWindowSpec, windowBand, LEAF_T, MULLION_BAY,
} from './openings.js';

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

// One albedo per floor finish. `makeFloorAlbedo` above is still what a room
// with nothing said about it gets — VCT, and the texture this scene has always
// laid down — and everything here is the same trick at other materials: a base
// colour out of the finish table with a grain drawn over it. Procedural, on
// canvas, no asset pipeline, exactly as the rest of the scene is.
//
// A finish costs one texture and one material, made the first time a room asks
// for it and cached forever after, so a design with three finishes in it draws
// three floor meshes per storey instead of one.
function makeFinishAlbedo(entry) {
  const base = entry.color;
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    if (entry.grain === 'tile') {
      const n = 4, tile = S / n;
      for (let ty = 0; ty < n; ty++) {
        for (let tx = 0; tx < n; tx++) {
          ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.06).toFixed(3)})`;
          ctx.fillRect(tx * tile, ty * tile, tile, tile);
        }
      }
      speckle(ctx, S, 2200, ['rgba(255,255,255,0.30)', 'rgba(0,0,0,0.10)'], 0.4, 1.3);
      ctx.strokeStyle = 'rgba(30,28,24,0.22)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(S, i * tile); ctx.stroke();
      }
    } else if (entry.grain === 'fiber') {
      // Carpet: a dense short-pile scatter, no seams. Loop pile does show tile
      // joints in real life, but at 4ft per texture repeat they'd read as a
      // grid of squares rather than as carpet.
      speckle(ctx, S, 26000, ['rgba(255,255,255,0.11)', 'rgba(0,0,0,0.13)'], 0.4, 1.5);
    } else if (entry.grain === 'plank') {
      const rows = 8, hgt = S / rows;
      for (let r = 0; r < rows; r++) {
        const l = (Math.random() - 0.5) * 0.09;
        ctx.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 240 : 20},${l > 0 ? 210 : 10},${Math.abs(l).toFixed(3)})`;
        ctx.fillRect(0, r * hgt, S, hgt);
        ctx.strokeStyle = 'rgba(60,38,18,0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, r * hgt); ctx.lineTo(S, r * hgt); ctx.stroke();
        // grain, running the length of the plank
        ctx.strokeStyle = 'rgba(90,58,26,0.16)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 5; g++) {
          const y = r * hgt + 3 + Math.random() * (hgt - 6);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(S / 3, y + 3, (2 * S) / 3, y - 3, S, y);
          ctx.stroke();
        }
      }
    } else if (entry.grain === 'chip') {
      // Terrazzo: big aggregate chips in a matrix.
      speckle(ctx, S, 900, ['rgba(255,255,255,0.5)', 'rgba(40,60,80,0.35)',
        'rgba(120,60,50,0.3)', 'rgba(60,80,60,0.3)'], 1.5, 4.5);
      speckle(ctx, S, 3000, ['rgba(0,0,0,0.10)'], 0.4, 1.2);
    } else {
      speckle(ctx, S, 5200, ['rgba(255,255,255,0.16)', 'rgba(0,0,0,0.14)'], 0.4, 2);
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

// A site surface — asphalt, turf, a running track, a mulch bed. Same shape as
// `makeFinishAlbedo` and for the same reason: what a material looks like is a
// column in a table, and the builder reads the column.
function makeSiteAlbedo(entry) {
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = entry.color;
    ctx.fillRect(0, 0, S, S);
    if (entry.grain === 'fiber') {
      speckle(ctx, S, 30000, ['rgba(255,255,255,0.09)', 'rgba(0,0,0,0.14)',
        'rgba(150,190,110,0.16)'], 0.4, 1.6);
    } else if (entry.grain === 'mow') {
      // A mown field: alternating bands, because that is the single thing that
      // makes turf read as *maintained* turf from the air.
      const bands = 6, bh = S / bands;
      for (let i = 0; i < bands; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(0, i * bh, S, bh);
      }
      speckle(ctx, S, 18000, ['rgba(255,255,255,0.07)', 'rgba(0,0,0,0.10)'], 0.4, 1.4);
    } else if (entry.grain === 'chip') {
      speckle(ctx, S, 2600, ['rgba(255,255,255,0.22)', 'rgba(0,0,0,0.24)',
        'rgba(160,120,80,0.25)'], 1.4, 4.5);
      speckle(ctx, S, 6000, ['rgba(0,0,0,0.10)'], 0.4, 1.4);
    } else {
      speckle(ctx, S, 9000, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.16)',
        'rgba(140,140,150,0.10)'], 0.4, 1.8);
    }
  });
}

// The outside of the building. One tile covers `entry.tile` feet of wall, so
// the brick courses come out at brick size rather than at whatever size the
// wall happens to be.
function makeFacadeAlbedo(entry) {
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = entry.color;
    ctx.fillRect(0, 0, S, S);
    if (entry.grain === 'brick') {
      // Running bond. At tile = 4ft a course is about 2.7in, which is a brick.
      const courses = 18, ch = S / courses, bw = S / 6;
      for (let r = 0; r < courses; r++) {
        const off = (r % 2) * bw * 0.5;
        for (let c = -1; c < 7; c++) {
          const x = c * bw + off;
          ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${(Math.random() * 0.07).toFixed(3)})`;
          ctx.fillRect(x + 1.5, r * ch + 1.5, bw - 3, ch - 3);
        }
      }
      ctx.strokeStyle = 'rgba(228,224,214,0.55)';
      ctx.lineWidth = 2.2;
      for (let r = 0; r <= courses; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(S, r * ch); ctx.stroke();
      }
      for (let r = 0; r < courses; r++) {
        const off = (r % 2) * bw * 0.5;
        for (let c = -1; c < 7; c++) {
          const x = c * bw + off;
          ctx.beginPath(); ctx.moveTo(x, r * ch); ctx.lineTo(x, (r + 1) * ch); ctx.stroke();
        }
      }
    } else if (entry.grain === 'block') {
      // 8 x 16 CMU, split face — so the units are four times a brick and the
      // surface is rough rather than smooth.
      const courses = 6, ch = S / courses, bw = S / 3;
      speckle(ctx, S, 9000, ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.16)'], 0.5, 2.2);
      ctx.strokeStyle = 'rgba(120,116,108,0.5)';
      ctx.lineWidth = 2.5;
      for (let r = 0; r <= courses; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(S, r * ch); ctx.stroke();
        const off = (r % 2) * bw * 0.5;
        for (let c = -1; c < 4; c++) {
          const x = c * bw + off;
          ctx.beginPath(); ctx.moveTo(x, r * ch); ctx.lineTo(x, (r + 1) * ch); ctx.stroke();
        }
      }
    } else if (entry.grain === 'rib') {
      // Standing-seam metal: vertical ribs, a highlight on one side of each.
      const ribs = 12, rw = S / ribs;
      for (let i = 0; i < ribs; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(i * rw, 0, rw * 0.18, S);
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(i * rw + rw * 0.18, 0, rw * 0.12, S);
      }
    } else if (entry.grain === 'plank') {
      const rows = 12, hgt = S / rows;
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,240,210' : '30,20,10'},${(Math.random() * 0.08).toFixed(3)})`;
        ctx.fillRect(0, r * hgt, S, hgt);
        ctx.strokeStyle = 'rgba(50,32,16,0.30)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, r * hgt); ctx.lineTo(S, r * hgt); ctx.stroke();
      }
    } else {
      // Stucco and precast: a fine tooth, nothing more.
      speckle(ctx, S, 16000, ['rgba(255,255,255,0.09)', 'rgba(0,0,0,0.09)'], 0.4, 1.5);
    }
  });
}

// A roof: a seamed membrane on a flat deck, courses of shingle on a pitched
// one. Which of the two is not a setting — see the note beside ROOF_MEMBRANE.
function makeRoofAlbedo(entry, shingle) {
  return canvasTex(512, (ctx, S) => {
    ctx.fillStyle = entry.color;
    ctx.fillRect(0, 0, S, S);
    if (shingle) {
      const courses = 16, ch = S / courses, tab = S / 8;
      for (let r = 0; r < courses; r++) {
        const off = (r % 2) * tab * 0.5;
        for (let c = -1; c < 9; c++) {
          ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${(Math.random() * 0.09).toFixed(3)})`;
          ctx.fillRect(c * tab + off, r * ch, tab - 2, ch - 1);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, (r + 1) * ch - 2, S, 2);
      }
      speckle(ctx, S, 7000, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)'], 0.4, 1.4);
    } else {
      const seams = 5, sw = S / seams;
      speckle(ctx, S, 5000, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)'], 0.5, 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= seams; i++) {
        ctx.beginPath(); ctx.moveTo(i * sw, 0); ctx.lineTo(i * sw, S); ctx.stroke();
      }
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
  const walkFog = new THREE.Fog(0x9fc4e0, 220, 700);

  // --- sky ---
  //
  // Phase 3 replaces the flat background colour with a gradient dome, because
  // a dusk that is one shade of orange everywhere reads as a wall, not as a
  // sky. It is deliberately the cheapest thing that works: a back-faced sphere
  // with a 2 x 256 canvas gradient on it, redrawn only when the palette
  // actually changes (a scrub through an hour touches it maybe twice). No
  // shader, no atmosphere integral — the palette in sky.js already decided
  // what the colours are, and this only has to put them in the right order
  // from zenith to horizon.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  skyDome.renderOrder = -1;
  scene.add(skyDome);

  let skyKey = '';
  function paintSky(zenith, horizon) {
    const key = zenith + horizon;
    if (key === skyKey) return;
    skyKey = key;
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, zenith);
    g.addColorStop(0.62, zenith);
    g.addColorStop(0.88, horizon);
    // Below the horizon the dome is just the ground haze — a little darker
    // than the horizon so the join doesn't read as a seam from a low camera.
    g.addColorStop(1, horizon);
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, 2, 256);
    skyTex.needsUpdate = true;
  }

  // The sun itself. A flat disc turned toward the camera each frame, drawn
  // with a basic material so the light rig can't dim the thing that *is* the
  // light rig, and left bright enough that the bloom pass already in the chain
  // gives it a halo for free. It hides below the horizon rather than being
  // removed, so nothing has to be added back at dawn.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3dd, fog: false, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  sunDisc.renderOrder = -1;
  scene.add(sunDisc);

  // --- lights ---
  //
  // Every number below is now written by setEnvironment() out of sky.js's
  // palette; what they start at is the Phase 2 fixed rig, which is also what
  // the default environment resolves to. So this is the same scene it always
  // was until somebody moves the clock.
  const hemi = new THREE.HemisphereLight(0xbedcf5, 0x8a8474, 1.15);
  const ambient = new THREE.AmbientLight(0xbfd0e0, 0.35);
  // A second, separately-coloured flat fill for the *building's* light rather
  // than the sky's. It exists because the two are different colours and
  // multiplying is not adding: at night the sky ambient is very nearly black,
  // and turning its intensity up to represent a lit corridor produces a
  // brighter shade of midnight blue, not a lit corridor. This one is lamp
  // coloured and starts at nothing.
  const houseAmbient = new THREE.AmbientLight(0xffeedd, 0);
  scene.add(hemi, ambient, houseAmbient);
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.15;
  scene.add(sun, sun.target);

  // The building's own lights, as a *fixed* pool.
  //
  // three.js compiles one shader program per (light count, light type) shape,
  // so a pool that grows and shrinks as the walker moves stalls on a recompile
  // every time a classroom comes into range — the exact moment you least want
  // a frame hitch. Twelve lights, allocated once, never added or removed: an
  // unused one sits at intensity 0, which costs a few instructions per
  // fragment and nothing else. That is the budget strategy's other half; the
  // first half (clustering a room's eight troffers into one source) lives in
  // lights.js where it can be tested.
  //
  // None of them cast shadows. Twelve shadow maps is not a school-scale
  // budget, and a shadowless interior fixture is a fluorescent ceiling — which
  // is what most of these are.
  const lightPool = [];
  for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 30, 2);
    l.castShadow = false;
    scene.add(l);
    lightPool.push(l);
  }

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
  // recessed fluorescent troffers — emissive so bloom gives them a soft glow.
  // Phase 3 drives the intensity off the sun: these are the ceiling's own
  // house lights, and they go out when the daylight takes over.
  const FIXTURE_GLOW = 1.5;
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xf4f2ea,
    emissive: 0xfff6e2,
    emissiveIntensity: FIXTURE_GLOW,
    roughness: 0.4,
  });

  // Lamp lenses. A placeable fixture's geometry comes back in two halves (see
  // the builder note below) and this is the material the glowing half wears.
  //
  // One material per lamp colour, cached, rather than one shared material with
  // the colour in a vertex attribute: three.js's `emissive` is a uniform and
  // is *not* modulated by vertex colours, so a shared material would give a
  // green exit sign a warm white glow. Same trick as `finishMats` above — a
  // Map keyed on the thing that actually differs.
  //
  // How bright a lit lens reads. Over 1 on purpose: the bloom pass thresholds
  // at 0.88, so a lens has to overshoot to bloom at all, and a fixture that
  // doesn't bloom doesn't look switched on.
  const LAMP_GLOW = 2.4;
  const lampMats = new Map();
  let lampLevel = 0;      // 0..1, how hard the building's lights are burning
  function lampMaterial(hex) {
    let m = lampMats.get(hex);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: lampLevel * LAMP_GLOW,
      roughness: 0.55,
      metalness: 0,
    });
    lampMats.set(hex, m);
    return m;
  }
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

  // --- floor finishes ---
  //
  // The default finish reuses the material this scene has always had, so a
  // design that never picks one renders byte-identically to how it did before
  // Phase 2 — and pays for no extra texture. Everything else is built on
  // demand and cached for the life of the page: a rebuild reuses the material,
  // the same way `sharedGeo` reuses prop geometry.
  const finishMats = new Map([[DEFAULT_FINISH, { solid: floorMat, ghost: floorMatGhost }]]);

  function finishMaterials(key) {
    let m = finishMats.get(key);
    if (m) return m;
    const entry = finishEntry(key);
    const map = makeFinishAlbedo(entry);
    map.anisotropy = Math.min(8, maxAniso);
    map.repeat.set(1 / entry.tile, 1 / entry.tile);
    const solid = new THREE.MeshStandardMaterial({
      map,
      roughnessMap: makeFloorRoughness(),
      roughness: entry.grain === 'fiber' ? 1.0 : 0.92,
      metalness: 0.0,
      vertexColors: true,
    });
    const ghost = solid.clone();
    ghost.transparent = true;
    ghost.depthWrite = false;
    ghost.roughness = 1.0;
    ghost.opacity = 0.30;
    m = { solid, ghost };
    finishMats.set(key, m);
    return m;
  }

  // --- site surfaces, facades and roofs ---
  //
  // All three follow the finish cache's bargain exactly: built on demand,
  // cached for the life of the page, keyed on the table row. A design that
  // never lays a parking lot never builds an asphalt texture.
  const siteMats = new Map();
  function siteMaterial(key) {
    let m = siteMats.get(key);
    if (m) return m;
    const entry = surfaceEntry(key);
    const map = makeSiteAlbedo(entry);
    map.anisotropy = Math.min(8, maxAniso);
    map.repeat.set(1 / entry.tile, 1 / entry.tile);
    m = new THREE.MeshStandardMaterial({
      map, roughness: entry.grain === 'fiber' || entry.grain === 'mow' ? 1.0 : 0.95,
      metalness: 0, vertexColors: true,
      // Every site surface is a skin laid on the terrain a few inches above
      // it. Depth offset rather than height is what keeps a court from
      // shimmering against the ground it is painted on at a hundred feet.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    siteMats.set(key, m);
    return m;
  }

  const facadeMats = new Map();
  function facadeMaterial(key) {
    let m = facadeMats.get(key);
    if (m) return m;
    const entry = facadeEntry(key);
    const map = makeFacadeAlbedo(entry);
    map.anisotropy = Math.min(8, maxAniso);
    map.repeat.set(1 / entry.tile, 1 / entry.tile);
    m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, vertexColors: true });
    facadeMats.set(key, m);
    return m;
  }

  const roofMats = new Map();
  function roofMaterial(shingle) {
    const key = shingle ? 'shingle' : 'membrane';
    let m = roofMats.get(key);
    if (m) return m;
    const entry = shingle ? ROOF_SHINGLE : ROOF_MEMBRANE;
    const map = makeRoofAlbedo(entry, shingle);
    map.anisotropy = Math.min(8, maxAniso);
    map.repeat.set(1 / entry.tile, 1 / entry.tile);
    m = new THREE.MeshStandardMaterial({
      map, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
    });
    roofMats.set(key, m);
    return m;
  }

  // The paint on a court or a car park: white and yellow lines, unlit enough
  // to stay legible at dusk, offset hard so they never fight the surface.
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  // --- the ground ---
  //
  // Two meshes, and which one you see depends on whether the design has been
  // graded. `ground` is the flat plane every version before Phase 5 drew,
  // still exactly that for a design with no terrain and costing nothing. When
  // there *is* terrain, it is hidden and `terrainMesh` takes over: the same
  // plane, lofted onto the heightfield, extended far enough past the site that
  // the horizon is still ground rather than sky.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  let terrainMesh = null;
  // How far past the graded site the lofted ground keeps going. `groundAt`
  // holds the edge elevation outward, so the skirt is the site's own boundary
  // slope carried to the horizon — and the walk fog closes in well before it
  // ends, which is why it doesn't need to be larger.
  const SITE_SKIRT = 500;   // ft
  // Vertices per elevation post, per axis. Two, not one, and the reason is
  // worth stating: the field is *bilinear* between posts, and two triangles
  // over a whole post cell can only be planar. The gap between the two is the
  // cell's twist — a few tenths of a foot on a graded site — and a car park
  // laid on the ground at less than that pokes through it in patches.
  // Halving the spacing quarters the error, and 30,000 vertices is a
  // millisecond of a rebuild that already costs tens.
  const TERRAIN_SUBDIV = 2;

  function buildTerrain(field) {
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh = null;
    }
    if (!field || field.flat || !field.cols) { ground.visible = true; return; }
    ground.visible = false;
    const x0 = field.x0 - SITE_SKIRT, z0 = field.z0 - SITE_SKIRT;
    const x1 = field.x0 + (field.cols - 1) * field.step + SITE_SKIRT;
    const z1 = field.z0 + (field.rows - 1) * field.step + SITE_SKIRT;
    const w = x1 - x0, d = z1 - z0;
    // One vertex per elevation post. Finer buys nothing — the field is
    // bilinear between posts, so the extra vertices would land on the same
    // plane the coarse ones already describe.
    const grain = field.step / TERRAIN_SUBDIV;
    const segX = Math.max(4, Math.min(400, Math.round(w / grain)));
    const segZ = Math.max(4, Math.min(400, Math.round(d / grain)));
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x0 + w / 2, 0, z0 + d / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, groundAt(field, pos.getX(i), pos.getZ(i)) - 0.06);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // The ground plane's texture repeats every fifty feet; keep that rate on
    // the lofted one so a graded site doesn't suddenly look differently
    // scaled from a flat one.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 50), uv.getY(i) * (d / 50));
    terrainMesh = new THREE.Mesh(geo, groundMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }

  // --- dynamic building content ---
  // Each of these holds one child Group per storey, indexed by floor number,
  // so a floor can be shown, ghosted or hidden without rebuilding geometry.
  const buildingGroup = new THREE.Group();
  const ceilingGroup = new THREE.Group();   // hidden in edit mode
  ceilingGroup.visible = false;             // starts in edit mode
  const labelGroup = new THREE.Group();
  // Hardscape, fields and their paint. One group for the whole site rather
  // than one per storey: the ground has no storeys.
  const siteGroup = new THREE.Group();
  // Parapets, roof decks and pitched masses. Hidden while editing for exactly
  // the reason ceilings are — you cannot draw a plan through a roof.
  const roofGroup = new THREE.Group();
  roofGroup.visible = false;
  // Phase 8's two edit-mode underlays. Neither is part of the building:
  // `overlayGroup` is the tracing image somebody loaded, and `shadowGroup` is
  // the footprint of the storey below the one being edited, drawn so you can
  // see what an upper floor is allowed to stand on. Both are edit-only and
  // both draw over the plan rather than under it — tracing paper you put on
  // top of the drawing, which is what you do with tracing paper.
  const overlayGroup = new THREE.Group();
  const shadowGroup = new THREE.Group();
  overlayGroup.visible = false;
  shadowGroup.visible = false;
  scene.add(buildingGroup, ceilingGroup, labelGroup, siteGroup, roofGroup,
    overlayGroup, shadowGroup);

  let gridHelper = null;
  let built = null;         // last state passed to buildFromState
  // The graded ground, swept once per rebuild and shared by the terrain mesh,
  // the site surfaces and every prop that stands on the site.
  let siteField = emptyField();
  let labelledFloor = -1;   // storey whose labels walk mode is currently showing

  // Phase 6 layers panel: what's drawn while editing. Ghosting the floor below
  // is the v1-through-5 default (it's what lines walls up between storeys);
  // ghosting the one above and hiding structure/props outright are new. None
  // of this touches walkthrough mode — there you're standing in the building,
  // not squinting at a cross-section of it, so the whole thing always shows.
  const layers = {
    structure: true, props: true, ghostBelow: true, ghostAbove: false,
    // Phase 8: the tracing image, and the shadow an upper storey stands on.
    overlay: true, shadow: true,
  };

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
  let dofPass = null;

  // Photo mode. A small bundle of camera settings that only exist while you
  // are composing a shot: field of view, an exposure nudge on top of whatever
  // the sky's own palette asked for, and the depth-of-field pass. Everything
  // here is view state — none of it is saved with the design, because a
  // photograph is not part of the building.
  const photo = {
    on: false,
    fov: 60,
    focus: 30,
    aperture: 2.8,
    dof: true,
    bloom: 0.14,
  };
  let exposureBias = 1;
  const WALK_FOV = 72;

  function buildComposer() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cam = mode === 'edit' ? editCamera : walkCamera;
    if (composer) composer.dispose();
    if (dofPass) { dofPass.dispose(); dofPass = null; }
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
    // Depth of field costs a second scene render, so it is built only while
    // photo mode is actually open — and it goes *before* bloom, so a blurred
    // highlight blooms as the soft blob it now is rather than as the pinpoint
    // it used to be.
    if (mode === 'walk' && photo.on && photo.dof) {
      dofPass = new DepthOfFieldPass(scene, cam, w, h);
      dofPass.focus = photo.focus;
      dofPass.aperture = photo.aperture;
      composer.addPass(dofPass);
    }
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), photo.bloom, 0.4, 0.88));
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
  }

  function applyPhotoCamera() {
    walkCamera.fov = photo.on ? photo.fov : WALK_FOV;
    walkCamera.updateProjectionMatrix();
    if (dofPass) {
      dofPass.focus = photo.focus;
      dofPass.aperture = photo.aperture;
    }
  }

  // Phase 11: re-pose the instances a walker has shoved. `list` is shove.js's
  // own output — the obstacle records it moved — and nothing about the design
  // has changed, which is exactly why this exists: a rebuild would put every
  // chair back, because `state.props` never learned that any of them moved.
  function moveProps(list) {
    if (!list || !list.length) return 0;
    let n = 0;
    for (const m of list) {
      const inst = propInstances.get(m.id);
      if (!inst) continue;
      _dummy.position.set(m.x, inst.y, m.z);
      _dummy.rotation.set(0, m.rotationY || 0, 0);
      _dummy.scale.set(inst.scale, inst.scale, inst.scale);
      _dummy.updateMatrix();
      inst.mesh.setMatrixAt(inst.idx, _dummy.matrix);
      inst.mesh.instanceMatrix.needsUpdate = true;
      if (inst.lens) {
        inst.lens.setMatrixAt(inst.idx, _dummy.matrix);
        inst.lens.instanceMatrix.needsUpdate = true;
      }
      shoved.add(m.id);
      n++;
    }
    return n;
  }

  // Put them all back. A shove lives as long as the walk does and not a frame
  // longer — coming back to the plan and finding the furniture rearranged
  // would be a lie about a file that never changed.
  function restoreProps() {
    if (!shoved.size) return 0;
    let n = 0;
    for (const id of shoved) {
      const inst = propInstances.get(id);
      if (!inst) continue;
      _dummy.position.set(inst.x, inst.y, inst.z);
      _dummy.rotation.set(0, inst.rotationY, 0);
      _dummy.scale.set(inst.scale, inst.scale, inst.scale);
      _dummy.updateMatrix();
      inst.mesh.setMatrixAt(inst.idx, _dummy.matrix);
      inst.mesh.instanceMatrix.needsUpdate = true;
      if (inst.lens) {
        inst.lens.setMatrixAt(inst.idx, _dummy.matrix);
        inst.lens.instanceMatrix.needsUpdate = true;
      }
      n++;
    }
    shoved.clear();
    return n;
  }

  function setMode(m) {
    mode = m;
    const edit = m === 'edit';
    // Everything the walker pushed around goes back where it was drawn.
    if (edit) restoreProps();
    // Photo mode is a walkthrough affordance; going back to the plan puts the
    // ordinary walk lens back so the next walk doesn't start at 24mm.
    if (edit && photo.on) photo.on = false;
    applyPhotoCamera();
    ceilingGroup.visible = !edit;
    if (gridHelper) gridHelper.visible = edit;
    scene.fog = edit ? null : walkFog;
    // The edit floor above only applies while editing, so switching modes
    // changes the answer even though the environment hasn't moved.
    applyAmbient();
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

  // ---------- the environment: sun, sky, and the building's own lights ----------
  //
  // One entry point. `setEnvironment` takes the design's env record, asks
  // sky.js where the sun is and what colour that makes everything, and writes
  // the answer into the rig — light colours and intensities, the sky gradient,
  // the fog, the tone mapping exposure, and how hard the fixtures burn. It is
  // cheap enough to call on every frame of a sun-study scrub (the only
  // allocation is the palette object; the gradient repaints only when its two
  // colours actually change), which is what lets the scrub be a scrub rather
  // than a stepped preview.

  const site = { x: 0, z: 0, span: 200, top: 40 };
  let envState = skyState(defaultEnv());
  // How far out the directional light stands. Far enough to clear an 8-storey
  // building and its shadow frustum, near enough that the shadow map still has
  // texels to spare.
  const SUN_DIST = 320;

  function placeSun() {
    const d = envState.dir;
    sun.target.position.set(site.x, 0, site.z);
    sun.position.set(
      site.x + d.x * SUN_DIST,
      Math.max(6, d.y * SUN_DIST),
      site.z + d.z * SUN_DIST,
    );
    // A low sun throws long shadows, so the orthographic frustum has to grow
    // as the sun sinks or the far end of the building falls out of the map and
    // stops casting at all. Twice the site at noon, four times at dusk.
    const stretch = 2 + 2 * (1 - Math.max(0, Math.min(1, envState.dir.y)));
    const span = site.span * stretch * 0.5;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.far = SUN_DIST * 2 + site.top;
    sun.shadow.camera.updateProjectionMatrix();
    // Below the horizon there is nothing to cast, and leaving the map running
    // costs a full extra scene render for a black texture.
    sun.castShadow = envState.daylight;

    sunDisc.visible = d.y > -0.08;
    sunDisc.position.set(site.x + d.x * 900, d.y * 900, site.z + d.z * 900);
    sunDisc.material.color.set(envState.palette.sun);
    // Fade the disc out as it touches the horizon rather than clipping it
    // through the ground plane.
    sunDisc.material.opacity = Math.max(0, Math.min(0.95, (d.y + 0.08) * 6));
  }

  function setEnvironment(env) {
    envState = skyState(env);
    const pal = envState.palette;

    baseHemi = pal.hemiIntensity;
    baseAmbient = pal.ambientIntensity;
    sun.color.set(pal.sun);
    sun.intensity = pal.sunIntensity;

    paintSky(pal.zenith, pal.horizon);
    walkFog.color.set(pal.horizon);
    walkFog.near = pal.fogNear;
    walkFog.far = pal.fogFar;
    renderer.toneMappingExposure = pal.exposure * exposureBias;

    // The fixtures. `lightLevel` is a ramp, not a switch, so scrubbing through
    // dusk fades the building up instead of snapping it on between two frames.
    lampLevel = envState.lightLevel;
    fixtureMat.emissiveIntensity = FIXTURE_GLOW * lampLevel;
    for (const m of lampMats.values()) m.emissiveIntensity = lampLevel * LAMP_GLOW;

    placeSun();
    markLightsDirty();
    applyAmbient();
    return envState;
  }

  // The flat fill is three terms on two lights, and keeping them apart matters:
  //
  //   baseAmbient   the sky's own contribution, written by the palette, on the
  //                 sky-coloured `ambient`
  //   fillAmbient   the building's, on the lamp-coloured `houseAmbient` — the
  //                 unbudgeted fixtures' spill, plus a modest house term so an
  //                 *unfurnished* school at night is dim rather than pitch
  //                 black (a design with no fixtures in it still has a ceiling
  //                 full of the generic troffers `buildFloor` bakes in, and
  //                 this is them)
  //   the edit floor, below
  //
  // The edit floor is the one concession the sun makes to the tool. A floor
  // plan at midnight is a correct picture of a building at midnight and a
  // useless thing to draw walls on, so while editing, the fill never falls
  // below a legible minimum — the plan keeps the *colour* and the *shadows* of
  // the hour you scrubbed to and stops taking its darkness from it. The
  // walkthrough gets no such help: standing in an unlit school at midnight is
  // supposed to be standing in an unlit school at midnight.
  // Raising the *intensity* of a midnight-blue fill light is not the same as
  // making the plan readable — it makes it a brighter midnight blue. So the
  // edit floor pulls the fill's colour toward neutral as well as its level,
  // and the amount it pulls is what decides how much of the hour still shows.
  // At 0.6 a dusk plan is legibly grey-blue and a noon plan is unchanged
  // (neutral pulled toward neutral is neutral).
  let baseAmbient = 0.35;
  let baseHemi = 1.15;
  let fillAmbient = 0;
  const HOUSE_FILL = 0.32;
  const EDIT_MIN_AMBIENT = 0.62;
  const EDIT_MIN_HEMI = 0.85;
  const EDIT_TINT = 0.6;
  const _editSky = new THREE.Color('#d2dbe6');
  const _editGround = new THREE.Color('#9aa0a8');

  function applyAmbient() {
    const pal = envState.palette;
    ambient.color.set(pal.ambient);
    hemi.color.set(pal.hemiSky);
    hemi.groundColor.set(pal.hemiGround);
    houseAmbient.intensity = fillAmbient;
    if (mode === 'edit') {
      ambient.color.lerp(_editSky, EDIT_TINT);
      hemi.color.lerp(_editSky, EDIT_TINT);
      hemi.groundColor.lerp(_editGround, EDIT_TINT);
      ambient.intensity = Math.max(EDIT_MIN_AMBIENT, baseAmbient);
      hemi.intensity = Math.max(EDIT_MIN_HEMI, baseHemi);
      return;
    }
    ambient.intensity = baseAmbient;
    hemi.intensity = baseHemi;
  }

  // ---------- the dynamic light pool ----------
  //
  // Recomputed when the design changes, when the lights come on or go off, or
  // when the eye has moved far enough for the ranking to plausibly differ —
  // *not* every frame. The budget is a sort over every fixture in the
  // building; at 4ft of movement it runs a couple of times a second while
  // walking and not at all while standing still.
  const LIGHT_REFRESH_FT = 4;
  let lightsDirty = true;
  let lastLightEye = { x: 1e9, y: 1e9, z: 1e9 };
  let lastLampLevel = -1;

  const markLightsDirty = () => { lightsDirty = true; };

  function updateDynamicLights(eye) {
    const moved = (eye.x - lastLightEye.x) ** 2 + (eye.y - lastLightEye.y) ** 2 +
      (eye.z - lastLightEye.z) ** 2;
    if (!lightsDirty && lampLevel === lastLampLevel && moved < LIGHT_REFRESH_FT ** 2) return;
    lightsDirty = false;
    lastLampLevel = lampLevel;
    lastLightEye = { x: eye.x, y: eye.y, z: eye.z };

    if (!built || lampLevel <= 0) {
      for (const l of lightPool) l.intensity = 0;
      fillAmbient = 0;
      applyAmbient();
      return;
    }

    const { lit, spillLm } = budgetFor(built, catalogEntry, eye, {
      floorHt: built.floorHt,
      cap: lightPool.length,
    });
    for (let i = 0; i < lightPool.length; i++) {
      const l = lightPool[i];
      const c = lit[i];
      if (!c) { l.intensity = 0; continue; }
      l.position.set(c.x, c.y, c.z);
      l.color.set(c.color);
      l.distance = c.range;
      // Lumens are the catalog's honest number; candela is what three.js
      // wants. LIGHT_GAIN is the one artistic constant in the chain — it says
      // how bright a real 4,000lm troffer should read in a scene that is also
      // being tone-mapped and bloomed.
      l.intensity = c.lm * LUMENS_TO_CANDELA * LIGHT_GAIN * lampLevel;
    }
    fillAmbient = (spillAmbient(spillLm) + HOUSE_FILL) * lampLevel;
    applyAmbient();
  }

  // Candela out of the conversion, scaled to this scene's exposure.
  //
  // This is the one artistic constant in an otherwise physical chain, and it
  // is small because the rest of the chain is not: a 4,000lm troffer is 318
  // candela, and 318 candela eight feet below a desk is an irradiance of five
  // with ACES tone mapping already lifting the midtones. Tuned so one troffer
  // lights the desk under it without flaring the ceiling it is set into, and a
  // gym's high bays light the gym.
  const LIGHT_GAIN = 0.14;

  function render() {
    if (mode === 'edit') applyEditCamera();
    else updateWalkLabels();
    const cam = mode === 'edit' ? editCamera : walkCamera;
    // The pool is ranked from wherever you are actually looking from — the
    // orthographic camera's own position while editing (200ft up, so almost
    // nothing is in range and the fixtures read as the glowing lenses they
    // are), the walker's eye while walking.
    updateDynamicLights(mode === 'edit'
      ? { x: editView.x, y: 12, z: editView.z }
      : cam.position);
    // The sky dome and the sun disc travel with the camera so a 1,000ft sphere
    // never has to be bigger than the far plane, and always face it.
    skyDome.position.copy(cam.position);
    sunDisc.lookAt(cam.position);
    if (fxEnabled && composer) composer.render();
    else renderer.render(scene, cam);
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

  // Lamps. Phase 3 splits the bulb out of the shade so the thing can be seen
  // to be on — and adds the desk variant, which is the same three pieces at a
  // sixth the height with an arm instead of a pole.
  const buildLamp = (e) => {
    const shadeColor = tint(e.color, 0.08);
    const poleColor = tint(e.color, -0.4);
    const glow = lensColor(e);
    if (e.surface) {
      const arm = e.h * 0.62;
      return lit(
        [
          cyl(e.w * 0.4, e.w * 0.46, 0.1, 14, 0, 0.05, 0, poleColor),
          cylT(0.04, 0.04, arm, 6, -e.w * 0.1, arm * 0.45, 0, poleColor, 0, 0.42),
          cylT(e.w * 0.42, e.w * 0.2, 0.42, 14, e.w * 0.16, e.h - 0.24, 0, shadeColor, 0, -0.7),
        ],
        [sph(e.w * 0.15, e.w * 0.1, e.h - 0.38, 0, glow, 10)],
      );
    }
    const body = [
      cyl(e.w * 0.22, e.w * 0.28, 0.08, 16, 0, 0.04, 0, poleColor),
      cyl(0.045, 0.045, e.h - 0.7, 8, 0, (e.h - 0.7) / 2 + 0.08, 0, poleColor),
      cyl(e.w * 0.16, e.w * 0.36, 0.55, 16, 0, e.h - 0.3, 0, shadeColor),
    ];
    // A lamp with no `emit` row is a prop that happens to look like a lamp;
    // it keeps the old single-geometry shape and never glows.
    if (!emitOf(e)) return mergeGeometries(body);
    return lit(body, [sph(e.w * 0.17, 0, e.h - 0.5, 0, glow, 10)]);
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

  // ---------- Phase 4 builders: the things that make the noise ----------

  // A corridor gong: a domed shell on a backplate with a striker beside it.
  // The dome is a half-sphere squashed on Y, because a bell shell is wider
  // than it is deep and a full sphere reads as a ball on the wall.
  const buildGongbell = (e) => {
    const metal = tint(e.color, 0.05, -0.1);
    const r = e.w / 2;
    const face = e.d * 0.55;
    return mergeGeometries([
      box(e.w * 0.95, e.h * 0.95, 0.12, 0, e.h / 2, -e.d / 2 + 0.06, tint(e.color, -0.22)),
      // The shell: a cone lying on its side, wide at the wall and domed at the
      // front, with a cap to round the apex off.
      cylT(r * 0.45, r, face, 18, 0, e.h / 2, face / 2 - e.d * 0.35, e.color, Math.PI / 2),
      sph(r * 0.45, 0, e.h / 2, face - e.d * 0.35, e.color, 12),
      // The striker, hanging off the side where a gong's clapper actually is.
      cyl(0.045, 0.045, e.w * 0.5, 6, r * 0.78, e.h * 0.36, -e.d * 0.1, metal),
      sph(0.1, r * 0.78, e.h * 0.11, -e.d * 0.1, metal, 8),
    ]);
  };

  // A ceiling diffuser is a stepped square cone; the same builder does the
  // round ceiling speaker, whose grille is a shallow disc in a trim ring.
  //   style 'speaker'  a round grille rather than a square throw pattern
  const buildDiffuser = (e) => {
    const trim = tint(e.color, -0.1);
    if (e.style === 'speaker') {
      const r = e.w / 2;
      return mergeGeometries([
        cyl(r, r, e.h * 0.35, 20, 0, e.h * 0.82, 0, trim),
        cyl(r * 0.82, r * 0.82, e.h * 0.3, 20, 0, e.h * 0.45, 0, tint(e.color, -0.3)),
        cyl(r * 0.34, r * 0.34, e.h * 0.2, 12, 0, e.h * 0.2, 0, trim),
      ]);
    }
    const parts = [box(e.w, e.h * 0.3, e.d, 0, e.h * 0.85, 0, trim)];
    // Three nested cones stepping down out of the plenum — what a supply
    // diffuser is, and the reason it whispers rather than roars.
    for (let i = 0; i < 3; i++) {
      const k = 1 - (i + 1) * 0.22;
      parts.push(box(e.w * k, e.h * 0.18, e.d * k, 0, e.h * (0.6 - i * 0.2), 0,
        tint(e.color, -0.06 - i * 0.06)));
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

  // ---------- Phase 11 builders: the decor packs ----------
  //
  // Three builders for four seasons, which is the whole argument for having
  // done the colour variants first. A garland is a garland whether it is
  // orange crepe in October or evergreen in December; what changes is the
  // paint, and paint is now a field on the prop rather than a row in this
  // table. Anything a pack needs that these three don't make, an existing
  // builder already did — a decorated conifer is `tree` with `trim`, a paper
  // snowflake is `panel` in white, a poinsettia is `plant` in red.
  //
  // `trim` is the second colour, named on the row the way buildTree names its
  // bark: fixed, so a repainted garland keeps its cream bunting rather than
  // going monochrome. A row without one derives its accent from its own paint.
  const trimOf = (e) => e.trim || tint(e.color, 0.22, 0.12);

  // A swag strung between two points, hanging along local x with its ends
  // pinned at the top of the row's box and its middle sagging by `sag`.
  // Sixteen chords is enough that the curve reads as a curve at arm's length
  // and cheap enough that a corridor of them still instances.
  //   style 'bulb'      spheres hung from the rope — beads, baubles, lights
  //   style 'pennant'   triangles hanging point-down — bunting
  //   style 'streamer'  no ornaments, a fatter twist — crepe paper
  // A row with `emit` hands its ornaments back as the lens, so a string of
  // lights glows on the same instance matrices as the rope it hangs from.
  const buildGarland = (e) => {
    const style = e.style || 'bulb';
    const segs = Math.max(8, Math.min(24, Math.round(e.w * 1.6)));
    const sag = e.h * 0.72;
    const ropeR = style === 'streamer' ? 0.075 : 0.045;
    const rope = tint(e.color, -0.14);
    // A parabola rather than a true catenary: at these spans the two curves
    // differ by less than the rope is thick.
    const yAt = (t) => e.h - sag * 4 * t * (1 - t);
    const xAt = (t) => (t - 0.5) * e.w;
    const parts = [];
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const x0 = xAt(t0), x1 = xAt(t1), y0 = yAt(t0), y1 = yAt(t1);
      const dx = x1 - x0, dy = y1 - y0;
      parts.push(boxT(Math.hypot(dx, dy) + ropeR, ropeR * 2, ropeR * 2,
        (x0 + x1) / 2, (y0 + y1) / 2, 0, rope, 0, 0, Math.atan2(dy, dx)));
    }
    if (style === 'streamer') return mergeGeometries(parts);
    // Ornaments hang from the interior nodes; the ends are where it is nailed
    // to the wall, and a bauble there would be inside the plaster.
    const orn = [];
    const accent = trimOf(e);
    const glow = emitOf(e) ? lensColor(e) : null;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const x = xAt(t), y = yAt(t);
      if (style === 'pennant') {
        // A triangle is a two-segment cone: flat enough to read as cloth.
        orn.push(cylT(0.01, e.w * 0.055, e.h * 0.5, 3, x, y - e.h * 0.25, 0,
          i % 2 ? accent : e.color, Math.PI, 0));
      } else {
        const r = e.h * (i % 2 ? 0.16 : 0.12);
        orn.push(sph(r, x, y - r - 0.04, 0, glow || (i % 2 ? accent : e.color), 8));
      }
    }
    return glow ? lit(parts, orn) : mergeGeometries(parts.concat(orn));
  };

  // A ring on a wall, facing the room the way every other wall mount does.
  // `berries` scatters a second colour around it; `bow` ties one on below.
  const buildWreath = (e) => {
    const r = Math.min(e.w, e.h) / 2;
    const cy = e.h / 2;
    const accent = trimOf(e);
    const parts = [
      ring(r * 0.78, r * 0.2, 0, cy, 0, e.color, { rx: 0 }),
      // A second, thinner ring set forward and turned a little: two rings read
      // as foliage where one reads as a doughnut.
      ring(r * 0.8, r * 0.12, 0, cy, e.d * 0.25, tint(e.color, -0.1), { rx: 0, rz: 0.4 }),
    ];
    if (e.berries !== false) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        // Set forward of the front ring rather than level with it: berries
        // buried inside the foliage are berries nobody sees from the corridor.
        parts.push(sph(r * 0.12, Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74, e.d * 0.42, accent, 6));
      }
    }
    if (e.bow !== false) {
      // A loop and a tail either side of a knot. Two small upright rings read
      // as a bow from across a corridor where two flat triangles read as a
      // bow tie, and the tails are what say which way is down.
      const by = cy - r * 0.78;
      for (const sx of [-1, 1]) {
        parts.push(ring(r * 0.19, r * 0.06, sx * r * 0.23, by + r * 0.04, e.d * 0.28, accent, { rx: 0 }));
        parts.push(boxT(r * 0.12, r * 0.6, e.d * 0.16, sx * r * 0.17, by - r * 0.32, e.d * 0.24, accent, 0, 0, sx * 0.33));
      }
      parts.push(sph(r * 0.11, 0, by, e.d * 0.3, tint(accent, -0.12), 8));
    }
    return mergeGeometries(parts);
  };

  // Pumpkins and gourds: a lathe with few enough segments that the facets read
  // as ribs. `style: 'gourd'` is the same profile pulled into a neck.
  const buildGourd = (e) => {
    const r = e.w / 2, h = e.h;
    const gourd = e.style === 'gourd';
    const profile = gourd
      ? [[0.02, 0], [r * 0.62, h * 0.03], [r, h * 0.22], [r * 0.92, h * 0.4],
         [r * 0.4, h * 0.58], [r * 0.3, h * 0.76], [r * 0.36, h * 0.88], [r * 0.1, h * 0.93]]
      : [[0.02, 0], [r * 0.72, h * 0.05], [r, h * 0.4], [r * 0.86, h * 0.76],
         [r * 0.36, h * 0.93], [0.02, h * 0.95]];
    return mergeGeometries([
      lathe(profile, 0, 0, 0, e.color, gourd ? 9 : 11),
      cylT(0.055, 0.1, h * 0.24, 6, 0, h * 1.02, r * 0.06, '#6f7a3a', 0, 0.25),
    ]);
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

  // ---------- the site ----------
  //
  // Phase 5 of the second arc. Nothing about the contract changes — merged,
  // vertex-coloured, bottom at y = 0, facing +Z, sized off the row — but these
  // are the first builders written for things that are twenty and thirty feet
  // tall, so the segment counts are kept low deliberately: a shade tree is
  // three overlapping spheres and a tapered trunk, and at the distance you
  // ever see one from, a fourth sphere buys nothing.

  // Five trees out of one builder, keyed on `style`. The canopy sits on the
  // top two-thirds of the height and the trunk tapers, which is most of what
  // makes a lump of green read as a tree rather than as a balloon.
  const buildTree = (e) => {
    const style = e.style || 'shade';
    const bark = '#6a5240';
    const parts = [];
    const r = e.w / 2;
    if (style === 'conifer') {
      parts.push(cyl(0.25, 0.45, e.h * 0.22, 8, 0, e.h * 0.11, 0, bark));
      // Three stacked skirts, each narrower and shorter than the one below.
      for (let i = 0; i < 3; i++) {
        const t = i / 3;
        const base = e.h * (0.16 + t * 0.28);
        parts.push(cyl(0, r * (1 - t * 0.55), e.h * 0.42, 10, 0, base + e.h * 0.21, 0,
          tint(e.color, -0.04 + i * 0.03)));
      }
      // Phase 11: `trim` turns the same conifer into a decorated one — a star
      // and a spiral of baubles, in the row's trim colour. It is a parameter
      // rather than a second builder because a decorated tree is a landscape
      // tree that somebody got at with a box of ornaments.
      if (e.trim) {
        const star = e.trim;
        const tipY = e.h * (0.16 + (2 / 3) * 0.28) + e.h * 0.42;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          parts.push(boxT(e.h * 0.1, e.h * 0.028, e.h * 0.028, 0, tipY + e.h * 0.06, 0, star, 0, 0, a));
        }
        const n = 12;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const a = t * Math.PI * 5.5;
          // Follow the cone in: the radius at height t, pulled just inside the
          // needles so a bauble hangs off the tree rather than floating beside it.
          const rr = r * (1 - t * 0.82) * 0.72;
          parts.push(sph(e.h * 0.035, Math.cos(a) * rr, e.h * (0.28 + t * 0.5), Math.sin(a) * rr,
            i % 2 ? star : tint(star, -0.18, 0.1), 6));
        }
      }
      return mergeGeometries(parts);
    }
    if (style === 'columnar') {
      // A poplar is a sphere stretched until it stops being one.
      const tall = new THREE.SphereGeometry(r, 10, 8);
      tall.scale(1, (e.h * 0.44) / r, 1);
      tall.translate(0, e.h * 0.56, 0);
      return mergeGeometries([
        cyl(0.2, 0.32, e.h * 0.18, 8, 0, e.h * 0.09, 0, bark),
        coloredGeo(tall, e.color),
      ]);
    }
    if (style === 'young') {
      parts.push(cyl(0.12, 0.18, e.h * 0.55, 8, 0, e.h * 0.275, 0, bark));
      parts.push(sph(r * 0.75, 0, e.h * 0.75, 0, e.color, 9));
      // Two stakes and the ties between them — the whole reason this row is
      // its own type rather than a smaller shade tree.
      for (const sx of [-1, 1]) {
        parts.push(cyl(0.07, 0.07, e.h * 0.45, 6, sx * r * 0.5, e.h * 0.225, 0, '#8a6a48'));
        parts.push(box(r, 0.06, 0.06, sx * r * 0.25, e.h * 0.4, 0, '#2f7a4a'));
      }
      return mergeGeometries(parts);
    }
    const trunkH = style === 'ornamental' ? e.h * 0.3 : e.h * 0.36;
    parts.push(cyl(r * 0.09, r * 0.16, trunkH, 8, 0, trunkH / 2, 0, bark));
    // Two limbs, splayed, so the canopy has something under it.
    for (const sx of [-1, 1]) {
      parts.push(cylT(0.1, 0.16, e.h * 0.22, 6, sx * r * 0.18, trunkH + e.h * 0.06, 0, bark, 0, sx * 0.45));
    }
    const cr = style === 'ornamental' ? r * 0.85 : r * 0.62;
    parts.push(sph(cr, 0, trunkH + cr * 0.75, 0, e.color, 12));
    parts.push(sph(cr * 0.78, r * 0.3, trunkH + cr * 0.5, -r * 0.22, tint(e.color, 0.05), 10));
    parts.push(sph(cr * 0.72, -r * 0.32, trunkH + cr * 0.55, r * 0.2, tint(e.color, -0.05), 10));
    parts.push(sph(cr * 0.6, r * 0.05, trunkH + cr * 1.25, r * 0.1, tint(e.color, 0.03), 10));
    return mergeGeometries(parts);
  };

  // A clipped hedge: a box with its top corners knocked off, which is what a
  // hedge trimmer leaves and what stops it reading as a green wall.
  const buildHedge = (e) => {
    const g = e.color;
    return mergeGeometries([
      box(e.w, e.h * 0.86, e.d, 0, e.h * 0.43, 0, g),
      box(e.w - 0.4, e.h * 0.2, e.d - 0.4, 0, e.h * 0.9, 0, tint(g, 0.05)),
      box(e.w, 0.25, e.d, 0, 0.12, 0, '#4a3a2c'),
    ]);
  };

  const buildShrub = (e) => {
    if (e.style === 'grass') {
      const parts = [];
      // A clump of blades, fanned. Six is enough at any distance you see one.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(boxT(0.12, e.h, 0.05,
          Math.cos(a) * e.w * 0.18, e.h * 0.45, Math.sin(a) * e.w * 0.18,
          tint(e.color, (i % 3) * 0.04 - 0.04), Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28));
      }
      return mergeGeometries(parts);
    }
    const r = e.w / 2;
    return mergeGeometries([
      sph(r * 0.9, 0, e.h * 0.5, 0, e.color, 10),
      sph(r * 0.6, r * 0.35, e.h * 0.32, r * 0.2, tint(e.color, -0.05), 8),
      sph(r * 0.55, -r * 0.3, e.h * 0.34, -r * 0.25, tint(e.color, 0.05), 8),
    ]);
  };

  const buildPlanter = (e) => {
    const r = e.w / 2;
    return mergeGeometries([
      lathe([[r * 0.72, 0], [r, e.h * 0.85], [r, e.h], [r * 0.86, e.h], [r * 0.86, e.h * 0.7]],
        0, 0, 0, e.color, 16),
      cyl(r * 0.84, r * 0.84, 0.15, 14, 0, e.h * 0.72, 0, '#4a3a2c'),
      sph(r * 0.6, 0, e.h * 0.95, 0, '#4a7a4a', 9),
      sph(r * 0.4, r * 0.4, e.h * 0.85, 0, '#5c8a44', 8),
    ]);
  };

  // A boulder: an icosahedron squashed to the row's dimensions, which gives
  // flat facets and no two-sphere blobbiness.
  const buildBoulder = (e) => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    g.scale(e.w, e.h * 1.5, e.d);
    g.translate(0, e.h * 0.42, 0);
    return coloredGeo(g, e.color);
  };

  // A goal is a frame and a net, and the net is a grid of thin bars rather
  // than a texture — it instances, and a texture with alpha would not.
  const buildGoal = (e) => {
    const post = 0.25;
    const parts = [
      box(post, e.h, post, -e.w / 2, e.h / 2, 0, e.color),
      box(post, e.h, post, e.w / 2, e.h / 2, 0, e.color),
      box(e.w + post, post, post, 0, e.h, 0, e.color),
    ];
    const net = tint(e.color, -0.25);
    for (const sx of [-1, 1]) {
      parts.push(boxT(post * 0.8, Math.hypot(e.h, e.d), post * 0.8,
        sx * e.w / 2, e.h / 2, -e.d / 2, net, Math.atan2(e.d, e.h), 0, 0));
    }
    parts.push(box(e.w, post * 0.7, post * 0.7, 0, 0.1, -e.d, net));
    for (let i = 1; i < 6; i++) {
      const x = -e.w / 2 + (e.w / 6) * i;
      parts.push(boxT(0.06, Math.hypot(e.h, e.d), 0.06, x, e.h / 2, -e.d / 2, net, Math.atan2(e.d, e.h), 0, 0));
    }
    for (let i = 1; i < 4; i++) {
      const y = (e.h / 4) * i;
      parts.push(box(e.w, 0.05, 0.05, 0, y, -(e.d * (1 - y / e.h)) * 0.9, net));
    }
    return mergeGeometries(parts);
  };

  // A backstop: two uprights, a curved hood and a mesh panel between them.
  const buildBackstop = (e) => {
    const parts = [];
    const post = 0.35;
    for (const sx of [-1, 1]) {
      parts.push(cyl(post / 2, post / 2, e.h, 8, sx * e.w / 2, e.h / 2, 0, e.color));
    }
    parts.push(cylT(post / 2, post / 2, e.w, 8, 0, e.h, 0, e.color, 0, Math.PI / 2));
    const meshC = tint(e.color, -0.18);
    for (let i = 0; i <= 8; i++) {
      parts.push(box(0.08, e.h, 0.08, -e.w / 2 + (e.w / 8) * i, e.h / 2, 0, meshC));
    }
    for (let i = 1; i <= 5; i++) {
      parts.push(box(e.w, 0.08, 0.08, 0, (e.h / 6) * i, 0, meshC));
    }
    // The hood, angled back over the plate.
    parts.push(boxT(e.w, 0.12, e.d * 0.7, 0, e.h + e.d * 0.2, -e.d * 0.3, meshC, 0.9, 0, 0));
    return mergeGeometries(parts);
  };

  const buildFence = (e) => {
    const post = 0.16;
    const wire = tint(e.color, -0.1);
    const parts = [
      cyl(post, post, e.h, 8, -e.w / 2, e.h / 2, 0, e.color),
      cyl(post, post, e.h, 8, e.w / 2, e.h / 2, 0, e.color),
      box(e.w, 0.12, 0.12, 0, e.h - 0.1, 0, e.color),
    ];
    const gate = e.style === 'gate';
    if (gate) {
      parts.push(box(e.w - 0.4, 0.12, 0.12, 0, 0.3, 0, e.color));
      parts.push(box(0.12, e.h - 0.5, 0.12, 0, (e.h - 0.5) / 2 + 0.3, 0, e.color));
    }
    // The fabric, as a lattice. Coarser than real chain-link on purpose:
    // one instanced mesh per fence panel, and a real diamond weave would be
    // thousands of triangles nobody can resolve past twenty feet.
    const bays = Math.max(3, Math.round(e.w / 1.5));
    for (let i = 1; i < bays; i++) {
      parts.push(box(0.05, e.h - 0.3, 0.05, -e.w / 2 + (e.w / bays) * i, (e.h - 0.3) / 2, 0, wire));
    }
    for (let i = 1; i < 5; i++) {
      parts.push(box(e.w, 0.05, 0.05, 0, (e.h / 5) * i, 0, wire));
    }
    return mergeGeometries(parts);
  };

  const buildShelter = (e) => {
    const glass = '#9fb6c4';
    const frame = e.color;
    const parts = [
      boxT(e.w + 1, 0.2, e.d + 1, 0, e.h, -0.2, tint(frame, 0.1), -0.09, 0, 0),
      box(e.w, 0.25, e.d, 0, 0.12, 0, '#8f8f8a'),
    ];
    for (const sx of [-1, 1]) {
      parts.push(box(0.3, e.h, 0.3, sx * e.w / 2, e.h / 2, e.d / 2, frame));
      parts.push(box(0.3, e.h, 0.3, sx * e.w / 2, e.h / 2, -e.d / 2, frame));
      parts.push(box(0.12, e.h - 1, e.d - 0.6, sx * e.w / 2, (e.h - 1) / 2 + 0.4, 0, glass));
    }
    parts.push(box(e.w - 0.6, e.h - 1, 0.12, 0, (e.h - 1) / 2 + 0.4, -e.d / 2, glass));
    // A bench along the back, because a shelter without one is a carport.
    parts.push(box(e.w - 1.5, 0.2, 1.2, 0, 1.5, -e.d / 2 + 0.9, '#7a6248'));
    for (const sx of [-1, 1]) {
      parts.push(box(0.2, 1.4, 0.2, sx * (e.w / 2 - 1.2), 0.7, -e.d / 2 + 0.9, frame));
    }
    return mergeGeometries(parts);
  };

  const buildPergola = (e) => {
    const post = 0.7;
    const wood = e.color;
    const parts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(box(post, e.h, post, sx * (e.w / 2 - post / 2), e.h / 2, sz * (e.d / 2 - post / 2), tint(wood, -0.1)));
      }
      parts.push(box(post * 0.7, 0.8, e.d, sx * (e.w / 2 - post / 2), e.h - 0.4, 0, wood));
    }
    // The slats. Six inches on, eighteen off, which is the ratio that throws
    // a striped shadow rather than a solid one.
    const slats = Math.max(4, Math.round(e.w / 2));
    for (let i = 0; i <= slats; i++) {
      parts.push(box(0.35, 0.55, e.d + 1, -e.w / 2 + (e.w / slats) * i, e.h + 0.15, 0, tint(wood, 0.06)));
    }
    return mergeGeometries(parts);
  };

  const buildSandbox = (e) => {
    const wood = e.color;
    const rail = 0.6;
    return mergeGeometries([
      box(e.w - rail * 2, e.h * 0.5, e.d - rail * 2, 0, e.h * 0.25, 0, '#c4b287'),
      box(e.w, e.h, rail, 0, e.h / 2, (e.d - rail) / 2, wood),
      box(e.w, e.h, rail, 0, e.h / 2, -(e.d - rail) / 2, wood),
      box(rail, e.h, e.d - rail * 2, (e.w - rail) / 2, e.h / 2, 0, wood),
      box(rail, e.h, e.d - rail * 2, -(e.w - rail) / 2, e.h / 2, 0, wood),
    ]);
  };

  // A play structure: two decks at different heights, a roof over one, a
  // ladder up and a slide down. Deliberately generic — it is the thing in the
  // middle of a playground, and the playground is what you are looking at.
  const buildClimber = (e) => {
    const post = 0.35;
    const frame = e.color;
    const deck = '#c9563f';
    const parts = [];
    const dx = e.w * 0.28, dz = e.d * 0.28;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(cyl(post / 2, post / 2, e.h, 8, sx * dx, e.h / 2, sz * dz, frame));
      }
    }
    parts.push(box(dx * 2 + post, 0.3, dz * 2 + post, 0, e.h * 0.45, 0, deck));
    parts.push(box(dx * 2 + post, 0.25, dz * 2 + post, 0, e.h * 0.92, 0, tint(frame, 0.1)));
    // Guard panels round the deck, on three sides.
    for (const sx of [-1, 1]) {
      parts.push(box(0.16, e.h * 0.28, dz * 2, sx * dx, e.h * 0.6, 0, tint(deck, 0.08)));
    }
    parts.push(box(dx * 2, e.h * 0.28, 0.16, 0, e.h * 0.6, -dz, tint(deck, 0.08)));
    // The ladder up one side.
    for (let i = 0; i < 4; i++) {
      parts.push(cylT(0.08, 0.08, dx * 1.6, 6, 0, e.h * (0.12 + i * 0.1), dz + 1.2, '#dcdcda', 0, Math.PI / 2));
    }
    for (const sx of [-1, 1]) {
      parts.push(cylT(0.1, 0.1, e.h * 0.55, 6, sx * dx * 0.8, e.h * 0.25, dz + 1.2, '#dcdcda', 0.35, 0));
    }
    // The slide off the other.
    parts.push(boxT(2.4, 0.2, e.h * 0.8, 0, e.h * 0.24, -dz - e.d * 0.24, '#d8b13f', -0.62, 0, 0));
    for (const sx of [-1, 1]) {
      parts.push(boxT(0.18, 0.6, e.h * 0.8, sx * 1.2, e.h * 0.35, -dz - e.d * 0.24, tint('#d8b13f', -0.12), -0.62, 0, 0));
    }
    return mergeGeometries(parts);
  };

  const buildTetherball = (e) => {
    return mergeGeometries([
      cyl(0.9, 1.1, 0.3, 12, 0, 0.15, 0, '#9d9c96'),
      cyl(0.14, 0.18, e.h - 0.3, 10, 0, (e.h - 0.3) / 2 + 0.3, 0, e.color),
      cyl(0.03, 0.03, e.h * 0.42, 5, 0.35, e.h * 0.72, 0, '#e0dcd2'),
      sph(0.42, 0.5, e.h * 0.5, 0, '#c94f3f', 10),
    ]);
  };

  const buildBollard = (e) => {
    return mergeGeometries([
      cyl(e.w * 0.34, e.w * 0.42, e.h - 0.3, 12, 0, (e.h - 0.3) / 2, 0, e.color),
      cyl(e.w * 0.36, e.w * 0.36, 0.3, 12, 0, e.h - 0.15, 0, tint(e.color, -0.2)),
      cyl(e.w * 0.38, e.w * 0.38, 0.25, 12, 0, e.h * 0.62, 0, '#f2f0ec'),
    ]);
  };

  // ---------- light fixtures ----------
  //
  // The builder contract gains one clause in Phase 3, and only for these:
  // a builder may return `{ body, lens }` instead of a bare geometry. `body`
  // is ordinary vertex-coloured furniture on the shared prop material; `lens`
  // is the part that glows, and gets its own emissive material keyed on the
  // lamp colour (see `lampMaterial`). Everything else about the contract is
  // untouched — both halves are merged, bottom at y=0, facing +Z, sized off
  // the row — so instancing, snapping and blueprint footprints never learn
  // that a light is different from a bookshelf.
  //
  // `lit()` is the whole of the new plumbing.
  const lit = (bodyParts, lensParts) => ({
    body: mergeGeometries(bodyParts),
    lens: mergeGeometries(lensParts),
  });

  // The colour the glowing half is drawn in. It comes off the row's own `emit`
  // block, so the catalog says once what a fixture's light looks like and both
  // the lens and the point light read the same number.
  const lensColor = (e) => (emitOf(e) || { color: '#fff2d8' }).color;

  // Recessed ceiling fixtures: the 2x4 and 2x2 troffers, the utility strip and
  // the track head rail. One builder, four rows — the housing is a frame and
  // the lens is what sits inside it, and only the proportions change.
  //   style 'strip'  a bare channel: no frame, a narrow lens tube
  //   style 'track'  a rail with `heads` swivelled cans hanging off it
  const buildTroffer = (e) => {
    const glow = lensColor(e);
    const shell = tint(e.color, -0.12);
    if (e.style === 'track') {
      const heads = Math.max(2, Math.round(e.heads || 4));
      const rail = 0.22;
      const body = [box(e.w, rail, e.d, 0, e.h - rail / 2, 0, tint(e.color, 0.05))];
      const lens = [];
      for (let i = 0; i < heads; i++) {
        const x = -e.w / 2 + (e.w * (i + 0.5)) / heads;
        body.push(cyl(0.05, 0.05, 0.3, 6, x, e.h - rail - 0.15, 0, shell));
        body.push(cylT(0.26, 0.34, 0.55, 12, x, e.h - rail - 0.6, 0, shell, Math.PI, 0));
        lens.push(cyl(0.24, 0.24, 0.05, 12, x, e.h - rail - 0.88, 0, glow));
      }
      return lit(body, lens);
    }
    if (e.style === 'strip') {
      return lit(
        [box(e.w, e.h * 0.5, e.d, 0, e.h * 0.75, 0, shell)],
        [cylT(e.d * 0.42, e.d * 0.42, e.w * 0.95, 10, 0, e.h * 0.34, 0, glow, 0, Math.PI / 2)],
      );
    }
    // A troffer is a shallow pan with a frame around a diffuser. Drawing the
    // frame as four rails rather than a box with a hole in it keeps the whole
    // thing four boxes and one plane.
    const fr = 0.12, pan = e.h * 0.55;
    const body = [
      box(e.w, pan, e.d, 0, e.h - pan / 2, 0, shell),
      box(e.w, e.h - pan, fr, 0, (e.h - pan) / 2, e.d / 2 - fr / 2, e.color),
      box(e.w, e.h - pan, fr, 0, (e.h - pan) / 2, -e.d / 2 + fr / 2, e.color),
      box(fr, e.h - pan, e.d - fr * 2, e.w / 2 - fr / 2, (e.h - pan) / 2, 0, e.color),
      box(fr, e.h - pan, e.d - fr * 2, -e.w / 2 + fr / 2, (e.h - pan) / 2, 0, e.color),
    ];
    return lit(body, [box(e.w - fr * 2, 0.06, e.d - fr * 2, 0, e.h - pan - 0.03, 0, glow)]);
  };

  // Hanging fixtures: the corridor pendant and the gym high bay. Both are a
  // stem, a reflector and a lamp under it; the high bay is just a much wider,
  // much shallower reflector with a proper aluminium cone.
  const buildPendant = (e) => {
    const glow = lensColor(e);
    const metal = tint(e.color, -0.25);
    const r = Math.min(e.w, e.d) / 2;
    if (e.style === 'highbay') {
      const stem = e.h * 0.28;
      return lit(
        [
          cyl(0.07, 0.07, stem, 8, 0, e.h - stem / 2, 0, metal),
          cylT(r, r * 0.4, e.h - stem, 20, 0, (e.h - stem) / 2, 0, metal, Math.PI, 0),
          ring(r * 0.98, 0.05, 0, 0.05, 0, tint(e.color, -0.35)),
        ],
        [cyl(r * 0.78, r * 0.86, 0.14, 20, 0, 0.12, 0, glow)],
      );
    }
    const drop = e.h * 0.5;
    return lit(
      [
        cyl(0.045, 0.045, drop, 6, 0, e.h - drop / 2, 0, metal),
        cyl(0.16, 0.16, 0.1, 8, 0, e.h - 0.05, 0, metal),
        lathe([[0, e.h - drop], [r * 0.5, e.h - drop - 0.12], [r, e.h - drop - 0.7], [r, e.h - drop - 0.8]],
          0, 0, 0, tint(e.color, 0.08), 20),
      ],
      [sph(r * 0.42, 0, e.h - drop - 0.72, 0, glow, 12)],
    );
  };

  // Wall-mounted: the interior sconce (a half-shade throwing light up the
  // wall) and the exterior wall pack (a hooded box aimed down at the ground).
  // Both hang off a backplate on the wall face, which is -d/2 in the prop's
  // own frame — the same convention every other wall mount here uses.
  const buildSconce = (e) => {
    const glow = lensColor(e);
    const shell = tint(e.color, -0.1);
    if (e.style === 'pack') {
      return lit(
        [
          box(e.w * 0.8, e.h * 0.9, 0.12, 0, e.h / 2, -e.d / 2 + 0.06, tint(e.color, -0.2)),
          box(e.w, e.h * 0.55, e.d * 0.9, 0, e.h * 0.62, 0, shell),
          boxT(e.w * 1.05, 0.1, e.d * 0.5, 0, e.h * 0.92, e.d * 0.2, tint(e.color, -0.3), -0.35, 0, 0),
        ],
        [boxT(e.w * 0.82, 0.08, e.d * 0.62, 0, e.h * 0.36, e.d * 0.06, glow, 0.35, 0, 0)],
      );
    }
    return lit(
      [
        box(e.w * 0.55, e.h * 0.75, 0.1, 0, e.h / 2, -e.d / 2 + 0.05, tint(e.color, -0.25)),
        cylT(e.w * 0.5, e.w * 0.32, e.h * 0.7, 14, 0, e.h * 0.55, e.d * 0.1, shell, 0.22, 0),
      ],
      [sph(e.w * 0.24, 0, e.h * 0.45, e.d * 0.06, glow, 10)],
    );
  };

  // Site lighting: the parking-lot pole with its shoebox head on an arm, and
  // the path bollard. Both stand on the ground, so `h` is the real mounting
  // height — 22ft for a lot light, which is what they actually are.
  const buildPolelight = (e) => {
    const glow = lensColor(e);
    const metal = tint(e.color, -0.15);
    if (e.style === 'bollard') {
      return lit(
        [
          cyl(0.34, 0.42, 0.18, 12, 0, 0.09, 0, tint(e.color, -0.3)),
          cyl(0.28, 0.32, e.h - 0.6, 12, 0, (e.h - 0.6) / 2 + 0.18, 0, metal),
          cyl(0.34, 0.3, 0.16, 12, 0, e.h - 0.08, 0, tint(e.color, 0.1)),
        ],
        [cyl(0.3, 0.3, 0.28, 12, 0, e.h - 0.34, 0, glow)],
      );
    }
    const arm = e.w * 0.8;
    return lit(
      [
        cyl(0.5, 0.6, 0.5, 10, 0, 0.25, 0, tint(e.color, -0.35)),
        cyl(0.22, 0.3, e.h - 0.5, 10, 0, (e.h - 0.5) / 2 + 0.5, 0, metal),
        box(arm, 0.2, 0.2, arm / 2, e.h - 0.1, 0, metal),
        box(1.9, 0.45, 1.3, arm, e.h - 0.42, 0, tint(e.color, 0.08)),
      ],
      [box(1.6, 0.08, 1.05, arm, e.h - 0.66, 0, glow)],
    );
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
    garland: buildGarland, wreath: buildWreath, gourd: buildGourd,
    picnic: buildPicnic, bikerack: buildBikerack, flagpole: buildFlagpole,
    slide: buildSlide, swing: buildSwing, dumpster: buildDumpster,
    polesign: buildPolesign,
    goal: buildGoal, backstop: buildBackstop, fence: buildFence,
    shelter: buildShelter, pergola: buildPergola, sandbox: buildSandbox,
    climber: buildClimber, tetherball: buildTetherball, bollard: buildBollard,
    tree: buildTree, hedge: buildHedge, shrub: buildShrub,
    planter: buildPlanter, boulder: buildBoulder,
    troffer: buildTroffer, pendant: buildPendant, sconce: buildSconce,
    polelight: buildPolelight,
    gongbell: buildGongbell, diffuser: buildDiffuser,
  };

  // ---------- Phase 9: geometry that came from a file ----------
  //
  // A catalog row with `geo: 'model'` has no builder above; it names a row of
  // the design's model library instead, and the geometry comes out of a glTF
  // file. Everything after this point treats it like any other prop geometry
  // — one merged, vertex-coloured BufferGeometry, bottom at y=0, sized from
  // the catalog row — which is the whole reason instancing, collision,
  // blueprints and the bill of materials needed no changes for imports.
  //
  // The parse happens once per model per design, here, rather than per
  // instance: a hundred imported chairs are one file read and one draw call,
  // exactly like a hundred procedural ones.
  const modelGeoCache = new Map(); // model id -> BufferGeometry | null

  function mergeModelParts(model) {
    // gltf.js hands back one part per primitive, each indexed from zero;
    // they are concatenated into the single geometry an InstancedMesh wants.
    let verts = 0, indices = 0;
    for (const part of model.meshes) {
      verts += part.position.length / 3;
      indices += part.index.length;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const color = new Float32Array(verts * 3);
    const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let vAt = 0, iAt = 0;
    for (const part of model.meshes) {
      position.set(part.position, vAt * 3);
      normal.set(part.normal, vAt * 3);
      color.set(part.color, vAt * 3);
      for (let i = 0; i < part.index.length; i++) index[iAt + i] = part.index[i] + vAt;
      vAt += part.position.length / 3;
      iAt += part.index.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  // The design's whole library, (re)built. Called on load, on import, on
  // delete and on undo — the same lifetime catalog.js's row registry has, for
  // the same reason. Returns what failed, so the panel can say which file
  // rather than going quietly blank.
  function setModels(list) {
    const models = list || [];
    const keep = new Set(models.map((m) => m.id));
    for (const [id, geo] of modelGeoCache) {
      if (!keep.has(id)) {
        if (geo) geo.dispose();
        modelGeoCache.delete(id);
        propGeoCache.delete(`model:${id}`);
      }
    }
    const failed = [];
    for (const model of models) {
      // A model already parsed under the same id and box is left alone; a
      // resized one is rebuilt, because the fit is baked into the vertices.
      const key = `${model.w}x${model.d}x${model.h}:${model.fit}:${model.data.length}`;
      const cached = modelGeoCache.get(model.id);
      if (cached && cached.userData.key === key) continue;
      if (cached) cached.dispose();
      propGeoCache.delete(`model:${model.id}`);
      try {
        const bytes = modelBytes(model);
        if (!bytes) throw new Error('the file could not be read back');
        const geo = mergeModelParts(loadModel(bytes, model, { mode: model.fit }));
        geo.userData.key = key;
        modelGeoCache.set(model.id, geo);
      } catch (err) {
        modelGeoCache.delete(model.id);
        failed.push({ id: model.id, name: model.name, message: err.message || String(err) });
      }
    }
    return failed;
  }

  // A stand-in for an import that failed or has been deleted: a wireframe-ish
  // box at the row's own size, so a prop whose model is missing is visibly
  // *there* rather than invisibly gone. Losing a chair silently is how you
  // lose a room's furniture without noticing.
  function missingModelGeo(entry) {
    const g = new THREE.BoxGeometry(entry.w, entry.h, entry.d);
    g.translate(0, entry.h / 2, 0);
    return coloredGeo(g, propColor(entry));
  }

  // Cached per catalog type (not rebuilt on every edit like the structural
  // meshes) — a prop's geometry never changes shape, only its transform does.
  //
  // Normalized to `{ body, lens }` here rather than at every call site: most
  // builders hand back one geometry and get `lens: null`, the light fixtures
  // hand back both, and `buildPropsGroup` below only has to know that a lens
  // may or may not be there.
  //
  // Phase 11 adds the second half of the key. A prop carrying `data.color`
  // wants the same shape in a different paint, and since the paint is baked
  // into the vertices there is nothing to do but build it twice — so the key
  // is the type *and* the variant, and the builder is handed a copy of the row
  // wearing the new colour. Every builder derives its own shading from
  // `e.color` through `tint()`, which is why a one-field copy is enough to
  // recolour a chair's legs and its seat together rather than leaving a red
  // chair on brown legs.
  //
  // `variantKey` returns '' for the overwhelmingly common case — a prop
  // wearing its row's own colour — and the key is then the bare type, so the
  // cache a design without a single variant in it builds is byte-for-byte the
  // one it built before this phase, and `setModels` below can still delete an
  // imported row's geometry by its type alone.
  const propGeoCache = new Map();
  function getPropGeometry(entry, variant = '') {
    // An imported model's colours came out of its file; there are no builder
    // parameters to re-run and nothing to re-tint, so a variant is dropped
    // here rather than quietly caching a second identical copy of it.
    const key = variant && entry.geo !== 'model' ? `${entry.type}|${variant}` : entry.type;
    let geo = propGeoCache.get(key);
    if (geo) return geo;
    if (entry.geo === 'model') {
      const fromFile = modelGeoCache.get(entry.model);
      geo = { body: fromFile || missingModelGeo(entry), lens: null };
      propGeoCache.set(key, geo);
      return geo;
    }
    const build = PROP_GEO_BUILDERS[entry.geo] || buildDesk;
    const built = build(variant ? { ...entry, color: variant } : entry);
    geo = built && built.body ? { body: built.body, lens: built.lens || null } : { body: built, lens: null };
    propGeoCache.set(key, geo);
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
  // ---------- door leaves ----------
  //
  // The one part of the building that isn't merged into a per-storey mesh,
  // because it is the one part that moves. Each leaf gets its own Group,
  // pivoted at its hinge with the panel built along local +X, so posing a door
  // is setting one rotation — no geometry is rebuilt when a door swings.
  //
  // Leaf geometry is shared by (length, height, lite, bar), so a corridor of
  // identical doors builds one BufferGeometry and hangs it forty times. That's
  // forty draw calls rather than one, which is the price of an independently
  // rotating object; at school scale it is well inside the noise next to the
  // instanced prop layer.
  const leafGeoCache = new Map();

  function leafGeometry(leaf) {
    const key = `${leaf.len.toFixed(2)}|${leaf.h.toFixed(2)}|${leaf.lite ? 1 : 0}|${leaf.bar ? 1 : 0}`;
    let geo = leafGeoCache.get(key);
    if (geo) return geo;
    const L = Math.max(0.4, leaf.len), H = Math.max(1, leaf.h);
    const wood = _doorTint, edge = tint('#c98f5f', -0.12), metal = new THREE.Color('#9aa3ad');
    const parts = [
      box(L, H, LEAF_T, L / 2, H / 2, 0, wood),
      // A stile down the hinge side and one down the lock side: without them a
      // leaf is a flat rectangle and reads as a poster rather than a door.
      box(0.09, H, LEAF_T + 0.02, 0.05, H / 2, 0, edge),
      box(0.09, H, LEAF_T + 0.02, L - 0.05, H / 2, 0, edge),
      // Lever handle, on the swinging edge at the height one actually sits.
      box(0.5, 0.1, 0.1, L - 0.35, 3.1, LEAF_T / 2 + 0.05, metal),
      box(0.5, 0.1, 0.1, L - 0.35, 3.1, -LEAF_T / 2 - 0.05, metal),
    ];
    if (leaf.lite) {
      // Vision lite: a narrow tall pane, the school-corridor kind. Baked as a
      // pale panel rather than real glass — it swings with the leaf, and a
      // transparent mesh per door would want sorting nobody is doing here.
      parts.push(box(L * 0.42, H * 0.42, LEAF_T + 0.04, L / 2, H * 0.63, 0,
        new THREE.Color('#b8ccd4')));
    }
    if (leaf.bar) {
      parts.push(box(L * 0.82, 0.16, 0.16, L / 2, 3.0, LEAF_T / 2 + 0.12, metal));
      for (const sx of [-1, 1]) {
        parts.push(box(0.12, 0.12, 0.28, L / 2 + sx * L * 0.36, 3.0, LEAF_T / 2 + 0.05, metal));
      }
    }
    geo = mergeGeometries(parts);
    leafGeoCache.set(key, geo);
    return geo;
  }

  // The live pivots, keyed the way openings.js keys its leaves — which is the
  // whole contract between this file and collide.js: neither describes a door
  // to the other, they just agree on the key.
  const doorPivots = new Map();

  function buildDoorGroup(leaves, baseY, group) {
    const doors = new THREE.Group();
    for (const leaf of leaves) {
      const mesh = new THREE.Mesh(leafGeometry(leaf), propMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(leaf.hx, baseY, leaf.hz);
      pivot.rotation.y = -leafAngle(leaf, leaf.open || 0);
      pivot.add(mesh);
      doors.add(pivot);
      doorPivots.set(leaf.key, pivot);
    }
    group.add(doors);
    group.userData.doorGroup = doors;
    return doors;
  }

  function buildFloor(floor, baseY, wallH, group, ceil, labels, ctx = {}) {
    // Floor geometry is bucketed by finish rather than pooled: one mesh per
    // material present on the storey. Everything else still merges into one
    // mesh apiece, exactly as before.
    const floorGeosBy = new Map();
    const ceilGeos = [], wallGeos = [], fixtureGeos = [];
    const glassGeos = [], railGeos = [], stairGeos = [];
    const cuts = ctx.cuts || [];
    const ceilCuts = ctx.ceilCuts || [];
    const metrics = ctx.metrics || null;
    const tmpColor = new THREE.Color();

    const pushFloor = (key, geo) => {
      const k = key || DEFAULT_FINISH;
      let list = floorGeosBy.get(k);
      if (!list) { list = []; floorGeosBy.set(k, list); }
      list.push(geo);
    };

    // Thickness and paint are both *derived* from what is on either side of a
    // boundary (walls.js, finish.js). Both are probes over the storey's rooms,
    // so both are memoized for the length of one rebuild.
    const thickness = wallProbe(floor);
    const _paint = new THREE.Color();
    const paintOf = (ax, az, bx, bz) => {
      const hex = wallPaint(floor, ax, az, bx, bz);
      // An unpainted room keeps the plain white multiplier the wall texture
      // has always been drawn with, so a design from before Phase 2 renders
      // exactly as it did.
      if (hex === DEFAULT_PAINT) return _white;
      _paint.set(hex);
      return _paint;
    };

    // Phase 5's facade, and the smallest honest way to have one. An exterior
    // wall is one box with a painted classroom on one side of it and weather
    // on the other, so it cannot have two materials — but it can have two
    // *colours*, because BoxGeometry lays its faces out in a fixed order and
    // the two long ones are the last eight vertices. `addOriented` builds
    // every wall along +X and turns it, which sends local +Z to the run's
    // left-hand normal — the same normal walls.js probes with `side: +1`. So
    // "which face is outside" is a question the model already answers, and
    // painting that face brick while the other stays off-white costs one
    // colour write per wall rather than a second mesh and a second texture.
    const _facade = new THREE.Color(facadeEntry(ctx.facade).color);
    const outwardFace = (ax, az, bx, bz) => {
      if (!thickness.exterior(ax, az, bx, bz)) return 0;
      // +1 if the left side is the outside, -1 if the right is, 0 if both are
      // (a free-standing garden wall, which gets facade on both faces).
      const left = solidBeside(floor, ax, az, bx, bz, 1);
      const right = solidBeside(floor, ax, az, bx, bz, -1);
      if (left === right) return 2;
      return left ? -1 : 1;
    };

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
          // The cell's `color` is still the room's label tint, multiplied over
          // whatever the finish's own texture is — the two say different things
          // and both survive.
          tmpColor.set(cell.color || _white);
          coloredGeo(f, tmpColor);
          pushFloor(cell.fin, f);
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

    const GLASS_BAY = 5;       // ft between mullions in a full-height curtain wall
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
    const addOriented = (len, h, d, x, y, z, angle, color, target = wallGeos, face = 0) => {
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
      // ...and pz is 16-19, nz is 20-23. See `outwardFace`.
      if (face) paintFace(g, face, _facade);
      target.push(g);
    };

    // Recolour one long face of a wall box. `face` is +1 for the +Z side
    // (the run's left-hand normal), -1 for the -Z side, 2 for both.
    const paintFace = (g, face, color) => {
      const col = g.attributes.color;
      if (!col) return;
      const range = face === 1 ? [16, 20] : face === -1 ? [20, 24] : [16, 24];
      for (let i = range[0]; i < range[1] && i < col.count; i++) {
        col.setXYZ(i, color.r, color.g, color.b);
      }
      col.needsUpdate = true;
    };

    // Glazing: sill, head, mullions every few feet, and one pane per bay. The
    // frame is ordinary wall geometry; only the pane goes in the transparent
    // pile, so glass costs one extra draw call per storey and no sorting
    // headaches for anything else.
    const glazedRun = (p0, p1, len, angle, h, y0 = baseY, t = WALL_T) => {
      const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
      addOriented(len, GLASS_SILL, t, cx, y0 + GLASS_SILL / 2, cz, angle, _glassFrame);
      addOriented(len, GLASS_HEAD, t, cx, y0 + h - GLASS_HEAD / 2, cz, angle, _glassFrame);
      const paneH = h - GLASS_SILL - GLASS_HEAD;
      if (paneH <= 0.2) return;
      const ux = (p1.x - p0.x) / len, uz = (p1.z - p0.z) / len;
      const bays = Math.max(1, Math.round(len / GLASS_BAY));
      for (let i = 1; i < bays; i++) {
        const at = (i / bays) * len;
        addOriented(0.25, paneH, t, p0.x + ux * at, y0 + GLASS_SILL + paneH / 2, p0.z + uz * at,
          angle, _glassFrame);
      }
      const pane = new THREE.BoxGeometry(len, paneH, t * 0.35);
      pane.rotateY(-angle);
      pane.translate(cx, y0 + GLASS_SILL + paneH / 2, cz);
      glassGeos.push(pane);
    };

    // A window: the band of glazing that sits in the middle of a wall, with
    // the wall itself carrying on above and below it. Same construction as the
    // curtain wall above — frame, mullions, one pane — at a tighter spacing,
    // because a punched window is a smaller thing than a storefront bay.
    const windowRun = (p0, p1, len, angle, band, t, color, face = 0) => {
      const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
      const ux = (p1.x - p0.x) / len, uz = (p1.z - p0.z) / len;
      // Wall under the sill and over the head — this is the line that makes a
      // window a window rather than a hole you can step out of.
      // Spandrel and lintel are the same wall as the piers either side of the
      // window, so they are clad the same way — otherwise a brick school comes
      // out with a plaster band running under every classroom window.
      if (band.sill > 0.05) {
        addOriented(len, band.sill, t, cx, baseY + band.sill / 2, cz, angle, color, wallGeos, face);
      }
      const over = wallH - band.head;
      if (over > 0.05) {
        addOriented(len, over, t, cx, baseY + band.head + over / 2, cz, angle, color, wallGeos, face);
      }
      const paneH = band.head - band.sill;
      if (paneH <= 0.15) return;
      // The frame: a sill board proud of the wall, a head, and jambs.
      addOriented(len, 0.18, t + 0.25, cx, baseY + band.sill + 0.09, cz, angle, _glassFrame);
      addOriented(len, 0.14, t + 0.06, cx, baseY + band.head - 0.07, cz, angle, _glassFrame);
      for (const at of [0.08, len - 0.08]) {
        addOriented(0.16, paneH, t + 0.04, p0.x + ux * at, baseY + band.sill + paneH / 2,
          p0.z + uz * at, angle, _glassFrame);
      }
      for (const at of mullionPositions(len, MULLION_BAY)) {
        addOriented(0.2, paneH - 0.2, t + 0.04, p0.x + ux * at,
          baseY + band.sill + paneH / 2, p0.z + uz * at, angle, _glassFrame);
      }
      const pane = new THREE.BoxGeometry(len, paneH - 0.2, t * 0.3);
      pane.rotateY(-angle);
      pane.translate(cx, baseY + band.sill + paneH / 2, cz);
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
    const fillSpan = (kind, p0, p1, angle, h, t, color, face = 0) => {
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (len < 0.02) return;
      if (kind === SEG_RAIL) railRun(p0, p1, len, angle);
      else if (kind === SEG_GLASS) glazedRun(p0, p1, len, angle, h, baseY, t);
      else {
        addOriented(len, h, t, (p0.x + p1.x) / 2, baseY + h / 2, (p0.z + p1.z) / 2,
          angle, color, wallGeos, face);
      }
    };

    // A boundary run with its openings taken out of it. `kind` picks what the
    // solid stretches are made of; each opening then fills its own stretch
    // according to what *it* is — a door leaves a hole with a header over it,
    // a window fills the stretch with wall, glass and wall again.
    //
    // Thickness and paint are per run, resolved once from the uncut segment:
    // a jamb is the same wall as the door beside it, and painting one of them
    // and not the other would be a visible seam.
    const buildSegWall = (a, b, openings, kind = SEG_WALL) => {
      const L = segLength(a, b);
      if (L < 0.01) return;
      const angle = Math.atan2(b.z - a.z, b.x - a.x);
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const h = kind === SEG_RAIL ? RAIL_H : wallH;
      const t = kind === SEG_RAIL ? WALL_T : thickness(a.x, a.z, b.x, b.z);
      const color = kind === SEG_WALL ? paintOf(a.x, a.z, b.x, b.z).clone() : _white;
      // Which face of this run, if any, faces the weather. Resolved once per
      // run for the same reason thickness and paint are: a door's jamb is the
      // same wall as the door, and cladding one and not the other is a seam.
      const face = kind === SEG_WALL ? outwardFace(a.x, a.z, b.x, b.z) : 0;
      const at = (v, pad = 0) => ({ x: a.x + ux * (v * L + pad), z: a.z + uz * (v * L + pad) });
      // Overhang the outer ends by half a wall thickness so corners close.
      const ends = (t0, t1, grow = 0) => [
        at(t0, (t0 <= 0 ? -t / 2 : 0) - grow),
        at(t1, (t1 >= 1 ? t / 2 : 0) + grow),
      ];
      const span = (t0, t1) => {
        const [p0, p1] = ends(t0, t1);
        fillSpan(kind, p0, p1, angle, h, t, color, face);
      };
      const header = (t0, t1, hh, cy, col, depth = t, grow = 0) => {
        const [p0, p1] = ends(t0, t1, grow);
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        if (len < 0.02) return;
        // A header or a sill over an opening is the same wall as the run it
        // interrupts, so it is clad the same way — but only when it is drawn
        // in the run's own colour; a door's own trim keeps its own.
        addOriented(len, hh, depth, (p0.x + p1.x) / 2, cy, (p0.z + p1.z) / 2, angle, col,
          wallGeos, col === color ? face : 0);
      };

      const cuts = openings
        .map((o) => {
          const spec = openingSpec(o);
          const half = o.w / 2 / L;
          return { t0: Math.max(0, o.t - half), t1: Math.min(1, o.t + half), spec };
        })
        .sort((p, q) => p.t0 - q.t0);

      let cursor = 0;
      for (const c of cuts) {
        if (c.t0 > cursor) span(cursor, c.t0);
        if (c.spec.window) {
          // A window is a *filled* stretch, not an empty one: glass in the
          // band, wall above and below. Nothing about the run's own kind
          // changes — a window in a glazed partition is still glass either
          // side of it, which is why the sill/head pieces take `color`.
          const [p0, p1] = ends(c.t0, c.t1);
          const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
          if (len > 0.05 && kind !== SEG_RAIL) {
            windowRun(p0, p1, len, angle, windowBand(c.spec), t, color, face);
          }
        } else {
          // A gap in a railing is just a gap — there is nothing to hang a
          // header from, which is exactly what makes it the top of a stair.
          const headH = h - c.spec.h;
          if (kind !== SEG_RAIL && headH > 0.05) {
            header(c.t0, c.t1, headH, baseY + c.spec.h + headH / 2, _doorTint);
            // door frame trim, a touch proud of the wall for readability
            header(c.t0, c.t1, 0.25, baseY + c.spec.h + 0.125, _doorTint, t + 0.2, 0.25);
          }
        }
        cursor = Math.max(cursor, c.t1);
      }
      if (cursor < 1) span(cursor, 1);
    };

    // A lattice edge, expressed as a one-cell segment handed to the same span
    // builder a polygon wall uses. The opening is the one case the grid still
    // says its own way: an edge is a whole cell wide, so anything cut into one
    // is fixed at its middle rather than placed along it (see
    // `gridOpeningWidth`).
    const buildEdge = (val, cx, cz, horizontal) => {
      const L = CELL;
      const half = L / 2;
      const a = horizontal ? { x: cx - half, z: cz } : { x: cx, z: cz - half };
      const b = horizontal ? { x: cx + half, z: cz } : { x: cx, z: cz + half };
      if (val === EDGE_RAIL) {
        railRun(a, b, L, horizontal ? 0 : Math.PI / 2);
        return;
      }
      const kind = val === EDGE_GLASS ? SEG_GLASS : SEG_WALL;
      const w = gridOpeningWidth(val);
      const openings = [];
      if (val === EDGE_WINDOW) {
        const spec = gridWindowSpec();
        openings.push({ seg: 0, t: 0.5, w, k: 1, sill: spec.sill, h: spec.h });
      } else if (isDoorEdge(val)) {
        openings.push({ seg: 0, t: 0.5, w });
      }
      buildSegWall(a, b, openings, kind);
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
      const m = runMetrics(link, metrics);
      if (m.run <= 0) return;
      if (link.type === 'ramp') {
        // A ramp is the same run without the risers, which is the whole of
        // what the model says about one — so it is the same solid mass with a
        // sloped top instead of a staircase of them. Built as a box sheared by
        // its own pitch, plus a curb either side so the edge reads at a
        // distance the way a nosing does on a stair.
        const slope = Math.hypot(m.run, m.rise);
        const deck = new THREE.BoxGeometry(w, 0.5, slope);
        deck.translate(0, -0.25, 0);
        deck.rotateX(-m.pitch);
        deck.translate(0, m.rise / 2, m.run / 2);
        deck.rotateY(link.rotationY || 0);
        deck.translate(link.x, baseY, link.z);
        coloredGeo(deck, _tread);
        stairGeos.push(deck);
        for (const sx of [-1, 1]) {
          const curb = new THREE.BoxGeometry(0.28, 0.4, slope);
          curb.rotateX(-m.pitch);
          curb.translate(sx * (w / 2 - 0.14), m.rise / 2 + 0.2, m.run / 2);
          curb.rotateY(link.rotationY || 0);
          curb.translate(link.x, baseY, link.z);
          coloredGeo(curb, _nosing);
          stairGeos.push(curb);
        }
      } else {
        // Each step is a solid block from the slab up to its own tread, not a
        // floating board: overlapping boxes merge into one mass, so the run has
        // an underside when you walk past it on the floor below.
        for (let i = 0; i < m.steps; i++) {
          const top = (i + 1) * m.riser;
          const z0 = i * m.tread;
          localBox(link, w, top, m.tread, 0, top / 2, z0 + m.tread / 2, _tread, stairGeos);
          localBox(link, w, 0.09, 0.2, 0, top - 0.045, z0 + m.tread - 0.1, _nosing, stairGeos);
        }
      }
      // Handrails: a sloped cap either side, on posts that grow with the run.
      // Identical for both — a ramp needs them more than a stair does.
      const slope = Math.hypot(m.run, m.rise);
      const posts = Math.max(2, Math.round(m.run / POST_GAP));
      for (const sx of [-1, 1]) {
        const lx = sx * (w / 2 - 0.12);
        for (let i = 0; i <= posts; i++) {
          const t = i / posts;
          localBox(link, 0.13, RAIL_H, 0.13, lx, t * m.rise + RAIL_H / 2, t * m.run,
            _railPost, railGeos);
        }
        const g = new THREE.BoxGeometry(0.18, 0.18, slope);
        g.rotateX(-m.pitch);
        g.translate(lx, RAIL_H + m.rise / 2, m.run / 2);
        g.rotateY(link.rotationY || 0);
        g.translate(link.x, baseY, link.z);
        coloredGeo(g, _railCap);
        railGeos.push(g);
      }
    };

    // An elevator, drawn on *both* the storeys it serves — it is the one link
    // that is a room on each of them rather than a run between them. Three
    // shaft walls, a lintel over the opening, a metal frame around it and a
    // call panel beside it; the car doors are drawn parked in their pockets,
    // since a sliding door that shuts is a door you can't board.
    const buildElevator = (link) => {
      const { w, d } = elevatorSize(link);
      const doorW = elevatorDoorWidth(link);
      const hw = w / 2, hd = d / 2, t = WALL_T;
      const jambW = (w - doorW) / 2;
      const shaft = tint('#b9bdc4', 0);
      localBox(link, t, wallH, d, -hw + t / 2, wallH / 2, 0, shaft, wallGeos);
      localBox(link, t, wallH, d, hw - t / 2, wallH / 2, 0, shaft, wallGeos);
      localBox(link, w, wallH, t, 0, wallH / 2, hd - t / 2, shaft, wallGeos);
      for (const sx of [-1, 1]) {
        localBox(link, jambW, wallH, t, sx * (hw - jambW / 2), wallH / 2, -hd + t / 2,
          shaft, wallGeos);
      }
      const headH = wallH - DOOR_H;
      if (headH > 0.05) {
        localBox(link, doorW, headH, t, 0, DOOR_H + headH / 2, -hd + t / 2, shaft, wallGeos);
      }
      // Brushed frame and the two parked door panels.
      localBox(link, doorW + 0.5, 0.3, t + 0.3, 0, DOOR_H + 0.15, -hd + t / 2,
        _railPost, railGeos);
      for (const sx of [-1, 1]) {
        localBox(link, 0.3, DOOR_H, t + 0.24, sx * (doorW / 2 + 0.15), DOOR_H / 2, -hd + t / 2,
          _railPost, railGeos);
        localBox(link, doorW / 2 - 0.1, DOOR_H - 0.1, 0.12,
          sx * (doorW / 2 + jambW / 2), (DOOR_H - 0.1) / 2, -hd + t / 2 + 0.2,
          _railPost, railGeos);
      }
      // Call panel, on the jamb you can actually see from outside.
      localBox(link, 0.5, 0.9, 0.08, -(doorW / 2 + jambW / 2), 4, -hd - 0.02,
        _nosing, wallGeos);
      // Car floor and ceiling, a hair off the slab so they read as a cab.
      localBox(link, w - t * 2, 0.08, d - t * 2, 0, 0.06, 0, _tread, stairGeos);
      localBox(link, w - t * 2, 0.12, d - t * 2, 0, WALL_H - 0.4, 0, _railCap, railGeos);
    };

    for (const link of ctx.risers || []) {
      if (link.type === 'stair' || link.type === 'ramp') buildStairRun(link);
    }
    for (const link of ctx.elevators || []) buildElevator(link);
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
      pushFloor(shape.fin, slab);

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

    if (ctx.leaves && ctx.leaves.length) buildDoorGroup(ctx.leaves, baseY, group);

    for (const [key, geos] of floorGeosBy) {
      if (!geos.length) continue;
      const mats = finishMaterials(key);
      const mesh = new THREE.Mesh(mergeGeometries(geos), mats.solid);
      mesh.receiveShadow = true;
      mesh.userData.mats = mats;
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
  // Phase 11: which instance of which mesh a given prop id is, so a chair that
  // has been shoved can be re-posed without rebuilding the storey it is on.
  // Filled by `buildPropsGroup` and thrown away with the meshes it points at;
  // `restoreProps` below is what puts everything back, because a shove is a
  // fact about the walk rather than about the design.
  const propInstances = new Map();
  const shoved = new Set();
  function buildPropsGroup(state, floorIndex, baseY, group, field = null) {
    // Bucketed by type *and* colour variant since Phase 11: two instanced
    // meshes share a draw call only if they share geometry, and a recoloured
    // prop has its colour in its vertices. A design with no variants in it
    // buckets exactly as it did before — one entry per type, keyed by the bare
    // type string.
    const byType = new Map();
    for (const p of state.props) {
      if (p.floor !== floorIndex) continue;
      const entry = catalogEntry(p.type);
      if (!entry) continue; // an unknown type from a newer save — nothing to draw it with
      const variant = variantKey(entry, p);
      const key = variant ? `${p.type}|${variant}` : p.type;
      let bucket = byType.get(key);
      if (!bucket) { bucket = { entry, variant, list: [] }; byType.set(key, bucket); }
      bucket.list.push(p);
    }
    for (const { entry, variant, list } of byType.values()) {
      const geo = getPropGeometry(entry, variant);
      const emit = emitOf(entry);
      const mesh = new THREE.InstancedMesh(geo.body, propMat, list.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeo = true;
      // A fixture's glowing half rides the *same* instance matrices as its
      // housing — one loop, two meshes — so a lens can never drift away from
      // the light it belongs to, and a lit type still costs two draw calls a
      // storey rather than two per fixture.
      const lens = geo.lens && emit
        ? new THREE.InstancedMesh(geo.lens, lampMaterial(emit.color), list.length)
        : null;
      if (lens) {
        lens.castShadow = false;
        lens.receiveShadow = false;
        lens.frustumCulled = false;
        lens.userData.sharedGeo = true;
      }
      // An outdoor piece on the ground storey stands on the *ground*, and
      // since Phase 5 the ground has a height. Indoors nothing changes: the
      // pad holds the terrain at datum under the building, so a desk on the
      // ground floor is at baseY whether the site has been graded or not.
      const onSite = entry.site && floorIndex === 0 && field && !field.flat;
      list.forEach((p, idx) => {
        const lift = onSite ? groundAt(field, p.x, p.z) : 0;
        _dummy.position.set(p.x, baseY + (p.y || 0) + lift, p.z);
        _dummy.rotation.set(0, p.rotationY || 0, 0);
        const s = p.scale > 0 ? p.scale : 1;
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        mesh.setMatrixAt(idx, _dummy.matrix);
        if (lens) lens.setMatrixAt(idx, _dummy.matrix);
        // Only the rows a person can actually shove are worth remembering; a
        // building of two thousand desks shouldn't carry two thousand map
        // entries for a feature none of them take part in.
        if (entry.light !== undefined) {
          propInstances.set(p.id, {
            mesh, lens, idx,
            y: baseY + (p.y || 0) + lift, scale: s,
            x: p.x, z: p.z, rotationY: p.rotationY || 0,
          });
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      if (lens) {
        lens.instanceMatrix.needsUpdate = true;
        group.add(lens);
      }
    }
  }


  // ---------- the tracing overlay ----------
  //
  // One textured plane, sized in world feet from the overlay's own scale, sat
  // just above the storey being edited. It is drawn with `depthTest: false` and
  // a render order between the building and the tools, so it reads as tracing
  // paper laid over the plan: you can see the picture, you can see the walls
  // you have already drawn on top of it, and the tool cursors stay above both.
  //
  // The texture is cached by data URL. An overlay's image doesn't change unless
  // somebody loads a different one, and decoding a couple of megabytes of PNG
  // on every rebuild would make dragging a wall feel like opening a file.
  const OVERLAY_ORDER = 400;
  let overlayTexture = null;
  let overlaySrc = null;
  let overlayMesh = null;
  let overlayMat = null;

  function overlayPlane() {
    if (overlayMesh) return overlayMesh;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    overlayMat = new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    overlayMesh = new THREE.Mesh(geo, overlayMat);
    overlayMesh.renderOrder = OVERLAY_ORDER;
    overlayMesh.frustumCulled = false;
    overlayGroup.add(overlayMesh);
    return overlayMesh;
  }

  // Decoding is asynchronous, so the first `applyOverlay` after an image is
  // loaded has nothing to show and leaves the group hidden. The decode calls
  // `applyOverlay` again when it lands, which is what actually turns the plane
  // on — and which terminates, because by then `src === overlaySrc` and this
  // returns before doing any work.
  function setOverlayTexture(src) {
    if (src === overlaySrc) return;
    if (overlayTexture) { overlayTexture.dispose(); overlayTexture = null; }
    overlaySrc = src;
    if (!src) return;
    const image = new Image();
    image.onload = () => {
      // A load that finished after somebody swapped the picture is stale;
      // dropping it is cheaper than cancelling the decode.
      if (overlaySrc !== src) return;
      const tex = new THREE.Texture(image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      overlayTexture = tex;
      const mesh = overlayPlane();
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
      applyOverlay(built);
    };
    // Leave `overlaySrc` set to the source that failed: clearing it would make
    // the `src === overlaySrc` guard miss and restart a multi-megabyte decode
    // on every rebuild, forever, for a picture that is never going to load.
    image.onerror = () => { /* keep the guard armed; there is nothing to draw */ };
    image.src = src;
  }

  // Position the plane from the overlay record and the storey being edited.
  // Called on every rebuild and every time the overlay tool nudges it, which
  // is cheap: nothing here rebuilds geometry.
  function applyOverlay(state) {
    if (!state) { overlayGroup.visible = false; return; }
    const o = state.overlay || null;
    const edit = mode === 'edit';
    if (!o || !edit || !layers.overlay || !showsOn(o, state.currentFloor)) {
      overlayGroup.visible = false;
      // Still keep the texture — the toggle comes back on more often than the
      // picture changes.
      if (o) setOverlayTexture(o.src);
      return;
    }
    setOverlayTexture(o.src);
    const mesh = overlayPlane();
    const size = overlaySize(o);
    // `geo.rotateX(-π/2)` bakes the plane into the XZ plane, so its depth is
    // the mesh's local *Z* and not its local Y. Scaling (w, d, 1) gives a
    // picture one foot deep — see the ghost-preview note in propedit.js.
    mesh.scale.set(Math.max(0.01, size.w), 1, Math.max(0.01, size.d));
    mesh.position.set(o.x, floorBaseY(state, state.currentFloor) + 0.06, o.z);
    // The plane's local +Y points up after the geometry rotation, so the
    // image's own rotation about the world's vertical axis is a negative
    // rotation.y — the same sign flip every top-down plane in this file makes.
    mesh.rotation.set(0, -o.rot, 0);
    mesh.material.opacity = o.opacity;
    overlayGroup.visible = !!overlayTexture;
  }

  // ---------- the structural shadow ----------
  //
  // While editing an upper storey, the footprint of the storey below is drawn
  // as a soft field with the cells you have built *outside* it picked out in
  // amber. That is the whole visual half of the rule: the pale area is what
  // you can build on, and the amber is what you built anyway.
  //
  // Deliberately quiet. An overhang is a design decision, not an error, so it
  // gets a tint and a line in the status bar rather than a red outline and a
  // dialog — the same register Phase 7's report uses for a note.
  const SHADOW_COLOR = 0x4da3ff;
  const OVERHANG_COLOR = 0xf0a44a;

  function buildShadow(state) {
    disposeGroup(shadowGroup);
    const cur = state ? state.currentFloor : 0;
    if (!state || mode !== 'edit' || !layers.shadow || cur <= 0) {
      shadowGroup.visible = false;
      return;
    }
    const below = state.floors[cur - 1];
    const here = state.floors[cur];
    const bounds = unionBounds(floorBounds(here), floorBounds(below));
    if (!bounds) { shadowGroup.visible = false; return; }
    const support = footprintMask(below, bounds);
    const mine = footprintMask(here, bounds);
    const y = floorBaseY(state, cur) + 0.03;

    // Two instanced meshes, one per tint: a storey is at most a few thousand
    // cells and this rebuilds on every structural edit, so it has to be one
    // draw call each rather than a mesh per cell.
    const cells = { support: [], overhang: [] };
    for (let cy = bounds.y0; cy <= bounds.y1; cy++) {
      for (let cx = bounds.x0; cx <= bounds.x1; cx++) {
        const under = support.at(cx, cy);
        const over = mine.at(cx, cy);
        if (over && !under) cells.overhang.push([cx, cy]);
        else if (under && !over) cells.support.push([cx, cy]);
      }
    }
    const geo = new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94);
    geo.rotateX(-Math.PI / 2);
    for (const [key, color, opacity, order] of [
      ['support', SHADOW_COLOR, 0.16, 380],
      ['overhang', OVERHANG_COLOR, 0.45, 382],
    ]) {
      const list = cells[key];
      if (!list.length) continue;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      list.forEach(([cx, cy], i) => {
        _dummy.position.set((cx + 0.5) * CELL, y, (cy + 0.5) * CELL);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      shadowGroup.add(mesh);
    }
    shadowGroup.visible = shadowGroup.children.length > 0;
  }

  // Which storeys are drawn, and how. Editing is one floor at a time: the
  // level below shows through as a ghost for alignment, everything else is
  // out of the way. Walkthrough shows the whole building.
  function applyFloorVisibility() {
    if (!built) return;
    const edit = mode === 'edit';
    // You cannot draw a plan through a roof, so the roof is off while editing
    // — the same call the ceilings made in Phase 1 and for the same reason.
    roofGroup.visible = !edit;
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
      // Door leaves are part of the structure but can't take the ghost
      // material (they're their own meshes, on a shared prop material), so a
      // ghosted storey simply doesn't draw them — a solid door floating over
      // the plan you're editing reads as a mistake.
      if (g.userData.doorGroup) {
        g.userData.doorGroup.visible = structureOn && !ghost;
      }
    }
    for (const g of labelGroup.children) {
      g.visible = !edit || g.userData.floor === cur;
    }
    labelledFloor = -1;   // let walk mode recompute from the camera
    if (gridHelper) gridHelper.position.y = floorBaseY(built, cur) + 0.04;
    // Phase 8's underlays follow the storey being edited, so switching floors
    // moves the tracing paper up with you and redraws the shadow you are now
    // standing on.
    applyOverlay(built);
    buildShadow(built);
  }

  // ---------- the site ----------
  //
  // A site surface is a polygon laid on ground that is not flat, which is the
  // one thing a polygon is bad at. Rather than clip the region against the
  // terrain lattice — which is real work and produces slivers — the region is
  // triangulated once and then *subdivided* until no edge is longer than a
  // few feet, and every vertex is dropped onto the ground. The result follows
  // a slope as closely as the eye can tell at any scale a site is ever seen
  // from, and it is fifteen lines rather than a clipper.
  const DRAPE_EDGE = 12;        // ft — longest edge left undivided
  // ...except along the building line, where a coarse triangle would push a
  // wedge of lawn under the corridor floor. A triangle whose corners disagree
  // about whether they are over a slab keeps splitting down to this, and then
  // the ones that *are* over the slab are dropped. Two feet is half a grid
  // cell: fine enough that the edge reads as the wall it follows.
  const DRAPE_FINE = 2;         // ft
  const DRAPE_MAX_TRIS = 8000;  // per region, a rail rather than a target
  // How far a paved surface stands above the earth around it. Four inches,
  // which is what a course of asphalt on its base actually is — and, not by
  // coincidence, comfortably more than the terrain mesh can be wrong by.
  const SURFACE_LIFT = 0.35;    // ft above the ground
  // Regions stack: a lawn is drawn first and the car park goes on top of it,
  // which is how anybody would draw a site and which leaves two surfaces at
  // exactly the same height. Coplanar is the one thing a depth buffer cannot
  // resolve, so each region in list order sits a fraction higher than the one
  // before — enough to settle it at the far end of a twenty-acre site, capped
  // so a design with two hundred regions doesn't end up on a plinth.
  const REGION_STEP = 0.06;     // ft per region, in draw order
  const REGION_STACK_MAX = 1.6; // ft
  const MARK_LIFT = 0.10;       // ...and the paint above its own region

  function subdivideTris(tris, maxEdge, maxTris, straddles = null) {
    let cur = tris;
    // Each pass splits every triangle that is still too big, so the count at
    // most doubles per pass; the loop ends when a pass finds nothing to split
    // or when the rail is reached. A twelve-acre lawn hits the rail, which is
    // what the rail is for — its triangles end up about as coarse as the
    // terrain lattice underneath them, and no coarser.
    for (let pass = 0; pass < 16 && cur.length < maxTris; pass++) {
      let split = false;
      const next = [];
      for (const t of cur) {
        // Split the longest edge, which keeps the triangles from degenerating
        // into slivers the way splitting a fixed edge would.
        let li = 0, lm = 0;
        for (let i = 0; i < 3; i++) {
          const a = t[i], b = t[(i + 1) % 3];
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (d > lm) { lm = d; li = i; }
        }
        const wanted = lm > maxEdge ||
          (lm > DRAPE_FINE && straddles && straddles(t));
        if (!wanted || next.length >= maxTris) { next.push(t); continue; }
        const a = t[li], b = t[(li + 1) % 3], c = t[(li + 2) % 3];
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        next.push([a, m, c], [m, b, c]);
        split = true;
      }
      cur = next;
      if (!split) break;
    }
    return cur;
  }

  // A ring of world (x, z) points, triangulated, subdivided and dropped onto
  // the ground. Returns a geometry with planar UVs, so a surface texture tiles
  // in feet rather than across the region.
  //
  // The vertex colour is white, deliberately. A site material already has its
  // colour baked into its texture the way a floor finish does, and the vertex
  // colour is a *multiplier* over it — so tinting the mesh with the surface's
  // own colour as well squares it, and a lawn comes out the colour of a pine
  // forest at midnight. White here means "the material as authored".
  function drapedRegion(pts, field, lift, covered) {
    if (!pts || pts.length < 3) return null;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const flat = new THREE.ShapeGeometry(shape).toNonIndexed();
    const pos = flat.attributes.position;
    const tris = [];
    for (let i = 0; i + 2 < pos.count; i += 3) {
      tris.push([0, 1, 2].map((k) => [pos.getX(i + k), -pos.getY(i + k)]));
    }
    flat.dispose();
    if (!tris.length) return null;
    // Does this triangle sit across the edge of the building? Only those get
    // refined past `DRAPE_FINE`, so the cost is paid along the walls and
    // nowhere else.
    const straddles = covered
      ? (t) => {
        const a = covered(t[0][0], t[0][1]);
        return t.some(([x, z]) => covered(x, z) !== a);
      }
      : null;
    const out = subdivideTris(tris, DRAPE_EDGE, DRAPE_MAX_TRIS, straddles)
      // Ground cover under a slab is ground cover nobody can see, and drawing
      // it puts a lawn 1.2 inches above the corridor floor.
      .filter((t) => !covered || !covered(
        (t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3));
    if (!out.length) return null;
    const verts = new Float32Array(out.length * 9);
    const uvs = new Float32Array(out.length * 6);
    let vi = 0, ui = 0;
    for (const t of out) {
      for (const [x, z] of t) {
        verts[vi++] = x;
        verts[vi++] = groundAt(field, x, z) + lift;
        verts[vi++] = z;
        uvs[ui++] = x;
        uvs[ui++] = -z;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return coloredGeo(geo, '#ffffff');
  }

  // One painted line, as a ribbon of quads following the ground. Each segment
  // is its own quad and they overlap at the joins, which is what keeps a
  // three-point arc from opening a wedge at every vertex.
  function markingRibbon(stroke, field, covered, lift) {
    const pts = stroke.closed ? stroke.pts.concat([stroke.pts[0]]) : stroke.pts;
    if (pts.length < 2) return null;
    const half = Math.max(0.08, (stroke.w || 0.33) / 2);
    const verts = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      // A stripe that runs under the building is a stripe on the corridor
      // floor. Per quad rather than per stroke, so a walk that passes under a
      // canopy loses only the length that is actually covered.
      if (covered && covered((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
      const ux = dx / len, uz = dz / len;
      const nx = -uz * half, nz = ux * half;
      // Extend each end by half a width so consecutive quads overlap into a
      // mitre rather than leaving a notch.
      const ax = a.x - ux * half, az = a.z - uz * half;
      const bx = b.x + ux * half, bz = b.z + uz * half;
      const corner = [
        [ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz],
      ];
      for (const [ci, cj, ck] of [[0, 1, 2], [0, 2, 3]]) {
        for (const k of [ci, cj, ck]) {
          const [x, z] = corner[k];
          verts.push(x, groundAt(field, x, z) + lift, z);
        }
      }
    }
    if (!verts.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return coloredGeo(geo, stroke.color || '#eceae4');
  }

  function buildSiteGroup(state, field) {
    disposeGroup(siteGroup);
    const ground = state.floors[0] || null;
    // What counts as "under the building": the ground storey's own slab, grid
    // cells and polygon rooms alike. Exactly the test `floorSolidAt` already
    // answers for the walker, so the ground you can see is the ground you can
    // stand on.
    const covered = ground ? (x, z) => floorSolidAt(ground, x, z) : null;
    const bySurface = new Map();
    const marks = [];
    regionsOf(state).forEach((region, i) => {
      const lift = SURFACE_LIFT + Math.min(i * REGION_STEP, REGION_STACK_MAX);
      const geo = drapedRegion(region.pts, field, lift, covered);
      if (geo) {
        let list = bySurface.get(region.surf);
        if (!list) { list = []; bySurface.set(region.surf, list); }
        list.push(geo);
      }
      for (const stroke of markingsFor(region)) {
        const ribbon = markingRibbon(stroke, field, covered, lift + MARK_LIFT);
        if (ribbon) marks.push(ribbon);
      }
    });
    // One mesh per surface and one for all the paint on the whole site: a
    // school with a car park, a court, a field and three lawns costs five
    // draw calls, not one per region.
    for (const [key, geos] of bySurface) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), siteMaterial(key));
      mesh.receiveShadow = true;
      siteGroup.add(mesh);
    }
    if (marks.length) {
      const mesh = new THREE.Mesh(mergeGeometries(marks), markMat);
      mesh.receiveShadow = true;
      siteGroup.add(mesh);
    }
  }

  // ---------- the roof ----------

  // A run of parapet: an upstand along one boundary segment with a coping cap
  // over it. Built off the same outline the site plan draws, so the cap you
  // see from the street is the line on the drawing.
  function parapetRun(a, b, y, wallGeos, capGeos) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const angle = Math.atan2(dz, dx);
    const t = WALL_T_EXT;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const band = new THREE.BoxGeometry(len + t, PARAPET_H, t);
    const uv = band.attributes.uv;
    for (let i = 16; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / CELL));
    band.rotateY(-angle);
    band.translate(cx, y + PARAPET_H / 2, cz);
    wallGeos.push(coloredGeo(band, '#ffffff'));
    const cap = new THREE.BoxGeometry(len + t + 0.2, COPING_T, t + 0.3);
    cap.rotateY(-angle);
    cap.translate(cx, y + PARAPET_H + COPING_T / 2, cz);
    capGeos.push(coloredGeo(cap, '#ffffff'));
  }

  // A roof face — a triangle or a quad in 3D — with planar UVs off its own
  // world footprint, so shingle courses come out at shingle size on a slope.
  // White vertex colours, for the same reason `drapedRegion` uses them.
  function roofFace(pts, color = '#ffffff') {
    const verts = [];
    const uvs = [];
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        verts.push(p.x, p.y, p.z);
        uvs.push(p.x, -p.z);
      }
    }
    if (!verts.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return coloredGeo(geo, color);
  }

  function buildRoofGroup(state) {
    disposeGroup(roofGroup);
    const plan = roofPlan(state);
    if (plan.style === 'flat') return plan;
    const wallGeos = [], capGeos = [], deckGeos = [], slopeGeos = [], gableGeos = [];

    if (plan.parapetH > 0) {
      for (const loop of plan.outlines) {
        for (let i = 0; i < loop.length; i++) {
          parapetRun(loop[i], loop[(i + 1) % loop.length], plan.eaveY, wallGeos, capGeos);
        }
      }
    }
    for (const rect of plan.deckRects) {
      deckGeos.push(roofFace([
        { x: rect.x0, y: plan.eaveY + 0.05, z: rect.z0 },
        { x: rect.x1, y: plan.eaveY + 0.05, z: rect.z0 },
        { x: rect.x1, y: plan.eaveY + 0.05, z: rect.z1 },
        { x: rect.x0, y: plan.eaveY + 0.05, z: rect.z1 },
      ]));
    }
    for (const block of plan.blocks) {
      for (const f of block.faces) {
        const geo = roofFace(f.pts);
        if (geo) slopeGeos.push(geo);
      }
      for (const g of block.gables) {
        const geo = roofFace(g.pts);
        if (geo) gableGeos.push(geo);
      }
    }

    const add = (geos, mat, shadow = true) => {
      if (!geos.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      roofGroup.add(mesh);
    };
    add(wallGeos, facadeMaterial(plan.facade));
    add(gableGeos, facadeMaterial(plan.facade));
    // A coping is precast, not brick, so it rides the membrane material,
    // which is the right grey already. Its own mesh, though: a coping is a
    // BoxGeometry and a deck is a raw triangle list, and `mergeGeometries`
    // will not mix an indexed geometry with a non-indexed one.
    add(capGeos, roofMaterial(false));
    add(deckGeos, roofMaterial(false), false);
    add(slopeGeos, roofMaterial(true));
    return plan;
  }

  // ---------- the crowd ----------
  //
  // Phase 6 puts people in the building, and they are drawn the way everything
  // else that repeats is drawn here: instanced. A person is eight rigid parts
  // — head, torso, two thighs, two shins, two arms — and each part is one
  // `InstancedMesh` shared by the whole school, so a hundred and fifty people
  // cost eight draw calls rather than twelve hundred.
  //
  // **No skinning, and no skeleton.** A rigid-part puppet instances trivially
  // (a skinned one does not, without a texture of bone matrices), and at the
  // distance a floor-plan tool is ever viewed from, a hinged plank of a leg
  // reads as a leg. What matters is that the *right number of people* are in
  // the right corridor facing the right way, which is a question about the
  // building rather than about the animation.
  //
  // Every part geometry hangs from its own joint — a thigh's origin is the
  // hip, an arm's is the shoulder — so posing a limb is setting a rotation
  // rather than working out where a rotated box's centre ended up. Colours are
  // per instance (`setColorAt`), which is why the geometries are baked white:
  // `propMat` has `vertexColors` on, so white × instance colour is the
  // instance colour.
  const CROWD_MAX = 640;
  // A body, in feet, at scale 1. Sizes are a person: 5.8ft to the crown, 2.9ft
  // to the hip, a 13in shoulder width.
  const BODY = {
    hip: 2.85, thigh: 1.5, shin: 1.35, torso: 1.9, head: 0.44,
    // How far below the top of the torso the shoulders are, and how far out
    // from the middle — two different measurements that a single `shoulder`
    // number conflated in the first cut of this, with the arms coming out of
    // somebody's ribs.
    shoulderDrop: 0.26, shoulderX: 0.66, hipX: 0.3, arm: 1.6,
  };
  const crowdGroup = new THREE.Group();
  crowdGroup.visible = false;
  scene.add(crowdGroup);
  const heatGroup = new THREE.Group();
  heatGroup.visible = false;
  scene.add(heatGroup);
  let crowdMeshes = null;
  let heatMesh = null;
  const _crowdColor = new THREE.Color();
  const _crowdQ = new THREE.Quaternion();
  const _crowdE = new THREE.Euler(0, 0, 0, 'YXZ');
  const _crowdV = new THREE.Vector3();
  const _crowdS = new THREE.Vector3(1, 1, 1);

  function crowdGeometries() {
    const w = '#ffffff';
    return {
      // Each hangs from its joint at the local origin.
      // The head's pivot is the top of the torso and the sphere sits a
      // fraction lower than its own radius, so it *rests* on the shoulders.
      // Hung off a neck-length offset instead, it floats — which is precisely
      // what the first version of this did, to everybody, all day.
      head: sph(BODY.head, 0, BODY.head * 0.86, 0, w, 10),
      torso: box(1.15, BODY.torso, 0.66, 0, BODY.torso / 2, 0, w),
      thighL: box(0.42, BODY.thigh, 0.42, 0, -BODY.thigh / 2, 0, w),
      thighR: box(0.42, BODY.thigh, 0.42, 0, -BODY.thigh / 2, 0, w),
      shinL: box(0.36, BODY.shin, 0.4, 0, -BODY.shin / 2, 0, '#c8c8c8'),
      shinR: box(0.36, BODY.shin, 0.4, 0, -BODY.shin / 2, 0, '#c8c8c8'),
      // Arms and shins are baked a shade darker than white, so that when the
      // instance colour multiplies through, a sleeve reads as a sleeve
      // against the shirt beside it and a shoe reads as a shoe. Same trick as
      // every prop in the catalog, one level down.
      armL: box(0.26, BODY.arm, 0.28, 0, -BODY.arm / 2, 0, '#c6c6c6'),
      armR: box(0.26, BODY.arm, 0.28, 0, -BODY.arm / 2, 0, '#c6c6c6'),
    };
  }

  function buildCrowdMeshes() {
    if (crowdMeshes) return crowdMeshes;
    const geos = crowdGeometries();
    crowdMeshes = {};
    for (const [name, geo] of Object.entries(geos)) {
      const mesh = new THREE.InstancedMesh(geo, propMat, CROWD_MAX);
      mesh.frustumCulled = false;      // one mesh spans the whole school
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crowdMeshes[name] = mesh;
      crowdGroup.add(mesh);
    }
    return crowdMeshes;
  }

  // Place one part: its joint in world space, its own swing, the body's
  // facing. Rotation order is YXZ so the swing happens in the body's frame
  // rather than the world's — turn first, then lift the leg.
  function poseCrowdPart(mesh, i, jx, jy, jz, facing, swing, scale) {
    _crowdE.set(swing, facing, 0);
    _crowdQ.setFromEuler(_crowdE);
    _crowdV.set(jx, jy, jz);
    _crowdS.set(scale, scale, scale);
    _dummy.matrix.compose(_crowdV, _crowdQ, _crowdS);
    mesh.setMatrixAt(i, _dummy.matrix);
  }

  // The whole population, once a frame. `agents` is agents.js's own array —
  // this reads it and never writes to it, the same deal `poseDoors` has with
  // openings.js's leaves.
  function setCrowd(agents, opts = {}) {
    const meshes = buildCrowdMeshes();
    if (!agents || !agents.length) {
      for (const m of Object.values(meshes)) m.count = 0;
      crowdGroup.visible = false;
      return 0;
    }
    crowdGroup.visible = true;
    const recolor = opts.recolor !== false;
    const hideFloor = opts.hideAbove;      // edit mode draws one storey at a time
    let n = 0;
    for (const a of agents) {
      if (a.state === 'out') continue;
      if (hideFloor !== undefined && (a.floorIndex ?? 0) > hideFloor) continue;
      if (n >= CROWD_MAX) break;
      const s = a.height || 1;
      const sit = a.state === 'sit';
      const y = a.y + (sit && a.seat ? a.seat.h - BODY.hip * s : 0);
      const f = a.facing || 0;
      const cos = Math.cos(f), sin = Math.sin(f);
      // Right-hand axis in the body's frame, for the parts that come in pairs.
      const rx = cos, rz = -sin;
      const hipY = y + BODY.hip * s;
      const shoulderY = hipY + (BODY.torso - BODY.shoulderDrop) * s;
      // The gait. A walker's legs swing about the hip and the arms answer
      // them; somebody sitting has their thighs forward and their shins down;
      // somebody standing still does neither.
      const moving = a.state === 'walk';
      const g = a.gait || 0;
      const swing = moving ? Math.sin(g) * 0.3 : 0;
      const thighL = sit ? -1.35 : swing;
      const thighR = sit ? -1.35 : -swing;
      const shinL = sit ? 0 : thighL + Math.max(0, swing) * 0.8;
      const shinR = sit ? 0 : thighR + Math.max(0, -swing) * 0.8;
      const armSwing = moving ? -swing * 0.8 : (sit ? -0.35 : 0.05);
      const lean = moving ? 0.06 : 0;

      const hipLX = a.x + rx * BODY.hipX * s, hipLZ = a.z + rz * BODY.hipX * s;
      const hipRX = a.x - rx * BODY.hipX * s, hipRZ = a.z - rz * BODY.hipX * s;
      const shX = BODY.shoulderX * s;

      poseCrowdPart(meshes.torso, n, a.x, hipY, a.z, f, lean, s);
      poseCrowdPart(meshes.head, n, a.x, hipY + BODY.torso * s, a.z, f, sit ? 0.1 : lean, s);
      poseCrowdPart(meshes.thighL, n, hipLX, hipY, hipLZ, f, thighL, s);
      poseCrowdPart(meshes.thighR, n, hipRX, hipY, hipRZ, f, thighR, s);
      // The knee is wherever the thigh's far end ended up.
      const kneeL = kneeAt(hipLX, hipY, hipLZ, f, thighL, BODY.thigh * s);
      const kneeR = kneeAt(hipRX, hipY, hipRZ, f, thighR, BODY.thigh * s);
      poseCrowdPart(meshes.shinL, n, kneeL.x, kneeL.y, kneeL.z, f, shinL, s);
      poseCrowdPart(meshes.shinR, n, kneeR.x, kneeR.y, kneeR.z, f, shinR, s);
      poseCrowdPart(meshes.armL, n, a.x + rx * shX, shoulderY, a.z + rz * shX, f, armSwing, s);
      poseCrowdPart(meshes.armR, n, a.x - rx * shX, shoulderY, a.z - rz * shX, f, -armSwing, s);

      if (recolor) {
        _crowdColor.set(a.shirt);
        meshes.torso.setColorAt(n, _crowdColor);
        meshes.armL.setColorAt(n, _crowdColor);
        meshes.armR.setColorAt(n, _crowdColor);
        _crowdColor.set(a.trousers);
        meshes.thighL.setColorAt(n, _crowdColor);
        meshes.thighR.setColorAt(n, _crowdColor);
        meshes.shinL.setColorAt(n, _crowdColor);
        meshes.shinR.setColorAt(n, _crowdColor);
        _crowdColor.set(a.skin);
        meshes.head.setColorAt(n, _crowdColor);
      }
      n++;
    }
    for (const m of Object.values(meshes)) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (recolor && m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    return n;
  }

  function kneeAt(x, y, z, facing, swing, len) {
    // The thigh points down, rotated by `swing` about the body's own X axis
    // and then turned by `facing`: the same composition `poseCrowdPart` makes,
    // applied to the single point that matters.
    const dy = -Math.cos(swing) * len;
    const dz = -Math.sin(swing) * len;
    return {
      x: x + Math.sin(facing) * dz,
      y: y + dy,
      z: z + Math.cos(facing) * dz,
    };
  }

  function clearCrowd() {
    if (!crowdMeshes) return;
    for (const m of Object.values(crowdMeshes)) m.count = 0;
    crowdGroup.visible = false;
  }

  // ---------- the crowding heatmap ----------
  //
  // One flat square per bin of agents.js's crowd field, coloured by how long
  // the crowd stood in it. This is the playful face of Phase 7's egress
  // analysis: a fire drill leaves a picture of where the building got tight,
  // measured rather than predicted.
  const HEAT_RAMP = [
    { t: 0.0, c: '#2f6fbf' },
    { t: 0.35, c: '#3fb08a' },
    { t: 0.6, c: '#d8c24a' },
    { t: 0.82, c: '#d9803f' },
    { t: 1.0, c: '#c33b3b' },
  ];

  function heatColor(t) {
    const v = Math.min(1, Math.max(0, t));
    for (let i = 1; i < HEAT_RAMP.length; i++) {
      if (v > HEAT_RAMP[i].t && i < HEAT_RAMP.length - 1) continue;
      const a = HEAT_RAMP[i - 1], b = HEAT_RAMP[i];
      const k = (v - a.t) / Math.max(1e-6, b.t - a.t);
      return mixHex(a.c, b.c, Math.min(1, Math.max(0, k)));
    }
    return HEAT_RAMP[HEAT_RAMP.length - 1].c;
  }

  function buildHeatMesh(cells, cell, baseY) {
    if (heatMesh) {
      heatGroup.remove(heatMesh);
      heatMesh.geometry.dispose();
      heatMesh.material.dispose();
      heatMesh = null;
    }
    if (!cells.length) return;
    const geo = new THREE.PlaneGeometry(cell, cell);
    geo.rotateX(-Math.PI / 2);
    coloredGeo(geo, '#ffffff');
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
    });
    heatMesh = new THREE.InstancedMesh(geo, mat, cells.length);
    heatMesh.frustumCulled = false;
    cells.forEach((c, i) => {
      // A hair above the slab, so it reads as paint on the floor rather than
      // z-fighting with it.
      _dummy.position.set(c.x, baseY + 0.06, c.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      heatMesh.setMatrixAt(i, _dummy.matrix);
      _crowdColor.set(heatColor(c.t));
      heatMesh.setColorAt(i, _crowdColor);
    });
    heatMesh.instanceMatrix.needsUpdate = true;
    if (heatMesh.instanceColor) heatMesh.instanceColor.needsUpdate = true;
    heatGroup.add(heatMesh);
  }

  // `cells` is agents.js's `crowdCells(field, floor)`, already normalised.
  function setHeat(cells, opts = {}) {
    const on = !!(cells && cells.length);
    heatGroup.visible = on;
    if (!on) { buildHeatMesh([], 4, 0); return 0; }
    buildHeatMesh(cells, opts.cell || 4, opts.baseY || 0);
    return cells.length;
  }

  function buildFromState(state) {
    built = state;
    disposeGroup(buildingGroup);
    disposeGroup(ceilingGroup);
    disposeGroup(labelGroup);

    const metrics = stairMetrics(state);
    const links = stairsOf(state);
    // The graded ground, swept once. Everything that stands on it — the
    // terrain mesh, the hardscape, the trees — reads this same field, so
    // nothing can be at a different elevation from anything else.
    siteField = terrainField(state);
    buildTerrain(siteField);
    buildSiteGroup(state, siteField);
    const plan = buildRoofGroup(state);
    // Pivots are per-build: the Groups they point at are about to be disposed.
    doorPivots.clear();
    // ...and so are the prop instances a shove would move.
    propInstances.clear();
    shoved.clear();
    state.floors.forEach((floor, i) => {
      const group = new THREE.Group();
      const ceil = new THREE.Group();
      const labels = new THREE.Group();
      group.userData.floor = ceil.userData.floor = labels.userData.floor = i;
      buildFloor(floor, floorBaseY(state, i), wallHeightOf(state, i), group, ceil, labels, {
        metrics,
        facade: plan.facade,
        cuts: floorCuts(state, i),
        ceilCuts: floorCuts(state, i + 1),
        risers: links.filter((l) => l.from === i),
        guarded: links.filter((l) => l.to === i),
        elevators: elevatorsOn(state, i),
        leaves: collectDoorLeaves(state, i),
      });
      const propsGroup = new THREE.Group();
      buildPropsGroup(state, i, floorBaseY(state, i), propsGroup, siteField);
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
    }

    // The site the sun swings around. Kept on the module rather than baked
    // into the light, because the sun now moves every time the clock does and
    // has to keep aiming at the same middle of the same building.
    site.x = gw * 0.5;
    site.z = gh * 0.5;
    site.span = Math.max(gw, gh) * 0.75 + 40;
    // The tallest thing that casts a shadow is now the ridge, not the wall top.
    site.top = Math.max(topOfBuilding(state), roofTop(plan));
    // The environment travels with the design, so a rebuild is also where a
    // loaded file's own date, hour and latitude take effect.
    setEnvironment(state.env);

    editView.camY = 200 + Math.max(topOfBuilding(state), roofTop(plan));
    applyFloorVisibility();
  }

  buildComposer();

  // ---------- capture ----------
  //
  // The blueprint exporter's trick, aimed at the 3D view: draw at a multiple of
  // the on-screen size, read the pixels, put everything back. The renderer has
  // no `preserveDrawingBuffer`, so the read has to happen in the same turn as
  // the draw — hence the synchronous render/toDataURL pair, with no await
  // between them. (Setting `preserveDrawingBuffer` instead would tax every
  // frame of every walkthrough to make one button work.)
  function capture(scale = 2) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const s = Math.max(1, Math.min(4, scale));
    const dpr = renderer.getPixelRatio();
    renderer.setPixelRatio(s);
    if (composer) composer.setSize(w, h);
    renderer.setSize(w, h, false);
    render();
    const url = canvas.toDataURL('image/png');
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    render();
    return url;
  }

  // ---------- Phase 9: the building, as a file ----------
  //
  // The wishlist's second item — "take the school into Blender" — and the
  // reason gltf.js writes as well as reads. What leaves here is what is on
  // screen: the merged structural meshes, the roof, the site, and every prop
  // instance expanded into its own triangles, all in world feet, all vertex
  // coloured. One material, because that is what the whole scene has been
  // since Phase 1 of the first arc; gltf.js scales the root node into metres
  // so the school arrives in Blender at the size it says it is.
  //
  // Instances are expanded rather than exported as glTF's own instancing
  // extension: `EXT_mesh_gpu_instancing` is an extension, and an extension is
  // a thing the importer at the other end may not have. A school of ten
  // thousand desks is a bigger file this way and it opens everywhere.
  const _exportMatrix = new THREE.Matrix4();
  const _exportNormalMat = new THREE.Matrix3();
  const _exportV = new THREE.Vector3();

  // One mesh's geometry, transformed into world space and pushed onto the
  // list gltf.js takes.
  function pushExportMesh(out, geometry, matrix, name, fallbackColor) {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) return;
    const count = posAttr.count;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const nrmAttr = geometry.getAttribute('normal');
    const colAttr = geometry.getAttribute('color');
    _exportNormalMat.getNormalMatrix(matrix);
    for (let i = 0; i < count; i++) {
      _exportV.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      position[i * 3] = _exportV.x; position[i * 3 + 1] = _exportV.y; position[i * 3 + 2] = _exportV.z;
      if (nrmAttr) {
        _exportV.fromBufferAttribute(nrmAttr, i).applyMatrix3(_exportNormalMat).normalize();
        normal[i * 3] = _exportV.x; normal[i * 3 + 1] = _exportV.y; normal[i * 3 + 2] = _exportV.z;
      }
      if (colAttr) {
        color[i * 3] = colAttr.getX(i); color[i * 3 + 1] = colAttr.getY(i); color[i * 3 + 2] = colAttr.getZ(i);
      } else {
        color[i * 3] = fallbackColor.r; color[i * 3 + 1] = fallbackColor.g; color[i * 3 + 2] = fallbackColor.b;
      }
    }
    const idx = geometry.getIndex();
    const index = idx ? Uint32Array.from(idx.array) : null;
    out.push({ name, position, normal, color, index: index || null });
  }

  const _exportColor = new THREE.Color();

  function collectExport(opts = {}) {
    scene.updateMatrixWorld(true);
    const out = [];
    const groups = [
      { group: buildingGroup, name: 'Structure' },
      { group: roofGroup, name: 'Roof' },
    ];
    if (opts.ceilings) groups.push({ group: ceilingGroup, name: 'Ceilings' });
    if (opts.site !== false) groups.push({ group: siteGroup, name: 'Site' });
    for (const { group, name } of groups) {
      group.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry || obj.isSprite) return;
        if (!obj.visible) return;
        _exportColor.set(obj.material && obj.material.color ? obj.material.color : 0xffffff);
        if (obj.isInstancedMesh) {
          for (let i = 0; i < obj.count; i++) {
            obj.getMatrixAt(i, _exportMatrix);
            _exportMatrix.premultiply(obj.matrixWorld);
            pushExportMesh(out, obj.geometry, _exportMatrix, `${name}-${obj.id}-${i}`, _exportColor);
          }
        } else {
          pushExportMesh(out, obj.geometry, obj.matrixWorld, `${name}-${obj.id}`, _exportColor);
        }
      });
    }
    // The ground plane is a mile wide and would arrive as a horizon rather
    // than as a site, so the graded terrain goes only when it has actually
    // been graded and only when asked for.
    if (opts.terrain && terrainMesh && terrainMesh.visible) {
      _exportColor.set(0xffffff);
      pushExportMesh(out, terrainMesh.geometry, terrainMesh.matrixWorld, 'Terrain', _exportColor);
    }
    return out;
  }

  // What an export would weigh, before anybody waits for it. A whole school
  // with its furniture expanded is tens of megabytes, and knowing that in
  // advance is the difference between a progress note and a hung tab.
  function exportStats(opts = {}) {
    const meshes = collectExport(opts);
    let vertices = 0, triangles = 0;
    for (const m of meshes) {
      vertices += m.position.length / 3;
      triangles += (m.index ? m.index.length : m.position.length / 3) / 3;
    }
    return { meshes: meshes.length, vertices, triangles, bytes: vertices * 36 + triangles * 12 };
  }

  function exportGLB(opts = {}) {
    const meshes = collectExport(opts);
    if (!meshes.length) throw new Error('There is nothing built to export yet');
    return writeGLB(meshes, {
      name: opts.name || 'School',
      generator: 'School Generator (gltf.js)',
      unitScale: opts.unitScale === undefined ? FT_TO_M : opts.unitScale,
    });
  }

  function downloadGLB(filename = 'school.glb', opts = {}) {
    const buf = exportGLB(opts);
    const blob = new Blob([buf], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return blob.size;
  }

  // ---------- Phase 9: the headset ----------
  //
  // Three things and no more, because three.js's `renderer.xr` does the rest:
  // a rig for the camera to be a child of (the headset writes the camera's
  // own transform, so nothing else may), a session, and an animation loop —
  // XR frames come from the headset's own clock at 72 or 90Hz, not from
  // `requestAnimationFrame`, so main.js's loop stands down while this runs.
  //
  // Post-processing stands down too. The composer renders one full-screen
  // pass at a time into its own targets, which is not how a stereo XR frame
  // is drawn; bloom in one eye and not the other is worse than no bloom.
  const xrRig = new THREE.Group();
  scene.add(xrRig);
  let xrSession = null;
  let xrOnFrame = null;

  function setXRRig(pose) {
    if (!pose) return;
    xrRig.position.set(pose.x || 0, pose.y || 0, pose.z || 0);
    xrRig.rotation.y = pose.yaw || 0;
  }

  // Where the head is relative to the rig, in *world* axes — which is what
  // the walker needs in order to put the rig somewhere that lands the head
  // where it wants it. World axes rather than rig-local ones because the rig
  // turns: a head half a metre to its left is half a metre along whichever
  // way the rig is currently facing, and subtracting the unrotated offset
  // would swing the building every time somebody snapped a turn.
  const _xrHead = new THREE.Vector3();
  function xrHeadLocal() {
    xrRig.updateMatrixWorld(true);
    walkCamera.getWorldPosition(_xrHead);
    return {
      x: _xrHead.x - xrRig.position.x,
      y: _xrHead.y - xrRig.position.y,
      z: _xrHead.z - xrRig.position.z,
    };
  }

  async function enterXR(opts = {}) {
    if (xrSession) return xrSession;
    const xr = navigator.xr;
    if (!xr) throw new Error('This browser has no WebXR');
    const session = await xr.requestSession(XR_MODE, {
      optionalFeatures: REFERENCE_SPACES.concat(['bounded-floor', 'hand-tracking']),
    });
    xrSession = session;
    xrOnFrame = opts.onFrame || null;
    // The camera becomes the rig's child for the length of the session and
    // goes back to the scene afterwards, so nothing outside XR has to know
    // the rig exists.
    xrRig.add(walkCamera);
    renderer.xr.enabled = true;
    // `local-floor` is what puts the model's floor under real feet; three.js
    // falls back on its own if the device refuses it.
    renderer.xr.setReferenceSpaceType(REFERENCE_SPACES[0]);
    await renderer.xr.setSession(session);
    session.addEventListener('end', () => { cleanupXR(); if (opts.onEnd) opts.onEnd(); }, { once: true });
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      if (xrOnFrame) xrOnFrame(dt, session);
      renderer.render(scene, walkCamera);
    });
    return session;
  }

  function cleanupXR() {
    renderer.setAnimationLoop(null);
    renderer.xr.enabled = false;
    if (walkCamera.parent === xrRig) scene.add(walkCamera);
    xrRig.position.set(0, 0, 0);
    xrRig.rotation.set(0, 0, 0);
    xrSession = null;
    xrOnFrame = null;
    // The canvas was resized for the headset; put it back for the page.
    resize();
  }

  function exitXR() {
    if (xrSession) xrSession.end().catch(() => cleanupXR());
  }

  function downloadCapture(scale = 2, filename = 'school-photo.png') {
    const a = document.createElement('a');
    a.href = capture(scale);
    a.download = filename;
    a.click();
  }

  return {
    renderer, scene, editCamera, walkCamera, editView,
    buildFromState, applyFloorVisibility, fitEditView, applyEditCamera,
    setMode, resize, render,
    // --- Phase 11: the furniture you walked into ---
    moveProps, restoreProps,
    get shovedCount() { return shoved.size; },
    // --- Phase 3: sun, sky and the building's own lights ---
    //
    // `setEnvironment` is the one write; everything else reads back what it
    // worked out, so the UI never has to recompute a solar position that the
    // renderer has already asked for.
    setEnvironment,
    get environment() { return envState; },
    // What the budget is doing, for the sky panel's readout — a line that says
    // "24 fixtures, 9 groups, 12 live at once" is the difference between
    // trusting the cap and wondering about it.
    //
    // `sources` and `clustered` describe the *design* and so don't move as you
    // walk; `lit` is what is switched on this instant, which is zero whenever
    // the sun is doing the work.
    lightReport(eye) {
      const cap = lightPool.length;
      if (!built) return { sources: 0, clustered: 0, lit: 0, cap, burning: false };
      const at = eye || (mode === 'walk' ? walkCamera.position : { x: editView.x, y: 12, z: editView.z });
      const r = budgetFor(built, catalogEntry, at, { floorHt: built.floorHt, cap });
      return {
        sources: r.sources,
        clustered: r.clustered,
        lit: lampLevel > 0 ? r.lit.length : 0,
        cap,
        burning: lampLevel > 0,
      };
    },
    // --- photo mode ---
    get photo() { return { ...photo }; },
    setPhoto(patch) {
      const wasOn = photo.on, hadDof = photo.dof;
      Object.assign(photo, patch);
      photo.fov = Math.min(110, Math.max(18, photo.fov));
      photo.focus = Math.min(400, Math.max(1.5, photo.focus));
      photo.aperture = Math.min(22, Math.max(1.2, photo.aperture));
      applyPhotoCamera();
      // Only the passes' *existence* needs a rebuild; focus and f-number are
      // uniforms and take effect on the next frame.
      if (photo.on !== wasOn || photo.dof !== hadDof || 'bloom' in patch) buildComposer();
      applyPhotoCamera();
      return { ...photo };
    },
    get exposureBias() { return exposureBias; },
    set exposureBias(v) {
      exposureBias = Math.min(3, Math.max(0.25, Number.isFinite(v) ? v : 1));
      renderer.toneMappingExposure = envState.palette.exposure * exposureBias;
    },
    capture, downloadCapture,
    // --- Phase 9 ---
    //
    // The library of imported models, the building on its way to Blender, and
    // the headset. All three are one write and one read, the arrangement
    // every phase since the third has settled on.
    setModels,
    get modelCount() { return modelGeoCache.size; },
    exportGLB, downloadGLB, exportStats,
    enterXR, exitXR, setXRRig, xrHeadLocal,
    get xrPresenting() { return !!xrSession; },
    get mode() { return mode; },
    get fxEnabled() { return fxEnabled; },
    set fxEnabled(v) { fxEnabled = v; },
    // Layers panel: which parts of the design are drawn while editing. A
    // shallow copy out, a merge in — `applyFloorVisibility` re-derives every
    // mesh's visibility from it immediately, so a toggle takes effect the
    // same frame without a full rebuild.
    get layers() { return { ...layers }; },
    setLayers(patch) { Object.assign(layers, patch); applyFloorVisibility(); },
    // --- Phase 8: the tracing overlay and the structural shadow ---
    //
    // Both are read straight off the state, the same arrangement the site and
    // the roof have. `refreshOverlay` is the cheap one — it moves and rescales
    // a plane the overlay tool is dragging, with no geometry to rebuild —
    // while `refreshShadow` re-rasterizes the storey below and so belongs with
    // a structural edit rather than with a pointer move.
    refreshOverlay(state) { if (state) { built = state; } applyOverlay(built); },
    refreshShadow(state) { if (state) { built = state; } buildShadow(built); },
    get overlayReady() { return !!overlayTexture; },
    // --- Phase 6: the people in it ---
    //
    // `setCrowd` takes agents.js's own array and poses it; `setHeat` takes
    // `crowdCells`. Neither module describes anything to the other — the
    // renderer reads the simulation's records directly, the same arrangement
    // `poseDoors` has with openings.js's leaves.
    setCrowd, clearCrowd, setHeat,
    get crowdVisible() { return crowdGroup.visible; },
    set crowdVisible(v) { crowdGroup.visible = !!v; },
    // Swing the doors. `leaves` is openings.js's own list — the same one
    // collide.js is resolving against — so the door you walk through is the
    // door you see move, keyed rather than described.
    poseDoors(leaves) {
      if (!leaves) return;
      for (const leaf of leaves) {
        const pivot = doorPivots.get(leaf.key);
        if (pivot) pivot.rotation.y = -leafAngle(leaf, leaf.open);
      }
    },
  };
}
