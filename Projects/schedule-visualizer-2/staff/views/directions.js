// #/directions?from=…&to=…  Directions
//
// Pick a start room and an end room: the way between them as numbered steps,
// the floors it passes through, and about how long the walk is. The route and
// its words are the engine's (routing.js and directions.js, through the
// school of model.js), the same ones the planner draws. "Step-free" asks for
// a way with no stairs (?stepfree=1) and says so plainly when there is none;
// the way with stairs is offered only when there is one (directionsRefusal).
//
// The time is the route's own estimate for an empty corridor.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, printGate } from '../page.js';
import { viewLink, sectionHeading } from '../clock.js';
import { floorMap } from '../map.js';
import { ELEVATOR_KIND } from '../../engine/schema.js';

// "under a minute", "about 1 minute", "about 4 minutes".
function about(seconds) {
  if (seconds < 45) return 'under a minute';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return 'about ' + minutes + (minutes === 1 ? ' minute' : ' minutes');
}

function roomPicker(school, id, label, value) {
  const select = h('select', { class: 'field__input', id },
    h('option', { value: '' }, 'Choose a room…'),
    school.floors.map((floor) => {
      const rooms = floor.spaces.filter((space) => space.kind === 'room');
      if (rooms.length === 0) return null;
      const names = h('optgroup', { label: floor.name });
      for (const room of rooms) names.appendChild(h('option', { value: room.id, selected: room.id === value }, school.roomName(room, true)));
      return names;
    }));
  return { select, field: h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, label), select) };
}

// The crossings a route makes, in the order walked, read from the route's own
// cells (ARCHITECTURE 19.4): crossing i leaves cells[connectionAt[i]] and
// arrives at the next cell. A car's id is its first connection's, whose own
// ends need not be the floors this ride joins, so the ends are never read from
// the connection. [{ kind: 'stairs' | 'ride', label, at, fromFloorId,
// toFloorId }]; `label` is the stairs' letter or the elevator's.
export function routeCrossings(school, found) {
  const connections = school.data.building.connections;
  const cells = found.cells || [];
  return (found.connections || []).map((id, i) => {
    const connection = connections.find((item) => item.id === id);
    const at = (found.connectionAt || [])[i];
    const ride = Boolean(connection) && connection.kind === ELEVATOR_KIND;
    const label = !connection ? '' : ride && typeof connection.car === 'string' && connection.car !== '' ? connection.car : connection.label;
    return { kind: ride ? 'ride' : 'stairs', label, at, fromFloorId: cells[at] ? cells[at].floorId : null, toFloorId: cells[at + 1] ? cells[at + 1].floorId : null };
  });
}

// The floors a route passes through, in the order walked, with the way
// between them: [{ floor, cells, stairs, via }]. `via` is the crossing taken
// to leave the floor ({ kind: 'stairs' | 'ride', label, ... }, null on the
// last floor, and { kind: 'stairs', label: '' } when the route does not say);
// `stairs` is its label, kept for the ones that read it ("" for none, null on
// the last floor).
export function routeFloors(school, found) {
  const parts = [];
  found.cells.forEach((step, index) => {
    const last = parts[parts.length - 1];
    if (last && last.floorId === step.floorId) {
      last.cells += 1;
      last.end = index;
    } else parts.push({ floorId: step.floorId, floor: school.floor(step.floorId), cells: 1, end: index, stairs: null, via: null });
  });
  // the crossing that leaves a floor is the one taken from that floor's last cell
  const crossings = routeCrossings(school, found);
  parts.forEach((part, index) => {
    if (index === parts.length - 1) return;
    const taken = crossings.find((each) => each.at === part.end);
    part.via = taken || { kind: 'stairs', label: '' };
    part.stairs = part.via.label;
  });
  return parts;
}

