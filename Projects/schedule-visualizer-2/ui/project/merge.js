// Import part of a project file (spec 13.2, DESIGN 15.5 and 15.9): bring in
// only the building, only the schedule or only the settings of a project file,
// and leave the rest of the open project as it is.
//
// A two-step dialog. Step 1 says what the file holds and asks which part (and,
// for the schedule, what to do with groups whose names are already here).
// Step 2 says exactly what that would change, with the engine's own
// previewPart, which applies nothing. Nothing in the project changes before
// "Bring it in"; then a snapshot is taken, and the part comes in as one undo
// step (importPart). Each step is a dialog of its own, so Escape is Cancel's
// answer in both and focus goes back to the button that opened the first.
//
// The file is read with readProjectFile, as the whole-project import does.
// That import takes the one-per-id rule with it (a file that is a copy of a
// kept project is not put over the open one); this one takes no project id
// and replaces nothing whole, so the rule does not apply to it.
//
// The page's pieces it leans on come in as `env` (files.js owns the card):
//   env.ctx            the page's context (store, storage, clock, ids, toast, openDialog)
//   env.say            the card's persistent line: say(kind, text, notes, undo)
//   env.snapshotPlan   async (name) => { snapshots, room, name }
//   env.takeSnapshot   async (plan) => null, or the sentence for why it was not taken
//   env.recoveryPoint  async () => takes the recovery point
//   env.safetyLine     (room, name, what) => the question's last line

import { h, uid } from '../components/dom.js';
import { count, list, periodWords } from '../components/words.js';
import { readProjectFile, buildingPart, schedulePart, SETTINGS_TAKEN } from '../../engine/project-file.js';
import { previewPart, importPart } from '../../engine/actions.js';
import { nameKey } from '../../engine/schema.js';
import { openProjectName } from './clear.js';
import { clashChooser, newPolicy } from '../schedule/import/parts.js';
import { alsoText } from '../schedule/import/schedule-file.js';
import { summaryText } from '../../engine/import-groups.js';

const quote = (text) => '“' + text + '”';
const messageOf = (error) => (error && error.message ? error.message : 'Try again.');

// The three parts, in the order the dialog offers them.
export const PARTS = [
  {
    part: 'building',
    label: 'Only the building',
    sentence: 'Floors, rooms, doors, stairs, exits and traced images. Your schedule stays; each class keeps its room where the new building has the same room number.',
    what: 'the building',
  },
  {
    part: 'schedule',
    label: 'Only the schedule',
    sentence: 'Subjects, teachers, groups, day types, bell schedules, the calendar, marked periods and duties. Your building stays; rooms are matched by number.',
    what: 'the schedule',
  },
  {
    part: 'settings',
    label: 'Only the settings',
    sentence: 'The school\'s name, periods, the period word, times and the checks. Not the theme or paper, which belong to this device, and not publishing.',
    what: 'the settings',
  },
];

const partOf = (part) => PARTS.find((entry) => entry.part === part);

// What the snapshot taken first is called.
export const snapshotName = (part) => 'Before bringing in ' + partOf(part).what;

// The settings the engine may take, in words (SETTINGS_TAKEN's keys, all of them).
const TAKEN_WORDS = {
  schoolName: 'School name (only while this project\'s is blank)',
  periods: 'Periods (raised if the file has more, never lowered)',
  periodWord: 'Period word',
  defaultPassingSeconds: 'Default passing time',
  defaultHeadCount: 'Default head count',
  colourScale: 'Colour scale',
  checks: 'Checks',
  timeFormat: 'Time format',
};

const SETTING_NAMES = {
  schoolName: 'School name',
  periods: 'Periods',
  periodWord: 'Period word',
  defaultPassingSeconds: 'Default passing time',
  defaultHeadCount: 'Default head count',
  colourScale: 'Colour scale',
  checks: 'Checks',
  timeFormat: 'Time format',
};

