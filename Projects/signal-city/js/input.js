// Signal City: pointer and keyboard. Turns clicks and keys into calls on
// the game object (js/main.js): phase requests, priority calls, pause, speed,
// zoom. Nothing here touches the world directly.

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

  canvas.addEventListener('pointermove', e => {
    const p = pointerWorld(e);
    const car = game.carAt(p.x, p.y);
    renderer.selected = car ? car.id : null;
    canvas.style.cursor = car && car.archetype === 'emergency' && !car.priority ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerdown', e => {
    const p = pointerWorld(e);
    const car = game.carAt(p.x, p.y);
    if (car) game.clickCar(car);
  });
}
