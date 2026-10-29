// Presentation mode (spec 15): the movement view on a projector. The tool's
// controls are hidden, the map fills the screen at Fit, its labels and the
// legend are 1.5 times their size, a key of the groups on the map stays
// beside it with the load bands, and a summary of the busiest places can be
// shown or hidden. Arrow keys step through the transitions, an auto-advance
// steps every 5, 10 or 15 seconds, the playback runs inside it, and Escape
// leaves with the section as it was.
//
//   presentMode({ ctx, plan, env, bar, root, places }) -> { button, enter(), leave(), unmount() }
//     ctx    the shell's section context
//     plan   the section's plan map (ui/surface/plan-map.js)
//     env    the section's env (the top of ./index.js): choice(), change()
//     bar    the playback bar's element (its .playback is the bar's own state)
//     root   the section's element, the plan map's root (div.mov), whose
//            .movement (./index.js) is the view on screen
//     places { bar, controls }: where Present stands. It ends the playback
//            bar's row (after More), where the scrubber gives up the width it
//            takes, and at 640 px and under it stands beside Clear in the
//            controls, since a phone's bar row has no width to spare. It
//            moves when the window crosses that width; P works either way.
//            Not the first line: there it could push the sentence to a second
//            row, which takes height from the map (44 px on a phone), and near
//            the width where that happens a scrollbar coming and going turned
//            the legend's dock over three times (m5-pass, 1024 by 768).
//   button   "Present"; the key is P (and P again leaves)
//   unmount  the section leaving the page (Movement's unmount(), which a
//            change of address inside Movement comes through too): the mode
//            is left with the transition and floors put back for the next
//            mount, and every listener, observer and timer let go
//
// Nothing is drawn twice and nothing keeps a clock of its own: the map is the
// section's plan map, the playback is the section's bar (its clock is copied
// into the corner of the screen, its Play and Pause are pressed by Space), and
// a step is the section's own change of transition. What this adds is laid
// into the section's element: the panel, the caption over the map, the
// corner line and the touch controls (./present.css styles them only under
// data-present).
//
// Full screen. The Fullscreen API is asked on the reader's press, for the
// section's element. The element is laid over the whole window at once
// (data-present="window"), so where the browser refuses, or has no such API
// (an iPhone), the presentation is whole as it is, and that is said once a
// visit; when the browser grants it, data-present is "fullscreen". A grant
// that comes after the mode was left (Escape pressed before the browser
// answered) is given straight back, and an error said by event (WebKit's
// prefixed API returns no promise) is a refusal like a rejected promise.
// Leaving full screen by the browser's own means (its Escape, its menu)
// leaves the presentation too. Everything outside the element is made inert while it
// lasts, but the shell's live regions, so neither Tab nor a screen reader
// wanders under it.
//
// Keys while presenting (listed in Help through ctx.shortcuts, PRESENT_KEYS):
// Left and Right step (the first from All is the first transition), Space
// plays and pauses, A cycles the auto-advance off, 5, 10, 15 s, H shows or
// hides the hotspot summary, Escape (or P again) leaves. Every other key is
// kept from the shell and the map, so a digit does not change section under
// the screen and Ctrl+Z does not change the project unseen. While one of the
// tool's dialogs is open its keys are its own, Escape included. The
// auto-advance lets a playback that is running finish its transition first.
//
// The touch controls (previous, play, next, leave) are shown on entering by
// a pointer and on any touch, and fade 3 s after. Faded they are only
// transparent: still in the Tab order and read by a screen reader (which
// has no Escape to press), shown again when the focus comes to them.
//
// Leaving puts back the transition, the floors, the map's zoom and place (or
// its fit; plan.setView, so a card open on a cell stays), the playback where
// it was, the section's scroll and the focus on Present, or, where Present
// is folded away on a phone, on Change, or the map.
//
// For the tests, on the section's element:
//   root.present   { presenting, how, advance, due, hotspots, controls, saved,
//                    enter(), leave(), timers({ set(fn, ms, what), clear(id) }) }
//   (due: an auto-advance step waiting on a running playback)
// `timers` replaces setTimeout for the auto-advance, the fading of the
// controls and of the corner line, so a test can run each one when it wants.

import { h } from '../components/dom.js';
import { singleKeyAllowed } from '../components/shortcuts.js';
import { dialogIsOpen } from '../components/dialog.js';
import { count } from '../components/words.js';
import { parse, readable } from '../colour.js';
import { bandText } from './legend.js';
import { unitWord, positionOf, nothingMeets, nothingMeetsParts } from './model.js';
import { hotspotRows, placeWords } from './hotspots.js';
import { layoutFloors, bestLayout, FIT_MARGIN } from '../surface/plan-layout.js';
import { CELL, MIN_ZOOM, MAX_ZOOM } from '../surface/viewport.js';
import { floorsShown, REARM_HEIGHT } from '../surface/plan-map.js';

// The keys, for Help, under Movement (Help explains each group it lists,
// ui/help/content.js). The section answers them itself (below).
export const PRESENT_KEYS = [
  { id: 'movement-present', group: 'Movement', does: 'Present the movement view on the whole screen', shown: 'P' },
  { id: 'present-step', group: 'Movement', does: 'In presentation mode: the previous or the next transition', shown: 'Left, Right' },
  { id: 'present-play', group: 'Movement', does: 'In presentation mode: play or pause the playback', shown: 'Space' },
  { id: 'present-advance', group: 'Movement', does: 'In presentation mode: step on by itself, off, then every 5, 10 or 15 seconds', shown: 'A' },
  { id: 'present-hotspots', group: 'Movement', does: 'In presentation mode: show or hide the busiest places', shown: 'H' },
  { id: 'present-leave', group: 'Movement', does: 'Leave presentation mode (P leaves too)', shown: 'Esc' },
];

// Seconds between steps, in the order A goes through them; 0 is off.
export const ADVANCE_STEPS = [0, 5, 10, 15];
// The map's labels and the panel's type, against their size in the section.
export const LABEL_SCALE = 1.5;
// The touch controls go this long after the last touch; the corner line this long after it is said.
export const CONTROLS_FADE_MS = 3000;
export const LINE_FADE_MS = 2500;
// The hotspot summary's length.
export const HOTSPOTS_SHOWN = 5;
// How long the map is given to be back at its size before it is put back where it was.
export const RESTORE_WAIT_MS = 1000;
// A playback dropping to within this much of its transition's start has gone round (dueStep).
export const AROUND = 0.02;
// Under the map, the panel is at most this much of the screen's height.
export const PANEL_UNDER_MOST = 0.38;
// The corner line stands beside the touch controls where it has this much
// width there (a short sentence on one line), else above them (placeLine).
export const LINE_LEAST = 240;
// A finger on the map that moves less than this, in px, is a tap: the map
// is put back at the mode's Fit when it lifts, if the Fit was on as it went
// down (SV2-31d: a 1 px move ended it; SV2-31e: a tap put a reader's zoom back to it).
export const TAP_SLOP = 6;

export const REFUSED_SAYS = 'This browser did not open full screen, so the map fills the window instead.';

