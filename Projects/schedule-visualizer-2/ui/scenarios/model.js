// The scenario lab's words and lists, worked out from the project and from
// the scenario lane's answer, with no page. ui/scenarios/index.js and its
// panels draw them; nothing here re-implements a rule of the engine: the
// chips are engine/scenario.js's changeWords, what applies is its reconcile,
// the figures are its compareResults as the lane hands them over.

import { baseDayType, isOwnCopy } from '../../engine/day-types.js';
import { periodName } from '../../engine/bells.js';
import { resolveSlotRoom, nameOfRoom } from '../../engine/schema.js';
import { formatDuration } from '../../engine/findings.js';
import { reconcile, changeWords } from '../../engine/scenario.js';
import { NEW_SCENARIO_NAME } from '../../engine/actions.js';
import { count, list } from '../components/words.js';

// The scenario's name as the screen says it: as typed, or "New scenario"
// where a file left it blank (the actions' own rule for their labels).
export function scenarioName(scenario) {
  const name = scenario && typeof scenario.name === 'string' ? scenario.name : '';
  return name.replace(/[\s​-‍⁠﻿]/g, '') === '' ? NEW_SCENARIO_NAME : name;
}

// The day types a change can name: those that are their own copy, each
// with the day types that follow it named, "A Day (B Day is the same)".
// A day type that is "the same as" another has no schedule of its own to
// change (ARCHITECTURE 6.6, Scenario semantics).
export function dayChoices(project) {
  const base = baseDayType(project);
  const followers = project.dayTypes.filter((day) => !isOwnCopy(project, day.id)).map((day) => day.name);
  return project.dayTypes.filter((day) => isOwnCopy(project, day.id)).map((day) => {
    const same = day.id === base.id && followers.length > 0 ? ' (' + list(followers) + (followers.length === 1 ? ' is' : ' are') + ' the same)' : '';
    return { value: day.id, label: day.name + same, name: day.name };
  });
}

export function periodChoices(project) {
  const out = [];
  for (let period = 0; period < project.settings.periods; period += 1) out.push({ value: String(period), label: periodName(project.settings, period) });
  return out;
}

export function groupChoices(project) {
  return project.groups.map((group) => ({ value: group.id, label: group.name }));
}

// What a slot holds now, as the forms say it: "Room 204", "a room not in
// the building (204)", or "no room".
export function slotWords(project, dayTypeId, groupId, period) {
  const group = project.groups.find((each) => each.id === groupId);
  const day = group && group.days ? group.days[dayTypeId] : null;
  const slot = day ? day[period] : null;
  if (!slot) return 'no room';
  const found = resolveSlotRoom(project, slot);
  if (found.room) return nameOfRoom(found.room);
  if (found.text) return found.text + ', not in the building';
  return 'no room';
}

// The open scenario as the lab shows it: reconcile's kept changes, each
// with its words and its index in scenario.changes (the chips' ×), and the
// dropped ones with their sentences.
export function scenarioView(project) {
  const scenario = project.scenario;
  if (!scenario) return null;
  const found = reconcile(project, scenario);
  const indexOf = (change) => scenario.changes.indexOf(change);
  return {
    name: scenarioName(scenario),
    changes: scenario.changes,
    kept: found.changes.map((change) => ({ change, index: indexOf(change), words: changeWords(project, change) })),
    dropped: found.dropped.map((each) => ({ change: each.change, index: indexOf(each.change), parts: each.parts, sentence: each.sentence })),
    compared: scenario.compared || null,
  };
}

// The screen's first line, as parts ({ text, name }: name for typed text).
export function firstLine(project, view) {
  if (!view) return [{ text: 'No scenario is open. Start one to try changes to the schedule without touching it; the real schedule changes only when you apply.' }];
  const n = view.kept.length;
  const parts = [{ text: 'Trying ' }, { text: view.name, name: true }, { text: ': ' + count(n, 'change') + ', not applied' }];
  if (view.dropped.length > 0) parts.push({ text: '; ' + count(view.dropped.length, 'change') + ' no longer ' + (view.dropped.length === 1 ? 'applies' : 'apply') });
  parts.push({ text: '. The real schedule is untouched until you apply.' });
  return parts;
}

// "Not applied yet: 3 changes", for the bar at the foot (spec 3.1: staged
// work says so on screen).
export function barWords(view) {
  if (!view) return '';
  return 'Not applied yet: ' + count(view.kept.length, 'change') + (view.dropped.length > 0 ? ', ' + view.dropped.length + ' skipped' : '');
}

// Did adding `change` cancel it? normalise drops the added change when it
// leaves its slots as the schedule has them, taking out the earlier changes
// on those slots with it (DECISIONS 2026-10-16 09:19). Then the change is in
// neither list, and `taken` says how many earlier changes went with it.
export function cancelled(before, after, change) {
  const had = before ? before.changes : [];
  const has = after ? after.changes : [];
  const same = (a) => Object.keys(change).every((key) => a[key] === change[key]) && Object.keys(a).length === Object.keys(change).length;
  if (has.some(same)) return null;
  return { taken: Math.max(0, had.length - has.length) };
}

export function cancelledSentence(words, taken) {
  return 'That puts the schedule back as it is: ' + words + '. Nothing is added' + (taken > 0 ? ', and ' + count(taken, 'earlier change') + ' on the same ' + (taken === 1 ? 'slot is' : 'slots are') + ' taken out' : '') + '.';
}

