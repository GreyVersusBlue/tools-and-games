// gltf.js — glTF 2.0, read and written by hand.
//
// Phase 9 wants two things that both speak the same format: a prop that comes
// from a file instead of from a geometry builder, and a whole building that
// leaves for Blender. The obvious way to get them is to vendor three.js's
// `GLTFLoader` and `GLTFExporter` alongside the addons already in `libs/` —
// six thousand lines of somebody else's code, most of it about the parts of
// the format this tool will never meet (skins, morph targets, animation
// samplers, Draco, KTX2, texture transforms).
//
// This is the other way, and it is the one that matches how the rest of the
// codebase is built: a pure module with a `node --test` twin, no build step,
// no deps, and a scope stated out loud. What it handles:
//
//   read  — .glb (binary, the format every exporter defaults to) and .gltf
//           (JSON with its buffer embedded as a data URI); TRIANGLES
//           primitives; POSITION, NORMAL and COLOR_0 attributes; indexed or
//           not; the full node hierarchy, flattened by multiplying matrices
//           down the tree; base colour taken from the material factor and
//           baked into vertex colours, because a prop in this build is one
//           vertex-coloured material and nothing else.
//   write — one buffer, one material, N meshes, as .glb, with optional
//           `EXT_mesh_gpu_instancing` on the nodes that want it.
//
// The one extension it does handle is `EXT_mesh_gpu_instancing`, and Phase 9
// deliberately did not: *"an extension is a thing the importer at the other
// end may not have. A school of ten thousand desks is a bigger file this way
// and it opens everywhere."* That was the right call for a school. It is the
// wrong call for a campus, where "a bigger file" is four megabytes of the same
// chair written out eight hundred times, and it is the difference between an
// export you can open and one you wait for. So it is a *choice* now rather
// than a policy: `opts.instancing` on the writer, a checkbox on the panel, and
// the expanded form still one click away for an importer that needs it.
//
// What it does not handle, deliberately: textures (the prop material has no
// map — see render.js's `propMat`), skins, morph targets, animations, sparse
// accessors, Draco or any other extension, and external buffer/image files (a
// .gltf that points at a sibling .bin is a *pair* of files, and a file input
// hands us one). Each of those fails as a stated error rather than as a
// half-read model: a prop that arrives inside out is worse than one that
// refuses to arrive.
//
// Units: glTF is metres, this build is feet. Reading normalizes the model
// into a catalog row's footprint anyway (`fitModel`), so an import's units
// genuinely do not matter. Writing does care — a school exported at 1 unit
// per foot lands in Blender three times too big — so `writeGLB` scales the
// root node by `unitScale`, which defaults to feet-to-metres.

// A file bigger than this is not a school prop, it is a scanned city block.
// The cap is on the *file*, checked before anything is parsed.
export const MAX_MODEL_BYTES = 8 * 1024 * 1024;
// ...and a cap on what comes out of it, because a compressed 6MB file can
// still decompress into more triangles than an instanced prop should carry.
export const MAX_VERTICES = 250000;
export const MAX_TRIANGLES = 250000;

export const FT_TO_M = 0.3048;

// The one extension this writer speaks.
export const EXT_INSTANCING = 'EXT_mesh_gpu_instancing';

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942;  // 'BIN\0'

const MODE_TRIANGLES = 4;

// componentType -> [TypedArray, bytes]
const COMPONENTS = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};

const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// The divisor that turns a normalized integer component back into 0..1 (or
// -1..1 for the signed kinds), per the glTF spec's own table.
const NORMALIZE_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

// ---------- bytes ----------

export function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source && source.buffer instanceof ArrayBuffer) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new Error('Expected an ArrayBuffer or a typed array');
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  const b = toBytes(bytes);
  let s = '';
  // In chunks: `String.fromCharCode(...bytes)` on a megabyte-long array blows
  // the argument limit, which is the kind of failure that only shows up on
  // the one model somebody actually cares about.
  const STEP = 0x8000;
  for (let i = 0; i < b.length; i += STEP) {
    s += String.fromCharCode.apply(null, b.subarray(i, i + STEP));
  }
  return btoa(s);
}

