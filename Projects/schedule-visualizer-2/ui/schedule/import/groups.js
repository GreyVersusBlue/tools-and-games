// Groups from a spreadsheet saved as CSV (spec 5.6): choose the file, see
// what the tool takes each column for and correct it, see what would happen
// row by row, answer for the groups whose names are already here, import.
// Every rule is engine/import-groups.js; this file shows its answers and
// passes the user's choices back.

import { h } from '../../components/dom.js';
import { count, list, periodWords } from '../../components/words.js';
import { parse } from '../../../engine/csv.js';
import { ROLES, guessColumns, previewImport, mergeGroups, summaryText } from '../../../engine/import-groups.js';
import { buildExport } from '../../../engine/exports.js';
import { periodName } from '../../../engine/bells.js';
import { importGroups } from '../../../engine/actions.js';
import { button, keyed, quote, download } from '../common.js';
import { panel, fileButton, clashChooser, newPolicy, previewIds, runImport, doneLine, refusal } from './parts.js';

const WHAT = 'Save the spreadsheet as CSV, with a header row and one row for each group: its name, and the room number it is in each period.';

function roleLabel(role, words) {
  if (role === 'name') return 'Group name';
  if (role === 'grade') return 'Grade';
  if (role === 'headCount') return 'Head count';
  if (role === 'colour') return 'Colour';
  if (role === 'dayType') return 'Day type';
  if (role === 'period') return 'A ' + words.one + ' (room numbers)';
  return 'Ignore it';
}

// The first thing a column holds under its header, to recognise it by.
function sample(rows, column) {
  for (let r = 1; r < rows.length; r += 1) {
    const text = column < rows[r].length ? String(rows[r][column]) : '';
    if (text.trim() !== '') return text;
  }
  return '';
}

// What the import would do with the answers so far, by the rule that will do
// it: { summary } or { problem }.
function planOf(project, preview, policy) {
  const incoming = preview.groups.map((group) => ({ key: group.key, name: group.name, fields: group.fields, days: group.days }));
  try {
    return { summary: mergeGroups(project, incoming, policy, previewIds()).summary };
  } catch (error) {
    return { problem: error && error.message ? error.message : 'These answers cannot be used.' };
  }
}

// "Add 3 groups and replace 1": the button names what it does.
function actionLabel(summary) {
  const added = summary.created.length;
  const replaced = summary.overwritten.length;
  if (added > 0 && replaced > 0) return 'Add ' + count(added, 'group') + ' and replace ' + replaced;
  if (added > 0) return 'Add ' + count(added, 'group');
  if (replaced > 0) return 'Replace ' + count(replaced, 'group');
  return null;
}