// A move that changes who teaches says that teachers follow rooms.
export const TEACHERS_FOLLOW = 'Teachers follow rooms: a slot with no teacher of its own is taught by the teachers of its room.';

// ---- the comparison's figures in words

const MINUS = '−';

export function signed(n, unit) {
  if (n === 0) return 'no change';
  return (n > 0 ? '+' : MINUS) + Math.abs(n) + (unit ? ' ' + unit : '');
}

// A number never parts from its unit at a line's end: "7 min 58 s" breaks
// only between "7 min" and "58 s".
const NBSP = '\u00a0';
export function duration(seconds) {
  return formatDuration(seconds).replace(/(\d) (min|s)\b/g, '$1' + NBSP + '$2');
}

export function signedDuration(seconds) {
  if (seconds === 0) return 'no change';
  return (seconds > 0 ? '+' : MINUS) + duration(Math.abs(seconds));
}

function busiestWords(side) {
  return side ? String(side.load) : '—';
}

// The Before / After / Difference table: [{ id, label, before, after, difference, worse }]
// `worse` is true when the change is for the worse, false for the better,
// null for none, so a row is marked in words as well as in colour.
export function figureRows(compare) {
  const f = compare.figures;
  const unit = (f.busiest.after || f.busiest.before || { unit: 'students' }).unit;
  const rows = [
    { id: 'walking', label: 'Total walking time', before: duration(f.walking.before), after: duration(f.walking.after), difference: signedDuration(f.walking.difference), n: f.walking.difference },
    { id: 'crowding', label: 'Time lost to crowding', before: duration(f.crowding.before), after: duration(f.crowding.after), difference: signedDuration(f.crowding.difference), n: f.crowding.difference },
    { id: 'busiest', label: 'Busiest load (' + unit + ')', before: busiestWords(f.busiest.before), after: busiestWords(f.busiest.after), difference: signed(f.busiest.difference), n: f.busiest.difference },
    { id: 'late', label: 'Late arrivals', before: String(f.late.before), after: String(f.late.after), difference: signed(f.late.difference), n: f.late.difference },
    { id: 'failed', label: 'Walks with no way through', before: String(f.failed.before), after: String(f.failed.after), difference: signed(f.failed.difference), n: f.failed.difference },
    { id: 'problem', label: 'Problems', before: String(f.findings.problem.before), after: String(f.findings.problem.after), difference: signed(f.findings.problem.difference), n: f.findings.problem.difference },
    { id: 'warning', label: 'Warnings', before: String(f.findings.warning.before), after: String(f.findings.warning.after), difference: signed(f.findings.warning.difference), n: f.findings.warning.difference },
    { id: 'note', label: 'Notes', before: String(f.findings.note.before), after: String(f.findings.note.after), difference: signed(f.findings.note.difference), n: f.findings.note.difference },
  ];
  // every figure here is better lower
  return rows.map((row) => ({ ...row, worse: row.n === 0 ? null : row.n > 0 }));
}

// Where the busiest load is, before and after, for the line under the table.
export function busiestPlaces(compare) {
  const f = compare.figures.busiest;
  return { before: f.before, after: f.after };
}

// One group's row: its name, edited or not, its travel before and after,
// and the change, in words. A row whose walks with no way through changed
// is worded by that (compareResults' rule): its times add up different walks.
export function groupRow(project, row) {
  const group = project.groups.find((each) => each.id === row.groupId);
  const name = group ? group.name : 'A group no longer in the project';
  const total = (side) => (side ? duration(side.total) : '—');
  let change;
  if (row.failedChange > 0) change = count(row.failedChange, 'walk') + ' more with no way through';
  else if (row.failedChange < 0) change = count(-row.failedChange, 'walk') + ' fewer with no way through';
  else if (row.difference === null) change = '—';
  else change = signedDuration(row.difference);
  const worse = row.failedChange !== 0 ? row.failedChange > 0 : row.difference === null || row.difference === 0 ? null : row.difference > 0;
  return { groupId: row.groupId, name, typed: Boolean(group), edited: row.edited, before: total(row.before), after: total(row.after), change, worse };
}

// The groups whose travel changed and the groups the scenario edits, in
// compareResults' order (biggest change first, edited first within a band),
// and how many others walk as before.
export function groupRows(project, compare) {
  const changed = compare.groups.filter((row) => row.edited || row.failedChange !== 0 || (row.difference !== null && row.difference !== 0));
  return { rows: changed.map((row) => groupRow(project, row)), same: compare.groups.length - changed.length };
}

export function placeRow(row, unit) {
  return { placeId: row.placeId, parts: row.parts || [{ text: row.name }], before: row.before, after: row.after, change: signed(row.difference), unit };
}

// The transitions a comparison can be narrowed to: period p into p + 1.
export function transitionChoices(project) {
  const out = [];
  for (let period = 0; period + 1 < project.settings.periods; period += 1) {
    out.push({ value: String(period), label: periodName(project.settings, period) + ' to ' + periodName(project.settings, period + 1) });
  }
  return out;
}

// What Apply will do, for its summary: the changes in words, and what is
// skipped (the changes that no longer apply, the groups only in a compared
// file, which a scenario cannot add or take away).
export function applySummary(project, view) {
  return {
    changes: view.kept.map((each) => each.words),
    skipped: view.dropped.map((each) => each.sentence),
    added: view.compared ? view.compared.addedGroups || [] : [],
    removed: view.compared ? view.compared.removedGroups || [] : [],
  };
}
