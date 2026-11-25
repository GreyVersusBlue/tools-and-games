// Timing: editing the Grid's Rooms rows at the size the tool promises to stay
// responsive at (the fixture in test/fixtures/big.mjs: 4 floors, 150 rooms,
// 80 groups, 10 periods, two own day types). ARCHITECTURE 23.12 sets the
// budget for the model of one edit: 40 ms, failing at 80 (SLACK 2, as every
// timing file here: a CI runner is not this machine).
//
// One edit is what the page does when a cell of the Rooms rows is typed into:
// translate the cell (acrossBlock, from the typed group name), stage the
// slots (stageSlot, one remember), work out the staged schedule (preview, the
// one that applies the draft) and run the checks that mark the cells
// (checkSchedule on the staged schedule, as ui/schedule/grid/model.js does).
// Fifty edits on 50 different rooms, one more group each time, the draft
// growing as it does in a long session. The redraw of the table is the page's
// and is timed in the browser (ui/ file of the grid unit), not here.
//
// The clock is read here, in the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { acrossBlock } from '../../engine/grid-across.js';
import { checkSchedule } from '../../engine/checks.js';
import { allRooms } from '../../engine/schema.js';
import { draftFor, stageSlot, remember, preview, touch, discard, isEmptyDraft } from '../../ui/schedule/grid/staged.js';
import { bigProject } from '../fixtures/big.mjs';
import { ctx } from '../engine/helpers.mjs';

const BUDGET = 40;
const SLACK = 2;
const EDITS = 50;

test('50 edits on the Rooms rows of the big fixture, the model of each (translate, stage, preview, checks): under ' + BUDGET + ' ms', () => {
  const project = bigProject({ seed: 1 });
  const projectId = project.id;
  const own = project.dayTypes[0].id;
  const rooms = allRooms(project).slice().sort((a, b) => a.number.localeCompare(b.number));
  assert.ok(rooms.length >= EDITS, 'the fixture has rooms enough for fifty different rows: ' + rooms.length);
  discard(projectId);

  const times = [];
  let staged = 0;
  let moved = 0;
  let cleared = 0;
  let current = preview(project, projectId, ctx()).project;
  for (let edit = 0; edit < EDITS; edit += 1) {
    const room = rooms[edit];
    const period = edit % project.settings.periods;
    const group = project.groups[(edit * 7) % project.groups.length];
    const started = performance.now();
    const result = acrossBlock(current, [{ kind: 'room', roomId: room.id, dayTypeId: own, period, text: group.name }]);
    assert.equal(result.refused, null, 'edit ' + edit + ' is not refused: ' + result.refused);
    remember(projectId);
    for (const slot of result.slots) stageSlot(projectId, slot.groupId, slot.dayTypeId, slot.period, slot.fields);
    touch(projectId);
    const after = preview(project, projectId, ctx());
    assert.equal(after.refusal, null, 'the draft still applies: ' + after.refusal);
    const found = checkSchedule(after.project, null);
    times.push(performance.now() - started);
    current = after.project;
    staged += result.slots.length;
    moved += result.moved.length;
    cleared += result.cleared.length;
    assert.ok(found.findings.length > 0, 'the checks ran');
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = times.reduce((sum, ms) => sum + ms, 0) / times.length;
  console.log('# 50 Rooms-row edits, model of each: first ' + times[0].toFixed(1) + ' ms, median ' + median.toFixed(1) + ', mean ' + mean.toFixed(1) + ', slowest ' + sorted[sorted.length - 1].toFixed(1) + ' ms (budget ' + BUDGET + ', fails at ' + BUDGET * SLACK + '); ' + staged + ' slots staged, ' + moved + ' groups moved, ' + cleared + ' left with no room');

  assert.ok(!isEmptyDraft(draftFor(projectId)), 'the edits are staged');
  assert.ok(moved > 0 && staged >= moved, 'the edits moved groups (they did real work)');
  assert.ok(median < BUDGET * SLACK, 'an edit took ' + median.toFixed(1) + ' ms at the median, over ' + BUDGET * SLACK);
  assert.ok(times[0] < BUDGET * SLACK, 'the first edit took ' + times[0].toFixed(1) + ' ms, over ' + BUDGET * SLACK);
  assert.ok(sorted[sorted.length - 1] < BUDGET * SLACK * 2, 'the slowest edit took ' + sorted[sorted.length - 1].toFixed(1) + ' ms, over ' + BUDGET * SLACK * 2);
  discard(projectId);
});
