// The live preview (DESIGN 5.6, ARCHITECTURE 8): the staff browser in a frame
// the size of a phone, with a switch to a desktop width.
//
// The frame's page is the published artifact itself: assemble() joins the
// staff browser's own files into one document, exactly as "Publish a file"
// does, with no data in it; the frame loads it from a blob address and is fed
// the data by message (feedPreview). So what the frame shows is what the file
// will show, linker and all.
//
// What it is fed is the published model as it is behind the passcode: staff
// see this once they have unlocked the file. "Start at the passcode screen"
// feeds the locked form instead, so the unlock screen can be looked at and
// tried. (The staff browser keeps the key a passcode made, per school, so on
// this device it asks once, as it will on a reader's.)
//
//   const view = preview(ctx);
//   view.element                the bar and the frame
//   view.update(project)        the project changed: feed the frame again, soon
//   view.stop()                 the section is leaving
//   view.state                  { loaded, live, sent, width, locked }, for the tests
//
// The frame is told again 250 ms after the last change, and only when
// something the published file holds has changed.

import { h, uid } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { publishedModel, isProtected } from '../../engine/publish-data.js';
import { assemble, pageReader, feedPreview } from './assemble.js';
import { publishData, deviceRandom } from './targets.js';

export const PREVIEW_SIZES = {
  phone: { label: 'Phone', width: 390, height: 760 },
  desktop: { label: 'Desktop', width: 1180, height: 760 },
};
export const PREVIEW_WAIT_MS = 250;

// The parts of a project a published file is made from. The store shares
// every branch a change did not touch, so "the same parts" is "nothing a
// reader would see has changed".
function partsOf(project, locked) {
  const publish = project.publish || {};
  return [project.id, project.settings, project.building, project.subjects, project.teachers, project.dayTypes, project.groups,
    publish.views, publish.teacherNamesOnMap, publish.stalenessDays, locked ? publish.passcode : null, locked];
}

function sameParts(a, b) {
  return a !== null && a.length === b.length && a.every((part, at) => part === b[at]);
}

export function preview(ctx) {
  const state = { loaded: false, live: false, sent: 0, width: 'phone', locked: false };
  let data = null;
  let shown = null;
  let timer = null;
  let turn = 0;
  let address = null;
  let stopped = false;

  const sizeLabel = uid('staff-size');
  const lockId = uid('staff-lock');
  const says = h('p', { class: 'stf-bar__says', role: 'status', data: { says: 'preview' } }, 'Putting the preview together.');
  const frame = h('iframe', { class: 'stf-frame', title: 'Preview of the staff browser' });
  const fit = h('div', { class: 'stf-fit' }, frame);
  const stage = h('div', { class: 'stf-stage', data: { width: 'phone' } }, fit);
  const again = h('button', { type: 'button', class: 'btn', hidden: true, data: { action: 'preview-again' } }, 'Try again');

  const size = choice({
    name: uid('staff-width'),
    labelledBy: sizeLabel,
    options: Object.entries(PREVIEW_SIZES).map(([value, each]) => ({ value, label: each.label })),
    value: state.width,
    onChange: (value) => {
      state.width = value;
      place();
    },
  });
  const lockBox = h('input', { type: 'checkbox', class: 'stf-check__box', id: lockId, name: 'previewLocked' });
  const lock = h('label', { class: 'stf-check', for: lockId }, lockBox, h('span', null, 'Start at the passcode screen'));

  const element = h('div', { class: 'stf-preview', data: { preview: 'loading', sent: '0' } },
    h('div', { class: 'stf-bar' },
      h('div', { class: 'stf-bar__control' }, h('span', { class: 'stf-bar__label', id: sizeLabel }, 'Preview as'), size.element),
      lock),
    h('div', { class: 'stf-bar__line' }, says, again),
    stage);

  // The frame is its true size and is scaled down, never up, to the room
  // there is: a desktop width in a narrow window, a phone on a narrower one.
  function place() {
    const box = PREVIEW_SIZES[state.width];
    const room = stage.clientWidth;
    const scale = room > 0 ? Math.min(1, room / box.width) : 1;
    stage.dataset.width = state.width;
    frame.style.width = box.width + 'px';
    frame.style.height = box.height + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    fit.style.width = Math.floor(box.width * scale) + 'px';
    fit.style.height = Math.ceil(box.height * scale) + 'px';
    frame.dataset.scale = String(Math.round(scale * 1000) / 1000);
  }

  const observer = new ResizeObserver(place);
  observer.observe(stage);

  const feed = feedPreview(window, frame, () => {
    if (data === null) return null;
    state.live = true;
    state.sent += 1;
    element.dataset.preview = 'live';
    element.dataset.sent = String(state.sent);
    says.textContent = state.locked
      ? 'This is the file as a reader first meets it. It follows the project as you change it.'
      : 'This is the file as staff see it. It follows the project as you change it.';
    return data;
  });

  // Work out what the frame should hold now, and hand it over.
  async function refresh() {
    timer = null;
    if (stopped) return;
    const project = ctx.store.project;
    const locked = state.locked && isProtected(project);
    const parts = partsOf(project, locked);
    if (sameParts(shown, parts)) return;
    turn += 1;
    const mine = turn;
    let next;
    try {
      next = locked
        ? (await publishData(project, { clock: ctx.clock, random: deviceRandom() })).data
        : publishedModel(project, { clock: ctx.clock });
    } catch (error) {
      if (mine === turn && !stopped) says.textContent = 'The preview could not be brought up to date: ' + (error && error.message ? error.message : 'something went wrong') + ' The file itself is not affected until you publish.';
      return;
    }
    // a later change overtook this one while the lock was being made
    if (mine !== turn || stopped) return;
    data = next;
    shown = parts;
    feed.send();
  }

  function update(project) {
    const can = isProtected(project);
    lockBox.disabled = !can;
    lock.classList.toggle('is-off', !can);
    if (!can && state.locked) {
      state.locked = false;
      lockBox.checked = false;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(refresh, PREVIEW_WAIT_MS);
  }

  lockBox.addEventListener('change', () => {
    state.locked = lockBox.checked;
    update(ctx.store.project);
  });

  async function load() {
    again.hidden = true;
    says.textContent = 'Putting the preview together.';
    element.dataset.preview = 'loading';
    try {
      const html = await assemble(pageReader(), null);
      if (stopped) return;
      address = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      frame.src = address;
      state.loaded = true;
      if (!state.live) says.textContent = 'Opening the preview.';
    } catch (error) {
      if (stopped) return;
      element.dataset.preview = 'failed';
      says.textContent = error && error.message ? error.message : 'The preview could not be put together. Check the connection and try again.';
      again.hidden = false;
    }
  }
  again.addEventListener('click', load);

  place();
  load();
  update(ctx.store.project);

  return {
    element,
    frame,
    state,
    update,
    stop() {
      stopped = true;
      feed.stop();
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      if (address) URL.revokeObjectURL(address);
    },
  };
}
