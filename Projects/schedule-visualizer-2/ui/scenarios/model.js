// The scenario lab's words and lists, worked out from the project and from
// the scenario lane's answer, with no page. ui/scenarios/index.js and its
// panels draw them; nothing here re-implements a rule of the engine: the
// chips are engine/scenario.js's changeWords, what applies is its reconcile,
// the figures are its compareResults as the lane hands them over.

import { baseDayType, isOwnCopy } from '../../engine/day-types.js';
import { periodName, offPeriods, bellsFor, parseTime, formatTime } from '../../engine/bells.js';
import { walkTarget } from '../../engine/routing.js';
import { resolveSlotRoom, nameOfRoom, bellSchedulesOf, CELL_CORRIDOR, ELEVATOR_KIND, isLiftCell } from '../../engine/schema.js';
import { formatDuration } from '../../engine/findings.js';
import { reconcile, reconcileLevers, changeWords, changeSlots, leverKey, isTrialOnly, isWrittenWay, trialOnlyWords, applyLevers } from '../../engine/scenario.js';
import { releaseDelay } from '../../engine/release.js';
import { NEW_SCENARIO_NAME, blankName } from '../../engine/actions.js';
import { count, list, periodWords } from '../components/words.js';

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
// dropped ones with their sentences. The levers (ARCHITECTURE 18.3) are the
// same: `levers` the kept ones, each with its index in scenario.levers, its
// words, whether it is a trial only (a closure) and, for a staggered
// dismissal that replaces a real one, what the real one says; `droppedLevers`
// the ones that no longer apply. `total` counts every chip: changes and levers.
export function scenarioView(project) {
  const scenario = project.scenario;
  if (!scenario) return null;
  const found = reconcile(project, scenario);
  const indexOf = (change) => scenario.changes.indexOf(change);
  const stored = Array.isArray(scenario.levers) ? scenario.levers : [];
  // reconcile trims a lever it keeps (a copy, not the stored object: a release
  // lever loses the group it named that was deleted), so a kept or dropped
  // lever is matched to the stored one it came from (leverIndexes)
  const where = leverIndexes(project, stored, found.levers || [], found.droppedLevers || []);
  const levers = (found.levers || []).map((lever, at) => ({ lever, index: where.kept[at], words: changeWords(project, lever), trial: isTrialOnly(lever), instead: insteadOf(project, lever) }));
  const droppedLevers = (found.droppedLevers || []).map((each, at) => ({ lever: each.lever, index: where.dropped[at], parts: each.parts, sentence: each.sentence }));
  return {
    name: scenarioName(scenario),
    changes: scenario.changes,
    kept: found.changes.map((change) => ({ change, index: indexOf(change), words: changeWords(project, change) })),
    dropped: found.dropped.map((each) => ({ change: each.change, index: indexOf(each.change), parts: each.parts, sentence: each.sentence })),
    levers,
    droppedLevers,
    total: found.changes.length + levers.length,
    droppedTotal: found.dropped.length + droppedLevers.length,
    compared: scenario.compared || null,
  };
}

// Where in scenario.levers each lever reconcile kept or dropped came from:
// { kept: [index], dropped: [index] }, -1 for one that cannot be placed. The
// lever reconcile hands back is the stored object, or a copy of it with what
// is gone taken out (trimLever), so the stored lever is found by what each
// would become alone (reconcileLevers on it by itself), last of a key first, as
// the kept lever of a key is the last one stored.
function leverIndexes(project, stored, kept, dropped) {
  const out = { kept: new Array(kept.length).fill(-1), dropped: new Array(dropped.length).fill(-1) };
  let k = kept.length - 1;
  let d = dropped.length - 1;
  for (let i = stored.length - 1; i >= 0; i -= 1) {
    let alone;
    try {
      alone = reconcileLevers(project, { levers: [stored[i]] });
    } catch (error) {
      continue;
    }
    const became = alone.levers.length > 0 ? alone.levers[0] : alone.dropped.length > 0 ? alone.dropped[0].lever : stored[i];
    const same = (one) => one === stored[i] || JSON.stringify(one) === JSON.stringify(became);
    if (k >= 0 && same(kept[k])) {
      out.kept[k] = i;
      k -= 1;
    } else if (d >= 0 && same(dropped[d].lever)) {
      out.dropped[d] = i;
      d -= 1;
    }
  }
  return out;
}

