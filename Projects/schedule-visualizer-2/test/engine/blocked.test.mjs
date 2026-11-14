// "What if this exit or stairs is blocked?": normaliseBlocked,
// blockedFromScenario, blockedOptions, blockedTrial and blockedWords
// (ARCHITECTURE 20.3, 20.9 items 2 and 15).
//
// Buildings are drawn in the tests that use them. twoStairs has stairs at both
// ends of one corridor and one exit beside stairs A, so blocking A sends floor
// 2's room the long way round and blocking both cuts it off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../engine/graph.js';
import { createRouteCache } from '../../engine/routing.js';
import { evacuationRoutes, byExit } from '../../engine/evacuation.js';
import { exitLoad } from '../../engine/exit-load.js';
import { normaliseBlocked, blockedFromScenario, blockedOptions, blockedTrial, blockedWords, stairsName } from '../../engine/blocked.js';
import { sampleSchool } from '../../data/sample-school.js';
import { planProject, disconnectedWing, threeFloors, floorId, roomId } from '../fixtures/buildings/plans.mjs';

const F1 = floorId(1);
const F2 = floorId(2);
const STAIRS_A = 'cplan00001';
const STAIRS_B = 'cplan00002';
const EXIT = 'xplan00001';

function twoStairs(exits) {
  const floor = ['..AA......', '..AA......', 'S########S', '..........', '..........'];
  return planProject([floor, floor], {
    doors: { '1A': [[2, 1, 's']], '2A': [[2, 1, 's']] },
    connections: [[1, 0, 2, 2, 0, 2], [1, 9, 2, 2, 9, 2]],
    exits: exits || [[1, 1, 2, 'West Door']],
  });
}

function trial(project, blocked, options) {
  return blockedTrial(project, buildGraph(project), blocked, options);
}

function changes(result) {
  return Object.fromEntries(result.rooms.map((room) => [room.roomId, room.change]));
}

test('a blocked exit moves the rooms that used it to the other exit, and says so', () => {
  // one room in the middle of a corridor with an exit at each end
  const project = planProject([['....A....', '....A....', '#########', '.........', '.........']], { doors: { '1A': [[4, 1, 's']] }, exits: [[1, 0, 2, 'West'], [1, 8, 2, 'East']] });
  const free = trial(project, {});
  assert.equal(free.rooms[0].before.exitId, EXIT, 'a tie goes to the lower id');
  const result = trial(project, { exits: [EXIT] });
  assert.deepEqual(changes(result), { [roomId('1A')]: 'other-exit' }, 'a tie: East is as far as West, so blocking West moves it to East');
  assert.equal(result.rooms[0].delta, 0, 'in the same time');
  const other = trial(project, { exits: ['xplan00002'] });
  assert.deepEqual(changes(other), { [roomId('1A')]: 'same' }, 'blocking East, which it did not use, moves nothing');
  // an unequal building: the room is near the west exit
  const near = planProject([['.A.......', '.A.......', '#########', '.........', '.........']], { doors: { '1A': [[1, 1, 's']] }, exits: [[1, 0, 2, 'West'], [1, 8, 2, 'East']] });
  const moved = trial(near, { exits: [EXIT] });
  const room = moved.rooms[0];
  assert.equal(room.change, 'other-exit');
  assert.equal(room.before.exitId, EXIT);
  assert.equal(room.after.exitId, 'xplan00002');
  assert.equal(room.delta, room.after.seconds - room.before.seconds);
  assert.ok(room.delta > 0);
  assert.equal(room.sentence, null, 'a room that has a way out has no sentence');
  assert.deepEqual({ moved: moved.summary.moved, otherExit: moved.summary.otherExit, slower: moved.summary.slower, lost: moved.summary.lost, gained: moved.summary.gained }, { moved: 1, otherExit: 1, slower: 0, lost: 0, gained: 0 });
  assert.equal(moved.sentence, 'If West is blocked: 1 room goes out another way and the slowest way out takes ' + secondsWords(room.after.seconds) + ' (was ' + secondsWords(room.before.seconds) + ').');
  assert.deepEqual(moved.exits.map((exit) => [exit.number, exit.blocked, exit.before.rooms, exit.after.rooms]), [[1, true, 1, 0], [2, false, 0, 1]]);
});

function secondsWords(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? rest + ' s' : rest === 0 ? minutes + ' min' : minutes + ' min ' + rest + ' s';
}

