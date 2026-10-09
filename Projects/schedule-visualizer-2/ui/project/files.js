// The Project file card (spec 13.2): the whole project as one file, out and
// in, and the building alone and the schedule alone.
//
// A file that is chosen is read and checked in full (engine/project-file.js)
// before anything is asked or changed. One that fails changes nothing, and
// the card says what was wrong with it. One that passes is described, and the
// tool asks before it replaces anything; a recovery point is taken first, and
// the replacement is one undo step.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count, list, figures } from '../components/words.js';
import { buildExport } from '../../engine/exports.js';
import { readProjectFile, readBuildingFile } from '../../engine/project-file.js';
import { replaceProject, importBuilding } from '../../engine/actions.js';
import { CURRENT_VERSION } from '../../engine/schema.js';

// Hand a file to the browser to save.
function download(fileName, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function quote(text) {
  return '“' + text + '”';
}

function messageOf(error) {
  return error && error.message ? error.message : 'Try again.';
}

// "3 floors, 13 rooms, 12 teachers and 8 groups", from summarise() or figures().
export function holdsWords(summary) {
  const parts = [count(summary.floors, 'floor'), count(summary.rooms, 'room')];
  if (summary.teachers !== undefined) parts.push(count(summary.teachers, 'teacher'), count(summary.groups, 'group'), count(summary.subjects, 'subject'), count(summary.dayTypes, 'day type'));
  return list(parts) + (summary.images > 0 ? ', with ' + count(summary.images, 'traced image') : '');
}

export function filesCard(ctx) {
  const storage = ctx.storage;
  // what the last export or import came to: { kind: 'done' | 'refused', text, notes }
  let said = null;

  const lead = h('p', { class: 'card__lead' }, 'A project file is the whole project in one file: the settings, the building with its traced images, the teachers, the groups and their schedule, the scenario and the accepted findings. Export one to keep somewhere safe or to hand to a colleague.');
  const result = h('div', { data: { line: 'result' }, hidden: true });

  function say(kind, text, notes) {
    said = { kind, text, notes: notes || [] };
    result.hidden = false;
    result.dataset.result = kind;
    result.replaceChildren(
      h('p', { role: kind === 'refused' ? 'alert' : 'status' }, text),
      said.notes.length > 0 ? h('ul', null, said.notes.map((note) => h('li', null, note))) : '');
  }

  async function save(kind) {
    try {
      const project = ctx.store.project;
      const images = kind === 'schedule' ? {} : await storage.imagesForFile(project);
      const file = buildExport(project, kind, { date: ctx.clock(), images });
      download(file.fileName, file.mime, file.text);
      if (kind === 'project') storage.noteExported();
      say('done', 'Saved ' + quote(file.fileName) + ' to your downloads.');
      ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
    } catch (error) {
      say('refused', 'The ' + kind + ' was not exported. ' + messageOf(error));
    }
  }

  async function recoveryPoint() {
    try {
      await storage.takeRecoveryPoint('import');
    } catch (error) { /* storage has said so itself; the import is still one undo step */ }
  }

  async function importProject(fileName, text, opener) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
      return;
    }
    const here = figures(ctx.store.project);
    const ok = await ctx.confirm({
      title: 'Replace this project with the one in ' + quote(fileName) + '?',
      body: [
        h('p', null, 'The file' + (read.project.settings.schoolName === '' ? '' : ' is ' + read.project.settings.schoolName + '. It') + ' holds ' + holdsWords(read.summary) + '.'),
        h('p', null, 'It takes the place of everything in this project: ' + holdsWords({ ...here, images: 0 }) + '.'),
        h('p', null, 'A recovery point of this project is taken first, and Undo brings it back while this tab stays open.'),
      ],
      action: 'Replace this project',
      keep: 'Keep this project',
      danger: true,
      opener,
    });
    if (!ok) {
      say('done', quote(fileName) + ' was read and not imported. Nothing has changed.');
      return;
    }
    const before = ctx.store.project;
    try {
      await recoveryPoint();
      await storage.keepFileImages(read.project, read.images);
      ctx.store.apply(replaceProject, { project: read.project, label: 'Import the project file ' + fileName });
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
      return;
    }
    if (ctx.store.project === before) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed.');
      return;
    }
    const notes = read.notes.slice();
    if (read.migratedFrom < CURRENT_VERSION) notes.unshift('The file was saved in an older format and has been brought up to date.');
    say('done', 'Imported ' + quote(fileName) + ': ' + holdsWords(read.summary) + '. Undo brings back the project that was here.', notes);
    ctx.toast({ text: 'Imported the project file ' + fileName + '.', action: { label: 'Undo', run: ctx.undo } });
  }

  async function importBuildingFile(fileName, text, opener) {
    let read;
    try {
      read = readBuildingFile(text);
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
      return;
    }
    const here = figures(ctx.store.project);
    // a building file's summary counts the building alone
    const holds = holdsWords({ floors: read.summary.floors, rooms: read.summary.rooms, images: read.summary.images });
    const ok = await ctx.confirm({
      title: 'Replace the building with the one in ' + quote(fileName) + '?',
      body: [
        h('p', null, 'The file holds ' + holds + '. It takes the place of the building here: ' + holdsWords({ floors: here.floors, rooms: here.rooms, images: 0 }) + '.'),
        h('p', null, 'The schedule stays. A group stays with its room where the new building has that room or one with the same number; a room that is gone is kept as its number and reads "not in the building".'),
        h('p', null, 'A recovery point of this project is taken first, and Undo brings the building back while this tab stays open.'),
      ],
      action: 'Replace the building',
      keep: 'Keep this building',
      danger: true,
      opener,
    });
    if (!ok) {
      say('done', quote(fileName) + ' was read and not imported. Nothing has changed.');
      return;
    }
    const before = ctx.store.project;
    try {
      await recoveryPoint();
      await storage.keepFileImages({ building: read.file.building }, read.images);
      ctx.store.apply(importBuilding, { file: read.file });
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
      return;
    }
    if (ctx.store.project === before) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed.');
      return;
    }
    const outcome = ctx.store.undoOutcome || {};
    const notes = [];
    if (outcome.slotsMoved > 0) notes.push(count(outcome.slotsMoved, 'schedule slot') + ' went to the room with the same number.');
    if (outcome.slotsLost > 0) notes.push(count(outcome.slotsLost, 'schedule slot') + ' now ' + (outcome.slotsLost === 1 ? 'reads' : 'read') + ' "not in the building": ' + list(outcome.lostRooms) + '.');
    if (outcome.subjectsAdded && outcome.subjectsAdded.length > 0) notes.push(count(outcome.subjectsAdded.length, 'subject') + ' the rooms use ' + (outcome.subjectsAdded.length === 1 ? 'was' : 'were') + ' added: ' + list(outcome.subjectsAdded) + '.');
    say('done', 'Imported ' + quote(fileName) + ': ' + holds + '. Undo brings back the building that was here.', notes);
    ctx.toast({ text: 'Imported the building file ' + fileName + '.', action: { label: 'Undo', run: ctx.undo } });
  }

  // A button that asks for a file, with the <input type="file"> it stands for.
  function chooser(kind, label, run) {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: kind } });
    const opener = h('button', { type: 'button', class: 'btn', data: { action: 'import-' + kind }, on: { click: () => input.click() } }, label);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      // the same file chosen again is a change again
      const picked = file.text();
      input.value = '';
      picked.then((text) => run(file.name, text, opener), (error) => say('refused', quote(file.name) + ' could not be read. ' + messageOf(error)));
    });
    return [opener, input];
  }

  const exporter = (kind, label) => h('button', { type: 'button', class: 'btn', data: { action: 'export-' + kind }, on: { click: () => save(kind) } }, label);

  const element = card({ id: 'project-file', title: 'Project file' },
    lead,
    h('div', { class: 'card__buttons' }, exporter('project', 'Export the project'), chooser('project', 'Import a project file…', importProject)),
    result,
    h('p', null, 'The building alone, with its traced images and none of the schedule. Importing one replaces the building here and keeps the schedule.'),
    h('div', { class: 'card__buttons' }, exporter('building', 'Export the building'), chooser('building', 'Import a building file…', importBuildingFile)),
    h('p', null, 'The schedule alone: subjects, teachers, groups, day types and bell times. Importing one adds to the schedule here, and asks about groups whose names are already here; that is on the Schedule section\'s Import tab.'),
    h('div', { class: 'card__buttons' }, exporter('schedule', 'Export the schedule'), h('a', { class: 'btn', href: '#schedule/import', data: { action: 'import-schedule' } }, 'Import a schedule file…')),
    h('p', { class: 'card__small' }, 'A file is checked in full before anything changes. One made by a newer Schedule Visualizer 2 is refused whole, and one that is damaged changes nothing.'),
  );

  return { element, update() {} };
}
