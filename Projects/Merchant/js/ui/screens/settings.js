// Settings (DESIGN 4.13): sound, Large text, Reduce motion (on, off, follow the device),
// single-key shortcuts, then Export, Import and Start again for the game in this browser.
import { h } from '../dom.js';
import { mountSaveBar } from '../../../../../assets/js/gvb-save.js';

/** Apply the settings to the page. Reduce motion "on" forces it, "off" forces motion even if
    the device asks for less, "device" leaves the browser's own preference in charge. */
export function applySettings(s) {
  const c = document.documentElement.classList;
  c.toggle('large-text', !!s.largeText);
  c.toggle('reduce-motion', s.reduceMotion === 'on');
  c.toggle('motion-ok', s.reduceMotion === 'off');
}

/** The body of the panel. `app` carries settings, setSetting(key, value), the game slot and
    the state; `onStartAgain(button)` is called by the last button when a game exists. */
export function settingsBody(app, { onStartAgain, onImported }) {
  const s = app.settings;
  const sw = (id, label, note, key) => {
    const input = h('input', { type: 'checkbox', id, checked: !!s[key], onchange: () => app.setSetting(key, input.checked) });
    return h('div', { class: 'switch-row' }, input, h('label', { for: id }, label, h('small', null, note)));
  };
  const motion = (value, label) => h('div', { class: 'switch-row' },
    h('input', { type: 'radio', name: 'reduce-motion', id: `set-motion-${value}`, value, checked: s.reduceMotion === value,
      onchange: () => app.setSetting('reduceMotion', value) }),
    h('label', { for: `set-motion-${value}` }, label));
  const bar = h('div', { id: 'save-bar', class: 'save-bar' });
  const body = [
    sw('set-sound', 'Sound', 'Quiet sounds, off until you press something.', 'sound'),
    sw('set-large', 'Large text', 'Makes all the writing a quarter bigger.', 'largeText'),
    h('fieldset', { class: 'motion' }, h('legend', null, 'Reduce motion'),
      motion('on', 'On: papers appear at once'), motion('off', 'Off: papers slide and turn'), motion('device', 'Follow the device')),
    sw('set-keys', 'Single-key shortcuts', 'The digits, M, L, N and E act on the desk. Turn off if your screen reader uses single keys.', 'shortcuts'),
  ];
  if (app.state) {
    body.push(h('h3', { class: 'save-title' }, 'Your game'), bar,
      h('button', { class: 'button', type: 'button', id: 'btn-start-again', onclick: e => onStartAgain(e.currentTarget) }, 'Start again'));
    queueMicrotask(() => mountSaveBar(bar, app.slots.game, {
      getState: () => app.state,
      setState: st => { onImported(st); return true; },
      buttons: ['export', 'import'],
      filename: () => 'merchant-save.json',
    }));
  }
  return body;
}
