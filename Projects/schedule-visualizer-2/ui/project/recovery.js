// The Recovery points card: the copies the tool takes by itself, newest
// first, each with when and why it was taken, what it holds and its size.
// Any of them can be restored (the present is captured first, so a restore
// can be put back), exported as a project file, or deleted.
//
// With several projects on the device (21.10, DESIGN 15.4) the list is the open
// project's. Under it a disclosure, "Of other projects (n)", lists the rest with
// the project's label first: a project kept on this device gets Open <label> in
// place of Restore, one that is no longer on it gets Restore as a project. A plain
// Restore is only ever offered for the open project's own points.

import { h } from '../components/dom.js';
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

export function recoveryCard(ctx) {
  const storage = ctx.storage;
  const lead = h('p', { class: 'card__lead' },
    'A recovery point is a complete copy of the project that the tool takes by itself: every 3 minutes while you work, when you leave the page, and before anything replaces the whole project. The newest '
    + storage.recoveryKeep + ' are kept, apart from the saved project, so that losing one does not lose the other.');
  const status = h('p', { data: { line: 'points' } });
  const body = h('tbody');
  const list = h('table', { class: 'table', hidden: true },
    h('caption', { class: 'vh' }, 'Recovery points, newest first'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Taken'),
      h('th', { scope: 'col' }, 'Why'),
      h('th', { scope: 'col' }, 'Holds'),
      h('th', { scope: 'col', class: 'table__num' }, 'Size'),
      h('th', { scope: 'col' }, 'Do'))),
    body);
  const otherBody = h('tbody');
  const otherTitle = h('summary', { data: { line: 'others-title' } });
  const otherTable = h('table', { class: 'table' },
    h('caption', { class: 'vh' }, 'Recovery points of other projects, newest first'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Project'),
      h('th', { scope: 'col' }, 'Taken'),
      h('th', { scope: 'col' }, 'Holds'),
      h('th', { scope: 'col', class: 'table__num' }, 'Size'),
      h('th', { scope: 'col' }, 'Do'))),
    otherBody);
  const others = h('details', { class: 'rec__others', data: { disclosure: 'other-points' }, hidden: true }, otherTitle, otherTable);
  const note = h('p', { role: 'alert', data: { line: 'point-problem' }, hidden: true });
  const element = card({ id: 'recovery', title: 'Recovery points' }, lead, status, note, list, others);

  let drawn = 0;

  async function remove(point, when, opener) {
    const ok = await ctx.confirm({
      title: 'Delete the recovery point from ' + when + '?',
      body: 'It cannot be brought back. The project you are working on does not change.',
      action: 'Delete this recovery point',
      keep: 'Keep it',
      danger: true,
      opener,
    });
    if (ok) await storage.deleteRecoveryPoint(point.key);
  }

  // Which of the device's projects are kept (the open one, the shelf): ids.
  let keptIds = new Set();

  function problem(text) {
    note.textContent = text;
    note.hidden = text === '';
  }

  // A point of another project. `shelved`: the project is kept on this device.
  async function openOrRestoreAsProject(point, shelved, opener) {
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
      return;
    }
    problem(answer.text);
  }

  // Plain Restore, for the open project's own points. A point whose project has
  // since been put on the shelf (the list was drawn before) is refused first.
  async function restorePlain(point, opener) {
    problem('');
    if (typeof point.projectId === 'string' && point.projectId !== '' && point.projectId !== ctx.store.project.id) {
      let held = null;
      try {
        const label = await storage.projects.holds(point.projectId);
        held = label === null ? null : { id: point.projectId, label };
      } catch (error) {
        problem('Nothing was restored, because this device could not be asked which projects it keeps. ' + (error && error.message ? error.message : ''));
        return;
      }
      if (held) {
        const outcome = await refuseHeld(ctx, { what: 'point', held, opener, keep: null });
        if (outcome.text !== '') problem(outcome.text);
        return;
      }
    }
    await storage.restoreRecoveryPoint(point.key);
  }

  function row(point, now, format, away) {
    const shelved = away && keptIds.has(point.projectId);
    const when = whenWords(point.takenAt, now, format);
    const name = 'the recovery point from ' + when;
    const who = point.label === '' || point.label === undefined ? 'a project with no name' : point.label;
    const restore = away
      ? h('button', { type: 'button', class: 'btn', 'aria-label': (shelved ? 'Open ' + who : 'Restore ' + name + ' as a project'), data: { action: shelved ? 'open-project' : 'restore-as-project' }, on: { click: (event) => openOrRestoreAsProject(point, shelved, event.currentTarget) } }, shelved ? 'Open ' + who : 'Restore as a project')
      : h('button', { type: 'button', class: 'btn', 'aria-label': 'Restore ' + name, data: { action: 'restore' }, on: { click: (event) => restorePlain(point, event.currentTarget) } }, 'Restore');
    const save = h('button', { type: 'button', class: 'btn', 'aria-label': 'Export ' + name, data: { action: 'export' }, on: { click: () => storage.exportRecoveryPoint(point.key) } }, 'Export');
    const drop = h('button', { type: 'button', class: 'btn', 'aria-label': 'Delete ' + name, data: { action: 'delete' }, on: { click: () => remove(point, when, drop) } }, 'Delete');
    const disabled = storage.state.readOnly;
    if (!point.readable || disabled) restore.setAttribute('aria-disabled', 'true');
    if (!point.readable) save.setAttribute('aria-disabled', 'true');
    if (disabled) drop.setAttribute('aria-disabled', 'true');
    for (const button of [restore, save, drop]) {
      // aria-disabled keeps the button in the tab order; it must then do nothing
      button.addEventListener('click', (event) => {
        if (button.getAttribute('aria-disabled') === 'true') event.stopImmediatePropagation();
      }, { capture: true });
    }
    const buttons = h('div', { class: 'card__buttons' }, restore, save, drop);
    buttons.style.marginTop = '0';
    if (away) {
      return h('tr', { data: { point: String(point.key), reason: point.reason, project: point.projectId } },
        h('th', { scope: 'row' }, h('bdi', { data: { line: 'point-project' } }, who)),
        h('td', null, when + ' · ' + (REASON_WORDS[point.reason] || 'By the tool')),
        h('td', null, point.readable ? summaryWords(point.summary) : 'This one cannot be read'),
        h('td', { class: 'table__num' }, formatBytes(point.bytes)),
        h('td', null, buttons));
    }
    return h('tr', { data: { point: String(point.key), reason: point.reason } },
      h('th', { scope: 'row' }, when),
      h('td', null, REASON_WORDS[point.reason] || 'By the tool'),
      h('td', null, point.readable ? summaryWords(point.summary) : 'This one cannot be read'),
      h('td', { class: 'table__num' }, formatBytes(point.bytes)),
      h('td', null, buttons));
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
    // the open project's (a point with no owner named, or one that cannot be read, is listed here), then the rest
    const openId = ctx.store.project.id;
    const away = (point) => ids !== null && point.readable && typeof point.projectId === 'string' && point.projectId !== '' && point.projectId !== openId;
    const abroad = points.filter(away);
    points = points.filter((point) => !away(point));
    element.dataset.points = String(points.length);
    element.dataset.others = String(abroad.length);
    if (!state.recovery || failed) {
      status.textContent = 'This device is not keeping recovery points: ' + (state.recoveryError || failed) + ' The project itself is still saved. Export a project file now and then to be safe.';
    } else if (points.length === 0) {
      status.textContent = (abroad.length > 0 ? 'There are no recovery points of this project yet; the ones below are of other projects. ' : 'There are no recovery points yet. ') + 'The first is taken a few minutes after you change something, or when you leave the page.';
    } else {
      const total = points.reduce((sum, point) => sum + (Number.isFinite(point.bytes) ? point.bytes : 0), 0);
      status.textContent = 'There ' + (points.length === 1 ? 'is ' : 'are ') + count(points.length, 'recovery point') + ', ' + formatBytes(total) + ' in all.'
        + (state.readOnly ? ' This tab is read-only, so it can export one but not restore or delete one.' : '');
    }
    list.hidden = points.length === 0;
    body.replaceChildren(...points.map((point) => row(point, now, format, false)));
    others.hidden = abroad.length === 0;
    otherTitle.textContent = 'Of other projects (' + abroad.length + ')';
    otherBody.replaceChildren(...abroad.map((point) => row(point, now, format, true)));
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
