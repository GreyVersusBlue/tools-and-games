import * as THREE from 'three';

// One quiet system for every hands-on verb: sitting, picking things up,
// scattering crumbs, and whatever comes later. Items register with a world
// position, a radius, a label and a use(); each frame the nearest available
// item the camera is roughly facing owns the hint pill, and E (or tapping the
// pill on touch) uses it.
//
// No raycasting. Proximity plus a facing dot-product picks the same item a ray
// would for objects this sparse, for none of the traversal — and it works for
// things at your feet, where a crosshair ray is exactly where nobody points it.
//
// The override slot is for held states (an examined shell, a wound-up stone)
// that must own the hint no matter where the walker faces. Held beats near.

export function buildInteract(camera, controls) {
  const hint = document.getElementById('action-hint');
  const items = [];
  let current = null;
  let override = null;
  let prevE = false;
  const fwd = new THREE.Vector3(), to = new THREE.Vector3();

  hint.addEventListener('click', e => {
    e.stopPropagation();
    const it = override || current;
    if (it && controls.enabled) it.use();
  });

  function show(text) {
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle('show', text !== '');
  }

  const state = {
    register(item) { items.push(item); return item; },
    setOverride(item) { override = item; },
    clearOverride() { override = null; },
    get held() { return override; },
    hintEl: hint,
    isTouch: window.matchMedia('(pointer: coarse)').matches,

    update() {
      const e = !!controls.keys['KeyE'];
      const pressed = e && !prevE && controls.enabled;
      prevE = e;

      if (override) {
        show(override.label());
        if (pressed) override.use();
        return;
      }

      camera.getWorldDirection(fwd);
      let best = null, bestScore = -Infinity;
      for (const it of items) {
        if (it.available && !it.available()) continue;
        const dx = it.x - controls.pos.x, dz = it.z - controls.pos.z;
        const d2 = dx * dx + dz * dz;
        const r = it.radius || 3;
        if (d2 > r * r) continue;
        to.set(dx, (it.y ?? controls.pos.y) - camera.position.y, dz).normalize();
        const face = fwd.dot(to);
        // Right on top of something counts as facing it — you cannot usefully
        // "face" a shell between your feet.
        if (face < 0.35 && d2 > 1.44) continue;
        const score = (1 - Math.sqrt(d2) / r) + Math.max(0, face);
        if (score > bestScore) { best = it; bestScore = score; }
      }
      current = best;
      show(best && controls.enabled ? best.label() : '');
      if (pressed && best) best.use();
    },
  };

  return state;
}
