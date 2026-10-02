// Signal City: pointer and keyboard. Turns clicks and keys into calls on
// the game object (js/main.js): phase requests, priority calls, pause, speed,
// zoom. Nothing here touches the world directly.

// A touch that moved this many px all told is still a tap, and it picks a
// car within TAP_PX of it (R8): a fingertip is about 9 mm, some 40 px.
export const TAP_SLOP = 12;
export const TAP_PX = 22;

export function bindInput({ canvas, renderer, game }) {
  const keyPhase = e => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) { game.requestPhase(n - 1); return true; }
    return false;
  };

  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (keyPhase(e)) { e.preventDefault(); return; }
    switch (e.key) {
      case ' ': game.togglePause(); e.preventDefault(); break;
      case 'f': case 'F': game.toggleSpeed(); break;
      case 'e': case 'E': game.priorityNearest(); break;
      case 'm': case 'M': game.toggleSound(); break;
      case '+': case '=': renderer.zoomBy(1.15); break;
      case '-': case '_': renderer.zoomBy(1 / 1.15); break;
      case 'Escape': game.escape(); break;
      default: break;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    renderer.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  const pointerWorld = e => {
    const r = canvas.getBoundingClientRect();
    return renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // a drag pans (a corridor is wider than the board once zoomed); a click
  // or a tap that did not move picks a car or a box. Two fingers on the
  // board pinch-zoom it (R8): the camera's own zoomBy, by how much the
  // distance between them changed. A finger is coarser than a cursor, so a
  // touch may move a little more and still be a tap, and it picks a car
  // within TAP_PX of it, however far the board is zoomed out.
  const pointers = new Map();   // pointerId -> { x, y }
  let drag = null, pinch = null;
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size < 2) return;
      const d = spread();
      if (pinch.d > 0 && d > 0) renderer.zoomBy(d / pinch.d);
      pinch.d = d;
      return;
    }
    if (drag) {
      if (e.pointerId !== drag.id) return;
      renderer.beginPan();
      renderer.panBy(e.clientX - drag.x, e.clientY - drag.y);
      drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      return;
    }
    if (e.pointerType === 'touch') return;
    const p = pointerWorld(e);
    const car = game.carAt(p.x, p.y);
    renderer.selected = car ? car.id : null;
    canvas.style.cursor = car && car.archetype === 'emergency' && !car.priority ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    if (pointers.size >= 2) {
      // a second finger turns the drag into a pinch, and nothing it ends in is a tap
      if (drag) renderer.endPan();
      drag = null;
      pinch = { d: spread() };
      return;
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, touch: e.pointerType === 'touch' };
  });
  const release = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (!pointers.size) pinch = null; return; }
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, touch } = drag;
    drag = null;
    renderer.endPan();
    if (moved > (touch ? TAP_SLOP : 4)) return;
    const p = pointerWorld(e);
    const car = game.carAt(p.x, p.y, touch ? TAP_PX / renderer.scale : undefined);
    if (car) game.clickCar(car);
    else game.clickMap(p.x, p.y);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if (!pointers.size) pinch = null; drag = null; renderer.endPan(); });
}
