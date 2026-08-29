// The difference between a document and a download. Run `node --test` from
// Projects/school-generator.
//
// The properties worth holding are the ones whose failure costs somebody their
// afternoon: a session knows whether it has a file, an edit makes it dirty and
// a save makes it clean, the name a picker is handed is always a legal one
// with the right extension, a cancelled dialog is silent, and the tab only
// argues about closing when there is genuinely something a close would lose.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILE_EXT, OPEN_EXTS, MIME, DEFAULT_NAME, SOURCES, AUTOSAVE_NOTE,
  fileMode, modeNote, makeFileSession, noteOpened, noteSaved, noteEdited,
  hasFile, sanitizeName, ensureExt, suggestName,
  savePickerOptions, openPickerOptions, docTitle, saveHint,
  shouldWarnOnClose, fileErrorText,
} from '../js/filestore.js';

const DIRECT = { window: { showSaveFilePicker() {}, showOpenFilePicker() {} } };
const PLAIN = { window: {} };

// ---------- which world ----------

test('the mode is read off the browser, and says which of the two it is', () => {
  assert.equal(fileMode(DIRECT), 'direct');
  assert.equal(fileMode(PLAIN), 'download');
  assert.equal(fileMode({ window: { showSaveFilePicker() {} } }), 'download',
    'half the API is not the API — Open matters as much as Save');
  assert.notEqual(modeNote('direct'), modeNote('download'));
  assert.match(modeNote('download'), /cannot write files in place/);
});

// ---------- the session ----------

test('a new session has no file, and knows it', () => {
  const s = makeFileSession();
  assert.equal(s.name, null);
  assert.equal(s.handle, null);
  assert.equal(s.source, 'new');
  assert.equal(s.dirty, false);
  assert.ok(!hasFile(s));
  assert.ok(SOURCES.includes(s.source));
  assert.equal(makeFileSession('nonsense').source, 'new');
  assert.equal(makeFileSession('card').source, 'card');
});

test('opening, editing and saving move the one flag that matters', () => {
  const handle = { name: 'made up' };
  let s = noteOpened(makeFileSession(), { name: 'Hillcrest', handle });
  assert.equal(s.name, `Hillcrest${FILE_EXT}`);
  assert.ok(hasFile(s));
  assert.equal(s.dirty, false);

  s = noteEdited(s);
  assert.equal(s.dirty, true);
  // The cheapest call in the module runs on every undoable change, so a
  // second edit is not a second object.
  assert.equal(noteEdited(s), s);

  s = noteSaved(s, { at: 1234 });
  assert.equal(s.dirty, false);
  assert.equal(s.savedAt, 1234);
  assert.equal(s.name, `Hillcrest${FILE_EXT}`, 'a save with no new name keeps the old one');
  assert.equal(s.handle, handle, 'a save with no new handle keeps the old one');

  const moved = noteSaved(s, { name: 'Elsewhere', handle: null });
  assert.equal(moved.name, `Elsewhere${FILE_EXT}`);
  assert.equal(moved.handle, null, 'Save As into a download world clears the handle');
});

test('a design out of a link or a card has no file behind it', () => {
  // Which is the whole reason `Save` on one of them has to ask where: there is
  // nothing to write back to, and silently inventing a file is how somebody
  // loses the school they were sent.
  for (const source of ['link', 'card', 'autosave']) {
    const s = noteOpened(makeFileSession(), { source });
    assert.equal(s.source, source);
    assert.ok(!hasFile(s));
    assert.equal(s.name, null);
    assert.match(saveHint(s, 'direct'), /ask where/);
  }
  // Everything survives being handed nothing at all.
  assert.equal(noteOpened(null).source, 'file');
  assert.equal(noteEdited(null).dirty, true);
  assert.equal(noteSaved(null).dirty, false);
});

// ---------- what it is called ----------

test('a filename survives anything a person can type into one', () => {
  assert.equal(sanitizeName('Room 101'), 'Room 101', 'the reserved set is not a range — digits stay');
  assert.equal(sanitizeName('a/b'), 'a-b');
  assert.equal(sanitizeName('north:wing?'), 'north-wing');
  assert.equal(sanitizeName('  ...  '), 'school');
  assert.equal(sanitizeName(''), 'school');
  assert.equal(sanitizeName(null), 'school');
  assert.ok(sanitizeName('x'.repeat(400)).length <= 80);
  for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    assert.ok(!sanitizeName(`a${ch}b`).includes(ch), `${ch} survived`);
  }
});

