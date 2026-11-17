// Boot, hash router and the two panels (About, Settings) of the title screen.
// DESIGN 4: the hash records the screen; opening a panel pushes it, closing
// one goes back, an unknown hash goes to #title.
import { h, qs, focusFirst } from './dom.js';
import { renderTitle, TITLE_TEXT } from './screens/title.js';

const SCREENS = new Set(['title']);
const PANELS = new Set(['about', 'settings']);

const root = document.getElementById('app');
let openPanel = null; // { name, dialog, opener }

const hashName = () => location.hash.replace(/^#/, '');

function closePanel(dialog) {
  if (dialog.open) dialog.close();
}

function makePanel(name, titleText, ...body) {
  const titleId = `panel-${name}-title`;
  const dialog = h('dialog', { class: 'paper', id: `panel-${name}`, 'aria-labelledby': titleId },
    h('h2', { id: titleId, tabindex: '-1' }, titleText),
    ...body,
    h('div', { class: 'panel-actions' },
      h('button', { class: 'button', type: 'button', id: `panel-${name}-close`, onclick: () => closePanel(dialog) }, 'Close')));
  return dialog;
}

function aboutPanel() {
  return makePanel('about', 'About this game',
    ...TITLE_TEXT.about.map(t => h('p', null, t)),
    h('p', null, TITLE_TEXT.noSave));
}

function settingsPanel() {
  const sw = (id, label, note, cls) => {
    const input = h('input', { type: 'checkbox', id, checked: document.documentElement.classList.contains(cls),
      onchange: () => document.documentElement.classList.toggle(cls, input.checked) });
    return h('div', { class: 'switch-row' }, input, h('label', { for: id }, label, h('small', null, note)));
  };
  return makePanel('settings', 'Settings',
    sw('set-large', 'Large text', 'Makes all the writing a quarter bigger.', 'large-text'),
    sw('set-motion', 'Reduce motion', 'Papers appear at once instead of sliding.', 'reduce-motion'),
    h('p', null, h('small', null, 'These are not saved yet.')));
}

function show(name, opener) {
  if (openPanel) return;
  const dialog = name === 'about' ? aboutPanel() : settingsPanel();
  document.body.append(dialog);
  openPanel = { name, dialog, opener };
  dialog.addEventListener('close', () => {
    const p = openPanel;
    openPanel = null;
    dialog.remove();
    // Esc and the Close button both land here: step the hash back to the screen.
    if (hashName() === name) {
      if (history.state?.panel === name) history.back();
      else { history.replaceState(null, '', '#title'); }
    }
    const back = (p?.opener && p.opener.isConnected) ? p.opener : qs(`#btn-${name}`);
    back?.focus();
  });
  dialog.showModal();
  focusFirst(dialog.querySelector('input, button'));
}

function open(name, opener) {
  history.pushState({ panel: name }, '', `#${name}`);
  show(name, opener);
}

function renderScreen() {
  root.replaceChildren(renderTitle({
    onAbout: b => open('about', b),
    onSettings: b => open('settings', b),
  }));
}

function route() {
  const name = hashName();
  if (PANELS.has(name)) {
    if (!qs('#screen-title')) renderScreen();
    if (!openPanel) show(name, null);
    return;
  }
  if (openPanel) closePanelNoHistory();
  if (!SCREENS.has(name)) { history.replaceState(null, '', '#title'); }
  if (!qs('#screen-title')) renderScreen();
}

// popstate closes the topmost layer only
function closePanelNoHistory() {
  const p = openPanel;
  if (!p) return;
  openPanel = null;
  p.dialog.remove();
  (p.opener?.isConnected ? p.opener : qs(`#btn-${p.name}`))?.focus();
}

window.addEventListener('popstate', route);
route();
