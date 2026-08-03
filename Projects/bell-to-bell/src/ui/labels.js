import { CFG } from '../config.js';
import { dom } from './dom.js';

// The signature element: tells annotate as district evaluation rubric boxes.
export function updateLabels({ state, camera, tellSystem, students, onClick, projector }) {
  if (!state.withitness) return;

  for (const t of tellSystem.tells) {
    if (!tellSystem.isVisible(t)) {
      if (t.el) { t.el.remove(); t.el = null; }
      continue;
    }
    projector.copy(t.pos).project(camera);
    const onScreen = projector.z < 1 &&
      projector.x > -1 && projector.x < 1 && projector.y > -1 && projector.y < 1;
    if (!onScreen) {
      if (t.el) { t.el.remove(); t.el = null; }
      continue;
    }

    if (!t.el) {
      const def = tellSystem.defs[t.type];
      const dist = camera.position.distanceTo(t.pos);
      const conf = def.forceConfidence || (dist > 8 ? 'MED' : 'HIGH');
      const el = document.createElement('div');
      el.className = 'tell';
      el.innerHTML =
        `<div class="id">\u25E7 Indicator <em>${def.indicator}</em> \u2014 ${def.name}</div>` +
        `<div class="d">${def.descriptor}</div>` +
        `<div class="m"><span>${students[t.seat].name}</span><span>Confidence: ${conf}</span></div>`;
      el.addEventListener('click', e => { e.stopPropagation(); onClick(t); });
      dom.labels.appendChild(el);
      t.el = el;
    }
    t.el.style.left = ((projector.x * 0.5 + 0.5) * innerWidth) + 'px';
    t.el.style.top = ((-projector.y * 0.5 + 0.5) * innerHeight - 14) + 'px';
  }
}

export const LABEL_RANGE = CFG.withitnessRange;
