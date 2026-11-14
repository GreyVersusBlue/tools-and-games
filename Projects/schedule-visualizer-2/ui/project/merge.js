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
//   env.snapshotPlan   async (file, name) => { snapshots, room, name }
//   env.takeSnapshot   async (plan) => null, or the sentence for why it was not taken
//   env.safetyLine     (room, name, what) => the question's last line
//
// What keeps the person's work safe (SV2-120b):
//   - A read-only tab, or a switch in progress, is refused before step 1 opens
//     and again before every snapshot, recovery point or image write.
//   - From Next until the end every await is under a modal "Working…" (aria-busy,
//     nothing can be pressed), so the page cannot be edited underneath.
//   - Step 2 describes one project object. Bring it in applies only to that very
//     object; when it has changed, step 2 comes back with the new summary.
//   - Whether it changed is read from this action's own history entry, and both
//     Undos (the toast's and the line's) name that entry by identity, never by label.
//   - A traced image of the file is written just before the change, never over a
//     different picture under the same id, and not at all when the part is refused.
//   - One run at a time; the opener says so.

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


const READ_ONLY_TEXT = 'This tab is read-only while the project is open in another tab, so nothing can be brought in here.';
const SWITCHING_TEXT = 'A project is being opened, so nothing can be brought in now.';
export const CHANGED_SENTENCE = 'The project changed while this was open; here is what would change now.';
const NOT_TAKEN_BY_PROJECT = 'The project did not take it.';

const arr = (value) => (Array.isArray(value) ? value : []);
const num = (value) => (Number.isFinite(value) ? value : 0);
const are = (n, one, many) => (n === 1 ? one : many);

// What bringing a part in would do, one line each: previewPart's summary in words.
// A partial summary (a field missing) says what it can and never throws.
export function summaryLines(part, given, project) {
  const summary = given !== null && typeof given === 'object' ? given : {};
  const lines = [];
  try {
    if (part === 'building') {
      const lostRooms = arr(summary.lostRooms).map(String);
      const subjectsAdded = arr(summary.subjectsAdded).map(String);
      const kept = num(summary.slotsKept);
      const moved = num(summary.slotsMoved);
      const lost = num(summary.slotsLost);
      lines.push('The building becomes ' + list([count(num(summary.floors), 'floor'), count(num(summary.rooms), 'room')]) + (num(summary.images) > 0 ? ', with ' + count(num(summary.images), 'traced image') : '') + '.');
      if (kept > 0) lines.push(count(kept, 'schedule slot') + ' ' + are(kept, 'keeps its room', 'keep their rooms') + '.');
      if (moved > 0) lines.push(count(moved, 'schedule slot') + ' ' + are(moved, 'goes', 'go') + ' to the room with the same number.');
      if (lost > 0) {
        const named = lostRooms.length > 0 ? count(lostRooms.length, 'room') + ', ' + list(lostRooms) + ', ' + are(lostRooms.length, 'is', 'are') + ' not in the new building' : 'A room is not in the new building';
        lines.push(named + ', so ' + count(lost, 'schedule slot') + ' ' + are(lost, 'keeps', 'keep') + ' the number as text and ' + are(lost, 'reads', 'read') + ' "not in the building".');
      }
      if (kept + moved + lost === 0) lines.push('No schedule slot is in a room, so none changes.');
      if (subjectsAdded.length > 0) lines.push(count(subjectsAdded.length, 'subject') + ' the rooms use ' + are(subjectsAdded.length, 'is', 'are') + ' added: ' + list(subjectsAdded) + '.');
      if (num(summary.leversDropped) > 0) lines.push(count(summary.leversDropped, 'scenario lever') + ' left out, because the new building has no such corridor, stairs or room.');
      if (num(summary.changesUnmatched) > 0) lines.push(count(summary.changesUnmatched, 'scenario change') + ' ' + are(summary.changesUnmatched, 'names a room', 'name rooms') + ' the new building does not have; ' + are(summary.changesUnmatched, 'it stays', 'they stay') + ' and ' + are(summary.changesUnmatched, 'shows', 'show') + ' as no longer applying.');
    } else if (part === 'schedule') {
      lines.push('Groups: ' + summaryText({ created: arr(summary.created), overwritten: arr(summary.overwritten), skipped: arr(summary.skipped), unchanged: arr(summary.unchanged), calendarReplaced: summary.calendarReplaced === true }) + '.');
      const raised = summary.periodsRaised && Number.isFinite(summary.periodsRaised.to) ? summary.periodsRaised : null;
      const words = periodWords(project && project.settings ? project.settings : {});
      const also = alsoText({
        subjectsAdded: arr(summary.subjectsAdded), teachersAdded: arr(summary.teachersAdded), dayTypesAdded: arr(summary.dayTypesAdded), periodsRaised: raised,
        marksAdded: num(summary.marksAdded), marksKept: num(summary.marksKept), marksReplaced: num(summary.marksReplaced),
        dutiesAdded: num(summary.dutiesAdded), dutiesKept: num(summary.dutiesKept), dutiesReplaced: num(summary.dutiesReplaced),
        releaseAdded: num(summary.releaseAdded), releaseKept: num(summary.releaseKept), releaseReplaced: num(summary.releaseReplaced), releaseDropped: num(summary.releaseDropped),
        unknownRooms: arr(summary.unknownRooms),
      }, words).trim();
      if (also !== '') lines.push(also);
    } else {
      const taken = arr(summary.taken).filter((entry) => entry && typeof entry === 'object');
      for (const { key, from, to } of taken) {
        let change;
        try {
          change = settingText(key, from) + ' → ' + settingText(key, to);
        } catch (error) {
          change = String(from) + ' → ' + String(to);
        }
        lines.push((key === 'periods' ? 'Periods' : SETTING_NAMES[key] || String(key)) + ': ' + change);
      }
      const stay = summary.periodsStay;
      if (stay && typeof stay === 'object') lines.push('Periods stay at ' + stay.at + ': the file has ' + stay.file + '.');
      if (taken.length === 0) lines.unshift('No setting changes: the file\'s settings match this project\'s, or are ones this project keeps.');
    }
  } catch (error) {
    // a summary this far from whole: what was said so far stands
  }
  return lines;
}

