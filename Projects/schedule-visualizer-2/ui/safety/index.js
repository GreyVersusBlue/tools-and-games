// The Safety section (spec 10.1, 10.2; DESIGN 5.5): the way out from every
// room, on the plan, and door cards to post by each door.
//
//   top       the screen's first line, a sentence: every room's way out, or
//             the picked room's ("Room 204 on Floor 2: out by Door B in 45 s
//             of walking."), with "Show every room" while one is picked
//   the map   the plan map (ui/surface/plan-map.js) with the evacuation
//             overlay (ui/surface/overlays/evacuation.js): every room's way
//             out in its exit's colour, or the picked room's alone, from the
//             round mark at its door to the square mark at the exit
//   under     the key, docked under the map: each exit's number, colour and
//             name, so the badge on a room says which exit without the
//             colour; past eight exits (EXIT_COUNT), that the colours repeat; with the
//             badges too small to draw, that zooming in shows them; with a
//             room picked, what the two marks mean (or, for a room with no
//             way out, that it is framed and no route is drawn)
//   top bar   which floors are on the map (the plan map's row)
//   inspector Exits (./exits.js): every exit with the rooms it serves and
//             their people, and the rooms with no way out, each with the
//             routing engine's sentence. Door cards (./doorcards.js): print
//             the picked room's card, the rooms ticked in its list, or every
//             room's; the list says each room's way out in words (its exit,
//             the walking time and the first step), and is the map's text
//             alternative
//
// Picking a room: a tap or a click on it; the keyboard cursor over it says
// where it goes out, Enter picks it, Escape shows every room again; a room
// named in the inspector picks it too. The routes are worked out here, on
// the page, from the graph the store keeps (engine/evacuation.js through
// ./model.js), once a state of the building.
//
// The What if tab (./what-if.js) holds the trial: the exits and stairs ticked as blocked.
// It is view state of this section (`memory.blocked`), never saved, never in undo, kept while
// the page is open and the same project is shown, forgotten when another project opens. While
// anything is blocked the map, the key, Exits, Step-free and the first line show the trial's
// ways, a band above the map says so on every tab (with Clear), and each blocked exit and stairs
// wears a cross on a white ring. Door cards, posters and the prints never read it.
//
// The view on screen is at document.querySelector('.sfy').safety, for the
// tests and for the console.

import { h, uid } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { choice } from '../components/choice.js';
import { count, figures } from '../components/words.js';
import { createPlanMap } from '../surface/plan-map.js';
import { slotAt } from '../surface/plan-layout.js';
import { evacuationOverlay, blockedOverlay, exitColours, exitPalette, runsOf, EXIT_KEY_LEAST, EXIT_COUNT } from '../surface/overlays/evacuation.js';
import { drawStairLink } from '../surface/overlays/lanes.js';
import { labelOn } from '../colour.js';
import { buildGraph } from '../../engine/graph.js';
import { createRouteCache } from '../../engine/routing.js';
import { normaliseBlocked, blockedFromScenario, blockedWords, stairsName } from '../../engine/blocked.js';
import { exitName } from '../../engine/exit-load.js';
import { safetyPicture, firstLine, stepFreePicture, stepFreeFirstLine, stepFreeWords, NO_BLOCKED, blockedCount, blockedKey } from './model.js';
import { exitsPanel } from './exits.js';
import { whatIfPanel, blockedSays, stairsOfBuilding } from './what-if.js';
import { doorCardsPanel } from './doorcards.js';
import { stepFreeWaysPanel, stepFreeReportPanel } from './stepfree.js';
import { stepFreeOverlay, endsOf } from './stepfree-overlay.js';
import { EVACUATION_NO_ELEVATORS } from './ways.js';

const HEADLINE = 'This is the safety section.';
const KEYS = 'Arrow keys move the cursor one cell and say where the room under it goes out. Enter shows that room’s way out alone, Escape shows every room again. Hold Space and press the arrows to move the map. = and - zoom in and out, 0 fits the map to the window. The Door cards tab of the inspector lists every room’s way out in words.';

// The keys of the map, for Help (spec 3.15). The map answers them itself.
export const SAFETY_KEYS = [
  { id: 'safety-arrows', does: 'Move the cursor one cell, and say where the room under it goes out', shown: 'Arrows' },
  { id: 'safety-enter', does: 'Show the way out of the room under the cursor', shown: 'Enter' },
  { id: 'safety-escape', does: 'Show every room’s way out again', shown: 'Esc' },
  { id: 'safety-pan', does: 'Move the map', shown: 'Space+Arrows' },
  { id: 'safety-zoom', does: 'Zoom in, zoom out, fit the map to the window', shown: '= - 0' },
];

export const SAFETY_TABS = [
  { id: 'exits', label: 'Exits' },
  { id: 'cards', label: 'Door cards' },
  { id: 'stepfree', label: 'Step-free' },
  { id: 'whatif', label: 'What if' },
  { id: 'prints', label: 'Prints' },
];

