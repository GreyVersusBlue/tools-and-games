// Timing in a page: node test/timing/page.mjs
//
// The three budgets of ARCHITECTURE 14 that only a browser can measure, in
// the planner itself (Chromium through test/browser/harness.mjs, the page
// served from this checkout), with the fixture in test/fixtures/big.mjs on
// screen: 4 floors of 60 by 40, 150 rooms, 80 groups, 10 periods, two own
// day types.
//
//   paint      paint one cell and redraw the floor, from the store action to
//              the pixels being readable, with the whole floor in the
//              window: budget 16 ms. The same measure as draw-pointer.mjs's
//              last case, which stays where it is; here it is held on the
//              median of PAINTS cells (two columns of the floor), and each
//              cell's own pixel is the one read back, so the measure ends
//              on the painted cell having its corridor colour.
//   movement   the movement view's render after the worker answers: from
//              the answer being on the main thread (store.derived.results()
//              resolving) to the map's canvas holding the new picture
//              (pictureOf, the panels, the layout and the paint in the next
//              frame, read back from a lane's pixel): budget 300 ms, the
//              median of EDITS one-slot changes. The canvas is cleared before
//              each, so a frame that painted nothing reads as transparent.
//   autosave   an autosave write into IndexedDB at that size: from flush()
//              to the save's transaction being complete: budget 200 ms, the
//              median of SAVES writes, each after a change of the school's
//              name (a change that moves no counter, so no derive runs on
//              the page meanwhile), on the Project section. The last is read
//              back from IndexedDB.
//
// Each fails at twice its budget (SLACK 2, as every timing file here: a CI
// runner is not this machine) and prints the measured numbers either way.
// The clock is read in the page and in this file, never in the tool. Every
// wait is on a state the page sets, never on a count of frames.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from '../browser/harness.mjs';
import { BIG } from '../fixtures/big.mjs';

const PAINT_BUDGET = 16;
const MOVEMENT_BUDGET = 300;
const AUTOSAVE_BUDGET = 200;
const SLACK = 2;
const PAINTS = 72;
const EDITS = 7;
const SAVES = 9;

let session = null;
let page = null;

const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];

before(async () => {
  session = await openPlanner({ hash: '#building' });
  page = session.page;
  await page.evaluate(async () => {
    const { bigProject } = await import('./test/fixtures/big.mjs');
    const actions = await import('./engine/actions.js');
    const project = bigProject({ seed: 1 });
    project.onboarding.dismissed = true;
    globalThis.sv2.store.apply(actions.replaceProject, { project, label: 'Load the timing fixture' });
  });
  // the plan styled, measured and showing the fixture's first floor
  await page.waitForFunction((floors) => {
    const section = document.querySelector('.bld');
    const editor = section && section.editor;
    return Boolean(editor) && section.dataset.styled === 'true' && editor.view.width > 0 && editor.floor && editor.floor.width === 60
      && globalThis.sv2.store.project.building.floors.length === floors;
  }, {}, BIG.floors);
});

after(async () => {
  if (session) await session.close();
});

