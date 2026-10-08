// Teachers and subjects from a CSV file. Each is a list with fixed columns
// found by their headers, so there is no mapping step: choose the file, see
// what each row would do, import. The rules are engine/import-teachers.js
// and engine/import-subjects.js.

import { h } from '../../components/dom.js';
import { count, list } from '../../components/words.js';
import { parse } from '../../../engine/csv.js';
import { previewTeacherImport, teacherSummaryText } from '../../../engine/import-teachers.js';
import { previewSubjectImport, subjectSummaryText } from '../../../engine/import-subjects.js';
import { importTeachers, importSubjects } from '../../../engine/actions.js';
import { button, quote } from '../common.js';
import { panel, fileButton, runImport, doneLine, refusal } from './parts.js';

const CHANGE_WORDS = { subject: 'subject', rooms: 'rooms', notes: 'notes', name: 'name', colour: 'colour' };

const KINDS = {
  teachers: {
    title: 'Teachers from a spreadsheet',
    one: 'teacher',
    what: 'A CSV file with a header row and one row for each teacher, under the headers Teacher, Subject code, Subject, Rooms and Notes. Only Teacher is needed. Rooms are room numbers with a semicolon between them. It is the file "Export CSV" on the Teachers tab writes.',
    choose: 'Choose a CSV file of teachers…',
    preview: previewTeacherImport,
    summary: teacherSummaryText,
    action: importTeachers,
    name: (line) => line.name,
    tab: { href: '#schedule/teachers', label: 'See the teachers' },
    rules: 'A name already on the list is that teacher, whatever the capitals. Nobody is deleted, rooms are added and never taken away, and an empty cell changes nothing.',
  },
  subjects: {
    title: 'Subjects from a spreadsheet',
    one: 'subject',
    what: 'A CSV file with a header row and one row for each subject, under the headers Code, Subject and Colour. A colour is written #rrggbb. It is the file "Subjects" under Export, below, writes.',
    choose: 'Choose a CSV file of subjects…',
    preview: previewSubjectImport,
    summary: subjectSummaryText,
    action: importSubjects,
    name: (line) => (line.name.trim() === '' ? line.code : line.code.trim() === '' ? line.name : line.code + ' · ' + line.name),
    tab: { href: '#schedule/subjects', label: 'See the subjects' },
    rules: 'A code already on the list is that subject, whatever the capitals, and the rooms and teachers that use it still do. Nothing is deleted, and an empty cell changes nothing.',
  },
};

function rowWords(kind, line) {
  if (line.status === 'heading') return line.reason;
  if (line.status === 'skip') return 'Left out. ' + line.reason;
  if (line.status === 'create') return 'A new ' + kind.one + '.';
  if (line.status === 'same') return 'Already here, and the same: nothing to change.';
  return 'Already here: the ' + list(line.changes.map((change) => CHANGE_WORDS[change])) + ' ' + (line.changes.length === 1 && line.changes[0] !== 'rooms' && line.changes[0] !== 'notes' ? 'changes' : 'change') + '.';
}

// "Add 2 teachers and update 1": the button names what it does.
function actionLabel(kind, counts) {
  if (counts.create > 0 && counts.update > 0) return 'Add ' + count(counts.create, kind.one) + ' and update ' + counts.update;
  if (counts.create > 0) return 'Add ' + count(counts.create, kind.one);
  if (counts.update > 0) return 'Update ' + count(counts.update, kind.one);
  return null;
}

