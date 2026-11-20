// Boot, the hash router, the panels and the save (ARCHITECTURE 11, 8.4; DESIGN 4).
// Screens are #title and #desk. Panels are native dialogs: About, Settings and New game
// carry a hash and a history entry; the desk's Menu and every confirm are dialogs with
// neither. The hash records the screen, opening a panel pushes it, closing one goes back,
// and a hash that makes no sense for the state is replaced, never stacked.
import { h, qs } from './dom.js';
import { loadContent } from '../data.js';
import * as engine from '../engine/index.js';
import { makeSlots, settingsDefaults } from '../save.js';
import { renderTitle, TITLE_TEXT } from './screens/title.js';
import { newGameBody } from './screens/newgame.js';
import { settingsBody, applySettings } from './screens/settings.js';
import { createDesk } from './screens/desk.js';
import { createMap } from './screens/map.js';
import { createEnding, ENDING_PAGES } from './screens/ending.js';
import { ledgerBody } from './screens/ledger.js';
import { notebookBody } from './screens/notebook.js';

const SCREENS = new Set(['title', 'desk', 'map', 'ending']);
const NEEDS_GAME = new Set(['desk', 'map', 'ending']);
const PANELS = new Set(['about', 'settings', 'newgame']);
const GAME_PANELS = new Set(['ledger', 'notebook']);   // dialogs over the desk, which need a game
const WORDS = ['one', 'two', 'three', 'four'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const app = {
  content: null, slots: null, art: new Map(), settings: settingsDefaults(),
  outfitFor: null, // a stop id the desk hands the map table to open the sheet on; the map reads and clears it
  state: null,     // the game in play, or null
  running: false,  // true once Continue or Begin put the player on the desk
  view() { return engine.view(app.state, app.content); },
  /** Run an engine call on the state, keep the result and save it (ARCHITECTURE 8.4). */
  act(fn) { app.state = fn(app.state); app.persist(); },
  persist() { if (app.state) app.slots.game.save(app.state); },
  setSetting(key, value) {
    app.settings = { ...app.settings, [key]: value };
    app.slots.settings.save(app.settings);
    applySettings(app.settings);
  },
  say(text) {
    const live = qs('#live');
    if (!live) return;
    live.textContent = '';
    queueMicrotask(() => { live.textContent = text; });
  },
  openMenu: b => openMenu(b),
  /** The ledger or the notebook over the desk; `section` is where the ledger opens ('warehouse'). */
  openBook: (name, opener, section) => open(name, opener, { section }),
  toTitle: () => goTo('title'),
  /** The last season is played: the ending's first page (DESIGN 4.12). */
  toEnding: () => goTo(`ending/${ENDING_PAGES[app.state.phase]?.[0] ?? 'notice'}`),
  recallPlan: {},  // expedition id -> 'recall' | 'stay', chosen on the recall page and not yet sent
};

let screen = null;       // 'title' | 'desk', what is drawn behind the panels
let desk = null;
let map = null;         // the map table, and under it the #outfit sheet
let ending = null;      // the ending's pages
let openPanel = null;    // { name, dialog, opener }

const hashName = () => location.hash.replace(/^#/, '');
/** `ending/home` is the screen `ending` on its page `home`; every other hash is a bare name. */
const splitHash = () => { const [name, page] = hashName().split('/'); return { name, page }; };

// ---- helpers

const label = () => {
  const v = app.view();
  return `${cap(v.season)} ${v.year}, Act ${WORDS[v.act - 1] ?? v.act}`;
};

/** A small modal with buttons; resolves to the pressed button's value, or null on Esc. */
function confirmDialog(title, body, actions) {
  return new Promise(resolve => {
    const id = `confirm-${Math.random().toString(36).slice(2, 7)}`;
    const dialog = h('dialog', { class: 'paper confirm', 'aria-labelledby': `${id}-t` },
      h('h2', { id: `${id}-t`, tabindex: '-1' }, title), h('p', null, body),
      h('div', { class: 'panel-actions' }, actions.map(a => h('button', { class: `button${a.primary ? ' primary' : ''}`, type: 'button', id: a.id, onclick: () => { dialog.dataset.value = a.value; dialog.close(); } }, a.label))));
    document.body.append(dialog);
    dialog.addEventListener('close', () => { const v = dialog.dataset.value ?? null; dialog.remove(); resolve(v); });
    trapTab(dialog);
    dialog.showModal();
    dialog.querySelector('h2').focus();
  });
}

function trapTab(dialog) {
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const stops = [...dialog.querySelectorAll('input:not([disabled]), button:not([tabindex="-1"])')];
    const first = stops[0], last = stops[stops.length - 1];
    const here = document.activeElement;
    if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (here === first || here === dialog.querySelector('h2'))) { e.preventDefault(); last.focus(); }
  });
}

