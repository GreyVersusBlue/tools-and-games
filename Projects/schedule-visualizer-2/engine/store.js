// The store: the one place the current project lives. It knows nothing about
// the page. createStore({ project, clock, ids }) gives:
//
//   store.project              the current project (never changed in place)
//   store.apply(action, payload)   run an action from actions.js; one undo entry
//                              (none for a quiet action; see apply below, and
//                              a quiet payload's acrossProjects there)
//   store.undoOutcome          what the action undo would take back reported
//                              (actions.js buildingOutcome, importOutcome), or null
//   store.undo(), store.redo()     { label, focus } of what was undone or redone, or null
//   store.subscribe(fn)        fn(project, change) after every change; returns an unsubscribe
//   store.replace(project)     a freshly loaded project; history starts again
//   store.geometryVersion, .buildingVersion, .scheduleVersion, .version
//   store.derived.get(key, deps, compute)   a value recomputed only when a counter it names moves
//
// The three counters are how derived data knows it is stale. geometryVersion
// moves only when routes could change (cells, a space's cells, doors,
// connections, exits, floor levels, the walking speeds); buildingVersion on
// any building change, and whenever geometryVersion does; scheduleVersion on
// any schedule change. Each action says which it moves, and undo and redo
// move the same ones. `modified` is set from the clock on every change.

import { createHistory, record, undo as undoHistory, redo as redoHistory, peekUndo, peekRedo, HISTORY_LIMIT } from './history.js';
import { describeAction, ActionError, GEOMETRY, BUILDING, SCHEDULE, replaceProject } from './actions.js';
import { collectIds } from './ids.js';

