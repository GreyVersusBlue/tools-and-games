// #/directions?from=…&to=…  Directions
//
// Pick a start room and an end room: the way between them as numbered steps,
// the floors it passes through, and about how long the walk is. The route and
// its words are the engine's (routing.js and directions.js, through the
// school of model.js), the same ones the planner draws. "Step-free" asks for
// a way with no stairs (?stepfree=1) and says so plainly when there is none.
//
// The time is the route's own estimate for an empty corridor.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf } from '../page.js';
import { viewLink, sectionHeading, shareRow } from '../clock.js';

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

// The floors a route passes through, in the order walked, with the stairs
// between them: [{ floor, cells, stairs }], `stairs` being the letter of the
// stairs taken to leave the floor, or null on the last.
export function routeFloors(school, found) {
  const parts = [];
  for (const step of found.cells) {
    const last = parts[parts.length - 1];
    if (last && last.floorId === step.floorId) last.cells += 1;
    else parts.push({ floorId: step.floorId, floor: school.floor(step.floorId), cells: 1, stairs: null });
  }
  // each change of floor is one of the route's connections, taken in order
  const left = (found.connections || []).map((id) => school.data.building.connections.find((item) => item.id === id)).filter(Boolean);
  parts.forEach((part, index) => {
    if (index === parts.length - 1) return;
    const next = parts[index + 1].floorId;
    const at = left.findIndex((item) => (item.a.floorId === part.floorId && item.b.floorId === next) || (item.b.floorId === part.floorId && item.a.floorId === next));
    part.stairs = at === -1 ? '' : left.splice(at, 1)[0].label;
  });
  return parts;
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
    };

    const says = h('p', { class: 'lede', role: 'status' });
    const out = h('div', { class: 'stack', dataset: { out: 'directions' } });
    const from = roomPicker(school, 'directions-from', 'From', state.from);
    const to = roomPicker(school, 'directions-to', 'To', state.to);
    const stepFree = h('input', { class: 'check__input', id: 'directions-stepfree', type: 'checkbox', checked: state.stepFree });

    const draw = () => {
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
        says.replaceChildren(h('span', null, typed(written.text)));
        out.replaceChildren(...[
          state.stepFree ? h('p', { dataset: { directions: 'stairs' } }, 'There may be a way that uses stairs. ', h('button', { class: 'btn', type: 'button', onclick: () => {
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

      const floors = routeFloors(school, found);
      const stairs = found.connections.length;
      says.replaceChildren(h('span', null, ends, ': ', about(found.seconds), stairs === 0 ? ', all on one floor' : ', ' + stairs + (stairs === 1 ? ' flight' : ' flights') + ' of stairs', state.stepFree ? ', step-free' : null, '.'));
      out.replaceChildren(
        h('section', { class: 'card', dataset: { directions: 'steps' } },
          sectionHeading('The way', written.steps.length),
          h('ol', { class: 'steps' }, written.steps.map((step) => h('li', { class: 'steps__step', dataset: { kind: step.kind } },
            step.parts.map((part) => (part.name ? typed(part.text) : part.text))))),
          h('p', { class: 'muted' }, 'The time is for an empty corridor. Distances are in squares of the floor plan.')),
        h('section', { class: 'card', dataset: { directions: 'floors' } },
          sectionHeading('Floors on the way', floors.length),
          h('ol', { class: 'plain' }, floors.map((part) => h('li', null,
            school.has('map') && part.floor ? h('a', { href: makeHash('map', part.floorId) }, typed(part.floor.name)) : typed(part.floor ? part.floor.name : 'a floor'),
            part.stairs === null ? ', where the walk ends' : [', then stairs ', typed(part.stairs)])))));
    };

    const address = () => ctx.replace(makeHash('directions', '', { from: state.from, to: state.to, stepfree: state.stepFree ? '1' : '' }));
    const changed = () => {
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
    return pageOf('Directions', null, says,
      h('div', { class: 'controls' },
        from.field,
        to.field,
        h('label', { class: 'check', for: 'directions-stepfree' }, stepFree, h('span', null, 'Step-free: a way with no stairs')),
        h('p', { class: 'actions' }, swap)),
      out, shareRow(() => 'Directions · ' + school.name));
  },
};
