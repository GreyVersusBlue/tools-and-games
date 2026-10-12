// VFX measure: how much of the screen an effect really changes, from the game camera at its default zoom, 1920x1080.
//
//   node Projects/throneshard/tools/scripts/vfx_measure.mjs [liora|aldric] [lane,river,grass] [outDir]
//
// liora: Piercing Gale 0.2 s after release (the whole effect, then its corkscrew and sparks alone) and Tether Shot's
// rope as the yardstick. aldric: the four lasting rune auras 1.8 s after activation, Haste again on a running hero,
// and Titan's Might as the yardstick. Each on the grounds named, by day and by night. For every case it renders the
// frame twice in one simulation state, with and without the layer, and prints the pixels whose colour moved by
// dE76 >= 10 ("seen"), >= 25 ("strong") and >= 2.3 ("any", which takes in the bloom's haze), the box they span, the
// mean and peak dE, the mean change in L* and in chroma, and the effect's draw calls, triangles and particles.
// It writes <outDir>/<case>_with.png and _without.png (crops) and a JSON of the rows. Default outDir is the system
// temp folder: every file in this repo is a live URL, so captures are not kept in it.
//
// Runs on Tools/board-check's harness (headless Chromium, software-rendered on Linux), so it needs no Playwright
// and no GPU; about 4 minutes a hero for three grounds. Colours and shapes are honest there, frame pacing is not,
// which is why nothing is timed and the match is stepped by hand. To compare with an older commit, run the same
// command from a checkout of it into another outDir. VFX_PORT moves the port (8191).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, launch, prepPage } from '../../../../Tools/board-check/harness.mjs';

const PORT = +(process.env.VFX_PORT || 8191);
const BASE = `http://127.0.0.1:${PORT}`;

