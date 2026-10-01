// VFX capture harness: casts every hero ability (12 heroes x 4) and every item active in the REAL renderer from
// the gameplay camera and screenshots two frames per effect (mid-cast + near impact), plus per-effect pair sheets
// and an overall contact sheet.
//
//   node scripts/vfx_capture.mjs <url> [outDir=/tmp/vfx] [tag=shot] [filter]
//     filter: comma list of hero ids, ability ids, item ids, rune types, or the words "heroes" / "items" / "runes".
//
// Output: <outDir>/<tag>_<id>_a.png, _b.png (full 1280x720), <outDir>/pair_<tag>_<id>.png (cropped side by side),
//         <outDir>/<tag>_contact_<n>.png (grid of all pairs).
// The simulation is stepped deterministically (fixedDt = 1/60, animation loop stopped); AI directors are disabled,
// enemy bot heroes become held, disarmed dummies with huge HP in front of the hero.
import { chromium } from 'playwright';
import fs from 'fs';

const url = process.argv[2] || 'http://127.0.0.1:5173';
const outDir = process.argv[3] || '/tmp/vfx';
const tag = process.argv[4] || 'shot';
const filter = (process.argv[5] || '').split(',').filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });

const HEROES = ['brakka', 'kenshar', 'isolde', 'pell', 'sera', 'gorrow', 'vesna', 'aldric', 'morvane', 'sable', 'thalor', 'vashkar', 'ondur', 'liora'];
// mode: enemy | point | none | self (unit-target on self) | toggle | attack (passive proc on hero attacks)
//       attacked (dummy attacks hero) | idle (just stand) | kill (dummy creep dies next to hero)
// shots: seconds after the trigger (cast / first attack landed) for frame a and b.  pre: extra shot during cast point.
const ABIL = {
  brakka_taunting_roar: { mode: 'none', shots: [0.08, 0.35] },
  brakka_bloodfever: { mode: 'enemy', shots: [0.1, 0.8] },
  brakka_whirling_riposte: { mode: 'attacked', shots: [0.03, 0.15] },
  brakka_executioners_cleave: { mode: 'enemy', target: 'creep', lowHp: true, shots: [0.05, 0.3] },
  kenshar_steel_cyclone: { mode: 'none', shots: [0.3, 1.5] },
  kenshar_mending_totem: { mode: 'point', near: true, shots: [0.3, 1.5] },
  kenshar_keen_edge: { mode: 'attack', shots: [0.02, 0.15] },
  kenshar_thousand_cuts: { mode: 'enemy', shots: [0.25, 0.9] },
  isolde_rime_burst: { mode: 'point', shots: [0.08, 0.4] },
  isolde_ice_shackles: { mode: 'enemy', shots: [0.1, 0.8] },
  isolde_wellspring_aura: { mode: 'idle', shots: [0.1, 0.6] },
  isolde_blizzard_veil: { mode: 'none', shots: [0.8, 2.2] },
  pell_scattershot: { mode: 'point', shots: [0.6, 2.0] },
  pell_deadeye: { mode: 'attack', shots: [0.02, 0.15] },
  pell_steady_sights: { mode: 'attack', shots: [0.02, 0.2] },
  pell_final_round: { mode: 'enemy', pre: 1.0, shots: [0.2, 0.5] },
  sera_flame_wave: { mode: 'point', shots: [0.1, 0.3] },
  sera_pillar_of_flame: { mode: 'point', shots: [0.25, 0.62] },
  sera_kindled_heart: { mode: 'castOther', shots: [0.3, 0.8] },
  sera_sunlance: { mode: 'enemy', shots: [0.1, 0.33] },
  gorrow_gut_hook: { mode: 'point', shots: [0.2, 0.55] },
  gorrow_blight_cloud: { mode: 'toggle', shots: [0.5, 1.2] },
  gorrow_stitched_hide: { mode: 'kill', shots: [0.1, 0.5] },
  gorrow_devour: { mode: 'enemy', shots: [0.3, 1.5] },
  vesna_chill_arrows: { mode: 'toggleAttack', shots: [0.02, 0.4] },
  vesna_hush_wind: { mode: 'point', shots: [0.15, 0.4] },
  vesna_arrow_fan: { mode: 'point', shots: [0.3, 0.8] },
  vesna_hunters_eye: { mode: 'attack', shots: [0.02, 0.2] },
  aldric_thunder_gauntlet: { mode: 'enemy', shots: [0.1, 0.35] },
  aldric_wide_sweep: { mode: 'attack', shots: [0.02, 0.12] },
  aldric_rally_shout: { mode: 'none', shots: [0.08, 0.6] },
  aldric_titans_might: { mode: 'none', shots: [0.1, 0.8] },
  morvane_grave_frost: { mode: 'enemy', shots: [0.1, 0.4] },
  morvane_rime_armor: { mode: 'self', shots: [0.2, 1.1] },
  morvane_dread_stare: { mode: 'enemy', shots: [0.3, 1.0] },
  morvane_leaping_cold: { mode: 'enemy', shots: [0.3, 0.9] },
  sable_throwing_knife: { mode: 'enemy', shots: [0.1, 0.3] },
  sable_shadow_step: { mode: 'enemy', shots: [0.05, 0.3] },
  sable_haze: { mode: 'attacked', shots: [0.03, 0.3] },
  sable_killing_edge: { mode: 'attack', shots: [0.02, 0.15] },
  thalor_forked_spark: { mode: 'enemy', shots: [0.05, 0.3] },
  thalor_skybolt: { mode: 'enemy', shots: [0.05, 0.2] },
  thalor_storm_leap: { mode: 'none', shots: [0.15, 0.5] },
  thalor_heavens_verdict: { mode: 'none', shots: [0.05, 0.3] },
  vashkar_stone_spines: { mode: 'point', shots: [0.15, 0.5] },
  vashkar_toadcurse: { mode: 'enemy', shots: [0.05, 0.5] },
  vashkar_siphon_will: { mode: 'enemy', shots: [0.3, 1.0] },
  vashkar_death_mark: { mode: 'enemy', shots: [0.1, 0.33] },
  ondur_rift_wall: { mode: 'point', shots: [0.3, 0.9] },
  ondur_totem_swing: { mode: 'none', shots: [0.1, 0.5] },
  ondur_tremor: { mode: 'castOther', shots: [0.15, 0.5] },
  ondur_deep_quake: { mode: 'none', shots: [0.25, 0.7] },
  liora_tether_shot: { mode: 'enemy', behind: true, shots: [0.15, 1.0] },
  liora_piercing_gale: { mode: 'point', shots: [0.08, 0.2] },
  liora_tailwind: { mode: 'none', shots: [0.2, 1.0] },
  liora_arrow_storm: { mode: 'enemy', shots: [0.2, 0.8] },
};
const RUNES = ['haste', 'double_damage', 'regeneration', 'invisibility', 'arcane', 'illusion', 'bounty'];
const ITEMS = {
  homeward_scroll: { mode: 'tp', shots: [0.5, 2.6] }, wayfarer_boots: { mode: 'tp', shots: [0.5, 2.6] },
  bark_ration: { mode: 'none' }, healing_salve: { mode: 'none' }, clarity: { mode: 'none' }, honeyed_plum: { mode: 'none' },
  wisp_ember: { mode: 'none' }, bottle: { mode: 'none', charges: 3 }, resonant_reed: { mode: 'none', charges: 10 },
  resonant_wand: { mode: 'none', charges: 15 }, lookout_ward: { mode: 'point' }, seeker_ward: { mode: 'point' },
  ashveil_powder: { mode: 'none' }, glimmerdust: { mode: 'none' }, flicker_dagger: { mode: 'blink', shots: [0.03, 0.25] },
  shifting_treads: { mode: 'none' }, surge_boots: { mode: 'none' }, tidecall_boots: { mode: 'none' },
  gilded_gauntlet: { mode: 'creep' }, frenzy_mask: { mode: 'none' }, clockwork_mender: { mode: 'none' },
  keepers_greaves: { mode: 'none' }, thrust_staff: { mode: 'self', shots: [0.1, 0.35] }, shimmer_cloak: { mode: 'self', shots: [0.2, 0.8] },
  crimson_bulwark: { mode: 'none' }, whirlwind_scepter: { mode: 'enemy', shots: [0.3, 1.2] }, silencing_bloom: { mode: 'enemy' }, thornbloom: { mode: 'enemy' },
  morphing_scythe: { mode: 'enemy' }, renewal_orb: { mode: 'none' }, unbroken_standard: { mode: 'none' },
  frostguard_mail: { mode: 'none', shots: [0.3, 0.8] }, mirror_mantle: { mode: 'none' }, hungering_blade: { mode: 'none' },
  chasm_blade: { mode: 'enemy', shots: [0.05, 0.4] },
};
const want = (hero, id) => !filter.length || filter.includes(hero) || filter.includes(id) ||
  (filter.includes('heroes') && hero !== 'items') || (filter.includes('items') && hero === 'items');

