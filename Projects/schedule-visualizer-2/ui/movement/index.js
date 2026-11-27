// The Movement section (DESIGN 5.3): a read-only map of the whole building
// with every group's walk drawn on it.
//
//   top       the screen's first line, a sentence; then who, the day type,
//             the transition strip, the two drawing options and Clear (./controls.js)
//   the map   the plan map (ui/surface/plan-map.js): every floor on one
//             canvas (ui/surface/plan-layout.js), drawn by the plan's own
//             renderer, its zoom, its keyboard cursor and its row of
//             floors; here the
//             lanes, the load colouring and the room markers are laid over
//             it (ui/surface/overlays/lanes.js), and the stairs links from
//             floor to floor; the legend card bottom right
//             (./legend.js); a card for the cell under the pointer, the cell
//             tapped, or the cell the keyboard cursor rests on (./card.js)
//   bottom    the playback bar's place (./playback.js)
//   top bar   which floors are on the map, and side by side or stacked (the plan map's row)
//   inspector Hotspots, Travel time, Summary, Export (./hotspots.js,
//             ./tables.js, ./summary.js, ./export.js)
//
// What is drawn comes from ./model.js, which reads the derived results
// (store.derived.results(): routes, crowd, loads, places, walks). They are
// asked for once per state of the project. Until the answer for a change
// comes the last answer stays on the map, drawn against the project it was
// worked out for, and the section reads as pending (`data-pending`). When an
// answer cannot be worked out the first line says so; a last answer that is
// still on the map is then from before the change, and the section reads as
// stale (`data-stale`) until an answer comes.
//
// Where a later unit plugs in. A panel of the inspector and the playback bar
// are each a function of `env` returning { element, update(state) }:
//
//   env    { ctx,
//            choice(), change(patch, { keepCard })   what is chosen on screen (model.js), and changing it
//            show(floorId, cells)         bring cells onto the map
//            overlays                     [(g, view, floor, theme) => {}] drawn over a floor after the lanes
//            marks                        [(g, map) => {}] drawn over the whole map, on a canvas of their
//                                         own laid over the map's (env.layer): map.point(floorId, cell)
//                                         gives a cell's middle in pixels, or null. A mark with a higher
//                                         `order` is drawn over one with a lower (playback's markers 1,
//                                         the hotspot rings 2); the keyboard cursor is over them all.
//            paint()                      draw the map again (an overlay changed); the marks with it
//            paintMarks()                 draw the marks again, now, and nothing else: what a frame of
//                                         playback or a tick of the pulse costs does not grow with the
//                                         building
//            layer                        the marks' canvas
//            card                         the cell card (card.extra is playback's place in it)
//            fix(where) }                 follow a "fix it" link of route health
//   state  { project, results, graph, picture, health, stale }: the project
//          the results are for, the results (null until the first answer),
//          buildGraph's graph, model.js's picture, routeHealth's list, and
//          whether all of it is from before a change whose answer failed
//
// Crowd-aware routes (ARCHITECTURE 23.5, 23.12; DESIGN 17.4, 17.7). While the
// choice's `routes` is 'crowd' (and who is not a teacher) the view asks the
// crowd lane (store.derived.crowd) for the day type and bells on screen, once
// per project, day type and bells, and asks again on a null (a stale asking
// never re-asks by itself). Until the answer comes the usual picture stands
// under a quiet band; a failure says so with Try again and the radio stays on
// Crowd-aware. With the answer, `state.results` is ./crowd-view.js's
// crowdResultsView for every panel, the bar and the card, and nothing else
// learns of the lens; route health and the findings are read from the usual
// results. The section's `data-crowd` is 'off', 'working', 'ready' or 'failed'
// (a test waits on it), and `data-pending` is not touched by it.
//
// The view on screen is at document.querySelector('.mov').movement, for the
// tests and for the console.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { count, figures, periodWords } from '../components/words.js';
import { createViewport } from '../surface/viewport.js';
import { createPlanMap, CURSOR_LEAST, KEEP_ON_STAGE } from '../surface/plan-map.js';
import { lanesOverlay, lanePoint, lineWidth } from '../surface/overlays/lanes.js';
import { drawLink } from './ride-link.js';
import { parse, readable } from '../colour.js';
import { buildGraph } from '../../engine/graph.js';
import { ActionError, setSetting, setOnboarding } from '../../engine/actions.js';
import { MOVEMENT_STEP } from '../help/progress.js';
import { slotHash, openAddress } from '../schedule/index.js';
import { readMovement, writeMovement } from '../../storage/device.js';
import { findBellSchedule } from '../../engine/bells.js';
import { defaultChoice, settleChoice, addGroup, pictureOf, sentenceOf, routeHealth, cellCard, roomCard, standingOf, failedSentence, createAsker, teacherColourOf, NO_ENGINE } from './model.js';
import { readMovementAddress } from './address.js';
import { crowdResultsView, lensOf, usualRouteOf, anotherWay } from './crowd-view.js';
import { slotAt, placeOf, FIT_MARGIN } from '../surface/plan-layout.js';
import { controls, CROWD_FAILED } from './controls.js';
import { legend } from './legend.js';
import { cellCardView } from './card.js';
import { summaryPanel } from './summary.js';
import { hotspotsPanel } from './hotspots.js';
import { tablesPanel } from './tables.js';
import { exportPanel } from './export.js';
import { playbackBar } from './playback.js';
import { presentMode, PRESENT_KEYS } from './present.js';