const PAGE_LIB = () => {
  const g = window.game;
  const cap = (window.__cap = {});
  cap.seed = (seed) => { let a = seed * 2654435761; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  cap.step = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) g.tick(); };
  cap.nightMode = 0;
  cap.render = () => {
    g.world.night = cap.nightMode;
    g.world.atmo.applyTime(cap.nightMode, g.scene, g.renderer);
    g.world.post?.setNight(cap.nightMode);
    g.frame += 2; // never reuse a stale half-rate bloom
    if (g.composer) g.composer.render(0); else g.renderer.render(g.scene, g.camera);
  };
  cap.setup = () => {
    g.renderer.setAnimationLoop(null);
    g.fixedDt = 1 / 60;
    g.renderEvery = 100000;
    if (g.ai) g.ai.update = () => {};
    for (const u of [...g.units]) if (!u.isStructure && u.kind !== 'hero') { u.alive = false; g.removeUnit(u); }
    // stop creep waves, neutrals and runes arriving in the shot
    if (g.creeps) g.creeps.update = () => {};
    if (g.neutrals) g.neutrals.update = () => {};
    cap.SP = { x: -6, z: 6 };
    const h = g.player.hero;
    cap.h = h;
    h.controller = null;
    h.addXp?.(1e6);
    for (let k = 0; k < 40; k++) for (let i = 0; i < 4; i++) h.levelAbility(i);
    h.baseStats.maxHp = 50000; h.baseStats.maxMana = 50000; h.hp = h.getStat('maxHp'); h.mana = h.getStat('maxMana');
    const enemies = g.heroes.filter((x) => x.team !== h.team);
    for (const x of g.heroes) if (x !== h) { x.controller = null; x.issueOrder({ type: 'hold' }); }
    cap.dummies = enemies.slice(0, 3);
    for (const d of cap.dummies) { d.baseStats.maxHp = 1e6; d.hp = d.getStat('maxHp'); d.baseStats.magicResist = 0; }
    for (const u of g.units) if (u.isStructure) u.addModifier({ id: 'cap_disarm', hidden: true, disarm: true, duration: 1e9 });
    cap.reset();
  };
  cap.place = (u, x, z, facing) => {
    u.position.set(x, 0, z); u.path = [];
    if (facing !== undefined) u.facing = facing;
    u.object?.position.set(x, g.world?.getHeight?.(x, z) ?? 0, z);
  };
  cap.clearFx = () => { for (const f of g.vfx?.effects ?? []) f.dead = true; g.vfx.add.clear(); g.vfx.alpha.clear(); };
  // dir: unit vector the hero faces and the dummies stand along
  cap.reset = () => {
    const h = cap.h, SP = cap.SP, d = cap.dir ?? { x: 1, z: 0 };
    const facing = Math.atan2(d.x, d.z);
    for (const ab of h.abilities) { ab.cooldownRemaining = 0; }
    for (const u of [h, ...g.heroes]) for (const m of [...u.modifiers]) if (Number.isFinite(m.remaining)) u.removeModifier(m);
    if (!h.alive) h.respawn();
    h.issueOrder({ type: 'hold' });
    h.hp = h.getStat('maxHp'); h.mana = h.getStat('maxMana');
    cap.place(h, SP.x - d.x * 5, SP.z - d.z * 5, facing);
    const offs = [[7, -1], [9.5, 2.5], [5.5, 3.5]];
    cap.dummies.forEach((dm, i) => {
      if (!dm.alive) dm.respawn();
      dm.hp = dm.getStat('maxHp');
      const [a, s] = cap.noDummies ? [300, 0] : offs[i];
      cap.place(dm, SP.x - d.x * 5 + d.x * a - d.z * s, SP.z - d.z * 5 + d.z * a + d.x * s, facing + Math.PI);
      dm.issueOrder({ type: 'hold' });
      dm.addModifier({ id: 'cap_disarm', hidden: true, disarm: true, duration: 1e9 });
    });
    for (const x of g.heroes) if (x !== h && !cap.dummies.includes(x)) { const f = x.team === 'sunward' ? [-92, 92] : [92, -92]; cap.place(x, f[0], f[1]); }
    cap.focus();
  };
  cap.focus = () => { g.cameraCtl?.focus?.(cap.SP.x, cap.SP.z, true); if (g.cameraCtl) { g.cameraCtl._shakes = []; g.cameraCtl.desiredDistance = g.cameraCtl.distance = 31; } };
  cap.watch = (evt, pred) => { cap.triggered = false; g.bus.on(evt, (e) => { if (!cap.triggered && pred(e)) cap.triggered = true; }); };
  cap.stepUntil = (maxSec) => { for (let i = 0; i < maxSec * 60; i++) { g.tick(); if (cap.triggered) return true; } return false; };

  // ---- pixels: the WebGL canvas, read straight after a render ----
  const W = g.renderer.domElement.width, Hh = g.renderer.domElement.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cap.grab = () => { cap.render(); cx.drawImage(g.renderer.domElement, 0, 0); return cx.getImageData(0, 0, W, Hh); };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = (r, gg, b, o) => {
    const R = LUT[r], G = LUT[gg], B = LUT[b];
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const fx = f(X), fy = f(Y), fz = f(Z);
    o[0] = 116 * fy - 16; o[1] = 500 * (fx - fy); o[2] = 200 * (fy - fz);
  };
  // with = everything drawn; without = `layer` hidden ('all' = the vfx root; 'spiral' = the additive particle layer and
  // any object tagged userData.cap === 'spiral'), same simulation state. Counts are over the whole 1920x1080 frame.
  // "seen" = pixels whose colour moved by dE76 >= 10 (plain to the eye); "any" = dE >= 2.3 (one just-noticeable step,
  // which also takes in the bloom's wide haze).
  cap.measure = (name, crop, layer = 'all') => {
    const root = g.vfx.root, info = g.renderer.info; info.autoReset = false;
    const tagged = []; root.traverse((o) => { if (o.userData?.galeHelix) tagged.push(o); });
    const hide = (v) => { if (layer === 'all') root.visible = !v; else { g.vfx.add.points.visible = !v; for (const o of tagged) o.visible = !v; } };
    info.reset(); const A = cap.grab(); const withURL = cap.cropURL(crop); const calls = info.render.calls, tris = info.render.triangles;
    hide(true); info.reset(); const B = cap.grab(); const withoutURL = cap.cropURL(crop); const calls0 = info.render.calls, tris0 = info.render.triangles; hide(false);
    const a = A.data, b = B.data, la = [0, 0, 0], lb = [0, 0, 0];
    let any = 0, n = 0, sumDE = 0, sumDL = 0, peakDE = 0, x0 = W, y0 = Hh, x1 = -1, y1 = -1, n25 = 0, dark = 0, sumC = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      lab(a[i], a[i + 1], a[i + 2], la); lab(b[i], b[i + 1], b[i + 2], lb);
      const dL = la[0] - lb[0], dC = Math.hypot(la[1] - lb[1], la[2] - lb[2]), de = Math.hypot(dL, dC);
      if (de >= 2.3) any++;
      if (de > peakDE) peakDE = de;
      if (de < 10) continue;
      n++; sumDE += de; sumDL += dL; sumC += dC; if (de >= 25) n25++; if (dL < -5) dark++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return { name, layer, any, seen: n, strong: n25, darker: dark, w: n ? x1 - x0 + 1 : 0, h: n ? y1 - y0 + 1 : 0,
      meanDE: r1(sumDE / (n || 1)), meanDL: r1(sumDL / (n || 1)), meanDC: r1(sumC / (n || 1)), peakDE: r1(peakDE),
      parts: g.vfx.add.count + g.vfx.alpha.count, ...cap.cost(), withURL, withoutURL };
  };
  // What the effects cost this frame, counted from the scene graph (a render's own counters also hold the shadow pass,
  // which runs on some frames and not others): one draw call per visible mesh, sprite or non-empty point cloud.
  cap.cost = () => {
    let fxCalls = 0, fxTris = 0;
    const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    g.vfx.root.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isSprite) || !vis(o)) return;
      const geo = o.geometry, n = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
      const dr = geo.drawRange, cnt = Math.max(0, Math.min(n - dr.start, dr.count));
      if (!cnt) return;
      fxCalls++; if (!o.isPoints) fxTris += Math.floor(cnt / 3);
    });
    return { fxCalls, fxTris };
  };
  const cc = document.createElement('canvas');
  cap.cropURL = (crop) => {
    if (!crop) return null;
    const [x, y, w, h] = crop; cc.width = w; cc.height = h;
    cc.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
    return cc.toDataURL('image/png');
  };
  cap.screen = (p) => { const v = p.clone().project(g.camera); return [Math.round((v.x + 1) / 2 * W), Math.round((1 - v.y) / 2 * Hh)]; };
  return { W, H: Hh };
};

