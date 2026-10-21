// The renderer's labelScale (SV2-31): presentation mode draws every label of
// the map larger, caps included, by one factor handed to renderer.draw and on
// to the overlays. Drawn in plain Node on a 2D context that records each text
// with the size it was written at. At 1 (or with no labelScale) the canvas
// is told, call for call, what it was told at be5f4c88, the last commit
// before the option existed (BASELINE, recorded there with this file's
// callLog and baselineScenes; SV2-31b); at 1.5 every size is 1.5 times
// as large where the label has the room, never past 1.5 times its cap, and
// a label with no room is fitted or left out as at 1. The map in a page is
// test/browser/present.mjs.
//
//   node test/ui/label-scale.test.mjs

import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

import { createRenderer } from '../../ui/surface/renderer.js';
import { createViewport, drawnBox, CELL } from '../../ui/surface/viewport.js';
import { lanesOverlay, drawStairLink } from '../../ui/surface/overlays/lanes.js';
import { sampleSchool } from '../../data/sample-school.js';
import { placeRanks, ringRadius, RANK_RADIUS } from '../../ui/movement/hotspots.js';

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
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'rect', 'clip', 'setLineDash', 'closePath', 'translate', 'rotate', 'quadraticCurveTo', 'bezierCurveTo']) ctx[name] = () => {};
  // the paths stroked and filled, for the shapes' geometry: { how, style, lineWidth, points, arcs }
  const shapes = [];
  let path = { points: [], arcs: [] };
  ctx.shapes = shapes;
  ctx.beginPath = () => { path = { points: [], arcs: [] }; };
  ctx.moveTo = (x, y) => { path.points.push([x, y]); };
  ctx.lineTo = (x, y) => { path.points.push([x, y]); };
  ctx.arc = (x, y, r) => { path.arcs.push([x, y, r]); };
  ctx.stroke = () => { shapes.push({ how: 'stroke', style: state.strokeStyle, lineWidth: state.lineWidth, points: path.points.slice(), arcs: path.arcs.slice() }); };
  ctx.fill = () => { shapes.push({ how: 'fill', style: state.fillStyle, points: path.points.slice(), arcs: path.arcs.slice() }); };
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
  drawFloor.shapes = g.shapes;
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

// A context that keeps every call made on it and every property set, in
// order, as text: what the canvas was told, call for call.
function callLog() {
  const log = [];
  const state = { font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', letterSpacing: '0px', lineDashOffset: 0, globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: 'transparent', imageSmoothingEnabled: true };
  const stack = [];
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)[1]);
  const ctx = {
    log,
    measureText(text) {
      log.push('measureText ' + JSON.stringify(String(text)) + ' ' + state.font);
      return { width: String(text).length * size() * 0.55, actualBoundingBoxAscent: size() * 0.7, actualBoundingBoxDescent: size() * 0.2 };
    },
    save() { log.push('save'); stack.push({ ...state }); },
    restore() { log.push('restore'); const was = stack.pop(); if (was) Object.assign(state, was); },
  };
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'clip', 'setLineDash', 'closePath', 'translate', 'rotate', 'scale', 'quadraticCurveTo', 'bezierCurveTo', 'fillText', 'strokeText', 'drawImage', 'ellipse', 'arcTo', 'roundRect']) {
    ctx[name] = (...args) => { log.push(name + ' ' + JSON.stringify(args.map((arg) => (typeof arg === 'object' && arg !== null && !Array.isArray(arg) ? '[object]' : arg)))); };
  }
  for (const key of Object.keys(state)) Object.defineProperty(ctx, key, { get: () => state[key], set: (value) => { log.push(key + '=' + JSON.stringify(value)); state[key] = value; }, enumerable: true });
  return ctx;
}

