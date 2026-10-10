// browser.mjs — Throneshard boots, plays a whole bot match, and ends it.
//
//   node Projects/throneshard/test/browser.mjs
//
// Exits non-zero on any failed check (#13). Screenshots in ./shots/.
//
// Borrows Tools/board-check's harness, as Orbital's suite does. The page runs
// under the harness's headless Chromium, which on Linux is software-rendered,
// so nothing here is timed (#53): the match is stepped with `game.fixedDt`
// and `game.tick()` from a stopped animation loop, with the renderer's draw
// calls stubbed out, and the checks are about what happened in game time.
//
// The player's hero is put on autoplay, so all ten heroes are bots. A match
// that has not ended by 70 game minutes is a failure: bot matches here end
// between roughly 25 and 50.
//
// The player's hero is Ormund, the newest, and Math.random is reseeded in the
// page at the moment the match starts, so the draft is the same on every run
// whatever order the assets loaded in. The match is not: nine runs of this
// file on one machine ended between 21.6 and 33.1 game minutes, so no check
// here may lean on an exact figure. The bot playing him has to cast his three
// active abilities and his passive has to slow somebody.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { waitFor } from '../../../Tools/board-check/drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const PORT = 8171; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = '/Projects/throneshard/';
const HERO = 'ormund';
const SEED = 7;
const CAP_MINUTES = 70;

fs.mkdirSync(OUT, { recursive: true });

let checks = 0, failures = 0;
function ok(cond, label, detail = '') {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
}

