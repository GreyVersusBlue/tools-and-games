// One tab edits; any other tab on the same project is read-only until the
// first one goes.
//
// The first tab takes the Web Lock `sv2:project` and holds it for as long as
// it lives. A tab that cannot get it asks again every 5 s, so it becomes the
// editing tab within 5 s of the first one closing.
//
// Where Web Locks are missing, the localStorage key `sv2:tab` holds
// { tabId, at }: the editing tab rewrites it every 2 s, and another tab
// treats it as abandoned after 60 s without a beat (a hidden tab's timers
// are slowed to once a minute, so anything shorter would steal from a tab
// that is only in the background). The editing tab removes the key as it
// leaves.
//
// Both names are permanent.
//
// watchTabs({ onChange, locks, storage, ... }) -> { ready, owner, kind, stop() }
//   ready     a promise of the first answer: true when this tab may edit
//   onChange  called with true or false whenever the answer changes after that

export const TAB_LOCK = 'sv2:project';
export const TAB_KEY = 'sv2:tab';
export const TAB_RETRY_MS = 5000;
export const TAB_BEAT_MS = 2000;
export const TAB_STALE_MS = 60000;

export function watchTabs(options) {
  const opts = options || {};
  const onChange = opts.onChange || (() => {});
  const nav = globalThis.navigator;
  const locks = opts.locks === undefined ? (nav && nav.locks) : opts.locks;
  const every = opts.setInterval || ((fn, ms) => setInterval(fn, ms));
  const stopEvery = opts.clearInterval || ((id) => clearInterval(id));
  const now = opts.now || (() => Date.now());
  const retryMs = opts.retryMs === undefined ? TAB_RETRY_MS : opts.retryMs;
  const beatMs = opts.beatMs === undefined ? TAB_BEAT_MS : opts.beatMs;
  const staleMs = opts.staleMs === undefined ? TAB_STALE_MS : opts.staleMs;

  let owner = false;
  let answered = false;
  let timer = null;
  let stopped = false;
  let release = null;

  function settle(next) {
    if (stopped) return;
    const changed = next !== owner;
    owner = next;
    if (!answered) answered = true;
    else if (changed) onChange(owner);
  }

  // ------------------------------------------------------------ Web Locks

  function askForLock() {
    return new Promise((resolve) => {
      locks.request(TAB_LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        // held until this promise settles: when the tab goes, or stop()
        return new Promise((done) => {
          release = done;
        });
      }).catch(() => resolve(false));
    });
  }

  async function startLocks() {
    settle(await askForLock());
    if (owner) return;
    timer = every(async () => {
      if (owner || stopped) return;
      if (await askForLock()) {
        if (timer !== null) stopEvery(timer);
        timer = null;
        settle(true);
      }
    }, retryMs);
  }

  // ------------------------------------------------------------ the heartbeat

  const tabId = opts.tabId || (now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  let store = null;

  function readBeat() {
    try {
      const value = JSON.parse(store.getItem(TAB_KEY));
      return value && typeof value === 'object' && typeof value.tabId === 'string' && Number.isFinite(value.at) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function beat() {
    const held = readBeat();
    const mine = held !== null && held.tabId === tabId;
    const free = held === null || now() - held.at > staleMs;
    if (mine || free) {
      store.setItem(TAB_KEY, JSON.stringify({ tabId, at: now() }));
      return true;
    }
    return false;
  }

  function leave() {
    if (!owner || store === null) return;
    try {
      const held = readBeat();
      if (held && held.tabId === tabId) store.removeItem(TAB_KEY);
    } catch (error) { /* the tab is going either way */ }
  }

  function startBeat() {
    try {
      store = opts.storage === undefined ? globalThis.localStorage : opts.storage;
      settle(beat());
    } catch (error) {
      // no way to see another tab here; the save's own savedAt check still
      // stops two tabs overwriting each other
      store = null;
      settle(true);
      return;
    }
    timer = every(() => {
      try {
        settle(beat());
      } catch (error) { /* keep the last answer */ }
    }, beatMs);
    if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('pagehide', leave);
  }

  const usesLocks = Boolean(locks && typeof locks.request === 'function');
  const ready = (usesLocks ? startLocks() : Promise.resolve().then(startBeat)).then(() => owner);

  return {
    ready,
    kind: usesLocks ? 'locks' : 'heartbeat',
    get owner() {
      return owner;
    },
    stop() {
      stopped = true;
      if (timer !== null) stopEvery(timer);
      timer = null;
      if (release) release();
      leave();
      if (!usesLocks && typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('pagehide', leave);
    },
  };
}
