// The Day tab (DESIGN 11.3): four cards, top to bottom.
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
  addBellSchedule, setBellSchedule, deleteBellSchedule,
} from '../../engine/actions.js';
import { isOwnCopy, baseDayType, effectiveDayType, ownDayTypes, dayShort, bellsShort } from '../../engine/day-types.js';
import { bellsFor, bellFindings, periodName, formatTime } from '../../engine/bells.js';
import { formatDuration } from '../../engine/findings.js';
import { PERIOD_WORDS, RANGES, DAY_TYPES_MOST, BELL_SCHEDULES_MOST, bellSchedulesOf } from '../../engine/schema.js';
import { fill, apply, button, keyed, freeName, dragRows, grip } from './common.js';

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
// sameAs }; what goes is the engine's describeDayTypeKind.
export function kindButtonWords(project, dayType, wanted) {
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
  parts.push(going.length > 0 ? 'Undo brings them back' : 'Undo brings it back');
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

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-daytab' });
  // a start typed with no end yet (or the other way round) waits here
  if (!view.halfBells) view.halfBells = new Map();
  // what is typed and chosen in "Add a day type", until it is added
  if (!view.dayAdd) view.dayAdd = { name: null, kind: 'own', refusal: '' };

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
      words: (option) => kindButtonWords(ctx.store.project, dayType, option.wanted),
      action: 'change-kind',
      opener,
    });
    if (!chosen || chosen.value === current) return;
    const before = ctx.store.project;
    const info = describeDayTypeKind(before, { dayTypeId: dayType.id, ...chosen.wanted });
    if (!apply(env, setDayTypeKind, { dayTypeId: dayType.id, ...chosen.wanted })) return;
    let text;
    if (chosen.wanted.own) {
      text = dayType.name + ' has its own classes now, starting as a copy of ' + info.from + '’s.';
    } else {
      const target = before.dayTypes.find((each) => each.id === chosen.wanted.sameAs).name;
      text = dayType.name + ' is the same as ' + target + ' now.';
      if (info.groups > 0) text += ' Its own classes for ' + count(info.groups, 'group') + ' went with that.';
      if (info.followers.length > 0) text += ' ' + list(info.followers) + (info.followers.length === 1 ? ' follows ' : ' follow ') + target + ' too.';
    }
    ctx.toast({ text, action: { label: 'Undo', run: ctx.undo } });
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
    else ctx.toast({ text: 'Copied ' + chosen.label + '’s classes onto ' + dayType.name + ' for every group.', action: { label: 'Undo', run: ctx.undo } });
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
    if (!apply(env, deleteDayType, { dayTypeId: dayType.id })) return;
    const outcome = ctx.store.undoOutcome;
    ctx.toast({ text: (outcome && outcome.text ? outcome.text : 'Deleted ' + dayType.name) + '.', action: { label: 'Undo', run: ctx.undo } });
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
    if (!base) items.push('separator', { label: 'Delete', danger: true, run: () => removeDayType(dayType) });
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
    if (state.name === null) state.name = nextDayTypeName(project);
    const nameId = uid('dt-add');
    const refusalId = uid('dt-add-refusal');
    const input = keyed(h('input', {
      type: 'text', class: 'field__input', id: nameId, autocomplete: 'off', spellcheck: 'false', style: 'width:12rem',
      'aria-describedby': state.refusal ? refusalId : null, 'aria-invalid': state.refusal ? 'true' : null,
    }), 'daytype-add-name');
    input.value = state.name;
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
      ctx.toast({ text: 'Added ' + added.name + (payload.own ? ', a copy of ' + base.name + '.' : ', the same as ' + effectiveDayType(after, added.id).name + '.'), action: { label: 'Undo', run: ctx.undo } });
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
    rows.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') event.stopImmediatePropagation();
    }, true);
    dragRows(rows, (from, to) => {
      const dayType = ctx.store.project.dayTypes[from];
      if (dayType) moveDayType(dayType, Math.max(1, to));
    });
    return h('section', { class: 'sch-card', 'aria-labelledby': 'sch-card-daytypes', data: { card: 'day-types' } },
      h('h2', { class: 'sch-card__title', id: 'sch-card-daytypes' }, 'Day types'),
      h('p', { class: 'sch-hint' }, 'A day type says which classes meet. One with its own classes has a room for every group in every ' + periodWords(project.settings).one + '; one that is the same as another follows it in everything.'),
      rows,
      addForm(project));
  }

  // ------------------------------------------------------------ 3. regular bells

  function regularBellsCard(project) {
    const tables = ownDayTypes(project).map((dayType) => {
      const titleId = uid('bells');
      return h('section', { class: 'sch-daytype', 'aria-labelledby': titleId, data: { day: dayType.id } },
        h('h3', { class: 'sch-daytype__title', id: titleId }, dayType.name),
        h('div', { class: 'sch-scroll' }, bellTable(project, { kind: 'day', id: dayType.id, name: dayType.name, bells: dayType.bells }, true)));
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
    ctx.toast({ text: 'Added ' + added.name + ', a copy of ' + baseDayType(project).name + '’s regular bells. Give it a name of its own.', action: { label: 'Undo', run: ctx.undo } });
    env.render('bsched:' + added.id + ':name');
  }

  function removeSchedule(schedule) {
    const index = bellSchedulesOf(ctx.store.project).indexOf(schedule);
    if (!apply(env, deleteBellSchedule, { bellScheduleId: schedule.id })) return;
    const outcome = ctx.store.undoOutcome;
    ctx.toast({ text: (outcome && outcome.text ? outcome.text : 'Deleted ' + schedule.name) + '.', action: { label: 'Undo', run: ctx.undo } });
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
    const words = periodWords(project.settings);
    return h('section', { class: 'sch-bsched', 'aria-labelledby': titleId, data: { bells: schedule.id } },
      h('div', { class: 'sch-bsched__head' },
        h('h3', { class: 'sch-daytype__title', id: titleId }, schedule.name),
        button('Delete', () => removeSchedule(schedule), { small: true, key: 'bsched:' + schedule.id + ':delete', action: 'delete-bells', more: ' the ' + schedule.name + ' bell schedule' })),
      h('div', { class: 'sch-bsched__fields' }, name.element, short.element),
      h('p', { class: 'sch-hint sch-bsched__off' }, off.length === 0 ? 'Every ' + words.one + ' meets.' : list(off.map((p) => periodName(project.settings, p))) + (off.length === 1 ? ' does' : ' do') + ' not meet.'),
      h('div', { class: 'sch-scroll' }, bellTable(project, { kind: 'bells', id: schedule.id, name: schedule.name, bells: schedule.bells }, true)));
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
      otherBellsCard(project));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
