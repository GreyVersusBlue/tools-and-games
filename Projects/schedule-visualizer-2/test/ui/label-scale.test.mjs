// The renderer's labelScale (SV2-31): presentation mode draws every label of
// the map larger, caps included, by one factor handed to renderer.draw and on
// to the overlays. Drawn in plain Node on a 2D context that records each text
// with the size it was written at. At 1 (or with no labelScale) the writes
// are the same as before the option existed; at 1.5 every size is 1.5 times
// as large where the label has the room, never past 1.5 times its cap, and
// a label with no room is fitted or left out as at 1. The map in a page is
// test/browser/present.mjs.
//
//   node test/ui/label-scale.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../../ui/surface/renderer.js';
import { createViewport, drawnBox, CELL } from '../../ui/surface/viewport.js';
import { lanesOverlay } from '../../ui/surface/overlays/lanes.js';
import { sampleSchool } from '../../data/sample-school.js';

// the light theme's tokens (ui/tokens.css), as the canvas reads them
const TOKENS = {
  '--paper': '#f6f3ec', '--card': '#fffdf8', '--ink': '#1f2328', '--ink-2': '#515761', '--line': '#d8d3c8', '--line-strong': '#857f73',
  '--accent': '#0f6e66', '--accent-ink': '#ffffff', '--accent-soft': '#d9ece9', '--problem': '#b3261e', '--warning': '#925d00',
  '--grid': '#e8e3d8', '--corridor': '#ffffff', '--corridor-edge': '#d8d3c8', '--stairs': '#d9ece9', '--room-default': '#e9e4d9', '--font-plan': 'sans-serif',
};
globalThis.document = globalThis.document || { documentElement: { dataset: {} } };
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: (name) => TOKENS[name] || '' }));

// A context that keeps every text written with the size of its font; a
// character is 0.55 of the size wide.
function recorder() {
  const writes = [];
  const state = { font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', letterSpacing: '0px' };
  const stack = [];
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)[1]);
  const ctx = {
    writes,
    measureText: (text) => ({ width: String(text).length * size() * 0.55 }),
    fillText(text) { writes.push({ how: 'fill', text: String(text), size: size(), font: state.font }); },
    strokeText(text) { writes.push({ how: 'stroke', text: String(text), size: size(), font: state.font }); },
    save() { stack.push({ ...state }); },
    restore() { const was = stack.pop(); if (was) Object.assign(state, was); },
  };
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'clip', 'setLineDash', 'closePath', 'translate', 'rotate', 'quadraticCurveTo', 'bezierCurveTo']) ctx[name] = () => {};
  for (const key of Object.keys(state)) Object.defineProperty(ctx, key, { get: () => state[key], set: (value) => { state[key] = value; }, enumerable: true });
  return ctx;
}

// One floor drawn at a cell size of `cell` px, its box at the window's top left.
function drawFloor(project, floor, cell, extra) {
  const g = recorder();
  const canvas = { isConnected: true, width: 0, height: 0, getContext: () => g };
  const renderer = createRenderer(canvas);
  const view = createViewport();
  view.resize(4000, 3000);
  const box = drawnBox(floor);
  view.zoom = cell / CELL;
  view.x = 40 - box.x * cell;
  view.y = 40 - box.y * cell;
  renderer.resize(4000, 3000, 1);
  renderer.draw({ project, floor, view, selection: [], hover: null, cursor: null, preview: null, ...extra });
  assert.equal(view.size, cell, 'the view is not at the cell size asked');
  return g.writes;
}

const fills = (writes) => writes.filter((w) => w.how === 'fill');
// the largest size each text was written at
function sizes(writes) {
  const by = new Map();
  for (const w of fills(writes)) by.set(w.text, Math.max(by.get(w.text) || 0, w.size));
  return by;
}