// A data: URI in a glTF buffer, as an exporter writes it. Anything else — a
// relative path to a sibling .bin, an http URL — is a second file we were
// never handed.
function readURI(uri) {
  const m = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(String(uri));
  if (!m) throw new Error('This model refers to a separate file; export it as .glb instead');
  if (m[2]) return base64ToBytes(m[3]);
  const text = decodeURIComponent(m[3]);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

// ---------- containers ----------

// A .glb is a 12-byte header and then length-prefixed chunks: JSON first, an
// optional binary blob second, and anything after that ignored by the spec.
export function parseGLB(source) {
  const bytes = toBytes(source);
  if (bytes.byteLength < 20) throw new Error('Not a glTF file (too short)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Not a glTF binary file');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`glTF version ${version} is not supported (needs 2)`);
  let json = null, bin = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const len = view.getUint32(at, true);
    const kind = view.getUint32(at + 4, true);
    const start = at + 8;
    const end = start + len;
    if (end > bytes.byteLength) throw new Error('Truncated glTF chunk');
    if (kind === CHUNK_JSON && json === null) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
    } else if (kind === CHUNK_BIN && bin === null) {
      bin = bytes.subarray(start, end);
    }
    // Chunks are 4-byte aligned; the length field excludes the padding.
    at = end + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('glTF file has no JSON chunk');
  return { json, bin };
}

export function isGLB(source) {
  const bytes = toBytes(source);
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC;
}

// Either container, sniffed rather than trusted to a file extension — plenty
// of .gltf files in the wild are binary and plenty of .glb files aren't.
export function parseModelFile(source) {
  const bytes = toBytes(source);
  if (bytes.byteLength > MAX_MODEL_BYTES) {
    throw new Error(`Model is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${MAX_MODEL_BYTES / 1048576} MB`);
  }
  if (isGLB(bytes)) return parseGLB(bytes);
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Not a glTF file');
  }
  if (!json || typeof json !== 'object' || !json.asset) throw new Error('Not a glTF file');
  return { json, bin: null };
}

// ---------- 4x4 matrices, column-major like the format ----------

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mulMat(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// glTF's rotation is a quaternion [x, y, z, w]; translation and scale are
// plain triples. A node may state either this or an explicit matrix, never
// both — the spec says so and this trusts it.
export function composeTRS(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice();
  return composeTRS(
    Array.isArray(node.translation) ? node.translation : [0, 0, 0],
    Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1],
    Array.isArray(node.scale) ? node.scale : [1, 1, 1],
  );
}

// The 3x3 inverse-transpose, for normals under a non-uniform scale. A
// squashed model whose normals were merely rotated lights wrong in a way that
// reads as "the import is broken" rather than as "the import is squashed".
export function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = 1 / det;
  // inverse = adj/det, then transposed — written out so neither step needs a
  // temporary.
  return [
    A * inv, B * inv, C * inv,
    (c * h - b * i) * inv, (a * i - c * g) * inv, (b * g - a * h) * inv,
    (b * f - c * e) * inv, (c * d - a * f) * inv, (a * e - b * d) * inv,
  ];
}

// ---------- accessors ----------