test('paint one cell and redraw the floor of the big fixture: under ' + PAINT_BUDGET + ' ms', async () => {
  const seen = await page.evaluate(async (count) => {
    const { store } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const editor = document.querySelector('.bld').editor;
    editor.fitTo({ x: 0, y: 0, w: editor.floor.width, h: editor.floor.height });
    editor.drawNow();
    const canvas = editor.canvas;
    const g = canvas.getContext('2d');
    const ratio = canvas.width / canvas.clientWidth;
    const floor = editor.floor;
    const corner = editor.view.toScreen(0, 0);
    const far = editor.view.toScreen(floor.width, floor.height);
    const whole = corner.x >= 0 && corner.y >= 0 && far.x <= canvas.clientWidth && far.y <= canvas.clientHeight;
    // two columns of empty cells, the floor's left and right edges, leaving
    // out the rows beside an exit, where the door's name is drawn over them
    const exitRows = floor.exits.map((exit) => Math.floor(exit.cell / floor.width));
    const cells = [];
    for (const x of [0, floor.width - 1]) {
      for (let y = 0; y < floor.height && cells.length < count; y += 1) if (exitRows.every((row) => Math.abs(row - y) > 1)) cells.push({ x, y });
    }
    const read = ({ x, y }) => {
      const at = editor.view.toScreen(x + 0.5, y + 0.5);
      return g.getImageData(Math.floor(at.x * ratio), Math.floor(at.y * ratio), 1, 1).data;
    };
    // The first time pixels are read back, this Chromium moves the canvas
    // out of the graphics process, which takes about a second and happens
    // once, to a test and never to a person. It is done before the clock
    // starts (draw-pointer.mjs does the same).
    const before = Array.from(read(cells[0]));
    const empty = cells.every((cell) => floor.cells[cell.y * floor.width + cell.x] === '.');
    const times = [];
    const pixels = [];
    for (const cell of cells) {
      const started = performance.now();
      store.apply(actions.paintCorridor, { floorId: floor.id, cells: [cell.y * floor.width + cell.x] });
      editor.drawNow();
      const pixel = read(cell);
      times.push(performance.now() - started);
      pixels.push(Array.from(pixel));
    }
    const corridor = editor.floor.cells;
    return { times, pixels, before, whole, empty, painted: cells.every((cell) => corridor[cell.y * floor.width + cell.x] === '#'), size: [floor.width, floor.height], rooms: floor.spaces.length };
  }, PAINTS);
  const at = median(seen.times);
  const worst = Math.max(...seen.times);
  console.log('# paint one cell and redraw, ' + seen.size.join(' by ') + ', ' + seen.rooms + ' spaces on the floor, the whole floor in the window: median ' + at.toFixed(2) + ' ms over ' + seen.times.length + ' cells (budget ' + PAINT_BUDGET + ', fails at ' + PAINT_BUDGET * SLACK + '), worst ' + worst.toFixed(2) + ' ms, first ' + seen.times[0].toFixed(2) + ' ms');

  assert.equal(seen.whole, true, 'the whole floor is in the window');
  assert.equal(seen.empty, true, 'every cell painted was empty before');
  assert.equal(seen.painted, true, 'and is a corridor cell now');
  assert.equal(seen.times.length, PAINTS);
  // the empty cell is --grid and a corridor cell --corridor (#ffffff in the light theme)
  assert.ok(seen.before.slice(0, 3).some((value) => value < 245), 'the cell was not white before: ' + seen.before.join(','));
  for (const [index, pixel] of seen.pixels.entries()) assert.ok(pixel[3] === 255 && pixel.slice(0, 3).every((value) => value >= 245), 'cell ' + index + ' reads ' + pixel.join(',') + ' after its paint, not the corridor\'s white');
  assert.ok(at < PAINT_BUDGET * SLACK, 'painting one cell and redrawing took ' + at.toFixed(2) + ' ms at the median, over ' + PAINT_BUDGET * SLACK);
});