const HEADLINE = 'This is the movement view.';
const KEYS = 'Arrow keys move the cursor one cell and say what crosses it. Hold Space and press the arrows to move the map. = and - zoom in and out, 0 fits the map to the window. Escape puts the card away.';

// The keys of the map. The map answers them itself, so they are listed for
// Help only (spec 3.15).
export const MOVEMENT_KEYS = [
  { id: 'movement-arrows', does: 'Move the cursor one cell, and say what crosses it', shown: 'Arrows' },
  { id: 'movement-pan', does: 'Move the map', shown: 'Space+Arrows' },
  { id: 'movement-zoom-in', does: 'Zoom in', shown: '=' },
  { id: 'movement-zoom-out', does: 'Zoom out', shown: '-' },
  { id: 'movement-fit', does: 'Fit the map to the window', shown: '0' },
  { id: 'movement-escape', does: 'Put the cell card away', shown: 'Esc' },
];

// The keyboard cursor's least and the keep on the stage are the plan map's.
export { CURSOR_LEAST, KEEP_ON_STAGE };

export const MOVEMENT_TABS = [
  { id: 'hotspots', label: 'Hotspots' },
  { id: 'tables', label: 'Travel time' },
  { id: 'summary', label: 'Summary' },
  { id: 'export', label: 'Export' },
];

// What is chosen here. It outlives a visit to another section, for the
// project that is open.
const memory = { projectId: null, parked: null, bellsName: '', choice: null, tab: 'hotspots', legendFolded: false, controls: null, refused: false };

// The controls are open from this width and folded under it, until the
// reader chooses (DESIGN 5.3); under PHONE the floors' row folds with them.
export const CONTROLS_OPEN_FROM = '(min-width: 900px)';
export const PHONE = '(max-width: 640px)';
export const REFUSED_CHOICE = 'This browser did not keep that choice: it lasts until the page is closed.';

// An address's choice laid over the one the view had (ARCHITECTURE 23.12). A teacher's address says a whole
// day or one transition (none when it names none); a room's leaves a teacher's day for the groups it filters.
export function withAddress(base, named) {
  if (!named) return base;
  if (named.who === 'teacher') return { ...base, ...named, transition: named.transition === undefined ? null : named.transition };
  return { ...base, ...named, who: base.who === 'teacher' ? 'all' : base.who };
}

function first(project) {
  const one = periodWords(project.settings).one;
  const then = figures(project).rooms === 0 ? 'Draw the building and its rooms first.' : 'Add a group and give it its rooms first.';
  return 'It draws every group’s walk between one ' + one + ' and the next, so you can see where the corridors fill and who cannot make it in time. ' + then;
}

function facts(project) {
  const f = figures(project);
  return 'There is nothing to draw yet: this project has ' + count(f.rooms, 'room') + ' and ' + count(f.groups, 'group') + '.';
}

// Open a group's slot in the Schedule section's Groups tab: a slot has an
// address there (the top of ui/schedule/index.js), and the section does the
// rest. It is opened as the schedule opens its own (`openAddress`), so the
// entry is marked by the one rule when the list is under it.
function openSlot(ctx, slot) {
  openAddress(ctx, slotHash(slot.groupId, slot.dayTypeId, slot.period));
}