function kinds(project, floor) {
  return {
    corridors: floor.corridors.filter((each) => each.name !== '').map((each) => each.name.toUpperCase()),
    doors: floor.exits.map((exit) => exit.doorName).filter((name) => name !== ''),
    rooms: floor.spaces.filter((space) => space.kind === 'room' && space.number.trim() !== '').map((space) => space.number),
  };
}

test('labelScale 1, and no labelScale, write exactly what the renderer wrote before the option: every text at every size', () => {
  const project = sampleSchool();
  for (const floor of project.building.floors) {
    for (const cell of [10, 16, 24, 40, 64]) {
      const plain = drawFloor(project, floor, cell, {});
      assert.deepEqual(drawFloor(project, floor, cell, { labelScale: 1 }), plain, floor.name + ' at ' + cell + ' px: labelScale 1 changed a write');
      // a value that is no scale is 1
      assert.deepEqual(drawFloor(project, floor, cell, { labelScale: 0 }), plain, floor.name + ' at ' + cell + ' px: labelScale 0 is not read as 1');
      assert.deepEqual(drawFloor(project, floor, cell, { labelScale: Number.NaN }), plain, floor.name + ' at ' + cell + ' px: labelScale NaN is not read as 1');
    }
  }
});

test('labelScale 1.5 at a middling zoom: corridor and door names are 1.5 times their size at 1, and a room number with the room grows', () => {
  const project = sampleSchool();
  const cell = 20;
  let corridors = 0;
  let doors = 0;
  let grew = 0;
  for (const floor of project.building.floors) {
    const one = sizes(drawFloor(project, floor, cell, {}));
    const large = sizes(drawFloor(project, floor, cell, { labelScale: 1.5 }));
    const k = kinds(project, floor);
    for (const name of k.corridors) {
      if (!one.has(name)) continue;
      // min(13, round(20 * 0.5)) = 10 at 1; min(19.5, round(15)) = 15 at 1.5
      assert.equal(one.get(name), 10, name + ' at 1');
      assert.equal(large.get(name), 15, name + ' is not 1.5 times as large');
      corridors += 1;
    }
    for (const name of k.doors) {
      if (!one.has(name)) continue;
      assert.equal(large.get(name), one.get(name) * 1.5, name + ' is not 1.5 times as large');
      doors += 1;
    }
    for (const number of k.rooms) {
      if (!one.has(number)) continue;
      assert.ok(large.has(number), 'Room ' + number + ' is left out at 1.5 though drawn at 1');
      assert.ok(large.get(number) >= one.get(number), 'Room ' + number + ' is smaller at 1.5');
      if (large.get(number) >= one.get(number) * 1.4) grew += 1;
    }
  }
  assert.ok(corridors >= 2, 'only ' + corridors + ' corridor names drawn: the case tests nothing');
  assert.ok(doors >= 1, 'no door name drawn: the case tests nothing');
  assert.ok(grew >= 3, 'only ' + grew + ' room numbers grew by 1.4 times or more');
});

test('labelScale 1.5 raises the caps by 1.5 and no more: far zoomed in, room numbers reach 27 px (18 at 1), corridor names 19.5 (13 at 1)', () => {
  const project = sampleSchool();
  const cell = 90;
  const most = (writes, texts) => Math.max(0, ...fills(writes).filter((w) => texts.includes(w.text)).map((w) => w.size));
  let rooms1 = 0;
  let rooms15 = 0;
  let names1 = 0;
  let names15 = 0;
  for (const floor of project.building.floors) {
    const k = kinds(project, floor);
    const one = drawFloor(project, floor, cell, {});
    const large = drawFloor(project, floor, cell, { labelScale: 1.5 });
    rooms1 = Math.max(rooms1, most(one, k.rooms));
    rooms15 = Math.max(rooms15, most(large, k.rooms));
    names1 = Math.max(names1, most(one, k.corridors));
    names15 = Math.max(names15, most(large, k.corridors));
    for (const w of fills(large)) assert.ok(w.size <= 27, w.text + ' is written at ' + w.size + ' px, past 1.5 times the 18 px cap');
  }
  assert.equal(rooms1, 18, 'the room numbers\' cap at 1');
  assert.equal(rooms15, 27, 'the room numbers\' cap at 1.5');
  assert.equal(names1, 13, 'the corridor names\' cap at 1');
  assert.equal(names15, 19.5, 'the corridor names\' cap at 1.5');
});

