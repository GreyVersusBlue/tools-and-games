import * as THREE from 'three';
import { Water } from '../libs/Water.js';
import { groundHeight, shorelineZ, beachSlope } from './field.js';

// The sea: a big reflective Water plane whose height breathes very slowly
// (the "slap" cycle), plus a soft foam line that slides up and down the
// wet sand in sync.

/** Soft-edged alpha ramp across the foam strip's width, with a bias seaward. */
function foamFade() {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 32;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0.00, '#000');
  grad.addColorStop(0.30, '#fff');
  grad.addColorStop(0.55, '#e0e0e0');
  grad.addColorStop(1.00, '#000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 1, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function buildOcean(scene, sunDirection) {
  // Big enough to reach the horizon from either end of the 1.6 km coast.
  const geo = new THREE.PlaneGeometry(3400, 2200);

  const water = new Water(geo, {
    // 1024, up from 512. There is something standing in the water now — the
    // groyne — and thin dark verticals are the worst case for a low-resolution
    // reflection: at 512 they came back as jagged black shapes on the water
    // rather than posts. Measured cost of the bump on this machine is below.
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: new THREE.TextureLoader().load('assets/waternormals.jpg', t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }),
    sunDirection: sunDirection.clone(),
    sunColor: 0xffcf99,
    waterColor: 0x0e3f4a,
    distortionScale: 2.2,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -560); // centered offshore; reaches past both capes
  scene.add(water);

  // Foam line: thin translucent strips that follow the swash, one per 100 m of
  // shoreline. The per-vertex re-deform is the cost, not the geometry, so each
  // frame only strips within FOAM_ACTIVE metres of the camera update — the
  // rest keep the shape they had when last near, which from that far away is
  // indistinguishable. The alpha ramp across the width is what keeps the strip
  // from reading as tape; that lesson predates the pool.
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xfff4e0,
    transparent: true,
    opacity: 0.0,
    alphaMap: foamFade(),
    depthWrite: false,
  });
  const FOAM_CHUNK = 100, FOAM_ACTIVE = 260;
  const foamStrips = [];
  for (let x0 = -800; x0 < 800; x0 += FOAM_CHUNK) {
    const g = new THREE.PlaneGeometry(FOAM_CHUNK, 2.4, 40, 2);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, foamMat);
    scene.add(mesh);
    foamStrips.push({ mesh, base: g.attributes.position.array.slice(), cx: x0 + FOAM_CHUNK / 2 });
  }
  const foamDay = new THREE.Color(0xfff4e0);
  const foamBio = new THREE.Color(0x5fe8ff);
  let foamAdditive = false;
  let firstFoamPass = true;

  const state = {
    water, foamStrips,
    t: 0,
    swashPeriod: 9.5,      // seconds per slow wave slap
    getSwashPhase() {
      return (this.t % this.swashPeriod) / this.swashPeriod; // 0..1
    },
    // exposed so audio can sync the wave-wash sound to the visual slap
    swashLevel: 0,

    // The sun moves now (main.js). The Water shader keeps its own copies of the
    // direction and colour, so they have to be pushed in — leave them and the
    // sea keeps the sun path it had at load while the sky above it drops.
    setSun(dir, color) {
      water.material.uniforms['sunDirection'].value.copy(dir).normalize();
      water.material.uniforms['sunColor'].value.copy(color);
    },

    // Bioluminescence. Deep at night the foam line stops being cream and starts
    // to glow faint cyan — each run-up paints a lit arc on the dark sand. The
    // glow is the foam material itself going additive; no light, no shader edit.
    // bio is 0..1 from the palette keyframes, single writer as ever.
    setNight(bio) {
      foamMat.color.copy(foamDay).lerp(foamBio, bio);
      const wantAdd = bio > 0.5;
      if (wantAdd !== foamAdditive) {
        foamAdditive = wantAdd;
        foamMat.blending = wantAdd ? THREE.AdditiveBlending : THREE.NormalBlending;
        foamMat.needsUpdate = true;
      }
      state._bio = bio;
    },
    _bio: 0,
  };

  state.update = (dt, camera) => {
    state.t += dt;
    water.material.uniforms['time'].value += dt * 0.35; // slow ripple

    // Tide "breathing": water plane rises/falls a touch, pushing the
    // waterline up the beach slope and back.
    const p = state.getSwashPhase();
    // asymmetric wave: quick-ish run-up, slow retreat
    const s = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2) : Math.cos(((p - 0.35) / 0.65) * Math.PI / 2);
    state.swashLevel = s;
    const level = 0.06 + s * 0.32;
    water.position.y = level - 0.25;

    // Each active strip hugs the terrain at the local waterline: where this
    // water level meets the beach slope, starting from the shoreline curve.
    const camX = camera ? camera.position.x : 0;
    const slope = beachSlope();
    for (const strip of foamStrips) {
      if (!firstFoamPass && Math.abs(strip.cx - camX) > FOAM_ACTIVE) continue;
      const posArr = strip.mesh.geometry.attributes.position;
      const base = strip.base;
      for (let i = 0; i < posArr.count; i++) {
        const x = base[i * 3] + strip.cx;
        const localZ = base[i * 3 + 2];
        const sz = shorelineZ(x);
        const zLine = Math.min(sz + 10, sz + water.position.y / slope);
        const wob = Math.sin(x * 0.09 + state.t * 0.6) * 0.7 + Math.sin(x * 0.023 - state.t * 0.3) * 1.1;
        const z = zLine + localZ + wob * 0.4;
        posArr.setX(i, x);
        posArr.setZ(i, z);
        posArr.setY(i, Math.max(groundHeight(x, z), water.position.y) + 0.03);
      }
      posArr.needsUpdate = true;
    }
    firstFoamPass = false;
    // Additive glow wants a touch more presence at full run-up than daytime foam.
    foamMat.opacity = 0.10 + s * 0.30 + state._bio * s * 0.15;
  };

  return state;
}
