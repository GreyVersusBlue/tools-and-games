// The one body. The suite that *runs the thing* — the arc convention says
// every arc keeps at least one test that simulates rather than calculates,
// and this is Phase 24's: a scripted player and a live creature on the baked
// sample school, driven headless through the same collider, navgraph and
// sightline the walk uses.
//
// The claims worth holding are the ones the player feels: it closes while
// you are not watching, it stops the moment you look, it comes when you
// stare too long, a slammed door breaks it — and one seed is one night,
// twice over, to the inch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import { buildCollider, updateDoorsFor } from '../js/collide.js';
import { sightBlockers } from '../js/sightline.js';
import { catalogEntry } from '../js/catalog.js';
import { banishNode } from '../js/haunt.js';
import {
  CREATURE_R, CREATURE_H, LURK_SPEED, CHASE_SPEED, CATCH_R, STARE_S,
  LOS_BREAK_S, DOOR_LOCKOUT_S, THINK_S,
  makeCreature, makeCreatureCtx, creatureSeen, pickLurkTarget,
  stepCreature, checkCaught, noteSlam, placeCreature,
} from '../js/creature.js';

// ---------- the numbers hold their shape ----------

test('the chase outruns the sprint, and the catch is a reach, not a room', () => {
  assert.ok(CHASE_SPEED > 24, 'SPRINT_SPEED is 24 — cardio must not be the answer');
  assert.ok(CHASE_SPEED < 30, 'but sight-breaking must be');
  assert.ok(LURK_SPEED < 6, 'the lurk is a walk');
  assert.ok(CATCH_R < 3 && CREATURE_R > 0 && CREATURE_H > 6);
});

// ---------- being seen, headless ----------

test('seen is a cone and a cast: behind you is invisible, a wall is a wall', () => {
  const wall = [{ ax: 5, az: -10, bx: 5, bz: 10 }];
  let look = { x: 1, z: 0 };
  const ctx = makeCreatureCtx(null, {
    sightSegsFor: () => wall,
    leavesFor: () => null,
    playerAt: () => ({ x: 0, z: 0, floor: 0 }),
    playerLook: () => look,
  });
  const c = makeCreature({ at: { x: 10, z: 0, floor: 0 } });
  assert.equal(creatureSeen(ctx, c), false, 'ahead but through a wall');
  c.x = 3;
  assert.equal(creatureSeen(ctx, c), true, 'ahead of the wall, in the cone');
  look = { x: -1, z: 0 };
  assert.equal(creatureSeen(ctx, c), false, 'the corner of your eye does not count as looking');
  look = { x: 1, z: 0 };
  c.floor = 1;
  assert.equal(creatureSeen(ctx, c), false, 'the slab is the one occluder nobody argues with');
});

// ---------- the simulation ----------

// The harness: sample school, real collider, real casts, a scripted player.
// `look` is a thunk the script retunes; doors answer to the creature the way
// the walk's do.
function makeSim(seed) {
  const state = buildSampleSchool(createState(40, 40));
  const nav = buildNav(state);
  const colliders = new Map();
  const colliderFor = (f) => {
    let c = colliders.get(f);
    if (!c) { c = buildCollider(state, f, catalogEntry, {}); colliders.set(f, c); }
    return c;
  };
  const segs = new Map();
  const sightSegsFor = (f) => {
    let s = segs.get(f);
    if (!s) { s = sightBlockers(state, f); segs.set(f, s); }
    return s;
  };
  // The player stands at a floor-0 room node, facing +x by default.
  const rooms = [...nav.nodes.values()].filter((n) => n.kind === 'room' && n.floor === 0);
  assert.ok(rooms.length > 2, 'the fixture has rooms to stand in');
  const player = { x: rooms[0].x, z: rooms[0].z, floor: 0 };
  const sim = {
    state, nav, player,
    look: { x: 1, z: 0 },
    ctx: null, creature: null,
  };
  sim.ctx = makeCreatureCtx(nav, {
    state,
    colliderFor,
    sightSegsFor,
    playerAt: () => sim.player,
    playerLook: () => sim.look,
    intensity: 0.5,
  });
  const far = banishNode(nav, player);
  assert.ok(far, 'somewhere to start from');
  sim.creature = makeCreature({ seed, at: far });
  sim.step = (dt) => {
    const collider = colliderFor(sim.creature.floor);
    updateDoorsFor(collider, [sim.creature], dt);
    return stepCreature(sim.ctx, sim.creature, dt);
  };
  sim.lookAway = () => {
    const dx = sim.creature.x - sim.player.x, dz = sim.creature.z - sim.player.z;
    const d = Math.hypot(dx, dz) || 1;
    sim.look = { x: -dx / d, z: -dz / d };
  };
  sim.lookAt = () => {
    const dx = sim.creature.x - sim.player.x, dz = sim.creature.z - sim.player.z;
    const d = Math.hypot(dx, dz) || 1;
    sim.look = { x: dx / d, z: dz / d };
  };
  return sim;
}

