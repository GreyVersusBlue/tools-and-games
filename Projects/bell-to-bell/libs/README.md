# libs — three.js r160, vendored

`three.module.js` and the three addon modules `src/` imports, copied verbatim
from the `three@0.160.0` npm tarball. Nothing here is edited, and there is no
build step: `index.html`'s import map points `three` and `three/addons/` at
this folder and the browser resolves them itself.

Before Phase 6 the import map pointed at `cdn.jsdelivr.net`, which was the last
offsite request in the project and the one thing the repo's zero-offsite rule
had no exception for. The version did not change with the move — r160 is the
same revision the CDN was serving — so nothing in `src/` had to.

What is here, and why each one:

| File | Imported by |
| --- | --- |
| `three.module.js` | everything |
| `addons/loaders/GLTFLoader.js` | `src/world/models.js` |
| `addons/utils/SkeletonUtils.js` | `src/world/models.js`, for cloning a rigged character per student |
| `addons/utils/BufferGeometryUtils.js` | `GLTFLoader.js` itself, for `toTrianglesDrawMode` |

That is the whole closure. Nothing else in the tarball is reachable from
`src/`, and `tests/smoke.mjs` asserts the list stays that way, so adding an
addon import without vendoring the file fails the suite rather than 404ing in
somebody's browser.

three.js is MIT licensed; `LICENSE` is the copy that ships with the package.