// A way that could not be found, for the page: { text, stairs }. `text` is
// the engine's sentence. With step-free asked for, the way is looked for once
// more with stairs allowed: `stairs` is true when that way exists, so the
// page offers it; when there is no way of any kind the sentence is the plain
// refusal's, and nothing is offered that would only lead to another refusal.
// Null when the way was found. `asked`, when given, is the route the page
// already looked for with these rooms and this choice: it is not looked for
// again, so a step-free refusal costs two routes, not three.
export function directionsRefusal(school, fromId, toId, stepFree, asked) {
  const found = asked || school.route(fromId, toId, { avoidStairs: stepFree });
  if (found.ok) return null;
  if (!stepFree) return { text: school.directions(found).text, stairs: false };
  const plain = school.route(fromId, toId, { avoidStairs: false });
  if (plain.ok) return { text: school.directions(found).text, stairs: true };
  return { text: school.directions(plain).text, stairs: false };
}

// The polite region that says the new way after Step-free is ticked or
// unticked. Like the calendar's month status it is on the page before its
// words change (a live region added with its words is not announced), and one
// serves every drawing of the way. It is cleared after a while so it is not
// read as part of another page.
const ROUTE_SAID_MS = 10000;
let routeTimer = 0;

let routeRegion = null;

function routeStatus() {
  if (routeRegion === null || routeRegion.isConnected === false) {
    routeRegion = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', dataset: { says: 'route' } });
    if (document.body) document.body.appendChild(routeRegion);
  }
  return routeRegion;
}

function sayRoute(words) {
  const region = routeStatus();
  globalThis.clearTimeout(routeTimer);
  region.textContent = words;
  routeTimer = globalThis.setTimeout(() => {
    region.textContent = '';
  }, ROUTE_SAID_MS);
}