const distToPlayer = (sim) =>
  Math.hypot(sim.creature.x - sim.player.x, sim.creature.z - sim.player.z);

test('unwatched, it closes — and one seed is one night, twice over', () => {
  const trace = (seed) => {
    const sim = makeSim(seed);
    const points = [];
    const events = [];
    for (let i = 0; i < 1200; i++) {
      sim.lookAway();
      events.push(...sim.step(0.1).map((e) => e.kind));
      if (i % 40 === 0) points.push([sim.creature.floor, +sim.creature.x.toFixed(4), +sim.creature.z.toFixed(4)]);
    }
    return { sim, points, events };
  };
  const a = trace(7);
  const b = trace(7);
  assert.deepEqual(a.points, b.points, 'the same seed walks the same walk');
  assert.deepEqual(a.events, b.events);
  const c = trace(8);
  assert.notDeepEqual(a.points, c.points, 'a different seed is a different night');
  // Two minutes unwatched brought it near: inside the lurk band, far from
  // where it was banished to.
  const d = distToPlayer(a.sim);
  assert.ok(d < 130, `it closed to the band (${d.toFixed(0)}ft)`);
  assert.ok(a.events.includes('thud'), 'and you could hear it doing it');
  assert.equal(a.sim.creature.state, 'lurk');
  assert.ok(!a.events.includes('chase-start'), 'nothing chases what never armed');
});

test('looked at, it stops; stared at with the chase armed, it comes; still, it catches', () => {
  const sim = makeSim(3);
  // Put it in the player's own room, in plain sight.
  placeCreature(sim.creature, { x: sim.player.x + 8, z: sim.player.z, floor: 0 });
  sim.lookAt();
  assert.ok(creatureSeen(sim.ctx, sim.creature), 'the fixture stands in plain sight');
  let events = sim.step(0.1);
  assert.ok(events.some((e) => e.kind === 'freeze'), 'seen, it stops');
  const fx = sim.creature.x, fz = sim.creature.z;
  for (let i = 0; i < 5; i++) sim.step(0.1);
  assert.equal(sim.creature.x, fx);
  assert.equal(sim.creature.z, fz);
  assert.equal(sim.creature.state, 'freeze', 'and it stays stopped while watched, unarmed');

  // Arm the chase and keep staring.
  sim.ctx.chaseArmed = true;
  const all = [];
  for (let i = 0; i < 40 && !all.includes('caught'); i++) {
    sim.lookAt();
    all.push(...sim.step(0.1).map((e) => e.kind));
  }
  assert.ok(all.includes('chase-start'), 'stared at too long, it came');
  assert.ok(all.includes('caught'), 'and standing still is not a plan');
});

test('a slammed door breaks the chase, and looking away first never started one', () => {
  const sim = makeSim(4);
  placeCreature(sim.creature, { x: sim.player.x + 8, z: sim.player.z, floor: 0 });
  sim.ctx.chaseArmed = true;
  // Glance, then look away before the stare threshold: freeze, then lurk.
  sim.lookAt();
  sim.step(0.1);
  assert.equal(sim.creature.state, 'freeze');
  sim.lookAway();
  for (let i = 0; i < 12; i++) sim.step(0.1);
  assert.equal(sim.creature.state, 'lurk', 'a glance is not a stare');

  // Now provoke the chase and slam in its face.
  placeCreature(sim.creature, { x: sim.player.x + 8, z: sim.player.z, floor: 0 });
  const kinds = [];
  for (let i = 0; i < 25 && !kinds.includes('chase-start'); i++) {
    sim.lookAt();
    kinds.push(...sim.step(0.1).map((e) => e.kind));
  }
  assert.ok(kinds.includes('chase-start'));
  assert.ok(noteSlam(sim.ctx, sim.creature,
    { x: sim.creature.x, z: sim.creature.z, floor: sim.creature.floor }), 'the slam lands');
  const after = sim.step(0.1);
  assert.ok(after.some((e) => e.kind === 'chase-break'), 'the door broke it');
  assert.equal(sim.creature.state, 'lurk');
  assert.ok(sim.creature.lockout > 0 && sim.creature.lockout <= DOOR_LOCKOUT_S);
  // A slam across the building lands on nobody.
  assert.equal(noteSlam(sim.ctx, sim.creature,
    { x: sim.creature.x + 100, z: sim.creature.z, floor: sim.creature.floor }), false);
});

test('the lurk target is somewhere you are not looking, inside the band', () => {
  const sim = makeSim(5);
  sim.lookAway();
  const node = pickLurkTarget(sim.ctx, sim.creature);
  assert.ok(node, 'there is somewhere to go');
  assert.equal(node.floor, 0, 'on the player’s storey');
  const d = Math.hypot(node.x - sim.player.x, node.z - sim.player.z);
  assert.ok(d <= 120, `inside the band (${d.toFixed(0)}ft)`);
});
