// The Calendar tab (DESIGN 11.4, ARCHITECTURE 17.4): which day type, and
// which bells, each date of the year is.
//
//   No calendar     "No calendar yet." and Make a calendar, which opens the
//                   setup card in place (calendar/setup.js).
//   A calendar      the year, month by month (calendar/year.js); a status
//                   line for a run of dates chosen; "Every date as a list"
//                   (calendar/list.js); and the panel (calendar/panel.js), in
//                   the inspector on a wide screen and under the year where
//                   the inspector is a sheet.
//
// A date is changed in the date dialog (calendar/dialog.js), through the
// action setCalendarDates; the toast says what changed, and when later dates
// moved, from where ("No school on 26 November. The rotation moves back a
// day from 27 November. · Undo"). Under 640 px, and when the text is enlarged
// past what a square holds, the list is open and the squares are folded
// behind "Show the months".
//
// Every rule is the engine's (engine/calendar.js, engine/actions.js); the
// words are calendar/model.js's, which the print shares.

import { h } from '../components/dom.js';
import { setCalendarDates } from '../../engine/actions.js';
import { calendarOf } from '../../engine/schema.js';
import { calendarDays } from '../../engine/calendar.js';
import { emptyState, button, keyed } from './common.js';
import { SHEET as INSPECTOR_SHEET } from './checks.js';
import { createYear } from './calendar/year.js';
import { openDateDialog, closeDateDialog, dateDialogOpen } from './calendar/dialog.js';
import { setupCard, freshSetup } from './calendar/setup.js';
import { calendarPanel } from './calendar/panel.js';
import { dateTable } from './calendar/list.js';
import { todayOf, doneWords, movedWords } from './calendar/model.js';

export { CALENDAR_KEYS } from './calendar/year.js';

export const NARROW = '(max-width: 640px)';

// Text enlarged past what a square holds: the root's size at 150% or more.
function enlarged() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24;
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'cal-tab' });
  const status = h('p', { class: 'cal-status', role: 'status', 'aria-live': 'polite', data: { says: 'selection' } });
  const year = createYear({
    open: (from, to, cell) => openOn(from, to, cell),
    status: (text) => {
      if (status.textContent !== text) status.textContent = text;
    },
  });
  // the list, open or not, and whether the months are shown where they fold
  if (view.calList === undefined) view.calList = null;
  if (view.calMonths === undefined) view.calMonths = false;

  const list = h('details', { class: 'cal-list', data: { part: 'list-fold' } });
  const listSummary = keyed(h('summary', { class: 'cal-list__summary' }, 'Every date as a list'), 'cal-list');
  list.append(listSummary);
  // opened or shut by the drawing (a phone opens it), not by the person: the
  // choice stays the default's
  let opening = null;
  list.addEventListener('toggle', () => {
    if (opening === list.open) opening = null;
    else view.calList = list.open;
    fillList(ctx.store.project);
  });

  function fillList(project) {
    const table = list.querySelector('table');
    if (!list.open) {
      if (table) table.remove();
      return;
    }
    const made = dateTable(project, todayOf(ctx.clock()));
    if (table) table.replaceWith(made);
    else list.append(made);
  }

  const showMonths = keyed(h('button', { type: 'button', class: 'btn cal-show', 'aria-expanded': 'false', data: { action: 'show-months' }, on: { click: () => {
    view.calMonths = !view.calMonths;
    env.render('cal-show-months');
  } } }), 'cal-show-months');

  const lead = h('p', { class: 'sch-lead cal-lead' }, 'Each date shows its day type. Choose a date to change it; Shift with the arrows, or Through in the dialog, changes a run of dates.');
  // the panel's place under the year, where the inspector is a sheet
  const slot = h('div', { class: 'cal-slot' });

  // the date the dialog was opened from, for the focus to come back to
  let openedAt = null;

  function openOn(from, to, cell) {
    const project = ctx.store.project;
    openedAt = from;
    openDateDialog({
      project,
      from,
      to,
      opener: cell,
      choose: (a, b) => year.choose(a, b),
      apply: (dates, change) => applyChange(dates, change),
      closed: (back) => {
        const target = year.cellOf(openedAt);
        if (back && target && target.isConnected) year.focusDate(openedAt);
      },
    });
  }

  function applyChange(dates, change) {
    const before = ctx.store.project;
    try {
      ctx.store.apply(setCalendarDates, { dates, ...change });
    } catch (error) {
      return error && error.message ? error.message : 'That could not be done. Try again.';
    }
    const after = ctx.store.project;
    if (after === before) {
      ctx.toast({ text: 'Nothing changed: ' + (dates.length === 1 ? 'the date already says that.' : 'the dates already say that.') });
      return null;
    }
    const outcome = ctx.store.undoOutcome;
    const moved = movedWords(before, after, dates, change, outcome ? outcome.movedFrom : null);
    ctx.toast({ text: doneWords(after, dates, change) + (moved ? ' ' + moved : ''), action: { label: 'Undo', run: ctx.undo } });
    return null;
  }

  function update(project) {
    const calendar = calendarOf(project);
    const today = todayOf(ctx.clock());
    // a setup begun for another project (one loaded or started since) goes
    if (view.calSetup && view.calSetup.projectId !== project.id) view.calSetup = null;
    if (!calendar || calendarDays(project).length === 0) {
      closeDateDialog(false);
      env.side(null);
      year.update(project, today);
      if (view.calSetup) {
        element.replaceChildren(setupCard(env, project, () => {
          // the year's stop: today when the calendar has it, else its first day
          const days = calendarDays(ctx.store.project);
          const now = todayOf(ctx.clock());
          env.focusAfter('cal:' + (days.some((day) => day.date === now) ? now : days[0].date));
        }));
      } else {
        element.replaceChildren(emptyState('No calendar yet. A calendar says which day type each date is, so the staff browser knows what today is.', button('Make a calendar', () => {
          view.calSetup = freshSetup(ctx.store.project, todayOf(ctx.clock()));
          env.render('cal-setup-start');
        }, { primary: true, key: 'cal-start', action: 'make-a-calendar' }), 'calendar'));
      }
      return;
    }
    year.update(project, today);
    // a dialog open on a date the change took away from the calendar goes
    const open = dateDialogOpen();
    if (open && !year.cellOf(open.from)) closeDateDialog(false);

    const narrow = window.matchMedia(NARROW).matches || enlarged();
    const sheet = window.matchMedia(INSPECTOR_SHEET).matches;
    const listOpen = view.calList === null ? narrow : view.calList;
    if (list.open !== listOpen) {
      opening = listOpen;
      list.open = listOpen;
    } else {
      fillList(project);
    }
    const folded = narrow && !view.calMonths;
    showMonths.textContent = view.calMonths ? 'Hide the months' : 'Show the months';
    showMonths.setAttribute('aria-expanded', String(!folded));
    year.element.hidden = folded;

    const panel = calendarPanel(env, project, today);
    element.dataset.folded = String(folded);
    // the parts stay on the page from one drawing to the next, so the square
    // with the focus is never taken off it
    if (element.firstChild !== lead) element.replaceChildren(lead, showMonths, year.element, status, list, slot);
    showMonths.hidden = !narrow;
    slot.replaceChildren(...(sheet ? [panel] : []));
    env.side(sheet ? null : panel);
  }

  // drawn now: a tab that comes on screen without a change to the project
  // has nothing else to draw it
  update(ctx.store.project);

  return {
    element,
    update,
    // the tab leaves the page: the dialog and the inspector's part go with it
    unmount() {
      closeDateDialog(false);
      env.side(null);
    },
  };
}
