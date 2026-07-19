import * as THREE from 'three';
import { Water } from '../libs/Water.js';
import { groundHeight } from './terrain.js';

// The sea: a big reflective Water plane whose height breathes very slowly
// (the "slap" cycle), plus a soft foam line that slides up and down the
// wet sand in sync.

export function buildOcean(scene, sunDirection) {
  const geo = new THREE.PlaneGeometry(1600, 1600);

  const water = new Water(geo, {
    textureWidth: 512,
    textureHeight: 512,
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
  water.position.set(0, 0, -420); // centered offshore; big enough to reach horizon
  scene.add(water);

  // Foam line: a long thin translucent strip that follows the swash.
  const foamGeo = new THREE.PlaneGeometry(400, 2.4, 160, 1);
  foamGeo.rotateX(-Math.PI / 2);
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xfff4e0,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  scene.add(foam);
  const foamBase = foamGeo.attributes.position.array.slice();

  const state = {
    water, foam,
    t: 0,
    swashPeriod: 9.5,      // seconds per slow wave slap
    getSwashPhase() {
      return (this.t % this.swashPeriod) / this.swashPeriod; // 0..1
    },
    // exposed so audio can sync the wave-wash sound to the visual slap
    swashLevel: 0,
  };

  state.update = (dt) => {
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

    // Where does this water level meet the beach? Solve on dry-slope:
    // groundHeight ≈ (z+6)*0.055 for z>-6  →  z = level/0.055 - 6
    const zLine = Math.min(4, (water.position.y) / 0.055 - 6);

    // Foam strip hugs the terrain at the waterline, fading with retreat
    const posArr = foam.geometry.attributes.position;
    for (let i = 0; i < posArr.count; i++) {
      const x = foamBase[i * 3];
      const localZ = foamBase[i * 3 + 2];
      const wob = Math.sin(x * 0.09 + state.t * 0.6) * 0.7 + Math.sin(x * 0.023 - state.t * 0.3) * 1.1;
      const z = zLine + localZ + wob * 0.4;
      posArr.setX(i, x);
      posArr.setZ(i, z);
      posArr.setY(i, Math.max(groundHeight(x, z), water.position.y) + 0.03);
    }
    posArr.needsUpdate = true;
    foamMat.opacity = 0.10 + s * 0.30;
  };

  return state;
}
