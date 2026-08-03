// drive.mjs — the bits needed to actually *play* a first-person three.js game
// from a script, extracted so play-castle.mjs and capture-previews.mjs share one
// implementation instead of two drifting copies.
//
// Everything here assumes a headed browser (`launch({ headed: true })`). A hidden
// or headless page doesn't composite, so requestAnimationFrame never fires, the
// render loop never runs, and every function below waits forever instead of
// failing usefully. See README.md.

/* ------------------------------------------------------------------ probing */

// None of these games expose their scene or camera globally, and
// `renderer.render` is an OWN property on the instance in three (r160 and r169
// both: `this.render = function (scene, camera)`), so patching
// `WebGLRenderer.prototype.render` captures nothing.
//
// What does work is patching `Object3D.prototype.updateMatrixWorld`. Both handles
// fall out of that single hook, because `WebGLRenderer.render()` calls it on the
// scene every frame AND on the camera every frame (`if (camera.parent === null)
// camera.updateMatrixWorld()`, and these games all keep their camera out of the
// scene graph). So one patch, both objects, no traversal and no guessing.
//
// `getWorldDirection` is also hooked, but only as a nicety — it fires first in
// games that raycast forward for interaction, so the camera is captured a frame
// or two earlier there. Don't rely on it alone: Golden Hour and Aphelion never
// call it, and an earlier version of this file that only had these two hooks plus
// a `PerspectiveCamera.updateProjectionMatrix` fallback hung on both of them —
// updateProjectionMatrix runs at construction (before this patch is installed)
// and then only on resize.
//
// `threeUrl` must be the *same specifier the game's import map resolves to*, or
// the module registry hands back a second copy of three with its own prototypes
// and the patch lands on nothing.
export async function attachSceneProbe(page, threeUrl) {
  await page.evaluate(async (url) => {
    const THREE = await import(url);
    const O = THREE.Object3D.prototype;

    const umw = O.updateMatrixWorld;
    O.updateMatrixWorld = function (f) {
      if (this.isScene && !window.__scene) window.__scene = this;
      if (this.isCamera && !window.__cam) window.__cam = this;
      return umw.call(this, f);
    };

    const gwd = O.getWorldDirection;
    O.getWorldDirection = function (t) {
      if (this.isCamera && !window.__cam) window.__cam = this;
      return gwd.call(this, t);
    };

    window.__THREE = THREE;
  }, threeUrl);
}

/**
 * `page.waitForFunction(fn, arg, options)` is Playwright's signature.
 * `harness.mjs`'s Linux branch drives Chromium through `puppeteer-core`, whose
 * `waitForFunction` is `(fn, options, ...args)` instead, so a literal `null` in
 * the middle argument lands in `options` and throws
 * `Cannot read properties of null (reading 'polling')`. `page.__engine`,
 * set by `harness.mjs`'s `prepPage`, tells the two call shapes apart. Use this
 * everywhere in place of a bare `page.waitForFunction(fn, null, opts)`.
 */
export async function waitFor(page, fn, opts) {
  if (page.__engine === 'puppeteer') return page.waitForFunction(fn, opts);
  return page.waitForFunction(fn, null, opts);
}

/** Resolve once both handles exist. */
export async function waitForProbe(page, timeout = 25000) {
  await waitFor(page, () => !!(window.__scene && window.__cam), { timeout });
}

/**
 * Camera x/z, eye height, yaw and pitch.
 *
 * `yaw` is raw `rotation.y`. In the three hand-rolled control schemes that is the
 * controller's own unwrapped yaw field, which drifts by whole turns over a long
 * session — use `facing` when you want to know which way the camera actually
 * points. `pitch` is `rotation.x`, which those same controllers own.
 */
