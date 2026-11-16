// The Projects on this device card (spec 13.1, DESIGN 15.2 with 15.9's
// revisions): the first card of the Project section.
//
// With one project it is a line, the Label field and two buttons, so a school
// that never keeps a second project is not made to think about it. With more
// than one it is a list: the open project first, marked "Open" in a pill, then
// the rest by most recently put aside, each row with Open, Rename… and Delete…
// named by its label (the buttons carry aria-describedby the label line).
//
// Everything that moves between projects is ctx.storage.projects (storage/
// session.js): open, startAnother, duplicate, rename, remove and
// restoreAsProject. Each answers { ok, code, text } and the page reloads a
// moment after a switch, so this file writes the sentence the page that follows
// will say (rememberOpening) and the page's start reads it back
// (openedSentences, which ui/app.js calls once after storage is ready).
//
// A button that cannot be used is aria-disabled with the reason beside it
// (DESIGN 15.9 item 15), and stays focusable. The card carries data-pending
// while its list is being read, so a test waits on that, never on a first paint.
//
// Exported for ui/app.js: openedSentences(ctx), keptDialog(ctx, options) (the
// one-per-id choice, used by the sample school's Load), projectsKept's words.

import { h, uid } from '../components/dom.js';
import { card } from '../components/card.js';
import { field } from '../components/field.js';
import { count } from '../components/words.js';
import { openProjectName } from './clear.js';
import { holdsWords, importSafetyLine } from './files.js';
import { setProjectLabel, replaceProject } from '../../engine/actions.js';
import { PROJECT_LABEL_MOST } from '../../engine/scenario.js';
import { readProjectFile } from '../../engine/project-file.js';
import { CURRENT_VERSION } from '../../engine/schema.js';
import { PROJECTS_MOST } from '../../storage/db.js';
import { pageSnapshots } from '../../storage/snapshots.js';
import { formatBytes, whenInSentence, whenWords } from '../../storage/words.js';

// The sessionStorage key this page writes for the page that follows a switch:
// { kind: 'open' | 'start' | 'duplicate', from }. Read once and removed.
export const OPENING_NOTE_KEY = 'sv2:opening-note';

// From this many projects the card says how many can be kept.
const LIMIT_SAID_FROM = 15;
// The label's count is shown from here, and announced at these lengths only.
const COUNT_FROM = 50;
const COUNT_ANNOUNCED = [50, 55, 60];

const READ_ONLY = 'This tab is read-only while the project is open in another tab, so it cannot open, start, duplicate or delete projects.';
const OPEN_FIRST = 'To delete this one, open another first.';
// storage/db.js keeps this many recovery points of each project that is not open (21.10)
const OTHERS_KEPT = 3;
// After a reload the card waits at most this many frames for its section to be on the page.
const HEADING_FRAMES = 12;
// ... and only for a page this young.
const HEADING_WITHIN_MS = 10000;
const SWITCH_SAYS = 'Undo starts afresh for each project you open.';

const textLength = (value) => Array.from(String(value)).length;
const quote = (text) => '“' + text + '”';
const messageOf = (error) => (error && error.message ? error.message : 'Try again.');

// What a kept project goes by in a sentence: label, else school name, else "Untitled project".
export function entryName(entry) {
  return openProjectName({ label: entry.label, settings: { schoolName: entry.schoolName } });
}

// "<name> (copy)", cut with an ellipsis so the whole is at most PROJECT_LABEL_MOST.
// A name that already ends in " (copy)" or " (copy N)" is not chained
// ("X (copy) (copy)"): it becomes " (copy 2)", " (copy N+1)".
export function suffixedLabel(name, suffix) {
  let base = name;
  let ending = suffix;
  const again = suffix === ' (copy)' ? / \(copy(?: (\d+))?\)$/.exec(name) : null;
  if (again) {
    base = name.slice(0, again.index);
    ending = ' (copy ' + (again[1] === undefined ? 2 : Number(again[1]) + 1) + ')';
  }
  const room = PROJECT_LABEL_MOST - ending.length;
  const letters = Array.from(base);
  const cut = letters.length > room ? letters.slice(0, Math.max(0, room - 1)).join('').trimEnd() + '…' : base;
  return cut + ending;
}

// ------------------------------------------------ the sentence after a reload

export function rememberOpening(note) {
  try {
    globalThis.sessionStorage.setItem(OPENING_NOTE_KEY, JSON.stringify(note));
  } catch (error) { /* the page opens all the same, with the plain sentence */ }
}

export function forgetOpening() {
  try {
    globalThis.sessionStorage.removeItem(OPENING_NOTE_KEY);
  } catch (error) { /* nothing to forget */ }
}

function takeOpening() {
  try {
    const raw = globalThis.sessionStorage.getItem(OPENING_NOTE_KEY);
    if (raw === null) return null;
    globalThis.sessionStorage.removeItem(OPENING_NOTE_KEY);
    const note = JSON.parse(raw);
    return note && typeof note === 'object' && typeof note.kind === 'string' ? note : null;
  } catch (error) {
    return null;
  }
}

let opened; // undefined until read; then null or { line, toast, focus }

