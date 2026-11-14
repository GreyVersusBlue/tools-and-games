// The Safety section's plain functions (SV2-67b): OKLab, a way out cut into
// runs a floor, the first line, a room's line in the Door cards list, and the
// cursor's sentence over a room. The section in a page is
// test/browser/safety.mjs. The exits' colours are tokens of
// ui/safety/safety.css since SV2-72c, held by test/ui/exit-colours.test.mjs.
//
// SV2-109 adds the trial: the picture under a blocked set, the route cache, exit numbers
// pinned to the engine's, the cross's contrast over every exit colour, and the marks the map draws.
//
//   node test/ui/safety.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runsOf, apart, oklab, blockedOverlay, blockedCross, blockedRingHolds, BLOCKED_RING, BLOCKED_EDGE } from '../../ui/surface/overlays/evacuation.js';
import { safetyPicture, stepFreePicture, firstLine, roomLine, blockedKey, blockedCount, lostInTrial, NO_BLOCKED } from '../../ui/safety/model.js';
import { AS_BUILT_LINE } from '../../ui/safety/ways.js';
import { stepFreeReport } from '../../engine/step-free.js';
import { cursorLine, REPEAT_SAYS, GONE_SAYS, SAFETY_TABS, BLOCKED_CURSOR, LOST_IN_TRIAL, bandShort } from '../../ui/safety/index.js';
import { spoken, blockedSays, stairsOfBuilding } from '../../ui/safety/what-if.js';
import { sampleSchool } from '../../data/sample-school.js';
import { buildGraph } from '../../engine/graph.js';
import { createRouteCache } from '../../engine/routing.js';
import { exitNumbers, EXIT_UNNAMED } from '../../engine/exit-load.js';
import { contrast } from '../../ui/colour.js';

function sample() {
  const project = sampleSchool();
  return { project, picture: safetyPicture(project, buildGraph(project)) };
}

test('OKLab: white, black and a known colour where they should be, and a distance of nothing between a colour and itself', () => {
  const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-3);
  assert.ok(near(oklab('#ffffff'), [1, 0, 0]), JSON.stringify(oklab('#ffffff')));
  assert.ok(near(oklab('#000000'), [0, 0, 0]), JSON.stringify(oklab('#000000')));
  // pure red, from Ottosson's own table
  assert.ok(near(oklab('#ff0000'), [0.628, 0.2249, 0.1258]), JSON.stringify(oklab('#ff0000')));
  assert.equal(apart('#8c6d31', '#8c6d31'), 0);
  assert.throws(() => oklab('not a colour'), TypeError);
});

test('past eight exits the key has the words for the colours repeating', () => {
  assert.equal(REPEAT_SAYS(8), 'The colours repeat after exit 8: the number on each room says which exit.');
});

test('runsOf: a way out down two stairs is three runs, one a floor, the first starting at the room\'s door', () => {
  const { picture } = sample();
  const route = picture.byRoom.get('rsample303').route;
  const runs = runsOf(route);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((run) => run[0].floorId), ['fsample003', 'fsample002', 'fsample001']);
  assert.equal(runs[0][0], route.from, 'the first run does not start at the door the room is left by');
  // every cell of the route is in one run, in order
  assert.deepEqual(runs.flat().slice(1), route.cells);
  for (const run of runs) assert.ok(run.every((place) => place.floorId === run[0].floorId), 'a run crosses floors');
  // a room on the exit's floor: one run
  assert.equal(runsOf(picture.byRoom.get('rsample101').route).length, 1);
  // no way out, or no route at all: no runs
  assert.deepEqual(runsOf({ ok: false }), []);
  assert.deepEqual(runsOf(null), []);
});