export function readAccessor(json, buffers, index) {
  const acc = (json.accessors || [])[index];
  if (!acc) throw new Error(`Missing accessor ${index}`);
  if (acc.sparse) throw new Error('Sparse accessors are not supported');
  const comp = COMPONENTS[acc.componentType];
  if (!comp) throw new Error(`Unknown component type ${acc.componentType}`);
  const per = TYPE_COUNTS[acc.type];
  if (!per) throw new Error(`Unknown accessor type ${acc.type}`);
  const [Arr, size] = comp;
  const count = acc.count | 0;
  const out = new Arr(count * per);
  if (acc.bufferView === undefined) return out; // spec: all zeroes

  const bv = (json.bufferViews || [])[acc.bufferView];
  if (!bv) throw new Error(`Missing bufferView ${acc.bufferView}`);
  const buf = buffers[bv.buffer || 0];
  if (!buf) throw new Error(`Missing buffer ${bv.buffer || 0}`);
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || per * size;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const need = base + (count - 1) * stride + per * size;
  if (count > 0 && need > buf.byteLength) throw new Error('Accessor runs past the end of its buffer');

  for (let i = 0; i < count; i++) {
    const at = base + i * stride;
    for (let j = 0; j < per; j++) {
      const o = at + j * size;
      let v;
      switch (acc.componentType) {
        case 5120: v = view.getInt8(o); break;
        case 5121: v = view.getUint8(o); break;
        case 5122: v = view.getInt16(o, true); break;
        case 5123: v = view.getUint16(o, true); break;
        case 5125: v = view.getUint32(o, true); break;
        default: v = view.getFloat32(o, true); break;
      }
      out[i * per + j] = v;
    }
  }
  return out;
}

// Normalized integer attributes (a COLOR_0 written as unsigned bytes, which is
// what most exporters do) come back as floats.
function readNormalized(json, buffers, index) {
  const acc = json.accessors[index];
  const raw = readAccessor(json, buffers, index);
  const div = acc.normalized ? NORMALIZE_DIV[acc.componentType] : null;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = div ? Math.max(-1, raw[i] / div) : raw[i];
  return out;
}

// ---------- reading a model ----------

function materialColor(json, index) {
  const mat = (json.materials || [])[index];
  const f = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor;
  if (!Array.isArray(f)) return [1, 1, 1];
  return [
    Number.isFinite(f[0]) ? f[0] : 1,
    Number.isFinite(f[1]) ? f[1] : 1,
    Number.isFinite(f[2]) ? f[2] : 1,
  ];
}

