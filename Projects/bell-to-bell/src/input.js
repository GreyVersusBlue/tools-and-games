import { CFG } from './config.js';

export function createInput(canvas, spawn) {
  const keys = {};
  const look = { yaw: spawn.yaw ?? Math.PI, pitch: -0.04 };
  let dragging = false, lx = 0, ly = 0;

  const actions = [];
  const bindings = Object.fromEntries(Object.entries(CFG.keys).map(([a, code]) => [code, a]));

  addEventListener('keydown', e => {
    if (!keys[e.code] && bindings[e.code]) actions.push(bindings[e.code]);
    keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', e => {
    if (!dragging) return;
    look.yaw -= (e.clientX - lx) * 0.0032;
    look.pitch = Math.max(-0.85, Math.min(0.5, look.pitch - (e.clientY - ly) * 0.0028));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('touchstart', e => {
    dragging = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    look.yaw -= (t.clientX - lx) * 0.005;
    look.pitch = Math.max(-0.85, Math.min(0.5, look.pitch - (t.clientY - ly) * 0.004));
    lx = t.clientX; ly = t.clientY;
  }, { passive: true });
  addEventListener('touchend', () => { dragging = false; });

  const wantsWithitness = () => !!(keys.ShiftLeft || keys.ShiftRight);
  // T7: "wait time" is performed by holding, not tapping — the same shape as
  // Withitness, and the same joke the rubric is making about doing nothing.
  const wantsWait = () => !!keys.KeyF;

  function move(camera, dt, bounds, students, occluders) {
    let fx = 0, fz = 0;
    if (keys.KeyW) fz += 1;
    if (keys.KeyS) fz -= 1;
    if (keys.KeyA) fx -= 1;
    if (keys.KeyD) fx += 1;
    if (!fx && !fz) return;

    const len = Math.hypot(fx, fz); fx /= len; fz /= len;
    const sp = CFG.moveSpeed * dt;
    const s = Math.sin(look.yaw), c = Math.cos(look.yaw);
    let nx = camera.position.x + (fx * c - fz * s) * sp;
    let nz = camera.position.z + (-fx * s - fz * c) * sp;

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
