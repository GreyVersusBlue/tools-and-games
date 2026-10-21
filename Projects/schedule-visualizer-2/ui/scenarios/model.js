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
import { NEW_SCENARIO_NAME, blankName } from '../../engine/actions.js';
import { count, list } from '../components/words.js';

// The scenario's name as the screen says it: as typed, or "New scenario"
// where a file left it blank (the actions' own rule for their labels).
export function scenarioName(scenario) {
  const name = scenario && typeof scenario.name === 'string' ? scenario.name : '';
  return blankName(name) ? NEW_SCENARIO_NAME : name;
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
const NO_CHANGE = 'no change';

export function signed(n, unit) {
  if (n === 0) return NO_CHANGE;
  return (n > 0 ? '+' : MINUS) + Math.abs(n) + (unit ? ' ' + unit : '');
}

// Durations, as the lab and the congestion report both print them (one
// rule for the same figures, SV2-72d). Under an hour as everywhere else in
// the tool (engine/findings.js formatDuration: "45 s", "7 min 58 s"); from an
// hour on in hours and minutes, to the nearest minute ("2 h 34 min", "1 h"):
// over a day's walking the seconds are noise, and "153 min 48 s" did not
// fit a cell of the inspector's 320 px. Every space inside a figure is a
// no-break space, so a figure never breaks across two lines.
const NBSP = '\u00a0';
const HOUR = 3600;

function hoursAndMinutes(seconds) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return rest + ' min';
  return rest === 0 ? hours + ' h' : hours + ' h ' + rest + ' min';
}

// `toMinute`: to the nearest minute whatever the length (a time beside one
// that reads in hours, so the two are to the same grain).
export function duration(seconds, toMinute) {
  return durationWords(seconds, toMinute).replace(/ /g, NBSP);
}

// The same rule with plain spaces, for a page whose lines may break inside
// a time (the congestion report's day sections, ui/prints/congestion.js,
// whose tables are pinned with plain spaces).
export function durationWords(seconds, toMinute) {
  const whole = Math.max(0, Math.round(seconds));
  return whole >= HOUR || toMinute === true ? hoursAndMinutes(whole) : formatDuration(whole);
}

export function signedDuration(seconds) {
  if (seconds === 0) return NO_CHANGE;
  return (seconds > 0 ? '+' : MINUS) + duration(Math.abs(seconds));
}

// Before, after and the difference of one time, printed so the three agree:
// the difference is that of the two times as printed. When either reads in
// hours, all three are to the minute ("58 min", "1 h 2 min", "+4 min"); else
// to the second. A change smaller than what is printed is "no change".
//   -> { before, after, difference, n }   n: the difference in seconds, as printed
export function timeFigures(before, after) {
  const a = Math.max(0, Math.round(before));
  const b = Math.max(0, Math.round(after));
  const minutes = Math.max(a, b) >= HOUR;
  const grain = minutes ? 60 : 1;
  const n = (Math.round(b / grain) - Math.round(a / grain)) * grain;
  return { before: duration(a, minutes), after: duration(b, minutes), difference: n === 0 ? NO_CHANGE : (n > 0 ? '+' : MINUS) + duration(Math.abs(n), minutes), n };
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
    { id: 'walking', label: 'Total walking time', ...timeFigures(f.walking.before, f.walking.after) },
    { id: 'crowding', label: 'Time lost to crowding', ...timeFigures(f.crowding.before, f.crowding.after) },
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
  // both sides walk: the three cells are timeFigures', so Before and After
  // are to the change's grain ("58 min | 1 h 2 min | +4 min", never "58 min
  // 20 s" beside a change to the minute) and the change is that of the two
  // times as printed
  const times = row.failedChange === 0 && row.difference !== null && row.before && row.after ? timeFigures(row.before.total, row.after.total) : null;
  const total = (side, printed) => (times ? printed : side ? duration(side.total) : '—');
  const moved = times ? times.n : row.difference;
  let change;
  if (row.failedChange > 0) change = count(row.failedChange, 'walk') + ' more with no way through';
  else if (row.failedChange < 0) change = count(-row.failedChange, 'walk') + ' fewer with no way through';
  else if (moved === null) change = '—';
  else change = times ? times.difference : signedDuration(moved);
  const worse = row.failedChange !== 0 ? row.failedChange > 0 : moved === null || moved === 0 ? null : moved > 0;
  return { groupId: row.groupId, name, typed: Boolean(group), edited: row.edited, before: total(row.before, times && times.before), after: total(row.after, times && times.after), change, worse };
}

// The groups whose travel changes as printed, in compareResults' order
// (biggest change first, edited first within a band), and how many others
// walk as before. The test is the printed change, not the seconds: a group
// whose change reads "no change" (12 s over two and a half hours, or an
// edited group whose times stay) walks as before and is counted with them,
// never listed as a row that says it did not change (SV2-72d2). An edited
// group with no time on a side ("—") is still listed: the scenario edits it
// and nothing says it walks as before.
export function groupRows(project, compare) {
  const rows = [];
  for (const row of compare.groups) {
    const shown = groupRow(project, row);
    if (shown.change === NO_CHANGE) continue;
    if (shown.change === '—' && !row.edited) continue;
    rows.push(shown);
  }
  return { rows, same: compare.groups.length - rows.length };
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
