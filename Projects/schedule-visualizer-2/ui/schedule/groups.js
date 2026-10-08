// The Groups tab: the list of groups on the left, and on the right the group
// editor, with the day types side by side and one row per period.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { picker } from '../components/picker.js';
import { openMenu } from '../components/menu.js';
import { icon } from '../components/icons.js';
import { count, periodWords } from '../components/words.js';
import { addGroup, editGroup, duplicateGroup, deleteGroup, setSlot, moveSlot, copyDay, makeOwnCopy } from '../../engine/actions.js';
import { effectiveSchedule, isOwnCopy, baseDayType } from '../../engine/day-types.js';
import { bellsFor, periodName, formatTime } from '../../engine/bells.js';
import { allRooms, resolveSlotRoom, GROUP_COLOUR_PRESETS, RANGES } from '../../engine/schema.js';
import { NOT_IN_BUILDING } from '../../engine/exports.js';
import { fill, apply, button, keyed, emptyState, marksFor, freeName, roomLabel, quote, collator, dragRows, grip, SEVERITY_WORDS } from './common.js';
import { slotKey } from './model.js';
import { roomPicker } from './room-picker.js';

const WHAT = 'A group is a set of students who travel together all day.';

function filled(slot) {
  return slot.room !== null || slot.roomText !== '';
}

function slotIsEmpty(slot) {
  return !filled(slot) && slot.label === '' && slot.teacherIds.length === 0;
}