test('the movement view\'s render of the big fixture after the worker answers: under ' + MOVEMENT_BUDGET + ' ms', async () => {
  await page.evaluate(() => {
    location.hash = '#movement';
  });
  // the view has drawn an answer for the project as it is now
  await page.waitForFunction(() => {
    const element = document.querySelector('.mov');
    const movement = element && element.movement;
    return Boolean(movement) && element.dataset.pending !== 'true' && Boolean(movement.state && movement.state.results)
      && movement.state.project === globalThis.sv2.store.project && Boolean(movement.world) && movement.view.width > 0;
  }, { timeout: 60000 });
  const opened = await page.evaluate(() => {
    const movement = document.querySelector('.mov').movement;
    return { where: movement.state.results.where, groups: movement.picture.groups.length, floors: movement.world.slots.length, drawn: movement.picture.drawn };
  });
  assert.equal(opened.where, 'worker', 'the answer came from the worker');
  assert.equal(opened.groups, BIG.groups);
  assert.equal(opened.floors, BIG.floors);
  // The first reads of a canvas's pixels move it out of the graphics
  // process, which takes a second or two, here twice: to a test, never to a
  // person. They are made before the clock starts, each after a paint of the
  // map (the plan map's paint is synchronous), until one is quick.
  const warm = await page.evaluate(() => {
    const movement = document.querySelector('.mov').movement;
    const canvas = document.querySelector('#movement-plan');
    const c = canvas.getContext('2d');
    const reads = [];
    for (let i = 0; i < 6; i += 1) {
      movement.env.paint();
      const started = performance.now();
      c.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1);
      reads.push(performance.now() - started);
      if (reads[i] < 50) break;
    }
    return reads;
  });
  assert.ok(warm[warm.length - 1] < 50, 'reading the map\'s pixels back never became quick: ' + warm.map((ms) => ms.toFixed(1)).join(', ') + ' ms');

  const each = [];
  let last = null;
  for (let i = 0; i < EDITS; i += 1) {
    last = await page.evaluate(async (g, period) => {
      const { store } = globalThis.sv2;
      const actions = await import('./engine/actions.js');
      const { allRooms } = await import('./engine/schema.js');
      const element = document.querySelector('.mov');
      const movement = element.movement;
      const canvas = document.querySelector('#movement-plan');
      const ratio = canvas.width / canvas.clientWidth;
      const c = canvas.getContext('2d');
      // a point on a lane of a group this run does not move: the first walk of the first group with one on the map
      const project = store.project;
      const day = movement.state.results.routes.days.find((each) => each.dayTypeId === movement.choice.dayTypeId);
      let spot = null;
      for (const entry of day.groups) {
        if (entry.groupId === project.groups[g].id) continue;
        for (const route of entry.routes) {
          if (!route || route.ok !== true || route.same === true) continue;
          const step = route.cells[Math.floor(route.cells.length / 2)];
          const lane = movement.laneAt(entry.groupId, step.floorId, step.cell);
          if (lane && lane.x > 0 && lane.y > 0 && lane.x < canvas.clientWidth && lane.y < canvas.clientHeight) {
            spot = { x: Math.floor(lane.x * ratio), y: Math.floor(lane.y * ratio), groupId: entry.groupId };
            break;
          }
        }
        if (spot) break;
      }
      if (!spot) return { failed: 'no lane point on the canvas to read back' };
      // the group in another room for one period, on the day type on screen
      const rooms = allRooms(project);
      const dayTypeId = movement.choice.dayTypeId;
      const now = project.groups[g].days[dayTypeId][period].room;
      let at = (g * 7 + period * 3) % rooms.length;
      if (rooms[at].id === now) at = (at + 1) % rooms.length;

      return new Promise((resolve) => {
        let answered = null;
        let seen = 0;
        let asked = 0;
        const real = store.derived.results;
        store.derived.results = function results(...args) {
          return real.apply(this, args).then((value) => {
            if (answered === null) answered = { at: performance.now(), where: value && value.where, transitions: value && value.work ? value.work.transitionsRun : null };
            return value;
          });
        };
        // the view reads as pending from the change until its answer is in
        // and drawn into the next frame; the observer runs once the view
        // has done all it does on the answer, and the frame asked for after
        // that is the one the map paints in
        const observer = new MutationObserver(() => {
          if (element.dataset.pending === 'true' || answered === null) return;
          observer.disconnect();
          seen = performance.now();
          store.derived.results = real;
          requestAnimationFrame(() => {
            const pixel = Array.from(c.getImageData(spot.x, spot.y, 1, 1).data);
            const painted = performance.now();
            resolve({
              ms: painted - answered.at,
              split: [answered.at - asked, seen - answered.at, painted - seen],
              pixel,
              where: answered.where,
              transitions: answered.transitions,
              current: movement.state.project === store.project,
              moved: store.project.groups[g].days[dayTypeId][period].room === rooms[at].id,
            });
          });
        });
        observer.observe(element, { attributes: true, attributeFilter: ['data-pending'] });
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.restore();
        asked = performance.now();
        store.apply(actions.setSlot, { groupId: project.groups[g].id, dayTypeId, period, slot: { room: rooms[at].id } });
      });
    }, 5 + i * 11, 1 + (i % 8));
    assert.equal(last.failed, undefined, last.failed);
    assert.equal(last.where, 'worker', 'edit ' + i + ': the answer came from the worker');
    assert.equal(last.current, true, 'edit ' + i + ': the view drew the project as it is after the edit');
    assert.equal(last.moved, true, 'edit ' + i + ': the group is in its new room');
    assert.equal(last.pixel[3], 255, 'edit ' + i + ': the lane\'s pixel was painted in the frame after the answer: ' + last.pixel.join(','));
    each.push(last.ms);
    console.log('# movement edit ' + i + ': change to answer ' + last.split[0].toFixed(1) + ' ms, answer to the view done ' + last.split[1].toFixed(1) + ' ms, then to the painted frame ' + last.split[2].toFixed(1) + ' ms');
  }
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  const at = median(each);
  console.log('# movement render after the worker answers: median ' + at.toFixed(1) + ' ms of ' + each.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + MOVEMENT_BUDGET + ', fails at ' + MOVEMENT_BUDGET * SLACK + '); ' + opened.drawn + ' routes of ' + opened.groups + ' groups on ' + opened.floors + ' floors; ' + last.transitions + ' transitions run a change; the lane read back ' + last.pixel.slice(0, 3).join(',') + '; the pixel reads before the clock: ' + warm.map((ms) => ms.toFixed(1)).join(', ') + ' ms');

  const paperRgb = [1, 3, 5].map((index) => parseInt(paper.slice(index, index + 2), 16));
  assert.ok(last.pixel.slice(0, 3).some((value, index) => Math.abs(value - paperRgb[index]) > 12), 'the lane\'s pixel is not the paper (' + paper + '): ' + last.pixel.join(','));
  assert.ok(at < MOVEMENT_BUDGET * SLACK, 'the movement view took ' + at.toFixed(1) + ' ms at the median from the answer to the painted map, over ' + MOVEMENT_BUDGET * SLACK);
});

