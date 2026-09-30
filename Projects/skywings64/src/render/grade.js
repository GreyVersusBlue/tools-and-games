// SkyWings 64 - final grade pass: radial speed blur, chromatic aberration, warm/teal grade, sun glare + ghosts, vignette.
// Runs in linear HDR space BEFORE OutputPass (tone mapping + sRGB).
import * as THREE from 'three';

export const GradeShader = {
  name: 'SWGrade',
  uniforms: {
    tDiffuse: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSunAmt: { value: 0 },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uSpeed: { value: 0 },
    uAspect: { value: 1.7 },
    uVignette: { value: 0.35 },
    uCA: { value: 0.0012 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUV; uniform float uSunAmt; uniform vec3 uSunColor;
    uniform float uSpeed, uAspect, uVignette, uCA, uSat, uContrast;
    varying vec2 vUv;
    float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      float blur = uSpeed * 0.035 * smoothstep(0.02, 0.25, r2);
      float ca = uCA * (0.4 + r2 * 5.0) + uSpeed * 0.003 * r2 * 4.0;
      vec3 col = vec3(0.0);
      const int N = 5;
      for (int i = 0; i < N; i++) {
        float k = float(i) / float(N - 1);
        vec2 o = d * (blur * k);
        col.r += texture2D(tDiffuse, uv - o - d * ca).r;
        col.g += texture2D(tDiffuse, uv - o).g;
        col.b += texture2D(tDiffuse, uv - o + d * ca).b;
      }
      col /= float(N);
      // grade: teal shadows, warm highlights, gentle saturation/contrast
      float l = lum(col);
      col *= mix(vec3(0.93, 1.0, 1.07), vec3(1.07, 1.02, 0.93), smoothstep(0.03, 1.1, l));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);
      // sun glare + ghosts
      if (uSunAmt > 0.001) {
        vec2 sd = uv - uSunUV; sd.x *= uAspect;
        float sdist = length(sd);
        float g = exp(-sdist * 5.0) * 0.30 + exp(-sdist * 22.0) * 0.55 + exp(-sdist * 90.0) * 0.8;
        g += smoothstep(0.02, 0.0, abs(sdist - 0.32)) * 0.05;
        vec2 axis = vec2(0.5) - uSunUV;
        vec3 gh = vec3(0.0);
        for (int i = 1; i <= 3; i++) {
          vec2 p = uSunUV + axis * (float(i) * 0.55);
          vec2 q = uv - p; q.x *= uAspect;
          float rr = 0.05 + 0.03 * float(i);
          gh += vec3(0.6 + 0.2 * float(i), 0.8, 1.0 - 0.1 * float(i)) * smoothstep(rr, rr * 0.2, length(q)) * 0.05;
        }
        // streak
        g += exp(-abs(sd.y) * 60.0) * exp(-abs(sd.x) * 3.0) * 0.12;
        col += (uSunColor * g + gh) * uSunAmt;
      }
      // vignette
      vec2 v = d * vec2(uAspect * 0.55 + 0.45, 1.0);
      col *= 1.0 - uVignette * smoothstep(0.30, 0.95, length(v) * 1.35);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