// The scenes the baseline was recorded on: every floor of the sample school
// at six cell sizes; with the plan map's clip and with names over; a stairs
// cell with no connection (the problem "!"); the lanes overlay's load,
// names and period pills; a stair link with and without its words.
// `extra` is added to every scene (labelScale: 1, or nothing).
function baselineScenes(modules, extra) {
  const { createRenderer, createViewport, drawnBox, CELL, lanesOverlay, drawStairLink, sampleSchool } = modules;
  const out = {};
  function drawOne(project, floor, cell, more) {
    const g = callLog();
    const canvas = { isConnected: true, width: 0, height: 0, getContext: () => g };
    const renderer = createRenderer(canvas);
    const view = createViewport();
    view.resize(4000, 3000);
    const box = drawnBox(floor);
    view.zoom = cell / CELL;
    view.x = 40 - box.x * cell;
    view.y = 40 - box.y * cell;
    renderer.resize(4000, 3000, 1);
    renderer.draw({ project, floor, view, selection: [], hover: null, cursor: null, preview: null, ...more, ...extra });
    return g.log;
  }
  const project = sampleSchool();
  for (const floor of project.building.floors) {
    for (const cell of [10, 16, 24, 40, 64, 90]) out[floor.name + ' at ' + cell] = drawOne(project, floor, cell, {});
    const box = drawnBox(floor);
    out[floor.name + ' clipped, names over, at 24'] = drawOne(project, floor, 24, { clip: { x: box.x + 1, y: box.y, w: box.w - 2, h: box.h }, namesOver: true });
  }
  // a stairs cell nothing connects: the renderer's "!"
  const lone = sampleSchool();
  const floor = lone.building.floors[0];
  const owned = new Set(floor.spaces.flatMap((space) => space.cells));
  const at = Array.from(floor.cells).findIndex((c, i) => c === '.' && !owned.has(i) && floor.cells[i + 1] === '#');
  floor.cells = floor.cells.slice(0, at) + 'S' + floor.cells.slice(at + 1);
  for (const cell of [16, 24, 40, 64]) out['a stairs cell with no connection at ' + cell] = drawOne(lone, floor, cell, {});
  // the lanes overlay: load bands, names over them, period pills
  const first = project.building.floors[0];
  const bands = new Map([[first.id, new Uint8Array(first.width * first.height).fill(1)]]);
  const markers = new Map([[first.id, [{ box: { x0: 0, y0: 0, x1: first.width, y1: first.height }, pills: [{ colour: '#d1495b', text: 'P1' }, { colour: '#0072b2', text: 'P2' }] }]]]);
  const overlay = lanesOverlay(() => ({ bands, markers, lanes: null, labels: true, bandColours: ['#e9eef2', '#bcd7e8', '#7fb3d5', '#d98a3e', '#b3261e'], colourOf: () => '#000000' }));
  for (const cell of [16, 20, 24, 40]) out['the lanes overlay at ' + cell] = drawOne(project, first, cell, { overlays: [overlay] });
  // a stair link between two ends, and one whose other end is off the map, with its words
  for (const [name, to, words] of [['between two ends', { x: 300, y: 140 }, null], ['to another floor', null, 'A to Floor 2']]) {
    const g = callLog();
    const style = { colour: '#1f2328', edge: '#fffdf8', width: 3, font: 'sans-serif', ink: '#1f2328', ...(words ? { text: words } : {}), ...extra };
    drawStairLink(g, { x: 100, y: 200 }, to, style);
    out['a stair link ' + name] = g.log;
  }
  return out;
}

