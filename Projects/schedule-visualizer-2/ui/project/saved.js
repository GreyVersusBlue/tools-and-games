// The Saved on this device card: where the project is kept, when it was last
// saved, how much room it takes, whether the browser has agreed to keep it,
// when it was last written to a file, and whether another tab has it open.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { count } from '../components/words.js';
import { formatBytes, whenInSentence } from '../../storage/words.js';

const PERSIST = {
  kept: 'This browser has agreed to keep the project until you clear its site data yourself.',
  'best-effort': 'This browser may clear the project if the device runs short of room. A project file is the copy that cannot be cleared: export one now and then.',
  unknown: 'This browser does not say whether it will keep the project if the device runs short of room. Export a project file now and then to be safe.',
};

// The share of the room used, in words: "under 1%", "12%".
export function shareWords(share) {
  const percent = share * 100;
  return percent < 1 ? 'under 1%' : Math.round(percent) + '%';
}

export function savedCard(ctx) {
  const storage = ctx.storage;
  const lead = h('p', { class: 'card__lead', data: { line: 'saved' } });
  const usage = h('p', { data: { line: 'usage' } });
  const persist = h('p', { data: { line: 'persist' } });
  const exported = h('p', { data: { line: 'exported' } });
  const tabs = h('p', { data: { line: 'tabs' } });
  const aside = h('p', { data: { line: 'quarantine' } });
  const repairs = h('div', { data: { line: 'repairs' } });
  const exportButton = h('button', { type: 'button', class: 'btn', data: { action: 'export-now' }, on: { click: () => storage.exportProject() } }, 'Export the project now');
  const asideButton = h('button', { type: 'button', class: 'btn', data: { action: 'export-unreadable' }, on: { click: () => storage.exportQuarantined() } }, 'Export the unreadable copy');
  const element = card({ id: 'saved', title: 'Saved on this device' }, lead, usage, persist, exported, tabs, aside, repairs,
    h('div', { class: 'card__buttons' }, exportButton, asideButton));

  function draw() {
    const state = storage.state;
    const now = ctx.clock();
    const format = ctx.store.project.settings.timeFormat;
    element.dataset.save = state.available ? state.save : 'unavailable';
    element.dataset.readOnly = String(state.readOnly);

    if (!state.available) lead.textContent = 'This browser is not keeping the project: ' + state.error + ' Your work lasts only while this tab is open.';
    else if (state.save === 'failed') lead.textContent = 'The last save failed: ' + state.saveError + ' Your work is still in this tab, and saving is tried again every 10 seconds.';
    else if (state.save === 'conflict') lead.textContent = 'This tab has stopped saving: another tab saved the project after this one read it. Reload to carry on from the saved project.';
    else if (state.savedAt) lead.textContent = 'The project is kept in this browser, on this device, and nowhere else. It was last saved ' + whenInSentence(state.savedAt, now, format) + '.';
    else lead.textContent = 'The project is kept in this browser, on this device, and nowhere else. Every change is saved as you make it; nothing has changed yet, so nothing is saved yet.';

    usage.hidden = !state.usage;
    if (state.usage) {
      usage.textContent = 'It uses ' + formatBytes(state.usage.usage) + ' of the ' + formatBytes(state.usage.quota) + ' this browser allows this site (' + shareWords(state.usage.share) + ').'
        + (state.usage.share >= 0.8 ? ' That is nearly all of it: export the project, then free some room on this device.' : '');
    }
    usage.dataset.warning = String(Boolean(state.usage && state.usage.share >= 0.8));

    persist.hidden = !state.available;
    persist.dataset.answer = state.persist;
    persist.textContent = PERSIST[state.persist];

    exported.dataset.exported = String(state.exportedAt !== null);
    exported.textContent = state.exportedAt
      ? 'It was last exported to a file ' + whenInSentence(state.exportedAt, now, format) + '.'
      : 'It has never been exported to a file from this device. Until it is, this browser holds the only copy.';

    tabs.textContent = state.readOnly
      ? 'The project is open in another tab, so this tab is read-only. Close the other tab and this one can edit within a few seconds.'
      : state.tabs === 'locks'
        ? 'This is the tab that edits the project. Open it in a second tab and that one is read-only until this one closes.'
        : 'This is the tab that edits the project. This browser is slow to notice a second tab, so keep the project open in one tab at a time.';

    aside.hidden = state.quarantined === 0;
    asideButton.hidden = state.quarantined === 0;
    aside.textContent = count(state.quarantined, 'saved copy', 'saved copies') + ' that could not be read '
      + (state.quarantined === 1 ? 'has' : 'have') + ' been set aside on this device, and nothing has overwritten ' + (state.quarantined === 1 ? 'it' : 'them') + '.';

    repairs.hidden = state.repairs.length === 0;
    repairs.replaceChildren(
      h('p', null, 'When this project was loaded, ' + count(state.repairs.length, 'thing') + (state.repairs.length === 1 ? ' was' : ' were') + ' put right:'),
      h('ul', null, state.repairs.map((note) => h('li', null, note))),
    );
  }

  // The card is rebuilt each time the section is opened; a card that has
  // left the page stops listening.
  let shown = false;
  const stop = storage.subscribe(() => {
    if (element.isConnected) shown = true;
    else if (shown) {
      stop();
      return;
    }
    draw();
  });

  draw();
  storage.refreshUsage();
  return { element, update: draw };
}
