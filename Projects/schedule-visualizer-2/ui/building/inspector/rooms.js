// The Rooms tab: every room of the floor on screen as a table that sorts by
// any column and is edited in place (spec 4.8). It is the way to do without
// the plan what the plan and the Properties tab do: the same actions, the
// same refusals. The floor plan and the room list print from here (DESIGN 8).
//
// A row's place does not change while it is being edited: the table sorts
// when a heading is pressed, not when a number is typed.
//
// Under the prints, the files (spec 17, SV2-32c): the floor plan as a PNG,
// this floor or every floor in one picture (ui/building/plan-png.js), and
// the room list as CSV. The CSV is Schedule › Import's Rooms export, made by
// the same builder (engine/exports.js buildExport 'rooms'), so it is every
// room of the building and the two files are the same file.
//   element.querySelector('#rooms-export').exports = { hooks }
//   hooks.deliver   when set, it is given { fileName, mime, blob | text,
//                   width, height } instead of the file being downloaded

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { table } from '../../components/table.js';
import { count } from '../../components/words.js';
import { printButton } from '../../components/print-preview.js';
import { printButtons } from '../../prints/index.js';
import { setRoomFields, setRoomTeachers } from '../../../engine/actions.js';
import { roomName } from '../../../engine/findings.js';
import { buildExport } from '../../../engine/exports.js';
import { download } from '../../schedule/common.js';
import { planPng } from '../plan-png.js';
import { selectField, wholeOrEmpty, keepFocus } from './controls.js';

const NONE = '';

