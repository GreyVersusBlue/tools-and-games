// Presentation mode (spec 15): the movement view on a projector. The tool's
// controls are hidden, the map fills the screen at Fit, its labels and the
// legend are 1.5 times their size, a key of the groups on the map stays
// beside it with the load bands, and a summary of the busiest places can be
// shown or hidden. Arrow keys step through the transitions, an auto-advance
// steps every 5, 10 or 15 seconds, the playback runs inside it, and Escape
// leaves with the section as it was.
//
//   presentMode({ ctx, plan, env, bar, root, places }) -> { button, enter(), leave() }
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
//   button   "Present"; the key is P
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
// visit; when the browser grants it, data-present is "fullscreen". Leaving
// full screen by the browser's own means (its Escape, its menu) leaves the
// presentation too. Everything outside the element is made inert while it
// lasts, but the shell's live regions, so neither Tab nor a screen reader
// wanders under it.
//
// Keys while presenting (listed in Help through ctx.shortcuts, PRESENT_KEYS):
// Left and Right step (the first from All is the first transition), Space
// plays and pauses, A cycles the auto-advance off, 5, 10, 15 s, H shows or
// hides the hotspot summary, Escape leaves. Every other key is kept from the
// shell and the map, so a digit does not change section under the screen and
// Ctrl+Z does not change the project unseen.
//
// Leaving puts back the transition, the floors, the map's zoom and place (or
// its fit), the playback where it was, the section's scroll and the focus on
// Present.
//
// For the tests, on the section's element:
//   root.present   { presenting, how, advance, hotspots, controls, saved,
//                    enter(), leave(), timers({ set(fn, ms, what), clear(id) }) }
// `timers` replaces setTimeout for the auto-advance, the fading of the
// controls and of the corner line, so a test can run each one when it wants.

import { h } from '../components/dom.js';
import { singleKeyAllowed } from '../components/shortcuts.js';
import { dialogIsOpen } from '../components/dialog.js';
import { count } from '../components/words.js';
import { parse, readable } from '../colour.js';
import { bandText } from './legend.js';
import { unitWord } from './model.js';
import { hotspotRows, placeWords } from './hotspots.js';

