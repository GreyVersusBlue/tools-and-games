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
// here: no module of the page sets them, and none can reach them, since the
// object is this module's own and is not exported.

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
// does not and which a page cannot turn on for itself. Anywhere else nothing
// on the page leads to them (SV2-58 item 1).
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
// { unnoted: 'read-only' | 'refused', of, until }: `of` is the project on
// screen when the file was made, null once the project has changed since,
// and `until` the time "just now" ends. A file the project notes takes its
// project's entry away. The tab's life is the entry's: a reload starts from
// what the project records.
const unnotedFiles = new Map();

function unnotedOf(project) {
  return unnotedFiles.get(project.id) || null;
}

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
  start() {
    const later = () => setTimeout(readInputs, IDLE_READ_MS);
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later, { once: true });
  },
  mount(ctx) {
    const shown = preview(ctx);
    const form = publishForm(ctx, hooks);
    const lead = h('p', { class: 'intro__facts stf-facts' });
    const element = h('div', { class: 'stf' },
      intro({
        headline: 'This is the staff browser.',
        first: 'It is what your staff see: one file they open on a phone to look up a teacher, a room or a group. Below is that file, live.',
      }),
      lead,
      shown.element);
    element.staff = viewHandle({ preview: shown, form }, hooks, automated());
    ctx.setInspector(form.element, { title: 'Publish' });

    // A file this tab made and the project did not note stays made: when
    // "just now" stops being so, the line says "earlier", never "no file
    // yet", and leaving the section does not forget it. It goes when a later
    // file is noted.
    let timer = null;
    const line = (project) => {
      const entry = unnotedOf(project);
      lead.textContent = facts(project, entry ? entry.unnoted : null, entry ? justNowOf(entry, project) : true);
    };
    // the line again when "just now" runs out for the project on screen
    const watch = (project) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const entry = unnotedOf(project);
      if (!justNowOf(entry, project)) return;
      timer = setTimeout(() => {
        timer = null;
        entry.of = null;
        line(ctx.store.project);
      }, Math.max(0, entry.until - Date.now()));
    };
    hooks.made = (published, recorded) => {
      const id = published && published.model && typeof published.model.id === 'string' ? published.model.id : ctx.store.project.id;
      if (recorded === true) unnotedFiles.delete(id);
      else unnotedFiles.set(id, { unnoted: recorded === READ_ONLY_MADE ? 'read-only' : 'refused', of: ctx.store.project, until: Date.now() + UNNOTED_TIMES.ms });
      watch(ctx.store.project);
      line(ctx.store.project);
    };

    function update(project) {
      // the next change of the project: the file was made before it, not just now
      const entry = unnotedOf(project);
      if (entry !== null && entry.of !== null && entry.of !== project) entry.of = null;
      watch(project);
      line(project);
      shown.update(project);
      form.update(project);
    }
    watch(ctx.store.project);
    line(ctx.store.project);

    return {
      element,
      update,
      unmount() {
        hooks.made = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        shown.stop();
        form.stop();
      },
    };
  },
};
