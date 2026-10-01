// Model gallery: renders every character model (heroes, creeps of both teams, neutrals, Grimmaw, summons) inside the
// real game scene/renderer (lights, shadows, post-fx) and screenshots each animation clip at a few phases.
//   node scripts/model_gallery.mjs <url> [outDir=/tmp/ws1/gallery] [filter,comma,separated]
// Outputs: moba_<clip>.png (default MOBA camera, all models in rows), close_<group>_<clip>_<phase>.png (front
// close-ups), portraits.png (getPortrait of every hero), stats.json (tris / draw calls / bones per model).
import { chromium } from 'playwright';
import fs from 'fs';
const url = process.argv[2] || 'http://127.0.0.1:5181';
const out = process.argv[3] || '/tmp/ws1/gallery';
const filter = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForSelector('.btn-play', { timeout: 180000 });
await p.waitForFunction(() => window.game?.models?.ready && window.game?.scene, null, { timeout: 180000 });
await p.waitForTimeout(500);

const setup = await p.evaluate((filter) => {
  const g = window.game;
  const T = g.THREE;
  g.renderer.setAnimationLoop(null);
  const ui = document.getElementById('ui-root');
  if (ui) ui.style.display = 'none';
  const kinds = {
    heroes: ['brakka', 'kenshar', 'isolde', 'pell', 'sera', 'gorrow', 'vesna', 'aldric', 'morvane', 'sable', 'thalor', 'vashkar'],
    extra: ['ondur', 'liora', 'rift_stalker', 'bone_shaman', 'illusion'],
    creeps: [['creep_melee', 'sunward'], ['creep_melee', 'duskward'], ['creep_ranged', 'sunward'], ['creep_ranged', 'duskward'], ['creep_siege', 'sunward'], ['creep_siege', 'duskward']],
    neutrals: ['neutral_small', 'neutral_medium', 'neutral_large', 'neutral_elder', 'grimmaw', 'summon_wolf', 'summon_golem', 'summon_treant', 'courier'],
  };
  // flat-ish spot: middle of the map river-free area near sunward base
  const cx = g.world?.getHeight ? -60 : 0, cz = g.world?.getHeight ? 60 : 0;
  const group = new T.Group();
  g.scene.add(group);
  const models = [];
  let row = 0;
  for (const [gname, list] of Object.entries(kinds)) {
    const lab = (k) => (Array.isArray(k) ? `${k[0]}_${k[1]}` : k);
    const sel = list.filter((k) => !filter || filter.some((f) => lab(k).includes(f)));
    if (!sel.length) continue;
    sel.forEach((k, i) => {
      const [kind, team] = Array.isArray(k) ? k : [k, 'sunward'];
      const label = lab(k);
      const opts = { team };
      if (kind === 'illusion') opts.heroModel = 'kenshar';
      const m = g.models.create(kind, opts);
      const x = cx + (i - (sel.length - 1) / 2) * 3.2, z = cz + row * 5;
      const y = g.world?.getHeight ? g.world.getHeight(x, z) : 0;
      m.root.position.set(x, y, z);
      group.add(m.root);
      let tris = 0, calls = 0, bones = 0;
      m.root.traverse((o) => {
        if (o.isMesh && o.visible) {
          calls++;
          const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
          if (o.isSkinnedMesh) bones = Math.max(bones, o.skeleton.bones.length);
        }
      });
      models.push({ m, label, group: gname, x, y, z, tris: Math.round(tris), calls, bones, height: m.height, hit: m.attackHitFraction });
    });
    row++;
  }
  window.__gal = { models, group, cx, cz };
  return models.map(({ label, group, tris, calls, bones, height, hit }) => ({ label, group, tris, calls, bones, height, hit }));
}, filter);
fs.writeFileSync(out + '/stats.json', JSON.stringify(setup, null, 1));
console.table(setup);

async function render(name, body, arg) {
  await p.evaluate(({ body, arg }) => {
    const g = window.game;
    new Function('g', 'G', 'arg', body)(g, window.__gal, arg);
    if (g.composer) g.composer.render(0.016); else g.renderer.render(g.scene, g.camera);
  }, { body, arg });
  await p.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
}

