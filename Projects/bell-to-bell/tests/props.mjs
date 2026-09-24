// tests/props.mjs — the props still have the shape they had.
//
// The eleven props and the picture frame used to be Poly Haven's .gltf, a .bin
// buffer beside it and a folder of JPEGs. Tools/board-check/asset-pipeline.mjs
// rewrote each .gltf and .bin as one meshopt-compressed .glb (#624) that names
// the same JPEGs by the same relative paths. Compression quantizes positions
// and texture coordinates, and a plant that came out a centimetre squashed, or
// a clipboard whose texture slid off its face, weighs less just the same. This
// is what can tell.
//
// Every model goes through the game's own createModelLoader().loadStatic(),
// decoder wiring included, and the scene it returns is measured raw: before
// room.js's fitFootprint()/fitPlane() rescale it into the room, since that
// rescale divides by the model's own size and would hide a model that shrank
// evenly. Per material: a box and a centroid of every vertex in the model's
// space, and a box and a centroid of its UVs. Per model: the named meshes (the
// frame's canvas is found by name, room.js dressPoster), and the images it
// fetched. BASELINE is those numbers measured the same way from the original
// .gltf files at 52d2a59, before the pipeline ran.
//
//   node props.mjs           check the props against BASELINE
//   node props.mjs --print   print what the current files measure

import './three-hook.mjs';
import fs from 'fs';

const THREE = await import('../src/three.js');
const { createModelLoader } = await import('../src/world/models.js');

// The game's loader fetches relative URLs; they are answered from disk,
// relative to the project root, the way the page's own server would. The
// texture loader asks for a plain string, the file loader for a Request.
// Every image a model asks for is recorded, so a .glb that names a different
// file from its .gltf is caught even when that file exists.
globalThis.self ??= globalThis;   // GLTFLoader reads self.URL before loading any image
let fetched = [];
globalThis.Request = class { constructor(url) { this.url = url; } };
globalThis.fetch = async req => {
  const url = typeof req === 'string' ? req : req.url;
  const file = '../' + decodeURI(url);
  if (/\.(jpe?g|png)$/i.test(file)) fetched.push(decodeURI(url));
  if (!fs.existsSync(file)) return new Response('', { status: 404 });
  return new Response(fs.readFileSync(file), { status: 200 });
};
// Node has no image decoder. The loader takes whatever this returns as the
// texture's image, so it only has to refuse what is not a JPEG: a 404 comes
// back as an empty body, and a PNG named .jpg would be as wrong in a browser.
globalThis.createImageBitmap = async blob => {
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new Error('not a JPEG');
  return { width: 1, height: 1, close() {} };
};

const manifest = JSON.parse(fs.readFileSync('../data/assets.json', 'utf8'));
const models = { ...manifest.props, frame: manifest.art.frame };
const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);

const r4 = v => v.toArray().map(x => +x.toFixed(4));

export async function measure(path) {
  fetched = [];
  const root = await createModelLoader().loadStatic(path);
  root.updateWorldMatrix(true, true);
  const byMat = {};
  const meshes = [];
  const v = new THREE.Vector3(), uv = new THREE.Vector2();
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes.push(o.name);
    const name = o.material.name;
    const m = byMat[name] ??= {
      box: new THREE.Box3(), sum: new THREE.Vector3(), n: 0,
      uvBox: new THREE.Box2(), uvSum: new THREE.Vector2(), maps: new Set()
    };
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap']) {
      if (o.material[k]) m.maps.add(k);
    }
    const pos = o.geometry.attributes.position;
    const tex = o.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      // getX() and friends undo a normalized (quantized) attribute; the node's
      // own dequantizing scale and offset live in matrixWorld.
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      m.box.expandByPoint(v);
      m.sum.add(v);
      if (tex) { uv.fromBufferAttribute(tex, i); m.uvBox.expandByPoint(uv); m.uvSum.add(uv); }
      m.n++;
    }
  });
  const materials = {};
  let box = new THREE.Box3();
  for (const [name, m] of Object.entries(byMat).sort()) {
    box.union(m.box);
    materials[name] = {
      min: r4(m.box.min), max: r4(m.box.max), mean: r4(m.sum.divideScalar(m.n)),
      uvMin: r4(m.uvBox.min), uvMax: r4(m.uvBox.max), uvMean: r4(m.uvSum.divideScalar(m.n)),
      maps: [...m.maps].sort()
    };
  }
  const images = [...new Set(fetched)].map(f => f.slice(dirOf(path).length)).sort();
  return { box: [r4(box.min), r4(box.max)], meshes: meshes.sort(), images, materials };
}

if (process.argv.includes('--print')) {
  const out = {};
  for (const [k, p] of Object.entries(models)) out[k] = await measure(p);
  console.log(JSON.stringify(out));
  process.exit(0);
}