// Every mesh in the file, flattened into world space and merged per material
// colour. The result is what this build's prop contract wants: positions,
// normals and colours, bottom-at-nothing-in-particular (fitModel handles
// that), one draw call's worth per colour.
export function readModel(parsed, opts = {}) {
  const { json, bin } = parsed;
  if (!json || !Array.isArray(json.meshes) || !json.meshes.length) {
    throw new Error('This glTF file has no meshes in it');
  }
  const buffers = (json.buffers || []).map((b, i) => {
    if (b.uri === undefined) {
      if (i === 0 && bin) return bin;
      throw new Error('This model refers to a separate file; export it as .glb instead');
    }
    return readURI(b.uri);
  });

  const maxV = opts.maxVertices || MAX_VERTICES;
  const maxT = opts.maxTriangles || MAX_TRIANGLES;
  const parts = [];
  let vertices = 0, triangles = 0;
  let skipped = 0;

  function addPrimitive(prim, m) {
    if (prim.mode !== undefined && prim.mode !== MODE_TRIANGLES) { skipped++; return; }
    const attrs = prim.attributes || {};
    if (attrs.POSITION === undefined) { skipped++; return; }
    const pos = readAccessor(json, buffers, attrs.POSITION);
    const n = pos.length / 3;
    const nrm = attrs.NORMAL !== undefined ? readAccessor(json, buffers, attrs.NORMAL) : null;
    const col = attrs.COLOR_0 !== undefined ? readNormalized(json, buffers, attrs.COLOR_0) : null;
    const colPer = col ? TYPE_COUNTS[json.accessors[attrs.COLOR_0].type] : 0;
    const base = materialColor(json, prim.material);
    const nm = normalMatrix(m);

    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      position[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      position[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      position[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (nrm) {
        const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
        let tx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
        let ty = nm[1] * nx + nm[4] * ny + nm[7] * nz;
        let tz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const len = Math.hypot(tx, ty, tz) || 1;
        normal[i * 3] = tx / len; normal[i * 3 + 1] = ty / len; normal[i * 3 + 2] = tz / len;
      }
      for (let c = 0; c < 3; c++) {
        const v = col ? col[i * colPer + c] : 1;
        color[i * 3 + c] = Math.min(1, Math.max(0, v * base[c]));
      }
    }

    let index;
    if (prim.indices !== undefined) {
      const raw = readAccessor(json, buffers, prim.indices);
      index = raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
    } else {
      index = new Uint32Array(n);
      for (let i = 0; i < n; i++) index[i] = i;
    }
    // A primitive whose index count isn't a multiple of three is malformed;
    // the extra one or two get dropped rather than read past the end.
    const tris = Math.floor(index.length / 3);
    if (tris * 3 !== index.length) index = index.subarray(0, tris * 3);

    vertices += n;
    triangles += tris;
    if (vertices > maxV || triangles > maxT) {
      throw new Error(`Model is too dense (${vertices} vertices, ${triangles} triangles); the limit is ${maxV}`);
    }
    parts.push({ position, normal, color, index, hasNormals: !!nrm });
  }

  function walkNode(i, parent, seen) {
    const node = (json.nodes || [])[i];
    if (!node || seen.has(i)) return; // a cycle in a hand-written file
    seen.add(i);
    const m = mulMat(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      if (mesh) for (const prim of mesh.primitives || []) addPrimitive(prim, m);
    }
    for (const child of node.children || []) walkNode(child, m, seen);
    seen.delete(i);
  }

  const root = opts.matrix || IDENTITY;
  const sceneIndex = json.scene !== undefined ? json.scene : 0;
  const scene = (json.scenes || [])[sceneIndex];
  if (scene && Array.isArray(scene.nodes) && scene.nodes.length) {
    for (const i of scene.nodes) walkNode(i, root, new Set());
  } else if (Array.isArray(json.nodes) && json.nodes.length) {
    // No scene declared: every node is a root, which is what a stripped-down
    // exporter leaves behind.
    for (let i = 0; i < json.nodes.length; i++) walkNode(i, root, new Set());
  } else {
    // No nodes at all: the meshes stand at the origin.
    for (const mesh of json.meshes) for (const prim of mesh.primitives || []) addPrimitive(prim, root);
  }

  if (!parts.length) {
    throw new Error(skipped
      ? 'This model has no triangles in it (points and lines are not supported)'
      : 'This glTF file has no drawable geometry');
  }
  for (const part of parts) if (!part.hasNormals) computeNormals(part);
  return { meshes: parts, bbox: modelBBox(parts), vertices, triangles, skipped };
}

// Flat normals for a primitive that shipped without any — rare from a real
// exporter, common from a script that wrote one by hand, and the difference
// between a prop that lights and a prop that renders black.
export function computeNormals(part) {
  const { position, index, normal } = part;
  normal.fill(0);
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ax = position[a], ay = position[a + 1], az = position[a + 2];
    const ux = position[b] - ax, uy = position[b + 1] - ay, uz = position[b + 2] - az;
    const vx = position[c] - ax, vy = position[c + 1] - ay, vz = position[c + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      normal[o] += nx; normal[o + 1] += ny; normal[o + 2] += nz;
    }
  }
  for (let i = 0; i < normal.length; i += 3) {
    const len = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
    if (len > 1e-9) { normal[i] /= len; normal[i + 1] /= len; normal[i + 2] /= len; }
    else normal[i + 1] = 1;
  }
  return part;
}

export function modelBBox(meshes) {
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const part of meshes) {
    const p = part.position;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1];
      if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
      if (p[i + 2] < b.minZ) b.minZ = p[i + 2];
      if (p[i + 2] > b.maxZ) b.maxZ = p[i + 2];
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  return b;
}

