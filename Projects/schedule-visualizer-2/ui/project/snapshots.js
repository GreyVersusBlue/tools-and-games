// The Snapshots card (spec 13.3, DESIGN 5.7): copies of the project kept by
// name. Take one with a name, see the list newest first with when each was
// taken, what it holds and its size, and restore, rename, export or delete
// any of them. The limit is said on the card, and at the limit taking one is
// refused in a sentence that says what to do (storage/snapshots.js).
//
// Restore asks nothing: it is one undo step, and a recovery point of the
// present is taken first. Delete asks, because it cannot be undone.
//
// Every name is shown exactly as typed, as text, in its own direction: a
// <bdi> inside a sentence, so a name with a right-to-left override in it
// cannot turn the words after it round.

import { h, uid } from '../components/dom.js';
import { card } from '../components/card.js';
import { count } from '../components/words.js';
import { formatBytes, whenWords } from '../../storage/words.js';
import { summaryWords } from '../../storage/session.js';
import { pageSnapshots, SNAPSHOT_LIMIT, NAME_NEEDED, READ_ONLY_SENTENCE, fullSentence } from '../../storage/snapshots.js';
import { readProjectFile } from '../../engine/project-file.js';
import { refuseHeld } from './files.js';

function messageOf(error) {
  const text = String(error && error.message ? error.message : error).trim();
  return /[.!?]$/.test(text) ? text : text + '.';
}

