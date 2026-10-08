// The Settings card: every row of spec 16, each with one line that says what
// it does. A change takes effect at once and is one undo step. There is no
// Save button: a field commits when it is left or Enter is pressed.

import { h, uid } from '../components/dom.js';
import { card } from '../components/card.js';
import { field, wholeNumber } from '../components/field.js';
import { choice } from '../components/choice.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { count, list, periodWords } from '../components/words.js';
import { setSetting, resetSettings, describePeriodChange } from '../../engine/actions.js';
import { CHECK_KINDS, RANGES } from '../../engine/schema.js';
import { isOwnCopy } from '../../engine/day-types.js';

const LETTER_REGIONS = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'PA', 'GT', 'DO', 'PR', 'SV', 'HN', 'NI', 'BO'];

// The paper a device's region uses: US Letter in North America and a few
// other countries, A4 everywhere else.
export function paperForRegion(locale) {
  let region = '';
  try {
    region = new Intl.Locale(locale).maximize().region || '';
  } catch (error) {
    region = '';
  }
  return LETTER_REGIONS.includes(region) ? 'letter' : 'a4';
}

// What each check is called, in the words of spec 5.7.
export function checkLabel(kind, words) {
  const labels = {
    'room-double': 'Two groups in one room',
    'teacher-double': 'A teacher in two places at once',
    'over-capacity': 'More students than a room holds',
    'no-planning': 'A teacher with no planning ' + words.one,
    consecutive: 'A teacher with too many ' + words.many + ' in a row',
    'teacher-walk': 'A teacher’s walk that is too long',
    'group-walk': 'A group’s walk that is too long',
    'room-missing': 'A room that is not in the building',
    'empty-period': 'A group with an empty ' + words.one,
    'teacher-multi-room': 'A teacher with more than one room',
    'teacher-room-unused': 'A teacher whose room is never used',
    'room-unused': 'A room nobody is scheduled into',
    'room-no-subject': 'A room with no subject',
    'room-no-teacher': 'A room with no teacher',
  };
  return labels[kind] || kind;
}

// "4" or "4:30" or "4.5" (minutes) to seconds.
export function parsePassing(text) {
  const trimmed = text.trim();
  let seconds = null;
  if (/^\d+$/.test(trimmed)) seconds = Number(trimmed) * 60;
  else if (/^\d+:[0-5]\d$/.test(trimmed)) seconds = Number(trimmed.split(':')[0]) * 60 + Number(trimmed.split(':')[1]);
  else if (/^\d*\.\d+$/.test(trimmed)) seconds = Math.round(Number(trimmed) * 60);
  if (seconds === null) throw new Error('The passing time is minutes, like 4, or minutes and seconds, like 4:30. "' + text + '" is neither.');
  return seconds;
}

export function formatPassing(seconds) {
  const whole = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? String(whole) : whole + ':' + String(rest).padStart(2, '0');
}

export function parseBands(text) {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== '');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) throw new Error('The bands are four whole numbers, each larger than the one before, like 10, 25, 50, 100.');
  return parts.map(Number);
}

const WISH = 'Not in the tool yet.';

