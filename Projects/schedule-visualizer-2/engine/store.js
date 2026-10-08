// The store: the one place the current project lives. It knows nothing about
// the page. createStore({ project, clock, ids }) gives:
//
//   store.project              the current project (never changed in place)
//   store.apply(action, payload)   run an action from actions.js; one undo entry
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
import { describeAction, GEOMETRY, BUILDING, SCHEDULE } from './actions.js';
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
    derived,

    // Run an action. An ActionError from the action comes straight through
    // and nothing changes. An action that changes nothing makes no entry.
    apply(action, payload) {
      const given = payload === undefined ? {} : payload;
      const before = project;
      const result = action(before, given, ctx);
      if (result === before) return before;
      const info = describeAction(action, before, given, result);
      const after = stamped(result);
      history = record(history, { label: info.label, before, after, focus: info.focus, bumps: info.bumps }, limit);
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
