// play-castle.mjs — end-to-end smoke test for Castle Conundrum.
//
// Plays the whole game with real input: pointer lock, WASD, E presses, typing into
// the riddle box. Asserts every beat of the quest chain and exits 1 on the first
// one that doesn't happen. Screenshots land in ./shots/play/ for eyeballing.
//
// WHY THIS EXISTS: sessions 2, 3 and 4 each verified Castle Conundrum by reading
// the code and checking the first frame, because the sandboxed browser they had
// couldn't acquire pointer lock. Nobody had actually pressed E on the Scholar.
// When session 5 finally did, it immediately found the Guard standing sealed
// inside the gatehouse wall — the interact prompt appeared happily on blank stone,
// because interaction.js tests proximity and facing but never line of sight.
// That class of bug is invisible to every other check in this folder.
//
// WHY HEADED: pointer lock needs a browser compositing frames to a real screen,
// and so does GPU rendering. `launch({ headed: true })` is the whole difference.
// A window will open and visibly play the game. That is expected.
//
// npm run play

import { serve, launch, prepPage } from './harness.mjs';
import { attachSceneProbe, waitForProbe, walkTo as driveTo } from './drive.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots', 'play');
const PORT = 8124; // not 8123 — so this can run alongside the other checks
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = `${BASE}/Projects/Castle%20Conundrum/`;
// Must match what the game's import map resolves 'three' to, or the probe patches
// a second copy of the module and captures nothing.
const THREE_URL = '/Projects/Castle%20Conundrum/libs/three.module.js';

// Where the NPCs stand, per data/npcs.json. If those move, move these.
const SCHOLAR = [1.5, -10.0];
const GUARD = [1.8, 9.2];

// Geometry the placement beats below check against. Measured from the live scene,
// not read off the config: every one of these models arrives at its own authored
// scale, so the hall "table" is 0.55 m tall and the "stool" next to it is 0.18 m.
const HALL_TABLE = { min: [-0.9, 0, -10.33], max: [0.9, 0.55, -9.67] };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
let shotN = 0;

const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); };
const assert = (cond, label, detail = '') => (cond ? ok(label, detail) : bad(label, detail));

const server = await serve(PORT);
const browser = await launch({ headed: true });
const page = await prepPage(browser, BASE, { width: 1200, height: 800, dsf: 1 });

