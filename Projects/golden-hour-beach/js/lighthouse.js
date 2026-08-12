import * as THREE from 'three';
import { groundHeight } from './field.js';

// The lighthouse on the headland top. Phase 1 promised it as a nameless flash
// on the far horizon; now it is a place you can stand under. The beam is a
// fake — two long additive cones swinging around the lamp room — because a
// real volumetric light for a sky that mostly can't see it would be the wrong
// trade, and the fake reads as the real thing from every angle that matters.

export const LIGHTHOUSE = { x: -620, z: 26 };

export function buildLighthouse(scene) {
  const group = new THREE.Group();
  const gy = groundHeight(LIGHTHOUSE.x, LIGHTHOUSE.z);
  group.position.set(LIGHTHOUSE.x, gy, LIGHTHOUSE.z);
  scene.add(group);

  const white = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.5, metalness: 0.3 });

  // Tower, gallery, lamp room, cap.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 13, 14, 1), white);
  tower.position.y = 6.5;
  group.add(tower);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.02, 1.6, 14, 1),
    new THREE.MeshStandardMaterial({ color: 0x8c3b34, roughness: 0.7 }));
  band.position.y = 4.2;
  group.add(band);

  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.35, 14, 1), dark);
  gallery.position.y = 13.2;
  group.add(gallery);

  const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.7, 10, 1),
    new THREE.MeshStandardMaterial({
      color: 0xfff2c8, roughness: 0.2, emissive: 0xffe6a8, emissiveIntensity: 0,
    }));
  lampRoom.position.y = 14.2;
  group.add(lampRoom);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.2, 10), dark);
  cap.position.y = 15.6;
  group.add(cap);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.2), dark);
  door.position.set(0, 0.9, 2.22);
  group.add(door);

  // The beam pair: long, thin, additive, swinging together. Origin at the lamp.
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 14.2;
  group.add(beamPivot);
  const beamGeo = new THREE.ConeGeometry(6, 220, 12, 1, true);
  beamGeo.rotateZ(Math.PI / 2);       // point along +x
  beamGeo.translate(110, 0, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
  });
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI;
  beamPivot.add(beamA, beamB);

  // Lamp glare sprite: brightens as the beam sweeps past the camera bearing.
  const glareTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,244,210,1)');
    grad.addColorStop(0.4, 'rgba(255,230,160,0.4)');
    grad.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, opacity: 0,
  }));
  glare.position.y = 14.2;
  glare.scale.set(6, 6, 1);
  group.add(glare);

  const state = { group, angle: 0 };
  const toCam = new THREE.Vector3();

  state.update = (dt, nightT, camera) => {
    // The lamp wakes with dusk and sweeps all night. A touch of it survives in
    // daylight — lighthouses do run by day — but the beam only shows against a
    // darkening sky.
    state.angle += dt * 0.55;
    beamPivot.rotation.y = state.angle;
    const on = Math.min(1, nightT * 1.8);
    beamMat.opacity = on * 0.055;
    lampRoom.material.emissiveIntensity = on * 1.6;

    // Glare peaks when a beam points at the camera.
    toCam.set(camera.position.x - LIGHTHOUSE.x, 0, camera.position.z - LIGHTHOUSE.z);
    const camBearing = Math.atan2(-toCam.z, toCam.x);
    // Two beams, so the phase repeats every half-turn.
    const diff = Math.abs(((state.angle - camBearing) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2);
    const sweep = Math.pow(Math.max(0, 1 - diff / 0.35), 3);
    glare.material.opacity = on * (0.15 + sweep * 0.85);
    const s = 4 + sweep * 9;
    glare.scale.set(s, s, 1);
  };

  return state;
}
