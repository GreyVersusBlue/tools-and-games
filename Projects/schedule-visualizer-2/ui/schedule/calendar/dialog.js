// The date dialog (DESIGN 11.4): opened on a date, or on a run of dates, by
// Enter, Space, a click or a tap on the year. Not modal: the year stays
// usable beside it, and choosing another date moves the dialog to it. Named
// by the date; a bottom sheet under 640 px with every field at 16 px.
//
//   openDateDialog({ project, from, to, opener, apply(dates, change), choose(from, to), closed() })
//
// The day type as radios, the date's own checked and focused, then No
// school, Next in the rotation and As the calendar says (which takes the
// date's change away); Bells when there are other bell schedules; Through,
// the last date of the run, for a run without a Shift key; a Note; and Apply,
// whose words name the change. Only what is touched is changed: a date whose
// day nobody touched keeps its day as it is, so a change of bells alone on a
// date with no change of its own leaves the day to the weekday (day null,
// SV2-75b) and moves nothing. `apply` returns a refusal's sentence, or null
// once the change is made; Apply and Escape close the dialog and the focus
// goes back to the date it was opened from.

import { h, uid } from '../../components/dom.js';
import { datesFrom, dateWords, isCalendarDate } from '../../../engine/calendar.js';
import { calendarOf, bellSchedulesOf, DAY_CLOSED, DAY_ROTATION, BELLS_REGULAR, DATE_LABEL_MOST } from '../../../engine/schema.js';
import { dayEntry, changeOn, changeWords, runWords, NO_SCHOOL, NEXT_IN_ROTATION, AS_CALENDAR_SAYS, AS_WEEKDAY_SAYS, REGULAR } from './model.js';

const AS_CALENDAR = 'calendar';
const AS_WEEKDAY = 'weekday';

let open = null;

export function dateDialogOpen() {
  return open;
}

export function closeDateDialog(focusBack) {
  if (open) open.close(focusBack);
}

function radioSet(name, legend, options, chosen) {
  const radios = options.map((option) => {
    const input = h('input', { type: 'radio', name, value: option.value });
    input.checked = option.value === chosen;
    return h('label', { class: 'sch-radio cal-dialog__radio' }, input, h('span', null, option.label));
  });
  return h('fieldset', { class: 'sch-fieldset cal-dialog__set' }, h('legend', null, legend), radios);
}

function checked(set) {
  const input = set ? set.querySelector('input:checked') : null;
  return input ? input.value : null;
}