// What the drawing of each scene was at be5f4c88, before labelScale: the
// first 16 hex digits of the SHA-256 of its call log (one call a line) and
// the number of calls. Recorded by running baselineScenes on that commit's
// renderer.js, lanes.js, viewport.js and sample school (git archive
// be5f4c88), unchanged since but for labelScale.
const BASELINE = {
  "Floor 1 at 10": "27ff385ff8611d34 599",
  "Floor 1 at 16": "7036aa11b3a2e4d9 654",
  "Floor 1 at 24": "42ed240569f1c7e8 694",
  "Floor 1 at 40": "9b7f7ceb1538815f 742",
  "Floor 1 at 64": "21ee4195caffd70d 802",
  "Floor 1 at 90": "a191a7b4b601dd28 868",
  "Floor 1 clipped, names over, at 24": "c60a23435b1b6061 706",
  "Floor 2 at 10": "3e858d1c8263f218 502",
  "Floor 2 at 16": "fc45ab98bd39d840 515",
  "Floor 2 at 24": "2f9c2d76478ed4a3 535",
  "Floor 2 at 40": "30d3d4e97ba408c7 535",
  "Floor 2 at 64": "d7e0640bbf623e9b 535",
  "Floor 2 at 90": "d431965240fe1389 535",
  "Floor 2 clipped, names over, at 24": "9cd92e3079572180 539",
  "Floor 3 at 10": "bbba8d7835e3553d 433",
  "Floor 3 at 16": "f76e7b42cccf7c34 457",
  "Floor 3 at 24": "f046b66a7ec27935 475",
  "Floor 3 at 40": "89933343b7f62401 475",
  "Floor 3 at 64": "614e4e7e56ca2fe5 473",
  "Floor 3 at 90": "8517d5d34905d4be 473",
  "Floor 3 clipped, names over, at 24": "bae597845283d89b 483",
  "a stairs cell with no connection at 16": "74f653d9f7b3900a 672",
  "a stairs cell with no connection at 24": "0e80a5b580d1f782 715",
  "a stairs cell with no connection at 40": "f0f3a11044c90f15 763",
  "a stairs cell with no connection at 64": "b0fe317c349715ed 823",
  "the lanes overlay at 16": "93c58aa8584c9b33 736",
  "the lanes overlay at 20": "fd89dea9459f9b58 766",
  "the lanes overlay at 24": "27466a92f6f6d3bf 782",
  "the lanes overlay at 40": "493697785ca994ad 830",
  "a stair link between two ends": "0109e16af7b4331f 32",
  "a stair link to another floor": "aa6a3b0c6b09885e 34",
};

const MODULES = { createRenderer, createViewport, drawnBox, CELL, lanesOverlay, drawStairLink, sampleSchool };
const digest = (log) => createHash('sha256').update(log.join('\n')).digest('hex').slice(0, 16) + ' ' + log.length;

test('labelScale 1, and no labelScale, tell the canvas call for call what be5f4c88 did, before the option existed', () => {
  // a value that is no scale is 1
  for (const [name, extra] of [['no labelScale', {}], ['labelScale 1', { labelScale: 1 }], ['labelScale 0', { labelScale: 0 }], ['labelScale NaN', { labelScale: Number.NaN }]]) {
    const scenes = baselineScenes(MODULES, extra);
    assert.deepEqual(Object.keys(scenes), Object.keys(BASELINE), 'the scenes are not the ones recorded');
    for (const [key, log] of Object.entries(scenes)) assert.equal(digest(log), BASELINE[key], name + ', ' + key + ': the drawing is not the one recorded at be5f4c88');
  }
});