test('firstLine: every room counted with the exits used; a picked room by name, floor, exit and time; a picked room with no way out in the engine\'s words', () => {
  const { project, picture } = sample();
  const text = (parts) => parts.map((part) => part.text).join('');
  assert.equal(text(firstLine(project, picture, null)), 'Every room’s way out, coloured by the exit it uses: 13 rooms to 2 exits.');
  const one = firstLine(project, picture, 'rsample303');
  assert.equal(text(one), 'Room 303 on Floor 3: out by Door A in 3 min 49 s of walking.');
  // the typed names are set apart, the words are not
  assert.deepEqual(one.filter((part) => part.name).map((part) => part.text), ['Room 303', 'Floor 3', 'Door A']);
  const lost = { ...picture, byRoom: new Map(picture.byRoom) };
  lost.byRoom.set('rsample303', { ...picture.byRoom.get('rsample303'), ok: false, sentence: 'Room 303 on Floor 3 does not open onto a corridor.' });
  assert.equal(text(firstLine(project, lost, 'rsample303')), 'Room 303 has no way out. Room 303 on Floor 3 does not open onto a corridor.');
  // a room picked that the picture does not have reads as every room
  assert.equal(text(firstLine(project, picture, 'rgone')), text(firstLine(project, picture, null)));
});

test('roomLine and the cursor\'s sentence: the exit by name, and on the cursor by the number the key gives it', () => {
  const { picture } = sample();
  const row = picture.byRoom.get('rsample303');
  assert.equal(roomLine(row, picture), 'Door A · 3 min 49 s · Turn left out of the door.');
  assert.equal(cursorLine(row, picture), 'Room 303: out by Door A, number 1 in the key. Enter shows its way out.');
  const gym = picture.byRoom.get('rsamplegym');
  assert.match(cursorLine(gym, picture), /^Gym: out by Door B, number 2 in the key\./);
  const none = { ...row, ok: false, sentence: 'Room 303 on Floor 3 does not open onto a corridor.' };
  assert.equal(roomLine(none, picture), none.sentence);
  assert.equal(cursorLine(none, picture), 'Room 303: ' + none.sentence);
  assert.equal(GONE_SAYS('Room 302'), 'Room 302 is no longer in the building; showing every room.');
});

// ---- SV2-109: the trial

const blocked = (parts) => ({ exits: [], connections: [], cells: [], ...parts });

test('exit numbers: the screen\'s are exitNumbers\', on the sample and on a building with an unnamed exit', () => {
  const { project, picture } = sample();
  const engine = exitNumbers(project);
  assert.deepEqual(picture.exits.map((exit) => [exit.exitId, exit.number]), Array.from(engine));
  // an unnamed exit keeps its number and gets the words for it
  const other = sampleSchool();
  other.building.floors[0].exits[1].doorName = '';
  const again = safetyPicture(other, buildGraph(other));
  assert.deepEqual(again.exits.map((exit) => [exit.exitId, exit.number]), Array.from(exitNumbers(other)));
  assert.equal(again.exits[1].name, EXIT_UNNAMED('Floor 1'));
  // a blocked exit keeps its number
  const trial = safetyPicture(project, buildGraph(project), { blocked: blocked({ exits: [picture.exits[0].exitId] }) });
  assert.deepEqual(trial.exits.map((exit) => exit.number), [1, 2]);
});

test('the picture with nothing blocked is the plain pass: no trial, nothing dropped, Door A flagged heavy with its sentence', () => {
  const { picture } = sample();
  assert.equal(picture.trial, null);
  assert.deepEqual(picture.dropped, []);
  assert.deepEqual(picture.blocked, NO_BLOCKED);
  assert.deepEqual(picture.exits.map((exit) => [exit.heavy, exit.blocked, exit.was]), [[true, false, null], [false, false, null]]);
  assert.equal(picture.load.sentence, 'Door A (1) is the way out for rooms holding 520 of 640 people at full capacity, 81 %, where an even share of the 2 exits would be 320.');
});

