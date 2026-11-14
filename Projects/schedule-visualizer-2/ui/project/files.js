// The Project file card (spec 13.2): the whole project as one file, out and
// in, and the building alone and the schedule alone.
//
// A file that is chosen is read and checked in full (engine/project-file.js)
// before anything is asked or changed. One that fails changes nothing, and
// the card says what was wrong with it. One that passes is described, and the
// tool asks before it replaces anything; a recovery point is taken first, and
// the replacement is one undo step.
//
// Before a file replaces the project or its building, a snapshot of what is
// here is taken too, named "Before importing <file name>" (spec 13.3), and
// the question says so; when the device already keeps as many snapshots as
// it can, the question says that instead, so going on without one is asked.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count, list, figures } from '../components/words.js';
import { buildExport } from '../../engine/exports.js';
import { readProjectFile, readBuildingFile } from '../../engine/project-file.js';
import { replaceProject, importBuilding } from '../../engine/actions.js';
import { CURRENT_VERSION } from '../../engine/schema.js';
import { pageSnapshots } from '../../storage/snapshots.js';

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

// The question's last line before an import: the recovery point, and the
// snapshot or why there is none. `room` is what snapshots.room() answered
// (null on a page with no snapshots); `what` is "it" or "the building".
export function importSafetyLine(room, name, what) {
  const point = 'A recovery point of this project is taken first';
  if (!room || room.error) return point + ', and Undo brings ' + what + ' back while this tab stays open. No snapshot can be taken' + (room && room.error ? ': ' + room.error : '.');
  if (room.full) return point + ', and Undo brings ' + what + ' back while this tab stays open. No snapshot can be taken: this device already keeps ' + room.limit + ' snapshots, the most it keeps, and none is replaced to make room. To have one as well, keep this, delete one under Snapshots, and import again.';
  return point + ', with a snapshot of it, ' + quote(name) + ', that you can restore from Snapshots at any time. Undo brings ' + what + ' back while this tab stays open.';
}

// The one-per-id rule (21.1, DESIGN 15.3): a project that is a copy of one kept
// on this device is never put over the open one. heldBy(ctx, id) asks before
// anything is stored, snapshotted or replaced: { id, label } when the id is a
// shelved project's, else null. The open project's own id is not a refusal. A page
// whose session cannot answer refuses (it throws: fail closed, never "nobody holds it").
export async function heldBy(ctx, projectId) {
  const projects = ctx.storage && ctx.storage.projects;
  if (!projects || typeof projects.holds !== 'function') throw new Error('The page has no way to ask which projects this device keeps.');
  const label = await projects.holds(projectId);
  return label === null ? null : { id: projectId, label };
}

// What each thing is called in the refusal, and what to do again afterwards.
const HELD_AGAIN = {
  file: ['This file', 'choose the file again'],
  project: ['This project', 'send it again'],
  snapshot: ['This snapshot', 'restore it again'],
  point: ['This recovery point', 'restore it again'],
};

// `keepable` false: there is no way to keep it as another project (a recovery
// point, which the session cannot read as a file), so only Open is offered.
export function heldSentence(what, label, keepable) {
  const [thing, again] = HELD_AGAIN[what];
  return thing + ' is a copy of ' + label + ', which is also kept on this device. Open ' + label + ' first, then ' + again + (keepable === false ? '' : ', or keep it as another project') + '. Nothing was replaced.';
}

// The two ways on, as the dialog's buttons: Keep it as another project, and
// Open <label> (last, so it is the focused one: it changes nothing).
export function heldButtons(label, keepable) {
  const open = { label: 'Open ' + label, value: 'open', kind: 'primary' };
  return keepable === false ? [open] : [{ label: 'Keep it as another project', value: 'keep' }, open];
}

// Show the refusal in the tool's dialog and carry out the way chosen.
//   what    'file' | 'project' | 'snapshot' | 'point'
//   held    { id, label } from heldBy
//   keep    async () => the session's answer for "Keep it as another project"
// Resolves { choice: 'open' | 'keep' | null, text }: `text` is the sentence for a
// way that failed (the page reloads when one worked), else ''.
export async function refuseHeld(ctx, { what, held, keep, opener }) {
  const choice = await ctx.openDialog({
    id: 'held-refusal',
    title: 'Nothing was replaced',
    body: h('p', { role: 'alert', data: { line: 'held' } }, heldSentence(what, held.label, typeof keep === 'function')),
    buttons: heldButtons(held.label, typeof keep === 'function'),
    opener,
  }).closed;
  if (choice !== 'open' && choice !== 'keep') return { choice: null, text: '' };
  try {
    const answer = choice === 'open' ? await ctx.storage.projects.open(held.id) : await keep();
    return { choice, text: answer && answer.ok === false ? answer.text : '' };
  } catch (error) {
    return { choice, text: messageOf(error) };
  }
}