export const camState = (page) =>
  page.evaluate(() => {
    const c = window.__cam;
    const yaw = c.rotation.y;
    return {
      pos: [+c.position.x.toFixed(2), +c.position.z.toFixed(2)],
      y: +c.position.y.toFixed(2),
      yaw: +yaw.toFixed(3),
      facing: +Math.atan2(Math.sin(yaw), Math.cos(yaw)).toFixed(3),
      pitch: +c.rotation.x.toFixed(3),
    };
  });

/**
 * Point the camera at a world x/z by writing `camera.rotation.y` directly.
 *
 * This composes with real pointer-lock input rather than fighting it:
 * PointerLockControls (and every hand-rolled equivalent in these projects)
 * re-reads `camera.quaternion` on each mousemove, so a direct write between
 * moves survives. It is also far easier to aim than synthesized pointer deltas.
 * Camera forward is local −Z, hence the `+ Math.PI`.
 */
export const aimAt = (page, [tx, tz], pitch = 0) =>
  page.evaluate(({ tx, tz, pitch }) => {
    const c = window.__cam;
    c.rotation.order = 'YXZ';   // yaw then pitch, same as PointerLockControls
    c.rotation.set(pitch, Math.atan2(tx - c.position.x, tz - c.position.z) + Math.PI, 0);
  }, { tx, tz, pitch });

/**
 * Absolute yaw, for framing a shot rather than chasing a target.
 *
 * ONLY WORKS ON CASTLE CONUNDRUM. It uses three's own `PointerLockControls`,
 * which treats `camera.quaternion` as the source of truth and only ever adds to
 * it, so a direct write survives. Aphelion, Golden Hour and The Fourth Quarter
 * all roll their own controls that keep private `yaw`/`pitch` fields and
 * overwrite `camera.rotation` from them every single frame — a write here is
 * gone within ~16 ms. Use `turnBy()` for those.
 */
export const setYaw = (page, yaw, pitch = 0) =>
  page.evaluate(({ yaw, pitch }) => { window.__cam.rotation.set(pitch, yaw, 0); }, { yaw, pitch });

/**
 * Turn by a yaw/pitch delta through the game's own mouse-look handler, for the
 * three projects whose controls own `camera.rotation` outright.
 *
 * Dispatches a `mousemove` carrying an explicit `movementX`/`movementY` rather
 * than using `page.mouse.move()`. Real synthesized moves do drive these handlers
 * — play-castle.mjs asserts exactly that — but the browser derives `movementX`
 * from the delta between successive absolute cursor positions, so one sweep is
 * capped at the viewport width and repeated sweeps in the same direction cancel
 * out. There is no way to compose a 180° turn from them. These handlers are
 * plain `document.addEventListener('mousemove')` closures that read `e.movementX`
 * and nothing else, so an untrusted event with the field set is equivalent for
 * their purposes and exact besides.
 *
 * `sens` is the game's own radians-per-pixel constant (0.0022 in Aphelion and
 * Golden Hour, 0.0023 in The Fourth Quarter). Yaw decreases as movementX grows
 * in all three.
 */
export async function turnBy(page, { dyaw = 0, dpitch = 0, sens = 0.0022 }) {
  await page.evaluate(({ dx, dy }) => {
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: dx, movementY: dy, bubbles: true,
    }));
  }, { dx: -dyaw / sens, dy: -dpitch / sens });
  await wait(120);
}

/**
 * Turn to an absolute facing and pitch, by measuring where the camera is now and
 * turning the difference.
 *
 * Prefer this to `turnBy` from an assumed starting angle. Every Playwright mouse
 * move that lands while pointer lock is held feeds `movementX`/`movementY` into
 * these controllers, so a script that clicks its way through a few panels arrives
 * with the camera pointing somewhere it never asked for — The Fourth Quarter's
 * capture drifted four whole turns of yaw and ended up staring at the floorboards
 * that way. Reading the current rotation first makes the whole thing immune to
 * however much drift accumulated on the way in.
 */
export async function lookAt(page, { facing = 0, pitch = 0, sens = 0.0022 }) {
  const c = await camState(page);
  await turnBy(page, { dyaw: facing - c.facing, dpitch: pitch - c.pitch, sens });
  return camState(page);
}