test('a trial picture: the trial\'s ways, the "was" figures, the blocked exit, nothing flagged, and rooms cut off say why', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const plain = safetyPicture(project, graph);
  const doorA = plain.exits[0].exitId;
  const trial = safetyPicture(project, graph, { blocked: blocked({ exits: [doorA] }) });
  assert.ok(trial.trial);
  assert.deepEqual(trial.exits[0].was, { rooms: 12, people: 520 });
  assert.equal(trial.exits[0].blocked, true);
  assert.equal(trial.exits[0].rooms, 0);
  assert.deepEqual(trial.exits[1].was, { rooms: 1, people: 120 });
  assert.equal(trial.exits[1].rooms, 13);
  assert.deepEqual(trial.exits.map((exit) => exit.heavy), [false, false], 'a blocked exit is never flagged, and one open exit has no even share');
  assert.equal(trial.load.sentence, 'Every room leaves by Door B: it is the only exit not blocked.');
  assert.equal(trial.rows.every((row) => row.ok && row.exitId === trial.exits[1].exitId), true);
  // both exits blocked: every room is cut off and says which exits
  const both = safetyPicture(project, graph, { blocked: blocked({ exits: plain.exits.map((exit) => exit.exitId) }) });
  assert.equal(both.missing.length, 13);
  assert.match(both.byRoom.get('rsample101').sentence, /^Every exit it can reach is blocked: Door A \(1\) and Door B \(2\)\.$/);
  // Stairs B blocked: Floor 3 has no way out, with noRoute's words
  const upper = safetyPicture(project, graph, { blocked: blocked({ connections: ['csample00b'] }) });
  assert.ok(upper.missing.length >= 1);
  assert.equal(upper.byRoom.get('rsample303').ok, false);
  assert.equal(upper.byRoom.get('rsample101').ok, true);
  // a stairs and an elevator that is not one: an elevator is dropped with its sentence
  const lift = safetyPicture(project, graph, { blocked: blocked({ connections: ['csample00d'] }) });
  assert.equal(lift.trial, null);
  assert.deepEqual(lift.dropped, ['Elevator D is never used in an evacuation, so it is not blocked.']);
});

test('a row\'s first step is worked out when it is read, and is the same step as the plain picture\'s', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const plain = safetyPicture(project, graph);
  const trial = safetyPicture(project, graph, { blocked: blocked({ connections: ['csample00b'] }) });
  const descriptor = Object.getOwnPropertyDescriptor(trial.byRoom.get('rsample101'), 'first');
  assert.equal(typeof descriptor.get, 'function', 'first is not lazy');
  assert.equal(trial.byRoom.get('rsample101').first, plain.byRoom.get('rsample101').first);
  assert.equal(roomLine(trial.byRoom.get('rsample101'), trial), roomLine(plain.byRoom.get('rsample101'), plain));
});

test('the route cache: a second plain pass searches nothing, a blocked exit searches nothing, a blocked stairs searches again', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const cache = createRouteCache(2 * 13 + 8);
  const options = { cache, geometryVersion: 1 };
  const plain = safetyPicture(project, graph, options);
  const first = cache.searches;
  assert.ok(first > 0, 'the first pass searched nothing');
  safetyPicture(project, graph, options);
  assert.equal(cache.searches, first, 'a second plain pass searched again');
  safetyPicture(project, graph, { ...options, blocked: blocked({ exits: [plain.exits[0].exitId] }) });
  assert.equal(cache.searches, first, 'a blocked exit worked out a field of its own');
  safetyPicture(project, graph, { ...options, blocked: blocked({ connections: ['csample00b'] }) });
  assert.ok(cache.searches > first, 'a blocked stairs found its fields already worked out');
  // the plain pass is still there after the stairs'
  const kept = cache.searches;
  safetyPicture(project, graph, options);
  assert.equal(cache.searches, kept, 'the stairs\' trial pushed the plain pass out of the cache');
  assert.ok(cache.bytes > 0);
});

test('the Step-free view under a trial: a blocked exit is left out, and a blocked stairs changes nothing', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const plain = safetyPicture(project, graph);
  const open = stepFreePicture(project, graph, plain);
  assert.deepEqual(open.counts, { exit: 5, refuge: 5, none: 3 });
  assert.deepEqual(open.blocked, NO_BLOCKED);
  const doorB = plain.exits[1].exitId;
  const shut = stepFreePicture(project, graph, safetyPicture(project, graph, { blocked: blocked({ exits: [doorB] }) }));
  assert.deepEqual(shut.counts, { exit: 0, refuge: 5, none: 8 });
  assert.equal(shut.rooms.some((room) => room.exitId === doorB), false);
  const stairs = stepFreePicture(project, graph, safetyPicture(project, graph, { blocked: blocked({ connections: ['csample00b'] }) }));
  assert.deepEqual(stairs.counts, open.counts, 'a blocked stairs changed the step-free ways');
});

test('blockedKey and blockedCount: one key a set, the count of every kind', () => {
  assert.equal(blockedCount(NO_BLOCKED), 0);
  assert.equal(blockedCount(blocked({ exits: ['a'], connections: ['b'], cells: [{ floorId: 'f', cell: 3 }] })), 3);
  assert.notEqual(blockedKey(blocked({ exits: ['a'] })), blockedKey(blocked({ connections: ['a'] })));
  assert.equal(blockedKey(blocked({ exits: ['a'] })), blockedKey(blocked({ exits: ['a'] })));
});

