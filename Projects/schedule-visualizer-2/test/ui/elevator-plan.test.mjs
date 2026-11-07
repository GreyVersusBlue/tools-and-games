// Elevators, steps and areas of refuge in words and on paper (SV2-101e), in
// plain Node: planSvg's markup and the `elevators` it returns for a stop, a
// step and a refuge; the sample school's plan, which has none, byte for byte
// (a digest of every floor's markup); elevatorWords (ui/building/index.js) and
// pendingElevatorLetter (ui/components/words.js); the cursor line's words for a step and a refuge
// (cellWords); the printed floor plan's sentence for an unconnected stop; and
// the renderer's refuge name, fitted to the cells beside it.
//
//   node test/ui/elevator-plan.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { planSvg } from '../../ui/prints/plan-svg.js';
import { render } from '../../ui/prints/floor-plan.js';
import { pendingElevatorLetter } from '../../ui/components/words.js';
import { cellWords, elevatorWords } from '../../ui/building/index.js';
import { createRenderer } from '../../ui/surface/renderer.js';
import { createViewport, drawnBox } from '../../ui/surface/viewport.js';
import { describeCell } from '../../engine/building.js';
import { sampleSchool } from '../../data/sample-school.js';

// the level sample's plan, with no stop, step or refuge (SV2-106: the full sample has them now): the digest of the markup of all floors
const SAMPLE_DIGEST = '6f86fc169479dd3a15d33e517d87763e3ae3fcc01ec9b11b45cb39d7facb63ce';

// The sample school's first floor with a stop (a stairs cell in `lifts`, joined
// to nothing), a step on a corridor cell and a refuge, all on one corridor.
function withMarks(name = 'Refuge North') {
  const project = sampleSchool({ level: true });
  const floor = project.building.floors[0];
  const corridor = floor.cells.split('').map((c, i) => (c === '#' ? i : -1)).filter((i) => i >= 0);
  const [stop, step, refuge] = [corridor[2], corridor[6], corridor[10]];
  const cells = floor.cells.split('');
  cells[stop] = 'S';
  floor.cells = cells.join('');
  floor.lifts = [stop];
  floor.notStepFree = [step];
  floor.refuges = [{ id: 'rf0000001', name, cell: refuge }];
  return { project, floor, stop, step, refuge };
}

test('the sample school\'s plan, with no stop, step or refuge, is byte for byte what it was, and returns no elevators', () => {
  const project = sampleSchool({ level: true });
  const hash = createHash('sha256');
  for (const floor of project.building.floors) {
    const picture = planSvg(project, floor, {});
    assert.equal('elevators' in picture, false);
    hash.update(picture.svg);
  }
  assert.equal(hash.digest('hex'), SAMPLE_DIGEST);
});

