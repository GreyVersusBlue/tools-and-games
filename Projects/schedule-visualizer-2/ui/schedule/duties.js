// The Duties tab (DESIGN 11.5, `#schedule/duties`): bus duty, lunch duty and
// standing meetings, one row each, sorted by when. A duty is an overlay on a
// teacher's day (ARCHITECTURE 17.6): it never moves a group, and it shows on
// the Teachers tab, the Grid's teachers and the prints.
//
//   What    the kind (Duty, Meeting, Their own lunch) and a label
//   When    before school, a period, or after school, with an optional start
//           and end ("7:15 to 7:35")
//   Days    weekdays, day types and dates, said as a sentence that opens its
//           editor in place
//   Where   a room, by the picker, or a place in words
//   Who     teachers, everyone teaching a subject, or all staff; "Nobody yet"
//           in the note colour when it is none
//
// Fields commit when they are left or on Enter. Changing When moves the row
// to its new place, keeps the focus in the field, and says so in the status
// line ("Moved to After school"). Under 640 px each row is a card with its
// lines labelled. The rules are the engine's (engine/actions.js addDuty,
// setDuty, deleteDuty; engine/marks.js dutyTeachers); this file asks and says.

import { h, uid } from '../components/dom.js';
import { field } from '../components/field.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { count, list, periodWords } from '../components/words.js';
import { addDuty, setDuty, deleteDuty } from '../../engine/actions.js';
import { dutyTeachers } from '../../engine/marks.js';
import { dateWords } from '../../engine/calendar.js';
import { formatTime, periodName } from '../../engine/bells.js';
import { dutiesOf, allRooms, findRoom, WEEKDAY_NAMES, DUTY_KINDS, DUTY_LABEL_MOST, DUTY_PLACE_MOST } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { parseClock } from './day.js';
import { fill, apply, button, keyed, emptyState, marksFor, roomLabel, collator, SEVERITY_WORDS } from './common.js';

export const DUTY_WORDS = { duty: 'Duty', meeting: 'Meeting', lunch: 'Their own lunch' };
const WHAT = 'Put bus duty, lunch duty and standing meetings here, and they show on each teacher’s day.';

// ---------------------------------------------------------------- the words

// "Bus duty", or the kind's word when it has no label.
export function dutyName(duty) {
  return duty.label !== '' ? duty.label : DUTY_WORDS[duty.kind];
}

// "Before school 7:15 to 7:35", "Period 5", "After school": the times, when
// there are any, in the school's clock.
export function whenWords(project, duty) {
  const settings = project.settings;
  const base = duty.when === 'before' ? 'Before school' : duty.when === 'after' ? 'After school' : periodName(settings, duty.period);
  const at = (value) => formatTime(value, settings.timeFormat, { suffix: settings.timeFormat !== '24h' });
  if (duty.start !== '' && duty.end !== '') return base + ' ' + at(duty.start) + ' to ' + at(duty.end);
  if (duty.start !== '') return base + ' from ' + at(duty.start);
  if (duty.end !== '') return base + ' until ' + at(duty.end);
  return base;
}

// "1 to 18 December", "1 December to 18 January", "from 1 December",
// "until 18 December": a roster's dates, without a year.
export function datesWords(duty) {
  const from = dateWords(duty.from, { year: false });
  const to = dateWords(duty.to, { year: false });
  if (from !== '' && to !== '') {
    const [fromDay, ...fromMonth] = from.split(' ');
    return fromMonth.join(' ') === to.split(' ').slice(1).join(' ') ? fromDay + ' to ' + to : from + ' to ' + to;
  }
  if (from !== '') return 'from ' + from;
  if (to !== '') return 'until ' + to;
  return '';
}

// "Wednesdays, every day type", "Every day", "Every day on A Day and B Day,
// 1 to 18 December": led by the weekdays when they are set, then the day
// types, then the dates.
export function daysWords(project, duty) {
  const weekdays = duty.weekdays.slice().sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[day] + 's');
  const named = project.dayTypes.filter((dayType) => duty.dayTypeIds.includes(dayType.id)).map((dayType) => dayType.name);
  let words = weekdays.length > 0 ? list(weekdays) : 'Every day';
  if (named.length > 0) words += ' on ' + list(named);
  else if (weekdays.length > 0) words += ', every day type';
  const dates = datesWords(duty);
  return dates === '' ? words : words + ', ' + dates;
}