// A trial staggered dismissal for exactly the groups, grade or wing, periods
// and day types of a real one replaces it in the trial (DESIGN 12.4); its
// chip says so: "instead of 2 min". Null for every other lever.
export function insteadOf(project, lever) {
  if (!lever || lever.kind !== 'release' || !Array.isArray(project.release)) return null;
  const key = leverKey(lever);
  const real = project.release.find((entry) => leverKey({ kind: 'release', who: entry.who, seconds: entry.seconds, after: entry.after, dayTypeIds: entry.dayTypeIds }) === key);
  if (!real || real.seconds === lever.seconds) return null;
  return real.seconds === 0 ? 'on the bell' : formatDuration(real.seconds);
}

// Every chip: changes and levers (a view built by hand may have changes only).
function totalOf(view) {
  return view.kept.length + (view.levers ? view.levers.length : 0);
}

function droppedOf(view) {
  return view.dropped.length + (view.droppedLevers ? view.droppedLevers.length : 0);
}

// The screen's first line, as parts ({ text, name }: name for typed text).
export function firstLine(project, view) {
  if (!view) return [{ text: 'No scenario is open. Start one to try changes to the schedule without touching it; the real schedule changes only when you apply.' }];
  const n = totalOf(view);
  const parts = [{ text: 'Trying ' }, { text: view.name, name: true }, { text: ': ' + count(n, 'change') + ', not applied' }];
  if (droppedOf(view) > 0) parts.push({ text: '; ' + count(droppedOf(view), 'change') + ' no longer ' + (droppedOf(view) === 1 ? 'applies' : 'apply') });
  parts.push({ text: '. The real schedule is untouched until you apply.' });
  return parts;
}

