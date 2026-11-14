// The Recovery points card: the copies the tool takes by itself, newest
// first, each with when and why it was taken, what it holds and its size.
// Any of them can be restored (the present is captured first, so a restore
// can be put back), exported as a project file, or deleted.
//
// With several projects on the device (21.10, DESIGN 15.4) the list is the open
// project's. Under it a disclosure, "Of other projects (n)", lists the rest with
// the project's label first: a project kept on this device gets Open <label> in
// place of Restore, one that is no longer on it gets Restore as a project. A plain
// Restore is only ever offered for the open project's own points. A point that cannot
// be read, or whose project cannot be told, is listed apart under "Cannot be read"
// (Export as it is, Delete) and is in no count.

import { h, uid } from '../components/dom.js';
import { card } from '../components/card.js';
import { count } from '../components/words.js';
import { formatBytes, whenWords } from '../../storage/words.js';
import { summaryWords } from '../../storage/session.js';
import { refuseHeld } from './files.js';

export const REASON_WORDS = {
  timer: 'While you worked',
  leave: 'When the page was left',
  replace: 'Before the project was replaced',
  import: 'Before an import',
  restore: 'Before a restore',
};

export const READ_ONLY_REASON = 'This tab is read-only while the project is open in another tab, so it cannot restore, open or delete a recovery point. It can export one.';

// On a phone a row is two lines, not five columns: the table gives way to stacked cells.
const PHONE_CSS = '@media (max-width: 640px) {'
  + ' .rec__table, .rec__table tbody, .rec__table tr, .rec__table td, .rec__table th { display: block; width: auto; max-width: 100%; box-sizing: border-box; }'
  + ' .rec__table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }'
  + ' .rec__table tr { padding: var(--s-2) 0; border-top: var(--border); overflow-wrap: anywhere; }'
  + ' .rec__table td, .rec__table th { padding: 0 0 var(--s-1); border: 0; text-align: left; text-transform: none; letter-spacing: normal; white-space: normal; }'
  + ' .rec__table .card__buttons { flex-wrap: wrap; } }';