// ---- panels with a hash

function makePanel(name, titleText, ...body) {
  const titleId = `panel-${name}-title`;
  return h('dialog', { class: 'paper', id: `panel-${name}`, 'aria-labelledby': titleId },
    h('h2', { id: titleId, tabindex: '-1' }, titleText), ...body);
}
const closeDialog = d => { if (d.open) d.close(); };
const closeButton = (name, dialog) => h('div', { class: 'panel-actions' },
  h('button', { class: 'button', type: 'button', id: `panel-${name}-close`, onclick: () => closeDialog(dialog) }, 'Close'));

function buildPanel(name, opts = {}) {
  if (name === 'ledger') {
    const d = makePanel('ledger', 'The ledger', ...ledgerBody(app));
    d.classList.add('book');
    d.append(closeButton(name, d));
    return d;
  }
  if (name === 'notebook') {
    const d = makePanel('notebook', 'The notebook', ...notebookBody(app, opts).nodes);
    d.classList.add('book');
    d.append(closeButton(name, d));
    return d;
  }
  if (name === 'about') {
    const d = makePanel('about', 'About this game', ...TITLE_TEXT.about.map(t => h('p', null, t)), h('p', null, TITLE_TEXT.noSave));
    d.append(closeButton(name, d));
    return d;
  }
  if (name === 'newgame') {
    return makePanel('newgame', 'New game', ...newGameBody({
      content: app.content,
      onBegin: begin,
      onCancel: () => closeDialog(openPanel.dialog),
    }));
  }
  const d = makePanel('settings', 'Settings', ...settingsBody(app, {
    onStartAgain: async opener => {
      const v = await confirmDialog('Start again?', `Your game in ${label()} will be lost. You can export it first.`, [
        { id: 'confirm-cancel', label: 'Cancel', value: 'cancel' }, { id: 'confirm-again', label: 'Start again', value: 'again', primary: true }]);
      if (v !== 'again') { opener.focus(); return; }
      app.slots.game.clear(); app.state = null; app.running = false;
      leavePanelSilently(); goTo('title', true);
    },
    onImported: st => { app.state = st; app.persist(); app.running = true; leavePanelSilently(); goTo('desk', true); },
  }));
  d.append(closeButton(name, d));
  return d;
}

function restoreFocus(p) {
  // The desk redraws its bar, so the opener may have been replaced by a button with the same id.
  const again = p.opener?.id && qs(`#${p.opener.id}`);
  (p.opener?.isConnected ? p.opener : again || qs(`#btn-${p.name}`) || qs('#btn-menu'))?.focus();
}

function show(name, opener, opts = {}) {
  if (openPanel) return;
  const dialog = buildPanel(name, opts);
  document.body.append(dialog);
  // fromHistory is set when history already moved (Back, or another panel's hash) and the
  // page closes the dialog itself. The close event arrives later, as its own task, and must
  // not step history a second time.
  const p = { name, dialog, opener, fromHistory: false };
  openPanel = p;
  dialog.addEventListener('close', () => {
    if (openPanel === p) openPanel = null;
    dialog.remove();
    if (p.fromHistory) return;
    // Esc and the Close button land here and step the hash back to the screen.
    if (hashName() === name) {
      if (history.state?.panel === name) history.back();
      else history.replaceState(null, '', `#${screen ?? 'title'}`);
    }
    restoreFocus(p);
  });
  trapTab(dialog);
  dialog.showModal();
  // DESIGN 6: focus goes to the panel's title; the ledger opened at a section goes to that section's heading
  const at = opts.section && qs(`#${name}-${opts.section}-h`, dialog);
  (at ?? dialog.querySelector('h2')).focus();
  at?.scrollIntoView({ block: 'start' });
}

function open(name, opener, opts = {}) {
  history.pushState({ panel: name }, '', `#${name}`);
  show(name, opener, opts);
}