const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errs = [];
const done = [];

// --------------------------------------------------------------------------------------------- page-side helpers
const PAGE_LIB = () => {
  const g = window.game;
  const cap = (window.__cap = {});
  cap.step = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) g.tick(); };
  cap.render = () => { if (g.composer) g.composer.render(0); else g.renderer.render(g.scene, g.camera); };
  cap.setup = () => {
    g.renderer.setAnimationLoop(null);
    g.fixedDt = 1 / 60;
    g.renderEvery = 100000; // render only when capturing
    if (g.ai) g.ai.update = () => {};
    for (const u of [...g.units]) if (!u.isStructure && u.kind !== 'hero') { u.alive = false; g.removeUnit(u); }
    const SP = { x: -6, z: 6 }; // mid-lane / river crossing, flat & open
    cap.SP = SP;
    const h = g.player.hero;
    cap.h = h;
    h.controller = null;
    h.addXp?.(1e6);
    for (let k = 0; k < 40; k++) for (let i = 0; i < 4; i++) h.levelAbility(i);
    h.baseStats.maxHp = 50000; h.baseStats.maxMana = 50000; h.hp = h.getStat('maxHp'); h.mana = h.getStat('maxMana');
    h.data._prd = new Proxy({}, { get: () => 1e6, set: () => true }); // force every PRD proc
    const enemies = g.heroes.filter((x) => x.team !== h.team);
    for (const x of g.heroes) if (x !== h) { x.controller = null; x.issueOrder({ type: 'hold' }); }
    cap.dummies = enemies.slice(0, 3);
    if (window.__enemyView) g.player.team = enemies[0].team; // judge indicators as the enemy team sees them
    for (const d of cap.dummies) { d.baseStats.maxHp = 1e6; d.hp = d.getStat('maxHp'); d.baseStats.magicResist = 0; }
    for (const u of g.units) if (u.isStructure) u.addModifier({ id: 'cap_disarm', hidden: true, disarm: true, duration: 1e9 });
    cap.reset();
  };
  cap.place = (u, x, z, facing) => {
    u.position.set(x, 0, z); u.path = [];
    if (facing !== undefined) u.facing = facing;
    u.object?.position.set(x, g.world?.getHeight?.(x, z) ?? 0, z);
  };
  cap.clearFx = () => { for (const f of g.vfx?.effects ?? []) f.dead = true; };
  cap.reset = () => {
    const h = cap.h, SP = cap.SP;
    for (const ab of h.abilities) {
      if (ab.channel) { try { ab.stopChannel?.(true); } catch {} }
      if (ab.toggled && ab.def.targetType === 'toggle') { try { ab.cast(); } catch {} }
      ab.cooldownRemaining = 0;
      if (ab.charges !== undefined) ab.charges = ab.def.charges?.max ?? ab.charges;
    }
    for (const u of [h, ...g.heroes]) for (const m of [...u.modifiers]) if (Number.isFinite(m.remaining)) u.removeModifier(m);
    if (!h.alive) h.respawn();
    h.issueOrder({ type: 'hold' });
    h.hp = h.getStat('maxHp'); h.mana = h.getStat('maxMana');
    h.data.airHeight = 0;
    cap.place(h, SP.x - 5, SP.z, Math.PI / 2);
    const offs = [[7, -1], [9.5, 2.5], [5.5, 3.5]];
    cap.dummies.forEach((d, i) => {
      if (!d.alive) d.respawn();
      d.hp = d.getStat('maxHp'); d.mana = d.getStat('maxMana');
      d.data.airHeight = 0;
      cap.place(d, SP.x - 5 + offs[i][0], SP.z + offs[i][1], -Math.PI / 2);
      d.issueOrder({ type: 'hold' });
      d.addModifier({ id: 'cap_disarm', hidden: true, disarm: true, duration: 1e9 });
    });
    for (const u of [...g.units]) if (u.data?.capTemp) { u.alive = false; g.removeUnit(u); }
    for (const x of g.heroes) if (x !== h && !cap.dummies.includes(x)) { const f = x.team === 'sunward' ? [-92, 92] : [92, -92]; cap.place(x, f[0], f[1]); }
    cap.focus();
  };
  cap.focus = () => { g.cameraCtl?.focus?.(cap.SP.x - 1, cap.SP.z + 1, true); if (g.cameraCtl) g.cameraCtl._shakes = []; };
  cap.spawnCreep = (x, z, hp = 400, team) => {
    const u = g.spawnUnit({ kind: 'creep', subtype: 'melee', team: team ?? cap.dummies[0].team, modelKind: 'creep_melee', position: new window.game.cameraCtl.target.constructor(x, 0, z), stats: { maxHp: hp, damageMin: 20, damageMax: 24, attackRange: 1.5 } });
    u.data.capTemp = true;
    u.facing = -Math.PI / 2;
    return u;
  };
  // Returns a promise-free trigger watcher: bus event sets cap.triggered.
  cap.watch = (evt, pred) => {
    cap.triggered = false;
    const off = g.bus.on(evt, (e) => { if (!cap.triggered && pred(e)) cap.triggered = true; });
    cap.offWatch = typeof off === 'function' ? off : () => g.bus.off?.(evt);
  };
  cap.stepUntil = (maxSec) => {
    for (let i = 0; i < maxSec * 60; i++) { g.tick(); if (cap.triggered) return true; }
    return false;
  };
};