// "Not applied yet: 3 changes", for the bar at the foot (spec 3.1: staged
// work says so on screen).
export function barWords(view) {
  if (!view) return '';
  return 'Not applied yet: ' + count(totalOf(view), 'change') + (droppedOf(view) > 0 ? ', ' + droppedOf(view) + ' skipped' : '');
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
export function groupRow(project, row, held) {
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
  const late = Boolean(row.after) && row.after.late > 0;
  return { groupId: row.groupId, name, typed: Boolean(group), edited: row.edited, late, held: late && held && held.has(row.groupId) ? held.get(row.groupId) : null, before: total(row.before, times && times.before), after: total(row.after, times && times.after), change, worse };
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
  const held = heldNotes(project);
  for (const row of compare.groups) {
    const shown = groupRow(project, row, held);
    if (shown.change === NO_CHANGE) continue;
    if (shown.change === '—' && !row.edited) continue;
    rows.push(shown);
  }
  return { rows, same: compare.groups.length - rows.length };
}

export function placeRow(row, unit) {
  return { placeId: row.placeId, parts: row.parts || [{ text: row.name }], before: row.before, after: row.after, change: signed(row.difference), unit };
}

// The words for the walk kept under `period` (the one out of it) under these
// bells: "Period 2 to Period 3", or past periods that do not meet "Period 2
// to Period 4" (ARCHITECTURE 17.3).
export function transitionName(project, bellsId, period) {
  const to = walkTarget(offPeriods(project, bellsId), project.settings.periods, period);
  return periodName(project.settings, period) + ' to ' + periodName(project.settings, to === null ? period + 1 : to);
}

// The transitions a comparison can be narrowed to: the walk out of each
// period that meets into the next one that does. Under a bell schedule, the
// periods that do not meet are left out, and a walk across them is one.
export function transitionChoices(project, bellsId) {
  const out = [];
  const off = offPeriods(project, bellsId);
  for (let period = 0; period + 1 < project.settings.periods; period += 1) {
    if (walkTarget(off, project.settings.periods, period) === null) continue;
    out.push({ value: String(period), label: transitionName(project, bellsId, period) });
  }
  return out;
}

// Applying a scenario that changes more than this many slots keeps an
// automatic snapshot of the project from before it (spec 13.3, "apply a big
// scenario"; SV2-28b). Why 10: a snapshot takes one of the 30 places this
// device keeps (storage/snapshots.js SNAPSHOT_LIMIT), refused rather than
// replaced at the limit, so the small applies that come often must not fill
// it. Try it in the Fix dialog applies one change, which is one slot (a move)
// or two (a swap), and a scenario built by hand from a few such changes stays
// under 10; one Undo puts any of those back. Over 10 is more than one group's
// whole day at the default 8 periods, or a scenario from another project
// file, where a person could not rebuild the schedule by hand if the undo
// history were gone (a reload, another tab).
export const SCENARIO_SNAPSHOT_SLOTS = 10;

// The slots Apply would change: each kept change's slots (a move one, a swap
// two), every slot once.
export function appliedSlots(view) {
  const seen = new Set();
  for (const each of view.kept) for (const slot of changeSlots(each.change)) seen.add(slot.dayTypeId + '\u0000' + slot.groupId + '\u0000' + slot.period);
  return seen.size;
}

// What Apply will do, for its summary: the changes in words, and what is
// skipped (the changes that no longer apply, the groups only in a compared
// file, which a scenario cannot add or take away). `slots` is appliedSlots,
// and `snapshot` whether that is enough to keep a snapshot first.
//
// The levers: `levers` the ones Apply writes (a closed stairs and a closed
// corridor are a trial only and are left out, ARCHITECTURE 18.3), `kinds` a
// line per kind of what it writes, `trial` the pre-Apply line for what it
// leaves out (the engine's trialOnlyWords) or null, and the counts the
// button says: `writes` of `total` ("Apply 4 of 6 changes").
export function applySummary(project, view) {
  const slots = appliedSlots(view);
  const written = view.levers.filter((each) => !each.trial);
  const left = view.levers.filter((each) => each.trial);
  const writes = view.kept.length + written.length;
  const kinds = [];
  const byKind = (kind) => written.filter((each) => each.lever.kind === kind).length;
  if (byKind('bell') > 0) kinds.push('Bell times: ' + count(byKind('bell'), 'change') + '.');
  if (byKind('release') > 0) kinds.push('Staggered dismissal: ' + count(byKind('release'), 'rule') + '.');
  if (byKind('capacity') > 0) kinds.push('Room capacities: ' + count(byKind('capacity'), 'change') + '.');
  if (byKind('headCount') > 0) kinds.push('Head counts: ' + count(byKind('headCount'), 'change') + '.');
  for (const each of written) if (each.lever.kind === 'way' && isWrittenWay(each.lever)) kinds.push(each.words.text.replace(': ', ' becomes ') + '.');
  return {
    slots,
    // a snapshot is kept for more than ten slots, and whenever a lever is written: a
    // bell time, a staggered dismissal, a capacity, a head count or a direction
    // moves more than the slots it names (ARCHITECTURE 18.3)
    snapshot: slots > SCENARIO_SNAPSHOT_SLOTS || written.length > 0,
    leversWritten: written.length,
    canApply: writes > 0,
    changes: view.kept.map((each) => each.words),
    levers: written.map((each) => each.words),
    kinds,
    trial: left.length > 0 ? trialOnlyWords(project, left.map((each) => each.lever)) : null,
    writes,
    total: writes + left.length,
    skipped: view.dropped.map((each) => each.sentence).concat(view.droppedLevers.map((each) => each.sentence)),
    added: view.compared ? view.compared.addedGroups || [] : [],
    removed: view.compared ? view.compared.removedGroups || [] : [],
  };
}

// The button of the Apply question, naming what it writes. It never counts
// "0 of 1": with a closure and nothing else there is nothing to write, which
// the button says and which it is disabled for (`canApply` false); with no
// change that applies at all it closes the scenario, as it always has.
export function applyButtonWords(summary) {
  const { writes, total } = summary;
  if (total === 0) return 'Close the scenario: no change of it applies';
  if (writes === 0) return 'Nothing here can be applied';
  if (total > writes) return 'Apply ' + writes + ' of ' + total + ' changes';
  return writes === 1 ? 'Apply 1 change' : 'Apply ' + writes + ' changes';
}

// The snapshot line of the Apply question: what it changes (the groups' days,
// and the levers it writes), then the snapshot that is kept, or the reason
// none will be. `none` is null where one will be kept.
export function snapshotWords(summary, periodWord, none, readOnly) {
  const parts = [];
  if (summary.slots > 0) parts.push(count(summary.slots, periodWord) + ' of the groups\' days');
  // "1 other change" after some periods, "1 setting" where there are none: "It changes 1 other change" was the fault
  if (summary.leversWritten > 0) parts.push(count(summary.leversWritten, summary.slots > 0 ? 'other change' : 'setting'));
  const what = parts.length > 0 ? 'It changes ' + parts.join(' and ') : 'It changes the schedule';
  return none === null
    ? what + ', so a snapshot of the project as it is now is kept as well, and can be restored from Snapshots in the Project section.'
    : what + ', which would keep a snapshot of the project as it is now, but none will be kept: ' + none + (readOnly ? '' : ' Undo still brings the schedule back while this tab stays open.');
}

// ---- what the staggered dismissals of the scenario hold back

// The groups the open scenario holds back, each with how, as the late rows
// say it: "leaves 2 min after the bell", or "leaves up to 2 min after the
// bell" where the delay differs by day type or period. A Map of group id to
// words; empty when the scenario has no staggered dismissal. The rule is
// the engine's own (releaseDelay), asked of the project with the levers laid
// over it; a group the real schedule holds back just as long is not named.
export function heldNotes(project) {
  const notes = new Map();
  if (!project.scenario) return notes;
  let kept;
  try {
    kept = reconcile(project, project.scenario);
  } catch (error) {
    return notes;
  }
  const releases = (kept.levers || []).filter((lever) => lever.kind === 'release');
  if (releases.length === 0) return notes;
  const trial = applyLevers(project, releases);
  const days = project.dayTypes.filter((day) => isOwnCopy(project, day.id));
  for (const group of project.groups) {
    const seen = new Set();
    let changed = false;
    for (const day of days) {
      const slots = group.days ? group.days[day.id] : undefined;
      for (let period = 0; period < project.settings.periods; period += 1) {
        const slot = Array.isArray(slots) ? slots[period] : undefined;
        const room = slot ? resolveSlotRoom(project, slot).room : null;
        const from = room ? room.id : null;
        const now = releaseDelay(trial, group.id, day.id, period, from);
        if (now !== releaseDelay(project, group.id, day.id, period, from)) changed = true;
        if (now > 0) seen.add(now);
      }
    }
    if (!changed || seen.size === 0) continue;
    const most = Math.max(...seen);
    notes.set(group.id, 'leaves ' + (seen.size > 1 ? 'up to ' : '') + formatDuration(most) + ' after the bell');
  }
  return notes;
}

// ---- levers: did adding one cancel it? And Apply's lines for them

// The counterpart of `cancelled` for a lever: null when the lever is among
// the scenario's levers now, else { taken }, the earlier levers of its key
// that went with it (a lever that leaves the schedule as it is replaces the
// earlier lever of its key, then goes itself).
export function leverCancelled(before, after, lever) {
  const had = before && Array.isArray(before.levers) ? before.levers : [];
  const has = after && Array.isArray(after.levers) ? after.levers : [];
  // by what the lever says, whatever the order its fields were written in
  const said = (each) => JSON.stringify(Object.keys(each).sort().map((key) => [key, each[key]]));
  const text = said(lever);
  if (has.some((each) => said(each) === text)) return null;
  return { taken: Math.max(0, had.length - has.length) };
}

export function leverCancelledSentence(words, taken, thing) {
  return 'That puts the ' + (thing || 'schedule') + ' back as it is: ' + words + '. Nothing is added' + (taken > 0 ? ', and ' + count(taken, 'earlier change') + ' to the same thing ' + (taken === 1 ? 'is' : 'are') + ' taken out' : '') + '.';
}

// The sets of bells the Bell times form can name: each own day type's
// regular bells, and each bell schedule. value: "d:<id>" or "b:<id>".
export function bellSets(project) {
  const sets = dayChoices(project).map((day) => ({ value: 'd:' + day.value, label: day.label, kind: 'day', id: day.value }));
  for (const schedule of bellSchedulesOf(project)) sets.push({ value: 'b:' + schedule.id, label: schedule.name + ' bells', kind: 'bells', id: schedule.id });
  return sets;
}

// The lever a Bell times form stands for, or { why }.
export function bellLever(project, form) {
  const set = bellSets(project).find((each) => each.value === form.setId);
  if (!set) return { why: 'There is no day type or bell schedule to change.' };
  if (!form.start || !form.end) return { why: 'Enter both times. Empty them in the Day tab to take a ' + periodWords(project.settings).one + ' away.' };
  const start = parseTime(form.start);
  const end = parseTime(form.end);
  if (start === null || end === null) return { why: 'Enter both times, like 8:05 or 2:10 pm.' };
  if (end <= start) return { why: 'A ' + periodWords(project.settings).one + ' ends after it starts.' };
  const lever = { kind: 'bell', period: form.period, start: form.start, end: form.end };
  if (set.kind === 'day') lever.dayTypeId = set.id;
  else lever.bellsId = set.id;
  return { lever };
}

// The real times of the set and period, or null.
export function realBellOf(project, set, period) {
  if (!set) return null;
  const run = set.kind === 'day' ? bellsFor(project, set.id) : bellsFor(project, project.dayTypes[0] ? project.dayTypes[0].id : null, set.id);
  const bell = run[period];
  return bell && bell.start && bell.end ? { start: bell.start, end: bell.end } : null;
}

// The passing time into `period`, in seconds, as the bells give it, under
// the project given, or null where nothing is passed into (the first period,
// a period that does not meet, a time missing).
export function passingBefore(project, set, period) {
  if (!set || period < 1) return null;
  const run = set.kind === 'day' ? bellsFor(project, set.id) : bellsFor(project, project.dayTypes[0] ? project.dayTypes[0].id : null, set.id);
  const before = run[period - 1];
  const here = run[period];
  if (!before || !here || before.off || here.off || !before.passingFromBells) return null;
  return before.passingAfter;
}

// The words under the Bell times form: the passing time it would make.
//   "Passing before Period 3: 6 min (was 4 min)"
// plus, with the lever applied, the period's times if they moved.
export function bellPassingWords(project, set, period, lever) {
  const name = periodName(project.settings, period);
  if (period < 1) return 'Nothing is passed into ' + name + ': it is the first of the day.';
  const was = passingBefore(project, set, period);
  const now = lever ? passingBefore(applyLevers(project, [lever]), set, period) : was;
  if (now === null && was === null) return 'No passing time into ' + name + ' from the bells: it uses the school’s ' + formatDuration(project.settings.defaultPassingSeconds) + '.';
  const show = (seconds) => (seconds === null ? 'the school’s ' + formatDuration(project.settings.defaultPassingSeconds) : formatDuration(seconds));
  return 'Passing before ' + name + ': ' + show(now) + ' (was ' + show(was) + ')';
}

// Lengthen the passing before a period by `minutes`: the start later and the
// end kept. { start, end, sentence } or { why }.
export function lengthenPassing(project, set, period, form, minutes) {
  const name = periodName(project.settings, period);
  if (period < 1) return { why: 'There is no passing time before ' + name + '.' };
  const real = realBellOf(project, set, period);
  const start = parseTime(form.start || (real ? real.start : ''));
  const end = parseTime(form.end || (real ? real.end : ''));
  if (start === null || end === null) return { why: 'Enter both times first.' };
  const moved = start + minutes;
  if (moved >= end) return { why: name + ' would start after it ends.' };
  const text = (value) => formatTime(value, project.settings.timeFormat);
  const wasText = real ? text(real.start) + ' to ' + text(real.end) : 'not set';
  return { start: formatTime(moved, '24h'), end: formatTime(end, '24h'), sentence: name + ' then runs ' + text(moved) + ' to ' + text(end) + ', was ' + wasText };
}

// ---- Stairs and corridors (spec 9.1, DESIGN 12.4)

// The connections that are stairs: an elevator is a connection too
// (kind 'elevator', ARCHITECTURE 19.1), and a scenario's lever turns a stair,
// never a car, so every list and lookup of the lab asks for these.
export function stairsOf(project) {
  return (project.building.connections || []).filter((connection) => connection && connection.kind !== ELEVATOR_KIND);
}

// One stairs connection by id; null for an id that is nothing, or an elevator's.
export function stairsConnection(project, connectionId) {
  return stairsOf(project).find((connection) => connection.id === connectionId) || null;
}

// The stairs connections the form offers: "Stairs B: Floor 1 to Floor 2" (the
// lower floor first), "Stairs B: on Floor 1" where both ends are on one floor.
// Elevators are not offered.
export function connectionChoices(project) {
  const floors = project.building.floors;
  return stairsOf(project).map((connection) => {
    const a = floors.find((floor) => floor.id === connection.a.floorId);
    const b = floors.find((floor) => floor.id === connection.b.floorId);
    const label = 'Stairs ' + (typeof connection.label === 'string' ? connection.label : '');
    let where = 'a floor no longer in the building';
    if (a && b) {
      const [low, high] = a.level <= b.level ? [a, b] : [b, a];
      where = a.id === b.id ? 'on ' + a.name : low.name + ' to ' + high.name;
    }
    return { value: connection.id, label: label.trim() + ': ' + where };
  });
}

// The corridors that have a name, on every floor, that the form can close by
// name: "North Corridor, Floor 1". A corridor with none of its cells still
// corridor is not offered.
export function corridorChoices(project) {
  const out = [];
  for (const floor of project.building.floors) {
    for (const corridor of floor.corridors || []) {
      if (typeof corridor.name !== 'string' || corridor.name.trim() === '') continue;
      if (!corridor.cells.some((cell) => floor.cells[cell] === CELL_CORRIDOR)) continue;
      out.push({ value: corridor.id, label: corridor.name + ', ' + floor.name, floorId: floor.id });
    }
  }
  return out;
}

// The lever that closes a named corridor, or null when it is gone.
export function corridorLever(project, corridorId) {
  for (const floor of project.building.floors) {
    const corridor = (floor.corridors || []).find((each) => each.id === corridorId);
    if (!corridor) continue;
    const cells = corridor.cells.filter((cell) => floor.cells[cell] === CELL_CORRIDOR).sort((a, b) => a - b);
    return cells.length === 0 ? null : { kind: 'corridor', floorId: floor.id, cells, name: corridor.name };
  }
  return null;
}

// What a cell of a floor is, for picking: { place, lever } where `place` is how
// to say it ("North Corridor", "a stretch of corridor on Floor 2") and `lever`
// the lever that closes the place (the named corridor, or the stretch between
// junctions), or { why } for a cell that is no corridor. `found` is the
// engine's place at the cell (engine/places.js placeAt) or null.
export function pickedPlace(project, floor, cell, found) {
  if (!floor || floor.cells[cell] !== CELL_CORRIDOR) {
    if (floor && floor.cells[cell] === 'S' && isLiftCell(project.building, floor.id, cell)) return { why: 'That is an elevator stop. A scenario closes corridors and stairs, not elevators.' };
    return { why: floor && floor.cells[cell] === 'S' ? 'That is a stairs landing. Close it with "A stair" above.' : 'That is not a corridor.' };
  }
  const corridor = found && found.corridorId ? (floor.corridors || []).find((each) => each.id === found.corridorId) : null;
  const named = corridor && typeof corridor.name === 'string' && corridor.name.trim() !== '';
  let cells = (found ? found.cells : [cell]).filter((at) => floor.cells[at] === CELL_CORRIDOR).sort((a, b) => a - b);
  if (!named) cells = boundedStretch(floor.width, cells, cell);
  const lever = { kind: 'corridor', floorId: floor.id, cells: cells.length > 0 ? cells : [cell], name: named ? corridor.name : '' };
  return { named: named ? corridor.name : null, floorName: floor.name, lever };
}

// What a closed place is called after a pick: the corridor's name, or the
// words the chip and Apply's band use for an unnamed stretch, "6 corridor
// cells on Floor 1" (one set of words, SV2-94b).
export function pickedName(picked) {
  if (picked.named !== null) return picked.named;
  const n = picked.lever.cells.length;
  return n + (n === 1 ? ' corridor cell on ' : ' corridor cells on ') + picked.floorName;
}

// The stretch a tap closes in an unnamed corridor. The engine's place is the
// stretch between junctions, but where a hall is more than one cell wide every
// cell of it is a junction, and the whole connected hall is one place (an L of
// two-wide halls was 27 of 32 cells). So in a hall with a 2 by 2 block the
// stretch is the straight run the tap is on: the band of the hall's own width
// along the longer way through the tap, up to where that width changes (a
// branch, a bend or the end). Of the band along the row and the band along the
// column, the smaller is taken. A corridor one cell wide is the engine's place
// as it is. `cells` are the place's corridor cells, sorted; `cell` the tap.
export function boundedStretch(width, cells, cell) {
  const inside = new Set(cells);
  const has = (x, y) => x >= 0 && x < width && y >= 0 && inside.has(y * width + x);
  const wide = cells.some((at) => has((at % width) + 1, Math.floor(at / width)) && has(at % width, Math.floor(at / width) + 1) && has((at % width) + 1, Math.floor(at / width) + 1));
  if (!wide) return cells;
  const x0 = cell % width;
  const y0 = Math.floor(cell / width);
  const band = (horizontal) => {
    // the cells across the band's way at (x, y), as offsets from it
    const span = (x, y) => {
      const at = (k) => (horizontal ? has(x, y + k) : has(x + k, y));
      let low = 0;
      let high = 0;
      while (at(low - 1)) low -= 1;
      while (at(high + 1)) high += 1;
      return [low, high];
    };
    const [low, high] = span(x0, y0);
    const out = [];
    for (const direction of [1, -1]) {
      for (let step = direction === 1 ? 0 : 1; ; step += 1) {
        const x = horizontal ? x0 + direction * step : x0;
        const y = horizontal ? y0 : y0 + direction * step;
        if (!has(x, y)) break;
        const [l, h] = span(x, y);
        if (l !== low || h !== high) break;
        for (let k = low; k <= high; k += 1) out.push(horizontal ? y * width + x + k * width : y * width + x + k);
      }
    }
    return out.sort((a, b) => a - b);
  };
  const along = band(true);
  const down = band(false);
  return down.length < along.length ? down : along;
}

// "North Corridor" or "a stretch of corridor on Floor 2", with whether it is
// closed in this trial: the polite words a cursor on the lab's plan says.
export function pickWords(picked, closed) {
  if (picked.why) return picked.why;
  return (picked.named === null ? 'A stretch of corridor on ' + picked.floorName : picked.named) + ', ' + (closed ? 'closed' : 'open');
}

// The corridor lever of the open scenario that has this cell, as a view's
// lever entry ({ lever, index }), or null: picking it again reopens it.
export function closedAt(view, floorId, cell) {
  if (!view) return null;
  return view.levers.find((each) => each.lever.kind === 'corridor' && each.lever.floorId === floorId && each.lever.cells.includes(cell)) || null;
}
