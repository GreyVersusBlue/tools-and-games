// The setup card (DESIGN 11.4), opened in place by Make a calendar: the
// first and last day; the school weekdays as seven toggles, Monday to Friday
// on, each with a Bells choice when there are other bell schedules ("Wednesdays:
// Early Release bells"); the rotation, the day types as chips in order,
// removable, with repeats; breaks and holidays, rows of from, to and a name,
// each saying how many school days it closes; and Make the calendar.
//
// What is typed and chosen waits in `view.calSetup` until Make the calendar,
// so a redraw (or a visit to another tab) keeps it. The rules are the
// engine's: makeCalendar refuses what it refuses and its sentence is shown.

import { h } from '../../components/dom.js';
import { makeCalendar } from '../../../engine/actions.js';
import { calendarDays, dateWords, datesFrom, daysBetween, isCalendarDate } from '../../../engine/calendar.js';
import { bellSchedulesOf, DAY_ROTATION, DAY_CLOSED, ROTATION_RANGE, DATE_LABEL_MOST, WEEKDAY_NAMES } from '../../../engine/schema.js';
import { keyed, button } from '../common.js';
import { rotationChips, dateInput } from './parts.js';

// A new setup: the school year this date is in (from 1 September to mid
// June), Monday to Friday, every day type in the rotation, no breaks.
export function freshSetup(project, today) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const first = month >= 7 ? year : year - 1;
  return {
    // whose setup this is: another project does not inherit it
    projectId: project.id,
    start: first + '-09-01',
    end: (first + 1) + '-06-15',
    days: WEEKDAY_NAMES.map((name, index) => ({ on: index < 5, bells: null })),
    rotation: project.dayTypes.slice(0, ROTATION_RANGE[1]).map((dayType) => dayType.id),
    breaks: [],
    refusal: '',
  };
}

// The school days a break would close, by the setup as it stands.
function breakDays(project, state, item) {
  if (!isCalendarDate(state.start) || !isCalendarDate(state.end) || !isCalendarDate(item.from)) return null;
  const to = isCalendarDate(item.to) ? item.to : item.from;
  if (to < item.from || state.end < state.start || daysBetween(state.start, state.end) > 730) return null;
  const calendar = { start: state.start, end: state.end, weekdays: weekdaysOf(state), rotation: state.rotation.length > 0 ? state.rotation : [project.dayTypes[0].id], dates: [] };
  const days = calendarDays({ ...project, calendar });
  const inside = new Set(datesFrom(item.from < state.start ? state.start : item.from, to > state.end ? state.end : to));
  return days.filter((day) => day.school && inside.has(day.date)).length;
}

function weekdaysOf(state) {
  return state.days.map((day) => ({ day: day.on ? DAY_ROTATION : DAY_CLOSED, bells: day.on ? day.bells : null }));
}

