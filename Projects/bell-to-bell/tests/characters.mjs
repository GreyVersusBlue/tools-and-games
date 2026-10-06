// tests/characters.mjs — the students still stand where they stood.
//
// The eight outfits used to be embedded .gltf files, 25.3 MB with 24 clips
// each. Tools/board-check/asset-pipeline.mjs rewrote them as meshopt-compressed
// .glb files with the one clip the game plays (#619). Compression is lossy: it
// quantizes positions, normals and the animation's keys. A body that came out
// a centimetre shorter, or a clip that came out bent, weighs less just the
// same, so a byte count cannot tell the difference. This can.
//
// Every outfit goes through the game's own loader (createModelLoader, the
// decoder wiring included) and findBone, then is measured twice. In the file's
// rest pose: the whole body's box, the Head and torso bones, a box and a
// vertex centroid per material with the skinning applied. And after the game's
// own poseIdle: the Head and torso again, and how many bones it left off the
// rest pose (see measure() for why those are separate numbers). BASELINE is
// the first six measured the same way from the original .gltf files at
// afbcae9, before the pipeline ran.
//
// The last block builds the twelve students the way main.js does and holds
// them to the same pose, because poseIdle keeping its pose is worth nothing if
// buildCharacterBody or the reactions tween puts the rest pose back (#882).
//
//   node characters.mjs           check the outfits against BASELINE
//   node characters.mjs --print   print what the current files measure

import './three-hook.mjs';
import fs from 'fs';

const THREE = await import('../src/three.js');
const { createModelLoader, poseIdle, findBone } = await import('../src/world/models.js');
const { buildStudents, createReactions } = await import('../src/world/students.js');
const { createMaterials, createRegistry } = await import('../src/world/materials.js');
const { createChart } = await import('../src/systems/chart.js');

// FileLoader builds a Request from the relative URL the game passes and
// fetches it. Node refuses a relative Request, so both are answered from disk
// here, relative to the project root, the way the page's own server would.
// A data: URI (what the original embedded .gltf files were made of) goes to
// Node's own fetch, which reads those fine.
const nodeFetch = globalThis.fetch;
globalThis.Request = class { constructor(url) { this.url = url; } };
globalThis.fetch = async req => {
  if (req.url.startsWith('data:')) return nodeFetch(req.url);
  const file = '../' + decodeURI(req.url);
  if (!fs.existsSync(file)) return new Response('', { status: 404 });
  return new Response(fs.readFileSync(file), { status: 200 });
};

const manifest = JSON.parse(fs.readFileSync('../data/assets.json', 'utf8'));
const outfits = manifest.characters.outfits;
const keyOf = p => (p.includes('Women') ? 'W/' : 'M/') + p.split('/').pop().replace(/\.gl(tf|b)$/, '');

const r4 = v => v.toArray().map(x => +x.toFixed(4));

