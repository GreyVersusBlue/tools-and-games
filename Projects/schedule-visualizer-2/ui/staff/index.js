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
// set, is handed each published file instead of the download.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { count, figures } from '../components/words.js';
import { inputsFor, pageReader } from './assemble.js';
import { preview } from './preview.js';
import { publishForm } from './form.js';

// How long the page is left alone after it loads before the staff browser's
// files are read in the background.
export const IDLE_READ_MS = 4000;

export const hooks = { deliver: null, published: null };

function facts(project) {
  const f = figures(project);
  const holds = 'It has ' + count(f.teachers, 'teacher') + ', ' + count(f.groups, 'group') + ' and ' + count(f.rooms, 'room') + ' to show.';
  return project.publish.lastPublishedAt ? 'A file has been published from this project. ' + holds : 'Nothing has been published from this project yet. ' + holds;
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

    function update(project) {
      lead.textContent = facts(project);
      shown.update(project);
      form.update(project);
    }
    lead.textContent = facts(ctx.store.project);

    return {
      element,
      update,
      unmount() {
        shown.stop();
        form.stop();
      },
    };
  },
};
