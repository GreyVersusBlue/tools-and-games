// The calendar's panel (DESIGN 11.4): in the inspector on a wide screen,
// under the year where the inspector is a sheet. First the sentence ("182
// school days from 31 August 2026 to 11 June 2027. Today is a B Day with
// Early Release bells."), then the counts per day type and per bell schedule,
// then the setup as it stands, each part changed where it is shown: the
// first and last day, each weekday's rule and bells, the rotation, the
// breaks. Last, Print the calendar, Save as CSV, Import dates… and Remove the
// calendar. Every change is one undo step with a toast that offers Undo.

import { h, uid } from '../../components/dom.js';
import { setCalendarRange, setCalendarWeekday, setCalendarRotation, setCalendarDates, removeCalendar } from '../../../engine/actions.js';
import { calendarCounts, dateWords } from '../../../engine/calendar.js';
import { exportFileName } from '../../../engine/exports.js';
import { calendarCsv } from '../../../engine/import-calendar.js';
import { calendarOf, bellSchedulesOf, DAY_ROTATION, DAY_CLOSED, ROTATION_RANGE, DATE_LABEL_MOST, WEEKDAY_NAMES } from '../../../engine/schema.js';
import { printButton as previewButton } from '../../components/print-preview.js';
import { keyed, button, download } from '../common.js';
import { summaryWords, breaksOf, runWords, firstDayOf } from './model.js';
import { rotationChips, dateInput } from './parts.js';
import { openImportDialog } from './import.js';

