import * as THREE from 'three';

// Every material carries a thermal twin. Withitness swaps the whole scene
// over in one traversal, so anything added to the world must be registered.
const PALETTE = {
  floor:  [0xC9BFA8, 0x0A1420],
  wall:   [0xD8DCD2, 0x08111C],
  ceil:   [0xE9ECE6, 0x060D16],
  board:  [0xF2F4F0, 0x0D1E30],
  desk:   [0xBFA478, 0x102438],
  metal:  [0x7A8078, 0x0C1826],
  wood:   [0x8A6A44, 0x102438],
  rug:    [0x6E7F8C, 0x0B1826],
  poster: [0xE0C24A, 0x14283C],
  skin:   [0xD9A579, 0xFF9C4A],
  shirtA: [0x4A6E8C, 0xE86A18],
  shirtB: [0x8C5A5A, 0xF07A22],
  shirtC: [0x5A7A5A, 0xE8721C],
  hair:   [0x3A2E26, 0xC65210],
  glass:  [0xCFE4F2, 0x123048]
};

const texLoader = new THREE.TextureLoader();

// Non-blocking: TextureLoader.load() returns the Texture immediately and
// fills it in whenever the image arrives, flagging needsUpdate itself. The
// render loop already runs every frame regardless, so no one has to await
// this — the flat PALETTE color is what you see until the photo lands.
function loadTex(url, srgb) {
  const t = texLoader.load(encodeURI(url));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// data/assets.json's `textures` manifest, keyed the same as PALETTE. A key
// with no entry (board, poster, skin, shirts, hair, glass) just stays flat —
// canvas-texture screens, flavor content and character skin have no PBR set.
export function createMaterials(assets) {
  const textures = assets?.textures || {};
  const mats = {};
  for (const [key, [normal, thermal]] of Object.entries(PALETTE)) {
    const transparent = key === 'glass';
    const m = new THREE.MeshStandardMaterial({
      color: normal, roughness: 0.85, metalness: key === 'metal' ? 0.6 : 0,
      transparent, opacity: transparent ? 0.75 : 1
    });
    m.userData.thermal = new THREE.MeshBasicMaterial({ color: thermal, transparent, opacity: transparent ? 0.75 : 1 });

    const tex = textures[key];
    if (tex) {
      const { dir, base, tile, packedArm = true } = tex;
      m.map = loadTex(`${dir}/${base}_diff_1k.jpg`, true);
      m.normalMap = loadTex(`${dir}/${base}_nor_gl_1k.jpg`, false);
      // Most Poly Haven sets ship one arm.jpg packing AO/roughness/metalness
      // into R/G/B. Not all of them do (plywood only has a plain rough.jpg) —
      // packedArm:false in the manifest switches to that instead.
      if (packedArm) {
        const arm = loadTex(`${dir}/${base}_arm_1k.jpg`, false);
        m.roughnessMap = arm;
        m.metalnessMap = arm;
      } else {
        m.roughnessMap = loadTex(`${dir}/${base}_rough_1k.jpg`, false);
      }
      m.userData.tile = tile || 1.4;
    }
    mats[key] = m;
  }
  return mats;
}

// A textured box's UVs are 0..1 per face regardless of the face's real size,
// so the same wall material stretched over a 10m wall and a 3m wall needs
// different repeat counts. Rather than cloning per instance (which would
// duplicate the uploaded texture per desk leg — dozens of times over), this
// clones once per distinct (material, size) pair and reuses it after that.
const tileCache = new Map();
export function tiled(mats, key, w, d) {
  const base = mats[key];
  if (!base || !base.map) return base;
  const tile = base.userData.tile;
  const cacheKey = `${key}:${w.toFixed(2)}:${d.toFixed(2)}`;
  let m = tileCache.get(cacheKey);
  if (!m) {
    m = base.clone();
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
      if (base[slot]) {
        const t = base[slot].clone();
        t.repeat.set(w / tile, d / tile);
        t.needsUpdate = true;
        m[slot] = t;
      }
    }
    m.userData.thermal = base.userData.thermal;
    tileCache.set(cacheKey, m);
  }
  return m;
}

export function createRegistry() {
  const meshes = [];
  return {
    add(mesh) { meshes.push(mesh); return mesh; },
    setThermal(on) {
      for (const m of meshes) {
        if (on) {
          if (!m.userData.orig) m.userData.orig = m.material;
          const t = m.userData.orig.userData?.thermal;
          if (t) m.material = t;
        } else if (m.userData.orig) {
          m.material = m.userData.orig;
        }
      }
    }
  };
}