// A point as it is stored, readable or not, as a file: its images as base64.
async function storedPoint(key) {
  const record = await new Promise((resolve, reject) => {
    const open = indexedDB.open('sv2-recovery');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const got = db.transaction('recovery', 'readonly').objectStore('recovery').get(key);
        got.onsuccess = () => {
          db.close();
          resolve(got.result);
        };
        got.onerror = () => {
          db.close();
          reject(got.error);
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
  if (record === undefined) throw new Error('That recovery point is no longer on this device.');
  const copy = { ...record };
  if (record && record.images && typeof record.images === 'object') {
    copy.images = {};
    for (const [id, blob] of Object.entries(record.images)) {
      if (blob instanceof Blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        copy.images[id] = { type: blob.type, data: btoa(text) };
      } else {
        copy.images[id] = blob;
      }
    }
  }
  return JSON.stringify(copy, null, 2);
}

export function recoveryCard(ctx) {
  const storage = ctx.storage;
  const lead = h('p', { class: 'card__lead' },
    'A recovery point is a complete copy of the project that the tool takes by itself: every 3 minutes while you work, when you leave the page, and before anything replaces the whole project. The newest '
    + storage.recoveryKeep + ' of this project are kept, and the newest 3 of each other project on this device (at most 24 of other projects in all), apart from the saved project, so that losing one does not lose the other.');
  const status = h('p', { data: { line: 'points' } });
  const head = (first) => h('thead', null, h('tr', null,
    h('th', { scope: 'col' }, first),
    h('th', { scope: 'col' }, first === 'Taken' ? 'Why' : 'Taken'),
    h('th', { scope: 'col' }, 'Holds'),
    h('th', { scope: 'col', class: 'table__num' }, 'Size'),
    h('th', { scope: 'col' }, 'Do')));
  const body = h('tbody');
  const list = h('table', { class: 'table rec__table', hidden: true },
    h('caption', { class: 'vh' }, 'Recovery points, newest first'),
    head('Taken'),
    body);
  const otherBody = h('tbody');
  const otherTitle = h('summary', { data: { line: 'others-title' } });
  const otherTable = h('table', { class: 'table rec__table' },
    h('caption', { class: 'vh' }, 'Recovery points of other projects, newest first'),
    head('Project'),
    otherBody);
  const others = h('details', { class: 'rec__others', data: { disclosure: 'other-points' }, hidden: true }, otherTitle, otherTable);
  const brokenBody = h('tbody');
  const brokenTitle = h('summary', { data: { line: 'broken-title' } });
  const brokenTable = h('table', { class: 'table rec__table' },
    h('caption', { class: 'vh' }, 'Recovery points that cannot be read, newest first'),
    head('Taken'),
    brokenBody);
  const broken = h('details', { class: 'rec__broken', data: { disclosure: 'unreadable-points' }, hidden: true }, brokenTitle, brokenTable);
  const note = h('p', { role: 'alert', data: { line: 'point-problem' }, hidden: true });
  const element = card({ id: 'recovery', title: 'Recovery points' }, h('style', null, PHONE_CSS), lead, status, note, list, others, broken);
  const heading = element.querySelector('.card__title');
  heading.setAttribute('tabindex', '-1');

  let drawn = 0;
  let lists = { mine: [], abroad: [], broken: [] };
  let focusAfter = null; // { key, action }, or 'heading': where the focus goes after the next draw

  // Where the focus goes when `point` goes: the next row's first button, else the previous row's, else the heading.
  function succeeded(point) {
    const among = [lists.mine, lists.abroad, lists.broken].find((each) => each.some((one) => one.key === point.key)) || [];
    const at = among.findIndex((one) => one.key === point.key);
    const next = among[at + 1] || among[at - 1];
    focusAfter = next ? { key: next.key } : 'heading';
  }

  function placeFocus() {
    const wanted = focusAfter;
    focusAfter = null;
    if (!wanted) return;
    const row = wanted === 'heading' ? null : element.querySelector('tr[data-point="' + CSS.escape(String(wanted.key)) + '"]');
    const target = row ? row.querySelector('button') : heading;
    if (row) {
      const details = row.closest('details');
      if (details) details.open = true;
    }
    target.focus();
  }

  // One restore, open or delete at a time: a second press while one runs does nothing.
  let busy = false;
  async function once(opener, run) {
    if (busy) return;
    busy = true;
    if (opener) opener.setAttribute('aria-busy', 'true');
    element.setAttribute('aria-busy', 'true');
    try {
      await run();
    } finally {
      busy = false;
      if (opener) opener.removeAttribute('aria-busy');
      element.removeAttribute('aria-busy');
    }
  }

  async function remove(point, when, opener) {
    const ok = await ctx.confirm({
      title: 'Delete the recovery point from ' + when + '?',
      body: 'It cannot be brought back. The project you are working on does not change.',
      action: 'Delete this recovery point',
      keep: 'Keep it',
      danger: true,
      opener,
    });
    if (!ok) return;
    problem('');
    succeeded(point);
    try {
      await storage.deleteRecoveryPoint(point.key);
    } catch (error) {
      focusAfter = null;
      problem('The recovery point was not deleted. ' + (error && error.message ? error.message : 'Try again.'));
    }
  }

  async function saveAsStored(point) {
    problem('');
    try {
      const text = await storedPoint(point.key);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const link = h('a', { href: url, download: 'recovery-point-as-stored-' + String(point.key).replace(/[^A-Za-z0-9_-]/g, '_') + '.json', hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      problem('The recovery point was not exported. ' + (error && error.message ? error.message : 'Try again.'));
    }
  }

  // Which of the device's projects are kept (the open one, the shelf): ids.
  let keptIds = new Set();

  function problem(text) {
    note.textContent = text;
    note.hidden = text === '';
  }

  // A point of another project. `shelved`: the project is kept on this device.
  function openOrRestoreAsProject(point, shelved, opener) {
    return once(opener, async () => {
      problem('');
      let answer;
      try {
        answer = shelved ? await storage.projects.open(point.projectId) : await storage.projects.restoreAsProject(point.key);
      } catch (error) {
        problem('Nothing was restored. ' + (error && error.message ? error.message : 'Try again.'));
        return;
      }
      if (answer.ok) return; // the page reloads into that project
      if (answer.code === 'held') {
        problem(answer.text);
        const outcome = await refuseHeld(ctx, { what: 'point', held: { id: answer.id, label: answer.label }, opener, keep: null });
        if (outcome.text !== '') problem(outcome.text);
        draw();
        return;
      }
      problem(answer.text);
    });
  }

  // Plain Restore, for the open project's own points. The session decides (a point
  // is only applied over its own project): a point whose project has since been put
  // on the shelf, or is neither open nor kept, comes back with its code and is sent
  // the way a row of another project goes.
  function restorePlain(point, opener) {
    return once(opener, async () => {
      problem('');
      succeeded(point);
      let answer;
      try {
        answer = await storage.restoreRecoveryPointResult(point.key);
      } catch (error) {
        focusAfter = null;
        problem('Nothing was restored. ' + (error && error.message ? error.message : 'Try again.'));
        return;
      }
      if (answer.ok) return;
      focusAfter = null;
      if (answer.code === 'held') {
        problem(answer.text);
        const outcome = await refuseHeld(ctx, { what: 'point', held: { id: answer.id, label: answer.label }, opener, keep: null });
        if (outcome.text !== '') problem(outcome.text);
        draw();
        return;
      }
      if (answer.code === 'other-project') {
        busy = false; // the row of another project goes on from here
        await openOrRestoreAsProject({ ...point }, false, opener);
        draw();
        return;
      }
      problem(answer.text);
    });
  }

  // A button's name starts with the words it shows (WCAG 2.5.3) and ends with whose it is.
  const nameOf = (visible, whose) => visible + (/ /.test(visible) ? ', ' : ' ') + whose;

  // kind: 'mine' | 'away' | 'broken'
  function row(point, now, format, kind) {
    const away = kind === 'away';
    const shelved = away && keptIds.has(point.projectId);
    const when = whenWords(point.takenAt, now, format);
    const who = point.label === '' || point.label === undefined ? 'a project with no name' : point.label;
    const whose = away ? 'the recovery point of ' + who + ' from ' + when : 'the recovery point from ' + when;
    const off = Boolean(storage.state.readOnly);
    const reasonId = uid('rec-reason');
    const reason = h('span', { class: 'vh', id: reasonId }, off ? READ_ONLY_REASON : '');
    const make = (visible, action, run, why) => {
      const el = h('button', { type: 'button', class: 'btn', 'aria-label': nameOf(visible, whose), data: { action } }, visible);
      if (why) {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('aria-describedby', reasonId);
      }
      el.addEventListener('click', (event) => {
        if (why) problem(why);
        else run(event.currentTarget);
      });
      return el;
    };
    const readOnlyWhy = off ? READ_ONLY_REASON : null;
    const save = make('Export', 'export', () => (kind === 'broken' ? saveAsStored(point) : storage.exportRecoveryPoint(point.key)), null);
    const drop = make('Delete', 'delete', (el) => remove(point, when, el), readOnlyWhy);
    let buttons;
    if (kind === 'broken') {
      buttons = [save, drop];
    } else if (away) {
      const go = shelved
        ? make('Open ' + who, 'open-project', (el) => openOrRestoreAsProject(point, true, el), readOnlyWhy)
        : make('Restore as a project', 'restore-as-project', (el) => openOrRestoreAsProject(point, false, el), readOnlyWhy);
      buttons = [go, save, drop];
    } else {
      buttons = [make('Restore', 'restore', (el) => restorePlain(point, el), readOnlyWhy), save, drop];
    }
    const cell = h('div', { class: 'card__buttons' }, ...buttons, off ? reason : null);
    cell.style.marginTop = '0';
    const holds = point.readable ? summaryWords(point.summary) : 'This one cannot be read';
    const size = h('td', { class: 'table__num' }, formatBytes(point.bytes));
    if (away) {
      return h('tr', { data: { point: String(point.key), reason: point.reason, project: point.projectId } },
        h('th', { scope: 'row' }, h('bdi', { data: { line: 'point-project' } }, who)),
        h('td', null, when + ' · ' + (REASON_WORDS[point.reason] || 'By the tool')),
        h('td', null, holds), size, h('td', null, cell));
    }
    if (kind === 'broken') {
      return h('tr', { data: { point: String(point.key), reason: point.reason } },
        h('th', { scope: 'row' }, when),
        h('td', null, REASON_WORDS[point.reason] || 'By the tool'),
        h('td', null, holds), size, h('td', null, cell));
    }
    return h('tr', { data: { point: String(point.key), reason: point.reason } },
      h('th', { scope: 'row' }, when),
      h('td', null, REASON_WORDS[point.reason] || 'By the tool'),
      h('td', null, holds), size, h('td', null, cell));
  }

  async function draw() {
    drawn += 1;
    const mine = drawn;
    const state = storage.state;
    let points = [];
    let failed = null;
    let ids = null;
    if (state.recovery) {
      try {
        points = await storage.listRecoveryPoints();
        if (storage.projects) ids = new Set((await storage.projects.list()).map((each) => each.id));
      } catch (error) {
        failed = error.message;
      }
    }
    if (mine !== drawn) return; // a later draw has the newer list
    const now = ctx.clock();
    const format = ctx.store.project.settings.timeFormat;
    keptIds = ids || new Set();
    // the open project's, then the rest; a point that cannot be read, or whose project cannot be told,
    // is listed apart and is in no count
    const openId = ctx.store.project.id;
    const hasProject = (point) => typeof point.projectId === 'string' && point.projectId !== '';
    const unclassed = (point) => !point.readable || (ids !== null && !hasProject(point));
    const away = (point) => ids !== null && point.readable && hasProject(point) && point.projectId !== openId;
    const lost = points.filter(unclassed);
    const abroad = points.filter((point) => !unclassed(point) && away(point));
    points = points.filter((point) => !unclassed(point) && !away(point));
    lists = { mine: points, abroad, broken: lost };
    element.dataset.points = String(points.length);
    element.dataset.others = String(abroad.length);
    element.dataset.unreadable = String(lost.length);
    const readOnlyLine = state.readOnly ? ' This tab is read-only, so it can export one but not restore or delete one.' : '';
    const apart = lost.length > 0 ? ' ' + (lost.length === 1 ? '1 cannot be read and is' : lost.length + ' cannot be read and are') + ' listed under Cannot be read.' : '';
    if (!state.recovery || failed) {
      status.textContent = 'This device is not keeping recovery points: ' + (state.recoveryError || failed) + ' The project itself is still saved. Export a project file now and then to be safe.';
    } else if (points.length === 0) {
      status.textContent = (abroad.length > 0 ? 'There are no recovery points of this project yet; the ones below are of other projects. ' : 'There are no recovery points yet. ') + 'The first is taken a few minutes after you change something, or when you leave the page.' + apart + readOnlyLine;
    } else {
      const total = points.reduce((sum, point) => sum + (Number.isFinite(point.bytes) ? point.bytes : 0), 0);
      status.textContent = 'There ' + (points.length === 1 ? 'is ' : 'are ') + count(points.length, 'recovery point') + ', ' + formatBytes(total) + ' in all.' + apart + readOnlyLine;
    }
    list.hidden = points.length === 0;
    body.replaceChildren(...points.map((point) => row(point, now, format, 'mine')));
    others.hidden = abroad.length === 0;
    otherTitle.textContent = 'Of other projects (' + abroad.length + ')';
    otherBody.replaceChildren(...abroad.map((point) => row(point, now, format, 'away')));
    broken.hidden = lost.length === 0;
    brokenTitle.textContent = 'Cannot be read (' + lost.length + ')';
    brokenBody.replaceChildren(...lost.map((point) => row(point, now, format, 'broken')));
    placeFocus();
  }

  let shown = false;
  const stop = storage.subscribe((state, what) => {
    if (element.isConnected) shown = true;
    else if (shown) {
      stop();
      return;
    }
    if (what === 'points' || what === 'recovery' || what === 'tabs' || what === 'ready' || what === 'projects') draw();
  });

  draw();
  // the list does not depend on the project; only a change of time format would redraw it
  let format = ctx.store.project.settings.timeFormat;
  return {
    element,
    update(project) {
      if (project.settings.timeFormat === format) return;
      format = project.settings.timeFormat;
      draw();
    },
  };
}
