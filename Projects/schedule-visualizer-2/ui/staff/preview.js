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
// a reader's device it asks once; here the frame is told to forget that key
// each time the tick goes on (feedPreview's `forget`), so the passcode screen
// is what the tick shows, every time, also where the frame could keep the key
// only in its memory.
//
//   const view = preview(ctx);
//   view.element                the bar and the frame
//   view.update(project)        the project changed: feed the frame again, soon
//   view.stop()                 the section is leaving
//   view.state                  { loaded, opened, live, sent, width, locked }, for the tests
//
// A frame that was given its page and has not asked for the data after
// PREVIEW_TIMES.open says so, with "Try again": the page is made anew and the
// address of the one before is let go. The wait ends when the page asks, not
// when it is first answered: a page that opened and could not be given its
// data keeps the sentence that says why. The feed counts a page as having
// asked only while the frame holds its address (feedPreview), so a change
// that lands after "Try again" waits for the new page.
//
// The frame is told again 250 ms after the last change, and only when
// something the published file holds has changed: of the settings, the seven
// publishedModel copies (PUBLISHED_SETTINGS), so a theme or a paper size
// leaves the frame alone.

import { h, uid } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { publishedModel, isProtected } from '../../engine/publish-data.js';
import { assemble, pageReader, feedPreview, failureSentence } from './assemble.js';
import { publishData, deviceRandom } from './targets.js';

export const PREVIEW_SIZES = {
  phone: { label: 'Phone', width: 390, height: 760 },
  desktop: { label: 'Desktop', width: 1180, height: 760 },
};
export const PREVIEW_WAIT_MS = 250;
// How long the frame has to ask for its data once it has its page. An object,
// so a test can shorten the wait.
export const PREVIEW_TIMES = { open: 20000 };
export const PREVIEW_FAILED = 'The preview could not be put together: the staff browser\'s files could not be read. Check the connection and try again.';
export const PREVIEW_BROKE = 'The preview could not be put together. Reload the page and try again.';
export const PREVIEW_NOT_OPEN = 'The preview has not opened. Try again; publishing a file does not depend on it.';

// The settings a published file carries: the keys of publishedModel's
// `settings`, held equal to it by a case in test/browser/publish.mjs.
export const PUBLISHED_SETTINGS = ['schoolName', 'periods', 'periodWord', 'defaultPassingSeconds', 'secondsPerCell', 'secondsPerStair', 'timeFormat'];

// The parts of a project a published file is made from. The store shares
// every branch a change did not touch, so "the same parts" is "nothing a
// reader would see has changed". A theme, a paper size or the note that a
// file was made is a new project object with the same parts. `locked`: the
// file is behind the passcode, so the passcode is a part too. The preview
// feeds the frame again only for new parts; Publish says the schedule
// changed while its file was made only for new parts (form.js).
export function partsOf(project, locked) {
  const publish = project.publish || {};
  const settings = project.settings || {};
  return [project.id, ...PUBLISHED_SETTINGS.map((key) => settings[key]), project.building, project.subjects, project.teachers, project.dayTypes, project.groups,
    publish.views, publish.teacherNamesOnMap, publish.stalenessDays, locked ? publish.passcode : null, locked];
}

export function sameParts(a, b) {
  return a !== null && a.length === b.length && a.every((part, at) => part === b[at]);
}

// Whether a reader would see a change between two projects, each read as
// the file it would make: locked when its own passcode is on. Publish says
// "the schedule changed while the file was being made" by this (form.js).
// A passcode turned on or off between the two is a change: one file asks
// for a passcode and the other does not. Until SV2-53 the form read both
// with the made file's flag, so a passcode turned on during assembly was no
// change and one turned off was.
export function readerSeesChange(before, after) {
  return before !== after && !sameParts(partsOf(before, isProtected(before)), partsOf(after, isProtected(after)));
}

export function preview(ctx) {
  const state = { loaded: false, opened: false, live: false, sent: 0, width: 'phone', locked: false };
  let data = null;
  let shown = null;
  let timer = null;
  let turn = 0;
  let address = null;
  let stopped = false;
  let forget = false; // the tick has just gone on: the next locked copy tells the frame to forget its key
  let forgetNext = false; // and that copy is in hand, waiting to be sent
  let openTimer = null;
  let staleSays = null; // why the frame could not be given the project as it is now, while that is so

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
    // The feed asks only once the frame's page has asked, so the page has
    // opened, whether or not there is anything to give it yet: the wait for
    // it to open ends here, and "has not opened" never replaces the reason
    // the data could not be made.
    waitToOpen(false);
    state.opened = true;
    // a page that asks after the wait ran out has opened after all: "has not
    // opened" goes, and so does "Try again"
    const late = element.dataset.preview === 'failed' && says.textContent === PREVIEW_NOT_OPEN;
    if (late) again.hidden = true;
    if (data === null) {
      if (late) {
        element.dataset.preview = 'loading';
        says.textContent = staleSays || 'Opening the preview.';
      }
      return null;
    }
    state.live = true;
    state.sent += 1;
    again.hidden = true;
    element.dataset.preview = 'live';
    element.dataset.sent = String(state.sent);
    // What the frame is given is the last copy that could be made. While a
    // later one could not be, the preview does not follow the project, and
    // the sentence saying why stays.
    says.textContent = staleSays || (state.locked
      ? 'This is the file as a reader first meets it. It follows the project as you change it.'
      : 'This is the file as staff see it. It follows the project as you change it.');
    return data;
  }, () => {
    const flags = forgetNext ? { forget: true } : null;
    forgetNext = false;
    return flags;
  });

  // The wait for the frame's page to ask for its data: data-waiting="open"
  // while it runs, so a test can tell a wait that ended from one that ran out.
  function waitToOpen(on) {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = null;
    delete element.dataset.waiting;
    if (!on) return;
    element.dataset.waiting = 'open';
    openTimer = setTimeout(() => {
      openTimer = null;
      delete element.dataset.waiting;
      if (stopped || state.live) return;
      element.dataset.preview = 'failed';
      says.textContent = PREVIEW_NOT_OPEN;
      again.hidden = false;
    }, PREVIEW_TIMES.open);
  }

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
      if (mine !== turn || stopped) return;
      // the same sentence Publish would give for the same failure (form.js)
      console.warn('Schedule Visualizer 2: the preview could not be brought up to date.', error);
      staleSays = 'The preview could not be brought up to date. ' + failureSentence(error, { connection: PREVIEW_FAILED, other: PREVIEW_BROKE });
      says.textContent = staleSays;
      element.dataset.previewSays = 'stale';
      return;
    }
    // a later change overtook this one while the lock was being made
    if (mine !== turn || stopped) return;
    if (locked && forget) forgetNext = true;
    forget = false;
    staleSays = null;
    delete element.dataset.previewSays;
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
      state.opened = false;
      state.live = false;
      // the reason there is nothing to show yet outlasts the page being made
      says.textContent = staleSays || 'Opening the preview.';
      waitToOpen(true);
    } catch (error) {
      if (stopped) return;
      element.dataset.preview = 'failed';
      // the tool's own refusals are sentences; a file that never arrived is the connection's; the browser's own words are not shown
      console.warn('Schedule Visualizer 2: the preview could not be put together.', error);
      says.textContent = failureSentence(error, { connection: PREVIEW_FAILED, other: PREVIEW_BROKE });
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
      if (openTimer !== null) clearTimeout(openTimer);
      if (address) URL.revokeObjectURL(address);
    },
  };
}
