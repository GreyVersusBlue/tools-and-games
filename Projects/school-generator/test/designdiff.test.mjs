// designdiff.test.mjs — what changed between two designs. Built from the
// state the editor actually produces (a scratch lattice, baked), and from
// the sample school, because a differ over the save format is only as honest
// as the saves it is shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { shapesOf } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { serialize, deserialize } from '../js/save-load.js';
import { clone } from '../js/history.js';
import { addProp } from '../js/props.js';
import { designDiff, diffHeadline, marksOn, RECORD_SENTENCES, CHANGES } from '../js/designdiff.js';

function twoRooms() {
  const s = createState();
  sheet(s, 0).box(2, 2, 7, 7, { name: 'Room 101' }).box(10, 2, 15, 7, { name: 'Room 102' }).bake();
  return s;
}

// The differ reads what deserialize hands back; every fixture goes through
// the file so a test never compares two live states that share an object.
const roundTrip = (s) => deserialize(serialize(s));

test('two copies of the same design differ in nothing', () => {
  const s = twoRooms();
  const d = designDiff(roundTrip(s), roundTrip(s));
  assert.equal(d.changes.length, 0);
  assert.deepEqual(d.sentences, []);
  assert.deepEqual(d.marks, []);
  assert.equal(diffHeadline(d), 'Nothing changed.');
  assert.equal(designDiff(null, null).changes.length, 0, 'nothing in, nothing out');
  const sample = buildSampleSchool();
  assert.equal(designDiff(roundTrip(sample), roundTrip(sample)).changes.length, 0,
    'the sample school against itself');
});

test('a room that appears, one that vanishes, and one that grows', () => {
  const before = twoRooms();
  const after = clone(roundTrip(before));
  // Room 103 appears, Room 102 vanishes, Room 101 grows a cell to the east.
  const s2 = createState();
  sheet(s2, 0).box(2, 2, 8, 7, { name: 'Room 101' }).box(2, 10, 7, 14, { name: 'Room 103' }).bake();
  // Keep 101's id so it matches by id and not by name — and give 103 an id
  // nobody in `before` had, which is what a fresh room gets in the tool:
  // ids count past the highest ever used and are never handed out twice.
  const r101 = shapesOf(s2.floors[0]).find((x) => x.name === 'Room 101');
  r101.id = shapesOf(before.floors[0]).find((x) => x.name === 'Room 101').id;
  shapesOf(s2.floors[0]).find((x) => x.name === 'Room 103').id = 500;
  const d = designDiff(roundTrip(before), roundTrip(s2));
  const kinds = d.changes.map((c) => `${c.kind}:${c.change}:${c.name || ''}`).sort();
  assert.deepEqual(kinds, ['room:added:Room 103', 'room:changed:Room 101', 'room:removed:Room 102']);
  assert.match(d.sentences.find((t) => t.startsWith('Room 103')), /appeared — \d+ ft², Level 1/);
  assert.match(d.sentences.find((t) => t.startsWith('Room 102')), /vanished/);
  assert.match(d.sentences.find((t) => t.startsWith('Room 101')), /grew from \d+ to \d+ ft²/);
  assert.equal(diffHeadline(d), '1 room appeared, 1 room vanished, 1 room changed.');
  // Marks: one per room, on the storey, in world feet, the changed one
  // carrying the outline it had before.
  const marks = marksOn(d, 0);
  assert.equal(marks.length, 3);
  assert.ok(marks.every((m) => CHANGES.includes(m.change) && m.pts.length >= 4));
  const changed = marks.find((m) => m.change === 'changed');
  assert.ok(changed.was && changed.was.length >= 4, 'a changed room remembers its old outline');
  assert.equal(marksOn(d, 1).length, 0);
  void after;
});

test('a room erased and redrawn under the same name is one room that changed', () => {
  const before = twoRooms();
  const s2 = createState();
  sheet(s2, 0).box(2, 2, 7, 7, { name: 'Room 101' }).box(10, 3, 15, 8, { name: 'Room 102' }).bake();
  // Fresh ids everywhere: nothing matches by id.
  for (const sh of shapesOf(s2.floors[0])) sh.id += 1000;
  const d = designDiff(roundTrip(before), roundTrip(s2));
  const rooms = d.changes.filter((c) => c.kind === 'room');
  assert.equal(rooms.length, 1, `${d.sentences.join(' | ')}`);
  assert.equal(rooms[0].change, 'changed');
  assert.equal(rooms[0].name, 'Room 102');
  assert.match(rooms[0].sentence, /moved \d+ ft/);
});

