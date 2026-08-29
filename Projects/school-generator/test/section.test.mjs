// section.js tests: the marquee's hit test, the clipboard, the paste and the
// stamped row, and the storey-wide move. Run `node --test` from
// Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, createState, addFloor } from '../js/grid.js';
import {
  addShape, addOpening, shapeById, shapeBBox, MAX_SHAPES, LEAF_SINGLE,
} from '../js/shapes.js';
import { addProp, propsOnFloor, addLink } from '../js/props.js';
import {
  MAX_STAMP, sectionBounds, shapesInRect, propsInSection, copySection,
  sectionEmpty, cloneSection, rotateSection, pasteSection, stampRow, moveStorey,
} from '../js/section.js';

const rect = (x0, z0, x1, z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// A state with two classrooms side by side and a desk in the first — the
// smallest school that can meaningfully be repeated.
function build() {
  const s = createState();
  const a = addShape(s, 0, rect(0, 0, 20, 12), { name: 'Room 101', color: '#f5d491' });
  a.fin = 'carpet';
  a.paint = '#aabbcc';
  addOpening(a, 0, 0, 0.25, 3, { leaf: LEAF_SINGLE });
  const b = addShape(s, 0, rect(24, 0, 44, 12), { name: 'Room 102' });
  const desk = addProp(s, 'desk', { x: 5, z: 5, rotationY: 1 });
  return { s, a, b, desk };
}

// ---------- the marquee ----------

test('shapesInRect catches a corner, an enclosure, and a crossing edge', () => {
  const { s, a, b } = build();
  const floor = s.floors[0];
  // A box around one corner of room A and nothing of room B.
  assert.deepEqual(shapesInRect(floor, { x: -2, z: -2 }, { x: 2, z: 2 }).map((x) => x.id), [a.id]);
  // A box wholly inside room B: no corner of the room is in it, the box is.
  assert.deepEqual(shapesInRect(floor, { x: 30, z: 4 }, { x: 34, z: 8 }).map((x) => x.id), [b.id]);
  // A thin band across both rooms — it holds no corner of either, and its
  // centre sits on the gap's edge, inside neither: only the *edge crossing*
  // test catches these, which is why the marquee has one.
  const band = shapesInRect(floor, { x: 10, z: 4 }, { x: 30, z: 8 });
  assert.deepEqual(band.map((x) => x.id), [a.id, b.id]);
  // A box in the corridor between them catches nothing.
  assert.equal(shapesInRect(floor, { x: 21, z: 4 }, { x: 23, z: 8 }).length, 0);
  // The two click orders describe the same box.
  assert.equal(shapesInRect(floor, { x: 2, z: 2 }, { x: -2, z: -2 })[0].id, a.id);
});

// ---------- the clipboard ----------

test('copySection carries geometry, openings, finishes and the props inside', () => {
  const { s, a, b, desk } = build();
  const clip = copySection(s, 0, [a, b]);
  assert.equal(clip.shapes.length, 2);
  assert.equal(clip.props.length, 1, 'the desk sits in room A and comes along');
  assert.equal(clip.shapes[0].name, 'Room 101');
  assert.equal(clip.shapes[0].fin, 'carpet');
  assert.equal(clip.shapes[0].paint, '#aabbcc');
  assert.equal(clip.shapes[0].rings[0].openings.length, 1, 'the door is on the clipboard');
  assert.equal(clip.props[0].id, undefined, 'a clipboard prop carries no id');
  // The clipboard is copies, not references: mutating the original after the
  // copy leaves the clipboard exactly as it was taken.
  a.rings[0].pts[0].x = 999;
  desk.x = 999;
  assert.equal(clip.shapes[0].rings[0].pts[0].x, 0);
  assert.equal(clip.props[0].x, 5);
  assert.equal(copySection(s, 0, []), null, 'nothing selected is nothing copied');
  assert.ok(sectionEmpty(null) && sectionEmpty({ shapes: [] }) && !sectionEmpty(clip));
});

test('propsInSection reads only the storey it was asked about', () => {
  const { s, a } = build();
  addFloor(s);
  addProp(s, 'desk', { x: 5, z: 5, floor: 1 }); // same spot, wrong storey
  assert.equal(propsInSection(s, 0, [a]).length, 1);
  assert.equal(propsInSection(s, 1, [a]).length, 1, 'the upstairs desk from upstairs');
});

test('rotateSection quarter-turns the set and counter-rotates its props', () => {
  const { s, a, b } = build();
  const clip = copySection(s, 0, [a, b]);
  const before = sectionBounds(clip.shapes);
  const rot = clip.props[0].rotationY;
  rotateSection(clip, true);
  const after = sectionBounds(clip.shapes);
  // The set turned about its own centre: the bounds swap extents in place.
  assert.ok(Math.abs((after.x1 - after.x0) - (before.z1 - before.z0)) < 1e-9);
  assert.ok(Math.abs((after.z1 - after.z0) - (before.x1 - before.x0)) < 1e-9);
  assert.ok(Math.abs((after.x0 + after.x1) - (before.x0 + before.x1)) < 1e-9, 'same centre');
  // rotationY counter-rotates against section rotation (the prop convention).
  const want = (rot - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  assert.ok(Math.abs(clip.props[0].rotationY - want) < 1e-9);
  // Four quarter turns come home, prop position included.
  const home = cloneSection(clip);
  for (let i = 0; i < 4; i++) rotateSection(clip, true);
  assert.ok(Math.abs(clip.props[0].x - home.props[0].x) < 1e-9);
  assert.ok(Math.abs(clip.props[0].rotationY - home.props[0].rotationY) < 1e-9);
});

// ---------- paste and stamp ----------

test('pasteSection lands copies with fresh ids, on the storey it was aimed at', () => {
  const { s, a, b } = build();
  const clip = copySection(s, 0, [a, b]);
  addFloor(s);
  const out = pasteSection(s, 1, clip, [{ dx: 8, dz: 4 }]);
  assert.equal(out.shapes, 2);
  assert.equal(out.props, 1);
  assert.equal(out.refused, 0);
  assert.equal(s.floors[0].shapes.length, 2, 'the originals stayed put');
  assert.equal(s.floors[1].shapes.length, 2, 'the copies landed upstairs');
  for (const id of out.ids) {
    const copy = shapeById(s.floors[1], id);
    assert.ok(copy, 'every reported id resolves');
    assert.notEqual(copy.id, a.id);
    assert.notEqual(copy.id, b.id);
  }
  const bb = shapeBBox(shapeById(s.floors[1], out.ids[0]));
  assert.equal(bb.x0, 8);
  assert.equal(bb.z0, 4);
  assert.equal(propsOnFloor(s, 1).length, 1, 'the desk pasted onto the target storey');
  assert.equal(propsOnFloor(s, 1)[0].x, 13);
});

test('a stamp that fills the floor reports how far it got', () => {
  const s = createState();
  const a = addShape(s, 0, rect(0, 0, 8, 8), { name: 'Cell' });
  const clip = copySection(s, 0, [a]);
  for (let i = s.floors[0].shapes.length; i < MAX_SHAPES - 1; i++) {
    addShape(s, 0, rect(0, 0, 4, 4), {});
  }
  const out = pasteSection(s, 0, clip, [{ dx: 10, dz: 0 }, { dx: 20, dz: 0 }]);
  assert.equal(out.shapes, 1, 'one fit');
  assert.equal(out.refused, 1, 'one did not, and was counted rather than thrown');
});

test('stampRow pitches copies by the clipboard extent, rounded out to cells', () => {
  const s = createState();
  const a = addShape(s, 0, rect(0, 0, 22, 12), {}); // 22ft wide: not a cell multiple
  const clip = copySection(s, 0, [a]);
  const row = stampRow(clip, { dx: 0, dz: 0 }, { dx: 50, dz: 3 });
  assert.equal(row.axis, 'x', 'the drag ran mostly east');
  assert.equal(row.pitch, 24, '22ft rounds out to six cells, never five and a half');
  assert.deepEqual(row.offsets, [{ dx: 0, dz: 0 }, { dx: 24, dz: 0 }, { dx: 48, dz: 0 }]);
  // The other axis, the other direction.
  const down = stampRow(clip, { dx: 4, dz: 0 }, { dx: 4, dz: -26 });
  assert.equal(down.axis, 'z');
  assert.equal(down.pitch, 12);
  assert.deepEqual(down.offsets, [{ dx: 4, dz: 0 }, { dx: 4, dz: -12 }, { dx: 4, dz: -24 }]);
  // A drag shorter than one pitch is a single paste, not a refusal…
  assert.equal(stampRow(clip, { dx: 0, dz: 0 }, { dx: 10, dz: 0 }).offsets.length, 1);
  // …and a drag across the county stops at the cap.
  assert.equal(stampRow(clip, { dx: 0, dz: 0 }, { dx: 1e6, dz: 0 }).offsets.length, MAX_STAMP);
});

// ---------- the storey ----------

test('moveStorey slides rooms, wall lines and props together, and only there', () => {
  const { s, a, desk } = build();
  addFloor(s);
  const up = addShape(s, 1, rect(0, 0, 10, 10), { name: 'Upstairs' });
  s.floors[0].walls = [{ id: 90, ax: 0, az: 20, bx: 16, bz: 20, kind: 1 }];
  const out = moveStorey(s, 0, 8, -4);
  assert.equal(out.changed, true);
  assert.equal(out.rooms, 2);
  assert.equal(out.walls, 1);
  assert.equal(out.props, 1);
  assert.equal(shapeBBox(a).x0, 8);
  assert.equal(shapeBBox(a).z0, -4);
  assert.equal(s.floors[0].walls[0].ax, 8);
  assert.equal(s.floors[0].walls[0].bz, 16);
  assert.equal(desk.x, 13);
  assert.equal(desk.z, 1);
  assert.equal(shapeBBox(up).x0, 0, 'the storey above never moved');
});

test('moveStorey reports the links it would not tear off the other storey', () => {
  const { s } = build();
  addFloor(s);
  addLink(s, 'stair', { from: 0, to: 1, x: 10, z: 6 });
  const out = moveStorey(s, 0, CELL, 0);
  assert.equal(out.links, 1, 'the stair stands on two storeys and is counted, not dragged');
  assert.equal(s.links[0].x, 10, 'and it did not move');
  assert.equal(moveStorey(s, 0, 0, 0).changed, false, 'sliding by nothing changes nothing');
  assert.equal(moveStorey(s, 9, 4, 0).changed, false, 'a storey that does not exist');
});