test('the tabs, and the words of the What if tab', () => {
  assert.deepEqual(SAFETY_TABS.map((tab) => tab.id), ['exits', 'cards', 'stepfree', 'whatif', 'prints']);
  assert.deepEqual(SAFETY_TABS.map((tab) => tab.label), ['Exits', 'Door cards', 'Step-free', 'What if', 'Prints']);
  assert.equal(blockedSays(2), '2 blocked');
  assert.equal(bandShort(2), 'Trial · 2 blocked');
  assert.equal(BLOCKED_CURSOR('Stairs B, Floor 2 to Floor 3'), 'Stairs B, Floor 2 to Floor 3, blocked in this trial');
  assert.equal(spoken(45), '45 seconds');
  assert.equal(spoken(1), '1 second');
  assert.equal(spoken(80), '1 minute 20 seconds');
  assert.equal(spoken(120), '2 minutes');
  // stairs only: an elevator is never offered
  assert.deepEqual(stairsOfBuilding(sampleSchool()).map((connection) => connection.id), ['csample00a', 'csample00b', 'csample0up']);
});

// A recording stand-in for the canvas: what was drawn, and in what colours
function recorder() {
  const calls = [];
  const g = { calls };
  for (const name of ['save', 'restore', 'beginPath', 'fill', 'stroke', 'moveTo', 'lineTo']) g[name] = (...args) => calls.push([name, ...args]);
  g.arc = (...args) => calls.push(['arc', ...args]);
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap']) {
    Object.defineProperty(g, name, { set: (value) => calls.push([name, value]), get: () => undefined });
  }
  return g;
}

test('the trial\'s marks: a ring and a cross at each blocked cell of the floor being drawn, none elsewhere, none when nothing is read', () => {
  const view = { x: 0, y: 0, size: 10 };
  const floor = { id: 'f1', width: 10, height: 10 };
  const theme = { problem: '#b3261e' };
  const g = recorder();
  blockedOverlay(() => null)(g, view, floor, theme);
  assert.deepEqual(g.calls, [], 'drew something with nothing to draw');
  const draw = blockedOverlay(() => ({ marks: [{ floorId: 'f1', cell: 23 }, { floorId: 'f2', cell: 5 }] }));
  const h = recorder();
  draw(h, view, floor, theme);
  const arcs = h.calls.filter((call) => call[0] === 'arc');
  assert.equal(arcs.length, 1, 'one mark is on this floor');
  // cell 23 is column 3, row 2: its middle is (35, 25); the ring is at least 7 px
  assert.deepEqual(arcs[0].slice(1, 3), [35, 25]);
  assert.ok(arcs[0][3] >= 7, 'the ring is ' + arcs[0][3] + ' px');
  const styles = h.calls.filter((call) => call[0] === 'fillStyle' || call[0] === 'strokeStyle').map((call) => call[1]);
  assert.deepEqual(styles, [BLOCKED_RING, BLOCKED_EDGE, blockedCross('#b3261e')]);
  assert.equal(h.calls.filter((call) => call[0] === 'lineTo').length, 2, 'the cross is two strokes');
});