test('a rename, a refinish and a door are each their own clause', () => {
  const before = twoRooms();
  const after = clone(roundTrip(before));
  const room = shapesOf(after.floors[0]).find((x) => x.name === 'Room 101');
  room.name = 'Art Room';
  room.fin = 'carpet';
  room.rings[0].openings.push({ seg: 0, t: 0.5, w: 3 });
  const d = designDiff(roundTrip(before), roundTrip(after));
  assert.equal(d.changes.length, 1);
  const c = d.changes[0];
  assert.ok(c.whats.includes('renamed from Room 101 to Art Room'), c.whats.join(' | '));
  assert.ok(c.whats.includes('gained a door'), c.whats.join(' | '));
  assert.ok(c.whats.includes('was refinished'), c.whats.join(' | '));
  assert.match(c.sentence, /^Art Room renamed from Room 101 to Art Room, gained a door, was refinished \(Level 1\)\.$/);
});

test('storeys, furniture, stairs and the sheet each read as a sentence', () => {
  const before = twoRooms();
  const after = clone(roundTrip(before));
  addFloor(after);
  sheet(after, 1).box(2, 2, 7, 7, { name: 'Room 201' }).bake();
  addProp(after, 'desk', { floor: 0, x: 20, z: 20 });
  addProp(after, 'desk', { floor: 0, x: 24, z: 20 });
  after.links.push({ id: 900, type: 'stair', from: 0, to: 1, x: 30, z: 30, rotationY: 0, data: {} });
  after.w += 4;
  const d = designDiff(roundTrip(before), roundTrip(after));
  const s = d.sentences.join('\n');
  assert.match(s, /Level 2 was added, with 1 room\./);
  assert.match(s, /2 pieces of furniture placed on Level 1\./);
  assert.match(s, /A stair was added between Level 1 and Level 2\./);
  assert.match(s, /The sheet was resized from \d+ × \d+ to \d+ × \d+ cells\./);
  // The stair marks both storeys it joins; the new storey's room marks itself.
  assert.ok(marksOn(d, 0).some((m) => m.kind === 'link' && m.change === 'added'));
  assert.ok(marksOn(d, 1).some((m) => m.kind === 'link' && m.change === 'added'));
  assert.ok(marksOn(d, 1).some((m) => m.kind === 'room' && m.change === 'added'));
  // ...and the same design the other way round says removed.
  const back = designDiff(roundTrip(after), roundTrip(before));
  assert.match(back.sentences.join('\n'), /Level 2 was removed, and 1 room with it\./);
  assert.match(back.sentences.join('\n'), /2 pieces removed on Level 1\./);
  assert.match(back.sentences.join('\n'), /A stair between Level 1 and Level 2 was removed\./);
});

test('the design-wide records each earn one sentence, and only when they differ', () => {
  const before = roundTrip(twoRooms());
  const after = clone(before);
  after.code = { edition: 'ibc2018', sprinklered: true };
  after.env = { ...(after.env || {}), minutes: 15 * 60 };
  const d = designDiff(before, after);
  assert.ok(d.sentences.includes(RECORD_SENTENCES.code));
  assert.ok(d.sentences.includes(RECORD_SENTENCES.env));
  assert.equal(d.changes.filter((c) => c.kind === 'record').length, 2);
  assert.equal(d.marks.length, 0, 'a record change has nowhere to draw');
  assert.equal(diffHeadline(d), '2 other changes.');
});

test('the sample school, edited, reads as what was done to it', () => {
  const before = roundTrip(buildSampleSchool());
  const after = clone(before);
  const gone = shapesOf(after.floors[0])[0];
  after.floors[0].shapes = shapesOf(after.floors[0]).slice(1);
  after.props = after.props.filter((p) => p.floor !== 0 || p.x > 40);
  const d = designDiff(before, after);
  assert.ok(d.sentences.some((t) => t.startsWith(gone.name || 'an unnamed room') && /vanished/.test(t)),
    d.sentences.join(' | '));
  assert.ok(d.sentences.some((t) => /pieces removed on Level 1/.test(t)), d.sentences.join(' | '));
  assert.equal(d.summary.rooms.removed, 1);
  assert.ok(marksOn(d, 0).filter((m) => m.kind === 'prop' && m.change === 'removed').length > 1);
});
