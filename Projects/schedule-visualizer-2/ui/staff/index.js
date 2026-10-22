// The Staff browser section (DESIGN 5.6, spec 12.5 and 12.4).
//
//   surface    the live preview: the staff browser itself in a frame the size
//              of a phone, with a switch to a desktop width (./preview.js)
//   inspector  the publish form, "Publish a file", and under it batch
//              printing (./form.js)
//
// There is one staff browser. The preview is the published file with no data
// in it, fed the project by message, so a file can never differ from what was
// previewed (ARCHITECTURE 8). The files it is made from are the tool's own,
// read once: when this section first opens, or a few seconds after the page
// has loaded and gone quiet, whichever comes first, so that a file can still
// be published once the connection has gone.
//
// The view on screen is at document.querySelector('.stf').staff, for the
// tests and for the console: { preview, form }, and `hooks` as well in a
// browser a test drives (viewHandle). `hooks.deliver`, when set, is handed
// each published file instead of the download; `hooks.assembled`, when set,
// is awaited before it is handed over. Both are the tests' and are null
// here: no module of the page sets them. The object is this module's own,
// not exported, and handed only to the form (./form.js), so a reader's
// ordinary page has no path to it. That keeps it out of the way; it is not a
// lock against code that sets out to reach it (SV2-58b).

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { count, figures } from '../components/words.js';
import { printDate } from '../prints/document.js';
import { inputsFor, pageReader } from './assemble.js';
import { preview } from './preview.js';
import { publishForm, READ_ONLY_MADE } from './form.js';

// How long the page is left alone after it loads before the staff browser's
// files are read in the background.
export const IDLE_READ_MS = 4000;

const hooks = { deliver: null, assembled: null, published: null, made: null };

// What the view puts on its element. The hooks go with it only in a browser
// a test drives: Puppeteer and Playwright start Chromium for automation, and
// such a browser says so in navigator.webdriver, which a reader's browser
// leaves false. In a reader's browser, then, the view on the page does not
// lead to them (SV2-58 item 1). The flag is a gate, not a guard: script on
// the page can redefine Navigator.prototype.webdriver before this module
// runs (the browser case in test/browser/publish.mjs does just that, the
// other way), so it keeps the hooks out of an ordinary page and no more.
export function viewHandle(parts, testHooks, automated) {
  return automated === true ? { ...parts, hooks: testHooks } : { ...parts };
}

const automated = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

// How long "This tab made a file just now" stands when the project did not
// note the file: on the next change of the project, or after this long,
// whichever comes first, it says "earlier" instead. An object, so a test can
// shorten it.
export const UNNOTED_TIMES = { ms: 5 * 60 * 1000 };

// The files this tab made that their project did not note, by the project's
// id, which survives export and import and is never another project's
// (ARCHITECTURE 4). The section's view is made anew each time it is opened,
// so what it knew went with it: left and opened again, the line said "No
// file has been made from this project yet" (SV2-58 item 4). Each entry is
// { unnoted: 'read-only' | 'refused', at, of, until }: `at` is when the file
// was made (ms), `of` the project on screen then, null once the project has
// changed since, and `until` the time "just now" ends. A file the project
// notes takes its project's entry away. The tab's life is the longest an
// entry lives (a reload starts from what the project records), and it yields
// sooner to anything that makes its line false (SV2-58b):
//   - a read-only entry, when the tab is no longer read-only: the line says
//     the project does not record the file "while the tab is read-only";
//   - any entry, when the project records a file made after it (another
//     tab's, taken up when this one becomes the editor): the line about
//     the last file is the project's own;
//   - any entry, when a project with its id is loaded (replaceProject, or
//     the store's replace) over one with another id: the sample school's id
//     is fixed, so the sample removed and loaded again is the same id and a
//     new project. Undo and redo across a load keep the entry: they bring
//     back the project it was made beside.
const unnotedFiles = new Map();

// Whether `entry` is still true of `project` in a tab that is `readOnly`.
export function unnotedStands(entry, project, readOnly) {
  if (!entry) return false;
  if (entry.unnoted === 'read-only' && readOnly !== true) return false;
  const last = project.publish.lastPublishedAt ? Date.parse(project.publish.lastPublishedAt) : NaN;
  return !(last > entry.at);
}

// The entry for the project on screen, or null; an entry that no longer
// stands is dropped here.
export function unnotedOf(project, readOnly) {
  const entry = unnotedFiles.get(project.id) || null;
  if (entry === null || unnotedStands(entry, project, readOnly)) return entry;
  unnotedFiles.delete(project.id);
  return null;
}

// A file was made from `project` (or the project with `id`): `recorded` is
// true when the project noted it, or the sentence saying why not (form.js).
export function fileMade(id, recorded, project, at) {
  if (recorded === true) {
    unnotedFiles.delete(id);
    return null;
  }
  const made = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : Date.now();
  const entry = { unnoted: recorded === READ_ONLY_MADE ? 'read-only' : 'refused', at: made, of: project, until: Date.now() + UNNOTED_TIMES.ms };
  unnotedFiles.set(id, entry);
  return entry;
}

