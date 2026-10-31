// The Day tab (DESIGN 11.3): five cards, top to bottom.
//
//   1. The school day     how many periods, and what the school calls one.
//   2. Day types          which classes meet: one row each, with its name, its
//                         short name, its kind ("Its own classes" or "Same as
//                         A Day") and Change…; a menu with Move up, Move down,
//                         Copy classes from… and Delete; Add a day type, up to
//                         twelve.
//   3. Regular bells      a bell table for each day type with its own classes;
//                         one line for each that is the same as another.
//   4. Other bell         another set of times for the same classes (early
//      schedules          release, assembly, testing), each period with a No
//                         class tick.
//   5. Marked periods     Lunch, Advisory, Activity and No class in a period,
//                         for the school, some grades or some groups: a
//                         sentence a mark, each opening its editor in place.
//
// Every rule is the engine's (engine/actions.js and engine/day-types.js): the
// limits on names and counts, what a change of kind takes with it, what a
// delete takes. This file asks and says.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { choice } from '../components/choice.js';
import { openMenu } from '../components/menu.js';
import { count, list, periodWords } from '../components/words.js';
import {
  setPeriods, setSetting, describePeriodChange, renameDayType, setBell,
  addDayType, deleteDayType, reorderDayType, setDayTypeKind, setDayTypeShort, describeDayTypeKind, copyDay,
  addBellSchedule, setBellSchedule, deleteBellSchedule, addMark, setMark, deleteMark,
} from '../../engine/actions.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { markFor } from '../../engine/marks.js';
import { isOwnCopy, baseDayType, effectiveDayType, ownDayTypes, dayShort, bellsShort } from '../../engine/day-types.js';
import { bellsFor, bellFindings, periodName, formatTime } from '../../engine/bells.js';
import { formatDuration } from '../../engine/findings.js';
import { PERIOD_WORDS, RANGES, DAY_TYPES_MOST, BELL_SCHEDULES_MOST, MARK_KINDS, MARK_LABEL_MOST, bellSchedulesOf, marksOf, spacelessKey } from '../../engine/schema.js';
import { fill, apply, button, keyed, freeName, dragRows, grip, collator } from './common.js';
import { unappliedOn, dropPointless } from './grid/staged.js';
import { MARK_WORDS } from './grid/words.js';

// What a person types for a time, as "HH:MM" on the 24-hour clock; '' is no
// time. "8:05", "805", "2:10 pm" and "14:10" are all read. With the 12-hour
// clock chosen and no am or pm typed, 1 to 6 are taken as the afternoon,
// since no school day starts then.
export function parseClock(text, timeFormat) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return null;
  const match = trimmed.match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(a|p)?\.?m?\.?$/);
  const sorry = '"' + text + '" is not a time. Type it like 8:05 or 2:10 pm.';
  if (!match) throw new Error(sorry);
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (match[3]) {
    if (hours < 1 || hours > 12) throw new Error(sorry);
    hours = (hours % 12) + (match[3] === 'p' ? 12 : 0);
  } else if (timeFormat === '12h' && hours >= 1 && hours <= 6) {
    hours += 12;
  }
  if (hours > 23 || minutes > 59) throw new Error(sorry);
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

// "C Day", "D Day"… the first letter's day type nobody has, for the name a
// new day type starts with; past Z, "Day type 2" and on.
export function nextDayTypeName(project) {
  const names = project.dayTypes.map((dayType) => dayType.name);
  const squash = (name) => name.replace(/\s+/g, '').toLowerCase();
  const taken = new Set(names.map(squash));
  for (let code = 65; code <= 90; code += 1) {
    const name = String.fromCharCode(code) + ' Day';
    if (!taken.has(squash(name))) return name;
  }
  return freeName(names, 'Day type');
}

// The words on the Change… dialog's button, which say exactly what it does
// (DESIGN 11.3): "Make C Day the same as A Day (14 groups’ days on C Day go;
// Undo brings them back)". `wanted` is { own: true } or { own: false,
// sameAs }; what goes is the engine's describeDayTypeKind. `unapplied` is the
// grid's staged changes on the day type, which Undo does not bring back.
export function kindButtonWords(project, dayType, wanted, unapplied) {
  const own = isOwnCopy(project, dayType.id);
  if (wanted.own === true) {
    if (own) return 'Keep ' + dayType.name + ' as it is';
    return 'Give ' + dayType.name + ' its own classes, starting as a copy of ' + effectiveDayType(project, dayType.id).name;
  }
  const target = project.dayTypes.find((each) => each.id === wanted.sameAs) || baseDayType(project);
  if (!own && effectiveDayType(project, dayType.id).id === target.id) return 'Keep ' + dayType.name + ' as it is';
  if (!own) return 'Make ' + dayType.name + ' the same as ' + target.name;
  const info = describeDayTypeKind(project, { dayTypeId: dayType.id, own: false, sameAs: target.id });
  const going = [];
  if (info.groups > 0) going.push(info.groups + (info.groups === 1 ? ' group’s day' : ' groups’ days') + ' on ' + dayType.name);
  if (info.bells > 0) going.push((info.groups > 0 ? 'its ' : dayType.name + '’s ') + count(info.bells, 'bell time'));
  const parts = [];
  if (going.length > 0) parts.push(list(going) + ' go');
  if (info.followers.length > 0) parts.push(list(info.followers) + (info.followers.length === 1 ? ' follows ' : ' follow ') + target.name + ' too');
  const lost = unapplied > 0 ? ', but not the ' + count(unapplied, 'unapplied grid change') + ' on it' : '';
  parts.push((going.length > 0 ? 'Undo brings them back' : 'Undo brings it back') + lost);
  return 'Make ' + dayType.name + ' the same as ' + target.name + ' (' + parts.join('; ') + ')';
}

// A set of radios in a dialog, which commit nothing: the dialog's one button
// says what the choice will do, and the choice is only made by it (DESIGN
// 11.3: no choice commits by arrowing). `words(option)` is the button's text,
// written again as the choice moves. The focus starts on the choice that
// stands. Resolves with the option chosen, or null. The Groups tab's Copy
// classes from… uses it too.
export async function radioDialog(ctx, { id, title, legend, options, chosen, words, action, opener, after }) {
  const name = uid(id);
  let picked = chosen;
  const radios = options.map((option) => {
    const radio = h('input', { type: 'radio', name, value: option.value });
    radio.checked = option === picked;
    return h('label', { class: 'sch-radio' }, radio, h('span', null, option.label));
  });
  const set = h('fieldset', { class: 'sch-fieldset' }, h('legend', null, legend), radios);
  const dialog = ctx.openDialog({
    title,
    body: [set, after || null],
    opener,
    id,
    buttons: [{ label: words(picked), value: 'go', kind: 'primary' }, { label: 'Cancel', value: null }],
  });
  const go = dialog.element.querySelector('.dialog__buttons .btn--primary');
  go.dataset.action = action;
  set.addEventListener('change', (event) => {
    picked = options.find((option) => option.value === event.target.value) || picked;
    go.textContent = words(picked);
  });
  const checked = set.querySelector('input:checked');
  if (checked) checked.focus();
  return (await dialog.closed) === 'go' ? picked : null;
}

