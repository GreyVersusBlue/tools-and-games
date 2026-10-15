// The Groups tab's places in the history, with no browser:
//
//   node test/ui/schedule-address.test.mjs
//
// The readers of an address (ui/schedule/address.js: `scheduleRest`,
// `writtenAsList`, `showsList`, `groupOf`, and `focusHash`, which is the
// rule of ui/app.js's `hashForFocus`), the list's one Tab stop
// (ui/schedule/groups.js, `listStop`), and the history a phone keeps of the
// list and a group's editor (`toGroup`, `toList`, `spentEntry`), worked on
// a stand-in for the browser's history at the top of this file: a list of
// entries and a place in it, nothing else. A step back or forward here is
// taken at once; in a browser it comes a moment later, which the browser
// cases (test/browser/m2-pass.mjs, SV2-54) wait for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { scheduleRest, writtenAsList, showsList, groupOf, focusHash, groupHash, slotHash, GROUPS_HASH } from '../../ui/schedule/address.js';
import { listStop, toGroup, toList, spentEntry } from '../../ui/schedule/groups.js';
import { deleteGroup } from '../../engine/actions.js';
import { school, ctx, group } from '../engine/helpers.mjs';

const SECTIONS = ['building', 'schedule', 'movement', 'scenarios', 'safety', 'staff', 'project'];

// ---------------------------------------------------------------- a history to stand on

// The browser's history as far as groups.js uses it: `location.hash`,
// `history.state`, `pushState`, `replaceState`, `back`, `forward`, and the
// shell's `navigate`, which sets the address (a new entry).
function standIn(start) {
  const entries = [{ hash: start, state: null }];
  let at = 0;
  const location = {
    get hash() {
      return entries[at].hash;
    },
  };
  const history = {
    get state() {
      return entries[at].state;
    },
    get length() {
      return entries.length;
    },
    pushState(state, title, hash) {
      entries.splice(at + 1);
      entries.push({ hash, state });
      at += 1;
    },
    replaceState(state, title, hash) {
      entries[at] = { hash: hash === undefined ? entries[at].hash : hash, state };
    },
    back() {
      if (at > 0) at -= 1;
    },
    forward() {
      if (at < entries.length - 1) at += 1;
    },
  };
  globalThis.location = location;
  globalThis.history = history;
  return {
    history,
    navigate(hash) {
      if (location.hash !== hash) history.pushState(null, '', hash);
    },
    // the addresses from the first entry to the last, and where the page is
    hashes: () => entries.map((entry) => entry.hash),
    at: () => at,
  };
}

function planner(project, start) {
  const page = standIn(start);
  return { page, ctx: { store: { project }, navigate: page.navigate } };
}

// ---------------------------------------------------------------- reading an address

test('scheduleRest is what follows "#schedule/", empty for the section alone, and null for another section', () => {
  assert.equal(scheduleRest('#schedule'), '');
  assert.equal(scheduleRest('#schedule/'), '');
  assert.equal(scheduleRest('#schedule/groups'), 'groups');
  assert.equal(scheduleRest('#schedule/groups/g1/d1/0'), 'groups/g1/d1/0');
  assert.equal(scheduleRest('#/schedule/grid'), 'grid');
  assert.equal(scheduleRest('#project'), null);
  assert.equal(scheduleRest('#schedules'), null);
  assert.equal(scheduleRest(''), null);
});

test('writtenAsList is the Groups tab with no group written in it, whatever the project holds', () => {
  for (const hash of ['#schedule', '#schedule/', '#schedule/groups', '#schedule/groups/']) assert.equal(writtenAsList(hash), true, hash);
  for (const hash of ['#schedule/groups/gsample06a', '#schedule/groups/gone', '#schedule/grid', '#project', '']) assert.equal(writtenAsList(hash), false, hash);
});

test('showsList is the list in this project: no group, or a group the project does not have; and groupOf is the group it names', () => {
  const project = school();
  const a6 = group(project, '6A');
  assert.equal(showsList(project, '#schedule/groups'), true);
  assert.equal(showsList(project, '#schedule'), true);
  assert.equal(showsList(project, '#schedule/groups/gnobody0001'), true, 'a group the project does not have shows the list');
  assert.equal(showsList(project, groupHash(a6.id)), false);
  assert.equal(showsList(project, slotHash(a6.id, 'dsample00a', 2)), false);
  assert.equal(showsList(project, '#schedule/grid'), false, 'another tab is not the list');
  assert.equal(showsList(project, '#project'), false);
  assert.equal(groupOf(project, groupHash(a6.id)), a6);
  assert.equal(groupOf(project, slotHash(a6.id, 'dsample00a', 2)), a6, 'a slot\'s address names its group');
  assert.equal(groupOf(project, '#schedule/groups'), null);
  assert.equal(groupOf(project, '#schedule/groups/gnobody0001'), null);
  assert.equal(groupOf(project, '#schedule/grid/' + a6.id), null, 'another tab names no group');
  assert.equal(groupOf(project, '#project'), null);
  // a group deleted since the address was written
  const after = deleteGroup(project, { id: a6.id }, ctx());
  assert.equal(groupOf(after, groupHash(a6.id)), null);
  assert.equal(showsList(after, groupHash(a6.id)), true);
});