const srv = await serve(PORT);
const browser = await launch();
const problems = [];
try {
  const page = await prepPage(browser, BASE, { width: 1280, height: 720, dsf: 1 });
  page.on('pageerror', (e) => problems.push('pageerror: ' + (e?.message ?? e)));
  page.on('console', (m) => {
    const type = typeof m.type === 'function' ? m.type() : m.type;
    if (type === 'error' || type === 'warn' || type === 'warning') problems.push(`${type}: ${m.text()}`);
  });
  await page.goto(BASE + PAGE_URL, { waitUntil: 'load', timeout: 60000 });

  console.log('\nboot');
  let booted = true;
  try {
    await waitFor(page, () => !!(window.game?.ui && document.querySelector('.btn-play')), { timeout: 180000 });
  } catch { booted = false; }
  ok(booted, 'the loading screen gives way to the main menu');
  const title = await page.title();
  ok(title === 'Throneshard', 'the page is titled Throneshard', JSON.stringify(title));
  await page.screenshot({ path: path.join(OUT, '1-menu.png') });

  if (booted) {
    console.log('\nstart');
    const start = await page.evaluate(({ heroId, seed }) => {
      const g = window.game;
      let a = seed * 2654435761;
      Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      g.startMatch({ heroId });
      g.ai.setPlayerAutoplay?.(true);
      // Stepped from the first tick, so no frame of the page's own loop runs on the wall clock in between.
      g.renderer.setAnimationLoop(null);
      g.__render = g.renderer.render.bind(g.renderer);
      g.__composer = g.composer;
      g.renderer.render = () => {};
      g.composer = null;
      g.fixedDt = 0.05;
      // What the bot does with the player's hero: casts by ability, and the two debuffs his kit hands out.
      const me = g.player.hero, K = (window.__kit = { casts: {}, slowed: 0, disarmed: 0, shared: 0 });
      g.bus.on('ability:cast', ({ hero, ability }) => { if (hero === me && !ability?.isItem) K.casts[ability.def.id] = (K.casts[ability.def.id] ?? 0) + 1; });
      g.bus.on('modifier:added', ({ modifier }) => {
        if (modifier.source !== me) return;
        if (modifier.id === 'no_free_passage') K.slowed++;
        if (modifier.id === 'confiscated') K.disarmed++;
        if (modifier.id === 'stand_surety') K.shared++;
      });
      return { heroes: g.heroes.length, player: me?.heroId, name: me?.name, model: me?.modelKind, abilities: me?.abilities.map((ab) => ab.def.id), team: g.heroes.filter((h) => h.team === me.team).map((h) => h.heroId) };
    }, { heroId: HERO, seed: SEED });
    ok(start.heroes === 10, 'ten heroes take the field', `got ${start.heroes}`);
    ok(start.player === HERO, `the player is ${HERO}`, `got ${start.player} (${start.name})`);
    ok(start.model === 'rift_stalker' && start.abilities?.length === 4, 'he wears the model rift_stalker and has four abilities', `${start.model}; ${start.abilities}`);
    console.log(`        with ${start.team?.slice(1).join(', ')}`);

    // Rift Wall in the real match, on the real map, before the lanes meet (test/wall.mjs has the open-map cases).
    // A slow enemy creep is sent straight across the line of a wall cast through Ondur's own ability definition.
    console.log('\nrift wall');
    const wall = await page.evaluate(async () => {
      const g = window.game, w = g.world, nav = w.nav;
      const { RIFT_WALL: T, riftWallSlabs } = await import('./src/gameplay/abilities/riftWall.js');
      const def = g.abilities.getAbilityDef('ondur_rift_wall');
      const len = def.values.length, V = (x, z) => g.player.hero.position.clone().set(x, 0, z);
      // First stretch of open ground among these: a start point, a direction, and a walker 5 units to either side of the middle.
      const spots = [];
      for (const [x, z] of [[-12, 12], [-30, 30], [10, -10], [-20, 0], [0, 20], [-40, 20], [20, -40]]) for (const a of [-Math.PI / 4, 0, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4]) spots.push({ x, z, dx: Math.cos(a), dz: Math.sin(a) });
      const spot = spots.find((s) => {
        const mx = s.x + s.dx * (1 + len / 2), mz = s.z + s.dz * (1 + len / 2);
        s.a = { x: mx + s.dz * 5, z: mz - s.dx * 5 }; s.b = { x: mx - s.dz * 5, z: mz + s.dx * 5 };
        s.slabs = riftWallSlabs({ x: s.x + s.dx, z: s.z + s.dz }, { x: s.dx, z: s.dz }, len);
        return w.isWalkable(s.x, s.z) && s.slabs.every((b) => w.isWalkable(b.x, b.z)) && nav.los(s.a.x, s.a.z, s.b.x, s.b.z);
      });
      if (!spot) return { spot: null };
      const before = nav.dyn.slice();
      const caster = g.spawnUnit({ kind: 'creep', team: 'sunward', position: V(spot.x, spot.z), immobile: true, stats: { attackRange: 0, damageMin: 0, damageMax: 0, maxHp: 9000 } });
      const walker = g.spawnUnit({ kind: 'creep', team: 'duskward', position: V(spot.a.x, spot.a.z), stats: { moveSpeed: 3.5, maxHp: 9000 } });
      walker.issueOrder({ type: 'move', point: V(spot.b.x, spot.b.z) });
      const ab = { hero: caster, game: g, level: 1, def, v: (k) => (Array.isArray(def.values[k]) ? def.values[k][0] : def.values[k]), getRadius: () => def.radius };
      const t0 = g.time;
      def.cast(ab, V(spot.x + spot.dx * 10, spot.z + spot.dz * 10));
      const side = (u) => (u.position.x - spot.x) * spot.dz - (u.position.z - spot.z) * spot.dx;
      const s0 = Math.sign(side(walker)), gone = spot.slabs[spot.slabs.length - 1].t1;
      const r = { spot: [spot.x, spot.z, +spot.dx.toFixed(2), +spot.dz.toFixed(2)], gone, crossedAt: null, arrivedAt: null, off: 0, blockedMid: false, hp: walker.hp };
      for (let n = 0; n < 400 && r.arrivedAt === null; n++) {
        g.tick();
        const t = g.time - t0;
        if (Math.abs(t - gone / 2) < 0.03) r.blockedMid = spot.slabs.every((b) => !w.isWalkable(b.circles[0].x, b.circles[0].z));
        if (!w.isWalkable(walker.position.x, walker.position.z)) r.off++;
        if (r.crossedAt === null && Math.sign(side(walker)) === -s0) { r.crossedAt = t; r.along = (walker.position.x - spot.x) * spot.dx + (walker.position.z - spot.z) * spot.dz; }
        if (walker.order.type === 'idle') r.arrivedAt = t;
      }
      r.miss = Math.hypot(walker.position.x - spot.b.x, walker.position.z - spot.b.z);
      r.restored = nav.dyn.every((v, i) => v === before[i]);
      r.len = len; r.lead = T.lead;
      g.removeUnit(walker); g.removeUnit(caster);
      return r;
    });
    ok(!!wall.spot, 'there is open ground on the map for a full-length wall', JSON.stringify(wall.spot));
    if (wall.spot) {
      ok(wall.blockedMid, 'halfway through its life every slab blocks the map\'s nav grid');
      ok(wall.off === 0, 'the creep sent across it never stands in a blocked cell', `${wall.off} ticks`);
      ok(wall.crossedAt !== null && wall.crossedAt >= wall.gone, 'the creep does not cross while the wall stands', `crossed at ${wall.crossedAt?.toFixed(2)} s, wall gone at ${wall.gone.toFixed(2)} s`);
      ok(wall.along > 1 + wall.lead && wall.along < wall.len, 'it crosses where the wall stood, not round an end', `${wall.along?.toFixed(1)} units along a ${wall.len}-unit wall`);
      ok(wall.arrivedAt !== null && wall.miss <= 0.5, 'and reaches the point it was sent to', `${wall.arrivedAt?.toFixed(2)} s, ${wall.miss.toFixed(2)} units off`);
      ok(wall.restored, 'every nav cell the wall blocked is released');
    }

    // Step in chunks so one evaluate never runs long enough to trip a protocol timeout.
    console.log('\nmatch');
    let state = { time: 0, over: false };
    const capTicks = CAP_MINUTES * 60 * 20;
    for (let done = 0; done < capTicks && !state.over; done += 2400) {
      state = await page.evaluate((n) => {
        const g = window.game;
        for (let i = 0; i < n && !g.matchOver; i++) g.tick();
        return { time: g.time, over: g.matchOver, winner: g.winner, units: g.units.filter((u) => u.alive).length };
      }, 2400);
      if (done % 12000 === 0) console.log(`        ${(state.time / 60).toFixed(1)} min, ${state.units} units alive`);
    }
    const minutes = state.time / 60;
    ok(state.over, `the match ends inside ${CAP_MINUTES} game minutes`, `${minutes.toFixed(1)} min`);
    ok(state.winner === 'sunward' || state.winner === 'duskward', 'one team wins', String(state.winner));
    ok(minutes >= 15, 'the match lasts at least 15 game minutes', `${minutes.toFixed(1)} min`);

    // UI.js puts the end screen up 2.5 s of wall clock after match:end (a setTimeout,
    // not game time), so this waits on the DOM rather than ticking.
    let endAppeared = true;
    try { await waitFor(page, () => !!document.querySelector('.scr-end'), { timeout: 20000 }); }
    catch { endAppeared = false; }
    ok(endAppeared, 'the end screen appears within 20 s of the match ending');
    const after = await page.evaluate(() => {
      const g = window.game;
      g.renderer.render = g.__render;
      g.composer = g.__composer;
      const sc = g.rules?.score ?? {};
      const end = document.querySelector('.scr-end');
      return {
        endShown: !!end,
        endText: end?.textContent ?? '',
        kills: (sc.sunward ?? 0) + (sc.duskward ?? 0),
        levels: g.heroes.map((h) => h.level),
        items: g.heroes.map((h) => h.inventory.filter(Boolean).length),
        kit: window.__kit,
        minutes: +(g.time / 60).toFixed(2),
        me: ((h) => ({ level: h.level, kda: `${h.kills}/${h.deaths}/${h.assists}`, lh: h.lastHits, learned: h.abilities.map((ab) => ab.level), talents: Object.keys(h.talents).length }))(g.player.hero),
      };
    });
    ok(after.endShown, 'the victory/defeat screen is shown');
    ok(/Victory|Defeat/.test(after.endText), 'the end screen says Victory or Defeat');
    ok(after.kills > 0, 'heroes died along the way', `${after.kills} kills`);
    ok(Math.min(...after.levels) >= 6, 'every hero reached level 6', `levels ${after.levels.join(',')}`);
    ok(Math.min(...after.items) >= 3, 'every hero holds at least three items', `items ${after.items.join(',')}`);
    const [w, q, e, r] = start.abilities ?? [], c = after.kit?.casts ?? {};
    console.log(`        ${HERO}: level ${after.me.level}, ${after.me.kda}, ${after.me.lh} last hits, abilities ${after.me.learned.join('/')}, ${after.me.talents} talents`);
    ok(after.me.learned.every((n) => n > 0), 'the bot learned all four of his abilities', after.me.learned.join('/'));
    ok(c[q] > 0 && after.kit.disarmed > 0, 'the bot cast Confiscate and it disarmed somebody', `${c[q] ?? 0} casts, ${after.kit?.disarmed} disarms`);
    ok(c[w] > 0 && after.kit.shared === c[w], 'the bot cast Stand Surety and every cast bonded an ally', `${c[w] ?? 0} casts, ${after.kit?.shared} bonds`);
    ok(after.kit?.slowed > 0 && !(e in c), 'No Free Passage slowed somebody without being cast', `${after.kit?.slowed} slows`);
    ok(c[r] > 0, 'the bot cast Called to Account', `${c[r] ?? 0} casts`);
    await page.evaluate(() => window.game.renderer.render(window.game.scene, window.game.camera));
    await page.screenshot({ path: path.join(OUT, '2-end.png') });
  }

  console.log('\nconsole');
  ok(problems.length === 0, 'no page errors, console errors or warnings', problems.slice(0, 5).join(' | '));
  await page.close();
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