test('the baseline\'s scenes write labels of every kind the scale reaches, the problem "!" and a stair link\'s words among them', () => {
  const all = Object.values(baselineScenes(MODULES, {})).flat();
  const texts = all.filter((line) => line.startsWith('fillText '));
  assert.ok(texts.length >= 400, 'only ' + texts.length + ' texts written: the baseline tests little');
  assert.ok(texts.some((line) => line.startsWith('fillText ["!"')), 'no problem "!" in the scenes');
  assert.ok(texts.some((line) => line.startsWith('fillText ["A to Floor 2"')), 'no stair link words in the scenes');
  assert.ok(texts.some((line) => line.startsWith('fillText ["P1"')), 'no period pill in the scenes');
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

test('labelScale 1.5 raises the caps by 1.5, rounded to a whole pixel, and no more: far zoomed in, room numbers reach 27 px (18 at 1), corridor names 20 (13 at 1; 19.5 rounded, SV2-31c)', () => {
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
  assert.equal(names15, 20, 'the corridor names\' cap at 1.5: 13 times 1.5 rounded to a whole pixel');
});

test('at 1.5, 1.25 and 1.7 every label is written at a whole pixel size, caps included (SV2-31c: 13 times 1.5 was 19.5)', () => {
  const project = sampleSchool();
  const floor0 = project.building.floors[0];
  const bands = new Map([[floor0.id, new Uint8Array(floor0.width * floor0.height).fill(1)]]);
  const overlay = lanesOverlay(() => ({ bands, markers: new Map(), lanes: null, labels: true, bandColours: ['#e9eef2', '#bcd7e8', '#7fb3d5', '#d98a3e', '#b3261e'], colourOf: () => '#000000' }));
  // and a copy of the first floor with no room numbered, for "needs a number" and its "?"
  const unnumbered = sampleSchool();
  const bare = unnumbered.building.floors[0];
  for (const space of bare.spaces) if (space.kind === 'room') space.number = '';
  // one room a single cell, too narrow for the words at any zoom, so its "?" reaches the 18 px cap times the scale
  const narrow = bare.spaces.find((space) => space.kind === 'room');
  narrow.cells = narrow.cells.slice(0, 1);
  let written = 0;
  let needs = 0;
  for (const labelScale of [1.5, 1.25, 1.7]) {
    for (const cell of [16, 24, 40, 64, 90]) {
      const writes = fills(drawFloor(unnumbered, bare, cell, { labelScale }));
      needs += writes.filter((w) => w.text === 'needs a number' || w.text === '?').length;
      for (const w of writes) assert.ok(Number.isInteger(w.size), w.text + ' (no room numbered) is written at ' + w.size + ' px at labelScale ' + labelScale + ' and ' + cell + ' px a cell');
    }
    for (const floor of project.building.floors) {
      for (const cell of [16, 24, 40, 64, 90]) {
        const writes = fills(drawFloor(project, floor, cell, { labelScale, overlays: floor === floor0 ? [overlay] : [] }));
        written += writes.length;
        for (const w of writes) assert.ok(Number.isInteger(w.size), w.text + ' is written at ' + w.size + ' px at labelScale ' + labelScale + ' and ' + cell + ' px a cell');
      }
    }
  }
  assert.ok(written > 300, 'only ' + written + ' texts written: the case tests little');
  assert.ok(needs > 10, 'only ' + needs + ' "needs a number" or "?" written: the case tests little');
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

test('labelScale 1.5 reaches a stair link\'s words and the problem "!" on a stairs cell nothing connects (SV2-31b)', () => {
  // a stair link to another floor: its words at 11 px, 17 at 1.5 (whole pixels)
  const words = (extra) => {
    const g = recorder();
    drawStairLink(g, { x: 100, y: 200 }, null, { colour: '#1f2328', edge: '#fffdf8', width: 3, font: 'sans-serif', ink: '#1f2328', text: 'A to Floor 2', ...extra });
    return fills(g.writes).map((w) => w.size);
  };
  assert.deepEqual(words({}), [11], 'a stair link\'s words at 1');
  assert.deepEqual(words({ labelScale: 1 }), [11], 'a stair link\'s words at labelScale 1');
  assert.deepEqual(words({ labelScale: 1.5 }), [17], 'a stair link\'s words are not 1.5 times as large');
  // the "!": a disc of min(7, 0.22 of the cell) px radius with the mark at
  // 1.7 times it; larger at 1.5, as far as the stairs chevron leaves it room
  // (SV2-31c: 1.5 times both put the disc over the chevron's point)
  const { project, floor } = lonelyStairs();
  const bang = (cell, extra) => fills(drawFloor(project, floor, cell, extra)).filter((w) => w.text === '!').map((w) => w.size);
  assert.deepEqual(bang(40, {}), [12], 'the "!" at 1 and 40 px');
  const at40 = bang(40, { labelScale: 1.5 });
  assert.equal(at40.length, 1, 'no "!" at 1.5 and 40 px');
  assert.ok(at40[0] > 12, 'the "!" is not larger at 1.5 and 40 px: ' + at40);
  // and by how much: a 9.44 px disc there (the chevron leaves it that), the mark round(16.05) (SV2-31d: "> 12" let it shrink unseen)
  assert.deepEqual(at40, [16], 'the "!" at 1.5 and 40 px');
  // at 64 px the chevron is far enough off for the whole 1.5 times: a 10.5 px disc, the mark round(17.85)
  assert.deepEqual(bang(64, { labelScale: 1.5 }), [18], 'the "!" at 1.5 and 64 px');
  // at 20 px the disc is 4.4 px at 1, too small for the mark; at 1.5 the chevron leaves it no more room than that
  assert.deepEqual(bang(20, {}), [], 'the "!" at 1 and 20 px');
  assert.deepEqual(bang(20, { labelScale: 1.5 }), [], 'the "!" at 1.5 and 20 px');
});

// The sample school's first floor with one stairs cell nothing connects: it gets the problem "!".
function lonelyStairs() {
  const project = sampleSchool();
  const floor = project.building.floors[0];
  const owned = new Set(floor.spaces.flatMap((space) => space.cells));
  const at = Array.from(floor.cells).findIndex((c, i) => c === '.' && !owned.has(i) && floor.cells[i + 1] === '#');
  floor.cells = floor.cells.slice(0, at) + 'S' + floor.cells.slice(at + 1);
  return { project, floor };
}

// How far a disc's edge stands from a stroked line, in px: under 0 where they overlap.
function apart(disc, stroke) {
  const [cx, cy, r] = disc;
  let least = Infinity;
  for (let i = 1; i < stroke.points.length; i += 1) {
    const [ax, ay] = stroke.points[i - 1];
    const [bx, by] = stroke.points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy)));
    least = Math.min(least, Math.hypot(cx - ax - t * dx, cy - ay - t * dy));
  }
  return least - r - stroke.lineWidth / 2;
}

test('the problem disc on a stairs cell keeps off the stairs chevron at a larger scale wherever it did at 1: at 20 px a cell and 1.5 it lay over its point (SV2-31c)', () => {
  const { project, floor } = lonelyStairs();
  const problem = TOKENS['--problem'];
  // the disc and the chevron under it, as drawn on a cell `cell` px a side
  const shapesAt = (cell, labelScale) => {
    drawFloor(project, floor, cell, { labelScale });
    const shapes = drawFloor.shapes;
    const discs = shapes.filter((shape) => shape.how === 'fill' && shape.style === problem && shape.arcs.length === 1 && shape.points.length === 0);
    assert.equal(discs.length, 1, 'not one problem disc at ' + cell + ' px and ' + labelScale);
    const disc = discs[0].arcs[0];
    // the chevron: three points, a stroke, its point within the cell of the disc
    const chevrons = shapes.filter((shape) => shape.how === 'stroke' && shape.points.length === 3 && Math.abs(shape.points[1][0] - disc[0]) < cell && Math.abs(shape.points[1][1] - disc[1]) < cell);
    return { disc, chevron: chevrons.length === 1 ? chevrons[0] : null };
  };
  // the case the review found
  const one = shapesAt(20, 1);
  const large = shapesAt(20, 1.5);
  assert.ok(one.chevron && large.chevron, 'no chevron found under the disc at 20 px');
  assert.ok(apart(one.disc, one.chevron) >= 0, 'at 1 and 20 px the disc lies on the chevron: the case tests the wrong thing');
  assert.ok(apart(large.disc, large.chevron) >= 0, 'at 1.5 and 20 px the disc lies ' + (-apart(large.disc, large.chevron)).toFixed(2) + ' px over the chevron');
  // and every size of cell with a chevron: clear at a larger scale where it was clear at 1, and never smaller than at 1
  let checked = 0;
  for (let cell = 10; cell <= 64; cell += 1) {
    const at1 = shapesAt(cell, 1);
    if (!at1.chevron) continue;
    for (const labelScale of [1.25, 1.5, 2]) {
      const now = shapesAt(cell, labelScale);
      assert.ok(now.disc[2] >= at1.disc[2] - 1e-9, 'at ' + labelScale + ' and ' + cell + ' px the disc is smaller than at 1');
      if (apart(at1.disc, at1.chevron) >= 0) {
        checked += 1;
        assert.ok(apart(now.disc, now.chevron) >= -1e-9, 'at ' + labelScale + ' and ' + cell + ' px the disc lies ' + (-apart(now.disc, now.chevron)).toFixed(2) + ' px over the chevron');
      }
    }
  }
  assert.ok(checked > 100, 'only ' + checked + ' sizes checked');
});

test('the hotspot ranks\' discs, 1.5 times as large in presentation mode, are placed clear of one another at that size (placeRanks\' radius; SV2-31c)', () => {
  const large = RANK_RADIUS * 1.5;
  const apart = (rings, radius) => rings.every((a, i) => rings.every((b, j) => j <= i || Math.hypot(a.bx - b.bx, a.by - b.by) >= radius * 2 + 1));
  const upperRight = (ring) => Math.abs(ring.bx - ring.x - ring.r * Math.SQRT1_2) < 0.01 && Math.abs(ring.by - ring.y + ring.r * Math.SQRT1_2) < 0.01;
  const pair = (dx) => [{ rank: 1, x: 100, y: 100, r: 14 }, { rank: 2, x: 100 + dx, y: 100, r: 14 }];
  // 20 px apart: two 8 px discs clear one another where they stand, two 12 px discs do not
  const small = placeRanks(pair(20));
  assert.ok(small.every(upperRight) && apart(small, RANK_RADIUS), 'at 8 px: ' + JSON.stringify(small));
  const grown = placeRanks(pair(20), large);
  assert.ok(upperRight(grown[0]), 'the busiest place\'s rank moved: ' + JSON.stringify(grown));
  assert.equal(upperRight(grown[1]), false, 'at 12 px the second rank was left on the first');
  assert.ok(apart(grown, large), 'at 12 px the two discs overlap: ' + JSON.stringify(grown));
  // far apart, both keep their upper right at either size
  assert.ok(placeRanks(pair(40), large).every(upperRight));
  // the default is RANK_RADIUS
  assert.deepEqual(placeRanks(pair(20)).map((ring) => [ring.bx, ring.by]), placeRanks(pair(20), RANK_RADIUS).map((ring) => [ring.bx, ring.by]));
});

test('the caps are rounded to the nearest whole pixel, neither up nor down: corridor names 16, 20 and 22 px at 1.25, 1.5 and 1.7 (13 times each is 16.25, 19.5, 22.1; ceil gives 17, 20, 23, floor 16, 19, 22) (SV2-31d)', () => {
  const project = sampleSchool();
  const cell = 90;
  const capAt = (labelScale) => {
    let most = 0;
    for (const floor of project.building.floors) {
      const k = kinds(project, floor);
      most = Math.max(most, ...fills(drawFloor(project, floor, cell, { labelScale })).filter((w) => k.corridors.includes(w.text)).map((w) => w.size));
    }
    return most;
  };
  assert.deepEqual([1.25, 1.5, 1.7].map(capAt), [16, 20, 22], 'the corridor names\' cap at 1.25, 1.5 and 1.7');
});

test('the hotspot rings\' least radius grows with the scale, so three ranks stand clear on the smallest ring at 1.5 as they do at 1 (SV2-31d)', () => {
  // three places on one cell far zoomed out: their rings are the least
  const three = (scale) => {
    const r = ringRadius(4, scale);
    return placeRanks([1, 2, 3].map((rank) => ({ rank, x: 100, y: 100, r })), RANK_RADIUS * scale);
  };
  const clear = (rings, radius) => rings.every((a, i) => rings.every((b, j) => j <= i || Math.hypot(a.bx - b.bx, a.by - b.by) >= radius * 2 + 1));
  assert.equal(ringRadius(4), 10, 'the least ring at 1');
  assert.equal(ringRadius(40), 36, 'nine tenths of a cell');
  assert.equal(ringRadius(40, 1.5), 36, 'the scale does not grow a ring past its least');
  assert.ok(clear(three(1), RANK_RADIUS), 'at 1 the three discs overlap: ' + JSON.stringify(three(1)));
  assert.ok(clear(three(1.5), RANK_RADIUS * 1.5), 'at 1.5 the three discs overlap on a ' + ringRadius(4, 1.5) + ' px ring: ' + JSON.stringify(three(1.5)));
});
