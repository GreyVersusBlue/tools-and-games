// wall.mjs — Rift Wall's gameplay wall, checked without a browser. Run through data.mjs:
//
//   node Projects/throneshard/test/data.mjs
//
// The units, the nav grid, the event bus, the projectiles, the forced moves and Ondur's cast are the game's own
// modules. What is written here is the stage they stand on: an open 200 by 200 map and a tick in the order Game.tick
// runs it (timers, unit updates, separation, projectiles). The fixed step is 0.05 s, as in browser.mjs.

const DT = 0.05;

export async function wallChecks({ ok, load }) {
  const THREE = await import('three');
  const { NavGrid } = await load('src/world/NavGrid.js');
  const { Unit } = await load('src/core/Unit.js');
  const { EventBus } = await load('src/core/EventBus.js');
  const { Projectiles } = await load('src/core/Projectiles.js');
  const { blinkTo, forceMove, lv } = await load('src/gameplay/abilities/util.js');
  const { RIFT_WALL: T, riftWallSlabs, riftWallExit } = await load('src/gameplay/abilities/riftWall.js');
  const ondur = (await load('src/gameplay/abilities/heroes/ondur.js')).default;
  const def = ondur.find((a) => a.id === 'ondur_rift_wall');
  const v3 = (x, z) => new THREE.Vector3(x, 0, z);

  function stage() {
    const nav = new NavGrid(100, 0.5);
    nav.rebuildCoarse();
    const g = {
      time: 0, frame: 0, units: [], bus: new EventBus(), _timers: [], spawned: [], scene: new THREE.Scene(),
      world: {
        nav,
        isWalkable: (x, z) => nav.isWalkable(x, z),
        findPath: (a, b) => nav.findPath(a, b),
        nearestWalkable: (x, z, r = 12) => nav.nearestWalkable(x, z, r),
        blockCircle: (x, z, r) => nav.blockCircle(x, z, r),
        unblockCircle: (x, z, r) => nav.unblockCircle(x, z, r),
      },
      vfx: { spawn: (name, o) => { g.spawned.push({ name, o }); return null; } },
      canSee: () => false, // nobody acquires a target: the scenarios are about walking
      delay(s, fn) { this._timers.push({ at: this.time + s, fn }); },
      unitsInRadius(pos, r, filter) {
        return this.units.filter((u) => u.alive && Math.hypot(u.position.x - pos.x, u.position.z - pos.z) <= r && (!filter || filter(u)));
      },
      tick() {
        this.time += DT; this.frame++;
        const due = [];
        this._timers = this._timers.filter((t) => (t.at <= this.time ? (due.push(t), false) : true));
        for (const t of due) t.fn();
        for (const u of [...this.units]) u.update(DT);
        for (const u of this.units) if (u.alive && !u.immobile) u.separate(this.unitsInRadius(u.position, 2.5), DT);
        this.projectiles.update(DT);
      },
      unit(team, x, z, stats = {}, kind = 'creep') {
        const u = new Unit(this, { kind, team, position: v3(x, z), stats: { maxHp: 5000, ...stats } });
        this.units.push(u);
        return u;
      },
      // Ondur at the origin casts Rift Wall along +X through the game's own ability definition.
      cast(level = 1) {
        const hero = this.unit('sunward', 0, 0, {}, 'hero');
        const ab = { hero, game: this, level, def, v: (k) => lv(def.values[k], level), getRadius: () => def.radius };
        def.cast(ab, v3(10, 0));
        this.castAt = this.time;
        return hero;
      },
    };
    g.projectiles = new Projectiles(g);
    return g;
  }
  const LEN = def.values.length;
  const slabs = riftWallSlabs({ x: 1, z: 0 }, { x: 1, z: 0 }, LEN);
  const lastFall = slabs[slabs.length - 1].t1;
  const wallEndX = 1 + (slabs.length - 1) * T.per + 2 * T.step; // the last blocked circle's centre
  const walkable = (g, u) => g.world.isWalkable(u.position.x, u.position.z);

  // ---- the numbers: one set, shared with the picture
  ok(slabs.length === 16, 'Rift Wall: a 1400-range wall is sixteen slabs', `got ${slabs.length}`);
  ok(slabs.every((s) => Math.abs(s.t1 - s.t0 - (T.rise + T.hold + s.i * T.stagger)) < 1e-9), 'Rift Wall: each slab blocks for its rise, its hold and its stagger');
  ok(slabs.every((s) => s.circles.every((c) => c.x >= 1 + T.lead)), 'Rift Wall: no blocked circle within the lead of the line\'s start');
  {
    const g = stage();
    g.cast();
    const o = g.spawned.find((s) => s.name === 'rift_wall')?.o ?? {};
    ok(['per', 'rise', 'hold', 'sink', 'stagger'].every((k) => o[k] === T[k]), 'Rift Wall: the effect is handed the timings the collision uses', JSON.stringify(o, ['per', 'rise', 'hold', 'sink', 'stagger']));
  }

  // ---- lifetime: every slab blocks from the tick it breaks ground to the tick it starts to crumble, and nothing is left
  {
    const g = stage();
    const before = { dyn: g.world.nav.dyn.slice(), cblock: g.world.nav.cblock.slice() };
    const caster = g.cast();
    ok(caster.position.x === 0 && caster.position.z === 0 && walkable(g, caster), 'Rift Wall: the caster is not standing in his own wall');
    let wrong = 0, sawAll = false, first = '';
    for (let n = 0; n < Math.ceil((lastFall + 0.5) / DT); n++) {
      // A timer fires on the first tick at or past its time, so each edge is checked to the tick: the tick an edge
      // falls in is not judged, the ticks either side of it are.
      const t = g.time - g.castAt;
      const standing = (o) => t > o.t0 - DT && t < o.t1 + DT;
      for (const s of slabs) {
        const up = t >= s.t0 + DT && t < s.t1 - DT, down = t < s.t0 - DT || t >= s.t1 + DT;
        const probe = s.circles[s.circles.length - 1];
        const free = g.world.isWalkable(probe.x, probe.z);
        const neighbour = slabs.some((o) => o !== s && standing(o) && o.circles.some((c) => Math.hypot(c.x - probe.x, c.z - probe.z) <= T.halfWidth + 0.36));
        if ((up && free) || (down && !free && !neighbour)) { wrong++; first ||= `slab ${s.i} at ${t.toFixed(2)} s`; }
      }
      if (slabs.every((s) => !g.world.isWalkable(s.circles[0].x, s.circles[0].z))) sawAll = true;
      g.tick();
    }
    ok(sawAll, 'Rift Wall: all sixteen slabs block at once while the wall stands');
    ok(wrong === 0, 'Rift Wall: a slab blocks from its rise to its crumble, to the tick', `${wrong} wrong, first ${first}`);
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    ok(same(g.world.nav.dyn, before.dyn), 'Rift Wall: every blocked nav cell is released when the wall is gone');
    ok(same(g.world.nav.cblock, before.cblock), 'Rift Wall: the coarse path grid is as it was when the wall is gone');
    ok(g._timers.length === 0, 'Rift Wall: no timer outlives the wall', `${g._timers.length} left`);
  }

  // ---- the push-out: a unit where a slab rises is put down beside it, on its own side
  {
    const exit = (x, z, blocked = () => false) => riftWallExit({ from: { x: 1, z: 0 }, dir: { x: 1, z: 0 } }, x, z, (px, pz) => !blocked(px, pz), () => ({ x: 99, z: 99 }));
    const off = T.halfWidth + T.clear;
    ok(Math.abs(exit(10, 0.3).z - off) < 1e-9 && exit(10, 0.3).x === 10, 'Rift Wall: a unit on the +z side is put down on the +z side, straight sideways');
    ok(Math.abs(exit(10, -0.3).z + off) < 1e-9, 'Rift Wall: a unit on the -z side is put down on the -z side');
    ok(Math.abs(exit(10, 0).z + off) < 1e-9, 'Rift Wall: a unit dead on the line goes to the fixed side');
    ok(Math.abs(exit(10, 0.3, (x, z) => z > 0).z + off) < 1e-9, 'Rift Wall: the other side when its own side is not walkable');
    ok(exit(10, 0.3, () => true).x === 99, 'Rift Wall: the nearest walkable spot when neither side is');

    const g = stage();
    g.world.nav.staticCircle(20, 1.5, 0.6); // a rock on the +z side of the line at x = 20
    const near = g.unit('duskward', 6, 0.3), onLine = g.unit('duskward', 12, 0), ally = g.unit('sunward', 9, -0.2);
    const rock = g.unit('duskward', 20, 0.3), far = g.unit('duskward', 30, 0.3), first = g.unit('duskward', 2, 0.2);
    g.cast();
    ok(walkable(g, first) && first.position.z >= off - 1e-9, 'Rift Wall: a unit under the first slab is beside it the moment the wall is cast', `z ${first.position.z.toFixed(2)}`);
    ok(near.hasState('stun') && !ally.hasState('stun'), 'Rift Wall: enemies on the line are stunned, allies are not');
    ok(far.position.z === 0.3, 'Rift Wall: a unit 29 units down the line is not moved before its slab rises');
    let stuck = 0;
    for (let n = 0; n < 16; n++) { g.tick(); for (const u of g.units) if (!walkable(g, u)) stuck++; }
    ok(stuck === 0, 'Rift Wall: no unit ends a tick inside the wall while it rises', `${stuck} unit-ticks`);
    const z = (u) => +u.position.z.toFixed(3);
    ok(near.position.z >= off - 1e-9 && near.position.x === 6, 'Rift Wall: the stunned enemy is beside the wall on its own side', `z ${z(near)}`);
    ok(onLine.position.z <= -off + 1e-9, 'Rift Wall: the enemy on the line is beside the wall', `z ${z(onLine)}`);
    ok(ally.position.z <= -off + 1e-9, 'Rift Wall: an ally in the wall is put down beside it too', `z ${z(ally)}`);
    ok(rock.position.z <= -off + 1e-9, 'Rift Wall: the enemy with a rock on its side goes to the other side', `z ${z(rock)}`);
    ok(Math.abs(far.position.z) >= off - 1e-9, 'Rift Wall: the far unit is moved once its slab has risen', `z ${z(far)}`);
  }

  // ---- obstacles' existing rules: blinks, forced moves and projectiles cross it, and none ends inside it
  {
    const g = stage();
    const blinker = g.unit('duskward', 15, -5), flyer = g.unit('duskward', 22, -5), shooter = g.unit('duskward', 28, -6);
    forceMove(g, flyer, v3(22, 0), 0.5); // in the air before the wall exists, landing on its line
    g.cast();
    for (let n = 0; n < 14; n++) g.tick();
    ok(walkable(g, flyer) && Math.abs(flyer.position.z) >= T.halfWidth, 'Rift Wall: a knockback that lands on the wall is put down beside it', `z ${flyer.position.z.toFixed(2)}`);
    blinkTo(g, blinker, v3(15, 0));
    ok(walkable(g, blinker), 'Rift Wall: a blink into the wall ends beside it', `z ${blinker.position.z.toFixed(2)}`);
    blinkTo(g, blinker, v3(15, 5));
    ok(blinker.position.z === 5, 'Rift Wall: a blink over the wall lands on the far side');
    let hit = null;
    g.projectiles.launch({ source: shooter, point: v3(28, 6), speed: 30, kind: 'test', onHit: (u, p) => { hit = g.time - g.castAt; } });
    for (let n = 0; n < 12 && hit === null; n++) g.tick();
    ok(hit !== null && hit < lastFall, 'Rift Wall: a projectile crosses the standing wall', `hit at ${hit?.toFixed(2)} s`);
  }

  // ---- walking: stopped while it stands, straight through where it stood once it is gone
  const stalled = (u, prev) => u.state === 'moving' && Math.hypot(u.position.x - prev.x, u.position.z - prev.z) < 0.1 * u.getStat('moveSpeed') * DT;
  function crossing(speed, x, wantRound) {
    const g = stage();
    const walker = g.unit('duskward', x, -5, { moveSpeed: speed });
    walker.issueOrder({ type: 'move', point: v3(x, 5) });
    g.tick(); // it is already walking when the wall is cast
    g.cast();
    const r = { crossedAt: null, crossedX: null, arrivedAt: null, stalls: 0, off: 0, maxX: x, trace: [] };
    for (let n = 0; n < 400 && r.arrivedAt === null; n++) {
      const prev = { x: walker.position.x, z: walker.position.z };
      g.tick();
      const t = g.time - g.castAt;
      if (stalled(walker, prev)) r.stalls++;
      if (!walkable(g, walker)) r.off++;
      r.maxX = Math.max(r.maxX, walker.position.x);
      if (r.crossedAt === null && walker.position.z >= 0) { r.crossedAt = t; r.crossedX = walker.position.x; }
      if (walker.order.type === 'idle') r.arrivedAt = t;
      r.trace.push(walker.position.x.toFixed(4) + ',' + walker.position.z.toFixed(4));
    }
    r.at = { x: walker.position.x, z: walker.position.z };
    return r;
  }
  {
    // A slow enemy at the wall's middle: the way round is 38 units and it walks 13 while the wall stands.
    const r = crossing(3.5, 17);
    console.log(`rift wall, middle: crossed at ${r.crossedAt?.toFixed(2)} s (x ${r.crossedX?.toFixed(1)}), arrived ${r.arrivedAt?.toFixed(2)} s, ${r.stalls} stalled ticks`);
    ok(r.off === 0, 'Rift Wall: the walker never stands in a blocked cell', `${r.off} ticks`);
    ok(r.crossedAt !== null && r.crossedAt >= lastFall, 'Rift Wall: an enemy at its middle does not cross while it stands', `crossed at ${r.crossedAt?.toFixed(2)} s, wall gone at ${lastFall.toFixed(2)} s`);
    ok(r.crossedX > 1 + T.lead && r.crossedX < wallEndX - 1, 'Rift Wall: once it is gone the enemy walks through where it stood', `x ${r.crossedX?.toFixed(1)}`);
    ok(r.arrivedAt !== null && Math.hypot(r.at.x - 17, r.at.z - 5) <= 0.5, 'Rift Wall: and reaches the point it was sent to', `at ${r.at.x.toFixed(1)}, ${r.at.z.toFixed(1)}`);
    ok(r.stalls <= 14, 'Rift Wall: it presses against the wall for no more than the 0.6 s the wall takes to rise', `${r.stalls} ticks of 0.05 s`);
    ok(crossing(3.5, 17).trace.join() === r.trace.join(), 'Rift Wall: the same scenario run twice gives the same walk, tick for tick');
  }
  {
    // A creep four units from the wall's far end: the way round is 14 units, about two seconds.
    const r = crossing(7.5, 31);
    console.log(`rift wall, near the end: crossed at ${r.crossedAt?.toFixed(2)} s (x ${r.crossedX?.toFixed(1)}), arrived ${r.arrivedAt?.toFixed(2)} s, ${r.stalls} stalled ticks`);
    const gone = slabs.find((s) => s.x >= 31 - T.per / 2).t1;
    ok(r.off === 0, 'Rift Wall: the creep never stands in a blocked cell', `${r.off} ticks`);
    ok(r.maxX >= wallEndX + T.halfWidth - 0.5 && r.crossedX >= wallEndX + T.halfWidth - 0.5, 'Rift Wall: a creep near its end routes round the end', `crossed at x ${r.crossedX?.toFixed(1)}, end ${wallEndX.toFixed(1)}`);
    ok(r.arrivedAt !== null && r.arrivedAt < gone, 'Rift Wall: and arrives while the wall in front of it still stands', `arrived ${r.arrivedAt?.toFixed(2)} s, that slab crumbles at ${gone.toFixed(2)} s`);
    ok(r.stalls <= 14, 'Rift Wall: it presses against the wall for no more than the rise before it re-plans', `${r.stalls} ticks of 0.05 s`);
  }
}
