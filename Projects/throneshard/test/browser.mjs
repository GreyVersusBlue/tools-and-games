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
// The player's hero is Tobren, the newest, with Ormund drafted beside him, and
// Math.random is reseeded in the page at the moment the match starts, so the
// draft is the same on every run whatever order the assets loaded in. The
// match is not: nine runs of this file on one machine ended between 21.6 and
// 33.1 game minutes, so no check here may lean on an exact figure. The bots
// playing the two have to cast each one's three active abilities, and each
// one's passive has to reach somebody.
//
// After it, two more pages play the first ten minutes of a hard-against-hard
// match each (about a minute of wall clock a page) for the three rules that keep
// a hard laner alive, and the first then stages a Grimmaw attempt for the count of attempts really made.
// THRONESHARD_ONLY=hard runs those two alone.

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
const HERO = 'tobren';
const ONLY_HARD = process.env.THRONESHARD_ONLY === 'hard'; // skip the whole match and run the two ten-minute hard ones
const ALLY = 'ormund';
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

  if (booted && !ONLY_HARD) {
    console.log('\nstart');
    const start = await page.evaluate(({ heroId, allyId, seed }) => {
      const g = window.game;
      let a = seed * 2654435761;
      Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      g.startMatch({ heroId, allies: [allyId] });
      g.ai.setPlayerAutoplay?.(true);
      // Stepped from the first tick, so no frame of the page's own loop runs on the wall clock in between.
      g.renderer.setAnimationLoop(null);
      g.__render = g.renderer.render.bind(g.renderer);
      g.__composer = g.composer;
      g.renderer.render = () => {};
      g.composer = null;
      g.fixedDt = 0.05;
      // What the bots do with the two newest heroes: casts by ability, and what each kit hands out.
      const me = g.player.hero, ally = g.heroes.find((h) => h.team === me.team && h.heroId === allyId);
      const K = (window.__kit = { casts: {}, allyCasts: {}, told: 0, shoved: 0, counselled: 0, slowed: 0, disarmed: 0, shared: 0 });
      g.bus.on('ability:cast', ({ hero, ability }) => {
        if (ability?.isItem || (hero !== me && hero !== ally)) return;
        const c = hero === me ? K.casts : K.allyCasts;
        c[ability.def.id] = (c[ability.def.id] ?? 0) + 1;
      });
      g.bus.on('modifier:added', ({ unit, modifier }) => {
        // The shove's own modifier names no source, so it is counted on the heroes and creeps of the other team.
        if (modifier.id === 'beat_the_brush' && unit.team !== me.team) K.shoved++;
        if (modifier.source === me) {
          if (modifier.id === 'twice_told') K.told++;
          if (modifier.id === 'good_counsel' && unit !== me) K.counselled++;
        }
        if (modifier.source === ally) {
          if (modifier.id === 'no_free_passage') K.slowed++;
          if (modifier.id === 'confiscated') K.disarmed++;
          if (modifier.id === 'stand_surety') K.shared++;
        }
      });
      const kit = (h) => h?.abilities.map((ab) => ab.def.id);
      return { heroes: g.heroes.length, player: me?.heroId, name: me?.name, model: me?.modelKind, abilities: kit(me), ally: ally?.heroId, allyModel: ally?.modelKind, allyAbilities: kit(ally), team: g.heroes.filter((h) => h.team === me.team).map((h) => h.heroId) };
    }, { heroId: HERO, allyId: ALLY, seed: SEED });
    ok(start.heroes === 10, 'ten heroes take the field', `got ${start.heroes}`);
    ok(start.player === HERO, `the player is ${HERO}`, `got ${start.player} (${start.name})`);
    ok(start.model === 'bone_shaman' && start.abilities?.length === 4, 'he wears the model bone_shaman and has four abilities', `${start.model}; ${start.abilities}`);
    ok(start.ally === ALLY && start.allyModel === 'rift_stalker' && start.allyAbilities?.length === 4, `${ALLY} is on his team, on the model rift_stalker, with four abilities`, `${start.ally}; ${start.allyModel}`);
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
    const after = await page.evaluate((allyId) => {
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
        ...((line) => ({ me: line(g.player.hero), ally: line(g.heroes.find((h) => h.team === g.player.hero.team && h.heroId === allyId)) }))((h) => ({ level: h.level, kda: `${h.kills}/${h.deaths}/${h.assists}`, lh: h.lastHits, learned: h.abilities.map((ab) => ab.level), talents: Object.keys(h.talents).length, renewed: h.abilities[3].data.renewed ?? 0 })),
      };
    }, ALLY);
    ok(after.endShown, 'the victory/defeat screen is shown');
    ok(/Victory|Defeat/.test(after.endText), 'the end screen says Victory or Defeat');
    ok(after.kills > 0, 'heroes died along the way', `${after.kills} kills`);
    ok(Math.min(...after.levels) >= 6, 'every hero reached level 6', `levels ${after.levels.join(',')}`);
    ok(Math.min(...after.items) >= 3, 'every hero holds at least three items', `items ${after.items.join(',')}`);
    const k = after.kit ?? {};
    for (const [id, h] of [[HERO, after.me], [ALLY, after.ally]]) console.log(`        ${id}: level ${h.level}, ${h.kda}, ${h.lh} last hits, abilities ${h.learned.join('/')}, ${h.talents} talents`);
    {
      const [told, brush, counsel, again] = start.abilities ?? [], c = k.casts ?? {};
      ok(after.me.learned.every((n) => n > 0), `the bot learned all four of ${HERO}'s abilities`, after.me.learned.join('/'));
      ok(c[told] > 0 && k.told > 0, 'the bot cast Twice Told and a hero carried it', `${c[told] ?? 0} casts, ${k.told} heroes told`);
      ok(c[brush] > 0 && k.shoved > 0, 'the bot cast Beat the Brush and an enemy was shoved toward an ally', `${c[brush] ?? 0} casts, ${k.shoved} shoves`);
      ok(k.counselled > 0 && !(counsel in c), 'Good Counsel reached an allied hero without being cast', `${k.counselled} times`);
      ok(c[again] > 0 && after.me.renewed > 0, 'the bot cast Throw Again and it handed abilities back', `${c[again] ?? 0} casts, ${after.me.renewed} abilities`);
    }
    {
      const [surety, confiscate, passage, account] = start.allyAbilities ?? [], c = k.allyCasts ?? {};
      ok(after.ally.learned.every((n) => n > 0), `the bot learned all four of ${ALLY}'s abilities`, after.ally.learned.join('/'));
      ok(c[confiscate] > 0 && k.disarmed > 0, 'the bot cast Confiscate and it disarmed somebody', `${c[confiscate] ?? 0} casts, ${k.disarmed} disarms`);
      ok(c[surety] > 0 && k.shared === c[surety], 'the bot cast Stand Surety and every cast bonded an ally', `${c[surety] ?? 0} casts, ${k.shared} bonds`);
      ok(k.slowed > 0 && !(passage in c), 'No Free Passage slowed somebody without being cast', `${k.slowed} slows`);
      ok(c[account] > 0, 'the bot cast Called to Account', `${c[account] ?? 0} casts`);
    }
    await page.evaluate(() => window.game.renderer.render(window.game.scene, window.game.camera));
    await page.screenshot({ path: path.join(OUT, '2-end.png') });
  }

  console.log('\nconsole');
  ok(problems.length === 0, 'no page errors, console errors or warnings', problems.slice(0, 5).join(' | '));
  await page.close();

  // Hard against hard, the first ten minutes, two seeded matches on the two line-ups tools/scripts/lh_test.mjs
  // uses. A hard bot may follow a fight under an enemy tower only on the terms its own tower rule lets it stay
  // there on (diveOk); when the fight rule waved every engage through, a bot walked in, was turned out on its next
  // think and walked in again, and hard melee laners took 14.9 last hits in ten minutes where normal's took 18.6.
  // tryFight is wrapped, not rewritten: the count is of what it decided, judged by the tower rule's own diveOk.
  // And a laner the enemy heroes in sight out-fight (laneStandoff() above 0) is sent to stand that far behind the
  // creep clash, not at it: at the clash a lone melee core in a lane against two ranged heroes died 5.7 times in
  // ten minutes. doLane is wrapped the same way, and the place it sent the hero is read from its own debug line.
  // And a laner standing alone against enemy heroes who would commit on it (laneYield(), kept by think() as `yielding`) is sent to wait at its own
  // front tower and takes no creep outside that tower's reach: left at the clash, the melee core of a lane against
  // two ranged heroes died 3.1 times in ten minutes, its partner dead, going home or not back in 60 of 75 deaths.
  // doLane's destination is read from its debug line again, and tryLastHit is wrapped for the creep it picks.
  // Last hits are printed and not checked, because one seed's mean runs from 9 to 21.
  for (const [seed, lu] of [
    [1, { heroId: 'kenshar', allies: ['brakka', 'aldric', 'isolde', 'vashkar'], enemies: ['sable', 'gorrow', 'pell', 'morvane', 'thalor'] }],
    [2, { heroId: 'sable', allies: ['gorrow', 'kenshar', 'morvane', 'thalor'], enemies: ['brakka', 'aldric', 'vesna', 'sera', 'isolde'] }],
  ]) {
    console.log(`\nhard against hard, seed ${seed}`);
    const hp = await prepPage(browser, BASE, { width: 640, height: 360, dsf: 1 });
    const hardProblems = [];
    hp.on('pageerror', (e) => hardProblems.push('pageerror: ' + (e?.message ?? e)));
    await hp.goto(BASE + PAGE_URL, { waitUntil: 'load', timeout: 60000 });
    await waitFor(hp, () => !!(window.game?.ui && document.querySelector('.btn-play')), { timeout: 180000 });
    await hp.evaluate(async ({ seed, lu }) => {
      const g = window.game;
      const { BotBrain } = await import('./src/ai/BotBrain.js');
      const T = (window.__dive = { chances: 0, under: 0, unsanctioned: 0, turnedOut: 0, thinks: 0, stoodOff: 0, tooClose: 0, worst: 0, yielded: 0, tooFar: 0, farthest: 0, picked: 0, strayed: 0 });
      const tryFight = BotBrain.prototype.tryFight, towerDanger = BotBrain.prototype.handleTowerDanger, doLane = BotBrain.prototype.doLane, tryLastHit = BotBrain.prototype.tryLastHit;
      BotBrain.prototype.doLane = function (lane) {
        doLane.call(this, lane);
        const y = /^(?:lane|yield) \S+ s=(-?\d+)$/.exec(this.debug ?? ''), tower = this.d.structures.frontTower(this.team, lane);
        if (y && tower && this.yielding) { // the flag think() set from laneYield() before it came here
          const past = +y[1] - this.laneFront(lane).path.project(tower.position.x, tower.position.z).s; // the debug line rounds s
          T.yielded++;
          if (past > 3.51) { T.tooFar++; T.farthest = Math.max(T.farthest, past); }
        }
        const m = /^lane \S+ s=(-?\d+)$/.exec(this.debug ?? ''), off = this.laneStandoff();
        if (!m || !(off > 0)) return;
        const f = this.laneFront(lane);
        if (!(f.myN > 0)) return;
        const clash = f.enN > 0 ? Math.min(f.my, f.en) : f.my, short = +m[1] - (clash - off); // the debug line rounds s
        T.stoodOff++;
        if (short > 0.51) { T.tooClose++; T.worst = Math.max(T.worst, short); }
      };
      BotBrain.prototype.tryLastHit = function () {
        const was = this.lhTarget, r = tryLastHit.call(this), c = this.lhTarget; // a hit already on its way when the yield began is let finish
        if (r && c && c !== was && c.team !== this.team && this.yielding) {
          T.picked++;
          if (!this.ctx.allyTowers.some((t) => t.alive && t.distanceTo(c.position) < t.getStat('attackRange'))) T.strayed++;
        }
        return r;
      };
      BotBrain.prototype.tryFight = function () {
        const modeWas = this.mode; // tryFight sets it to 'fight', and diveOk's push clause reads it
        const r = tryFight.call(this);
        const over = (u) => this.ctx.enemyTowers.filter((t) => t.alive && t.subtype !== 'fountain' && t.distanceTo(u.position) < t.getStat('attackRange') + 2);
        T.thinks++;
        if (this.ctx.enemyHeroes.some((e) => over(e).length)) T.chances++;
        const ft = this.fightTarget, towers = ft ? over(ft) : [];
        if (towers.length) {
          const modeNow = this.mode;
          this.mode = modeWas;
          T.under++; if (!towers.every((t) => this.diveOk(t, ft))) T.unsanctioned++;
          this.mode = modeNow;
        }
        return r;
      };
      BotBrain.prototype.handleTowerDanger = function () { const r = towerDanger.call(this); if (r) T.turnedOut++; return r; };
      let a = seed * 7919;
      Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      g.startMatch({ ...lu, difficulty: 'hard' });
      g.ai.setPlayerAutoplay?.(true);
      g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
    }, { seed, lu });
    let hard = null;
    for (let done = 0; done < 12000; done += 2400) {
      hard = await hp.evaluate((n) => {
        const g = window.game;
        for (let i = 0; i < n; i++) g.tick();
        const melee = g.heroes.filter((h) => h.isMelee);
        return { ...window.__dive, minutes: g.time / 60, lh: melee.map((h) => h.lastHits), deaths: g.heroes.reduce((s, h) => s + h.deaths, 0) };
      }, 2400);
    }
    const share = (100 * hard.turnedOut / Math.max(1, hard.thinks + hard.turnedOut)).toFixed(1);
    console.log(`        ${hard.minutes.toFixed(1)} min: melee last hits ${hard.lh.join(' ')} (mean ${(hard.lh.reduce((x, y) => x + y, 0) / hard.lh.length).toFixed(1)}), ${hard.deaths} deaths, turned out of tower range on ${hard.turnedOut} thinks (${share}%)`);
    ok(hard.chances > 0, 'an enemy hero stood under its own tower in a hard bot\'s sight', `${hard.chances} of ${hard.thinks} thinks`);
    ok(hard.unsanctioned === 0, 'no hard bot fought a hero under an enemy tower that its tower rule would turn it out for', `${hard.unsanctioned} thinks of ${hard.under} under a tower`);
    ok(hard.stoodOff > 0, 'a laner was out-fought by the enemy heroes in its lane', `${hard.stoodOff} thinks`);
    ok(hard.tooClose === 0, 'and was sent to stand off from the clash by the full distance every time', `${hard.tooClose} thinks short, by up to ${hard.worst.toFixed(1)} units`);
    ok(hard.yielded > 0, 'a laner stood alone against enemy heroes who would commit on it', `${hard.yielded} thinks`);
    ok(hard.tooFar === 0, 'and was sent to wait at its own front tower every time', `${hard.tooFar} thinks past it, by up to ${hard.farthest.toFixed(1)} units`);
    ok(hard.strayed === 0, 'and went for no creep outside that tower\'s reach', `${hard.strayed} of ${hard.picked} creeps picked while alone`);
    if (seed === 1) {
      // A staged Grimmaw attempt on the same page, after its ten minutes, for the count of attempts really made
      // (stats.grimmawEngaged). Duskward's plan is set to take him and he is put at 90% health: with the five at their
      // fountain that is a plan and not an attempt, and with them stood at the pit it is one attempt, counted once.
      console.log('\nGrimmaw attempts, staged');
      const st = await hp.evaluate(async () => {
        const g = window.game, ai = g.ai, nav = g.world.nav;
        const { FOUNTAIN } = await import('./src/core/constants.js');
        const grim = ai.neutrals.grimmaw, pit = grim.position, dusk = g.heroes.filter((h) => h.team === 'duskward');
        const put = (h, x, z) => {
          if (!h.alive) { h.respawnTimer = 0; h.respawn(); }
          const p = nav.nearestWalkable(x, z, 12);
          h.position.set(p.x, 0, p.z); h.issueOrder({ type: 'stop' });
          h.hp = h.getStat('maxHp');
        };
        const run = (seconds, plan) => { for (let n = 0; n < seconds * 20; n++) { ai.teams.duskward.plan = plan; grim.hp = grim.getStat('maxHp') * 0.9; g.tick(); } };
        const count = () => ai.stats.grimmawEngaged ?? 0, c0 = count();
        dusk.forEach((h, i) => put(h, FOUNTAIN.duskward[0] + (i - 2) * 2, FOUNTAIN.duskward[1] + 3));
        run(3, { type: 'grimmaw', since: g.time, count: 5 });
        const far = { counted: count() - c0, nearest: Math.min(...dusk.map((h) => h.distanceTo(pit))) };
        dusk.forEach((h, i) => put(h, pit.x + Math.cos(i * 1.257) * 5, pit.z + Math.sin(i * 1.257) * 5));
        run(5, { type: 'grimmaw', since: g.time, count: 5 });
        return { far, counted: count() - c0 - far.counted, there: dusk.filter((h) => h.alive && h.distanceTo(pit) < 16).length };
      });
      ok(st.far.counted === 0 && st.far.nearest > 16, 'a plan to take Grimmaw with nobody at the pit is not counted as an attempt', `${st.far.counted} counted, nearest hero ${st.far.nearest.toFixed(0)} units off`);
      ok(st.counted === 1 && st.there > 0, 'with the team at the pit and Grimmaw hurt it is counted, once', `${st.counted} counted over 5 s, ${st.there} heroes at the pit`);
    }
    ok(hardProblems.length === 0, 'no page errors', hardProblems.slice(0, 3).join(' | '));
    await hp.close();
  }
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
