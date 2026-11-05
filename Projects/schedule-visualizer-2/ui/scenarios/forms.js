// "Add a change" (spec 9.1, DESIGN 5.4, 12.4): the kinds of change a
// scenario holds, each as a form, one open at a time under the fieldset
// "Kind of change". Move a group's room for a period on a day type; swap two
// of a group's periods; swap two groups' rooms for a period (changes); Bell
// times, Staggered dismissal, and Capacity and head counts (levers,
// ARCHITECTURE 18.3), and Stairs and corridors (a stair's way by select and four
// choices; a corridor by name, or picked on the lab's map, which the section
// does: env.pick*). The Staggered
// dismissal form uses the Day tab's editor (ui/schedule/release.js), imported.
// The day types offered are those that are their own copy, with the ones
// that follow them named ("A Day (B Day is the same)"). The room is picked
// with the schedule's own room picker (ui/schedule/room-picker.js, used as
// it is). Under each form, what the change will say as a chip, and that
// teachers follow rooms when it changes who teaches.
//
// formsPanel(env) -> { element, update(project) }
//   env.ctx, env.memory (the lab's memory: memory.form), env.add(change) and
//   env.addLever(lever) (true when added; they say what happened),
//   env.pickStart() / env.pickStop(refocus) / env.picking(): the lab's map in
//   picking mode, for "Pick on the map"
//   focusKinds() puts the focus on the Kind of change fieldset
//   focusPick() puts the focus on "Pick on the map" (after a pick, or Cancel)

import { h } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { roomPicker } from '../schedule/room-picker.js';
import { roomLabel } from '../schedule/common.js';
import { allRooms } from '../../engine/schema.js';
import { changeWords } from '../../engine/scenario.js';
import { field } from '../components/field.js';
import { releaseEditor, releaseDraftOf, releasePayload, releaseMissing, releaseSentence, syncReleaseDraft } from '../schedule/release.js';
import { parseClock } from '../schedule/day.js';
import { releaseOf } from '../../engine/schema.js';
import { periodName, formatTime } from '../../engine/bells.js';
import { periodWords } from '../components/words.js';
import { wayChoices } from '../building/inspector/floor.js';
import { dayChoices, periodChoices, groupChoices, slotWords, TEACHERS_FOLLOW, bellSets, bellLever, realBellOf, bellPassingWords, lengthenPassing, connectionChoices, corridorChoices, corridorLever } from './model.js';

export const FORM_KINDS = [
  { value: 'move', label: 'Move a group' },
  { value: 'swapPeriods', label: 'Swap two periods' },
  { value: 'swapRooms', label: 'Swap two groups’ rooms' },
  { value: 'bells', label: 'Bell times' },
  { value: 'release', label: 'Staggered dismissal' },
  { value: 'building', label: 'Stairs and corridors' },
  { value: 'seats', label: 'Capacity and head counts' },
];

// What a capacity or a head count is, said once under the form.
export const SEATS_MOVE = 'Capacity changes findings (a group larger than its room); head count changes crowding, walking times and findings.';
const MINUTES = [1, 2, 5];

// What each form starts with, and what the lab keeps of it while the page is open.
export function freshForm() {
  return {
    kind: 'move',
    move: { groupId: null, dayTypeId: null, period: 0, roomId: null },
    swapPeriods: { groupId: null, dayTypeId: null, periodA: 0, periodB: 1 },
    swapRooms: { groupA: null, groupB: null, dayTypeId: null, period: 0 },
    // times as "HH:MM", or '' where there are none yet
    bells: { setId: null, period: 0, start: '', end: '', lengthened: '' },
    release: releaseDraftOf(null),
    // a stair (a connection and the way it is given) or a corridor (a named one, or picked on the map)
    building: { what: 'stair', connectionId: null, way: 'both', corridorId: null, seeded: '' },
    // capacity and headCount: a whole number, or null for "none set" / "the school's default"
    seats: { what: 'capacity', roomId: null, capacity: null, groupId: null, headCount: null, seeded: '' },
  };
}

