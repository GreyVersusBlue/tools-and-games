// EffectComposer chain: render -> bloom (not on low) -> output (colour grade + vignette + tonemap/sRGB) -> SMAA/FXAA
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.12 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    uVignette: { value: 0.32 },
    uNight: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; uniform vec3 uTint; uniform float uVignette; uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * mix(uTint, vec3(0.86, 0.94, 1.12), uNight);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, mix(uSat, uSat * 0.8, uNight));
      // contrast around mid grey in (linear HDR) log-ish space
      col = pow(max(col, 0.0), vec3(uContrast)) * pow(0.18, 1.0 - uContrast);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      col *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(col, c.a);
    }`,
};

// The colour grade is folded into the OutputPass shader (grade -> tonemap -> sRGB in one full-screen pass instead of
// two half-float passes). `post.grade` keeps the old {enabled, uniforms} shape for tools that toggle it.
function foldGradeIntoOutput(output) {
  const m = output.material;
  const u = THREE.UniformsUtils.clone(GradeShader.uniforms);
  delete u.tDiffuse;
  u.uGradeOn = { value: 1 };
  Object.assign(m.uniforms, u);
  const body = GradeShader.fragmentShader.split('void main() {')[1].replace(/}\s*$/, '');
  m.fragmentShader = m.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform float uSat; uniform float uContrast; uniform vec3 uTint; uniform float uVignette; uniform float uNight; uniform float uGradeOn;')
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `{
      vec4 gOrig = texture2D( tDiffuse, vUv );
      ${body.replace('texture2D(tDiffuse, vUv)', 'gOrig')}
      gl_FragColor = mix(gOrig, gl_FragColor, uGradeOn);
    }`);
  m.needsUpdate = true;
  return {
    uniforms: m.uniforms,
    get enabled() { return m.uniforms.uGradeOn.value > 0.5; },
    set enabled(v) { m.uniforms.uGradeOn.value = v ? 1 : 0; },
  };
}

export class PostFX {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * r.getPixelRatio(), size.y * r.getPixelRatio(), { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(game.scene, game.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
    this.output = new OutputPass();
    this.grade = foldGradeIntoOutput(this.output);
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);
    this.setQuality(true);
    this.composer.setSize(size.x, size.y);
    this.halfRateBloom(game);
  }

  // The bloom chain is 13 full-screen draws. Except on ultra it is recomputed every 2nd frame, on the frames that do
  // not re-render the shadow map (World.scheduleShadows), and the frame in between re-blends the previous result
  // (1 draw): a one-frame-old glow is not visible at 60 fps. Any gap (resize, bloom toggled, first frame) forces a
  // full pass, so a stale result is never shown.
  halfRateBloom(game) {
    const bloom = this.bloom, full = bloom.render.bind(bloom);
    let last = -10;
    const setSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => { last = -10; setSize(w, h); };
    bloom.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
      const w = game.world, f = game.frame;
      const reuse = w && w.quality !== 'ultra' && w.shadowThisFrame && last === f - 1 && !bloom.renderToScreen && !maskActive;
      if (!reuse) { last = f; full(renderer, writeBuffer, readBuffer, deltaTime, maskActive); return; }
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      bloom._fsQuad.material = bloom.blendMaterial;
      bloom.copyUniforms.tDiffuse.value = bloom.renderTargetsHorizontal[0].texture;
      renderer.setRenderTarget(readBuffer);
      bloom._fsQuad.render(renderer);
      renderer.autoClear = oldAutoClear;
    };
  }
  // level: 'low' | 'medium' | 'high' | 'ultra' (booleans accepted: true = high)
  setQuality(level) {
    const q = level === true ? 'high' : level === false ? 'low' : level;
    this.bloom.enabled = q !== 'low';
    this.bloom.strength = q === 'low' ? 0.25 : 0.32;
    this.smaa.enabled = q === 'high' || q === 'ultra';
    this.fxaa.enabled = !this.smaa.enabled;
  }
  setNight(n) { this.grade.uniforms.uNight.value = n; }
}
