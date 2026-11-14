// Timing: evacuation for every room at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, two exits on floor 1).
//
//   cold   the graph, every room's way out, byExit, noRoute and a door card
//          for every room, from nothing: budget 300 ms
//
//   up-only  (SV2-90, ARCHITECTURE 18.4) the same with one stairs made up
//          only, in a cache the movement view has already filled: evacuation
//          takes every stair, so it shares no distance field with Movement
//          and searches every room afresh, as many as the main lane did.
//          Budget 300 ms for the routes alone, as above.
//
//   blocked  (SV2-107, SV2-107b, ARCHITECTURE 20.9 item 1) a blocked-trial
//          question on the same fixture, in a cache of 2 * rooms + 8 fields
//          (Safety's recipe: the default 64 gets no hit on a 150-room pass,
//          and with rooms + 8 a blocked stairs' pass pushed the plain pass out,
//          so asking the same stairs again searched everything again) with the
//          plain pass already in it, as Safety has it. The order: plain, a
//          stairs trial (a fresh pass), the same stairs trial again (no
//          search), an exit trial (no search: avoidExits filters targets after
//          the field and is not in the plan key). Budgets: an exit 300 ms
//          warm, a stairs 600 ms. cache.bytes stays under FIELD_BYTES.
//          Measured on huginn; a phone is not measured.
//
// Measured by SV2-62b on huginn (2026-10-16), five runs in fresh processes,
// after the stale-route check, the room's footprint in the crop and the
// folded steps: 110 to 129 ms, the routes alone 72 to 84 ms (SV2-62 measured
// 93 to 185 and 46 to 157 on a busier machine). The suite fails at twice the
// budget, to leave room for a slow runner, and prints the measured number
// either way. The clock is read here, in the test, never in the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { routingGraph, routesForSchedule, createRouteCache, FIELD_BYTES } from '../../engine/routing.js';
import { evacuationRoutes, byExit, noRoute, doorCard } from '../../engine/evacuation.js';
import { blockedTrial } from '../../engine/blocked.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const BUDGET = 300;
const SLACK = 2;