const snap = async (label) => {
  await page.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`) });
};

/** Everything the assertions need, read straight off the live DOM + camera. */
const state = () => page.evaluate(() => {
  const c = window.__cam;
  const hidden = (id) => document.getElementById(id).classList.contains('hidden');
  const text = (id) => document.getElementById(id).textContent;
  return {
    pos: [+c.position.x.toFixed(2), +c.position.z.toFixed(2)],
    prompt: hidden('interact-prompt') ? null : text('interact-prompt'),
    dialogueOpen: !hidden('dialogue-box'),
    dialogueName: text('dialogue-name'),
    dialogueText: text('dialogue-text'),
    riddleOpen: !hidden('riddle-overlay'),
    victoryOpen: !hidden('victory-screen'),
    objective: text('quest-objective'),
    locked: !!document.pointerLockElement,
  };
});

/** Walk until the interact prompt names `who`. drive.mjs owns the aim/strafe loop. */
const walkTo = (target, who) =>
  driveTo(page, target, async () => (await state()).prompt?.includes(who));

console.log('playing Castle Conundrum end to end\n');

try {
  await page.goto(GAME, { waitUntil: 'load' });
  await page.waitForSelector('#start-overlay:not(.hidden)', { timeout: 90000 });
  const loadStatus = await page.textContent('#loading-status');
  ok('reached the start screen', loadStatus);

  // Live scene + camera handles. See drive.mjs for why this has to patch
  // Object3D.prototype rather than WebGLRenderer.prototype.render.
  await attachSceneProbe(page, THREE_URL);
  await waitForProbe(page);

  // --- The three NPCs built, and their rigs are actually bound to their own bones.
  // Object3D.clone() on a SkinnedMesh keeps the ORIGINAL skeleton, which leaves the
  // body frozen while the mixer happily runs. assets.js clones via SkeletonUtils to
  // avoid that; this is the assertion that keeps it that way.
  const rigs = await page.evaluate(async () => {
    const s = window.__scene;
    const groups = new Map();
    s.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let root = o;
      while (root.parent && root.parent !== s) root = root.parent;
      let boneRoot = o.skeleton?.bones?.[0];
      while (boneRoot?.parent) boneRoot = boneRoot.parent;
      if (!groups.has(root)) groups.set(root, { rebound: boneRoot === s });
      if (boneRoot !== s) groups.get(root).rebound = false;
    });
    const hands = [];
    s.traverse((o) => { if (o.isBone && /^wrist\.?r$/i.test(o.name)) hands.push(o); });
    const before = JSON.stringify(hands.map((b) => b.matrixWorld.elements.slice(12, 15)));
    await new Promise((r) => setTimeout(r, 700));
    const after = JSON.stringify(hands.map((b) => b.matrixWorld.elements.slice(12, 15)));
    return {
      count: groups.size,
      allRebound: [...groups.values()].every((g) => g.rebound),
      handBones: hands.length,
      animating: before !== after,
    };
  });
  assert(rigs.count === 3, 'three rigged NPC bodies in the scene', `found ${rigs.count}`);
  assert(rigs.allRebound, 'every skeleton rebound into the scene tree (SkeletonUtils clone)');
  assert(rigs.animating, 'rigs are animating', `${rigs.handBones} hand bones tracked`);

  // --- Textures are sampled for a 64 px pixel-art kit, not smeared across a 4 m wall.
  // The Kenney retro kit's glTF samplers declare minFilter and nothing else, so
  // GLTFLoader defaults magFilter to LinearFilter and bilinearly interpolates a
  // 64x64 cobblestone over 4 m of stone. That is the "blurry walls" report that
  // stood open from v6 §8 to v7 §8. assets.js now gives every texture the GPU's
  // anisotropy ceiling and switches magnification to NEAREST for anything 128 px
  // or smaller. Both halves are asserted because they fail independently: drop
  // setTextureQuality() and anisotropy silently returns to 1 while the walls stay
  // crisp; drop the NEAREST branch and the smear comes back at full anisotropy.
  const sampling = await page.evaluate(async () => {
    const THREE = await import('/Projects/Castle%20Conundrum/libs/three.module.js');
    const seen = new Set();
    const all = [];
    const SLOTS = ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'];
    window.__scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material || [])) {
        for (const k of SLOTS) {
          const t = m?.[k];
          if (!t || seen.has(t.uuid)) continue;
          seen.add(t.uuid);
          all.push({ px: Math.max(t.image?.width || 0, t.image?.height || 0), mag: t.magFilter, aniso: t.anisotropy });
        }
      }
    });
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    const cap = ext ? gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    const small = all.filter((t) => t.px > 0 && t.px <= 128);
    const large = all.filter((t) => t.px > 128);
    return {
      cap,
      total: all.length,
      small: small.length,
      large: large.length,
      smallAllNearest: small.length > 0 && small.every((t) => t.mag === THREE.NearestFilter),
      largeAllLinear: large.length > 0 && large.every((t) => t.mag === THREE.LinearFilter),
      allAtCap: all.length > 0 && all.every((t) => t.aniso === cap),
      worstAniso: Math.min(...all.map((t) => t.aniso)),
    };
  });
  assert(sampling.smallAllNearest, 'every pixel-art texture magnifies NEAREST',
    `${sampling.small} textures at <=128px`);
  assert(sampling.largeAllLinear, 'the 1k Poly Haven maps still magnify LINEAR',
    `${sampling.large} textures over 128px`);
  assert(sampling.allAtCap, 'every texture is at the GPU anisotropy ceiling',
    `cap ${sampling.cap}, worst ${sampling.worstAniso}, ${sampling.total} textures`);

  // --- Nothing in the hall is standing in mid-air or inside the furniture.
  // Two separate bugs, one check: the lantern and the candleholders carried
  // `yOffset: 0.95` against a 0.55 m table and hung 0.40 m above it, and the
  // Scholar stood 0.57 m inside that same table. castle-builder now measures the
  // surface under a prop instead of trusting a typed-in height, so this asserts
  // the measurement, not the number that came out of it.
  const hall = await page.evaluate(async ({ table, scholar }) => {
    const THREE = await import('/Projects/Castle%20Conundrum/libs/three.module.js');
    const s = window.__scene;
    const tableBox = new THREE.Box3(new THREE.Vector3(...table.min), new THREE.Vector3(...table.max));

    // Tabletop items: the ones sitting above the table's base whose footprint is
    // MOSTLY over it. "Mostly" is doing real work — the gothic statue stands on the
    // floor behind the table and its 1.56 m footprint clips the table's z range by
    // 0.12 m, so an any-overlap test calls a correctly placed statue a tabletop
    // item floating 1.74 m in the air.
    const resting = [];
    for (const c of s.children) {
      const b = new THREE.Box3().setFromObject(c);
      if (!isFinite(b.min.x) || b.min.y < 0.2) continue;
      const ox = Math.min(b.max.x, tableBox.max.x) - Math.max(b.min.x, tableBox.min.x);
      const oz = Math.min(b.max.z, tableBox.max.z) - Math.max(b.min.z, tableBox.min.z);
      if (ox <= 0 || oz <= 0) continue;
      const covered = (ox * oz) / Math.max(1e-6, (b.max.x - b.min.x) * (b.max.z - b.min.z));
      if (covered < 0.5) continue;
      resting.push({
        gap: +(b.min.y - tableBox.max.y).toFixed(3),
        // fully supported, i.e. no part of it hangs off the table
        overhang: +Math.max(
          tableBox.min.x - b.min.x, b.max.x - tableBox.max.x,
          tableBox.min.z - b.min.z, b.max.z - tableBox.max.z, 0
        ).toFixed(3),
      });
    }

    // The Scholar's own body box against the table.
    let body = null;
    s.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let r = o;
      while (r.parent && r.parent !== s) r = r.parent;
      const b = new THREE.Box3().setFromObject(r);
      const c = b.getCenter(new THREE.Vector3());
      if (Math.hypot(c.x - scholar[0], c.z - scholar[1]) < 1.2) body = b;
    });
    const clip = body
      ? +Math.min(
          Math.min(body.max.x, tableBox.max.x) - Math.max(body.min.x, tableBox.min.x),
          Math.min(body.max.z, tableBox.max.z) - Math.max(body.min.z, tableBox.min.z)
        ).toFixed(3)
      : null;

    // Braziers: every emissive coal has iron under it, the iron reaches the floor,
    // and the whole thing is standing somewhere a player can see rather than sealed
    // inside a wall. That last one is v5 decision 26 applied to scenery instead of
    // to an NPC: a PointLight is not occluded by geometry in this renderer, so both
    // gate braziers lit the courtyard convincingly from inside 4 m of solid stone.
    const stoneBoxes = [];
    for (const c of s.children) {
      const b = new THREE.Box3().setFromObject(c);
      if (!isFinite(b.min.x)) continue;
      if (b.max.y - b.min.y < 1.5) continue;     // scenery, not structure
      if (b.max.x - b.min.x > 100) continue;     // the ground plane
      let skinned = false;
      c.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
      if (skinned) continue;
      stoneBoxes.push({ box: b, name: c.name || c.type });
    }
    const braziers = [];
    for (const c of s.children) {
      let coal = null;
      c.traverse((o) => { if (o.isMesh && o.material?.emissiveIntensity > 1) coal = o; });
      if (!coal) continue;
      const whole = new THREE.Box3().setFromObject(c);
      const coalBox = new THREE.Box3().setFromObject(coal);
      const bowl = coalBox.getCenter(new THREE.Vector3());
      let solid = 0;
      c.traverse((o) => { if (o.isMesh && o !== coal) solid++; });
      braziers.push({
        floor: +whole.min.y.toFixed(3),
        coalY: +coalBox.min.y.toFixed(3),
        parts: solid,
        at: [+bowl.x.toFixed(1), +bowl.z.toFixed(1)],
        inside: stoneBoxes.find((sb) => sb.box.containsPoint(bowl))?.name || null,
      });
    }
    return { resting, clip, braziers };
  }, { table: HALL_TABLE, scholar: SCHOLAR });

  // 5 mm, not 0: Box3.setFromObject walks transformed vertices, so a surface and the
  // thing resting on it round to within about a millimetre of each other, not to zero.
  assert(hall.resting.length >= 2 && hall.resting.every((r) => Math.abs(r.gap) <= 0.005),
    'every tabletop item rests on the table, not above it',
    `${hall.resting.length} items, gaps ${hall.resting.map((r) => r.gap).join('/')}`);
  assert(hall.resting.every((r) => r.overhang <= 0), 'no tabletop item overhangs the table',
    `worst overhang ${Math.max(0, ...hall.resting.map((r) => r.overhang))}m`);
  assert(hall.clip !== null && hall.clip <= 0, 'the Scholar is standing clear of the hall table',
    hall.clip === null ? 'never found his body' : `${hall.clip > 0 ? hall.clip + 'm INSIDE it' : Math.abs(hall.clip) + 'm clear'}`);
  assert(hall.braziers.length === 3 && hall.braziers.every((b) => b.floor < 0.02 && b.parts >= 5),
    'every brazier has a stand that reaches the floor',
    hall.braziers.map((b) => `coal@${b.coalY} base@${b.floor} ${b.parts}parts`).join(' '));
  assert(hall.braziers.length === 3 && hall.braziers.every((b) => !b.inside),
    'no brazier is sealed inside the stonework',
    hall.braziers.map((b) => `${JSON.stringify(b.at)}${b.inside ? ' IN ' + b.inside : ''}`).join(' '));

  // --- Start. A real trusted click is what pointer lock requires.
  await page.click('#start-button');
  await page.waitForTimeout(600);
  let s = await state();
  assert(s.locked, 'pointer lock engaged');
  if (!s.locked) throw new Error('without pointer lock there is nothing left to test — is this running headed?');

  // --- Real mouse movement drives the look.
  const yaw0 = await page.evaluate(() => +window.__cam.rotation.y.toFixed(4));
  await page.mouse.move(700, 400);
  await page.mouse.move(500, 400);
  await page.waitForTimeout(200);
  const yaw1 = await page.evaluate(() => +window.__cam.rotation.y.toFixed(4));
  assert(yaw0 !== yaw1, 'mouse look turns the camera', `${yaw0} -> ${yaw1}`);

  // --- Scholar.
  const toScholar = await walkTo(SCHOLAR, 'Scholar');
  assert(!!toScholar, 'walked to the Scholar', toScholar ? `${toScholar.dist}m after ${toScholar.bursts} bursts` : 'never got in range');
  await snap('at-scholar');
  if (!toScholar) throw new Error('cannot continue without reaching the Scholar');

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  s = await state();
  assert(s.dialogueOpen && s.dialogueName === 'Scholar', 'E opened the Scholar dialogue', s.dialogueName);
  await snap('scholar-dialogue');

  for (let i = 0; i < 5 && !(await state()).riddleOpen; i++) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(350);
  }
  s = await state();
  assert(s.riddleOpen, 'dialogue ran out into the riddle overlay');
  assert(!s.locked, 'pointer lock released so the answer can be typed');
  await snap('riddle');
  if (!s.riddleOpen) throw new Error('no riddle, no keystone, no point continuing');

  // Wrong answers: distinct responses, and the hint from the second one on.
  await page.fill('#riddle-input', 'a door');
  await page.press('#riddle-input', 'Enter');
  await page.waitForTimeout(300);
  const wrong1 = await page.textContent('#riddle-feedback');
  await page.fill('#riddle-input', 'the sky');
  await page.press('#riddle-input', 'Enter');
  await page.waitForTimeout(300);
  const wrong2 = await page.textContent('#riddle-feedback');
  assert(!!wrong1 && wrong1 !== wrong2, 'wrong answers give escalating responses');
  assert(/Hint:/.test(wrong2), 'the second wrong answer adds the hint');

  await page.fill('#riddle-input', 'Keyboard');
  await page.press('#riddle-input', 'Enter');
  await page.waitForTimeout(700);
  s = await state();
  assert(!s.riddleOpen, 'the right answer closed the riddle');
  assert(/Keystone/.test(s.objective), 'objective advanced to the Keystone', JSON.stringify(s.objective));
  assert(s.locked, 'pointer lock re-acquired after the overlay');
  await snap('keystone');

  // --- Guard.
  if (!s.locked) { await page.click('#start-button'); await page.waitForTimeout(400); }
  const toGuard = await walkTo(GUARD, 'Guard');
  assert(!!toGuard, 'walked to the Guard', toGuard ? `${toGuard.dist}m after ${toGuard.bursts} bursts` : 'never got in range');
  await snap('at-guard');
  if (!toGuard) throw new Error('cannot continue without reaching the Guard');

  // He is standing where the player can SEE him, not sealed inside the gatehouse.
  // interaction.js has no line-of-sight test, so the prompt above proves nothing.
  const visible = await page.evaluate(async ({ gx, gz }) => {
    const THREE = await import('/Projects/Castle%20Conundrum/libs/three.module.js');
    const s = window.__scene, cam = window.__cam;
    const npcRoots = new Set();
    s.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let r = o;
      while (r.parent && r.parent !== s) r = r.parent;
      npcRoots.add(r);
    });
    const world = s.children.filter((c) => !npcRoots.has(c));
    const from = cam.position.clone();
    const to = new THREE.Vector3(gx, 1.2, gz);
    const dist = from.distanceTo(to);
    const ray = new THREE.Raycaster(from, new THREE.Vector3().subVectors(to, from).normalize(), 0.01, dist);
    const blocker = ray.intersectObjects(world, true).find((h) => h.distance < dist - 0.05);
    return { dist: +dist.toFixed(2), blockedBy: blocker?.object.name || null };
  }, { gx: GUARD[0], gz: GUARD[1] });
  assert(!visible.blockedBy, 'the Guard is actually visible from interact range',
    visible.blockedBy ? `blocked by ${visible.blockedBy}` : `${visible.dist}m, clear`);

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  s = await state();
  assert(s.dialogueOpen && s.dialogueName === 'Guard', 'E opened the Guard dialogue', s.dialogueName);

  for (let i = 0; i < 5 && (await state()).dialogueOpen; i++) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(350);
  }
  s = await state();
  assert(/gate is open/i.test(s.objective), 'the gate opened', JSON.stringify(s.objective));
  await snap('gate-opening');

  let victory = true;
  await page.waitForFunction(
    () => !document.getElementById('victory-screen').classList.contains('hidden'),
    null, { timeout: 10000 }
  ).catch(() => { victory = false; });
  assert(victory, 'victory screen appeared');
  await page.waitForTimeout(400);
  await snap('victory');

  // --- Nothing broke, and nothing reached for a CDN.
  assert(page.__errs.length === 0, 'no page/console errors', page.__errs.slice(0, 4).join(' | '));
  assert(page.__blocked.length === 0, 'no offsite requests', page.__blocked.slice(0, 4).join(' | '));
} catch (err) {
  failures++;
  console.log(`\n  ABORTED  ${err.message}`);
  await snap('aborted').catch(() => {});
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures ? `${failures} failure(s)` : 'all beats passed'} — shots in ${path.relative(HERE, OUT)}`);
process.exit(failures ? 1 : 0);
