// Helpers to inject fog-of-war, wind sway & world-position varyings into built-in three.js materials.
import * as THREE from 'three';

// Shared uniforms referenced by every world material (same objects -> one update affects all).
export const worldUniforms = {
  uFowTex: { value: null },
  uFowOn: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.4) },
  uMapHalf: { value: 100 },
  uNight: { value: 0 },
};

const FOW_VERT_HEAD = 'varying vec3 vFowPos;\n';
const FOW_VERT_BODY = `
  {
    vec4 fowWP = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      fowWP = instanceMatrix * fowWP;
    #endif
    vFowPos = (modelMatrix * fowWP).xyz;
  }
`;
const FOW_FRAG_HEAD = `
varying vec3 vFowPos;
uniform sampler2D uFowTex;
uniform float uFowOn;
uniform float uMapHalf;
`;
export const FOW_FRAG_BODY = `
  {
    vec2 fowUV = (vFowPos.xz + uMapHalf) / (2.0 * uMapHalf);
    float fowV = texture2D(uFowTex, fowUV).r;
    fowV = mix(1.0, fowV, uFowOn);
    vec3 fc = gl_FragColor.rgb;
    float fl = dot(fc, vec3(0.299, 0.587, 0.114));
    vec3 fogged = mix(vec3(fl), fc, 0.35) * vec3(0.36, 0.38, 0.46);
    gl_FragColor.rgb = mix(fogged, fc, fowV);
  }
`;

export function injectFow(shader) {
  shader.uniforms.uFowTex = worldUniforms.uFowTex;
  shader.uniforms.uFowOn = worldUniforms.uFowOn;
  shader.uniforms.uMapHalf = worldUniforms.uMapHalf;
  shader.vertexShader = FOW_VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + FOW_VERT_BODY);
  shader.fragmentShader = FOW_FRAG_HEAD + shader.fragmentShader.replace('#include <fog_fragment>', FOW_FRAG_BODY + '\n#include <fog_fragment>');
}

// Wind sway for instanced vegetation. Displacement grows with height above `base` (object space).
export function injectWind(shader, { base = 1.0, amount = 0.035, freq = 1.3 } = {}) {
  shader.uniforms.uTime = worldUniforms.uTime;
  shader.uniforms.uWind = worldUniforms.uWind;
  shader.vertexShader = 'uniform float uTime;\nuniform vec2 uWind;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      vec3 ip = vec3(0.0);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
      #endif
      float hh = max(transformed.y - ${base.toFixed(3)}, 0.0);
      float ph = ip.x * 0.21 + ip.z * 0.17;
      float breeze = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.02 + ip.z * 0.015);
      float sw = sin(uTime * ${freq.toFixed(3)} + ph) * 0.7 + sin(uTime * ${(freq * 2.7).toFixed(3)} + ph * 1.7) * 0.3;
      vec2 d = uWind * (sw * breeze) * ${amount.toFixed(4)} * hh * hh;
      transformed.x += d.x;
      transformed.z += d.y;
    }`,
  );
}

// Apply one or more patches to a material, preserving a stable program cache key.
export function patchMaterial(mat, key, fn) {
  mat.onBeforeCompile = (shader, renderer) => { fn(shader, renderer); };
  mat.customProgramCacheKey = () => key;
  return mat;
}