test('focusHash, the rule of hashForFocus: a slot\'s change is the slot\'s address, a group\'s the group\'s, and the list only when no group is named', () => {
  const at = (focus) => focusHash(focus, SECTIONS);
  assert.equal(at({ section: 'schedule', tab: 'groups', groupId: 'gsample06c', dayTypeId: 'dsample00a', period: 3 }), '#schedule/groups/gsample06c/dsample00a/3');
  assert.equal(at({ section: 'schedule', tab: 'groups', groupId: 'gsample06c', dayTypeId: 'dsample00a', period: 0 }), '#schedule/groups/gsample06c/dsample00a/0', 'period 0 is a period');
  assert.equal(at({ section: 'schedule', tab: 'groups', groupId: 'gsample06c', dayTypeId: 'dsample00a' }), '#schedule/groups/gsample06c', 'no period: the group');
  assert.equal(at({ section: 'schedule', tab: 'groups', groupId: 'gsample06c' }), '#schedule/groups/gsample06c');
  assert.equal(at({ section: 'schedule', tab: 'groups' }), '#schedule/groups');
  assert.equal(at({ section: 'schedule', tab: 'teachers', teacherId: 'tsample001' }), '#schedule/teachers');
  assert.equal(at({ section: 'schedule' }), '#schedule');
  assert.equal(at({ section: 'building', floorId: 'fsample001' }), '#building/fsample001');
  assert.equal(at({ section: 'building' }), '#building');
  assert.equal(at({ section: 'project' }), '#project');
  assert.equal(at({ section: 'nowhere' }), null);
  assert.equal(at(null), null);
  assert.equal(at(undefined), null);
});

test('listStop is the chosen card, or the first the filter leaves, or the filter box when it leaves none, or "Add a group" with no groups', () => {
  const project = school();
  const id = (name) => group(project, name).id;
  assert.equal(listStop(project, { groupId: id('6B'), filter: '' }), 'group:' + id('6B'));
  assert.equal(listStop(project, { groupId: id('6B'), filter: 'b' }), 'group:' + id('6B'), 'a filter that leaves the chosen one');
  assert.equal(listStop(project, { groupId: id('6A'), filter: '7' }), 'group:' + id('7A'), 'a filter that hides the chosen one');
  assert.equal(listStop(project, { groupId: id('6A'), filter: ' 8 ' }), 'group:' + id('8A'), 'a filter is read without its spaces');
  assert.equal(listStop(project, { groupId: id('6A'), filter: 'zzz' }), 'group-filter');
  assert.equal(listStop(project, { groupId: null, filter: '' }), 'group:' + id('6A'), 'none chosen: the first');
  assert.equal(listStop({ ...project, groups: [] }, { groupId: null, filter: '' }), 'group-add');
});

// ---------------------------------------------------------------- the phone's history

test('a group chosen from the list is a new entry above it, and "All groups" goes back to the list: Forward is the group again', () => {
  const project = school();
  const a6 = group(project, '6A').id;
  const { page, ctx: shell } = planner(project, '#schedule/groups');
  toGroup(shell, a6);
  assert.deepEqual(page.hashes(), ['#schedule/groups', groupHash(a6)]);
  toList();
  assert.equal(page.at(), 0, '"All groups" made an entry instead of going back');
  assert.equal(location.hash, '#schedule/groups');
  page.history.forward();
  assert.equal(location.hash, groupHash(a6), 'a group still there is a place to go forward to');
  assert.equal(spentEntry(), false);
});

test('SV2-54 item 5: a gone group\'s entry above the list is spent: Forward onto it is to be stepped back from, and it is never the gone group\'s address', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const { page, ctx: shell } = planner(project, '#schedule/groups');
  toGroup(shell, c6);
  toList(true);
  assert.equal(page.at(), 0);
  assert.equal(spentEntry(), false, 'the list under it is not spent');
  assert.deepEqual(page.hashes(), ['#schedule/groups', '#schedule/groups'], 'the gone group\'s address is still in the history');
  page.history.forward();
  assert.equal(location.hash, '#schedule/groups');
  assert.equal(spentEntry(), true, 'Forward landed on an entry that is not marked spent');
});

test('SV2-54 item 5: from an entry the list was not under, a gone group\'s address is replaced by the list\'s, and nothing is spent', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const { page } = planner(project, '#project');
  page.navigate(groupHash(c6));
  toList(true);
  assert.deepEqual(page.hashes(), ['#project', '#schedule/groups']);
  assert.equal(page.at(), 1);
  assert.equal(spentEntry(), false);
});

test('SV2-54 item 5: the chosen group, on its own slot\'s address, adds no entry; another group from a slot\'s address does', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const a7 = group(project, '7A').id;
  const slot = slotHash(c6, 'dsample00a', 3);
  const { page, ctx: shell } = planner(project, '#schedule/groups');
  page.navigate(slot);
  toGroup(shell, c6);
  assert.deepEqual(page.hashes(), ['#schedule/groups', slot], 'a tap on the chosen card made an entry');
  toGroup(shell, a7);
  assert.deepEqual(page.hashes(), ['#schedule/groups', slot, groupHash(a7)]);
  assert.equal(history.state, null, 'a slot\'s address is not the list: the new entry has no list under it');
});