test('a blocked stairs sends the upper floor the long way round to the same exit: slower, not another exit', () => {
  const project = twoStairs();
  const result = trial(project, { connections: [STAIRS_A] });
  assert.deepEqual(changes(result), { [roomId('1A')]: 'same', [roomId('2A')]: 'slower' });
  const upper = result.rooms.find((room) => room.roomId === roomId('2A'));
  assert.equal(upper.before.exitId, upper.after.exitId);
  assert.ok(upper.delta > 0);
  assert.equal(result.summary.moved, 1, 'slower counts as going out another way');
  assert.equal(result.summary.otherExit, 0);
  assert.equal(result.summary.slower, 1);
  assert.ok(result.after.rooms.find((entry) => entry.roomId === roomId('2A')).route.connections.includes(STAIRS_B));
  assert.equal(
    result.sentence,
    'If Stairs A, Floor 1 to Floor 2 is blocked: 1 room goes out another way and the slowest way out takes ' + secondsWords(upper.after.seconds) + ' (was ' + secondsWords(upper.before.seconds) + ').',
    'the stairs named with the floors it joins, durations as formatDuration says them',
  );
});

test('a blocked stairs on a three-floor stairwell cuts off every floor above it, and only those', () => {
  const project = threeFloors();
  const top = trial(project, { connections: [STAIRS_B] });
  assert.deepEqual(top.rooms.filter((room) => room.change === 'lost').map((room) => room.roomId), [roomId('3A'), roomId('3B')], 'Stairs B joins floors 2 and 3: floor 3 is cut off');
  assert.ok(top.rooms.filter((room) => room.floorId !== floorId(3)).every((room) => room.change === 'same'));
  const low = trial(project, { connections: [STAIRS_A] });
  assert.deepEqual(low.rooms.filter((room) => room.change === 'lost').map((room) => room.roomId), [roomId('2A'), roomId('2B'), roomId('3A'), roomId('3B')], 'Stairs A is the way down for floors 2 and 3');
  assert.equal(low.summary.lost, 4);
  assert.equal(stairsName(project, project.building.connections[1]), 'Stairs B, Floor 2 to Floor 3', 'a chained stairwell\'s connections each name their own floors');
});

test('both stairs of an upper floor blocked: its room has no way out, in noRoute\'s words about what was avoided', () => {
  const project = twoStairs();
  const result = trial(project, { connections: [STAIRS_A, STAIRS_B] });
  const upper = result.rooms.find((room) => room.roomId === roomId('2A'));
  assert.equal(upper.change, 'lost');
  assert.equal(upper.after, null);
  assert.equal(upper.delta, null);
  assert.equal(upper.sentence, 'There is no way through that keeps to what you asked to avoid from Room 2A on Floor 2 to an exit.');
  assert.equal(result.sentence, 'If Stairs A, Floor 1 to Floor 2 and Stairs B, Floor 1 to Floor 2 are blocked: 1 room has no way out.', 'a lost room does not shorten the slowest way out');
  assert.equal(result.summary.slowestBefore, result.summary.slowestAfter);
});

test('a room cut off by a blocked exit is told which exit: its only way out, or every exit it can reach', () => {
  const project = twoStairs();
  const only = trial(project, { exits: [EXIT] });
  assert.deepEqual(only.rooms.map((room) => room.sentence), ['Its only way out, West Door (1), is blocked.', 'Its only way out, West Door (1), is blocked.']);
  // a room that reaches two exits, both blocked
  const two = twoStairs([[1, 1, 2, 'West Door'], [1, 8, 2, '']]);
  const both = trial(two, { exits: ['xplan00001', 'xplan00002'] });
  assert.equal(both.rooms[0].sentence, 'Every exit it can reach is blocked: West Door (1) and The exit on Floor 1 (2).');
  assert.equal(both.sentence, 'If West Door and The exit on Floor 1 are blocked: 2 rooms have no way out.');
  // one blocked, one left: no sentence, the room goes out the other way
  const one = trial(two, { exits: ['xplan00001'] });
  assert.ok(one.rooms.every((room) => room.sentence === null && room.after !== null));
});

test('an exit and a stairs together: a room cut off by the stairs is worded by noRoute, not as an exit block', () => {
  const two = twoStairs([[1, 1, 2, 'West Door'], [1, 8, 2, 'East Door']]);
  const result = trial(two, { exits: ['xplan00001'], connections: [STAIRS_A, STAIRS_B] });
  const upper = result.rooms.find((room) => room.roomId === roomId('2A'));
  assert.equal(upper.change, 'lost');
  assert.equal(upper.sentence, 'There is no way through that keeps to what you asked to avoid from Room 2A on Floor 2 to an exit.', 'the stairs cut it off whichever exit is blocked');
});

test('a room with no way out before and none after is "none", worded as it always was', () => {
  const result = trial(disconnectedWing(), { exits: [EXIT] });
  const east = result.rooms.filter((room) => room.change === 'none');
  assert.deepEqual(east.map((room) => room.roomId), [roomId('1C'), roomId('1D')]);
  assert.deepEqual(east.map((room) => room.sentence), ['There is no way through from Room 1C on Floor 1 to an exit.', 'There is no way through from Room 1D on Floor 1 to an exit.']);
  assert.equal(result.summary.lost, 2, 'only the west rooms are lost');
});

