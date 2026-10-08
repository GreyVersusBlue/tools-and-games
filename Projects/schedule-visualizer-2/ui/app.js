// The planner's shell: the rail, the top bar, routing by hash, the theme,
// shortcuts, undo and redo, toasts, and the Getting started card. Each section
// is a module under ui/<name>/index.js exporting
//
//   section = { id, label, name, key, icon, page, mount(ctx, rest) }
//
// where mount returns { element, update(project), route(rest) }. `update`
// runs after every change to the project; `route` (optional) is asked when the
// address changes inside the same section, and returns true when it has shown
// it. `ctx` is what a section may use of the shell; it is built in boot().

import { h, focusables } from './components/dom.js';
import { icon } from './components/icons.js';
import { createShortcuts } from './components/shortcuts.js';
import { openDialog, confirm, dialogIsOpen } from './components/dialog.js';
import { openMenu, closeMenu } from './components/menu.js';
import { createToasts } from './components/toast.js';
import { field } from './components/field.js';
import { table } from './components/table.js';
import { gettingStarted } from './components/getting-started.js';
import { paperForRegion } from './project/settings.js';

import { section as building } from './building/index.js';
import { section as schedule } from './schedule/index.js';
import { section as movement } from './movement/index.js';
import { section as scenarios } from './scenarios/index.js';
import { section as safety } from './safety/index.js';
import { section as staff } from './staff/index.js';
import { section as project } from './project/index.js';

import { createStore } from '../engine/store.js';
import { createIds } from '../engine/ids.js';
import { newProject, THEMES } from '../engine/schema.js';
import { setSetting, setOnboarding, replaceProject } from '../engine/actions.js';
import { sampleSchool, SAMPLE_PROJECT_ID } from '../data/sample-school.js';
import { startStorage } from '../storage/session.js';

export const TOOL_NAME = 'Schedule Visualizer 2';
export const SECTIONS = [building, schedule, movement, scenarios, safety, staff, project];

// Small device preferences. The name never changes (the storage module keeps
// it): { theme, lastSection, playback, paper }.
export const DEVICE_KEY = 'sv2:device';

const THEME_NAMES = { auto: 'Follow the device', light: 'Light', dark: 'Dark' };

function readDevice() {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_KEY));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

// Does the project hold anything a person entered?
export function hasContent(target) {
  if (target.teachers.length > 0 || target.groups.length > 0) return true;
  return target.building.floors.some((floor) => floor.spaces.length > 0 || /[^.]/.test(floor.cells));
}

export function parseHash(hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/');
  return { id: parts[0], rest: parts.slice(1).join('/') };
}

// Where an undo entry's `focus` is, as an address.
export function hashForFocus(focus) {
  if (!focus || !SECTIONS.some((each) => each.id === focus.section)) return null;
  if (focus.section === 'building' && focus.floorId) return '#building/' + focus.floorId;
  if (focus.section === 'schedule' && focus.tab) return '#schedule/' + focus.tab;
  return '#' + focus.section;
}