async function newMatch(heroId) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${heroId}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', (e) => errs.push(`[${heroId}] pageerror: ${e.message}`));
  await p.goto(url);
  await p.waitForFunction(() => window.game && document.querySelector('.btn-play'), null, { timeout: 180000 });
  await p.evaluate((heroId) => window.game.startMatch({ heroId, team: 'sunward', difficulty: 'normal' }), heroId);
  await p.waitForFunction(() => window.game?.running, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  if (process.env.ENEMY_VIEW) await p.evaluate(() => { window.__enemyView = true; });
  await p.evaluate(PAGE_LIB);
  await p.evaluate(() => { window.__cap.setup(); window.__cap.step(3); });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__cap.step(0.5));
  return p;
}

async function snap(p, name) {
  await p.evaluate(() => { window.__cap.render(); });
  await p.screenshot({ path: `${outDir}/${name}.png` });
}

async function captureAbility(p, heroId, idx) {
  const id = await p.evaluate((i) => window.__cap.h.abilities[i].def.id, idx);
  if (!want(heroId, id)) return;
  const cfg = ABIL[id] ?? { mode: 'enemy' };
  const shots = cfg.shots ?? [0.1, 0.45];
  const res = await p.evaluate(({ idx, cfg }) => {
    const g = window.game, cap = window.__cap, h = cap.h;
    cap.reset();
    cap.step(0.05);
    const ab = h.abilities[idx];
    const E = cap.dummies[0];
    let target = E;
    if (cfg.target === 'creep' || cfg.mode === 'kill') {
      target = cap.spawnCreep(E.position.x - 2.5, E.position.z, cfg.lowHp ? 120 : 400);
      cap.step(0.05);
    }
    if (cfg.behind) { // second dummy on the far side of the target, on the line from the hero: the shot latches
      const d = target.position.clone().sub(h.position).setY(0).normalize();
      cap.place(cap.dummies[1], target.position.x + d.x * 4, target.position.z + d.z * 4);
    }
    const pt = cfg.near ? h.position.clone().add({ x: 3, y: 0, z: 1.5 }) : target.position.clone();
    cap.watch('ability:cast', (e) => e.hero === h && e.ability === ab);
    switch (cfg.mode) {
      case 'enemy': h.issueOrder({ type: 'cast', ability: ab, target }); break;
      case 'self': h.issueOrder({ type: 'cast', ability: ab, target: h }); break;
      case 'point': h.issueOrder({ type: 'cast', ability: ab, point: pt }); break;
      case 'none': h.issueOrder({ type: 'cast', ability: ab }); break;
      case 'toggle': ab.cast(); cap.triggered = true; break;
      case 'idle': cap.triggered = true; break;
      case 'castOther': {
        const other = h.abilities.find((a) => a !== ab && ['point', 'unit', 'none'].includes(a.def.targetType) && !a.def.ultimate);
        cap.watch('ability:cast', (e) => e.hero === h);
        h.issueOrder({ type: 'cast', ability: other, point: target.position.clone(), target: other.def.targetType === 'unit' ? target : undefined });
        break;
      }
      case 'attack': case 'toggleAttack': {
        if (cfg.mode === 'toggleAttack' && !ab.toggled) ab.cast();
        cap.watch('unit:attackLanded', (e) => e.unit === h);
        h.issueOrder({ type: 'attack', target });
        break;
      }
      case 'attacked': {
        const c = cap.spawnCreep(h.position.x + 2, h.position.z + 0.5, 5000);
        c.issueOrder({ type: 'attack', target: h });
        cap.watch('unit:attackLanded', (e) => e.unit === c);
        break;
      }
      case 'kill': {
        cap.triggered = true;
        cap.place(target, h.position.x + 2.5, h.position.z);
        target.takeDamage(1e7, 'pure', h, {});
        break;
      }
    }
    return { id: ab.def.id, castPoint: ab.def.castPoint ?? 0 };
  }, { idx, cfg });
  if (cfg.pre) {
    await p.evaluate((s) => window.__cap.step(s), cfg.pre);
    await snap(p, `${tag}_${id}_pre`);
  }
  const ok = await p.evaluate(() => window.__cap.stepUntil(6));
  if (!ok) console.log('  !! trigger not reached for', id);
  await p.evaluate((s) => window.__cap.step(s), shots[0]);
  await snap(p, `${tag}_${id}_a`);
  await p.evaluate((s) => window.__cap.step(s), shots[1] - shots[0]);
  await snap(p, `${tag}_${id}_b`);
  await p.evaluate(() => { const c = window.__cap; c.offWatch?.(); c.clearFx(); c.reset(); c.step(1.5); c.clearFx(); });
  done.push(id);
  console.log('  captured', id, ok ? '' : '(no trigger)');
}

