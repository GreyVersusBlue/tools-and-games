import { CFG } from '../config.js';
import { applyEffects } from '../state.js';

export function createEvents({ data, dom, toast, react }) {
  function tick(state) {
    for (const ev of data.scheduled) {
      if (state.firedEvents.has(ev.id)) continue;
      if (state.t > CFG.periodSeconds - ev.atMinute * 60) continue;
      state.firedEvents.add(ev.id);
      fire(state, ev);
    }
  }

  function fire(state, ev) {
    if (ev.kind === 'pa') {
      dom.paTitle.textContent = ev.title;
      dom.paTxt.textContent = ev.body;
      dom.pa.classList.add('on');
      setTimeout(() => dom.pa.classList.remove('on'), ev.durationMs || 8000);
    }
    applyEffects(state, ev.effects);
    react?.(ev);
    if (ev.toast) toast(ev.toast.kind, ev.toast.title, ev.toast.body);
  }

  return { tick };
}