// The one transform that makes an imported file behave like a catalog row:
// centred on x/z, sitting on y=0, and scaled to fit the row's w/d/h box. A
// prop in this build is "bottom at y=0, facing +Z, sized from the catalog"
// (see render.js's contract) — this is that sentence as arithmetic, and it is
// why an import needs no eyeballing to sit on the floor.
//
// `mode` is 'contain' (the default: the whole model fits inside the box, one
// axis touching) or 'stretch' (each axis scaled independently, which is what
// you want when the row's dimensions *are* the intent and the model is a
// stand-in).
export function fitModel(bbox, box, mode = 'contain') {
  const sx = Math.max(1e-6, bbox.maxX - bbox.minX);
  const sy = Math.max(1e-6, bbox.maxY - bbox.minY);
  const sz = Math.max(1e-6, bbox.maxZ - bbox.minZ);
  const w = Math.max(1e-6, box.w), d = Math.max(1e-6, box.d), h = Math.max(1e-6, box.h);
  let scale;
  if (mode === 'stretch') scale = { x: w / sx, y: h / sy, z: d / sz };
  else {
    const k = Math.min(w / sx, h / sy, d / sz);
    scale = { x: k, y: k, z: k };
  }
  return {
    scale,
    // Move the centre of the footprint to the origin and the underside to
    // zero — the same anchor every procedural builder in render.js uses.
    offset: {
      x: -((bbox.minX + bbox.maxX) / 2) * scale.x,
      y: -bbox.minY * scale.y,
      z: -((bbox.minZ + bbox.maxZ) / 2) * scale.z,
    },
  };
}

// Apply a fit in place — the import path's last step, so what gets cached as
// prop geometry is already in catalog coordinates and instancing can treat it
// like anything else.
export function bakeFit(model, fit) {
  const { scale, offset } = fit;
  // Normals follow the *inverse* scale, which only matters under 'stretch';
  // under 'contain' the three factors are equal and this is the identity.
  const nsx = 1 / scale.x, nsy = 1 / scale.y, nsz = 1 / scale.z;
  for (const part of model.meshes) {
    const p = part.position, n = part.normal;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = p[i] * scale.x + offset.x;
      p[i + 1] = p[i + 1] * scale.y + offset.y;
      p[i + 2] = p[i + 2] * scale.z + offset.z;
      const nx = n[i] * nsx, ny = n[i + 1] * nsy, nz = n[i + 2] * nsz;
      const len = Math.hypot(nx, ny, nz) || 1;
      n[i] = nx / len; n[i + 1] = ny / len; n[i + 2] = nz / len;
    }
  }
  model.bbox = modelBBox(model.meshes);
  return model;
}

// Read a file and put it straight into a catalog row's box — the whole import
// in one call, which is all `models.js` ever needs.
export function loadModel(source, box, opts = {}) {
  const model = readModel(parseModelFile(source), opts);
  if (box) bakeFit(model, fitModel(model.bbox, box, opts.mode));
  return model;
}

// ---------- writing ----------

const pad4 = (n) => (n + 3) & ~3;

