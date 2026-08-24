# Textures

v1 generates all surface textures procedurally on canvas (see `js/render.js`),
per the build brief's fallback path — the build environment had no network
access to Poly Haven / ambientCG.

To upgrade to real PBR sets: drop CC0 texture maps here (e.g.
`floor_diff_1k.jpg`, `floor_nor_1k.jpg`, `floor_rough_1k.jpg`) and swap the
`map` / `normalMap` / `roughnessMap` on the corresponding
`MeshStandardMaterial` in `js/render.js` to `new THREE.TextureLoader().load(...)`.
Set `wrapS/wrapT = RepeatWrapping` and `colorSpace = SRGBColorSpace` on albedo
maps to match the current setup.