// The sentences for a page opened by a switch: { line, toast, focus } or null.
// Read once per page (the note and storage's own marker are each removed when
// read), so the shell and the card both ask and get the same answer.
export function openedSentences(ctx) {
  if (opened !== undefined) return opened;
  const marker = ctx.storage && ctx.storage.state ? ctx.storage.state.opened : null;
  const note = takeOpening();
  opened = null;
  if (!marker || marker.id !== ctx.store.project.id) return opened;
  const name = openProjectName(ctx.store.project);
  const format = ctx.store.project.settings.timeFormat;
  const kept = note && note.from ? note.from + ' is kept on this device.' : 'Your other projects are kept on this device.';
  const toast = note && (note.kind === 'duplicate' || note.kind === 'start')
    ? 'Opened ' + name + '. ' + kept
    : 'Opened ' + name + '. ' + kept + ' ' + SWITCH_SAYS;
  opened = { line: 'Opened ' + name + ' ' + whenInSentence(marker.at, ctx.clock(), format) + '.', toast, focus: true };
  return opened;
}

// ------------------------------------------------ the one-per-id choice

// The question a project that is already kept raises (DESIGN 15.9 item 3):
// two ways on, never a detour only. Resolves to 'open', 'keep', 'replace' or null.
//   options.sentence   the first sentence ("This file is a copy of …")
//   options.label, options.heldBy ('open' | 'shelf')
//   options.replace    offer "Replace the open project" (only where it means something)
//   options.what       what Open forgets ("file")
export function keptChoices(options) {
  const buttons = [];
  if (options.heldBy === 'shelf') buttons.push({ value: 'open', label: 'Open ' + options.label });
  else if (options.replace) buttons.push({ value: 'replace', label: 'Replace the open project' });
  buttons.push({ value: 'keep', label: 'Keep it as another project' });
  return buttons;
}

export function keptDialog(ctx, options) {
  const buttons = keptChoices(options).map((each, index) => ({ label: each.label, value: each.value, kind: index === 0 ? 'primary' : 'plain' }));
  buttons.push({ label: 'Cancel', value: null });
  const forgets = options.heldBy === 'shelf' && options.forgets
    ? h('p', null, 'Open ' + options.label + ' forgets this ' + options.forgets + ': after it opens, choose the ' + options.forgets + ' again.')
    : null;
  return ctx.openDialog({
    title: options.title,
    body: [h('p', { role: 'alert' }, options.sentence), forgets],
    buttons,
    opener: options.opener,
  }).closed;
}

// A dialog that is working (its question is with storage) cannot be cancelled:
// Escape and Cancel do nothing and the dialog says aria-busy, so a late answer
// is never written into a dialog that has closed. `working()` is asked each time.
export function holdWhileWorking(dialog, working) {
  const buttons = dialog.element.querySelectorAll('.dialog__buttons button');
  const cancel = buttons[buttons.length - 1];
  const stop = (event) => {
    if (!working()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  dialog.element.addEventListener('cancel', stop, true);
  dialog.element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stop(event);
  }, true);
  dialog.element.addEventListener('click', (event) => {
    if (event.target === cancel) stop(event);
  }, true);
  return (on) => {
    if (on) dialog.element.setAttribute('aria-busy', 'true');
    else dialog.element.removeAttribute('aria-busy');
  };
}

// ------------------------------------------------ the card

