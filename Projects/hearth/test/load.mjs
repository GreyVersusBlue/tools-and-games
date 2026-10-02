// Hearth in Node, without a browser (TG-26). The game is ten classic scripts sharing one global scope, so there is no module to
// import; this runs them, in index.html's order, inside one vm context whose document, canvas and audio are a stub that answers
// every property and every call with itself. What comes out is the real code — the same newWorld, step, pack and tellOfDead the
// page runs — with nothing drawn and nothing heard. The RAF loop never starts: the stubbed Image never loads, so sheetGo never
// calls back, and every step is the caller's.
//
// Node's V8 is not Chromium 1194's (see hearth-ci.yml): Math.pow and Math.sin differ in the last bits, so an island stepped here
// is a different island from the pinned one. Nothing here compares against hashes.json. It compares the code with itself.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ORDER = ['js/core.js', 'js/flavor.js', 'js/life.js', 'js/watcher.js', 'js/sim.js', 'assets/sprites/buildings.js',
  'js/render.js', 'js/audio.js', 'js/save.js', 'js/main.js'];

function stub() {
  const f = function () {};
  const p = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (Object.prototype.hasOwnProperty.call(t, k)) return t[k];
      return p;
    },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}

// `warn` collects every console.warn and console.error line, the way the harness collects `hearth:` lines from the page.
export function loadHearth() {
  const S = stub(), warns = [];
  const store = new Map();
  const ctx = {
    console: { log() {}, info() {}, warn: (...a) => warns.push(a.join(' ')), error: (...a) => warns.push(a.join(' ')) },
    document: S, navigator: S, history: S, performance,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { hash: '', search: '', href: '', pathname: '/' },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame() {}, setTimeout, clearTimeout,
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
    Image: function () { return S; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  // `ev` reads and writes the scripts' own top-level let/const, which window.__hearth only partly exposes
  const ev = code => vm.runInContext(code, ctx);
  return { H: ctx.__hearth, ev, ctx, warns };
}