export const NOT_TAKEN_SENTENCE = 'Not taken: the theme and paper (this device\'s), and the cell size, walking and stair times and elevator times (they belong to the building).';

function seconds(value) {
  if (value > 0 && value % 60 === 0) return count(value / 60, 'minute');
  return count(value, 'second');
}

// A setting's value as a person reads it.
export function settingText(key, value) {
  if (key === 'schoolName') return value === '' ? 'blank' : value;
  if (key === 'defaultPassingSeconds') return seconds(value);
  if (key === 'timeFormat') return value === '24h' ? '24-hour' : value === '12h' ? '12-hour' : String(value);
  if (key === 'colourScale') return value.mode + ' (bands ' + value.bands.join(', ') + ')';
  if (key === 'checks') {
    const off = Array.isArray(value.off) ? value.off.length : 0;
    return 'at most ' + count(value.consecutiveLimit, 'period') + ' in a row, margin ' + seconds(value.passingMarginSeconds) + ', ' + (off === 0 ? 'none switched off' : off + ' switched off');
  }
  return String(value);
}

const are = (n, one, many) => (n === 1 ? one : many);

// What bringing a part in would do, one line each: previewPart's summary in words.
export function summaryLines(part, summary, project) {
  const lines = [];
  if (part === 'building') {
    lines.push('The building becomes ' + list([count(summary.floors, 'floor'), count(summary.rooms, 'room')]) + (summary.images > 0 ? ', with ' + count(summary.images, 'traced image') : '') + '.');
    if (summary.slotsKept > 0) lines.push(count(summary.slotsKept, 'schedule slot') + ' ' + are(summary.slotsKept, 'keeps its room', 'keep their rooms') + '.');
    if (summary.slotsMoved > 0) lines.push(count(summary.slotsMoved, 'schedule slot') + ' ' + are(summary.slotsMoved, 'goes', 'go') + ' to the room with the same number.');
    if (summary.slotsLost > 0) {
      lines.push(count(summary.lostRooms.length, 'room') + ', ' + list(summary.lostRooms) + ', ' + are(summary.lostRooms.length, 'is', 'are') + ' not in the new building, so ' + count(summary.slotsLost, 'schedule slot') + ' ' + are(summary.slotsLost, 'keeps', 'keep') + ' the number as text and ' + are(summary.slotsLost, 'reads', 'read') + ' "not in the building".');
    }
    if (summary.slotsKept + summary.slotsMoved + summary.slotsLost === 0) lines.push('No schedule slot is in a room, so none changes.');
    if (summary.subjectsAdded.length > 0) lines.push(count(summary.subjectsAdded.length, 'subject') + ' the rooms use ' + are(summary.subjectsAdded.length, 'is', 'are') + ' added: ' + list(summary.subjectsAdded) + '.');
    if (summary.leversDropped > 0) lines.push(count(summary.leversDropped, 'scenario lever') + ' left out, because the new building has no such corridor, stairs or room.');
    if (summary.changesUnmatched > 0) lines.push(count(summary.changesUnmatched, 'scenario change') + ' ' + are(summary.changesUnmatched, 'names a room', 'name rooms') + ' the new building does not have; ' + are(summary.changesUnmatched, 'it stays', 'they stay') + ' and ' + are(summary.changesUnmatched, 'shows', 'show') + ' as no longer applying.');
  } else if (part === 'schedule') {
    lines.push('Groups: ' + summaryText(summary) + '.');
    const also = alsoText(summary, periodWords(project.settings)).trim();
    if (also !== '') lines.push(also);
  } else {
    for (const { key, from, to } of summary.taken) lines.push((key === 'periods' ? 'Periods' : SETTING_NAMES[key]) + ': ' + settingText(key, from) + ' → ' + settingText(key, to));
    if (summary.periodsStay) lines.push('Periods stay at ' + summary.periodsStay.at + ': the file has ' + summary.periodsStay.file + '.');
    if (summary.taken.length === 0) lines.unshift('No setting changes: the file\'s settings match this project\'s, or are ones this project keeps.');
  }
  return lines;
}