function count(n, one, many) {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

// Run an action; a refusal is a toast with its sentence. The project after,
// or null.
function run(ctx, action, payload) {
  try {
    ctx.store.apply(action, payload);
    return ctx.store.project;
  } catch (error) {
    ctx.toast({ kind: 'problem', text: error && error.message ? error.message : 'That could not be done. Try again.' });
    return null;
  }
}

function undoToast(ctx, text) {
  ctx.toast({ text, action: { label: 'Undo', run: ctx.undo } });
}

export function calendarPanel(env, project, today) {
  const { ctx, view } = env;
  const calendar = calendarOf(project);
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
  const counts = calendarCounts(project);
  const names = new Map(project.dayTypes.map((dayType) => [dayType.id, dayType.name]));
  const titleId = uid('cal-panel');

  // ---- the counts
  const byDay = h('ul', { class: 'cal-counts', data: { part: 'counts-days' } }, counts.dayTypes.map((each) => h('li', null, h('span', null, names.get(each.dayTypeId)), ' ', h('span', { class: 'cal-counts__n' }, count(each.count, 'school day')))));
  const byBells = schedules.length === 0 ? null : h('ul', { class: 'cal-counts', data: { part: 'counts-bells' } }, counts.bells.map((each) => h('li', null,
    h('span', null, each.bellsId === null ? 'Regular bells' : (schedules.find((schedule) => schedule.id === each.bellsId) || { name: '' }).name + ' bells'), ' ',
    h('span', { class: 'cal-counts__n' }, count(each.count, 'school day')))));

  // ---- the range: both dates go to the action together
  const range = { start: calendar.start, end: calendar.end };
  const commitRange = () => {
    if (range.start === calendar.start && range.end === calendar.end) return;
    if (run(ctx, setCalendarRange, { start: range.start, end: range.end })) undoToast(ctx, 'The calendar runs from ' + dateWords(range.start) + ' to ' + dateWords(range.end) + '.');
    else env.render();
  };
  const first = dateInput('cal-start', 'First day', calendar.start, (value) => {
    range.start = value;
  }, commitRange);
  const last = dateInput('cal-end', 'Last day', calendar.end, (value) => {
    range.end = value;
  }, commitRange);

  // ---- the weekdays: what each says, and its bells
  const weekdays = h('table', { class: 'cal-rules', data: { part: 'weekdays' } },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Weekday'), h('th', { scope: 'col' }, 'Day'), schedules.length > 0 ? h('th', { scope: 'col' }, 'Bells') : null)),
    h('tbody', null, WEEKDAY_NAMES.map((name, index) => {
      const rule = calendar.weekdays[index] || { day: DAY_ROTATION, bells: null };
      const day = keyed(h('select', {
        class: 'field__input cal-select',
        'aria-label': name + 's',
        on: {
          change: (event) => {
            if (run(ctx, setCalendarWeekday, { weekday: index, day: event.target.value })) undoToast(ctx, name + 's: ' + event.target.selectedOptions[0].textContent + '.');
          },
        },
      }, h('option', { value: DAY_ROTATION }, 'In the rotation'), h('option', { value: DAY_CLOSED }, 'No school'), project.dayTypes.map((dayType) => h('option', { value: dayType.id }, 'Always ' + dayType.name))), 'cal-weekday:' + index);
      day.value = rule.day;
      let bells = null;
      if (schedules.length > 0) {
        const select = keyed(h('select', {
          class: 'field__input cal-select',
          'aria-label': name + 's: bells',
          disabled: rule.day === DAY_CLOSED ? '' : null,
          on: {
            change: (event) => {
              const value = event.target.value === '' ? null : event.target.value;
              if (run(ctx, setCalendarWeekday, { weekday: index, bells: value })) undoToast(ctx, name + 's: ' + event.target.selectedOptions[0].textContent + '.');
            },
          },
        }, h('option', { value: '' }, 'Regular bells'), schedules.map((schedule) => h('option', { value: schedule.id }, schedule.name + ' bells'))), 'cal-weekday-bells:' + index);
        select.value = rule.bells || '';
        bells = h('td', null, select);
      }
      return h('tr', null, h('th', { scope: 'row' }, name), h('td', null, day), bells);
    })));

  // ---- the rotation
  const rotation = rotationChips(project, calendar.rotation, {
    keyBase: 'cal-rotation',
    remove(index) {
      const next = calendar.rotation.slice();
      const [gone] = next.splice(index, 1);
      env.focusAfter('cal-rotation-add');
      if (run(ctx, setCalendarRotation, { rotation: next })) undoToast(ctx, 'Took ' + names.get(gone) + ' out of the rotation.');
    },
    add(id) {
      env.focusAfter('cal-rotation-add');
      if (run(ctx, setCalendarRotation, { rotation: calendar.rotation.concat([id]) })) undoToast(ctx, 'Added ' + names.get(id) + ' to the rotation.');
    },
  });

  // ---- the breaks
  const breaks = breaksOf(project);
  const adding = view.calBreak || (view.calBreak = { from: '', to: '', label: '' });
  const breakList = h('ul', { class: 'cal-breaklist', data: { part: 'breaks' } }, breaks.map((item, index) => h('li', { class: 'cal-breakline' },
    h('span', null, (item.label === '' ? 'No school' : item.label) + ': ' + runWords(item.from, item.to) + ', ' + count(item.schoolDays, 'school day')),
    button('Remove', () => {
      env.focusAfter('cal-add-break');
      if (run(ctx, setCalendarDates, { dates: item.dates, day: null })) undoToast(ctx, 'Removed ' + (item.label === '' ? 'the break' : item.label) + ': ' + runWords(item.from, item.to) + ' is as the calendar says.');
    }, { small: true, key: 'cal-break:' + index + ':remove', more: ' ' + (item.label || 'the break') + ', ' + runWords(item.from, item.to) }))));
  const breakFrom = dateInput('cal-break-from', 'From', adding.from, (value) => {
    adding.from = value;
  }, () => {});
  const breakTo = dateInput('cal-break-to', 'To', adding.to, (value) => {
    adding.to = value;
  }, () => {});
  const breakName = keyed(h('input', { type: 'text', id: 'cal-break-name', class: 'field__input', maxlength: String(DATE_LABEL_MOST), autocomplete: 'off', on: { input: (event) => { adding.label = event.target.value; } } }), 'cal-break-name');
  breakName.value = adding.label;
  const addBreak = button('Add a break', () => {
    const from = adding.from;
    const to = adding.to === '' ? from : adding.to;
    if (from === '') {
      ctx.toast({ kind: 'problem', text: 'A break needs its first day. Choose it under From.' });
      return;
    }
    if (to < from) {
      ctx.toast({ kind: 'problem', text: 'The break ends before it starts. Swap the two dates.' });
      return;
    }
    env.focusAfter('cal-add-break');
    const after = run(ctx, setCalendarDates, { dates: { from: from < calendar.start ? calendar.start : from, to: to > calendar.end ? calendar.end : to }, day: DAY_CLOSED, label: adding.label });
    if (!after) return;
    const outcome = ctx.store.undoOutcome;
    view.calBreak = { from: '', to: '', label: '' };
    undoToast(ctx, (adding.label === '' ? 'A break' : adding.label) + ': ' + count(outcome ? outcome.schoolDays : 0, 'school day') + ' with no school, ' + runWords(from, to) + '.');
  }, { key: 'cal-add-break', action: 'add-break' });

  // ---- the files
  // the week starts on this device's first day, as on screen
  const printButton = keyed(previewButton(ctx, { id: 'print-calendar', output: 'calendar', label: 'Print the calendar' }, () => ({ firstDay: firstDayOf(navigator.language || 'en-US') })), 'cal-print');
  const csvButton = button('Save as CSV', () => {
    const now = ctx.clock();
    download(exportFileName(ctx.store.project, 'calendar', 'csv', now), 'text/csv', calendarCsv(ctx.store.project));
    ctx.toast({ text: 'Saved the calendar as a CSV file: one row per date, ready for a spreadsheet.' });
  }, { key: 'cal-csv', action: 'save-calendar-csv' });
  const importButton = button('Import dates…', (opener) => openImportDialog(env, opener), { key: 'cal-import', action: 'import-dates' });
  const removeButton = button('Remove the calendar', () => {
    env.focusAfter('cal-start');
    if (run(ctx, removeCalendar)) undoToast(ctx, 'Removed the calendar.');
  }, { key: 'cal-remove', action: 'remove-calendar' });

  return h('section', { class: 'cal-panel', 'aria-labelledby': titleId, data: { part: 'panel' } },
    h('h2', { class: 'cal-panel__title', id: titleId }, 'Calendar'),
    h('p', { class: 'cal-panel__summary', data: { says: 'summary' } }, summaryWords(project, today)),
    h('h3', { class: 'cal-panel__sub' }, 'Day types'), byDay,
    byBells ? [h('h3', { class: 'cal-panel__sub' }, 'Bells'), byBells] : null,
    h('h3', { class: 'cal-panel__sub' }, 'The year'),
    h('div', { class: 'cal-range' }, first.element, last.element),
    h('h3', { class: 'cal-panel__sub' }, 'Weekdays'), weekdays,
    h('h3', { class: 'cal-panel__sub' }, 'The rotation'),
    h('p', { class: 'sch-hint' }, 'The day types in the order they come round, up to ' + ROTATION_RANGE[1] + '.'),
    rotation,
    h('h3', { class: 'cal-panel__sub' }, 'Breaks and holidays'),
    breaks.length === 0 ? h('p', { class: 'sch-hint' }, 'No breaks yet.') : breakList,
    h('div', { class: 'cal-addbreak' }, breakFrom.element, breakTo.element, h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'cal-break-name' }, 'Name'), breakName), addBreak),
    h('div', { class: 'cal-files' }, printButton, csvButton, importButton, removeButton));
}