// Whether previewPart said anything would change. A building always does (it is made
// of new objects); the schedule says "nothing to import" and the settings take nothing.
function wouldChange(part, summary) {
  if (part === 'settings') return arr(summary && summary.taken).length > 0;
  if (part === 'schedule') {
    const lines = summaryLines('schedule', summary, null);
    return !(lines.length === 1 && lines[0] === 'Groups: nothing to import.');
  }
  return true;
}

// The one-line heading of what the file holds: "<file>: <school>, 3 floors, 41 rooms, 30 groups."
export function fileLine(fileName, read) {
  const school = read.project.settings.schoolName;
  const s = read.summary;
  return fileName + ': ' + (typeof school === 'string' && school.trim() !== '' ? school + ', ' : '') + [count(s.floors, 'floor'), count(s.rooms, 'room'), count(s.groups, 'group')].join(', ') + '.';
}

// The bytes of a stored image or a file's image, as one string, to compare.
async function bytesOfBlob(blob) {
  const view = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < view.length; i += 8192) text += String.fromCharCode(...view.subarray(i, i + 8192));
  return text;
}
const bytesOfFile = (image) => atob(image.data);

// A modal "Working…" over the page: aria-busy, nothing under it can be pressed or
// edited, Escape does nothing. Closed by whoever opened it.
function working() {
  const titleId = uid('merge-working');
  const title = h('h2', { class: 'dialog__title', id: titleId, tabindex: '-1' }, 'Working…');
  const element = h('dialog', { class: 'dialog merge-working', id: 'merge-working', 'aria-labelledby': titleId, 'aria-busy': 'true' },
    title,
    h('div', { class: 'dialog__body' }, h('p', null, 'Nothing else can be changed until this is done.')));
  element.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(element);
  element.showModal();
  title.focus();
  return {
    close() {
      if (element.open) element.close();
      element.remove();
    },
  };
}