async function openMatch(browser, heroId, { seed = 11 } = {}) {
  const page = await prepPage(browser, BASE, { width: 1920, height: 1080, dsf: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e?.message ?? e)));
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warn' || t === 'warning') errs.push(`${t}: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + '/Projects/throneshard/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!(window.game?.ui && document.querySelector('.btn-play')), { timeout: 240000, polling: 500 });
  await page.evaluate(({ heroId, seed }) => {
    const g = window.game;
    let a = seed * 2654435761;
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    g.startMatch({ heroId, team: 'sunward', difficulty: 'normal' });
    g.renderer.setAnimationLoop(null);
    g.renderEvery = 100000;
    g.fixedDt = 1 / 60;
  }, { heroId, seed });
  const dims = await page.evaluate(PAGE_LIB);
  await page.evaluate(() => { const c = window.__cap; c.step(0.2); c.setup(); c.step(3); });
  page.__errs2 = errs;
  return { page, dims, errs };
}
const savePNG = (file, url) => { if (url) fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); };

const hero = process.argv[2] || 'liora';
const only = (process.argv[3] || 'lane,river,grass').split(',');
const OUT = path.resolve(process.argv[4] || path.join(os.tmpdir(), 'throneshard-vfx')) + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const S = Math.SQRT1_2;
const GROUNDS = { lane: { x: -24, z: 24, d: { x: S, z: -S } }, river: { x: -20, z: -20, d: { x: S, z: S } }, grass: { x: -52, z: -8, d: { x: 1, z: 0 } } };
const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
const srv = await serve(PORT); const browser = await launch();
const rows = [];
async function measure(page, name, cropAt, layer = 'all') {
  const m = await page.evaluate(({ name, cropAt, layer }) => {
    const cap = window.__cap, h = cap.h;
    const d = cap.dir, c = h.position.clone(); c.y = (h.object?.position.y ?? 0) + 1.2; c.x += d.x * cropAt.ahead; c.z += d.z * cropAt.ahead;
    const [sx, sy] = cap.screen(c);
    const w = cropAt.w, hh = cropAt.h, x = Math.max(0, Math.min(1920 - w, sx - w / 2)), y = Math.max(0, Math.min(1080 - hh, sy - hh / 2));
    return cap.measure(name, [x | 0, y | 0, w, hh], layer);
  }, { name, cropAt, layer });
  savePNG(`${OUT}${name}_with.png`, m.withURL); savePNG(`${OUT}${name}_without.png`, m.withoutURL);
  delete m.withURL; delete m.withoutURL;
  rows.push(m);
  console.log(T(), name, `seen ${m.seen} px (box ${m.w}x${m.h}, strong ${m.strong}, darker ${m.darker}, any ${m.any}) dE mean ${m.meanDE} peak ${m.peakDE} dL ${m.meanDL} dC ${m.meanDC} | fx calls ${m.fxCalls} tris ${m.fxTris} parts ${m.parts}`);
}
const scene = (page, gname, night, noDummies) => page.evaluate(({ G, night, noDummies }) => {
  const cap = window.__cap;
  cap.SP = { x: G.x, z: G.z }; cap.dir = G.d; cap.nightMode = night; cap.noDummies = noDummies;
  cap.clearFx(); cap.reset(); cap.step(0.1); cap.clearFx(); cap.seed(31);
}, { G: GROUNDS[gname], night, noDummies });
try {
  const { page, errs } = await openMatch(browser, hero);
  console.log(T(), 'open');
  for (const gname of only) for (const night of [0, 1]) {
    const sfx = `${gname}_${night ? 'night' : 'day'}`;
    if (hero === 'liora') {
      // Piercing Gale, nothing in its way: the travelling arrow, spiral and wind lane alone, 0.2 s after release
      await scene(page, gname, night, true);
      await page.evaluate(() => { const cap = window.__cap, h = cap.h, ab = h.abilities.find((a) => a.def.id === 'liora_piercing_gale');
        cap.watch('ability:cast', (e) => e.hero === h && e.ability === ab);
        h.issueOrder({ type: 'cast', ability: ab, point: h.position.clone().add({ x: cap.dir.x * 20, y: 0, z: cap.dir.z * 20 }) }); cap.stepUntil(4); cap.step(0.2); });
      await measure(page, `gale_${sfx}`, { ahead: 9, w: 1100, h: 520 });
      await measure(page, `galespiral_${sfx}`, { ahead: 9, w: 1100, h: 520 }, 'spiral');
      // yardstick: Tether Shot's rope between two heroes
      await scene(page, gname, night, false);
      await page.evaluate(() => { const cap = window.__cap, h = cap.h, ab = h.abilities.find((a) => a.def.id === 'liora_tether_shot'), E = cap.dummies[0];
        const d = E.position.clone().sub(h.position).setY(0).normalize(); cap.place(cap.dummies[1], E.position.x + d.x * 4, E.position.z + d.z * 4);
        cap.watch('ability:cast', (e) => e.hero === h && e.ability === ab);
        h.issueOrder({ type: 'cast', ability: ab, target: E }); cap.stepUntil(4); cap.step(1.0); });
      await measure(page, `yard_tetherlink_${sfx}`, { ahead: 6, w: 1100, h: 520 });
    } else {
      const TYPES = (process.env.ONLY_TYPES || 'haste,double_damage,regeneration,arcane').split(',');
      for (const type of TYPES) {
        await scene(page, gname, night, true);
        await page.evaluate((type) => { const g = window.game, cap = window.__cap; cap.h.hp = cap.h.getStat('maxHp') * 0.4; g.runes.activate(cap.h, type); cap.step(1.8); }, type);
        await measure(page, `rune_${type}_${sfx}`, { ahead: 0, w: 520, h: 420 });
        if (type === 'haste') { // the one whose stream is meant to trail a running hero
          await page.evaluate(() => { const cap = window.__cap, h = cap.h; h.issueOrder({ type: 'move', point: h.position.clone().add({ x: cap.dir.x * 14, y: 0, z: cap.dir.z * 14 }) }); cap.step(0.6); });
          await measure(page, `rune_haste_run_${sfx}`, { ahead: 0, w: 520, h: 420 });
        }
        await page.evaluate(() => { const c = window.__cap; for (const m of [...c.h.modifiers]) if (m.rune) c.h.removeModifier(m); });
      }
      // yardstick: a lasting buff of Aldric's own, same hero, same spot, same wait
      if (process.env.ONLY_TYPES) continue;
      await scene(page, gname, night, true);
      await page.evaluate(() => { const cap = window.__cap, h = cap.h, ab = h.abilities.find((a) => a.def.id === 'aldric_titans_might');
        cap.watch('ability:cast', (e) => e.hero === h && e.ability === ab); h.issueOrder({ type: 'cast', ability: ab }); cap.stepUntil(4); cap.step(1.8); });
      await measure(page, `yard_titans_might_${sfx}`, { ahead: 0, w: 520, h: 420 });
    }
  }
  if (errs.length) console.log('errs', [...new Set(errs)].slice(0, 10));
  fs.writeFileSync(`${OUT}${hero}_${only.join('-')}${process.env.ONLY_TYPES ? '_' + process.env.ONLY_TYPES : ''}.json`, JSON.stringify(rows, null, 1));
} finally { await browser.close(); srv.close(); }