async function captureItem(p, id) {
  if (!want('items', id)) return;
  const cfg = ITEMS[id] ?? { mode: 'none' };
  const shots = cfg.shots ?? [0.1, 0.5];
  const ok = await p.evaluate(({ id, cfg }) => {
    const g = window.game, cap = window.__cap, h = cap.h;
    cap.reset();
    const Ctor = (h.homeScroll ?? h.inventory.find(Boolean))?.constructor;
    for (let i = 0; i < 6; i++) h.inventory[i] = null;
    const def = g.items.getItemDef(id);
    if (!Ctor || !def) return 'no ctor/def';
    const it = new Ctor(g.items, def, h, cfg.charges);
    if (id === 'homeward_scroll') { h.homeScroll = it; it.charges = 3; } else h.inventory[0] = it;
    g.items.markDirty?.(h);
    cap.step(0.05);
    h.data.lastHeroDamageTime = -99;
    const slot = id === 'homeward_scroll' ? 'tp' : 0;
    const E = cap.dummies[0];
    let target = null;
    switch (cfg.mode) {
      case 'enemy': target = E; break;
      case 'self': target = h; break;
      case 'point': target = h.position.clone().add({ x: 4, y: 0, z: -1 }); break;
      case 'blink': target = h.position.clone().add({ x: 10, y: 0, z: -2 }); break;
      case 'creep': target = cap.spawnCreep(E.position.x - 2.5, E.position.z, 400); cap.step(0.05); break;
      case 'tp': { const t = g.units.filter((u) => u.kind === 'tower' && u.team === h.team).sort((a, b) => a.position.distanceTo(h.position) - b.position.distanceTo(h.position))[0]; target = t ? t.position.clone() : h.position.clone().add({ x: -30, y: 0, z: 30 }); break; }
    }
    cap.watch('item:used', (e) => e.hero === h);
    const r = g.items.use(h, slot, target);
    if (!r.ok) return 'use failed: ' + r.reason;
    return true;
  }, { id, cfg });
  if (ok !== true) { console.log('  !! item', id, ok); }
  await p.evaluate(() => window.__cap.stepUntil(3));
  await p.evaluate((s) => window.__cap.step(s), shots[0]);
  await snap(p, `${tag}_${id}_a`);
  await p.evaluate((s) => window.__cap.step(s), shots[1] - shots[0]);
  await snap(p, `${tag}_${id}_b`);
  await p.evaluate(() => { const c = window.__cap; c.offWatch?.(); c.clearFx(); c.reset(); c.step(1.2); c.clearFx(); });
  done.push(id);
  console.log('  captured item', id);
}

