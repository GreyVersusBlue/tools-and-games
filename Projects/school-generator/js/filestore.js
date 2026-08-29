// filestore.js — the difference between a document and a download.
//
// Phase 30's third item. Until now the tool has saved in three places, none of
// which is a file: an autosave in localStorage, thirty named slots beside it,
// and a `downloadSave` that drops `school.json` in whatever folder the browser
// drops things in and forgets it ever existed. Open that file again and you
// have *loaded* it; save again and you get `school (1).json`. That is a
// website's relationship with your work, and this tool is not a website — it
// is a program that happens to be delivered over one.
//
// The File System Access API closes the gap: a handle, kept for the session,
// that `Save` writes back to. Ctrl+S overwrites the file you opened. Ctrl+Shift+S
// asks where. Ctrl+O opens one. The autosave stops being the place your work
// lives and goes back to being what it always should have been — the safety
// net under the file.
//
// Where the API is missing (and it is missing on a whole engine family), every
// verb still works and one of them degrades: `Save` becomes the download it
// always was, `Open` becomes the file input it always was, and the session
// says which of the two it is doing rather than pretending. `mode` is the one
// word for that, and the shell asks for it once.
//
// What is *in* this module is every decision: what a session is, when it is
// dirty, what the title bar says, what to call the file, what the picker
// should ask for, and which errors are worth a sentence (an abort is not — the
// person pressed Escape, and a tool that scolds them for it is a tool with
// opinions about its own dialogs). What is not in it is a single call to
// `showSaveFilePicker`: the handle lives in main.js, because a handle is a
// live browser object and this module has no live anything.
//
// Pure module: no DOM, no File System Access, no `window`. Exercised by
// test/filestore.test.mjs.

// The extension. `.school` rather than `.json` because that is what the thing
// is — and the picker accepts `.json` too, since every file anybody has saved
// out of this tool so far is one.
export const FILE_EXT = '.school';
export const OPEN_EXTS = [FILE_EXT, '.json'];
export const MIME = 'application/json';
export const DEFAULT_NAME = `school${FILE_EXT}`;

// ---------- which of the two worlds we are in ----------

// `direct` where the browser can hand back a writable handle; `download`
// everywhere else. Read off an environment record so a suite can be in either
// world without a browser in it.
export function fileMode(env = {}) {
  const w = env.window || (typeof window === 'undefined' ? null : window);
  const has = !!(w && typeof w.showSaveFilePicker === 'function'
    && typeof w.showOpenFilePicker === 'function');
  return has ? 'direct' : 'download';
}

export const modeNote = (mode) => (mode === 'direct'
  ? 'Save writes back to the file you opened. Save As picks a new one.'
  : 'This browser cannot write files in place, so Save downloads and Open reads from a file you choose.');

// ---------- the session ----------
//
// One document, for as long as the tab is open. `handle` is opaque here — the
// shell puts a FileSystemFileHandle in it and this module only ever asks
// whether there is one.

export const SOURCES = ['new', 'file', 'link', 'card', 'store', 'autosave'];

export function makeFileSession(source = 'new') {
  return {
    name: null,
    handle: null,
    source: SOURCES.includes(source) ? source : 'new',
    dirty: false,
    savedAt: 0,
  };
}

// A design arrived from somewhere. A file gives its name and (where the API
// exists) its handle; a link, a card or the autosave give neither — which is
// exactly why `Save` on one of those has to ask where, and `hasFile` says so.
export function noteOpened(sess, { name = null, handle = null, source = 'file' } = {}) {
  return {
    ...makeFileSession(source),
    name: name ? ensureExt(name) : null,
    handle: handle || null,
  };
}

export function noteSaved(sess, { name = null, handle = undefined, at = Date.now() } = {}) {
  const s = sess || makeFileSession();
  return {
    ...s,
    source: 'file',
    name: name ? ensureExt(name) : s.name,
    handle: handle === undefined ? s.handle : handle,
    dirty: false,
    savedAt: at,
  };
}

// Every edit, and the cheapest call in the module — it runs on each undoable
// change, so it returns the session it was given when nothing would change.
export function noteEdited(sess) {
  const s = sess || makeFileSession();
  return s.dirty ? s : { ...s, dirty: true };
}

