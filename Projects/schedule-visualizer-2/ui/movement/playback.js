// The playback bar along the bottom of the movement view (DESIGN 5.3, spec
// 8.1): it walks the groups on screen through one transition, each a marker
// on the map (ui/surface/overlays/markers.js).
//
//   playbackBar(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js. The bar's height
// is whatever its contents take; the map gives it the room.
//
// Where a group is at a second is the crowd model's answer
// (state.results.crowd: per transition, per group, `positions`), read through
// routePath for what each index of a path is. The bar never walks anybody
// itself. The clock is seconds into the transition, as the model counts
// them; every choice here (speed, pace) changes how fast the clock runs and
// nothing about where a group is at a given second.
//
//   Play / Pause, Previous, Next   one transition at a time; the strip above
//                                  the map jumps to any of them
//   the scrubber                   a range input, a second a step: the
//                                  keyboard's way through a transition
//   the clock and the countdown    the time of day when the bells are known,
//                                  and the passing time running out
//   Speed, Loop                    0.5× to 4×; once, this transition, the whole day
//   More                           pace (a fixed length a transition, or real
//                                  walking pace), style, marker size, and
//                                  everyone at once or one group after another
//
// The map shows no marker until playback is started (Play, or the scrubber);
// choosing "All" on the strip puts them away again. A group still walking
// when the passing time is over is late by the crowd model's own rule
// (isLate): its marker changes shape, the bar names it, and the card of a
// cell says so beside who is there now (env.card.extra).
//
// The clock advances by the time between animation frames, not by counting
// them, so a slow machine shows the same seconds. With reduced motion asked
// for (prefers-reduced-motion) nothing moves by itself: the scrubber is the
// only way through, and the bar says so.
//
// The settings are remembered in `sv2:device` under `playback`
// (storage/device.js). The bar's stylesheet is in this file (PLAYBACK_CSS)
// until movement.css takes it.
//
// For the tests and the console, on the bar's element:
//
//   element.playback   { seconds, end, playing, started, prefs, scene, mark,
//                        now(), seek(seconds), play(), pause(), set(patch),
//                        frames({ request, cancel }) }
//
// `frames` replaces requestAnimationFrame for the playback clock alone, so a
// test can hand it the frames' times; `mark.drawn` is where the markers were
// last put on the map.

import { h, uid } from '../components/dom.js';
import { choice as segmented } from '../components/choice.js';
import { periodWords } from '../components/words.js';
import { formatTime, parseTime } from '../../engine/bells.js';
import { routingGraph } from '../../engine/routing.js';
import { routePath, isLate } from '../../engine/crowd.js';
import { readPlayback, writePlayback, PLAYBACK_SPEEDS } from '../../storage/device.js';
import { markersMark, trackOf, headAt, coveredBy } from '../surface/overlays/markers.js';

// At the fixed pace and 1×, how long a transition takes to watch, and how
// long each group's turn takes when they walk one after another.
export const FIXED_SECONDS = 20;
export const TURN_SECONDS = 8;
// A gap between two frames longer than this is a tab that was put away, not
// a slow machine: the clock does not jump over it.
export const MAX_GAP_MS = 1000;

export const REDUCED_LINE = 'Reduced motion is on, so nothing moves by itself: move the scrubber to walk the groups.';

const LOOPS = [{ value: 'once', label: 'Once' }, { value: 'transition', label: 'This transition' }, { value: 'day', label: 'The whole day' }];

