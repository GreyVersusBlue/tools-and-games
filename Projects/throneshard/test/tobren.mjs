// tobren.mjs — Tobren's four abilities, checked without a browser. Run through data.mjs:
//
//   node Projects/throneshard/test/data.mjs
//
// The heroes, the units, the ability system, the talents, the nav grid and the event bus are the game's own modules.
// What is written here is the stage they stand on, as in ormund.mjs and wall.mjs: an open 200 by 200 map and a tick
// in the order Game.tick runs it (timers, unit updates, ability tasks, separation, projectiles), at the fixed 0.05 s
// step. Nobody on the stage picks a fight on its own (acquire range below zero), so every hit point lost is one a
// check dealt. An attack's damage is rolled with Math.random, so no check here names an attack's size: each reads
// what the first strike dealt and asks for the share of it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DT = 0.05;
const CHARS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets/models/chars');
// The JSON chunk of a binary glTF file: 12 bytes of header, then the chunk's length, its type and its text.
const gltf = (name) => { const b = fs.readFileSync(path.join(CHARS, name)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); };

export async function tobrenChecks({ ok, load }) {
  const THREE = await import('three');
  const { NavGrid } = await load('src/world/NavGrid.js');
  const { Unit } = await load('src/core/Unit.js');
  const { Hero } = await load('src/core/Hero.js');
  const { EventBus } = await load('src/core/EventBus.js');
  const { Projectiles } = await load('src/core/Projectiles.js');
  const { du } = await load('src/core/constants.js');
  const { AbilitySystem } = await load('src/gameplay/abilities/AbilitySystem.js');
  const { Talents } = await load('src/gameplay/talents/Talents.js');
  const { TALENT_DEFS } = await load('src/gameplay/talents/TalentDefs.js');
  const { HERO_DEFS } = await load('src/gameplay/heroes/HeroDefs.js');
  const { CHARACTERS, COMBOS } = await load('src/models/configs.js');
  const { nearestAlly, renewable } = await load('src/gameplay/abilities/heroes/tobren.js');
  const v3 = (x, z) => new THREE.Vector3(x, 0, z);
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  const [TOLD, BRUSH, COUNSEL, AGAIN] = [0, 1, 2, 3]; // his ability slots, Q to R

  function stage() {
    const nav = new NavGrid(100, 0.5);
    nav.rebuildCoarse();
    const g = {
      time: 0, frame: 0, units: [], heroes: [], bus: new EventBus(), _timers: [], spawned: [], scene: new THREE.Scene(),
      world: {
        nav,
        isWalkable: (x, z) => nav.isWalkable(x, z),
        findPath: (a, b) => nav.findPath(a, b),
        nearestWalkable: (x, z, r = 12) => nav.nearestWalkable(x, z, r),
      },
      vfx: { spawn: (name, o) => { g.spawned.push({ name, o }); return null; } },
      canSee: () => true,
      delay(s, fn) { this._timers.push({ at: this.time + s, fn }); },
      unitsInRadius(pos, r, filter) {
        return this.units.filter((u) => u.alive && Math.hypot(u.position.x - pos.x, u.position.z - pos.z) <= r && (!filter || filter(u)));
      },
      tick(n = 1) {
        for (let i = 0; i < n; i++) {
          this.time += DT; this.frame++;
          const due = [];
          this._timers = this._timers.filter((t) => (t.at <= this.time ? (due.push(t), false) : true));
          for (const t of due) t.fn();
          for (const u of [...this.units]) u.update(DT);
          this.abilities.update(DT);
          for (const u of this.units) if (u.alive && !u.immobile) u.separate(this.unitsInRadius(u.position, 2.5), DT);
          this.projectiles.update(DT);
        }
      },
      unit(team, x, z, stats = {}, kind = 'creep') {
        const u = new Unit(this, { kind, team, position: v3(x, z), stats: { maxHp: 5000, hpRegen: 0, armor: 0, magicResist: 0, acquireRange: -9, ...stats } });
        this.units.push(u);
        return u;
      },
      // A hero from the game's own definitions, with its abilities set to the levels given, in slot order.
      hero(id, team, x, z, levels = [1, 1, 1, 1]) {
        const h = new Hero(this, HERO_DEFS[id], { team, position: v3(x, z), isBot: false });
        h.baseStats.acquireRange = -9;
        h.baseStats.hpRegen = -h.def.str * 0.1; // no regeneration at level 1, so health only moves when something hits
        this.abilities.setupHero(h);
        this.units.push(h); this.heroes.push(h);
        levels.forEach((n, i) => { for (let k = 0; k < n; k++) { h.abilities[i].level++; h.abilities[i].onLevelUp(); } });
        return h;
      },
    };
    g.projectiles = new Projectiles(g);
    g.abilities = new AbilitySystem(g);
    g.talents = new Talents(g);
    return g;
  }
  const speedOf = (u) => u.getStat('moveSpeed');
  const cdr = (u) => u.bonusFromSources('cooldownReduction');

  // ---- the hero: the spare model, its rig and clips, and tooltips that carry the numbers the code uses
  const def = HERO_DEFS.tobren;
  const abDef = (i) => new AbilitySystem({ bus: new EventBus() }).getAbilityDef(def.abilities[i]);
  ok(def.model === 'bone_shaman' && !!CHARACTERS.bone_shaman?.rig && !CHARACTERS.tobren, 'Tobren: wears the spare model bone_shaman, with no rig of his own to shadow it');
  ok(def.attackType === 'ranged' && def.projectileSpeed > 0 && def.attackRange > 300, 'Tobren: ranged, as the model\'s clips are (a caster\'s idle and a spell shot)');
  ok(!!HERO_DEFS[def.projectileKind] && !!CHARACTERS[def.projectileKind] && def.projectileKind !== 'tobren', 'Tobren: his attack projectile is one a hero with its own rig already has', def.projectileKind);
  ok(def.roles[0] === 'Support' && def.roles.includes('Enabler') && !Object.values(HERO_DEFS).some((h) => h !== def && h.roles.includes('Enabler')), 'Tobren: a Support first (bots ward and leave the farm), and the one Enabler');
  {
    const clips = new Set(gltf('anims.glb').animations.map((a) => a.name));
    for (const k of ['idle', 'run', 'attack', 'cast', 'death']) {
      const name = CHARACTERS.bone_shaman.anims[k];
      const parts = COMBOS[name] ?? [name];
      ok(!!name && parts.every((c) => clips.has(c)), `Tobren: the model's ${k} clip is in the shared animation file`, `${name} (${parts.join(' + ')})`);
    }
    const bones = (f) => { const j = gltf(f); return j.skins.length === 1 ? j.skins[0].joints.map((n) => j.nodes[n].name).sort().join() : ''; };
    ok(bones('bone_shaman.glb') !== '' && bones('bone_shaman.glb') === bones('vashkar.glb'), 'Tobren: the model file has one skin on the skeleton those clips are made for (Vashkar\'s)');
  }
  {
    const q = abDef(TOLD), w = abDef(BRUSH), e = abDef(COUNSEL), r = abDef(AGAIN);
    const has = (d, text) => d.description.includes(text);
    ok(has(q, `For ${q.values.duration} seconds`) && has(q, `${q.values.delay} seconds later`) && has(q, 'pure damage'), 'Twice Told: the tooltip names the duration, the delay and the damage type the code uses');
    ok(has(w, `${w.values.slow * 100}%`) && has(w, `up to ${Math.round(w.values.distance * 40)} `) && has(w, `within ${Math.round(w.values.allyRange * 40)} of`), 'Beat the Brush: the tooltip names the slow, the shove and the range an ally is looked for in');
    ok(has(e, `within ${Math.round(e.radius * 40)} of`) && has(e, '0.6 seconds'), 'Good Counsel: the tooltip names the radius and the linger');
    ok(has(r, `within ${Math.round(r.radius * 40)},`) && r.values.ultPct === 0 && has(r, 'Ultimates and items are not touched'), 'Throw Again: the tooltip names the radius, and without the scepter no ultimate is touched');
    ok(r.scepter.description.includes(`${r.scepter.values.ultPct * 100}%`) && r.scepter.description.includes(`to ${Math.round(r.scepter.radius * 40)}.`), 'Throw Again: the scepter line names its share and its radius');
  }

  // ---- Twice Told: every attack that lands strikes again for a share of what it dealt
  // The hero `who` is told (by Tobren, from 8 away) and attacks `target` until the first strike and its echo land.
  function told(level, who = 'brakka', opts = {}) {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [level, 1, 0, 1]);
    const a = who === 'tobren' ? o : g.hero(who, 'sunward', 8, 0);
    const t = g.unit('duskward', who === 'tobren' ? 6 : 10, 0, { armor: 5, ...opts.stats }, opts.kind ?? 'creep');
    const ab = o.abilities[TOLD];
    const hits = [];
    g.bus.on('unit:damaged', ({ unit, source, amount, isAttack }) => { if (unit === t) hits.push({ at: g.time, amount, source, isAttack }); });
    const mana = o.mana;
    const cast = ab.canCast(a).ok && ab.cast(a);
    const spent = mana - o.mana;
    a.issueOrder({ type: 'attack', target: t });
    for (let n = 0; n < 200 && hits.length < 1; n++) g.tick();
    g.tick(Math.round(1 / DT)); // a second more: the echo is 0.35 s behind, the next attack more than a second
    return { g, o, a, t, ab, hits, cast, spent };
  }
  {
    const s = told(1);
    const [first, second, third] = s.hits;
    ok(s.cast === true && near(s.spent, 70) && near(s.ab.cooldownTotal, 20), 'Twice Told: level 1 costs 70 mana on a 20 s cooldown', `${s.spent} mana, ${s.ab.cooldownTotal} s`);
    ok(!!first && first.isAttack && !!second && !third, 'Twice Told: one attack lands as two strikes, and the second sets off no third', `${s.hits.length} strikes in the second after the first`);
    ok(!!second && near(second.amount, first.amount * 0.25), 'Twice Told: at level 1 the second strike is 25% of what the first dealt after armour, not reduced again', `${first?.amount.toFixed(2)} then ${second?.amount.toFixed(2)}`);
    ok(!!second && Math.abs(second.at - first.at - 0.35) <= DT + 1e-9, 'Twice Told: the second strike lands 0.35 s after the first', `${(second?.at - first?.at).toFixed(2)} s`);
    ok(!!second && !second.isAttack && second.source === s.a, 'Twice Told: the second strike is the attacker\'s own and is not an attack');
    const s4 = told(4);
    ok(s4.hits.length === 2 && near(s4.hits[1].amount, s4.hits[0].amount * 0.55), 'Twice Told: 55% at level 4', `${s4.hits[0]?.amount.toFixed(2)} then ${s4.hits[1]?.amount.toFixed(2)}`);
    const self = told(1, 'tobren');
    ok(self.cast === true && self.hits.length === 2 && near(self.hits[1].amount, self.hits[0].amount * 0.25), 'Twice Told: cast on himself, his own bolt strikes twice', `${self.hits.length} strikes`);
    ok(told(1, 'brakka', { kind: 'tower' }).hits.length === 1 && told(1, 'brakka', { kind: 'ward' }).hits.length === 1, 'Twice Told: no second strike on a building or a ward');
  }
  {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, 1, 0, 1]);
    const a = g.hero('brakka', 'sunward', 5, 0), foe = g.hero('sera', 'duskward', 0, 5), creep = g.unit('sunward', 3, 3);
    const ab = o.abilities[TOLD];
    ok(ab.canCast(a).ok && ab.canCast(o).ok && !ab.canCast(foe).ok && !ab.canCast(creep).ok, 'Twice Told: an allied hero or himself only (not an enemy or a creep)');
    ab.cast(a);
    let n = 0;
    while (a.hasModifier('twice_told') && n < 400) { g.tick(); n++; }
    ok(Math.abs(n * DT - 6) <= DT + 1e-9, 'Twice Told: it lasts 6 s', `${(n * DT).toFixed(2)} s`);
  }

  // ---- Beat the Brush: damage, a slow, and a shove toward the allied hero nearest the target
  // Tobren at the origin, the target 10 to his east, allies wherever `allies` puts them ([id, x, z]).
  function brush(level, allies = [], opts = {}) {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, level, 0, 1]);
    const friends = allies.map(([id, x, z]) => g.hero(id, 'sunward', x, z));
    opts.before?.(g, friends);
    const t = g.unit('duskward', 10, 0, { magicResist: 0.25 });
    const ab = o.abilities[BRUSH];
    const base = speedOf(t), mana = o.mana, hp = t.hp;
    const r = { g, o, t, ab, friends, base, trace: [], heldTicks: 0 };
    o.issueOrder({ type: 'cast', ability: ab, target: t });
    for (let n = 0; n < 60 && r.castAt == null; n++) { g.tick(); if (ab.cooldownRemaining > 0) r.castAt = g.time; }
    r.dealt = (hp - t.hp) / 0.75; r.spent = mana - o.mana;
    for (let n = 0; n < 12; n++) { if (t.isStunned) r.heldTicks++; g.tick(); r.trace.push(`${t.position.x.toFixed(4)},${t.position.z.toFixed(4)}`); }
    r.speed = speedOf(t);
    return r;
  }
  {
    const r = brush(1, [['sera', 10, 14]]);
    ok(r.castAt != null && near(r.dealt, 70) && near(r.spent, 90, 0.5) && near(r.ab.cooldownTotal, 14), 'Beat the Brush: level 1 deals 70 magical damage for 90 mana on a 14 s cooldown', `${r.dealt.toFixed(1)} before resistance, ${r.spent.toFixed(1)} mana`);
    ok(near(r.t.position.x, 10, 1e-6) && near(r.t.position.z, du(300), 1e-6), 'Beat the Brush: the target is shoved 300 straight toward the ally', `ended at ${r.t.position.x.toFixed(2)}, ${r.t.position.z.toFixed(2)}`);
    ok(r.heldTicks >= 6 && r.heldTicks <= 8 && !r.t.isStunned, 'Beat the Brush: it cannot act for the 0.3 s of the shove and is free after it', `${r.heldTicks} ticks held`);
    ok(near(r.speed, r.base * 0.7), 'Beat the Brush: and is slowed by 30%', `${(100 * (1 - r.speed / r.base)).toFixed(1)}%`);
    let n = 12;
    while (speedOf(r.t) < r.base && n < 200) { r.g.tick(); n++; }
    ok(Math.abs(n * DT - 2) <= DT + 1e-9, 'Beat the Brush: the level 1 slow lasts 2 s from the cast', `${(n * DT).toFixed(2)} s`);
    ok(brush(1, [['sera', 10, 14]]).trace.join() === r.trace.join(), 'Beat the Brush: the same cast run twice moves the target the same way, tick for tick');
  }
  {
    const close = brush(1, [['sera', 10, 5]]);
    const reach = close.t.radius + close.friends[0].radius + 0.1;
    ok(near(close.t.position.z, 5 - reach, 0.05) && close.t.position.z < du(300), 'Beat the Brush: the shove stops short of an ally nearer than 300', `ended ${(5 - close.t.position.z).toFixed(2)} from it, radii ${reach.toFixed(2)}`);
    const two = brush(1, [['sera', 10, 14], ['brakka', 10, -9]]);
    ok(two.t.position.z < -7 && near(two.t.position.x, 10, 1e-6), 'Beat the Brush: of two allies it is driven toward the nearer', `ended at z ${two.t.position.z.toFixed(2)}`);
    ok(nearestAlly(two.g, two.o, v3(10, 0), du(1200)) === two.friends[1] && nearestAlly(two.g, two.o, v3(0, 0), du(1200)) !== two.o, 'Beat the Brush: Tobren is never the ally it looks for');
    const alone = brush(1);
    ok(near(alone.t.position.x, 10) && near(alone.t.position.z, 0) && near(alone.dealt, 70) && near(alone.speed, alone.base * 0.7) && alone.heldTicks === 0, 'Beat the Brush: with no ally it is damaged and slowed but not moved or held');
    const far = brush(1, [['sera', 10, du(1200) + 0.5]]), inside = brush(1, [['sera', 10, du(1200) - 0.5]]);
    ok(near(far.t.position.z, 0) && near(inside.t.position.z, du(300), 1e-6), 'Beat the Brush: an ally just outside 1200 of the target does not count and one just inside does');
    const dead = brush(1, [['sera', 10, 14]], { before: (g, [a]) => a.takeDamage(1e6, 'pure', null) });
    ok(near(dead.t.position.z, 0), 'Beat the Brush: a dead ally does not count');
    const r4 = brush(4, [['sera', 10, 14]]);
    let n = 12;
    while (speedOf(r4.t) < r4.base && n < 200) { r4.g.tick(); n++; }
    ok(near(r4.dealt, 220) && Math.abs(n * DT - 3.5) <= DT + 1e-9, 'Beat the Brush: level 4 deals 220 and slows for 3.5 s', `${r4.dealt.toFixed(1)}, ${(n * DT).toFixed(2)} s`);
  }
  {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0);
    const immune = g.unit('duskward', 3, 0), friend = g.hero('sera', 'sunward', 0, 3);
    immune.addModifier({ id: 'ward', magicImmune: true });
    ok(!o.abilities[BRUSH].canCast(immune).ok && !o.abilities[BRUSH].canCast(friend).ok && !o.abilities[BRUSH].canCast(o).ok, 'Beat the Brush: not on a magic-immune enemy, an ally or himself');
  }

  // ---- Good Counsel: allied heroes within 900, Tobren included, put abilities on a shorter cooldown
  function counsel(level) {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, 1, level, 1]);
    const R900 = du(900);
    const inside = g.hero('sera', 'sunward', R900 - 0.3, 0), outside = g.hero('brakka', 'sunward', 0, R900 + 0.3);
    const foe = g.hero('isolde', 'duskward', 0, -5), creep = g.unit('sunward', 5, 5);
    return { g, o, inside, outside, foe, creep };
  }
  {
    const s = counsel(1);
    s.g.tick(6);
    ok(near(cdr(s.inside), 0.06) && near(cdr(s.o), 0.06), 'Good Counsel: an allied hero inside 900 and Tobren himself get 6% at level 1', `${cdr(s.inside)}, ${cdr(s.o)}`);
    ok(cdr(s.outside) === 0 && cdr(s.foe) === 0 && cdr(s.creep) === 0, 'Good Counsel: not an ally just outside 900, an enemy hero or an allied creep');
    const pillar = s.inside.abilities[1], base = pillar.def.cooldown[0];
    pillar.cast(v3(30, 30));
    ok(near(pillar.cooldownRemaining, base * 0.94) && near(s.outside.abilities[0].getCooldown(), s.outside.abilities[0].def.cooldown[0]), 'Good Counsel: an ability cast beside him goes on 94% of its cooldown, and one cast out of reach on all of it', `${pillar.cooldownRemaining} of ${base}`);
    const brushAb = s.o.abilities[BRUSH];
    ok(near(brushAb.getCooldown(), 14 * 0.94), 'Good Counsel: his own abilities too');
    // A hero that leaves keeps it for 0.6 s after it last applied, and it last applied within one 0.25 s beat.
    s.inside.position.x = du(900) + 5;
    let n = 0;
    while (cdr(s.inside) > 0 && n < 100) { s.g.tick(); n++; }
    ok(n * DT >= 0.6 - 0.25 - DT && n * DT <= 0.6 + DT, 'Good Counsel: it is gone 0.6 s after it last applied', `${(n * DT).toFixed(2)} s after leaving`);
    // Tobren never leaves his own side, so the modifier he holds is never re-made: a level gained must still show.
    const ab = s.o.abilities[COUNSEL];
    ab.level++; ab.onLevelUp();
    s.g.tick(6);
    ok(near(cdr(s.o), 0.09), 'Good Counsel: a level gained shows on a hero who never left his side', String(cdr(s.o)));
    const s4 = counsel(4);
    s4.g.tick(6);
    ok(near(cdr(s4.inside), 0.15), 'Good Counsel: 15% at level 4');
    s4.inside.addModifier({ id: 'rune', bonus: { cooldownReduction: 0.45 } });
    ok(near(s4.inside.abilities[1].getCooldown(), s4.inside.abilities[1].def.cooldown[0] * 0.5), 'Good Counsel: with other sources it stops at the game\'s cap of half the cooldown');
    const s0 = counsel(0);
    s0.g.tick(6);
    ok(cdr(s0.inside) === 0 && cdr(s0.o) === 0, 'Good Counsel: nothing before it is learned');
  }

  // ---- Throw Again: every basic ability of every allied hero in 700 comes off cooldown
  function again(level, opts = {}) {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, 1, 0, level]);
    if (opts.scepter) o.data.hasScepter = true;
    const ab = o.abilities[AGAIN];
    const inside = g.hero('sera', 'sunward', du(700) - 0.3, 0), outside = g.hero('brakka', 'sunward', 0, du(700) + 0.3), pell = g.hero('pell', 'sunward', 0, 5);
    const foe = g.hero('isolde', 'duskward', 0, -5);
    for (const h of [o, inside, outside, foe]) for (const x of h.abilities) if (!x.isPassive && x !== ab) x.startCooldown();
    pell.abilities[0].startCooldown(); pell.abilities[0].startCooldown(); // Scattershot: two of three charges spent
    o.mana = 250; inside.mana = 100; outside.mana = 100; // under every hero's level 1 pool, so nothing is capped
    const before = { ult: inside.abilities[3].cooldownRemaining, out: outside.abilities.map((x) => x.cooldownRemaining), foe: foe.abilities.map((x) => x.cooldownRemaining), outUlt: outside.abilities[3].cooldownRemaining };
    const list = renewable(ab), hint = g.abilities.botCastHint(o, AGAIN);
    const cast = ab.canCast().ok && ab.cast();
    return { g, o, ab, inside, outside, pell, foe, before, list, hint, cast };
  }
  {
    const s = again(1);
    ok(s.cast === true && near(250 - s.o.mana, 125) && near(s.ab.cooldownTotal, 120) && near(s.ab.getRadius(), du(700)), 'Throw Again: level 1 costs 125 mana on a 120 s cooldown with a 700 radius');
    ok(s.inside.abilities.slice(0, 3).every((x) => x.cooldownRemaining === 0) && s.o.abilities[TOLD].cooldownRemaining === 0 && s.o.abilities[BRUSH].cooldownRemaining === 0, 'Throw Again: the basic abilities of an ally inside 700, and his own, come off cooldown');
    ok(s.pell.abilities[0].charges === 3, 'Throw Again: an ability that holds charges is filled', `${s.pell.abilities[0].charges} charges`);
    ok(s.inside.abilities[3].cooldownRemaining === s.before.ult && s.before.ult > 0 && near(s.ab.cooldownRemaining, 120), 'Throw Again: no ultimate is touched, and its own cooldown stands');
    ok(s.outside.abilities.every((x, i) => x.cooldownRemaining === s.before.out[i]) && s.foe.abilities.every((x, i) => x.cooldownRemaining === s.before.foe[i]) && s.before.out[0] > 0 && s.before.foe[0] > 0, 'Throw Again: nothing changes for an ally just outside 700 or for an enemy');
    ok(near(s.inside.mana, 160) && near(s.outside.mana, 100) && near(s.o.mana, 125), 'Throw Again: an ally inside regains 60 mana at level 1, and Tobren gives himself none', `ally ${s.inside.mana}, Tobren ${s.o.mana}`);
    // Sera's two actives, Tobren's two and Pell's Scattershot: five. Sera's passive and every ultimate are not in it.
    ok(s.list.length === 5 && s.ab.data.renewed === 5 && !s.list.some((x) => x.isPassive || x.def.ultimate), 'Throw Again: it counts the five abilities it hands back, no passive and no ultimate among them', `${s.list.length} listed, ${s.ab.data.renewed} counted`);
    ok(s.hint.type === 'self' && s.hint.minEnemies === 1 && s.hint.ult === true, 'Throw Again: bots throw with three or more abilities to hand back and one enemy hero in the radius', JSON.stringify(s.hint));
    // Short cooldowns do not tempt a bot: with every one at 5 s or less left it waits, and the cast still clears them.
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, 1, 0, 1]), a = g.hero('sera', 'sunward', 5, 0);
    for (const x of [o.abilities[TOLD], o.abilities[BRUSH], a.abilities[0], a.abilities[1]]) x.cooldownRemaining = 5;
    ok(g.abilities.botCastHint(o, AGAIN).minEnemies === 99 && renewable(o.abilities[AGAIN]).length === 4, 'Throw Again: bots hold it while every cooldown around him has 5 s or less left');
    a.abilities[0].cooldownRemaining = 5.1; a.abilities[1].cooldownRemaining = 5.1; o.abilities[BRUSH].cooldownRemaining = 5.1;
    ok(g.abilities.botCastHint(o, AGAIN).minEnemies === 1, 'Throw Again: and throw once three of them have more than 5 s left');
    const s3 = again(3);
    ok(near(s3.inside.mana, 240) && near(s3.ab.cooldownTotal, 90) && near(250 - s3.o.mana, 225), 'Throw Again: level 3 gives 140 mana for 225, on a 90 s cooldown');
    const sc = again(1, { scepter: true });
    ok(near(sc.ab.getRadius(), du(900)) && near(sc.inside.abilities[3].cooldownRemaining, sc.before.ult * 0.6), 'Throw Again: with the scepter the radius is 900 and an ally\'s ultimate loses 40% of what was left', `${sc.inside.abilities[3].cooldownRemaining.toFixed(1)} of ${sc.before.ult}`);
    ok(sc.outside.abilities.slice(0, 3).every((x) => x.isPassive || x.cooldownRemaining === 0) && near(sc.outside.abilities[3].cooldownRemaining, sc.before.outUlt * 0.6) && near(sc.ab.cooldownRemaining, 120), 'Throw Again: with the scepter the ally at 700 is reached, and Tobren\'s own ultimate is still not touched');
  }

  // ---- talents: each one that names an ability moves the number its name says
  {
    const g = stage();
    const o = g.hero('tobren', 'sunward', 0, 0, [1, 1, 1, 1]);
    const tree = TALENT_DEFS.tobren;
    const read = () => ({ dmg: o.abilities[BRUSH].v('damage'), regen: o.getStat('manaRegen'), dur: o.abilities[TOLD].v('duration'), range: o.getStat('attackRange'), cd: o.abilities[BRUSH].getCooldown(), cut: o.abilities[COUNSEL].v('cdrPct'), echo: o.abilities[TOLD].v('echoPct'), ult: o.abilities[AGAIN].getCooldown() });
    const before = read();
    for (const lvl of [10, 15, 20, 25]) for (const t of tree[lvl]) g.talents.apply(o, t);
    const after = read();
    const d = Object.fromEntries(Object.keys(before).map((k) => [k, +(after[k] - before[k]).toFixed(4)]));
    ok(d.dmg === 60 && d.regen === 1.5 && d.dur === 2 && d.range === du(100) && d.cd === -4 && d.cut === 0.04 && d.echo === 0.15 && d.ult === -25, 'Tobren: the eight talents move what their names say', JSON.stringify(d));
    const names = [10, 15, 20, 25].flatMap((l) => tree[l].map((t) => t.name)).join(' | ');
    ok(/\+60 Beat the Brush Damage.*\+1\.5 Mana Regen.*\+2s Twice Told Duration.*\+100 Attack Range.*-4s Beat the Brush Cooldown.*\+4% Good Counsel Cooldown Cut.*\+15% Twice Told Second Strike.*-25s Throw Again Cooldown/.test(names), 'Tobren: and are named for those numbers');
  }
}