test('blocking never gives a room a way out: "gained" does not happen', () => {
  for (const [project, sets] of [
    [twoStairs(), [{ exits: [EXIT] }, { connections: [STAIRS_A] }, { connections: [STAIRS_A, STAIRS_B] }, { cells: [{ floorId: F2, cell: 21 }] }]],
    [threeFloors(), [{ connections: ['cplan00001'] }, { connections: ['cplan00002'] }, { exits: ['xplan00001'] }]],
    [disconnectedWing(), [{ exits: [EXIT] }]],
  ]) {
    for (const blocked of sets) {
      const result = trial(project, blocked);
      assert.equal(result.summary.gained, 0);
      assert.ok(result.rooms.every((room) => room.change !== 'gained'), JSON.stringify(blocked));
      assert.ok(result.rooms.every((room) => room.delta === null || room.delta >= 0), 'no way out gets quicker: ' + JSON.stringify(blocked));
    }
  }
});

test('nothing blocked, or nothing that matters: "Nothing changes: every room goes out the way it did."', () => {
  const project = twoStairs([[1, 1, 2, 'West Door'], [1, 8, 2, 'East Door']]);
  const none = trial(project, {});
  assert.equal(none.sentence, 'Nothing changes: every room goes out the way it did.');
  assert.deepEqual(none.summary, { moved: 0, otherExit: 0, slower: 0, lost: 0, gained: 0, slowestBefore: none.summary.slowestBefore, slowestAfter: none.summary.slowestBefore });
  // East Door is used by no room (West is nearer on both floors)
  const unused = trial(project, { exits: ['xplan00002'] });
  assert.equal(unused.sentence, 'Nothing changes: every room goes out the way it did.');
  assert.ok(unused.rooms.every((room) => room.change === 'same'));
  // Stairs B is no one's way down
  assert.equal(trial(twoStairs(), { connections: [STAIRS_B] }).sentence, 'Nothing changes: every room goes out the way it did.');
});

test('blockedTrial: the load before and after, and the exits\' figures, with a blocked exit left out of the even share', () => {
  const project = sampleSchool();
  const ids = project.building.floors[0].exits.map((exit) => exit.id);
  const result = trial(project, { exits: [ids[0]] });
  assert.equal(result.load.before.open, 2);
  assert.equal(result.load.after.open, 1);
  assert.deepEqual(result.load.after.exits.map((exit) => exit.blocked), [true, false]);
  assert.deepEqual(result.load.after.heavy, []);
  assert.equal(result.exits.length, 2);
  assert.equal(result.exits[0].after.rooms, 0);
  assert.equal(result.exits[1].after.rooms, result.exits[0].before.rooms + result.exits[1].before.rooms, 'every room that used the blocked exit uses the other');
  assert.deepEqual(result.exits.map((exit) => exit.number), [1, 2]);
  assert.equal(result.load.after.sentence, 'Every room leaves by Door B: it is the only exit not blocked.');
});

test('before is evacuationRoutes alone, byte for byte, and the trial reads nothing it was not given', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const frozen = JSON.stringify(project);
  const blocked = { exits: ['xsample00a'], connections: ['csample00a'], cells: [] };
  const given = JSON.stringify(blocked);
  const result = blockedTrial(project, graph, blocked);
  assert.equal(JSON.stringify(result.before), JSON.stringify(evacuationRoutes(project, graph)));
  assert.equal(JSON.stringify(project), frozen, 'the building is not touched');
  assert.equal(JSON.stringify(blocked), given, 'the blocked set is not touched');
  assert.equal(result.rooms.length, evacuationRoutes(project, graph).rooms.length, 'every room, in building order');
  assert.deepEqual(result.rooms.map((room) => room.roomId), evacuationRoutes(project, graph).rooms.map((entry) => entry.roomId));
});

