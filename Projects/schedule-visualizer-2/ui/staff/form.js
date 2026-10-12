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
// the download; `hooks.published` is the last file made.

import { h, uid } from '../components/dom.js';
import { field, wholeNumber } from '../components/field.js';
import { openPrintPreview } from '../components/print-preview.js';
import { printDate } from '../prints/document.js';
import { batchWords } from '../prints/batch.js';
import { notePublished, setPublishSetting } from '../../engine/actions.js';
import { PUBLISH_VIEWS, RANGES } from '../../engine/schema.js';
import { isProtected } from '../../engine/publish-data.js';
import { DEFAULT_PASSCODE } from '../../engine/publish-defaults.js';
import { pageReader, LinkError } from './assemble.js';
import { publishDocument, deviceRandom, fileTarget } from './targets.js';
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
  let asked = null;

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

  // The findings are the engine client's. They are asked for once per state
  // of the project; until the answer for a change comes, the last stays.
  function askChecks(project) {
    if (asked === project) return;
    asked = project;
    if (!store.derived || !store.derived.engine) {
      checksSays.textContent = 'The checks are not running in this tab, so look at Schedule › Checks before you publish.';
      checksSays.hidden = false;
      checksList.hidden = true;
      return;
    }
    element.dataset.checksPending = 'true';
    store.derived.results().then((results) => {
      if (stopped || asked !== project) return;
      delete element.dataset.checksPending;
      drawChecks(project, results);
    }, () => {
      if (stopped || asked !== project) return;
      delete element.dataset.checksPending;
      checksSays.textContent = 'The checks could not be run just now. Look at Schedule › Checks before you publish.';
      checksSays.hidden = false;
    });
  }

  // ---- publish

  const says = h('p', { class: 'pub__says', role: 'status', data: { says: 'published' } });
  // The passcode a file asks for is typed text: it stands in an element of its
  // own, last on the line, so no full stop reads as part of it.
  function saysPublished(published, size, passcode) {
    const made = 'Published ' + published.fileName + size + '. ' + NOT_SENT + ' ';
    if (!published.locked) {
      says.textContent = made + 'It opens with no passcode.';
      return;
    }
    says.replaceChildren(made + 'It asks for the staff passcode: ', h('strong', { class: 'pub__passcode', data: { says: 'published-passcode' } }, passcode));
  }
  const button = h('button', { type: 'button', class: 'btn btn--primary', id: 'publish-file' }, fileTarget.action);

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
    says.textContent = 'Putting the file together.';
    try {
      const project = store.project;
      const published = await publishDocument(pageReader(), project, { clock: ctx.clock, random: deviceRandom() });
      hooks.published = published;
      const delivered = typeof hooks.deliver === 'function' ? hooks.deliver(published) : fileTarget.deliver(published);
      const size = delivered && typeof delivered.bytes === 'number' ? ' (' + kilobytes(delivered.bytes) + ')' : '';
      saysPublished(published, size, project.publish.passcode);
      try {
        store.apply(notePublished, { at: published.model.publishedAt });
      } catch (error) {
        // a tab that cannot change the project still made its file
      }
      return published;
    } catch (error) {
      says.textContent = error instanceof LinkError && error.message ? error.message : PUBLISH_FAILED;
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
  // how many views the file holds, so nothing is hidden that matters.
  const foldSays = h('span', { class: 'pub__fold-says', data: { says: 'views' } });
  const fold = h('details', { class: 'pub__fold', id: 'publish-contents' },
    h('summary', { class: 'pub__fold-title' }, h('span', { class: 'eyebrow' }, 'What is in it'), foldSays),
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
    foldSays.textContent = held === views.length ? 'All ' + views.length + ' views' : held + ' of ' + views.length + ' views';
    names.box.checked = publish.teacherNamesOnMap !== false;
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
    },
  };
}