test('an autosave write of the big fixture into IndexedDB: under ' + AUTOSAVE_BUDGET + ' ms', async () => {
  await page.evaluate(() => {
    location.hash = '#project';
  });
  await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'project' && globalThis.sv2.storage.pending === false && globalThis.sv2.storage.state.save === 'saved');
  const seen = await page.evaluate(async (count) => {
    const { store, storage } = globalThis.sv2;
    const actions = await import('./engine/actions.js');
    const times = [];
    let name = '';
    for (let i = 0; i < count; i += 1) {
      name = 'Tarnwick Fixture School ' + (i + 1);
      const before = storage.state.savedAt;
      store.apply(actions.setSetting, { key: 'schoolName', value: name });
      if (!storage.pending) return { failed: 'the change of name left nothing to save' };
      const started = performance.now();
      await storage.flush();
      times.push(performance.now() - started);
      if (storage.state.save !== 'saved' || storage.state.savedAt === before) return { failed: 'save ' + i + ' did not save: ' + storage.state.save + ', ' + storage.state.saveError };
    }
    // the last write, read back from IndexedDB
    const record = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('sv2');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const got = db.transaction('project', 'readonly').objectStore('project').get('current');
        got.onerror = () => reject(got.error);
        got.onsuccess = () => {
          db.close();
          resolve(got.result);
        };
      };
    });
    return {
      times,
      savedAt: storage.state.savedAt,
      record: { savedAt: record.savedAt, name: record.project.settings.schoolName, groups: record.project.groups.length, floors: record.project.building.floors.length, bytes: JSON.stringify(record.project).length },
      name,
    };
  }, SAVES);
  assert.equal(seen.failed, undefined, seen.failed);
  const at = median(seen.times);
  console.log('# autosave write into IndexedDB: median ' + at.toFixed(1) + ' ms of ' + seen.times.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + AUTOSAVE_BUDGET + ', fails at ' + AUTOSAVE_BUDGET * SLACK + '); the project is ' + (seen.record.bytes / 1024).toFixed(0) + ' KB as JSON');

  assert.equal(seen.times.length, SAVES);
  assert.equal(seen.record.savedAt, seen.savedAt, 'the record in IndexedDB is the last save');
  assert.equal(seen.record.name, seen.name, 'and holds the last change');
  assert.equal(seen.record.groups, BIG.groups);
  assert.equal(seen.record.floors, BIG.floors);
  assert.ok(at < AUTOSAVE_BUDGET * SLACK, 'an autosave write took ' + at.toFixed(1) + ' ms at the median, over ' + AUTOSAVE_BUDGET * SLACK);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
