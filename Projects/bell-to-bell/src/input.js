import { CFG } from './config.js';

// Keys, the mouse, and the one walk both of them feed.
//
// There is no touch source (#940, Devon 2026-10-07: "no touch controls").
// Phase 8's stick, chips and hold pads came out on 2026-10-10 with the
// one-finger look that predated them. What Phase 8 left that a keyboard uses
// stays: the walk's unit vector is a pure function a Node test executes, and
// the event wiring takes its listener target as an argument for the same
// reason (`root` is `globalThis` in a browser and a stub in tests/smoke.mjs).

// Pure. The unit vector the walk uses, from the keys that are down.
export function moveVector(keys) {
  let fx = 0, fz = 0;
  if (keys.KeyW) fz += 1;
  if (keys.KeyS) fz -= 1;
  if (keys.KeyA) fx -= 1;
  if (keys.KeyD) fx += 1;
  if (!fx && !fz) return null;
  const len = Math.hypot(fx, fz);
  return { fx: fx / len, fz: fz / len };
}

export function createInput(canvas, spawn, opts = {}) {
  const root = opts.root || globalThis;
  const keys = {};
  const look = { yaw: spawn.yaw ?? Math.PI, pitch: -0.04 };
  let dragging = false, lx = 0, ly = 0;

  const actions = [];
  const bindings = Object.fromEntries(Object.entries(CFG.keys).map(([a, code]) => [code, a]));

  root.addEventListener('keydown', e => {
    if (!keys[e.code] && bindings[e.code]) actions.push(bindings[e.code]);
    keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') e.preventDefault();
  });
  root.addEventListener('keyup', e => { keys[e.code] = false; });
  // A window that loses focus mid-hold must not leave a key stuck down: SHIFT
  // stuck down is the room in thermal view with nobody holding anything.
  root.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  root.addEventListener('mouseup', () => { dragging = false; });
  root.addEventListener('mousemove', e => {
    if (!dragging) return;
    look.yaw -= (e.clientX - lx) * 0.0032;
    look.pitch = Math.max(-0.85, Math.min(0.5, look.pitch - (e.clientY - ly) * 0.0028));
    lx = e.clientX; ly = e.clientY;
  });

  const wantsWithitness = () => !!(keys.ShiftLeft || keys.ShiftRight);
  // T7: "wait time" is performed by holding, not tapping — the same shape as
  // Withitness, and the same joke the rubric is making about doing nothing.
  // The two holds are independent: the five-second one has to work with
  // SHIFT already down.
  const wantsWait = () => !!keys.KeyF;

  function move(camera, dt, bounds, students, occluders) {
    const v = moveVector(keys);
    if (!v) return;

    const sp = CFG.moveSpeed * dt;
    const s = Math.sin(look.yaw), c = Math.cos(look.yaw);
    let nx = camera.position.x + (v.fx * c - v.fz * s) * sp;
    let nz = camera.position.z + (-v.fx * s - v.fz * c) * sp;

    nx = Math.max(-bounds.x + 0.45, Math.min(bounds.x - 0.45, nx));
    nz = Math.max(bounds.zFront + 0.6, Math.min(bounds.zBack - 0.45, nz));

    for (const st of students) if (Math.hypot(nx - st.x, nz - st.z) < 0.62) return;
    for (const o of occluders) {
      if (Math.abs(nx - o.position.x) < o.userData.halfW + 0.3 &&
          Math.abs(nz - o.position.z) < o.userData.halfD + 0.3) return;
    }
    camera.position.x = nx;
    camera.position.z = nz;
  }

  // Drained once per frame by main. Held keys do not repeat.
  function takeActions() {
    if (!actions.length) return null;
    return actions.splice(0, actions.length);
  }

  return { keys, look, move, wantsWithitness, wantsWait, takeActions };
}