export const PLAYBACK_CSS = `
.mov-pb { display: grid; gap: var(--s-2); }
.mov-pb__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.mov-pb__steps { display: inline-flex; gap: var(--s-1); }
.mov-pb__play { min-width: 5rem; }
.mov-pb__scrub { flex: 1 1 10rem; min-width: 8rem; height: 36px; margin: 0; accent-color: var(--accent); }
.mov-pb__scrub:disabled { opacity: 0.5; }
.mov-pb__time { display: grid; min-width: 9.5rem; font-variant-numeric: var(--numeric); }
.mov-pb__clock { font-family: var(--font-plan); font-size: var(--t-lg); font-weight: var(--w-semibold); line-height: 1.1; }
.mov-pb__countdown { font-size: var(--t-xs); line-height: var(--lh-xs); color: var(--ink-2); }
.mov-pb__countdown[data-over="true"] { color: var(--problem); font-weight: var(--w-semibold); }
.mov-pb__pick { display: inline-flex; align-items: center; gap: var(--s-1); font-size: var(--t-sm); }
.mov-pb__select { width: auto; height: 36px; padding: 0 var(--s-2); border: var(--border-width) solid var(--line-strong); border-radius: var(--r-1); background: var(--card); }
.mov-pb__more { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-5); padding-top: var(--s-2); border-top: var(--border); }
.mov-pb__more[hidden], .mov-pb__line[hidden] { display: none; }
.mov-pb__set { display: grid; gap: var(--s-1); min-width: 0; }
.mov-pb__label { font-size: var(--t-xs); line-height: var(--lh-xs); font-weight: var(--w-semibold); color: var(--ink-2); }
.mov-pb__line { margin: 0; font-size: var(--t-sm); line-height: var(--lh-sm); color: var(--ink-2); }
.mov-pb__line--late { color: var(--problem); font-weight: var(--w-semibold); }
.mov-card__now { margin: var(--s-1) 0 0; padding-top: var(--s-1); border-top: var(--border); font-size: var(--t-sm); line-height: var(--lh-sm); }
.mov-card__late { color: var(--problem); font-weight: var(--w-semibold); }
`;

function loadSheet() {
  if (document.querySelector('style[data-sheet="playback"]')) return;
  document.head.append(h('style', { data: { sheet: 'playback' } }, PLAYBACK_CSS));
}

