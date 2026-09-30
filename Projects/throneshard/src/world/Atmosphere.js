// Sun (shadow camera follows view), hemisphere fill, HDRI environment, sky dome, distance fog, day/night.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { assetUrl } from './Textures.js';
import { worldUniforms } from './shaderUtils.js';

const DAY = {
  sun: new THREE.Color(0xfff0d8), sunI: 2.6, hemiSky: new THREE.Color(0xc4dcff), hemiGround: new THREE.Color(0x5a5030), hemiI: 0.75,
  fog: new THREE.Color(0xa9c0cf), skyTop: new THREE.Color(0x4f86c6), skyHor: new THREE.Color(0xcfe0ea), env: 0.45, exposure: 1.0,
};
const NIGHT = {
  sun: new THREE.Color(0xa8bcff), sunI: 1.5, hemiSky: new THREE.Color(0x5a6c9c), hemiGround: new THREE.Color(0x24222c), hemiI: 0.85,
  fog: new THREE.Color(0x1d2438), skyTop: new THREE.Color(0x0a1022), skyHor: new THREE.Color(0x26304a), env: 0.22, exposure: 0.95,
};

export class Atmosphere {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'atmosphere';
    this.shadowExtent = 38; // covers the default camera view (~40 x 45 units) with margin
    this.cur = { ...DAY, sun: DAY.sun.clone(), hemiSky: DAY.hemiSky.clone(), hemiGround: DAY.hemiGround.clone(), fog: DAY.fog.clone(), skyTop: DAY.skyTop.clone(), skyHor: DAY.skyHor.clone() };
    this.sunDir = new THREE.Vector3(-0.55, 1.0, 0.42).normalize();
    this.moonDir = new THREE.Vector3(0.5, 1.0, 0.35).normalize();
  }

  async init(scene, renderer, hq) {
    const sun = (this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI));
    sun.castShadow = true;
    sun.shadow.mapSize.set(hq ? 2048 : 1024, hq ? 2048 : 1024);
    const e = this.shadowExtent;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 260 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    sun.shadow.camera.updateProjectionMatrix();
    this.group.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
    this.group.add(this.hemi);

    // gradient sky dome (visible at map edges / low camera angles)
    const skyGeo = new THREE.SphereGeometry(450, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: this.cur.skyTop }, uHor: { value: this.cur.skyHor }, uGround: { value: new THREE.Color(0x2a3020) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGround; varying vec3 vD;
        void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(uHor, uTop, pow(h, 0.6)) : mix(uHor, uGround, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    scene.fog = new THREE.Fog(DAY.fog, 140, 360);
    scene.add(this.group);

    // HDRI environment for PBR reflections (water, metals)
    try {
      const hdr = await new HDRLoader().loadAsync(assetUrl('sky.hdr'));
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      this.envMap = pm.fromEquirectangular(hdr).texture;
      hdr.dispose(); pm.dispose();
      scene.environment = this.envMap;
      scene.environmentIntensity = DAY.env;
    } catch (err) {
      console.warn('[world] HDRI load failed, continuing without env map', err);
    }
  }

  setQuality(hq) {
    const s = hq ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== s) {
      this.sun.shadow.mapSize.set(s, s);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  // Keep the shadow frustum centred on what the camera looks at; snap to texels to avoid shimmering.
  follow(target, camera) {
    const sun = this.sun;
    const dir = this.sunDir.clone().lerp(this.moonDir, this.night || 0).normalize();
    const texel = (this.shadowExtent * 2) / sun.shadow.mapSize.x;
    // snap in light space
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = m.clone().invert();
    const ls = target.clone().applyMatrix4(inv);
    ls.x = Math.round(ls.x / texel) * texel;
    ls.y = Math.round(ls.y / texel) * texel;
    const t = ls.applyMatrix4(m);
    sun.target.position.copy(t);
    sun.position.copy(t).addScaledVector(dir, 120);
    sun.target.updateMatrixWorld();
    this.sky.position.copy(camera.position);
  }

  // night: 0..1
  applyTime(night, scene, renderer) {
    this.night = night;
    const c = this.cur, L = (a, b) => a + (b - a) * night;
    c.sun.copy(DAY.sun).lerp(NIGHT.sun, night);
    this.sun.color.copy(c.sun);
    this.sun.intensity = L(DAY.sunI, NIGHT.sunI);
    this.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, night);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, night);
    this.hemi.intensity = L(DAY.hemiI, NIGHT.hemiI);
    c.skyTop.copy(DAY.skyTop).lerp(NIGHT.skyTop, night);
    c.skyHor.copy(DAY.skyHor).lerp(NIGHT.skyHor, night);
    if (scene.fog) scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, night);
    scene.environmentIntensity = L(DAY.env, NIGHT.env);
    worldUniforms.uNight.value = night;
  }
}
