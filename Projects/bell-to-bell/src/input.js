import { CFG } from './config.js';

// Phase 8 — the same room, driven by a thumb.
//
// Everything here has exactly one rule: a touch source never gets its own
// branch downstream. The stick produces the same {fx, fz} pair WASD produces
// and hands it to the same clamp-and-collide walk; an on-screen button pushes
// the same action string a keydown pushes; a hold pad sets the same flag SHIFT
// sets. main.js's frame loop cannot tell which one happened, and that is the
// point — there is no second movement path to keep in sync.
//
// The math is exported on its own so a Node test can execute it. The event
// wiring below takes its listener target as an argument for the same reason:
// `root` is `globalThis` in a browser and a stub in tests/smoke.mjs.

// Pure. The unit vector the walk uses, from whichever sources are live.
// A stick past its deadzone wins over the keys, because a thumb on the pad
// is a deliberate act and a stuck key is not.
export function moveVector(keys, stick) {
  if (stick && (stick.x || stick.y)) {
    const len = Math.hypot(stick.x, stick.y);
    if (len > 1e-6) return { fx: stick.x / len, fz: -stick.y / len, mag: Math.min(1, len) };
  }
  let fx = 0, fz = 0;
  if (keys.KeyW) fz += 1;
  if (keys.KeyS) fz -= 1;
  if (keys.KeyA) fx -= 1;
  if (keys.KeyD) fx += 1;
  if (!fx && !fz) return null;
  const len = Math.hypot(fx, fz);
  return { fx: fx / len, fz: fz / len, mag: 1 };
}

// Pure. Where the thumb is relative to where it landed, in stick space:
// x right, y down, both in [-1, 1], zero inside the deadzone. The origin is
// where the finger touched down rather than the centre of the drawn pad, so
// the pad follows the thumb instead of the thumb hunting for the pad.
export function stickVector(originX, originY, x, y, radius = CFG.touch.stickRadius,
                            dead = CFG.touch.deadZone) {
  const dx = x - originX, dy = y - originY;
  const len = Math.hypot(dx, dy);
  if (len < dead) return { x: 0, y: 0 };
  const scale = Math.min(1, (len - dead) / (radius - dead)) / len;
  return { x: dx * scale, y: dy * scale };
}

// Pure. Whether the on-screen controls belong on this device. A coarse pointer
// is the honest signal; `ontouchstart` catches the phones whose browser lies
// about matchMedia, and the query override is how you look at the strip on a
// desktop without lying to it.
export function wantsTouchUI({ coarse = false, hasTouch = false, override = null } = {}) {
  if (override === 'on') return true;
  if (override === 'off') return false;
  return !!(coarse || hasTouch);
}

export function createInput(canvas, spawn, opts = {}) {
  const root = opts.root || globalThis;
  const keys = {};
  const look = { yaw: spawn.yaw ?? Math.PI, pitch: -0.04 };
  // Held by a pad rather than by a key. Same flags, read the same way.
  const holds = { withitness: false, wait: false };
  const stick = { x: 0, y: 0 };
  let dragging = false, lx = 0, ly = 0;

  const actions = [];
  const bindings = Object.fromEntries(Object.entries(CFG.keys).map(([a, code]) => [code, a]));

  root.addEventListener('keydown', e => {
    if (!keys[e.code] && bindings[e.code]) actions.push(bindings[e.code]);
    keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') e.preventDefault();
  });
  root.addEventListener('keyup', e => { keys[e.code] = false; });
  // A window that loses focus mid-hold must not leave a key, a pad or the
  // stick stuck down — and a pad stuck down means the room stays in thermal
  // view with nobody touching anything.
  root.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    holds.withitness = false; holds.wait = false;
    endStick();
  });

  canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  root.addEventListener('mouseup', () => { dragging = false; });
  root.addEventListener('mousemove', e => {
    if (!dragging) return;
    look.yaw -= (e.clientX - lx) * 0.0032;
    look.pitch = Math.max(-0.85, Math.min(0.5, look.pitch - (e.clientY - ly) * 0.0028));
    lx = e.clientX; ly = e.clientY;
  });

  // ---- touch -------------------------------------------------------------
  //
  // Two fingers at once is the normal case, not the exotic one: walking while
  // looking is how you cross a room. So every touch is tracked by identifier
  // and each one is claimed by exactly one job for its whole life. A finger
  // that lands in the walk half walks; one that lands anywhere else looks.
  // Whichever finger got there first keeps the job until it lifts.
  //
  // The hold pads and the action chips are DOM buttons above the canvas, so
  // their touches never reach these handlers at all.
  let stickId = null, lookId = null;
  const stickOrigin = { x: 0, y: 0 };
  let onStick = null;   // told where the pad is, so the UI can draw it

  const walkHalf = t => t.clientX < (root.innerWidth || 0) * CFG.touch.walkHalf;

  function endStick() {
    stickId = null;
    stick.x = 0; stick.y = 0;
    if (onStick) onStick(null);
  }

  canvas.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (stickId === null && walkHalf(t)) {
        stickId = t.identifier;
        stickOrigin.x = t.clientX; stickOrigin.y = t.clientY;
        stick.x = 0; stick.y = 0;
        if (onStick) onStick({ x: stickOrigin.x, y: stickOrigin.y, dx: 0, dy: 0 });
      } else if (lookId === null) {
        lookId = t.identifier;
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const v = stickVector(stickOrigin.x, stickOrigin.y, t.clientX, t.clientY);
        stick.x = v.x; stick.y = v.y;
        if (onStick) onStick({ x: stickOrigin.x, y: stickOrigin.y, dx: v.x, dy: v.y });
      } else if (t.identifier === lookId) {
        look.yaw -= (t.clientX - lx) * 0.005;
        look.pitch = Math.max(-0.85, Math.min(0.5, look.pitch - (t.clientY - ly) * 0.004));
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });

  const lift = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) endStick();
      else if (t.identifier === lookId) lookId = null;
    }
  };
  canvas.addEventListener('touchend', lift, { passive: true });
  canvas.addEventListener('touchcancel', lift, { passive: true });

  const wantsWithitness = () => !!(keys.ShiftLeft || keys.ShiftRight || holds.withitness);
  // T7: "wait time" is performed by holding, not tapping — the same shape as
  // Withitness, and the same joke the rubric is making about doing nothing.
  // Phase 8: and holding two pads at once is the interesting case, which is
  // why these are two independent flags rather than one "held control".
  const wantsWait = () => !!(keys.KeyF || holds.wait);

  function move(camera, dt, bounds, students, occluders) {
    const v = moveVector(keys, stick);
    if (!v) return;

    const sp = CFG.moveSpeed * dt * v.mag;
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

  return {
    keys, look, move, wantsWithitness, wantsWait, takeActions,
    // What the on-screen controls call in. A chip pushes an action; a pad sets
    // a hold; the stick pad asks to be told where the thumb put it.
    press: action => { if (action) actions.push(action); },
    setHold: (name, on) => { if (name in holds) holds[name] = !!on; },
    onStickMove: fn => { onStick = fn; },
    stick
  };
}