async function boot() {
  const root = document.getElementById('app');
  const device = readDevice();
  let deviceWarned = false;

  const clock = () => new Date();
  const ids = createIds(Math.random);
  const devicePaper = () => paperForRegion(navigator.language || 'en-US');

  // The sample school stands in until storage has looked for a saved project
  // (below, before anything is drawn), and stays on a device that has none.
  const first = sampleSchool();
  if (THEMES.includes(device.theme)) first.settings.theme = device.theme;
  const store = createStore({ project: first, clock, ids });

  // ------------------------------------------------------------ the frame

  const rail = h('nav', { class: 'rail', id: 'rail', 'aria-label': 'Sections', tabindex: '-1' },
    h('ul', { class: 'rail__list' }, SECTIONS.map((each) => h('li', null,
      h('a', {
        class: 'rail__item',
        href: '#' + each.id,
        title: each.name + ' (' + each.key + ')',
        'aria-keyshortcuts': each.key,
        data: { section: each.id },
      },
      icon(each.icon),
      // the rail shows one word; the rest of a longer name is there for a screen reader
      h('span', { class: 'rail__label' }, each.label, each.name.startsWith(each.label + ' ') ? h('span', { class: 'vh' }, each.name.slice(each.label.length)) : null),
      h('span', { class: 'rail__key', 'aria-hidden': 'true' }, each.key))))));

  const schoolText = h('span', { class: 'school__text' });
  const schoolMore = h('span', { class: 'vh' });
  const schoolButton = h('button', { type: 'button', class: 'school__name', id: 'school-name', title: 'Change the school name' }, schoolText, schoolMore);
  const schoolSlot = h('div', { class: 'school' }, schoolButton);
  const sampleChip = h('a', { class: 'sample-chip', id: 'sample-chip', href: '#project', title: 'This is the sample school. Remove it in the Project section.' }, 'Sample');
  const saveIndicator = h('span', { class: 'save', id: 'save-indicator', data: { state: 'off' } }, 'Opening…');
  const undoButton = h('button', { type: 'button', class: 'icon-btn', id: 'undo', on: { click: () => undo() } }, icon('undo'));
  const redoButton = h('button', { type: 'button', class: 'icon-btn', id: 'redo', on: { click: () => redo() } }, icon('redo'));
  const searchInput = h('input', { type: 'search', class: 'search__input', id: 'search', placeholder: 'Search', 'aria-label': 'Search rooms, teachers and groups', autocomplete: 'off', spellcheck: 'false' });
  const search = h('form', { class: 'search', role: 'search', on: { submit: (event) => event.preventDefault() } }, icon('search', 16), searchInput);
  const helpButton = h('button', { type: 'button', class: 'icon-btn icon-btn--glyph', id: 'help', title: 'Help and shortcuts (?)', 'aria-label': 'Help and shortcuts', 'aria-keyshortcuts': '?', on: { click: () => openHelp(helpButton) } }, '?');
  const themeButton = h('button', { type: 'button', class: 'icon-btn', id: 'theme', 'aria-haspopup': 'menu', 'aria-expanded': 'false', on: { click: () => openThemeMenu() } }, icon('theme'));
  const secondRow = h('div', { class: 'topbar__row2', id: 'topbar-row2', hidden: true });

  const topbar = h('header', { class: 'topbar', id: 'topbar', tabindex: '-1' },
    h('div', { class: 'topbar__row' },
      schoolSlot, sampleChip, saveIndicator,
      h('div', { class: 'topbar__tools' }, undoButton, redoButton, search, helpButton, themeButton)),
    secondRow,
  );

  const sectionHost = h('div', { class: 'surface__section', id: 'section' });
  const toastHost = h('div', { class: 'toasts', id: 'toasts', role: 'status' });
  const announcer = h('div', { class: 'vh', id: 'announcer', 'aria-live': 'polite' });
  const layout = h('div', { class: 'surface__layout' }, sectionHost);
  const main = h('main', { class: 'surface', id: 'surface', tabindex: '-1' }, layout, toastHost, announcer);
  const inspector = h('aside', { class: 'inspector', id: 'inspector', 'aria-label': 'Inspector', tabindex: '-1', hidden: true });

  // The skip link moves focus itself: the address belongs to the sections.
  const skip = h('a', {
    class: 'skip',
    href: '#surface',
    on: {
      click: (event) => {
        event.preventDefault();
        main.focus();
      },
    },
  }, 'Skip to the section');
  root.replaceChildren(skip, rail, topbar, main, inspector);

  const toasts = createToasts(toastHost);
  const toast = (options) => toasts.show(options);
  const focusSurface = () => main.focus();

  // ------------------------------------------------------------ the device

  function writeDevice(patch) {
    Object.assign(device, patch);
    try {
      localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    } catch (error) {
      if (deviceWarned) return;
      deviceWarned = true;
      toast({ kind: 'problem', text: 'This browser is not keeping your theme and other device choices: ' + error.message + '. They last until this tab closes.' });
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.title = 'Theme: ' + THEME_NAMES[theme];
    themeButton.setAttribute('aria-label', 'Theme: ' + THEME_NAMES[theme]);
    if (device.theme !== theme) writeDevice({ theme });
  }

  function openThemeMenu() {
    const now = store.project.settings.theme;
    openMenu({
      label: 'Theme',
      anchor: themeButton,
      items: THEMES.map((theme) => ({ label: THEME_NAMES[theme], checked: theme === now, run: () => store.apply(setSetting, { key: 'theme', value: theme }) })),
    });
  }

  // ------------------------------------------------------------ undo, redo

  function showAction(focus) {
    const hash = hashForFocus(focus);
    return hash ? { label: 'Show', run: () => navigate(hash) } : undefined;
  }

  function undo() {
    const step = store.undo();
    if (!step) toast({ text: 'There is nothing to undo.' });
    else toast({ text: 'Undid: ' + step.label, action: showAction(step.focus) });
  }

  function redo() {
    const step = store.redo();
    if (!step) toast({ text: 'There is nothing to redo.' });
    else toast({ text: 'Redid: ' + step.label, action: showAction(step.focus) });
  }

  function drawHistory() {
    const pairs = [[undoButton, store.undoLabel, 'Undo', 'Nothing to undo'], [redoButton, store.redoLabel, 'Redo', 'Nothing to redo']];
    for (const [button, label, verb, nothing] of pairs) {
      const text = label ? verb + ': ' + label : nothing;
      button.title = text;
      button.setAttribute('aria-label', text);
      // aria-disabled, not disabled: the button keeps focus when its last step is used
      button.setAttribute('aria-disabled', String(!label));
    }
  }

  // ------------------------------------------------------------ the school name

  function drawSchool() {
    const name = store.project.settings.schoolName;
    schoolText.textContent = name === '' ? TOOL_NAME : name;
    schoolMore.textContent = name === '' ? ' (no school name yet). Set the school name' : '. Change the school name';
    schoolButton.classList.toggle('school__name--unset', name === '');
    sampleChip.hidden = store.project.id !== SAMPLE_PROJECT_ID;
  }

  function editSchool() {
    const edit = field({
      id: 'school-name-field',
      value: store.project.settings.schoolName,
      name: 'schoolName',
      placeholder: 'School name',
      commit: (value) => {
        store.apply(setSetting, { key: 'schoolName', value });
      },
    });
    edit.input.setAttribute('aria-label', 'School name');
    edit.input.classList.add('school__input');
    let done = false;
    function end(refocus) {
      if (done) return;
      done = true;
      schoolSlot.replaceChildren(schoolButton);
      if (refocus) schoolButton.focus();
    }
    edit.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') end(true);
      else if (event.key === 'Escape') {
        edit.input.value = store.project.settings.schoolName;
        end(true);
      }
    });
    edit.input.addEventListener('blur', () => end(false));
    schoolSlot.replaceChildren(edit.element);
    edit.input.focus();
    edit.input.select();
  }
  schoolButton.addEventListener('click', editSchool);

  // ------------------------------------------------------------ the sample school

  async function loadSample(opener) {
    const now = store.project;
    if (now.id === SAMPLE_PROJECT_ID) return;
    if (hasContent(now)) {
      const ok = await confirm({
        title: 'Replace this project with the sample school?',
        body: 'Your building and your schedule are replaced by an invented school. Undo brings them back, for as long as this tab stays open.',
        action: 'Replace my project with the sample school',
        keep: 'Keep my project',
        danger: true,
        opener,
        fallbackFocus: focusSurface,
      });
      if (!ok) return;
    }
    const sample = sampleSchool();
    sample.settings.theme = now.settings.theme;
    store.apply(replaceProject, { project: sample, label: 'Load the sample school' });
    toast({ text: 'Loaded the sample school.', action: { label: 'Undo', run: undo } });
  }

  function removeSample() {
    const now = store.project;
    if (now.id !== SAMPLE_PROJECT_ID) return;
    const empty = newProject(ids, clock, { paperSize: devicePaper() });
    empty.settings.theme = now.settings.theme;
    store.apply(replaceProject, { project: empty, label: 'Remove the sample school' });
    toast({ text: 'Removed the sample school. This is an empty project.', action: { label: 'Undo', run: undo } });
  }

  // ------------------------------------------------------------ help

  function openHelp(opener) {
    const rows = shortcuts.list();
    const list = table({
      caption: 'Keyboard shortcuts',
      key: (row) => row.id,
      columns: [
        { id: 'keys', label: 'Keys', sortable: true, value: (row) => row.keys, render: (row) => h('kbd', null, row.keys) },
        { id: 'does', label: 'What it does', sortable: true, value: (row) => row.does },
        { id: 'group', label: 'Where', sortable: true, value: (row) => row.group },
      ],
      rows,
    });
    const dialog = openDialog({
      id: 'help-dialog',
      title: 'These are the keyboard shortcuts.',
      wide: true,
      opener,
      fallbackFocus: focusSurface,
      body: [
        h('p', null, 'A single key does nothing while you are typing in a field, or while Ctrl, Alt or ⌘ is held. Inside a text field, undo and redo belong to the field.'),
        h('div', { class: 'dialog__scroll', tabindex: '0', role: 'group', 'aria-label': 'Keyboard shortcuts' }, list.element),
      ],
      buttons: [
        { label: 'Show Getting started', value: 'start' },
        { label: 'Close help', value: null },
      ],
    });
    dialog.closed.then((value) => {
      if (value === 'start') showStarted();
    });
    return dialog;
  }

  function showStarted() {
    store.apply(setOnboarding, { dismissed: false, neverShow: false });
    started.element.scrollIntoView({ block: 'nearest' });
    const link = focusables(started.element)[0];
    if (link) link.focus();
  }

  // ------------------------------------------------------------ sections and routing

  let current = null;

  const ctx = {
    store,
    clock,
    ids,
    toast,
    undo,
    redo,
    navigate,
    focusSurface,
    devicePaper,
    loadSample,
    removeSample,
    openHelp,
    showGettingStarted: showStarted,
    confirm: (options) => confirm({ fallbackFocus: focusSurface, ...options }),
    openDialog: (options) => openDialog({ fallbackFocus: focusSurface, ...options }),
    announce(text) {
      announcer.textContent = text;
    },
    // The top bar's second row (the floor tabs). Pass null to take it away.
    setSecondRow(element) {
      secondRow.replaceChildren(...(element ? [element] : []));
      secondRow.hidden = !element;
    },
    // The panel on the right of the surface. Pass null for none.
    setInspector(element) {
      inspector.replaceChildren(...(element ? [element] : []));
      inspector.hidden = !element;
    },
    // 'off', 'saving', 'saved' or 'failed', and the words to show.
    setSaveState(state, text, title) {
      saveIndicator.dataset.state = state;
      saveIndicator.textContent = text;
      saveIndicator.title = title || '';
    },
  };

  const started = gettingStarted(ctx);
  layout.append(started.element);

  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function drawTitle() {
    if (!current) return;
    const name = store.project.settings.schoolName;
    document.title = current.section.name + ' · ' + (name === '' ? TOOL_NAME : name + ' · ' + TOOL_NAME);
  }

  function route() {
    const { id, rest } = parseHash(location.hash);
    const wanted = SECTIONS.find((each) => each.id === id);
    if (!wanted) {
      const last = SECTIONS.some((each) => each.id === device.lastSection) ? device.lastSection : 'building';
      history.replaceState(null, '', '#' + (id === '' ? last : 'building'));
      route();
      return;
    }
    closeMenu();
    const same = current && current.section === wanted;
    if (!same || !(current.view.route && current.view.route(rest))) {
      if (!same) {
        ctx.setSecondRow(null);
        ctx.setInspector(null);
      }
      const view = wanted.mount(ctx, rest);
      current = { section: wanted, view };
      sectionHost.replaceChildren(view.element);
      if (!same) main.scrollTop = 0;
    }
    layout.dataset.section = wanted.id;
    layout.classList.toggle('surface__layout--page', wanted.page === true);
    main.setAttribute('aria-label', wanted.name);
    for (const link of rail.querySelectorAll('.rail__item')) {
      if (link.dataset.section === wanted.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    drawTitle();
    if (!same) {
      announcer.textContent = wanted.name;
      if (device.lastSection !== wanted.id) writeDevice({ lastSection: wanted.id });
    }
  }

  // ------------------------------------------------------------ shortcuts

  const shortcuts = createShortcuts({ blocked: dialogIsOpen });
  for (const each of SECTIONS) {
    shortcuts.add({ id: 'section-' + each.id, group: 'Sections', does: 'Open ' + each.name, key: each.key, run: () => navigate('#' + each.id) });
  }
  shortcuts.add({ id: 'undo', group: 'Anywhere', does: 'Undo the last change', chord: { key: 'z', mod: true }, textFields: false, run: undo });
  shortcuts.add({ id: 'redo', group: 'Anywhere', does: 'Redo what was undone', chord: { key: 'z', mod: true, shift: true }, textFields: false, run: redo });
  shortcuts.add({ id: 'redo-y', group: 'Anywhere', does: 'Redo what was undone', chord: { key: 'y', mod: true }, textFields: false, only: 'other', run: redo });
  shortcuts.add({ id: 'search', group: 'Anywhere', does: 'Go to the search box', chord: { key: 'f', mod: true }, run: () => searchInput.focus() });
  shortcuts.add({ id: 'search-slash', group: 'Anywhere', does: 'Go to the search box', key: '/', run: () => searchInput.focus() });
  shortcuts.add({ id: 'help', group: 'Anywhere', does: 'Open this list', key: '?', run: () => openHelp(document.activeElement === document.body ? helpButton : document.activeElement) });
  shortcuts.add({
    id: 'regions',
    group: 'Anywhere',
    does: 'Move between the rail, the top bar, the section and a message. Shift+F6 goes back',
    chord: { key: 'F6', shift: 'any' },
    run: (event) => cycleRegions(event.shiftKey),
  });
  shortcuts.add({ id: 'escape', group: 'Dialogs and menus', does: 'Close it, and go back to where you were', shown: 'Esc' });
  shortcuts.add({ id: 'field-enter', group: 'Fields', does: 'Keep what you typed. Leaving the field does the same', shown: 'Enter' });
  shortcuts.add({ id: 'field-escape', group: 'Fields', does: 'Put back what was there', shown: 'Esc' });

  // F6: the page's regions in order. The toast counts when one is showing.
  function cycleRegions(back) {
    const stops = [
      { has: (el) => rail.contains(el), go: () => rail.focus() },
      { has: (el) => topbar.contains(el), go: () => topbar.focus() },
      { has: (el) => main.contains(el) && !toastHost.contains(el), go: () => main.focus() },
    ];
    if (!inspector.hidden) stops.push({ has: (el) => inspector.contains(el), go: () => inspector.focus() });
    if (toasts.showing) stops.push({ has: (el) => toastHost.contains(el), go: () => toasts.focus() });
    const at = stops.findIndex((stop) => stop.has(document.activeElement));
    const next = at === -1 ? (back ? stops.length - 1 : 0) : (at + (back ? -1 : 1) + stops.length) % stops.length;
    stops[next].go();
  }

  document.addEventListener('keydown', (event) => shortcuts.handle(event));

  // ------------------------------------------------------------ go

  function draw() {
    const now = store.project;
    applyTheme(now.settings.theme);
    drawSchool();
    drawHistory();
    drawTitle();
    started.update(now);
    if (current && current.view.update) current.view.update(now);
  }

  // Storage: the saved project goes into the store before the first draw,
  // and from here every change is saved (storage/session.js).
  ctx.storage = startStorage(ctx);
  await ctx.storage.ready;

  store.subscribe(draw);
  window.addEventListener('hashchange', route);
  route();
  draw();
  document.documentElement.dataset.ready = 'true';

  // For the tests and for the console.
  globalThis.sv2 = { store, navigate, shortcuts, ctx, storage: ctx.storage };
}

boot();