test('a stop, a step and a refuge are drawn with their attributes, and the stop is returned with its letter and whether it is connected', () => {
  const { project, floor } = withMarks();
  const picture = planSvg(project, floor, {});
  assert.deepEqual(picture.elevators, [{ letter: 'D', staffOnly: false, connected: false }]);
  assert.match(picture.svg, /<path class="plan__lift" fill="#1f2328" d="M/);
  assert.match(picture.svg, /<path class="plan__steps" fill="none" stroke="#925d00" stroke-width="1\.6" stroke-linecap="butt" d="M/);
  assert.match(picture.svg, /<path class="plan__refuge" fill="none" stroke="#0f6e66" stroke-width="1\.2" stroke-linejoin="round" stroke-linecap="round" d="M/);
  assert.match(picture.svg, />Refuge North<\/text>/);
  const other = planSvg(project, project.building.floors[1], {});
  assert.equal('elevators' in other, false, 'a floor with no stop returns none');
});

test('elevatorWords: a stop alone has the letter the next elevator takes and says it is not connected; a connected one does not', () => {
  const { project, floor, stop } = withMarks();
  assert.equal(pendingElevatorLetter(project.building), 'D');
  const alone = describeCell(project.building, floor.id, stop);
  assert.equal(elevatorWords(project, alone), 'Elevator D, not connected');
  assert.equal(elevatorWords(project, { elevator: { label: 'D', connected: true, staffOnly: false } }), 'Elevator D');
  assert.equal(elevatorWords(project, { elevator: { label: 'D', connected: true, staffOnly: true } }), 'Elevator D, staff only');
  // A, B and C are the sample school's stairs
  assert.equal(['A', 'B', 'C'].includes(pendingElevatorLetter(project.building)), false);
});

test('the cursor and announcement words name a step and an area of refuge, and a cell with neither reads as it did', () => {
  const { project, floor, step, refuge, stop } = withMarks();
  assert.equal(cellWords(project, floor.id, step), 'Corridor, Main Corridor, has a step');
  assert.equal(cellWords(project, floor.id, refuge), 'Corridor, Main Corridor, area of refuge Refuge North');
  floor.refuges[0].name = '';
  assert.equal(cellWords(project, floor.id, refuge), 'Corridor, Main Corridor, area of refuge');
  assert.equal(cellWords(project, floor.id, stop), 'Elevator D, not connected');
  floor.notStepFree.push(stop);
  assert.equal(cellWords(project, floor.id, stop), 'Elevator D, not connected, has a step');
  const plain = sampleSchool({ level: true });
  assert.equal(cellWords(plain, plain.building.floors[0].id, plain.building.floors[0].cells.indexOf('#')), 'Corridor, Main Corridor');
});

test('the printed floor plan\'s sentence says "not connected" for a stop with no car, and a building with no stop says nothing of elevators', () => {
  const { project } = withMarks();
  const page = (p) => render(p, null, { floorId: p.building.floors[0].id });
  const flat = (pages) => JSON.stringify(pages);
  assert.match(flat(page(project)), /elevator D \(not connected\)/);
  const plain = sampleSchool({ level: true });
  assert.doesNotMatch(flat(page(plain)), /elevator/);
});

// ---------------------------------------------------------------- the renderer's refuge name

const TOKENS = {
  '--paper': '#f6f3ec', '--card': '#fffdf8', '--ink': '#1f2328', '--ink-2': '#515761', '--line': '#d8d3c8', '--line-strong': '#857f73',
  '--accent': '#0f6e66', '--accent-ink': '#ffffff', '--accent-soft': '#d9ece9', '--problem': '#b3261e', '--warning': '#925d00',
  '--grid': '#e8e3d8', '--corridor': '#ffffff', '--corridor-edge': '#d8d3c8', '--stairs': '#d9ece9', '--room-default': '#e9e4d9', '--font-plan': 'sans-serif',
};
globalThis.document = globalThis.document || { documentElement: { dataset: {} } };
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: (name) => TOKENS[name] || '' }));

function recorder() {
  const writes = [];
  const state = { font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', letterSpacing: '0px' };
  const stack = [];
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)[1]);
  const ctx = {
    writes,
    measureText: (text) => ({ width: String(text).length * size() * 0.55 }),
    fillText(text, x) { writes.push({ text, x, wide: String(text).length * size() * 0.55 }); },
    strokeText() {},
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
  };
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'roundRect', 'clip', 'setLineDash', 'closePath', 'translate', 'rotate']) ctx[name] = () => {};
  for (const key of Object.keys(state)) Object.defineProperty(ctx, key, { get: () => state[key], set: (value) => { state[key] = value; }, enumerable: true });
  return ctx;
}

test('a refuge\'s name is fitted to the cells beside it: whole when it fits, smaller, then ended with an ellipsis, never wider than three cells', () => {
  for (const name of ['Hall', 'Refuge North by the old library entrance', 'Refuge']) {
    const { project, floor, refuge } = withMarks(name);
    const g = recorder();
    const canvas = { isConnected: true, width: 0, height: 0, getContext: () => g };
    const view = createViewport();
    view.resize(1100, 700);
    view.fit(drawnBox(floor), 20);
    const renderer = createRenderer(canvas);
    renderer.resize(1100, 700, 1);
    renderer.draw({ project, floor, view, selection: [], hover: null, cursor: null, preview: null });
    const written = g.writes.find((each) => each.text.toUpperCase() === each.text && name.toUpperCase().startsWith(each.text.replace('…', '').trim()) && each.text.length > 1 && each.x > 0);
    assert.ok(written, 'the name of ' + name + ' was not written: ' + JSON.stringify(g.writes.map((w) => w.text)));
    assert.ok(written.wide <= view.size * 3, name + ' is ' + written.wide + ' px wide at ' + view.size + ' px a cell');
    if (name === 'Hall') assert.equal(written.text, 'HALL');
    if (name.length > 30) assert.match(written.text, /…$/);
    assert.ok(refuge > 0);
  }
});
