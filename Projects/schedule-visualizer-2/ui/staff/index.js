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
// tests and for the console: { preview, form, hooks }. `hooks.deliver`, when
// set, is handed each published file instead of the download;
// `hooks.assembled`, when set, is awaited before it is handed over. Both are
// the tests' and are null here: no module of the page sets them.

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

export const hooks = { deliver: null, assembled: null, published: null, made: null };

// `unnoted`: this tab made a file the project did not note, so "no file
// yet" would be false on this screen. 'read-only' when the tab is read-only
// and so was never asked to; 'refused' when the project was asked and could
// not record it; null when the last file was noted.
export function facts(project, unnoted) {
  const f = figures(project);
  const holds = 'It has ' + count(f.teachers, 'teacher') + ', ' + count(f.groups, 'group') + ' and ' + count(f.rooms, 'room') + ' to show.';
  const last = project.publish.lastPublishedAt ? printDate(project.publish.lastPublishedAt) : '';
  if (unnoted === 'read-only') return 'This tab made a file just now. The project does not record it while the tab is read-only. ' + holds;
  if (unnoted === 'refused') return 'This tab made a file just now. The project could not record it. ' + holds;
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
    element.staff = { preview: shown, form, hooks };
    ctx.setInspector(form.element, { title: 'Publish' });

    let unnoted = null;
    hooks.made = (published, noted) => {
      unnoted = noted === true ? null : noted === READ_ONLY_MADE ? 'read-only' : 'refused';
      lead.textContent = facts(ctx.store.project, unnoted);
    };

    function update(project) {
      lead.textContent = facts(project, unnoted);
      shown.update(project);
      form.update(project);
    }
    lead.textContent = facts(ctx.store.project, unnoted);

    return {
      element,
      update,
      unmount() {
        hooks.made = null;
        shown.stop();
        form.stop();
      },
    };
  },
};