/** Close the open panel because history moved, or because the page is leaving it. */
function closeFromHistory(focus = true) {
  const p = openPanel;
  if (!p) return;
  p.fromHistory = true;
  openPanel = null;
  closeDialog(p.dialog);
  p.dialog.remove();
  if (focus) restoreFocus(p);
}
const leavePanelSilently = () => closeFromHistory(false);

// ---- the desk's Menu

function openMenu(opener) {
  const item = (id, text, fn) => h('button', { class: 'choice', type: 'button', id, onclick: () => { dialog.close(); fn(); } }, text);
  const dialog = h('dialog', { class: 'paper menu', id: 'panel-menu', 'aria-labelledby': 'panel-menu-title' },
    h('h2', { id: 'panel-menu-title', tabindex: '-1' }, 'Menu'),
    h('div', { class: 'menu-items' },
      // DESIGN 5.2, 5.3: on a phone the bar holds only the Menu, so the ledger and the notebook are here
      item('menu-ledger', 'Ledger', () => open('ledger', opener)),
      item('menu-notebook', `Notebook ${app.state?.notebook.length ?? 0}`, () => open('notebook', opener)),
      item('menu-settings', 'Settings', () => open('settings', opener)),
      item('menu-about', 'About this game', () => open('about', opener)),
      item('menu-quit', 'Save and quit to title', () => { app.persist(); goTo('title'); })),
    h('div', { class: 'panel-actions' }, h('button', { class: 'button', type: 'button', id: 'menu-close', onclick: () => dialog.close() }, 'Close')));
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (!openPanel && screen === 'desk') opener?.focus(); });
  trapTab(dialog);
  dialog.showModal();
  dialog.querySelector('h2').focus();
}

// ---- starting and continuing

const newSeed = () => {
  const s = Number(params.get('seed'));
  if (testMode && params.has('seed') && Number.isInteger(s)) return s;
  return testMode ? 1324 : Math.floor(Math.random() * 2 ** 31);
};

async function begin({ length, house }) {
  const saved = app.slots.game.load();
  if (saved) {
    app.state = saved;
    const v = await confirmDialog('Start again?', `Your game in ${label()} will be lost. You can export it first.`, [
      { id: 'confirm-cancel', label: 'Cancel', value: 'cancel' },
      { id: 'confirm-export', label: 'Export', value: 'export' },
      { id: 'confirm-again', label: 'Start again', value: 'again', primary: true }]);
    if (v === 'export') { app.slots.game.exportToFile(saved, 'merchant-save.json'); return begin({ length, house }); }
    if (v !== 'again') return;
  }
  app.slots.game.clear();
  app.state = engine.newGame(app.content, { seed: newSeed(), length, house });
  app.persist();
  app.running = true;
  leavePanelSilently();
  goTo('desk', true);
}

/** Play again (DESIGN 4.12 step 6): the finished game's save goes, and the New game panel opens on the title. */
function playAgain(opener) {
  app.slots.game.clear(); app.state = null; app.running = false; app.recallPlan = {};
  goTo('title', true);
  open('newgame', opener);
}

/** Go to a screen. `replace` swaps the current history entry (a panel's) instead of adding one. */
function goTo(name, replace = false) {
  if (name === 'title') app.running = false;
  history[replace ? 'replaceState' : 'pushState'](null, '', `#${name}`);
  route();
}

// ---- drawing

function renderScreen(name) {
  desk?.destroy(); desk = null;
  map?.destroy(); map = null;
  ending?.destroy(); ending = null;
  screen = name;
  document.documentElement.removeAttribute('data-season');
  if (name === 'map') {
    map = createMap(app, {
      toDesk: () => goTo('desk'),
      openOutfit: stopId => { map.prepareOutfit(stopId); history.pushState({ panel: 'outfit' }, '', '#outfit'); route(); },
      // Esc, Back to the map and a send all land here: the sheet is gone, so the hash steps back to #map
      outfitClosed: () => { if (hashName() === 'outfit') history.back(); },
    });
    root.replaceChildren(map.el);
    map.focusFirst();
    return;
  }
  if (name === 'ending') {
    ending = createEnding(app, {
      go: page => { history.pushState(null, '', `#ending/${page}`); route(); },
      toTitle: () => goTo('title'),
      playAgain: opener => playAgain(opener),
    });
    root.replaceChildren(ending.el);
    return;
  }
  if (name === 'desk') {
    desk = createDesk(app);
    root.replaceChildren(desk.el);
    desk.draw({ focus: 'season' });
    return;
  }
  const saved = app.slots.game.load();
  app.state = saved ?? null;
  root.replaceChildren(renderTitle({
    city: app.content.city,
    save: saved ? { label: label() } : null,
    onNew: b => open('newgame', b),
    onContinue: () => { app.running = true; goTo('desk'); },
    onAbout: b => open('about', b),
    onSettings: b => open('settings', b),
  }));
}

