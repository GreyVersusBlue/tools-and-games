// Autosave: every change to the project schedules a save 600 ms later. More
// changes inside that time push it back (a trailing debounce), but never past
// 3 s after the first unsaved change, so a long run of painting still saves.
// A save that fails is retried every 10 s until one works. A save refused
// because another tab saved first stops autosave: retrying would only ask to
// overwrite that tab's work again.
//
// createAutosave({ write, onState, delay, maxWait, retry, setTimeout, clearTimeout, now })
//   write()    saves the project as it is now; returns a promise of savedAt
//   onState(state, detail)   'saving' | 'saved' (detail: savedAt) |
//                            'failed' (detail: the error) | 'conflict' (detail: the error)
// returns { changed(), flush(), pause(), resume(), setTiming({ delay, maxWait, retry }), state, pending }
//
// No DOM and no storage here: the caller supplies both ends.

export const SAVE_DELAY_MS = 600;
export const SAVE_MAX_WAIT_MS = 3000;
export const SAVE_RETRY_MS = 10000;

export function createAutosave(options) {
  const write = options.write;
  const onState = options.onState || (() => {});
  const later = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.clearTimeout || ((id) => clearTimeout(id));
  const now = options.now || (() => Date.now());
  let delay = options.delay === undefined ? SAVE_DELAY_MS : options.delay;
  let maxWait = options.maxWait === undefined ? SAVE_MAX_WAIT_MS : options.maxWait;
  let retry = options.retry === undefined ? SAVE_RETRY_MS : options.retry;

  let state = 'idle';
  let timer = null;
  let dirty = false; // a change no finished save has covered
  let dirtySince = 0; // when the oldest such change was made
  let writing = null; // the save in flight
  let paused = false;
  let stopped = false; // a conflict: nothing more is written

  function set(next, detail) {
    state = next;
    onState(next, detail);
  }

  function clear() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function schedule(ms) {
    clear();
    timer = later(() => {
      timer = null;
      run();
    }, ms);
  }

  function run() {
    if (paused || stopped || !dirty) return Promise.resolve();
    if (writing) return writing;
    dirty = false;
    let attempt;
    try {
      attempt = Promise.resolve(write());
    } catch (error) {
      attempt = Promise.reject(error);
    }
    writing = attempt.then((savedAt) => {
      writing = null;
      // a change made while this save was in flight has its own save coming
      if (dirty) schedule(delay);
      else set('saved', savedAt);
    }, (error) => {
      writing = null;
      dirty = true;
      if (error && error.name === 'ConflictError') {
        stopped = true;
        clear();
        set('conflict', error);
        return;
      }
      set('failed', error);
      schedule(retry);
    });
    return writing;
  }

  return {
    get state() {
      return state;
    },
    // Is there a change that is not saved yet?
    get pending() {
      return dirty || writing !== null;
    },

    // The project changed.
    changed() {
      if (stopped) return;
      const at = now();
      if (!dirty) dirtySince = at;
      dirty = true;
      if (paused) return;
      // while a save is failing the banner and the red indicator stay up
      if (state !== 'failed') set('saving');
      schedule(Math.max(0, Math.min(delay, dirtySince + maxWait - at)));
    },

    // Save now if anything is waiting (the page is being left).
    flush() {
      clear();
      return run();
    },

    // A read-only tab saves nothing.
    pause() {
      paused = true;
      clear();
    },
    // Editable again. What this tab showed while it was paused was never its
    // own work, so nothing from then is owed a save.
    resume() {
      paused = false;
      dirty = false;
    },

    setTiming(timing) {
      if (timing.delay !== undefined) delay = timing.delay;
      if (timing.maxWait !== undefined) maxWait = timing.maxWait;
      if (timing.retry !== undefined) retry = timing.retry;
      if (timer !== null && state === 'failed') schedule(retry);
    },
  };
}
