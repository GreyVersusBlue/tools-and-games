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
// The view on screen is at document.querySelector('.sfy').safety, for the
// tests and for the console.

import { h } from '../components/dom.js';
import { intro } from '../components/card.js';
import { tabs } from '../components/tabs.js';
import { count, figures } from '../components/words.js';
import { createPlanMap } from '../surface/plan-map.js';
import { slotAt } from '../surface/plan-layout.js';
import { evacuationOverlay, exitColours, exitPalette, runsOf, EXIT_KEY_LEAST, EXIT_COUNT } from '../surface/overlays/evacuation.js';
import { drawStairLink } from '../surface/overlays/lanes.js';
import { labelOn } from '../colour.js';
import { buildGraph } from '../../engine/graph.js';
import { safetyPicture, firstLine } from './model.js';
import { exitsPanel } from './exits.js';
import { doorCardsPanel } from './doorcards.js';

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
];

export const MARKS_SAY = 'Round mark: the door the room is left by. Square mark: the exit.';
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
export function cursorLine(row, picture) {
  if (!row.ok) return row.name + ': ' + row.sentence;
  const exit = picture.exits.find((each) => each.exitId === row.exitId);
  return row.name + ': out by ' + (exit ? exit.name + ', number ' + exit.number + ' in the key' : 'an exit') + '. Enter shows its way out.';
}

// What is chosen here, kept for the open project while the page is open
// (in memory: no storage key).
const memory = { projectId: null, picked: null, pickedName: '', chosen: new Set(), floors: 'auto', tab: 'exits' };

// A project other than the one the choices were made for lets them go: on
// mounting, and at every refresh while mounted (a replace, Undo across one).
function adopt(project) {
  if (memory.projectId === project.id) return false;
  memory.projectId = project.id;
  memory.picked = null;
  memory.pickedName = '';
  memory.chosen = new Set();
  memory.floors = 'auto';
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
    let shown = null;
    let colours = [];
    let coloursKey = '';

    const graphNow = () => store.derived.get('graph', ['building'], (project) => buildGraph(project));
    // once a state of the building: rooms, doors, exits, connections, names
    const pictureNow = () => store.derived.get('safety-picture', ['building'], (project) => safetyPicture(project, graphNow()));

    // ---- the first line
    const lineWords = h('span', { class: 'mov-line__words', data: { part: 'words' } });
    const allButton = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-all' }, on: { click: showEvery } }, 'Show every room');
    const line = h('p', { class: 'mov-line intro__first', id: 'safety-line' }, lineWords, ' ', allButton);
    const top = h('div', { class: 'mov-top sfy-top' }, line);
    const headline = h('h1', { class: 'vh' }, HEADLINE);

    // ---- the key, docked under the map
    const keyList = h('ul', { class: 'sfy-key__list', 'aria-label': 'Exits on the map' });
    const marks = h('p', { class: 'sfy-key__marks', hidden: true }, MARKS_SAY);
    const repeat = h('p', { class: 'sfy-key__note', hidden: true, data: { note: 'repeat' } });
    const zoomNote = h('p', { class: 'sfy-key__note', hidden: true, data: { note: 'zoom' } }, ZOOM_SAYS);
    const keyLine = h('div', { class: 'sfy-key', data: { part: 'key' } }, h('span', { class: 'sfy-key__title', 'aria-hidden': 'true' }, 'Key'), keyList, marks, repeat, zoomNote);

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
      if (!picture || !shown) return null;
      const lost = memory.picked ? picture.byRoom.get(memory.picked) : null;
      return {
        mode: memory.picked ? 'one' : 'all',
        picked: memory.picked,
        lost: lost && !lost.ok ? { floorId: lost.floorId, cells: lost.cells } : null,
        rooms: picture.rows.filter((row) => row.ok).map((row) => ({ roomId: row.roomId, floorId: row.floorId, cells: row.cells, route: row.route, number: row.exitNumber, colour: exitColour(row.exitNumber) })),
      };
    }));
    // the picked room's stairs, from one floor to the other, over every floor
    plan.across.push((g, given) => {
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
      project: () => shown,
      picked: () => memory.picked,
      chosen: () => memory.chosen,
      swatch,
      themeKey: () => plan.theme().corridor,
      pick(roomId) {
        // on a phone the inspector is a sheet over the map: it is shut, so the way out is seen
        const sheet = document.getElementById('inspector');
        if (sheet && sheet.dataset.mode === 'sheet' && sheet.dataset.open === 'true') ctx.closeInspector();
        pick(roomId, { say: true, bring: true });
      },
      // where the focus goes when what held it in a panel is gone: the map
      home: () => plan.focus(),
    };
    const panels = { exits: exitsPanel(env), cards: doorCardsPanel(env) };
    const inspector = tabs({
      label: 'Ways out and door cards',
      selected: memory.tab,
      onSelect(id) {
        memory.tab = id;
        drawPanel();
      },
      items: SAFETY_TABS.map((tab) => ({ id: tab.id, label: tab.label, panel: () => panels[tab.id].element })),
    });
    const inspectorBox = h('div', { class: 'mov-inspector sfy-inspector' }, inspector.element);
    ctx.setInspector(inspectorBox);
    function drawPanel() {
      if (picture && shown) panels[inspector.selected].update();
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
        if (!found) ctx.announce('Between floors.');
        else if (!row) ctx.announce(found.slot.floor.name + ': not a room.');
        else ctx.announce(cursorLine(row, picture));
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
      keyList.hidden = one;
      marks.hidden = !one;
      marks.textContent = row && !row.ok ? LOST_SAYS : MARKS_SAY;
      keyLine.dataset.mode = one ? 'one' : 'all';
      const repeats = !one && picture.exits.length > EXIT_COUNT;
      repeat.hidden = !repeats;
      repeat.textContent = repeats ? REPEAT_SAYS(EXIT_COUNT) : '';
      drawZoomNote(plan.view.size);
      if (one) return;
      keyList.replaceChildren(...picture.exits.map((exit) => h('li', { class: 'sfy-key__item', data: { exit: exit.exitId, number: String(exit.number) } },
        h('span', { class: 'sfy-swatch', style: swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
        h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
        h('span', null, h('bdi', { class: 'sfy-key__name' }, exit.name), ', ' + count(exit.rooms, 'room')))));
    }

    // the badges are drawn from EXIT_KEY_LEAST px a cell; under it, with
    // every room shown, the key says that zooming in shows the numbers
    function drawZoomNote(size) {
      const hide = gone || !picture || Boolean(memory.picked) || !(size > 0) || size >= EXIT_KEY_LEAST;
      if (zoomNote.hidden !== hide) zoomNote.hidden = hide;
    }

    function draw() {
      if (!picture || gone) return;
      if (memory.picked && !picture.byRoom.has(memory.picked)) memory.picked = null;
      if (memory.picked) memory.pickedName = picture.byRoom.get(memory.picked).name;
      lineWords.replaceChildren(...words(firstLine(shown, picture, memory.picked)));
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
      const f = figures(project);
      const nothing = f.rooms === 0 || f.exits === 0;
      map.hidden = nothing;
      empty.hidden = !nothing;
      headline.hidden = nothing;
      plan.showFloors(!nothing);
      if (nothing) {
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
      element.dataset.rooms = String(picture.rows.length);
      element.dataset.missing = String(picture.missing.length);
      draw();
      plan.setProject(project, graph);
      if (lost) ctx.announce(GONE_SAYS(lost));
    }

    refresh();

    element.safety = {
      plan,
      get picture() { return picture; },
      get picked() { return memory.picked; },
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