let fails = 0;
function check(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }

// Measured from the original .gltf files at 52d2a59 by `--print`, before the
// pipeline ran. Metres and UV units, in the model's own space.
const BASELINE = {
  wallClock: {
    box: [[-0.1602,-0.1602,0],[0.1602,0.1602,0.0472]],
    meshes: ["frame001","frame001_1","wall_clock_hours_hand","wall_clock_minute_hand","wall_clock_second_hand"],
    images: ["textures/wall_clock_arm_512.jpg","textures/wall_clock_diff_512.jpg","textures/wall_clock_glass_arm_512.jpg","textures/wall_clock_nor_gl_512.jpg"],
    materials: {
      "wall_clock": { min: [-0.1602,-0.1602,0], max: [0.1602,0.1602,0.0354], mean: [-0.0015,-0.0054,0.02], uvMin: [-0.0005,0.0028], uvMax: [0.998,0.9985], uvMean: [0.6826,0.6088], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
      "wall_clock_glass": { min: [-0.1426,-0.1426,0.0353], max: [0.1426,0.1426,0.0472], mean: [0,0,0.0396], uvMin: [0.0223,0.0279], uvMax: [0.9777,0.9781], uvMean: [0.5,0.503], maps: ["metalnessMap","roughnessMap"] },
    }
  },
  fireAlarm: {
    box: [[-0.0497,-0.0774,0.0004],[0.0497,0.0662,0.0267]],
    meshes: ["fire_alarm","fire_alarm_lever"],
    images: ["textures/fire_alarm_arm_512.jpg","textures/fire_alarm_diff_512.jpg","textures/fire_alarm_nor_gl_512.jpg"],
    materials: {
      "fire_alarm": { min: [-0.0497,-0.0774,0.0004], max: [0.0497,0.0662,0.0267], mean: [0.0013,0.0032,0.0219], uvMin: [0.0036,0.0034], uvMax: [0.9952,0.9963], uvMean: [0.5523,0.4252], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  pottedPlant2: {
    box: [[-0.3967,0.0001,-0.4203],[0.3045,0.8412,0.2371]],
    meshes: ["potted_plant_02_dirt","potted_plant_02_leaves","potted_plant_02_pot"],
    images: ["textures/potted_plant_02_leaves_diff_1k.jpg","textures/potted_plant_02_leaves_nor_gl_1k.jpg","textures/potted_plant_02_leaves_rough_1k.jpg","textures/potted_plant_02_pot_diff_1k.jpg","textures/potted_plant_02_pot_nor_gl_1k.jpg","textures/potted_plant_02_pot_rough_1k.jpg"],
    materials: {
      "potted_plant_02_leaves": { min: [-0.3967,0.2087,-0.4203], max: [0.3045,0.8412,0.2229], mean: [-0.061,0.5008,-0.0303], uvMin: [0.0281,0.0061], uvMax: [0.9953,0.9976], uvMean: [0.6547,0.5116], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
      "potted_plant_02_pot": { min: [-0.2371,0.0001,-0.2371], max: [0.2371,0.3408,0.2371], mean: [0.0026,0.3068,-0.0003], uvMin: [0.0025,0.0025], uvMax: [0.8292,0.9975], uvMean: [0.6999,0.378], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  pottedPlant4: {
    box: [[-0.0839,0.0004,-0.0839],[0.0839,0.2678,0.1008]],
    meshes: ["potted_plant_04_dirt","potted_plant_04_ground","potted_plant_04_plant","potted_plant_04_pot"],
    images: ["textures/potted_plant_04_arm_1k.jpg","textures/potted_plant_04_diff_1k.jpg","textures/potted_plant_04_nor_gl_1k.jpg"],
    materials: {
      "potted_plant_04": { min: [-0.0839,0.0004,-0.0839], max: [0.0839,0.2678,0.1008], mean: [0.0077,0.1422,0.005], uvMin: [0.0041,0.0175], uvMax: [0.9944,0.9943], uvMean: [0.507,0.5138], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  displayShelves: {
    box: [[-0.1858,0.0004,-0.5389],[0.1858,1.5566,0.5389]],
    meshes: ["wooden_display_shelves_01","wooden_display_shelves_01_drawer_01","wooden_display_shelves_01_drawer_02","wooden_display_shelves_01_drawer_03"],
    images: ["textures/wooden_display_shelves_01_arm_1k.jpg","textures/wooden_display_shelves_01_diff_1k.jpg","textures/wooden_display_shelves_01_nor_gl_1k.jpg"],
    materials: {
      "wooden_display_shelves_01": { min: [-0.1858,0.0004,-0.5389], max: [0.1858,1.5566,0.5389], mean: [-0.0009,0.4865,-0.0042], uvMin: [0.0067,0.0094], uvMax: [0.9932,0.9933], uvMean: [0.6572,0.4411], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  metalRack: {
    box: [[-0.46,0,-0.3],[0.4554,1.9,0.3]],
    meshes: ["worn_metal_rack"],
    images: ["textures/worn_metal_rack_arm_1k.jpg","textures/worn_metal_rack_diff_1k.jpg","textures/worn_metal_rack_nor_gl_1k.jpg"],
    materials: {
      "worn_metal_rack": { min: [-0.46,0,-0.3], max: [0.4554,1.9,0.3], mean: [-0.002,0.9743,0.0005], uvMin: [0.0008,0.0004], uvMax: [0.9998,0.9998], uvMean: [0.3768,0.2872], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  wetFloorSign: {
    box: [[-0.15,0.0022,-0.1933],[0.15,0.6317,0.1653]],
    meshes: ["WetFloorSign_01"],
    images: ["textures/WetFloorSign_01_arm_1k.jpg","textures/WetFloorSign_01_diff_1k.jpg","textures/WetFloorSign_01_nor_gl_1k.jpg"],
    materials: {
      "WetFloorSign_01": { min: [-0.15,0.0022,-0.1933], max: [0.15,0.6317,0.1653], mean: [0.0002,0.4365,-0.014], uvMin: [0.0005,0.0005], uvMax: [0.8918,0.9995], uvMean: [0.4923,0.5569], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  clipboard: {
    box: [[-0.1143,-0.0025,-0.1778],[0.1143,0.0395,0.1588]],
    meshes: ["clipboard"],
    images: ["textures/clipboard_arm_512.jpg","textures/clipboard_diff_512.jpg","textures/clipboard_nor_gl_512.jpg"],
    materials: {
      "clipboard": { min: [-0.1143,-0.0025,-0.1778], max: [0.1143,0.0395,0.1588], mean: [0,0.0093,-0.1317], uvMin: [0.0022,0.002], uvMax: [0.9934,0.9976], uvMean: [0.5538,0.1976], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  stationery: {
    box: [[-0.1633,-0.0737,-0.0418],[0.1386,0.0907,0.0418]],
    meshes: ["stationery_supplies_eraser","stationery_supplies_pen_blue","stationery_supplies_pen_fancy","stationery_supplies_pen_red","stationery_supplies_pencil_new_a","stationery_supplies_pencil_new_b","stationery_supplies_pencil_old","stationery_supplies_pencil_used","stationery_supplies_pencilcup"],
    images: ["textures/stationery_supplies_arm_512.jpg","textures/stationery_supplies_diff_512.jpg","textures/stationery_supplies_nor_gl_512.jpg"],
    materials: {
      "stationery_supplies": { min: [-0.1633,-0.0737,-0.0418], max: [0.1386,0.0907,0.0418], mean: [-0.0365,0.0179,-0.0002], uvMin: [0.0039,0.0039], uvMax: [0.9961,0.9961], uvMean: [0.7458,0.5598], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  binder: {
    box: [[-0.1568,-0.0021,-0.0996],[0.4272,0.0232,0.1003]],
    meshes: ["binder_notebook","binder_notebook_closed"],
    images: ["textures/binder_notebook_arm_512.jpg","textures/binder_notebook_diff_512.jpg","textures/binder_notebook_nor_gl_512.jpg"],
    materials: {
      "binder_notebook": { min: [-0.1568,-0.0021,-0.0996], max: [0.4272,0.0232,0.1003], mean: [0.1762,0.0078,-0.0055], uvMin: [0.0044,0.0119], uvMax: [0.9956,0.9956], uvMean: [0.6414,0.4502], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  stapler: {
    box: [[-0.0981,-0.0128,-0.0237],[0.1103,0.0824,0.0237]],
    meshes: ["vintage_stapler_base","vintage_stapler_staple_single","vintage_stapler_staples","vintage_stapler_top"],
    images: ["textures/vintage_stapler_arm_512.jpg","textures/vintage_stapler_diff_512.jpg","textures/vintage_stapler_nor_gl_512.jpg"],
    materials: {
      "vintage_stapler": { min: [-0.0981,-0.0128,-0.0237], max: [0.1103,0.0824,0.0237], mean: [0.0003,0.0106,0], uvMin: [0.0019,0.0088], uvMax: [0.9977,0.9981], uvMean: [0.5273,0.5516], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
  frame: {
    box: [[-0.3015,-0.2321,0.0019],[0.3015,0.2321,0.0219]],
    meshes: ["fancy_picture_frame_01","fancy_picture_frame_01_canvas"],
    images: ["textures/fancy_picture_frame_01_canvas_diff_1k.jpg","textures/fancy_picture_frame_01_canvas_nor_gl_1k.jpg","textures/fancy_picture_frame_01_canvas_rough_1k.jpg","textures/fancy_picture_frame_01_diff_1k.jpg","textures/fancy_picture_frame_01_nor_gl_1k.jpg","textures/fancy_picture_frame_01_rough_1k.jpg"],
    materials: {
      "fancy_picture_frame_01": { min: [-0.3015,-0.2321,0.0019], max: [0.3015,0.2321,0.0219], mean: [0,0,0.0114], uvMin: [0.0053,0.004], uvMax: [0.9965,0.9974], uvMean: [0.5529,0.4442], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
      "fancy_picture_frame_01_canvas": { min: [-0.2701,-0.2011,0.0066], max: [0.2693,0.1991,0.0066], mean: [-0.0004,-0.001,0.0066], uvMin: [0.0323,0.1253], uvMax: [0.9686,0.8202], uvMean: [0.5004,0.4728], maps: ["map","metalnessMap","normalMap","roughnessMap"] },
    }
  },
};

// Measured 2026-09-24 against the files the pipeline wrote (positions at 14
// bits, texture coordinates at 12): the worst box moved 0.1 mm, no centroid
// moved at the 0.1 mm this rounds to, and the worst UV bound moved 0.0002.
// Where the tolerances start biting, found by re-running the recipe coarser:
// positions at 9 bits fail the display shelves and the metal rack, and at 8
// the potted plant too; 10 bits passes, because on a 1 m prop 10 bits is still
// under a millimetre, which is the claim. Texture coordinates at 9 bits fail
// the frame, and at 8 six props; 10 passes (half a step is 0.0005, a texel at
// 1k is 0.001).
const TOL = 0.001, UV_TOL = 0.001;
const near = (a, b, tol = TOL) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);

check('eleven props and the frame', Object.keys(models).length === 12);
check('every prop is a .glb the pipeline wrote', Object.values(models).every(p => p.endsWith('.glb')));

// Reads a .glb's JSON chunk without three: 12-byte header, then the chunk.
function glbJson(p) {
  const b = fs.readFileSync('../' + p);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
check('every prop requires EXT_meshopt_compression, so the decoder is load-bearing',
  Object.values(models).every(p => (glbJson(p).extensionsRequired || []).includes('EXT_meshopt_compression')));
check('every prop names its images by URI, none embedded (#624)',
  Object.values(models).every(p => (glbJson(p).images || []).every(i => i.uri && i.bufferView === undefined)));

for (const [k, p] of Object.entries(models)) {
  const want = BASELINE[k];
  let got = null;
  try { got = await measure(p); }
  catch (err) { console.log(`        ${k}: ${err.message}`); }
  check(`${k} loads through the game's own loader`, !!got);
  if (!got || !want) { check(`${k} has a baseline`, !!want); continue; }

  check(`${k} fetches the same images`, got.images.join() === want.images.join());
  check(`${k} has the same named meshes`, got.meshes.join() === want.meshes.join());
  check(`${k} sits in the same box`, near(got.box[0], want.box[0]) && near(got.box[1], want.box[1]));
  const names = Object.keys(got.materials).join();
  check(`${k} has the same materials`, names === Object.keys(want.materials).join());
  const moved = [], slid = [], unmapped = [];
  for (const [m, w] of Object.entries(want.materials)) {
    const g = got.materials[m];
    if (!g) continue;
    if (!near(g.min, w.min) || !near(g.max, w.max) || !near(g.mean, w.mean)) moved.push(m);
    if (!near(g.uvMin, w.uvMin, UV_TOL) || !near(g.uvMax, w.uvMax, UV_TOL) || !near(g.uvMean, w.uvMean, UV_TOL)) slid.push(m);
    if (g.maps.join() !== w.maps.join()) unmapped.push(m);
  }
  check(`${k}: every material's vertices are where they were`, moved.length === 0);
  if (moved.length) console.log('        moved: ' + moved.join(', '));
  check(`${k}: every material's texture coordinates are where they were`, slid.length === 0);
  if (slid.length) console.log('        slid: ' + slid.join(', '));
  // A JPEG that is missing or is not a JPEG does not fail the load: GLTFLoader
  // logs it and leaves the slot empty, and the prop draws untextured. So this
  // is the line that catches it (moving vintage_stapler_arm_512.jpg aside
  // leaves every other assertion green), and the image list above is the one
  // that catches a .glb naming the wrong file that does exist.
  check(`${k}: every material has the same texture slots filled`, unmapped.length === 0);
  if (unmapped.length) console.log('        changed: ' + unmapped.join(', '));
}

console.log(fails ? `\n${fails} FAILURES` : '\nall green');
process.exit(fails ? 1 : 0);