// "0:37", "4:00", "12:05": whole seconds as minutes and seconds.
export function minutesText(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

// The time of day `seconds` after the bell at `from` ("HH:MM"), to the
// second: "1:08:37", or "13:08:37" on a 24-hour clock. '' when there is no bell.
export function clockText(from, seconds, timeFormat) {
  const start = parseTime(from);
  if (start === null) return '';
  const whole = start * 60 + Math.max(0, Math.floor(seconds));
  return formatTime(Math.floor(whole / 60), timeFormat, { suffix: false }) + ':' + String(whole % 60).padStart(2, '0');
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function able(button, on, why) {
  if (on) {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
  } else {
    button.setAttribute('aria-disabled', 'true');
    if (why) button.title = why;
  }
}

export function playbackBar(env) {
  const ctx = env.ctx;
  loadSheet();
  let prefs = readPlayback();
  let state = null;
  // what is played: the transition chosen, and the walks of the groups on screen
  let scene = null;
  let sceneKey = null;
  let walkKey = null;
  // seconds along what is played: into the transition, or along the turns
  let seconds = 0;
  let playing = false;
  let started = false;
  let frame = null;
  let lastStamp = null;
  let lateSaid = '';
  let extraKey = '';
  let refused = false;
  const real = { request: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) };
  let frames = real;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---- the controls
  const playButton = h('button', { type: 'button', class: 'btn btn--primary mov-pb__play', data: { action: 'play' }, on: { click: () => (playing ? pause() : play()) } }, 'Play');
  const previous = h('button', { type: 'button', class: 'btn', 'aria-label': 'Previous transition', data: { action: 'previous' }, on: { click: () => step(-1) } }, 'Previous');
  const next = h('button', { type: 'button', class: 'btn', 'aria-label': 'Next transition', data: { action: 'next' }, on: { click: () => step(1) } }, 'Next');
  const scrub = h('input', { type: 'range', class: 'mov-pb__scrub', min: '0', max: '1', step: '1', value: '0', 'aria-label': 'Seconds into the transition', data: { control: 'scrubber' } });
  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  const clock = h('span', { class: 'mov-pb__clock', data: { part: 'clock' } });
  const countdown = h('span', { class: 'mov-pb__countdown', data: { part: 'countdown' } });
  const speed = h('select', { class: 'mov-pb__select', data: { control: 'speed' } }, PLAYBACK_SPEEDS.map((value) => h('option', { value: String(value) }, value + '×')));
  speed.addEventListener('change', () => set({ speed: Number(speed.value) }));
  const loop = h('select', { class: 'mov-pb__select', data: { control: 'loop' } }, LOOPS.map((each) => h('option', { value: each.value }, each.label)));
  loop.addEventListener('change', () => set({ loop: loop.value }));
  const moreId = uid('playback-more');
  const moreButton = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': moreId, data: { action: 'more' } }, 'More');
  moreButton.addEventListener('click', () => {
    more.hidden = !more.hidden;
    moreButton.setAttribute('aria-expanded', String(!more.hidden));
  });

  const sets = {};
  function setting(key, label, options) {
    const id = uid('playback-' + key);
    sets[key] = segmented({ name: 'playback-' + key, labelledBy: id, value: prefs[key], options, onChange: (value) => set({ [key]: value }) });
    sets[key].element.dataset.control = key;
    return h('div', { class: 'mov-pb__set' }, h('span', { class: 'mov-pb__label', id }, label), sets[key].element);
  }
  const more = h('div', { class: 'mov-pb__more', id: moreId, hidden: true, data: { part: 'more' } },
    setting('pace', 'Pace', [{ value: 'fixed', label: FIXED_SECONDS + ' seconds a transition' }, { value: 'real', label: 'Real walking pace' }]),
    setting('style', 'Style', [{ value: 'tail', label: 'A fading tail' }, { value: 'route', label: 'The whole route behind' }]),
    setting('size', 'Marker size', [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }]),
    setting('order', 'Who walks', [{ value: 'together', label: 'Everyone at once' }, { value: 'turns', label: 'One after another' }]));

  const note = h('p', { class: 'mov-pb__line', hidden: true, data: { part: 'note' } });
  const turn = h('p', { class: 'mov-pb__line', hidden: true, data: { part: 'turn' } });
  const late = h('p', { class: 'mov-pb__line mov-pb__line--late', hidden: true, data: { part: 'late' } });
  const element = h('div', { class: 'mov-bar mov-pb', role: 'group', 'aria-label': 'Playback', data: { bar: 'playback' } },
    h('div', { class: 'mov-pb__row' },
      playButton,
      h('span', { class: 'mov-pb__steps' }, previous, next),
      scrub,
      h('span', { class: 'mov-pb__time' }, clock, countdown),
      h('label', { class: 'mov-pb__pick' }, 'Speed', speed),
      h('label', { class: 'mov-pb__pick' }, 'Loop', loop),
      moreButton),
    more, note, turn, late);

  // ---- what is played
  function count() {
    return state ? state.picture.transitions.length : 0;
  }

  function chosen() {
    return state ? state.picture.choice.transition : null;
  }

  function build() {
    const picture = state.picture;
    const period = picture.choice.transition;
    const results = state.results;
    if (period === null || !picture.transition || !results || !state.graph) return null;
    const crowdDay = results.crowd && Array.isArray(results.crowd.days) ? results.crowd.days.find((day) => day.dayTypeId === picture.dayTypeId) : null;
    const crowd = crowdDay && crowdDay.transitions ? crowdDay.transitions[period] : null;
    const routesDay = results.routes && Array.isArray(results.routes.days) ? results.routes.days.find((day) => day.dayTypeId === picture.dayTypeId) : null;
    if (!crowd || !routesDay) return null;
    const routing = routingGraph(state.project, state.graph);
    const walkers = [];
    let together = crowd.passingSeconds;
    let offset = 0;
    for (const group of picture.groups) {
      const walker = crowd.groups.find((each) => each.groupId === group.id);
      const entry = routesDay.groups.find((each) => each.groupId === group.id);
      const route = entry ? entry.routes[period] : null;
      const track = walker ? trackOf(routing, route, routePath(routing, route)) : null;
      // a group in the same room, or with no route, has nowhere to be drawn
      if (!track || track.slots !== walker.slots) continue;
      const span = Math.max(1, walker.arrived ? walker.total : walker.positions.length - 1);
      walkers.push({ groupId: group.id, name: group.name, colour: group.colour, track, positions: walker.positions, length: walker.length, arrived: walker.arrived === true, total: walker.total, span, offset });
      offset += span;
      together = Math.max(together, span);
    }
    return { transition: picture.transition, passing: crowd.passingSeconds, margin: crowd.marginSeconds, step: routing.secondsPerCell, walkers, together, turns: offset };
  }

  function inTurns() {
    return prefs.order === 'turns' && scene !== null && scene.walkers.length > 0;
  }

  function end() {
    if (!scene) return 0;
    return inTurns() ? scene.turns : scene.together;
  }

  // Who is walking at this second, and what their clock reads.
  function now() {
    if (!scene) return null;
    if (!inTurns()) return { clock: seconds, walkers: scene.walkers, turn: null };
    let at = scene.walkers.length - 1;
    for (let i = 0; i < scene.walkers.length; i += 1) {
      if (seconds < scene.walkers[i].offset + scene.walkers[i].span) {
        at = i;
        break;
      }
    }
    return { clock: seconds - scene.walkers[at].offset, walkers: [scene.walkers[at]], turn: at };
  }

  // Late by the one rule: a group that is in its room is judged by when it
  // got there, one still walking by the clock.
  function lateAt(walker, at) {
    return isLate(walker.arrived && at >= walker.total ? walker.total : at, scene.passing, scene.margin);
  }

  const mark = markersMark(() => {
    const moment = started ? now() : null;
    if (!moment) return null;
    return {
      step: scene.step,
      style: prefs.style,
      size: prefs.size,
      walkers: moment.walkers.map((walker) => ({ groupId: walker.groupId, colour: walker.colour, track: walker.track, positions: walker.positions, seconds: moment.clock, late: lateAt(walker, moment.clock) })),
    };
  });
  env.marks.push(mark);

  // ---- the clock
  function rate() {
    if (prefs.pace === 'real' || !scene) return 1;
    const moment = now();
    return moment.turn === null ? scene.together / FIXED_SECONDS : moment.walkers[0].span / TURN_SECONDS;
  }

  function stop() {
    playing = false;
    lastStamp = null;
    if (frame !== null) frames.cancel(frame);
    frame = null;
  }

  function tick(stamp) {
    frame = null;
    if (!playing) return;
    // the view was left: nothing is on screen to move
    if (!element.isConnected || !scene) {
      stop();
      return;
    }
    const gap = lastStamp === null ? 0 : Math.min(MAX_GAP_MS, Math.max(0, stamp - lastStamp));
    lastStamp = stamp;
    advance(gap / 1000);
    if (playing && frame === null) frame = frames.request(tick);
  }

  function advance(elapsed) {
    seconds += elapsed * prefs.speed * rate();
    if (seconds >= end()) {
      if (prefs.loop === 'transition') {
        seconds = 0;
        lateSaid = '';
      } else if (prefs.loop === 'day' && count() > 0) {
        seconds = 0;
        lateSaid = '';
        const following = (chosen() + 1) % count();
        // update() comes back with the next transition before this returns
        if (following !== chosen()) env.change({ transition: following });
      } else {
        seconds = end();
        stop();
        ctx.announce(scene.transition.name + ' is played to its end.' + lateWords());
      }
    }
    render();
    env.paint();
  }

  function play() {
    if (reduce.matches || count() === 0 || !state || !state.results) return;
    if (chosen() === null) env.change({ transition: 0 });
    if (!scene) return;
    if (seconds >= end()) {
      seconds = 0;
      lateSaid = '';
    }
    started = true;
    playing = true;
    lastStamp = null;
    if (frame === null) frame = frames.request(tick);
    render();
    env.paint();
  }

  function pause() {
    stop();
    render();
  }

  function seek(to) {
    if (!scene) return;
    seconds = Math.max(0, Math.min(Number.isFinite(to) ? to : 0, end()));
    started = true;
    render();
    env.paint();
  }

  function step(by) {
    if (count() === 0) return;
    const at = chosen();
    const to = at === null ? (by > 0 ? 0 : null) : at + by;
    if (to === null || to < 0 || to >= count()) return;
    env.change({ transition: to });
  }

  function set(patch) {
    try {
      prefs = writePlayback(patch);
    } catch (error) {
      // the choice holds for this visit; the browser keeps nothing, said once
      prefs = { ...prefs, ...patch };
      if (!refused) ctx.toast({ kind: 'warning', text: 'This browser did not keep the playback settings: they last until the page is closed.' });
      refused = true;
    }
    if ('order' in patch) {
      seconds = 0;
      lateSaid = '';
    }
    render();
    env.paint();
  }

  // ---- what the bar says
  function lateNames(moment) {
    return moment.walkers.filter((walker) => lateAt(walker, moment.clock)).map((walker) => walker.name);
  }

  function lateWords() {
    const names = scene ? lateNames(now()) : [];
    return names.length === 0 ? '' : ' Late: ' + names.join(', ') + '.';
  }

  function noteText() {
    if (!state) return '';
    if (count() === 0) return 'There is nothing to play: the day has one ' + periodWords(state.project.settings).one + '.';
    if (!state.results) return 'Working out the routes.';
    if (chosen() === null) return reduce.matches ? 'Playback walks one transition at a time. Choose one above, or press Next for the first.' : 'Playback walks one transition at a time. Press Play for the first, or choose one above.';
    if (!scene) return 'Working out the routes.';
    if (scene.walkers.length === 0) return 'Nobody on screen walks in ' + scene.transition.name + '.';
    return reduce.matches ? REDUCED_LINE : '';
  }

  function render() {
    const moment = now();
    const total = end();
    element.dataset.playing = String(playing);
    element.dataset.started = String(started && scene !== null);
    element.dataset.seconds = String(Math.round(seconds * 1000) / 1000);
    element.dataset.reduced = String(reduce.matches);

    setText(playButton, playing ? 'Pause' : 'Play');
    const ready = Boolean(state && state.results) && count() > 0;
    able(playButton, ready && !reduce.matches, reduce.matches ? 'Reduced motion is on: use the scrubber.' : null);
    able(previous, ready && chosen() !== null && chosen() > 0);
    able(next, ready && (chosen() === null || chosen() + 1 < count()));
    speed.disabled = reduce.matches;
    loop.disabled = reduce.matches;
    if (speed.value !== String(prefs.speed)) speed.value = String(prefs.speed);
    if (loop.value !== prefs.loop) loop.value = prefs.loop;
    for (const key of Object.keys(sets)) sets[key].set(prefs[key]);

    scrub.disabled = !scene;
    const max = String(Math.max(1, Math.ceil(total)));
    if (scrub.max !== max) scrub.max = max;
    const value = String(Math.round(seconds));
    if (scrub.value !== value) scrub.value = value;

    if (!moment) {
      setText(clock, '');
      setText(countdown, '');
      scrub.removeAttribute('aria-valuetext');
    } else {
      const transition = scene.transition;
      const time = transition.times ? clockText(transition.from, moment.clock, state.project.settings.timeFormat) : '';
      const left = scene.passing - Math.floor(moment.clock);
      const into = minutesText(moment.clock) + ' into ' + transition.name;
      setText(clock, time || minutesText(moment.clock));
      const words = transition.times
        ? (left >= 0 ? minutesText(left) + ' to the bell' : minutesText(-left) + ' after the bell')
        : (left >= 0 ? minutesText(left) + ' of the passing time left' : minutesText(-left) + ' over the passing time');
      setText(countdown, words);
      countdown.dataset.over = String(left < 0);
      scrub.setAttribute('aria-valuetext', (time ? time + ', ' : '') + into + ', ' + words);
    }

    const words = noteText();
    setText(note, words);
    note.hidden = words === '';

    if (moment && moment.turn !== null) {
      const walker = moment.walkers[0];
      const key = walker.groupId + ':' + moment.turn;
      if (turn.dataset.key !== key) {
        turn.dataset.key = key;
        turn.replaceChildren(h('bdi', null, walker.name), ', group ' + (moment.turn + 1) + ' of ' + scene.walkers.length + '.');
      }
      turn.hidden = false;
    } else {
      turn.hidden = true;
      delete turn.dataset.key;
    }

    const names = moment && started ? lateNames(moment) : [];
    const lateKey = names.join('\n');
    if (late.dataset.key !== lateKey) {
      late.dataset.key = lateKey;
      late.replaceChildren('Late, still walking after the passing time: ', ...names.flatMap((name, index) => (index === 0 ? [h('bdi', null, name)] : [', ', h('bdi', null, name)])), '.');
    }
    late.hidden = names.length === 0;
    element.dataset.late = String(names.length);
    // a group that has just become late is said once
    if (playing && lateKey !== '' && lateKey !== lateSaid) ctx.announce(names.join(', ') + (names.length === 1 ? ' is late.' : ' are late.'));
    if (lateKey !== '' || !playing) lateSaid = lateKey;

    drawExtra();
  }

  // ---- the cell card: who is at this cell now
  function drawExtra() {
    const card = env.card;
    const moment = started ? now() : null;
    const floorId = card.element.dataset.floor;
    if (!moment || card.element.hidden || floorId === undefined) {
      if (extraKey !== '') card.extra.replaceChildren();
      extraKey = '';
      return;
    }
    const cell = Number(card.element.dataset.cell);
    const here = moment.walkers
      .filter((walker) => coveredBy(walker.track, headAt(walker.positions, moment.clock, scene.step, walker.track.slots), walker.length, floorId, cell))
      .map((walker) => ({ walker, late: lateAt(walker, moment.clock) }));
    const transition = scene.transition;
    const at = transition.times ? clockText(transition.from, moment.clock, state.project.settings.timeFormat) : minutesText(moment.clock) + ' in';
    const key = floorId + ':' + cell + ':' + at + ':' + here.map((each) => each.walker.groupId + (each.late ? '!' : '')).join(',');
    if (key === extraKey) return;
    extraKey = key;
    const line = h('p', { class: 'mov-card__now', data: { part: 'now' } });
    if (here.length === 0) {
      line.append('Nobody is here at ' + at + '.');
    } else {
      line.append('Here at ' + at + ': ');
      here.forEach((each, index) => {
        if (index > 0) line.append(', ');
        line.append(h('bdi', null, each.walker.name));
        if (each.late) line.append(h('span', { class: 'mov-card__late' }, ' (late)'));
      });
      line.append('.');
    }
    card.extra.replaceChildren(line);
  }
  // the card comes and goes with the pointer, between two frames of playback too
  new MutationObserver(drawExtra).observe(env.card.element, { attributes: true, attributeFilter: ['hidden', 'data-floor', 'data-cell'] });

  function onReduce() {
    if (!element.isConnected) {
      reduce.removeEventListener('change', onReduce);
      return;
    }
    if (reduce.matches) stop();
    render();
  }
  reduce.addEventListener('change', onReduce);

  element.playback = {
    get seconds() { return seconds; },
    get end() { return end(); },
    get playing() { return playing; },
    get started() { return started; },
    get prefs() { return prefs; },
    get scene() { return scene; },
    mark,
    now,
    seek,
    play,
    pause,
    set,
    frames(given) {
      const was = playing;
      stop();
      frames = given || real;
      if (was) play();
    },
  };

  return {
    element,
    update(given) {
      state = given;
      const picture = state.picture;
      const walk = picture.dayTypeId + ':' + picture.choice.transition;
      const key = walk + ':' + picture.groups.map((group) => group.id).join(',');
      if (scene === null || key !== sceneKey || scene.results !== state.results || scene.graph !== state.graph) {
        scene = build();
        if (scene) {
          scene.results = state.results;
          scene.graph = state.graph;
        }
        sceneKey = key;
      }
      // another transition, or another day type: from its first second
      if (walk !== walkKey) {
        walkKey = walk;
        seconds = 0;
        lateSaid = '';
      }
      if (picture.choice.transition === null) started = false;
      if (!scene) stop();
      seconds = Math.min(seconds, end());
      render();
    },
  };
}
