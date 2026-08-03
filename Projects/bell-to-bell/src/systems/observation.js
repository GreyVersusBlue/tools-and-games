import { CFG } from '../config.js';
import { applyEffects } from '../state.js';

// T7 — THE OBSERVATION. Admin Proximity Alert fires once, at a scripted
// minute. A real-time window (dt, not the scaled game clock) gives you a few
// seconds to pick up to `maxPicks` look-fors before it resolves into a
// post-conference dialogue tree. The lesson does not pause — this only
// gates E/Q/R/T and new tell menus, the same as an open tell menu does.
export function createObservation({ data, dom, toast, openMenu, closeMenu, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  let phase = 'idle';       // idle | window | conference
  let fired = false;
  let timeLeft = 0;
  let shownSecond = -1;
  let picked = [];
  let queue = [];
  let liveState = null;

  function active() { return phase !== 'idle'; }

  function trigger() {
    phase = 'window';
    timeLeft = data.trigger.warningSeconds;
    shownSecond = -1;
    picked = [];
    dom.paTitle.textContent = data.alert.title;
    dom.pa.classList.add('on');
    renderWindow();
  }

  function renderWindow() {
    const remaining = data.maxPicks - picked.length;
    const secs = Math.max(0, Math.ceil(timeLeft));
    dom.paTxt.textContent = `${data.alert.body}  —  ${secs}s`;
    openMenu({
      header: data.alert.title,
      body: `${data.alert.instruction} ${remaining} left.`,
      footer: `${secs} seconds. Pick ${data.maxPicks}. That's it.`,
      items: data.actions.map(a => ({
        key: a.id, label: a.label, blurb: a.blurb || '',
        enabled: !picked.includes(a.id) && (a.solo ? picked.length === 0 : remaining > 0)
      }))
    }, key => pick(key));
  }

  function pick(id) {
    if (phase !== 'window') return;
    const action = data.actions.find(a => a.id === id);
    if (!action || picked.includes(id)) return;
    applyEffects(liveState, action.effects || {});
    if (action.toast) toast(action.toast.kind, action.toast.title, action.toast.body);
    picked.push(id);
    if (action.solo || picked.length >= data.maxPicks) { closeWindow(); return; }
    renderWindow();
  }

  function closeWindow() {
    dom.pa.classList.remove('on');
    closeMenu();
    phase = 'conference';
    queue = (data.conference?.prompts || []).slice();
    if (data.bridge) toast(data.bridge.kind, data.bridge.title, data.bridge.body);
    schedule(nextPrompt, 900);
  }

  function nextPrompt() {
    if (!queue.length) {
      phase = 'idle';
      closeMenu();
      const c = data.conference?.closing;
      if (c) toast(c.kind, c.title, c.body);
      return;
    }
    const p = queue.shift();
    openMenu({
      header: data.conference.header || 'Post-Conference',
      body: p.line,
      footer: '',
      items: p.choices.map((c, i) => ({ key: String(i), label: c.label, blurb: c.blurb || '', enabled: true }))
    }, key => choose(p, Number(key)));
  }

  function choose(prompt, index) {
    const c = prompt.choices[index];
    if (!c) return;
    applyEffects(liveState, c.effects || {});
    if (c.followUp) {
      const fu = (data.conference.followUps || {})[c.followUp];
      if (fu) queue.unshift(fu);
    }
    nextPrompt();
  }

  function tick(state, dt) {
    liveState = state;
    if (phase === 'idle') {
      if (fired || state.t > CFG.periodSeconds - data.trigger.atMinute * 60) return;
      fired = true;
      trigger();
      return;
    }
    if (phase !== 'window') return;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; closeWindow(); return; }
    const secs = Math.max(0, Math.ceil(timeLeft));
    if (secs !== shownSecond) { shownSecond = secs; renderWindow(); }
  }

  return { active, tick };
}
