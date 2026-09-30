// Animated river: a strip mesh along x == z with per-vertex depth, flowing normals, bank foam and fresnel.
import * as THREE from 'three';
import { WATER_Y } from './layout.js';
import { injectFow, patchMaterial, worldUniforms } from './shaderUtils.js';
import { loadTexture } from './Textures.js';

export function createRiver(world, noiseTex) {
  const halfW = 12, L = 142, step = 0.8;
  const nx = Math.round((halfW * 2) / step), nl = Math.round((L * 2) / step);
  const pos = [], depth = [], idx = [];
  const d = new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2), p = new THREE.Vector2(Math.SQRT1_2, -Math.SQRT1_2);
  for (let j = 0; j <= nl; j++) {
    const s = -L + j * step;
    for (let i = 0; i <= nx; i++) {
      const t = -halfW + i * step;
      const x = d.x * s + p.x * t, z = d.y * s + p.y * t;
      pos.push(x, WATER_Y, z);
      depth.push(WATER_Y - world.getHeight(x, z));
    }
  }
  for (let j = 0; j < nl; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
    // skip quads entirely under terrain
    if (Math.max(depth[a], depth[b], depth[c], depth[e]) < -0.05) continue;
    idx.push(a, c, b, b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const waterN = loadTexture('tex/waternormals.jpg', { srgb: false });
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, envMapIntensity: 1.2,
  });
  const u = { uWaterN: { value: waterN }, uNoise: { value: noiseTex }, uTime: worldUniforms.uTime };
  patchMaterial(mat, 'river-v1', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float aDepth;\nvarying float vDepth;\nvarying vec3 vRWPos;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvDepth = aDepth;\nvRWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    sh.fragmentShader = `uniform sampler2D uWaterN;\nuniform sampler2D uNoise;\nuniform float uTime;\nvarying float vDepth;\nvarying vec3 vRWPos;\n` + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`
        vec2 wp = vRWPos.xz;
        vec2 flowDir = vec2(0.7071, 0.7071);
        float tt = uTime;
        vec2 uvA = wp * 0.055 + flowDir * tt * 0.035;
        vec2 uvB = wp * 0.09 + vec2(-0.6, 0.8) * tt * 0.018 + flowDir * tt * 0.05;
        vec3 wnA = texture2D(uWaterN, uvA).rgb * 2.0 - 1.0;
        vec3 wnB = texture2D(uWaterN, uvB).rgb * 2.0 - 1.0;
        vec3 wn = normalize(vec3(wnA.x + wnB.x, 4.0, wnA.y + wnB.y));
        float dep = vDepth;
        float deepT = smoothstep(0.02, 0.75, dep);
        vec3 shallowC = vec3(0.2, 0.46, 0.42);
        vec3 deepC = vec3(0.015, 0.09, 0.115);
        vec3 wc = mix(shallowC, deepC, deepT);
        float fn = texture2D(uNoise, wp * 0.12 + flowDir * tt * 0.06).r;
        float fn2 = texture2D(uNoise, wp * 0.05 - flowDir * tt * 0.02).g;
        float foam = 1.0 - smoothstep(0.0, 0.1 + fn * 0.22, dep);
        foam += smoothstep(0.72, 0.86, fn2 + fn * 0.25) * 0.16 * (1.0 - deepT * 0.6);
        foam = clamp(foam, 0.0, 1.0);
        diffuseColor.rgb = mix(wc, vec3(0.9, 0.95, 0.95), foam * 0.85);
        diffuseColor.a = clamp(mix(0.5, 0.88, deepT) + foam * 0.4, 0.0, 1.0) * smoothstep(-0.02, 0.05, dep);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.05, 0.5, foam);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(normalize(mix(wn, vec3(0.0,1.0,0.0), foam * 0.7)), 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += wc * 0.15 * (1.0 - deepT);`);
    injectFow(sh);
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}
