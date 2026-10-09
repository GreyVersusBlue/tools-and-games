// What a reader keeps for themselves, on their own device and nowhere else:
// who they are in this school, and a short note against any period of their
// own day.
//
//   sv2staff:<schoolId>:me     a teacher id
//   sv2staff:<schoolId>:notes  { [dayTypeId]: { [period]: text } } as JSON
//
// Both go through the guard of storage.js (ctx.store), which is opened for
// the school's id: a newer file of the same school finds them as they were,
// and another school's file never sees them. Nothing here is ever put in an
// address, shared, or sent. Neither key's name changes.
//
// A note is text and stays text: it is kept as typed, shown as typed and
// printed as typed. What is kept is put right on every read, so a damaged or
// hand-edited value reads as the notes it still holds and never stops a page.

import { h } from './dom.js';

export const ME_KEY = 'me';
export const NOTES_KEY = 'notes';
export const NOTE_MAX = 200;
export const NOTES_KEPT_SENTENCE = 'Your notes are kept on this device only. They print with your schedule, and an empty note prints nothing.';

// ---- who the reader is

// The teacher the reader said they are, when this copy of the schedule has
// that teacher; else null. A choice that names nobody here is left as it is:
// the next copy may have them again.
export function meOf(ctx) {
  const id = ctx && ctx.store ? ctx.store.get(ME_KEY) : null;
  return id ? ctx.school.teacher(id) || null : null;
}

export function isMe(ctx, teacherId) {
  const me = meOf(ctx);
  return me !== null && me.id === teacherId;
}

export function chooseMe(ctx, teacherId) {
  if (ctx.school.teacher(teacherId)) ctx.store.set(ME_KEY, teacherId);
}

export function forgetMe(ctx) {
  ctx.store.remove(ME_KEY);
}

// ---- the notes

// Whatever was kept, as notes: an object of objects of non-empty text, and
// nothing else. Anything that is not that is left out.
export function notesFrom(kept) {
  let raw = null;
  try {
    raw = typeof kept === 'string' ? JSON.parse(kept) : null;
  } catch (error) {
    raw = null;
  }
  const notes = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return notes;
  for (const [dayTypeId, day] of Object.entries(raw)) {
    if (day === null || typeof day !== 'object' || Array.isArray(day)) continue;
    for (const [period, text] of Object.entries(day)) {
      if (!/^\d+$/.test(period) || typeof text !== 'string' || text === '') continue;
      if (!notes[dayTypeId]) notes[dayTypeId] = {};
      notes[dayTypeId][period] = text;
    }
  }
  return notes;
}

export function readNotes(store) {
  return notesFrom(store.get(NOTES_KEY));
}

// The note against one period of one day type, or ''.
export function noteOf(notes, dayTypeId, period) {
  const day = notes[dayTypeId];
  const text = day ? day[String(period)] : undefined;
  return typeof text === 'string' ? text : '';
}

// Keep `text` against a period of each of `dayTypeIds`; '' takes the note
// away. With no note left at all the key itself is removed.
export function writeNote(store, dayTypeIds, period, text) {
  const notes = readNotes(store);
  for (const dayTypeId of dayTypeIds) {
    if (text === '') {
      if (notes[dayTypeId]) delete notes[dayTypeId][String(period)];
      if (notes[dayTypeId] && Object.keys(notes[dayTypeId]).length === 0) delete notes[dayTypeId];
    } else {
      if (!notes[dayTypeId]) notes[dayTypeId] = {};
      notes[dayTypeId][String(period)] = text;
    }
  }
  if (Object.keys(notes).length === 0) store.remove(NOTES_KEY);
  else store.set(NOTES_KEY, JSON.stringify(notes));
  return notes;
}

// ---- on the reader's own day cards

// Put the reader's notes on their day cards (the node dayCardsOf() made), in
// place: under each period its note as text, and, once "Edit my notes" is
// pressed, a field for each period instead. A card that stands for two day
// types that are the same shows the first one's note, and what is typed
// there is kept against both. Returns the button and the sentence that go
// under the cards.
export function noteFields(ctx, days) {
  const school = ctx.school;
  const notes = readNotes(ctx.store);
  const boxes = [];
  for (const card of days.querySelectorAll('.day')) {
    const ids = (card.dataset.days || '').split(' ').filter((id) => id !== '');
    const names = ids.map((id) => school.dayTypes.find((dayType) => dayType.id === id)).filter(Boolean).map((dayType) => dayType.name).join(' and ');
    for (const row of card.querySelectorAll('.row[data-period]')) {
      const period = Number(row.dataset.period);
      const kept = ids.map((id) => noteOf(notes, id, period)).find((text) => text !== '') || '';
      const paper = h('span', { class: 'note__paper' }, kept);
      const input = h('input', {
        class: 'field__input note__input',
        type: 'text',
        maxlength: String(NOTE_MAX),
        autocomplete: 'off',
        enterkeyhint: 'done',
        placeholder: 'Add a note',
        'aria-label': 'Note for ' + school.periodName(period) + ' on ' + names,
      });
      input.value = kept;
      const box = h('div', { class: 'row__note note', dataset: { note: ids[0] + ':' + period, empty: String(kept === '') } }, paper, input);
      input.addEventListener('input', () => {
        writeNote(ctx.store, ids, period, input.value);
        paper.textContent = input.value;
        box.dataset.empty = String(input.value === '');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
      row.appendChild(box);
      boxes.push(box);
    }
  }
  days.dataset.notes = 'read';

  const toggle = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', dataset: { toggle: 'notes' } }, 'Edit my notes');
  toggle.addEventListener('click', () => {
    const editing = days.dataset.notes !== 'edit';
    days.dataset.notes = editing ? 'edit' : 'read';
    toggle.setAttribute('aria-pressed', String(editing));
    toggle.textContent = editing ? 'Done with notes' : 'Edit my notes';
    const first = editing ? days.querySelector('.note__input') : null;
    if (first) first.focus();
  });
  return h('div', { class: 'no-print', dataset: { part: 'notes' } },
    h('p', { class: 'actions' }, toggle),
    h('p', { class: 'muted' }, NOTES_KEPT_SENTENCE));
}