/**
 * Aim at `target` and hold W in bursts until `arrived()` says so.
 *
 * `arrived` is a node-side async predicate, so each caller can key off whatever
 * its own game exposes (an interact prompt, a distance, a phase flag). Returns
 * `{ bursts, dist }` on success or null after `maxBursts`.
 *
 * The strafe nudge matters: these are all capsule-vs-AABB collision worlds and a
 * straight line to the target routinely runs into a table leg. If distance stops
 * changing, step sideways before pushing forward again.
 *
 * `nearAt` is where the long strides give way to short ones. A 400 ms burst
 * covers a couple of metres, so if `arrived` wants a precise standoff distance
 * (framing a screenshot rather than just getting in range) raise `nearAt` above
 * it or the last long stride sails straight past.
 */
export async function walkTo(page, target, arrived,
                            { maxBursts = 40, key = 'KeyW', nearAt = 5, longMs = 400, shortMs = 130,
                              steer = 'aimAt', sens = 0.0022 } = {}) {
  let lastDist = null;
  for (let bursts = 0; bursts < maxBursts; bursts++) {
    const s = await camState(page);
    const dist = Math.hypot(s.pos[0] - target[0], s.pos[1] - target[1]);
    if (await arrived(dist)) return { bursts, dist: +dist.toFixed(2) };

    if (steer === 'lookAt') {
      // aimAt()'s raw camera.rotation.set() only sticks where a game's own
      // controls treat camera.quaternion as the source of truth
      // (PointerLockControls — Castle Conundrum). Aphelion, Golden Hour and
      // The Fourth Quarter all keep a private yaw/pitch and overwrite
      // camera.rotation from it every frame, so a raw write here is gone
      // within ~16ms and walkTo() silently never turns — this is locked
      // decision #35, confirmed again this round against The Fourth
      // Quarter's Real Estate beat ("never got in range" on a 6-8m walk).
      // Same target-angle formula as aimAt(), routed through lookAt()'s
      // mousemove-based turn instead, which those three games' own
      // mousemove handlers actually read.
      const facing = Math.atan2(target[0] - s.pos[0], target[1] - s.pos[1]) + Math.PI;
      await lookAt(page, { facing, pitch: 0, sens });
    } else {
      await aimAt(page, target);
    }

    if (lastDist !== null && Math.abs(lastDist - dist) < 0.05) {
      await page.keyboard.down('KeyD');
      await wait(220);
      await page.keyboard.up('KeyD');
    }
    lastDist = dist;

    await page.keyboard.down(key);
    await wait(dist > nearAt ? longMs : shortMs);
    await page.keyboard.up(key);
    await wait(60);
  }
  return null;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `page.textContent(selector)` is Playwright's convenience method; puppeteer-core
 * has no page-level `textContent` at all, only element handles. Same
 * `page.__engine` split as `waitFor` above — use this in place of a bare
 * `page.textContent(sel)` so a beat works under both engines.
 */
export const textContent = (page, sel) =>
  page.__engine === 'puppeteer'
    ? page.$eval(sel, (el) => el.textContent)
    : page.textContent(sel);

/**
 * Run `trigger` and answer the file chooser it opens with `file`.
 *
 * gvb-save's promptImport() creates a hidden <input type="file"> and clicks it,
 * which is a real chooser; it has to be answered by the driver, and the two
 * engines this harness supports do that differently. Registering the handler
 * before the click matters — the chooser is a one-shot event. Shared here (not
 * just in play-games.mjs) because games.mjs's own `open()` recipes need it too
 * — Torchbearer's opening move is importing a save, not clicking through UI.
 */
export async function setFiles(page, file, trigger) {
  if (page.__engine === 'puppeteer') {
    const [chooser] = await Promise.all([page.waitForFileChooser(), trigger()]);
    await chooser.accept([file]);
    return;
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(file);
}
