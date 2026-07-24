import * as THREE from 'three';
import { Sky } from '../libs/Sky.js';
import { buildTerrain, groundHeight } from './terrain.js';
import { buildOcean } from './ocean.js';
import { buildWildlife } from './wildlife.js';
import { WalkControls } from './controls.js';
import { Soundscape } from './audio.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe8b28a, 0.0022);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2500);

// ---------- Sunset sky ----------
const sky = new Sky();
sky.scale.setScalar(2000);
scene.add(sky);

const sunElevationDeg = 3.2;     // just above the horizon — deep golden hour
const sunAzimuthDeg = 195;       // roughly out over the water, slightly west
const sun = new THREE.Vector3();
{
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 2.6;
  u.mieCoefficient.value = 0.012;
  u.mieDirectionalG.value = 0.92;
  const phi = THREE.MathUtils.degToRad(90 - sunElevationDeg);
  const theta = THREE.MathUtils.degToRad(sunAzimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sun);
}

// ---------- Lighting ----------
const sunLight = new THREE.DirectionalLight(0xffb26b, 2.4);
sunLight.position.copy(sun).multiplyScalar(300);
scene.add(sunLight);

const skyFill = new THREE.HemisphereLight(0xcf8ab0, 0x6b5138, 0.55);
scene.add(skyFill);

const bounce = new THREE.AmbientLight(0x86506a, 0.25);
scene.add(bounce);

// ---------- World ----------
buildTerrain(scene);
const ocean = buildOcean(scene, sun);
const audio = new Soundscape();
const wildlife = buildWildlife(scene, audio);
const controls = new WalkControls(camera, canvas, groundHeight);
controls.pos.set(0, 0, 14);   // start on dry sand, sea ahead

// ---------- Sun glint sprite ----------
const glintTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,230,180,0.9)');
  grad.addColorStop(0.3, 'rgba(255,190,120,0.35)');
  grad.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false }));
glint.scale.set(260, 260, 1);
glint.position.copy(sun).multiplyScalar(1400);
glint.position.y = Math.max(glint.position.y, 40);
scene.add(glint);

// ---------- Overlay / input bootstrap ----------
const overlay = document.getElementById('overlay');
const isTouch = window.matchMedia('(pointer: coarse)').matches;

function begin() {
  audio.init();
  audio.resume();
  controls.enabled = true;
  overlay.classList.add('hidden');
  if (!isTouch) canvas.requestPointerLock?.();
}
overlay.addEventListener('click', begin);
canvas.addEventListener('click', () => {
  if (controls.enabled && !isTouch && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
});

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', e => {
  e.stopPropagation();
  audio.setMuted(!audio.muted);
  muteBtn.innerHTML = audio.muted ? '&#128263;' : '&#128266;';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  const moving = controls.update(dt);
  ocean.update(dt);
  wildlife.update(dt, camera);
  audio.update(dt, ocean.swashLevel, moving && controls.enabled);

  renderer.render(scene, camera);
}
tick();
