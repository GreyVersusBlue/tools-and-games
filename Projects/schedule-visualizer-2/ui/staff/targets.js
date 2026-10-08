// Where a published schedule can go. Today there is one target: a file the
// publisher downloads and passes on. A hosted link would be a second entry
// here, and nothing else in the planner would change.
//
// Every target publishes the same thing, made by publishData(): the published
// model, behind the passcode when the project has one. The lock is the same
// function for all of them.
//
// Nothing here touches the page until a target's deliver() is called, so the
// tests run publishData() and publishDocument() in Node.

import { publishedModel, isProtected } from '../../engine/publish-data.js';
import { lockPublished } from '../../engine/publish-crypto.js';
import { exportFileName } from '../../engine/exports.js';
import { assemble } from './assemble.js';

// publishData(project, { clock, random }) → { model, data, locked }.
// `data` is what readers receive: the model itself when protection is off,
// the locked form when the project has a passcode. `clock` gives the publish
// time and `random` the lock's IV; both are passed in.
export async function publishData(project, options) {
  const opts = options || {};
  const model = publishedModel(project, { clock: opts.clock });
  if (!isProtected(project)) return { model, data: model, locked: false };
  const data = await lockPublished(model, project.publish.passcode, { random: opts.random, salt: opts.salt, iterations: opts.iterations });
  return { model, data, locked: true };
}

// publishDocument(read, project, { clock, random }) → what a file target
// writes: { html, fileName, model, locked }. `read` is the assembler's reader
// (pageReader() in the planner).
export async function publishDocument(read, project, options) {
  const opts = options || {};
  const made = await publishData(project, opts);
  const html = await assemble(read, made.data);
  return { html, fileName: exportFileName(project, 'staff schedule', 'html', opts.clock()), model: made.model, locked: made.locked };
}

// A source of numbers from 0 up to 1 from the device's own randomness, for
// the `random` a real publish passes in.
export function deviceRandom() {
  const one = new Uint32Array(1);
  return () => globalThis.crypto.getRandomValues(one)[0] / 4294967296;
}

export const fileTarget = {
  id: 'file',
  name: 'A file',
  action: 'Publish a file',
  says: 'One file that opens on any phone or computer with no connection. Send it by email or put it on a shared drive.',
  // Hand the document to the browser as a download.
  deliver(published, env) {
    const win = (env && env.win) || globalThis;
    const doc = win.document;
    const blob = new win.Blob([published.html], { type: 'text/html;charset=utf-8' });
    const address = win.URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = address;
    link.download = published.fileName;
    link.hidden = true;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(address), 60000);
    return { fileName: published.fileName, bytes: blob.size };
  },
};

export const TARGETS = [fileTarget];

export function targetFor(id) {
  return TARGETS.find((target) => target.id === id) || null;
}