// Runes: spawn one at a spot beside the hero (frame a: pickup burst), let the hero walk onto it, and shoot the
// activation flourish (frame b) and the lasting aura (frame c).
async function captureRune(p, type) {
  const id = 'rune_' + type;
  if (!want('runes', id) && !want('runes', type)) return;
  await p.evaluate((type) => {
    const g = window.game, cap = window.__cap, h = cap.h;
    cap.reset(); cap.step(0.05);
    for (const m of [...h.modifiers]) if (m.rune) h.removeModifier(m);
    for (const r of [...g.runes.runes]) g.runes.remove(r);
    const spot = h.position.clone().add({ x: 3, y: 0, z: 1 });
    const rune = g.runes.spawn(type, spot, type === 'bounty' ? 'bounty' : 'power');
    rune.pos.copy(spot);
    rune.mesh.position.copy(spot);
    cap.rune = rune;
    cap.step(0.3);
    g.runes.pick(h, rune);
  }, type);
  await p.evaluate(() => window.__cap.step(0.12));
  await snap(p, `${tag}_${id}_a`);
  await p.evaluate(() => window.__cap.step(0.25));
  await snap(p, `${tag}_${id}_b`);
  await p.evaluate(() => window.__cap.step(1.2));
  await snap(p, `${tag}_${id}_c`);
  await p.evaluate(() => { const c = window.__cap; for (const m of [...c.h.modifiers]) if (m.rune) c.h.removeModifier(m); c.clearFx(); c.reset(); c.step(1.5); c.clearFx(); });
  done.push(id);
  console.log('  captured', id);
}

