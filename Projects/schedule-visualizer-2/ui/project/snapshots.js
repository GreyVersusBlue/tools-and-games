// The Snapshots card (spec 13.3, DESIGN 5.7): copies of the project kept by
// name. Take one with a name, see the list newest first with when each was
// taken, what it holds and its size, and restore, rename, export or delete
// any of them. The limit is said on the card, and at the limit taking one is
// refused in a sentence that says what to do (storage/snapshots.js).
//
// Restore asks nothing: it is one undo step, and a recovery point of the
// present is taken first. Delete asks, because it cannot be undone.
//
// Every name is shown exactly as typed, as text, in its own direction.

import { h, uid } from '../components/dom.js';
import { card } from '../components/card.js';
import { count } from '../components/words.js';
import { formatBytes, whenWords } from '../../storage/words.js';
import { summaryWords } from '../../storage/session.js';
import { pageSnapshots, SNAPSHOT_LIMIT, NAME_NEEDED, READ_ONLY_SENTENCE } from '../../storage/snapshots.js';

function quote(text) {
  return '“' + text + '”';
}

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

// The status line under the take form.
export function countSentence(entries, limit) {
  if (entries.length === 0) return 'There are no snapshots yet. Take one before a large change; the tool also takes one by itself before it clears the building, the schedule or the whole project, and before an import replaces it. This device keeps up to ' + limit + '.';
  const total = entries.reduce((sum, entry) => sum + (Number.isFinite(entry.bytes) ? entry.bytes : 0), 0);
  const most = entries.length >= limit ? ' That is the most this device keeps: delete one to take another.' : ' This device keeps up to ' + limit + '.';
  return 'There ' + (entries.length === 1 ? 'is ' : 'are ') + count(entries.length, 'snapshot') + ', ' + formatBytes(total) + ' in all.' + most;
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
  const status = h('p', { data: { line: 'snapshots' } });
  const result = h('div', { data: { line: 'result' }, hidden: true });
  const listEl = h('ul', { class: 'snap__list', 'aria-label': 'Snapshots, newest first', hidden: true });
  const element = card({ id: 'snapshots', title: 'Snapshots' }, lead, form, result, status, listEl);

  // What the card is doing, kept across a redraw.
  let renaming = null; // the id of the snapshot whose name is being edited
  let focusAfter = null; // { id, action } or 'take': where the focus goes after the next draw
  let drawn = 0;
  let entries = [];

  function say(kind, text) {
    result.hidden = false;
    result.dataset.result = kind;
    result.replaceChildren(h('p', { role: kind === 'refused' ? 'alert' : 'status' }, text));
  }

  const readOnly = () => Boolean(ctx.storage && ctx.storage.state.readOnly);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!snapshots) return;
    const name = input.value;
    try {
      const taken = await snapshots.take(name);
      input.value = '';
      say('done', 'Took the snapshot ' + quote(taken.name) + '.');
      focusAfter = 'take';
    } catch (error) {
      say('refused', error && error.code === 'no-name' ? NAME_NEEDED : messageOf(error));
      input.focus();
    }
  });

  async function restore(entry) {
    try {
      const done = await snapshots.restore(entry.id);
      const notes = done.notes.length > 0 ? ' ' + count(done.notes.length, 'thing') + ' in it ' + (done.notes.length === 1 ? 'was' : 'were') + ' put right on the way in.' : '';
      say('done', 'Restored the snapshot ' + quote(done.name) + '. What was here before is a recovery point now, and Undo puts it back.' + notes);
      ctx.toast({ text: 'Restored the snapshot ' + done.name + '.', action: { label: 'Undo', run: ctx.undo } });
    } catch (error) {
      say('refused', 'The snapshot ' + quote(entry.name) + ' was not restored. ' + messageOf(error));
    }
  }

  async function save(entry) {
    try {
      const file = await snapshots.exportFile(entry.id);
      download(file.fileName, file.text);
      say('done', 'Saved the snapshot ' + quote(file.name) + ' as ' + quote(file.fileName) + ' to your downloads. It is a project file: import it under Project file.');
    } catch (error) {
      say('refused', 'The snapshot ' + quote(entry.name) + ' was not exported. ' + messageOf(error));
    }
  }

  async function remove(entry, opener) {
    const ok = await ctx.confirm({
      title: 'Delete the snapshot ' + quote(entry.name) + '?',
      body: 'It cannot be brought back. The project you are working on does not change. Export it first to keep it as a file.',
      action: 'Delete this snapshot',
      keep: 'Keep it',
      danger: true,
      opener,
    });
    if (!ok) return;
    const at = entries.findIndex((each) => each.id === entry.id);
    try {
      await snapshots.remove(entry.id);
      say('done', 'Deleted the snapshot ' + quote(entry.name) + '.');
      // the focus goes to the row now in its place, else the one before, else the name field
      const next = entries[at + 1] || entries[at - 1];
      focusAfter = next ? { id: next.id, action: 'delete' } : 'take';
    } catch (error) {
      say('refused', 'The snapshot ' + quote(entry.name) + ' was not deleted. ' + messageOf(error));
    }
  }

  // A button that does nothing but say why while it is marked off: `off` is
  // that sentence, or null. (aria-disabled keeps it in the tab order, so it
  // has to stop the click itself.)
  function button(label, action, aria, run, off) {
    const el = h('button', { type: 'button', class: 'btn', 'aria-label': aria, data: { action } }, label);
    if (off) el.setAttribute('aria-disabled', 'true');
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
          say('done', 'Renamed the snapshot ' + quote(entry.name) + ' to ' + quote(value) + '.');
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

  function row(entry, now, format) {
    const when = whenWords(entry.takenAt, now, format);
    const off = readOnly();
    const about = [
      'Taken ' + when,
      entry.readable ? summaryWords(entry.summary) : 'This one cannot be read',
      entry.bytes === null ? null : formatBytes(entry.bytes),
    ].filter(Boolean).join(' · ');
    const elsewhere = entry.readable && entry.projectId !== null && entry.projectId !== ctx.store.project.id
      ? h('p', { class: 'snap__other' }, 'Of another project: ', named(entry.school === '' ? 'a school with no name' : entry.school))
      : null;
    const head = renaming === entry.id ? renameField(entry) : h('p', { class: 'snap__name' }, named(entry.name));
    const label = 'the snapshot ' + entry.name;
    const unreadable = entry.readable ? null : 'The snapshot ' + quote(entry.name) + ' cannot be read, so it can only be deleted.';
    const buttons = h('div', { class: 'card__buttons snap__buttons' },
      button('Restore', 'restore', 'Restore ' + label, () => restore(entry), off ? READ_ONLY_SENTENCE : unreadable),
      button('Rename', 'rename', 'Rename ' + label, () => startRename(entry), off ? READ_ONLY_SENTENCE : null),
      button('Export', 'export', 'Export ' + label, () => save(entry), unreadable),
      button('Delete', 'delete', 'Delete ' + label, (el) => remove(entry, el), off ? READ_ONLY_SENTENCE : null));
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
    const item = listEl.querySelector('[data-snapshot="' + wanted.id + '"]');
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

  async function draw() {
    drawn += 1;
    const mine = drawn;
    let found = [];
    let failed = null;
    if (snapshots) {
      try {
        found = await snapshots.list();
      } catch (error) {
        failed = messageOf(error);
      }
    } else {
      failed = 'Snapshots are not open on this page.';
    }
    if (mine !== drawn) return; // a later draw has the newer list
    entries = found;
    const now = ctx.clock();
    const format = ctx.store.project.settings.timeFormat;
    element.dataset.snapshots = String(found.length);
    element.dataset.state = failed ? 'failed' : 'ready';
    const full = found.length >= SNAPSHOT_LIMIT;
    element.dataset.full = String(full);
    status.textContent = failed ? 'Snapshots cannot be kept here: ' + failed : countSentence(found, SNAPSHOT_LIMIT) + (readOnly() ? ' ' + READ_ONLY_SENTENCE : '');
    if (readOnly() || failed) takeButton.setAttribute('aria-disabled', 'true');
    else takeButton.removeAttribute('aria-disabled');
    listEl.hidden = found.length === 0;
    if (renaming !== null && !found.some((entry) => entry.id === renaming)) renaming = null;
    listEl.replaceChildren(...found.map((entry) => row(entry, now, format)));
    placeFocus();
  }

  takeButton.addEventListener('click', (event) => {
    if (takeButton.getAttribute('aria-disabled') !== 'true') return;
    event.preventDefault();
    say('refused', readOnly() ? READ_ONLY_SENTENCE : status.textContent);
  });

  let shown = false;
  const stops = [];
  const watch = (what) => {
    if (element.isConnected) shown = true;
    else if (shown) {
      for (const stop of stops) stop();
      return;
    }
    if (what === 'ready' || what === 'tabs' || what === 'taken' || what === 'renamed' || what === 'deleted' || what === 'restored') draw();
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