test('before comes from the cache: a blocked exit searches nothing new, and the second call searches nothing at all', () => {
  const project = twoStairs();
  const graph = buildGraph(project);
  const cache = createRouteCache(project.building.floors.length * 2 + 8);
  const base = { cache, geometryVersion: 1 };
  evacuationRoutes(project, graph, base);
  const worked = cache.searches;
  assert.equal(worked, 2, 'one field a room');
  blockedTrial(project, graph, { exits: [EXIT] }, base);
  assert.equal(cache.searches, worked, 'avoidExits filters targets after the field: a blocked exit costs no search, and before was already there');
  const first = blockedTrial(project, graph, { connections: [STAIRS_A] }, base);
  const afterStairs = cache.searches;
  assert.ok(afterStairs > worked, 'a blocked stairs changes the plan: a fresh pass');
  const second = blockedTrial(project, graph, { connections: [STAIRS_A] }, base);
  assert.equal(cache.searches, afterStairs, 'the second call is served from the cache');
  assert.equal(JSON.stringify(second.rooms), JSON.stringify(first.rooms));
  // from nothing, with a counting cache, the first trial of an exit block is one pass
  const fresh = createRouteCache(20);
  blockedTrial(project, graph, { exits: [EXIT] }, { cache: fresh, geometryVersion: 1 });
  assert.equal(fresh.searches, 2, 'before once; after shares its fields');
  // a stairs changes the plan: before is its own pass, in the cache, so the plain pass is a hit afterwards
  const stairsCache = createRouteCache(20);
  blockedTrial(project, graph, { connections: [STAIRS_A] }, { cache: stairsCache, geometryVersion: 1 });
  assert.equal(stairsCache.searches, 4, 'before (2 fields) and after (2 fields), each in the cache');
  evacuationRoutes(project, graph, { cache: stairsCache, geometryVersion: 1 });
  assert.equal(stairsCache.searches, 4, 'the plain pass is already there: before went through the cache');
});

test('the cut-off wording asks the cache, not a new search, once the pass is cached', () => {
  const project = twoStairs();
  const graph = buildGraph(project);
  const cache = createRouteCache(20);
  const base = { cache, geometryVersion: 1 };
  blockedTrial(project, graph, { exits: [EXIT] }, base);
  const searched = cache.searches;
  const again = blockedTrial(project, graph, { exits: [EXIT] }, base);
  assert.equal(cache.searches, searched);
  assert.equal(again.rooms[0].sentence, 'Its only way out, West Door (1), is blocked.');
});

test('a corridor\'s cells from a scenario block it: the room behind them goes the long way round', () => {
  const project = twoStairs();
  const scenario = { levers: [{ kind: 'corridor', floorId: F2, cells: [21], name: 'North Corridor' }] };
  const found = blockedFromScenario(project, scenario);
  assert.deepEqual(found.cells, [{ floorId: F2, cell: 21 }]);
  const result = trial(project, { cells: found.cells });
  assert.equal(changes(result)[roomId('2A')], 'slower', 'stairs A\'s corridor cell is shut: floor 2 walks to B');
  assert.equal(result.sentence.startsWith('If 1 corridor cell on Floor 2 is blocked: '), true);
  const named = { ...project };
  named.building.floors[1].corridors.push({ id: 'knorth', name: 'North Corridor', cells: [21] });
  assert.equal(trial(named, { cells: found.cells }).sentence.startsWith('If North Corridor is blocked: '), true, 'cells that make up a named corridor are worded by its name');
  const lost = trial(project, { cells: [{ floorId: F2, cell: 21 }, { floorId: F2, cell: 28 }] });
  assert.equal(changes(lost)[roomId('2A')], 'lost');
  assert.equal(lost.rooms.find((room) => room.roomId === roomId('2A')).sentence, 'There is no way through that keeps to what you asked to avoid from Room 2A on Floor 2 to an exit.');
});

test('blockedFromScenario: closed stairs and closed corridors only, never one-way, never an elevator', () => {
  const project = twoStairs();
  project.building.connections.push({ id: 'celev0001', label: 'D', kind: 'elevator', a: { floorId: F1, cell: 11 }, b: { floorId: F2, cell: 11 }, direction: 'both' });
  const scenario = {
    levers: [
      { kind: 'way', connectionId: STAIRS_A, way: 'ab' },
      { kind: 'way', connectionId: STAIRS_B, way: 'closed' },
      { kind: 'way', connectionId: 'celev0001', way: 'closed' },
      { kind: 'corridor', floorId: F1, cells: [22, 21], name: 'West <b>Corridor</b>' },
      { kind: 'corridor', floorId: 'fgone', cells: [3], name: 'Gone' },
    ],
  };
  const found = blockedFromScenario(project, scenario);
  assert.deepEqual(found.connections, [STAIRS_B]);
  assert.deepEqual(found.cells, [{ floorId: F1, cell: 21 }, { floorId: F1, cell: 22 }]);
  assert.deepEqual(found.corridors, [{ floorId: F1, name: 'West <b>Corridor</b>', cells: [21, 22] }]);
  assert.equal(found.words.text, 'Stairs B and West <b>Corridor</b>', 'names as typed');
  assert.deepEqual(found.words.parts.filter((part) => part.name).map((part) => part.text), ['B', 'West <b>Corridor</b>']);
  assert.deepEqual(blockedFromScenario(project, { levers: [{ kind: 'way', connectionId: STAIRS_A, way: 'ba' }] }), { connections: [], cells: [], corridors: [], words: { parts: [], text: '' } });
  assert.deepEqual(blockedFromScenario(project, null).connections, [], 'no scenario, nothing');
});

