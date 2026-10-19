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
//             colour; with a room picked, what the two marks mean
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
import { evacuationOverlay, exitColours, runsOf } from '../surface/overlays/evacuation.js';
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

// What is chosen here, kept for the open project while the page is open
// (in memory: no storage key).
const memory = { projectId: null, picked: null, chosen: new Set(), floors: 'auto', tab: 'exits' };

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
    if (memory.projectId !== store.project.id) {
      memory.projectId = store.project.id;
      memory.picked = null;
      memory.chosen = new Set();
      memory.floors = 'auto';
    }
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
    const allButton = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'show-all' }, on: { click: () => pick(null, { say: true }) } }, 'Show every room');
    const line = h('p', { class: 'mov-line intro__first', id: 'safety-line' }, lineWords, ' ', allButton);
    const top = h('div', { class: 'mov-top sfy-top' }, line);
    const headline = h('h1', { class: 'vh' }, HEADLINE);

    // ---- the key, docked under the map
    const keyList = h('ul', { class: 'sfy-key__list', 'aria-label': 'Exits on the map' });
    const marks = h('p', { class: 'sfy-key__marks', hidden: true }, MARKS_SAY);
    const keyLine = h('div', { class: 'sfy-key', data: { part: 'key' } }, h('span', { class: 'sfy-key__title', 'aria-hidden': 'true' }, 'Key'), keyList, marks);

    const plan = createPlanMap({
      ctx,
      name: 'safety',
      label: 'The evacuation map',
      keys: KEYS,
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

    // ---- the exits' colours, for the theme on screen
    function exitColour(number) {
      const theme = plan.theme();
      const many = picture ? picture.exits.length : 0;
      const key = theme.corridor + ':' + many;
      if (key !== coloursKey) {
        coloursKey = key;
        colours = exitColours(many, theme);
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
    plan.overlays.push(evacuationOverlay(() => {
      if (!picture || !shown) return null;
      return {
        mode: memory.picked ? 'one' : 'all',
        picked: memory.picked,
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
      pick: (roomId) => pick(roomId, { say: true, bring: true }),
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
    //   options.bring   bring the room onto the map (picked from a list)
    function pick(roomId, options) {
      const opts = options || {};
      const row = roomId && picture ? picture.byRoom.get(roomId) : null;
      memory.picked = row ? roomId : null;
      draw();
      if (opts.bring && row && row.cells.length > 0) plan.show(row.floorId, row.cells);
      if (opts.say) ctx.announce(lineWords.textContent);
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
        else if (!row.ok) ctx.announce(row.name + ': ' + row.sentence);
        else ctx.announce(row.name + ': out by ' + picture.exits.find((exit) => exit.exitId === row.exitId).name + '. Enter shows its way out.');
      } else if (ev.kind === 'escape') {
        if (!memory.picked) return false;
        pick(null, { say: true });
        return true;
      }
      return false;
    });
    // Enter over a room picks it. The map makes Enter a press on the
    // cursor's cell, which is a pan on this map, so the key is read here.
    function onKey(event) {
      if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const cursor = plan.cursor;
      const { room } = roomUnder(cursor.x + 0.5, cursor.y + 0.5);
      if (room && picture && picture.byRoom.has(room.id)) pick(room.id, { say: true });
      else ctx.announce('There is no room under the cursor.');
    }
    plan.canvas.addEventListener('keydown', onKey);

    // the key and the lists follow a theme the device changes (the map draws itself again)
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => requestAnimationFrame(() => {
      if (!gone) draw();
    });
    dark.addEventListener('change', onScheme);

    // ---- everything but the canvas
    function drawKey() {
      const one = Boolean(memory.picked);
      keyList.hidden = one;
      marks.hidden = !one;
      keyLine.dataset.mode = one ? 'one' : 'all';
      if (one) return;
      keyList.replaceChildren(...picture.exits.map((exit) => h('li', { class: 'sfy-key__item', data: { exit: exit.exitId, number: String(exit.number) } },
        h('span', { class: 'sfy-swatch', style: swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
        h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
        h('span', null, h('bdi', { class: 'sfy-key__name' }, exit.name), ', ' + count(exit.rooms, 'room')))));
    }

    function draw() {
      if (!picture || gone) return;
      // The renderer keeps the theme it first reads (ui/surface/renderer.js),
      // and a canvas not yet in the document reads no tokens at all: the key's
      // colours wait until the shell has put the section on the page, which
      // it does as soon as mount returns.
      if (!element.isConnected) {
        queueMicrotask(draw);
        return;
      }
      if (memory.picked && !picture.byRoom.has(memory.picked)) memory.picked = null;
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
      // a chosen room the building no longer has is let go
      for (const id of Array.from(memory.chosen)) if (!picture.byRoom.has(id)) memory.chosen.delete(id);
      element.dataset.rooms = String(picture.rows.length);
      element.dataset.missing = String(picture.missing.length);
      draw();
      plan.setProject(project, graph);
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
        plan.canvas.removeEventListener('keydown', onKey);
        dark.removeEventListener('change', onScheme);
        plan.unmount();
      },
    };
  },
};
