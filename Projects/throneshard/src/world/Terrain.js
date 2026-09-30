import * as THREE from 'three';
import {
  EXT, laneDist, riverDist, reservedDist, pathDist, plateauFactor, computeHeight, corruption,
  distToDuskwardBase, reserved,
} from './layout.js';
import { fbm, noise2, smoothstep, clamp } from './noise.js';
import { injectFow, worldUniforms, patchMaterial } from './shaderUtils.js';

export const RES = 0.5; // world units per height sample
export const N = Math.round((EXT * 2) / RES) + 1; // samples per side

// Heightfield + material masks sampled on a regular grid covering [-EXT, EXT]^2.
export class TerrainData {
  constructor() {
    const n = N * N;
    this.h = new Float32Array(n);
    this.lane = new Float32Array(n);
    this.res = new Float32Array(n);
    this.path = new Float32Array(n);
    this.plat = new Float32Array(n);
    this.corr = new Float32Array(n);
    this.slope = new Float32Array(n);
  }

  async build(onProgress = () => {}) {
    for (let j = 0; j < N; j++) {
      const z = -EXT + j * RES;
      for (let i = 0; i < N; i++) {
        const x = -EXT + i * RES;
        const k = j * N + i;
        const inMap = Math.abs(x) < 112 && Math.abs(z) < 112;
        const lane = inMap ? laneDist(x, z) : 50;
        const resD = inMap ? reservedDist(x, z) : 50;
        const pathD = inMap ? pathDist(x, z) : 50;
        const pf = plateauFactor(x, z);
        this.lane[k] = lane; this.res[k] = resD; this.path[k] = pathD; this.plat[k] = pf.t;
        this.h[k] = computeHeight(x, z, lane, resD, pathD, pf.t);
        this.corr[k] = corruption(x, z);
      }
      if (j % 40 === 0) { onProgress(j / N); await new Promise((r) => setTimeout(r, 0)); }
    }
    // slope magnitude
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
      const dx = (this.h[j * N + i1] - this.h[j * N + i0]) / ((i1 - i0) * RES);
      const dz = (this.h[j1 * N + i] - this.h[j0 * N + i]) / ((j1 - j0) * RES);
      this.slope[j * N + i] = Math.hypot(dx, dz);
    }
  }

  // bilinear sample of a field array
  sample(arr, x, z) {
    let fx = (x + EXT) / RES, fz = (z + EXT) / RES;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * N + i;
    const a = arr[k], b = arr[k + 1], c = arr[k + N], d = arr[k + N + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  height(x, z) { return this.sample(this.h, x, z); }
}

// Build the two RGBA splat textures (same grid as the heightfield).
// A: grass, dirt, stone, rock   B: duskward, gravel, lava, dark(ao/wet)
export function buildSplat(td) {
  const n = N * N;
  const A = new Uint8Array(n * 4), B = new Uint8Array(n * 4);
  const towerPts = reserved.filter((r) => r.kind === 'tower');
  const plazaPts = reserved.filter((r) => ['throneshard', 'fountain', 'rax', 'shop'].includes(r.kind));
  const camps = reserved.filter((r) => r.kind === 'camp' || r.kind === 'secret');
  const grim = reserved.find((r) => r.kind === 'grimmaw');
  for (let j = 0; j < N; j++) {
    const z = -EXT + j * RES;
    for (let i = 0; i < N; i++) {
      const x = -EXT + i * RES;
      const k = j * N + i;
      const n1 = noise2(x * 0.3, z * 0.3, 71);
      const n2 = fbm(x * 0.08, z * 0.08, 3, 72);
      const corr = td.corr[k];
      const t = td.plat[k];
      const lane = td.lane[k];
      let w = [1 - corr, 0, 0, 0, corr, 0]; // grass, dirt, stone, rock, duskward, gravel
      const over = (li, a) => {
        if (a <= 0) return;
        a = Math.min(1, a);
        for (let q = 0; q < 6; q++) w[q] *= 1 - a;
        w[li] += a;
      };
      // dirt: lanes, jungle trails, camp clearings, random patches
      const laneM = 1 - smoothstep(2.2, 4.6, lane + n1 * 1.4 + n2 * 1.5);
      const trail = (1 - smoothstep(0.6, 2.4, td.path[k] + n1 * 0.9)) * 0.8 * (1 - t);
      let campM = 0;
      for (const c of camps) { const d = Math.hypot(x - c.x, z - c.z); if (d < 9) campM = Math.max(campM, 1 - smoothstep(3, 7.5, d + n1 * 1.5)); }
      const patch = smoothstep(0.32, 0.5, fbm(x * 0.045, z * 0.045, 4, 73)) * 0.7;
      over(1, Math.max(laneM, trail, campM * 0.85, patch));
      // river bed gravel
      const rd = Math.abs(x - z) / Math.SQRT2;
      const grimD = Math.hypot(x - grim.x, z - grim.z);
      const grav = (1 - smoothstep(5, 8.5, rd + n1 * 1.2 + n2)) * smoothstep(8, 11, grimD);
      over(5, grav);
      // stone base floors, tower foundations, Grimmaw's lair floor
      let stone = 0;
      const platM = smoothstep(0.55, 0.95, t);
      if (platM > 0) {
        let plaza = 1 - smoothstep(2.4, 4.4, lane + n1 * 1.2);
        for (const p of plazaPts) {
          const d = Math.hypot(x - p.x, z - p.z);
          plaza = Math.max(plaza, 1 - smoothstep(p.r * 0.38, p.r * 0.72, d + n1 * 1.5));
        }
        stone = platM * plaza;
      }
      for (const p of towerPts) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < 6) stone = Math.max(stone, 1 - smoothstep(3.4, 4.6, d + n1 * 0.6));
      }
      if (grimD < 11) stone = Math.max(stone, (1 - smoothstep(6, 9.5, grimD + n1 * 1.5)) * 0.9);
      over(2, stone);
      // rock on steep slopes & mountain rim
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const rock = Math.max(smoothstep(0.55, 1.1, td.slope[k] + n1 * 0.15), smoothstep(101, 106, edge + n2 * 4) * 0.9);
      over(3, rock);
      const s = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
      for (let q = 0; q < 6; q++) w[q] /= s;
      A[k * 4] = w[0] * 255; A[k * 4 + 1] = w[1] * 255; A[k * 4 + 2] = w[2] * 255; A[k * 4 + 3] = w[3] * 255;
      B[k * 4] = w[4] * 255; B[k * 4 + 1] = w[5] * 255;
      // lava cracks around the Duskward base and in scattered Duskward jungle patches
      const dd = distToDuskwardBase(x, z);
      let lava = corr * (1 - smoothstep(18, 46, dd + n2 * 8)) * (1 - w[2]) * (1 - w[1] * 0.9) * (1 - w[5]) * (1 - w[3]);
      lava = Math.max(lava, corr * smoothstep(0.3, 0.5, fbm(x * 0.05, z * 0.05, 3, 74)) * 0.6 * smoothstep(8, 14, lane) * (1 - t));
      lava *= smoothstep(0.0, 0.25, fbm(x * 0.09, z * 0.09, 2, 75) + 0.02);
      B[k * 4 + 2] = clamp(lava, 0, 1) * 255;
      // wetness near the river
      const wet = (1 - smoothstep(5.5, 9, rd + n1)) * 0.6;
      B[k * 4 + 3] = clamp(wet, 0, 1) * 255;
    }
  }
  const mk = (d) => {
    const tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };
  return { A, B, texA: mk(A), texB: mk(B) };
}