test('normaliseBlocked drops a gone exit, a gone stairs, an elevator and a cell that is no longer a corridor, with a sentence for each', () => {
  const project = twoStairs();
  const before = structuredClone(project);
  project.building.connections = project.building.connections.filter((connection) => connection.id !== STAIRS_B);
  project.building.connections.push({ id: 'celev0001', label: 'D', kind: 'elevator', a: { floorId: F1, cell: 11 }, b: { floorId: F2, cell: 11 }, direction: 'both' });
  const given = { exits: ['xgone', EXIT, EXIT], connections: [STAIRS_B, 'celev0001', STAIRS_A], cells: [{ floorId: F1, cell: 22 }, { floorId: F1, cell: 0 }, { floorId: F2, cell: 99999 }, { floorId: 'fgone', cell: 1 }, { floorId: F1, cell: 22 }] };
  const result = normaliseBlocked(project, given, before);
  assert.deepEqual(result.blocked, { exits: [EXIT], connections: [STAIRS_A], cells: [{ floorId: F1, cell: 22 }] }, 'what is left, sorted, once');
  assert.deepEqual(result.dropped, [
    'A blocked exit is gone, so it is no longer blocked.',
    'Elevator D is never used in an evacuation, so it is not blocked.',
    'Stairs B, Floor 1 to Floor 2 is gone, so it is no longer blocked.',
    '1 blocked corridor cell on Floor 1 is no longer a corridor, so it is no longer blocked.',
    '1 blocked corridor cell on Floor 2 is no longer a corridor, so it is no longer blocked.',
    '1 blocked corridor cell on a floor that is gone is no longer a corridor, so it is no longer blocked.',
  ]);
  const unnamed = normaliseBlocked(project, { connections: [STAIRS_B] });
  assert.deepEqual(unnamed.dropped, ['A blocked stairs is gone, so it is no longer blocked.'], 'without the earlier building a gone stairs has no name to give');
});

test('normaliseBlocked names a gone exit from the earlier building, as typed, and takes nothing or junk without throwing', () => {
  const project = twoStairs([[1, 1, 2, '<i>West</i> "Door"']]);
  const before = structuredClone(project);
  project.building.floors[0].exits = [];
  assert.deepEqual(normaliseBlocked(project, { exits: [EXIT] }, before).dropped, ['<i>West</i> "Door" is gone, so it is no longer blocked.']);
  assert.deepEqual(normaliseBlocked(project, undefined), { blocked: { exits: [], connections: [], cells: [] }, dropped: [], droppedParts: [] });
  assert.deepEqual(normaliseBlocked(project, { exits: 'x', connections: [1, null], cells: [null, { floorId: 1 }, 'a'] }).blocked, { exits: [], connections: [], cells: [] });
});

test('blockedTrial normalises first: a gone stairs changes nothing and is reported', () => {
  const project = twoStairs();
  const result = trial(project, { connections: ['cgone'], exits: ['xgone'] });
  assert.equal(result.sentence, 'Nothing changes: every room goes out the way it did.');
  assert.deepEqual(result.blocked, { exits: [], connections: [], cells: [] });
  assert.equal(result.dropped.length, 2);
  assert.equal(JSON.stringify(result.after), JSON.stringify(result.before));
});

test('an elevator in the blocked set changes nothing: evacuation never uses one', () => {
  const project = twoStairs();
  project.building.connections.push({ id: 'celev0001', label: 'D', kind: 'elevator', a: { floorId: F1, cell: 11 }, b: { floorId: F2, cell: 11 }, direction: 'both' });
  const result = trial(project, { connections: ['celev0001'] });
  assert.deepEqual(result.blocked.connections, []);
  assert.equal(result.sentence, 'Nothing changes: every room goes out the way it did.');
  assert.equal(result.dropped[0], 'Elevator D is never used in an evacuation, so it is not blocked.');
});

test('blockedOptions: the three lists evacuation.js takes, sorted, as copies', () => {
  const blocked = { exits: ['xb', 'xa'], connections: ['cb', 'ca'], cells: [{ floorId: F1, cell: 3 }] };
  const options = blockedOptions(blocked);
  assert.deepEqual(options, { avoidExits: ['xa', 'xb'], avoidConnections: ['ca', 'cb'], shutCells: [{ floorId: F1, cell: 3 }] });
  options.shutCells[0].cell = 99;
  assert.equal(blocked.cells[0].cell, 3, 'a copy');
  assert.deepEqual(blockedOptions(undefined), { avoidExits: [], avoidConnections: [], shutCells: [] });
});