// Pose all models: clip name, phase 0..1 of its duration
const pose = (g, G, arg) => {
  for (const it of G.models) {
    const m = it.m;
    m.play('idle');
    m.update(0.5);
    if (arg.clip !== 'idle') {
      const dur = 1.0;
      m.play(arg.clip, arg.clip === 'run' ? {} : { duration: dur });
      m.update(arg.clip === 'run' ? arg.phase * 0.7 : Math.max(0.001, arg.phase * dur));
      if (arg.flash) m.flash?.(0xff4040, 0.3);
      if (arg.flash) m.update(0.01);
    }
    m.root.updateMatrixWorld(true);
  }
};
const cam = (g, G, arg) => {
  const T = g.THREE;
  const c = g.camera;
  c.fov = arg.fov ?? 40;
  c.aspect = 1280 / 720;
  c.updateProjectionMatrix();
  const pitch = T.MathUtils.degToRad(arg.pitch ?? 57);
  const tx = arg.x ?? G.cx, tz = arg.z ?? G.cz + 7, ty = g.world?.getHeight ? g.world.getHeight(tx, tz) : 0;
  c.position.set(tx + (arg.side ?? 0), ty + Math.sin(pitch) * arg.d + (arg.up ?? 0), tz + Math.cos(pitch) * arg.d);
  c.lookAt(tx, ty + (arg.up ?? 0), tz);
  g.world?.atmosphere?.update?.(0, c);
};

const clips = [['idle', 0.3], ['run', 0.3], ['attack', 0.25], ['attack', 0.5], ['cast', 0.5], ['death', 0.9]];
for (const [clip, phase] of clips) {
  await render(`moba_${clip}_${Math.round(phase * 100)}`, `(${pose})(g,G,arg); (${cam})(g,G,{d:31});`, { clip, phase });
}
await render('moba_flash', `(${pose})(g,G,arg); (${cam})(g,G,{d:31});`, { clip: 'attack', phase: 0.3, flash: true });
// close-ups: chunks of 4 models, low front camera
for (let k = 0; k < setup.length; k += 4) {
  const idx = setup.slice(k, k + 4).map((_, j) => k + j);
  for (const [clip, phase] of [['idle', 0.3], ['attack', 0.3], ['cast', 0.5], ['run', 0.3]]) {
    await render(`close_${k / 4}_${clip}`, `(${pose})(g,G,arg);
      for (const it of G.models) it.m.root.visible = false;
      const ms=[${idx}].map(i=>G.models[i]);
      ms.forEach((it, j) => { it.m.root.visible = true; { const nx = G.cx + (j - (ms.length-1)/2) * 3.2; it.m.root.position.set(nx, g.world?.getHeight ? g.world.getHeight(nx, G.cz) : 0, G.cz); } });
      (${cam})(g,G,{d: 9 + Math.max(...ms.map(m=>m.height))*0.8, pitch: 10, x: G.cx, z: G.cz, up: 1.3, fov: 40});`, { clip, phase });
    await p.evaluate(() => { for (const it of window.__gal.models) { it.m.root.visible = true; it.m.root.position.set(it.x, it.y, it.z); } });
  }
}
// hero detail (MOBA pitch, zoomed in), two at a time
const heroes = setup.map((s, i) => [s, i]).filter(([s]) => s.group === 'heroes' || s.group === 'extra');
for (let k = 0; k < heroes.length; k += 4) {
  const idx = heroes.slice(k, k + 4).map(([, i]) => i);
  await render(`detail_${k / 4}`, `(${pose})(g,G,arg);
    for (const it of G.models) it.m.root.visible = false;
    const ms=[${idx}].map(i=>G.models[i]);
    ms.forEach((it, j) => { it.m.root.visible = true; { const nx = G.cx + (j - (ms.length-1)/2) * 3.2; it.m.root.position.set(nx, g.world?.getHeight ? g.world.getHeight(nx, G.cz) : 0, G.cz); } });
    (${cam})(g,G,{d: 16, pitch: 57, x: G.cx, z: G.cz, up: 1.0, fov: 40});`, { clip: 'attack', phase: 0.28 });
  await p.evaluate(() => { for (const it of window.__gal.models) { it.m.root.visible = true; it.m.root.position.set(it.x, it.y, it.z); } });
}
// portraits
const portraits = await p.evaluate(() => {
  const ks = ['brakka', 'kenshar', 'isolde', 'pell', 'sera', 'gorrow', 'vesna', 'aldric', 'morvane', 'sable', 'thalor', 'vashkar', 'ondur', 'liora', 'rift_stalker', 'bone_shaman'];
  return ks.map((k) => [k, window.game.models.getPortrait(k)]);
});
const html = `<html><body style="background:#111;margin:0">${portraits.map(([k, u]) => `<div style="display:inline-block;margin:4px;color:#ccc;font:12px sans-serif;text-align:center"><img src="${u}" width="150" height="150"><br>${k}</div>`).join('')}</body></html>`;
const p2 = await b.newPage({ viewport: { width: 1300, height: 360 } });
await p2.setContent(html);
await p2.screenshot({ path: `${out}/portraits.png` });
console.log('errors:', errs.length, errs.slice(0, 20));
await b.close();