// The keys, for Help, under Movement (Help explains each group it lists,
// ui/help/content.js). The section answers them itself (below).
export const PRESENT_KEYS = [
  { id: 'movement-present', group: 'Movement', does: 'Present the movement view on the whole screen', shown: 'P' },
  { id: 'present-step', group: 'Movement', does: 'In presentation mode: the previous or the next transition', shown: 'Left, Right' },
  { id: 'present-play', group: 'Movement', does: 'In presentation mode: play or pause the playback', shown: 'Space' },
  { id: 'present-advance', group: 'Movement', does: 'In presentation mode: step on by itself, off, then every 5, 10 or 15 seconds', shown: 'A' },
  { id: 'present-hotspots', group: 'Movement', does: 'In presentation mode: show or hide the busiest places', shown: 'H' },
  { id: 'present-leave', group: 'Movement', does: 'Leave presentation mode', shown: 'Esc' },
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
  if (!singleKeyAllowed(event) || dialogIsOpen()) return;
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
  let madeInert = [];
  let watchGone = null;
  let watchClock = null;
  let drawnKey = null;

  const view = () => root.movement || null;
  const playback = () => bar.playback;

  // ---- the button
  const button = h('button', { type: 'button', class: 'btn mov-present', 'aria-keyshortcuts': 'P', title: 'Show the map on the whole screen, for a projector (P)', data: { action: 'present' }, on: { click: () => enter() } }, 'Present');

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
  const parts = [panel, caption, line, touch];
  for (const part of parts) part.hidden = true;
  root.append(panel);
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
    hotNote.textContent = !state.results ? 'Still being worked out.' : picture.mode === 'single' ? 'One group on the map: there is no load to rank.' : 'Nobody crosses a corridor here.';
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
    if (event.type === 'pointermove' && event.pointerType !== 'mouse') return;
    if (event.type === 'pointerdown') lastInput = 'pointer';
    showControls();
  }
  touch.addEventListener('focusin', () => {
    if (!presenting || lastInput !== 'key') return;
    held = true;
    touch.dataset.shown = 'true';
  });
  touch.addEventListener('focusout', (event) => {
    if (touch.contains(event.relatedTarget) || !held) return;
    held = false;
    if (presenting) showControls();
  });

  // ---- stepping, playing, the auto-advance, the summary
  function step(by, wrap) {
    const movement = view();
    const picture = movement && movement.picture;
    if (!presenting || !picture) return;
    const n = picture.transitions.length;
    const to = stepTo(picture.choice.transition, by, n, wrap);
    if (to === null) {
      say(n === 0 ? 'This day has no transition to show.' : by > 0 ? 'This is the last transition of the day.' : 'This is the first transition of the day.');
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
    root.dataset.presentAdvance = String(advance);
    if (!presenting || advance === 0) return;
    advanceTimer = timers.set(() => {
      advanceTimer = null;
      if (!presenting || !root.isConnected) return;
      step(1, true);
    }, advance * 1000, 'advance');
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
    if (event.key === 'Tab') return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const onButton = event.target && event.target.closest ? event.target.closest('button') : null;
    const key = event.key;
    if (key === 'Escape' || key === 'Esc') leave();
    else if (key === 'ArrowLeft') step(-1, false);
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

  function onFullscreenChange() {
    const element = fullscreenElement();
    if (element === root) {
      if (presenting) {
        how = 'fullscreen';
        root.dataset.present = 'fullscreen';
      }
      return;
    }
    // the browser's own way out
    if (presenting && how === 'fullscreen') leave();
  }

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
  function enter() {
    if (presenting || !can()) return;
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
    pendingRestore = null;
    root.dataset.present = 'window';
    delete root.dataset.presentRefused;
    for (const part of parts) part.hidden = false;
    madeInert = inertOutside();
    plan.setLabelScale(LABEL_SCALE);
    plan.fit(true);
    plan.paint();
    drawnKey = null;
    draw(true);
    copyClock();
    advance = 0;
    schedule();
    line.textContent = '';
    line.dataset.shown = 'false';
    touch.dataset.shown = 'false';
    held = false;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    root.addEventListener('pointerdown', onPointer, true);
    root.addEventListener('pointermove', onPointer, true);
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
      if (asked && typeof asked.then === 'function') asked.then(() => onFullscreenChange(), () => refused());
    } catch (error) {
      refused();
    }
  }

  // ---- out
  function leave() {
    if (!presenting) return;
    presenting = false;
    for (const id of [advanceTimer, controlsTimer, lineTimer]) if (id !== null) timers.clear(id);
    advanceTimer = null;
    controlsTimer = null;
    lineTimer = null;
    advance = 0;
    delete root.dataset.presentAdvance;
    document.removeEventListener('keydown', onKey, true);
    root.removeEventListener('pointerdown', onPointer, true);
    root.removeEventListener('pointermove', onPointer, true);
    if (watchGone) watchGone.disconnect();
    if (watchClock) watchClock.disconnect();
    watchGone = null;
    watchClock = null;
    for (const each of madeInert) each.inert = false;
    madeInert = [];
    how = null;
    if (fullscreenElement() === root) {
      const out = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const done = out ? out.call(document) : null;
        if (done && typeof done.catch === 'function') done.catch(() => {});
      } catch (error) { /* already out */ }
    }
    // the browser's own way out is over by the time its event comes; ours is now
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    // the window comes back when full screen is over: the map is put back after the section measures it there
    if (fullscreenElement() === root) {
      const over = () => {
        if (fullscreenElement() === root) return;
        document.removeEventListener('fullscreenchange', over);
        document.removeEventListener('webkitfullscreenchange', over);
        requestAnimationFrame(tryPut);
      };
      document.addEventListener('fullscreenchange', over);
      document.addEventListener('webkitfullscreenchange', over);
    }
    delete root.dataset.present;
    delete root.dataset.presentRefused;
    for (const part of parts) part.hidden = true;
    plan.setLabelScale(1);
    if (!root.isConnected) return;
    restore();
  }

  function restore() {
    const was = saved;
    const choice = env.choice();
    if (choice.transition !== was.transition || choice.floors !== was.floors) env.change({ transition: was.transition, floors: was.floors });
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
    if (restoreTimer !== null) timers.clear(restoreTimer);
    restoreTimer = timers.set(() => {
      restoreTimer = null;
      putView();
    }, RESTORE_WAIT_MS, 'restore');
    // full screen ends after the attribute goes, and the section may already
    // be at its size by then, so no resize follows: each frame looks again
    // until the map is put back (or the timer above does it)
    const look = () => {
      tryPut();
      if (pendingRestore && !presenting) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    button.focus();
  }

  function putView() {
    const was = pendingRestore;
    if (!was || presenting) return;
    const v = plan.view;
    pendingRestore = null;
    if (restoreTimer !== null) timers.clear(restoreTimer);
    restoreTimer = null;
    // the scroll again, now the section is its own height (set while it was
    // still the screen's, it was cut to 0), before Fit, which follows it
    root.scrollTop = was.scroll;
    if (was.fitted) {
      plan.fit(true);
    } else {
      // a zoom the reader made: the map is no longer at Fit (a zoom button is
      // the plan map's way to say so), then at the zoom and place it had
      const zoomIn = plan.stage.querySelector('[data-action="zoom-in"]');
      if (zoomIn) zoomIn.click();
      v.zoom = was.zoom;
      v.x = was.x;
      v.y = was.y;
    }
    plan.paint();
    root.dataset.presentRestored = String(Number(root.dataset.presentRestored || 0) + 1);
  }

  // the stage back at its size: the map goes back where it was
  // once full screen is over and the plan map has measured its stage there
  function tryPut() {
    if (pendingRestore && fullscreenElement() !== root && plan.view.width === plan.stage.clientWidth && plan.view.height === plan.stage.clientHeight) putView();
  }
  const stageWatch = new ResizeObserver(() => {
    tryPut();
    if (presenting) draw(false);
  });
  stageWatch.observe(plan.stage);
  // each time the section draws its picture again (a step, an answer, a change of theme)
  plan.onLayout(() => {
    if (presenting) draw(false);
  });

  const me = { root, enter, can, get presenting() { return presenting; } };
  active = me;

  root.present = {
    get presenting() { return presenting; },
    get how() { return how; },
    get advance() { return advance; },
    get hotspots() { return memory.hotspots; },
    get controls() { return touch.dataset.shown === 'true'; },
    get saved() { return saved; },
    enter,
    leave,
    timers(given) {
      timers = given || realTimers;
    },
  };

  return { button, enter, leave };
}
