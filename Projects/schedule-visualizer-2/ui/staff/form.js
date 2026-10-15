// The publish form (DESIGN 5.6, spec 12.5), top to bottom: the staff
// passcode, what readers will see of the problems that remain, and "Publish a
// file", so that all three are on screen in a 1280 px window; then, folded
// under "What is in it", which views the file holds and teacher names on the
// map; then how long the file counts as current. Under it, batch printing
// (spec 12.4).
//
// Every choice is a setting of the project (project.publish), changed through
// setPublishSetting: it is saved, it is one undo step, and it travels in the
// project file. There is no Save button; a field commits when it is left or
// Enter is pressed.
//
//   const form = publishForm(ctx, hooks);
//   form.element
//   form.update(project)     the project changed: every control follows it
//   form.publish()           what the button does; resolves when the file is handed over
//   form.stop()
//
// `hooks.deliver(published)`, when a test sets it, takes the file instead of
// the download; `hooks.published` is the last file made. `hooks.assembled`,
// when a test sets it, is awaited between the file being made and its being
// handed over, so a case can change the project in that gap.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { openPrintPreview } from '../components/print-preview.js';
import { printDate } from '../prints/document.js';
import { batchWords } from '../prints/batch.js';
import { notePublished, setPublishSetting } from '../../engine/actions.js';
import { PUBLISH_VIEWS, RANGES } from '../../engine/schema.js';
import { isProtected } from '../../engine/publish-data.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { pageReader, failureSentence } from './assemble.js';
import { publishDocument, deviceRandom, fileTarget } from './targets.js';
import { partsOf, sameParts } from './preview.js';
import { readerSentences, readerSummary, NOTHING_REMAINS as NOTHING } from './readers.js';

// What each view is called on the form, in the order of spec 12.2.
export const VIEW_LABELS = {
  teacher: 'Teacher pages',
  group: 'Group pages',
  room: 'Room pages and door signs',
  map: 'Building map',
  free: 'Free right now',
  now: 'Where is this group right now',
  common: 'Common planning',
  coverage: 'Coverage',
  sub: 'Substitute plan',
  directions: 'Directions',
  staffing: 'Staffing overview',
};

export const PASSCODE_TRUTH = 'A short or guessable passcode stops a casual look, not someone set on guessing it. Tell staff this passcode: the file asks for it once on each device.';
export const PASSCODE_DEFAULT = 'This is the passcode the tool starts with, so it is public. Change it, then tell staff the new one.';
export const PASSCODE_OFF = 'With no passcode, anyone who has the file can read the schedule.';
export const PASSCODE_EMPTY = 'A passcode cannot be empty. To publish without one, untick "Ask for a staff passcode".';
export const PASSCODE_NOT_TAKEN = 'Nothing was published: the passcode in the box was not taken. Change it, or press Escape in the box to go back to the last one.';
export const NOT_SENT = 'Nothing was sent anywhere: send the file on yourself, by mail or on a shared drive.';
export const PUBLISH_FAILED = 'The file could not be made, so nothing was published. Check the connection and try again.';
// for a failure that is neither the connection's nor one the tool has a sentence for
export const PUBLISH_BROKE = 'The file could not be made, so nothing was published. Reload the page and try again.';
export const CHECKS_PENDING = 'Working out what readers will see.';
export const CHECKS_FAILED = 'The checks could not be run just now, so this form cannot say what readers will see. Look at Schedule › Checks.';
export const CHECKS_NOT_HERE = 'The checks are not running in this tab, so this form cannot say what readers will see. Look at Schedule › Checks.';
export const CHECKS_WAIT = 'Waiting for the checks of the project as it is now.';
export const CHECKS_REFUSED = 'Nothing was published: the checks could not be run, so the file would go out with nothing said about what readers will see. Try again in a moment, or reload the page.';
export const READ_ONLY_MADE = 'This tab is read-only, so the project does not record that a file was made.';
// the file went out and the project then refused the note of it
export const NOT_NOTED = 'The project could not record that a file was made.';
// the project changed while the file was being put together (DECISIONS 2026-10-12 18:15)
export const MOVED_ON = 'The schedule changed while the file was being made. The file is of the schedule as it was when Publish was pressed, and the changes made since are not in it: publish again to send them.';
// How long the checks may take before the list says it is being worked out.
// They answer in a few milliseconds as a rule; words that came and went with
// every keystroke would move the Publish button under the pointer.
export const CHECKS_WORDS_AFTER_MS = 400;
export const STALE_LABEL = 'Days until the file counts as out of date';
export const NOTES_LINE = 'Teacher notes are published: the substitute plan shows them.';
export const MAIL_LINE = 'On a phone, open the file in Safari or Chrome, or save it to Files first; a mail app’s preview will not work.';
export const NOTHING_REMAINS = NOTHING;

