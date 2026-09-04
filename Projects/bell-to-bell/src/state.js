import { CFG } from './config.js';

export function createState() {
  return {
    running: false,
    ended: false,
    t: CFG.periodSeconds,

    mastery: CFG.start.mastery,
    fidelity: CFG.start.fidelity,
    rapport: CFG.start.rapport,
    bandwidth: CFG.start.bandwidth,
    restless: CFG.start.restless,
    hyper: 0,

    withitness: false,
    withitnessUses: 0,
    withitnessSeconds: 0,
    falseSpawned: false,

    // the lesson
    beat: 0,
    beatProgress: 0,        // game seconds spent delivering the current beat
    beatsDelivered: 0,
    onFiller: false,
    checksThisBeat: 0,
    checks: 0,
    reteaches: 0,
    rushed: 0,
    lastCheckAt: null,      // state.t at the last check
    revealed: false,
    masteryPending: 0,      // mastery effects owed to the class, in meter points

    // the seating chart
    rechart: null,

    // room temp
    tempReadAt: null,
    tempUses: 0,
    tempZone: null,

    // Phase 5: the subject's one number. Science is the only subject that has
    // it, it rises on lab days and settles otherwise, and it does not cross
    // the bell — it is a fact about this period in this room, the way
    // Restlessness is, so Bandwidth is still the only carried meter.
    hazard: 0,
    incident: false,

    caught: 0,
    missed: 0,
    sawCurveball: false,
    leverage: [],
    firedEvents: new Set(),
    openTell: null,

    // T7: the Observation. 'idle' -> 'alert' -> 'active' -> 'done', in order,
    // once per period, unskippable and unrepeatable.
    obsPhase: 'idle',
    obsAlertRemaining: 0,   // real seconds left in the Admin Proximity Alert
    obsWindowRemaining: 0,  // game seconds left once she's actually in the room
    obsSatisfied: {},       // look-for key -> true, once satisfied it stays satisfied
    obsWaitHeld: 0,         // real seconds KeyF has been held, this window
    obsResult: null,        // { satisfied: [...], total, announced } once the window closes

    // Phase 4: the post-conference is a tree, so what you said to her is a
    // path through it rather than one key; `obsOwed` is the follow-up an
    // option put on the books, which the semester record settles, not this.
    obsConference: [],      // [{ node, key }], in the order they were said
    obsOwed: null,          // { id, lookFor, days } if an answer promised one

    // Phase 4: what you actually did in the room today, rubric or no rubric.
    // A promised follow-up is kept by doing the thing on a later day, and she
    // is not in the room when you do it.
    lookForsUsed: []
  };
}

export const clamp01to100 = v => Math.max(0, Math.min(100, v));
export const clamp01 = v => Math.max(0, Math.min(1, v));

// Apply a { mastery, rapport, ... } effect bag from data.
//
// Mastery is the exception: it is no longer a number the game can simply add to,
// it is the mean of what twelve people understand. So anything that claims to
// cost Mastery gets queued and the lesson system spends it across the room.
export function applyEffects(state, effects = {}) {
  for (const [k, v] of Object.entries(effects)) {
    if (k === 'mastery') { state.masteryPending += v; continue; }
    if (typeof state[k] === 'number') state[k] += v;
  }
}