export function filesCard(ctx) {
  const storage = ctx.storage;
  // what the last export or import came to: { kind: 'done' | 'refused', text, notes }
  let said = null;

  const lead = h('p', { class: 'card__lead' }, 'A project file is the whole project in one file: the settings, the building with its traced images, the teachers, the groups and their schedule, the scenarios and the accepted findings. Export one to keep somewhere safe or to hand to a colleague.');
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

  // Whether a snapshot can be taken before an import: { room, name }.
  async function snapshotPlan(fileName) {
    const snapshots = pageSnapshots();
    return { snapshots, room: snapshots ? await snapshots.room() : null, name: 'Before importing ' + fileName };
  }

  // Take the snapshot the question promised. Null when it was taken or none
  // was promised; otherwise the sentence saying why it was not.
  async function takeSnapshot(plan) {
    if (!plan.snapshots || !plan.room || plan.room.error || plan.room.full) return null;
    const answer = await plan.snapshots.takeAuto('import', plan.name);
    return answer.ok ? null : answer.text;
  }

  async function importProject(fileName, text, opener) {
    // The refusal is said once, in the dialog's alert; the card's line only says that nothing
    // was imported (replacing whatever an earlier outcome left there), and what a way on failed with.
    async function refused(held) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed.');
      const outcome = await refuseHeld(ctx, { what: 'file', held, opener, keep: () => storage.projects.startAnother('file', read, { copy: true }) });
      if (outcome.text !== '') say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + outcome.text);
    }
    // asked again just before the snapshot and just before the replacement: the shelf may have changed
    // while the question was open. Resolves true when the import must stop (it has said why).
    async function stopped(held) {
      try {
        held = await heldBy(ctx, read.project.id);
      } catch (error) {
        say('refused', quote(fileName) + ' was not imported, and nothing has changed, because this device could not be asked which projects it keeps. ' + messageOf(error));
        return true;
      }
      if (!held) return false;
      await refused(held);
      return true;
    }
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
      return;
    }
    // one project, one place: before the question, and so before any snapshot or image
    let held;
    try {
      held = await heldBy(ctx, read.project.id);
    } catch (error) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed, because this device could not be asked which projects it keeps. ' + messageOf(error));
      return;
    }
    if (held) {
      await refused(held);
      return;
    }
    const here = figures(ctx.store.project);
    const plan = await snapshotPlan(fileName);
    const ok = await ctx.confirm({
      title: 'Replace this project with the one in ' + quote(fileName) + '?',
      body: [
        h('p', null, 'The file' + (read.project.settings.schoolName === '' ? '' : ' is ' + read.project.settings.schoolName + '. It') + ' holds ' + holdsWords(read.summary) + '.'),
        h('p', null, 'It takes the place of everything in this project: ' + holdsWords({ ...here, images: 0 }) + '.'),
        h('p', null, importSafetyLine(plan.room, plan.name, 'it')),
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
    if (await stopped()) return;
    const unsnapped = await takeSnapshot(plan);
    if (unsnapped) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed, because the snapshot could not be taken first. ' + unsnapped);
      return;
    }
    if (await stopped()) return;
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
    const plan = await snapshotPlan(fileName);
    const ok = await ctx.confirm({
      title: 'Replace the building with the one in ' + quote(fileName) + '?',
      body: [
        h('p', null, 'The file holds ' + holds + '. It takes the place of the building here: ' + holdsWords({ floors: here.floors, rooms: here.rooms, images: 0 }) + '.'),
        h('p', null, 'The schedule stays. A group stays with its room where the new building has that room or one with the same number; a room that is gone is kept as its number and reads "not in the building".'),
        h('p', null, importSafetyLine(plan.room, plan.name, 'the building')),
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
    const unsnapped = await takeSnapshot(plan);
    if (unsnapped) {
      say('refused', quote(fileName) + ' was not imported, and nothing has changed, because the snapshot could not be taken first. ' + unsnapped);
      return;
    }
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