export function openDateDialog(options) {
  if (open) open.close(false);
  const project = options.project;
  const calendar = calendarOf(project);
  const from = options.from;
  const entry = dayEntry(project, from);
  const own = changeOn(project, from);
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
  const titleId = uid('cal-dialog-title');
  const base = uid('cal-dialog');

  // the day the date has now: its own change's, else what the walk gives
  let dayNow;
  if (own && own.day !== null) dayNow = own.day;
  else if (entry && !entry.school) dayNow = DAY_CLOSED;
  else dayNow = entry ? entry.dayTypeId : project.dayTypes[0].id;
  const days = radioSet(base + '-day', 'Day', project.dayTypes.map((dayType) => ({ value: dayType.id, label: dayType.name })).concat([
    { value: DAY_CLOSED, label: NO_SCHOOL },
    { value: DAY_ROTATION, label: NEXT_IN_ROTATION },
    { value: AS_CALENDAR, label: AS_CALENDAR_SAYS },
  ]), dayNow);
  days.dataset.part = 'day';

  const bellsNow = own && own.bells !== null ? own.bells : AS_WEEKDAY;
  const bells = schedules.length === 0 ? null : radioSet(base + '-bells', 'Bells', [{ value: AS_WEEKDAY, label: AS_WEEKDAY_SAYS }, { value: BELLS_REGULAR, label: REGULAR }].concat(schedules.map((schedule) => ({ value: schedule.id, label: schedule.name }))), bellsNow);
  if (bells) bells.dataset.part = 'bells';

  const throughId = base + '-through';
  const through = h('input', { type: 'date', id: throughId, class: 'field__input cal-dialog__date', min: from, max: calendar.end, name: 'through' });
  through.value = options.to;
  const noteId = base + '-note';
  const noteNow = own ? own.label : '';
  const note = h('input', { type: 'text', id: noteId, class: 'field__input', name: 'note', maxlength: String(DATE_LABEL_MOST), autocomplete: 'off', spellcheck: 'false' });
  note.value = noteNow;
  const refusal = h('p', { class: 'field__refusal', role: 'alert', hidden: true });
  const applyButton = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'apply-date' } });
  const closeButton = h('button', { type: 'button', class: 'btn', data: { action: 'close-date' } }, 'Close');
  const title = h('h2', { class: 'dialog__title', id: titleId });

  const element = h('dialog', { class: 'dialog cal-dialog', 'aria-labelledby': titleId, id: 'calendar-date-dialog' },
    title,
    h('div', { class: 'dialog__body cal-dialog__body' },
      days,
      bells,
      h('div', { class: 'field cal-dialog__field' }, h('label', { class: 'field__label', for: throughId }, 'Through'), through),
      h('div', { class: 'field cal-dialog__field' }, h('label', { class: 'field__label', for: noteId }, 'Note'), note),
      refusal),
    h('div', { class: 'dialog__buttons' }, applyButton, closeButton));

  const touched = { day: false, bells: false, note: false };

  function lastDate() {
    const value = through.value;
    if (!isCalendarDate(value)) return null;
    if (value < from || value > calendar.end) return null;
    return value;
  }

  // what Apply will do: { dates, change } or a refusal
  function reading() {
    const last = lastDate();
    if (last === null) return { refusal: 'Through is a date from ' + dateWords(from) + ' to ' + dateWords(calendar.end) + '.' };
    const dates = datesFrom(from, last);
    const change = {};
    const day = checked(days);
    if (touched.day) change.day = day === AS_CALENDAR ? null : day;
    if (change.day !== null) {
      const chosenBells = checked(bells);
      if (touched.bells && chosenBells !== null) change.bells = chosenBells === AS_WEEKDAY ? null : chosenBells;
      if (touched.note) change.label = note.value;
    }
    return { dates, change };
  }

  function words() {
    const read = reading();
    // "As the calendar says" takes the change away, bells and note with it
    const away = checked(days) === AS_CALENDAR;
    if (bells) for (const input of bells.querySelectorAll('input')) input.disabled = away;
    note.disabled = away;
    const last = lastDate() || from;
    title.textContent = last === from ? dateWords(from, { weekday: true }) : runWords(from, last);
    if (read.refusal) {
      applyButton.textContent = 'Apply';
      return;
    }
    const nothing = Object.keys(read.change).length === 0;
    applyButton.textContent = nothing ? 'Apply' : changeWords(project, read.dates, read.change);
  }

  function close(focusBack) {
    if (!element.isConnected) return;
    element.close();
    element.remove();
    if (open === handle) open = null;
    if (options.closed) options.closed(focusBack !== false);
  }

  // a choice put back to what the date has is no change, on one date; on a
  // run it is what every date of the run is to have
  const run = () => (lastDate() || from) !== from;
  days.addEventListener('change', () => {
    touched.day = run() || checked(days) !== dayNow;
    words();
  });
  if (bells) {
    bells.addEventListener('change', () => {
      touched.bells = run() || checked(bells) !== bellsNow;
      words();
    });
  }
  note.addEventListener('input', () => {
    touched.note = note.value !== noteNow;
    words();
  });
  through.addEventListener('change', () => {
    const last = lastDate();
    if (last !== null && options.choose) options.choose(from, last);
    words();
  });

  applyButton.addEventListener('click', () => {
    const read = reading();
    if (read.refusal) {
      refusal.textContent = read.refusal;
      refusal.hidden = false;
      through.setAttribute('aria-invalid', 'true');
      through.focus();
      return;
    }
    if (Object.keys(read.change).length === 0) {
      close(true);
      return;
    }
    const said = options.apply(read.dates, read.change);
    if (said) {
      refusal.textContent = said;
      refusal.hidden = false;
      return;
    }
    close(true);
  });
  closeButton.addEventListener('click', () => close(true));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Enter' && event.target === note) {
      event.preventDefault();
      applyButton.click();
    }
  });

  words();
  document.body.append(element);
  element.show();
  const first = days.querySelector('input:checked') || days.querySelector('input');
  first.focus();

  const handle = { element, close, from };
  open = handle;
  return handle;
}