// Terrain geometry directly from the height grid.
export function buildTerrainGeometry(td) {
  const geo = new THREE.PlaneGeometry(EXT * 2, EXT * 2, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    const i = Math.round((x + EXT) / RES), j = Math.round((z + EXT) / RES);
    pos.setY(v, td.h[j * N + i]);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const TERRAIN_FRAG_HEAD = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAlb;
uniform sampler2DArray uNrm;
uniform sampler2D uSplatA;
uniform sampler2D uSplatB;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uExt;
uniform float uNrmStrength;
uniform float uHQ;
varying vec3 vWPos;
varying vec3 vWNrm;

vec2 th22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float voronoiEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr; float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = th22(n + g);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)); vec2 o = th22(n + g);
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}
void terrLayer(float w, float idx, float scale, float rough, vec2 uv, vec2 dx, vec2 dy, float at,
               inout vec3 alb, inout vec3 nrm, inout float r) {
  if (w < 0.003) return;
  vec2 u = uv / scale; vec2 ddx = dx / scale, ddy = dy / scale;
  vec3 c = textureGrad(uAlb, vec3(u, idx), ddx, ddy).rgb;
  vec3 n = textureGrad(uNrm, vec3(u, idx), ddx, ddy).rgb * 2.0 - 1.0;
  if (at > 0.0) {
    // anti-tiling: blend a rotated, rescaled second sample
    mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
    vec2 u2 = R * u * 0.37 + 0.31; vec2 dx2 = R * ddx * 0.37, dy2 = R * ddy * 0.37;
    vec3 c2 = textureGrad(uAlb, vec3(u2, idx), dx2, dy2).rgb;
    vec3 n2 = textureGrad(uNrm, vec3(u2, idx), dx2, dy2).rgb * 2.0 - 1.0;
    c = mix(c, c2, at); n = mix(n, n2, at);
  }
  alb += c * w; nrm += n * w; r += rough * w;
}
`;

const TERRAIN_MAP = /* glsl */`
  vec2 sUV = (vWPos.xz + uExt) / (2.0 * uExt);
  vec4 sA = texture2D(uSplatA, sUV);
  vec4 sB = texture2D(uSplatB, sUV);
  vec3 geoN = normalize(vWNrm);
  vec2 bUV = vec2(vWPos.x, -vWPos.z);
  vec2 gdx = dFdx(bUV), gdy = dFdy(bUV);
  vec4 mac = texture2D(uNoise, vWPos.xz * 0.0105);
  vec4 mac2 = texture2D(uNoise, vWPos.xz * 0.043 + 0.37);
  float atb = smoothstep(0.3, 0.7, mac2.g) * uHQ;
  vec3 tAlb = vec3(0.0), tNrm = vec3(0.0); float tRough = 0.0;
  float wRock = sA.a;
  float wDuskward = sB.r;
  terrLayer(sA.r, 0.0, 4.5, 0.92, bUV, gdx, gdy, atb, tAlb, tNrm, tRough);
  terrLayer(sA.g, 1.0, 6.0, 0.95, bUV, gdx, gdy, atb * 0.6, tAlb, tNrm, tRough);
  vec3 preStone = tAlb;
  terrLayer(sA.b, 2.0, 4.0, 0.72, bUV, gdx, gdy, 0.0, tAlb, tNrm, tRough);
  tAlb = preStone + (tAlb - preStone) * vec3(0.66, 0.63, 0.58);
  terrLayer(sB.g, 5.0, 3.5, 0.8, bUV, gdx, gdy, 0.0, tAlb, tNrm, tRough);
  if (wDuskward > 0.003) {
    // Duskward ground: dark soil mixed with dead, ash-tinted grass
    vec3 da = vec3(0.0), dn = vec3(0.0); float dr = 0.0;
    terrLayer(1.0, 4.0, 5.0, 0.95, bUV, gdx, gdy, atb, da, dn, dr);
    vec3 ga = vec3(0.0), gn = vec3(0.0); float gr = 0.0;
    terrLayer(1.0, 0.0, 4.5, 0.95, bUV, gdx, gdy, 0.0, ga, gn, gr);
    float glum = dot(ga, vec3(0.3, 0.55, 0.15));
    vec3 dead = vec3(glum) * vec3(1.05, 0.78, 0.5) * 0.95;
    float m = smoothstep(0.35, 0.65, mac.b);
    da = mix(da * vec3(1.15, 0.82, 0.78), dead, m * 0.75);
    dn = mix(dn, gn, m * 0.75);
    tAlb += da * wDuskward; tNrm += dn * wDuskward; tRough += dr * wDuskward;
  }
  vec3 rockWN = geoN;
  if (wRock > 0.003) {
    // triplanar rock for cliffs
    vec3 bw = pow(abs(geoN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    float sc = 1.0 / 7.0;
    vec2 ux = vWPos.zy * sc, uy = vWPos.xz * sc, uz = vWPos.xy * sc;
    vec3 cx = texture(uAlb, vec3(ux, 3.0)).rgb, cy = texture(uAlb, vec3(uy, 3.0)).rgb, cz = texture(uAlb, vec3(uz, 3.0)).rgb;
    vec3 nx = texture(uNrm, vec3(ux, 3.0)).rgb * 2.0 - 1.0;
    vec3 ny = texture(uNrm, vec3(uy, 3.0)).rgb * 2.0 - 1.0;
    vec3 nz = texture(uNrm, vec3(uz, 3.0)).rgb * 2.0 - 1.0;
    vec3 wx = vec3(nx.xy + geoN.zy, abs(geoN.x)).zyx;
    vec3 wy = vec3(ny.xy + geoN.xz, abs(geoN.y)).xzy;
    vec3 wz = vec3(nz.xy + geoN.xy, abs(geoN.z));
    rockWN = normalize(wx * bw.x + wy * bw.y + wz * bw.z);
    tAlb += (cx * bw.x + cy * bw.y + cz * bw.z) * wRock * vec3(0.95, 0.92, 0.88);
    tRough += 0.85 * wRock;
  }
  // macro variation & grass hue shifts
  float corrA = smoothstep(-8.0, 12.0, (vWPos.x - vWPos.z) * 0.7071 + (mac.a - 0.5) * 16.0);
  tAlb *= 0.8 + 0.4 * mac.r;
  tAlb = mix(tAlb, tAlb * vec3(1.18, 1.08, 0.72), smoothstep(0.55, 0.8, mac2.r) * sA.r * 0.8);
  tAlb *= mix(vec3(1.0), vec3(0.78, 0.62, 0.62), corrA * (1.0 - wDuskward) * 0.75);
  tAlb *= mix(1.0, 0.55, corrA * sA.b);
  float wet = sB.a;
  tAlb *= 1.0 - wet * 0.35;
  tRough = mix(tRough, 0.45, wet * 0.8);
  diffuseColor.rgb *= tAlb;
  // world-space normal from blended tangent-space normals (planar mapping u=+X, v=-Z)
  vec3 pT = normalize(vec3(1.0, 0.0, 0.0) - geoN * geoN.x);
  vec3 pB = cross(geoN, pT);
  vec3 tn = tNrm; tn.xy *= uNrmStrength;
  vec3 planarWN = normalize(pT * tn.x + pB * tn.y + geoN * max(tn.z, 0.15));
  vec3 terrNW = normalize(mix(planarWN, rockWN, wRock));
`;

const TERRAIN_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  {
    float lava = sB.b;
    if (lava > 0.02) {
      vec2 lp = vWPos.xz * 0.32 + (mac.xy - 0.5) * 1.5;
      float e = voronoiEdge(lp);
      float crack = 1.0 - smoothstep(0.0, 0.03 + 0.035 * lava, e);
      float pulse = 0.65 + 0.35 * sin(uTime * 1.3 + mac.r * 12.0 + vWPos.x * 0.1);
      float glow = crack * smoothstep(0.02, 0.5, lava);
      totalEmissiveRadiance += vec3(2.6, 0.62, 0.12) * glow * pulse;
      diffuseColor.rgb *= 1.0 - glow * 0.85;
      // faint heat haze darkening around cracks
      diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.25, e)) * lava * 0.4;
    }
  }
`;

export function createTerrainMaterial({ layers, splat, noiseTex, hq = true }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const u = {
    uAlb: { value: layers.albedo },
    uNrm: { value: layers.normal },
    uSplatA: { value: splat.texA },
    uSplatB: { value: splat.texB },
    uNoise: { value: noiseTex },
    uExt: { value: EXT },
    uNrmStrength: { value: 1.0 },
    uHQ: { value: hq ? 1 : 0 },
    uTime: worldUniforms.uTime,
  };
  mat.userData.uniforms = u;
  patchMaterial(mat, 'terrain-v1', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWNrm = normalize(mat3(modelMatrix) * objectNormal);`,
    );
    shader.fragmentShader = TERRAIN_FRAG_HEAD + shader.fragmentShader
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrNW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', TERRAIN_EMISSIVE);
    injectFow(shader);
  });
  return mat;
}