function listPanel(id) {
  const kind = KINDS[id];
  return (env, state) => {
    const { ctx } = env;
    const chooseKey = 'imp-' + id + '-choose';

    function take(fileName, text) {
      state.done[id] = null;
      state.refused[id] = null;
      state[id] = { fileName, rows: parse(text).rows };
      const preview = kind.preview(ctx.store.project, state[id].rows);
      ctx.announce(preview.problems.length > 0 ? quote(fileName) + ' cannot be used. ' + preview.problems[0] : 'Read ' + fileName + '. Check what each row would do, then import.');
      env.render(chooseKey);
    }

    function refuse(fileName, error) {
      state[id] = null;
      state.refused[id] = quote(fileName) + ' could not be read. ' + (error && error.message ? error.message : '');
      ctx.announce(state.refused[id]);
      env.render(chooseKey);
    }

    function putAway() {
      state[id] = null;
      env.render(chooseKey);
    }

    async function run(opener) {
      const loaded = state[id];
      opener.disabled = true;
      const result = await runImport(ctx, kind.action, { rows: loaded.rows });
      if (!result) {
        opener.disabled = false;
        return;
      }
      const said = result.changed ? kind.summary(result.outcome) : 'nothing changed';
      state.done[id] = { text: 'Imported ' + quote(loaded.fileName) + ': ' + said + '.' + (result.changed ? ' Undo takes the whole import back in one step.' : ''), link: kind.tab };
      state[id] = null;
      ctx.toast({ text: 'Imported ' + id + ': ' + said + '.', action: result.changed ? { label: 'Undo', run: ctx.undo } : null });
      env.render(chooseKey);
    }

    function draw(project) {
      const loaded = state[id];
      const choose = (label) => fileButton({ label, accept: '.csv,text/csv,text/plain', key: chooseKey, kind: id, csv: true, onText: take, onError: refuse });
      if (!loaded) {
        return panel(id, kind.title,
          h('p', { class: 'sch-lead' }, kind.what),
          h('div', { class: 'sch-toolbar' }, choose(kind.choose)),
          refusal(id, state.refused[id]),
          doneLine(id, state.done[id]));
      }
      const preview = kind.preview(project, loaded.rows);
      const away = button('Put the file away', putAway, { key: 'imp-' + id + '-away', action: 'put-away' });
      if (preview.problems.length > 0) {
        return panel(id, kind.title,
          h('p', { class: 'sch-lead', data: { file: id } }, quote(loaded.fileName) + ' cannot be used as it is, and nothing has changed.'),
          h('ul', { class: 'imp-problems', data: { problems: id } }, preview.problems.map((problem) => h('li', null, problem))),
          h('div', { class: 'sch-toolbar' }, choose('Choose another file…'), away));
      }
      const label = actionLabel(kind, preview.counts);
      const c = preview.counts;
      const parts = [];
      if (c.create > 0) parts.push(count(c.create, kind.one) + ' ' + (c.create === 1 ? 'is' : 'are') + ' new');
      if (c.update > 0) parts.push(count(c.update, kind.one) + ' already here would change');
      if (c.same > 0) parts.push(count(c.same, kind.one) + ' already here ' + (c.same === 1 ? 'is' : 'are') + ' the same');
      if (c.skip > 0) parts.push(count(c.skip, 'row') + ' will be left out');
      return panel(id, kind.title,
        h('p', { class: 'sch-lead', data: { file: id } }, quote(loaded.fileName) + ': ' + (parts.length === 0 ? 'it has no ' + kind.one + ' to import.' : list(parts) + '.') + ' Nothing changes until you import.'),
        h('p', { class: 'sch-hint' }, kind.rules),
        // the rows scroll inside this region, so the keyboard has to be able to reach it
        h('div', { class: 'sch-scroll imp-scroll', tabindex: '0', role: 'region', 'aria-label': 'What importing the file would do, row by row', data: { key: 'imp-' + id + '-preview' } }, h('table', { class: 'table imp-table imp-preview' },
          h('caption', { class: 'vh' }, 'What importing the file would do, row by row'),
          h('thead', null, h('tr', null, ['Row', kind.one.replace(/^./, (letter) => letter.toUpperCase()), 'What will happen', 'Left out, and why'].map((text) => h('th', { scope: 'col' }, text)))),
          h('tbody', null, preview.rows.map((line) => h('tr', { data: { row: String(line.row), status: line.status } },
            h('td', { class: 'table__num' }, String(line.row)),
            h('td', null, line.status === 'heading' ? '' : kind.name(line)),
            h('td', null, rowWords(kind, line)),
            h('td', null, line.warnings.map((warning) => h('p', { class: 'imp-note' }, warning)))))))),
        h('div', { class: 'sch-toolbar imp-go' },
          label
            ? button(label, run, { primary: true, key: 'imp-' + id + '-run', action: 'import-' + id })
            : h('p', { class: 'sch-hint', data: { note: 'nothing' } }, 'Importing this file would change nothing.'),
          choose('Choose another file…'),
          away));
    }

    return { draw };
  };
}

export const teachersPanel = listPanel('teachers');
export const subjectsPanel = listPanel('subjects');
