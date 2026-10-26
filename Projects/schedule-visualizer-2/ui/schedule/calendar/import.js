// Import dates… (DESIGN 11.4, ARCHITECTURE 17.9): a calendar CSV, or any list
// of dates in its columns (a district's holidays are enough), read against
// the calendar and shown as what would change before anything does. Apply
// puts every change in place as one undo step, through the action
// importCalendarDates. A file that cannot be read, or names a day type or a
// bell schedule the project does not have, is refused whole with the
// engine's sentence (spec 3.7), and nothing changes.
//
// The action is SV2-77b's. The namespace import below finds it by name, so
// this file loads before it exists and says so on Apply if it is still not
// there.

import { h, uid } from '../../components/dom.js';
import * as actions from '../../../engine/actions.js';
import { readCalendarCsv, calendarImportText } from '../../../engine/import-calendar.js';
import { dateWords } from '../../../engine/calendar.js';
import { bellSchedulesOf } from '../../../engine/schema.js';
import { readText } from '../import/parts.js';
import { button, keyed } from '../common.js';

// "B Day with Early Release bells", "No school, Thanksgiving".
function stateWords(project, state) {
  if (!state) return '';
  if (!state.school) return 'No school' + (state.label ? ', ' + state.label : '');
  const dayType = project.dayTypes.find((each) => each.id === state.dayTypeId);
  const schedule = state.bellsId ? bellSchedulesOf(project).find((each) => each && each.id === state.bellsId) : null;
  return (dayType ? dayType.name : '') + (schedule ? ' with ' + schedule.name + ' bells' : '') + (state.label ? ', ' + state.label : '');
}

export function openImportDialog(env, opener) {
  const { ctx } = env;
  const project = ctx.store.project;
  let reading = null;
  const pasteId = uid('cal-paste');
  const says = h('p', { class: 'cal-import__says', role: 'status', data: { says: 'import' } }, 'Choose a CSV file, or paste the rows. Only the Date column is needed; Day type, Bells and Note are read when there.');
  const preview = h('div', { class: 'cal-import__preview', data: { part: 'import-preview' } });
  const paste = keyed(h('textarea', { id: pasteId, class: 'field__input cal-import__paste', rows: '5', spellcheck: 'false', autocomplete: 'off' }), 'cal-import-paste');

  const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: 'calendar' } });

  function take(name, text) {
    const now = ctx.store.project;
    try {
      reading = readCalendarCsv(now, text);
    } catch (error) {
      reading = null;
      says.textContent = (name ? name + ': ' : '') + (error && error.message ? error.message : 'This file could not be read.') + ' Nothing has changed.';
      preview.replaceChildren();
      go.disabled = true;
      go.textContent = 'Apply';
      return;
    }
    const changes = reading.counts.changes;
    const text2 = calendarImportText(now, reading);
    says.textContent = (name ? name + ': ' : '') + text2.charAt(0).toUpperCase() + text2.slice(1) + '.' + (reading.movedFrom ? ' Later dates move too, from ' + dateWords(reading.movedFrom) + '.' : '');
    const changed = reading.rows.filter((row) => row.status === 'change');
    preview.replaceChildren(changed.length === 0 ? h('p', { class: 'sch-hint' }, 'Nothing in it changes the calendar.') : h('table', { class: 'cal-import__table' },
      h('caption', { class: 'vh' }, 'What changes'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Now'), h('th', { scope: 'col' }, 'After'))),
      h('tbody', null, changed.map((row) => h('tr', null, h('th', { scope: 'row' }, dateWords(row.date, { weekday: true })), h('td', null, stateWords(now, row.before)), h('td', null, stateWords(now, row.after)))))));
    go.disabled = changes === 0;
    go.textContent = changes === 0 ? 'Apply' : 'Apply: ' + changes + (changes === 1 ? ' date changes' : ' dates change');
  }

  file.addEventListener('change', () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    readText(chosen, true).then((text) => take(chosen.name, text), (error) => take(chosen.name, ''));
    file.value = '';
  });

  const dialog = ctx.openDialog({
    id: 'calendar-import',
    wide: true,
    title: 'Import dates into the calendar',
    opener,
    body: [
      says,
      h('div', { class: 'cal-import__choose' },
        button('Choose a file', () => file.click(), { key: 'cal-import-choose', action: 'choose-calendar' }), file),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: pasteId }, 'Or paste rows, the header first'), paste),
      button('Read what is pasted', () => take('', paste.value), { key: 'cal-import-read', action: 'read-pasted' }),
      preview,
    ],
    buttons: [{ label: 'Apply', value: 'go', kind: 'primary' }, { label: 'Cancel', value: null }],
  });
  const go = dialog.element.querySelector('.dialog__buttons .btn--primary');
  go.dataset.action = 'apply-import';
  go.disabled = true;
  // the input is the way a test hands a file in, too
  dialog.element.calendarRead = (name, text) => take(name, text);

  dialog.closed.then((answer) => {
    if (answer !== 'go' || !reading) return;
    if (typeof actions.importCalendarDates !== 'function') {
      ctx.toast({ kind: 'problem', text: 'Importing dates is not in this copy of the planner yet. Nothing has changed.' });
      return;
    }
    const text = calendarImportText(ctx.store.project, reading);
    try {
      ctx.store.apply(actions.importCalendarDates, { changes: reading.changes });
    } catch (error) {
      ctx.toast({ kind: 'problem', text: (error && error.message ? error.message : 'The dates could not be imported.') + ' Nothing has changed.' });
      return;
    }
    ctx.toast({ text: 'Imported dates: ' + text + '.', action: { label: 'Undo', run: ctx.undo } });
  });
  return dialog;
}