// Who is on it: "Ms. Okafor and Mr. Vance", "Everyone teaching Science",
// "All staff", or "Nobody yet".
export function whoWords(project, duty) {
  if (duty.everyone) return 'All staff';
  const parts = duty.teacherIds.map((id) => project.teachers.find((teacher) => teacher.id === id)).filter(Boolean).map((teacher) => teacher.name);
  for (const id of duty.subjectIds) {
    const subject = project.subjects.find((candidate) => candidate.id === id);
    if (subject) parts.push('Everyone teaching ' + (subject.name === '' ? subject.code : subject.name));
  }
  return parts.length === 0 ? 'Nobody yet' : list(parts);
}

// Where it is: the room as the picker shows it, else the words, else ''.
export function whereWords(project, duty) {
  const room = duty.roomId ? findRoom(project, duty.roomId) : null;
  return room ? roomLabel(project, room) : duty.place;
}

// The duties in the order the tab lists them: before school, the periods in
// order, after school; within one, the earlier start first, then by name.
export function sortedDuties(project) {
  const slot = (duty) => (duty.when === 'before' ? -1 : duty.when === 'after' ? project.settings.periods + 1 : duty.period);
  return dutiesOf(project).slice().sort((a, b) => slot(a) - slot(b) || collator.compare(a.start, b.start) || collator.compare(dutyName(a), dutyName(b)));
}

// What one duty looks like to a reader, as one line (the tab's label for its
// controls and its toasts): "Bus duty, Before school 7:15 to 7:35".
export function dutySentence(project, duty) {
  return dutyName(duty) + ', ' + whenWords(project, duty);
}

