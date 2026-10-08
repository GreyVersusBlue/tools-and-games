// Every export of the schedule, each a download named with the school and
// the date (engine/exports.js exportFileName). The project file and the
// building file are on the Project section's file card.

import { h } from '../../components/dom.js';
import { periodWords } from '../../components/words.js';
import { buildExport } from '../../../engine/exports.js';
import { button, download } from '../common.js';
import { panel } from './parts.js';

// kind (engine/exports.js), the button's words, and what the file is.
export function exportList(settings) {
  const words = periodWords(settings);
  return [
    ['groups', 'Groups', 'One row per group with the room for each ' + words.one + '. The groups import reads it back.'],
    ['teachers', 'Teachers', 'The teacher list: name, subject, rooms, notes.'],
    ['subjects', 'Subjects', 'The subject list: code, name, colour.'],
    ['rooms', 'Rooms', 'Every room, floor by floor, with its teachers, subject and capacity.'],
    ['teacher-grid', 'Teachers by ' + words.one, 'One row per teacher per day type: who they teach each ' + words.one + ', and where.'],
    ['room-grid', 'Rooms by ' + words.one, 'One row per room per day type: the groups in it each ' + words.one + '.'],
    ['schedule', 'Schedule file', 'The whole schedule without the building, for the schedule import here or on another device. Not a spreadsheet.'],
  ];
}

export function exportsPanel(env) {
  const { ctx } = env;

  function save(kind) {
    let file;
    try {
      file = buildExport(ctx.store.project, kind, { date: ctx.clock() });
    } catch (error) {
      ctx.toast({ kind: 'problem', text: 'That was not exported. ' + (error && error.message ? error.message : 'Try again.') });
      return;
    }
    download(file.fileName, file.mime, file.text);
    ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
  }

  function draw(project) {
    return panel('export', 'Export',
      h('p', { class: 'sch-lead' }, 'Each is a download named with the school and today\'s date. All but the last are CSV files, which open in a spreadsheet.'),
      h('ul', { class: 'imp-exports' }, exportList(project.settings).map(([kind, label, what]) => h('li', { class: 'imp-export' },
        button(label, () => save(kind), { key: 'imp-export:' + kind, action: 'export-' + kind, more: kind === 'schedule' ? '' : ', as CSV' }),
        h('span', { class: 'imp-export__what' }, what)))),
      h('p', { class: 'sch-hint' }, 'The whole project, and the building alone, are exported from ', h('a', { href: '#project' }, 'the Project section'), '.'));
  }

  return { draw };
}
