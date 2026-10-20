// What the sending and the receiving dialogs share: the progress line, the
// two lines a code field speaks through, the way to the project file, and a
// code pasted anywhere in the dialog.

import { h } from '../../components/dom.js';
import { buildExport } from '../../../engine/exports.js';
import { looksLikeCode } from './codes.js';
import { partsWords } from './words.js';

export function subtleOf() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  return subtle || null;
}

export function messageOf(error) {
  return error && error.message ? error.message : 'Try again.';
}

// A line for news (role status) and a line for refusals (role alert).
export function lines() {
  const said = h('p', { class: 'xfer__said', role: 'status', data: { line: 'said' } });
  const refused = h('p', { class: 'xfer__refused', role: 'alert', data: { line: 'refused' } });
  return {
    said,
    refused,
    say(text) {
      refused.textContent = '';
      said.textContent = text;
    },
    refuse(text) {
      said.textContent = '';
      refused.textContent = text;
    },
  };
}

// "Sending: 3 of 12 parts", with a <progress>. The dialog carries
// data-parts="3/12" for anyone waiting on it.
export function progressLine(dialog, verb) {
  const bar = h('progress', { class: 'xfer__bar', max: '1', value: '0', 'aria-hidden': 'true' });
  const words = h('p', { class: 'xfer__parts', data: { line: 'parts' } });
  return {
    element: h('div', { class: 'xfer__progress' }, words, bar),
    set(done, total) {
      bar.max = Math.max(1, total);
      bar.value = done;
      words.textContent = verb + ': ' + partsWords(done, total) + '.';
      dialog.element.dataset.parts = done + '/' + total;
    },
  };
}

function download(fileName, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The sending device's other way: the project file, saved from here.
export function exportRow(ctx, say) {
  const button = h('button', { type: 'button', class: 'btn', data: { action: 'transfer-export' } }, 'Export the project file');
  button.addEventListener('click', async () => {
    try {
      const project = ctx.store.project;
      const file = buildExport(project, 'project', { date: ctx.clock(), images: await ctx.storage.imagesForFile(project) });
      download(file.fileName, file.mime, file.text);
      ctx.storage.noteExported();
      say('Saved “' + file.fileName + '” to your downloads. Pass it on, and open it on the other device with Import a project file.');
    } catch (error) {
      say('The project was not exported. ' + messageOf(error));
    }
  });
  return h('div', { class: 'card__buttons' }, button);
}

// The receiving device's other way: the Project file card's import button.
export function importRow(dialog) {
  const button = h('button', { type: 'button', class: 'btn', data: { action: 'transfer-import' } }, 'Go to Import a project file');
  button.addEventListener('click', () => {
    dialog.close();
    const target = document.querySelector('[data-action="import-project"]');
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.focus();
    }
  });
  return h('div', { class: 'card__buttons' }, button);
}

// A code pasted anywhere in the dialog but a text field goes to `take`,
// while `wanted()` says a code is being asked for.
export function pasteAnywhere(dialog, wanted, take) {
  dialog.element.addEventListener('paste', (event) => {
    const target = event.target;
    if (target && (target.closest('textarea, input, [contenteditable]'))) return;
    if (!wanted()) return;
    const text = event.clipboardData ? event.clipboardData.getData('text') : '';
    if (!looksLikeCode(text)) return;
    event.preventDefault();
    take(text.trim());
  });
}
