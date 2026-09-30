// SkyWings 64 - world assembly. See CONTRACT.md (A: World).
import * as THREE from 'three';
import { createTerrain, LAYOUT, smoothstep, clamp } from './terrain.js';
import { createWater } from './water.js';
import { createSky } from './sky.js';
import { createLandmarks } from './landmarks.js';

export function createWorld(scene, seed = 1337) {
  const terrain = createTerrain(seed);
  const water = createWater(terrain);
  const sky = createSky(scene);
  const landmarks = createLandmarks(terrain, seed);

  scene.add(terrain.group, water.mesh, sky.group, landmarks.group);

  const { heightAt, surfaceAt } = terrain;
  const W = LAYOUT.wind;
  let time = 0;
  const _wind = new THREE.Vector3();
  const V = (x, z, y) => new THREE.Vector3(x, y !== undefined ? y : heightAt(x, z), z);

  const hd = landmarks.info.headings;
  const pads = {};
  for (const k in LAYOUT.pads) { const p = LAYOUT.pads[k]; pads[k] = { position: V(p.x, p.z, landmarks.info.padY[k]), heading: hd[k] }; }
  const landingZones = {};
  for (const k in LAYOUT.landing) { const l = LAYOUT.landing[k]; landingZones[k] = { position: V(l.x, l.z), radius: l.r }; }
  const thermals = LAYOUT.thermals.map((t) => ({ position: V(t.x, t.z), radius: t.radius, strength: t.strength }));

  function windAt(x, y, z) {
    const k = (1 + clamp(y, 0, 800) / 900) * (1 + 0.22 * Math.sin(time * 0.4 + x * 0.002 + z * 0.0013));
    return _wind.set(W.x * k, 0, W.z * k);
  }

  function liftAt(x, y, z) {
    const ground = heightAt(x, z);
    const agl = y - Math.max(ground, 0);
    if (agl < 0) return 0;
    let lift = 0;
    const vf = smoothstep(3, 60, agl) * (1 - smoothstep(520, 780, agl));
    for (let i = 0; i < thermals.length; i++) {
      const t = thermals[i], dx = x - t.position.x, dz = z - t.position.z, R = t.radius;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > R * 1.6) continue;
      let prof;
      if (d < R) prof = 1 - 0.35 * (d / R) * (d / R);
      else if (d < R * 1.25) prof = 0.65 * (1 - smoothstep(R, R * 1.25, d));
      else prof = -0.08 * smoothstep(R * 1.25, R * 1.4, d) * (1 - smoothstep(R * 1.4, R * 1.6, d)) * 4;
      lift += t.strength * prof * vf * (0.92 + 0.08 * Math.sin(time * 0.7 + i * 1.7));
    }
    // ridge / slope lift from wind hitting hillsides
    if (ground > 1 && agl < 170) {
      const e = 15;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const w = windAt(x, y, z);
      const up = clamp((w.x * gx + w.z * gz) * 1.1, -1.5, 3.5);
      lift += up * smoothstep(0, 10, agl) * (1 - smoothstep(40, 170, agl));
    }
    return lift;
  }

  function syncLighting() {
    const s = sky.state;
    const refl = new THREE.Color().copy(s.horizon).lerp(s.zenith, 0.35);
    water.setLighting(s.sunDir, s.sunColor, refl, s.daylight, s.horizon, s.zenith);
  }
  syncLighting();

  const info = landmarks.info;
  const world = {
    scene,
    update(dt, elapsed, cameraPosition) {
      time = elapsed !== undefined ? elapsed : time + dt;
      try {
        terrain.update(cameraPosition);
        sky.update(dt, time, cameraPosition, W);
        water.update(dt, time, cameraPosition);
        landmarks.update(dt, time);
      } catch (e) { /* never throw during frame update */ }
    },
    heightAt,
    surfaceAt,
    liftAt,
    windAt,
    pads,
    landingZones,
    thermals,
    setTimeOfDay(t01) { sky.setTimeOfDay(t01); syncLighting(); },
    // extras for integrators / missions
    waterHeightAt(x, z) { return water.waveAt(x, z, time); },
    slopeAt: terrain.slopeAt,
    sun: sky.sun,
    hemi: sky.hemi,
    bounds: { min: -2000, max: 2000 },
    seed,
    landmarks: {
      lighthouse: info.lighthouse, castle: info.castle, statue: info.statue, bridge: info.bridge,
      windmills: info.windmills, cabins: info.cabins,
      peak: new THREE.Vector3(terrain.peak.x, terrain.peak.h, terrain.peak.z),
    },
    runway: { start: V(LAYOUT.runway.ax, LAYOUT.runway.az), end: V(LAYOUT.runway.bx, LAYOUT.runway.bz), width: LAYOUT.runway.width },
    meshes: { terrain: terrain.group, water: water.mesh, sky: sky.group, landmarks: landmarks.group },
  };
  return world;
}

export default createWorld;
