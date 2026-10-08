// What the schedule's tabs share: running an action and saying a refusal,
// the empty screen with its one button, the mark a finding leaves on a thing,
// names for new things, a download, and rows that move by drag.

import { h, append } from '../components/dom.js';
import { roomName } from '../../engine/findings.js';
import { nameKey } from '../../engine/schema.js';

export const SEVERITY_WORDS = {
  problem: { one: 'problem', many: 'problems', glyph: '●' },
  warning: { one: 'warning', many: 'warnings', glyph: '▲' },
  note: { one: 'note', many: 'notes', glyph: '◆' },
};

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Run an action. A refusal is shown as the sentence the action gave, and the
// answer is false. Fields do not use this: they show a refusal under
// themselves.
export function apply(env, action, payload) {
  try {
    env.ctx.store.apply(action, payload);
    return true;
  } catch (error) {
    env.ctx.toast({ kind: 'problem', text: error && error.message ? error.message : 'That could not be done. Try again.' });
    return false;
  }
}

// Put new children in an element. Unlike replaceChildren, a null is nothing
// and a list is its items.
export function fill(element, ...children) {
  element.replaceChildren();
  return append(element, children);
}

// Give an element the name focus is put back by after the tab is drawn again.
export function keyed(element, key) {
  element.dataset.key = key;
  return element;
}

// button('Add a group', run, { primary, key, action, title })
export function button(label, run, options) {
  const opts = options || {};
  const element = h('button', {
    type: 'button',
    class: 'btn' + (opts.primary ? ' btn--primary' : '') + (opts.quiet ? ' btn--quiet' : '') + (opts.small ? ' sch-btn--small' : ''),
    title: opts.title,
    'aria-label': opts.name,
    data: opts.action ? { action: opts.action } : null,
    on: { click: (event) => run(event.currentTarget) },
  }, label);
  if (opts.key) keyed(element, opts.key);
  return element;
}

// A button for something that is not built yet. It stays reachable by
// keyboard so its reason can be read, and does nothing.
export function notYet(label, reason, action) {
  return h('button', { type: 'button', class: 'btn sch-btn--small', 'aria-disabled': 'true', title: reason, data: action ? { action } : null },
    label, h('span', { class: 'vh' }, ' (' + reason + ')'));
}

// The screen a tab shows when it has nothing: what the thing is, one button.
export function emptyState(text, action) {
  return h('div', { class: 'sch-empty' }, h('p', { class: 'sch-empty__text' }, text), action);
}

// "● 2 problems", with the shape for the eye and the words for everyone.
export function severityMark(severity, n, options) {
  const words = SEVERITY_WORDS[severity];
  const text = n + ' ' + (n === 1 ? words.one : words.many);
  return h('span', { class: 'sch-mark sch-mark--' + severity, title: options && options.short ? text : null, data: { severity } },
    h('span', { 'aria-hidden': 'true' }, words.glyph + ' '),
    options && options.short ? [h('span', { 'aria-hidden': 'true' }, String(n)), h('span', { class: 'vh' }, text)] : text);
}

// The marks for a list of findings: one per severity that has any.
export function marksFor(findings) {
  const counts = { problem: 0, warning: 0, note: 0 };
  for (const finding of findings || []) counts[finding.severity] += 1;
  return Object.keys(counts).filter((severity) => counts[severity] > 0).map((severity) => severityMark(severity, counts[severity], { short: true }));
}

// "New group", then "New group 2", "New group 3": the first one not in use.
export function freeName(names, base) {
  const taken = new Set(names.map(nameKey));
  if (!taken.has(nameKey(base))) return base;
  let n = 2;
  while (taken.has(nameKey(base + ' ' + n))) n += 1;
  return base + ' ' + n;
}

// A room in a list of rooms to pick from: "204 — Ms. Okafor".
export function roomLabel(project, room) {
  const number = room.number.trim() === '' ? roomName(room) : room.number;
  const names = room.teacherIds.map((id) => (project.teachers.find((teacher) => teacher.id === id) || { name: '' }).name).filter((name) => name !== '');
  return names.length > 0 ? number + ' — ' + names.join(', ') : number;
}

export function quote(text) {
  return '“' + text + '”';
}

// Hand a file to the browser to save.
export function download(fileName, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rows that move by drag. A press on a `.sch-grip` inside `body` picks its
// row up; the row under the pointer is marked; letting go calls
// onDrop(from, to) with the two rows' `data-index`. Mouse, finger and pen all
// come through Pointer Events, and the grip sets touch-action: none.
export function dragRows(body, onDrop) {
  let from = null;
  let over = null;

  function rowAt(event) {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const row = hit && hit.closest ? hit.closest('[data-index]') : null;
    return row && row.parentElement === body ? row : null;
  }

  function clear() {
    if (from) from.classList.remove('is-dragging');
    if (over) over.classList.remove('is-drop');
    from = null;
    over = null;
  }

  body.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest ? event.target.closest('.sch-grip') : null;
    if (!grip || !body.contains(grip) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    from = grip.closest('[data-index]');
    if (!from) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    from.classList.add('is-dragging');
  });
  body.addEventListener('pointermove', (event) => {
    if (!from) return;
    const row = rowAt(event);
    if (row === over) return;
    if (over) over.classList.remove('is-drop');
    over = row && row !== from ? row : null;
    if (over) over.classList.add('is-drop');
  });
  body.addEventListener('pointerup', (event) => {
    if (!from) return;
    const row = rowAt(event) || over;
    const a = Number(from.dataset.index);
    const b = row ? Number(row.dataset.index) : a;
    clear();
    if (a !== b) onDrop(a, b);
  });
  body.addEventListener('pointercancel', clear);
}

export function grip() {
  return h('span', { class: 'sch-grip', 'aria-hidden': 'true', title: 'Drag to move' }, '⠿');
}