test('blockedWords: "Door B and Stairs A, Floor 1 to Floor 2 blocked", names as typed, the floors optional', () => {
  const project = twoStairs([[1, 1, 2, 'West <b>Door</b>'], [1, 8, 2, '']]);
  const blocked = { exits: ['xplan00002', 'xplan00001'], connections: [STAIRS_B] };
  const words = blockedWords(project, blocked);
  assert.equal(words.text, 'West <b>Door</b>, The exit on Floor 1 and Stairs B, Floor 1 to Floor 2 blocked');
  assert.deepEqual(words.parts.filter((part) => part.name).map((part) => part.text), ['West <b>Door</b>', 'The exit on Floor 1', 'B', 'Floor 1', 'Floor 2']);
  assert.equal(words.parts.map((part) => part.text).join(''), words.text);
  assert.equal(blockedWords(project, blocked, { floors: false }).text, 'West <b>Door</b>, The exit on Floor 1 and Stairs B blocked');
  assert.equal(blockedWords(project, { exits: ['xplan00001'] }).text, 'West <b>Door</b> blocked');
  assert.deepEqual(blockedWords(project, {}), { parts: [], text: '' });
  assert.deepEqual(blockedWords(project, { exits: ['xgone'] }), { parts: [], text: '' }, 'a gone exit is not worded');
});

test('stairs are named with their floors in the trial\'s sentence and the same stairwell\'s connections each name their own', () => {
  const project = threeFloors();
  const result = trial(project, { connections: ['cplan00001', 'cplan00002'] });
  assert.ok(result.sentence.startsWith('If Stairs A, Floor 1 to Floor 2 and Stairs B, Floor 2 to Floor 3 are blocked: '), result.sentence);
  assert.equal(stairsName(project, null), 'Stairs');
  const noLabel = structuredClone(project);
  noLabel.building.connections[0].label = '';
  assert.equal(stairsName(noLabel, noLabel.building.connections[0]), 'Stairs, Floor 1 to Floor 2');
});

test('the trial sentence: three clauses with the Oxford comma, the noun once, plurals right', () => {
  // floor 2 loses its stairs A (slower via B), floor 3 has no way (needs a chain)
  const project = twoStairs([[1, 1, 2, 'A'], [1, 8, 2, 'B']]);
  const result = trial(project, { exits: ['xplan00001'] });
  assert.ok(result.rooms.every((room) => room.after !== null));
  assert.equal(result.summary.moved, 2);
  assert.ok(result.sentence.startsWith('If A is blocked: 2 rooms go out another way and the slowest way out takes '), result.sentence);
  const wing = trial(disconnectedWing(), { exits: [EXIT] });
  assert.equal(wing.sentence, 'If West Door is blocked: 2 rooms have no way out.');
});

// ---- SV2-107b

function names(parts) {
  return parts.filter((part) => part.name).map((part) => part.text);
}

function joinedText(parts) {
  return parts.map((part) => part.text).join('');
}

// Floor 1 has room 1A with no capacity; floor 2 has rooms 2A and 2B of 30.
function basisFlip() {
  const low = ['..AA......', '..AA......', 'S########S', '..........', '..........'];
  const high = ['..AABB....', '..AABB....', 'S########S', '..........', '..........'];
  const project = planProject([low, high], {
    doors: { '1A': [[2, 1, 's']], '2A': [[2, 1, 's']], '2B': [[4, 1, 's']] },
    connections: [[1, 0, 2, 2, 0, 2], [1, 9, 2, 2, 9, 2]],
    exits: [[1, 1, 2, 'West Door']],
  });
  for (const space of project.building.floors[1].spaces) space.capacity = 30;
  return project;
}

test('before and after are loaded on one basis: losing the counted rooms would otherwise flip it to rooms', () => {
  const project = basisFlip();
  const graph = buildGraph(project);
  const result = blockedTrial(project, graph, { connections: [STAIRS_A, STAIRS_B] });
  assert.equal(result.summary.lost, 2, 'both upper rooms are cut off');
  assert.equal(result.load.before.basis, 'people', '1 of 3 rooms with a way out has no capacity');
  const alone = exitLoad(project, byExit(project, result.after));
  assert.equal(alone.basis, 'rooms', 'the one room left has no capacity: on its own the after load flips');
  assert.equal(result.load.after.basis, 'people', 'the trial holds it to before\'s basis');
  assert.equal(result.load.after.total, 0, 'people, and the room left holds none');
});