function route() {
  let { name, page } = splitHash();
  // #outfit is the sheet over the map. Its draft lives in memory, so a reload (or a hash typed in)
  // has nothing to show and goes to the map table instead (DESIGN 4.8).
  if (name === 'outfit') {
    if (screen === 'map' && map?.hasDraft()) { closeFromHistory(); map.showOutfit(); return; }
    history.replaceState(null, '', '#map');
    name = 'map';
  } else if (name === 'map' && screen === 'map') {
    map?.hideOutfit();
  }
  if (PANELS.has(name)) {
    if (!screen) renderScreen('title');
    // A panel hash arriving while another panel is open closes the first.
    if (openPanel && openPanel.name !== name) closeFromHistory();
    if (!openPanel) show(name, null);
    return;
  }
  if (GAME_PANELS.has(name)) {
    if (!app.running) {
      const saved = app.slots.game.load();
      if (saved) { app.state = saved; app.running = true; }
    }
    // The ledger and the notebook lie over the desk; with no game there is nothing to show.
    if (!app.running) { history.replaceState(null, '', '#title'); name = 'title'; }
    else {
      if (screen !== 'desk' && screen !== 'map') renderScreen('desk');
      if (openPanel && openPanel.name !== name) closeFromHistory();
      if (!openPanel) show(name, null);
      return;
    }
  }
  closeFromHistory();
  // A reload on #desk with a save in this browser picks the game up where it was.
  if (NEEDS_GAME.has(name) && !app.running) {
    const saved = app.slots.game.load();
    if (saved) { app.state = saved; app.running = true; }
  }
  let want = SCREENS.has(name) && (!NEEDS_GAME.has(name) || app.running) ? name : app.running ? 'desk' : 'title';
  // Once the last season is played the game is the ending: the desk and the map have nothing to show,
  // and a page of the ending that the phase does not open (Back after the recall was sent) is replaced.
  const pages = ENDING_PAGES[app.state?.phase];
  if (want !== 'title' && app.running && pages) {
    if (want !== 'ending') page = undefined;
    want = 'ending';
    if (!pages.includes(page)) page = pages[0];
  } else if (want === 'ending') want = 'desk';
  const wanted = want === 'ending' ? `ending/${page}` : want;
  // An unknown or unplayable hash is replaced, never pushed, so Back never meets it twice.
  if (wanted !== hashName()) history.replaceState(null, '', `#${wanted}`);
  if (screen !== want) renderScreen(want);
  if (want === 'ending') ending.show(page);
}

// ---- keyboard, save on leaving

addEventListener('keydown', e => { desk?.key(e); map?.key(e); ending?.key(e); });
addEventListener('pagehide', () => app.persist());

// ---- boot

async function boot() {
  try {
    const content = engine.validateContent(await loadContent('cairo', { fetch: u => fetch(u) }));
    const manifest = await (await fetch(new URL('../../assets/art/manifest.json', import.meta.url))).json();
    for (const a of manifest.assets) app.art.set(a.id, a);
    app.content = content;
    app.slots = makeSlots(content);
    app.settings = app.slots.settings.load() ?? settingsDefaults();
    applySettings(app.settings);
  } catch (e) {
    root.replaceChildren(h('main', { class: 'title-screen' }, h('div', { class: 'paper', role: 'alert' },
      h('h2', null, 'The game could not start'), h('p', null, 'Something in the game files is wrong. Nothing was lost.'),
      h('p', null, h('small', null, String(e.message).slice(0, 400))))));
    return;
  }
  if (testMode) {
    Object.defineProperty(window, '__merchant', { value: {
      get state() { return app.state; }, get view() { return app.state ? app.view() : null; },
      content: app.content, get settings() { return app.settings; } } });
  }
  // Only now: a popstate that arrives while the content is still loading has nothing to draw.
  addEventListener('popstate', route);
  route();
}

// One polite live region for the whole page; it outlives every screen (DESIGN 6).
document.body.append(h('div', { id: 'live', class: 'visually-hidden', role: 'status', 'aria-live': 'polite' }));
await boot();
