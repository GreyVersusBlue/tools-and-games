// The planner's marked periods and Duties tab, the parts that need no page:
// the sentences they say, and the print of the teachers by period with duties
// before and after school (SV2-85). The journey itself is
// test/browser/marks-duties.mjs.
//
//   node test/ui/marks-duties.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { addDuty, addMark } from '../../engine/actions.js';
import { renderOutput } from '../../ui/prints/index.js';
import { teacherGridRows } from '../../engine/exports.js';
import { school, ctx, PINNED } from '../engine/helpers.mjs';

const NOW = { now: PINNED };
const shared = ctx();

function apply(action, project, payload) {
  return action(project, payload, shared);
}

function headCells(html) {
  const head = html.match(/<thead>.*?<\/thead>/s);
  return head ? Array.from(head[0].matchAll(/<th[^>]*>(.*?)<\/th>/gs), (cell) => cell[1].replace(/<[^>]+>/g, '')) : [];
}

test('the teachers by period print gives Before and After a head and a cell each, past the periods', () => {
  const project = school();
  const file = teacherGridRows(project, project.dayTypes[0].id)[0];
  assert.equal(file.includes('Before'), false, 'no duty before school: no column');
  let next = apply(addDuty, project, { kind: 'duty', label: 'Bus duty', when: 'before', teacherIds: [project.teachers[0].id] });
  next = apply(addDuty, next, { kind: 'duty', label: 'Car line', when: 'after', teacherIds: [project.teachers[1].id] });
  const rows = teacherGridRows(next, next.dayTypes[0].id);
  assert.deepEqual(rows[0].slice(-2), ['Before', 'After']);
  const { html } = renderOutput('teacher-grid', next, null, { ...NOW, dayTypeId: next.dayTypes[0].id });
  const heads = headCells(html);
  assert.deepEqual(heads.slice(-2), ['Before', 'After'], 'the heads come last');
  assert.equal(heads.length, 1 + next.settings.periods + 2);
  assert.ok(html.includes('Bus duty') && html.includes('Car line'));
  const bus = html.match(/<tr data-teacher="[^"]*">(?:(?!<\/tr>).)*Bus duty.*?<\/tr>/s)[0];
  assert.equal((bus.match(/<td/g) || []).length, next.settings.periods + 2, 'a cell for each period, then Before and After');
});
