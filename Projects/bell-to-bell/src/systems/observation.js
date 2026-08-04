import { CFG } from '../config.js';
import { applyEffects } from '../state.js';

// T7 — THE OBSERVATION. The boss fight.
//
// Announced by a countdown, not a coin flip: it happens every period, the same
// way the intercom PA does. An Admin Proximity Alert gives you a real-time
// window to feel it coming; then she's in the room and a rubric window opens
// on the game clock. Four of its five look-fors are close to pure performance
// (post the objective, ask a big question, hold still and call it wait time,
// step back and call it discourse); the fifth — checks for understanding — is
// also just good teaching, and costs nothing extra here because lesson.js
// already charges for it. Being watched costs Mastery the whole window is
// open, win or lose the rubric; that part is not something you can perform.
export function createObservation({ data, dom, toast }) {
  const O = CFG.observation;
  const byKey = Object.fromEntries(data.lookFors.map(l => [l.key, l]));

  function tick(state, dt) {
    if (state.obsPhase === 'idle') {
      if (state.t <= CFG.periodSeconds - data.atMinute * 60) startAlert(state);
      return;
    }
    if (state.obsPhase === 'alert') {
      state.obsAlertRemaining -= dt;
      const secs = Math.max(0, Math.ceil(state.obsAlertRemaining));
      dom.paTxt.textContent = `${data.alert.body} (${secs}s)`;
      if (state.obsAlertRemaining <= 0) startActive(state);
      return;
    }
    if (state.obsPhase === 'active') {
      state.obsWindowRemaining -= dt * CFG.timeScale;
      // Ambient, not performative: this runs whether or not you chase a
      // single look-for, and it goes through masteryPending like every other
      // Mastery cost, never state.mastery directly.
      state.masteryPending -= O.masteryDrainPerSec * dt * CFG.timeScale;
      if (state.obsWindowRemaining <= 0) finish(state);
    }
  }

  function startAlert(state) {
    state.obsPhase = 'alert';
    state.obsAlertRemaining = O.alertSeconds;
    dom.paTitle.textContent = data.alert.title;
    dom.paTxt.textContent = data.alert.body;
    dom.pa.classList.add('on');
  }

  function startActive(state) {
    state.obsPhase = 'active';
    state.obsWindowRemaining = O.windowMinutes * 60;
    dom.paTitle.textContent = data.arrival.title;
    dom.paTxt.textContent = data.arrival.body;
    toast('', data.arrival.title, data.arrival.body);
    setTimeout(() => dom.pa.classList.remove('on'), 4000);
  }

  // One-shot look-fors (posted objective, higher-order question, student-led
  // discourse) and checks-for-understanding (called from main's Q handler)
  // all land here. First time only; the rubric does not reward repeats.
  function satisfy(state, key) {
    if (state.obsPhase !== 'active') { toast('', 'Not now', data.idle); return false; }
    if (state.obsSatisfied[key]) return false;
    state.obsSatisfied[key] = true;
    applyEffects(state, { fidelity: O.lookForFidelity, bandwidth: O.lookForBandwidth });
    const def = byKey[key];
    if (def?.toast) toast(def.toast.kind, def.toast.title, def.toast.body);
    return true;
  }

  // Wait time is the one look-for you perform by doing nothing: hold the key
  // for long enough and it books itself, the same joke the rubric is making.
  function tickWait(state, dt, held) {
    if (state.obsPhase !== 'active' || state.obsSatisfied.wait) { state.obsWaitHeld = 0; return; }
    if (!held) { state.obsWaitHeld = 0; return; }
    state.obsWaitHeld += dt;
    if (state.obsWaitHeld >= O.waitHoldSeconds) satisfy(state, 'wait');
  }

  function finish(state) {
    state.obsPhase = 'done';
    dom.pa.classList.remove('on');
    const satisfied = data.lookFors.map(l => l.key).filter(k => state.obsSatisfied[k]);
    state.obsResult = { satisfied, total: data.lookFors.length };
    const line = satisfied.length === data.lookFors.length ? data.conclusion.full
      : satisfied.length === 0 ? data.conclusion.empty : data.conclusion.partial;
    toast('', 'The Observation', line);
  }

  const active = state => state.obsPhase === 'active';

  // The post-conference. One exchange, three ways to answer it — called once,
  // from main's endPeriod, before the report.
  function resolveConference(state, key) {
    const opt = data.conference.options.find(o => o.key === key);
    if (!opt) return null;
    applyEffects(state, opt.effects);
    state.obsConference = key;
    return opt;
  }

  function conferenceOption(key) {
    return data.conference.options.find(o => o.key === key) || null;
  }

  return {
    tick, satisfy, tickWait, active, resolveConference, conferenceOption,
    lookFors: data.lookFors, conference: data.conference, report: data.report
  };
}
