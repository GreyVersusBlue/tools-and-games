// SkyWings 64 - render pipeline (agent R): renderer, ACES + sRGB, HDR env, sun shadows, post chain, adaptive resolution.
import * as THREE from 'three';
import { createLighting, loadEnvironment, TOD_PRESETS } from './lighting.js';
import { GradeShader } from './grade.js';

const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _f = new THREE.Vector3();

function quality() {
  const q = (typeof window !== 'undefined' && window.SW_QUALITY) || 'high';
  return q === 'low' || q === 'medium' ? q : 'high';
}

/**
 * Create renderer + lighting BEFORE createWorld. Returns the swRender object (also set on scene.userData.swRender
 * and renderer.__sw). main.js then calls sw.attach({camera, world, getVehicle}) after world creation and sw.render(dt) per frame.
 */
export function createRenderSystem({ app, scene, camera }) {
  let Q = quality();
  const renderer = new THREE.WebGLRenderer({ antialias: Q === 'low', powerPreference: 'high-performance', stencil: false });
  const maxPR = Q === 'low' ? 1 : 2;
  const sw = {
    renderer, scene, camera, quality: Q, handlesLighting: true,
    pixelRatio: Math.min(window.devicePixelRatio || 1, maxPR), maxPixelRatio: Math.min(window.devicePixelRatio || 1, maxPR),
    minPixelRatio: 0.5, composer: null, world: null, getVehicle: null, frameMs: 16, passes: {}, failed: false,
  };
  renderer.setPixelRatio(sw.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = Q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  app.appendChild(renderer.domElement);

  const L = createLighting(scene, Q);
  sw.lighting = L; sw.sun = L.sun; sw.hemi = L.hemi; sw.sunDirection = L.sunDirection;
  sw.setSun = (dir) => { if (dir) L.sunDirection.copy(dir).normalize(); };
  sw.presets = Object.keys(TOD_PRESETS);
  sw.setTimeOfDay = (name) => {
    const p = L.setPreset(name);
    if (p && sw.world && sw.world.setTimeOfDay) { try { sw.world.setTimeOfDay(p.t); } catch (e) { /* ignore */ } }
    return !!p;
  };
  scene.userData.swRender = sw;
  renderer.__sw = sw;
  window.__sw = sw;

  // ---- environment lighting (async, non-blocking)
  loadEnvironment(renderer, scene, L, './assets/hdr/kloofendal_48d_partly_cloudy_puresky_1k.hdr').then((t) => { sw.envMap = t; });

  // ---- post chain
  sw.buildComposer = async function buildComposer() {
    if (Q === 'low') return null;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/ShaderPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
      const w = window.innerWidth, h = window.innerHeight;
      const rt = new THREE.WebGLRenderTarget(w * sw.pixelRatio, h * sw.pixelRatio, {
        type: THREE.HalfFloatType, samples: Q === 'high' ? 4 : 2,
      });
      const composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(sw.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(scene, sw.camera));
      if (Q === 'high' && window.SW_AO === true) {
        try {
          const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
          const ao = new GTAOPass(scene, sw.camera, w, h);
          ao.output = GTAOPass.OUTPUT.Default;
          ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1, thickness: 3, scale: 1.2, samples: 12 });
          composer.addPass(ao); sw.passes.ao = ao;
        } catch (e) { console.warn('[render] GTAO unavailable', e); }
      }
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), Q === 'high' ? 0.22 : 0.16, 0.7, 0.92);
      composer.addPass(bloom); sw.passes.bloom = bloom;
      const grade = new ShaderPass(GradeShader);
      composer.addPass(grade); sw.passes.grade = grade;
      composer.addPass(new OutputPass());
      try {
        const { SMAAPass } = await import('three/addons/postprocessing/SMAAPass.js');
        const smaa = new SMAAPass(w * sw.pixelRatio, h * sw.pixelRatio);
        composer.addPass(smaa); sw.passes.smaa = smaa;
      } catch (e) { console.warn('[render] SMAA unavailable', e); }
      sw.composer = composer; renderer.__sw.composer = composer;
      sw.resize();
      return composer;
    } catch (e) {
      console.warn('[render] composer failed, using plain renderer', e);
      sw.composer = null; sw.failed = true;
      return null;
    }
  };

  sw.attach = function attach({ camera: cam, world, getVehicle }) {
    if (cam) sw.camera = cam;
    sw.world = world || null; sw.getVehicle = getVehicle || null;
    // adopt any legacy directional light created by the world so we don't double-light
    scene.traverse((o) => { if (o.isDirectionalLight && o !== L.sun && !L.foreign) L.adoptForeign(o); });
    if (L.foreign) { L.hemi.intensity = 0.25; } else sw.setTimeOfDay(L.preset);
    return sw.buildComposer();
  };

  sw.resize = function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(sw.pixelRatio);
    renderer.setSize(w, h);
    if (sw.camera) { sw.camera.aspect = w / h; sw.camera.updateProjectionMatrix(); }
    if (sw.composer) { try { sw.composer.setPixelRatio(sw.pixelRatio); sw.composer.setSize(w, h); } catch (e) { /* ignore */ } }
    if (sw.passes.grade) sw.passes.grade.uniforms.uAspect.value = w / h;
  };
  window.addEventListener('resize', () => sw.resize());

  // ---- live quality changes (window 'settingsChanged' / SW_QUALITY)
  sw.applyQuality = async function applyQuality() {
    const nq = quality();
    if (nq === Q) return;
    Q = nq; sw.quality = Q;
    try {
      const dpr = window.devicePixelRatio || 1;
      sw.maxPixelRatio = Math.min(dpr, Q === 'low' ? 1 : 2);
      sw.pixelRatio = Math.min(sw.pixelRatio, sw.maxPixelRatio);
      const t = Q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      if (renderer.shadowMap.type !== t) {
        renderer.shadowMap.type = t;
        scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      }
      L.setQuality(Q);
      if (sw.composer) { try { sw.composer.dispose(); } catch (e) { /* ignore */ } }
      sw.composer = null; renderer.__sw.composer = null; sw.passes = {};
      sw.failed = false;
      sw.resize();
      if (sw.world) await sw.buildComposer();
    } catch (e) { console.warn('[render] applyQuality', e); sw.composer = null; }
  };
  window.addEventListener('settingsChanged', (ev) => { if (!ev.detail || ev.detail.key === 'quality') sw.applyQuality(); });

  // ---- shadow/env flags on meshes (cheap periodic scan of newly added objects)
  const seen = new WeakSet();
  let scanT = 0;
  function scan() {
    scene.traverse((o) => {
      if (!o.isMesh || seen.has(o)) return;
      seen.add(o);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.transparent || m.side === THREE.BackSide || m.depthWrite === false || m.isShaderMaterial && !m.lights) {
        if (m && m.isShaderMaterial === undefined) { /* nothing */ }
        return;
      }
      if (o.userData.noShadow) return;
      if (!o.userData.noCast) o.castShadow = true;   // noCast: receives shadows, casts none (vegetation past the near tier)
      if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) o.receiveShadow = true;
      if (m.isMeshStandardMaterial && m.userData.swEnv === undefined) { m.userData.swEnv = 1; m.envMapIntensity = Math.min(m.envMapIntensity, 0.6); }
    });
  }
  sw.rescan = () => { scanT = 0; };

  // ---- adaptive resolution
  let slowT = 0, fastT = 0, last = 0;
  function adapt(dtMs) {
    if (window.SW_ADAPTIVE === false || document.hidden) return;
    if (dtMs > 400) return; // hitch / tab switch
    sw.frameMs += (dtMs - sw.frameMs) * 0.08;
    if (sw.frameMs > 22) { slowT += dtMs; fastT = 0; } else if (sw.frameMs < 13) { fastT += dtMs; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT > 1200 && sw.pixelRatio > sw.minPixelRatio) {
      sw.pixelRatio = Math.max(sw.minPixelRatio, +(sw.pixelRatio - 0.15).toFixed(2)); slowT = 0; sw.resize();
    } else if (fastT > 4000 && sw.pixelRatio < sw.maxPixelRatio) {
      sw.pixelRatio = Math.min(sw.maxPixelRatio, +(sw.pixelRatio + 0.1).toFixed(2)); fastT = 0; sw.resize();
    }
  }

  // ---- sun glare screen position / occlusion
  let sunVis = 0;
  function updateGlare(dt) {
    const g = sw.passes.grade; if (!g) return;
    const cam = sw.camera;
    _s.copy(cam.position).addScaledVector(L.sunDirection, 3000).project(cam);
    cam.getWorldDirection(_f);
    let amt = _f.dot(L.sunDirection) > 0 && L.sunDirection.y > -0.05 ? 1 : 0;
    amt *= 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_s.x), Math.abs(_s.y)), 0.9, 1.6);
    if (amt > 0 && sw.world && sw.world.heightAt) {
      let occ = 0;
      for (let i = 1; i <= 14; i++) {
        const d = 30 * Math.pow(1.45, i);
        _v.copy(cam.position).addScaledVector(L.sunDirection, d);
        if (sw.world.heightAt(_v.x, _v.z) > _v.y) { occ = 1; break; }
      }
      amt *= 1 - occ;
    }
    sunVis += (amt - sunVis) * Math.min(1, dt * 6);
    g.uniforms.uSunUV.value.set(_s.x * 0.5 + 0.5, _s.y * 0.5 + 0.5);
    g.uniforms.uSunAmt.value = sunVis * (window.SW_GLARE === false ? 0 : 1) * Math.min(1, L.sun.intensity / 2);
    g.uniforms.uSunColor.value.copy(L.sun.color);
  }

  let speedS = 0, tPrev = performance.now();
  sw.render = function render(dt) {
    const now = performance.now();
    const dtMs = now - last; last = now;
    dt = dt || Math.min(0.1, (now - tPrev) / 1000); tPrev = now;
    adapt(dtMs);
    const veh = sw.getVehicle ? sw.getVehicle() : null;
    try {
      if ((scanT -= dt) <= 0) { scanT = 1.0; scan(); }
      const focus = _v.copy(veh && veh.position ? veh.position : sw.camera.position);
      if (veh && sw.world && sw.world.heightAt) focus.y = (focus.y + sw.world.heightAt(focus.x, focus.z)) * 0.5;
      L.update(focus);
    } catch (e) { console.warn('[render] lighting', e); }
    const g = sw.passes.grade;
    if (g) {
      try {
        const sp = veh && veh.state === 'flying' ? Math.min(1, Math.max(0, ((veh.speed || 0) - 22) / 45)) : 0;
        speedS += (sp - speedS) * Math.min(1, dt * 2);
        g.uniforms.uSpeed.value = speedS * 0.6;
        updateGlare(dt);
      } catch (e) { /* ignore */ }
    }
    if (sw.composer) {
      try { sw.composer.render(dt); return; } catch (e) {
        console.warn('[render] composer render failed; falling back', e);
        sw.composer = null; sw.failed = true; renderer.setRenderTarget(null);
      }
    }
    renderer.render(scene, sw.camera);
  };
  return sw;
}