const t0 = Date.now();
const SHEETS_ONLY = !!process.env.SHEETS_ONLY; // rebuild sheets from existing shots in outDir
if (SHEETS_ONLY) for (const id of [...Object.keys(ABIL), ...Object.keys(ITEMS)]) if (fs.existsSync(`${outDir}/${tag}_${id}_a.png`) && want(id.startsWith('cm_') ? 'isolde' : 'x', id)) done.push(id);
for (const heroId of SHEETS_ONLY ? [] : HEROES) {
  if (filter.length && !filter.includes('heroes') && !filter.includes(heroId) && !Object.keys(ABIL).some((a) => filter.includes(a) && a.startsWith(heroId.split('_')[0]))) continue;
  console.log('hero', heroId);
  const p = await newMatch(heroId);
  for (let i = 0; i < 4; i++) {
    try { await captureAbility(p, heroId, i); } catch (e) { console.log('  capture error', heroId, i, e.message.slice(0, 300)); }
  }
  await p.close();
}
if (!SHEETS_ONLY && (!filter.length || filter.includes('runes') || RUNES.some((r) => filter.includes(r) || filter.includes('rune_' + r)))) {
  console.log('runes');
  const p = await newMatch('aldric');
  for (const type of RUNES) {
    try { await captureRune(p, type); } catch (e) { console.log('  rune error', type, e.message.slice(0, 300)); }
  }
  await p.close();
}
if (!SHEETS_ONLY && (!filter.length || filter.includes('items') || Object.keys(ITEMS).some((i) => filter.includes(i)))) {
  console.log('items');
  const p = await newMatch('aldric');
  for (const id of Object.keys(ITEMS)) {
    try { await captureItem(p, id); } catch (e) { console.log('  item error', id, e.message.slice(0, 300)); }
  }
  await p.close();
}