// ---- the contrast case: the ring and the cross over every exit colour, in both themes

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bare = (file) => readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// the first eight --exit-n of safety.css are the light theme's, the next eight the dark theme's; the first
// --problem of tokens.css is the light theme's, the second the dark's (test/ui/exit-colours.test.mjs holds the blocks)
const exitColours = (text) => Array.from(text.matchAll(/--exit-(\d):\s*(#[0-9a-fA-F]{6})/g)).map((match) => match[2]);
const problems = Array.from(bare('ui/tokens.css').matchAll(/--problem:\s*(#[0-9a-fA-F]{6})/g)).map((match) => match[1]);
const sets = exitColours(bare('ui/safety/safety.css'));

test('the cross holds 3:1 on its white ring, and the ring holds 3:1 over each of the eight exit colours, in both themes', () => {
  assert.equal(sets.length >= 16, true, 'read ' + sets.length + ' exit colours');
  assert.ok(problems.length >= 2, 'read ' + problems.length + ' problem colours');
  const checked = [];
  for (const [theme, colours, problem] of [['light', sets.slice(0, 8), problems[0]], ['dark', sets.slice(8, 16), problems[1]]]) {
    const cross = blockedCross(problem);
    const onRing = contrast(cross, BLOCKED_RING);
    assert.ok(onRing >= 3, theme + ': the cross ' + cross + ' is ' + onRing.toFixed(2) + ':1 on the ring');
    colours.forEach((colour, i) => {
      const held = blockedRingHolds(colour);
      checked.push(theme + ' ' + (i + 1));
      assert.ok(held >= 3, theme + ' exit ' + (i + 1) + ' ' + colour + ': neither the white ring nor its edge is 3:1 (best ' + held.toFixed(2) + ')');
    });
  }
  assert.equal(checked.length, 16);
  // the dark theme's --problem is paler than the white ring can carry: the cross is a darker variant of it
  assert.notEqual(blockedCross(problems[1]), problems[1]);
  assert.equal(blockedCross(problems[0]), problems[0]);
});

// ---- SV2-109b

test('a room a trial leaves with no way out: lostInTrial finds it, and the cursor says so in words', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const plain = safetyPicture(project, graph);
  assert.deepEqual(lostInTrial(plain), [], 'no trial, no room lost in it');
  const trial = safetyPicture(project, graph, { blocked: blocked({ connections: ['csample00b'] }) });
  const lost = lostInTrial(trial);
  assert.ok(lost.length >= 1);
  assert.ok(lost.every((row) => !row.ok && trial.byRoom.get(row.roomId) === row), 'a lost room is a row of the picture, with no way out');
  assert.equal(lostInTrial(trial), lost, 'one answer a picture');
  assert.equal(lost.some((row) => row.roomId === 'rsample101'), false, 'Room 101 keeps its way out');
  const row = trial.byRoom.get('rsample303');
  assert.equal(cursorLine(row, trial), 'Room 303, no way out in this trial');
  assert.equal(LOST_IN_TRIAL('Room 302'), 'Room 302, no way out in this trial');
  // a room with no way out before the trial too keeps the engine's words
  const none = { ...plain.byRoom.get('rsample101'), ok: false, sentence: 'Room 101 does not open onto a corridor.' };
  assert.equal(cursorLine(none, plain), 'Room 101: Room 101 does not open onto a corridor.');
});

test('the trial line is one constant, in the words of DESIGN 14.7 item 4', () => {
  assert.equal(AS_BUILT_LINE, 'Printed as built, not this trial.');
  const doorcards = readFileSync(join(root, 'ui/safety/doorcards.js'), 'utf8');
  assert.match(doorcards, /AS_BUILT_LINE/);
  assert.doesNotMatch(doorcards, /not this trial\./, 'door cards keep a copy of the words');
});

test('the Step-free picture under a trial takes the route cache\'s options and the report it is given', () => {
  const project = sampleSchool();
  const graph = buildGraph(project);
  const cache = createRouteCache(3 * 13 + 8);
  const options = { cache, geometryVersion: 1 };
  const plain = safetyPicture(project, graph);
  const trial = safetyPicture(project, graph, { blocked: blocked({ exits: [plain.exits[1].exitId] }) });
  const report = stepFreeReport(project, graph);
  const before = cache.searches;
  const first = stepFreePicture(project, graph, trial, { ...options, report });
  assert.ok(cache.searches > before, 'the step-free ways were not worked out through the cache');
  assert.equal(first.report, report, 'the report was worked out again');
  const warm = cache.searches;
  const second = stepFreePicture(project, graph, trial, { ...options, report });
  assert.equal(cache.searches, warm, 'the same trial searched again');
  assert.deepEqual(second.counts, first.counts);
  // the same picture without a trial keeps to its own passes (it is never given the cache's)
  const open = stepFreePicture(project, graph, plain, { ...options, report });
  assert.deepEqual(open.counts, { exit: 5, refuge: 5, none: 3 });
});

test('what-if.js compares an exit\'s name with EXIT_UNNAMED, not with a copy of its words', () => {
  const source = readFileSync(join(root, 'ui/safety/what-if.js'), 'utf8');
  assert.match(source, /EXIT_UNNAMED\(/);
  assert.doesNotMatch(source, /The exit on /);
});