export const hasFile = (sess) => !!(sess && sess.handle);

// ---------- what it is called ----------

// Anything a person or a file system can produce, made into a filename that
// will not lose a path separator argument with a save dialog. Deliberately
// conservative: the reserved set plus control characters, collapsed rather
// than deleted so `a/b` reads as `a-b` and not as `ab`.
export function sanitizeName(raw) {
  const text = String(raw == null ? '' : raw)
    // Control characters and the set every file system reserves — escaped
    // rather than typed, because a literal NUL in a source file is a bug
    // waiting to be pasted somewhere less forgiving than a regex.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 80);
  return text || 'school';
}

// `.school` unless it already ends in something this tool wrote.
export function ensureExt(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return DEFAULT_NAME;
  const lower = text.toLowerCase();
  for (const ext of OPEN_EXTS) {
    if (lower.endsWith(ext)) return `${sanitizeName(text.slice(0, -ext.length))}${ext}`;
  }
  return `${sanitizeName(text)}${FILE_EXT}`;
}

// What a Save As dialog should arrive holding: the file's own name if it has
// one, then the design's own name if anything has named it, then the default.
export function suggestName(sess, designName = '') {
  if (sess && sess.name) return ensureExt(sess.name);
  if (designName) return ensureExt(designName);
  return DEFAULT_NAME;
}

// The picker's options, as the API wants them. Here rather than at the call
// site so the two pickers cannot drift apart about what a `.school` file is.
export const savePickerOptions = (name) => ({
  suggestedName: ensureExt(name),
  types: [{
    description: 'School design',
    accept: { [MIME]: [...OPEN_EXTS] },
  }],
});

export const openPickerOptions = () => ({
  multiple: false,
  types: [{
    description: 'School design',
    accept: { [MIME]: [...OPEN_EXTS] },
  }],
});

// ---------- what the chrome says ----------

// The document title. A dot rather than an asterisk before the name: it is
// what every editor with a title bar has used for thirty years, and it
// survives a truncated tab better than a trailing mark.
export function docTitle(sess) {
  const s = sess || makeFileSession();
  const name = s.name || 'Untitled';
  return `${s.dirty ? '• ' : ''}${name} — School Generator`;
}

// The one sentence under the Save button, in every state it has.
export function saveHint(sess, mode = 'download') {
  const s = sess || makeFileSession();
  if (mode !== 'direct') {
    return s.dirty || !s.savedAt
      ? 'Save downloads a copy — this browser cannot write files in place.'
      : 'Downloaded. The autosave keeps the working copy.';
  }
  if (!hasFile(s)) return 'Save will ask where to put it — after that it writes straight back.';
  if (s.dirty) return `Unsaved changes to ${s.name}.`;
  return `Saved to ${s.name}.`;
}

// Whether closing the tab should ask. Only ever true when there is a file with
// unsaved edits: the autosave has always covered the rest, and a tool that
// asks "are you sure" over work it has already kept is a tool crying wolf.
export const shouldWarnOnClose = (sess, mode = 'download') =>
  mode === 'direct' && hasFile(sess) && !!sess.dirty;

// ---------- when it goes wrong ----------

// A cancelled picker is not an error, and the empty string is how this module
// says "say nothing". Everything else gets a sentence naming the thing that
// failed rather than the exception that carried it.
export function fileErrorText(err, verb = 'save') {
  const name = err && err.name ? String(err.name) : '';
  if (name === 'AbortError') return '';
  if (name === 'NotAllowedError') {
    return `The browser would not let the tool ${verb} that file — the permission was refused.`;
  }
  if (name === 'NotFoundError') {
    return 'That file is no longer where it was — use Save As to put it somewhere new.';
  }
  if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') {
    return 'That file is open somewhere else, or is read-only.';
  }
  const message = err && err.message ? String(err.message) : 'something went wrong';
  return `Could not ${verb} the file: ${message}`;
}

// The autosave's job description, now that it has been demoted to it. Printed
// where somebody might otherwise wonder what happened to it.
export const AUTOSAVE_NOTE =
  'The autosave is the safety net, not the filing cabinet: it holds the last '
  + 'few seconds of work in this browser and nothing else. The file is where the design lives.';
