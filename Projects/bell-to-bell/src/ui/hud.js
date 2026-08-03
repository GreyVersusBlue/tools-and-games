import { CFG } from '../config.js';
import { dom } from './dom.js';

export function drawHUD(state, teaching, temp, lesson) {
  for (const [key, [bar, val]] of Object.entries(dom.meters)) {
    bar.style.width = state[key] + '%';
    val.textContent = Math.round(state[key]);
  }
  const mm = Math.floor(state.t / 60), ss = Math.floor(state.t % 60);
  dom.clock.textContent = mm + ':' + String(ss).padStart(2, '0');

  dom.zone.textContent = teaching ? 'DELIVERING' : 'AWAY FROM FRONT';
  dom.zone.style.color = teaching ? '#4A7A3C' : '#A33B2A';

  dom.hyper.textContent = state.hyper > CFG.hyperThreshold ? 'HYPERVIGILANT'
    : state.hyper > 25 ? 'tired' : '\u2014';
  dom.hyper.style.color = state.hyper > CFG.hyperThreshold ? '#A33B2A' : '#6B6455';

  dom.tempV.textContent = temp.label;
  dom.tempS.textContent = temp.sub;
  dom.tempBox.classList.toggle('stale', !temp.fresh);

  dom.chipTxt.textContent = state.withitness
    ? 'Withitness active \u2014 you are not teaching'
    : 'Hold for Withitness';

  drawLesson(state, teaching, lesson);
}

function drawLesson(state, teaching, ls) {
  if (!ls) return;
  dom.lsUnit.textContent = ls.unit;
  dom.lsCount.textContent = state.onFiller ? 'off plan' : `beat ${ls.index + 1}/${ls.total}`;
  dom.lsLabel.textContent = ls.label;
  dom.lsLine.textContent = ls.line;
  dom.lsBar.style.width = Math.min(100, ls.progress * 100) + '%';
  dom.lsMark.style.left = (CFG.lesson.minFracToAdvance * 100) + '%';
  dom.lesson.classList.toggle('off', !teaching || state.withitness);
  dom.lesson.classList.toggle('rushable', ls.progress < CFG.lesson.minFracToAdvance && !state.onFiller);
  dom.lesson.classList.toggle('belabor', ls.progress > CFG.lesson.belaborAfter);
}
