// SkyWings 64 - bootstrap: wires renderer/scene/world/vehicles/input/camera/HUD/audio/fx/game.
import * as THREE from 'three';

const showError = (e, where) => {
  try { console.error(where || '', e); if (window.__swShowError) window.__swShowError(e, where); } catch (x) { /* ignore */ }
};
// Import a module without letting failure kill the whole game (error is displayed instead).
const imp = (p) => import(p).catch((e) => { showError(e, 'import ' + p); return null; });
const noop = () => {};
const progress = (f, label, done) => { try { window.__swLoad && window.__swLoad(f, label, done); } catch (e) { /* ignore */ } };
const stub = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : noop)), set: (t, k, v) => { t[k] = v; return true; } });

async function boot() {
  const [worldM, vehM, inputM, camM, hudM, loopM, audioM, partM, fxM, gameM, missM] = await Promise.all([
    imp('./world/index.js'), imp('./vehicles/index.js'), imp('./core/input.js'), imp('./core/camera.js'),
    imp('./core/hud.js'), imp('./core/loop.js'), imp('./fx/audio.js'), imp('./fx/particles.js'),
    imp('./fx/effects.js'), imp('./game/game.js'), imp('./game/missions.js'),
  ]);
  if (!worldM || !vehM || !gameM || !missM) throw new Error('Essential modules failed to load (world/vehicles/game). See errors.');
  progress(0.35, 'BUILDING RENDERER...');
  const modelsM = await imp('./core/models.js');

  // ---- renderer / scene / camera
  const app = document.getElementById('app');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 12000);
  scene.add(camera);
  // Render pipeline (agent R): renderer, tone mapping, lighting, shadows, post. Must exist BEFORE createWorld.
  const rm = await imp('./render/index.js');
  let sw = null;
  let renderer;
  try { sw = rm && rm.createRenderSystem({ app, scene, camera }); } catch (e) { showError(e, 'render'); }
  if (sw) renderer = sw.renderer;
  else {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(renderer.domElement);
    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });
  }

  // ---- world
  progress(0.45, 'SCULPTING THE ISLAND...');
  await new Promise((r) => setTimeout(r, 0)); // let the bar paint before the heavy synchronous build
  const world = worldM.createWorld(scene);
  progress(0.7, 'PREPARING AIRCRAFT...');
  let hasLight = false;
  scene.traverse((o) => { if (o.isLight) hasLight = true; });
  if (!hasLight) {
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x6a7a4a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
    sun.position.set(300, 500, 200);
    scene.add(sun);
  }
  if (!scene.background) scene.background = new THREE.Color(0x87ceeb);
  if (sw && !scene.fog) scene.fog = new THREE.Fog(0xb4defc, 500, 7200);

  // ---- core systems (each falls back to a harmless stub)
  const input = inputM && inputM.createInput ? inputM.createInput(renderer.domElement)
    : { pitch: 0, roll: 0, yaw: 0, throttle: 0, update: noop, reset: noop, consumeEdges: noop };
  const chase = camM && camM.ChaseCamera ? new camM.ChaseCamera(camera)
    : { setRig: noop, snap: noop, toggleMode: noop, update(dt, v) { if (v && v.position) { camera.position.copy(v.position).add(new THREE.Vector3(0, 6, 16)); camera.lookAt(v.position); } } };
  const hudRoot = document.createElement('div');
  hudRoot.id = 'hud-root';
  document.body.appendChild(hudRoot);
  const hud = hudM && hudM.HUD ? new hudM.HUD(hudRoot) : stub();
  let audio, particles, effects;
  try { audio = audioM && audioM.AudioManager ? new audioM.AudioManager() : stub(); } catch (e) { showError(e, 'audio'); audio = stub(); }
  try { particles = partM && partM.ParticleSystem ? new partM.ParticleSystem(scene) : stub(); } catch (e) { showError(e, 'particles'); particles = stub(); }
  try { effects = fxM && fxM.Effects ? new fxM.Effects(scene, particles) : stub(); } catch (e) { showError(e, 'effects'); effects = stub(); }
  missM.setFactories({
    createRing: fxM && fxM.createRing,
    createLandingPadMesh: fxM && fxM.createLandingPadMesh,
    createTargetMarker: fxM && fxM.createTargetMarker,
  });

  // ---- UI root for menus
  const uiRoot = document.createElement('div');
  uiRoot.id = 'ui';
  document.body.appendChild(uiRoot);

  const game = new gameM.Game({
    renderer, scene, camera, world, input, chase, hud, audio, particles, effects,
    VEHICLES: vehM.VEHICLES, uiRoot,
  });
  if (sw) sw.attach({ camera, world, getVehicle: () => game.vehicle }).catch((e) => showError(e, 'render attach'));
  window.__game = game; window.__scene = scene; window.__world = world;
  if (/[?&]perf=1/.test(location.search)) imp('./render/perf.js').then((m) => m && m.installPerf(renderer, scene));

  const update = (dt, elapsed) => {
    try { game.update(dt, elapsed); } catch (e) { showError(e, 'update'); }
    try { camera.updateMatrixWorld(); audio.setListenerFromCamera && audio.setListenerFromCamera(camera); } catch (e) { /* ignore */ }
  };
  const render = () => { if (sw) sw.render(); else renderer.render(scene, camera); };
  if (loopM && loopM.GameLoop) {
    new loopM.GameLoop(update, render).start();
  } else {
    let last = performance.now(), el = 0;
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; el += dt;
      update(dt, el); render();
    };
    requestAnimationFrame(tick);
  }
  // Final stretch of the bar tracks the hero GLBs (vehicles are preloaded so the first flight doesn't pop).
  // Never block the game on them: fallbacks are procedural, and we give up waiting after 12 s.
  if (modelsM) {
    modelsM.preloadModels(['hang_glider', 'gyrocopter', 'rocket_pilot']);
    const off = modelsM.onModelProgress((st) => {
      if (st.requested) progress(0.75 + 0.25 * (st.done / st.requested), 'LOADING MODELS ' + st.done + '/' + st.requested);
    });
    await Promise.race([modelsM.allModelsSettled(), new Promise((r) => setTimeout(r, 12000))]);
    off();
  }
  progress(1, 'READY', true);
}

boot().catch((e) => showError(e, 'boot'));
