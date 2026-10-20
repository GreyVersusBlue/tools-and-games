// The renderer's labels over a plan map's slot (SV2-72c, the M5 walk-through's
// W6), drawn in plain Node on a 2D context that records what is written: a
// door name the slot would cut slides along its edge, or goes inside its
// exit's dash on a halo, or is left out;
// with namesOver, corridor names are written over the overlays on a halo, so
// Safety's routes leave them readable. The map in a page is
// test/browser/plan-map.mjs and test/browser/safety.mjs.
//
//   node test/ui/renderer-labels.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer } from '../../ui/surface/renderer.js';
import { createViewport, drawnBox } from '../../ui/surface/viewport.js';
import { sampleSchool } from '../../data/sample-school.js';

// the light theme's tokens (ui/tokens.css), as the canvas reads them
const TOKENS = {
  '--paper': '#f6f3ec', '--card': '#fffdf8', '--ink': '#1f2328', '--ink-2': '#515761', '--line': '#d8d3c8', '--line-strong': '#857f73',
  '--accent': '#0f6e66', '--accent-ink': '#ffffff', '--accent-soft': '#d9ece9', '--problem': '#b3261e', '--warning': '#925d00',
  '--grid': '#e8e3d8', '--corridor': '#ffffff', '--corridor-edge': '#d8d3c8', '--stairs': '#d9ece9', '--room-default': '#e9e4d9', '--font-plan': 'sans-serif',
};
globalThis.document = globalThis.document || { documentElement: { dataset: {} } };
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: (name) => TOKENS[name] || '' }));

// A context that keeps every text written, with its alignment and an
// estimate of its box: 0.55 of the size a character, the size tall.
function recorder() {
  const writes = [];
  const state = { font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', letterSpacing: '0px' };
  const stack = [];
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)[1]);
  const box = (text, x, y) => {
    const wide = text.length * size() * 0.55;
    const tall = size();
    const x0 = state.textAlign === 'center' ? x - wide / 2 : state.textAlign === 'right' || state.textAlign === 'end' ? x - wide : x;
    const y0 = state.textBaseline === 'middle' ? y - tall / 2 : state.textBaseline === 'bottom' ? y - tall : y;
    return { x0, x1: x0 + wide, y0, y1: y0 + tall };
  };
  let turned = false;
  const ctx = {
    writes,
    measureText: (text) => ({ width: String(text).length * size() * 0.55 }),
    fillText(text, x, y) { writes.push({ how: 'fill', text, turned, ...box(String(text), x, y) }); },
    strokeText(text, x, y) { writes.push({ how: 'stroke', text, turned, ...box(String(text), x, y) }); },
    save() { stack.push({ ...state, turned }); },
    restore() { const was = stack.pop(); if (was) { turned = was.turned; delete was.turned; Object.assign(state, was); } },
    translate() { turned = true; },
    rotate() {},
    mark(name) { writes.push({ how: 'mark', text: name }); },
  };
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'clip', 'setLineDash', 'closePath']) ctx[name] = () => {};
  for (const key of Object.keys(state)) Object.defineProperty(ctx, key, { get: () => state[key], set: (value) => { state[key] = value; }, enumerable: true });
  return ctx;
}

function drawFloor(floor, project, extra) {
  const g = recorder();
  const canvas = { isConnected: true, width: 0, height: 0, getContext: () => g };
  const renderer = createRenderer(canvas);
  const view = createViewport();
  view.resize(1100, 700);
  const clip = drawnBox(floor);
  view.fit(clip, 20);
  renderer.resize(1100, 700, 1);
  renderer.draw({ project, floor, view, selection: [], hover: null, cursor: null, preview: null, ...extra(clip) });
  const px = { x0: view.x + clip.x * view.size, x1: view.x + (clip.x + clip.w) * view.size, y0: view.y + clip.y * view.size, y1: view.y + (clip.y + clip.h) * view.size };
  return { writes: g.writes, px, size: view.size, clip };
}

const doorNames = (project, floor) => floor.exits.map((exit) => exit.doorName).filter((name) => name !== '');

test('W6: on a plan map\'s slot no door name runs past the slot, and the one that would is drawn whole inside it', () => {
  const project = sampleSchool();
  let moved = 0;
  let seen = 0;
  for (const floor of project.building.floors) {
    const names = doorNames(project, floor);
    if (names.length === 0) continue;
    const plain = drawFloor(floor, project, () => ({}));
    const slot = drawFloor(floor, project, (clip) => ({ clip }));
    assert.ok(slot.size >= 12, 'the floor is drawn too small for door names: the case tests nothing');
    for (const name of names) {
      const before = plain.writes.find((w) => w.how === 'fill' && w.text === name);
      const after = slot.writes.filter((w) => w.how === 'fill' && w.text === name);
      assert.ok(before, name + ' is not drawn with no slot');
      const out = (w) => w.x0 < slot.px.x0 - 0.5 || w.x1 > slot.px.x1 + 0.5 || w.y0 < slot.px.y0 - 0.5 || w.y1 > slot.px.y1 + 0.5;
      for (const w of after) assert.equal(out(w), false, floor.name + ': ' + name + ' runs past the slot ' + JSON.stringify({ w, slot: slot.px }));
      if (out(before)) {
        moved += 1;
        assert.equal(after.length, 1, name + ' was cut on the slot and is not drawn inside it');
      }
      seen += 1;
    }
  }
  assert.ok(seen >= 2, 'the sample school has ' + seen + ' door names');
  assert.ok(moved >= 1, 'no door name of the sample school ran past its slot: the case tests nothing');
});

