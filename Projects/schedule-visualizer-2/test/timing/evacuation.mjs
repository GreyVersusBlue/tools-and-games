// Timing: evacuation for every room at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors of 60 by 40,
// 150 rooms, two exits on floor 1).
//
//   cold   the graph, every room's way out, byExit, noRoute and a door card
//          for every room, from nothing: budget 300 ms
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
import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, byExit, noRoute, doorCard } from '../../engine/evacuation.js';
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
