// The one place a bare `three` specifier becomes a path.
//
// `import * as THREE from 'three'` only resolves in a browser, against the
// import map in index.html. Node has no import map, so every module that
// reached for the bare specifier was unloadable outside a browser — which is
// why systems/tells.js, a dependency-injected factory whose whole job is
// logic, had never been executed by a test.
//
// index.html's import map still maps `three`, because the vendored addons
// import it bare and those files are copied verbatim. Both routes resolve to
// the same URL, so the browser loads one three, not two.
export * from '../libs/three.module.js';