// ---------------------------------------------------------------- the tab

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-duties' });
  // the filter and the row whose days are open: kept while the page is open
  if (view.dutyTeacher === undefined) view.dutyTeacher = '';
  if (view.dutyDays === undefined) view.dutyDays = null;
  // the duty whose "Only these…" is chosen with no day type ticked yet
  if (view.dutyOnly === undefined) view.dutyOnly = null;

  function add(kind) {
    const before = dutiesOf(ctx.store.project).length;
    if (!apply(env, addDuty, { kind })) return;
    const duties = dutiesOf(ctx.store.project);
    if (duties.length === before) return;
    const made = duties[duties.length - 1];
    // a filter on a teacher would hide the new duty, which nobody is on yet
    view.dutyTeacher = '';
    ctx.announce('Added a ' + DUTY_WORDS[kind].toLowerCase() + ', before school. Give it a name and say who is on it.');
    env.render('duty:' + made.id + ':label');
  }

  function remove(duty, order) {
    const project = ctx.store.project;
    const sentence = dutySentence(project, duty);
    if (!apply(env, deleteDuty, { id: duty.id })) return;
    if (view.dutyDays === duty.id) view.dutyDays = null;
    // Undo from the toast brings the row back and the focus with it
    ctx.toast({ text: 'Deleted ' + sentence + '.', action: { label: 'Undo', run: () => {
      env.focusAfter('duty:' + duty.id + ':label');
      ctx.undo();
    } } });
    const left = order.filter((other) => other.id !== duty.id);
    env.render(left.length > 0 ? 'duty:' + left[Math.min(order.indexOf(duty), left.length - 1)].id + ':label' : 'duty-add');
  }

  // A field of text that commits on leave or Enter through setDuty.
  function text(duty, key, name, label, value, build) {
    const control = field({ value, name, commit: (typed) => {
      ctx.store.apply(setDuty, { id: duty.id, ...build(typed) });
    } });
    control.input.setAttribute('aria-label', label + ' of ' + dutyName(duty));
    keyed(control.input, 'duty:' + duty.id + ':' + key);
    return control;
  }

  function clockField(project, duty, which) {
    const control = field({
      value: duty[which],
      name: 'duty' + which,
      format: (value) => (value === '' ? '' : formatTime(value, project.settings.timeFormat, { suffix: false })),
      parse: (typed) => parseClock(typed, project.settings.timeFormat) || '',
      width: '5.5rem',
      commit: (value) => {
        ctx.store.apply(setDuty, { id: duty.id, [which]: value });
      },
    });
    control.input.setAttribute('aria-label', (which === 'start' ? 'Starts' : 'Ends') + ' (optional), ' + dutyName(duty));
    control.input.placeholder = which === 'start' ? 'Start' : 'End';
    keyed(control.input, 'duty:' + duty.id + ':' + which);
    return control;
  }

  // What
  function whatCell(duty) {
    const kind = keyed(h('select', { class: 'field__input', 'aria-label': 'Kind of ' + dutyName(duty) },
      DUTY_KINDS.map((value) => h('option', { value }, DUTY_WORDS[value]))), 'duty:' + duty.id + ':kind');
    kind.value = duty.kind;
    kind.addEventListener('change', () => {
      env.focusAfter('duty:' + duty.id + ':kind');
      apply(env, setDuty, { id: duty.id, kind: kind.value });
    });
    const label = text(duty, 'label', 'dutyLabel', 'Label', duty.label, (typed) => ({ label: typed }));
    label.input.placeholder = DUTY_WORDS[duty.kind];
    label.input.maxLength = DUTY_LABEL_MOST * 2;
    return h('td', { data: { label: 'What' } }, kind, label.element);
  }

  // When
  function whenCell(project, duty) {
    const settings = project.settings;
    const words = periodWords(settings);
    const select = keyed(h('select', { class: 'field__input', 'aria-label': 'When ' + dutyName(duty) + ' is' },
      h('option', { value: 'before' }, 'Before school'),
      Array.from({ length: Math.max(settings.periods, duty.period + 1) }, (_, at) => h('option', { value: 'p' + at }, periodName(settings, at) + (at >= settings.periods ? ' (not in the day)' : ''))),
      h('option', { value: 'after' }, 'After school')), 'duty:' + duty.id + ':when');
    select.value = duty.when === 'period' ? 'p' + duty.period : duty.when;
    select.addEventListener('change', () => {
      env.focusAfter('duty:' + duty.id + ':when');
      const value = select.value;
      const payload = value === 'before' || value === 'after' ? { id: duty.id, when: value } : { id: duty.id, when: 'period', period: Number(value.slice(1)) };
      if (!apply(env, setDuty, payload)) return;
      const next = dutiesOf(ctx.store.project).find((candidate) => candidate.id === duty.id);
      if (next) ctx.announce('Moved to ' + (next.when === 'before' ? 'Before school' : next.when === 'after' ? 'After school' : periodName(ctx.store.project.settings, next.period)) + '.');
    });
    return h('td', { data: { label: 'When' } }, select, h('div', { class: 'sch-duties__times', role: 'group', 'aria-label': 'Times, if the ' + words.one + ' is not the time' }, clockField(project, duty, 'start').element, clockField(project, duty, 'end').element));
  }

  // Days
  function daysEditor(project, duty) {
    const key = (part) => 'duty:' + duty.id + ':' + part;
    const chips = h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Weekdays' }, WEEKDAY_NAMES.map((name, day) => {
      const on = duty.weekdays.includes(day);
      return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(on), on: { click: () => {
        env.focusAfter(key('weekday:' + day));
        apply(env, setDuty, { id: duty.id, weekdays: on ? duty.weekdays.filter((other) => other !== day) : duty.weekdays.concat([day]) });
      } } }, name.slice(0, 3), h('span', { class: 'vh' }, name.slice(3))), key('weekday:' + day));
    }));
    const name = uid('duty-days');
    const some = duty.dayTypeIds.length > 0;
    const waiting = !some && view.dutyOnly === duty.id;
    const every = keyed(h('input', { type: 'radio', name, value: 'all' }), key('days:all'));
    every.checked = !some && !waiting;
    every.addEventListener('change', () => {
      view.dutyOnly = null;
      env.focusAfter(key('days:all'));
      apply(env, setDuty, { id: duty.id, dayTypeIds: [] });
    });
    const only = keyed(h('input', { type: 'radio', name, value: 'some' }), key('days:some'));
    only.checked = some || waiting;
    // "Only these" with nothing ticked would be every day type again: the
    // first tick is what makes it so, so until then the choice is kept here,
    // the radio stays checked and the focus stays on it (an arrow key has
    // put it there, and the next arrow or Tab goes on from it)
    only.addEventListener('change', () => {
      view.dutyOnly = duty.id;
      env.render(key('days:some'));
    });
    const ticks = h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Day types' }, project.dayTypes.map((dayType) => {
      const box = keyed(h('input', { type: 'checkbox' }), key('day:' + dayType.id));
      box.checked = duty.dayTypeIds.includes(dayType.id);
      box.addEventListener('change', () => {
        env.focusAfter(key('day:' + dayType.id));
        apply(env, setDuty, { id: duty.id, dayTypeIds: box.checked ? duty.dayTypeIds.concat([dayType.id]) : duty.dayTypeIds.filter((other) => other !== dayType.id) });
      });
      return h('label', { class: 'sch-radio' }, box, h('span', null, dayType.name));
    }));
    const date = (which, label) => {
      const input = keyed(h('input', { type: 'date', class: 'field__input', 'aria-label': label + ' of ' + dutyName(duty) }), key(which));
      input.value = duty[which];
      input.addEventListener('change', () => {
        env.focusAfter(key(which));
        if (!apply(env, setDuty, { id: duty.id, [which]: input.value })) env.render(key(which));
      });
      return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), input);
    };
    return h('div', { class: 'sch-duties__days', role: 'group', 'aria-label': 'Days of ' + dutyName(duty) },
      h('div', null, h('p', { class: 'sch-markedit__legend' }, 'Weekdays (none is every day)'), chips),
      h('fieldset', { class: 'sch-fieldset' }, h('legend', null, 'Day types'),
        h('label', { class: 'sch-radio' }, every, h('span', null, 'Every day type')),
        h('label', { class: 'sch-radio' }, only, h('span', null, 'Only these…')), ticks,
        waiting ? h('p', { class: 'sch-hint' }, 'Tick a day type. Until one is ticked, this holds on every day type.') : null),
      h('div', { class: 'sch-duties__dates' }, date('from', 'From (optional)'), date('to', 'Until (optional)')),
      button('Done', () => {
        view.dutyDays = null;
        view.dutyOnly = null;
        env.render(key('days'));
      }, { primary: true, small: true, key: key('days-done'), action: 'done-days' }));
  }

  function daysCell(project, duty) {
    const open = view.dutyDays === duty.id;
    const line = keyed(h('button', { type: 'button', class: 'sch-marks__line', 'aria-expanded': String(open), 'aria-label': 'Days of ' + dutyName(duty) + ': ' + daysWords(project, duty), on: { click: () => {
      view.dutyDays = open ? null : duty.id;
      view.dutyOnly = null;
      env.render(open ? 'duty:' + duty.id + ':days' : 'duty:' + duty.id + ':weekday:0');
    } } }, daysWords(project, duty)), 'duty:' + duty.id + ':days');
    return h('td', { data: { label: 'Days' } }, line);
  }

  // Where
  function whereCell(project, duty) {
    const room = duty.roomId ? findRoom(project, duty.roomId) : null;
    const key = (part) => 'duty:' + duty.id + ':' + part;
    if (room) {
      return h('td', { data: { label: 'Where' } }, h('span', { class: 'chip' }, h('span', null, roomLabel(project, room)), keyed(h('button', {
        type: 'button',
        class: 'chip__remove',
        'aria-label': 'Take ' + roomName(room) + ' off ' + dutyName(duty),
        on: { click: () => {
          env.focusAfter(key('room'));
          apply(env, setDuty, { id: duty.id, roomId: null });
        } },
      }, icon('close', 14)), key('room-remove'))));
    }
    const choose = picker({
      placeholder: 'Choose a room',
      listLabel: 'Rooms',
      emptyText: allRooms(project).length === 0 ? 'No rooms yet. Draw them in the Building section.' : 'No room matches.',
      options: () => allRooms(ctx.store.project).slice().sort((a, b) => collator.compare(a.number, b.number)).map((each) => ({ id: each.id, label: roomLabel(ctx.store.project, each) })),
      onPick: (option) => {
        env.focusAfter(key('room-remove'));
        apply(env, setDuty, { id: duty.id, roomId: option.id, place: '' });
      },
    });
    choose.input.setAttribute('aria-label', 'Room for ' + dutyName(duty));
    keyed(choose.input, key('room'));
    const place = text(duty, 'place', 'dutyPlace', 'Place', duty.place, (typed) => ({ place: typed }));
    place.input.placeholder = 'or a place, such as Bus loop';
    place.input.maxLength = DUTY_PLACE_MOST * 2;
    return h('td', { data: { label: 'Where' } }, choose.element, place.element);
  }

  // Who
  function whoCell(project, duty) {
    const key = (part) => 'duty:' + duty.id + ':' + part;
    const chip = (words, id, run, remove) => h('span', { class: 'chip', data: { who: id } }, h('span', null, words), keyed(h('button', {
      type: 'button',
      class: 'chip__remove',
      'aria-label': 'Take ' + words + ' off ' + dutyName(duty),
      on: { click: () => {
        env.focusAfter(key('who'));
        run();
      } },
    }, icon('close', 14)), key('who-' + remove)));
    const chips = [];
    if (duty.everyone) chips.push(chip('All staff', 'everyone', () => apply(env, setDuty, { id: duty.id, everyone: false }), 'everyone'));
    for (const id of duty.teacherIds) {
      const teacher = project.teachers.find((candidate) => candidate.id === id);
      if (teacher) chips.push(chip(teacher.name, id, () => apply(env, setDuty, { id: duty.id, teacherIds: duty.teacherIds.filter((other) => other !== id) }), id));
    }
    for (const id of duty.subjectIds) {
      const subject = project.subjects.find((candidate) => candidate.id === id);
      if (subject) chips.push(chip('Everyone teaching ' + (subject.name === '' ? subject.code : subject.name), id, () => apply(env, setDuty, { id: duty.id, subjectIds: duty.subjectIds.filter((other) => other !== id) }), id));
    }
    const nobody = dutyTeachers(project, duty).length === 0;
    const add = picker({
      placeholder: chips.length === 0 ? 'Add a teacher' : 'Add another',
      listLabel: 'Who is on it',
      emptyText: 'No teacher or subject matches.',
      options: () => {
        const now = ctx.store.project;
        const options = [];
        if (!duty.everyone) options.push({ id: 'everyone', label: 'All staff' });
        for (const teacher of now.teachers) if (!duty.teacherIds.includes(teacher.id)) options.push({ id: 't:' + teacher.id, label: teacher.name });
        for (const subject of now.subjects) if (!duty.subjectIds.includes(subject.id)) options.push({ id: 's:' + subject.id, label: 'Everyone teaching ' + (subject.name === '' ? subject.code : subject.name) });
        return options;
      },
      onPick: (option) => {
        env.focusAfter(key('who'));
        if (option.id === 'everyone') apply(env, setDuty, { id: duty.id, everyone: true });
        else if (option.id.startsWith('t:')) apply(env, setDuty, { id: duty.id, teacherIds: duty.teacherIds.concat([option.id.slice(2)]) });
        else apply(env, setDuty, { id: duty.id, subjectIds: duty.subjectIds.concat([option.id.slice(2)]) });
      },
    });
    add.input.setAttribute('aria-label', 'Add a teacher or a subject to ' + dutyName(duty));
    keyed(add.input, key('who'));
    return h('td', { data: { label: 'Who' } },
      nobody ? h('p', { class: 'sch-duties__nobody' }, 'Nobody yet') : null,
      chips.length > 0 ? h('div', { class: 'chips' }, chips) : null,
      add.element);
  }

  function row(project, model, duty, order) {
    const found = model.byDuty.get(duty.id) || [];
    const open = view.dutyDays === duty.id;
    const main = h('tr', { data: { duty: duty.id, open: open ? 'true' : null } },
      whatCell(duty), whenCell(project, duty), daysCell(project, duty), whereCell(project, duty), whoCell(project, duty),
      h('td', { class: 'sch-duties__marks', data: { label: 'Checks' } }, found.length > 0 ? marksFor(found) : null),
      h('td', { class: 'sch-duties__delete' }, button('Delete', () => remove(duty, order), { small: true, key: 'duty:' + duty.id + ':delete', action: 'delete', more: ' ' + dutyName(duty) })));
    // what the checks say about it, a line each, in a row of its own under it
    const says = found.length === 0 ? null : h('tr', { class: 'sch-duties__findrow', data: { findingsOf: duty.id } }, h('td', { colspan: '7' },
      found.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--' + finding.severity, data: { finding: finding.id } }, h('span', { class: 'sch-finding-line__word' }, SEVERITY_WORDS[finding.severity].glyph + ' ' + finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1) + ': '), finding.text))));
    const days = open ? h('tr', { class: 'sch-duties__editrow', data: { daysOf: duty.id } }, h('td', { colspan: '7' }, daysEditor(project, duty))) : null;
    return [main, says, days];
  }

  function draw(project) {
    const model = env.model();
    const byDuty = new Map();
    for (const finding of model.findings) {
      if (finding.kind !== 'duty-clash' && finding.kind !== 'duty-nobody') continue;
      const id = finding.id.split(':').pop();
      if (!byDuty.has(id)) byDuty.set(id, []);
      byDuty.get(id).push(finding);
    }
    const seen = { byDuty };
    const addDutyButton = button('Add a duty', () => add('duty'), { primary: true, key: 'duty-add', action: 'add-duty' });
    if (dutiesOf(project).length === 0) {
      fill(element, emptyState('No duties or meetings yet. ' + WHAT, h('div', { class: 'sch-toolbar' }, addDutyButton, button('Add a meeting', () => add('meeting'), { key: 'meeting-add', action: 'add-meeting' })), 'duties'));
      return;
    }
    if (view.dutyTeacher !== '' && !project.teachers.some((teacher) => teacher.id === view.dutyTeacher)) view.dutyTeacher = '';
    const filter = keyed(h('select', { class: 'field__input', 'aria-label': 'Show the duties of' },
      h('option', { value: '' }, 'Everyone'),
      project.teachers.map((teacher) => h('option', { value: teacher.id }, teacher.name))), 'duty-filter');
    filter.value = view.dutyTeacher;
    filter.addEventListener('change', () => {
      view.dutyTeacher = filter.value;
      env.render('duty-filter');
    });
    const order = sortedDuties(project);
    const shown = view.dutyTeacher === '' ? order : order.filter((duty) => dutyTeachers(project, duty).includes(view.dutyTeacher));
    fill(element,
      h('p', { class: 'sch-lead' }, 'This project has ' + count(order.length, 'duty or meeting', 'duties and meetings') + '. ' + WHAT),
      h('div', { class: 'sch-toolbar' }, addDutyButton, button('Add a meeting', () => add('meeting'), { key: 'meeting-add', action: 'add-meeting' }),
        h('label', { class: 'sch-duties__filter' }, h('span', null, 'Show'), filter)),
      shown.length === 0
        ? h('p', { class: 'sch-marks__empty' }, 'No duty or meeting has this teacher on it.')
        : h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-edit-table sch-duties__table' },
          h('caption', { class: 'vh' }, 'Duties and meetings'),
          h('thead', null, h('tr', null, ['What', 'When', 'Days', 'Where', 'Who', 'Checks'].map((label) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Delete')))),
          h('tbody', null, shown.map((duty) => row(project, seen, duty, order))))));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