// "Steps on every 10 seconds.", "Auto-advance is off."
export function advanceWords(seconds) {
  return seconds > 0 ? 'Steps on every ' + seconds + ' seconds.' : 'Auto-advance is off.';
}

// Where a step from transition `at` (null for All) goes in a day of `n`:
// the index, or null at either end. `wrap` goes round (the auto-advance).
export function stepTo(at, by, n, wrap) {
  if (!(n > 0)) return null;
  let to = at === null || at === undefined ? (by > 0 ? 0 : n - 1) : at + by;
  if (to < 0 || to >= n) {
    if (!wrap) return null;
    to = ((to % n) + n) % n;
  }
  return to;
}

// The next of ADVANCE_STEPS after `seconds`.
export function nextAdvance(seconds) {
  const at = ADVANCE_STEPS.indexOf(seconds);
  return ADVANCE_STEPS[(at + 1) % ADVANCE_STEPS.length];
}

// What lasts the visit: the summary shown or hidden, and whether the refusal was said.
const memory = { hotspots: true, refusedSaid: false };

// The sheet: added to the page once, as the plan map adds movement.css.
const SHEET = new URL('./present.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="present"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'present' } }));
}

// The section shown now, for P: one listener for the page, whatever the
// number of visits to Movement; a section that has left the page is let go
// at the next key.
let active = null;
let listening = false;
function onPageKey(event) {
  const me = active;
  if (!me || event.defaultPrevented || me.presenting) return;
  if (!me.root.isConnected) {
    active = null;
    return;
  }
  if (event.key !== 'p' && event.key !== 'P') return;
  // a field's p, or a dialog's, is theirs, held down too (SV2-31d: a held p
  // in any text field lost its repeats while Movement was mounted)
  if (!singleKeyAllowed(event) || dialogIsOpen()) return;
  // P held down: its repeats are not presses (SV2-31c: the mode went in and out)
  if (event.repeat) {
    event.preventDefault();
    return;
  }
  if (!me.can()) return;
  event.preventDefault();
  me.enter();
}

// The fullscreen element, with WebKit's older name.
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

// Under this the button stands in the controls, not on the playback bar's row.
export const PRESENT_IN_CONTROLS = '(max-width: 640px)';