export function settingsCard(ctx) {
  const rows = [];
  const body = h('div', { class: 'settings' });

  const set = (key, value) => ctx.store.apply(setSetting, { key, value });

  // One row: the name and its one-line explanation on the left, the control on
  // the right. `make(labelId, hintId)` returns { element, sync(project) }.
  function row(group, name, hint, make) {
    const labelId = uid('setting');
    const hintId = labelId + '-hint';
    const label = h('span', { class: 'setting__label', id: labelId });
    const explanation = h('p', { class: 'setting__hint', id: hintId });
    const control = make(labelId, hintId);
    const element = h('div', { class: 'setting', data: { setting: group.id + '.' + rows.length } },
      h('div', { class: 'setting__text' }, label, explanation),
      h('div', { class: 'setting__control' }, control.element),
    );
    group.element.append(element);
    rows.push({
      sync(project) {
        const words = periodWords(project.settings);
        label.textContent = typeof name === 'function' ? name(words) : name;
        explanation.textContent = typeof hint === 'function' ? hint(words, project) : hint;
        if (control.sync) control.sync(project);
      },
    });
    return element;
  }

  function group(id, title) {
    const titleId = uid('settings-group');
    const element = h('div', { class: 'settings__group', role: 'group', 'aria-labelledby': titleId }, h('h3', { class: 'eyebrow settings__title', id: titleId }, title));
    body.append(element);
    return { id, element };
  }

  function text(key, read, options) {
    return (labelId, hintId) => {
      const control = field({
        value: read(ctx.store.project.settings),
        labelledBy: labelId,
        describedBy: hintId,
        name: key,
        width: options.width,
        inputMode: options.inputMode,
        parse: options.parse,
        format: options.format,
        placeholder: options.placeholder,
        commit: options.commit || ((value) => {
          set(key, value);
        }),
      });
      return { element: control.element, sync: (project) => control.set(read(project.settings)) };
    };
  }

  function number(key, read, what) {
    return text(key, read, { width: '6rem', inputMode: 'numeric', parse: wholeNumber(what) });
  }

  function pick(key, read, options) {
    return (labelId, hintId) => {
      const control = choice({ name: key, labelledBy: labelId, describedBy: hintId, options, value: read(ctx.store.project.settings), onChange: (value) => set(key, value) });
      return { element: control.element, sync: (project) => control.set(read(project.settings)) };
    };
  }

  // A row whose editing lives in another section: what is there, and the way.
  function summary(read, href, linkText) {
    return () => {
      const says = h('span', { class: 'setting__summary' });
      return { element: h('div', { class: 'setting__see' }, says, h('a', { href }, linkText)), sync: (project) => { says.textContent = read(project); } };
    };
  }

  function wish() {
    return () => ({ element: h('span', { class: 'setting__wish' }, WISH) });
  }

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
    set('periods', periods);
    return true;
  }

  // ---- School
  const school = group('school', 'School');
  row(school, 'School name', 'Shown in the top bar and on everything printed or published. Until it is set, the tool shows its own name.',
    text('schoolName', (s) => s.schoolName, { width: '100%', placeholder: 'Schedule Visualizer 2' }));

  // ---- The day
  const day = group('day', 'The day');
  row(day, (w) => w.Many + ' per day', (w) => 'How many ' + w.many + ' there are in a day, from ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '.', (labelId, hintId) => {
    const control = field({
      value: ctx.store.project.settings.periods,
      labelledBy: labelId,
      describedBy: hintId,
      name: 'periods',
      width: '6rem',
      inputMode: 'numeric',
      parse: wholeNumber('The number of ' + periodWords(ctx.store.project.settings).many + ' per day'),
      commit: (value) => commitPeriods(value, control.input),
    });
    return { element: control.element, sync: (project) => control.set(project.settings.periods) };
  });
  row(day, 'Period word', 'What your school calls one slot of the day. The word you pick is used everywhere.',
    pick('periodWord', (s) => s.periodWord, ['Period', 'Mod', 'Block', 'Hour'].map((word) => ({ value: word, label: word }))));
  row(day, 'Day types', 'The named patterns of the day. At least two.',
    summary((project) => list(project.dayTypes.map((dayType, index) => dayType.name + (index > 0 && !isOwnCopy(project, dayType.id) ? ' (same as ' + project.dayTypes[0].name + ')' : ''))), '#schedule/day', 'Edit under Schedule › Day'));
  row(day, 'Bell schedules', (w) => 'When each ' + w.one + ' starts and ends, for each day type.',
    summary((project) => {
      const entered = project.dayTypes.filter((dayType) => isOwnCopy(project, dayType.id) && dayType.bells.some((bell) => bell !== null));
      return entered.length === 0 ? 'None entered' : 'Entered for ' + list(entered.map((dayType) => dayType.name));
    }, '#schedule/day', 'Edit under Schedule › Day'));
  row(day, 'Default passing time', (w) => 'Minutes between one ' + w.one + ' and the next, used wherever the bells do not say. Write 4, or 4:30 for four and a half.',
    text('defaultPassingSeconds', (s) => s.defaultPassingSeconds, { width: '6rem', parse: parsePassing, format: formatPassing }));
  row(day, 'Calendar', 'Which day type each date of the year is.', wish());
  row(day, 'Subjects', 'The departments, each with a code, a name and a colour.',
    summary((project) => count(project.subjects.length, 'subject'), '#schedule/subjects', 'Edit under Schedule › Subjects'));

  // ---- Movement
  const movement = group('movement', 'Movement');
  row(movement, 'Default head count', 'How many students are in a group that has no head count of its own.',
    number('defaultHeadCount', (s) => s.defaultHeadCount, 'The default head count'));
  row(movement, 'Seconds per corridor cell', 'How long it takes to walk one square of corridor.',
    number('secondsPerCell', (s) => s.secondsPerCell, 'Seconds per corridor cell'));
  row(movement, 'Seconds per stair connection', 'How long the stairs take, for each floor climbed or descended.',
    number('secondsPerStair', (s) => s.secondsPerStair, 'Seconds per stair connection'));
  row(movement, 'Cell scale', 'How long one square is in metres or feet.', wish());
  row(movement, 'Colour scale', 'Relative colours the busiest corridor in this school as the top band. Absolute uses the numbers in the next row.',
    pick('colourScale.mode', (s) => s.colourScale.mode, [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }]));
  row(movement, 'Absolute bands', 'The load at which the second, third, fourth and fifth bands begin.',
    text('colourScale.bands', (s) => s.colourScale.bands, { width: '12rem', parse: parseBands, format: (bands) => bands.join(', ') }));

  // ---- Checks
  const checks = group('checks', 'Checks');
  row(checks, 'Consecutive-periods limit', (w) => 'The most ' + w.many + ' in a row a teacher can teach before a check says so.',
    number('checks.consecutiveLimit', (s) => s.checks.consecutiveLimit, 'The consecutive-periods limit'));
  row(checks, 'Passing margin', 'Seconds a walk may run past the passing time before it counts as late.',
    number('checks.passingMarginSeconds', (s) => s.checks.passingMarginSeconds, 'The passing margin in seconds'));
  row(checks, 'Checks switched off', 'A check that is switched off reports nothing. Pick one to switch it off; remove it from the list to switch it back on.', (labelId, hintId) => {
    const chips = h('ul', { class: 'chips', 'aria-labelledby': labelId });
    const none = h('p', { class: 'setting__summary' }, 'None. Every check is on.');
    const control = picker({
      labelledBy: labelId,
      describedBy: hintId,
      listLabel: 'Checks that are on',
      placeholder: 'Switch a check off…',
      emptyText: 'No check that is on matches.',
      options: () => {
        const words = periodWords(ctx.store.project.settings);
        const off = ctx.store.project.settings.checks.off;
        return CHECK_KINDS.filter((kind) => !off.includes(kind)).map((kind) => ({ id: kind, label: checkLabel(kind, words) }));
      },
      onPick: (option) => set('checks.off', ctx.store.project.settings.checks.off.concat([option.id])),
    });
    return {
      element: h('div', { class: 'setting__stack' }, control.element, none, chips),
      sync(project) {
        const words = periodWords(project.settings);
        const off = project.settings.checks.off;
        none.hidden = off.length > 0;
        chips.hidden = off.length === 0;
        chips.replaceChildren(...off.map((kind) => h('li', { class: 'chip', data: { check: kind } },
          h('span', null, checkLabel(kind, words)),
          h('button', {
            type: 'button',
            class: 'chip__remove',
            'aria-label': 'Switch back on: ' + checkLabel(kind, words),
            on: {
              click: () => {
                set('checks.off', ctx.store.project.settings.checks.off.filter((other) => other !== kind));
                control.input.focus();
              },
            },
          }, icon('close', 14)),
        )));
      },
    };
  });

  // ---- Display and printing
  const display = group('display', 'Display and printing');
  row(display, 'Time format', 'How times are written: 2:05 PM or 14:05.',
    pick('timeFormat', (s) => s.timeFormat, [{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]));
  row(display, 'Paper size', 'The paper that prints are laid out for. It starts as the size this device’s region uses.',
    pick('paper.size', (s) => s.paper.size, [{ value: 'letter', label: 'US Letter' }, { value: 'a4', label: 'A4' }]));
  row(display, 'Paper orientation', 'Which way up a print starts. Each print preview can still turn its own page.',
    pick('paper.orientation', (s) => s.paper.orientation, [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]));
  row(display, 'Theme', 'Light or dark. Follow the device uses whichever this device is set to.',
    pick('theme', (s) => s.theme, [{ value: 'auto', label: 'Follow the device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]));
  row(display, 'North direction', 'Which way is north on the plan.', wish());

  const resetButton = h('button', {
    type: 'button',
    class: 'btn',
    data: { action: 'reset-settings' },
    on: {
      click: () => {
        const before = ctx.store.project;
        const after = ctx.store.apply(resetSettings, { paperSize: ctx.devicePaper() });
        if (after === before) ctx.toast({ text: 'The settings are already the defaults.' });
        else ctx.toast({ text: 'Reset the settings to their defaults.', action: { label: 'Undo', run: ctx.undo } });
      },
    },
  }, 'Reset to defaults');
  const resetNote = h('p', { class: 'setting__hint' });

  const element = card({ id: 'settings', title: 'Settings' },
    h('p', { class: 'card__lead' }, 'Each change takes effect at once and can be undone.'),
    body,
    h('div', { class: 'settings__reset' }, resetButton, resetNote),
  );

  function update(project) {
    for (const each of rows) each.sync(project);
    const words = periodWords(project.settings);
    resetNote.textContent = 'Resets the settings above and nothing else: the building and the schedule stay, and so does the number of ' + words.many + ' per day. It can be undone.';
  }

  update(ctx.store.project);
  return { element, update };
}