// The two views of the evacuation (DESIGN 13.6): a radio group at the top of the inspector.
export const VIEWS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'step-free', label: 'Step-free' },
];
// under the key in the Step-free view: what the marks are
export const STEP_MARKS_SAY = 'Solid line: a step-free way to an exit, in its colour. Dashed line: a way to an area of refuge, where help comes. A framed room marked × has no step-free way out.';

export const MARKS_SAY = 'Round mark: the door the room is left by. Square mark: the exit.';
// the picked room's marks in the Step-free view, for an area of refuge and for no way
export const STEP_REFUGE_MARKS_SAY = 'Round mark: the door the room is left by. Dashed line to the rounded mark: the area of refuge, where it waits for help.';
export const STEP_LOST_SAYS = 'The picked room is framed. It has no step-free way out, so no route is drawn.';
// what is drawn for a picked room with no way out: its frame, no route and no marks
export const LOST_SAYS = 'The picked room is framed. It has no way out, so no route is drawn.';
// under the key, when the badges are too small to draw (EXIT_KEY_LEAST)
export const ZOOM_SAYS = 'Zoom in to see each room’s exit number on the map.';
// under the key, past the colours there are (EXIT_COUNT)
export const REPEAT_SAYS = (n) => 'The colours repeat after exit ' + n + ': the number on each room says which exit.';
// the stage's least in px, in place of the plan map's 120: a phone on its
// side keeps a map a finger can use, the key scrolled to under it (W5)
export const SAFETY_LEAST = 160;
// the live region, when the picked room is gone from the building
export const GONE_SAYS = (name) => name + ' is no longer in the building; showing every room.';

// The cursor's sentence over a room: its way out, by name and by the number
// the key and the badges give it, since past the colours a colour repeats.
export function cursorLine(row, picture, stepRoom) {
  if (stepRoom) {
    if (stepRoom.way === 'exit') return row.name + ': step-free out by ' + stepRoom.exitName + ', number ' + stepRoom.exitNumber + ' in the key. Enter shows its way out.';
    if (stepRoom.way === 'refuge') return row.name + ': no step-free exit; waits at ' + stepRoom.refugeName + '. Enter shows its way.';
    return row.name + ': no step-free way out, ' + stepRoom.why + '.';
  }
  if (!row.ok) return row.name + ': ' + row.sentence;
  const exit = picture.exits.find((each) => each.exitId === row.exitId);
  return row.name + ': out by ' + (exit ? exit.name + ', number ' + exit.number + ' in the key' : 'an exit') + '. Enter shows its way out.';
}

// The cross's words under the keyboard cursor (DESIGN 14.3)
export const BLOCKED_CURSOR = (name) => name + ', blocked in this trial';
// the trial band (DESIGN 14.3; 14.7 item 8): the words, and the short form for a phone
export const bandWords = (words) => 'Trial: ' + words;
export const bandShort = (n) => 'Trial · ' + n + ' blocked';
export const CLEAR_SAYS = 'The trial is cleared: every room goes out the way it did.';

// What is chosen here, kept for the open project while the page is open
// (in memory: no storage key). `blocked` is the What if trial (ARCHITECTURE 20.9 item 14): a trial
// survives a move to another section and back, and is let go when another project opens.
// `chips` are the corridors it brought in from the scenario; `droppedSays` what the last building
// change took out of it; `seen` the project this section last drew, to name what is gone.
const memory = { projectId: null, picked: null, pickedName: '', chosen: new Set(), floors: 'auto', tab: 'exits', view: 'everyone', stepFree: null, blocked: NO_BLOCKED, chips: [], droppedSays: [], seen: null, cache: null, cacheLimit: 0 };

// A project other than the one the choices were made for lets them go: on
// mounting, and at every refresh while mounted (a replace, Undo across one).
function adopt(project) {
  if (memory.projectId === project.id) return false;
  memory.projectId = project.id;
  memory.picked = null;
  memory.pickedName = '';
  memory.chosen = new Set();
  memory.floors = 'auto';
  memory.view = 'everyone';
  memory.stepFree = null;
  memory.blocked = NO_BLOCKED;
  memory.chips = [];
  memory.droppedSays = [];
  memory.seen = null;
  memory.cache = null;
  memory.cacheLimit = 0;
  return true;
}

function first(project) {
  const f = figures(project);
  if (f.rooms === 0) return 'It shows the way out from every room to its nearest exit, and prints a door card for each room. Draw the building and its rooms first.';
  return 'It shows the way out from every room to its nearest exit, and prints a door card for each room. Mark at least one exit on a corridor first: the Exit tool (X) in the Building section.';
}

function facts(project) {
  const f = figures(project);
  return f.exits === 0 ? 'No exits are marked yet, for ' + count(f.rooms, 'room') + '.' : 'There ' + (f.exits === 1 ? 'is ' : 'are ') + count(f.exits, 'exit') + ' for ' + count(f.rooms, 'room') + '.';
}