// A form's values made good for the project as it is: a group, a day type
// or a period gone is replaced by the first there is.
function settle(project, form) {
  const groups = project.groups.map((group) => group.id);
  const days = dayChoices(project).map((day) => day.value);
  const periods = project.settings.periods;
  const group = (id, other) => (groups.includes(id) ? id : groups.find((each) => each !== other) || groups[0] || null);
  const day = (id) => (days.includes(id) ? id : days[0] || null);
  const period = (p, fallback) => (Number.isInteger(p) && p >= 0 && p < periods ? p : Math.min(fallback, Math.max(0, periods - 1)));
  const rooms = new Set(allRooms(project).map((room) => room.id));
  form.move.groupId = group(form.move.groupId);
  form.move.dayTypeId = day(form.move.dayTypeId);
  form.move.period = period(form.move.period, 0);
  if (!rooms.has(form.move.roomId)) form.move.roomId = null;
  form.swapPeriods.groupId = group(form.swapPeriods.groupId);
  form.swapPeriods.dayTypeId = day(form.swapPeriods.dayTypeId);
  form.swapPeriods.periodA = period(form.swapPeriods.periodA, 0);
  form.swapPeriods.periodB = period(form.swapPeriods.periodB, 1);
  form.swapRooms.groupA = group(form.swapRooms.groupA);
  form.swapRooms.groupB = group(form.swapRooms.groupB, form.swapRooms.groupA);
  form.swapRooms.dayTypeId = day(form.swapRooms.dayTypeId);
  form.swapRooms.period = period(form.swapRooms.period, 0);
  // the new kinds: a set of bells, a room or a group gone is replaced by the first there is
  const sets = bellSets(project);
  if (!sets.some((each) => each.value === form.bells.setId)) {
    form.bells.setId = sets[0] ? sets[0].value : null;
    form.bells.start = '';
    form.bells.end = '';
  }
  form.bells.period = period(form.bells.period, 0);
  if (form.bells.start === '' && form.bells.end === '') seedBells(project, form.bells);
  const roomIds = allRooms(project).map((room) => room.id);
  if (!roomIds.includes(form.seats.roomId)) form.seats.roomId = sortedRooms(project)[0] ? sortedRooms(project)[0].id : null;
  form.seats.groupId = group(form.seats.groupId);
  seedSeats(project, form.seats);
  const connections = connectionChoices(project);
  if (!connections.some((each) => each.value === form.building.connectionId)) form.building.connectionId = connections[0] ? connections[0].value : null;
  const corridors = corridorChoices(project);
  if (!corridors.some((each) => each.value === form.building.corridorId)) form.building.corridorId = corridors[0] ? corridors[0].value : null;
  seedWay(project, form.building);
}

// A stairs connection chosen: the way starts from the one it has.
function seedWay(project, building) {
  const key = String(building.connectionId);
  if (building.seeded === key) return;
  building.seeded = key;
  const connection = (project.building.connections || []).find((each) => each.id === building.connectionId);
  building.way = connection ? connection.direction : 'both';
}

// A set of bells and a period chosen: the form starts from the times the
// real schedule has there, so a change is a change to them.
function seedBells(project, bells) {
  const set = bellSets(project).find((each) => each.value === bells.setId);
  const real = realBellOf(project, set, bells.period);
  bells.start = real ? real.start : '';
  bells.end = real ? real.end : '';
}

// A room or a group chosen: the field starts from what is there.
function seedSeats(project, seats) {
  const key = seats.what + ':' + seats.roomId + ':' + seats.groupId;
  if (seats.seeded === key) return;
  seats.seeded = key;
  const room = allRooms(project).find((each) => each.id === seats.roomId);
  const group = project.groups.find((each) => each.id === seats.groupId);
  seats.capacity = room && Number.isInteger(room.capacity) ? room.capacity : null;
  seats.headCount = group && Number.isInteger(group.headCount) ? group.headCount : null;
}

