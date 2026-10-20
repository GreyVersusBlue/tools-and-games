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

import { scheduleRest, writtenAsList, showsList, groupOf, namesGoneGroup, focusHash, groupHash, slotHash, GROUPS_HASH } from '../../ui/schedule/address.js';
import { listStop, toGroup, toList, spentEntry, stepOffSpent, placeView, placeInHistory, openAddress } from '../../ui/schedule/groups.js';
import { deleteGroup } from '../../engine/actions.js';
import { school, ctx, group } from '../engine/helpers.mjs';

const SECTIONS = ['building', 'schedule', 'movement', 'scenarios', 'safety', 'staff', 'project'];

// ---------------------------------------------------------------- a history to stand on

// The browser's history as far as groups.js uses it: `location.hash`,
// `history.state`, `pushState`, `replaceState`, `back`, `forward`, and the
// shell's `navigate`, which sets the address (a new entry). A step back or
// forward that moves calls `page.popstate`, when a test has set one, as the
// browser fires `popstate`.
function standIn(start) {
  const entries = [{ hash: start, state: null }];
  let at = 0;
  let page = null;
  const stepped = () => {
    if (page.popstate) page.popstate();
  };
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
      if (at === 0) return;
      at -= 1;
      stepped();
    },
    forward() {
      if (at === entries.length - 1) return;
      at += 1;
      stepped();
    },
  };
  globalThis.location = location;
  globalThis.history = history;
  page = {
    popstate: null,
    history,
    navigate(hash) {
      if (location.hash !== hash) history.pushState(null, '', hash);
    },
    // the addresses from the first entry to the last, and where the page is
    hashes: () => entries.map((entry) => entry.hash),
    at: () => at,
  };
  return page;
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

test('namesGoneGroup is an address naming a group the project does not have, and nothing else', () => {
  const project = school();
  const a6 = group(project, '6A');
  const after = deleteGroup(project, { id: a6.id }, ctx());
  assert.equal(namesGoneGroup(after, groupHash(a6.id)), true);
  assert.equal(namesGoneGroup(after, slotHash(a6.id, 'dsample00a', 2)), true, 'a gone group\'s slot');
  assert.equal(namesGoneGroup(project, '#schedule/groups/gnobody0001'), true);
  assert.equal(namesGoneGroup(project, groupHash(a6.id)), false, 'a group the project has');
  for (const hash of ['#schedule', '#schedule/groups', '#schedule/groups/', '#schedule/grid/' + a6.id, '#project', '']) assert.equal(namesGoneGroup(after, hash), false, hash);
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

// Settled by SV2-72e: "an entry the list was not under" is one the page
// came to from another section, opened the way every link into the
// schedule opens a group or a slot (`openAddress`; Movement's "Fix it in the
// schedule" is this, from #movement). The list is not under it, so it is
// not marked, and a gone group's address there becomes the list's.
test('SV2-54 item 5: from an entry the list was not under, a gone group\'s address is replaced by the list\'s, and nothing is spent', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const { page, ctx: shell } = planner(project, '#movement');
  openAddress(shell, slotHash(c6, 'dsample00a', 2));
  assert.equal(history.state, null, 'opened from Movement, the entry is marked as having the list under it');
  toList(true);
  assert.deepEqual(page.hashes(), ['#movement', '#schedule/groups']);
  assert.equal(page.at(), 1);
  assert.equal(spentEntry(), false);
});

// ---------------------------------------------------------------- SV2-72e

// The review of SV2-56, finding 3 (probe-history.mjs, B): a group opened by
// an address over the list (a finding's Show beside the Groups tab) had no
// mark, so a Delete on a phone wrote the list in its place, over the list.
test('SV2-72e item 1: a group\'s or a slot\'s address opened over the list is marked, and a Delete or "All groups" goes back to that list: it is in the history once', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  for (const hash of [slotHash(c6, 'dsample00a', 2), groupHash(c6)]) {
    for (const how of ['delete', 'all groups']) {
      const { page, ctx: shell } = planner(project, '#project');
      page.navigate(GROUPS_HASH);
      openAddress(shell, hash);
      assert.deepEqual(page.hashes(), ['#project', GROUPS_HASH, hash], hash + ': no entry of its own');
      assert.equal(history.state && history.state.scheduleListUnder, true, hash + ': opened over the list, the entry has no list mark');
      toList(how === 'delete');
      assert.equal(page.at(), 1, how + ' from ' + hash + ' wrote the list over the list');
      assert.equal(location.hash, GROUPS_HASH);
      page.history.back();
      assert.equal(location.hash, '#project', how + ' from ' + hash + ': Back from the list showed the list twice');
    }
  }
});