export function setupCard(env, project, done) {
  const { ctx, view } = env;
  const state = view.calSetup;
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');

  const start = dateInput('cal-setup-start', 'First day', state.start, (value) => {
    state.start = value;
  }, () => env.render());
  const end = dateInput('cal-setup-end', 'Last day', state.end, (value) => {
    state.end = value;
  }, () => env.render());

  const weekdays = h('ul', { class: 'cal-weekdays', role: 'list' }, WEEKDAY_NAMES.map((name, index) => {
    const day = state.days[index];
    const toggle = keyed(h('button', {
      type: 'button',
      class: 'cal-toggle',
      'aria-pressed': String(day.on),
      on: {
        click: () => {
          day.on = !day.on;
          env.render('cal-setup-day:' + index);
        },
      },
    }, name), 'cal-setup-day:' + index);
    let bells = null;
    if (schedules.length > 0 && day.on) {
      const select = keyed(h('select', { class: 'field__input cal-select', 'aria-label': name + 's: bells', on: { change: (event) => { day.bells = event.target.value === '' ? null : event.target.value; } } },
        h('option', { value: '' }, 'Regular bells'),
        schedules.map((schedule) => h('option', { value: schedule.id }, schedule.name + ' bells'))), 'cal-setup-bells:' + index);
      select.value = day.bells || '';
      bells = select;
    }
    return h('li', { class: 'cal-weekday' }, toggle, bells);
  }));

  const rotation = rotationChips(project, state.rotation, {
    keyBase: 'cal-setup-rotation',
    remove(index) {
      state.rotation.splice(index, 1);
      env.render(state.rotation.length > 0 ? 'cal-setup-rotation-add' : 'cal-setup-rotation-add');
    },
    add(id) {
      if (state.rotation.length >= ROTATION_RANGE[1]) return;
      state.rotation.push(id);
      env.render('cal-setup-rotation-add');
    },
  });

  const breaks = h('ul', { class: 'cal-breaks', role: 'list' }, state.breaks.map((item, index) => {
    const from = dateInput('cal-setup-break:' + index + ':from', 'From', item.from, (value) => {
      item.from = value;
    }, () => env.render());
    const to = dateInput('cal-setup-break:' + index + ':to', 'To', item.to, (value) => {
      item.to = value;
    }, () => env.render());
    const nameId = 'cal-setup-break-' + index + '-name';
    const name = keyed(h('input', { type: 'text', id: nameId, class: 'field__input', maxlength: String(DATE_LABEL_MOST), autocomplete: 'off', on: { input: (event) => { item.label = event.target.value; } } }), 'cal-setup-break:' + index + ':name');
    name.value = item.label;
    const counted = breakDays(project, state, item);
    return h('li', { class: 'cal-break', data: { index: String(index) } },
      from.element, to.element,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: nameId }, 'Name'), name),
      h('p', { class: 'cal-break__count', data: { says: 'break-days' } }, counted === null ? '' : counted + (counted === 1 ? ' school day' : ' school days')),
      button('Remove', () => {
        state.breaks.splice(index, 1);
        env.render('cal-setup-add-break');
      }, { small: true, key: 'cal-setup-break:' + index + ':remove', more: ' the break ' + (item.label || dateWords(item.from || state.start)) }));
  }));

  const refusal = h('p', { class: 'field__refusal', role: 'alert', hidden: state.refusal === '' }, state.refusal);

  function make() {
    const payload = {
      start: state.start,
      end: state.end,
      weekdays: weekdaysOf(state),
      rotation: state.rotation.slice(),
      breaks: state.breaks.filter((item) => item.from !== '' || item.to !== '' || item.label !== '').map((item) => ({ from: item.from, to: item.to === '' ? item.from : item.to, label: item.label })),
    };
    try {
      ctx.store.apply(makeCalendar, payload);
    } catch (error) {
      state.refusal = error && error.message ? error.message : 'The calendar could not be made. Try again.';
      env.render('cal-make');
      return;
    }
    const outcome = ctx.store.undoOutcome;
    view.calSetup = null;
    const school = calendarDays(ctx.store.project).filter((day) => day.school).length;
    ctx.toast({ text: 'Made the calendar: ' + school + (school === 1 ? ' school day' : ' school days') + ' from ' + dateWords(payload.start) + ' to ' + dateWords(payload.end) + '.' + (outcome && outcome.text ? ' ' + outcome.text + '.' : ''), action: { label: 'Undo', run: ctx.undo } });
    done();
  }

  return h('section', { class: 'sch-card cal-setup', data: { card: 'calendar-setup' }, 'aria-labelledby': 'cal-setup-title' },
    h('h2', { class: 'sch-card__title', id: 'cal-setup-title' }, 'Make a calendar'),
    h('p', { class: 'sch-hint' }, 'Say when the year runs, which weekdays have school, and the order the day types come round in. Every date can be changed afterwards.'),
    h('div', { class: 'cal-range' }, start.element, end.element),
    h('fieldset', { class: 'sch-fieldset cal-group' }, h('legend', null, 'School weekdays'), weekdays),
    h('fieldset', { class: 'sch-fieldset cal-group' }, h('legend', null, 'The rotation'), h('p', { class: 'sch-hint' }, 'The day types in the order they come round. A day type can come more than once.'), rotation),
    h('fieldset', { class: 'sch-fieldset cal-group' }, h('legend', null, 'Breaks and holidays'),
      h('p', { class: 'sch-hint' }, 'A break has no school on the school days it covers.'),
      breaks,
      button('Add a break', () => {
        state.breaks.push({ from: '', to: '', label: '' });
        env.render('cal-setup-break:' + (state.breaks.length - 1) + ':from');
      }, { key: 'cal-setup-add-break' })),
    refusal,
    h('div', { class: 'cal-actions' },
      button('Make the calendar', make, { primary: true, key: 'cal-make', action: 'make-calendar' }),
      button('Cancel', () => {
        view.calSetup = null;
        env.render('cal-start');
      }, { key: 'cal-setup-cancel' })));
}
