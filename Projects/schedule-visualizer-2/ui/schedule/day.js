// The Day tab: how many periods the day has, what the school calls them, and
// each day type with its bell times. A day type with nothing of its own is
// "the same as A Day" until it is made its own copy.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { choice } from '../components/choice.js';
import { count, list, periodWords } from '../components/words.js';
import { setPeriods, setSetting, describePeriodChange, renameDayType, makeOwnCopy, revertToBase, describeRevert, setBell } from '../../engine/actions.js';
import { isOwnCopy, baseDayType } from '../../engine/day-types.js';
import { bellsFor, bellFindings, periodName, formatTime } from '../../engine/bells.js';
import { formatDuration } from '../../engine/findings.js';
import { PERIOD_WORDS, RANGES } from '../../engine/schema.js';
import { fill, apply, button, keyed } from './common.js';

// What a person types for a time, as "HH:MM" on the 24-hour clock; '' is no
// time. "8:05", "805", "2:10 pm" and "14:10" are all read. With the 12-hour
// clock chosen and no am or pm typed, 1 to 6 are taken as the afternoon,
// since no school day starts then.
export function parseClock(text, timeFormat) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return null;
  const match = trimmed.match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(a|p)?\.?m?\.?$/);
  const sorry = '"' + text + '" is not a time. Type it like 8:05 or 2:10 pm.';
  if (!match) throw new Error(sorry);
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (match[3]) {
    if (hours < 1 || hours > 12) throw new Error(sorry);
    hours = (hours % 12) + (match[3] === 'p' ? 12 : 0);
  } else if (timeFormat === '12h' && hours >= 1 && hours <= 6) {
    hours += 12;
  }
  if (hours > 23 || minutes > 59) throw new Error(sorry);
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-daytab' });
  // a start typed with no end yet (or the other way round) waits here
  if (!view.halfBells) view.halfBells = new Map();

  async function commitPeriods(periods, input) {
    const project = ctx.store.project;
    const words = periodWords(project.settings);
    const info = describePeriodChange(project, periods);
    if (info.losesData) {
      const names = info.removedPeriods.map((period) => period.name);
      const what = names.length <= 3 ? list(names) : 'the last ' + names.length + ' ' + words.many;
      const lost = [];
      if (info.slots > 0) lost.push(count(info.slots, 'room entry', 'room entries') + ' in ' + count(info.groups.length, 'group'));
      if (info.bells > 0) lost.push(count(info.bells, 'bell time'));
      if (info.scenarioChanges > 0) lost.push(count(info.scenarioChanges, 'scenario change'));
      const ok = await ctx.confirm({
        title: 'Remove ' + what + ' from every day?',
        body: 'That takes away ' + list(lost) + '. Undo brings them back.',
        action: 'Remove ' + what,
        keep: 'Keep ' + count(info.from, words.one, words.many),
        danger: true,
        opener: input,
      });
      if (!ok) return false;
    }
    ctx.store.apply(setPeriods, { periods });
    return true;
  }

  function dayBasics(project) {
    const words = periodWords(project.settings);
    const periodsHint = uid('hint');
    const periods = field({
      label: words.Many + ' per day',
      value: project.settings.periods,
      name: 'periods',
      width: '6rem',
      inputMode: 'numeric',
      describedBy: periodsHint,
      parse: wholeNumber('The number of ' + words.many + ' per day'),
      commit: (value) => commitPeriods(value, periods.input),
    });
    keyed(periods.input, 'day-periods');
    const wordLabel = uid('word');
    const word = choice({
      name: 'sch-period-word',
      labelledBy: wordLabel,
      options: PERIOD_WORDS.map((value) => ({ value, label: value })),
      value: project.settings.periodWord,
      onChange: (value) => apply(env, setSetting, { key: 'periodWord', value }),
    });
    word.element.querySelectorAll('input').forEach((input) => keyed(input, 'day-word:' + input.value));
    return h('div', { class: 'sch-daytab__basics' },
      h('div', null, periods.element, h('p', { class: 'sch-hint', id: periodsHint }, 'From ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '. Taking some away asks first, and says what would go.')),
      h('div', { class: 'field' }, h('span', { class: 'field__label', id: wordLabel }, 'What the school calls one'), word.element,
        h('p', { class: 'sch-hint' }, 'Blocks are lettered and hours are counted: ' + periodName({ periodWord: 'Block' }, 2) + ', ' + periodName({ periodWord: 'Hour' }, 2) + '.')));
  }

  function bellField(project, dayType, period, which, half) {
    const settings = project.settings;
    const stored = dayType.bells[period];
    const key = dayType.id + ':' + period;
    const value = stored ? stored[which] : half ? half[which] : null;
    const control = field({
      value,
      name: 'bell-' + which,
      width: '7rem',
      placeholder: settings.timeFormat === '24h' ? '08:05' : '8:05',
      format: (time) => (time ? formatTime(time, settings.timeFormat) : ''),
      parse: (text) => parseClock(text, settings.timeFormat),
      commit: (time) => {
        const before = stored || view.halfBells.get(key) || { start: null, end: null };
        const next = { ...before, [which]: time };
        if (next.start && next.end) {
          view.halfBells.delete(key);
          ctx.store.apply(setBell, { dayTypeId: dayType.id, period, bell: next });
        } else if (!next.start && !next.end) {
          view.halfBells.delete(key);
          ctx.store.apply(setBell, { dayTypeId: dayType.id, period, bell: null });
        } else if (stored) {
          throw new Error('A ' + periodWords(settings).one + ' needs both times. Empty both to take them away.');
        } else {
          view.halfBells.set(key, next);
        }
        env.render();
      },
    });
    control.input.setAttribute('aria-label', periodName(settings, period) + ' on ' + dayType.name + (which === 'start' ? ' starts at' : ' ends at'));
    keyed(control.input, 'bell:' + key + ':' + which);
    return control.element;
  }

  function bellTable(project, dayType, own) {
    const settings = project.settings;
    const words = periodWords(settings);
    const bells = bellsFor(project, dayType.id);
    const found = own ? bellFindings(project, dayType.id) : [];
    return h('table', { class: 'table sch-bells' + (own ? '' : ' sch-bells--same') },
      h('caption', { class: 'vh' }, 'Bell times on ' + dayType.name),
      h('thead', null, h('tr', null, [words.One, 'Starts', 'Ends', 'Passing time after'].map((label) => h('th', { scope: 'col' }, label)), own ? h('th', { scope: 'col' }, 'Noticed') : null)),
      h('tbody', null, bells.map((bell, period) => {
        const half = view.halfBells.get(dayType.id + ':' + period);
        const mine = found.filter((finding) => finding.period === period);
        const passing = bell.passingAfter === null ? '' : formatDuration(bell.passingAfter) + (bell.passingFromBells ? '' : ' (the usual)');
        return h('tr', { data: { period: String(period) } },
          h('th', { scope: 'row' }, periodName(settings, period)),
          h('td', null, own ? bellField(project, dayType, period, 'start', half) : formatTime(bell.start, settings.timeFormat) || '—'),
          h('td', null, own ? bellField(project, dayType, period, 'end', half) : formatTime(bell.end, settings.timeFormat) || '—'),
          h('td', null, passing),
          own ? h('td', { class: 'sch-bells__found' },
            half && !dayType.bells[period] ? h('p', { class: 'sch-hint' }, 'Add the other time to keep this one.') : null,
            mine.map((finding) => h('p', { class: 'sch-finding-line sch-finding-line--warning', data: { bell: finding.kind } }, finding.message))) : null);
      })));
  }

  function dayType(project, type) {
    const base = baseDayType(project);
    const own = isOwnCopy(project, type.id);
    const titleId = uid('daytype');
    const name = field({ label: 'Name', value: type.name, name: 'dayTypeName', width: '14rem', commit: (value) => {
      ctx.store.apply(renameDayType, { dayTypeId: type.id, name: value });
    } });
    keyed(name.input, 'daytype:' + type.id + ':name');
    let line = null;
    if (!own) {
      line = h('p', { class: 'sch-day__line' }, type.name + ': same as ' + base.name + ' · ',
        button('Make its own copy', () => apply(env, makeOwnCopy, { dayTypeId: type.id }), { small: true, key: 'own:' + type.id, action: 'make-own', name: 'Make ' + type.name + ' its own copy' }));
    } else if (type !== base) {
      line = h('p', { class: 'sch-day__line' }, type.name + ' is its own copy, with its own bell times and its own rooms for every group. ',
        button('Make it the same as ' + base.name, () => {
          const info = describeRevert(ctx.store.project, type.id);
          if (!apply(env, revertToBase, { dayTypeId: type.id })) return;
          const lost = [];
          if (info.slots > 0) lost.push(count(info.slots, 'room entry', 'room entries') + ' in ' + count(info.groups, 'group'));
          if (info.bells > 0) lost.push(count(info.bells, 'bell time'));
          ctx.toast({ text: type.name + ' is the same as ' + base.name + ' again.' + (lost.length > 0 ? ' Its own ' + list(lost) + ' went with that.' : ''), action: { label: 'Undo', run: ctx.undo } });
        }, { small: true, key: 'revert:' + type.id, action: 'revert', name: 'Make ' + type.name + ' the same as ' + base.name }));
    }
    return h('section', { class: 'sch-daytype' + (own ? '' : ' sch-daytype--same'), 'aria-labelledby': titleId, data: { day: type.id } },
      h('h2', { class: 'sch-daytype__title', id: titleId }, type.name),
      name.element,
      line,
      h('div', { class: 'sch-scroll' }, bellTable(project, type, own)));
  }

  function draw(project) {
    const words = periodWords(project.settings);
    fill(element, 
      h('p', { class: 'sch-lead' }, 'The day is ' + count(project.settings.periods, words.one, words.many) + ' long. A day type is a named pattern of the day, with its own bell times.'),
      dayBasics(project),
      h('div', { class: 'sch-daytypes' }, project.dayTypes.map((type) => dayType(project, type))));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