export function groupsPanel(env, state) {
  const { ctx } = env;

  function take(fileName, text) {
    const read = parse(text);
    state.done.groups = null;
    if (read.rows.length === 0) {
      state.groups = null;
      state.refused.groups = quote(fileName) + ' has no rows. Choose a CSV file with a header row and one row for each group.';
      ctx.announce(state.refused.groups);
      env.render('imp-groups-choose');
      return;
    }
    state.refused.groups = null;
    state.groups = { fileName, rows: read.rows, warnings: read.warnings, mapping: guessColumns(read.rows[0], ctx.store.project), policy: newPolicy() };
    ctx.announce('Read ' + fileName + ': ' + count(read.rows.length - 1, 'row') + ' under the header. Check what each column is, then import.');
    env.render('imp-groups-choose');
  }

  function refuse(fileName, error) {
    state.groups = null;
    state.refused.groups = quote(fileName) + ' could not be read. ' + (error && error.message ? error.message : '');
    ctx.announce(state.refused.groups);
    env.render('imp-groups-choose');
  }

  function template() {
    const file = buildExport(ctx.store.project, 'groups-template', { date: ctx.clock() });
    download(file.fileName, file.mime, file.text);
    ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
  }

  function putAway() {
    state.groups = null;
    env.render('imp-groups-choose');
  }

  function setColumn(index, patch, key) {
    const loaded = state.groups;
    loaded.mapping = loaded.mapping.map((item, at) => (at === index ? { ...item, ...patch, note: '' } : item));
    env.render(key);
  }

  // The period a column newly set to "a period" starts as: the first one no
  // other column has.
  function freePeriod(project, mapping) {
    const used = new Set(mapping.filter((item) => item.role === 'period' && item.dayTypeId === null).map((item) => item.period));
    for (let period = 0; period < project.settings.periods; period += 1) if (!used.has(period)) return period;
    return 0;
  }

  function mappingTable(project, loaded) {
    const words = periodWords(project.settings);
    const hasDayColumn = loaded.mapping.some((item) => item.role === 'dayType');
    return h('div', { class: 'sch-scroll' }, h('table', { class: 'table imp-table imp-mapping' },
      h('caption', { class: 'vh' }, 'What each column of the file is'),
      h('thead', null, h('tr', null, ['Column in the file', 'First value', 'What it is', 'Which ' + words.one, 'Which day type'].map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', null, loaded.mapping.map((item, index) => {
        const key = 'imp-col:' + index + ':';
        const header = item.header.trim() === '' ? 'Column ' + (index + 1) + ' (no header)' : item.header;
        const role = keyed(h('select', { class: 'field__input', 'aria-label': 'What column ' + header + ' is' },
          ROLES.map((value) => h('option', { value }, roleLabel(value, words)))), key + 'role');
        role.value = item.role;
        role.addEventListener('change', () => {
          const next = role.value;
          setColumn(index, { role: next, period: next === 'period' ? freePeriod(project, loaded.mapping) : null, dayTypeId: null }, key + 'role');
        });
        let period = null;
        let day = null;
        if (item.role === 'period') {
          period = keyed(h('select', { class: 'field__input', 'aria-label': 'Which ' + words.one + ' column ' + header + ' is' },
            Array.from({ length: project.settings.periods }, (unused, at) => h('option', { value: String(at) }, periodName(project.settings, at)))), key + 'period');
          period.value = String(item.period);
          period.addEventListener('change', () => setColumn(index, { period: Number(period.value) }, key + 'period'));
          day = keyed(h('select', { class: 'field__input', 'aria-label': 'Which day type column ' + header + ' is for' },
            h('option', { value: '' }, hasDayColumn ? 'The one each row names' : project.dayTypes[0].name + ', or the block the row is under'),
            project.dayTypes.slice(hasDayColumn ? 0 : 1).map((dayType) => h('option', { value: dayType.id }, dayType.name))), key + 'day');
          // without a day column, "no day type" and the first day type are one thing
          day.value = item.dayTypeId === null || (!hasDayColumn && item.dayTypeId === project.dayTypes[0].id) ? '' : item.dayTypeId;
          day.addEventListener('change', () => setColumn(index, { dayTypeId: day.value === '' ? null : day.value }, key + 'day'));
        }
        return h('tr', { data: { column: String(index), role: item.role } },
          h('th', { scope: 'row' }, header),
          h('td', { class: 'imp-sample' }, sample(loaded.rows, index)),
          h('td', null, role, item.note ? h('p', { class: 'sch-hint' }, item.note) : null),
          h('td', null, period),
          h('td', null, day));
      }))));
  }

  // What happens to a row, in words, by the plan the answers make.
  function rowWords(line, plan) {
    if (line.status === 'heading') return line.reason;
    if (line.status === 'skip') return 'Left out. ' + line.reason;
    if (line.status === 'create') return 'A new group.';
    if (!plan.summary) return 'A group of this name is already here.';
    const renamed = plan.summary.renamed.find((entry) => entry.from === line.name);
    if (renamed) return 'Already here, so it is added as ' + quote(renamed.to) + '.';
    if (plan.summary.overwritten.includes(line.name)) return 'Already here: the group here takes these rooms.';
    if (plan.summary.unchanged.includes(line.name)) return 'Already here, and the same: nothing to change.';
    return 'Already here: skipped.';
  }

  function previewTable(project, preview, plan) {
    const many = project.dayTypes.length > 1;
    const dayName = (id) => (project.dayTypes.find((dayType) => dayType.id === id) || { name: '' }).name;
    // the rows scroll inside this region, so the keyboard has to be able to reach it
    return h('div', { class: 'sch-scroll imp-scroll', tabindex: '0', role: 'region', 'aria-label': 'What importing the file would do, row by row', data: { key: 'imp-groups-preview' } }, h('table', { class: 'table imp-table imp-preview' },
      h('caption', { class: 'vh' }, 'What importing the file would do, row by row'),
      h('thead', null, h('tr', null, ['Row', 'Group', many ? 'Day type' : null, 'What will happen', 'Rooms not in the building, and other notes'].filter(Boolean).map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', null, preview.rows.map((line) => {
        const missing = line.cells.filter((cell) => cell.unknown).map((cell) => cell.text.trim());
        const notes = line.warnings.slice();
        if (missing.length > 0) notes.unshift('Not in the building: ' + list(missing) + '.');
        return h('tr', { data: { row: String(line.row), status: line.status } },
          h('td', { class: 'table__num' }, String(line.row)),
          h('td', null, line.status === 'heading' ? '' : line.name),
          many ? h('td', null, list(Array.from(new Set(line.cells.map((cell) => cell.dayTypeId))).map(dayName))) : null,
          h('td', null, rowWords(line, plan)),
          h('td', null, notes.map((note) => h('p', { class: 'imp-note' }, note))));
      }))));
  }

  function countsLine(preview) {
    const parts = [];
    const c = preview.counts;
    if (c.create > 0) parts.push(count(c.create, 'group') + ' ' + (c.create === 1 ? 'is' : 'are') + ' new');
    if (c.match > 0) parts.push(count(c.match, 'group') + ' ' + (c.match === 1 ? 'has' : 'have') + ' the name of a group already here');
    if (c.skip > 0) parts.push(count(c.skip, 'row') + ' will be left out');
    const first = parts.length === 0 ? 'The file has no group to import.' : list(parts).replace(/^./, (letter) => letter.toUpperCase()) + '.';
    return first + (c.unknownRooms > 0 ? ' ' + count(c.unknownRooms, 'room number') + ' in the file ' + (c.unknownRooms === 1 ? 'is' : 'are') + ' not in the building; each is kept as typed and reads "not in the building" until the room is drawn or the slot changed.' : '');
  }

  async function run(opener) {
    const loaded = state.groups;
    opener.disabled = true;
    const result = await runImport(ctx, importGroups, { rows: loaded.rows, mapping: loaded.mapping, policy: loaded.policy });
    if (!result) {
      opener.disabled = false;
      return;
    }
    const said = result.changed ? summaryText(result.outcome) : 'nothing changed';
    const extra = result.changed && result.outcome.madeOwn.length > 0 ? ' ' + list(result.outcome.madeOwn) + (result.outcome.madeOwn.length === 1 ? ' is' : ' are') + ' now ' + (result.outcome.madeOwn.length === 1 ? 'its own copy' : 'their own copies') + '.' : '';
    state.done.groups = { text: 'Imported ' + quote(loaded.fileName) + ': ' + said + '.' + extra + (result.changed ? ' Undo takes the whole import back in one step.' : ''), link: { href: '#schedule/groups', label: 'See the groups' } };
    state.groups = null;
    ctx.toast({ text: 'Imported groups: ' + said + '.', action: result.changed ? { label: 'Undo', run: ctx.undo } : null });
    env.render('imp-groups-choose');
  }

  function draw(project) {
    const loaded = state.groups;
    const choose = (label, primary) => fileButton({ label, accept: '.csv,text/csv,text/plain', key: 'imp-groups-choose', kind: 'groups', primary, csv: true, onText: take, onError: refuse });
    const templateButton = button('Download the template', template, { key: 'imp-groups-template', action: 'template' });
    if (!loaded) {
      return panel('groups', 'Groups from a spreadsheet',
        h('p', { class: 'sch-lead' }, WHAT + ' The template has the right columns for this school\'s ' + periodWords(project.settings).many + ' and day types, and opens in a spreadsheet.'),
        h('div', { class: 'sch-toolbar' }, choose('Choose a CSV file of groups…', true), templateButton),
        refusal('groups', state.refused.groups),
        doneLine('groups', state.done.groups));
    }

    const preview = previewImport(project, loaded.rows, loaded.mapping);
    const usable = preview.problems.length === 0;
    const clashes = usable ? preview.groups.filter((group) => group.existing).map((group) => ({ key: group.key, name: group.name })) : [];
    const plan = usable ? planOf(project, preview, loaded.policy) : {};
    const label = plan.summary ? actionLabel(plan.summary) : null;
    const makesOwn = usable ? preview.makesOwn.map((id) => (project.dayTypes.find((dayType) => dayType.id === id) || { name: '' }).name) : [];

    return panel('groups', 'Groups from a spreadsheet',
      h('p', { class: 'sch-lead', data: { file: 'groups' } }, quote(loaded.fileName) + ' has ' + count(loaded.rows.length - 1, 'row') + ' under its header. Nothing changes until you import.'),
      h('div', { class: 'sch-toolbar' }, choose('Choose another file…', false), templateButton),
      loaded.warnings.length > 0 ? h('ul', { class: 'imp-warnings' }, loaded.warnings.slice(0, 5).map((warning) => h('li', null, warning.message)),
        loaded.warnings.length > 5 ? h('li', null, 'And ' + count(loaded.warnings.length - 5, 'more row') + ' like these.') : null) : null,

      h('h3', { class: 'imp-step' }, '1. What each column is'),
      h('p', { class: 'sch-hint' }, 'The tool has guessed from the headers. Change any guess. A column it does not understand is ignored, never taken for a ' + periodWords(project.settings).one + '.'),
      mappingTable(project, loaded),
      usable ? null : h('ul', { class: 'imp-problems', data: { problems: 'mapping' } }, preview.problems.map((problem) => h('li', null, problem))),

      usable ? [
        h('h3', { class: 'imp-step' }, '2. What will happen'),
        h('p', { class: 'imp-counts', data: { create: String(preview.counts.create), match: String(preview.counts.match), skip: String(preview.counts.skip), unknown: String(preview.counts.unknownRooms) } }, countsLine(preview)),
        makesOwn.length > 0 ? h('p', { class: 'sch-hint', data: { note: 'makes-own' } }, list(makesOwn) + (makesOwn.length === 1 ? ' is' : ' are') + ' the same as ' + project.dayTypes[0].name + ' now. The file has rooms for ' + (makesOwn.length === 1 ? 'it, so it becomes its own copy' : 'them, so they become their own copies') + '.') : null,
        previewTable(project, preview, plan),
        clashes.length > 0 ? [
          h('h3', { class: 'imp-step' }, '3. Groups that are already here'),
          clashChooser('imp-groups', clashes, loaded.policy, (key) => env.render(key)),
          plan.problem ? h('p', { class: 'imp-refusal', data: { refused: 'names' } }, plan.problem) : null,
        ] : null,
        h('div', { class: 'sch-toolbar imp-go' },
          label
            ? button(label, run, { primary: true, key: 'imp-groups-run', action: 'import-groups' })
            : h('p', { class: 'sch-hint', data: { note: 'nothing' } }, plan.problem ? 'Put the name right and the import button comes back.' : 'With these answers the import would change nothing.'),
          button('Put the file away', putAway, { key: 'imp-groups-away', action: 'put-away' })),
      ] : h('div', { class: 'sch-toolbar imp-go' }, button('Put the file away', putAway, { key: 'imp-groups-away', action: 'put-away' })));
  }

  return { draw };
}
