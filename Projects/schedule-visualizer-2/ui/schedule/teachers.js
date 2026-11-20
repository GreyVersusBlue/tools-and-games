// The Teachers tab: the list of teachers as a table that is edited in place.
// Names that look like the same person are flagged, with a button to merge
// them.

import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { count } from '../components/words.js';
import { addTeacher, editTeacher, deleteTeacher, mergeTeachers, findNearDuplicateTeachers } from '../../engine/actions.js';
import { allRooms, findRoom, dutiesOf, WEEKDAY_NAMES } from '../../engine/schema.js';
import { setTeacherAway, describeAway } from '../../engine/w7-actions.js';
import { periodName } from '../../engine/bells.js';
import { dutyTeachers } from '../../engine/marks.js';
import { roomName } from '../../engine/findings.js';
import { buildExport } from '../../engine/exports.js';
import { printButtons } from '../prints/index.js';
import { printButton, openPrintPreview } from '../components/print-preview.js';
import { fill, apply, button, keyed, emptyState, marksFor, freeName, deletedText, quote, collator, download } from './common.js';

const WHAT = 'A teacher is a named member of staff, with a subject and one or more rooms.';

// ---------------------------------------------------------------- part-time
// DESIGN 16.6 and 16.12 item 4. A teacher's `away` entries are edited in a
// disclosure under the row. "Only in school on…" writes the complement of the
// weekdays ticked as one entry; "Not in school…" is the full form, one entry
// at a time, committed with Done (one undo step each).

const SHORT_DAYS = WEEKDAY_NAMES.map((name) => name.slice(0, 3));
const SCHOOL_DAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// A weekdays-only entry: the shape "Only in school on…" writes and reads back.
function isWeekdayEntry(entry) {
  return entry.weekdays.length > 0 && entry.dayTypeIds.length === 0 && entry.periods.length === 0;
}

function awayList(teacher) {
  return (Array.isArray(teacher.away) ? teacher.away : []).map((entry) => ({
    dayTypeIds: Array.isArray(entry.dayTypeIds) ? entry.dayTypeIds : [],
    weekdays: Array.isArray(entry.weekdays) ? entry.weekdays : [],
    periods: Array.isArray(entry.periods) ? entry.periods : [],
  }));
}