// The change a form stands for ({ change }), or the lever it stands for
// ({ lever }), or { why } when it is not one yet.
export function formChange(form, project) {
  if (form.kind === 'bells') return project ? bellLever(project, form.bells) : { why: 'There is no day type or bell schedule to change.' };
  if (form.kind === 'release') {
    const missing = releaseMissing(form.release);
    return missing === '' ? { lever: { kind: 'release', ...releasePayload(form.release) } } : { why: missing };
  }
  if (form.kind === 'building') {
    const f = form.building;
    if (f.what === 'stair') return f.connectionId ? { lever: { kind: 'way', connectionId: f.connectionId, way: f.way } } : { why: 'There are no stairs to change.' };
    const lever = project ? corridorLever(project, f.corridorId) : null;
    return lever ? { lever } : { why: 'There is no named corridor to close. Pick one on the map.' };
  }
  if (form.kind === 'seats') {
    const f = form.seats;
    if (f.what === 'capacity') return f.roomId ? { lever: { kind: 'capacity', roomId: f.roomId, capacity: f.capacity } } : { why: 'There is no room to change.' };
    return f.groupId ? { lever: { kind: 'headCount', groupId: f.groupId, headCount: f.headCount } } : { why: 'There is no group to change.' };
  }
  if (form.kind === 'move') {
    const f = form.move;
    if (!f.groupId || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
    if (!f.roomId) return { why: 'Pick the room to move to.' };
    return { change: { kind: 'move', dayTypeId: f.dayTypeId, groupId: f.groupId, period: f.period, roomId: f.roomId } };
  }
  if (form.kind === 'swapPeriods') {
    const f = form.swapPeriods;
    if (!f.groupId || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
    if (f.periodA === f.periodB) return { why: 'Pick two different ' + (form.periodWord || 'period').toLowerCase() + 's.' };
    return { change: { kind: 'swapPeriods', dayTypeId: f.dayTypeId, groupId: f.groupId, periodA: f.periodA, periodB: f.periodB } };
  }
  const f = form.swapRooms;
  if (!f.groupA || !f.groupB || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
  if (f.groupA === f.groupB) return { why: 'Pick two different groups.' };
  return { change: { kind: 'swapRooms', dayTypeId: f.dayTypeId, groupA: f.groupA, groupB: f.groupB, period: f.period } };
}

// The building's rooms in the picker's order: by number, numbers read as numbers.
export function sortedRooms(project) {
  return allRooms(project).slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

function partsToNodes(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

export function formsPanel(env) {
  const ctx = env.ctx;
  const memory = env.memory;
  const kinds = choice({
    name: 'scenario-kind',
    labelledBy: 'scenario-kind-legend',
    value: memory.form.kind,
    options: FORM_KINDS,
    onChange(value) {
      memory.form.kind = value;
      // another kind chosen while the map is picking: picking ends, the focus stays on the chips
      if (env.picking && env.picking()) env.pickStop(false);
      draw(ctx.store.project, true);
    },
  });
  const title = h('h2', { class: 'scn-panel__title', id: 'scenario-add-title' }, 'Add a change');
  const kindSet = h('fieldset', { class: 'scn-kind', data: { part: 'kinds' } }, h('legend', { class: 'scn-kind__legend', id: 'scenario-kind-legend' }, 'Kind of change'), kinds.element);
  const body = h('div', { class: 'scn-form', data: { part: 'form' } });
  const element = h('section', { class: 'scn-add', 'aria-labelledby': 'scenario-add-title' }, title, kindSet, body);

  // the form's parts that follow its values without being drawn again
  let now = null;
  let preview = null;
  let follow = null;
  let line = null;
  let passing = null;
  let lengthen = null;
  let addButton = null;
  let startField = null;
  let endField = null;
  let drawnKey = '';

  const select = (id, label, options, value, onChange) => {
    const input = h('select', { class: 'field__input', id, data: { key: id } },
      options.map((option) => h('option', { value: option.value }, option.label)));
    input.value = value === null || value === undefined ? '' : String(value);
    input.addEventListener('change', () => onChange(input.value));
    return h('div', { class: 'field scn-field' }, h('label', { class: 'field__label', for: id }, label), input);
  };

  // what the slots hold now, and what the chip will say
  function follows() {
    const project = ctx.store.project;
    const form = memory.form;
    now.replaceChildren();
    if (form.kind === 'move') {
      const f = form.move;
      now.textContent = f.groupId && f.dayTypeId ? 'Now: ' + slotWords(project, f.dayTypeId, f.groupId, f.period) + '.' : '';
    } else if (form.kind === 'swapPeriods') {
      const f = form.swapPeriods;
      const periods = periodChoices(project);
      now.textContent = f.groupId && f.dayTypeId ? 'Now: ' + periods[f.periodA].label + ', ' + slotWords(project, f.dayTypeId, f.groupId, f.periodA) + '; ' + periods[f.periodB].label + ', ' + slotWords(project, f.dayTypeId, f.groupId, f.periodB) + '.' : '';
    } else if (form.kind === 'swapRooms') {
      const f = form.swapRooms;
      const name = (id) => (project.groups.find((group) => group.id === id) || { name: '' }).name;
      now.replaceChildren(...(f.groupA && f.groupB && f.dayTypeId ? ['Now: ', h('bdi', null, name(f.groupA)), ', ' + slotWords(project, f.dayTypeId, f.groupA, f.period) + '; ', h('bdi', null, name(f.groupB)), ', ' + slotWords(project, f.dayTypeId, f.groupB, f.period) + '.'] : []));
    } else if (form.kind === 'bells') {
      const set = bellSets(project).find((each) => each.value === form.bells.setId);
      const real = realBellOf(project, set, form.bells.period);
      const text = (time) => formatTime(time, project.settings.timeFormat);
      now.textContent = set ? 'Now: ' + periodName(project.settings, form.bells.period) + ', ' + (real ? text(real.start) + ' to ' + text(real.end) : 'no times') + '.' : '';
    }
    else if (form.kind === 'building' && form.building.what === 'stair') {
      const connection = (project.building.connections || []).find((each) => each.id === form.building.connectionId);
      const has = connection ? wayChoices(project, connection).find((each) => each.value === connection.direction) : null;
      now.textContent = has ? 'Now: ' + has.label + '.' : '';
    }
    const made = formChange(form, project);
    const said = made.change ? changeWords(project, made.change) : made.lever ? changeWords(project, made.lever) : null;
    if (said) {
      preview.replaceChildren('The change: ', ...partsToNodes(said.parts));
      follow.hidden = !made.change || said.teachers.length === 0;
    } else {
      preview.replaceChildren();
      follow.hidden = true;
    }
    if (form.kind === 'bells' && passing) {
      const set = bellSets(project).find((each) => each.value === form.bells.setId);
      passing.textContent = set ? bellPassingWords(project, set, form.bells.period, made.lever || null) : '';
    }
    if (addButton && form.kind === 'release') addButton.disabled = releaseMissing(form.release) !== '';
  }

  function add() {
    const project = ctx.store.project;
    const made = formChange(memory.form, project);
    if (!made.change && !made.lever) {
      line.textContent = made.why;
      return;
    }
    line.textContent = '';
    const added = made.change ? env.add(made.change) : env.addLever(made.lever);
    if (added) follows();
  }

  // drawn again with the focus on the control `key` names
  function redraw(key) {
    draw(ctx.store.project, false);
    if (key) {
      const back = body.querySelector('[data-key="' + key + '"]');
      if (back) back.focus();
    }
  }

  // ---- Bell times (spec 9.1; DESIGN 12.4)
  function bellsFields(project) {
    const f = memory.form.bells;
    const sets = bellSets(project);
    const periods = periodChoices(project);
    const word = periodWords(project.settings).One;
    const hasSchedules = sets.some((each) => each.kind === 'bells');
    const fields = [];
    const choose = (key, value) => {
      f[key] = value;
      f.start = '';
      f.end = '';
      f.lengthened = '';
      seedBells(ctx.store.project, f);
      redraw('scenario-bells-' + (key === 'setId' ? 'set' : 'period'));
    };
    fields.push(select('scenario-bells-set', hasSchedules ? 'Day type or bell schedule' : 'Day type', sets, f.setId, (value) => choose('setId', value)));
    fields.push(select('scenario-bells-period', word, periods, f.period, (value) => choose('period', Number(value))));
    const timeFormat = project.settings.timeFormat;
    const one = (which, label) => {
      const control = field({
        value: f[which] === '' ? null : f[which],
        id: 'scenario-bells-' + which,
        label,
        name: 'scenarioBell' + which,
        width: '100%',
        placeholder: timeFormat === '24h' ? '08:05' : '8:05',
        format: (time) => (time ? formatTime(time, timeFormat) : ''),
        parse: (text) => parseClock(text, timeFormat),
        commit: (time) => {
          f[which] = time || '';
          f.lengthened = '';
          lengthen.textContent = '';
          line.textContent = '';
          follows();
        },
      });
      control.element.classList.add('scn-field');
      control.input.dataset.key = 'scenario-bells-' + which;
      return control;
    };
    startField = one('start', 'Starts');
    endField = one('end', 'Ends');
    fields.push(startField.element, endField.element);
    return fields;
  }

  function bellsExtras(project) {
    const f = memory.form.bells;
    const name = periodName(project.settings, f.period);
    passing = h('p', { class: 'scn-form__passing', 'aria-live': 'polite', data: { part: 'passing' } });
    lengthen = h('p', { class: 'scn-form__lengthen', 'aria-live': 'polite', data: { part: 'lengthen' } }, f.lengthened);
    const first = f.period < 1;
    const row = h('div', { class: 'scn-lengthen', role: 'group', 'aria-label': 'Lengthen the passing time before ' + name, data: { part: 'lengthen-row' } },
      h('span', { class: 'scn-lengthen__label' }, 'Lengthen passing before ' + name + ' by'),
      MINUTES.map((minutes) => h('button', {
        type: 'button',
        class: 'btn scn-lengthen__button',
        disabled: first,
        'aria-label': 'Lengthen passing before ' + name + ' by ' + minutes + ' min',
        data: { key: 'scenario-lengthen-' + minutes, minutes: String(minutes) },
        on: { click: () => lengthenBy(minutes) },
      }, minutes + ' min')));
    return [passing, row, lengthen];
  }

  function lengthenBy(minutes) {
    const project = ctx.store.project;
    const f = memory.form.bells;
    const set = bellSets(project).find((each) => each.value === f.setId);
    const made = lengthenPassing(project, set, f.period, f, minutes);
    if (made.why) {
      lengthen.textContent = made.why;
      return;
    }
    f.start = made.start;
    f.end = made.end;
    f.lengthened = made.sentence;
    startField.set(made.start);
    endField.set(made.end);
    lengthen.textContent = made.sentence;
    line.textContent = '';
    follows();
  }

  // ---- Staggered dismissal (spec 8.2 and 9.1): the Day tab's editor, imported
  function releaseBody(project) {
    const draft = memory.form.release;
    const real = releaseOf(project);
    const inForce = h('section', { class: 'scn-force', 'aria-labelledby': 'scenario-force-title', data: { part: 'in-force' } },
      h('h3', { class: 'scn-force__title', id: 'scenario-force-title' }, 'Already in force'),
      real.length === 0
        ? h('p', { class: 'scn-force__none' }, 'No staggered dismissal is in force.')
        : h('ul', { class: 'scn-force__list' }, real.map((entry) => h('li', { dir: 'auto', data: { release: entry.id } }, releaseSentence(project, entry, entry.id)))));
    const trial = h('p', { class: 'scn-form__trial' }, 'A trial: it counts here, and becomes real only if you Apply');
    const editor = releaseEditor({
      project,
      draft,
      key: (part) => 'scenario-release:' + part,
      announce: ctx.announce,
      buildingHref: '#building',
      change(patch, key) {
        const next = { ...draft, ...patch };
        // a kind chosen from the groups entry's "On the bell" leaves a time the other kinds can use
        if (patch.kind !== undefined && patch.kind !== 'groups') next.onBell = false;
        Object.assign(draft, next, { note: '' });
        line.textContent = '';
        if (key === null) {
          // a typed field keeps the focus it has
          follows();
        } else {
          redraw(key);
        }
      },
    });
    return [inForce, trial, editor.element];
  }

  // ---- Capacity and head counts
  function seatsBody(project) {
    const f = memory.form.seats;
    const what = choice({
      name: 'scenario-seats-what',
      labelledBy: 'scenario-seats-legend',
      value: f.what,
      options: [{ value: 'capacity', label: 'A room’s capacity' }, { value: 'headCount', label: 'A group’s head count' }],
      onChange(value) {
        f.what = value;
        f.seeded = '';
        seedSeats(ctx.store.project, f);
        redraw('scenario-seats-' + (value === 'capacity' ? 'room' : 'group'));
      },
    });
    const pick = h('fieldset', { class: 'scn-seats__what' }, h('legend', { id: 'scenario-seats-legend' }, 'What to change'), what.element);
    const fields = [];
    const rooms = sortedRooms(project);
    const numeric = (id, label, value, name, wording, set) => {
      const control = field({
        value,
        id,
        label,
        name,
        type: 'text',
        inputMode: 'numeric',
        width: '100%',
        format: (number) => (number === null ? '' : String(number)),
        parse: (text) => {
          const trimmed = text.trim();
          if (trimmed === '') return null;
          if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > 999) throw new Error(wording);
          return Number(trimmed);
        },
        commit: (number) => {
          set(number);
          line.textContent = '';
          follows();
        },
      });
      control.element.classList.add('scn-field');
      control.input.dataset.key = id;
      return control;
    };
    if (f.what === 'capacity') {
      const room = rooms.find((each) => each.id === f.roomId) || null;
      fields.push(select('scenario-seats-room', 'Room', rooms.map((each) => ({ value: each.id, label: roomLabel(project, each) })), f.roomId, (value) => {
        f.roomId = value;
        f.seeded = '';
        seedSeats(ctx.store.project, f);
        redraw('scenario-seats-room');
      }));
      const control = numeric('scenario-seats-capacity', 'Capacity (seats)', f.capacity, 'scenarioCapacity', 'A capacity is a whole number from 1 to 999, or empty.', (number) => {
        f.capacity = number;
      });
      fields.push(control.element);
      fields.push(h('p', { class: 'scn-form__now scn-seats__now', data: { part: 'now' } }, room && Number.isInteger(room.capacity) ? room.capacity + ' now' : 'No capacity is set now'));
    } else {
      const group = project.groups.find((each) => each.id === f.groupId) || null;
      fields.push(select('scenario-seats-group', 'Group', groupChoices(project), f.groupId, (value) => {
        f.groupId = value;
        f.seeded = '';
        seedSeats(ctx.store.project, f);
        redraw('scenario-seats-group');
      }));
      const control = numeric('scenario-seats-headcount', 'Head count (students)', f.headCount, 'scenarioHeadCount', 'A head count is a whole number from 1 to 999, or empty.', (number) => {
        f.headCount = number;
      });
      fields.push(control.element);
      const own = group && Number.isInteger(group.headCount);
      fields.push(h('p', { class: 'scn-form__now scn-seats__now', data: { part: 'now' } }, own ? group.headCount + ' now' : project.settings.defaultHeadCount + ' now, the school’s default'));
      fields.push(h('p', { class: 'scn-form__hint' }, 'Clear the field to use the school’s default.'));
    }
    return [pick, h('div', { class: 'scn-form__fields' }, fields), h('p', { class: 'scn-form__hint scn-seats__move', data: { part: 'seats-move' } }, SEATS_MOVE)];
  }

  // ---- Stairs and corridors (spec 9.1; DESIGN 12.4)
  function buildingBody(project) {
    const f = memory.form.building;
    const what = choice({
      name: 'scenario-building-what',
      labelledBy: 'scenario-building-legend',
      value: f.what,
      options: [{ value: 'stair', label: 'A stair' }, { value: 'corridor', label: 'A corridor' }],
      onChange(value) {
        f.what = value;
        if (env.picking && env.picking()) env.pickStop(false);
        redraw('scenario-building-' + (value === 'stair' ? 'stair' : 'corridor'));
      },
    });
    const pick = h('fieldset', { class: 'scn-seats__what' }, h('legend', { id: 'scenario-building-legend' }, 'What to close or turn'), what.element);
    const fields = [];
    if (f.what === 'stair') {
      const connections = connectionChoices(project);
      if (connections.length === 0) {
        fields.push(h('p', { class: 'scn-form__hint', data: { part: 'none' } }, 'The building has no stairs connecting floors yet.'));
      } else {
        fields.push(select('scenario-building-stair', 'Stairs', connections, f.connectionId, (value) => {
          f.connectionId = value;
          f.seeded = '';
          seedWay(ctx.store.project, f);
          redraw('scenario-building-stair');
        }));
        const connection = (project.building.connections || []).find((each) => each.id === f.connectionId);
        const ways = connection ? wayChoices(project, connection).concat([{ value: 'closed', label: 'Closed' }]) : [];
        const group = choice({
          name: 'scenario-building-way',
          labelledBy: 'scenario-building-way-legend',
          value: f.way,
          options: ways,
          onChange(value) {
            f.way = value;
            line.textContent = '';
            follows();
          },
        });
        fields.push(h('fieldset', { class: 'scn-way', data: { part: 'ways' } }, h('legend', { class: 'field__label', id: 'scenario-building-way-legend' }, 'Which way'), group.element));
      }
    } else {
      const corridors = corridorChoices(project);
      if (corridors.length === 0) {
        fields.push(h('p', { class: 'scn-form__hint', data: { part: 'none' } }, 'No corridor has a name. Pick one on the map, or name them in the Floor tab.'));
      } else {
        fields.push(select('scenario-building-corridor', 'Named corridor', corridors, f.corridorId, (value) => {
          f.corridorId = value;
          line.textContent = '';
          follows();
        }));
      }
      const pickButton = h('button', {
        type: 'button',
        class: 'btn scn-pick-button',
        'aria-pressed': String(Boolean(env.picking && env.picking())),
        data: { key: 'scenario-building-pick', action: 'pick' },
        on: { click: () => env.pickStart() },
      }, 'Pick on the map');
      fields.push(h('div', { class: 'scn-pick-row' }, pickButton));
      fields.push(h('p', { class: 'scn-form__hint' }, 'A pick closes the place: the named corridor, or the stretch between junctions. Pick a closed place again to open it.'));
    }
    return [pick, h('div', { class: 'scn-form__fields' }, fields)];
  }

  function draw(project, focusKinds) {
    const form = memory.form;
    settle(project, form);
    if (form.kind === 'release') syncReleaseDraft(project, form.release, ctx.announce);
    const days = dayChoices(project);
    const periods = periodChoices(project);
    const groups = groupChoices(project);
    const word = periodWords(project.settings).One;
    form.periodWord = word;
    kinds.set(form.kind);
    drawnKey = keyOf(project);
    now = h('p', { class: 'scn-form__now', dir: 'auto', data: { part: 'now' } });
    preview = h('p', { class: 'scn-form__preview', dir: 'auto', data: { part: 'preview' } });
    follow = h('p', { class: 'scn-form__follow', hidden: true, data: { part: 'follow' } }, TEACHERS_FOLLOW);
    line = h('p', { class: 'scn-form__line', role: 'status', data: { part: 'line' } });
    passing = null;
    lengthen = null;
    startField = null;
    endField = null;
    const fields = [];
    let before = [];
    let after = [];
    const set = (part, key, value) => {
      form[part][key] = value;
      follows();
    };
    const whole = (value) => Number(value);
    if (form.kind === 'move') {
      const f = form.move;
      fields.push(select('scenario-move-group', 'Group', groups, f.groupId, (value) => set('move', 'groupId', value)));
      fields.push(select('scenario-move-day', 'Day type', days, f.dayTypeId, (value) => set('move', 'dayTypeId', value)));
      fields.push(select('scenario-move-period', word, periods, f.period, (value) => set('move', 'period', whole(value))));
      const rooms = sortedRooms(project);
      const room = rooms.find((each) => each.id === f.roomId) || null;
      const picker = roomPicker({
        name: 'Room to move to',
        key: 'scenario-move-room',
        text: room ? roomLabel(project, room) : '',
        roomId: room ? room.id : null,
        missing: false,
        options: () => sortedRooms(ctx.store.project).map((each) => ({ id: each.id, number: each.number, label: roomLabel(ctx.store.project, each), teachers: '', detail: '' })),
        onPick(id) {
          set('move', 'roomId', id);
          line.textContent = '';
          return true;
        },
        onKeep(text) {
          if (text.trim() === '') {
            set('move', 'roomId', null);
            return true;
          }
          line.textContent = 'A move goes to a room of the building. Pick one from the list.';
          return false;
        },
      });
      fields.push(h('div', { class: 'field scn-field scn-field--room' }, h('label', { class: 'field__label', for: picker.input.id }, 'Room to move to'), picker.element));
    } else if (form.kind === 'swapPeriods') {
      const f = form.swapPeriods;
      fields.push(select('scenario-periods-group', 'Group', groups, f.groupId, (value) => set('swapPeriods', 'groupId', value)));
      fields.push(select('scenario-periods-day', 'Day type', days, f.dayTypeId, (value) => set('swapPeriods', 'dayTypeId', value)));
      fields.push(select('scenario-periods-a', 'Swap ' + word.toLowerCase(), periods, f.periodA, (value) => set('swapPeriods', 'periodA', whole(value))));
      fields.push(select('scenario-periods-b', 'With', periods, f.periodB, (value) => set('swapPeriods', 'periodB', whole(value))));
    } else if (form.kind === 'swapRooms') {
      const f = form.swapRooms;
      fields.push(select('scenario-rooms-a', 'Group', groups, f.groupA, (value) => set('swapRooms', 'groupA', value)));
      fields.push(select('scenario-rooms-b', 'Swaps rooms with', groups, f.groupB, (value) => set('swapRooms', 'groupB', value)));
      fields.push(select('scenario-rooms-day', 'Day type', days, f.dayTypeId, (value) => set('swapRooms', 'dayTypeId', value)));
      fields.push(select('scenario-rooms-period', word, periods, f.period, (value) => set('swapRooms', 'period', whole(value))));
    } else if (form.kind === 'bells') {
      fields.push(...bellsFields(project));
      after = bellsExtras(project);
    } else if (form.kind === 'release') {
      before = releaseBody(project);
    } else if (form.kind === 'building') {
      before = buildingBody(project);
    } else {
      before = seatsBody(project);
    }
    addButton = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'add-change' }, on: { click: add } }, form.kind === 'release' ? 'Add this trial' : 'Add this change');
    body.dataset.kind = form.kind;
    body.replaceChildren(...before, ...(fields.length > 0 ? [h('div', { class: 'scn-form__fields' }, fields)] : []), ...after, now, preview, follow, h('div', { class: 'scn-form__actions' }, addButton), line);
    follows();
    if (focusKinds) {
      // the choice of kind keeps the focus it had
      const checked = kinds.element.querySelector('input:checked');
      if (checked && document.activeElement !== checked) checked.focus();
    }
  }

  // drawn again only when what the form lists changes, so a field being
  // typed in is not taken away by a change elsewhere
  function keyOf(project) {
    return JSON.stringify([
      project.groups.map((group) => [group.id, group.name, group.grade, group.headCount]),
      project.dayTypes.map((day) => [day.id, day.name, day.own, day.bells]),
      project.settings.periods,
      project.settings.periodWord,
      project.settings.timeFormat,
      project.settings.defaultHeadCount,
      project.settings.defaultPassingSeconds,
      bellSets(project).map((each) => each.value + each.label),
      project.bellSchedules,
      project.release,
      // the stairs and the named corridors the Stairs and corridors form offers, and the ways it words
      project.building.connections,
      project.building.floors.map((floor) => [floor.id, floor.name, floor.level, (floor.corridors || []).map((corridor) => [corridor.id, corridor.name, corridor.cells.length])]),
      // a room's name and label too: the picker shows the label of the room picked
      allRooms(project).map((room) => [room.id, room.number, room.name, roomLabel(project, room), room.teacherIds.join(','), room.capacity, room.wing]),
    ]);
  }

  function update(project) {
    if (keyOf(project) !== drawnKey) {
      const held = body.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      draw(project, false);
      if (held) {
        const back = body.querySelector('[data-key="' + held + '"]');
        if (back) back.focus();
      }
    } else if (now) {
      // the slots' rooms may have changed under the same lists
      follows();
    }
  }

  return {
    element,
    update,
    // the Kind of change fieldset takes the focus (on the chip chosen)
    focusKinds() {
      const checked = kinds.element.querySelector('input:checked');
      if (checked) checked.focus();
    },
    // "Pick on the map" takes the focus back, after a pick or Cancel
    focusPick() {
      const button = body.querySelector('[data-key="scenario-building-pick"]');
      if (button) {
        button.setAttribute('aria-pressed', 'false');
        button.focus();
        return true;
      }
      return false;
    },
    // the button follows the map's mode
    picked(on) {
      const button = body.querySelector('[data-key="scenario-building-pick"]');
      if (button) button.setAttribute('aria-pressed', String(on));
    },
  };
}
