// The Safety section's plain functions (SV2-67b): the exits' colours and how
// far apart they are in both themes, a way out cut into runs a floor, the
// first line, a room's line in the Door cards list, and the cursor's
// sentence over a room. The section in a page is test/browser/safety.mjs.
//
//   node test/ui/safety.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { exitColours, runsOf, apart, oklab, EXIT_APART, EXIT_PRESETS } from '../../ui/surface/overlays/evacuation.js';
import { contrast } from '../../ui/colour.js';
import { safetyPicture, firstLine, roomLine } from '../../ui/safety/model.js';
import { cursorLine, REPEAT_SAYS, GONE_SAYS } from '../../ui/safety/index.js';
import { sampleSchool } from '../../data/sample-school.js';
import { buildGraph } from '../../engine/graph.js';

// the corridor of each theme (ui/tokens.css), which the colours are made 3:1 against
const THEMES = { light: { corridor: '#ffffff' }, dark: { corridor: '#2a2f36' } };

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

for (const [name, theme] of Object.entries(THEMES)) {
  test('the ten exit colours in the ' + name + ' theme: each 3:1 on the corridor, and every pair at least ' + EXIT_APART + ' apart in OKLab', () => {
    const colours = exitColours(10, theme);
    assert.equal(colours.length, 10);
    for (const colour of colours) assert.ok(contrast(colour, theme.corridor) >= 3, colour + ' is ' + contrast(colour, theme.corridor).toFixed(2) + ':1 on ' + theme.corridor);
    const close = [];
    for (let i = 0; i < colours.length; i += 1) {
      for (let j = i + 1; j < colours.length; j += 1) {
        const d = apart(colours[i], colours[j]);
        if (d < EXIT_APART) close.push('exits ' + (i + 1) + ' and ' + (j + 1) + ' (' + colours[i] + ', ' + colours[j] + ') are ' + d.toFixed(3) + ' apart');
      }
    }
    assert.deepEqual(close, [], name + ': ' + close.join('; '));
  });
}

test('exits 7 and 9, alike on the light theme before (#8c6d31 and #9e962c), are far apart now', () => {
  const colours = exitColours(10, THEMES.light);
  assert.ok(apart('#8c6d31', '#9e962c') < EXIT_APART, 'the pair called alike is not under the threshold: the threshold tests nothing');
  assert.ok(apart(colours[6], colours[8]) >= EXIT_APART, colours[6] + ' and ' + colours[8]);
});

test('past ten exits the colours repeat in key order, and the key has the words for it', () => {
  const colours = exitColours(12, THEMES.light);
  assert.equal(EXIT_PRESETS.length, 10);
  assert.equal(colours[10], colours[0]);
  assert.equal(colours[11], colours[1]);
  assert.equal(new Set(colours.slice(0, 10)).size, 10);
  assert.equal(REPEAT_SAYS(10), 'The colours repeat after exit 10: the number on each room says which exit.');
  // a theme with no corridor colour is read as white
  assert.deepEqual(exitColours(3, {}), exitColours(3, THEMES.light));
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
