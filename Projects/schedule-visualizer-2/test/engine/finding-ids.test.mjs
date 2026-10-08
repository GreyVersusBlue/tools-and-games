// One form for every finding's id, whichever check made it (findings.js):
// the kind, then what the finding is about, joined by colons, where each part
// is an id, a whole number (a period, a cell) or the word "building". Never a
// name or a number somebody typed, so the id is the same after a rename and
// an accepted finding stays accepted. node test/engine/finding-ids.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingChecks, BUILDING_CHECK_KINDS } from '../../engine/building-checks.js';
import { checkSchedule } from '../../engine/checks.js';
import { findingId } from '../../engine/findings.js';
import { CHECK_KINDS } from '../../engine/schema.js';
import { isId } from '../../engine/ids.js';
import { school } from './helpers.mjs';

// The sample school with one of everything the building checks look for.
function brokenBuilding() {
  const project = school();
  const floor = project.building.floors[0];
  floor.spaces[0].number = '';
  floor.spaces[2].number = ' 102 ';
  floor.spaces[1].doors.push({ cell: floor.spaces[1].cells[0], side: 'n' });
  floor.spaces.push({ id: 'rsample199', kind: 'room', cells: [13 * 40 + 39], number: '<b>199</b>: annex', teacherIds: [], subjectId: null, wing: '', capacity: null, shared: false, doors: [] });
  const cells = floor.cells.split('');
  cells[0] = 'S';
  floor.cells = cells.join('');
  project.building.connections = [];
  return project;
}

function noExits() {
  const project = school();
  project.building.floors[0].exits = [];
  return project;
}

function partsOf(finding) {
  assert.ok(finding.id.startsWith(finding.kind + ':'), finding.id + ' starts with its kind');
  return finding.id.slice(finding.kind.length + 1).split(':');
}

function assertForm(finding) {
  const parts = partsOf(finding);
  for (const part of parts) assert.ok(isId(part) || /^\d+$/.test(part) || part === 'building', '"' + part + '" in ' + finding.id + ' is an id, a whole number or "building"');
  assert.equal(finding.id, findingId(finding.kind, ...parts), 'and it is what findingId builds');
}

test('every building finding\'s id has the form findings.js gives the schedule findings, for all nine kinds', () => {
  const findings = buildingChecks(brokenBuilding()).concat(buildingChecks(noExits()));
  assert.deepEqual(BUILDING_CHECK_KINDS.filter((kind) => !findings.some((finding) => finding.kind === kind)), [], 'every kind is among the findings checked');
  for (const finding of findings) assertForm(finding);
  assert.equal(new Set(findings.map((finding) => finding.id)).size, findings.length, 'and no two share one');
});

test('every schedule finding\'s id has that form too', () => {
  const project = school();
  project.building.floors[0].spaces[0].number = 'Room: "101"';
  const walks = { groups: [{ dayTypeId: 'dsample00a', groupId: 'gsample08a', period: 5, fromRoomId: 'rsamplegym', toRoomId: 'rsample303', passingSeconds: 240, total: 261, walking: 261, waiting: 0, late: true, arrived: true }], teachers: [] };
  const findings = checkSchedule(project, walks).findings;
  assert.ok(findings.length >= 4);
  for (const finding of findings) {
    assert.ok(CHECK_KINDS.includes(finding.kind));
    assertForm(finding);
  }
});