// Under 640 px (the width at which the Groups tab takes turns too).
const NARROW = '(max-width: 640px)';

// The sentence under a bell schedule's table for the periods ticked No class
// (`off`, from 0, sorted): "Every period meets.", "Period 3 does not meet.",
// "Periods 5 to 8 do not meet.", "Period 2 and Periods 5 to 8 do not meet.",
// and, with every period ticked, "Nothing meets under Early Release."
export function offSentence(settings, name, off, periods) {
  const words = periodWords(settings);
  if (off.length === 0) return 'Every ' + words.one + ' meets.';
  if (off.length >= periods) return 'Nothing meets under ' + name + '.';
  const runs = [];
  for (const period of off) {
    const last = runs[runs.length - 1];
    if (last && last[1] === period - 1) last[1] = period;
    else runs.push([period, period]);
  }
  // "Period 5" without its word, "C" for Block C, "2nd" for the 2nd Hour
  const bare = (period) => periodName(settings, period).replace(/^(Period|Mod|Block) /, '').replace(/ Hour$/, '');
  const hours = settings.periodWord === 'Hour';
  const pieces = runs.map(([from, to]) => {
    if (from === to) return periodName(settings, from);
    const span = bare(from) + (to === from + 1 ? ' and ' : ' to ') + bare(to);
    return hours ? span + ' ' + words.Many : words.Many + ' ' + span;
  });
  return list(pieces) + (off.length === 1 ? ' does' : ' do') + ' not meet.';
}

// ---------------------------------------------------------------- marked periods (DESIGN 11.3, card 5)

export { MARK_WORDS };

// The groups a mark takes, by its scope (ARCHITECTURE 17.5), in the project's
// order: every group, those of the grades (matched ignoring case and spaces),
// or those it names.
export function markGroups(project, mark) {
  if (mark.scope === 'groups') return project.groups.filter((group) => mark.groupIds.includes(group.id));
  if (mark.scope === 'grades') {
    const wanted = new Set(mark.grades.map(spacelessKey));
    return project.groups.filter((group) => typeof group.grade === 'string' && group.grade.trim() !== '' && wanted.has(spacelessKey(group.grade)));
  }
  return project.groups;
}

// The day types a mark takes: all when it names none, else those it names and
// those that are the same as one it names.
export function markDayTypes(project, mark) {
  if (mark.dayTypeIds.length === 0) return project.dayTypes;
  return project.dayTypes.filter((dayType) => {
    if (mark.dayTypeIds.includes(dayType.id)) return true;
    const own = effectiveDayType(project, dayType.id);
    return own !== null && mark.dayTypeIds.includes(own.id);
  });
}

// The groups for which another mark wins somewhere this one would apply
// ("7-3 has its own"), in the project's order. `id` is the mark's own id, ''
// for one not added yet.
export function markBeatenFor(project, mark, id) {
  const days = markDayTypes(project, mark);
  return markGroups(project, mark).filter((group) => days.some((dayType) => {
    const winner = markFor(project, group.id, dayType.id, mark.period);
    return winner !== null && winner.id !== id;
  }));
}

// "Lunch for grade 7 in Period 5, every day type (4 groups)" as plain parts:
// { word, kindWord, rest, groups, beaten }. `word` is the label or the kind's
// word, `kindWord` the kind's word when a label stands in front of it.
export function markParts(project, mark, id) {
  const settings = project.settings;
  const taken = markGroups(project, mark);
  let who;
  if (mark.scope === 'school') who = 'the whole school';
  else if (mark.scope === 'grades') who = (mark.grades.length === 1 ? 'grade ' : 'grades ') + list(mark.grades);
  else who = taken.length <= 3 ? list(taken.map((group) => group.name)) : count(taken.length, 'group');
  const pastEnd = mark.period >= settings.periods;
  const days = mark.dayTypeIds.length === 0 ? ', every day type' : ' on ' + list(project.dayTypes.filter((dayType) => mark.dayTypeIds.includes(dayType.id)).map((dayType) => dayType.name));
  const beaten = id === undefined ? [] : markBeatenFor(project, mark, id);
  return {
    word: mark.label !== '' ? mark.label : MARK_WORDS[mark.kind],
    kindWord: mark.label !== '' ? MARK_WORDS[mark.kind] : '',
    rest: ' for ' + who + ' in ' + periodName(settings, mark.period) + (pastEnd ? ' (past the end of the day)' : '') + days,
    groups: mark.scope === 'school' ? null : taken.length + (taken.length === 1 ? ' group' : ' groups'),
    beaten: beaten.length === 0 ? '' : beaten.length <= 2 ? list(beaten.map((group) => group.name)) + (beaten.length === 1 ? ' has its own' : ' have their own') : beaten.length + ' groups have their own',
  };
}

// The same, as one sentence of text.
export function markSentence(project, mark, id) {
  const parts = markParts(project, mark, id);
  return parts.word + (parts.kindWord === '' ? '' : ' (' + parts.kindWord + ')') + parts.rest + (parts.groups === null ? '' : ' (' + parts.groups + ')');
}

