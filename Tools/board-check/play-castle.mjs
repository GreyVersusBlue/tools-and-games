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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots', 'play');
const PORT = 8124; // not 8123 — so this can run alongside the other checks
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = `${BASE}/Projects/Castle%20Conundrum/`;

// Where the NPCs stand, per data/npcs.json. If those move, move these.
const SCHOLAR = [0.8, -9.6];
const GUARD = [1.8, 9.2];

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

/** Aim at a world x/z, then hold W in bursts until the interact prompt names `who`. */
async function walkTo([tx, tz], who) {
  let lastDist = null;
  for (let burst = 0; burst < 40; burst++) {
    const s = await state();
    const dist = Math.hypot(s.pos[0] - tx, s.pos[1] - tz);
    if (s.prompt?.includes(who)) return { burst, dist: +dist.toFixed(2) };

    // Aim by writing the camera yaw. PointerLockControls re-reads
    // camera.quaternion on every mousemove, so this composes with real mouse
    // input rather than fighting it — and it's far easier to aim than synthesized
    // pointer deltas. Camera forward is local -Z, hence the + PI.
    await page.evaluate(({ tx, tz }) => {
      const c = window.__cam;
      c.rotation.set(0, Math.atan2(tx - c.position.x, tz - c.position.z) + Math.PI, 0);
    }, { tx, tz });

    // Wedged on geometry? Strafe before trying forward again.
    if (lastDist !== null && Math.abs(lastDist - dist) < 0.05) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(220);
      await page.keyboard.up('KeyD');
    }
    lastDist = dist;

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(dist > 5 ? 400 : 130);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(60);
  }
  return null;
}

console.log('playing Castle Conundrum end to end\n');

try {
  await page.goto(GAME, { waitUntil: 'load' });
  await page.waitForSelector('#start-overlay:not(.hidden)', { timeout: 90000 });
  const loadStatus = await page.textContent('#loading-status');
  ok('reached the start screen', loadStatus);

  // A live camera handle. renderer.render is an OWN property on the instance in
  // three r169, so patching WebGLRenderer.prototype.render captures nothing —
  // but interaction.update() calls camera.getWorldDirection() every frame, and
  // that IS a prototype method.
  await page.evaluate(async () => {
    const THREE = await import('/Projects/Castle%20Conundrum/libs/three.module.js');
    const O = THREE.Object3D.prototype;
    const gwd = O.getWorldDirection;
    O.getWorldDirection = function (t) {
      if (this.isCamera && !window.__cam) window.__cam = this;
      return gwd.call(this, t);
    };
    const umw = O.updateMatrixWorld;
    O.updateMatrixWorld = function (f) {
      if (this.isScene && !window.__scene) window.__scene = this;
      return umw.call(this, f);
    };
  });
  await page.waitForFunction(() => window.__cam && window.__scene, null, { timeout: 20000 });

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
  assert(!!toScholar, 'walked to the Scholar', toScholar ? `${toScholar.dist}m after ${toScholar.burst} bursts` : 'never got in range');
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
  assert(!!toGuard, 'walked to the Guard', toGuard ? `${toGuard.dist}m after ${toGuard.burst} bursts` : 'never got in range');
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