test('every room\'s way out and door card on the big fixture: under 300 ms cold', () => {
  const project = bigProject({ seed: 1 });
  const started = performance.now();
  const graph = routingGraph(project, buildGraph(project));
  const evacuation = evacuationRoutes(project, graph);
  const routed = performance.now() - started;
  const exits = byExit(project, evacuation);
  const missing = noRoute(project, evacuation);
  const cards = evacuation.rooms.map((entry) => doorCard(project, graph, entry.route));
  const ms = performance.now() - started;

  console.log('# evacuation, cold: ' + ms.toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '), the routes ' + routed.toFixed(1) + ' ms: ' + evacuation.rooms.length + ' rooms, ' + cards.length + ' cards, exits serving ' + exits.map((row) => row.rooms).join(' and ') + ' rooms');

  assert.equal(evacuation.rooms.length, BIG.rooms);
  assert.equal(cards.length, BIG.rooms);
  assert.deepEqual(missing, [], 'every room of the fixture has a way out');
  assert.ok(cards.every((card) => card.ok && card.steps.length > 1 && card.floors.length >= 1), 'every card is a real one');
  assert.equal(exits.reduce((sum, row) => sum + row.rooms, 0), BIG.rooms);
  assert.ok(exits.every((row) => row.rooms > 0), 'both exits are used: ' + exits.map((row) => row.rooms).join(', '));
  assert.ok(ms < BUDGET * SLACK, 'evacuation took ' + ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});

test('every room\'s way out on the big fixture with one stairs up only, beside the movement view\'s fields: its own searches, under 300 ms', () => {
  const project = bigProject({ seed: 1 });
  project.building.connections[0].direction = 'ab';
  const graph = routingGraph(project, buildGraph(project));
  const cache = createRouteCache(BIG.rooms);
  const movement = routesForSchedule(project, graph, { cache, geometryVersion: 1 });
  const before = cache.searches;
  const started = performance.now();
  const evacuation = evacuationRoutes(project, graph, { cache, geometryVersion: 1 });
  const ms = performance.now() - started;
  const searched = cache.searches - before;

  console.log('# evacuation, one stairs up only: ' + ms.toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '), ' + searched + ' distance fields searched beside the ' + movement.searches + ' the movement view needed');

  assert.equal(searched, BIG.rooms, 'one search for every room: none of the movement view\'s fields is the evacuation\'s');
  assert.deepEqual(noRoute(project, evacuation), [], 'every room has a way out, up-only stairs or not');
  assert.ok(ms < BUDGET * SLACK, 'evacuation with an up-only stairs took ' + ms.toFixed(1) + ' ms, over ' + BUDGET * SLACK);
});

test('a blocked-trial question on the big fixture, the plain pass cached: a stairs under 600 ms, the same again and an exit with no search, in 2 * rooms + 8 fields', () => {
  const project = bigProject({ seed: 1 });
  const graph = routingGraph(project, buildGraph(project));
  const limit = 2 * BIG.rooms + 8;
  const cache = createRouteCache(limit);
  const base = { cache, geometryVersion: 1 };
  evacuationRoutes(project, graph, base);
  const warmed = cache.searches;
  assert.equal(cache.limit, limit, 'the default 64 fields would thrash on a 150-room pass');
  assert.equal(warmed, BIG.rooms);

  const stairsId = project.building.connections.find((connection) => connection.kind !== 'elevator').id;
  let started = performance.now();
  const byStairs = blockedTrial(project, graph, { connections: [stairsId] }, base);
  const stairsMs = performance.now() - started;
  const stairsSearches = cache.searches - warmed;

  const beforeAgain = cache.searches;
  started = performance.now();
  const again = blockedTrial(project, graph, { connections: [stairsId] }, base);
  const againMs = performance.now() - started;
  const againSearches = cache.searches - beforeAgain;

  const beforeExit = cache.searches;
  const exitId = project.building.floors[0].exits[0].id;
  started = performance.now();
  const byExitResult = blockedTrial(project, graph, { exits: [exitId] }, base);
  const exitMs = performance.now() - started;
  const exitSearches = cache.searches - beforeExit;

  console.log('# blocked trial, stairs: ' + stairsMs.toFixed(1) + ' ms (budget 600, fails at 1200), ' + stairsSearches + ' fields searched; the same stairs again: ' + againMs.toFixed(1) + ' ms, ' + againSearches + ' searched; exit: ' + exitMs.toFixed(1) + ' ms (budget 300, fails at 600), ' + exitSearches + ' searched; cache ' + cache.fields.size + ' of ' + limit + ' fields, ' + cache.bytes + ' bytes of ' + FIELD_BYTES);

  assert.equal(byStairs.rooms.length, BIG.rooms);
  assert.equal(byExitResult.rooms.length, BIG.rooms);
  assert.ok(stairsSearches > 0 && stairsSearches <= BIG.rooms, 'a blocked stairs is one fresh pass: ' + stairsSearches);
  assert.equal(againSearches, 0, 'the same stairs again finds the stairs\' fields and the plain pass still cached');
  assert.equal(JSON.stringify(again.summary), JSON.stringify(byStairs.summary), 'and gives the same answer');
  assert.equal(exitSearches, 0, 'a blocked exit costs no search: before is cached and avoidExits is not in the plan key');
  assert.ok(byExitResult.summary.moved > 0, 'blocking one of the two exits moves rooms');
  assert.ok(cache.fields.size <= limit, 'the cache stays inside its limit: ' + cache.fields.size);
  assert.ok(cache.bytes < FIELD_BYTES, 'cache.bytes ' + cache.bytes + ' is under ' + FIELD_BYTES);
  assert.ok(exitMs < 300 * SLACK, 'a blocked exit took ' + exitMs.toFixed(1) + ' ms, over ' + 300 * SLACK);
  assert.ok(stairsMs < 600 * SLACK, 'a blocked stairs took ' + stairsMs.toFixed(1) + ' ms, over ' + 600 * SLACK);
});