export function createStore(options) {
  const clock = options.clock;
  const ids = options.ids;
  const limit = options.historyLimit === undefined ? HISTORY_LIMIT : options.historyLimit;
  if (!options.project || typeof clock !== 'function' || typeof ids !== 'function') {
    throw new TypeError('createStore needs { project, clock, ids }.');
  }
  let project = options.project;
  // an id the project already uses is never handed out again
  if (typeof ids.reserve === 'function') ids.reserve(collectIds(project));
  let history = createHistory();
  const counters = { geometry: 0, building: 0, schedule: 0, all: 0 };
  const listeners = new Set();
  const ctx = { ids, clock };
  const cache = new Map();

  function bump(bumps) {
    const geometry = bumps.includes(GEOMETRY);
    if (geometry) counters.geometry += 1;
    if (geometry || bumps.includes(BUILDING)) counters.building += 1;
    if (bumps.includes(SCHEDULE)) counters.schedule += 1;
    counters.all += 1;
  }

  function stamped(next) {
    return { ...next, modified: clock().toISOString() };
  }

  function notify(change) {
    for (const listener of Array.from(listeners)) listener(project, change);
  }

  const derived = {
    // deps: any of 'geometry', 'building', 'schedule'. compute(project) runs
    // again only after one of those counters has moved.
    get(key, deps, compute) {
      const stamp = deps.map((dep) => counters[dep]).join(':');
      const held = cache.get(key);
      if (held && held.stamp === stamp) return held.value;
      const value = compute(project);
      cache.set(key, { stamp, value });
      return value;
    },
    clear() {
      cache.clear();
    },
    // Everything worked out from the project that takes real time: routes,
    // crowd results, loads, places, walk results and findings (the result of
    // engine/worker.js). results() is a promise for the project as it is
    // now; asking twice between two changes gives the same promise. The
    // store does not run the engines itself: the page hands it something
    // that does, with use({ results() }) (ui/engine-client.js, which runs
    // them in a worker, or on the main thread where there is none).
    engine: null,
    use(engine) {
      if (engine !== null && (!engine || typeof engine.results !== 'function')) throw new TypeError('derived.use needs { results() } or null.');
      derived.engine = engine;
    },
    results() {
      if (!derived.engine) return Promise.reject(new Error('Nothing is attached to work out routes and findings. Call engineFor(store) from ui/engine-client.js first.'));
      return derived.engine.results();
    },
  };

  const store = {
    get project() {
      return project;
    },
    get geometryVersion() {
      return counters.geometry;
    },
    get buildingVersion() {
      return counters.building;
    },
    get scheduleVersion() {
      return counters.schedule;
    },
    get version() {
      return counters.all;
    },
    get history() {
      return history;
    },
    get canUndo() {
      return history.past.length > 0;
    },
    get canRedo() {
      return history.future.length > 0;
    },
    get undoLabel() {
      const entry = peekUndo(history);
      return entry ? entry.label : null;
    },
    get redoLabel() {
      const entry = peekRedo(history);
      return entry ? entry.label : null;
    },
    get undoOutcome() {
      const entry = peekUndo(history);
      return entry && entry.outcome ? entry.outcome : null;
    },
    derived,

    // Run an action. An ActionError from the action comes straight through
    // and nothing changes. An action that changes nothing makes no entry.
    // The entry keeps what the action reported for its result (`outcome`),
    // since the project kept here is a stamped copy of that result.
    //
    // A quiet action (action.quiet) is not the user's work on the school: it
    // makes no entry, does not clear redo and does not set `modified`. So
    // that undo and redo do not take it back, it is run on every state the
    // history holds of this same project as well; a state it refuses is left
    // as it is. A replaceProject entry (a load, a clear, an import, a
    // transfer, a restore) is where another project begins: its `before` and
    // everything past it on the undo side, its `after` and everything past it
    // on the redo side, are left alone (SV2-30c), so undoing a load does not
    // bring the other project back dismissed, ticked or noted as published.
    // A quiet payload's acrossProjects is a payload run on those other states
    // instead, for the one quiet change that belongs to the person and not
    // the project ("Don't show this again", SV2-30b); it is taken off before
    // the action sees the payload. It rides in the payload, not in a third
    // argument, so a wrapper of apply (the read-only refusal in
    // storage/session.js) passes it on.
    apply(action, payload) {
      let given = payload === undefined ? {} : payload;
      let across = null;
      if (action.quiet === true && given !== null && typeof given === 'object' && 'acrossProjects' in given) {
        const { acrossProjects, ...rest } = given;
        across = acrossProjects === undefined ? null : acrossProjects;
        given = rest;
      }
      const before = project;
      const result = action(before, given, ctx);
      // A quiet action that changes nothing here may still carry an
      // acrossProjects to the other projects in the history (SV2-28f): Help's
      // reopen of Getting started on a project already showing the card.
      const unchanged = result === before;
      if (unchanged && (action.quiet !== true || across === null)) return before;
      const info = unchanged ? null : describeAction(action, before, given, result);
      // whatever the action brought in, its ids are never handed out again
      if (!unchanged && typeof ids.reserve === 'function') ids.reserve(collectIds(result));
      if (action.quiet === true) {
        const runner = (body, done) => (state) => {
          if (!done.has(state)) {
            let next = state;
            try {
              next = action(state, body, ctx);
            } catch (error) {
              if (!(error instanceof ActionError)) throw error;
            }
            done.set(state, next);
          }
          return done.get(state);
        };
        const through = runner(given, new Map([[before, result]]));
        const beyond = across === null ? (state) => state : runner(across, new Map());
        // newest first on each side: this project's states until a boundary
        const carry = (entries, near, far) => {
          const out = entries.slice();
          let inside = true;
          for (let i = out.length - 1; i >= 0; i -= 1) {
            const entry = out[i];
            const own = inside ? through : beyond;
            const crosses = inside && entry.replaces === true;
            const other = crosses || !inside ? beyond : through;
            out[i] = { ...entry, [near]: own(entry[near]), [far]: other(entry[far]) };
            if (crosses) inside = false;
          }
          return out;
        };
        history = { past: carry(history.past, 'after', 'before'), future: carry(history.future, 'before', 'after') };
        // the visible project is as it was: nothing to save, nobody to tell
        if (unchanged) return before;
        project = result;
        bump(info.bumps);
        notify({ kind: 'apply', label: info.label, focus: info.focus, bumps: info.bumps, quiet: true });
        return project;
      }
      const after = stamped(result);
      const entry = { label: info.label, before, after, focus: info.focus, bumps: info.bumps, outcome: info.outcome };
      // another project from here on: a quiet action's carry stops at it
      if (action === replaceProject) entry.replaces = true;
      history = record(history, entry, limit);
      project = after;
      bump(info.bumps);
      notify({ kind: 'apply', label: info.label, focus: info.focus, bumps: info.bumps });
      return project;
    },

    undo() {
      const step = undoHistory(history);
      if (!step) return null;
      history = step.history;
      project = stamped(step.entry.before);
      bump(step.entry.bumps);
      notify({ kind: 'undo', label: step.entry.label, focus: step.entry.focus, bumps: step.entry.bumps });
      return { label: step.entry.label, focus: step.entry.focus };
    },

    redo() {
      const step = redoHistory(history);
      if (!step) return null;
      history = step.history;
      project = stamped(step.entry.after);
      bump(step.entry.bumps);
      notify({ kind: 'redo', label: step.entry.label, focus: step.entry.focus, bumps: step.entry.bumps });
      return { label: step.entry.label, focus: step.entry.focus };
    },

    // A project loaded from the device or a recovery point. Not an undo
    // entry: the history starts again and `modified` is left as loaded.
    replace(next) {
      project = next;
      if (typeof ids.reserve === 'function') ids.reserve(collectIds(project));
      history = createHistory();
      const bumps = [GEOMETRY, BUILDING, SCHEDULE];
      bump(bumps);
      notify({ kind: 'replace', label: null, focus: null, bumps });
      return project;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}