test('W6: a door name with no room inside the slot either is left out, never cut', () => {
  const project = sampleSchool();
  const floor = project.building.floors.find((each) => each.exits.some((exit) => exit.doorName !== ''));
  for (const exit of floor.exits) exit.doorName = 'An exit by the far side of the playing fields and the car park past the gate';
  const slot = drawFloor(floor, project, (clip) => ({ clip }));
  const long = slot.writes.filter((w) => w.text === floor.exits[0].doorName);
  for (const w of long) assert.ok(w.x0 >= slot.px.x0 - 0.5 && w.x1 <= slot.px.x1 + 0.5, 'a long door name runs past the slot');
});

test('W6: with namesOver the corridor names are written after the overlays, each over a halo; without, under them as before', () => {
  const project = sampleSchool();
  const floor = project.building.floors.find((each) => each.corridors.some((corridor) => corridor.name !== ''));
  const overlays = [(g) => g.mark('overlay')];
  const names = floor.corridors.filter((corridor) => corridor.name !== '').map((corridor) => corridor.name.toUpperCase());
  const order = (writes) => writes.map((w) => (w.how === 'mark' ? 'overlay' : w.how + ':' + w.text));
  const under = order(drawFloor(floor, project, () => ({ overlays })).writes);
  const over = order(drawFloor(floor, project, () => ({ overlays, namesOver: true })).writes);
  const drawn = names.filter((name) => under.includes('fill:' + name));
  assert.ok(drawn.length >= 1, 'no corridor name is drawn at this size: the case tests nothing');
  for (const name of drawn) {
    assert.ok(under.indexOf('fill:' + name) < under.indexOf('overlay'), name + ' is not under the overlays by default');
    assert.equal(under.includes('stroke:' + name), false, name + ' has a halo under the overlays');
    const at = over.indexOf('fill:' + name);
    assert.ok(at > over.indexOf('overlay'), name + ' is still under the overlays with namesOver');
    assert.ok(over.indexOf('stroke:' + name) !== -1 && over.indexOf('stroke:' + name) < at, name + ' has no halo under it');
  }
});

test('W6: a door name with no room beyond its dash inside the slot is drawn inside the dash, on a halo of the corridor', () => {
  const project = sampleSchool();
  const floor = project.building.floors.find((each) => each.exits.some((exit) => exit.doorName === 'Door B'));
  const exit = floor.exits.find((each) => each.doorName === 'Door B');
  const x = exit.cell % floor.width;
  // a corridor down the floor's east column, Door B on it: the dash faces east, onto the floor's edge
  const cells = floor.cells.split('');
  for (let y = 0; y < floor.height; y += 1) cells[y * floor.width + x] = '#';
  floor.cells = cells.join('');
  const slot = drawFloor(floor, project, (clip) => ({ clip }));
  const name = slot.writes.filter((w) => w.text === 'Door B');
  assert.deepEqual(name.map((w) => w.how), ['stroke', 'fill'], 'Door B is not drawn once, over its halo');
  assert.ok(name[1].x1 <= slot.px.x1 + 0.5, 'Door B runs past the floor\'s edge');
});

test('SV2-72c2 item 10: with namesOver a door name drawn inward, where a route ends at its exit\'s cell, is written after the overlays on a halo; without, before them as before', () => {
  const project = sampleSchool();
  const floor = project.building.floors.find((each) => each.exits.some((exit) => exit.doorName === 'Door A'));
  const overlays = [(g) => g.mark('overlay')];
  const order = (writes) => writes.map((w) => (w.how === 'mark' ? 'overlay' : w.how + ':' + w.text));
  // on the map's slot Door A has no room beyond its dash, so it is drawn inward, over the corridor the route runs down
  const plain = drawFloor(floor, project, (clip) => ({ clip, overlays }));
  const inward = plain.writes.filter((w) => w.text === 'Door A');
  assert.deepEqual(inward.map((w) => w.how), ['stroke', 'fill'], 'Door A is not drawn inward on a halo: the case tests nothing');
  const under = order(plain.writes);
  assert.ok(under.indexOf('fill:Door A') < under.indexOf('overlay'), 'Door A is not under the overlays without namesOver');
  const over = order(drawFloor(floor, project, (clip) => ({ clip, overlays, namesOver: true })).writes);
  const at = over.indexOf('fill:Door A');
  assert.ok(at > over.indexOf('overlay'), 'with namesOver Door A is still under the overlays: the route is drawn over it');
  assert.ok(over.indexOf('stroke:Door A') > over.indexOf('overlay') && over.indexOf('stroke:Door A') < at, 'Door A over the overlays has no halo under it');
});