function words(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function roomAtCell(project, floorId, cell) {
  const floor = project.building.floors.find((each) => each.id === floorId);
  if (!floor) return null;
  return floor.spaces.find((space) => space.kind === 'room' && space.cells.includes(cell)) || null;
}

export const section = {
  id: 'safety',
  label: 'Safety',
  name: 'Safety',
  key: '5',
  icon: 'safety',
  start(ctx) {
    for (const key of SAFETY_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Safety', does: key.does, shown: key.shown });
  },
  mount(ctx) {
    const store = ctx.store;
    adopt(store.project);
    let gone = false;
    let picture = null;
    let step = null;
    let owesCounts = false;
    let shown = null;
    let colours = [];
    let coloursKey = '';

    const graphNow = () => store.derived.get('graph', ['building'], (project) => buildGraph(project));
    // One route cache for every pass this section makes (ARCHITECTURE 20.9 item 1): two fields a room
    // and a few over, so the plain pass is still there after a trial's, which a stairs block makes
    // a fresh pass of its own. It empties itself when the store's geometry counter moves.
    const routeOptions = (project) => {
      const need = 2 * figures(project).rooms + 8;
      if (!memory.cache || memory.cacheLimit < need) {
        memory.cache = createRouteCache(need);
        memory.cacheLimit = need;
      }
      return { cache: memory.cache, geometryVersion: store.geometryVersion };
    };
    // the trial's picture, once a (state of the building, blocked set): never through store.derived,
    // which keys on the project's parts, and always a new object when either changes
    let trialHeld = null;
    const trialStamp = () => store.buildingVersion + ':' + store.scheduleVersion + ':' + store.geometryVersion + ':' + blockedKey(memory.blocked);
    const trialOn = () => blockedCount(memory.blocked) > 0;
    // once a state of the building: rooms, doors, exits, connections, names
    const pictureNow = () => {
      if (!trialOn()) return store.derived.get('safety-picture', ['building'], (project) => safetyPicture(project, graphNow(), routeOptions(project)));
      const stamp = trialStamp();
      if (trialHeld && trialHeld.stamp === stamp) return trialHeld.picture;
      const picture = safetyPicture(store.project, graphNow(), { ...routeOptions(store.project), blocked: memory.blocked });
      trialHeld = { stamp, picture, step: null };
      return picture;
    };

    // the step-free picture is worked out only when the view or the tab needs it
    const stepNow = () => {
      if (!trialOn()) return store.derived.get('safety-step', ['building', 'schedule'], (project) => stepFreePicture(project, graphNow(), pictureNow()));
      const picture = pictureNow();
      if (!trialHeld.step) trialHeld.step = stepFreePicture(store.project, graphNow(), picture);
      return trialHeld.step;
    };
    const wantStep = () => memory.view === 'step-free' || memory.tab === 'stepfree';
    const ensureStep = () => {
      step = picture && shown && wantStep() ? stepNow() : null;
    };
    const stepView = () => memory.view === 'step-free' && step !== null;

    // ---- the first line
    const lineWords = h('span', { class: 'mov-line__words', data: { part: 'words' } });
    const allButton = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-all' }, on: { click: showEvery } }, 'Show every room');
    const line = h('p', { class: 'mov-line intro__first', id: 'safety-line' }, lineWords, ' ', allButton);
    // the trial band, above the map on every tab: the words long, "Trial · 2 blocked" on a phone
    const bandLong = h('span', { class: 'sfy-band__long', data: { part: 'band-words' } });
    const bandShortWords = h('span', { class: 'sfy-band__short', data: { part: 'band-short' } });
    const bandClear = h('button', { type: 'button', class: 'btn sfy-band__clear', data: { action: 'band-clear' }, on: { click: () => clearTrial({ from: 'band' }) } }, 'Clear', h('span', { class: 'vh' }, ' the trial'));
    const band = h('div', { class: 'sfy-band', hidden: true, role: 'group', 'aria-label': 'Trial', data: { part: 'band' } }, h('p', { class: 'sfy-band__text' }, bandLong, bandShortWords), bandClear);
    const top = h('div', { class: 'mov-top sfy-top' }, line, band);
    const headline = h('h1', { class: 'vh' }, HEADLINE);

    // ---- the key, docked under the map
    const keyList = h('ul', { class: 'sfy-key__list', 'aria-label': 'Exits on the map' });
    const marks = h('p', { class: 'sfy-key__marks', hidden: true }, MARKS_SAY);
    const repeat = h('p', { class: 'sfy-key__note', hidden: true, data: { note: 'repeat' } });
    const zoomNote = h('p', { class: 'sfy-key__note', hidden: true, data: { note: 'zoom' } }, ZOOM_SAYS);
    const stepNote = h('p', { class: 'sfy-key__note', hidden: true, data: { note: 'step-free' } }, STEP_MARKS_SAY);
    const keyLine = h('div', { class: 'sfy-key', data: { part: 'key' } }, h('span', { class: 'sfy-key__title', 'aria-hidden': 'true' }, 'Key'), keyList, marks, repeat, stepNote, zoomNote);

    const plan = createPlanMap({
      ctx,
      name: 'safety',
      label: 'The evacuation map',
      keys: KEYS,
      // the routes run along the corridors: their names are drawn over them
      namesOver: true,
      least: SAFETY_LEAST,
      floorsRow: {
        value: () => memory.floors,
        change(value) {
          memory.floors = value;
          refresh();
        },
      },
      frame: () => ({ before: [headline, top], after: [keyLine], head: top, line, under: keyLine }),
    });
    const element = plan.root;
    element.classList.add('sfy');
    const map = plan.element;
    const empty = h('div', { class: 'mov-empty stub sfy-empty', hidden: true });
    element.append(empty);

    // ---- the exits' colours, for the theme on screen: the --exit-n tokens
    // of ./safety.css, read where the section is (the page's root while it is
    // not on the page yet, where the tokens are too)
    function exitColour(number) {
      const theme = plan.theme();
      const many = picture ? picture.exits.length : 0;
      const key = theme.corridor + ':' + many;
      if (key !== coloursKey) {
        const palette = exitPalette(getComputedStyle(element.isConnected ? element : document.documentElement));
        // a reading with a token missing is used now and asked again at the next draw
        coloursKey = palette.every(Boolean) ? key : '';
        colours = exitColours(many, palette, theme.ink);
      }
      return colours[number - 1] || theme.ink;
    }
    // a swatch of the key: the exit's colour, its number in ink or paper at 4.5:1
    function swatch(number) {
      const theme = plan.theme();
      const fill = exitColour(number);
      return 'background:' + fill + ';color:' + labelOn(fill, theme.ink, theme.paper);
    }

    // ---- the overlay: what it draws is read at each paint
    // the key says so when the badges are too small to be drawn, as the map is painted
    plan.overlays.push((g, view) => drawZoomNote(view.size));
    plan.overlays.push(evacuationOverlay(() => {
      if (!picture || !shown || stepView()) return null;
      const lost = memory.picked ? picture.byRoom.get(memory.picked) : null;
      return {
        mode: memory.picked ? 'one' : 'all',
        picked: memory.picked,
        lost: lost && !lost.ok ? { floorId: lost.floorId, cells: lost.cells } : null,
        rooms: picture.rows.filter((row) => row.ok).map((row) => ({ roomId: row.roomId, floorId: row.floorId, cells: row.cells, route: row.route, number: row.exitNumber, colour: exitColour(row.exitNumber) })),
      };
    }));
    // the Step-free view's own drawing (./stepfree-overlay.js); a step-free way keeps to one floor
    let drawnStep = null;
    let drawnWith = '';
    let drawnPicture = null;
    const stepDrawing = () => {
      if (!stepView() || !shown) return null;
      const key = plan.theme().corridor + ':' + coloursKey;
      if (drawnStep !== step || drawnWith !== key) {
        const rooms = step.rooms.map((room) => ({
          roomId: room.roomId,
          floorId: room.floorId,
          cells: room.cells,
          way: room.way,
          route: room.route,
          exitId: room.exitId,
          refugeId: room.refugeId,
          exitName: room.exitName,
          refugeName: room.refugeName,
          colour: room.exitNumber ? exitColour(room.exitNumber) : plan.theme().accent,
          mark: room.way === 'exit' ? String(room.exitNumber) : room.way === 'refuge' ? 'R' : '×',
        }));
        drawnPicture = { rooms, ends: endsOf(rooms, shown, (room) => room.colour) };
        drawnStep = step;
        drawnWith = key;
      }
      return drawnPicture;
    };
    plan.overlays.push(stepFreeOverlay(() => {
      const drawing = stepDrawing();
      return drawing ? { ...drawing, picked: memory.picked } : null;
    }, labelOn));
    // what the trial blocks: a cross on a white ring over each blocked exit and each end of a blocked
    // stairs, on every tab and in both views
    plan.overlays.push(blockedOverlay(() => (trialOn() && shown ? { marks: blockedMarks() } : null)));
    // the picked room's stairs, from one floor to the other, over every floor
    plan.across.push((g, given) => {
      if (stepView()) return;
      const row = picture && memory.picked ? picture.byRoom.get(memory.picked) : null;
      if (!row || !row.ok) return;
      const runs = runsOf(row.route);
      for (let i = 0; i + 1 < runs.length; i += 1) {
        const from = runs[i][runs[i].length - 1];
        const to = runs[i + 1][0];
        const a = given.point(from.floorId, from.cell);
        const b = given.point(to.floorId, to.cell);
        if (!a && !b) continue;
        const style = { colour: given.theme.accent, edge: given.theme.card, width: 3, font: given.theme.font, ink: given.theme.ink };
        if (a && b) drawStairLink(g, a, b, style);
        else {
          const other = shown.building.floors.find((floor) => floor.id === (a ? to.floorId : from.floorId));
          drawStairLink(g, a || b, null, { ...style, text: other ? 'to ' + other.name : '' });
        }
      }
    });

    // ---- the inspector
    const env = {
      ctx,
      picture: () => picture,
      step: () => step,
      project: () => shown,
      picked: () => memory.picked,
      chosen: () => memory.chosen,
      // the door cards' Step-free ways out: null is the default (on when the building has a refuge or a step mark)
      stepFree: () => memory.stepFree,
      setStepFree: (value) => {
        memory.stepFree = value;
      },
      swatch,
      themeKey: () => plan.theme().corridor,
      // the What if tab's: the trial and what it needs
      blocked: () => memory.blocked,
      chips: () => memory.chips,
      closures: () => (shown && shown.scenario ? blockedFromScenario(shown, shown.scenario) : null),
      dropped: () => memory.droppedSays,
      tick: tickBlocked,
      useScenario,
      removeChip,
      clear: () => clearTrial({ from: 'tab' }),
      show(roomId) {
        const sheet = document.getElementById('inspector');
        const row = picture ? picture.byRoom.get(roomId) : null;
        if (sheet && sheet.dataset.mode === 'sheet' && sheet.dataset.open === 'true') ctx.closeInspector();
        pick(roomId, { bring: true });
        if (row) ctx.announce(row.name + ' shown on the map');
      },
      pick(roomId) {
        // on a phone the inspector is a sheet over the map: it is shut, so the way out is seen
        const sheet = document.getElementById('inspector');
        if (sheet && sheet.dataset.mode === 'sheet' && sheet.dataset.open === 'true') ctx.closeInspector();
        pick(roomId, { say: true, bring: true });
      },
      // where the focus goes when what held it in a panel is gone: the map
      home: () => plan.focus(),
    };
    // the Exits tab holds the exits' list in the Everyone view and the step-free ways in the other
    const everyoneExits = exitsPanel(env);
    const stepWays = stepFreeWaysPanel(env);
    const exitsHolder = h('div', { class: 'sfy-holder' }, everyoneExits.element);
    const exitsTab = {
      element: exitsHolder,
      update() {
        const want = stepView() ? stepWays : everyoneExits;
        if (exitsHolder.firstChild !== want.element) exitsHolder.replaceChildren(want.element);
        want.update();
      },
    };
    const whatIf = whatIfPanel(env);
    // the Prints tab is mounted by ui/safety/prints.js (SV2-111): until then, its heading and nothing else
    const printsPanel = { element: h('div', { class: 'mov-panel sfy-panel', data: { panel: 'prints' } }, h('h2', { class: 'mov-panel__title' }, 'Prints')), update() {} };
    const panels = { exits: exitsTab, cards: doorCardsPanel(env), stepfree: stepFreeReportPanel(env), whatif: whatIf, prints: printsPanel };
    const inspector = tabs({
      label: 'Safety',
      selected: memory.tab,
      onSelect(id) {
        memory.tab = id;
        ensureStep();
        drawPanel();
      },
      items: SAFETY_TABS.map((tab) => ({ id: tab.id, label: tab.label, panel: () => panels[tab.id].element })),
    });
    // Everyone / Step-free: one radio group, so Tab passes through it once and the arrows move
    // the choice with the focus staying on it (DESIGN 13.6)
    const viewLabel = uid('safety-view');
    const viewChoice = choice({
      name: uid('safety-view-name'),
      labelledBy: viewLabel,
      options: VIEWS,
      value: memory.view,
      onChange(value) {
        memory.view = value;
        ensureStep();
        draw();
        // the Step-free counts are said once they are known; until then it says it is working them out
        owesCounts = value === 'step-free' && !step;
        if (value === 'step-free') ctx.announce(step ? 'Step-free: ' + stepFreeWords(step.counts) : 'Step-free: working it out');
        else ctx.announce('Everyone: ' + lineWords.textContent);
      },
    });
    const viewBox = h('div', { class: 'sfy-view', data: { part: 'view' } },
      h('span', { class: 'sfy-view__label', id: viewLabel }, 'Ways out for'),
      viewChoice.element,
      h('p', { class: 'sfy-view__line', data: { line: 'no-elevators' } }, EVACUATION_NO_ELEVATORS));
    const inspectorBox = h('div', { class: 'mov-inspector sfy-inspector' }, viewBox, inspector.element);
    ctx.setInspector(inspectorBox);
    function drawPanel() {
      if (picture && shown) panels[inspector.selected].update();
    }

    // ---- the trial (DESIGN 14.3): what is blocked, and the words for it
    // how many things are blocked, as the band and the live region count them: an exit, a stairs,
    // a corridor brought in from the scenario
    const blockedThings = () => memory.blocked.exits.length + memory.blocked.connections.length + memory.chips.length;
    // the cells of the map the trial marks, with the name the cursor says: each blocked exit, each end of a blocked stairs
    function blockedMarks() {
      const marks = [];
      if (!shown) return marks;
      for (const id of memory.blocked.exits) {
        for (const floor of shown.building.floors) {
          const exit = (floor.exits || []).find((each) => each.id === id);
          if (exit) marks.push({ floorId: floor.id, cell: exit.cell, name: exitName(shown, id) });
        }
      }
      for (const id of memory.blocked.connections) {
        const connection = (shown.building.connections || []).find((each) => each && each.id === id);
        if (!connection) continue;
        const name = stairsName(shown, connection);
        for (const end of [connection.a, connection.b]) if (end) marks.push({ floorId: end.floorId, cell: end.cell, name });
      }
      return marks;
    }
    const trialSentence = () => (picture && picture.trial ? picture.trial.sentence : '');
    function trialParts() {
      const trial = picture.trial;
      if (Array.isArray(trial.sentenceParts)) return trial.sentenceParts.map((part) => ({ text: part.text, name: Boolean(part.name) }));
      return [{ text: trial.sentence, name: false }];
    }
    // A new blocked set: the lists as the engine keeps them, the chips of what is no longer in it let go,
    // the section drawn again, and the count and the sentence said (the live region, once the work is done)
    function setBlocked(next, said) {
      const checked = normaliseBlocked(store.project, next);
      memory.blocked = blockedCount(checked.blocked) === 0 ? NO_BLOCKED : checked.blocked;
      const held = new Set(memory.blocked.cells.map((place) => place.floorId + ':' + place.cell));
      memory.chips = memory.chips.filter((chip) => chip.cells.some((cell) => held.has(chip.floorId + ':' + cell)));
      memory.droppedSays = [];
      refresh();
      const n = blockedThings();
      ctx.announce((said ? said + ' ' : '') + (n === 0 ? 'Nothing blocked.' : blockedSays(n) + '. ' + trialSentence()));
    }
    function tickBlocked(kind, id, on) {
      const set = memory.blocked;
      const list = kind === 'exit' ? set.exits : set.connections;
      const next = on ? Array.from(new Set([...list, id])) : list.filter((each) => each !== id);
      setBlocked(kind === 'exit' ? { ...set, exits: next } : { ...set, connections: next });
    }
    function useScenario() {
      const closures = shown && shown.scenario ? blockedFromScenario(shown, shown.scenario) : null;
      if (!closures || (closures.connections.length === 0 && closures.cells.length === 0)) {
        ctx.announce('The open scenario closes no stairs or corridors.');
        return;
      }
      const set = memory.blocked;
      const before = blockedKey(set);
      const next = { exits: set.exits, connections: Array.from(new Set([...set.connections, ...closures.connections])), cells: [...set.cells, ...closures.cells] };
      const checked = normaliseBlocked(store.project, next).blocked;
      if (blockedKey(checked) === before) {
        ctx.announce('Nothing new: the scenario’s closures are already in this trial.');
        return;
      }
      for (const corridor of closures.corridors) {
        const same = memory.chips.some((chip) => chip.floorId === corridor.floorId && chip.name === corridor.name && chip.cells.join() === corridor.cells.join());
        if (!same) memory.chips.push({ floorId: corridor.floorId, name: corridor.name.trim() === '' ? corridor.cells.length + ' corridor cells' : corridor.name, cells: corridor.cells });
      }
      setBlocked(checked, 'Brought in from the scenario: ' + closures.words.text + '.');
    }
    function removeChip(index) {
      const chip = memory.chips[index];
      if (!chip) return;
      const others = memory.chips.filter((_, i) => i !== index);
      const kept = new Set(others.flatMap((each) => each.cells.map((cell) => each.floorId + ':' + cell)));
      const cells = memory.blocked.cells.filter((place) => !(place.floorId === chip.floorId && chip.cells.includes(place.cell) && !kept.has(place.floorId + ':' + place.cell)));
      memory.chips = others;
      setBlocked({ ...memory.blocked, cells }, chip.name + ' is no longer blocked.');
    }
    // Clear: every room goes out the way it did. On the band the focus goes to the open tab's heading
    // (DESIGN 14.7 item 8), on the What if tab's own button to the first tick
    function clearTrial(options) {
      if (!trialOn()) return;
      memory.blocked = NO_BLOCKED;
      memory.chips = [];
      memory.droppedSays = [];
      trialHeld = null;
      refresh();
      ctx.announce(CLEAR_SAYS);
      if (options && options.from === 'tab') whatIf.focusFirst();
      else focusHeading();
    }
    function focusHeading() {
      const heading = inspector.element.querySelector('.tabs__panel .mov-panel__title');
      if (heading && heading.getClientRects().length > 0) {
        heading.tabIndex = -1;
        heading.focus();
      } else plan.focus();
    }

    // ---- picking a room
    //   options.say     say it in the live region
    //   options.bring   bring its way out onto the map (picked from a list):
    //                   the room's floor shown, and the map fitted to the
    //                   window, since a way out can cross every floor
    function pick(roomId, options) {
      const opts = options || {};
      const row = roomId && picture ? picture.byRoom.get(roomId) : null;
      memory.picked = row ? roomId : null;
      draw();
      if (opts.bring && row && row.cells.length > 0) {
        plan.show(row.floorId, row.cells);
        plan.fit();
      }
      if (opts.say) ctx.announce(lineWords.textContent);
    }

    // Show every room hides itself: the focus goes to the map it changed
    function showEvery() {
      const held = document.activeElement === allButton;
      pick(null, { say: true });
      if (held) plan.focus();
    }

    // ---- what is done to a cell of the map (plan-map.js's onCell)
    function roomUnder(x, y) {
      const world = plan.world;
      const found = world && shown ? slotAt(world, x, y) : null;
      if (!found) return { found: null, room: null };
      return { found, room: roomAtCell(shown, found.slot.floor.id, found.cell) };
    }
    plan.onCell((ev) => {
      if (!picture || !shown) return false;
      if (ev.kind === 'tap') {
        // a tap on a room shows its way out alone; on the same room, or on no room, every room's again
        const { room } = ev.inside ? roomUnder(ev.x, ev.y) : { room: null };
        pick(room && room.id !== memory.picked ? room.id : null, { say: true });
      } else if (ev.kind === 'keyboard') {
        const { found, room } = roomUnder(ev.x, ev.y);
        const row = room ? picture.byRoom.get(room.id) : null;
        const blockedHere = found && trialOn() ? blockedMarks().find((mark) => mark.floorId === found.slot.floor.id && mark.cell === found.cell) : null;
        if (blockedHere) ctx.announce(BLOCKED_CURSOR(blockedHere.name));
        else if (!found) ctx.announce('Between floors.');
        else if (!row) ctx.announce(found.slot.floor.name + ': not a room.');
        else ctx.announce(cursorLine(row, picture, stepView() ? step.byRoom.get(row.roomId) : null));
      } else if (ev.kind === 'enter') {
        // Enter over a room picks it
        const { room } = roomUnder(ev.x + 0.5, ev.y + 0.5);
        if (room && picture.byRoom.has(room.id)) pick(room.id, { say: true });
        else ctx.announce('There is no room under the cursor.');
        return true;
      } else if (ev.kind === 'escape') {
        if (!memory.picked) return false;
        pick(null, { say: true });
        return true;
      }
      return false;
    });

    // the key and the lists follow a theme the device changes (the map draws itself again)
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => requestAnimationFrame(() => {
      if (!gone) draw();
    });
    dark.addEventListener('change', onScheme);

    // ---- everything but the canvas
    function drawKey() {
      const one = Boolean(memory.picked);
      const row = one ? picture.byRoom.get(memory.picked) : null;
      const stepRoom = one && stepView() ? step.byRoom.get(memory.picked) : null;
      keyList.hidden = one;
      marks.hidden = !one;
      marks.textContent = stepRoom ? (stepRoom.way === 'none' ? STEP_LOST_SAYS : stepRoom.way === 'refuge' ? STEP_REFUGE_MARKS_SAY : MARKS_SAY) : row && !row.ok ? LOST_SAYS : MARKS_SAY;
      keyLine.dataset.mode = one ? 'one' : 'all';
      const repeats = !one && picture.exits.length > EXIT_COUNT;
      repeat.hidden = !repeats;
      repeat.textContent = repeats ? REPEAT_SAYS(EXIT_COUNT) : '';
      stepNote.hidden = one || !stepView();
      drawZoomNote(plan.view.size);
      if (one) return;
      if (stepView()) {
        const theme = plan.theme();
        const items = step.exits.map((exit) => h('li', { class: 'sfy-key__item', data: { exit: exit.exitId, number: String(exit.number) } },
          h('span', { class: 'sfy-swatch', style: swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
          h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
          h('span', null, h('bdi', { class: 'sfy-key__name' }, exit.name), ', ' + count(exit.rooms, 'room'))));
        const refuges = step.refuges.filter((refuge) => refuge.roomIds.length > 0).map((refuge) => h('li', { class: 'sfy-key__item', data: { refuge: refuge.refugeId } },
          h('span', { class: 'sfy-swatch', style: 'background:' + theme.accent + ';color:' + labelOn(theme.accent, theme.ink, theme.paper), 'aria-hidden': 'true' }, 'R'),
          h('span', { class: 'vh' }, 'Area of refuge: '),
          h('span', null, h('bdi', { class: 'sfy-key__name' }, refuge.name), ', ' + count(refuge.roomIds.length, 'room'))));
        const none = step.counts.none > 0 ? [h('li', { class: 'sfy-key__item', data: { none: String(step.counts.none) } },
          h('span', { class: 'sfy-swatch', style: 'background:' + theme.problem + ';color:' + labelOn(theme.problem, theme.ink, theme.paper), 'aria-hidden': 'true' }, '×'),
          h('span', null, 'No step-free way out, ' + count(step.counts.none, 'room')))] : [];
        keyList.replaceChildren(...items, ...refuges, ...none);
        return;
      }
      keyList.replaceChildren(...picture.exits.map((exit) => h('li', { class: 'sfy-key__item', data: { exit: exit.exitId, number: String(exit.number) } },
        h('span', { class: 'sfy-swatch', style: swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
        h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
        h('span', null, h('bdi', { class: 'sfy-key__name' }, exit.name), ', ' + (exit.blocked ? 'blocked in this trial' : count(exit.rooms, 'room'))))));
    }

    // the badges are drawn from EXIT_KEY_LEAST px a cell; under it, with
    // every room shown, the key says that zooming in shows the numbers
    function drawZoomNote(size) {
      const hide = gone || !picture || Boolean(memory.picked) || !(size > 0) || size >= EXIT_KEY_LEAST;
      if (zoomNote.hidden !== hide) zoomNote.hidden = hide;
    }

    // the band above the map: the words of what is blocked, and Clear; hidden with no trial
    function drawBand() {
      const on = trialOn() && Boolean(shown);
      band.hidden = !on;
      element.dataset.trial = on ? String(blockedThings()) : '0';
      if (!on) return;
      const parts = blockedWords(shown, memory.blocked, { floors: false }).parts;
      bandLong.replaceChildren('Trial: ', ...parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      bandShortWords.textContent = bandShort(blockedThings());
    }

    function draw() {
      if (!picture || gone) return;
      if (memory.picked && !picture.byRoom.has(memory.picked)) memory.picked = null;
      if (memory.picked) memory.pickedName = picture.byRoom.get(memory.picked).name;
      lineWords.replaceChildren(...words(stepView() ? stepFreeFirstLine(shown, step, memory.picked) : picture.trial && !memory.picked ? trialParts() : firstLine(shown, picture, memory.picked)));
      drawBand();
      element.dataset.view = memory.view;
      viewChoice.set(memory.view);
      allButton.hidden = !memory.picked;
      element.dataset.mode = memory.picked ? 'one' : 'all';
      if (memory.picked) element.dataset.picked = memory.picked;
      else delete element.dataset.picked;
      drawKey();
      drawPanel();
      plan.paint();
    }

    function refresh() {
      const project = store.project;
      adopt(project);
      // a building change that removes a blocked item: the trial drops it, and the words are said once
      let droppedSaid = '';
      if (blockedCount(memory.blocked) > 0) {
        const checked = normaliseBlocked(project, memory.blocked, memory.seen || undefined);
        if (checked.dropped.length > 0) {
          memory.blocked = blockedCount(checked.blocked) === 0 ? NO_BLOCKED : checked.blocked;
          const held = new Set(memory.blocked.cells.map((place) => place.floorId + ':' + place.cell));
          memory.chips = memory.chips.filter((chip) => chip.cells.some((cell) => held.has(chip.floorId + ':' + cell)));
          memory.droppedSays = checked.dropped;
          droppedSaid = checked.dropped.join(' ');
          trialHeld = null;
        }
      }
      memory.seen = project;
      const f = figures(project);
      const nothing = f.rooms === 0 || f.exits === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      plan.showFloors(!nothing);
      if (nothing) {
        empty.dataset.empty = f.rooms === 0 ? 'safety-rooms' : 'safety-exits';
        empty.replaceChildren(intro({
          headline: HEADLINE,
          first: first(project),
          facts: facts(project),
          actions: [h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'to-building' }, on: { click: () => ctx.navigate('#building') } }, 'Go to the building')],
        }));
        ctx.setInspector(null);
        picture = null;
        shown = null;
        element.dataset.mode = 'empty';
        band.hidden = true;
        step = null;
        return;
      }
      if (empty.firstChild) {
        empty.replaceChildren();
        ctx.setInspector(inspectorBox);
      }
      const graph = graphNow();
      picture = pictureNow();
      shown = project;
      // a chosen room the building no longer has is let go; the picked one, said
      for (const id of Array.from(memory.chosen)) if (!picture.byRoom.has(id)) memory.chosen.delete(id);
      let lost = null;
      if (memory.picked && !picture.byRoom.has(memory.picked)) {
        lost = memory.pickedName || 'The picked room';
        memory.picked = null;
        memory.pickedName = '';
      }
      ensureStep();
      element.dataset.rooms = String(picture.rows.length);
      element.dataset.missing = String(picture.missing.length);
      draw();
      if (owesCounts && memory.view !== 'step-free') owesCounts = false;
      if (owesCounts && step) {
        owesCounts = false;
        ctx.announce('Step-free: ' + stepFreeWords(step.counts));
      }
      plan.setProject(project, graph);
      if (lost) ctx.announce(GONE_SAYS(lost));
      if (droppedSaid) ctx.announce(droppedSaid);
    }

    refresh();

    element.safety = {
      plan,
      get picture() { return picture; },
      get picked() { return memory.picked; },
      get step() { return step; },
      // the labelled ends of the step-free ways, as drawn: [{ id, floorId, cell, label, colour, kind }]
      stepEnds: () => {
        const drawing = stepDrawing();
        return drawing ? drawing.ends : [];
      },
      get view() { return memory.view; },
      // the What if trial, for the tests and the console
      get blocked() { return memory.blocked; },
      get trial() { return picture ? picture.trial : null; },
      blockedMarks,
      get routeCache() { return memory.cache; },
      setView(value) {
        viewChoice.set(value);
        memory.view = value;
        ensureStep();
        draw();
      },
      get chosen() { return Array.from(memory.chosen); },
      pick: (roomId) => pick(roomId, { bring: true }),
      colour: (number) => exitColour(number),
    };

    return {
      element,
      focus: () => plan.focus(),
      update() {
        if (!gone) refresh();
      },
      unmount() {
        gone = true;
        dark.removeEventListener('change', onScheme);
        plan.unmount();
      },
    };
  },
};
