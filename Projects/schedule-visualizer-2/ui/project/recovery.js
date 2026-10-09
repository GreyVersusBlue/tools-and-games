// The Recovery points card: the copies the tool takes by itself, newest
// first, each with when and why it was taken, what it holds and its size.
// Any of them can be restored (the present is captured first, so a restore
// can be put back), exported as a project file, or deleted.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count } from '../components/words.js';
import { formatBytes, whenWords } from '../../storage/words.js';
import { summaryWords } from '../../storage/session.js';

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
  const element = card({ id: 'recovery', title: 'Recovery points' }, lead, status, list);

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

  function row(point, now, format) {
    const when = whenWords(point.takenAt, now, format);
    const name = 'the recovery point from ' + when;
    const restore = h('button', { type: 'button', class: 'btn', 'aria-label': 'Restore ' + name, data: { action: 'restore' }, on: { click: () => storage.restoreRecoveryPoint(point.key) } }, 'Restore');
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
    if (state.recovery) {
      try {
        points = await storage.listRecoveryPoints();
      } catch (error) {
        failed = error.message;
      }
    }
    if (mine !== drawn) return; // a later draw has the newer list
    const now = ctx.clock();
    const format = ctx.store.project.settings.timeFormat;
    element.dataset.points = String(points.length);
    if (!state.recovery || failed) {
      status.textContent = 'This device is not keeping recovery points: ' + (state.recoveryError || failed) + ' The project itself is still saved. Export a project file now and then to be safe.';
    } else if (points.length === 0) {
      status.textContent = 'There are no recovery points yet. The first is taken a few minutes after you change something, or when you leave the page.';
    } else {
      const total = points.reduce((sum, point) => sum + (Number.isFinite(point.bytes) ? point.bytes : 0), 0);
      status.textContent = 'There ' + (points.length === 1 ? 'is ' : 'are ') + count(points.length, 'recovery point') + ', ' + formatBytes(total) + ' in all.'
        + (state.readOnly ? ' This tab is read-only, so it can export one but not restore or delete one.' : '');
    }
    list.hidden = points.length === 0;
    body.replaceChildren(...points.map((point) => row(point, now, format)));
  }

  let shown = false;
  const stop = storage.subscribe((state, what) => {
    if (element.isConnected) shown = true;
    else if (shown) {
      stop();
      return;
    }
    if (what === 'points' || what === 'recovery' || what === 'tabs' || what === 'ready') draw();
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
