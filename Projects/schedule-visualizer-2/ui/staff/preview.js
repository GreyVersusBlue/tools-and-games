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
// tried. The staff browser keeps the key a passcode made, per school, so on
// a reader's device it asks once; here that key is forgotten each time the
// tick goes on, so the passcode screen is what the tick shows, every time.
// (The frame's page is at a blob address made by this page, so the two share
// one origin and one localStorage.)
//
//   const view = preview(ctx);
//   view.element                the bar and the frame
//   view.update(project)        the project changed: feed the frame again, soon
//   view.stop()                 the section is leaving
//   view.state                  { loaded, live, sent, width, locked }, for the tests
//
// The frame is told again 250 ms after the last change, and only when
// something the published file holds has changed: of the settings, the seven
// publishedModel copies (PUBLISHED_SETTINGS), so a theme or a paper size
// leaves the frame alone.

import { h, uid } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { publishedModel, isProtected } from '../../engine/publish-data.js';
import { assemble, pageReader, feedPreview, LinkError } from './assemble.js';
import { publishData, deviceRandom } from './targets.js';
import { STORAGE_PREFIX } from '../../staff/storage.js';

export const PREVIEW_SIZES = {
  phone: { label: 'Phone', width: 390, height: 760 },
  desktop: { label: 'Desktop', width: 1180, height: 760 },
};
export const PREVIEW_WAIT_MS = 250;
export const PREVIEW_FAILED = 'The preview could not be put together: the staff browser\'s files could not be read. Check the connection and try again.';

// The settings a published file carries: the keys of publishedModel's
// `settings`, held equal to it by a case in test/browser/publish.mjs.
export const PUBLISHED_SETTINGS = ['schoolName', 'periods', 'periodWord', 'defaultPassingSeconds', 'secondsPerCell', 'secondsPerStair', 'timeFormat'];

// The parts of a project a published file is made from. The store shares
// every branch a change did not touch, so "the same parts" is "nothing a
// reader would see has changed".
function partsOf(project, locked) {
  const publish = project.publish || {};
  const settings = project.settings || {};
  return [project.id, ...PUBLISHED_SETTINGS.map((key) => settings[key]), project.building, project.subjects, project.teachers, project.dayTypes, project.groups,
    publish.views, publish.teacherNamesOnMap, publish.stalenessDays, locked ? publish.passcode : null, locked];
}

// Forget the key this device kept for a school's passcode, so the next locked
// copy the frame is fed meets the passcode screen. Where the browser keeps
// nothing there is nothing to forget.
function forgetKey(schoolId) {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + schoolId + ':key');
  } catch (error) {
    // storage is refused here, so the frame kept no key either
  }
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
  let forget = false; // the tick has just gone on: the kept key goes before the next feed

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
    if (locked && forget) forgetKey(project.id);
    forget = false;
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
    forget = state.locked;
    update(ctx.store.project);
  });

  async function load() {
    again.hidden = true;
    says.textContent = 'Putting the preview together.';
    element.dataset.preview = 'loading';
    try {
      const html = await assemble(pageReader(), null);
      if (stopped) return;
      // the page before this one, when "Try again" is making another
      if (address) URL.revokeObjectURL(address);
      address = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      frame.src = address;
      state.loaded = true;
      if (!state.live) says.textContent = 'Opening the preview.';
    } catch (error) {
      if (stopped) return;
      element.dataset.preview = 'failed';
      // the assembler's own refusals are sentences; anything else (a fetch that never arrived) is the browser's words, not ours
      says.textContent = error instanceof LinkError && error.message ? error.message : PREVIEW_FAILED;
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