export async function measure(path) {
  const loader = createModelLoader();
  // The rest pose, as the file has it. BASELINE's box, bones and materials
  // were measured after a poseIdle() that put the rest pose back (see below),
  // so this is the same skeleton they were measured on.
  const { root, animations } = await loader.loadRigged(path);
  root.updateWorldMatrix(true, true);
  const byMat = {};
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const name = o.material.name;
    const m = byMat[name] ??= { box: new THREE.Box3(), sum: new THREE.Vector3(), n: 0 };
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // getVertexPosition already applies the bone transform to a
      // SkinnedMesh (three r160). Calling applyBoneTransform after it skins
      // the vertex twice: near-invisible on the originals, whose idle is
      // close to the bind pose, and 1.1 m wrong on a quantized mesh, whose
      // dequantization lives in the inverse bind matrices.
      o.getVertexPosition(i, v);
      v.applyMatrix4(o.matrixWorld);
      m.box.expandByPoint(v);
      m.sum.add(v);
      m.n++;
    }
  });
  const materials = {};
  for (const [name, m] of Object.entries(byMat).sort()) {
    materials[name] = { min: r4(m.box.min), max: r4(m.box.max), mean: r4(m.sum.divideScalar(m.n)) };
  }
  const box = new THREE.Box3().setFromObject(root);

  // The clip, through the game's own poseIdle(). Until #882 poseIdle played
  // the Idle clip for 1.2 s and then called stopAllAction(), and deactivating
  // an action makes AnimationMixer restore every binding's original state:
  // the student ended up in the file's rest pose, whichever clip it sampled
  // (keeping "Death" instead of "Idle" left everything above green to the
  // tenth of a millimetre). clipHead and clipTorso were baselined for the day
  // that was fixed, from a mixer this file drove itself. They are poseIdle's
  // own output now, so a clip damaged by compression is still caught, and so
  // is a poseIdle that goes back to ending in the rest pose.
  const again = await loader.loadRigged(path);
  poseIdle(again.root, again.animations);

  // How much of the skeleton the pose is. Local quaternions, bone by bone,
  // against the rest pose above: 42 of the men's 62 bones and 37 of the
  // women's are more than a milliradian off it at 1.2 s, the furthest by 0.20
  // and 0.22 rad (a finger joint in both).
  const local = r => { const o = {}; r.traverse(n => { if (n.isBone) o[n.name] = n.quaternion; }); return o; };
  const restQ = local(root), posedQ = local(again.root);
  const moved = Object.keys(restQ).filter(k => restQ[k].angleTo(posedQ[k]) > 1e-3).length;
  const headPitch = findBone(again.root, ['Head']).rotation.x;
  const torsoPitch = findBone(again.root, ['Chest', 'Spine1', 'Spine', 'Hips']).rotation.x;

  const bones = r => [findBone(r, ['Head']), findBone(r, ['Chest', 'Spine1', 'Spine', 'Hips'])]
    .map(b => r4(b.getWorldPosition(new THREE.Vector3())));
  const [head, torso] = bones(root);
  const [clipHead, clipTorso] = bones(again.root);
  return { clips: animations.map(a => a.name), box: [r4(box.min), r4(box.max)], head, torso, clipHead, clipTorso,
    moved, bones: Object.keys(restQ).length, headPitch, torsoPitch, materials };
}

