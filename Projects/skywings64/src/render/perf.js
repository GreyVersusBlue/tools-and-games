// Perf audit (enable with ?perf=1; call window.__perfReport() any time, it also logs 'PERF {...}' once
// after load). No GPU timing is possible in this headless/software-GL setup, so this reports the static
// cost drivers instead: draw calls, triangles, shader programs, texture memory/oversize/NPOT textures and
// instancing candidates (one geometry drawn by many separate meshes).
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'envMap', 'lightMap'];
const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;

export function perfReport(renderer, scene) {
  const info = renderer.info;
  const out = {
    frame: { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines },
    memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: (info.programs || []).length },
    scene: { meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, materials: 0 },
    textures: { count: 0, estMB: 0, oversize: [], npot: [] },
    instancingCandidates: [],
  };
  const geoUse = new Map();
  const mats = new Set();
  const texs = new Map();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    out.scene.meshes++;
    let vis = o.visible; for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
    if (vis) out.scene.visibleMeshes++;
    if (o.isInstancedMesh) { out.scene.instanced++; out.scene.instances += o.count; }
    else if (vis && o.geometry) {
      const u = geoUse.get(o.geometry) || { n: 0, name: o.name || o.parent && o.parent.name || '', tris: 0 };
      u.n++; u.tris = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0);
      geoUse.set(o.geometry, u);
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue; mats.add(m);
      for (const k of TEX_SLOTS) { const t = m[k]; if (t && t.isTexture && !texs.has(t)) texs.set(t, k); }
      if (m.uniforms) for (const k in m.uniforms) { const t = m.uniforms[k] && m.uniforms[k].value; if (t && t.isTexture && !texs.has(t)) texs.set(t, 'uniform:' + k); }
    }
  });
  out.scene.materials = mats.size;
  let bytes = 0;
  for (const [t, slot] of texs) {
    const img = t.image || (t.source && t.source.data);
    const w = (img && (img.width || img.videoWidth)) || 0, h = (img && (img.height || img.videoHeight)) || 0;
    if (!w || !h) continue;
    out.textures.count++;
    const bpp = t.type === 1016 /* HalfFloat */ ? 8 : t.type === 1015 /* Float */ ? 16 : 4;
    bytes += w * h * bpp * (t.generateMipmaps !== false ? 1.33 : 1);
    const label = (t.name || slot) + ' ' + w + 'x' + h;
    if (w > 2048 || h > 2048) out.textures.oversize.push(label);
    if (!isPOT(w) || !isPOT(h)) out.textures.npot.push(label);
  }
  out.textures.estMB = +(bytes / 1048576).toFixed(1);
  for (const [, u] of geoUse) if (u.n >= 4) out.instancingCandidates.push({ name: u.name, meshes: u.n, tris: u.tris });
  out.instancingCandidates.sort((a, b) => b.meshes * b.tris - a.meshes * a.tris);
  out.instancingCandidates.length = Math.min(out.instancingCandidates.length, 12);
  return out;
}

export function installPerf(renderer, scene) {
  // the post-processing composer renders several passes per frame and info auto-resets on each one:
  // accumulate over whole frames instead so 'calls'/'triangles' mean one displayed frame
  renderer.info.autoReset = false;
  const tick = () => {
    const r = renderer.info.render; last = { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines };
    renderer.info.reset(); requestAnimationFrame(tick);
  };
  let last = null;
  requestAnimationFrame(tick);
  window.__perfReport = () => { const o = perfReport(renderer, scene); if (last) o.frame = last; return o; };
  // log once after things settle (models, lazy vegetation cells)
  setTimeout(() => { try { console.log('PERF ' + JSON.stringify(window.__perfReport())); } catch (e) { console.warn(e); } }, 6000);
}