const DAY_MS = 24 * 60 * 60 * 1000;

function kilobytes(bytes) {
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (Math.round(bytes / 1024 / 102.4) / 10) + ' MB';
}

export function publishForm(ctx, hooks) {
  const store = ctx.store;
  let stopped = false;
  let busy = false;
  // what the box brings back when protection is turned on again
  let lastPasscode = DEFAULT_PASSCODE;
  // whose passcode that is: another project never inherits it
  let lastProject = null;
  // The checks on screen: `asked` is the project they were last asked for,
  // `answer` the promise for that asking (true once its lines are drawn, false
  // when the run was refused), `wordsTimer` the wait before the pending words.
  let asked = null;
  let answer = null;
  let wordsTimer = null;

  // One change to project.publish. A value the action will not take is said,
  // and the control goes back to what the project holds. (A tab that cannot
  // change the project says so itself and draws the section again:
  // storage/session.js.)
  function change(key, value) {
    try {
      store.apply(setPublishSetting, { key, value });
      return true;
    } catch (error) {
      ctx.toast({ text: error && error.message ? error.message : 'That could not be changed.', kind: 'problem' });
      update(store.project);
      return false;
    }
  }

  function heldAt(key) {
    const publish = store.project.publish;
    return key.startsWith('views.') ? publish.views[key.slice(6)] : publish[key];
  }

  function check(name, label, onChange) {
    const id = uid('publish-' + name);
    const box = h('input', { type: 'checkbox', class: 'stf-check__box', id, name });
    box.addEventListener('change', () => onChange(box.checked));
    return { box, element: h('label', { class: 'stf-check', for: id }, box, h('span', null, label)) };
  }

  function group(title, ...children) {
    const id = uid('publish-group');
    return h('div', { class: 'pub__group', role: 'group', 'aria-labelledby': id }, h('h3', { class: 'eyebrow pub__title', id }, title), children);
  }

  // A field's commit: false when the project did not take the value (a tab
  // that cannot change it), so the field goes back to what the project holds.
  function taken(key, value) {
    store.apply(setPublishSetting, { key, value });
    return heldAt(key) === value ? undefined : false;
  }

  // ---- views, and names on the map

  const views = PUBLISH_VIEWS.map((view) => ({ view, ...check('view-' + view, VIEW_LABELS[view] || view, (on) => change('views.' + view, on)) }));
  for (const each of views) each.box.dataset.view = each.view;
  const names = check('names', 'Show teacher names on the map', (on) => change('teacherNamesOnMap', on));

  // ---- staleness

  const staleHint = uid('publish-stale-hint');
  // the group's heading is the field's label: one line, not a heading and a label saying the same
  const staleTitle = uid('publish-stale-title');
  const staleSays = h('p', { class: 'pub__hint', id: staleHint });
  const stale = field({
    id: 'publish-stale',
    value: store.project.publish.stalenessDays,
    parse: wholeNumber('The number of days'),
    type: 'text',
    inputMode: 'numeric',
    width: '6rem',
    describedBy: staleHint,
    commit: (value) => taken('stalenessDays', value),
  });

  // ---- the passcode

  const truthId = uid('publish-truth');
  const truth = h('p', { class: 'pub__hint', id: truthId, data: { says: 'passcode' } });
  const protect = check('protect', 'Ask for a staff passcode', (on) => {
    if (on) change('passcode', lastPasscode === '' ? DEFAULT_PASSCODE : lastPasscode);
    else change('passcode', '');
  });
  protect.box.id = 'publish-protect';
  protect.element.setAttribute('for', 'publish-protect');
  const passcode = field({
    id: 'publish-passcode',
    label: 'Staff passcode',
    value: store.project.publish.passcode,
    describedBy: truthId,
    // spaces around a passcode are a slip of the thumb, and nobody could type them back
    parse: (text) => text.trim(),
    commit: (value) => {
      if (value === '') throw new Error(PASSCODE_EMPTY);
      return taken('passcode', value);
    },
  });
  passcode.input.setAttribute('autocapitalize', 'off');
  passcode.input.setAttribute('autocorrect', 'off');

  // ---- what readers will see

  const checksList = h('ul', { class: 'pub__checks', data: { says: 'checks' } });
  const checksSays = h('p', { class: 'pub__hint', data: { says: 'checks-summary' } });

  function drawChecks(project, results) {
    const read = readerSentences(project, results);
    const { lines } = read;
    checksList.replaceChildren(...lines.map((line) => h('li', { data: { finding: line.id, kind: line.kind } }, line.text)));
    checksList.hidden = lines.length === 0;
    const summary = readerSummary(read);
    checksSays.textContent = summary;
    checksSays.hidden = summary === '';
    element.dataset.checks = String(lines.length);
  }

  function settled() {
    delete element.dataset.checksPending;
    checksList.removeAttribute('aria-busy');
    if (wordsTimer !== null) clearTimeout(wordsTimer);
    wordsTimer = null;
  }

  // A run that gave no answer: the lines of an earlier project do not stand
  // beside it, and the next asking (a change, or a press of Publish) runs the
  // checks again.
  function refused(words) {
    settled();
    checksList.replaceChildren();
    checksList.hidden = true;
    checksSays.textContent = words;
    checksSays.hidden = false;
    element.dataset.checks = 'none';
    asked = null;
    return false;
  }

  // The findings are the engine client's. They are asked for once per state
  // of the project. Until the answer for a change comes the form is marked
  // data-checks-pending and the last lines stay, dimmed; an answer that takes
  // long has words. Publish waits on what this returns (DECISIONS 2026-10-12
  // 12:30): a promise for true once the lines of `project` are on screen, or
  // for false when its checks could not be run.
  function askChecks(project) {
    if (asked === project && answer !== null) return answer;
    asked = project;
    if (!store.derived || !store.derived.engine) {
      answer = Promise.resolve(refused(CHECKS_NOT_HERE));
      return answer;
    }
    element.dataset.checksPending = 'true';
    checksList.setAttribute('aria-busy', 'true');
    if (wordsTimer === null) {
      wordsTimer = setTimeout(() => {
        wordsTimer = null;
        if (stopped || element.dataset.checksPending !== 'true') return;
        checksSays.textContent = CHECKS_PENDING;
        checksSays.hidden = false;
      }, CHECKS_WORDS_AFTER_MS);
    }
    const mine = store.derived.results().then((results) => {
      // a newer asking has taken over: its answer is this one's too
      if (stopped || asked !== project || answer !== mine) return answer !== mine && answer !== null ? answer : false;
      settled();
      drawChecks(project, results);
      return true;
    }, (error) => {
      if (stopped || asked !== project || answer !== mine) return answer !== mine && answer !== null ? answer : false;
      console.warn('Schedule Visualizer 2: the checks could not be run for the publish form.', error);
      return refused(CHECKS_FAILED);
    });
    answer = mine;
    return mine;
  }

  // The project whose lines are on screen, which is the project as it is
  // now: the one the file is made from. Null when its checks cannot be run
  // (asked twice: a refusal is tried once more, and the engine client never
  // remembers a failed run, so each asking is a new one).
  async function checksStand() {
    for (let tries = 0; tries < 2; tries += 1) {
      for (;;) {
        const project = store.project;
        const drawn = await askChecks(project);
        if (stopped) return null;
        if (store.project !== project) continue;
        if (drawn) return project;
        break;
      }
    }
    return null;
  }

  // ---- publish

  const says = h('p', { class: 'pub__says', role: 'status', data: { says: 'published' } });
  // A file's name ends in its day, which is one word: it goes to the next
  // line whole, never cut at a hyphen.
  function fileWords(fileName) {
    const at = fileName.lastIndexOf(' ');
    return h('span', { class: 'pub__file', data: { says: 'published-file' } }, fileName.slice(0, at + 1), h('span', { class: 'pub__file-day' }, fileName.slice(at + 1)));
  }
  // The passcode a file asks for is typed text: it stands in an element of its
  // own, last on the line, so no full stop reads as part of it.
  // `moved`: the project changed while the file was being made. `noted`:
  // true, or the sentence saying why the project does not record the file.
  function saysPublished(published, size, passcode, noted, moved) {
    const made = ['Published ', fileWords(published.fileName), size + '. ' + (moved ? MOVED_ON + ' ' : '') + NOT_SENT + ' ' + (noted === true ? '' : noted + ' ')];
    if (!published.locked) {
      says.replaceChildren(...made, 'It opens with no passcode.');
      return;
    }
    says.replaceChildren(...made, 'It asks for the staff passcode: ', h('strong', { class: 'pub__passcode', data: { says: 'published-passcode' } }, passcode));
  }
  const button = h('button', { type: 'button', class: 'btn btn--primary', id: 'publish-file' }, fileTarget.action);

  const readOnly = () => Boolean(ctx.storage && ctx.storage.state && ctx.storage.state.readOnly);

  async function publish() {
    if (busy) return null;
    // what is in the box was refused, so the project still holds another passcode than the one on screen
    if (isProtected(store.project) && passcode.input.getAttribute('aria-invalid') === 'true') {
      says.textContent = PASSCODE_NOT_TAKEN;
      return null;
    }
    busy = true;
    button.setAttribute('aria-disabled', 'true');
    element.dataset.publishing = 'true';
    try {
      // The press is held until the list above is the list of the project
      // the file is made from: a file never goes out beside the lines of an
      // earlier project.
      says.textContent = element.dataset.checksPending === 'true' || asked !== store.project ? CHECKS_WAIT : 'Putting the file together.';
      // The file is made from the project the checks were for, the very
      // object, whatever the store holds by the time it is ready.
      const project = await checksStand();
      if (project === null) {
        if (!stopped) says.textContent = CHECKS_REFUSED;
        return null;
      }
      says.textContent = 'Putting the file together.';
      const published = await publishDocument(pageReader(), project, { clock: ctx.clock, random: deviceRandom() });
      if (typeof hooks.assembled === 'function') await hooks.assembled(published);
      hooks.published = published;
      const delivered = typeof hooks.deliver === 'function' ? hooks.deliver(published) : fileTarget.deliver(published);
      const size = delivered && typeof delivered.bytes === 'number' ? ' (' + kilobytes(delivered.bytes) + ')' : '';
      // From here the file is out, and nothing below may say it is not.
      // "The schedule changed" only when something a reader would see did: a
      // theme or a paper size is a new project and the same file.
      const moved = store.project !== project && !sameParts(partsOf(project, published.locked), partsOf(store.project, published.locked));
      // A tab that cannot change the project still made its file. It is not
      // asked to note it: the refusal's toast ("Nothing changed") would be
      // the one false thing on the screen.
      let noted = readOnly() ? READ_ONLY_MADE : true;
      if (noted === true) {
        try {
          store.apply(notePublished, { at: published.model.publishedAt });
        } catch (error) {
          console.warn('Schedule Visualizer 2: the file was made, and the project could not record it.', error);
          noted = NOT_NOTED;
        }
      }
      saysPublished(published, size, project.publish.passcode, noted, moved);
      if (moved) element.dataset.publishedOf = 'earlier';
      else delete element.dataset.publishedOf;
      // The list is of what is on screen, not of what went out, and nothing
      // here asks for it again: a project that moved, or the note just made
      // of the publish, reached update(), which asked; in a read-only tab
      // the store refuses every change, so the project on screen is the one
      // checksStand asked about (SV2-51).
      if (typeof hooks.made === 'function') hooks.made(published, noted === true);
      return published;
    } catch (error) {
      console.warn('Schedule Visualizer 2: the file could not be made.', error);
      says.textContent = failureSentence(error, { connection: PUBLISH_FAILED, other: PUBLISH_BROKE });
      return null;
    } finally {
      busy = false;
      button.removeAttribute('aria-disabled');
      delete element.dataset.publishing;
    }
  }
  button.addEventListener('click', publish);

  // ---- batch printing

  const batchSays = h('p', { class: 'pub__hint', data: { says: 'batch' } });
  const batch = (output, label) => {
    const made = h('button', { type: 'button', class: 'btn', data: { print: output } }, label);
    made.addEventListener('click', () => openPrintPreview(ctx, output, { opener: made }));
    return made;
  };

  // The eleven views and the map's names are folded away: the summary says
  // how many views the file holds, and that the map carries no names when it
  // does not, so nothing is hidden that matters.
  const foldSays = h('span', { class: 'pub__fold-says', data: { says: 'views' } });
  const fold = h('details', { class: 'pub__fold', id: 'publish-contents' },
    h('summary', { class: 'pub__fold-title' }, h('span', { class: 'eyebrow' }, 'What is in it'), ' · ', foldSays),
    group('Views to include', h('div', { class: 'pub__list' }, views.map((each) => each.element))),
    group('The map', names.element));

  const element = h('div', { class: 'pub', data: { checks: '0' } },
    h('h2', { class: 'pub__heading' }, 'Publish'),
    h('p', { class: 'pub__lead' }, fileTarget.says),
    group('Passcode', protect.element, passcode.element, truth),
    group('Before you publish', checksList, checksSays, h('p', { class: 'pub__hint', data: { says: 'notes' } }, NOTES_LINE)),
    h('div', { class: 'pub__publish' }, button, says, h('p', { class: 'pub__hint', data: { says: 'mail' } }, MAIL_LINE)),
    fold,
    h('div', { class: 'pub__group', role: 'group', 'aria-labelledby': staleTitle }, h('h3', { class: 'eyebrow pub__title', id: staleTitle }, h('label', { for: 'publish-stale' }, STALE_LABEL)), stale.element, staleSays),
    h('h2', { class: 'pub__heading pub__heading--next' }, 'Print for the whole school'),
    batchSays,
    h('div', { class: 'pub__batch' },
      batch('teacher-schedules', 'Print every teacher’s schedule'),
      batch('door-signs', 'Print every door sign'),
      batch('door-signs-day', 'Print every door sign with the room’s day')));

  function update(project) {
    const publish = project.publish;
    for (const each of views) each.box.checked = publish.views[each.view] !== false;
    const held = views.filter((each) => each.box.checked).length;
    names.box.checked = publish.teacherNamesOnMap !== false;
    foldSays.textContent = (held === views.length ? 'All ' + views.length + ' views' : held + ' of ' + views.length + ' views') + (names.box.checked ? '' : ', no teacher names on the map');
    stale.set(publish.stalenessDays);
    const until = printDate(new Date(ctx.clock().getTime() + publish.stalenessDays * DAY_MS));
    staleSays.textContent = 'Readers see a notice once the file is older than this. Published today, it is current until ' + until + '. From 1 to ' + RANGES.stalenessDays[1] + ' days.';

    const on = isProtected(project);
    if (project.id !== lastProject) {
      lastProject = project.id;
      lastPasscode = DEFAULT_PASSCODE;
    }
    if (on) lastPasscode = publish.passcode;
    protect.box.checked = on;
    passcode.element.hidden = !on;
    if (on) passcode.set(publish.passcode);
    truth.textContent = !on ? PASSCODE_OFF : publish.passcode === DEFAULT_PASSCODE ? PASSCODE_DEFAULT : PASSCODE_TRUTH;

    const words = batchWords(project);
    batchSays.textContent = 'One document each, a sheet for every teacher or room after a cover sheet: ' + words.teachers + ', ' + words.rooms + '. Choose "Save as PDF" in the print dialog for one file.';
    askChecks(project);
  }

  update(store.project);

  return {
    element,
    update,
    publish,
    stop() {
      stopped = true;
      if (wordsTimer !== null) clearTimeout(wordsTimer);
    },
  };
}