export const directionsView = {
  id: 'directions',
  flag: 'directions',
  nav: 'search',
  title(ctx, route) {
    return 'Directions';
  },
  render(ctx, route) {
    const school = ctx.school;
    const state = {
      from: school.room(route.query.from) ? route.query.from : '',
      to: school.room(route.query.to) ? route.query.to : '',
      stepFree: route.query.stepfree === '1',
      announce: false,
    };

    const says = h('p', { class: 'lede', role: 'status' });
    const out = h('div', { class: 'stack', dataset: { out: 'directions' } });
    const from = roomPicker(school, 'directions-from', 'From', state.from);
    const to = roomPicker(school, 'directions-to', 'To', state.to);
    const stepFree = h('input', { class: 'check__input', id: 'directions-stepfree', type: 'checkbox', checked: state.stepFree });
    const gate = printGate();
    routeStatus();

    const draw = () => {
      gate.set(false);
      if (!state.from || !state.to) {
        says.replaceChildren(h('span', null, 'Choose where you are starting and where you are going.'));
        out.replaceChildren();
        return;
      }
      const found = school.route(state.from, state.to, { avoidStairs: state.stepFree });
      const written = school.directions(found);
      const start = school.room(state.from);
      const end = school.room(state.to);
      const ends = ['From ', viewLink(school, 'room', start.id, typed(school.roomName(start))), ' to ', viewLink(school, 'room', end.id, typed(school.roomName(end)))];
      says.dataset.ok = String(Boolean(found.ok && !found.same));

      if (!found.ok) {
        // the engine's own sentence: which room, which floor, and what was avoided
        const refusal = directionsRefusal(school, state.from, state.to, state.stepFree, found);
        says.replaceChildren(h('span', null, typed(refusal.text)));
        if (state.announce) sayRoute('Route updated: ' + refusal.text);
        out.replaceChildren(...[
          refusal.stairs ? h('p', { dataset: { directions: 'stairs' } }, 'There is a way that uses stairs. ', h('button', { class: 'btn', type: 'button', onclick: () => {
            stepFree.checked = false;
            stepFree.dispatchEvent(new Event('change'));
            stepFree.focus();
          } }, 'Show the way with stairs')) : null,
        ].filter(Boolean));
        return;
      }
      if (found.same) {
        says.replaceChildren(h('span', null, typed(written.text)));
        out.replaceChildren();
        return;
      }

      gate.set(true);
      const floors = routeFloors(school, found);
      const crossings = routeCrossings(school, found);
      const stairs = found.stairs;
      const rides = crossings.filter((each) => each.kind === 'ride');
      const byOf = (part) => (part.via && part.via.kind === 'ride' ? ['Elevator ', typed(part.via.label)] : part.via && part.via.label ? ['stairs ', typed(part.via.label)] : 'the stairs');
      // the line on each floor, in words: the picture's alternative
      const lineOn = (floor) => {
        const here = floors.map((part, index) => ({ part, index })).filter((each) => each.part.floorId === floor.id);
        if (here.length === 0) return [h('span', null, 'The way does not cross ', typed(floor.name), '.')];
        return [h('span', null, here.map(({ part, index }, at) => [
          at > 0 ? ' Then from ' : ['On ', typed(floor.name), ' the line runs from '],
          index === 0 ? typed(school.roomName(start)) : byOf(floors[index - 1]),
          ' to ',
          part.via === null ? typed(school.roomName(end)) : byOf(part),
          '.',
        ]))];
      };
      says.replaceChildren(h('span', null, ends, ': ', about(found.seconds), stairs === 0 && rides.length === 0 ? ', all on one floor' : null, stairs > 0 ? ', ' + stairs + (stairs === 1 ? ' flight' : ' flights') + ' of stairs' : null, rides.length > 0 ? [', ', 'by ', rides.map((each, at) => [at > 0 ? ' and ' : null, 'Elevator ', typed(each.label)])] : null, state.stepFree ? ', step-free' : null, '.'));
      // after the reader has ticked or unticked Step-free, the new way is announced politely
      if (state.announce) {
        const takes = [rides.length > 0 ? 'takes ' + rides.map((each) => 'Elevator ' + each.label).join(' and ') : null, stairs > 0 ? 'takes ' + stairs + (stairs === 1 ? ' flight' : ' flights') + ' of stairs' : null].filter(Boolean);
        sayRoute('Route updated: ' + (takes.length === 0 ? 'all on one floor' : takes.join(' and ')) + '.');
      }
      out.replaceChildren(
        h('section', { class: 'card', dataset: { directions: 'steps' } },
          sectionHeading('The way', written.steps.length),
          h('ol', { class: 'steps' }, written.steps.map((step) => h('li', { class: 'steps__step', dataset: { kind: step.kind } },
            step.parts.map((part) => (part.name ? typed(part.text) : part.text))))),
          h('p', { class: 'muted', dataset: { directions: 'time' } }, 'The walk is ' + school.formatDuration(found.seconds) + ' at the school\'s walking pace' + (rides.length > 0 ? ', including the elevator\'s wait' : '') + ', for an empty corridor. Distances are in cells of the floor plan.')),
        h('section', { class: 'card', dataset: { directions: 'floors' } },
          sectionHeading('Floors on the way', floors.length),
          h('ol', { class: 'plain' }, floors.map((part) => h('li', null,
            school.has('map') && part.floor ? h('a', { href: makeHash('map', part.floorId) }, typed(part.floor.name)) : typed(part.floor ? part.floor.name : 'a floor'),
            part.via === null ? ', where the walk ends' : [', then ', byOf(part)]))),
          school.has('map') ? floorMap(ctx, {
            floorId: floors[0].floorId,
            label: 'The way on the map',
            route: found,
            marks: [{ roomId: start.id, ring: true }, { roomId: end.id, ring: true }],
            says: lineOn,
          }) : null));
    };

    const address = () => ctx.replace(makeHash('directions', '', { from: state.from, to: state.to, stepfree: state.stepFree ? '1' : '' }));
    const changed = () => {
      state.announce = true;
      state.from = from.select.value;
      state.to = to.select.value;
      state.stepFree = stepFree.checked;
      address();
      draw();
    };
    from.select.addEventListener('change', changed);
    to.select.addEventListener('change', changed);
    stepFree.addEventListener('change', changed);
    const swap = h('button', { class: 'btn', type: 'button', dataset: { directions: 'swap' }, onclick: () => {
      const kept = from.select.value;
      from.select.value = to.select.value;
      to.select.value = kept;
      changed();
    } }, 'Swap start and end');

    draw();
    return gate.on(pageOf('Directions', null, says,
      h('div', { class: 'controls' },
        from.field,
        to.field,
        h('label', { class: 'check', for: 'directions-stepfree' }, stepFree, h('span', null, 'Step-free: a way with no stairs')),
        h('p', { class: 'actions' }, swap)),
      out));
  },
};