test('labelScale 1.5 in a room too narrow for the larger number fits it to the room, as at 1, rather than running it over the walls', () => {
  const project = sampleSchool();
  const floor = project.building.floors[0];
  const room = floor.spaces.find((space) => space.kind === 'room' && space.number.trim() !== '');
  room.number = '1234567890';
  const cell = 24;
  const one = fills(drawFloor(project, floor, cell, {})).find((w) => w.text === room.number);
  const large = fills(drawFloor(project, floor, cell, { labelScale: 1.5 })).find((w) => w.text === room.number);
  // the room's label row is its width less 6 px; the number takes 0.55 of its size a character
  const xs = room.cells.map((index) => index % floor.width);
  const width = (Math.max(...xs) - Math.min(...xs) + 1) * cell - 6;
  if (one) assert.ok(one.size * 0.55 * 10 <= width, 'at 1 the number runs over the walls');
  if (large) assert.ok(large.size * 0.55 * 10 <= width, 'at 1.5 the number runs over the walls: ' + large.size + ' px in ' + width);
  assert.equal(Boolean(large), Boolean(one), 'the long number is drawn at one scale and left out at the other');
});

test('the overlays are handed the scale: the lanes\' period pills and the corridor names over the load are 1.5 times as large', () => {
  const project = sampleSchool();
  const floor = project.building.floors[0];
  const bands = new Map([[floor.id, new Uint8Array(floor.width * floor.height).fill(1)]]);
  const markers = new Map([[floor.id, [{ box: { x0: 0, y0: 0, x1: floor.width, y1: floor.height }, pills: [{ colour: '#d1495b', text: 'P1' }, { colour: '#0072b2', text: 'P2' }] }]]]);
  const overlay = lanesOverlay(() => ({ bands, markers, lanes: null, labels: true, bandColours: ['#e9eef2', '#bcd7e8', '#7fb3d5', '#d98a3e', '#b3261e'], colourOf: () => '#000000' }));
  const pill = (writes) => fills(writes).find((w) => w.text === 'P1');
  const name = floor.corridors.find((each) => each.name !== '').name.toUpperCase();
  const corridor = (writes) => writes.filter((w) => w.text === name).map((w) => w.size);
  const cell = 20;
  const one = drawFloor(project, floor, cell, { overlays: [overlay] });
  const large = drawFloor(project, floor, cell, { overlays: [overlay], labelScale: 1.5 });
  // round(min(13, 20 * 0.42)) = 8 is under the 9 px words need, so pills are squares at 1; 13 at 1.5 has words
  assert.equal(pill(one), undefined, 'at 1 and 20 px a pill is drawn with words');
  assert.ok(pill(large), 'at 1.5 and 20 px the pill is drawn as a square with no words: the overlay was not handed the scale');
  assert.equal(pill(large).size, 13, 'the pill\'s words at 1.5');
  const at24 = pill(drawFloor(project, floor, 24, { overlays: [overlay] }));
  const at24large = pill(drawFloor(project, floor, 24, { overlays: [overlay], labelScale: 1.5 }));
  assert.equal(at24.size, 10, 'the pill\'s words at 1 and 24 px');
  assert.equal(at24large.size, 15, 'the pill\'s words at 1.5 and 24 px');
  // the renderer's own corridor name, then the overlay's over the load, both at 15
  assert.deepEqual(corridor(large).filter((size) => size !== 15), [], 'a corridor name over the load is not 1.5 times as large: ' + corridor(large));
  assert.ok(corridor(one).every((size) => size === 10), 'the corridor names at 1: ' + corridor(one));
});