// Hand a file to the browser to save.
function download(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A typed name, as text, in its own direction.
const named = (name) => h('bdi', { class: 'snap__name-text' }, name);

// The same, in quotation marks, for inside a sentence.
const quoted = (name) => ['“', named(name), '”'];

// The status line under the take form. `entries` are the open project's;
// `others` is how many more are of other projects and `unreadable` how many cannot
// be read: both count towards the device's limit (DESIGN 15.4).
export function countSentence(entries, limit, others, unreadable) {
  const apart = (others || 0) + (unreadable || 0);
  const more = others > 0 ? ' ' + (others === 1 ? '1 more is' : others + ' more are') + ' of other projects; the limit of ' + limit + ' is for the whole device.' : '';
  const broken = unreadable > 0 ? ' ' + (unreadable === 1 ? '1 cannot be read' : unreadable + ' cannot be read') + ' and is listed under Cannot be read.' : '';
  if (entries.length === 0 && apart >= limit) return 'There are no snapshots of this project, and this device is full: it keeps ' + apart + ' snapshots, the most it keeps, none of them of this project, so taking one will be refused. Delete one you no longer need first (export it first to keep it as a file).' + broken;
  if (entries.length === 0) return 'There are no snapshots yet. Take one before a large change; the tool also takes one by itself before it clears the building, the schedule or the whole project, and before an import replaces it. This device keeps up to ' + limit + '.' + more + broken;
  const total = entries.reduce((sum, entry) => sum + (Number.isFinite(entry.bytes) ? entry.bytes : 0), 0);
  const most = entries.length + apart >= limit ? ' That is the most this device keeps: delete one to take another.' : ' This device keeps up to ' + limit + '.';
  return 'There ' + (entries.length === 1 ? 'is ' : 'are ') + count(entries.length, 'snapshot') + ', ' + formatBytes(total) + ' in all.' + most + more + broken;
}

export function snapshotsCard(ctx) {
  const snapshots = pageSnapshots();
  const nameId = uid('snap-name');
  const input = h('input', { class: 'field__input snap__take-input', id: nameId, type: 'text', autocomplete: 'off', spellcheck: 'false', data: { field: 'snapshot-name' }, placeholder: 'Before moving 7th grade' });
  const takeButton = h('button', { type: 'submit', class: 'btn btn--primary', data: { action: 'take-snapshot' } }, 'Take a snapshot');
  const form = h('form', { class: 'snap__take', data: { form: 'take-snapshot' } },
    h('label', { class: 'field__label', for: nameId }, 'Name'),
    h('div', { class: 'snap__take-row' }, input, takeButton));
  const lead = h('p', { class: 'card__lead' }, 'A snapshot is a copy of the project that stays on this device, under the name you give it, until you delete it. Restoring one takes a recovery point of the project first, and Undo puts the project back. Traced images are kept once, however many snapshots name them.');
  const statusId = uid('snap-status');
  const status = h('p', { id: statusId, data: { line: 'snapshots' } });
  const result = h('div', { data: { line: 'result' }, hidden: true });
  const listEl = h('ul', { class: 'snap__list', 'aria-label': 'Snapshots, newest first', hidden: true });
  // Snapshots of projects that are no longer on this device (21.4): Export, Restore as a project, Delete
  const goneList = h('ul', { class: 'snap__list', 'aria-label': 'Snapshots of projects no longer on this device, newest first' });
  const goneTitle = h('summary', { data: { line: 'gone-title' } });
  const gone = h('details', { class: 'snap__gone', data: { disclosure: 'gone-snapshots' }, hidden: true }, goneTitle, goneList);
  // Snapshots that cannot be read, or whose project cannot be told: Export (as stored) and Delete only
  const brokenList = h('ul', { class: 'snap__list', 'aria-label': 'Snapshots that cannot be read, newest first' });
  const brokenTitle = h('summary', { data: { line: 'broken-title' } });
  const broken = h('details', { class: 'snap__gone', data: { disclosure: 'unreadable-snapshots' }, hidden: true }, brokenTitle, brokenList);
  const element = card({ id: 'snapshots', title: 'Snapshots' }, lead, form, result, status, listEl, gone, broken);

  // What the card is doing, kept across a redraw.
  let renaming = null; // the id of the snapshot whose name is being edited
  let focusAfter = null; // { id, action } or 'take': where the focus goes after the next draw
  let drawn = 0;
  let entries = [];
  let others = []; // the readable ones of other projects, kept apart from the open project's
  let unreadable = []; // the ones that cannot be read
  // snapshots a press has found to be of another project than the card thought: id -> { kind: 'held' | 'other', held }
  // They stay listed with the button that fits, until the card is drawn for another project.
  const pinned = new Map();
  let takeReason = ''; // why Take is marked off, or ''

  // `parts`: text and nodes (a name is a <bdi>, never spliced into the text)
  function say(kind, ...parts) {
    result.hidden = false;
    result.dataset.result = kind;
    result.replaceChildren(h('p', { role: kind === 'refused' ? 'alert' : 'status' }, parts));
  }

  const readOnly = () => Boolean(ctx.storage && ctx.storage.state.readOnly);

  // One take, restore or delete at a time: a second Enter or press while one
  // is under way does nothing, so a double press never takes two snapshots.
  let busy = false;
  async function once(run) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!snapshots) return;
    once(async () => {
      const name = input.value;
      try {
        const taken = await snapshots.take(name);
        input.value = '';
        say('done', 'Took the snapshot ', quoted(taken.name), '.');
        focusAfter = 'take';
      } catch (error) {
        say('refused', error && error.code === 'no-name' ? NAME_NEEDED : messageOf(error));
        input.focus();
      }
    });
  });

  // A press found the snapshot to be of another project: the card is drawn again with that
  // row offering the button that fits (Open <label>, or Restore as a project), the focus on it.
  function pin(entry, kind, held) {
    pinned.set(entry.id, { kind, held: held || null });
    focusAfter = { id: entry.id, action: kind === 'held' ? 'open-project' : 'restore-as-project' };
    return draw();
  }

  // the row's button after a redraw (the one pressed is gone with the old row)
  const openerOf = (entry) => element.querySelector('[data-snapshot="' + CSS.escape(entry.id) + '"] [data-action="open-project"]');

  async function restore(entry, opener) {
    try {
      const done = await snapshots.restore(entry.id);
      const notes = done.notes.length > 0 ? ' ' + count(done.notes.length, 'thing') + ' in it ' + (done.notes.length === 1 ? 'was' : 'were') + ' put right on the way in.' : '';
      const before = done.recoveryPoint
        ? ' What was here before is a recovery point now, and Undo puts it back.'
        : ' No recovery point could be kept of what was here before, because this device is not keeping recovery points just now; Undo still puts it back while this tab stays open.';
      say('done', 'Restored the snapshot ', quoted(done.name), '.' + before + notes);
      ctx.toast({ text: ['Restored the snapshot ', named(done.name), '.'], action: { label: 'Undo', run: ctx.undo } });
    } catch (error) {
      if (error && error.code === 'held' && error.held) {
        say('refused', 'The snapshot ', quoted(entry.name), ' was not restored. ' + messageOf(error));
        await pin(entry, 'held', error.held);
        const outcome = await refuseHeld(ctx, { what: 'snapshot', held: error.held, opener: openerOf(entry) || opener, keep: () => keepAsProject(entry) });
        if (outcome.text !== '') say('refused', 'The snapshot ', quoted(entry.name), ' was not restored, and nothing has changed. ' + outcome.text);
        focusAfter = { id: entry.id, action: 'open-project' };
        await draw();
        return;
      }
      say('refused', 'The snapshot ', quoted(entry.name), ' was not restored. ' + messageOf(error));
      if (error && error.code === 'other-project') await pin(entry, 'other');
    }
  }

  // Open the kept project this snapshot is a copy of (the page reloads into it).
  async function openHeld(entry, held) {
    let answer;
    try {
      answer = await ctx.storage.projects.open(held.id);
    } catch (error) {
      say('refused', 'The snapshot ', quoted(entry.name), ' was not restored, and nothing has changed. ' + messageOf(error));
      return;
    }
    if (answer && answer.ok === false) say('refused', 'The snapshot ', quoted(entry.name), ' was not restored, and nothing has changed. ' + answer.text);
  }

  // "Keep it as another project": the snapshot as a project file, read the way a
  // file is, and started as another project with an identity of its own.
  async function keepAsProject(entry) {
    const file = await snapshots.exportFile(entry.id);
    const read = readProjectFile(file.text, { ids: ctx.ids, clock: ctx.clock });
    return ctx.storage.projects.startAnother('file', read, { copy: true });
  }

  // A snapshot of a project that is not on this device: kept on the shelf as it
  // was, and opened. Where the project turns out to be kept after all, the two ways on.
  async function restoreAsProject(entry, opener) {
    let answer;
    try {
      answer = await ctx.storage.projects.restoreAsProject(entry.id);
    } catch (error) {
      say('refused', 'The snapshot ', quoted(entry.name), ' was not restored as a project, and nothing has changed. ' + messageOf(error));
      return;
    }
    if (answer.ok) {
      say('done', 'Kept the snapshot ', quoted(entry.name), ' on this device as another project, and opened it.' + (answer.imageGone ? ' A traced image it names is gone, so it is kept without it.' : ''));
      return;
    }
    if (answer.code === 'held') {
      say('refused', 'The snapshot ', quoted(entry.name), ' was not restored. ' + answer.text);
      const held = { id: answer.id, label: answer.label };
      await pin(entry, 'held', held);
      const outcome = await refuseHeld(ctx, { what: 'snapshot', held, opener: openerOf(entry) || opener, keep: () => keepAsProject(entry) });
      if (outcome.text !== '') say('refused', 'The snapshot ', quoted(entry.name), ' was not restored, and nothing has changed. ' + outcome.text);
      focusAfter = { id: entry.id, action: 'open-project' };
      await draw();
      return;
    }
    say('refused', 'The snapshot ', quoted(entry.name), ' was not restored as a project, and nothing has changed. ' + answer.text);
  }

  async function save(entry, asStored) {
    try {
      const file = await (asStored ? snapshots.exportRaw(entry.id) : snapshots.exportFile(entry.id));
      download(file.fileName, file.text);
      say('done', 'Saved the snapshot ', quoted(file.name === '' ? entry.name : file.name), ' as ', quoted(file.fileName), ' to your downloads.' + (asStored ? ' It is the record as it is stored, not a project file: it cannot be imported.' : ' It is a project file: import it under Project file.'));
    } catch (error) {
      say('refused', 'The snapshot ', quoted(entry.name), ' was not exported. ' + messageOf(error));
    }
  }

  async function remove(entry, opener) {
    const ok = await ctx.confirm({
      title: ['Delete the snapshot ', quoted(entry.name), '?'],
      body: 'It cannot be brought back. The project you are working on does not change. Export it first to keep it as a file.',
      action: 'Delete this snapshot',
      keep: 'Keep it',
      danger: true,
      opener,
    });
    if (!ok) return;
    // the row's own list: the open project's, or those of projects no longer here
    const among = [entries, others, unreadable].find((list) => list.some((each) => each.id === entry.id)) || entries;
    const at = among.findIndex((each) => each.id === entry.id);
    try {
      await snapshots.remove(entry.id);
      say('done', 'Deleted the snapshot ', quoted(entry.name), '.');
      // the focus goes to the row now in its place, else the one before, else the name field
      const next = among[at + 1] || among[at - 1];
      focusAfter = next ? { id: next.id, action: 'delete' } : 'take';
    } catch (error) {
      say('refused', 'The snapshot ', quoted(entry.name), ' was not deleted. ' + messageOf(error));
    }
  }

  // A button that does nothing but say why while it is marked off: `off` is
  // that sentence (text, or a list of text and nodes), or null. aria-disabled
  // keeps it in the tab order, so it has to stop the click itself; and it is
  // described by the reason (`reasonId`, a visually hidden line in its row).
  // Its name begins with the words it shows (WCAG 2.5.3) and ends with whose it is.
  const nameOf = (visible, whose) => visible + (/ /.test(visible) ? ', ' : ' ') + whose;
  function button(label, action, whose, run, off, reasonId) {
    const el = h('button', { type: 'button', class: 'btn', 'aria-label': nameOf(label, whose), data: { action } }, label);
    if (off) {
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('aria-describedby', reasonId);
    }
    el.addEventListener('click', () => {
      if (off) say('refused', off);
      else run(el);
    });
    return el;
  }

  // The name being edited: it is kept when the field is left or Enter is
  // pressed, Escape puts the old name back, and a refusal stays under the
  // field with what was typed, so it can be fixed.
  function renameField(entry) {
    const id = uid('snap-rename');
    const refusal = h('p', { class: 'field__refusal', id: id + '-refusal', hidden: true });
    const edit = h('input', { class: 'field__input', id, type: 'text', autocomplete: 'off', spellcheck: 'false', data: { field: 'snapshot-rename' } });
    edit.value = entry.name;
    let busy = false;
    async function keep(focusRow) {
      if (busy || renaming !== entry.id) return;
      busy = true;
      const value = edit.value;
      try {
        if (value !== entry.name) {
          await snapshots.rename(entry.id, value);
          say('done', 'Renamed the snapshot ', quoted(entry.name), ' to ', quoted(value), '.');
        }
        renaming = null;
        focusAfter = focusRow ? { id: entry.id, action: 'rename' } : null;
        draw();
      } catch (error) {
        refusal.textContent = messageOf(error);
        refusal.hidden = false;
        edit.setAttribute('aria-invalid', 'true');
        edit.setAttribute('aria-describedby', refusal.id);
      } finally {
        busy = false;
      }
    }
    edit.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        keep(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        renaming = null;
        focusAfter = { id: entry.id, action: 'rename' };
        draw();
      }
    });
    edit.addEventListener('blur', () => keep(false));
    return h('div', { class: 'field snap__rename' },
      h('label', { class: 'field__label', for: id }, 'New name for the snapshot ', named(entry.name)),
      edit,
      refusal);
  }

  function startRename(entry) {
    renaming = entry.id;
    focusAfter = { id: entry.id, action: 'name' };
    draw();
  }

  // `kind`: 'mine' (the open project's), 'gone' (a project no longer on this device), 'other'
  // (a press found it is of another project that is not kept: Restore as a project), 'held'
  // (a press found it is a copy of a kept project: Open <label>) or 'broken' (cannot be read).
  function row(entry, now, format, kind, held) {
    const when = whenWords(entry.takenAt, now, format);
    const off = readOnly();
    const about = [
      'Taken ' + when,
      entry.readable ? summaryWords(entry.summary) : 'This one cannot be read',
      entry.bytes === null ? null : formatBytes(entry.bytes),
    ].filter(Boolean).join(' · ');
    // a snapshot of another project says whose it is (a typed name, as text)
    const elsewhere = kind === 'gone' || kind === 'other' || kind === 'held'
      ? h('p', { class: 'snap__other', data: { line: 'of-project' } }, 'Of ', named(entry.label === '' ? 'a project with no name' : entry.label))
      : null;
    const head = renaming === entry.id ? renameField(entry) : h('p', { class: 'snap__name' }, named(entry.name));
    const whose = 'the snapshot ' + entry.name;
    const reasonId = uid('snap-reason');
    const reason = h('span', { class: 'vh', id: reasonId }, off ? READ_ONLY_SENTENCE : '');
    const off2 = off ? READ_ONLY_SENTENCE : null;
    let list;
    if (kind === 'broken') {
      list = [
        button('Export', 'export', whose, () => save(entry, true), null, reasonId),
        button('Delete', 'delete', whose, (el) => once(() => remove(entry, el)), off2, reasonId),
      ];
    } else if (kind === 'gone' || kind === 'other') {
      list = [
        button('Export', 'export', whose, () => save(entry), null, reasonId),
        button('Restore as a project', 'restore-as-project', whose, (el) => once(() => restoreAsProject(entry, el)), off2, reasonId),
        button('Delete', 'delete', whose, (el) => once(() => remove(entry, el)), off2, reasonId),
      ];
    } else if (kind === 'held') {
      list = [
        button('Open ' + held.label, 'open-project', whose, () => once(() => openHeld(entry, held)), off2, reasonId),
        button('Export', 'export', whose, () => save(entry), null, reasonId),
        button('Delete', 'delete', whose, (el) => once(() => remove(entry, el)), off2, reasonId),
      ];
    } else {
      list = [
        button('Restore', 'restore', whose, (el) => once(() => restore(entry, el)), off2, reasonId),
        button('Rename', 'rename', whose, () => startRename(entry), off2, reasonId),
        button('Export', 'export', whose, () => save(entry), null, reasonId),
        button('Delete', 'delete', whose, (el) => once(() => remove(entry, el)), off2, reasonId),
      ];
    }
    const buttons = h('div', { class: 'card__buttons snap__buttons' }, ...list, off ? reason : null);
    return h('li', { class: 'snap__item', data: { snapshot: entry.id } }, head, h('p', { class: 'snap__about' }, about), elsewhere, buttons);
  }

  function placeFocus() {
    const wanted = focusAfter;
    focusAfter = null;
    if (!wanted) return;
    if (wanted === 'take') {
      input.focus();
      return;
    }
    const item = element.querySelector('[data-snapshot="' + CSS.escape(wanted.id) + '"]');
    if (!item) {
      input.focus();
      return;
    }
    const target = wanted.action === 'name' ? item.querySelector('input') : item.querySelector('[data-action="' + wanted.action + '"]');
    if (target) {
      target.focus();
      if (wanted.action === 'name') target.select();
    }
  }

  // While a list is being read and drawn the card carries data-pending, so a
  // test (or anything else) can wait for the rows it is about to press.
  async function draw() {
    drawn += 1;
    const mine = drawn;
    element.dataset.pending = 'true';
    let found = [];
    let failed = null;
    let kept = null; // the ids of the projects on this device, or null when this page cannot say
    if (snapshots) {
      try {
        found = await snapshots.list();
        if (ctx.storage && ctx.storage.projects) kept = new Set((await ctx.storage.projects.list()).map((each) => each.id));
      } catch (error) {
        failed = messageOf(error);
      }
    } else {
      failed = 'Snapshots are not open on this page.';
    }
    if (mine !== drawn) return; // a later draw has the newer list
    // the open project's are the list (a snapshot with no project id is from before projects had
    // ids, so it is the open project's); a press may have found one to be of another project, and
    // that one stays listed with the button that fits. One that cannot be read is listed apart
    // (Cannot be read), and the rest are counted, those of projects no longer here listed apart.
    const openId = ctx.store.project.id;
    for (const [id, as] of Array.from(pinned)) {
      const there = found.find((entry) => entry.id === id && entry.readable);
      // a press's finding is dropped when the snapshot is gone, or the shelf no longer says it
      if (!there || (kept !== null && (as.kind === 'held' ? !kept.has(as.held.id) : kept.has(there.projectId)))) pinned.delete(id);
    }
    unreadable = found.filter((entry) => !entry.readable);
    const readable = found.filter((entry) => entry.readable);
    const isMine = (entry) => pinned.has(entry.id) || kept === null || entry.projectId === null || entry.projectId === openId;
    entries = readable.filter(isMine);
    const elsewhere = readable.filter((entry) => !isMine(entry));
    others = elsewhere.filter((entry) => !kept.has(entry.projectId));
    const now = ctx.clock();
    const format = ctx.store.project.settings.timeFormat;
    element.dataset.snapshots = String(entries.length);
    element.dataset.total = String(found.length);
    element.dataset.others = String(elsewhere.length);
    element.dataset.gone = String(others.length);
    element.dataset.unreadable = String(unreadable.length);
    element.dataset.state = failed ? 'failed' : 'ready';
    const full = found.length >= SNAPSHOT_LIMIT;
    element.dataset.full = String(full);
    status.textContent = failed ? 'Snapshots cannot be kept here: ' + failed : countSentence(entries, SNAPSHOT_LIMIT, elsewhere.length, unreadable.length) + (readOnly() ? ' ' + READ_ONLY_SENTENCE : '');
    // marked off (and still focusable) when this tab is read-only, snapshots cannot be kept here, or the device is full
    takeReason = readOnly() ? READ_ONLY_SENTENCE : failed ? status.textContent : full ? fullSentence(SNAPSHOT_LIMIT, found.length) : '';
    if (takeReason !== '') {
      takeButton.setAttribute('aria-disabled', 'true');
      takeButton.setAttribute('aria-describedby', statusId);
    } else {
      takeButton.removeAttribute('aria-disabled');
      takeButton.removeAttribute('aria-describedby');
    }
    listEl.hidden = entries.length === 0;
    if (renaming !== null && !entries.some((entry) => entry.id === renaming)) renaming = null;
    listEl.replaceChildren(...entries.map((entry) => {
      const as = pinned.get(entry.id);
      return row(entry, now, format, as ? as.kind : 'mine', as ? as.held : null);
    }));
    gone.hidden = others.length === 0;
    goneTitle.textContent = 'Of projects no longer on this device (' + others.length + ')';
    goneList.replaceChildren(...others.map((entry) => row(entry, now, format, 'gone')));
    broken.hidden = unreadable.length === 0;
    brokenTitle.textContent = 'Cannot be read (' + unreadable.length + ')';
    brokenList.replaceChildren(...unreadable.map((entry) => row(entry, now, format, 'broken')));
    delete element.dataset.pending;
    placeFocus();
  }

  takeButton.addEventListener('click', (event) => {
    if (takeButton.getAttribute('aria-disabled') !== 'true') return;
    event.preventDefault();
    say('refused', takeReason);
  });

  let shown = false;
  const stops = [];
  const watch = (what) => {
    if (element.isConnected) shown = true;
    else if (shown) {
      for (const stop of stops) stop();
      return;
    }
    if (what === 'ready' || what === 'tabs' || what === 'projects' || what === 'taken' || what === 'renamed' || what === 'deleted' || what === 'restored') draw();
  };
  if (snapshots) stops.push(snapshots.subscribe(watch));
  if (ctx.storage) stops.push(ctx.storage.subscribe((state, what) => watch(what)));

  draw();
  let format = ctx.store.project.settings.timeFormat;
  let projectId = ctx.store.project.id;
  return {
    element,
    update(project) {
      // the list depends on the time format and, for "of another project", on which project is open
      if (project.settings.timeFormat === format && project.id === projectId) return;
      format = project.settings.timeFormat;
      projectId = project.id;
      draw();
    },
  };
}