function matches(group, filter) {
  const wanted = filter.trim().toLowerCase();
  return wanted === '' || group.name.toLowerCase().includes(wanted) || group.grade.toLowerCase().includes(wanted);
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-groups' });

  function select(groupId, focusKey) {
    view.groupId = groupId;
    view.shown = null;
    env.render(focusKey);
  }

  function add() {
    const project = ctx.store.project;
    if (!apply(env, addGroup, { name: freeName(project.groups.map((group) => group.name), 'New group') })) return;
    const groups = ctx.store.project.groups;
    view.filter = '';
    select(groups[groups.length - 1].id, 'group-name');
  }

  // ------------------------------------------------------------ the list

  // The button's name for a screen reader is what is in it: the shapes and
  // the short figures are for the eye, and each has its words beside it.
  function listItem(project, model, group, selected) {
    const words = periodWords(project.settings);
    const periods = project.settings.periods;
    const base = baseDayType(project);
    const seen = (text) => h('span', { 'aria-hidden': 'true' }, text);
    const said = (text) => h('span', { class: 'vh' }, text);
    const bars = project.dayTypes.map((dayType) => {
      if (!isOwnCopy(project, dayType.id)) {
        return h('span', { class: 'sch-bar sch-bar--same' }, h('span', { class: 'sch-bar__text' }, seen(dayType.name + ' = ' + base.name), said(dayType.name + ': same as ' + base.name + '. ')));
      }
      const done = effectiveSchedule(project, group.id, dayType.id).filter(filled).length;
      return h('span', { class: 'sch-bar', data: { day: dayType.id, done: String(done) } },
        h('span', { class: 'sch-bar__track' }, h('span', { class: 'sch-bar__fill', style: 'width:' + Math.round((100 * done) / periods) + '%' })),
        h('span', { class: 'sch-bar__text' }, seen(dayType.name + ' ' + done + '/' + periods), said(dayType.name + ': ' + done + ' of ' + count(periods, words.one, words.many) + ' have a room. ')));
    });
    const found = model.byGroup.get(group.id) || [];
    return h('li', null, keyed(h('button', {
      type: 'button',
      class: 'sch-group',
      'aria-current': selected ? 'true' : null,
      data: { group: group.id },
      on: { click: () => select(group.id, 'group:' + group.id) },
    },
    h('span', { class: 'sch-group__top' },
      h('span', { class: 'sch-dot', style: 'background:' + group.colour }),
      h('span', { class: 'sch-group__name' }, group.name),
      group.grade === '' ? said('. ') : h('span', { class: 'sch-group__grade' }, said(', grade '), group.grade, said('. ')),
      h('span', { class: 'sch-group__marks' }, marksFor(found))),
    h('span', { class: 'sch-group__bars' }, bars)), 'group:' + group.id));
  }

  // ------------------------------------------------------------ the editor

  function colourControl(group) {
    const labelId = uid('colour');
    const name = uid('swatch');
    const custom = keyed(h('input', { type: 'color', class: 'sch-colour__custom', 'aria-label': 'Another colour for ' + group.name, title: 'Another colour', value: group.colour }), 'group-colour');
    custom.addEventListener('change', () => apply(env, editGroup, { id: group.id, colour: custom.value }));
    // radio buttons: one Tab stop, and the arrow keys move through the presets
    const swatches = GROUP_COLOUR_PRESETS.map((colour, index) => {
      const radio = keyed(h('input', { type: 'radio', class: 'sch-swatch__input', name, value: colour }), 'swatch:' + index);
      radio.checked = colour.toLowerCase() === group.colour.toLowerCase();
      radio.addEventListener('change', () => {
        if (radio.checked) apply(env, editGroup, { id: group.id, colour });
      });
      return h('label', { class: 'sch-swatch', style: 'background:' + colour, title: colour }, radio, h('span', { class: 'vh' }, 'Preset ' + (index + 1) + ', ' + colour));
    });
    return h('div', { class: 'field sch-colour' },
      h('span', { class: 'field__label', id: labelId }, 'Colour'),
      h('div', { class: 'sch-colour__row' }, h('div', { class: 'sch-colour__presets', role: 'radiogroup', 'aria-labelledby': labelId }, swatches), custom));
  }

  function headFields(project, group) {
    const name = field({ label: 'Name', value: group.name, name: 'groupName', commit: (value) => {
      ctx.store.apply(editGroup, { id: group.id, name: value });
    } });
    keyed(name.input, 'group-name');
    const grade = field({ label: 'Grade', value: group.grade, name: 'groupGrade', width: '6rem', commit: (value) => {
      ctx.store.apply(editGroup, { id: group.id, grade: value });
    } });
    keyed(grade.input, 'group-grade');
    const whole = wholeNumber('A head count');
    const head = field({
      label: 'Head count',
      value: group.headCount,
      name: 'groupHeadCount',
      width: '6rem',
      inputMode: 'numeric',
      placeholder: String(project.settings.defaultHeadCount),
      format: (value) => (value === null ? '' : String(value)),
      parse: (text) => (text.trim() === '' ? null : whole(text)),
      commit: (value) => {
        ctx.store.apply(editGroup, { id: group.id, headCount: value });
      },
    });
    keyed(head.input, 'group-head');
    head.input.title = 'From ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + '. Left empty, the group counts as ' + project.settings.defaultHeadCount + ', the school’s usual.';
    return h('div', { class: 'sch-editor__fields' }, name.element, grade.element, head.element, colourControl(group));
  }

  function roomOptions(project, model, slot) {
    const rooms = allRooms(project).slice().sort((a, b) => collator.compare(a.number, b.number));
    const options = rooms.map((room) => {
      const subject = project.subjects.find((candidate) => candidate.id === room.subjectId);
      const found = model.byRoom.get(room.id) || [];
      const detail = [subject ? subject.code || subject.name : null, found.length > 0 ? count(found.length, 'finding') : null].filter(Boolean).join(' · ');
      return { id: room.id, number: room.number, label: roomLabel(project, room), detail };
    });
    return filled(slot) ? [{ id: null, number: '', label: 'No room', detail: '' }].concat(options) : options;
  }

  function slotRow(project, model, group, dayType, period, slot, bell) {
    const settings = project.settings;
    const pName = periodName(settings, period);
    const at = pName + ' on ' + dayType.name;
    const keyBase = 'slot:' + dayType.id + ':' + period + ':';
    const change = (patch) => ctx.store.apply(setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: patch });
    const resolved = resolveSlotRoom(project, slot);
    const text = resolved.room ? roomLabel(project, resolved.room) : resolved.missing && resolved.text !== '' ? resolved.text + ' · ' + NOT_IN_BUILDING : '';

    const found = model.bySlot.get(slotKey(group.id, dayType.id, period)) || [];
    const findingsId = found.length > 0 ? uid('slot-findings') : null;
    const room = roomPicker({
      name: 'Room for ' + at,
      key: keyBase + 'room',
      text,
      describedBy: findingsId,
      options: () => roomOptions(ctx.store.project, env.model(), slot),
      onPick: (roomId) => {
        try {
          change({ room: roomId });
        } catch (error) {
          ctx.toast({ kind: 'problem', text: error.message });
        }
      },
    });
    if (resolved.missing && resolved.text !== '') room.input.classList.add('sch-room--missing');

    const label = field({ value: slot.label, name: 'slotLabel', placeholder: 'Label', commit: (value) => {
      change({ label: value });
    } });
    label.input.setAttribute('aria-label', 'Label for ' + at);
    keyed(label.input, keyBase + 'label');

    const implied = resolved.room ? resolved.room.teacherIds.map((id) => (project.teachers.find((teacher) => teacher.id === id) || { name: '' }).name).filter(Boolean) : [];
    const teacher = picker({
      placeholder: slot.teacherIds.length > 0 ? 'Add another' : implied.length > 0 ? implied.join(', ') : 'Teacher',
      listLabel: 'Teachers',
      emptyText: project.teachers.length === 0 ? 'No teachers yet. Add them in the Teachers tab.' : 'No teacher matches.',
      options: () => ctx.store.project.teachers.filter((candidate) => !slot.teacherIds.includes(candidate.id)).map((candidate) => ({ id: candidate.id, label: candidate.name })),
      onPick: (option) => {
        env.focusAfter(keyBase + 'teacher');
        apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { teacherIds: slot.teacherIds.concat([option.id]) } });
      },
    });
    teacher.input.setAttribute('aria-label', 'Teacher for ' + at + (implied.length > 0 && slot.teacherIds.length === 0 ? '. Left empty, it is the room’s: ' + implied.join(', ') : ''));
    keyed(teacher.input, keyBase + 'teacher');
    const chips = slot.teacherIds.map((id) => {
      const name = (project.teachers.find((candidate) => candidate.id === id) || { name: '' }).name;
      return h('span', { class: 'chip' }, h('span', null, name), keyed(h('button', {
        type: 'button',
        class: 'chip__remove',
        'aria-label': 'Take ' + name + ' off ' + at,
        on: { click: () => {
          env.focusAfter(keyBase + 'teacher');
          apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { teacherIds: slot.teacherIds.filter((other) => other !== id) } });
        } },
      }, icon('close', 14)), keyBase + 'chip:' + id));
    });

    const move = (to) => {
      if (!apply(env, moveSlot, { groupId: group.id, dayTypeId: dayType.id, from: period, to })) return;
      ctx.announce('Moved ' + pName + '’s assignment to ' + periodName(settings, to) + '. The two traded places.');
      env.render('slot:' + dayType.id + ':' + to + ':menu');
    };
    const menu = keyed(h('button', {
      type: 'button',
      class: 'icon-btn sch-slot__menu',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Move or clear ' + at,
      title: 'Move or clear ' + at,
      on: { click: () => openMenu({
        label: at,
        anchor: menu,
        items: [
          { label: 'Move up', disabled: period === 0, run: () => move(period - 1) },
          { label: 'Move down', disabled: period === settings.periods - 1, run: () => move(period + 1) },
          'separator',
          { label: 'Clear this ' + periodWords(settings).one, disabled: slotIsEmpty(slot), run: () => apply(env, setSlot, { groupId: group.id, dayTypeId: dayType.id, period, slot: { room: null, label: '', teacherIds: [] } }) },
        ],
      }) },
    }, '⋯'), keyBase + 'menu');

    const shown = view.shown && view.shown.groupId === group.id && view.shown.dayTypeId === dayType.id && view.shown.period === period;
    const time = bell.start && bell.end ? formatTime(bell.start, settings.timeFormat, { suffix: false }) + '–' + formatTime(bell.end, settings.timeFormat) : '';
    return h('tr', { class: 'sch-slot', data: { index: String(period), period: String(period), shown: shown ? 'true' : null } },
      h('th', { scope: 'row', class: 'sch-slot__period' }, grip(), h('span', { class: 'sch-slot__name' }, pName), time === '' ? null : h('span', { class: 'sch-slot__time' }, time)),
      h('td', { class: 'sch-slot__room' }, room.element,
        h('div', { class: 'sch-slot__extra' }, label.element, h('div', { class: 'sch-slot__teacher' }, chips.length > 0 ? h('div', { class: 'chips' }, chips) : null, teacher.element)),
        found.length > 0 ? h('div', { id: findingsId, class: 'sch-slot__findings' }, found.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--' + finding.severity, data: { finding: finding.id } },
          h('span', { class: 'sch-finding-line__word' }, SEVERITY_WORDS[finding.severity].glyph + ' ' + finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1) + ': '), finding.text))) : null),
      h('td', { class: 'sch-slot__more' }, menu));
  }

  function dayColumn(project, model, group, dayType) {
    const base = baseDayType(project);
    const words = periodWords(project.settings);
    const titleId = uid('day');
    const bells = bellsFor(project, dayType.id);
    const day = effectiveSchedule(project, group.id, dayType.id);
    if (!isOwnCopy(project, dayType.id)) {
      return h('section', { class: 'sch-day sch-day--same', 'aria-labelledby': titleId, data: { day: dayType.id } },
        h('h3', { class: 'sch-day__title', id: titleId }, dayType.name + ': same as ' + base.name),
        h('p', { class: 'sch-day__line' }, 'Whatever ' + base.name + ' holds, ' + dayType.name + ' holds too. ',
          button('Make its own copy', () => apply(env, makeOwnCopy, { dayTypeId: dayType.id }), { small: true, key: 'own:' + dayType.id, action: 'make-own', more: ': ' + dayType.name })),
        h('table', { class: 'table sch-slots sch-slots--same' },
          h('caption', { class: 'vh' }, group.name + ' on ' + dayType.name + ', the same as ' + base.name),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, words.One), h('th', { scope: 'col' }, 'Room'))),
          h('tbody', null, day.map((slot, period) => {
            const resolved = resolveSlotRoom(project, slot);
            return h('tr', null, h('th', { scope: 'row' }, periodName(project.settings, period)),
              h('td', null, resolved.room ? roomLabel(project, resolved.room) : resolved.text !== '' ? resolved.text + ' · ' + NOT_IN_BUILDING : '—'));
          }))));
    }
    const body = h('tbody', null, day.map((slot, period) => slotRow(project, model, group, dayType, period, slot, bells[period])));
    dragRows(body, (from, to) => {
      if (apply(env, moveSlot, { groupId: group.id, dayTypeId: dayType.id, from, to })) ctx.announce('Moved ' + periodName(project.settings, from) + '’s assignment to ' + periodName(project.settings, to) + '.');
    });
    const whole = model.byDay.get(group.id + '|' + dayType.id) || [];
    return h('section', { class: 'sch-day', 'aria-labelledby': titleId, data: { day: dayType.id } },
      h('div', { class: 'sch-day__head' },
        h('h3', { class: 'sch-day__title', id: titleId }, dayType.name),
        dayType === base ? null : button('Copy ' + base.name + ' to ' + dayType.name, () => {
          if (apply(env, copyDay, { fromDayTypeId: base.id, toDayTypeId: dayType.id, groupId: group.id })) ctx.toast({ text: 'Copied ' + group.name + '’s ' + base.name + ' to ' + dayType.name + '.', action: { label: 'Undo', run: ctx.undo } });
        }, { small: true, key: 'copy:' + dayType.id, action: 'copy-day' })),
      whole.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--' + finding.severity }, finding.text)),
      h('table', { class: 'table sch-slots' },
        h('caption', { class: 'vh' }, group.name + ' on ' + dayType.name),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', class: 'sch-slots__period' }, words.One), h('th', { scope: 'col' }, 'Room', h('span', { class: 'vh' }, ', then a label and a teacher if needed')), h('th', { scope: 'col', class: 'sch-slots__more' }, h('span', { class: 'vh' }, 'Move')))),
        body));
  }

  function editor(project, model, group) {
    const titleId = uid('editor');
    const index = project.groups.indexOf(group);
    return h('section', { class: 'sch-editor', 'aria-labelledby': titleId, data: { group: group.id } },
      h('div', { class: 'sch-editor__head' },
        h('h2', { class: 'sch-editor__title', id: titleId }, h('span', { class: 'sch-dot', style: 'background:' + group.colour }), group.name),
        h('div', { class: 'sch-editor__actions' },
          button('Duplicate', () => {
            if (!apply(env, duplicateGroup, { id: group.id })) return;
            select(ctx.store.project.groups[index + 1].id, 'group-name');
          }, { small: true, key: 'group-duplicate', action: 'duplicate', more: ' ' + group.name }),
          button('Delete', () => {
            if (!apply(env, deleteGroup, { id: group.id })) return;
            const left = ctx.store.project.groups;
            ctx.toast({ text: 'Deleted group ' + group.name + '.', action: { label: 'Undo', run: ctx.undo } });
            const next = left[Math.min(index, left.length - 1)];
            select(next ? next.id : null, next ? 'group:' + next.id : 'group-add');
          }, { small: true, key: 'group-delete', action: 'delete', more: ' ' + group.name }))),
      headFields(project, group),
      h('div', { class: 'sch-days' }, project.dayTypes.map((dayType) => dayColumn(project, model, group, dayType))));
  }

  // ------------------------------------------------------------ drawing

  function draw(project) {
    const model = env.model();
    if (project.groups.length === 0) {
      view.groupId = null;
      fill(element, emptyState('No groups yet. ' + WHAT, button('Add a group', add, { primary: true, key: 'group-add', action: 'add-group' })));
      return;
    }
    if (!project.groups.some((group) => group.id === view.groupId)) view.groupId = project.groups[0].id;
    const selected = project.groups.find((group) => group.id === view.groupId);
    const visible = project.groups.filter((group) => matches(group, view.filter));
    const filter = keyed(h('input', { type: 'search', class: 'field__input', placeholder: 'Filter by name or grade', 'aria-label': 'Filter groups by name or grade', autocomplete: 'off', spellcheck: 'false' }), 'group-filter');
    filter.value = view.filter;
    filter.addEventListener('input', () => {
      view.filter = filter.value;
      env.render('group-filter');
    });
    const old = element.querySelector('.sch-groups__list');
    const scroll = old ? old.scrollTop : 0;
    const list = h('ul', { class: 'sch-groups__list' }, visible.map((group) => listItem(project, model, group, group === selected)));
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' Each has a name, and a room for every ' + periodWords(project.settings).one + '.'),
      h('div', { class: 'sch-groups__cols' },
        h('div', { class: 'sch-groups__side' },
          button('Add a group', add, { primary: true, key: 'group-add', action: 'add-group' }),
          filter,
          h('p', { class: 'sch-groups__tally', 'aria-live': 'polite' }, view.filter.trim() === '' ? count(project.groups.length, 'group') + '.' : visible.length === 0 ? 'No group matches ' + quote(view.filter.trim()) + '.' : visible.length + ' of ' + count(project.groups.length, 'group') + '.'),
          list),
        editor(project, model, selected)));
    list.scrollTop = scroll;
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