export const section = {
  id: 'movement',
  label: 'Movement',
  name: 'Movement',
  key: '3',
  icon: 'movement',
  // Once, before anything is mounted: the map's keys go on the shell's list.
  start(ctx) {
    for (const key of MOVEMENT_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Movement', does: key.does, shown: key.shown });
    // Present (P) and the keys of presentation mode, which ./present.js answers
    for (const key of PRESENT_KEYS) ctx.shortcuts.add({ id: key.id, group: key.group, does: key.does, shown: key.shown });
  },
  mount(ctx, rest) {
    const store = ctx.store;
    if (memory.projectId !== store.project.id) memory.parked = null;
    // an address that names a choice (a teacher's day, walks into a room: ./address.js) lays it over the choice the view had
    const named = readMovementAddress(store.project, rest);
    // Routes is Usual on every visit: a lens opened on purpose each time (ARCHITECTURE 23.2)
    const had = memory.projectId === store.project.id && memory.choice ? { ...memory.choice, routes: 'usual' } : defaultChoice(store.project);
    const remembered = withAddress(had, named);
    let choice = settleChoice(store.project, remembered);
    noticeBells(remembered.bellsId);
    // the last answer, the project it was worked out for, and that project's graph
    // The graph of the building as it is: the store keeps one a building (ARCHITECTURE 16, SV2-16).
    const graphNow = () => store.derived.get('graph', ['building'], (project) => buildGraph(project));
    let state = null;
    let picture = null;
    let gone = false;
    // the cell whose card shows: { floorId, cell, source }
    let point = null;
    // the group whose usual route is drawn faint beside its crowd-aware one (Summary's row), or null
    let usualFor = null;
    let bandColours = null;
    let bandKey = null;
    const lineColours = new Map();

    // ---- the map (ui/surface/plan-map.js): the canvas, the marks' canvas,
    // the viewport, the pointer and the keyboard cursor, the zoom buttons and
    // the row of floors, the stage's least and the keep on the stage; its
    // root is this section's element, styled by movement.css (the map loads
    // the sheet). The frame is asked for once the rest below is made.
    const plan = createPlanMap({
      ctx,
      name: 'movement',
      label: 'The movement map',
      keys: KEYS,
      floorsRow: { value: () => choice.floors, change: (value) => change({ floors: value }) },
      frame: () => ({
        before: [headline, top.element],
        after: [key.line, bar.element],
        inside: [staleBand, key.element, card.element],
        head: top.element,
        line: top.element.querySelector('.mov-line'),
        foot: bar.element,
        more: bar.element.querySelector('[data-part="more"]'),
        under: key.line,
      }),
    });
    const { view, canvas, layer, stage } = plan;
    const card = cellCardView({ showInto: (roomId) => showWalksInto(roomId) });
    // with crowd-aware routes the card adds how many groups cross here on each routes (DESIGN 17.4); card.js draws the rest
    const crowdLine = h('p', { class: 'mov-card__crowd', hidden: true, data: { card: 'crowd' } });
    card.element.insertBefore(crowdLine, card.extra);
    const crowdWords = (info) => (info && info.crowd ? 'Crowd-aware: ' + count(info.crowd.aware, 'group') + ' here, usual: ' + info.crowd.usual : '');

    const env = {
      ctx,
      choice: () => choice,
      change,
      show: (floorId, cells) => plan.show(floorId, cells),
      // the plan map's: the lanes are first in it (below), before a panel's own
      overlays: plan.overlays,
      marks: plan.marks,
      paint: () => plan.paint(),
      paintMarks: () => plan.paintMarks(),
      layer,
      card,
      // a group's row chosen in Summary: its usual route is drawn faint beside the crowd-aware one (DESIGN 17.7 item 6)
      usual: () => usualFor,
      showUsual(groupId) {
        usualFor = usualFor === groupId ? null : groupId;
        // the legend names it, Summary's button says it, the map draws it
        refresh();
        return usualFor;
      },
      // who holds an elevator at the second playback shows: { now: [{ groupId,
      // car, label, at }], listeners }; playback writes it, the hotspot table reads it
      rides: { now: [], listeners: new Set() },
      // a card the reader tapped open ({ floorId, cell }, or null), and
      // putting it back beside its cell after the map moved under it with
      // nothing said (presentation mode leaving, ./present.js)
      tapped: () => tapped(),
      reopen: (held) => reopen(held),
      fix(where) {
        if (where.slot) openSlot(ctx, where.slot);
        else ctx.navigate(where.hash);
      },
    };

    // ---- the controls, shown or folded away behind "Change": the reader's
    // choice on this device (sv2:device, `movement.controls`), and the
    // window's width until there is one
    const wide = matchMedia(CONTROLS_OPEN_FROM);
    const phone = matchMedia(PHONE);
    if (memory.controls === null) memory.controls = readMovement().controls;
    const foldedByDefault = () => (memory.controls === null ? !wide.matches : memory.controls === 'folded');

    const top = controls({
      folded: foldedByDefault(),
      fold(folded) {
        memory.controls = folded ? 'folded' : 'open';
        try {
          writeMovement({ controls: memory.controls });
        } catch (error) {
          // the browser keeps nothing: said once, and the choice holds for the visit
          if (!memory.refused) ctx.toast({ kind: 'warning', text: REFUSED_CHOICE });
          memory.refused = true;
        }
        placeFloors();
        // the map and its zoom buttons moved up or down with no change to the stage's size
        plan.dock();
        ctx.announce(folded ? 'The controls are folded away.' : 'The controls are shown.');
      },
      change,
      tryAgain() {
        askCrowd(true);
        refresh();
      },
      add(groupId) {
        const answer = addGroup(choice, groupId);
        // the reason is on screen under the chips already: it is said, not put up again
        if (answer.refused) ctx.announce(answer.refused);
        else change(answer.choice);
      },
      remove: (groupId) => change({ groupIds: choice.groupIds.filter((id) => id !== groupId) }),
      clear() {
        // Clear empties the view: the filters and a teacher go with the groups (spec 7.1)
        change({ who: 'groups', groupIds: [], transition: null, teacherId: null, toRoomId: null, subjectId: null });
        ctx.announce('Cleared: nothing is shown.');
      },
      showMe(tab) {
        // a teacher's walk that does not fit is shown in Travel time, a failed route in Summary
        const to = tab === 'tables' ? 'tables' : 'summary';
        // a sheet over the map on a phone: open it, so what is focused is there to be seen
        ctx.openInspector();
        inspector.select(to);
        memory.tab = to;
        drawPanel();
        if (to === 'summary') panels.summary.focusHealth();
        else panels.tables.focusTable();
      },
    });
    const key = legend({
      folded: memory.legendFolded,
      // the card shown whole again may now lie on a floor (it was measured
      // folded): then it docks, and is brought out over the map, since the
      // reader asked to see it, until its own button puts it away
      fold(folded) {
        memory.legendFolded = folded;
        if (folded) return;
        dockLegend();
        key.bringOut();
      },
      measure: (value) => change({ measure: value }),
      scale(value) {
        try {
          store.apply(setSetting, { key: 'colourScale.mode', value });
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          ctx.toast({ kind: 'problem', text: error.message });
        }
      },
    });
    // the lanes go over each floor before any overlay of a panel's
    plan.overlays.push(lanesOverlay(() => {
      if (!picture) return null;
      const theme = plan.theme();
      return {
        bands: picture.bands,
        bandColours: themeColours(theme),
        lanes: picture.lanes,
        markers: picture.markers,
        labels: choice.labels,
        constantWidth: choice.constantWidth,
        colourOf: (groupId) => lineColour(groupId, theme),
      };
    }));
    const bar = playbackBar(env);
    // over the map while it is the last answer after a derive that failed: the picture is muted under it (movement.css)
    const staleBand = h('p', { class: 'mov-stale', hidden: true, data: { part: 'stale' } }, 'From before your last change');
    const headline = h('h1', { class: 'vh' }, HEADLINE);
    const map = plan.element;
    const empty = h('div', { class: 'mov-empty stub', hidden: true });
    // the section's element is the plan map's root (div.mov), with the map in it
    const element = plan.root;
    element.append(empty);
    // Present (./present.js: presentation mode): at the end of the playback bar's row, or beside Clear on a phone
    const presenter = presentMode({ ctx, plan, env, bar: bar.element, root: element, places: { bar: bar.element.querySelector('.mov-pb__row'), controls: top.element.querySelector('.mov-ctl--options') } });

    // ---- the top bar's second row, the plan map's: on a phone it folds with the controls
    function placeFloors() {
      // the row put away with the focus in it (a window narrowed under 640 px):
      // the focus goes to what brings it back
      if (!plan.showFloors(!map.hidden && !(top.folded && phone.matches))) return;
      if (map.hidden) ctx.focusSurface();
      else top.element.querySelector('[data-action="change"]').focus();
    }
    function onWidth() {
      if (memory.controls === null) top.setFolded(!wide.matches);
      placeFloors();
      dockLegend();
    }
    wide.addEventListener('change', onWidth);
    phone.addEventListener('change', onWidth);
    placeFloors();

    // ---- the inspector
    const panels = { hotspots: hotspotsPanel(env), tables: tablesPanel(env), summary: summaryPanel(env), export: exportPanel(env) };
    const inspector = tabs({
      label: 'What the movement view found',
      selected: MOVEMENT_TABS.some((tab) => tab.id === memory.tab) ? memory.tab : 'summary',
      onSelect(id) {
        memory.tab = id;
        drawPanel();
      },
      items: MOVEMENT_TABS.map((tab) => ({ id: tab.id, label: tab.label, panel: () => panels[tab.id].element })),
    });
    ctx.setInspector(h('div', { class: 'mov-inspector' }, inspector.element));
    function drawPanel() {
      if (state) panels[inspector.selected].update(state);
    }

    // ---- the bell schedule chosen, deleted and brought back
    // A bell schedule that is deleted while it is chosen leaves the view on
    // the regular bells, and says so; if the delete is undone the choice is
    // put back, unless the reader has chosen other bells since.
    function noticeBells(wanted) {
      const project = store.project;
      const schedule = findBellSchedule(project, choice.bellsId);
      if (schedule) memory.bellsName = schedule.name;
      if (typeof wanted === 'string' && !findBellSchedule(project, wanted)) {
        if (!memory.parked || memory.parked.bellsId !== wanted) {
          memory.parked = { bellsId: wanted, name: memory.bellsName || '' };
          ctx.announce((memory.parked.name === '' ? 'The bell schedule' : memory.parked.name + ' bells') + ' ' + (memory.parked.name === '' ? 'was' : 'were') + ' deleted, so the view now shows regular bells.');
        }
      } else if (memory.parked && choice.bellsId === null && findBellSchedule(project, memory.parked.bellsId)) {
        choice = { ...choice, bellsId: memory.parked.bellsId };
        memory.bellsName = findBellSchedule(project, choice.bellsId).name;
        memory.parked = null;
        ctx.announce(memory.bellsName + ' bells are back, so the view shows them again.');
      }
    }

    // ---- what is chosen
    //   options.keepCard   a card the reader tapped open stays on its cell,
    //                      saying what the new choice makes of it (playback
    //                      going on from one transition to the next)
    function change(patch, options) {
      if (patch && 'bellsId' in patch) memory.parked = null;
      choice = settleChoice(store.project, { ...choice, ...patch });
      const held = options && options.keepCard === true && !(patch && 'floors' in patch) ? tapped() : null;
      clearPoint();
      askCrowd();
      refresh();
      reopen(held);
    }

    // the card's "Show walks into Room 204": the filter, nothing else changed
    function showWalksInto(roomId) {
      change({ toRoomId: roomId });
      const room = store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === roomId);
      ctx.announce('Showing walks into ' + (room && typeof room.number === 'string' && room.number.trim() !== '' ? 'room ' + room.number : 'that room') + '.');
    }

    // A card the reader tapped open, and putting it back on its cell after
    // something that clears the card (the map drawn for another choice, or
    // at another size).
    function tapped() {
      return point && point.source === 'tap' ? { floorId: point.floorId, cell: point.cell } : null;
    }
    function reopen(held) {
      const world = plan.world;
      const at = held && world && state ? placeOf(world, held.floorId, held.cell) : null;
      if (at) pointAt(at.x + 0.5, at.y + 0.5, 'tap');
    }

    // ---- the results: asked once per state of the project (model.js's
    // createAsker, which a Node case runs as the view does)
    const asker = createAsker({
      store,
      graph: () => graphNow(),
      gone: () => gone,
      timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
      pending() {
        element.dataset.pending = 'true';
      },
      settled(failed, answered) {
        // the answer is in: nothing is awaited by the time the panels are told (the Export tab reads this)
        if (answered) delete element.dataset.pending;
        refresh();
        if (failed) ctx.announce(failedSentence(standingOf(store.project, asker.derived)).parts.map((part) => part.text).join(''));
      },
    });
    const ask = () => asker.ask();

    // ---- the crowd lane: asked while the choice wants it, once for a project, day type and bells
    const lens = { key: null, project: null, state: 'off', run: null, message: '', retries: 0 };
    const tokens = new WeakMap();
    let tokenCount = 0;
    const keyFor = (project) => {
      if (!tokens.has(project)) tokens.set(project, (tokenCount += 1));
      return tokens.get(project) + '|' + choice.dayTypeId + '|' + (choice.bellsId === null ? '' : choice.bellsId);
    };
    const wantsCrowd = () => choice.routes === 'crowd' && choice.who !== 'teacher';
    function askCrowd(again) {
      if (gone) return;
      if (!wantsCrowd()) {
        // put away: the next time it is asked for is a new asking, and what was said of the last is not kept
        lens.key = null;
        lens.state = 'off';
        lens.run = null;
        lens.project = null;
        lens.retries = 0;
        return;
      }
      const project = store.project;
      const key = keyFor(project);
      if (again !== true && lens.key === key) return;
      lens.key = key;
      lens.project = project;
      lens.state = 'working';
      lens.run = null;
      lens.message = '';
      if (again === true) lens.retries = 0;
      const wanted = { dayTypeId: choice.dayTypeId, bellsId: choice.bellsId };
      let asked;
      try {
        asked = store.derived && typeof store.derived.crowd === 'function' ? store.derived.crowd(wanted) : Promise.reject(new Error(NO_ENGINE));
      } catch (error) {
        asked = Promise.reject(error);
      }
      asked.then((answer) => landed(key, answer), (error) => landed(key, { failed: error && error.message ? String(error.message) : String(error) }));
    }
    // An answer: an asking that has been replaced is dropped; a null (the counters moved before it ran) is asked again for the store as it is.
    function landed(key, answer) {
      if (gone || lens.key !== key) return;
      if (answer === null) {
        lens.key = null;
        if (lens.retries < 3) {
          lens.retries += 1;
          askCrowd();
          return;
        }
        answer = { failed: 'The answer kept going out of date. Try again.' };
      }
      if (answer.failed !== undefined) {
        lens.state = 'failed';
        lens.message = String(answer.failed);
        refresh();
        ctx.announce(CROWD_FAILED + '.');
        return;
      }
      lens.state = 'ready';
      lens.run = answer.run;
      lens.retries = 0;
      refresh();
      // said once, as the answer lands: the first line is the comparison
      if (state && state.picture.routesMode === 'crowd') ctx.announce(sentenceOf(state.project, state.picture, state.health).parts.map((part) => part.text).join(''));
    }

    // ---- everything but the canvas
    function refresh() {
      const project = store.project;
      const wanted = choice.bellsId;
      choice = settleChoice(project, choice);
      noticeBells(wanted);
      memory.projectId = project.id;
      memory.choice = choice;
      const f = figures(project);
      const nothing = f.groups === 0 || f.rooms === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      if (nothing) {
        // the one button does what the first line says comes first
        const noRooms = f.rooms === 0;
        empty.dataset.empty = noRooms ? 'movement-rooms' : 'movement-groups';
        empty.replaceChildren(intro({
          headline: HEADLINE,
          first: first(project),
          facts: facts(project),
          actions: [h('button', { type: 'button', class: 'btn btn--primary', data: { action: noRooms ? 'to-building' : 'to-groups' }, on: { click: () => ctx.navigate(noRooms ? '#building' : '#schedule/groups') } }, noRooms ? 'Go to the building' : 'Go to Groups')],
        }));
        key.element.hidden = true;
        ctx.setInspector(null);
        placeFloors();
        state = null;
        delete element.dataset.stale;
        return;
      }
      if (empty.firstChild) {
        empty.replaceChildren();
        ctx.setInspector(inspector.element.parentElement);
      }
      placeFloors();
      // the last answer is drawn against the project it was worked out for,
      // on that project's graph; after a derive that failed it is stale
      const derived = asker.derived;
      const standing = standingOf(project, derived);
      const shown = standing.project;
      const graph = standing.results && derived.graph ? derived.graph : graphNow();
      // crowd-aware routes: with the answer for the project the results are on screen, one view for every panel (./crowd-view.js);
      // route health and the findings are the usual routes' own
      const crowdOn = wantsCrowd() && standing.results !== null && !standing.failed;
      const usable = crowdOn && lens.state === 'ready' && lens.run !== null && lens.project === shown && lens.key === keyFor(shown);
      const results = usable ? crowdResultsView(standing.results, lens.run) : standing.results;
      const crowd = { state: !crowdOn ? 'off' : usable ? 'ready' : lens.state === 'failed' ? 'failed' : 'working', message: lens.message };
      picture = pictureOf(shown, results, graph, choice);
      const health = routeHealth(shown, standing.results);
      const sentence = standing.failed ? failedSentence(standing) : sentenceOf(shown, picture, health);
      if (usualFor !== null && !picture.changed.some((row) => row.groupId === usualFor)) usualFor = null;
      element.dataset.crowd = crowd.state;
      state = { project: shown, results, graph, picture, health, stale: standing.stale };
      if (standing.stale) element.dataset.stale = 'true';
      else delete element.dataset.stale;
      staleBand.hidden = !standing.stale;
      lineColours.clear();
      element.dataset.mode = picture.mode;
      element.dataset.groups = String(picture.groups.length);
      top.update(project, picture, sentence, crowd);
      // the scale's toggle shows the setting as it is now, not as the picture on screen had it
      key.update(shown, picture, {
        mode: project.settings.colourScale && project.settings.colourScale.mode === 'absolute' ? 'absolute' : 'relative',
        usual: usualFor === null ? '' : (shown.groups.find((group) => group.id === usualFor) || { name: '' }).name,
      });
      bar.update(state);
      drawPanel();
      // the floors laid out, the row of floors drawn, the map painted (plan-map.js)
      plan.setProject(shown, graph);
    }

    // ---- the legend never covers a floor (DESIGN 5.3). Its card stands on
    // the map's bottom right corner only where, with the map fitted to the
    // window, it would lie on no floor; otherwise, and always on a phone, it
    // is docked as one line under the map. The stage is measured as it is
    // without that line, so that docking does not itself decide the answer.
    const probe = createViewport();
    function coversFloor() {
      const world = plan.world;
      if (!world || view.width === 0) return false;
      // the stage undocked: what docking the line took from it, which is
      // less than the line's height where the stage is at its least
      // (SV2-72c3), measured now with the stage it is taken from, never the
      // last measure's view.height (SV2-72h)
      // and its width read in the same look, not view.width, the last
      // measure's: the two of one stage (SV2-72i)
      const { width: across, height } = plan.undockedStage();
      const card = key.element;
      const width = card.offsetWidth;
      const tall = card.offsetHeight;
      if (width === 0 || tall === 0) return false;
      // where Fit puts the floors on that stage, round the zoom buttons and
      // above the sticky foot, by the rule Fit itself takes (the map's
      // choose, SV2-72f2): in the band beside them it moves them right,
      // toward the card (SV2-72c2), so a plain fit is not asked
      const place = plan.fitAt(across, height, FIT_MARGIN);
      if (!place) return false;
      probe.resize(across, height);
      probe.zoom = place.zoom;
      probe.x = place.x;
      probe.y = place.y;
      const style = getComputedStyle(card);
      const right = across - (parseFloat(style.right) || 0);
      // where the card rests: not lifted over the bar (--mov-under), which
      // moves with the scroll and must not decide whether it docks
      const lifted = parseFloat(stage.style.getPropertyValue('--mov-under')) || 0;
      const bottom = height - ((parseFloat(style.bottom) || 0) - lifted);
      const box = { left: right - width, top: bottom - tall, right, bottom };
      const size = probe.size;
      return world.slots.some((slot) => {
        const left = probe.x + slot.x * size;
        const topEdge = probe.y + slot.y * size;
        return left < box.right && box.left < left + slot.w * size && topEdge < box.bottom && box.top < topEdge + slot.h * size;
      });
    }
    function dockLegend() {
      if (gone || key.element.hidden) return;
      key.setDocked(phone.matches || coversFloor());
    }
    // each time the floors are laid out, before a fitted map is fitted again
    plan.onLayout(dockLegend);

    // ---- the colours
    function themeColours(theme) {
      const next = (document.documentElement.dataset.theme || '') + ':' + theme.paper;
      if (next !== bandKey) {
        bandKey = next;
        const style = getComputedStyle(canvas);
        bandColours = [1, 2, 3, 4, 5].map((band) => {
          const value = style.getPropertyValue('--load-' + band).trim();
          return parse(value) ? value : '#888888';
        });
        lineColours.clear();
      }
      return bandColours;
    }

    // A group's colour as a line: the group's own, strengthened where it
    // would not show on a corridor of this theme.
    function lineColour(groupId, theme) {
      let colour = lineColours.get(groupId);
      if (!colour) {
        const group = state.project.groups.find((each) => each.id === groupId);
        // a teacher's walks are in the teacher's subject colour, else in ink
        const teacher = !group && picture && picture.teacher && picture.teacher.teacher.id === groupId ? picture.teacher : null;
        if (teacher) colour = teacher.colour && parse(teacher.colour) ? readable(teacher.colour, theme.corridor, 3) : theme.ink;
        else colour = group && parse(group.colour) ? readable(group.colour, theme.corridor, 3) : theme.ink2;
        lineColours.set(groupId, colour);
      }
      return colour;
    }

    // ---- the links in use over every floor on the map's canvas: a dotted arc
    // from one end of a stairs connection to the other, and for an elevator
    // ride a dashed line with a ring at each stop (ride-link.js)
    plan.across.push((g, given) => {
      if (!picture || !state) return;
      const theme = given.theme;
      themeColours(theme);
      const alone = picture.mode === 'teacher' ? lineColour(picture.teacher.teacher.id, theme) : picture.groups.length === 1 ? lineColour(picture.groups[0].id, theme) : null;
      const linkWidth = Math.max(2, Math.min(4, view.size * 0.14));
      for (const link of picture.links) {
        const a = given.point(link.a.floorId, link.a.cell);
        const b = given.point(link.b.floorId, link.b.cell);
        if (!a && !b) continue;
        const style = { colour: alone || theme.ink, edge: theme.card, width: linkWidth, font: theme.font, ink: theme.ink, labelScale: plan.labelScale };
        if (a && b) {
          drawLink(g, link, a, b, style);
        } else {
          const other = state.project.building.floors.find((floor) => floor.id === (a ? link.b.floorId : link.a.floorId));
          drawLink(g, link, a || b, null, { ...style, text: link.label + (other ? ' to ' + other.name : '') });
        }
      }
    });

    // ---- a group's usual route, faint and dashed beside the crowd-aware one it left (DESIGN 17.7 item 6): drawn for the
    // walks on screen that took another way, from the usual routes' own result
    plan.across.push((g, given) => {
      if (usualFor === null || !picture || !state || picture.routesMode !== 'crowd') return;
      const periods = anotherWay(lensOf(state.results), new Set([usualFor]), choice.transition).map((row) => row.period);
      if (periods.length === 0) return;
      const theme = given.theme;
      themeColours(theme);
      g.save();
      g.setLineDash([3, 5]);
      g.globalAlpha = 0.55;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(2, Math.min(4, view.size * 0.14));
      g.strokeStyle = lineColour(usualFor, theme);
      for (const period of periods) {
        const found = usualRouteOf(state.results, usualFor, period);
        if (!found || found.ok !== true || !Array.isArray(found.cells)) continue;
        let last = null;
        g.beginPath();
        for (const step of found.cells) {
          const at = given.point(step.floorId, step.cell);
          // a step onto a floor that is not on the map, or onto another floor, starts the line again
          if (!at || (last && last.floorId !== step.floorId)) {
            last = at ? { floorId: step.floorId } : null;
            if (at) g.moveTo(at.x, at.y);
            continue;
          }
          if (last) g.lineTo(at.x, at.y);
          else g.moveTo(at.x, at.y);
          last = { floorId: step.floorId };
        }
        g.stroke();
      }
      g.restore();
    });

    // ---- the cell card
    function clearPoint() {
      if (!point && card.element.hidden) return;
      point = null;
      plan.hover(null);
      card.hide();
      plan.paint();
    }

    // The card for a cell of the map. Returns what was found there.
    function pointAt(x, y, source) {
      const world = plan.world;
      const found = world ? slotAt(world, x, y) : null;
      const info = found && state ? cellCard(state.project, state.results, state.graph, picture, found.slot.floor.id, found.cell) : null;
      if (!info) {
        // a tapped room offers the one button that shows walks into it (not for a teacher: no filter there)
        const room = source === 'tap' && found && state && picture.mode !== 'teacher' ? roomCard(state.project, found.slot.floor.id, found.cell) : null;
        if (room) {
          point = { floorId: found.slot.floor.id, cell: found.cell, source, picture };
          plan.hover(point.floorId, point.cell);
          const at = view.toScreen(x, y);
          card.showRoom(room, { x: at.x, y: at.y, size: view.size });
          crowdLine.hidden = true;
          card.element.dataset.floor = point.floorId;
          card.element.dataset.cell = String(point.cell);
          plan.paint();
          return { found, info: null, room };
        }
        clearPoint();
        return { found, info: null };
      }
      point = { floorId: found.slot.floor.id, cell: found.cell, source, picture };
      // the cell the pointer is on is drawn as hovered; the keyboard's has its own ring
      plan.hover(source === 'keyboard' ? null : point.floorId, point.cell);
      const at = view.toScreen(x, y);
      card.show(info, { x: at.x, y: at.y, size: view.size }, picture, state.project.settings);
      crowdLine.textContent = crowdWords(info);
      crowdLine.hidden = !info.crowd;
      // the card is as tall as the line made it: beside its cell again
      if (info.crowd) card.place();
      card.element.dataset.floor = point.floorId;
      card.element.dataset.cell = String(point.cell);
      plan.paint();
      return { found, info };
    }

    // what is done to a cell of the map (plan-map.js's onCell)
    plan.onCell((ev) => {
      const world = plan.world;
      if (ev.kind === 'tap') {
        // a tap shows a cell's card and keeps it; a tap on the same cell, or on nothing, puts it away
        const found = world && ev.inside ? slotAt(world, ev.x, ev.y) : null;
        if (!found || (point && point.source === 'tap' && point.floorId === found.slot.floor.id && point.cell === found.cell)) clearPoint();
        else pointAt(ev.x, ev.y, 'tap');
      } else if (ev.kind === 'hover') {
        if (point && point.source === 'tap') return false;
        if (!ev.inside) {
          clearPoint();
          return false;
        }
        // still in the cell whose card is up, over the same picture: nothing to work out again
        const found = point && point.source === 'hover' && point.picture === picture && world ? slotAt(world, ev.x, ev.y) : null;
        if (found && found.slot.floor.id === point.floorId && found.cell === point.cell) return false;
        pointAt(ev.x, ev.y, 'hover');
      } else if (ev.kind === 'keyboard') {
        const { found, info } = pointAt(ev.x, ev.y, 'keyboard');
        if (info) ctx.announce(card.text(info, picture, state.project.settings) + (info.crowd ? ' ' + crowdWords(info) + '.' : ''));
        else ctx.announce(found ? found.slot.floor.name + ': not a corridor.' : 'Between floors.');
      } else if (ev.kind === 'escape') {
        if (!point) return false;
        clearPoint();
        return true;
      } else if (ev.kind === 'view') {
        clearPoint();
      } else if (ev.kind === 'resize') {
        // a card under the pointer goes with the old size; one the reader tapped open is put back on its cell
        const held = tapped();
        clearPoint();
        reopen(held);
      }
      return false;
    });

    // Looking at this view is the last step of Getting started. The tick is
    // quiet: no undo entry, and the project does not read as changed. It is
    // looked for at mount and on every update, so a project that comes to
    // have something to draw while the view is open (the sample school
    // loaded, an undo, a file imported) is ticked too (SV2-30c). After this
    // turn, since an update comes from inside the store's own notify.
    let ticking = false;
    function tick() {
      if (ticking) return;
      ticking = true;
      setTimeout(() => {
        ticking = false;
        if (gone || store.project.onboarding.steps[MOVEMENT_STEP] === true) return;
        if (ctx.storage && ctx.storage.state && ctx.storage.state.readOnly) return;
        const f = figures(store.project);
        if (f.groups === 0 || f.rooms === 0) return;
        store.apply(setOnboarding, { step: MOVEMENT_STEP });
      }, 0);
    }
    tick();

    ask();
    askCrowd();
    refresh();

    element.movement = {
      view,
      canvas,
      env,
      plan,
      get choice() { return choice; },
      get picture() { return picture; },
      get world() { return plan.world; },
      get state() { return state; },
      get fitted() { return plan.fitted; },
      get point() { return point; },
      // the keyboard cursor (ui/surface/cursor.js): where it is, and moveTo(x, y, visible)
      cursor: plan.cursor,
      change,
      fit: () => plan.fit(),
      // Where on the canvas a group's lane runs through a cell, and how wide
      // the line is, in CSS pixels; null when the group does not walk there.
      laneAt(groupId, floorId, cell) {
        const world = plan.world;
        const at = picture && picture.lanes ? lanePoint(picture.lanes, groupId, floorId, cell) : null;
        const slot = at && world ? world.slots.find((each) => each.floor.id === floorId) : null;
        if (!slot) return null;
        const place = view.toScreen(slot.x + at[0] - slot.box.x, slot.y + at[1] - slot.box.y);
        return { x: place.x, y: place.y, width: lineWidth(picture.lanes, view.size, choice.constantWidth), colour: lineColour(groupId, plan.theme()) };
      },
      cellAt: plan.cellAt,
    };

    return {
      element,
      // where the shell's "to the surface" goes: the map
      focus: () => plan.focus(),
      // the same section at another address (`#movement/teacher/…`, `#movement/to/…`): the choice it names is made
      // here, nothing is mounted again, and Back goes to where the link was followed from. An address that names
      // nothing (`#movement`, or something the project no longer has) leaves the view as it is.
      route(next) {
        const named = readMovementAddress(store.project, next);
        if (named) change(withAddress(choice, named));
        return true;
      },
      update() {
        ask();
        askCrowd();
        refresh();
        tick();
      },
      unmount() {
        // presentation mode left first (a change of address inside Movement
        // comes here too): the transition and floors from before it are
        // what the next mount opens on, written to memory only, since this
        // section is not drawn again (SV2-31c)
        const kept = presenter.unmount();
        if (kept && memory.choice) memory.choice = { ...memory.choice, ...kept };
        gone = true;
        asker.stop();
        bar.unmount();
        plan.unmount();
        wide.removeEventListener('change', onWidth);
        phone.removeEventListener('change', onWidth);
        panels.hotspots.unmount();
      },
    };
  },
};
