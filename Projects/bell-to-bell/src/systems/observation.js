import { CFG } from '../config.js';
import { applyEffects } from '../state.js';
import { createRng, mixSeed } from './rng.js';

// T7 — THE OBSERVATION. The boss fight.
// Phase 4 — and now a visit that does not always happen, a rubric drawn from a
// pool, and a post-conference with more than one exchange in it.
//
// What changed and why: an AP who walks in at minute 30 of every period
// forever is a metronome, not a boss. `visitFor` below decides whether she
// comes at all, when in a window she arrives, whether the visit was on the
// calendar days ahead, and which five of the nine look-fors she brought. It is
// a pure function of the semester seed, the day index and the period id, so
// nothing about the calendar has to be stored and Thursday can be read off
// today. Announced visits skip the Admin Proximity Alert — the nine-second
// countdown is the funnier one and it belongs to the surprise.
//
// Phase 3: `windowScale` is what a growth plan does to the rubric window — she
// stays longer. 1 is the eleven minutes the data says.

const round1 = v => Math.round(v * 10) / 10;

// A period id is a string and mixSeed takes integers. FNV-1a over the
// characters, so "p4" and "p5" are different streams and the same id is the
// same stream in a week's time.
export function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < String(id).length; i++) {
    h ^= String(id).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Which five of the nine. Drawn without replacement, so no rubric ever asks
// for the same thing twice in one window.
function drawRubric(rng, data) {
  const size = Math.min(data.visit.rubricSize, data.lookFors.length);
  return rng.shuffle(data.lookFors.map(l => l.key)).slice(0, size);
}

// Whether AP Reyes visits this period on this day, and what she brings.
// Pure: same arguments, same answer, forever, which is what lets an announced
// visit be read days early without anything being written down.
export function visitFor(data, { seed = 0, dayIndex = 0, periodId }) {
  const V = data.visit;
  const rng = createRng(mixSeed(seed, dayIndex + 1, hashId(periodId)));
  if (rng.next() >= V.chance) return null;
  const atMinute = round1(rng.between(V.window.fromMinute, V.window.toMinute));
  const announced = rng.next() < V.announced.chance;
  const leadDays = announced ? rng.int(V.announced.leadDays.min, V.announced.leadDays.max) : 0;
  return { periodId, dayIndex, atMinute, announced, leadDays, rubric: drawRubric(rng, data) };
}

// The visit the headless sim and the balance table get when nobody names one:
// she always comes, at the minute she used to come, with the five look-fors
// she used to bring. Phase 4 does not get to move the balance numbers.
export const defaultVisit = (data, periodId = 'p4') => ({
  periodId, dayIndex: 0, atMinute: data.visit.default.atMinute,
  announced: false, leadDays: 0, rubric: data.visit.default.rubric.slice()
});

// Every announced visit you already know about: one whose announcement day
// (its own day minus its lead) is today or earlier, within the horizon. Today's
// own announced visit is the first row when there is one.
export function announcedAhead(data, { seed = 0, dayIndex = 0, periodIds = [] }) {
  const horizon = data.visit.announced.horizonDays;
  const out = [];
  for (let d = dayIndex; d <= dayIndex + horizon; d++) {
    for (const periodId of periodIds) {
      const v = visitFor(data, { seed, dayIndex: d, periodId });
      if (v && v.announced && d - v.leadDays <= dayIndex) out.push({ ...v, inDays: d - dayIndex });
    }
  }
  return out;
}

export function createObservation({ data, dom, toast, windowScale = 1, visit = null }) {
  const O = CFG.observation;
  const byKey = Object.fromEntries(data.lookFors.map(l => [l.key, l]));
  // The five she brought today, in the pool's own order so the HUD reads the
  // same way every time even though the contents do not.
  const rubric = (visit ? visit.rubric : []).filter(k => byKey[k]);
  const lookFors = data.lookFors.filter(l => rubric.includes(l.key));
  const onRubric = key => rubric.includes(key);

  function tick(state, dt) {
    if (!visit) return;
    if (state.obsPhase === 'idle') {
      if (state.t <= CFG.periodSeconds - visit.atMinute * 60) {
        // Announced: no countdown, no alert banner. You have known for days.
        if (visit.announced) startActive(state);
        else startAlert(state);
      }
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
    state.obsWindowRemaining = O.windowMinutes * 60 * windowScale;
    const arrival = visit.announced ? data.visit.announced.arrival : data.arrival;
    dom.paTitle.textContent = arrival.title;
    dom.paTxt.textContent = arrival.body;
    dom.pa.classList.add('on');
    toast('', arrival.title, arrival.body);
    setTimeout(() => dom.pa.classList.remove('on'), 4000);
  }

  // One-shot look-fors and checks-for-understanding (called from main's Q
  // handler) all land here. First time only; the rubric does not reward
  // repeats, and it does not reward anything she did not come in asking for.
  function satisfy(state, key) {
    const def = byKey[key];
    if (state.obsPhase !== 'active') {
      if (!def?.implicit) toast('', 'Not now', data.idle);
      return false;
    }
    if (!onRubric(key)) {
      if (!def?.implicit) toast('', 'Not on the rubric', data.notOnRubric);
      return false;
    }
    if (state.obsSatisfied[key]) return false;
    state.obsSatisfied[key] = true;
    applyEffects(state, { fidelity: O.lookForFidelity, bandwidth: O.lookForBandwidth });
    if (def?.toast) toast(def.toast.kind, def.toast.title, def.toast.body);
    return true;
  }

  // Wait time is the one look-for you perform by doing nothing: hold the key
  // for long enough and it books itself, the same joke the rubric is making.
  function tickWait(state, dt, held) {
    if (state.obsPhase !== 'active' || !onRubric('wait') || state.obsSatisfied.wait) {
      state.obsWaitHeld = 0;
      return;
    }
    if (!held) { state.obsWaitHeld = 0; return; }
    state.obsWaitHeld += dt;
    if (state.obsWaitHeld >= O.waitHoldSeconds) satisfy(state, 'wait');
  }

  function finish(state) {
    state.obsPhase = 'done';
    dom.pa.classList.remove('on');
    const satisfied = rubric.filter(k => state.obsSatisfied[k]);
    state.obsResult = { satisfied, total: rubric.length, announced: !!visit.announced };
    const line = satisfied.length === rubric.length ? data.conclusion.full
      : satisfied.length === 0 ? data.conclusion.empty : data.conclusion.partial;
    toast('', 'The Observation', line);
  }

  const active = state => state.obsPhase === 'active';

  // ---- the post-conference -------------------------------------------------
  //
  // A tree now, not one exchange: every option may carry a `then` naming the
  // next node, and ui/conference.js loops until an option has none. Effects
  // land at every node, and an option may put a follow-up on the books
  // (`owes`), which is the semester record's problem rather than this file's.
  const node = id => data.conference.nodes[id] || null;
  const rootNode = () => node(data.conference.root);

  function optionIn(nodeId, key) {
    return node(nodeId)?.options.find(o => o.key === key) || null;
  }

  // Returns the option and where the tree goes next, or null for a key that is
  // not in that node. `state.obsConference` accumulates the path in order.
  function resolveConference(state, nodeId, key) {
    const opt = optionIn(nodeId, key);
    if (!opt) return null;
    applyEffects(state, opt.effects);
    state.obsConference.push({ node: nodeId, key });
    if (opt.owes) state.obsOwed = { ...opt.owes };
    return { option: opt, next: opt.then ? node(opt.then) : null, nextId: opt.then || null };
  }

  // What the report reads: the options along the path the player actually took.
  const conferencePath = state =>
    (state.obsConference || []).map(step => optionIn(step.node, step.key)).filter(Boolean);

  return {
    tick, satisfy, tickWait, active, visit,
    resolveConference, conferencePath, rootNode, node, optionIn,
    lookFors, rubric, conference: data.conference, report: data.report
  };
}
