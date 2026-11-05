// Staggered dismissal in the Day tab (DESIGN 12.2): the words for an entry and
// its editor. The Day tab's sixth card (./day.js) and the scenario lab's Leave
// late form (SV2-92) both use the editor; neither copies it.
//
//   releaseDraftOf(entry)       the draft the editor edits: from an entry, or
//                               null for a new one
//   releasePayload(draft)       the fields addRelease and setRelease take
//   releaseMissing(draft)       what is still missing before the engine can take
//                               the draft, or ''
//   releaseParts(project, entry, id)    the sentence in parts, for markup
//   releaseSentence(project, entry, id) the same, as one string
//   releaseEditor(options)      -> { element }
//
// The editor draws a draft and reports every change; it saves nothing. The
// host decides what a change does (the Day tab applies it at once to an entry
// that is added, and waits for the Add button on a new one):
//
//   releaseEditor({
//     project,            the project as it is now
//     draft,              the draft; the editor never changes it
//     change(patch, key), a field changed. `patch` holds draft fields; `key` is
//                         the data-key of the control to keep the focus on, or
//                         null for a typed field, which has the focus already.
//                         May throw: a refusal shows under the field.
//     key(part),          the data-key a part of the editor takes (default
//                         'release:' + part); the host's drawing puts focus back
//                         by it
//     announce(text),     optional: said to a screen reader (a note)
//     parts,              optional: which parts to draw, from 'who', 'long',
//                         'after', 'days'; all by default
//     buildingHref,       optional: where "No rooms have a wing yet" links to
//   })
//
// The draft: { id, kind: 'groups' | 'grade' | 'wing', groupIds, grade, wing,
//   onBell, seconds, periodsMode: 'all' | 'some', after, daysMode: 'all' |
//   'some', dayTypeIds, seen, note }. `seconds` is what the minutes and seconds
// fields say (never 0); `onBell` makes a groups entry leave on the bell.

import { h, uid } from '../components/dom.js';
import { field } from '../components/field.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { count, list, periodWords } from '../components/words.js';
import { periodName } from '../../engine/bells.js';
import { formatDuration } from '../../engine/findings.js';
import { ownDayTypes, effectiveDayType } from '../../engine/day-types.js';
import { allRooms, releaseOf, nameKey, RELEASE_SECONDS } from '../../engine/schema.js';
import { releaseKind, releaseOnDay, releaseAfter } from '../../engine/release.js';
import { keyed, collator } from './common.js';

const DEFAULT_SECONDS = 120;
const STEP = 15;

// The grades the groups are in, once each as first typed, in order.
export function gradesOf(project) {
  const seen = new Map();
  for (const group of project.groups) {
    if (typeof group.grade !== 'string' || group.grade.trim() === '') continue;
    const key = nameKey(group.grade);
    if (!seen.has(key)) seen.set(key, group.grade.trim());
  }
  return Array.from(seen.values()).sort(collator.compare);
}

// The wings the rooms have, once each as first typed, in order.
export function wingsOf(project) {
  const seen = new Map();
  for (const room of allRooms(project)) {
    if (typeof room.wing !== 'string' || room.wing.trim() === '') continue;
    const key = nameKey(room.wing);
    if (!seen.has(key)) seen.set(key, room.wing.trim());
  }
  return Array.from(seen.values()).sort(collator.compare);
}

// "grade 7", and "Grade 7" left as the school typed it (never "grade Grade 7").
function gradeWords(grade) {
  return /^grade\s/i.test(grade) ? grade : 'grade ' + grade;
}

// "North wing", and "Music Wing" left as it is (never "Music Wing wing").
function wingWords(wing) {
  const name = String(wing).trim();
  return /\bwing$/i.test(name) ? name : name + ' wing';
}

// The groups of a grade, matched as the crowd model matches them (engine/release.js
// releaseDelay): ignoring case and surrounding spaces, so "Grade 7" and "Grade7"
// are two grades here as they are in Movement's picker.
function groupsOfGrade(project, grade) {
  const wanted = nameKey(grade);
  return project.groups.filter((group) => typeof group.grade === 'string' && group.grade.trim() !== '' && nameKey(group.grade) === wanted);
}