export function mergeImport(env) {
  const { ctx, say } = env;
  let running = false;
  // the entry of the step whose summary the card's line shows now
  let latest = null;

  // The sentence for why nothing can be brought in right now, or ''.
  function blocked() {
    const state = ctx.storage && ctx.storage.state;
    if (state && state.readOnly) return READ_ONLY_TEXT;
    if (state && state.switching) return SWITCHING_TEXT;
    return '';
  }

  const topEntry = () => {
    const past = ctx.store.history.past;
    return past.length > 0 ? past[past.length - 1] : null;
  };

  // The ids of the traced images this tab's project and its undo history name.
  function namedImages() {
    const found = new Set();
    const note = (project) => {
      const floors = project && project.building && Array.isArray(project.building.floors) ? project.building.floors : [];
      for (const floor of floors) if (floor && floor.image && typeof floor.image.imageId === 'string') found.add(floor.image.imageId);
    };
    note(ctx.store.project);
    const { past, future } = ctx.store.history;
    for (const entry of past.concat(future)) {
      note(entry.before);
      note(entry.after);
    }
    return found;
  }

  // The images the file brings that are not already kept: { write } and, when one id is
  // kept already with other bytes, { problem }. Reads only; nothing is written here.
  async function imagesToWrite(images) {
    const ids = Object.keys(images);
    const write = {};
    if (ids.length === 0 || !ctx.storage || typeof ctx.storage.getImage !== 'function') return { write: images };
    const named = namedImages();
    let mine = {};
    if (typeof ctx.storage.imagesForFile === 'function') mine = await ctx.storage.imagesForFile(ctx.store.project);
    for (const id of ids) {
      const theirs = bytesOfFile(images[id]);
      let known = null;
      if (Object.prototype.hasOwnProperty.call(mine, id)) known = atob(mine[id].data);
      else {
        const stored = await ctx.storage.getImage(id);
        if (stored && stored.blob) known = await bytesOfBlob(stored.blob);
      }
      if (known !== null) {
        if (known === theirs) continue;
        return { problem: 'A traced image in this file has the same name as a different picture this device already keeps (in this project, its Undo history or a snapshot). Bringing it in would change that picture, so the building was left alone.' };
      }
      if (named.has(id)) return { problem: 'A traced image in this file has the name of a picture this project or its Undo history uses, but that picture cannot be read here to compare, so the building was left alone.' };
      write[id] = images[id];
    }
    return { write };
  }

  // Run the dialog for one file. Resolves when it is over.
  async function run(fileName, text, opener) {
    if (running) return;
    const stopped = blocked();
    if (stopped !== '') {
      say('refused', quote(fileName) + ' was not brought in, and nothing has changed. ' + stopped);
      return;
    }
    running = true;
    const reason = h('span', { class: 'vh', id: uid('merge-busy') }, 'An import of part of a project file is in progress.');
    if (opener) {
      opener.setAttribute('aria-disabled', 'true');
      opener.setAttribute('aria-describedby', reason.id);
      opener.after(reason);
    }
    try {
      await session(fileName, text, opener);
    } finally {
      running = false;
      if (opener) {
        opener.removeAttribute('aria-disabled');
        opener.removeAttribute('aria-describedby');
        reason.remove();
        const active = document.activeElement;
        if (opener.isConnected && (!active || active === document.body)) opener.focus();
      }
    }
  }

  async function session(fileName, text, opener) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      say('refused', quote(fileName) + ' was not brought in, and nothing has changed. ' + messageOf(error));
      return;
    }
    const state = { part: PARTS[0].part, policy: newPolicy(), error: '', focusRadio: true };
    const cancelled = () => say('done', fileName + ' was read and nothing was brought in. Nothing has changed.');

    function stepOne() {
      // groups of the file whose names are groups here now: the schedule's one question
      const here = new Set(ctx.store.project.groups.map((group) => nameKey(group.name)));
      const clashes = schedulePart(read.project).file.groups.filter((group) => here.has(nameKey(group.name))).map((group) => ({ key: nameKey(group.name), name: group.name }));
      const ids = { legend: uid('merge-part') };
      const alert = h('p', { role: 'alert', class: 'imp-refusal', data: { line: 'refused' }, hidden: true });
      const hosts = {};
      const showError = (sentence) => {
        state.error = sentence;
        alert.textContent = sentence;
        alert.hidden = sentence === '';
      };
      // only the question under the schedule changes when a radio or a clash answer does
      function drawClash(focusKey) {
        const host = hosts.schedule;
        host.replaceChildren(...(state.part === 'schedule' && clashes.length > 0 ? [clashChooser('merge-schedule', clashes, state.policy, (key) => drawClash(key))] : []));
        if (focusKey) {
          const target = host.querySelector('[data-key="' + focusKey + '"]');
          if (target) target.focus();
        }
      }
      const fields = h('fieldset', { class: 'imp-clash__all merge__parts', 'aria-labelledby': ids.legend },
        h('legend', { id: ids.legend }, 'What to bring in'),
        PARTS.map((entry) => {
          const described = uid('merge-says');
          const input = h('input', { type: 'radio', name: 'merge-part', value: entry.part, 'aria-describedby': described, data: { part: entry.part } });
          input.checked = state.part === entry.part;
          input.addEventListener('change', () => {
            state.part = entry.part;
            showError('');
            drawClash();
          });
          hosts[entry.part] = entry.part === 'schedule' ? h('div', { class: 'merge__clash' }) : null;
          return h('div', { class: 'merge__part' },
            h('label', { class: 'imp-clash__option' }, input, h('span', null, h('strong', null, entry.label))),
            h('p', { class: 'card__small', id: described }, entry.sentence),
            hosts[entry.part]);
        }));
      const body = h('div', { class: 'merge' }, h('p', { data: { line: 'file' } }, fileLine(fileName, read)), fields, alert);
      const dialog = ctx.openDialog({
        id: 'merge-import',
        class: 'scn-apply',
        title: 'Import part of a project file',
        body,
        buttons: [{ label: 'Next', value: 'next', kind: 'primary' }, { label: 'Cancel', value: null }],
        opener,
      });
      dialog.element.dataset.step = '1';
      // Next does not close the dialog until the part can be previewed: a refusal keeps this step open and
      // says so in its alert. (The dialog's own handler would close it at once, so the button is replaced.)
      const first = dialog.element.querySelector('.dialog__buttons button');
      const next = first.cloneNode(true);
      first.replaceWith(next);
      next.addEventListener('click', () => {
        const stopped = blocked();
        if (stopped !== '') {
          showError(stopped);
          return;
        }
        try {
          previewPart(ctx.store.project, read, state.part, { policy: state.policy, clock: ctx.clock });
        } catch (error) {
          showError(messageOf(error));
          return;
        }
        dialog.close('next');
      });
      showError(state.error);
      drawClash();
      if (state.focusRadio) fields.querySelector('input[data-part="' + state.part + '"]').focus();
      return dialog.closed;
    }

    function stepTwo(preview, plan, previewed, notice) {
      const entry = partOf(state.part);
      const lines = summaryLines(state.part, preview, previewed);
      const noticeId = uid('merge-notice');
      const children = [];
      if (notice) children.push(h('p', { class: 'merge__notice', id: noticeId, data: { line: 'changed' } }, notice));
      children.push(
        h('p', { data: { line: 'file' } }, fileLine(fileName, read)),
        h('p', { class: 'merge__chosen', data: { line: 'part' } }, h('strong', null, entry.label)),
        h('ul', { class: 'merge__lines', data: { line: 'summary' } }, lines.map((line) => h('li', null, line))));
      if (state.part === 'settings') {
        children.push(
          h('p', { class: 'card__small', data: { line: 'taken' } }, 'Taken from the file: ' + list(SETTINGS_TAKEN.map((key) => TAKEN_WORDS[key])) + '.'),
          h('p', { class: 'card__small', data: { line: 'not-taken' } }, NOT_TAKEN_SENTENCE));
      }
      children.push(
        h('p', { data: { line: 'snapshot' } }, env.safetyLine(plan.room, plan.name, 'it all')),
        h('p', { data: { line: 'duplicate' } }, 'To keep ' + openProjectName(previewed) + ' as it is, close this and use Duplicate this project first.'));
      const dialog = ctx.openDialog({
        id: 'merge-import',
        class: 'scn-apply',
        title: 'Bring in ' + entry.what + '?',
        body: h('div', { class: 'merge' }, children),
        buttons: [{ label: 'Bring it in', value: 'bring', kind: 'primary' }, { label: 'Back', value: 'back' }, { label: 'Cancel', value: null }],
        opener,
      });
      dialog.element.dataset.step = '2';
      if (notice) dialog.element.setAttribute('aria-describedby', noticeId);
      // Next moves the focus to this step's heading
      const title = dialog.element.querySelector('.dialog__title');
      title.tabIndex = -1;
      title.focus();
      return dialog.closed;
    }

    let phase = 'one';
    let notice = '';
    for (;;) {
      if (phase === 'one') {
        const next = await stepOne();
        if (next !== 'next') {
          cancelled();
          return;
        }
        state.focusRadio = false;
        state.error = '';
        phase = 'two';
        notice = '';
      }
      // every await from here to the end is under "Working…" (or under a dialog)
      const wait = working();
      let asking;
      try {
        const stopped = blocked();
        if (stopped !== '') {
          say('refused', quote(fileName) + ' was not brought in, and nothing has changed. ' + stopped);
          return;
        }
        const previewed = ctx.store.project;
        let preview;
        try {
          preview = previewPart(previewed, read, state.part, { policy: state.policy, clock: ctx.clock });
        } catch (error) {
          state.error = messageOf(error);
          state.focusRadio = true;
          phase = 'one';
          continue;
        }
        const plan = await env.snapshotPlan(fileName, snapshotName(state.part));
        if (ctx.store.project !== previewed) {
          notice = CHANGED_SENTENCE;
          continue;
        }
        asking = { previewed, preview, plan, dialog: stepTwo(preview, plan, previewed, notice) };
      } finally {
        wait.close();
      }
      const answer = await asking.dialog;
      if (answer === 'back') {
        state.focusRadio = true;
        phase = 'one';
        continue;
      }
      if (answer !== 'bring') {
        cancelled();
        return;
      }
      const outcome = await bringIn(fileName, read, state, asking);
      if (outcome === 'again') {
        notice = CHANGED_SENTENCE;
        continue;
      }
      return;
    }
  }

  // Resolves 'again' when the project changed under the question (step 2 comes back with
  // the new summary); otherwise the card's line has said what came of it.
  async function bringIn(fileName, read, state, asked) {
    const entry = partOf(state.part);
    const { previewed, preview, plan } = asked;
    const kept = { snapshot: false, point: false };
    const keptSentence = () => {
      if (kept.snapshot && kept.point) return ' A snapshot and a recovery point were kept, though nothing changed.';
      if (kept.snapshot) return ' A snapshot was kept, though nothing changed.';
      if (kept.point) return ' A recovery point was kept, though nothing changed.';
      return '';
    };
    const refused = (why) => say('refused', quote(fileName) + ' was not brought in, and nothing has changed' + why + keptSentence());
    const wait = working();
    try {
      let stopped = blocked();
      if (stopped !== '') return refused('. ' + stopped);
      if (ctx.store.project !== previewed) return 'again';
      // what can refuse is looked at before anything is kept: images are only read here
      let built = null;
      let images = {};
      if (state.part === 'building') {
        built = buildingPart(read);
        let looked;
        try {
          looked = await imagesToWrite(built.images);
        } catch (error) {
          return refused('. ' + messageOf(error));
        }
        if (looked.problem) return refused('. ' + looked.problem);
        images = looked.write;
        stopped = blocked();
        if (stopped !== '') return refused('. ' + stopped);
        if (ctx.store.project !== previewed) return 'again';
      }
      const unsnapped = await env.takeSnapshot(plan);
      if (unsnapped) return refused(', because the snapshot could not be taken first. ' + unsnapped);
      kept.snapshot = Boolean(plan.snapshots && plan.room && !plan.room.error && !plan.room.full);
      stopped = blocked();
      if (stopped !== '') return refused('. ' + stopped);
      if (ctx.store.project !== previewed) return 'again';
      if (ctx.storage) {
        try {
          kept.point = (await ctx.storage.takeRecoveryPoint('import')) !== null;
        } catch (error) { /* storage has said so itself; the import is still one undo step */ }
      }
      stopped = blocked();
      if (stopped !== '') return refused('. ' + stopped);
      if (ctx.store.project !== previewed) return 'again';
      if (built && Object.keys(images).length > 0) {
        try {
          await ctx.storage.keepFileImages({ building: built.file.building }, images);
        } catch (error) {
          return refused('. ' + messageOf(error));
        }
        stopped = blocked();
        if (stopped !== '') return refused('. ' + stopped);
        // the images are in; the session offers no way to forget them, so a project that moved
        // on in this moment leaves them unnamed, for the sweep of the images store
        if (ctx.store.project !== previewed) return 'again';
      }
      const top = topEntry();
      try {
        ctx.store.apply(importPart, { part: state.part, read, fileName, policy: state.policy });
      } catch (error) {
        return refused('. ' + messageOf(error));
      }
      const made = topEntry();
      if (made === top || made === null) {
        if (!wouldChange(state.part, preview)) {
          say('done', 'Nothing changed: ' + entry.what + ' in ' + quote(fileName) + ' matches what this project has, or is what it keeps.' + keptSentence());
          return null;
        }
        return refused('. ' + NOT_TAKEN_BY_PROJECT);
      }
      announce(fileName, entry, state, made, kept);
      return null;
    } finally {
      wait.close();
    }
  }

  // The line and the toast after a part came in, each with an Undo that takes back this step
  // and no other: the step is its history entry, and the entry is told apart by identity.
  function announce(fileName, entry, state, made, kept) {
    const sentence = 'Brought in ' + entry.what + ' from ' + fileName + '.';
    const lines = summaryLines(state.part, made.outcome, ctx.store.project);
    const name = snapshotName(state.part);
    latest = made;
    function undoStep(fromToast) {
      const owns = latest === made;
      // `offer` keeps Undo on the line; `ok` is a step taken back (Undo's own toast has said so)
      const tell = (text, offer, ok) => {
        if (owns) say('done', text, offer ? lines : [], offer ? line : undefined, !fromToast);
        if (!ok && (fromToast || !owns)) ctx.toast({ text });
      };
      const history = ctx.store.history;
      const newest = (list) => (list.length > 0 ? list[list.length - 1] : null);
      if (newest(history.past) === made) {
        ctx.undo();
        const now = ctx.store.history;
        if (newest(now.future) === made) {
          tell('Undid bringing in ' + entry.what + ' from ' + quote(fileName) + '. This project is as it was.', false, true);
        } else {
          tell('Nothing was undone: the project did not take Undo. ' + sentence, true, false);
        }
      } else if (history.future.includes(made)) {
        tell('Bringing in ' + entry.what + ' from ' + quote(fileName) + ' was already undone.', false, false);
      } else if (history.past.includes(made)) {
        tell(sentence + ' Later changes sit on top of it, so Undo cannot take it back by itself. Undo them first, or restore ' + quote(name) + ' from Snapshots.', false, false);
      } else {
        tell(sentence + ' It is no longer in the list of changes Undo keeps, so Undo cannot take it back. Restore ' + quote(name) + ' from Snapshots to go back.', false, false);
      }
    }
    const line = { run: () => undoStep(false) };
    say('done', sentence + ' Undo brings it all back.', lines, line);
    ctx.toast({ text: sentence, action: { label: 'Undo', run: () => undoStep(true) } });
  }

  run.busy = () => running;
  return run;
}