test('a caller\'s avoidExits count as blocked for the loads and for exits[].blocked, with the set\'s on top', () => {
  const project = twoStairs([[1, 1, 2, 'West Door'], [1, 8, 2, 'East Door']]);
  const graph = buildGraph(project);
  const result = blockedTrial(project, graph, { exits: ['xplan00002'] }, { avoidExits: ['xplan00001'] });
  assert.equal(result.load.before.open, 1, 'before has West Door avoided by the caller');
  assert.deepEqual(result.load.before.exits.map((exit) => exit.blocked), [true, false]);
  assert.equal(result.load.after.open, 0, 'after has both: the caller\'s and the set\'s');
  assert.deepEqual(result.load.after.exits.map((exit) => exit.blocked), [true, true]);
  assert.deepEqual(result.exits.map((exit) => exit.blocked), [true, true], 'exits[] uses the same union');
  const plain = blockedTrial(project, graph, { exits: ['xplan00002'] });
  assert.equal(plain.load.before.open, 2, 'no caller option: before has nothing blocked');
  assert.deepEqual(plain.exits.map((exit) => exit.blocked), [false, true]);
});

test('every exit blocked: every room is lost, nothing is open, no load sentence', () => {
  const project = twoStairs([[1, 1, 2, 'West Door'], [1, 8, 2, 'East Door']]);
  const result = trial(project, { exits: ['xplan00001', 'xplan00002'] });
  assert.ok(result.rooms.every((room) => room.change === 'lost'));
  assert.equal(result.summary.lost, 2);
  assert.equal(result.load.after.open, 0);
  assert.equal(result.load.after.sentence, null);
  assert.deepEqual(result.load.after.heavy, []);
  assert.ok(result.exits.every((exit) => exit.blocked));
  assert.equal(result.sentence, 'If West Door and East Door are blocked: 2 rooms have no way out.');
});

test('one link of a three-floor stairwell blocked: the floors below it keep their way, the floor above has none', () => {
  const project = threeFloors();
  const result = trial(project, { connections: [STAIRS_B] });
  assert.equal(result.sentence, 'If Stairs B, Floor 2 to Floor 3 is blocked: 2 rooms have no way out.');
  assert.deepEqual(result.rooms.map((room) => [room.roomId, room.change]), [
    [roomId('1A'), 'same'], [roomId('1B'), 'same'], [roomId('2A'), 'same'], [roomId('2B'), 'same'], [roomId('3A'), 'lost'], [roomId('3B'), 'lost'],
  ]);
  assert.equal(result.summary.moved, 0);
});

test('a scenario corridor lever on cells that are no longer a corridor blocks nothing; one cell left blocks that cell', () => {
  const project = twoStairs();
  const scenario = { levers: [{ kind: 'corridor', floorId: F2, cells: [21, 22], name: 'North Corridor' }, { kind: 'corridor', floorId: F1, cells: [25], name: 'Gone Corridor' }] };
  const floor = project.building.floors[1];
  const erase = (cell) => {
    floor.cells = floor.cells.slice(0, cell) + '.' + floor.cells.slice(cell + 1);
  };
  const one = project.building.floors[0];
  one.cells = one.cells.slice(0, 25) + '.' + one.cells.slice(26);
  erase(21);
  const part = blockedFromScenario(project, scenario);
  assert.deepEqual(part.cells, [{ floorId: F2, cell: 22 }], 'cell 21 is erased on floor 2 and cell 25 on floor 1');
  assert.deepEqual(part.corridors, [{ floorId: F2, name: 'North Corridor', cells: [22] }]);
  assert.equal(part.words.text, 'North Corridor', 'the corridor with no cell left is not worded');
  erase(22);
  const none = blockedFromScenario(project, scenario);
  assert.deepEqual(none, { connections: [], cells: [], corridors: [], words: { parts: [], text: '' } });
  const out = { levers: [{ kind: 'corridor', floorId: F2, cells: [5000, -1, 1.5], name: 'Far' }] };
  assert.deepEqual(blockedFromScenario(project, out).corridors, [], 'cells out of range or not whole numbers');
});