function groupName(project, id) {
  const group = project.groups.find((each) => each.id === id);
  return group ? group.name : 'a group that is gone';
}

// Do two entries both apply on some day type, and after some period?
function overlap(project, a, b) {
  const days = project.dayTypes.some((dayType) => releaseOnDay(project, a, dayType.id) && releaseOnDay(project, b, dayType.id));
  if (!days) return false;
  if (!Array.isArray(a.after) || !Array.isArray(b.after)) return true;
  return a.after.some((period) => releaseAfter(b, period));
}

// What another entry beats this one for, as names: the groups a rule for named
// groups takes from a grade's or a wing's, and the grades a grade's rule takes
// from a wing's. `id` is the entry's own id ('' for one not added yet).
function beatenBy(project, entry, id) {
  const kind = releaseKind(entry.who);
  if (kind === null || kind === 'groups') return [];
  const others = releaseOf(project).filter((other) => other.id !== id && overlap(project, entry, other));
  const names = [];
  for (const other of others) {
    const otherKind = releaseKind(other.who);
    if (otherKind === 'groups') {
      for (const groupId of other.who.groups) {
        const group = project.groups.find((each) => each.id === groupId);
        if (!group) continue;
        const inside = kind === 'wing' || groupsOfGrade(project, entry.who.grade).includes(group);
        if (inside && !names.includes(group.name)) names.push(group.name);
      }
    } else if (kind === 'wing' && otherKind === 'grade') {
      const name = gradeWords(String(other.who.grade).trim());
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

function beatenWords(names) {
  if (names.length === 0) return '';
  return names.length <= 2 ? list(names) + (names.length === 1 ? ' has its own' : ' have their own') : names.length + ' groups or grades have their own';
}

// "7th grade leaves 2 min after the bell, after every period, every day type
// (4 groups)" as plain parts: { who, how, rest, groups, beaten }. `who` is
// bold on the page; `how` too. `id` is the entry's own id, '' for one not
// added yet, undefined to leave the "has its own" note out.
export function releaseParts(project, entry, id) {
  const kind = releaseKind(entry.who);
  let who;
  let groups = null;
  if (kind === 'groups') {
    const names = entry.who.groups.map((groupId) => groupName(project, groupId));
    who = names.length <= 3 ? list(names) : count(names.length, 'group');
  } else if (kind === 'grade') {
    who = gradeWords(String(entry.who.grade).trim());
    const taken = groupsOfGrade(project, entry.who.grade);
    groups = count(taken.length, 'group');
  } else if (kind === 'wing') {
    who = wingWords(entry.who.wing);
  } else {
    who = 'Nobody';
  }
  const settings = project.settings;
  const after = Array.isArray(entry.after) && entry.after.length > 0 ? 'after ' + list(entry.after.map((period) => periodName(settings, period))) : 'after every ' + periodWords(settings).one;
  const days = Array.isArray(entry.dayTypeIds) && entry.dayTypeIds.length > 0 ? 'on ' + list(entry.dayTypeIds.map((dayTypeId) => (project.dayTypes.find((each) => each.id === dayTypeId) || { name: 'a day type that is gone' }).name)) : 'every day type';
  return {
    who,
    how: entry.seconds === 0 ? 'leaves on the bell' : 'leaves ' + formatDuration(entry.seconds) + ' after the bell',
    rest: ', ' + after + ', ' + days,
    groups,
    beaten: id === undefined ? '' : beatenWords(beatenBy(project, entry, id)),
  };
}

// The same, as one sentence of text. A grade reads with a capital at the
// start only if the school typed one.
export function releaseSentence(project, entry, id) {
  const parts = releaseParts(project, entry, id);
  return parts.who + ' ' + parts.how + parts.rest + (parts.groups === null ? '' : ' (' + parts.groups + ')');
}

// ---------------------------------------------------------------- the draft

export function releaseDraftOf(entry) {
  const kind = entry ? releaseKind(entry.who) || 'groups' : 'groups';
  return {
    seen: entry ? signature(entry) : null,
    note: '',
    id: entry ? entry.id : null,
    kind,
    groupIds: kind === 'groups' && entry ? entry.who.groups.slice() : [],
    grade: kind === 'grade' && entry ? String(entry.who.grade) : '',
    wing: kind === 'wing' && entry ? String(entry.who.wing) : '',
    onBell: Boolean(entry) && entry.seconds === 0,
    seconds: entry && entry.seconds > 0 ? entry.seconds : DEFAULT_SECONDS,
    periodsMode: entry && Array.isArray(entry.after) ? 'some' : 'all',
    after: entry && Array.isArray(entry.after) ? entry.after.slice() : [],
    daysMode: entry && Array.isArray(entry.dayTypeIds) ? 'some' : 'all',
    dayTypeIds: entry && Array.isArray(entry.dayTypeIds) ? entry.dayTypeIds.slice() : [],
  };
}

// What the project holds for an entry, as one string, so a drawing that finds
// an entry holding something else knows the project changed under the editor
// (an Undo, a Redo) and the draft was not typed.
export function signature(entry) {
  return JSON.stringify([entry.who, entry.seconds, entry.after, entry.dayTypeIds]);
}

export function releaseWho(draft) {
  if (draft.kind === 'grade') return { grade: draft.grade.trim() };
  if (draft.kind === 'wing') return { wing: draft.wing.trim() };
  return { groups: draft.groupIds };
}

export function releaseSeconds(draft) {
  return draft.kind === 'groups' && draft.onBell ? 0 : draft.seconds;
}

// The fields the actions take.
export function releasePayload(draft) {
  return {
    who: releaseWho(draft),
    seconds: releaseSeconds(draft),
    after: draft.periodsMode === 'all' ? null : draft.after.slice().sort((a, b) => a - b),
    dayTypeIds: draft.daysMode === 'all' ? null : draft.dayTypeIds,
  };
}

// What is still missing before the engine can take the draft, or ''.
export function releaseMissing(draft) {
  if (draft.kind === 'groups' && draft.groupIds.length === 0) return 'Add a group to finish.';
  if (draft.kind === 'grade' && draft.grade.trim() === '') return 'Choose a grade to finish.';
  if (draft.kind === 'wing' && draft.wing.trim() === '') return 'Choose a wing to finish.';
  if (draft.periodsMode === 'some' && draft.after.length === 0) return 'Tick a period to finish.';
  if (draft.daysMode === 'some' && draft.dayTypeIds.length === 0) return 'Tick a day type to finish.';
  // only a groups entry on the bell may be 0
  const seconds = releaseSeconds(draft);
  const onTheBell = draft.kind === 'groups' && draft.onBell;
  if (!onTheBell && (seconds < RELEASE_SECONDS[0] || seconds > RELEASE_SECONDS[1])) {
    return 'Choose a time from ' + formatDuration(RELEASE_SECONDS[0]) + ' to ' + formatDuration(RELEASE_SECONDS[1]) + ' after the bell to finish.';
  }
  return '';
}

// The draft as an entry, for reading it back as a sentence.
export function releaseEntryOf(draft) {
  return { id: draft.id === null ? '' : draft.id, ...releasePayload(draft) };
}

function goneNote(gone) {
  return gone === 1 ? 'A group, day type or period this staggered dismissal named is gone from the project, so it was taken off.' : gone + ' groups, day types or periods this staggered dismissal named are gone from the project, so they were taken off.';
}

// What an entry's signature (as the draft last saw it) becomes with every
// group, day type and period it names that the project no longer has taken
// off: { gone, signature }.
function takenOff(project, seen) {
  let saved;
  try {
    saved = JSON.parse(seen);
  } catch (error) {
    return { gone: 0, signature: '' };
  }
  const [who, seconds, after, dayTypeIds] = saved;
  let gone = 0;
  const keep = (list, has) => list.filter((item) => {
    if (has(item)) return true;
    gone += 1;
    return false;
  });
  const nextWho = who && Array.isArray(who.groups) ? { ...who, groups: keep(who.groups, (id) => project.groups.some((group) => group.id === id)) } : who;
  const nextAfter = Array.isArray(after) ? keep(after, (period) => period < project.settings.periods) : after;
  const nextDays = Array.isArray(dayTypeIds) ? keep(dayTypeIds, (id) => project.dayTypes.some((dayType) => dayType.id === id)) : dayTypeIds;
  return { gone, signature: JSON.stringify([nextWho, seconds, nextAfter, nextDays]) };
}

// The draft made true to the project before it is drawn. An entry that is
// added and now holds something other than the draft last saw was changed by
// an Undo or a Redo: the draft is read from it again, so the next edit never
// puts an undone value back. A draft that names a day type or group no longer
// in the project lets them go and says so. Returns the draft to draw.
export function syncReleaseDraft(project, draft, announce) {
  if (draft.id !== null) {
    const now = releaseOf(project).find((entry) => entry.id === draft.id);
    if (now && signature(now) !== draft.seen) {
      const fresh = releaseDraftOf(now);
      // a group, day type or period the entry named was deleted: the entry is the one it was, less what went
      const left = takenOff(project, draft.seen);
      fresh.note = left.gone > 0 && left.signature === signature(now)
        ? goneNote(left.gone)
        : 'This staggered dismissal was changed by an Undo or a Redo. The editor shows it as it is now.';
      if (announce) announce(fresh.note);
      return fresh;
    }
  }
  const days = draft.dayTypeIds.filter((id) => project.dayTypes.some((dayType) => dayType.id === id));
  const groups = draft.groupIds.filter((id) => project.groups.some((group) => group.id === id));
  const periods = draft.after.filter((period) => period < project.settings.periods);
  const gone = (draft.dayTypeIds.length - days.length) + (draft.groupIds.length - groups.length) + (draft.after.length - periods.length);
  if (gone > 0) {
    draft.dayTypeIds = days;
    draft.groupIds = groups;
    draft.after = periods;
    draft.note = goneNote(gone);
    if (announce) announce(draft.note);
  }
  return draft;
}

// ---------------------------------------------------------------- the editor

// "2" and "45": the minutes and seconds a length of time is typed as.
function wholeIn(what, low, high) {
  return (text) => {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) throw new Error(what + ' is a whole number. "' + text + '" is not one.');
    const value = Number(trimmed);
    if (value < low || value > high) throw new Error(what + ' goes from ' + low + ' to ' + high + '.');
    return value;
  };
}

// A row of radios in a fieldset with a legend, 44 px under 640 px (11.2).
function radios(legend, name, options, value, onChange, key) {
  return h('fieldset', { class: 'sch-fieldset sch-markedit__set' }, h('legend', null, legend),
    options.map((option) => {
      const input = keyed(h('input', { type: 'radio', name, value: option.value }), key(option.value));
      input.checked = option.value === value;
      input.addEventListener('change', () => input.checked && onChange(option.value));
      return h('label', { class: 'sch-radio' }, input, h('span', null, option.label));
    }));
}

export function releaseEditor(options) {
  const { project, draft, change } = options;
  const key = options.key || ((part) => 'release:' + (draft.id === null ? 'new' : draft.id) + ':' + part);
  const parts = options.parts || ['who', 'long', 'after', 'days'];
  const words = periodWords(project.settings);
  const top = [];

  // ---- who
  if (parts.includes('who')) {
    const who = [radios('Who', uid('release-who'), [
      { value: 'groups', label: 'Groups…' },
      { value: 'grade', label: 'A grade' },
      { value: 'wing', label: 'A wing' },
    ], draft.kind, (value) => change({ kind: value }, key('who:' + value)), (value) => key('who:' + value))];
    if (draft.kind === 'groups') {
      const chosen = draft.groupIds.map((groupId) => project.groups.find((group) => group.id === groupId)).filter(Boolean);
      const add = picker({
        placeholder: chosen.length === 0 ? 'Add a group' : 'Add another group',
        listLabel: 'Groups',
        emptyText: project.groups.length === 0 ? 'No groups yet.' : 'No group matches.',
        options: () => options.project.groups.filter((group) => !draft.groupIds.includes(group.id)).map((group) => ({ id: group.id, label: group.name })),
        onPick: (option) => change({ groupIds: draft.groupIds.concat([option.id]) }, key('group-add')),
      });
      add.input.setAttribute('aria-label', 'Add a group to this staggered dismissal');
      keyed(add.input, key('group-add'));
      who.push(h('div', { class: 'sch-markedit__chips' },
        chosen.map((group) => h('span', { class: 'chip' }, h('span', null, group.name), keyed(h('button', { type: 'button', class: 'chip__remove', 'aria-label': 'Take ' + group.name + ' off this staggered dismissal', on: {
          click: () => change({ groupIds: draft.groupIds.filter((other) => other !== group.id) }, key('group-add')),
        } }, icon('close', 14)), key('group:' + group.id)))), add.element));
    } else if (draft.kind === 'grade') {
      const grades = gradesOf(project);
      if (draft.grade.trim() !== '' && !grades.some((other) => nameKey(other) === nameKey(draft.grade))) grades.push(draft.grade.trim());
      who.push(grades.length === 0
        ? h('p', { class: 'sch-hint sch-markedit__nogrades' }, 'No group has a grade yet. A rule for a grade takes the groups whose Grade field matches it, so give groups a grade on the Groups tab first.')
        : h('div', { class: 'sch-markedit__chips', role: 'group', 'aria-label': 'Grades' }, grades.map((grade) => {
          const pressed = nameKey(grade) === nameKey(draft.grade);
          return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(pressed), data: { grade }, on: { click: () => change({ grade: pressed ? '' : grade }, key('grade:' + nameKey(grade))) } }, gradeWords(grade).replace(/^./, (letter) => letter.toUpperCase())), key('grade:' + nameKey(grade)));
        })));
    } else {
      const wings = wingsOf(project);
      if (draft.wing.trim() !== '' && !wings.some((other) => nameKey(other) === nameKey(draft.wing))) wings.push(draft.wing.trim());
      who.push(wings.length === 0
        ? h('p', { class: 'sch-hint sch-markedit__nowings' }, 'No rooms have a wing yet. ', h('a', { href: options.buildingHref || '#building' }, 'Give rooms a wing in the Building section'), ' and a rule can follow them.')
        : h('div', { class: 'sch-markedit__chips', role: 'group', 'aria-label': 'Wings' }, wings.map((wing) => {
          const pressed = nameKey(wing) === nameKey(draft.wing);
          return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(pressed), data: { wing }, on: { click: () => change({ wing: pressed ? '' : wing }, key('wing:' + nameKey(wing))) } }, wingWords(wing)), key('wing:' + nameKey(wing)));
        })));
    }
    top.push(h('div', null, who));
  }

  // ---- how long
  if (parts.includes('long')) {
    const onBell = draft.kind === 'groups' && draft.onBell;
    const minutes = field({
      label: 'Minutes',
      value: Math.floor(draft.seconds / 60),
      name: 'releaseMinutes',
      type: 'text',
      inputMode: 'numeric',
      width: '5rem',
      parse: wholeIn('Minutes', 0, Math.floor(RELEASE_SECONDS[1] / 60)),
      commit: (value) => change({ seconds: value * 60 + (draft.seconds % 60) }, null),
    });
    const secs = field({
      label: 'Seconds',
      value: draft.seconds % 60,
      name: 'releaseSeconds',
      type: 'text',
      inputMode: 'numeric',
      width: '5rem',
      parse: (text) => {
        const value = wholeIn('Seconds', 0, 59)(text);
        if (value % STEP !== 0) throw new Error('Seconds go in steps of ' + STEP + ': 0, 15, 30 or 45.');
        return value;
      },
      commit: (value) => change({ seconds: Math.floor(draft.seconds / 60) * 60 + value }, null),
    });
    keyed(minutes.input, key('minutes'));
    keyed(secs.input, key('seconds'));
    minutes.input.disabled = onBell;
    secs.input.disabled = onBell;
    const group = [h('p', { class: 'sch-markedit__label' }, 'How long after the bell'), h('div', { class: 'sch-release__time' }, minutes.element, secs.element)];
    if (draft.kind === 'groups') {
      const box = keyed(h('input', { type: 'checkbox' }), key('on-bell'));
      box.checked = draft.onBell;
      box.addEventListener('change', () => change({ onBell: box.checked }, key('on-bell')));
      group.push(h('label', { class: 'sch-radio' }, box, h('span', null, 'On the bell')));
    }
    group.push(h('p', { class: 'sch-hint' }, 'From ' + formatDuration(RELEASE_SECONDS[0]) + ' to ' + formatDuration(RELEASE_SECONDS[1]) + ', in steps of ' + STEP + ' s.'));
    top.push(h('div', { class: 'sch-release__long' }, group));
  }

  // ---- after which periods and on which day types
  const when = [];
  if (parts.includes('after')) {
    const periods = [radios('Follows', uid('release-after'), [{ value: 'all', label: 'Every ' + words.one }, { value: 'some', label: 'Only these…' }], draft.periodsMode,
      (value) => change({ periodsMode: value, after: value === 'all' ? [] : draft.after }, key('after:' + value)), (value) => key('after:' + value))];
    if (draft.periodsMode === 'some') {
      periods.push(h('div', { class: 'sch-markedit__ticks', role: 'group', 'aria-label': words.Many + ' this staggered dismissal follows' }, Array.from({ length: Math.max(project.settings.periods, ...draft.after.map((period) => period + 1)) }, (_, at) => {
        const box = keyed(h('input', { type: 'checkbox' }), key('period:' + at));
        box.checked = draft.after.includes(at);
        box.addEventListener('change', () => change({ after: box.checked ? draft.after.concat([at]) : draft.after.filter((other) => other !== at) }, key('period:' + at)));
        return h('label', { class: 'sch-radio' }, box, h('span', null, periodName(project.settings, at)));
      })));
    }
    when.push(h('div', null, periods));
  }
  if (parts.includes('days')) {
    const own = ownDayTypes(project);
    const shown = project.dayTypes.filter((dayType) => own.includes(dayType) || draft.dayTypeIds.includes(dayType.id));
    const followers = project.dayTypes.filter((dayType) => !own.includes(dayType));
    const days = [radios('Day types', uid('release-days'), [{ value: 'all', label: 'Every day type' }, { value: 'some', label: 'Only these…' }], draft.daysMode,
      (value) => change({ daysMode: value, dayTypeIds: value === 'all' ? [] : draft.dayTypeIds }, key('days:' + value)), (value) => key('days:' + value))];
    if (draft.daysMode === 'some') {
      days.push(h('div', { class: 'sch-markedit__ticks', role: 'group', 'aria-label': 'Day types this staggered dismissal is on' }, shown.map((dayType) => {
        const box = keyed(h('input', { type: 'checkbox' }), key('day:' + dayType.id));
        box.checked = draft.dayTypeIds.includes(dayType.id);
        box.addEventListener('change', () => change({ dayTypeIds: box.checked ? draft.dayTypeIds.concat([dayType.id]) : draft.dayTypeIds.filter((other) => other !== dayType.id) }, key('day:' + dayType.id)));
        const base = own.includes(dayType) ? null : effectiveDayType(project, dayType.id);
        return h('label', { class: 'sch-radio' }, box, h('span', null, dayType.name + (base ? ' (same as ' + base.name + ')' : '')));
      })));
      if (followers.length > 0) {
        days.push(h('p', { class: 'sch-hint' }, list(followers.map((dayType) => dayType.name)) + (followers.length === 1 ? ' is' : ' are') + ' the same as another day type and follows it, so ticking the day type it follows covers ' + (followers.length === 1 ? 'it' : 'them') + '.'));
      }
    }
    when.push(h('div', null, days));
  }
  return { element: h('div', { class: 'sch-release__fields' },
    top.length === 0 ? null : h('div', { class: 'sch-markedit__grid' }, top),
    when.length === 0 ? null : h('div', { class: 'sch-markedit__grid' }, when)) };
}
