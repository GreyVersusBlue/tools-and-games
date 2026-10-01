// Scene cost breakdown: per top-level group, triangles & draw calls seen by the main camera and by the sun shadow camera
// (bounding-sphere frustum test, instancing aware). usage: node scripts/ws2_diag.mjs <url> [high|low] [minutes=6]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const quality = process.argv[3] || 'high';
const mins = +(process.argv[4] || 6);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript((q) => {
  try { localStorage.setItem('throneshard.world.quality', q); const k = 'throneshard-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.quality = q; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
  let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}, quality);
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
const r = await p.evaluate(async (mins) => {
  const g = window.game, THREE = g.THREE;
  g.startMatch({ heroId: 'sera' });
  g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null);
  const rr = g.renderer.render.bind(g.renderer), comp = g.composer;
  g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < mins * 60 * 20; i++) g.tick();
  g.renderer.render = rr; g.composer = comp; g.fixedDt = undefined;
  const mid = g.heroes.find(h => h.team === 'sunward' && h.lane === 'mid') ?? g.player.hero;
  g.cameraCtl.focus(mid.position.x, mid.position.z, true);
  for (let i = 0; i < 5; i++) g.tick();
  const sun = g.world.atmo.sun;
  sun.shadow.camera.updateMatrixWorld();
  const cams = { main: g.camera, shadow: sun.shadow.camera };
  const res = {};
  const tag = (o) => { let x = o; while (x) { if (x.userData?.unit) return 'unit:' + x.userData.unit.kind; if (x.parent === g.scene) return (x.name || x.type); x = x.parent; } return 'orphan'; };
  for (const [cn, cam] of Object.entries(cams)) {
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const groups = {};
    g.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      if (cn === 'shadow' && !o.castShadow) return;
      if (cn === 'shadow' && !o.layers.test(cam.layers)) return;
      if (cn === 'main' && !o.layers.test(cam.layers)) return;
      if (o.frustumCulled) {
        if (o.isSprite) { /* approx */ } else {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
          if (!fr.intersectsObject(o)) return;
        }
      }
      const geo = o.geometry;
      let tris = geo ? (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3 : 2;
      if (geo?.drawRange && geo.drawRange.count !== Infinity) tris = Math.min(tris, geo.drawRange.count / 3);
      const inst = o.isInstancedMesh ? o.count : geo?.isInstancedBufferGeometry ? geo.instanceCount : 1;
      const k = tag(o) + (o.isInstancedMesh ? ':inst' : '');
      const e = (groups[k] ??= { calls: 0, tris: 0 });
      e.calls++; e.tris += Math.round(tris * inst);
    });
    res[cn] = Object.entries(groups).sort((a, b) => b[1].tris - a[1].tris);
  }
  res.trees = g.world.foliage.trees.length;
  res.camera = { pos: g.camera.position.toArray().map((v) => +v.toFixed(1)), fov: g.camera.fov };
  return res;
}, mins);
console.log(JSON.stringify(r, null, 0).replace(/\],\[/g, '],\n['));
await b.close();