if (process.argv.includes('--print')) {
  const out = {};
  for (const p of outfits) {
    const m = await measure(p);
    out[keyOf(p)] = { box: m.box, head: m.head, torso: m.torso, clipHead: m.clipHead, clipTorso: m.clipTorso, materials: m.materials };
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

let fails = 0;
function check(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }

// Measured from the original .gltf files at afbcae9 by `--print`, before the
// pipeline ran. Metres, in the model's own space, before fitHeight scales it.
const BASELINE = {
  'M/Casual_2': {
    box: [[-0.2655, -0.0015, -0.1708], [0.3309, 1.8144, 0.472]], head: [0.0039, 1.5471, 0.0939], torso: [0.0044, 1.339, 0.0659],
    clipHead: [0.0039, 1.5523, 0.0906], clipTorso: [0.0044, 1.3438, 0.0659],
    materials: {
      "Eye": { min: [-0.0535, 1.6358, 0.188], max: [0.0606, 1.662, 0.2173], mean: [0.0035, 1.6489, 0.2027] },
      "Eyebrows": { min: [-0.0638, 1.6523, 0.2015], max: [0.0707, 1.6662, 0.2263], mean: [0.0035, 1.6593, 0.2141] },
      "Hair": { min: [-0.1087, 1.5286, -0.1138], max: [0.1161, 1.8144, 0.2198], mean: [0.004, 1.6814, 0.0706] },
      "LightBlue": { min: [-0.1357, 0.1159, -0.1461], max: [0.2489, 1.0068, 0.3124], mean: [0.0323, 0.6562, 0.0806] },
      "LightBrown": { min: [-0.2519, 0.9844, -0.0711], max: [0.2581, 1.5233, 0.1931], mean: [0.0081, 1.317, 0.0796] },
      "Red_Dark": { min: [-0.1203, 0.0276, -0.1692], max: [0.3309, 0.2452, 0.472], mean: [0.0468, 0.1059, 0.0982] },
      "Skin": { min: [-0.2655, 0.7427, -0.0507], max: [0.2892, 1.7852, 0.2748], mean: [0.022, 1.0178, 0.0993] },
      "Skin_Darker": { min: [-0.0869, 1.5202, 0.1278], max: [0.0944, 1.669, 0.2083], mean: [0.0039, 1.5618, 0.1644] },
      "White": { min: [-0.1203, -0.0015, -0.1708], max: [0.3309, 0.1965, 0.472], mean: [0.0483, 0.0498, 0.1002] },
    }
  },
  'W/Casual': {
    box: [[-0.2511, -0.0086, -0.1687], [0.2731, 1.8009, 0.4508]], head: [-0.0137, 1.5477, 0.0878], torso: [-0.014, 1.3396, 0.06],
    clipHead: [-0.0137, 1.556, 0.0826], clipTorso: [-0.014, 1.3473, 0.06],
    materials: {
      "Brown": { min: [-0.0734, 1.6306, 0.1834], max: [0.0458, 1.6572, 0.2129], mean: [-0.0138, 1.6439, 0.1982] },
      "Grey": { min: [-0.0854, -0.0086, -0.1687], max: [0.2731, 0.1007, 0.4508], mean: [0.0574, 0.0279, 0.1145] },
      "Hair_Blond": { min: [-0.1316, 1.4875, -0.0467], max: [0.1022, 1.8009, 0.2501], mean: [-0.0067, 1.673, 0.0917] },
      "Hair_Brown": { min: [-0.0854, 1.6493, 0.1953], max: [0.0578, 1.6664, 0.2237], mean: [-0.0138, 1.6578, 0.211] },
      "Orange": { min: [-0.1638, 0.1345, -0.1202], max: [0.2288, 1.1016, 0.3192], mean: [0.0248, 0.652, 0.0902] },
      "Skin": { min: [-0.2511, 0.0766, -0.1354], max: [0.239, 1.742, 0.2783], mean: [0.0009, 0.957, 0.0954] },
      "White": { min: [-0.2164, 1.0551, -0.0095], max: [0.1848, 1.4833, 0.2105], mean: [-0.008, 1.3116, 0.1066] },
    }
  },
  'M/Worker': {
    box: [[-0.2655, -0.0038, -0.1662], [0.3309, 1.8222, 0.472]], head: [0.0039, 1.5471, 0.0939], torso: [0.0044, 1.339, 0.0659],
    clipHead: [0.0039, 1.5523, 0.0906], clipTorso: [0.0044, 1.3438, 0.0659],
    materials: {
      "Black": { min: [-0.1203, -0.0038, -0.1662], max: [0.3309, 0.039, 0.472], mean: [0.058, 0.0053, 0.1149] },
      "Brown": { min: [-0.1414, 0.1222, -0.1463], max: [0.2623, 1.0089, 0.3199], mean: [0.0326, 0.5929, 0.0809] },
      "Brown2": { min: [-0.1497, 0.4424, -0.0782], max: [0.2674, 1.0089, 0.3329], mean: [0.0432, 0.7152, 0.0996] },
      "Eye": { min: [-0.0535, 1.6358, 0.188], max: [0.0606, 1.662, 0.2173], mean: [0.0035, 1.6489, 0.2027] },
      "Eyebrows": { min: [-0.0904, 1.6054, -0.0014], max: [0.0982, 1.7852, 0.2263], mean: [0.0039, 1.702, 0.1096] },
      "Grey": { min: [-0.1203, 0.025, -0.1646], max: [0.3309, 0.2739, 0.472], mean: [0.0469, 0.1094, 0.0987] },
      "LightBrown": { min: [-0.252, 0.9716, -0.076], max: [0.2582, 1.4995, 0.1931], mean: [0.0099, 1.2491, 0.0796] },
      "Moustache": { min: [-0.0347, 1.567, 0.2009], max: [0.0421, 1.5917, 0.2177], mean: [0.0037, 1.5766, 0.2079] },
      "Skin": { min: [-0.2655, 0.7427, -0.0507], max: [0.2892, 1.715, 0.2748], mean: [0.0228, 0.9867, 0.101] },
      "Worker_Vest": { min: [-0.167, 0.9994, -0.0572], max: [0.1794, 1.5229, 0.1898], mean: [0.0062, 1.3801, 0.0708] },
      "Worker_Yellow": { min: [-0.1472, 1.0825, -0.0429], max: [0.162, 1.8222, 0.2947], mean: [0.0049, 1.6217, 0.1028] },
    }
  },
  'W/Formal': {
    box: [[-0.2509, -0.0001, -0.158], [0.2834, 1.8002, 0.4353]], head: [-0.0137, 1.5477, 0.0878], torso: [-0.014, 1.3396, 0.06],
    clipHead: [-0.0137, 1.556, 0.0826], clipTorso: [-0.014, 1.3473, 0.06],
    materials: {
      "Brown": { min: [-0.0853, 1.6305, 0.1834], max: [0.0577, 1.6663, 0.2237], mean: [-0.0138, 1.6525, 0.2062] },
      "Gold": { min: [-0.0983, 1.123, -0.0083], max: [0.1089, 1.1612, 0.163], mean: [0.0059, 1.1401, 0.0838] },
      "LimeGreen": { min: [-0.1923, 0.648, -0.1042], max: [0.2834, 1.4864, 0.3687], mean: [-0.0012, 1.1671, 0.1044] },
      "Red": { min: [-0.1339, -0.0001, -0.158], max: [0.2677, 1.8002, 0.4353], mean: [-0.0052, 1.5261, 0.0807] },
      "Skin": { min: [-0.2509, 0.0139, -0.1507], max: [0.2388, 1.742, 0.3884], mean: [0.0057, 0.9037, 0.0976] },
    }
  },
  'M/Adventurer': {
    box: [[-0.2673, -0.0025, -0.2508], [0.3309, 1.8158, 0.472]], head: [0.0039, 1.5471, 0.0939], torso: [0.0044, 1.339, 0.0659],
    clipHead: [0.0039, 1.5523, 0.0906], clipTorso: [0.0044, 1.3438, 0.0659],
    materials: {
      "Black": { min: [-0.1203, -0.0025, -0.1661], max: [0.3309, 0.04, 0.472], mean: [0.0601, 0.0067, 0.1128] },
      "Brown": { min: [-0.2142, 0.1222, -0.1463], max: [0.2628, 1.5691, 0.3253], mean: [0.0263, 0.8698, 0.0378] },
      "Brown2": { min: [-0.1497, 0.5579, -0.0782], max: [0.2575, 1.0103, 0.287], mean: [0.0274, 0.8229, 0.0743] },
      "Eye": { min: [-0.0535, 1.6358, 0.188], max: [0.0606, 1.662, 0.2173], mean: [0.0035, 1.6489, 0.2027] },
      "Eyebrows": { min: [-0.0638, 1.6523, 0.2015], max: [0.0707, 1.6662, 0.2263], mean: [0.0035, 1.6593, 0.2141] },
      "Gold": { min: [-0.1785, 1.2244, -0.2385], max: [0.1915, 1.4091, -0.0939], mean: [0.0064, 1.3103, -0.16] },
      "Green": { min: [-0.2673, 0.9502, -0.2279], max: [0.2703, 1.5254, 0.1958], mean: [0.0061, 1.3081, 0.0585] },
      "Grey": { min: [-0.1203, 0.026, -0.1645], max: [0.3309, 0.2217, 0.472], mean: [0.0468, 0.1139, 0.0986] },
      "Hair": { min: [-0.1048, 1.488, -0.0329], max: [0.1154, 1.8158, 0.2326], mean: [0.012, 1.6574, 0.1396] },
      "LightGreen": { min: [-0.1875, 0.9584, -0.2508], max: [0.2006, 1.5701, 0.2025], mean: [0.0091, 1.3124, -0.049] },
      "Skin": { min: [-0.2586, 0.7427, -0.0507], max: [0.2892, 1.7852, 0.2748], mean: [0.0218, 1.0259, 0.1012] },
    }
  },
  'W/Worker': {
    box: [[-0.2509, -0.0023, -0.1619], [0.2869, 1.8183, 0.4551]], head: [-0.0137, 1.5477, 0.0878], torso: [-0.014, 1.3396, 0.06],
    clipHead: [-0.0137, 1.556, 0.0826], clipTorso: [-0.014, 1.3473, 0.06],
    materials: {
      "Black": { min: [-0.083, -0.0023, -0.1619], max: [0.2869, 0.1231, 0.4551], mean: [0.0511, 0.0457, 0.1054] },
      "Brown": { min: [-0.0734, 1.6305, 0.1834], max: [0.0457, 1.657, 0.2129], mean: [-0.0138, 1.6437, 0.1982] },
      "Brown2": { min: [-0.1715, 0.4305, -0.089], max: [0.2425, 1.12, 0.321], mean: [0.028, 0.8098, 0.1026] },
      "Brown_02": { min: [-0.1703, 0.1325, -0.1452], max: [0.2307, 1.0707, 0.317], mean: [0.0241, 0.5329, 0.0836] },
      "DarkBrown": { min: [-0.1252, 1.5342, -0.0319], max: [0.0985, 1.7817, 0.2237], mean: [-0.0134, 1.6499, 0.0835] },
      "Skin": { min: [-0.2509, 0.0771, -0.1262], max: [0.2388, 1.7124, 0.2809], mean: [0.0018, 0.9322, 0.0966] },
      "White": { min: [-0.221, 1.1062, -0.0186], max: [0.1891, 1.4765, 0.2139], mean: [-0.0072, 1.2992, 0.1028] },
      "Worker_Vest": { min: [-0.1316, 1.1322, -0.0101], max: [0.1117, 1.482, 0.2139], mean: [-0.0109, 1.339, 0.1168] },
      "Worker_Yellow": { min: [-0.1543, 1.1884, -0.0386], max: [0.1292, 1.8183, 0.2923], mean: [-0.0127, 1.6421, 0.1078] },
    }
  },
  'M/Casual_Hoodie': {
    box: [[-0.2735, -0.0043, -0.171], [0.3309, 1.8239, 0.472]], head: [0.0039, 1.5471, 0.0939], torso: [0.0044, 1.339, 0.0659],
    clipHead: [0.0039, 1.5523, 0.0906], clipTorso: [0.0044, 1.3438, 0.0659],
    materials: {
      "Eye": { min: [-0.0535, 1.6358, 0.188], max: [0.0606, 1.662, 0.2173], mean: [0.0035, 1.6489, 0.2027] },
      "Eyebrows": { min: [-0.0638, 1.6523, 0.2015], max: [0.0707, 1.6685, 0.2266], mean: [0.0035, 1.6607, 0.2152] },
      "Hair": { min: [-0.1099, 1.5905, -0.025], max: [0.1175, 1.8239, 0.2335], mean: [0.0037, 1.7066, 0.1199] },
      "LightBlue": { min: [-0.1505, 0.5821, -0.0871], max: [0.2566, 1.0178, 0.3014], mean: [0.0261, 0.8547, 0.0725] },
      "Purple": { min: [-0.2735, 0.0194, -0.171], max: [0.3309, 1.5411, 0.472], mean: [0.0163, 1.0602, 0.0796] },
      "Skin": { min: [-0.2401, 0.1113, -0.1272], max: [0.2892, 1.7852, 0.312], mean: [0.0277, 0.9361, 0.1058] },
      "White": { min: [-0.1203, -0.0043, -0.171], max: [0.3309, 0.1409, 0.472], mean: [0.0464, 0.0498, 0.0974] },
    }
  },
  'W/Adventurer': {
    box: [[-0.2554, -0.0017, -0.1954], [0.2624, 1.7862, 0.4394]], head: [-0.0137, 1.5477, 0.0878], torso: [-0.014, 1.3396, 0.06],
    clipHead: [-0.0137, 1.556, 0.0826], clipTorso: [-0.014, 1.3473, 0.06],
    materials: {
      "Brown": { min: [-0.0734, 1.6305, 0.1834], max: [0.0457, 1.657, 0.2129], mean: [-0.0138, 1.6437, 0.1982] },
      "Brown2": { min: [-0.1839, -0.0017, -0.1718], max: [0.2614, 1.1269, 0.4384], mean: [0.0325, 0.4872, 0.0952] },
      "Brown_02": { min: [-0.1801, 0.0093, -0.1754], max: [0.2624, 1.0957, 0.4394], mean: [0.0275, 0.485, 0.0871] },
      "Gold": { min: [-0.1328, 1.065, -0.1839], max: [0.1632, 1.3914, 0.1848], mean: [0.0008, 1.2341, -0.045] },
      "Green": { min: [-0.2279, 1.2732, -0.1738], max: [0.1981, 1.5425, 0.1611], mean: [-0.0137, 1.4443, -0.0038] },
      "Hair_Brown": { min: [-0.1143, 1.5995, -0.0004], max: [0.0877, 1.7862, 0.227], mean: [-0.0133, 1.6896, 0.1128] },
      "LightGreen": { min: [-0.2218, 1.0353, -0.1954], max: [0.1909, 1.5435, 0.2147], mean: [-0.0039, 1.2735, 0.0247] },
      "Skin": { min: [-0.2331, 0.343, -0.093], max: [0.2388, 1.7146, 0.3154], mean: [0.0047, 0.941, 0.1033] },
      "White": { min: [-0.2554, 0.3823, -0.0857], max: [0.2329, 1.3275, 0.2947], mean: [-0.0056, 1.0465, 0.0587] },
    }
  },
};

// Measured 2026-09-24 against the files the pipeline wrote: the worst
// per-material box moved 0.2 mm, the worst centroid 0.1 mm, the whole body's box
// 0.1 mm, the rest-pose bones not at all, and the Idle clip's bones 0.3 mm. A
// millimetre is three times the worst of that and a fraction of a pixel on a
// student at the back row. The clip's own offset from the rest pose is up to
// 8.3 mm in these eight, so a different clip, or none, cannot hide inside it.
const TOL = 0.001;
const near = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= TOL);

check('eight outfits in the manifest', outfits.length === 8);
check('every outfit is a .glb the pipeline wrote',
  outfits.every(p => p.endsWith('.glb')));

// Reads a .glb's JSON chunk without three: 12-byte header, then the chunk.
function glbJson(p) {
  const b = fs.readFileSync('../' + p);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
check('every outfit requires EXT_meshopt_compression, so the decoder is load-bearing',
  outfits.every(p => (glbJson(p).extensionsRequired || []).includes('EXT_meshopt_compression')));

const idle = {};
for (const p of outfits) {
  const k = keyOf(p);
  const want = BASELINE[k];
  let got = null;
  try { got = await measure(p); }
  catch (err) { console.log(`        ${k}: ${err.message}`); }
  check(`${k} loads through the game's own loader`, !!got);
  if (!got || !want) { check(`${k} has a baseline`, !!want); continue; }

  check(`${k} carries exactly one clip, Idle`, got.clips.length === 1 && got.clips[0] === 'Idle');
  check(`${k} stands in the same box`, near(got.box[0], want.box[0]) && near(got.box[1], want.box[1]));
  check(`${k} has its Head and torso where they were`, near(got.head, want.head) && near(got.torso, want.torso));
  check(`${k}: poseIdle leaves the Head and torso where the Idle clip puts them`,
    near(got.clipHead, want.clipHead) && near(got.clipTorso, want.clipTorso));
  // 37 and 42 measured; 30 is under both and nowhere near the 0 a pose that
  // was put back measures.
  check(`${k}: poseIdle leaves the skeleton in a pose, not in the rest pose (${got.moved} of ${got.bones} bones off it)`,
    got.moved >= 30);
  idle[p] = got;
  const names = Object.keys(got.materials).join();
  check(`${k} has the same materials`, names === Object.keys(want.materials).join());
  const off = Object.entries(want.materials).filter(([m, w]) => {
    const g = got.materials[m];
    return !g || !near(g.min, w.min) || !near(g.max, w.max) || !near(g.mean, w.mean);
  }).map(([m]) => m);
  check(`${k}: every material's vertices are where they were`, off.length === 0);
  if (off.length) console.log('        moved: ' + off.join(', '));
}

// ---------------------------------------------------------------------------
// The room. Twelve students built by buildStudents, the way main.js builds
// them, then one frame of the reactions tween with nothing playing. What a
// headless run can say about a pose is where the bones are, so that is what
// this says: nobody has looked at it in a window (root CLAUDE.md, #53).
// ---------------------------------------------------------------------------
{
  const D = f => JSON.parse(fs.readFileSync(`../data/${f}.json`, 'utf8'));
  const sData = D('students');
  const chart = createChart({
    seatGrid: sData.seatGrid, room: D('room'), roster: sData.roster,
    tellTypes: D('tells').types, rules: D('seating').rules,
    plan: D('seating').plan.furniture, saved: null, layout: null
  });
  const scene = new THREE.Scene();
  // No `models` in the manifest handed over: the desks and chairs fall back
  // to boxes, which is not what is being measured.
  const students = await buildStudents(scene, createRegistry(), createMaterials(), sData, chart,
    { loader: createModelLoader(), assets: { characters: manifest.characters } });
  const camera = { position: new THREE.Vector3(0, 1.65, -2.4) };
  const reactions = createReactions({ students, data: D('reactions'), camera });
  const outfitOf = s => idle[outfits[s.seat % outfits.length]];

  check('all twelve students get a rigged body', students.length === 12 && students.every(s => s.head.isBone && s.torso.isBone));

  reactions.tick(0);
  scene.updateMatrixWorld(true);
  const EPS = 1e-6;
  const off = (s, f) => { if (!f(s)) console.log(`        ${s.name}`); return f(s); };
  check('the pitch a student rests at is the Idle clip\'s, head and chest',
    students.every(s => off(s, s => outfitOf(s)
      && Math.abs(s.headRestX - outfitOf(s).headPitch) < EPS && Math.abs(s.torsoRestX - outfitOf(s).torsoPitch) < EPS)));
  check('and one frame of the tween with nothing playing leaves both there',
    students.every(s => off(s, s => Math.abs(s.head.rotation.x - s.headRestX) < EPS && Math.abs(s.torso.rotation.x - s.torsoRestX) < EPS)));

  // The bones reactions.js does not drive are the ones that would show a pose
  // put back: an arm, a hand. Count them the way measure() does, against a
  // fresh rest-pose copy of the same outfit.
  const loader = createModelLoader();
  const stillPosed = [];
  for (const s of students) {
    const rest = {};
    (await loader.loadRigged(outfits[s.seat % outfits.length])).root.traverse(n => { if (n.isBone) rest[n.name] = n.quaternion; });
    let moved = 0;
    s.group.traverse(n => { if (n.isBone && n !== s.head && n !== s.torso && rest[n.name].angleTo(n.quaternion) > 1e-3) moved++; });
    stillPosed.push(moved);
  }
  check(`and the rest of each skeleton is still off the rest pose (${Math.min(...stillPosed)} to ${Math.max(...stillPosed)} bones)`,
    stillPosed.every(n => n >= 30));

  // poseIdle runs before fitHeight and the floor settle, and both measure the
  // posed body: a student is targetHeight tall in the pose it stands in, with
  // its lowest vertex on the floor. The group's idle bob is taken back out.
  const target = manifest.characters.targetHeight || 1.48;
  check(`every student is ${target} m tall in the Idle pose and stands on the floor`,
    students.every(s => off(s, s => {
      // A SkinnedMesh caches the box it was first asked for, which is the
      // one fitHeight took. Measured again here from the bones as they are,
      // or this would read fitHeight's own answer back to it.
      s.group.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
      const b = new THREE.Box3().setFromObject(s.group.children.find(c => c.type !== 'Mesh'));
      return Math.abs((b.max.y - b.min.y) - target) < TOL && Math.abs(b.min.y - s.group.position.y) < TOL;
    })));
}

console.log(fails ? `\n${fails} FAILURES` : '\nall green');
process.exit(fails ? 1 : 0);
