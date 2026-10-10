// ormund.mjs — Ormund's four abilities, checked without a browser. Run through data.mjs:
//
//   node Projects/throneshard/test/data.mjs
//
// The heroes, the units, the ability system, the talents, the nav grid and the event bus are the game's own modules.
// What is written here is the stage they stand on, as in wall.mjs: an open 200 by 200 map and a tick in the order
// Game.tick runs it (timers, unit updates, ability tasks, separation, projectiles), at the fixed 0.05 s step.
// Nobody on the stage picks a fight on its own (acquire range below zero), so every hit point lost is one a check dealt.

const DT = 0.05;

export async function ormundChecks({ ok, load }) {
  const THREE = await import('three');
  const { NavGrid } = await load('src/world/NavGrid.js');
  const { Unit } = await load('src/core/Unit.js');
  const { Hero } = await load('src/core/Hero.js');
  const { EventBus } = await load('src/core/EventBus.js');
  const { Projectiles } = await load('src/core/Projectiles.js');
  const { du, armorMultiplier } = await load('src/core/constants.js');
  const { AbilitySystem } = await load('src/gameplay/abilities/AbilitySystem.js');
  const { Talents } = await load('src/gameplay/talents/Talents.js');
  const { TALENT_DEFS } = await load('src/gameplay/talents/TalentDefs.js');
  const { HERO_DEFS } = await load('src/gameplay/heroes/HeroDefs.js');
  const { CHARACTERS } = await load('src/models/configs.js');
  const { backTurned, ledgerTotal } = await load('src/gameplay/abilities/heroes/ormund.js');
  const v3 = (x, z) => new THREE.Vector3(x, 0, z);
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  const [SURETY, CONFISCATE, PASSAGE, ACCOUNT] = [0, 1, 2, 3]; // his ability slots, Q to R

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
  const face = (u, p) => { u.facing = Math.atan2(p.x - u.position.x, p.z - u.position.z); };
  const faceAway = (u, p) => { u.facing = Math.atan2(u.position.x - p.x, u.position.z - p.z); };
  const speedOf = (u) => u.getStat('moveSpeed');

  // ---- the hero: the spare model, and tooltips that carry the numbers the code uses
  const def = HERO_DEFS.ormund;
  const abDef = (i) => new AbilitySystem({ bus: new EventBus() }).getAbilityDef(def.abilities[i]);
  ok(def.model === 'rift_stalker' && !!CHARACTERS.rift_stalker?.rig && !CHARACTERS.ormund, 'Ormund: wears the spare model rift_stalker, with no rig of his own to shadow it');
  ok(def.attackType === 'melee' && !def.projectileSpeed, 'Ormund: melee, as the model\'s clips are (sword idle, two swings, a dash)');
  for (const k of ['idle', 'run', 'attack', 'cast', 'death']) ok(!!CHARACTERS.rift_stalker.anims[k], `Ormund: the model has a clip for ${k}`);
  {
    const w = abDef(SURETY), e = abDef(PASSAGE), r = abDef(ACCOUNT);
    const has = (d, text) => d.description.includes(text);
    ok(has(w, `${w.values.floorPct * 100}% health`) && has(w, `more than ${Math.round(w.values.breakRange * 40)} apart`), 'Stand Surety: the tooltip names the health floor and the break range the code uses');
    ok(has(e, `within ${Math.round(e.radius * 40)} of`) && has(e, '90 degrees') && has(e, '0.6 seconds'), 'No Free Passage: the tooltip names the radius, the angle and the linger');
    ok(has(r, `last ${r.values.window} seconds`) && has(r, `within ${Math.round(r.radius * 40)} `) && has(r, `${r.values.slow * 100}%`) && has(r, `${r.values.slowDuration} seconds`), 'Called to Account: the tooltip names the window, the radius and the slow');
    ok(r.scepter.description.includes(`last ${r.scepter.values.window} seconds`) && r.scepter.description.includes(r.scepter.values.cap.join('/')) && r.scepter.description.includes(`to ${Math.round(r.scepter.radius * 40)}.`), 'Called to Account: the scepter line names its window, caps and radius');
  }
  {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0);
    const hints = [0, 1, 2, 3].map((i) => g.abilities.botCastHint(o, i));
    ok(hints.map((h) => h.type).join() === 'ally,enemy,passive,self', 'Ormund: the bots are told how to use each ability', hints.map((h) => h.type).join());
    ok(hints[CONFISCATE].disable === false && hints[SURETY].defensive === true && hints[ACCOUNT].minEnemies === 2 && near(hints[ACCOUNT].radius, du(550)), 'Ormund: Confiscate is not a retreat tool, Stand Surety is defensive, Called to Account wants two heroes in its radius');
  }

  // ---- Confiscate: a walk into range, a lunge, a blow, a disarm
  function confiscate(level, opts = {}) {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [1, level, 0, 1]);
    const t = g.unit('duskward', 14, 0, { armor: 5, damageMin: 50, damageMax: 50, attackRange: 1, ...opts.stats }, opts.kind ?? 'creep');
    const ab = o.abilities[CONFISCATE];
    const mana = o.mana, hp = t.hp;
    o.issueOrder({ type: 'cast', ability: ab, target: t });
    const r = { g, o, t, ab, castAt: null, hitAt: null, trace: [] };
    for (let n = 0; n < 200 && r.hitAt === null; n++) {
      g.tick();
      if (r.castAt === null && ab.cooldownRemaining > 0) { r.castAt = g.time; r.castFrom = o.distanceTo(t); }
      if (t.hp < hp) r.hitAt = g.time;
      r.trace.push(o.position.x.toFixed(4));
    }
    r.dealt = hp - t.hp; r.spent = mana - o.mana; r.gap = o.distanceTo(t);
    return r;
  }
  {
    const r = confiscate(1);
    const { g, o, t, ab } = r;
    ok(r.castAt !== null && r.castFrom <= du(400) + 1.4 + 0.3 && r.castFrom > du(400) - 0.5, 'Confiscate: Ormund walks to its 400 cast range before casting', `cast from ${r.castFrom?.toFixed(2)}`);
    ok(r.hitAt !== null && r.hitAt - r.castAt <= ab.def.values.jumpTime + 3 * DT, 'Confiscate: the blow lands when the lunge ends', `${(r.hitAt - r.castAt).toFixed(2)} s after the cast`);
    ok(r.gap <= 1.4 + 0.3, 'Confiscate: the lunge ends beside the target', `gap ${r.gap.toFixed(2)}`);
    ok(near(r.dealt, 80 * armorMultiplier(5), 1e-6), 'Confiscate: level 1 deals 80 physical damage, reduced by the target\'s armour', `dealt ${r.dealt.toFixed(2)}`);
    ok(near(r.spent, 80, 0.5) && near(ab.cooldownTotal, 15), 'Confiscate: level 1 costs 80 mana on a 15 s cooldown', `${r.spent.toFixed(1)} mana, ${ab.cooldownTotal} s`);
    ok(t.isDisarmed && !t.isStunned && !t.isSilenced, 'Confiscate: the target is disarmed, not stunned or silenced');
    ok(o.order.type === 'attack' && o.order.target === t, 'Confiscate: Ormund goes on to attack the target');
    // The target is ordered to hit back. It cannot until the disarm ends.
    o.issueOrder({ type: 'hold' });
    o.baseStats.attackRange = 0; // he only stands there, so every hit point he loses is the target's doing
    t.issueOrder({ type: 'attack', target: o });
    const hp0 = o.hp;
    let disarmedTicks = 0, hurtWhileDisarmed = false;
    while (t.isDisarmed && disarmedTicks < 200) { g.tick(); disarmedTicks++; if (o.hp < hp0 && t.isDisarmed) hurtWhileDisarmed = true; }
    const lasted = g.time - r.hitAt;
    ok(Math.abs(lasted - 1.75) <= DT + 1e-9, 'Confiscate: the level 1 disarm lasts 1.75 s', `${lasted.toFixed(2)} s`);
    ok(!hurtWhileDisarmed && o.hp === hp0, 'Confiscate: a disarmed unit ordered to attack lands nothing');
    g.tick(60);
    ok(o.hp < hp0, 'Confiscate: and attacks again once the disarm ends', `Ormund lost ${(hp0 - o.hp).toFixed(0)}`);
    ok(confiscate(1).trace.join() === r.trace.join(), 'Confiscate: the same cast run twice gives the same walk and lunge, tick for tick');
  }
  {
    const r = confiscate(4);
    ok(near(r.dealt, 230 * armorMultiplier(5), 1e-6), 'Confiscate: level 4 deals 230', `dealt ${r.dealt.toFixed(2)}`);
    let n = 0;
    while (r.t.isDisarmed && n < 200) { r.g.tick(); n++; }
    ok(Math.abs(r.g.time - r.hitAt - 3.25) <= DT + 1e-9, 'Confiscate: the level 4 disarm lasts 3.25 s', `${(r.g.time - r.hitAt).toFixed(2)} s`);
  }
  {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0);
    const immune = g.unit('duskward', 3, 0), friend = g.hero('sera', 'sunward', 0, 3);
    immune.addModifier({ id: 'ward', magicImmune: true });
    ok(!o.abilities[CONFISCATE].canCast(immune).ok && !o.abilities[CONFISCATE].canCast(friend).ok && !o.abilities[CONFISCATE].canCast(o).ok, 'Confiscate: not on a magic-immune enemy, an ally or himself');
  }

  // ---- Stand Surety: a share of the ally's damage, taken by Ormund as it stands
  function bond(level, at = 6) {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [level, 1, 0, 1]);
    const a = g.hero('sera', 'sunward', at, 0);
    const foe = g.unit('duskward', 40, 40);
    const ab = o.abilities[SURETY];
    return { g, o, a, foe, ab, cast: () => (ab.canCast(a).ok ? ab.cast(a) : false) };
  }
  {
    const s = bond(1);
    const { g, o, a, foe, ab } = s;
    const creep = g.unit('sunward', 3, 3);
    ok(!ab.canCast(o).ok && !ab.canCast(foe).ok && !ab.canCast(creep).ok && ab.canCast(a).ok, 'Stand Surety: another allied hero only (not himself, an enemy or a creep)');
    const m0 = o.mana;
    ok(s.cast() === true && a.hasModifier('stand_surety') && near(m0 - o.mana, 60) && near(ab.cooldownTotal, 22), 'Stand Surety: level 1 costs 60 mana on a 22 s cooldown and bonds the ally');
    let ha = a.hp, ho = o.hp;
    a.takeDamage(100, 'pure', foe);
    ok(near(ha - a.hp, 70) && near(ho - o.hp, 30), 'Stand Surety: at level 1 Ormund takes 30 of 100 and the ally 70', `ally ${(ha - a.hp).toFixed(1)}, Ormund ${(ho - o.hp).toFixed(1)}`);
    // Physical damage: the ally's armour reduces it once, and Ormund's own armour does not reduce his share again.
    const mult = armorMultiplier(a.getStat('armor'));
    ok(Math.abs(mult - armorMultiplier(o.getStat('armor'))) > 0.01, 'Stand Surety: (the two heroes on the stage have different armour)');
    ha = a.hp; ho = o.hp;
    a.takeDamage(100, 'physical', foe);
    ok(near(ha - a.hp, 70 * mult) && near(ho - o.hp, 30 * mult), 'Stand Surety: Ormund\'s share is what the ally would have taken, not reduced again by his armour', `ally ${(ha - a.hp).toFixed(2)}, Ormund ${(ho - o.hp).toFixed(2)}`);
    ho = o.hp;
    o.takeDamage(50, 'pure', foe);
    ok(near(ho - o.hp, 50), 'Stand Surety: damage to Ormund himself is not shared back');
    // The floor: at or below 30% health he takes nothing for the ally, and cannot cast.
    o.hp = o.getStat('maxHp') * 0.3;
    ha = a.hp; ho = o.hp;
    a.takeDamage(100, 'pure', foe);
    ok(near(ha - a.hp, 100) && o.hp === ho, 'Stand Surety: at 30% health Ormund takes none of it');
    ab.cooldownRemaining = 0;
    ok(!ab.canCast(a).ok && /wounded/.test(ab.canCast(a).reason), 'Stand Surety: cannot be cast at 30% health', ab.canCast(a).reason);
    o.hp = o.getStat('maxHp') * 0.3 + 1;
    ok(ab.canCast(a).ok, 'Stand Surety: can be cast one hit point above the floor');
    ho = o.hp; ha = a.hp;
    a.takeDamage(100, 'pure', foe);
    ok(near(ho - o.hp, 30) && o.alive, 'Stand Surety: one hit point above the floor he takes his full share');
  }
  {
    const s = bond(4);
    s.cast();
    const ha = s.a.hp, ho = s.o.hp;
    s.a.takeDamage(100, 'pure', s.foe);
    ok(near(ha - s.a.hp, 40) && near(ho - s.o.hp, 60), 'Stand Surety: at level 4 Ormund takes 60 of 100');
  }
  {
    // It ends after 7 s, when the two are more than 900 apart, and when either dies.
    let s = bond(1);
    s.cast();
    let n = 0;
    while (s.a.hasModifier('stand_surety') && n < 400) { s.g.tick(); n++; }
    ok(Math.abs(n * DT - 7) <= DT + 1e-9, 'Stand Surety: the bond lasts 7 s', `${(n * DT).toFixed(2)} s`);
    s = bond(1);
    s.cast();
    s.a.position.x = du(900) - 0.2; s.g.tick(2);
    const heldInside = s.a.hasModifier('stand_surety');
    s.a.position.x = du(900) + 0.2; s.g.tick(2);
    ok(heldInside && !s.a.hasModifier('stand_surety'), 'Stand Surety: the bond holds just inside 900 and breaks just outside it');
    s = bond(1);
    s.cast();
    s.o.takeDamage(1e6, 'pure', s.foe); s.g.tick(2);
    ok(!s.o.alive && !s.a.hasModifier('stand_surety'), 'Stand Surety: the bond breaks when Ormund dies');
    const ha = s.a.hp;
    s.a.takeDamage(100, 'pure', s.foe);
    ok(near(ha - s.a.hp, 100), 'Stand Surety: and the ally takes everything again');
  }

  // ---- No Free Passage: enemies with their backs to him, inside 350
  ok(backTurned({ position: v3(5, 0), facing: Math.PI / 2 }, v3(0, 0)) && !backTurned({ position: v3(5, 0), facing: -Math.PI / 2 }, v3(0, 0)), 'No Free Passage: facing straight away counts as a turned back, facing him does not');
  ok(!backTurned({ position: v3(5, 0), facing: 0 }, v3(0, 0)) && backTurned({ position: v3(5, 0), facing: 0.02 }, v3(0, 0)) && !backTurned({ position: v3(5, 0), facing: -0.02 }, v3(0, 0)), 'No Free Passage: the line is at 90 degrees, and exactly side-on is not a turned back');
  function passage(level) {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [1, 1, level, 1]);
    const R350 = du(350);
    const away = g.unit('duskward', R350 - 0.3, 0), toward = g.unit('duskward', 0, R350 - 0.3), far = g.unit('duskward', -(R350 + 0.3), 0);
    const ally = g.unit('sunward', 0, -5), immune = g.unit('duskward', -5, -5), ward = g.unit('duskward', 5, -5, {}, 'ward');
    immune.addModifier({ id: 'ward', magicImmune: true });
    for (const u of [away, far, ally, immune, ward]) faceAway(u, o.position);
    face(toward, o.position);
    return { g, o, away, toward, far, ally, immune, ward };
  }
  {
    const s = passage(1);
    const base = speedOf(s.away);
    s.g.tick(6);
    ok(near(speedOf(s.away), base * (1 - 0.14)), 'No Free Passage: an enemy inside 350 with its back to him is slowed by 14% at level 1', `${(100 * (1 - speedOf(s.away) / base)).toFixed(1)}%`);
    ok(speedOf(s.toward) === base, 'No Free Passage: an enemy facing him is not slowed');
    ok(speedOf(s.far) === base, 'No Free Passage: an enemy just outside 350 is not slowed');
    ok(speedOf(s.ally) === base && speedOf(s.immune) === base && speedOf(s.ward) === base, 'No Free Passage: not an ally, a magic-immune enemy or a ward');
    // It turns to face him: the slow is gone 0.6 s after it last applied, and it last applied within one 0.25 s beat.
    face(s.away, s.o.position);
    let n = 0;
    while (speedOf(s.away) < base && n < 100) { s.g.tick(); n++; }
    ok(n * DT >= 0.6 - 0.25 - DT && n * DT <= 0.6 + DT, 'No Free Passage: the slow ends 0.6 s after it last applied', `${(n * DT).toFixed(2)} s after turning`);
    faceAway(s.toward, s.o.position);
    s.g.tick(6);
    ok(near(speedOf(s.toward), base * (1 - 0.14)), 'No Free Passage: and an enemy that turns its back is slowed within one beat');
    const s4 = passage(4);
    s4.g.tick(6);
    ok(near(speedOf(s4.away), base * (1 - 0.32)), 'No Free Passage: 32% at level 4');
    const s0 = passage(0);
    s0.g.tick(6);
    ok(speedOf(s0.away) === base, 'No Free Passage: nothing before it is learned');
  }

  // ---- Called to Account: base damage, a share of the ledger up to a cap, a slow
  function account(level, taken = [], opts = {}) {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [1, 1, 0, level]);
    if (opts.scepter) o.data.hasScepter = true;
    opts.before?.(g, o);
    const ab = o.abilities[ACCOUNT];
    const r = ab.getRadius();
    const inside = g.unit('duskward', r - 0.3, 0, { magicResist: 0.25 }), outside = g.unit('duskward', 0, r + 0.3), ally = g.unit('sunward', 3, 3);
    const foe = g.unit('duskward', 60, 60);
    o.baseStats.maxHp = 5000; o.hp = 5000;
    for (const [amount, wait] of taken) { o.takeDamage(amount, 'pure', foe); g.tick(Math.round(wait / DT)); }
    const hp = inside.hp, hpOut = outside.hp, hpAlly = ally.hp, base = speedOf(inside), mana = o.mana;
    const ledger = ledgerTotal(ab);
    const cast = ab.canCast().ok && ab.cast();
    return { g, o, ab, r, inside, outside, ally, foe, cast, ledger, dealt: (hp - inside.hp) / 0.75, out: hpOut - outside.hp, allyLost: hpAlly - ally.hp, base, spent: mana - o.mana };
  }
  {
    const s = account(1);
    ok(s.cast === true && near(s.r, du(550)) && near(s.spent, 150) && near(s.ab.cooldownTotal, 110), 'Called to Account: level 1 costs 150 mana on a 110 s cooldown with a 550 radius');
    ok(near(s.dealt, 130), 'Called to Account: with an empty ledger it deals its 130 base damage, as magical damage', `${s.dealt.toFixed(1)} before resistance`);
    ok(s.out === 0 && s.allyLost === 0, 'Called to Account: nothing outside 550 and no ally is hit');
    ok(near(speedOf(s.inside), s.base * 0.6), 'Called to Account: enemies hit are slowed by 40%');
    let n = 0;
    while (speedOf(s.inside) < s.base && n < 200) { s.g.tick(); n++; }
    ok(Math.abs(n * DT - 2.5) <= DT + 1e-9, 'Called to Account: the slow lasts 2.5 s', `${(n * DT).toFixed(2)} s`);
  }
  {
    const s = account(1, [[200, 1]]);
    ok(near(s.ledger, 200) && near(s.dealt, 130 + 0.4 * 200), 'Called to Account: 200 taken a second ago adds 40% of it, 80', `ledger ${s.ledger}, dealt ${s.dealt.toFixed(1)}`);
    ok(ledgerTotal(s.ab) === 0, 'Called to Account: the ledger is wiped when it is called in');
    ok(near(account(1, [[200, 5.9]]).dealt, 210) && near(account(1, [[200, 6.1]]).dealt, 130), 'Called to Account: damage 5.9 s old counts and damage 6.1 s old does not');
    ok(near(account(1, [[300, 1], [300, 1]]).dealt, 130 + 200), 'Called to Account: the ledger\'s share stops at the 200 cap at level 1 (600 taken would be 240)');
    ok(near(account(3, [[1000, 1]]).dealt, 250 + 400) && near(account(3, [[100, 1]]).dealt, 250 + 60), 'Called to Account: level 3 is 250 base, 60% returned, a 400 cap');
    const sc = account(1, [[200, 8], [1000, 1]], { scepter: true });
    ok(near(sc.r, du(700)) && near(sc.dealt, 130 + 350), 'Called to Account: with the scepter the radius is 700 and the cap 350', `radius ${Math.round(sc.r * 40)}, dealt ${sc.dealt.toFixed(1)}`);
    ok(near(account(1, [[200, 8]], { scepter: true }).dealt, 130 + 80) && near(account(1, [[200, 8]]).dealt, 130), 'Called to Account: with the scepter damage 8 s old still counts');
    // Old entries are dropped when a new one is written, and the scepter's window must outlive that.
    ok(near(account(1, [[200, 7], [10, 1]], { scepter: true }).dealt, 130 + 0.4 * 210), 'Called to Account: with the scepter a hit 8 s old is still in the ledger after a later hit is written', `${account(1, [[200, 7], [10, 1]], { scepter: true }).dealt.toFixed(1)}`);
    // The share he takes through Stand Surety is in the ledger; what the ally keeps is not.
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [1, 1, 0, 1]), a = g.hero('sera', 'sunward', 5, 0), foe = g.unit('duskward', 50, 50);
    o.abilities[SURETY].cast(a);
    a.takeDamage(100, 'pure', foe);
    ok(near(ledgerTotal(o.abilities[ACCOUNT]), 30), 'Called to Account: his 30 from Stand Surety is in the ledger', String(ledgerTotal(o.abilities[ACCOUNT])));
    o.takeDamage(1e6, 'pure', foe);
    ok(!o.alive && ledgerTotal(o.abilities[ACCOUNT]) === 0, 'Called to Account: the ledger is wiped when Ormund dies');
  }

  // ---- talents: each one that names an ability moves the number its name says
  {
    const g = stage();
    const o = g.hero('ormund', 'sunward', 0, 0, [1, 1, 1, 1]);
    const tree = TALENT_DEFS.ormund;
    const before = { dmg: o.abilities[CONFISCATE].v('damage'), dur: o.abilities[CONFISCATE].v('duration'), slow: o.abilities[PASSAGE].v('slow'), cd: o.abilities[SURETY].getCooldown(), cap: o.abilities[ACCOUNT].v('cap'), share: o.abilities[SURETY].v('sharePct'), hp: o.getStat('maxHp'), armor: o.getStat('armor') };
    for (const lvl of [10, 15, 20, 25]) for (const t of tree[lvl]) g.talents.apply(o, t);
    const after = { dmg: o.abilities[CONFISCATE].v('damage'), dur: o.abilities[CONFISCATE].v('duration'), slow: o.abilities[PASSAGE].v('slow'), cd: o.abilities[SURETY].getCooldown(), cap: o.abilities[ACCOUNT].v('cap'), share: o.abilities[SURETY].v('sharePct'), hp: o.getStat('maxHp'), armor: o.getStat('armor') };
    const d = Object.fromEntries(Object.keys(before).map((k) => [k, +(after[k] - before[k]).toFixed(4)]));
    ok(d.dmg === 60 && d.dur === 0.75 && d.slow === 0.08 && d.cd === -4 && d.cap === 150 && d.share === 0.1 && d.hp === 250 && d.armor === 6, 'Ormund: the eight talents move what their names say', JSON.stringify(d));
    const names = [10, 15, 20, 25].flatMap((l) => tree[l].map((t) => t.name)).join(' | ');
    ok(/\+60 Confiscate Damage.*\+250 Health.*\+8% No Free Passage Slow.*\+6 Armor.*\+0\.75s Confiscate Duration.*-4s Stand Surety Cooldown.*\+150 Called to Account Cap.*\+10% Stand Surety Share/.test(names), 'Ormund: and are named for those numbers');
  }
}