test('every name that leaves this module ends in an extension the tool reads', () => {
  assert.equal(ensureExt('Hillcrest'), `Hillcrest${FILE_EXT}`);
  assert.equal(ensureExt(`Hillcrest${FILE_EXT}`), `Hillcrest${FILE_EXT}`);
  // A `.json` from before this phase is left as one — it is a file that
  // already exists on somebody's disk, and renaming it on save is how a Save
  // becomes a Save As nobody asked for.
  assert.equal(ensureExt('school.json'), 'school.json');
  assert.equal(ensureExt(''), DEFAULT_NAME);
  assert.equal(ensureExt('  '), DEFAULT_NAME);
  assert.equal(ensureExt('a/b.school'), `a-b${FILE_EXT}`);
  for (const ext of OPEN_EXTS) assert.ok(ensureExt(`x${ext}`).endsWith(ext));
});

test('the dialog arrives holding the best name anybody has for the design', () => {
  assert.equal(suggestName(null), DEFAULT_NAME);
  assert.equal(suggestName(makeFileSession(), 'Larkspur School'), `Larkspur School${FILE_EXT}`);
  const opened = noteOpened(makeFileSession(), { name: 'Hillcrest.school' });
  assert.equal(suggestName(opened, 'Larkspur School'), `Hillcrest${FILE_EXT}`,
    'the file’s own name beats a name derived from the design');
});

test('both pickers agree about what a .school file is', () => {
  const save = savePickerOptions('Hillcrest');
  const open = openPickerOptions();
  assert.equal(save.suggestedName, `Hillcrest${FILE_EXT}`);
  assert.deepEqual(save.types[0].accept, open.types[0].accept);
  assert.deepEqual(save.types[0].accept[MIME], OPEN_EXTS);
  assert.equal(open.multiple, false);
  // The arrays are copies: an API that mutated what it was handed would
  // otherwise poison every later picker in the session.
  save.types[0].accept[MIME].push('.exe');
  assert.deepEqual(openPickerOptions().types[0].accept[MIME], OPEN_EXTS);
});

// ---------- what the chrome says ----------

test('the title bar names the file and marks the unsaved one', () => {
  assert.equal(docTitle(null), 'Untitled — School Generator');
  const s = noteOpened(makeFileSession(), { name: 'Hillcrest' });
  assert.equal(docTitle(s), 'Hillcrest.school — School Generator');
  assert.equal(docTitle(noteEdited(s)), '• Hillcrest.school — School Generator');
});

test('the hint under Save says something different in each state it has', () => {
  const fresh = makeFileSession();
  const open = noteOpened(fresh, { name: 'Hillcrest', handle: {} });
  const said = new Set([
    saveHint(fresh, 'direct'),
    saveHint(open, 'direct'),
    saveHint(noteEdited(open), 'direct'),
    saveHint(fresh, 'download'),
    saveHint(noteSaved(fresh, { at: 1 }), 'download'),
  ]);
  assert.equal(said.size, 5, 'two states share a sentence');
  assert.match(saveHint(open, 'direct'), /Saved to Hillcrest\.school/);
  assert.match(saveHint(noteEdited(open), 'direct'), /Unsaved changes/);
});

test('the tab only argues about closing when a close would actually lose something', () => {
  const open = noteOpened(makeFileSession(), { name: 'Hillcrest', handle: {} });
  assert.ok(shouldWarnOnClose(noteEdited(open), 'direct'));
  assert.ok(!shouldWarnOnClose(open, 'direct'), 'nothing unsaved, nothing to ask about');
  // No handle means the autosave is the only copy, and the autosave has
  // covered that case since v1 — asking would be crying wolf.
  assert.ok(!shouldWarnOnClose(noteEdited(makeFileSession()), 'direct'));
  assert.ok(!shouldWarnOnClose(noteEdited(open), 'download'));
});

// ---------- when it goes wrong ----------

test('a cancelled dialog says nothing at all', () => {
  assert.equal(fileErrorText({ name: 'AbortError' }), '');
  assert.equal(fileErrorText({ name: 'AbortError' }, 'open'), '');
});

test('every other failure gets a sentence about the file, not about the exception', () => {
  const seen = new Set();
  for (const name of ['NotAllowedError', 'NotFoundError', 'NoModificationAllowedError', 'TypeError']) {
    const text = fileErrorText({ name, message: 'raw' }, 'save');
    assert.ok(text.length > 10, `${name} produced nothing`);
    seen.add(text);
  }
  assert.equal(seen.size, 4);
  assert.match(fileErrorText({ name: 'NotAllowedError' }, 'open'), /open that file/);
  assert.match(fileErrorText(null, 'save'), /Could not save/);
  assert.ok(AUTOSAVE_NOTE.includes('safety net'));
});
