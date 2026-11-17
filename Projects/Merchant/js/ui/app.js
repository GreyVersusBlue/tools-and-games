// Boot, hash router and the two panels (About, Settings) of the title screen.
// DESIGN 4: the hash records the screen; opening a panel pushes it, closing
// one goes back, an unknown hash goes to #title.
import { h, qs } from './dom.js';
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

function restoreFocus(p) {
  (p.opener?.isConnected ? p.opener : qs(`#btn-${p.name}`))?.focus();
}

function show(name, opener) {
  if (openPanel) return;
  const dialog = name === 'about' ? aboutPanel() : settingsPanel();
  document.body.append(dialog);
  // fromHistory is set when history already moved (Back, or another panel's
  // hash) and the page closes the dialog itself. The close event arrives later,
  // as its own task, and must not step history a second time.
  const p = { name, dialog, opener, fromHistory: false };
  openPanel = p;
  dialog.addEventListener('close', () => {
    if (openPanel === p) openPanel = null;
    dialog.remove();
    if (p.fromHistory) return;
    // Esc and the Close button land here and step the hash back to the screen.
    if (hashName() === name) {
      if (history.state?.panel === name) history.back();
      else history.replaceState(null, '', '#title');
    }
    restoreFocus(p);
  });
  // The page behind is inert, but Tab past the last control would leave for
  // the browser's own bar. Keep it going round inside the panel (DESIGN 6).
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const stops = [...dialog.querySelectorAll('input, button')];
    const first = stops[0], last = stops[stops.length - 1];
    const here = document.activeElement;
    if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (here === first || here === dialog.querySelector('h2'))) { e.preventDefault(); last.focus(); }
  });
  dialog.showModal();
  // DESIGN 6: focus goes to the panel's title, not its first control.
  dialog.querySelector('h2').focus();
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

// Close the open panel because history moved: dialog.close() with the panel's
// flag up. The panel is gone from the page before this returns, so a second
// panel can open in the same turn; the close event itself comes later.
function closeFromHistory() {
  const p = openPanel;
  if (!p) return;
  p.fromHistory = true;
  openPanel = null;
  closePanel(p.dialog);
  p.dialog.remove();
  restoreFocus(p);
}

function route() {
  const name = hashName();
  if (PANELS.has(name)) {
    if (!qs('#screen-title')) renderScreen();
    // A panel hash arriving while another panel is open closes the first.
    if (openPanel && openPanel.name !== name) closeFromHistory();
    if (!openPanel) show(name, null);
    return;
  }
  closeFromHistory();
  // An unknown hash is replaced, never pushed, so Back never meets a second #title.
  if (!SCREENS.has(name)) history.replaceState(null, '', '#title');
  if (!qs('#screen-title')) renderScreen();
}

window.addEventListener('popstate', route);
route();