// The grades the groups are in, once each as first typed, in order.
export function gradesInUse(project) {
  const seen = new Map();
  for (const group of project.groups) {
    if (typeof group.grade !== 'string' || group.grade.trim() === '') continue;
    const key = spacelessKey(group.grade);
    if (!seen.has(key)) seen.set(key, group.grade.trim());
  }
  return Array.from(seen.values()).sort(collator.compare);
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-daytab' });
  // a start typed with no end yet (or the other way round) waits here
  if (!view.halfBells) view.halfBells = new Map();
  // which bell tables are open on a narrow screen: key -> open
  if (!view.bellFold) view.bellFold = new Map();
  // what is typed and chosen in "Add a day type", until it is added
  if (!view.dayAdd) view.dayAdd = { name: null, kind: 'own', refusal: '' };
  // (name null: nothing typed, and the next free name is suggested afresh)

  // ------------------------------------------------------------ 1. the school day

  async function commitPeriods(periods, input) {
    const project = ctx.store.project;
    const words = periodWords(project.settings);
    const info = describePeriodChange(project, periods);
    if (info.losesData) {
      const names = info.removedPeriods.map((period) => period.name);
      const what = names.length <= 3 ? list(names) : 'the last ' + names.length + ' ' + words.many;
      const lost = [];
      if (info.slots > 0) lost.push(count(info.slots, 'room entry', 'room entries') + ' in ' + count(info.groups.length, 'group'));
      if (info.bells > 0) lost.push(count(info.bells, 'bell time'));
      if (info.scenarioChanges > 0) lost.push(count(info.scenarioChanges, 'scenario change'));
      lost.push(...info.marksAndDutiesWords);
      const ok = await ctx.confirm({
        title: 'Remove ' + what + ' from every day?',
        body: 'That takes away ' + list(lost) + '. Undo brings them back.',
        action: 'Remove ' + what,
        keep: 'Keep ' + count(info.from, words.one, words.many),
        danger: true,
        opener: input,
      });
      if (!ok) return false;
    }
    ctx.store.apply(setPeriods, { periods });
    return true;
  }

  function dayBasics(project) {
    const words = periodWords(project.settings);
    const periodsHint = uid('hint');
    const periods = field({
      label: words.Many + ' per day',
      value: project.settings.periods,
      name: 'periods',
      width: '6rem',
      inputMode: 'numeric',
      describedBy: periodsHint,
      parse: wholeNumber('The number of ' + words.many + ' per day'),
      commit: (value) => commitPeriods(value, periods.input),
    });
    keyed(periods.input, 'day-periods');
    const wordLabel = uid('word');
    const word = choice({
      name: 'sch-period-word',
      labelledBy: wordLabel,
      options: PERIOD_WORDS.map((value) => ({ value, label: value })),
      value: project.settings.periodWord,
      onChange: (value) => apply(env, setSetting, { key: 'periodWord', value }),
    });
    word.element.querySelectorAll('input').forEach((input) => keyed(input, 'day-word:' + input.value));
    return h('div', { class: 'sch-daytab__basics' },
      h('div', null, periods.element, h('p', { class: 'sch-hint', id: periodsHint }, 'From ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '. Taking some away asks first, and says what would go.')),
      h('div', { class: 'field' }, h('span', { class: 'field__label', id: wordLabel }, 'What the school calls one'), word.element,
        h('p', { class: 'sch-hint' }, 'Blocks are lettered and hours are counted: ' + periodName({ periodWord: 'Block' }, 2) + ', ' + periodName({ periodWord: 'Hour' }, 2) + '.')));
  }

  // ------------------------------------------------------------ bell tables

  // One time field of a bell table. `owner` is { kind: 'day' | 'bells', id,
  // name, bells }: a day type's regular bells or a bell schedule's.
  function bellField(project, owner, period, which) {
    const settings = project.settings;
    const stored = owner.bells[period] || null;
    const key = (owner.kind === 'day' ? '' : 'b:') + owner.id + ':' + period;
    const half = stored ? null : view.halfBells.get(key);
    const value = stored ? stored[which] : half ? half[which] : null;
    const save = (bell) => {
      if (owner.kind === 'day') ctx.store.apply(setBell, { dayTypeId: owner.id, period, bell });
      else ctx.store.apply(setBellSchedule, { bellScheduleId: owner.id, period, bell });
    };
    const control = field({
      value,
      name: 'bell-' + which,
      width: '7rem',
      placeholder: settings.timeFormat === '24h' ? '08:05' : '8:05',
      format: (time) => (time ? formatTime(time, settings.timeFormat) : ''),
      parse: (text) => parseClock(text, settings.timeFormat),
      commit: (time) => {
        const before = stored || view.halfBells.get(key) || { start: null, end: null };
        const next = { ...before, [which]: time };
        if (next.start && next.end) {
          view.halfBells.delete(key);
          save(next);
        } else if (!next.start && !next.end) {
          view.halfBells.delete(key);
          save(null);
        } else if (stored) {
          throw new Error('A ' + periodWords(settings).one + ' needs both times. Empty both to take them away.');
        } else {
          view.halfBells.set(key, next);
        }
        env.render();
      },
    });
    const where = owner.kind === 'day' ? ' on ' + owner.name : ' with ' + owner.name + ' bells';
    control.input.setAttribute('aria-label', periodName(settings, period) + where + (which === 'start' ? ' starts at' : ' ends at'));
    keyed(control.input, (owner.kind === 'day' ? 'bell:' : 'bsched:') + owner.id + ':' + period + ':' + which);
    return control.element;
  }

  // A bell table. For a day type: its regular bells, editable when it has
  // its own classes. For a bell schedule: its times, with a No class tick in
  // each row; a period ticked reads "No class" and the checks pass it by.
  function bellTable(project, owner, editable) {
    const settings = project.settings;
    const words = periodWords(settings);
    const schedule = owner.kind === 'bells';
    const bells = schedule ? bellsFor(project, baseDayType(project).id, owner.id) : bellsFor(project, owner.id);
    const found = !editable ? [] : schedule ? bellFindings(project, null, owner.id) : bellFindings(project, owner.id);
    const prefix = schedule ? 'b:' : '';
    return h('table', { class: 'table sch-bells' + (editable ? '' : ' sch-bells--same') + (schedule ? ' sch-bells--schedule' : ''), data: schedule ? { bells: owner.id } : null },
      h('caption', { class: 'vh' }, schedule ? 'Times with ' + owner.name + ' bells' : 'Bell times on ' + owner.name),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, words.One),
        schedule ? h('th', { scope: 'col', class: 'sch-bells__off' }, 'No class') : null,
        ['Starts', 'Ends', 'Passing time after'].map((label) => h('th', { scope: 'col' }, label)),
        editable ? h('th', { scope: 'col' }, 'Noticed') : null)),
      h('tbody', null, bells.map((bell, period) => {
        const half = view.halfBells.get(prefix + owner.id + ':' + period);
        const mine = found.filter((finding) => finding.period === period);
        const off = bell.off === true;
        const passing = bell.passingAfter === null ? '' : formatDuration(bell.passingAfter) + (bell.passingFromBells ? '' : ' (the usual)');
        let tick = null;
        if (schedule) {
          const box = keyed(h('input', { type: 'checkbox', class: 'sch-bells__tick', 'aria-label': 'No class in ' + periodName(settings, period) + ' with ' + owner.name + ' bells' }), 'bsched:' + owner.id + ':' + period + ':off');
          box.checked = off;
          box.addEventListener('change', () => {
            if (!apply(env, setBellSchedule, { bellScheduleId: owner.id, period, off: box.checked })) box.checked = !box.checked;
          });
          tick = h('td', { class: 'sch-bells__off' }, h('label', { class: 'sch-tick' }, box));
        }
        const timeCell = (which) => {
          if (off) return h('td', { class: 'sch-bells__none' }, which === 'start' ? 'No class' : '');
          if (editable) return h('td', null, bellField(project, owner, period, which));
          return h('td', null, formatTime(bell[which], settings.timeFormat) || '—');
        };
        return h('tr', { data: { period: String(period), off: off ? 'true' : null } },
          h('th', { scope: 'row' }, periodName(settings, period)),
          tick,
          timeCell('start'),
          timeCell('end'),
          h('td', null, passing),
          editable ? h('td', { class: 'sch-bells__found' },
            half && !owner.bells[period] ? h('p', { class: 'sch-hint' }, 'Add the other time to keep this one.') : null,
            mine.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--warning', data: { bell: finding.kind } }, finding.message))) : null);
      })));
  }

  // ------------------------------------------------------------ 2. day types

  function kindWords(project, dayType) {
    if (dayType === baseDayType(project)) return dayType.name + ' comes first';
    return isOwnCopy(project, dayType.id) ? 'Its own classes' : 'Same as ' + effectiveDayType(project, dayType.id).name;
  }

  // Change…: what a day type is.
  async function changeKind(dayTypeId, opener) {
    const project = ctx.store.project;
    const dayType = project.dayTypes.find((each) => each.id === dayTypeId);
    if (!dayType) return;
    const own = isOwnCopy(project, dayType.id);
    const follows = own ? null : effectiveDayType(project, dayType.id);
    const options = [{ value: 'own', label: own ? 'Its own classes' : 'Its own classes, starting as a copy of ' + follows.name, wanted: { own: true } }]
      .concat(ownDayTypes(project).filter((each) => each.id !== dayType.id).map((each) => ({ value: each.id, label: 'Same as ' + each.name, wanted: { own: false, sameAs: each.id } })));
    const current = own ? 'own' : follows.id;
    const chosen = await radioDialog(ctx, {
      id: 'day-kind-dialog',
      title: 'Change what ' + dayType.name + ' is',
      legend: 'What ' + dayType.name + ' is',
      options,
      chosen: options.find((option) => option.value === current),
      words: (option) => kindButtonWords(ctx.store.project, dayType, option.wanted, unappliedOn(ctx.store.project, dayType.id)),
      action: 'change-kind',
      opener,
    });
    if (!chosen || chosen.value === current) return;
    const before = ctx.store.project;
    const info = describeDayTypeKind(before, { dayTypeId: dayType.id, ...chosen.wanted });
    const unapplied = !chosen.wanted.own && own ? unappliedOn(before, dayType.id) : 0;
    if (!apply(env, setDayTypeKind, { dayTypeId: dayType.id, ...chosen.wanted })) return;
    if (unapplied > 0) dropPointless(ctx.store.project);
    let text;
    if (chosen.wanted.own) {
      text = dayType.name + ' has its own classes now, starting as a copy of ' + info.from + '’s.';
    } else {
      const target = before.dayTypes.find((each) => each.id === chosen.wanted.sameAs).name;
      text = dayType.name + ' is the same as ' + target + ' now.';
      if (info.groups > 0) text += ' Its own classes for ' + count(info.groups, 'group') + ' went with that.';
      if (info.followers.length > 0) text += ' ' + list(info.followers) + (info.followers.length === 1 ? ' follows ' : ' follow ') + target + ' too.';
      if (unapplied > 0) text += ' ' + count(unapplied, 'unapplied grid change') + ' on ' + dayType.name + ' went too, and Undo does not bring ' + (unapplied === 1 ? 'it' : 'them') + ' back.';
    }
    ctx.toast({ text, action: { label: 'Undo', run: undoTo('daytype:' + dayType.id + ':change') } });
  }

  // Copy classes from…: any day type with its own classes into this one, for
  // every group, as one step.
  async function copyClasses(dayTypeId, opener) {
    const project = ctx.store.project;
    const dayType = project.dayTypes.find((each) => each.id === dayTypeId);
    if (!dayType) return;
    const sources = ownDayTypes(project).filter((each) => each.id !== dayType.id).map((each) => ({ value: each.id, label: each.name, dayType: each }));
    if (sources.length === 0) return;
    const chosen = await radioDialog(ctx, {
      id: 'day-copy-dialog',
      title: 'Copy classes onto ' + dayType.name,
      legend: 'Copy the classes of',
      options: sources,
      chosen: sources[0],
      words: (option) => 'Copy ' + option.label + '’s classes onto ' + dayType.name + ' for every group',
      action: 'copy-classes',
      opener,
      after: h('p', { class: 'sch-hint' }, 'Every group’s ' + dayType.name + ' becomes a copy of its day on the one chosen. Undo brings back what ' + dayType.name + ' had.'),
    });
    if (!chosen) return;
    const before = ctx.store.project;
    if (!apply(env, copyDay, { fromDayTypeId: chosen.value, toDayTypeId: dayType.id })) return;
    if (ctx.store.project === before) ctx.toast({ text: dayType.name + ' already has ' + chosen.label + '’s classes for every group.' });
    else ctx.toast({ text: 'Copied ' + chosen.label + '’s classes onto ' + dayType.name + ' for every group.', action: { label: 'Undo', run: undoTo('daytype:' + dayType.id + ':menu') } });
  }

  // Undo from a toast, with the focus on the control the change was made
  // from (DESIGN 11.2), not left on the surface.
  function undoTo(key) {
    return () => {
      ctx.undo();
      env.render(key);
    };
  }

  function moveDayType(dayType, toIndex) {
    if (!apply(env, reorderDayType, { dayTypeId: dayType.id, toIndex })) return;
    const project = ctx.store.project;
    const at = project.dayTypes.findIndex((each) => each.id === dayType.id);
    ctx.announce(dayType.name + ' is now ' + (at + 1) + ' of ' + project.dayTypes.length + '.');
    env.render('daytype:' + dayType.id + ':menu');
  }

  function removeDayType(dayType) {
    const project = ctx.store.project;
    const index = project.dayTypes.indexOf(dayType);
    const unapplied = unappliedOn(project, dayType.id);
    if (!apply(env, deleteDayType, { dayTypeId: dayType.id })) return;
    if (unapplied > 0) dropPointless(ctx.store.project);
    const outcome = ctx.store.undoOutcome;
    const lost = unapplied > 0 ? ' It had ' + count(unapplied, 'unapplied grid change') + ', which Undo does not bring back.' : '';
    ctx.toast({ text: (outcome && outcome.text ? outcome.text : 'Deleted ' + dayType.name) + '.' + lost, action: { label: 'Undo', run: undoTo('daytype:' + dayType.id + ':menu') } });
    // the focus on the row that took its place, or the one above it
    const left = ctx.store.project.dayTypes;
    const next = left[Math.min(index, left.length - 1)];
    env.render(next && next !== left[0] ? 'daytype:' + next.id + ':menu' : 'daytype-add-name');
  }

  function dayTypeMenu(dayTypeId, opener) {
    const project = ctx.store.project;
    const index = project.dayTypes.findIndex((each) => each.id === dayTypeId);
    const dayType = project.dayTypes[index];
    if (!dayType) return;
    const base = index === 0;
    const items = [];
    if (!base) {
      items.push({ label: 'Move up', disabled: index <= 1, run: () => moveDayType(dayType, index - 1) });
      items.push({ label: 'Move down', disabled: index >= project.dayTypes.length - 1, run: () => moveDayType(dayType, index + 1) });
    }
    if (isOwnCopy(project, dayType.id)) items.push({ label: 'Copy classes from…', disabled: ownDayTypes(project).length < 2, run: () => copyClasses(dayType.id, opener) });
    if (!base) {
      const unapplied = unappliedOn(project, dayType.id);
      items.push('separator', { label: unapplied > 0 ? 'Delete, and ' + count(unapplied, 'unapplied grid change') + ' on it' : 'Delete', danger: true, run: () => removeDayType(dayType) });
    }
    openMenu({ items, anchor: opener, label: dayType.name });
  }

  function dayTypeRow(project, dayType, index) {
    const base = index === 0;
    const own = isOwnCopy(project, dayType.id);
    const name = field({ label: 'Name', value: dayType.name, name: 'dayTypeName', width: '12rem', commit: (value) => {
      ctx.store.apply(renameDayType, { dayTypeId: dayType.id, name: value });
    } });
    name.input.setAttribute('aria-label', 'Name of ' + dayType.name);
    keyed(name.input, 'daytype:' + dayType.id + ':name');
    const derived = dayShort(dayType, project.dayTypes);
    const short = field({
      label: 'Short',
      value: typeof dayType.short === 'string' ? dayType.short : '',
      name: 'dayTypeShort',
      width: '5rem',
      placeholder: derived,
      commit: (value) => {
        ctx.store.apply(setDayTypeShort, { dayTypeId: dayType.id, short: value.trim() });
      },
    });
    short.input.setAttribute('aria-label', 'Short name of ' + dayType.name + ', up to 4 characters' + (dayType.short ? '' : '. Left empty, it is ' + derived));
    keyed(short.input, 'daytype:' + dayType.id + ':short');
    const kind = h('p', { class: 'sch-dtrow__kind', data: { kind: base ? 'base' : own ? 'own' : 'same' } }, kindWords(project, dayType));
    let change = null;
    if (!base) {
      change = button('Change…', (opener) => changeKind(dayType.id, opener), { small: true, key: 'daytype:' + dayType.id + ':change', action: 'change-kind', more: ' what ' + dayType.name + ' is' });
      change.setAttribute('aria-haspopup', 'dialog');
    }
    // the first day type's menu has only Copy classes from…, and only when
    // there is another day type with its own classes to copy from
    const hasMenu = !base || ownDayTypes(project).length > 1;
    const menu = hasMenu ? keyed(h('button', {
      type: 'button',
      class: 'icon-btn sch-slot__menu',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'More for ' + dayType.name,
      title: 'More for ' + dayType.name,
      on: { click: (event) => dayTypeMenu(dayType.id, event.currentTarget) },
    }, '⋯'), 'daytype:' + dayType.id + ':menu') : null;
    return h('li', { class: 'sch-dtrow' + (own ? '' : ' sch-dtrow--same'), data: { index: String(index), day: dayType.id } },
      h('span', { class: 'sch-dtrow__grip' }, base ? null : grip()),
      h('div', { class: 'sch-dtrow__name' }, name.element),
      h('div', { class: 'sch-dtrow__more' },
        short.element,
        h('div', { class: 'sch-dtrow__kindbox' }, kind, change)),
      h('div', { class: 'sch-dtrow__menu' }, menu));
  }

  function addForm(project) {
    const n = project.dayTypes.length;
    const countId = uid('dt-count');
    if (n >= DAY_TYPES_MOST) {
      const off = button('Add a day type', () => {}, { key: 'daytype-add', action: 'add-day-type' });
      off.setAttribute('aria-disabled', 'true');
      off.setAttribute('aria-describedby', countId);
      return h('div', { class: 'sch-dtadd sch-dtadd--full' },
        h('h3', { class: 'sch-card__sub' }, 'Add a day type'),
        h('div', { class: 'sch-dtadd__go' }, off, h('p', { class: 'sch-hint sch-dtadd__count', id: countId }, n + ' of ' + DAY_TYPES_MOST + '. A project has at most ' + DAY_TYPES_MOST + ' day types; delete one to add another.')));
    }
    const state = view.dayAdd;
    const nameId = uid('dt-add');
    const refusalId = uid('dt-add-refusal');
    const input = keyed(h('input', {
      type: 'text', class: 'field__input', id: nameId, autocomplete: 'off', spellcheck: 'false', style: 'width:12rem',
      'aria-describedby': state.refusal ? refusalId : null, 'aria-invalid': state.refusal ? 'true' : null,
    }), 'daytype-add-name');
    input.value = state.name === null ? nextDayTypeName(project) : state.name;
    input.addEventListener('input', () => {
      state.name = input.value;
    });
    const radioName = uid('dt-add-kind');
    const base = baseDayType(project);
    const options = [{ value: 'own', label: 'Its own classes, starting as a copy of ' + base.name }]
      .concat(ownDayTypes(project).map((each) => ({ value: each.id, label: 'Same as ' + each.name })));
    if (!options.some((option) => option.value === state.kind)) state.kind = 'own';
    const radios = options.map((option) => {
      const radio = keyed(h('input', { type: 'radio', name: radioName, value: option.value }), 'daytype-add-kind:' + option.value);
      radio.checked = option.value === state.kind;
      radio.addEventListener('change', () => {
        if (radio.checked) state.kind = option.value;
      });
      return h('label', { class: 'sch-radio' }, radio, h('span', null, option.label));
    });
    const add = () => {
      const payload = state.kind === 'own' ? { name: input.value.trim(), own: true } : { name: input.value.trim(), own: false, sameAs: state.kind };
      try {
        ctx.store.apply(addDayType, payload);
      } catch (error) {
        state.name = input.value;
        state.refusal = error && error.message ? error.message : 'That day type could not be added. Try again.';
        env.render('daytype-add-name');
        return;
      }
      const after = ctx.store.project;
      const added = after.dayTypes[after.dayTypes.length - 1];
      ctx.toast({ text: 'Added ' + added.name + (payload.own ? ', a copy of ' + base.name + '.' : ', the same as ' + effectiveDayType(after, added.id).name + '.'), action: { label: 'Undo', run: undoTo('daytype-add-name') } });
      view.dayAdd = { name: null, kind: state.kind, refusal: '' };
      env.render(after.dayTypes.length >= DAY_TYPES_MOST ? 'daytype-add' : 'daytype-add-name');
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
    return h('div', { class: 'sch-dtadd' },
      h('h3', { class: 'sch-card__sub' }, 'Add a day type'),
      h('div', { class: 'sch-dtadd__row' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: nameId }, 'Name'), input,
          state.refusal ? h('p', { class: 'field__refusal', id: refusalId }, state.refusal) : null),
        h('fieldset', { class: 'sch-fieldset' }, h('legend', null, 'Its classes'), radios)),
      h('div', { class: 'sch-dtadd__go' },
        button('Add', add, { primary: true, key: 'daytype-add', action: 'add-day-type', more: ' this day type' }),
        h('p', { class: 'sch-hint sch-dtadd__count', id: countId }, n + ' of ' + DAY_TYPES_MOST)));
  }

  function dayTypesCard(project) {
    const rows = h('ol', { class: 'sch-dtlist', 'aria-label': 'Day types' }, project.dayTypes.map((dayType, index) => dayTypeRow(project, dayType, index)));
    // Drag to reorder, by mouse or pen. A finger does not drag (it scrolls
    // the page); Move up and Move down in the row's menu always work
    // (DESIGN 11.2).
    dragRows(rows, (from, to) => {
      const dayType = ctx.store.project.dayTypes[from];
      if (dayType) moveDayType(dayType, Math.max(1, to));
    }, { touch: false });
    return h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-daytypes', data: { card: 'day-types' } },
      h('h2', { class: 'sch-card__title', id: 'sch-card-daytypes' }, 'Day types'),
      h('p', { class: 'sch-hint' }, 'A day type says which classes meet. One with its own classes has a room for every group in every ' + periodWords(project.settings).one + '; one that is the same as another follows it in everything.'),
      rows,
      addForm(project));
  }

  // ------------------------------------------------------------ 3. regular bells

  // Under 640 px a bell table is a disclosure headed by its day type's or
  // schedule's name, folded when there are more than two tables in the card
  // (the page would be a long scroll of tables); wider, the table is just
  // there. What a person opened or shut stays so through the next drawing.
  // `title` is the heading's text node(s), `table` the scrolling table.
  function bellFold(key, many, heading, table, headed) {
    if (!window.matchMedia(NARROW).matches) return headed ? [heading, table] : [table];
    const details = h('details', { class: 'sch-fold', data: { fold: key } },
      h('summary', { class: 'sch-fold__summary' }, heading), table);
    const fallback = many <= 2;
    details.open = view.bellFold.has(key) ? view.bellFold.get(key) : fallback;
    // (the toggle event fires for setting `open` above as well: only a
    // difference from the usual is something a person did)
    details.addEventListener('toggle', () => {
      if (details.open === fallback) view.bellFold.delete(key);
      else view.bellFold.set(key, details.open);
    });
    return [details];
  }

  function regularBellsCard(project) {
    const tables = ownDayTypes(project).map((dayType) => {
      const titleId = uid('bells');
      return h('section', { class: 'sch-daytype', 'aria-labelledby': titleId, data: { day: dayType.id } },
        bellFold('day:' + dayType.id, ownDayTypes(project).length,
          h('h3', { class: 'sch-daytype__title', id: titleId }, dayType.name),
          h('div', { class: 'sch-scroll' }, bellTable(project, { kind: 'day', id: dayType.id, name: dayType.name, bells: dayType.bells }, true)), true));
    });
    const followers = project.dayTypes.filter((dayType) => !isOwnCopy(project, dayType.id));
    return h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-regular', data: { card: 'regular-bells' } },
      h('h2', { class: 'sch-card__title', id: 'sch-card-regular' }, 'Regular bells'),
      h('p', { class: 'sch-hint' }, 'The times each day type rings on an ordinary day.'),
      h('div', { class: 'sch-daytypes' }, tables),
      followers.length === 0 ? null : h('ul', { class: 'sch-followers' }, followers.map((dayType) => h('li', { class: 'sch-followers__line', data: { day: dayType.id } }, dayType.name + ': ' + effectiveDayType(project, dayType.id).name + '’s bells'))));
  }

  // ------------------------------------------------------------ 4. other bell schedules

  function addSchedule() {
    const project = ctx.store.project;
    if (bellSchedulesOf(project).length >= BELL_SCHEDULES_MOST) return;
    const name = freeName(bellSchedulesOf(project).map((schedule) => schedule.name), 'New bell schedule');
    if (!apply(env, addBellSchedule, { name })) return;
    const all = bellSchedulesOf(ctx.store.project);
    const added = all[all.length - 1];
    ctx.toast({ text: 'Added ' + added.name + ', a copy of ' + baseDayType(project).name + '’s regular bells. Give it a name of its own.', action: { label: 'Undo', run: undoTo('bsched-add') } });
    env.render('bsched:' + added.id + ':name');
  }

  function removeSchedule(schedule) {
    const index = bellSchedulesOf(ctx.store.project).indexOf(schedule);
    if (!apply(env, deleteBellSchedule, { bellScheduleId: schedule.id })) return;
    const outcome = ctx.store.undoOutcome;
    ctx.toast({ text: (outcome && outcome.text ? outcome.text : 'Deleted ' + schedule.name) + '.', action: { label: 'Undo', run: undoTo('bsched:' + schedule.id + ':delete') } });
    const left = bellSchedulesOf(ctx.store.project);
    const next = left[Math.min(index, left.length - 1)];
    env.render(next ? 'bsched:' + next.id + ':delete' : 'bsched-add');
  }

  function scheduleBlock(project, schedule, all) {
    const titleId = uid('bsched');
    const name = field({ label: 'Name', value: schedule.name, name: 'bellScheduleName', width: '14rem', commit: (value) => {
      ctx.store.apply(setBellSchedule, { bellScheduleId: schedule.id, name: value });
    } });
    name.input.setAttribute('aria-label', 'Name of the ' + schedule.name + ' bell schedule');
    keyed(name.input, 'bsched:' + schedule.id + ':name');
    const derived = bellsShort(schedule, all);
    const short = field({
      label: 'Short',
      value: typeof schedule.short === 'string' ? schedule.short : '',
      name: 'bellScheduleShort',
      width: '5rem',
      placeholder: derived,
      commit: (value) => {
        ctx.store.apply(setBellSchedule, { bellScheduleId: schedule.id, short: value.trim() });
      },
    });
    short.input.setAttribute('aria-label', 'Short name of ' + schedule.name + ', up to 4 characters' + (schedule.short ? '' : '. Left empty, it is ' + derived));
    keyed(short.input, 'bsched:' + schedule.id + ':short');
    const off = Array.isArray(schedule.off) ? schedule.off.filter((p) => p < project.settings.periods) : [];
    return h('section', { class: 'sch-bsched', 'aria-labelledby': titleId, data: { bells: schedule.id } },
      h('div', { class: 'sch-bsched__head' },
        h('h3', { class: 'sch-daytype__title', id: titleId }, schedule.name),
        button('Delete', () => removeSchedule(schedule), { small: true, key: 'bsched:' + schedule.id + ':delete', action: 'delete-bells', more: ' the ' + schedule.name + ' bell schedule' })),
      h('div', { class: 'sch-bsched__fields' }, name.element, short.element),
      bellFold('bells:' + schedule.id, all.length,
        h('span', { class: 'sch-fold__name' }, schedule.name + ': bell times'),
        h('div', { class: 'sch-scroll' }, bellTable(project, { kind: 'bells', id: schedule.id, name: schedule.name, bells: schedule.bells }, true)), false),
      h('p', { class: 'sch-hint sch-bsched__off' }, offSentence(project.settings, schedule.name, off, project.settings.periods)));
  }

  function otherBellsCard(project) {
    const all = bellSchedulesOf(project);
    const full = all.length >= BELL_SCHEDULES_MOST;
    const add = button('Add a bell schedule', addSchedule, { primary: all.length === 0, key: 'bsched-add', action: 'add-bells' });
    const countId = uid('bs-count');
    if (full) {
      add.setAttribute('aria-disabled', 'true');
      add.setAttribute('aria-describedby', countId);
    }
    return h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-other', data: { card: 'other-bells' } },
      h('h2', { class: 'sch-card__title', id: 'sch-card-other' }, 'Other bell schedules'),
      h('p', { class: 'sch-hint' }, 'Early release, assembly, testing: the same classes at other times. A new one starts as a copy of ' + baseDayType(project).name + '’s regular bells; tick No class for each ' + periodWords(project.settings).one + ' that does not meet.'),
      all.map((schedule) => scheduleBlock(project, schedule, all)),
      h('div', { class: 'sch-bsched__add' }, add,
        full ? h('p', { class: 'sch-hint', id: countId }, all.length + ' of ' + BELL_SCHEDULES_MOST + '. A project has at most ' + BELL_SCHEDULES_MOST + ' bell schedules; delete one to add another.') : null));
  }

  // ------------------------------------------------------------ 5. marked periods

  // What is open in the card: null, or a draft { id, kind, label, period,
  // daysMode, dayTypeIds, scope, grades, groupIds }. `id` is null for a mark
  // not added yet, which is added by its own button; one that is added is
  // changed as each field is left, once the draft says something the engine
  // takes (a scope of grades with no grade ticked yet waits).
  if (view.markEdit === undefined) view.markEdit = null;

  function draftOf(mark) {
    return {
      id: mark ? mark.id : null,
      kind: mark ? mark.kind : 'lunch',
      label: mark ? mark.label : '',
      period: mark ? mark.period : 0,
      daysMode: mark && mark.dayTypeIds.length > 0 ? 'some' : 'all',
      dayTypeIds: mark ? mark.dayTypeIds.slice() : [],
      scope: mark ? mark.scope : 'school',
      grades: mark ? mark.grades.slice() : [],
      groupIds: mark ? mark.groupIds.slice() : [],
    };
  }

  // The fields the actions take.
  function payloadOf(edit) {
    return {
      kind: edit.kind,
      label: edit.label,
      period: edit.period,
      dayTypeIds: edit.daysMode === 'all' ? [] : edit.dayTypeIds,
      scope: edit.scope,
      grades: edit.scope === 'grades' ? edit.grades : [],
      groupIds: edit.scope === 'groups' ? edit.groupIds : [],
    };
  }

  // What is still missing before the engine can take the draft, or ''.
  function missing(edit) {
    if (edit.daysMode === 'some' && edit.dayTypeIds.length === 0) return 'Tick a day type to finish.';
    if (edit.scope === 'grades' && edit.grades.length === 0) return 'Tick a grade to finish.';
    if (edit.scope === 'groups' && edit.groupIds.length === 0) return 'Add a group to finish.';
    return '';
  }

  function openMark(mark) {
    view.markEdit = draftOf(mark);
    env.render('mark:' + mark.id + ':kind:' + mark.kind);
  }

  function startMark() {
    view.markEdit = draftOf(null);
    env.render('mark:new:kind:lunch');
  }

  function closeMark() {
    const edit = view.markEdit;
    view.markEdit = null;
    env.render(edit && edit.id !== null ? 'mark:' + edit.id + ':open' : 'mark-new');
  }

  // A field of the draft changed; `key` is the control to keep the focus on.
  function change(patch, key) {
    const edit = view.markEdit;
    if (!edit) return;
    Object.assign(edit, patch);
    if (edit.id !== null && missing(edit) === '') apply(env, setMark, { id: edit.id, ...payloadOf(edit) });
    env.render(key);
  }

  function addThisMark() {
    const edit = view.markEdit;
    if (!edit || missing(edit) !== '') return;
    if (!apply(env, addMark, payloadOf(edit))) return;
    view.markEdit = null;
    const marks = marksOf(ctx.store.project);
    const added = marks[marks.length - 1];
    ctx.announce('Added ' + markSentence(ctx.store.project, added, added.id) + '.');
    env.render('mark:' + added.id + ':open');
  }

  function removeMark(mark) {
    const project = ctx.store.project;
    const sentence = markSentence(project, mark, mark.id);
    if (!apply(env, deleteMark, { id: mark.id })) return;
    view.markEdit = null;
    ctx.toast({ text: 'Deleted ' + sentence + '.', action: { label: 'Undo', run: ctx.undo } });
    env.render('mark-new');
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

  function markEditor(project, edit) {
    const id = edit.id === null ? 'new' : edit.id;
    const key = (part) => 'mark:' + id + ':' + part;
    const words = periodWords(project.settings);
    const kindLegend = uid('mark-kind');
    const kind = choice({
      name: uid('mark-kind'),
      labelledBy: kindLegend,
      options: MARK_KINDS.map((value) => ({ value, label: MARK_WORDS[value] })),
      value: edit.kind,
      onChange: (value) => change({ kind: value }, key('kind:' + value)),
    });
    kind.element.querySelectorAll('input').forEach((input) => keyed(input, key('kind:' + input.value)));

    const says = h('p', { class: 'sch-markedit__says', 'aria-live': 'polite' });
    const draftMark = () => ({ id: edit.id === null ? '' : edit.id, ...payloadOf(edit) });
    const sayIt = () => {
      says.textContent = markSentence(project, draftMark(), edit.id === null ? '' : edit.id);
    };
    sayIt();

    const label = field({
      label: 'Label (optional)',
      value: edit.label,
      name: 'markLabel',
      placeholder: MARK_WORDS[edit.kind],
      commit: (value) => {
        const next = { ...edit, label: value.trim() };
        if (edit.id !== null && missing(next) === '') ctx.store.apply(setMark, { id: edit.id, ...payloadOf(next) });
        edit.label = next.label;
        sayIt();
      },
    });
    keyed(label.input, key('label'));
    label.input.maxLength = MARK_LABEL_MOST * 2;
    label.input.setAttribute('aria-describedby', uid('mark-label-hint'));
    const labelHint = h('p', { class: 'sch-hint', id: label.input.getAttribute('aria-describedby') }, 'Shown in place of ' + MARK_WORDS[edit.kind] + ', such as Assembly or Testing. Up to ' + MARK_LABEL_MOST + ' characters.');

    const period = keyed(h('select', { class: 'field__input', id: uid('mark-period') }, Array.from({ length: Math.max(project.settings.periods, edit.period + 1) }, (_, at) => h('option', { value: String(at) }, periodName(project.settings, at) + (at >= project.settings.periods ? ' (not in the day)' : '')))), key('period'));
    period.value = String(edit.period);
    period.addEventListener('change', () => change({ period: Number(period.value) }, key('period')));

    const days = [radios('Day types', uid('mark-days'), [{ value: 'all', label: 'Every day type' }, { value: 'some', label: 'Only these…' }], edit.daysMode,
      (value) => change({ daysMode: value, dayTypeIds: value === 'all' ? [] : edit.dayTypeIds }, key('days:' + value)), (value) => key('days:' + value))];
    if (edit.daysMode === 'some') {
      days.push(h('div', { class: 'sch-markedit__ticks', role: 'group', 'aria-label': 'Day types this mark is on' }, project.dayTypes.map((dayType) => {
        const box = keyed(h('input', { type: 'checkbox' }), key('day:' + dayType.id));
        box.checked = edit.dayTypeIds.includes(dayType.id);
        box.addEventListener('change', () => change({ dayTypeIds: box.checked ? edit.dayTypeIds.concat([dayType.id]) : edit.dayTypeIds.filter((other) => other !== dayType.id) }, key('day:' + dayType.id)));
        return h('label', { class: 'sch-radio' }, box, h('span', null, dayType.name));
      })));
    }

    const who = [radios('Who', uid('mark-who'), [{ value: 'school', label: 'The whole school' }, { value: 'grades', label: 'Grades…' }, { value: 'groups', label: 'Groups…' }], edit.scope,
      (value) => change({ scope: value }, key('who:' + value)), (value) => key('who:' + value))];
    if (edit.scope === 'grades') {
      const keys = new Set(edit.grades.map(spacelessKey));
      const grades = gradesInUse(project);
      for (const grade of edit.grades) if (!grades.some((other) => spacelessKey(other) === spacelessKey(grade))) grades.push(grade);
      who.push(grades.length === 0
        ? h('p', { class: 'sch-hint' }, 'No group has a grade yet. Give groups a grade on the Groups tab.')
        : h('div', { class: 'sch-markedit__chips', role: 'group', 'aria-label': 'Grades' }, grades.map((grade) => {
          const pressed = keys.has(spacelessKey(grade));
          return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(pressed), data: { grade }, on: { click: () => change({
            grades: pressed ? edit.grades.filter((other) => spacelessKey(other) !== spacelessKey(grade)) : edit.grades.concat([grade]),
          }, key('grade:' + spacelessKey(grade))) } }, 'Grade ' + grade), key('grade:' + spacelessKey(grade)));
        })));
    }
    if (edit.scope === 'groups') {
      const chosen = edit.groupIds.map((groupId) => project.groups.find((group) => group.id === groupId)).filter(Boolean);
      const add = picker({
        placeholder: chosen.length === 0 ? 'Add a group' : 'Add another group',
        listLabel: 'Groups',
        emptyText: project.groups.length === 0 ? 'No groups yet.' : 'No group matches.',
        options: () => ctx.store.project.groups.filter((group) => !edit.groupIds.includes(group.id)).map((group) => ({ id: group.id, label: group.name })),
        onPick: (option) => change({ groupIds: edit.groupIds.concat([option.id]) }, key('group-add')),
      });
      add.input.setAttribute('aria-label', 'Add a group to this mark');
      keyed(add.input, key('group-add'));
      who.push(h('div', { class: 'sch-markedit__chips' },
        chosen.map((group) => h('span', { class: 'chip' }, h('span', null, group.name), keyed(h('button', { type: 'button', class: 'chip__remove', 'aria-label': 'Take ' + group.name + ' off this mark', on: {
          click: () => change({ groupIds: edit.groupIds.filter((other) => other !== group.id) }, key('group-add')),
        } }, icon('close', 14)), key('group:' + group.id)))), add.element));
    }

    const hint = missing(edit);
    const added = edit.id === null ? null : marksOf(project).find((mark) => mark.id === edit.id);
    return h('div', { class: 'sch-markedit', role: 'group', 'aria-label': edit.id === null ? 'The new mark' : 'The mark: ' + (added ? markSentence(project, added, added.id) : '') },
      h('div', { class: 'sch-markedit__kind' }, h('p', { class: 'sch-markedit__legend', id: kindLegend }, 'Kind'), kind.element),
      h('div', { class: 'sch-markedit__grid' }, h('div', null, label.element, labelHint), h('div', { class: 'field' }, h('label', { class: 'field__label', for: period.id }, words.One), period)),
      h('div', { class: 'sch-markedit__grid' }, h('div', null, days), h('div', null, who)),
      h('p', { class: 'sch-markedit__label' }, 'This reads:'),
      says,
      hint === '' ? null : h('p', { class: 'sch-hint sch-markedit__missing', role: 'status' }, hint + (edit.id === null ? '' : ' Nothing changes until then.')),
      h('div', { class: 'sch-toolbar' },
        edit.id === null
          ? [button('Add this mark', addThisMark, { primary: true, key: key('add'), action: 'add-mark' }), button('Cancel', closeMark, { key: key('cancel'), action: 'cancel-mark' })]
          : [button('Done', closeMark, { primary: true, key: key('done'), action: 'done-mark' }), button('Delete this mark', () => removeMark(added), { key: key('delete'), action: 'delete-mark' })]));
  }

  function markLine(project, mark) {
    const parts = markParts(project, mark, mark.id);
    return h('li', { class: 'sch-marks__item', data: { mark: mark.id } },
      keyed(h('button', { type: 'button', class: 'sch-marks__line', 'aria-expanded': 'false', on: { click: () => openMark(mark) } },
        h('strong', null, parts.word), parts.kindWord === '' ? null : ' (' + parts.kindWord + ')', parts.rest,
        parts.groups === null ? null : [' (', h('span', { class: parts.groups.startsWith('0 ') ? 'sch-marks__none' : null }, parts.groups), ')']), 'mark:' + mark.id + ':open'),
      parts.beaten === '' ? null : h('span', { class: 'sch-marks__beaten' }, parts.beaten));
  }

  function marksCard(project) {
    const marks = marksOf(project);
    const edit = view.markEdit && (view.markEdit.id === null || marks.some((mark) => mark.id === view.markEdit.id)) ? view.markEdit : null;
    if (view.markEdit && !edit) view.markEdit = null;
    const add = button('Mark a period', startMark, { primary: marks.length === 0, key: 'mark-new', action: 'mark-period' });
    add.disabled = edit !== null && edit.id === null;
    return h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-marks', data: { card: 'marks' } },
      h('h2', { class: 'sch-card__title', id: 'sch-card-marks' }, 'Marked periods'),
      h('p', { class: 'sch-hint' }, 'Lunch, advisory, an assembly or no class in a ' + periodWords(project.settings).one + ', for the whole school, some grades or some groups. No class beats every other mark. A teacher with nothing in a ' + periodWords(project.settings).one + ' the school has marked shows the mark instead of Planning.'),
      marks.length === 0 && edit === null
        ? h('p', { class: 'sch-marks__empty' }, 'Nothing is marked. Mark lunch by grade, an assembly or a no-class period here, and the groups, teachers and checks follow.')
        : h('ul', { class: 'sch-marks' }, marks.map((mark) => (edit && edit.id === mark.id ? h('li', { class: 'sch-marks__item is-open', data: { mark: mark.id } }, markEditor(project, edit)) : markLine(project, mark)))),
      edit !== null && edit.id === null ? markEditor(project, edit) : null,
      h('div', { class: 'sch-toolbar' }, add));
  }

  // ------------------------------------------------------------ drawing

  function draw(project) {
    const words = periodWords(project.settings);
    fill(element,
      h('p', { class: 'sch-lead' }, 'The day is ' + count(project.settings.periods, words.one, words.many) + ' long. A day type says which classes meet; a bell schedule says which times ring.'),
      h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-day', data: { card: 'school-day' } },
        h('h2', { class: 'sch-card__title', id: 'sch-card-day' }, 'The school day'),
        dayBasics(project)),
      dayTypesCard(project),
      regularBellsCard(project),
      otherBellsCard(project),
      marksCard(project));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