test('SV2-72e item 1: an address of the group the page is at takes its entry\'s place, mark and all; the page at the address itself makes no entry', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const a7 = group(project, '7A').id;
  const slot = slotHash(c6, 'dsample00a', 2);
  const { page, ctx: shell } = planner(project, GROUPS_HASH);
  toGroup(shell, c6);
  openAddress(shell, slot);
  assert.deepEqual(page.hashes(), [GROUPS_HASH, slot], 'Show from the group\'s own editor put a second entry of the group above it');
  assert.equal(history.state && history.state.scheduleListUnder, true, 'the slot in the group\'s place lost the list mark');
  openAddress(shell, slot);
  assert.deepEqual(page.hashes(), [GROUPS_HASH, slot], 'the address the page is at made an entry');
  // deleted there: back to the list, once
  toList(true);
  assert.equal(page.at(), 0);
  // another group's address from a group's is a new entry, with no list under it
  toGroup(shell, c6);
  openAddress(shell, slotHash(a7, 'dsample00a', 0));
  assert.deepEqual(page.hashes(), [GROUPS_HASH, groupHash(c6), slotHash(a7, 'dsample00a', 0)]);
  assert.equal(history.state, null, 'another group\'s address has the list under it');
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

// ---------------------------------------------------------------- SV2-56

// The review of SV2-54's walk (probe-wide-delete.mjs): 6C chosen on a phone,
// the phone on its side, 6C deleted there (a wide screen writes no address,
// so the page stays on 6C's), turned upright, 7A tapped, "All groups", Back.
// `placeView` is what the turn upright does (ui/schedule/index.js).
function wideDelete(folded) {
  let project = school();
  const c6 = group(project, '6C').id;
  const a7 = group(project, '7A').id;
  const { page, ctx: shell } = planner(project, '#schedule/groups');
  toGroup(shell, c6);
  project = deleteGroup(project, { id: c6 }, ctx());
  shell.store.project = project;
  // the drawing after a Delete opens the list and chooses the first group;
  // a click on 7A while still wide folds the list to it
  const view = { groupId: folded ? a7 : project.groups[0].id, folded };
  placeView(shell, view);
  return { page, shell, view, c6, a7 };
}

test('SV2-56 item 1: a Delete while wide, then upright, a tap on another group, All groups and Back never shows the list twice', () => {
  const { page, shell, c6, a7 } = wideDelete(false);
  assert.equal(location.hash, GROUPS_HASH, 'turned upright, the page is still at the gone group\'s address');
  assert.equal(page.at(), 0, 'the gone group\'s entry is left above the list instead of stepped back from');
  toGroup(shell, a7);
  assert.deepEqual(page.hashes(), [GROUPS_HASH, groupHash(a7)], 'the gone group is still in the history under 7A');
  toList();
  assert.equal(page.at(), 0);
  assert.equal(location.hash, GROUPS_HASH);
  assert.equal(page.hashes().includes(groupHash(c6)), false);
  // Back from the list leaves the section: there is no second list under it
  page.history.back();
  assert.equal(page.at(), 0);
});

test('SV2-56 item 1: a Delete while wide, another group chosen wide, then upright: that group is in the gone one\'s place, the list under it', () => {
  const { page, a7 } = wideDelete(true);
  assert.deepEqual(page.hashes(), [GROUPS_HASH, groupHash(a7)], 'turned upright, the gone group\'s entry is still a list under the editor');
  assert.equal(history.state && history.state.scheduleListUnder, true, 'the list under it is forgotten');
  toList();
  assert.equal(page.at(), 0, '"All groups" made an entry instead of going back');
  assert.equal(location.hash, GROUPS_HASH);
});

test('SV2-56 item 1: an undone Add while wide is a gone group too', () => {
  const project = school();
  const a6 = group(project, '6A').id;
  // the group the Add made, chosen on a phone, then gone by an Undo while wide
  const { page, ctx: shell } = planner(project, '#schedule/groups');
  page.navigate(groupHash('gadded00001'));
  history.replaceState({ scheduleListUnder: true }, '');
  placeView(shell, { groupId: a6, folded: false });
  assert.equal(page.at(), 0, 'turned upright, the gone group\'s entry is still above the list');
  assert.equal(location.hash, GROUPS_HASH);
  page.history.forward();
  assert.equal(spentEntry(), true, 'the gone group\'s entry above the list is not spent');
});

test('SV2-56 item 3: Forward onto a spent entry steps straight back to the list under it, and Forward onto a group still there stays', () => {
  const project = school();
  const c6 = group(project, '6C').id;
  const a7 = group(project, '7A').id;
  const page = planner(project, '#schedule/groups').page;
  const shell = { store: { project }, navigate: page.navigate };
  page.popstate = stepOffSpent;
  toGroup(shell, c6);
  toList(true);
  assert.equal(page.at(), 0);
  page.history.forward();
  assert.equal(page.at(), 0, 'Forward was left on the spent entry');
  assert.equal(location.hash, GROUPS_HASH);
  assert.equal(stepOffSpent(), false, 'the list under it is not spent');
  // a group chosen afterwards drops the spent entry: Forward is that group
  toGroup(shell, a7);
  toList();
  page.history.forward();
  assert.equal(location.hash, groupHash(a7));
  assert.equal(page.at(), 1);
});

// ---------------------------------------------------------------- SV2-56b

// The review of SV2-56 (probe-history.mjs, A): the only group, chosen on a
// phone, deleted while the phone lay on its side, then upright. The turn
// upright returned when the project had no groups left, so the gone group's
// entry stayed above the list, marked as having the list under it: "Add a
// group" put the new group above that, "All groups" went back to it, and
// Back from there was the list again. `placeInHistory` is what
// ui/schedule/index.js calls when the screen crosses to narrow.
test('SV2-56b: the only group deleted while wide, then upright, Add a group, All groups and Back never shows the list twice', () => {
  let project = school();
  const { page, ctx: shell } = planner(project, '#project');
  page.navigate(GROUPS_HASH);
  const first = project.groups[0].id;
  toGroup(shell, first);
  for (const each of project.groups) project = deleteGroup(project, { id: each.id }, ctx());
  shell.store.project = project;
  assert.equal(project.groups.length, 0);
  // the drawing of a project with no groups chooses none and opens the list
  const view = { groupId: null, folded: false };
  placeInHistory(shell, view, 'groups');
  assert.equal(location.hash, GROUPS_HASH, 'turned upright with no groups left, the page is still at the gone group\'s address');
  assert.deepEqual(page.hashes().slice(0, page.at() + 1), ['#project', GROUPS_HASH], 'the gone group\'s entry is still above the list');
  // "Add a group" on the phone: the new group is chosen from the list
  project = { ...project, groups: [{ ...school().groups[1], id: 'gadded00001' }] };
  shell.store.project = project;
  toGroup(shell, 'gadded00001');
  toList();
  assert.equal(location.hash, GROUPS_HASH);
  page.history.back();
  assert.equal(location.hash, '#project', 'Back from the list showed the list twice');
});