// --------------------------------------------------------------------------------------------- sheets
const CROP = { x: 200, y: 60, w: 880, h: 500 };
const sheetPage = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const imgData = (f) => (fs.existsSync(f) ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : '');
const cell = (id, w) => {
  const pre = fs.existsSync(`${outDir}/${tag}_${id}_pre.png`);
  const c3 = fs.existsSync(`${outDir}/${tag}_${id}_c.png`);
  const imgs = [...(pre ? ['pre'] : []), 'a', 'b', ...(c3 ? ['c'] : [])].map((s) => `<div style="width:${w}px;height:${Math.round(w * CROP.h / CROP.w)}px;overflow:hidden;position:relative;display:inline-block">
      <img src="${imgData(`${outDir}/${tag}_${id}_${s}.png`)}" style="position:absolute;left:${-CROP.x * w / CROP.w}px;top:${-CROP.y * w / CROP.w}px;width:${1280 * w / CROP.w}px"></div>`).join('');
  return `<div style="display:inline-block;margin:2px;background:#111;color:#eee;font:12px sans-serif"><div>${id}</div>${imgs}</div>`;
};
for (const id of done) {
  const pre = fs.existsSync(`${outDir}/${tag}_${id}_pre.png`);
  const n = pre || fs.existsSync(`${outDir}/${tag}_${id}_c.png`) ? 3 : 2;
  await sheetPage.setViewportSize({ width: n * 640 + 8, height: 385 });
  await sheetPage.setContent(`<body style="margin:0;background:#000">${cell(id, 640)}</body>`, { timeout: 120000 });
  await sheetPage.screenshot({ path: `${outDir}/pair_${tag}_${id}.png` });
}
const PER = 24;
for (let s = 0; s * PER < done.length; s++) {
  const ids = done.slice(s * PER, (s + 1) * PER);
  await sheetPage.setViewportSize({ width: 4 * (2 * 200 + 4) + 8, height: Math.ceil(ids.length / 4) * 135 + 8 });
  await sheetPage.setContent(`<body style="margin:0;background:#000">${ids.map((id) => cell(id, 200)).join('')}</body>`, { timeout: 180000 });
  await sheetPage.screenshot({ path: `${outDir}/${tag}_contact_${s + 1}.png`, fullPage: true });
}
await b.close();
const uniq = [...new Set(errs)];
console.log(`done ${done.length} effects in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 40).join('\n'));
