// scene-setup.js — renderer, camera, lighting, fog, ground plane, audio stub.

import * as THREE from 'three';
import { loadPBRMaterial } from './assets.js';

export function createScene(config) {
  const scene = new THREE.Scene();

  // Fog / sky tint
  const fogCfg = config.lighting.fog;
  scene.fog = new THREE.Fog(fogCfg.color, fogCfg.near, fogCfg.far);
  scene.background = new THREE.Color(fogCfg.color);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  // Camera
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(...config.spawn.position);
  camera.lookAt(new THREE.Vector3(...config.spawn.lookAt));

  // Ambient audio hook point (silent for now — ready for footsteps/ambience later)
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);

  // Lights
  const sunCfg = config.lighting.sun;
  const sun = new THREE.DirectionalLight(sunCfg.color, sunCfg.intensity);
  sun.position.set(...sunCfg.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const hemiCfg = config.lighting.hemisphere;
  const hemi = new THREE.HemisphereLight(hemiCfg.skyColor, hemiCfg.groundColor, hemiCfg.intensity);
  scene.add(hemi);

  // Ground plane
  const groundMat = loadPBRMaterial(
    config.ground.textures,
    config.ground.textureRepeat,
    config.ground.fallbackColor
  );
  const groundGeo = new THREE.PlaneGeometry(config.ground.size, config.ground.size);
  groundGeo.setAttribute('uv2', groundGeo.attributes.uv); // for aoMap
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Resize handling
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, renderer, camera, audioListener };
}

/** Simple flickering point light for braziers/torches. Returns an update fn. */
export function createBrazier(scene, position) {
  const light = new THREE.PointLight(0xff9033, 8, 12, 2);
  light.position.copy(position).add(new THREE.Vector3(0, 1.3, 0));
  scene.add(light);

  // small emissive coal so the light source is visible
  const coal = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff5511, emissiveIntensity: 2 })
  );
  coal.position.copy(light.position);
  scene.add(coal);

  const baseIntensity = light.intensity;
  const phase = Math.random() * Math.PI * 2;
  return (t) => {
    light.intensity =
      baseIntensity * (0.85 + 0.15 * Math.sin(t * 9 + phase) * Math.sin(t * 23 + phase * 2));
  };
}