export function presentMode({ ctx, plan, env, bar, root, places }) {
  loadSheet();
  if (!listening) {
    document.addEventListener('keydown', onPageKey);
    listening = true;
  }
  let timers = realTimers;
  let presenting = false;
  let how = null;
  let saved = null;
  let advance = 0;
  let advanceTimer = null;
  let controlsTimer = null;
  let lineTimer = null;
  let restoreTimer = null;
  let pendingRestore = null;
  // the focus to be given when a full screen that outlasted the leave ends (focusBack)
  let focusLater = false;
  let madeInert = [];
  let watchGone = null;
  let watchClock = null;
  let drawnKey = null;
  // an auto-advance step that came while the playback ran: { transition, seconds }
  let due = null;
  // the section has left the page (unmount)
  let gone = false;
  // the mode's own Fit (fitMode): on from entering until the reader moves the map
  let modeFitted = false;
  let fitting = false;
  // the frame a waiting step samples the playback on (watchDue), and the
  // frame the map is put back on after leaving (restore's look)
  let dueFrame = null;
  let lookFrame = null;

  const view = () => root.movement || null;
  const playback = () => bar.playback;

  // ---- the button
  // a click with no pointer (Enter or Space on the button) is the keyboard's
  const button = h('button', { type: 'button', class: 'btn mov-present', 'aria-keyshortcuts': 'P', title: 'Show the map on the whole screen, for a projector (P)', data: { action: 'present' }, on: { click: (event) => enter(event.detail > 0 ? 'pointer' : 'key') } }, 'Present');

  // ---- the panel: the groups on the map, the load, the busiest places
  const panel = h('section', { class: 'mov-pres__panel', tabindex: '0', 'aria-label': 'Presentation of the movement view: the key', data: { part: 'present-panel' } });
  const groupsTitle = h('h2', { class: 'mov-pres__title' }, 'On the map');
  const groupsList = h('ul', { class: 'mov-pres__list', data: { present: 'groups' } });
  const groupsNote = h('p', { class: 'mov-pres__note', hidden: true });
  const groupsPart = h('section', { class: 'mov-pres__part', data: { present: 'key' } }, groupsTitle, groupsList, groupsNote);
  const loadWhat = h('p', { class: 'mov-pres__what' });
  const bandsList = h('ol', { class: 'mov-pres__list', data: { present: 'bands' } });
  const loadNote = h('p', { class: 'mov-pres__note' });
  const loadPart = h('section', { class: 'mov-pres__part', data: { present: 'load' } }, h('h2', { class: 'mov-pres__title' }, 'Load'), loadWhat, bandsList, loadNote);
  const hotList = h('ol', { class: 'mov-pres__list', data: { present: 'hotspot-rows' } });
  const hotNote = h('p', { class: 'mov-pres__note', hidden: true });
  const hotPart = h('section', { class: 'mov-pres__part', data: { present: 'hotspots' } }, h('h2', { class: 'mov-pres__title' }, 'Busiest places'), hotList, hotNote);
  panel.append(groupsPart, loadPart, hotPart);

  // ---- over the map: what is shown, the corner line, the touch controls
  const captionWhat = h('span', { class: 'mov-pres__what-shown' });
  const captionClock = h('span', { class: 'mov-pres__clock', data: { present: 'clock' } });
  const caption = h('p', { class: 'mov-pres__caption', data: { part: 'present-caption' } }, captionWhat, captionClock);
  const line = h('p', { class: 'mov-pres__line', role: 'status', 'aria-live': 'polite', data: { part: 'present-line', shown: 'false' } });
  const touchButton = (action, text, label, run) => h('button', { type: 'button', class: 'btn mov-pres__btn', 'aria-label': label, data: { action }, on: { click: run } }, text);
  const previousButton = touchButton('present-previous', '‹', 'Previous transition', () => step(-1, false));
  const playButton = touchButton('present-play', 'Play', 'Play', () => togglePlay());
  const nextButton = touchButton('present-next', '›', 'Next transition', () => step(1, false));
  const leaveButton = touchButton('present-leave', 'Leave', 'Leave presentation mode', () => leave());
  const touch = h('div', { class: 'mov-pres__touch', role: 'group', 'aria-label': 'Presentation controls', data: { part: 'present-touch', shown: 'false' } }, previousButton, playButton, nextButton, leaveButton);
  // what the safe area's insets are, read from its padding (insets())
  const probe = h('div', { class: 'mov-pres__probe', 'aria-hidden': 'true' });

  // where the button stands: the first line, or the controls on a phone
  const phone = matchMedia(PRESENT_IN_CONTROLS);
  function placeButton() {
    if (!places) return;
    // the section has left the page: nothing is placed again
    if (!root.isConnected && root.dataset.styled === 'true') {
      phone.removeEventListener('change', placeButton);
      return;
    }
    const into = phone.matches ? places.controls : places.bar;
    if (!into) return;
    if (button.parentNode !== into) {
      const held = document.activeElement === button;
      into.append(button);
      if (held) button.focus();
    }
    button.dataset.place = button.parentNode === places.controls ? 'controls' : 'bar';
  }
  placeButton();
  phone.addEventListener('change', placeButton);

  // hidden until the mode is entered: present.css comes on its own, and until
  // it is in they would stand in the section unstyled, moving its layout
  const parts = [panel, caption, line, touch, probe];
  for (const part of parts) part.hidden = true;
  root.append(panel, probe);
  plan.element.insertBefore(caption, plan.stage);
  plan.stage.append(line, touch);

  // ---- what the panel and the caption say, drawn again when the picture changes
  function lineColour(group, theme) {
    // the map's line for a group: its own colour, strengthened where it would
    // not show on a corridor (./index.js's lineColour, the same rule)
    return parse(group.colour) ? readable(group.colour, theme.corridor, 3) : theme.ink2;
  }

  function draw(force) {
    const movement = view();
    if (!presenting || !movement || !movement.picture || !movement.state) return;
    const picture = movement.picture;
    const state = movement.state;
    const key = [document.documentElement.dataset.theme || '', memory.hotspots].join('|');
    if (!force && drawnKey && drawnKey.picture === picture && drawnKey.key === key) return;
    drawnKey = { picture, key };
    const theme = plan.theme();
    const project = state.project;

    // the caption: the day type, the transition and its times
    const transition = picture.transition;
    captionWhat.replaceChildren(h('bdi', null, picture.dayTypeName), ' · ', transition ? transition.name : 'All transitions of the day', transition && transition.times ? ' · ' + transition.times : '');

    // the groups on the map
    groupsList.replaceChildren(...picture.groups.map((group) => h('li', { class: 'mov-pres__group', data: { group: group.id } },
      h('span', { class: 'mov-pres__swatch', style: 'background:' + lineColour(group, theme), 'aria-hidden': 'true' }),
      h('bdi', null, group.name))));
    groupsTitle.textContent = picture.groups.length === 1 ? 'On the map' : 'On the map: ' + count(picture.groups.length, 'group');
    groupsNote.hidden = picture.groups.length > 0;
    groupsNote.textContent = 'No group is on the map. Leave, and choose who to show.';

    // the load: what the colours count and the five bands in numbers
    const load = picture.mode === 'load' ? picture.load : null;
    loadPart.hidden = !load && picture.mode !== 'single';
    if (picture.mode === 'single') {
      loadWhat.textContent = 'One group, in its own colour: the corridors are coloured by load when more than one group is shown.';
      bandsList.replaceChildren();
      loadNote.textContent = '';
    } else if (load) {
      const many = unitWord(load.unit, 2);
      loadWhat.textContent = load.measure === 'transition'
        ? many[0].toUpperCase() + many.slice(1) + ' crossing a corridor cell in ' + transition.name + '.'
        : load.measure === 'total'
          ? 'Total over the day: ' + many + ' crossing a corridor cell.'
          : 'Busiest moment: the most ' + many + ' crossing a corridor cell in one transition.';
      bandsList.replaceChildren(...load.edges.map((edge) => h('li', { class: 'mov-pres__band', data: { band: String(edge.band) } },
        h('span', { class: 'mov-pres__chip', style: 'background:var(--load-' + edge.band + ')', 'aria-hidden': 'true' }, String(edge.band)),
        h('span', { class: 'vh' }, 'Band ' + edge.band + ': '),
        h('span', null, bandText(edge, true) + ' ' + many))));
      loadNote.textContent = (load.mode === 'absolute' ? 'Absolute scale.' : 'Relative scale: fifths of the busiest cell on screen.') + (load.zones > 0 ? ' ' + count(load.zones, 'exclusion zone') + ' left out.' : '');
    }

    // the busiest places, as the Hotspots tab ranks them
    hotPart.hidden = !memory.hotspots;
    panel.dataset.hotspots = memory.hotspots ? 'shown' : 'hidden';
    const rows = load && state.results ? hotspotRows(project, state.results, state.graph, picture).slice(0, HOTSPOTS_SHOWN) : [];
    hotList.replaceChildren(...rows.map((row) => h('li', { class: 'mov-pres__hot', data: { rank: String(row.rank) } },
      h('span', { class: 'mov-pres__rank' }, row.rank + '.'),
      h('bdi', { class: 'mov-pres__place' }, placeWords(row)),
      h('span', { class: 'mov-pres__detail' }, row.load + ' ' + unitWord(row.unit, row.load) + (row.when ? ', ' + row.when : '')))));
    hotNote.hidden = rows.length > 0;
    hotNote.textContent = !state.results ? 'Still being worked out.' : nothingMeets(project, picture.bellsId) ? nothingMeetsParts(project, picture.bellsId).map((part) => part.text).join('') : picture.mode === 'single' ? 'One group on the map: there is no load to rank.' : 'Nobody crosses a corridor here.';
  }

  // the bar's clock and countdown, as the bar writes them
  function copyClock() {
    const clock = bar.querySelector('[data-part="clock"]');
    const countdown = bar.querySelector('[data-part="countdown"]');
    const pb = playback();
    const shown = pb && pb.started && clock && clock.textContent !== '';
    captionClock.textContent = shown ? clock.textContent + (countdown && countdown.textContent ? ' · ' + countdown.textContent : '') : '';
    const playing = Boolean(pb && pb.playing);
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (due) dueStep();
  }

  // ---- the corner line, which fades
  function say(text) {
    line.textContent = text;
    line.dataset.shown = 'true';
    if (lineTimer !== null) timers.clear(lineTimer);
    lineTimer = timers.set(() => {
      lineTimer = null;
      line.dataset.shown = 'false';
    }, LINE_FADE_MS, 'line');
  }

  // ---- the touch controls, which fade. The keyboard's focus in them holds
  // them on screen until it leaves; a finger's (a tapped button takes the
  // focus) does not, or they would never fade for a touch user. Which one
  // it was is the last of a key or a pointer pressed.
  let lastInput = 'key';
  let held = false;
  const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
  function showControls() {
    touch.dataset.shown = 'true';
    if (controlsTimer !== null) timers.clear(controlsTimer);
    controlsTimer = timers.set(() => {
      controlsTimer = null;
      if (!held) touch.dataset.shown = 'false';
    }, CONTROLS_FADE_MS, 'controls');
  }
  function onPointer(event) {
    if (!presenting) return;
    track(event);
    if (event.type === 'pointerup' || event.type === 'pointercancel') return;
    if (event.type === 'pointermove' && event.pointerType !== 'mouse') return;
    if (event.type === 'pointerdown') lastInput = 'pointer';
    showControls();
  }

  // A gesture on the map, from its first pointer down on the stage (not on
  // the touch controls) to its last up: how far each pointer went, whether
  // the map moved under it, whether the mode's Fit was on as it began, and
  // whether a fit was wanted while it lasted. While it lasts nothing fits
  // the map under the finger (fitMode waits; SV2-31e: a step mid-drag threw
  // the map back to the Fit under it). As it lifts: a finger that went
  // under TAP_SLOP px was a tap, and the map goes back to the mode's Fit if
  // the Fit was on as it went down (a reader who zoomed and taps a cell
  // keeps their zoom, SV2-31e); further, or two fingers, the reader moved
  // the map, and the mode's Fit ends (SV2-31d: a 1 px move on a tap had
  // ended it for good). A window of another size meanwhile is fitted then.
  let gesture = null;
  function track(event) {
    if (event.type === 'pointerdown') {
      if (!plan.stage.contains(event.target) || touch.contains(event.target)) return;
      if (!gesture) gesture = { pointers: new Map(), far: 0, many: false, moved: false, fitted: modeFitted, wanted: false };
      gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.pointers.size > 1) gesture.many = true;
      return;
    }
    const at = gesture ? gesture.pointers.get(event.pointerId) : null;
    if (!at) return;
    gesture.far = Math.max(gesture.far, Math.hypot(event.clientX - at.x, event.clientY - at.y));
    // a mouse moving with no button down has come up where nobody heard it
    if (event.type === 'pointermove' && !(event.pointerType === 'mouse' && event.buttons === 0)) return;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size > 0) return;
    const done = gesture;
    gesture = null;
    if (!done.moved && !done.wanted) return;
    if (done.many || done.far >= TAP_SLOP) modeFitted = false;
    else if (done.fitted) modeFitted = true;
    fitMode(false);
  }
  // the focus coming to them shows them, whoever brought it (a screen
  // reader's swipe too); the keyboard's holds them
  touch.addEventListener('focusin', () => {
    if (!presenting) return;
    if (lastInput !== 'key') {
      showControls();
      return;
    }
    held = true;
    touch.dataset.shown = 'true';
  });
  touch.addEventListener('focusout', (event) => {
    if (touch.contains(event.relatedTarget) || !held) return;
    held = false;
    if (presenting) showControls();
  });

  // ---- the mode's Fit (SV2-31c). The map fills what the panel and the
  // caption leave, and the touch controls and the corner line lie over its
  // foot: the Fit counts that band as a foot, so no floor is drawn under
  // them, and the safe area's left and right insets as margins, so none is
  // drawn under a phone's notch either (SV2-31d). Where the panel goes (a
  // column beside the map, or a band under it) is chosen by the layout the
  // plan map will draw on the stage each place leaves (bestLayout, which
  // 'auto' asks, on that stage): the place where that layout shows every
  // floor whole above the band at the larger zoom, beside on a tie (SV2-31d:
  // the place had been judged by whichever layout fitted above the band,
  // and the map then drew its own pick on the whole stage). At 844 by 390
  // the floors had stood stacked beside a 236 px panel, Floor 3 under the
  // controls, and no layout is whole there at 25 %; under a 109 px panel
  // they are whole side by side at 27 %. Under the map the panel is as tall
  // as the map leaves it, between its first row of groups and 38 % of the
  // screen. The floors are placed through the plan map's fitAt (its rule,
  // choose) and setView; the map's own Fit, which knows nothing of the band,
  // is not used while presenting. The reader moving the map ends the mode's
  // Fit, but for a tap (a finger that moves under TAP_SLOP px), and a window
  // of another width, or a height changed by more than REARM_HEIGHT, brings
  // it back (a touch browser's bar coming or going does not, SV2-31e).

  // How far up from the stage's foot the touch controls and the corner line
  // reach, in px, as present.css places them: the controls as they stand
  // (faded they keep their box), the line as tall as its longest sentence
  // (the refusal) or as what it says now, so a line said later is not drawn
  // over a floor.
  function footBand() {
    let band = 0;
    const from = (el) => (parseFloat(getComputedStyle(el).bottom) || 0) + el.offsetHeight;
    if (touch.getClientRects().length > 0) band = Math.max(band, from(touch));
    if (line.getClientRects().length > 0) {
      band = Math.max(band, from(line));
      // a copy that says the longest, laid out where the line is, read by nobody
      const longest = line.cloneNode(false);
      for (const name of ['role', 'aria-live', 'data-part']) longest.removeAttribute(name);
      longest.setAttribute('aria-hidden', 'true');
      longest.textContent = REFUSED_SAYS;
      line.after(longest);
      band = Math.max(band, from(longest));
      longest.remove();
    }
    return Math.ceil(band);
  }

  // The safe area's insets in px, as env() gives them to the probe's padding.
  function insets() {
    const style = getComputedStyle(probe);
    const px = (name) => parseFloat(style[name]) || 0;
    return { top: px('paddingTop'), right: px('paddingRight'), bottom: px('paddingBottom'), left: px('paddingLeft') };
  }

  // The corner line and the touch controls side by side at the stage's
  // foot (the line at the left, the controls at the right), or, on a stage
  // too narrow for the line beside them (an upright phone), the line above
  // the controls: never one over the other (SV2-31d: at 844 by 390 the
  // centred controls lay over the line's end). `width` is the stage's.
  // The line's width beside them is set here (--pres-line-most), so the
  // sheet and this agree on it: from the line's left to the controls, less
  // as much again as the line stands off the stage's edge.
  function placeLine(width) {
    const left = parseFloat(getComputedStyle(line).left) || 0;
    const gap = Math.max(0, left - insets().left);
    const touchStyle = getComputedStyle(touch);
    const room = Math.floor(width - left - (parseFloat(touchStyle.right) || 0) - touch.offsetWidth - gap);
    root.dataset.presentLine = room >= LINE_LEAST ? 'beside' : 'above';
    root.style.setProperty('--pres-line-most', Math.max(0, room) + 'px');
    root.style.setProperty('--pres-touch-up', Math.ceil((parseFloat(touchStyle.bottom) || 0) + touch.offsetHeight) + 'px');
  }

  // The floors the mode may be shown: the reader's choice, and the layout
  // the plan map draws for it on a stage `width` by `height` (its arrange:
  // bestLayout for 'auto', keeping the layout on the map unless the other
  // is clearly larger), as { how, layout }.
  function floorsNow(project) {
    return floorsShown(project, saved ? saved.floors : env.choice().floors);
  }
  function drawnOn(project, width, height) {
    const value = saved ? saved.floors : env.choice().floors;
    const floors = floorsShown(project, value);
    const world = plan.world;
    const same = world && world.measured && world.slots.length === floors.length && world.slots.every((slot, at) => slot.floor.id === floors[at].id);
    const how = value === 'side' || value === 'stacked' ? value : bestLayout(floors, width, height, same ? world.how : undefined);
    return { how, layout: layoutFloors(floors, how) };
  }

  // The zoom at which a layout fits `width` by `height` with the fit's
  // margin, unclamped, and whether that is a zoom the map can take (25 %
  // and over: every floor whole)
  function fitOf(layout, width, height) {
    const zoom = Math.min(MAX_ZOOM, Math.max(0, width - FIT_MARGIN * 2) / (layout.width * CELL), Math.max(0, height - FIT_MARGIN * 2) / (layout.height * CELL));
    return { zoom, whole: zoom >= MIN_ZOOM };
  }

  // Each place of the panel measured as laid out (the attribute set, the
  // page asked for its boxes), and the best arrangement:
  // { panel: 'beside' | 'under', how, height (the panel's, under), zoom, whole }
  function arrangement() {
    const movement = view();
    if (!movement || !movement.state) return null;
    const project = movement.state.project;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const edge = insets();
    const was = { panel: root.dataset.presentPanel, line: root.dataset.presentLine };
    let best = null;
    const better = (next) => {
      if (!best || (next.whole && !best.whole) || (next.whole === best.whole && next.zoom > best.zoom + 1e-9)) best = next;
    };
    for (const where of ['beside', 'under']) {
      root.dataset.presentPanel = where;
      panel.style.removeProperty('height');
      const captionHeight = caption.offsetHeight;
      if (where === 'beside') {
        // the stage reaches the screen's left edge, the panel its right
        const stageWidth = width - panel.offsetWidth;
        placeLine(stageWidth);
        const band = footBand();
        const drawn = drawnOn(project, stageWidth, height - captionHeight);
        better({ panel: where, how: drawn.how, height: null, ...fitOf(drawn.layout, stageWidth - edge.left, height - captionHeight - band) });
        continue;
      }
      placeLine(width);
      const band = footBand();
      // under: at least the panel's title and its first row of groups, at
      // most 38 % of the screen; to the row's foot, as the panel would
      // stand unscrolled, then its padding and its bottom border (the safe
      // area's, SV2-31d: left out, a phone's 34 px inset cut the row)
      const first = panel.querySelector('[data-present="groups"] li') || groupsTitle;
      const style = getComputedStyle(panel);
      const least = Math.ceil(first.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + panel.scrollTop + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0));
      const most = Math.max(least, Math.floor(height * PANEL_UNDER_MOST));
      const across = width - edge.left - edge.right;
      const tried = new Set();
      for (const how of ['side', 'stacked']) {
        // the map as tall as the width lets that layout be, the panel the
        // rest; then the layout the map draws on the stage so left
        const layout = layoutFloors(floorsNow(project), how);
        const wants = Math.ceil(band + FIT_MARGIN * 2 + layout.height * CELL * fitOf(layout, across, Infinity).zoom);
        const panelHeight = Math.max(least, Math.min(most, height - captionHeight - wants));
        if (tried.has(panelHeight)) continue;
        tried.add(panelHeight);
        const stageHeight = height - captionHeight - panelHeight;
        const drawn = drawnOn(project, width, stageHeight);
        better({ panel: where, how: drawn.how, height: panelHeight, ...fitOf(drawn.layout, across, stageHeight - band) });
      }
    }
    for (const [name, value] of [['presentPanel', was.panel], ['presentLine', was.line]]) {
      if (value === undefined) delete root.dataset[name];
      else root.dataset[name] = value;
    }
    return best;
  }

  // The arrangement put on the page: where the panel stands, its height
  // under the map, and where the corner line stands. Asked on entering and
  // when the window changes size, not at each step (its boxes are laid out
  // twice). The floors' layout is the plan map's own pick for 'auto' on
  // the stage so made, the one judged here (root.dataset.presentHow, for a
  // test); a layout the reader chose is theirs.
  let arrangedFor = null;
  const windowKey = () => root.clientWidth + 'x' + root.clientHeight;
  function arrange(force) {
    const key = windowKey();
    if (!force && key === arrangedFor) return;
    const chosen = arrangement();
    if (!chosen) return;
    arrangedFor = key;
    // the window it was arranged for, for a test to wait on
    root.dataset.presentArranged = key;
    root.dataset.presentPanel = chosen.panel;
    root.dataset.presentHow = chosen.how;
    if (chosen.height === null) panel.style.removeProperty('height');
    else panel.style.height = chosen.height + 'px';
    placeLine(chosen.panel === 'beside' ? root.clientWidth - panel.offsetWidth : root.clientWidth);
  }

  // The window changed size inside the plan map's own measuring (a resize
  // observer's turn): the arrangement waits a frame, so the boxes it lays
  // out are not laid out again inside that turn. A window of another width,
  // or a height more than REARM_HEIGHT from the one last fitted for (the
  // plan map's rule), is fitted again whatever the reader did to the map
  // before (SV2-31d: a map moved once kept its place through a rotation);
  // a phone's toolbar showing or hiding (56 px) is arranged for and leaves
  // the reader's zoom (SV2-31e). A pointer down on the map holds all of
  // this until it lifts (track).
  let arrangeFrame = null;
  let fitWindow = null;
  function fitMode(fromLayout) {
    if (!presenting || fitting || gone) return;
    if (gesture) {
      gesture.wanted = true;
      return;
    }
    if (windowKey() !== arrangedFor) {
      const now = { width: root.clientWidth, height: root.clientHeight };
      if (!fitWindow || now.width !== fitWindow.width || Math.abs(now.height - fitWindow.height) > REARM_HEIGHT) {
        modeFitted = true;
        fitWindow = now;
      }
      if (fromLayout) {
        if (arrangeFrame === null) {
          arrangeFrame = requestAnimationFrame(() => {
            arrangeFrame = null;
            fitMode(false);
          });
        }
      } else {
        fitting = true;
        try {
          arrange(false);
        } finally {
          fitting = false;
        }
      }
    }
    if (!modeFitted) return;
    const v = plan.view;
    if (!plan.world || v.width === 0 || v.height === 0) return;
    fitting = true;
    try {
      // where the map's own Fit would put the floors on the stage above the
      // band and inside the safe area's left and right insets
      const stage = plan.stage.getBoundingClientRect();
      const edge = insets();
      const left = Math.max(0, Math.ceil(edge.left - stage.left));
      const right = Math.max(0, Math.ceil(stage.left + v.width - (root.clientWidth - edge.right)));
      const place = plan.fitAt(Math.max(1, v.width - left - right), Math.max(1, v.height - footBand()));
      if (place) plan.setView({ zoom: place.zoom, x: place.x + left, y: place.y });
      root.dataset.presentFit = place ? plan.world.how : '';
    } finally {
      fitting = false;
    }
  }
  function stopArrange() {
    if (arrangeFrame !== null) cancelAnimationFrame(arrangeFrame);
    arrangeFrame = null;
    arrangedFor = null;
    fitWindow = null;
    delete root.dataset.presentArranged;
    delete root.dataset.presentPanel;
    delete root.dataset.presentHow;
    delete root.dataset.presentLine;
    root.style.removeProperty('--pres-line-most');
    root.style.removeProperty('--pres-touch-up');
    panel.style.removeProperty('height');
  }

  // ---- stepping, playing, the auto-advance, the summary
  function step(by, wrap) {
    const movement = view();
    const picture = movement && movement.picture;
    if (!presenting || !picture) return;
    const n = picture.transitions.length;
    const at = positionOf(picture.transitions, picture.choice.transition);
    const toAt = stepTo(at === -1 ? null : at, by, n, wrap);
    const to = toAt === null ? null : picture.transitions[toAt].period;
    if (to === null) {
      say(n === 0 ? (nothingMeets(movement.state.project, picture.bellsId) ? nothingMeetsParts(movement.state.project, picture.bellsId).map((part) => part.text).join('') : 'This day has no transition to show.') : by > 0 ? 'This is the last transition of the day.' : 'This is the first transition of the day.');
    } else {
      // a card the reader tapped open stays on its cell, as playback going on from one transition to the next does
      env.change({ transition: to }, { keepCard: true });
      const now = view().picture.transition;
      if (now) say(now.name + (now.times ? ', ' + now.times : '') + '.');
    }
    schedule();
  }

  function togglePlay() {
    const pb = playback();
    if (!presenting || !pb) return;
    if (pb.playing) pb.pause();
    else {
      pb.play();
      if (!pb.playing) say(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Reduced motion is on, so the playback does not move by itself.' : 'There is nothing to play here yet.');
    }
    copyClock();
  }

  function schedule() {
    if (advanceTimer !== null) timers.clear(advanceTimer);
    advanceTimer = null;
    due = null;
    stopDue();
    root.dataset.presentAdvance = String(advance);
    if (!presenting || advance === 0) return;
    advanceTimer = timers.set(() => {
      advanceTimer = null;
      if (!presenting || !root.isConnected) return;
      const pb = playback();
      if (pb && pb.playing) {
        // a playback running: the step waits for it to finish its transition (dueStep)
        due = { transition: env.choice().transition, seconds: pb.seconds, stride: 0 };
        watchDue();
        return;
      }
      step(1, true);
    }, advance * 1000, 'advance');
  }

  // Each change of the bar (its clock, Play and Pause) and each frame while
  // a step waits: it comes once the playback has finished its transition,
  // that is played it to its end and stopped there, or gone round from its
  // end to its start (the loop over the transition). A pause before the end
  // holds the step until Play and the end (SV2-31c: Space mid-transition
  // brought it at once), and a seek is not a finish: the scrubber moved back
  // is a drop from the middle to the middle, a going round is a drop from
  // within a frame or two of the end (a frame's advance is the last stride
  // seen) or to within AROUND of the start. (A seek to the very start counts
  // as going round; the mode has no scrubber, so only a script makes one.) One that
  // went on to the next transition by itself (the loop over the day) has
  // stepped already, and the next step is timed from there.
  function dueStep() {
    const pb = playback();
    if (!presenting || !due || !pb) return;
    if (env.choice().transition !== due.transition) {
      schedule();
      return;
    }
    const at = pb.seconds;
    const end = pb.end;
    let finished;
    if (!pb.playing) finished = at >= end - 1e-6;
    // gone round: from near the end, or to the start (the playback sets its
    // clock to 0 there and drops the overshoot, so after a slow frame the
    // last sample can stand further from the end than two strides)
    else finished = at < due.seconds && (due.seconds + 2 * due.stride >= end || at <= Math.max(2 * due.stride, AROUND * end));
    if (at > due.seconds) due.stride = at - due.seconds;
    due.seconds = at;
    if (!finished) {
      watchDue();
      return;
    }
    due = null;
    step(1, true);
  }
  // a frame at a time while the playback runs and a step waits on it
  function watchDue() {
    const pb = playback();
    if (dueFrame !== null || !presenting || !due || !pb || !pb.playing) return;
    dueFrame = requestAnimationFrame(() => {
      dueFrame = null;
      dueStep();
    });
  }
  function stopDue() {
    if (dueFrame !== null) cancelAnimationFrame(dueFrame);
    dueFrame = null;
  }

  function cycleAdvance() {
    advance = nextAdvance(advance);
    schedule();
    say(advanceWords(advance));
  }

  function toggleHotspots() {
    memory.hotspots = !memory.hotspots;
    draw(true);
    say(memory.hotspots ? 'The busiest places are shown. H hides them.' : 'The busiest places are hidden. H shows them.');
  }

  // ---- the keys while presenting: on the page, before the shell's and the map's
  function onKey(event) {
    if (!presenting) return;
    lastInput = 'key';
    // a dialog of the tool's, opened over the mode: its keys, Escape included, are its own
    if (event.key === 'Tab' || dialogIsOpen()) return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const onButton = event.target && event.target.closest ? event.target.closest('button') : null;
    const key = event.key;
    // a key held down: the arrows step on as it repeats; the toggles (P,
    // Escape, Space, A, H) answer the press only, or holding one flickers it
    if (event.repeat && key !== 'ArrowLeft' && key !== 'ArrowRight') {
      if (!(key === ' ' && onButton)) event.preventDefault();
      return;
    }
    if (key === 'Escape' || key === 'Esc' || key === 'p' || key === 'P') {
      releaseHeld();
      holdUntilUp(key);
      leave();
    } else if (key === 'ArrowLeft') step(-1, false);
    else if (key === 'ArrowRight') step(1, false);
    else if (key === ' ' || key === 'Spacebar') {
      // a button pressed with Space is the button's
      if (onButton) return;
      togglePlay();
    } else if (key === 'a' || key === 'A') cycleAdvance();
    else if (key === 'h' || key === 'H') toggleHotspots();
    else return;
    event.preventDefault();
  }

  // The keys that may be held on past the leave: the one that left
  // (Escape, P; Escape too when the browser's own Escape ended full
  // screen), and Enter and Space, which press a button (Leave) and would
  // press Present, where the focus goes, on their repeats. Their repeats
  // are kept from the shell, the map and the button until each comes up
  // (SV2-31d: a held Escape's repeats reached the map, which shuts a card
  // on Escape, and the shell; SV2-31e: a held Enter on Leave entered
  // again). A key pressed afresh ends it for all; a keyup, for that key.
  const heldKeys = new Set();
  function onHeldKey(event) {
    if (event.type === 'keyup') {
      heldKeys.delete(event.key);
      if (heldKeys.size === 0) releaseHeld();
      return;
    }
    if (!heldKeys.has(event.key) || !event.repeat) {
      releaseHeld();
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  }
  function holdUntilUp(...keys) {
    if (heldKeys.size === 0) {
      document.addEventListener('keydown', onHeldKey, true);
      document.addEventListener('keyup', onHeldKey, true);
    }
    for (const key of keys) heldKeys.add(key);
  }
  function releaseHeld() {
    if (heldKeys.size === 0) return;
    heldKeys.clear();
    document.removeEventListener('keydown', onHeldKey, true);
    document.removeEventListener('keyup', onHeldKey, true);
  }

  // Listened for from the start to the section's unmount, so that a grant
  // coming after the mode was left still finds somebody to give it back.
  function onFullscreenChange() {
    const element = fullscreenElement();
    if (element === root) {
      if (presenting) {
        how = 'fullscreen';
        root.dataset.present = 'fullscreen';
      } else {
        // granted after the mode was left (Escape before the browser answered)
        exitFull();
      }
      return;
    }
    // the browser's own way out: its Escape, held, repeats into the page
    // as the in-page one would (SV2-31e)
    if (presenting && how === 'fullscreen') {
      holdUntilUp('Escape');
      leave();
    }
  }
  function onFullscreenError() {
    refused();
  }

  function exitFull() {
    if (fullscreenElement() !== root) return;
    const out = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      const done = out ? out.call(document) : null;
      if (done && typeof done.catch === 'function') done.catch(() => {});
    } catch (error) { /* already out */ }
  }
  const FULLSCREEN_EVENTS = [['fullscreenchange', onFullscreenChange], ['webkitfullscreenchange', onFullscreenChange], ['fullscreenerror', onFullscreenError], ['webkitfullscreenerror', onFullscreenError]];
  for (const [name, fn] of FULLSCREEN_EVENTS) document.addEventListener(name, fn);

  function refused() {
    if (!presenting || how === 'fullscreen') return;
    root.dataset.presentRefused = 'true';
    if (memory.refusedSaid) return;
    memory.refusedSaid = true;
    say(REFUSED_SAYS);
  }

  // Everything beside the section's element, up to the body, out of reach
  // while the presentation lasts; the shell's live regions are left to speak.
  function inertOutside() {
    const made = [];
    for (let node = root; node && node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.inert || sibling.matches('[aria-live], [role="status"], [role="alert"], script, style, link')) continue;
        sibling.inert = true;
        made.push(sibling);
      }
    }
    return made;
  }

  function can() {
    return root.isConnected && !plan.element.hidden && Boolean(view());
  }

  // ---- in
  // `by` is 'pointer' for a tap or a click, else the keyboard
  function enter(by) {
    if (presenting || gone || !can()) return;
    const movement = view();
    const choice = env.choice();
    const pb = playback();
    const v = plan.view;
    saved = {
      transition: choice.transition,
      floors: choice.floors,
      zoom: v.zoom,
      x: v.x,
      y: v.y,
      fitted: plan.fitted,
      width: v.width,
      height: v.height,
      scroll: root.scrollTop,
      playing: Boolean(pb && pb.playing),
      seconds: pb ? pb.seconds : 0,
      started: Boolean(pb && pb.started),
    };
    presenting = true;
    how = 'window';
    gesture = null;
    dropLate();
    dropRestore();
    focusLater = false;
    root.dataset.present = 'window';
    delete root.dataset.presentRefused;
    for (const part of parts) part.hidden = false;
    madeInert = inertOutside();
    plan.setLabelScale(LABEL_SCALE);
    // the panel drawn first: how tall it must be under the map is its first row of groups
    drawnKey = null;
    draw(true);
    modeFitted = true;
    fitMode(false);
    plan.paint();
    copyClock();
    advance = 0;
    schedule();
    line.textContent = '';
    line.dataset.shown = 'false';
    touch.dataset.shown = 'false';
    held = false;
    // entered by a finger or a mouse: the controls come with it, for the next tap
    lastInput = by === 'pointer' ? 'pointer' : 'key';
    if (lastInput === 'pointer') showControls();
    document.addEventListener('keydown', onKey, true);
    for (const type of POINTER_EVENTS) root.addEventListener(type, onPointer, true);
    // the section taken off the page while presenting (Back, a link): let go of everything
    watchGone = new MutationObserver(() => {
      if (!root.isConnected) leave();
    });
    watchGone.observe(document.body, { childList: true, subtree: true });
    watchClock = new MutationObserver(copyClock);
    watchClock.observe(bar, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-playing'] });
    panel.focus({ preventScroll: true });
    // the whole screen, on the reader's press
    const ask = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!ask) {
      refused();
      return;
    }
    try {
      const asked = ask.call(root, { navigationUI: 'hide' });
      // granted after the mode was left, onFullscreenChange gives it back
      if (asked && typeof asked.then === 'function') asked.then(() => onFullscreenChange(), () => refused());
    } catch (error) {
      refused();
    }
  }

  // ---- out
  // `away`: the section is leaving the page (unmount): the choice is put
  // back for the next mount, and nothing else is drawn or focused
  function leave(away) {
    if (!presenting) return;
    presenting = false;
    for (const id of [advanceTimer, controlsTimer, lineTimer]) if (id !== null) timers.clear(id);
    advanceTimer = null;
    controlsTimer = null;
    lineTimer = null;
    advance = 0;
    due = null;
    stopDue();
    stopArrange();
    modeFitted = false;
    delete root.dataset.presentAdvance;
    delete root.dataset.presentFit;
    document.removeEventListener('keydown', onKey, true);
    for (const type of POINTER_EVENTS) root.removeEventListener(type, onPointer, true);
    gesture = null;
    if (watchGone) watchGone.disconnect();
    if (watchClock) watchClock.disconnect();
    watchGone = null;
    watchClock = null;
    for (const each of madeInert) each.inert = false;
    madeInert = [];
    how = null;
    const wasFull = fullscreenElement() === root;
    exitFull();
    // the window comes back when full screen is over: the map is put back after the section measures it there
    if (wasFull && !away) armLate();
    delete root.dataset.present;
    delete root.dataset.presentRefused;
    for (const part of parts) part.hidden = true;
    plan.setLabelScale(1);
    // leaving the page: the section is not drawn again; what it is to remember is handed back
    if (away) return { transition: saved.transition, floors: saved.floors };
    if (!root.isConnected) return null;
    // Enter or Space held on Leave: their repeats do not press Present (holdUntilUp)
    holdUntilUp('Enter', ' ');
    restore();
    return null;
  }

  // The end of a full screen that outlasts the leave (the browser slow to
  // give it up, or refusing to): the map is looked for again then and the
  // focus given, unless the reader has acted since, whose zoom and focus
  // stand (the map moved: dropRestore, from onCell; a key or a press: the
  // focus is theirs). Let go when it comes, on the next entry and on
  // unmount (SV2-31d: a full screen ending after the section had left
  // focused the next section).
  let late = null;
  function armLate() {
    dropLate();
    const over = () => {
      if (fullscreenElement() === root) return;
      dropLate();
      // looked for again, for as long again: the section is measured at its size a frame or two after
      if (pendingRestore && !presenting) lookForPut();
      // a focus outside the section that the full screen held off (focusBack)
      if (focusLater && !presenting) focusBack();
    };
    const acted = (event) => {
      if (event.repeat) return;
      focusLater = false;
    };
    late = { over, acted };
    document.addEventListener('fullscreenchange', over);
    document.addEventListener('webkitfullscreenchange', over);
    document.addEventListener('keydown', acted, true);
    document.addEventListener('pointerdown', acted, true);
  }
  function dropLate() {
    if (!late) return;
    document.removeEventListener('fullscreenchange', late.over);
    document.removeEventListener('webkitfullscreenchange', late.over);
    document.removeEventListener('keydown', late.acted, true);
    document.removeEventListener('pointerdown', late.acted, true);
    late = null;
  }
  // the map is no longer to be put back (the reader moved it, or the section left)
  function dropRestore() {
    pendingRestore = null;
    if (restoreTimer !== null) timers.clear(restoreTimer);
    restoreTimer = null;
    stopLook();
  }

  // the transition and floors as they were; a card open on a cell stays on its cell
  function putChoice(was) {
    const choice = env.choice();
    const patch = {};
    if (choice.transition !== was.transition) patch.transition = was.transition;
    if (choice.floors !== was.floors) patch.floors = was.floors;
    if (Object.keys(patch).length === 0) return;
    // a change of floors shuts a card (Movement's change): this one is put
    // back; with the floors as they were, putView puts it back on its cell
    const held = env.tapped();
    env.change(patch, { keepCard: true });
    if (held && 'floors' in patch) env.reopen(held);
  }

  function restore() {
    const was = saved;
    putChoice(was);
    const pb = playback();
    if (pb) {
      if (!was.started && pb.started && was.transition !== null) {
        // markers that were not on the map go again: All, then the transition back, as the strip does
        pb.pause();
        env.change({ transition: null });
        env.change({ transition: was.transition });
      } else if (was.started) {
        pb.seek(was.seconds);
      }
      if (was.playing && !pb.playing) pb.play();
      if (!was.playing && pb.playing) pb.pause();
    }
    root.scrollTop = was.scroll;
    // the map's zoom and place, once its stage has been measured back in the
    // section: a full screen gives the window back only after the attribute
    // goes, so the first measure can still be at the screen's size. The
    // stage need not be the size it was (the playback's hint line goes once
    // playback has run), so nothing waits for that size itself.
    pendingRestore = was;
    lookForPut();
    focusBack();
  }

  // Full screen ends after the attribute goes, and the section may already
  // be at its size by then, so no resize follows: each frame looks again
  // until the map is put back, and no longer than RESTORE_WAIT_MS, when the
  // map is put back as it is. A full screen the browser will not give up
  // (exitFullscreen refused) stops the looking there (SV2-31c: it spun a
  // frame at a time for as long); its end, whenever it comes, looks again
  // (leave's listener).
  function lookForPut() {
    if (restoreTimer !== null) timers.clear(restoreTimer);
    restoreTimer = timers.set(() => {
      restoreTimer = null;
      putView();
    }, RESTORE_WAIT_MS, 'restore');
    stopLook();
    const look = () => {
      lookFrame = null;
      tryPut();
      if (pendingRestore && !presenting && restoreTimer !== null) lookFrame = requestAnimationFrame(look);
    };
    lookFrame = requestAnimationFrame(look);
  }
  function stopLook() {
    if (lookFrame !== null) cancelAnimationFrame(lookFrame);
    lookFrame = null;
  }

  // Present, where it has a box; folded away with the controls on a phone,
  // the button that opens them (Change), or the map; with no map (the
  // project left with nothing to draw while presenting) the shell's region
  // of the section (#surface): never the page's body (SV2-31c)
  function focusBack() {
    focusLater = false;
    const drawn = (el) => el && el.isConnected && el.getClientRects().length > 0;
    if (drawn(button)) {
      button.focus();
      return;
    }
    const change = root.querySelector('[data-action="change"]');
    if (drawn(change)) {
      change.focus();
      return;
    }
    if (drawn(plan.canvas) && plan.focus() !== false && document.activeElement === plan.canvas) return;
    // with no map, the section's empty card, its heading first, which says
    // what the section needs (SV2-31d; it had been the shell's region, main,
    // which reads nothing). The card and not its heading: the section draws
    // the card's insides again on each change of the project, and a focus on
    // the heading went to the page with it (a refresh after the leave did).
    // Outside the section, which is still the full-screen element until the
    // browser has let go, nothing takes the focus: it is given when full
    // screen ends
    const card = root.querySelector('.mov-empty:not([hidden])');
    if (drawn(card)) {
      if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
      card.focus({ preventScroll: true });
      if (document.activeElement === card) return;
    }
    if (ctx.focusSurface) ctx.focusSurface();
    if (fullscreenElement() === root && !root.contains(document.activeElement)) focusLater = true;
  }

  function putView() {
    const was = pendingRestore;
    // still at the screen's size (full screen granted late, and being given back): later
    if (!was || presenting || gone || fullscreenElement() === root) return;
    pendingRestore = null;
    if (restoreTimer !== null) timers.clear(restoreTimer);
    restoreTimer = null;
    // the scroll again, now the section is its own height (set while it was
    // still the screen's, it was cut to 0), before Fit, which follows it
    root.scrollTop = was.scroll;
    if (was.fitted) plan.fit(true);
    // a zoom the reader made, off Fit, with nothing said to the section (a card open on a cell stays)
    else plan.setView({ zoom: was.zoom, x: was.x, y: was.y });
    // neither tells the section the map moved: a card the reader tapped open
    // is put back beside its cell, not left where the mode's map had it (SV2-31c)
    const held = env.tapped();
    if (held) env.reopen(held);
    plan.paint();
    root.dataset.presentRestored = String(Number(root.dataset.presentRestored || 0) + 1);
  }

  // the stage back at its size: the map goes back where it was
  // once full screen is over and the plan map has measured its stage there
  function tryPut() {
    if (pendingRestore && fullscreenElement() !== root && plan.view.width === plan.stage.clientWidth && plan.view.height === plan.stage.clientHeight) putView();
  }
  const stageWatch = new ResizeObserver(() => {
    // the project left with nothing to draw (the map hidden): nothing to present
    if (presenting && plan.element.hidden) {
      leave();
      return;
    }
    tryPut();
    if (presenting) draw(false);
  });
  stageWatch.observe(plan.stage);
  // each time the floors are laid out (a step, an answer, a change of theme,
  // the stage at another size): the mode's Fit again, and the panel
  let layouts = 0;
  let layoutOff = plan.onLayout(() => {
    layouts += 1;
    if (!presenting || gone) return;
    fitMode(true);
    draw(false);
  });
  // the reader moving the map (a drag, the wheel, a pinch) ends the mode's Fit
  plan.onCell((event) => {
    if (event.kind !== 'view' || fitting) return;
    if (presenting) {
      // under a finger or a mouse: judged when it lifts (track)
      if (gesture) gesture.moved = true;
      else modeFitted = false;
      return;
    }
    // left, and the reader moved the map before it was put back: it stays
    // where they moved it (SV2-31d: a full screen that ended late put it back over them)
    if (pendingRestore) dropRestore();
  });
  // the map's labelScale for what the section's marks write (the hotspot ranks, ./hotspots.js)
  Object.defineProperty(env, 'labelScale', { configurable: true, enumerable: true, get: () => plan.labelScale });

  // the section leaving the page
  function unmount() {
    if (gone) return null;
    const kept = leave(true) || null;
    gone = true;
    if (layoutOff) layoutOff();
    layoutOff = null;
    dropRestore();
    dropLate();
    releaseHeld();
    focusLater = false;
    stageWatch.disconnect();
    phone.removeEventListener('change', placeButton);
    for (const [name, fn] of FULLSCREEN_EVENTS) document.removeEventListener(name, fn);
    if (active === me) active = null;
    return kept;
  }

  const me = { root, enter: () => enter('key'), can, get presenting() { return presenting; } };
  active = me;

  root.present = {
    get presenting() { return presenting; },
    get how() { return how; },
    get advance() { return advance; },
    get due() { return due !== null; },
    get hotspots() { return memory.hotspots; },
    get controls() { return touch.dataset.shown === 'true'; },
    get saved() { return saved; },
    // the mode's Fit holds (fitMode), the map not moved by the reader since
    get fitted() { return presenting && modeFitted; },
    // a frame is asked to put the map back (restore's look)
    get looking() { return lookFrame !== null; },
    // how many times the floors were laid out with this listening (plan.onLayout)
    get layouts() { return layouts; },
    enter: () => enter('key'),
    leave: () => leave(),
    timers(given) {
      timers = given || realTimers;
    },
  };

  return { button, enter: () => enter('key'), leave: () => leave(), unmount };
}