// roomsPanel(env) -> { element, update(state) }
export function roomsPanel(env) {
  const { store, ctx } = env;
  const lead = h('p', { id: 'rooms-lead' });
  const host = h('div', { class: 'bi-scroll', id: 'rooms-table' });
  const prints = h('div', { class: 'bi-buttons', id: 'rooms-print' });
  const pngOne = h('button', { type: 'button', class: 'btn', data: { action: 'plan-png' } });
  const pngAll = h('button', { type: 'button', class: 'btn', data: { action: 'plan-png-all' } }, 'Save every floor as an image');
  const csv = h('button', { type: 'button', class: 'btn', data: { action: 'rooms-csv' } }, 'Save the room list as CSV');
  const saves = h('div', { class: 'bi-buttons', id: 'rooms-export' }, pngOne, pngAll, csv);
  const saved = h('p', { class: 'bi-check__hint', id: 'rooms-export-status', role: 'status' });
  const files = h('div', { class: 'bi-part', id: 'rooms-files' },
    h('h3', { class: 'bi-heading' }, 'Save as a file'),
    h('p', { class: 'bi-check__hint', id: 'rooms-files-hint' }, 'The image is the floor plan as it prints, as a PNG. The room list is every room on every floor, the same file as the Rooms export on Schedule › Import. For a PDF, print and choose "Save as PDF" as the printer.'),
    saves, saved);
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-rooms' }, h('h2', { class: 'bld-inspector__title', id: 'rooms-title' }), lead, host, prints, files);
  const hooks = { deliver: null };
  saves.exports = { hooks };
  // room id -> { number, teacher, subject, capacity }, the controls of its row
  const handles = new Map();
  let state = null;
  let built = null;
  let list = null;

  const roomsOf = (floor) => floor.spaces.filter((space) => space.kind === 'room');
  const find = (id) => state.floor.spaces.find((space) => space.id === id) || null;

  function handle(id) {
    if (!handles.has(id)) handles.set(id, {});
    return handles.get(id);
  }

  function teacherOptions() {
    return [{ value: NONE, label: 'No teacher' }].concat(state.project.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })));
  }

  function subjectOptions() {
    return [{ value: NONE, label: 'No subject' }].concat(state.project.subjects.map((subject) => ({ value: subject.id, label: subject.name })));
  }

  function subjectName(room) {
    const subject = room.subjectId ? state.project.subjects.find((each) => each.id === room.subjectId) : null;
    return subject ? subject.name : '';
  }

  function teacherName(room) {
    const teacher = room.teacherIds.length > 0 ? state.project.teachers.find((each) => each.id === room.teacherIds[0]) : null;
    return teacher ? teacher.name : '';
  }

  const columns = [
    {
      id: 'number',
      label: 'Room',
      sortable: true,
      value: (room) => room.number,
      render: (room) => {
        const made = field({ value: room.number, name: 'number', commit: (value) => store.apply(setRoomFields, { roomId: room.id, number: value }) });
        made.input.dataset.key = room.id + ':number';
        made.input.setAttribute('aria-label', 'Room number');
        handle(room.id).number = made;
        return made.element;
      },
    },
    {
      id: 'teacher',
      label: 'Teacher',
      sortable: true,
      value: (room) => teacherName(room),
      render: (room) => {
        // the main teacher: the one chosen takes that place, and the room's other teachers stay
        const made = selectField({
          key: room.id + ':teacher',
          name: 'teacher',
          ariaLabel: 'Main teacher',
          options: teacherOptions(),
          value: room.teacherIds[0] || NONE,
          commit: (value) => {
            const now = find(room.id);
            const rest = now.teacherIds.slice(1).filter((id) => id !== value);
            store.apply(setRoomTeachers, { roomId: room.id, teacherIds: value === NONE ? rest : [value].concat(rest) });
          },
        });
        handle(room.id).teacher = made;
        return made.element;
      },
    },
    {
      id: 'subject',
      label: 'Subject',
      sortable: true,
      value: (room) => subjectName(room),
      render: (room) => {
        const made = selectField({
          key: room.id + ':subject',
          name: 'subject',
          ariaLabel: 'Subject',
          options: subjectOptions(),
          value: room.subjectId || NONE,
          commit: (value) => store.apply(setRoomFields, { roomId: room.id, subjectId: value === NONE ? null : value }),
        });
        handle(room.id).subject = made;
        return made.element;
      },
    },
    {
      id: 'capacity',
      label: 'Seats',
      sortable: true,
      numeric: true,
      value: (room) => (room.capacity === null ? -1 : room.capacity),
      render: (room) => {
        const made = field({
          value: room.capacity,
          name: 'capacity',
          inputMode: 'numeric',
          parse: wholeOrEmpty('A capacity'),
          format: (value) => (value === null ? '' : String(value)),
          commit: (value) => store.apply(setRoomFields, { roomId: room.id, capacity: value }),
        });
        made.input.dataset.key = room.id + ':capacity';
        made.input.setAttribute('aria-label', 'Capacity, in seats');
        handle(room.id).capacity = made;
        return made.element;
      },
    },
  ];

  // The room whose row has the focus is the selected one, so the plan shows which it is.
  host.addEventListener('focusin', (event) => {
    const row = event.target.closest('tr[data-key]');
    if (!row || !state) return;
    const ed = env.editor();
    if (ed.selection.length === 1 && ed.selection[0] === row.dataset.key) return;
    if (find(row.dataset.key)) ed.select([row.dataset.key]);
  });

  for (const entry of printButtons.filter((each) => each.screen === '#building')) {
    prints.append(printButton(ctx, entry, () => ({ floorId: state.floor.id, sort: list ? list.sort : undefined })));
  }

  function deliver(file) {
    if (typeof hooks.deliver === 'function') {
      hooks.deliver(file);
    } else {
      if (file.blob) {
        const url = URL.createObjectURL(file.blob);
        const link = h('a', { href: url, download: file.fileName, hidden: true });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        download(file.fileName, file.mime, file.text);
      }
      ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
    }
  }

  // One file at a time: a press while an image is being made does nothing.
  let busy = false;
  async function savePlan(floorId) {
    if (busy) return;
    busy = true;
    saves.dataset.busy = 'true';
    saved.textContent = 'Making the image…';
    try {
      const made = await planPng(store.project, { floorId, now: ctx.clock() });
      if (!made.ok) {
        saved.textContent = made.text;
        ctx.toast({ kind: 'problem', text: made.text });
        return;
      }
      deliver({ fileName: made.fileName, mime: 'image/png', blob: made.blob, width: made.width, height: made.height });
      saved.textContent = 'Saved ' + made.fileName + ', ' + made.width + ' by ' + made.height + ' pixels.'
        + (made.fell > 0 ? ' This browser could not hold it larger, so it was saved ' + (made.fell === 1 ? 'one size' : made.fell + ' sizes') + ' down.' : '');
    } catch (error) {
      saved.textContent = 'That was not saved. ' + (error && error.message ? error.message : 'Try again.');
      ctx.toast({ kind: 'problem', text: saved.textContent });
    } finally {
      busy = false;
      delete saves.dataset.busy;
    }
  }

  pngOne.addEventListener('click', () => savePlan(state.floor.id));
  pngAll.addEventListener('click', () => savePlan('all'));
  csv.addEventListener('click', () => {
    let file;
    try {
      file = buildExport(store.project, 'rooms', { date: ctx.clock() });
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'That was not exported. ' + (error && error.message ? error.message : 'Try again.') });
      return;
    }
    deliver(file);
    saved.textContent = 'Saved ' + file.fileName + '.';
  });

  function update(next) {
    state = next;
    const { floor, project } = state;
    const rooms = roomsOf(floor);
    const title = element.querySelector('#rooms-title');
    const name = 'The rooms of ' + floor.name;
    if (title.textContent !== name) title.textContent = name;
    const one = 'Save ' + floor.name + ' as an image';
    if (pngOne.textContent !== one) pngOne.textContent = one;
    pngAll.hidden = project.building.floors.length < 2;
    const numbered = rooms.filter((room) => room.number.trim() !== '').length;
    lead.textContent = rooms.length === 0
      ? 'There are no rooms on ' + floor.name + ' yet. Choose the Room tool (R) and drag on the plan.'
      : floor.name + ' has ' + count(rooms.length, 'room') + (numbered === rooms.length ? '.' : ', ' + (rooms.length - numbered) + ' with no number yet.') + ' Press a heading to sort by it.';

    const key = floor.id + '/' + rooms.map((room) => room.id).join(',') + '/' + project.teachers.map((teacher) => teacher.id + teacher.name).join(',') + '/' + project.subjects.map((subject) => subject.id + subject.name).join(',');
    if (key !== built) {
      built = key;
      keepFocus(host, () => {
        handles.clear();
        if (rooms.length === 0) {
          list = null;
          host.replaceChildren();
        } else {
          const sort = list ? list.sort : { column: 'number', direction: 'ascending' };
          list = table({ caption: 'The rooms of ' + floor.name, columns, rows: rooms, sort, key: (room) => room.id });
          host.replaceChildren(list.element);
        }
      });
      return;
    }
    // the same rooms: only what each row shows
    for (const room of rooms) {
      const row = handles.get(room.id);
      if (!row) continue;
      row.number.set(room.number);
      row.teacher.set(room.teacherIds[0] || NONE);
      row.subject.set(room.subjectId || NONE);
      row.capacity.set(room.capacity);
      row.number.input.setAttribute('aria-label', 'Room number of ' + roomName(room));
    }
  }

  return { element, update };
}