// Each store and each session is followed once, for the tab's life, whether
// or not the section is open: a load, or the tab becoming the editor, can
// happen anywhere. `redraw` is the open view's line, or null.
const followed = new WeakSet();
let redraw = null;
export function followTab(store, storage) {
  if (store && !followed.has(store)) {
    followed.add(store);
    let seen = store.project;
    store.subscribe((project, change) => {
      const before = seen;
      seen = project;
      const loaded = change && (change.kind === 'replace' || change.kind === 'apply') && before && project.id !== before.id;
      if (loaded && unnotedFiles.delete(project.id) && redraw !== null) redraw();
    });
  }
  if (storage && typeof storage.subscribe === 'function' && !followed.has(storage)) {
    followed.add(storage);
    storage.subscribe((state) => {
      if (state && state.readOnly) return;
      let dropped = false;
      for (const [id, entry] of unnotedFiles) {
        if (entry.unnoted === 'read-only') dropped = unnotedFiles.delete(id) || dropped;
      }
      if (dropped && redraw !== null) redraw();
    });
  }
}

export const NOTHING_TO_SHOW = 'There is nothing in the file yet: it shows your staff the building and the schedule you enter in the planner. Draw the building first, then add teachers and groups.';

const readOnlyOf = (ctx) => Boolean(ctx.storage && ctx.storage.state && ctx.storage.state.readOnly);

// "just now": `project`, the one on screen, is the project the file was made
// beside (it has not changed since, here or while the section was away), and
// the set time has not run out
function justNowOf(entry, project) {
  return entry !== null && entry.of === project && Date.now() < entry.until;
}

// `unnoted`: this tab made a file the project did not note, so "no file
// yet" would be false on this screen. 'read-only' when the tab is read-only
// and so was never asked to; 'refused' when the project was asked and could
// not record it; null when the last file was noted. `justNow` false once the
// file is no longer just now: the tab still made it, earlier.
export function facts(project, unnoted, justNow = true) {
  const f = figures(project);
  const holds = 'It has ' + count(f.teachers, 'teacher') + ', ' + count(f.groups, 'group') + ' and ' + count(f.rooms, 'room') + ' to show.';
  const last = project.publish.lastPublishedAt ? printDate(project.publish.lastPublishedAt) : '';
  const made = justNow ? 'This tab made a file just now. ' : 'This tab made a file earlier. ';
  if (unnoted === 'read-only') return made + 'The project does not record it while the tab is read-only. ' + holds;
  if (unnoted === 'refused') return made + 'The project could not record it. ' + holds;
  if (last === '') return 'No file has been made from this project yet. ' + holds;
  return 'The last file from this project was made on ' + last + '. ' + holds;
}

// Read the staff browser's files now. They are kept (assemble.js), so this is
// one round of requests for the page's life; a failure is tried again the
// next time anything asks.
function readInputs() {
  return inputsFor(pageReader()).then(() => true, () => false);
}

export const section = {
  id: 'staff',
  label: 'Staff',
  name: 'Staff browser',
  key: '6',
  icon: 'staff',
  start(ctx) {
    followTab(ctx && ctx.store, ctx && ctx.storage);
    const later = () => setTimeout(readInputs, IDLE_READ_MS);
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later, { once: true });
  },
  mount(ctx) {
    const shown = preview(ctx);
    const form = publishForm(ctx, hooks);
    const lead = h('p', { class: 'intro__facts stf-facts' });
    // A project with no teacher, group or room makes a file with nothing in
    // it: the section says so and where to begin, over the empty preview.
    const empty = h('div', { class: 'stf-empty', hidden: true, data: { empty: 'staff' } },
      h('p', { class: 'stf-empty__text' }, NOTHING_TO_SHOW),
      h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'to-building' }, on: { click: () => ctx.navigate('#building') } }, 'Go to the building'));
    const element = h('div', { class: 'stf' },
      intro({
        headline: 'This is the staff browser.',
        first: 'It is what your staff see: one file they open on a phone to look up a teacher, a room or a group. Below is that file, live.',
      }),
      lead,
      empty,
      shown.element);
    element.staff = viewHandle({ preview: shown, form }, hooks, automated());
    ctx.setInspector(form.element, { title: 'Publish' });

    // A file this tab made and the project did not note stays made: when
    // "just now" stops being so, the line says "earlier", never "no file
    // yet", and leaving the section does not forget it. It goes when a later
    // file is noted, or when the line would no longer be true (above).
    followTab(ctx.store, ctx.storage);
    let timer = null;
    const line = (project) => {
      const entry = unnotedOf(project, readOnlyOf(ctx));
      lead.textContent = facts(project, entry ? entry.unnoted : null, entry ? justNowOf(entry, project) : true);
      const f = figures(project);
      empty.hidden = f.teachers + f.groups + f.rooms > 0;
    };
    // the line again when "just now" runs out for the project on screen
    const watch = (project) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const entry = unnotedOf(project, readOnlyOf(ctx));
      if (!justNowOf(entry, project)) return;
      timer = setTimeout(() => {
        timer = null;
        entry.of = null;
        line(ctx.store.project);
      }, Math.max(0, entry.until - Date.now()));
    };
    const drawn = () => {
      watch(ctx.store.project);
      line(ctx.store.project);
    };
    redraw = drawn;
    hooks.made = (published, recorded) => {
      const model = published && published.model;
      const id = model && typeof model.id === 'string' ? model.id : ctx.store.project.id;
      fileMade(id, recorded, ctx.store.project, model ? model.publishedAt : undefined);
      drawn();
    };

    function update(project) {
      // the next change of the project: the file was made before it, not just now
      const entry = unnotedOf(project, readOnlyOf(ctx));
      if (entry !== null && entry.of !== null && entry.of !== project) entry.of = null;
      watch(project);
      line(project);
      shown.update(project);
      form.update(project);
    }
    drawn();

    return {
      element,
      update,
      unmount() {
        hooks.made = null;
        if (redraw === drawn) redraw = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        shown.stop();
        form.stop();
      },
    };
  },
};