// Meshes in, one .glb out. Each mesh is `{ position, normal, color, index,
// name }` in this build's own coordinates (feet, y up); `unitScale` is the
// root node's scale, which is what turns feet into the metres every other
// tool assumes.
//
// A mesh may also carry `instances` — `{ count, translation, rotation, scale }`
// as flat arrays of 3, 4 and 3 floats each — and then its geometry is written
// once and the copies go out as `EXT_mesh_gpu_instancing` on the node. The
// geometry has to be in its *own* space for that: an instanced mesh's vertices
// are not pre-transformed, which is the whole saving.
export function writeGLB(meshes, opts = {}) {
  const list = (meshes || []).filter((m) => m && m.position && m.position.length >= 9);
  if (!list.length) throw new Error('Nothing to export');
  const unit = Number.isFinite(opts.unitScale) ? opts.unitScale : FT_TO_M;

  const bufferViews = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;

  function addView(bytes, target) {
    const padded = pad4(bytes.byteLength);
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    });
    chunks.push({ bytes, padded });
    offset += padded;
    return bufferViews.length - 1;
  }

  function addAttribute(arr, type, min, max) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const view = addView(bytes, 34962); // ARRAY_BUFFER
    accessors.push({
      bufferView: view,
      componentType: 5126,
      count: arr.length / TYPE_COUNTS[type],
      type,
      ...(min ? { min, max } : {}),
    });
    return accessors.length - 1;
  }

  const gltfMeshes = [];
  const nodes = [];
  let usesInstancing = false;
  for (const m of list) {
    const pos = m.position instanceof Float32Array ? m.position : Float32Array.from(m.position);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = pos[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    const attributes = { POSITION: addAttribute(pos, 'VEC3', min, max) };
    if (m.normal && m.normal.length === pos.length) {
      attributes.NORMAL = addAttribute(
        m.normal instanceof Float32Array ? m.normal : Float32Array.from(m.normal), 'VEC3');
    }
    if (m.color && m.color.length === pos.length) {
      attributes.COLOR_0 = addAttribute(
        m.color instanceof Float32Array ? m.color : Float32Array.from(m.color), 'VEC3');
    }
    const prim = { attributes, mode: MODE_TRIANGLES, material: 0 };
    if (m.index && m.index.length) {
      // Indices go out as unsigned ints unless they comfortably fit in
      // shorts, which is the ordinary case for one merged storey.
      const count = pos.length / 3;
      const small = count <= 65535;
      const arr = small ? Uint16Array.from(m.index) : Uint32Array.from(m.index);
      const view = addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), 34963);
      accessors.push({
        bufferView: view,
        componentType: small ? 5123 : 5125,
        count: arr.length,
        type: 'SCALAR',
      });
      prim.indices = accessors.length - 1;
    }
    gltfMeshes.push({ ...(m.name ? { name: m.name } : {}), primitives: [prim] });
    const node = { mesh: gltfMeshes.length - 1, ...(m.name ? { name: m.name } : {}) };
    // The copies, if there are any. Per the extension: one accessor per
    // attribute, all of the same count, on a node that carries the mesh and
    // no children of its own.
    const inst = m.instances;
    if (inst && inst.count > 0) {
      const attributes = {};
      const add = (arr, type, expect) => {
        if (!arr || arr.length !== inst.count * expect) return null;
        const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
        return addAttribute(f, type);
      };
      const t = add(inst.translation, 'VEC3', 3);
      const r = add(inst.rotation, 'VEC4', 4);
      const sc = add(inst.scale, 'VEC3', 3);
      if (t !== null) attributes.TRANSLATION = t;
      if (r !== null) attributes.ROTATION = r;
      if (sc !== null) attributes.SCALE = sc;
      if (Object.keys(attributes).length) {
        node.extensions = { [EXT_INSTANCING]: { attributes } };
        usesInstancing = true;
      }
    }
    nodes.push(node);
  }

  // One root, so the unit conversion is a single scale rather than a factor
  // smeared across every vertex — and so a Blender import arrives with one
  // object to move.
  const rootChildren = nodes.map((_, i) => i);
  nodes.push({
    name: opts.name || 'School',
    scale: [unit, unit, unit],
    children: rootChildren,
  });

  const json = {
    asset: { version: '2.0', generator: opts.generator || 'School Generator' },
    // Declared *required* as well as used, on purpose. An importer that does
    // not know the extension would otherwise read one desk where there are
    // eight hundred and say nothing — and a file that quietly loses most of
    // its contents is worse than one that refuses to open.
    ...(usesInstancing
      ? { extensionsUsed: [EXT_INSTANCING], extensionsRequired: [EXT_INSTANCING] }
      : {}),
    scene: 0,
    scenes: [{ nodes: [nodes.length - 1] }],
    nodes,
    meshes: gltfMeshes,
    materials: [{
      name: 'School',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      doubleSided: true,
    }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bin.set(c.bytes, at);
    at += c.padded;
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = pad4(jsonBytes.byteLength);
  const binPad = pad4(bin.byteLength);
  const total = 12 + 8 + jsonPad + (binPad ? 8 + binPad : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPad, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  // JSON pads with spaces, BIN with zeroes — the spec is specific about it,
  // and a validator will say so.
  for (let i = 20 + jsonBytes.byteLength; i < 20 + jsonPad; i++) out[i] = 0x20;
  if (binPad) {
    const off = 20 + jsonPad;
    view.setUint32(off, binPad, true);
    view.setUint32(off + 4, CHUNK_BIN, true);
    out.set(bin, off + 8);
  }
  return out.buffer;
}