test('blockedOptions and every exported function survive null, non-object and malformed cells and ids', () => {
  const project = twoStairs();
  const junk = { exits: [null, 5, 'xplan00001', {}], connections: 'cplan00001', cells: [null, 'a', 7, {}, { floorId: 1, cell: 2 }, { floorId: F1, cell: 'x' }, { floorId: F1, cell: 1.5 }, { floorId: F1, cell: 22 }] };
  assert.deepEqual(blockedOptions(junk), { avoidExits: ['xplan00001'], avoidConnections: [], shutCells: [{ floorId: F1, cell: 22 }] });
  for (const given of [null, undefined, 'x', 5, true, [], [null], { cells: null }, { cells: 'ab' }, { exits: null, connections: {} }, junk]) {
    assert.doesNotThrow(() => blockedOptions(given), 'blockedOptions');
    assert.doesNotThrow(() => normaliseBlocked(project, given), 'normaliseBlocked');
    assert.doesNotThrow(() => blockedWords(project, given), 'blockedWords');
    assert.doesNotThrow(() => trial(project, given), 'blockedTrial');
    assert.doesNotThrow(() => blockedFromScenario(project, given), 'blockedFromScenario');
  }
  assert.doesNotThrow(() => stairsName(project, null));
  assert.doesNotThrow(() => stairsName(project, {}));
  for (const options of [null, 'x', 5, { avoidExits: 'xplan00001' }, { avoidExits: [null, 3], shutCells: 'a' }]) assert.doesNotThrow(() => trial(project, {}, options), 'options ' + JSON.stringify(options));
  const only = trial(project, junk);
  assert.deepEqual(only.blocked.exits, ['xplan00001'], 'what is well formed still counts');
  assert.equal(blockedWords(project, junk).text, 'West Door and 1 corridor cell on Floor 1 blocked');
});

test('every sentence a page shows has parts, names marked: the trial, each room, the dropped, the scenario', () => {
  const project = twoStairs([[1, 1, 2, '<b>West</b> Door']]);
  project.building.floors[1].name = 'Upper <i>Floor</i>';
  project.building.floors[1].spaces[0].number = '<u>2A</u>';
  const before = structuredClone(project);
  project.building.connections = project.building.connections.filter((connection) => connection.id !== STAIRS_B);
  const result = trial(project, { exits: [EXIT], connections: ['cgone'] });
  assert.equal(joinedText(result.sentenceParts), result.sentence);
  assert.deepEqual(names(result.sentenceParts), ['<b>West</b> Door']);
  assert.equal(result.sentence, 'If <b>West</b> Door is blocked: 2 rooms have no way out.');
  for (const room of result.rooms) {
    assert.equal(room.sentence, 'Its only way out, <b>West</b> Door (1), is blocked.');
    assert.equal(joinedText(room.sentenceParts), room.sentence);
    assert.deepEqual(names(room.sentenceParts), ['<b>West</b> Door']);
  }
  assert.equal(result.droppedParts.length, result.dropped.length);
  assert.deepEqual(result.droppedParts.map(joinedText), result.dropped);
  // a room cut off by a blocked stairs: noRoute's sentence, with the room and floor marked
  const stairs = trial(project, { connections: [STAIRS_A] });
  const cut = stairs.rooms.find((room) => room.change === 'lost');
  assert.ok(cut, 'floor 2 is cut off by stairs A, B being gone');
  assert.equal(joinedText(cut.sentenceParts), cut.sentence);
  assert.deepEqual(names(cut.sentenceParts), ['<u>2A</u>', 'Upper <i>Floor</i>']);
  // a room that has a way has none
  const same = stairs.rooms.find((room) => room.change === 'same');
  assert.equal(same.sentence, null);
  assert.equal(same.sentenceParts, null);
  assert.deepEqual(trial(project, {}).sentenceParts, [{ text: 'Nothing changes: every room goes out the way it did.', name: false }]);
  // dropped: a gone exit by its earlier name, a gone stairs by letter and floors, cells by floor
  const gone = normaliseBlocked(project, { exits: ['xplan00009'], connections: [STAIRS_B], cells: [{ floorId: F2, cell: 0 }] }, before);
  assert.deepEqual(gone.droppedParts.map(joinedText), gone.dropped);
  assert.deepEqual(gone.droppedParts.map(names), [[], ['B', 'Floor 1', 'Upper <i>Floor</i>'], ['Upper <i>Floor</i>']]);
});

test('normaliseBlocked with `previous` after a renamed exit: the exit that stays is blocked by its new name, the one that went by its old', () => {
  const project = twoStairs([[1, 1, 2, 'Old Name'], [1, 8, 2, 'Side Door']]);
  const previous = structuredClone(project);
  project.building.floors[0].exits = [{ ...project.building.floors[0].exits[0], doorName: 'New Name' }];
  const result = normaliseBlocked(project, { exits: ['xplan00001', 'xplan00002'] }, previous);
  assert.deepEqual(result.blocked.exits, ['xplan00001'], 'the renamed exit keeps its id and stays blocked');
  assert.deepEqual(result.dropped, ['Side Door is gone, so it is no longer blocked.']);
  assert.equal(blockedWords(project, result.blocked).text, 'New Name blocked');
  const renamedAway = normaliseBlocked({ ...project, building: { ...project.building, floors: [{ ...project.building.floors[0], exits: [] }, project.building.floors[1]] } }, { exits: ['xplan00001'] }, previous);
  assert.deepEqual(renamedAway.dropped, ['Old Name is gone, so it is no longer blocked.'], 'a gone exit is named as it was in `previous`, not renamed');
});
