// three-hook.mjs — lets Node load what the browser loads.
//
// The vendored addons import `three` bare, and src/world/models.js imports
// `three/addons/...` bare, because in a browser index.html's import map turns
// both into paths under libs/. Node has no import map, so without this nothing
// that touches GLTFLoader could run in a test. This is the import map, said
// once more for Node: the same two entries, pointing at the same files.
//
//   import './three-hook.mjs';   // first, before anything that imports three
//
// Registered with module.register(), so it needs Node 20.6 or later.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const libs = pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../libs') + '/').href;

const hook = `
const LIBS = ${JSON.stringify(libs)};
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: LIBS + 'three.module.js', shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: LIBS + 'addons/' + specifier.slice(13), shortCircuit: true };
  return next(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// three's FileLoader reports progress with a DOM ProgressEvent, which Node
// does not have. Nothing in a test listens for it; it only has to construct.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