function listOf(names) {
  return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// The words on the column's button: "Full-time", "Not in Thu, Fri", or the
// entry's own words for anything with day types or periods.
export function partTimeWords(project, teacher) {
  const list = awayList(teacher);
  if (list.length === 0) return 'Full-time';
  return list.map((entry) => (isWeekdayEntry(entry)
    ? 'Not in ' + entry.weekdays.slice().sort((a, b) => a - b).map((day) => SHORT_DAYS[day]).join(', ')
    : describeAway(project, entry) || 'Not in school')).join('; ');
}

// What the editor changes, in a sentence with the name in it (16.6, 16.12).
function consequence(teacher, list) {
  // a node can sit in one place only: each use makes its own
  const name = () => h('bdi', null, teacher.name);
  const parts = [];
  if (list.some((entry) => !isWeekdayEntry(entry))) parts.push(h('span', null, name(), ' will not be counted as free in these periods, and a class with ', name(), ' then is flagged. '));
  const days = list.filter(isWeekdayEntry);
  if (days.length > 0) {
    const named = Array.from(new Set(days.flatMap((entry) => entry.weekdays))).sort((a, b) => a - b).map((day) => WEEKDAY_NAMES[day] + 's');
    parts.push(h('span', null, 'Day-type views list this as a note; the staff browser leaves ', name(), ' out on ' + listOf(named) + ' by the calendar.'));
  }
  if (parts.length === 0) parts.push(h('span', null, name(), ' is in school at every time the schedule has.'));
  return parts;
}

// "Mon/Wed only", "Tuesdays and Thursdays": the weekdays a note names, when
// they read as part-time days. Days after "not", "off" or "except" are the
// days away; otherwise they are the days in school.
const DAY_WORDS = [['mon', 0], ['tue', 1], ['wed', 2], ['thu', 3], ['fri', 4]];
export function noteDays(notes) {
  const found = [];
  for (const match of String(notes).toLowerCase().matchAll(/\b(mon|tue|wed|thu|fri)[a-z]*\b/g)) {
    const day = DAY_WORDS.find(([word]) => word === match[1])[1];
    if (!found.includes(day)) found.push(day);
  }
  if (found.length === 0 || found.length === SCHOOL_DAYS.length) return null;
  const away = /\b(not|off|except|away|out)\b/i.test(notes);
  const inSchool = away ? SCHOOL_DAYS.filter((day) => !found.includes(day)) : found;
  return inSchool.length === 0 ? null : inSchool.sort((a, b) => a - b);
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-teachers' });

  function add() {
    const project = ctx.store.project;
    if (!apply(env, addTeacher, { name: freeName(project.teachers.map((teacher) => teacher.name), 'New teacher') })) return;
    const teachers = ctx.store.project.teachers;
    env.render('teacher:' + teachers[teachers.length - 1].id + ':name');
  }

  function exportCsv() {
    const file = buildExport(ctx.store.project, 'teachers', { date: ctx.clock() });
    download(file.fileName, file.mime, file.text);
    ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
  }

  function duplicates(project) {
    return findNearDuplicateTeachers(project).map((same) => {
      const keep = same[0];
      return h('div', { class: 'sch-flag', role: 'group', 'aria-label': 'Names that look alike', data: { duplicate: keep.id } },
        h('p', null, same.map((teacher) => quote(teacher.name)).join(' and ') + ' look like the same teacher. Merging keeps one name and moves every room and ' + 'assignment to it.'),
        h('div', { class: 'sch-flag__actions' }, same.slice(1).map((gone) => button('Merge into ' + quote(keep.name), () => {
          if (!apply(env, mergeTeachers, { keepId: keep.id, mergeId: gone.id })) return;
          ctx.toast({ text: 'Merged ' + gone.name + ' into ' + keep.name + '.', action: { label: 'Undo', run: ctx.undo } });
          env.render('teacher:' + keep.id + ':name');
        }, { small: true, key: 'merge:' + gone.id, action: 'merge', more: ', and drop ' + quote(gone.name) }))));
    });
  }

  if (view.part === undefined) view.part = null;
  if (!(view.noteOffers instanceof Set)) view.noteOffers = new Set();

  // ---- Part-time: the button, the disclosure under the row
  const partKey = (teacher, part) => 'teacher:' + teacher.id + ':part:' + part;
  const blankDraft = () => ({ onlyTypes: false, dayTypeIds: [], weekdays: [], periods: [], more: false });
  const draftOf = (entry) => ({ onlyTypes: entry.dayTypeIds.length > 0, dayTypeIds: entry.dayTypeIds.slice(), weekdays: entry.weekdays.slice(), periods: entry.periods.slice(), more: entry.weekdays.some((day) => day >= 5) });
  const stateOf = (teacher) => (view.part && view.part.teacherId === teacher.id ? view.part : null);

  // Commit a whole list of entries, or say why not, without a toast: the
  // refusal is shown under the controls (16.12 item 4). Returns the sentence,
  // or null when it was done.
  function tryAway(teacher, away) {
    try {
      ctx.store.apply(setTeacherAway, { teacherId: teacher.id, away });
      return null;
    } catch (error) {
      return error && error.message ? error.message : 'That could not be done. Try again.';
    }
  }

  function openPart(teacher, mode) {
    const list = awayList(teacher);
    const only = list.length === 0 || (list.length === 1 && isWeekdayEntry(list[0]));
    view.part = { teacherId: teacher.id, mode: mode || (only ? 'only' : 'not'), editing: null, draft: null, refusal: '', more: list.some((entry) => entry.weekdays.some((day) => day >= 5)) };
    env.render(partKey(teacher, 'radio:' + view.part.mode));
  }

  function closePart(teacher) {
    const fresh = ctx.store.project.teachers.find((each) => each.id === teacher.id);
    view.part = null;
    if (fresh) ctx.announce(fresh.name + ': ' + partTimeWords(ctx.store.project, fresh) + '.');
    env.render(partKey(teacher, 'button'));
  }

  function partButton(project, teacher) {
    const open = Boolean(stateOf(teacher));
    const words = partTimeWords(project, teacher);
    return keyed(h('button', { type: 'button', class: 'sch-marks__line sch-part__button', 'aria-expanded': String(open), 'aria-controls': 'sch-part-' + teacher.id, data: { part: teacher.id, action: 'part-time' }, on: { click: () => {
      if (open) closePart(teacher);
      else openPart(teacher);
    } } }, words, h('span', { class: 'vh' }, ' for ' + teacher.name + ', times in school')), partKey(teacher, 'button'));
  }

  // "Only in school on…": the weekdays ticked are the days in school and the
  // others are written as one entry of days away.
  function onlyEditor(project, teacher, st) {
    const list = awayList(teacher);
    const stored = list.length === 1 && isWeekdayEntry(list[0]) ? list[0] : null;
    const days = (st.more || (stored && stored.weekdays.some((day) => day >= 5))) ? ALL_DAYS : SCHOOL_DAYS;
    const inSchool = stored ? days.filter((day) => !stored.weekdays.includes(day)) : days.slice();
    const replaces = !stored && list.length > 0;
    const chips = days.map((day) => {
      const on = inSchool.includes(day);
      return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(on), data: { day: String(day) }, on: { click: () => {
        const next = on ? inSchool.filter((other) => other !== day) : inSchool.concat([day]);
        const away = days.filter((other) => !next.includes(other));
        env.focusAfter(partKey(teacher, 'day:' + day));
        // nobody is in school on no day: the engine's own refusal says so
        const refused = tryAway(teacher, next.length === 0 ? [{ dayTypeIds: [], weekdays: ALL_DAYS, periods: [] }] : away.length === 0 ? [] : [{ dayTypeIds: [], weekdays: away, periods: [] }]);
        st.refusal = refused || '';
        if (refused) env.render(partKey(teacher, 'day:' + day));
      } } }, SHORT_DAYS[day], h('span', { class: 'vh' }, WEEKDAY_NAMES[day].slice(3))), partKey(teacher, 'day:' + day));
    });
    return h('div', { class: 'sch-part__only' },
      h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Days ' + teacher.name + ' is in school' }, chips,
        days === ALL_DAYS ? null : keyed(h('button', { type: 'button', class: 'sch-show__chip', on: { click: () => {
          st.more = true;
          env.render(partKey(teacher, 'day:5'));
        } } }, 'More'), partKey(teacher, 'more'))),
      replaces ? h('p', { class: 'sch-hint' }, 'Choosing days here replaces the times set under Not in school.') : null);
  }

  // One entry of "Not in school…", as a form on a draft.
  function entryForm(project, teacher, st, index) {
    const draft = st.draft;
    const key = (part) => partKey(teacher, 'e' + index + ':' + part);
    const redraw = (focus) => env.render(focus);
    const radios = 'part-types-' + teacher.id + '-' + index;
    const every = keyed(h('input', { type: 'radio', name: radios, value: 'all' }), key('types:all'));
    every.checked = !draft.onlyTypes;
    every.addEventListener('change', () => {
      draft.onlyTypes = false;
      draft.dayTypeIds = [];
      redraw(key('types:all'));
    });
    const only = keyed(h('input', { type: 'radio', name: radios, value: 'some' }), key('types:some'));
    only.checked = draft.onlyTypes;
    only.addEventListener('change', () => {
      draft.onlyTypes = true;
      redraw(key('types:some'));
    });
    const ticks = draft.onlyTypes ? h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Day types' }, project.dayTypes.map((dayType) => {
      const box = keyed(h('input', { type: 'checkbox' }), key('type:' + dayType.id));
      box.checked = draft.dayTypeIds.includes(dayType.id);
      box.addEventListener('change', () => {
        draft.dayTypeIds = box.checked ? draft.dayTypeIds.concat([dayType.id]) : draft.dayTypeIds.filter((other) => other !== dayType.id);
        redraw(key('type:' + dayType.id));
      });
      return h('label', { class: 'sch-radio' }, box, h('span', null, dayType.name));
    })) : null;
    const days = draft.more || draft.weekdays.some((day) => day >= 5) ? ALL_DAYS : SCHOOL_DAYS;
    const dayChips = h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Days of the week' }, days.map((day) => {
      const on = draft.weekdays.includes(day);
      return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(on), on: { click: () => {
        draft.weekdays = on ? draft.weekdays.filter((other) => other !== day) : draft.weekdays.concat([day]);
        redraw(key('day:' + day));
      } } }, SHORT_DAYS[day], h('span', { class: 'vh' }, WEEKDAY_NAMES[day].slice(3))), key('day:' + day));
    }), days === ALL_DAYS ? null : keyed(h('button', { type: 'button', class: 'sch-show__chip', on: { click: () => {
      draft.more = true;
      redraw(key('day:5'));
    } } }, 'More'), key('more')));
    const periodChips = h('div', { class: 'sch-duties__chips', role: 'group', 'aria-label': 'Periods' }, Array.from({ length: project.settings.periods }, (_, period) => {
      const on = draft.periods.includes(period);
      return keyed(h('button', { type: 'button', class: 'sch-show__chip', 'aria-pressed': String(on), on: { click: () => {
        draft.periods = on ? draft.periods.filter((other) => other !== period) : draft.periods.concat([period]);
        redraw(key('period:' + period));
      } } }, periodName(project.settings, period)), key('period:' + period));
    }));
    const list = awayList(teacher);
    const done = () => {
      const entry = { dayTypeIds: draft.onlyTypes ? draft.dayTypeIds : [], weekdays: draft.weekdays.slice().sort((a, b) => a - b), periods: draft.periods.slice().sort((a, b) => a - b) };
      const next = list.slice();
      next[index] = entry;
      const refused = tryAway(teacher, next);
      if (refused) {
        st.refusal = refused;
        redraw(key('done'));
        return;
      }
      st.editing = null;
      st.draft = null;
      st.refusal = '';
      env.render(partKey(teacher, 'edit:' + Math.min(index, ctx.store.project.teachers.find((each) => each.id === teacher.id).away.length - 1)));
    };
    const cancel = () => {
      st.editing = null;
      st.draft = null;
      st.refusal = '';
      // with nothing saved, there is nothing to go back to under Not in school
      if (list.length === 0) st.mode = 'only';
      env.render(partKey(teacher, list.length === 0 ? 'radio:only' : 'edit:' + Math.min(index, list.length - 1)));
    };
    return h('div', { class: 'sch-part__entry', role: 'group', 'aria-label': 'Entry ' + (index + 1) + ' for ' + teacher.name, data: { entry: String(index) } },
      h('fieldset', { class: 'sch-fieldset' }, h('legend', null, 'When'),
        h('label', { class: 'sch-radio' }, every, h('span', null, 'Every day type')),
        h('label', { class: 'sch-radio' }, only, h('span', null, 'Only these…')), ticks,
        draft.onlyTypes && draft.dayTypeIds.length === 0 ? h('p', { class: 'sch-hint' }, 'Tick a day type. Until one is ticked, this holds on every day type.') : null),
      h('div', null, h('p', { class: 'sch-markedit__legend' }, 'Days of the week (none is every day)'), dayChips),
      h('div', null, h('p', { class: 'sch-markedit__legend' }, 'Periods (none is the whole day)'), periodChips),
      st.refusal ? h('p', { class: 'field__refusal', role: 'alert', data: { refusal: 'part' } }, st.refusal) : null,
      h('div', { class: 'sch-part__actions' },
        button('Done', done, { primary: true, small: true, key: key('done'), action: 'part-done' }),
        button('Cancel', cancel, { small: true, key: key('cancel'), action: 'part-cancel' })));
  }

  function notEditor(project, teacher, st) {
    const list = awayList(teacher);
    // nothing saved yet: the first entry is open to fill in
    if (st.editing === null && list.length === 0) {
      st.editing = 0;
      st.draft = blankDraft();
    }
    const rows = list.map((entry, index) => {
      if (st.editing === index) return entryForm(project, teacher, st, index);
      const words = describeAway(project, entry) || 'Not in school';
      return h('div', { class: 'sch-part__saved', data: { entry: String(index) } },
        h('span', { class: 'sch-part__words' }, h('bdi', null, words)),
        button('Edit', () => {
          st.editing = index;
          st.draft = draftOf(entry);
          st.refusal = '';
          env.render(partKey(teacher, 'e' + index + ':types:' + (st.draft.onlyTypes ? 'some' : 'all')));
        }, { small: true, key: partKey(teacher, 'edit:' + index), action: 'part-edit', more: ' entry ' + (index + 1) + ' for ' + teacher.name }),
        button('Remove', () => {
          const next = list.filter((_, at) => at !== index);
          const refused = tryAway(teacher, next);
          if (refused) {
            st.refusal = refused;
            env.render(partKey(teacher, 'remove:' + index));
            return;
          }
          st.refusal = '';
          env.render(partKey(teacher, next.length === 0 ? 'radio:not' : 'edit:' + Math.min(index, next.length - 1)));
        }, { small: true, key: partKey(teacher, 'remove:' + index), action: 'part-remove', more: ' entry ' + (index + 1) + ' for ' + teacher.name }));
    });
    if (st.editing !== null && st.editing >= list.length) rows.push(entryForm(project, teacher, st, st.editing));
    const most = list.length >= 12;
    const adding = st.editing !== null && st.editing >= list.length;
    return h('div', { class: 'sch-part__not' }, rows,
      adding ? null : h('div', { class: 'sch-part__actions' }, button('Add another time', () => {
        st.editing = list.length;
        st.draft = blankDraft();
        st.refusal = '';
        env.render(partKey(teacher, 'e' + list.length + ':types:all'));
      }, { small: true, key: partKey(teacher, 'add'), action: 'part-add', more: ' for ' + teacher.name })),
      most ? h('p', { class: 'sch-hint' }, 'A teacher has at most 12 times. Combine some to add another.') : null);
  }

  function partEditor(project, teacher, st) {
    const name = 'part-mode-' + teacher.id;
    const radio = (value, label) => {
      const input = keyed(h('input', { type: 'radio', name, value }), partKey(teacher, 'radio:' + value));
      input.checked = st.mode === value;
      input.addEventListener('change', () => {
        st.mode = value;
        st.editing = null;
        st.draft = null;
        st.refusal = '';
        env.render(partKey(teacher, 'radio:' + value));
      });
      return h('label', { class: 'sch-radio' }, input, h('span', null, label));
    };
    const list = awayList(teacher);
    return h('div', { class: 'sch-part', id: 'sch-part-' + teacher.id, role: 'group', 'aria-label': 'Part-time times for ' + teacher.name, on: { keydown: (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest('.picker')) {
        event.preventDefault();
        closePart(teacher);
      }
    } } },
      h('fieldset', { class: 'sch-fieldset' }, h('legend', null, 'When is ', h('bdi', null, teacher.name), ' in school?'),
        radio('only', 'Only in school on…'), radio('not', 'Not in school…')),
      st.mode === 'only' ? onlyEditor(project, teacher, st) : notEditor(project, teacher, st),
      st.mode === 'only' && st.refusal ? h('p', { class: 'field__refusal', role: 'alert', data: { refusal: 'part' } }, st.refusal) : null,
      h('p', { class: 'sch-part__says', data: { says: 'part' } }, consequence(teacher, list)),
      h('p', { class: 'sch-hint' }, 'Shown in the staff browser.'),
      h('div', { class: 'sch-part__actions' }, button('Close', () => closePart(teacher), { small: true, key: partKey(teacher, 'close'), action: 'part-close' })));
  }

  // Notes that name weekdays are offered once as part-time days (16.12 item 4).
  function offerFromNotes(teacher, text) {
    const days = noteDays(text);
    const fresh = ctx.store.project.teachers.find((each) => each.id === teacher.id);
    const once = teacher.id + '\n' + text;
    if (!days || !fresh || awayList(fresh).length > 0 || view.noteOffers.has(once)) return;
    view.noteOffers.add(once);
    const said = text.trim().length > 40 ? text.trim().slice(0, 40) + '…' : text.trim();
    ctx.toast({ text: 'Notes say ‘' + said + '’. Set it as part-time?', action: { label: 'Set as part-time', run: () => {
      const away = SCHOOL_DAYS.filter((day) => !days.includes(day));
      if (away.length > 0 && tryAway(fresh, [{ dayTypeIds: [], weekdays: away, periods: [] }]) === null) openPart(fresh, 'only');
    } } });
  }

  function row(project, model, teacher, alike, dutyCounts) {
    const key = 'teacher:' + teacher.id + ':';
    const name = field({ value: teacher.name, name: 'teacherName', commit: (value) => {
      ctx.store.apply(editTeacher, { id: teacher.id, name: value });
    } });
    name.input.setAttribute('aria-label', 'Name');
    keyed(name.input, key + 'name');

    const subject = keyed(h('select', { class: 'field__input', 'aria-label': 'Subject of ' + teacher.name },
      h('option', { value: '' }, 'No subject'),
      project.subjects.map((each) => h('option', { value: each.id }, each.name === '' ? each.code : each.name))), key + 'subject');
    subject.value = teacher.subjectId === null ? '' : teacher.subjectId;
    subject.addEventListener('change', () => apply(env, editTeacher, { id: teacher.id, subjectId: subject.value === '' ? null : subject.value }));

    const rooms = teacher.roomIds.map((id) => findRoom(project, id)).filter(Boolean);
    const addRoom = picker({
      placeholder: rooms.length === 0 ? 'Add a room' : 'Add another',
      listLabel: 'Rooms',
      emptyText: allRooms(project).length === 0 ? 'No rooms yet. Draw them in the Building section.' : 'No room matches.',
      options: () => allRooms(ctx.store.project).filter((room) => !teacher.roomIds.includes(room.id)).sort((a, b) => collator.compare(a.number, b.number))
        .map((room) => ({ id: room.id, label: room.number.trim() === '' ? roomName(room) : room.number })),
      onPick: (option) => {
        env.focusAfter(key + 'room');
        apply(env, editTeacher, { id: teacher.id, roomIds: teacher.roomIds.concat([option.id]) });
      },
    });
    addRoom.input.setAttribute('aria-label', 'Add a room for ' + teacher.name);
    keyed(addRoom.input, key + 'room');

    const notes = field({ value: teacher.notes, name: 'teacherNotes', commit: (value) => {
      ctx.store.apply(editTeacher, { id: teacher.id, notes: value });
      offerFromNotes(teacher, value);
    } });
    notes.input.setAttribute('aria-label', 'Notes on ' + teacher.name);
    keyed(notes.input, key + 'notes');

    const found = model.byTeacher.get(teacher.id) || [];
    const st = stateOf(teacher);
    const main = h('tr', { data: { teacher: teacher.id, shown: view.shown && view.shown.teacherId === teacher.id ? 'true' : null } },
      h('td', { class: 'sch-teachers__name' }, name.element,
        alike ? h('p', { class: 'sch-finding-line sch-finding-line--warning' }, 'Looks like another name in the list.') : null,
        found.length > 0 ? h('p', { class: 'sch-teachers__marks' }, marksFor(found)) : null),
      h('td', null, subject),
      h('td', null,
        rooms.length > 0 ? h('div', { class: 'chips' }, rooms.map((room) => h('span', { class: 'chip' }, h('span', null, room.number.trim() === '' ? roomName(room) : room.number), keyed(h('button', {
          type: 'button',
          class: 'chip__remove',
          'aria-label': 'Take ' + roomName(room) + ' from ' + teacher.name,
          on: { click: () => {
            env.focusAfter(key + 'room');
            apply(env, editTeacher, { id: teacher.id, roomIds: teacher.roomIds.filter((id) => id !== room.id) });
          } },
        }, icon('close', 14)), key + 'chip:' + room.id)))) : null,
        addRoom.element),
      h('td', null, notes.element),
      h('td', { class: 'sch-teachers__part', data: { label: 'Part-time' } }, partButton(project, teacher)),
      h('td', { class: 'sch-teachers__duties' }, duties(teacher, dutyCounts.get(teacher.id) || 0)),
      h('td', null, button('Route sheet', (opener) => openPrintPreview(ctx, 'route-sheet', { teacherId: teacher.id, opener }), { small: true, key: key + 'route-sheet', action: 'route-sheet', more: ' for ' + teacher.name }), button('Delete', () => {
        const index = project.teachers.indexOf(teacher);
        if (!apply(env, deleteTeacher, { id: teacher.id })) return;
        ctx.toast({ text: deletedText(ctx.store.undoOutcome, 'teacher ', teacher.name), action: { label: 'Undo', run: ctx.undo } });
        const left = ctx.store.project.teachers;
        const next = left[Math.min(index, left.length - 1)];
        env.render(next ? 'teacher:' + next.id + ':name' : 'teacher-add');
      }, { small: true, key: key + 'delete', action: 'delete', more: ' ' + teacher.name })));
    return st ? [main, h('tr', { class: 'sch-part-row', data: { partEditor: teacher.id } }, h('td', { colspan: '7' }, h('div', { class: 'sch-part__wrap' }, partEditor(project, teacher, st))))] : [main];
  }

  // The Duties column: how many duties and meetings the teacher is on, a link
  // to the Duties tab with that teacher chosen (DESIGN 11.5).
  function duties(teacher, n) {
    if (n === 0) return h('span', { class: 'sch-teachers__none' }, 'None');
    return h('a', { href: '#schedule/duties', data: { teacherDuties: teacher.id }, on: { click: () => {
      view.dutyTeacher = teacher.id;
    } } }, count(n, 'duty or meeting', 'duties and meetings'), h('span', { class: 'vh' }, ' for ' + teacher.name));
  }

  function draw(project) {
    if (view.part && !project.teachers.some((teacher) => teacher.id === view.part.teacherId)) view.part = null;
    const model = env.model();
    const dutyCounts = new Map();
    for (const duty of dutiesOf(project)) for (const id of dutyTeachers(project, duty)) dutyCounts.set(id, (dutyCounts.get(id) || 0) + 1);
    const addButton = button('Add a teacher', add, { primary: true, key: 'teacher-add', action: 'add-teacher' });
    if (project.teachers.length === 0) {
      fill(element, emptyState('No teachers yet. ' + WHAT.slice(0, -1) + ', and this is the list of them. Add the first teacher to begin.', addButton, 'teachers'));
      return;
    }
    const alike = new Set(findNearDuplicateTeachers(project).flat().map((teacher) => teacher.id));
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' This project has ' + count(project.teachers.length, 'teacher') + '.'),
      h('div', { class: 'sch-toolbar' },
        addButton,
        button('Export CSV', exportCsv, { key: 'teacher-export', action: 'export', more: ' of the teachers' }),
        h('a', { class: 'btn', href: '#schedule/import', data: { action: 'import', key: 'teacher-import' } }, 'Import CSV…', h('span', { class: 'vh' }, ' of teachers, on the Import tab')),
        keyed(printButton(ctx, printButtons.find((entry) => entry.id === 'print-teachers')), 'teacher-print')),
      duplicates(project),
      h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-edit-table' },
        h('caption', { class: 'vh' }, 'Teachers'),
        h('thead', null, h('tr', null, ['Name', 'Subject', 'Rooms', 'Notes', 'Part-time', 'Duties'].map((label) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Delete')))),
        h('tbody', null, project.teachers.flatMap((teacher) => row(project, model, teacher, alike.has(teacher.id), dutyCounts))))));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