export function projectsCard(ctx) {
  const storage = ctx.storage;
  const store = ctx.store;
  const ids = { label: uid('proj-label'), hint: uid('proj-hint'), readOnly: uid('proj-readonly'), limit: uid('proj-limit'), count: uid('proj-count') };

  const openedLine = h('p', { class: 'proj__opened', data: { line: 'opened' }, hidden: true });
  const lead = h('p', { class: 'card__lead', data: { line: 'lead' } });
  const hint = h('p', { class: 'card__small', id: ids.hint }, 'A name for this project on this device, such as Next year. The school’s name is in Settings.');
  const countLine = h('p', { class: 'card__small proj__count', id: ids.count, hidden: true, data: { line: 'label-count' } });
  const countLive = h('p', { class: 'vh', role: 'status', data: { line: 'label-count-live' } });
  const labelField = field({
    id: ids.label,
    label: 'Label (optional)',
    value: typeof store.project.label === 'string' ? store.project.label : '',
    describedBy: ids.hint + ' ' + ids.count,
    commit: (text) => {
      store.apply(setProjectLabel, { label: text });
    },
  });
  const list = h('ul', { class: 'proj__list', data: { list: 'projects' }, hidden: true });
  const readOnlyLine = h('p', { class: 'proj__reason', id: ids.readOnly, hidden: true, data: { line: 'read-only' } }, READ_ONLY);
  const limitLine = h('p', { class: 'proj__reason', id: ids.limit, hidden: true, data: { line: 'limit' } });
  const result = h('p', { class: 'proj__result', hidden: true, data: { line: 'result' } });
  const keepsNote = h('p', { class: 'card__small' }, 'Clear… replaces the open project; these keep it.');

  const startButton = h('button', { type: 'button', class: 'btn', data: { action: 'start-another' } }, 'Start another project…');
  const duplicateButton = h('button', { type: 'button', class: 'btn', data: { action: 'duplicate' } }, 'Duplicate this project');
  const buttons = h('div', { class: 'card__buttons' }, startButton, duplicateButton);

  const element = card({ id: 'projects', title: 'Projects on this device' },
    openedLine, lead, labelField.element, hint, countLine, countLive, list, readOnlyLine, limitLine, result, buttons, keepsNote);
  const heading = element.querySelector('.card__title');
  heading.setAttribute('tabindex', '-1');
  element.dataset.pending = 'true';

  let rows = []; // storage.projects.list(), last read
  let busy = false;
  let drawn = 0;
  let want = null; // where the focus goes after the next draw

  const sentence = openedSentences(ctx);
  // The heading takes the focus on the page a switch just opened, not on a card built later (a reader who came to this section minutes after).
  let headingWanted = Boolean(sentence && sentence.focus && performance.now() < HEADING_WITHIN_MS);
  let headingFrames = 0;
  if (sentence) {
    openedLine.hidden = false;
    openedLine.textContent = sentence.line;
  }

  const readOnly = () => Boolean(storage.state.readOnly);
  const openName = () => openProjectName(store.project);

  // ---- the shell's one say-so for a failure: a line in the card

  function say(kind, text) {
    result.hidden = text === '';
    result.dataset.result = kind;
    result.setAttribute('role', kind === 'refused' ? 'alert' : 'status');
    result.textContent = text;
  }

  // ---- disabled is never silent

  // A row's button is named by its label line (data-names); a reason is added
  // after it, never in its place, and taken away again when it no longer holds.
  function gate(button, reasonId, reason) {
    const names = button.dataset.names;
    if (reason) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-describedby', names ? names + ' ' + reasonId : reasonId);
    } else {
      button.removeAttribute('aria-disabled');
      if (names) button.setAttribute('aria-describedby', names);
      else if (button.getAttribute('aria-describedby') === reasonId) button.removeAttribute('aria-describedby');
    }
  }

  const disabled = (button) => button.getAttribute('aria-disabled') === 'true';

  // The row button that says it is working. It is found again by its row and action,
  // because the list is drawn again while a switch is under way ('switching').
  let working = null; // { id, action, text, was }

  function liveWorking() {
    if (!working) return null;
    const li = list.querySelector('[data-project-id="' + CSS.escape(working.id) + '"]');
    return li ? li.querySelector('[data-action="' + working.action + '"]') : null;
  }

  function showWorking() {
    const button = liveWorking();
    if (!button) return null;
    button.dataset.was = working.was;
    button.textContent = working.text;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    return button;
  }

  // On: `button` is a row's button, which reads `text` and says it is busy.
  // Off: the same button (the live one) is as it was; it is returned.
  function setBusy(on, button, text) {
    busy = on;
    if (on) element.setAttribute('aria-busy', 'true');
    else element.removeAttribute('aria-busy');
    if (on && button) {
      const li = button.closest('[data-project-id]');
      working = li ? { id: li.dataset.projectId, action: button.dataset.action, text, was: button.textContent } : null;
      if (working) showWorking();
      return button;
    }
    if (!on && working) {
      const live = liveWorking();
      const was = working.was;
      working = null;
      if (live) {
        live.textContent = was;
        delete live.dataset.was;
        live.removeAttribute('aria-disabled');
        live.removeAttribute('aria-busy');
      }
      return live;
    }
    return null;
  }

  // ---- the label

  // No maxlength on the field: it counts UTF-16 units and the limit is in characters
  // (a name with letters outside the basic plane would be cut short), and it would
  // silently cut text pasted in. The count shows from 50, the live region speaks at
  // 50, 55 and 60 and once more when the label is over, and the store's refusal says
  // the limit in a sentence.
  let lastLength = null; // null until the first draw, which only primes the thresholds
  function drawCount() {
    const length = textLength(labelField.input.value.trim());
    countLine.hidden = length < COUNT_FROM;
    countLine.textContent = length + ' of ' + PROJECT_LABEL_MOST + ' characters' + (length > PROJECT_LABEL_MOST ? ': over the limit' : '');
    const before = lastLength;
    lastLength = length;
    if (before === null || length === before) return;
    if (length < before) {
      countLive.textContent = ''; // so the same words, said again on the way up, are heard again
      return;
    }
    if (length > PROJECT_LABEL_MOST) {
      if (before <= PROJECT_LABEL_MOST) countLive.textContent = length + ' of ' + PROJECT_LABEL_MOST + ' characters: over the limit';
      return;
    }
    const crossed = COUNT_ANNOUNCED.filter((at) => before < at && at <= length);
    if (crossed.length > 0) countLive.textContent = crossed[crossed.length - 1] + ' of ' + PROJECT_LABEL_MOST + ' characters';
  }
  labelField.input.addEventListener('input', drawCount);

  // ---- the rows

  function aboutOf(entry, now, format) {
    if (entry.unreadable) return 'This project cannot be read. It can still be exported as it is, or deleted.';
    const parts = [];
    if (entry.schoolName !== '' && entry.label !== '') parts.push(entry.schoolName);
    const summary = entry.summary || {};
    parts.push(count(summary.rooms || 0, 'room') + ', ' + count(summary.groups || 0, 'group'));
    const changed = entry.savedAt || entry.shelvedAt;
    if (changed) parts.push('last changed ' + whenWords(changed, now, format));
    if (entry.bytes > 0) parts.push(formatBytes(entry.bytes));
    return parts.join(' · ');
  }

  function rowButton(label, action, nameId, run) {
    const button = h('button', { type: 'button', class: 'btn', data: { action, names: nameId }, 'aria-describedby': nameId });
    button.textContent = label;
    button.addEventListener('click', (event) => {
      if (disabled(button) || busy) {
        event.preventDefault();
        return;
      }
      run(button);
    });
    return button;
  }

  function row(entry, now, format) {
    const nameId = uid('proj-name');
    const name = entry.open ? openName() : entryName(entry);
    const li = h('li', { class: 'proj__row', data: { projectId: entry.id, open: String(entry.open), unreadable: String(Boolean(entry.unreadable)) } });
    const title = h('div', { class: 'proj__name', id: nameId }, h('span', { class: 'proj__label' }, name), entry.open ? h('span', { class: 'proj__pill' }, 'Open') : null);
    li.append(title, h('div', { class: 'proj__about' }, aboutOf(entry, now, format)));
    const actions = h('div', { class: 'proj__buttons' });
    const locked = readOnly();
    if (entry.open) {
      const reasonId = uid('proj-why');
      const del = rowButton('Delete…', 'delete', nameId, () => {});
      gate(del, reasonId, true);
      actions.append(del);
      li.append(actions, h('p', { class: 'proj__reason', id: reasonId }, OPEN_FIRST));
      return li;
    }
    if (entry.unreadable) {
      actions.append(rowButton('Export it as it is', 'export-raw', nameId, async (button) => {
        try {
          await entry.exportRaw();
        } catch (error) {
          say('refused', 'It was not exported. ' + messageOf(error));
        }
        button.focus();
      }));
    } else {
      actions.append(rowButton('Open', 'open', nameId, (button) => openEntry(entry, button)));
      actions.append(rowButton('Rename…', 'rename', nameId, (button) => renameEntry(entry, button)));
    }
    actions.append(rowButton('Delete…', 'delete', nameId, (button) => deleteEntry(entry, button)));
    // reading only stays available: exporting a record as it is changes nothing
    if (locked) for (const button of actions.querySelectorAll('button:not([data-action="export-raw"])')) gate(button, ids.readOnly, true);
    li.append(actions);
    return li;
  }

  async function read() {
    try {
      return await storage.projects.list();
    } catch (error) {
      return null;
    }
  }

  async function draw() {
    drawn += 1;
    const mine = drawn;
    element.dataset.pending = 'true';
    const found = await read();
    if (mine !== drawn) return; // a later draw has the newer list
    rows = found || [{ id: store.project.id, open: true, label: store.project.label || '', schoolName: store.project.settings.schoolName, savedAt: null, shelvedAt: null, bytes: 0, summary: null }];
    const now = ctx.clock();
    const format = store.project.settings.timeFormat;
    const many = rows.length > 1;
    const locked = readOnly();
    element.dataset.projects = String(rows.length);
    element.dataset.readOnly = String(locked);
    element.dataset.state = found ? 'ready' : 'failed';

    lead.textContent = many
      ? 'This device keeps ' + count(rows.length, 'project') + '. ' + openName() + ' is open.'
      : 'This device keeps one project: ' + openName() + '.';
    list.hidden = !many;
    // a redraw keeps a focus that was inside the list (by row and button), and a
    // button that was working goes on saying so
    const kept = focusInList();
    list.replaceChildren(...(many ? rows.map((entry) => row(entry, now, format)) : []));
    const was = showWorking();
    if (kept) restoreFocus(kept, was);

    readOnlyLine.hidden = !locked;
    const full = rows.length >= PROJECTS_MOST;
    limitLine.hidden = rows.length < LIMIT_SAID_FROM;
    limitLine.textContent = 'Up to ' + PROJECTS_MOST + ' projects can be kept on this device; you have ' + rows.length + '.';
    gate(startButton, locked ? ids.readOnly : ids.limit, locked || full);
    gate(duplicateButton, locked ? ids.readOnly : ids.limit, locked || full);
    labelField.input.toggleAttribute('readonly', locked);

    delete element.dataset.pending;
    placeFocus();
  }

  // Where the focus is inside the list: { id, action } or null.
  function focusInList() {
    const at = document.activeElement;
    if (!at || !list.contains(at)) return null;
    const li = at.closest('[data-project-id]');
    return li ? { id: li.dataset.projectId, action: at.dataset.action || '' } : null;
  }

  function restoreFocus(spot, busyButton) {
    const gone = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
    if (!gone || want) return;
    const li = list.querySelector('[data-project-id="' + CSS.escape(spot.id) + '"]');
    const button = li ? li.querySelector('[data-action="' + spot.action + '"]') || li.querySelector('button') : null;
    if (button) button.focus();
    else if (!list.hidden || element.isConnected) heading.focus();
  }

  // The reader may have moved on: only a focus on nothing (the page, or the main region) is taken.
  const focusIsFree = () => {
    const at = document.activeElement;
    return !at || at === document.body || at.tagName === 'MAIN';
  };

  function placeFocus() {
    if (headingWanted) {
      headingFrames += 1;
      if (!focusIsFree() || headingFrames > HEADING_FRAMES) {
        headingWanted = false; // moved on, or the section never came: no heading focus, no more frames
      } else if (element.isConnected) {
        headingWanted = false;
        heading.focus();
        return;
      } else {
        // the section is not on the page yet; the first frame it is, the heading has the focus
        requestAnimationFrame(placeFocus);
        return;
      }
    }
    if (!want) return;
    if (document.querySelector('dialog[open]')) return; // the focus is kept for when the dialog has closed
    const target = want;
    want = null;
    const rowOf = (id) => list.querySelector('[data-project-id="' + CSS.escape(id) + '"]');
    let found = null;
    if (target.id) {
      const li = rowOf(target.id);
      found = li ? li.querySelector('[data-action="' + target.action + '"]') || li.querySelector('button') : null;
    } else if (target.after !== undefined) {
      const items = Array.from(list.children);
      const li = items[target.after] || items[target.after - 1];
      found = li && !list.hidden ? li.querySelector('button') : null;
    }
    (found || heading).focus();
  }

  // ---- Open

  async function openEntry(entry, button) {
    rememberOpening({ kind: 'open', from: openName() });
    setBusy(true, button, 'Opening…');
    say('status', '');
    const answer = await storage.projects.open(entry.id);
    if (answer.ok && !answer.reloadFailed) return; // the page reloads a moment from now
    if (answer.ok) {
      const live = setBusy(false); // the switch is done; the page's banner says to reload it
      if (live) live.focus();
      return;
    }
    forgetOpening();
    const live = setBusy(false);
    say('refused', answer.text);
    (live || heading).focus();
  }

  // ---- Rename…

  async function renameEntry(entry, opener) {
    const name = entryName(entry);
    const input = field({ id: uid('proj-rename'), label: 'Label', value: entry.label, commit: () => {} });
    const problem = h('p', { class: 'proj__dialog-refusal', role: 'alert', hidden: true });
    const dialog = ctx.openDialog({
      title: 'Rename ' + name,
      body: [
        h('p', null, 'This project is not open, so renaming it is not an undo step. Leave the label empty to show the school’s name.'),
        input.element,
        problem,
      ],
      buttons: [{ label: 'Rename', value: 'rename', kind: 'primary' }, { label: 'Cancel', value: null }],
      opener,
    });
    const [renameButton] = dialog.element.querySelectorAll('.dialog__buttons button');
    let renaming = false;
    const showBusy = holdWhileWorking(dialog, () => renaming);
    async function submit() {
      if (renaming) return;
      renaming = true;
      showBusy(true);
      problem.hidden = true;
      // the focus is wanted before the answer: the list is drawn again as the store answers
      want = { id: entry.id, action: 'rename' };
      const answer = await storage.projects.rename(entry.id, input.input.value);
      renaming = false;
      showBusy(false);
      if (answer.ok) {
        dialog.close('renamed');
        placeFocus();
        return;
      }
      want = null;
      problem.textContent = answer.text;
      problem.hidden = false;
      input.input.focus();
    }
    dialog.element.addEventListener('click', (event) => {
      if (event.target !== renameButton) return;
      event.stopImmediatePropagation();
      submit();
    }, true);
    input.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      submit();
    });
    input.input.focus();
    input.input.select();
    await dialog.closed;
  }

  // ---- Delete…

  async function snapshotCount(projectId) {
    const snapshots = pageSnapshots();
    if (!snapshots) return 0;
    try {
      return (await snapshots.list()).filter((each) => each.projectId === projectId).length;
    } catch (error) {
      return 0;
    }
  }

  async function deleteEntry(entry, opener) {
    const name = entryName(entry);
    const kept = await snapshotCount(entry.id);
    const exporter = entry.unreadable ? () => entry.exportRaw() : typeof storage.projects.exportShelved === 'function' ? () => storage.projects.exportShelved(entry.id) : null;
    const note = h('p', { class: 'proj__dialog-note', role: 'status', hidden: true });
    let exported = false;
    const body = entry.unreadable
      ? [h('p', null, 'Delete ' + name + ' from this device? It cannot be read, so no recovery point can be made of it. Export it as it is first if you may want it later.')]
      : [
        h('p', null, 'Delete ' + name + ' from this device? It is not open, and a recovery point of it is kept first, so you can get it back from Recovery points for a while. The newest ' + OTHERS_KEPT + ' recovery points of each project you are not working on are kept. Export it first if you may want it later.'),
        kept > 0 ? h('p', null, 'Its ' + count(kept, 'snapshot') + ' stay' + (kept === 1 ? 's' : '') + ' on this device.') : null,
      ];
    body.push(note);
    const buttons = [];
    if (exporter) buttons.push({ label: entry.unreadable ? 'Export it as it is' : 'Export it first', value: 'export' });
    buttons.push({ label: 'Delete', value: 'delete', kind: 'danger' }, { label: 'Cancel', value: null });
    const dialog = ctx.openDialog({ title: 'Delete ' + name + ' from this device?', body, buttons, opener });
    const all = dialog.element.querySelectorAll('.dialog__buttons button');
    if (exporter) {
      dialog.element.addEventListener('click', async (event) => {
        if (event.target !== all[0]) return;
        event.stopImmediatePropagation();
        try {
          const done = await exporter();
          exported = !(done && done.ok === false);
          note.textContent = exported ? 'Exported. Delete it now, or cancel and keep it.' : done.text;
        } catch (error) {
          note.textContent = 'It was not exported. ' + messageOf(error);
        }
        note.hidden = false;
      }, true);
    }
    const choice = await dialog.closed;
    if (choice !== 'delete') return;
    const index = Array.from(list.children).findIndex((li) => li.dataset.projectId === entry.id);
    setBusy(true);
    // the focus is wanted before the answer: the list is drawn again as the store answers
    want = { after: index };
    const answer = await storage.projects.remove(entry.id, exported ? { exported: true } : undefined);
    setBusy(false);
    if (!answer.ok) {
      // no recovery point could be kept (needs: 'exported'): the row's Delete… asks again, with Export first
      want = null;
      say('refused', answer.text);
      return;
    }
    say('status', '');
    ctx.toast({
      text: 'Deleted ' + name + ' from this device.' + (answer.pointKept ? '' : ' No recovery point could be kept of it.'),
      action: answer.pointKept ? { label: 'Restore as a project', run: () => restoreDeleted(answer.pointKey) } : undefined,
    });
  }

  // One press only: the toast's button is pressed again while the first is working, nothing happens.
  async function restoreDeleted(pointKey) {
    if (busy) return;
    setBusy(true);
    rememberOpening({ kind: 'start', from: openName() });
    const answer = await storage.projects.restoreAsProject(pointKey);
    if (answer.ok && !answer.reloadFailed) return; // the page reloads a moment from now
    setBusy(false);
    if (answer.ok) return;
    forgetOpening();
    ctx.toast({ kind: 'problem', text: answer.text });
  }

  // ---- Duplicate this project

  async function duplicate(opener) {
    const input = field({ id: uid('proj-copy'), label: 'Label for the copy', value: suffixedLabel(openName().replace(/[⁦-⁩]/g, ''), ' (copy)'), commit: () => {} });
    const problem = h('p', { class: 'proj__dialog-refusal', role: 'alert', hidden: true });
    const dialog = ctx.openDialog({
      title: 'Duplicate this project',
      body: [
        h('p', null, 'The copy has everything in ' + openName() + ': the building with its traced images, the schedule, the settings and the scenarios. It is kept beside it and opened. Each has its own undo history.'),
        input.element,
        problem,
      ],
      buttons: [{ label: 'Duplicate and open it', value: 'duplicate', kind: 'primary' }, { label: 'Cancel', value: null }],
      opener,
    });
    const [go] = dialog.element.querySelectorAll('.dialog__buttons button');
    let duplicating = false;
    const showBusy = holdWhileWorking(dialog, () => duplicating);
    async function submit() {
      if (duplicating) return;
      duplicating = true;
      showBusy(true);
      problem.hidden = true;
      go.textContent = 'Duplicating…';
      go.setAttribute('aria-disabled', 'true');
      rememberOpening({ kind: 'duplicate', from: openName() });
      const answer = await storage.projects.duplicate({ label: input.input.value });
      if (answer.ok) {
        dialog.close('duplicated');
        setBusy(true);
        return;
      }
      forgetOpening();
      duplicating = false;
      showBusy(false);
      go.textContent = 'Duplicate and open it';
      go.removeAttribute('aria-disabled');
      if (!dialog.element.isConnected) {
        ctx.toast({ kind: 'problem', text: answer.text });
        return;
      }
      problem.textContent = answer.text;
      problem.hidden = false;
      input.input.focus();
    }
    dialog.element.addEventListener('click', (event) => {
      if (event.target !== go) return;
      event.stopImmediatePropagation();
      submit();
    }, true);
    input.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      submit();
    });
    input.input.focus();
    input.input.select();
    await dialog.closed;
  }

  // ---- Start another project…

  async function startAnother(opener) {
    const open = openName();
    const name = uid('proj-kind');
    let kind = 'empty';
    let picked = null; // { fileName, read } once a file has been read
    let held = null; // { id, label, heldBy } the refusal of the one-per-id rule
    let working = false;

    const refusal = h('p', { class: 'proj__dialog-refusal', role: 'alert', hidden: true });
    const summary = h('p', { class: 'proj__dialog-note', hidden: true, data: { line: 'file-summary' } });
    const heldBox = h('div', { class: 'proj__held', hidden: true, data: { line: 'held' } });
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: 'start' } });

    const KINDS = [
      ['empty', 'Empty', 'A project with nothing in it yet.'],
      ['sample', 'The sample school', 'A complete invented school to explore.'],
      ['file', 'A project file…', 'Choose a file; it opens as another project.'],
    ];
    const group = h('div', { class: 'proj__choices', role: 'radiogroup', 'aria-label': 'What to start' }, KINDS.map(([value, label, about]) => h('label', { class: 'proj__choice' },
      h('input', { type: 'radio', name, value, checked: value === 'empty', on: { change: () => choose(value) } }),
      h('span', { class: 'proj__choice-text' }, h('span', { class: 'proj__choice-label' }, label), h('span', { class: 'proj__choice-about' }, about)))));

    const dialog = ctx.openDialog({
      title: 'Start another project.',
      body: [h('p', null, open + ' stays on this device.'), group, summary, heldBox, refusal, input],
      buttons: [{ label: 'Start', value: 'start', kind: 'primary' }, { label: 'Cancel', value: null }],
      opener,
    });
    const [startBtn] = dialog.element.querySelectorAll('.dialog__buttons button');
    const showBusy = holdWhileWorking(dialog, () => working);

    function drawStart() {
      startBtn.textContent = kind === 'file' && picked ? 'Open it as another project' : working ? 'Starting…' : 'Start';
      if (held || working) startBtn.setAttribute('aria-disabled', 'true');
      else startBtn.removeAttribute('aria-disabled');
      showBusy(working);
    }

    // A sentence for the dialog; if the dialog is gone it goes to a toast, never into a closed dialog.
    function showRefusal(text) {
      if (!dialog.element.isConnected) {
        if (text !== '') ctx.toast({ kind: 'problem', text });
        return;
      }
      refusal.textContent = text;
      refusal.hidden = text === '';
    }

    function choose(value) {
      kind = value;
      held = null;
      heldBox.hidden = true;
      heldBox.replaceChildren();
      showRefusal('');
      summary.hidden = !(value === 'file' && picked);
      drawStart();
      // the file is still held: choosing it again asks the one-per-id question again
      if (value === 'file' && picked) checkHeld();
    }

    // The one-per-id rule, asked of the picked file before anything is started.
    async function checkHeld() {
      const mine = picked;
      if (mine.read.project.id === store.project.id) {
        showHeld({ id: mine.read.project.id, label: open, heldBy: 'open' }, 'file');
        return;
      }
      const label = await storage.projects.holds(mine.read.project.id);
      if (label !== null && kind === 'file' && picked === mine && !held) showHeld({ id: mine.read.project.id, label, heldBy: 'shelf' }, 'file');
    }

    // The two ways on when the project is already kept (15.9 item 3).
    function showHeld(about, source) {
      held = about;
      const sentence = source === 'file'
        ? 'This file is a copy of ' + about.label + (about.heldBy === 'open' ? ', the project that is open now.' : ', which is also kept on this device.')
        : 'The sample school is already kept on this device' + (about.heldBy === 'open' ? ' as the open project, ' + about.label + '.' : ' as ' + about.label + '.');
      const ways = [];
      if (about.heldBy === 'shelf') ways.push(['open', 'Open ' + about.label]);
      else if (source === 'file') ways.push(['replace', 'Replace the open project']);
      ways.push(['keep', 'Keep it as another project']);
      heldBox.hidden = false;
      heldBox.replaceChildren(
        h('p', { role: 'alert' }, sentence),
        about.heldBy === 'shelf' && source === 'file' ? h('p', { class: 'card__small' }, 'Open ' + about.label + ' forgets this file: after it opens, choose the file again.') : null,
        h('div', { class: 'proj__held-buttons' }, ways.map(([way, label]) => h('button', { type: 'button', class: 'btn', data: { action: 'held-' + way }, on: { click: () => follow(way, source) } }, label))));
      drawStart();
    }

    async function follow(way, source) {
      if (working) return;
      if (way === 'open') {
        rememberOpening({ kind: 'open', from: open });
        working = true;
        drawStart();
        const answer = await storage.projects.open(held.id);
        if (answer.ok) return finish();
        forgetOpening();
        working = false;
        showRefusal(answer.text);
        drawStart();
      } else if (way === 'keep') {
        await run(true);
      } else {
        await replaceOpen();
      }
    }

    function finish() {
      dialog.close('started');
      setBusy(true);
    }

    async function run(copy) {
      if (working) return;
      working = true;
      showRefusal('');
      drawStart();
      rememberOpening({ kind: 'start', from: open });
      const answer = await storage.projects.startAnother(kind, picked ? picked.read : undefined, { copy });
      if (answer.ok) return finish();
      forgetOpening();
      working = false;
      if (answer.code === 'held') {
        showHeld({ id: answer.id, label: answer.label, heldBy: answer.heldBy }, kind);
        return;
      }
      showRefusal(answer.text);
      drawStart();
    }

    // "Replace the open project" is Import's meaning: a recovery point and a
    // snapshot first, one undo step. Refused up front in a read-only tab or while a
    // switch is under way; when no snapshot can be taken, the question says so first.
    function cannotReplace() {
      if (storage.state.readOnly) return 'This tab is read-only while the project is open in another tab, so it cannot replace the open project.';
      if (storage.state.switching) return 'A project is already being opened. Wait for the page to reload.';
      return null;
    }

    async function replaceOpen() {
      const no = cannotReplace();
      if (no) {
        showRefusal(no);
        return;
      }
      working = true;
      drawStart();
      const { read: file, fileName } = picked;
      const before = store.project;
      let snapshotSaid = '';
      try {
        const snapshots = pageSnapshots();
        const room = snapshots ? await snapshots.room() : null;
        const takes = Boolean(snapshots && room && !room.error && !room.full);
        if (!takes) {
          working = false;
          drawStart();
          const go = await ctx.openDialog({
            title: 'Replace the open project without a snapshot?',
            body: [h('p', null, importSafetyLine(room, 'Before importing ' + fileName, 'the project that was here'))],
            buttons: [{ label: 'Replace anyway', value: 'replace', kind: 'danger' }, { label: 'Cancel', value: null }],
            opener: dialog.element.querySelector('[data-action="held-replace"]'),
          }).closed;
          if (go !== 'replace') return;
          const again = cannotReplace();
          if (again) {
            showRefusal(again);
            return;
          }
          working = true;
          drawStart();
          snapshotSaid = ' No snapshot was taken' + (room && room.error ? ' (' + String(room.error).replace(/\.$/, '') + ')' : room && room.full ? ': this device keeps the most snapshots it can' : '') + '; a recovery point of it was.';
        } else {
          const taken = await snapshots.takeAuto('import', 'Before importing ' + fileName);
          snapshotSaid = taken && taken.ok === false ? ' No snapshot was taken (' + String(taken.text).replace(/\.$/, '') + '); a recovery point of it was.' : ' A snapshot and a recovery point of it were kept first.';
        }
        await storage.takeRecoveryPoint('import');
        await storage.keepFileImages(file.project, file.images);
        const late = cannotReplace();
        if (late) throw new Error(late);
        store.apply(replaceProject, { project: file.project, label: 'Import the project file ' + fileName });
      } catch (error) {
        working = false;
        showRefusal(quote(fileName) + ' was not imported, and nothing has changed. ' + messageOf(error));
        drawStart();
        return;
      }
      working = false;
      if (store.project === before) {
        showRefusal(quote(fileName) + ' was not imported, and nothing has changed.');
        drawStart();
        return;
      }
      dialog.close('replaced');
      ctx.toast({ text: 'Imported the project file ' + fileName + '. Undo brings back the project that was here.' + snapshotSaid, action: { label: 'Undo', run: ctx.undo } });
    }

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let text;
      try {
        text = await file.text();
      } catch (error) {
        showRefusal(quote(file.name) + ' could not be read. ' + messageOf(error));
        return;
      } finally {
        input.value = '';
      }
      let parsed;
      try {
        parsed = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
      } catch (error) {
        picked = null;
        summary.hidden = true;
        showRefusal(quote(file.name) + ' was not started, and nothing has changed. ' + messageOf(error));
        drawStart();
        return;
      }
      picked = { fileName: file.name, read: parsed };
      showRefusal('');
      const school = parsed.project.settings.schoolName;
      const notes = parsed.migratedFrom < CURRENT_VERSION ? ' It was saved in an older format and has been brought up to date.' : '';
      summary.textContent = quote(file.name) + (school === '' ? '' : ' is ' + school + '.') + ' It holds ' + holdsWords(parsed.summary) + '.' + notes;
      summary.hidden = false;
      held = null;
      heldBox.hidden = true;
      await checkHeld(); // the one-per-id rule, asked before anything is started
      drawStart();
      // the first held choice takes the focus, never the Start that waits for one
      const first = held ? heldBox.querySelector('button') : null;
      (first || startBtn).focus();
    });

    dialog.element.addEventListener('click', (event) => {
      if (event.target !== startBtn) return;
      event.stopImmediatePropagation();
      if (disabled(startBtn)) return;
      if (kind === 'file' && !picked) input.click();
      else run(false);
    }, true);

    await dialog.closed;
  }

  // ---- the two buttons

  function guarded(button, run) {
    button.addEventListener('click', (event) => {
      if (disabled(button) || busy) {
        event.preventDefault();
        if (disabled(button)) say('refused', readOnly() ? READ_ONLY : limitLine.textContent);
        return;
      }
      run(button);
    });
  }
  guarded(startButton, startAnother);
  guarded(duplicateButton, duplicate);

  // ---- keeping up

  let shown = false;
  const stop = storage.subscribe((state, what) => {
    if (element.isConnected) shown = true;
    else if (shown) {
      stop();
      return;
    }
    if (what === 'ready' || what === 'tabs' || what === 'projects' || what === 'switching' || what === 'switched') draw();
  });

  draw();
  let format = store.project.settings.timeFormat;
  let projectId = store.project.id;
  let label = typeof store.project.label === 'string' ? store.project.label : '';
  let school = store.project.settings.schoolName;
  drawCount();
  return {
    element,
    update(project) {
      const now = typeof project.label === 'string' ? project.label : '';
      // an undo or a redo of the label puts the field back; text being typed in (not the label as it was) is left alone
      if (now !== label) {
        const untouched = labelField.input.value === label;
        labelField.set(now); // the field keeps text being typed; the label as it was is not that
        if (untouched) labelField.input.value = now;
      }
      if (now !== label || project.settings.timeFormat !== format || project.settings.schoolName !== school || project.id !== projectId) {
        label = now;
        format = project.settings.timeFormat;
        school = project.settings.schoolName;
        projectId = project.id;
        draw();
      }
      drawCount();
    },
  };
}