// The one-line heading of what the file holds: "<file>: <school>, 3 floors, 41 rooms, 30 groups."
export function fileLine(fileName, read) {
  const school = read.project.settings.schoolName;
  const s = read.summary;
  return fileName + ': ' + (typeof school === 'string' && school.trim() !== '' ? school + ', ' : '') + [count(s.floors, 'floor'), count(s.rooms, 'room'), count(s.groups, 'group')].join(', ') + '.';
}

export function mergeImport(env) {
  const { ctx, say } = env;

  // Run the dialog for one file. Resolves when it is over.
  async function run(fileName, text, opener) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      say('refused', quote(fileName) + ' was not brought in, and nothing has changed. ' + messageOf(error));
      return;
    }
    const state = { part: PARTS[0].part, policy: newPolicy(), error: '', focusRadio: true };
    // groups of the file whose names are groups here: the schedule's one question
    const here = new Set(ctx.store.project.groups.map((group) => nameKey(group.name)));
    const clashes = schedulePart(read.project).file.groups.filter((group) => here.has(nameKey(group.name))).map((group) => ({ key: nameKey(group.name), name: group.name }));

    function stepOne() {
      const ids = { legend: uid('merge-part') };
      const body = h('div', { class: 'merge' });
      const dialog = ctx.openDialog({
        id: 'merge-import',
        class: 'scn-apply',
        title: 'Import part of a project file',
        body,
        buttons: [{ label: 'Next', value: 'next', kind: 'primary' }, { label: 'Cancel', value: null }],
        opener,
      });
      dialog.element.dataset.step = '1';
      function draw(focusKey) {
        const fields = h('fieldset', { class: 'imp-clash__all merge__parts', 'aria-labelledby': ids.legend },
          h('legend', { id: ids.legend }, 'What to bring in'),
          PARTS.map((entry) => {
            const described = uid('merge-says');
            const input = h('input', { type: 'radio', name: 'merge-part', value: entry.part, 'aria-describedby': described, data: { part: entry.part } });
            input.checked = state.part === entry.part;
            input.addEventListener('change', () => {
              state.part = entry.part;
              state.error = '';
              draw('part:' + entry.part);
            });
            return h('div', { class: 'merge__part' },
              h('label', { class: 'imp-clash__option' }, input, h('span', null, h('strong', null, entry.label))),
              h('p', { class: 'card__small', id: described }, entry.sentence),
              entry.part === 'schedule' && state.part === 'schedule' && clashes.length > 0 ? clashChooser('merge-schedule', clashes, state.policy, (key) => draw(key)) : null);
          }));
        body.replaceChildren(...[
          h('p', { data: { line: 'file' } }, fileLine(fileName, read)),
          fields,
          state.error === '' ? null : h('p', { role: 'alert', class: 'imp-refusal', data: { line: 'refused' } }, state.error),
        ].filter(Boolean));
        const target = focusKey === undefined ? null : body.querySelector('[data-key="' + focusKey + '"], [data-part="' + String(focusKey).replace(/^part:/, '') + '"]');
        if (target) target.focus();
      }
      draw(state.focusRadio ? 'part:' + state.part : undefined);
      return dialog.closed;
    }

    function stepTwo(preview, plan) {
      const entry = partOf(state.part);
      const project = ctx.store.project;
      const lines = summaryLines(state.part, preview, project);
      const children = [
        h('p', { data: { line: 'file' } }, fileLine(fileName, read)),
        h('p', { class: 'merge__chosen', data: { line: 'part' } }, h('strong', null, entry.label)),
        h('ul', { class: 'merge__lines', data: { line: 'summary' } }, lines.map((line) => h('li', null, line))),
      ];
      if (state.part === 'settings') {
        children.push(
          h('p', { class: 'card__small', data: { line: 'taken' } }, 'Taken from the file: ' + list(SETTINGS_TAKEN.map((key) => TAKEN_WORDS[key])) + '.'),
          h('p', { class: 'card__small', data: { line: 'not-taken' } }, NOT_TAKEN_SENTENCE));
      }
      children.push(
        h('p', { data: { line: 'snapshot' } }, env.safetyLine(plan.room, plan.name, 'it all')),
        h('p', { data: { line: 'duplicate' } }, 'To keep ' + openProjectName(project) + ' as it is, close this and use Duplicate this project first.'));
      const dialog = ctx.openDialog({
        id: 'merge-import',
        class: 'scn-apply',
        title: 'Bring in ' + entry.what + '?',
        body: h('div', { class: 'merge' }, children),
        buttons: [{ label: 'Bring it in', value: 'bring', kind: 'primary' }, { label: 'Back', value: 'back' }, { label: 'Cancel', value: null }],
        opener,
      });
      dialog.element.dataset.step = '2';
      // Next moves the focus to this step's heading
      const title = dialog.element.querySelector('.dialog__title');
      title.tabIndex = -1;
      title.focus();
      return dialog.closed;
    }

    for (;;) {
      const next = await stepOne();
      if (next !== 'next') {
        say('done', fileName + ' was read and nothing was brought in. Nothing has changed.');
        return;
      }
      state.focusRadio = false;
      let preview;
      try {
        preview = previewPart(ctx.store.project, read, state.part, { policy: state.policy, clock: ctx.clock });
      } catch (error) {
        state.error = messageOf(error);
        state.focusRadio = true;
        continue;
      }
      const plan = await env.snapshotPlan(fileName, snapshotName(state.part));
      const answer = await stepTwo(preview, plan);
      if (answer === 'back') {
        state.focusRadio = true;
        continue;
      }
      if (answer !== 'bring') {
        say('done', fileName + ' was read and nothing was brought in. Nothing has changed.');
        return;
      }
      await bringIn(fileName, read, state, plan);
      return;
    }
  }

  async function bringIn(fileName, read, state, plan) {
    const entry = partOf(state.part);
    const refused = (why) => say('refused', quote(fileName) + ' was not brought in, and nothing has changed' + why);
    const before = ctx.store.project;
    const unsnapped = await env.takeSnapshot(plan);
    if (unsnapped) {
      refused(', because the snapshot could not be taken first. ' + unsnapped);
      return;
    }
    try {
      await env.recoveryPoint();
      if (state.part === 'building') {
        const built = buildingPart(read);
        await ctx.storage.keepFileImages({ building: built.file.building }, built.images);
      }
      ctx.store.apply(importPart, { part: state.part, read, fileName, policy: state.policy });
    } catch (error) {
      refused('. ' + messageOf(error));
      return;
    }
    if (ctx.store.project === before) {
      say('done', 'Nothing changed: ' + entry.what + ' in ' + quote(fileName) + ' matches what this project has, or is what it keeps.');
      return;
    }
    const label = ctx.store.undoLabel;
    const outcome = ctx.store.undoOutcome || {};
    const sentence = 'Brought in ' + entry.what + ' from ' + fileName + '.';
    // The line's Undo takes this step back only while this step is the one Undo would take.
    const undo = {
      run() {
        if (ctx.store.undoLabel !== label) {
          say('done', sentence + ' Undo no longer reaches it: later changes sit on top. Undo them first, or restore ' + quote(snapshotName(state.part)) + ' from Snapshots.');
          return;
        }
        ctx.undo();
        say('done', 'Undid bringing in ' + entry.what + ' from ' + quote(fileName) + '. This project is as it was.');
      },
    };
    say('done', sentence + ' Undo brings it all back.', summaryLines(state.part, { part: state.part, ...outcome }, ctx.store.project), undo);
    ctx.toast({ text: sentence, action: { label: 'Undo', run: ctx.undo } });
  }

  return run;
}
