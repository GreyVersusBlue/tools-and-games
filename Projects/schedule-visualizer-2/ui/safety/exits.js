// The Exits tab of the Safety inspector (spec 10.1; DESIGN 5.5): every exit,
// numbered as the key under the map numbers it, with the rooms that go out
// by it and how many people they hold (byExit), and the rooms with no way
// out, each with the routing engine's sentence (noRoute). A room's name is a
// button that shows its way out on the map.
//
//   exitsPanel(env) -> { element, update() }
//     env   { picture(), project(), picked(), swatch(number), themeKey(), pick(roomId) }

import { h } from '../components/dom.js';
import { count } from '../components/words.js';

const CAPACITY_UNSET = (n) => (n === 1 ? '1 room has no capacity set and is not counted' : n + ' rooms have no capacity set and are not counted');

export function exitsPanel(env) {
  const element = h('div', { class: 'mov-panel sfy-panel', data: { panel: 'exits' } });
  let drawnFor = null;
  let drawnTheme = null;
  let drawnPicked;

  function roomButton(row) {
    return h('button', {
      type: 'button',
      class: 'sfy-room',
      'aria-pressed': String(env.picked() === row.roomId),
      data: { room: row.roomId },
      on: { click: () => env.pick(row.roomId) },
    }, h('bdi', null, row.name));
  }

  function update() {
    const picture = env.picture();
    if (!picture) return;
    if (drawnFor === picture && drawnTheme === env.themeKey()) {
      // the same ways out: only which room is picked changed
      if (drawnPicked !== env.picked()) {
        drawnPicked = env.picked();
        for (const button of element.querySelectorAll('.sfy-room')) button.setAttribute('aria-pressed', String(button.dataset.room === drawnPicked));
      }
      return;
    }
    // the focus is put back on the same thing after the panel is drawn again
    const held = element.contains(document.activeElement) ? document.activeElement.dataset.room || null : null;
    drawnFor = picture;
    drawnTheme = env.themeKey();
    drawnPicked = env.picked();
    const rows = new Map(picture.rows.map((row) => [row.roomId, row]));
    const exits = picture.exits.map((exit) => {
      const people = exit.rooms === 0 ? 'No room goes out this way.' : count(exit.rooms, 'room') + ', ' + count(exit.people, 'person', 'people') + (exit.uncounted > 0 ? ' (' + CAPACITY_UNSET(exit.uncounted) + ')' : '') + '.';
      const assembly = typeof exit.assembly === 'string' && exit.assembly.trim() !== ''
        ? h('p', { class: 'sfy-exit__assembly' }, 'Assembly point: ', h('bdi', null, exit.assembly))
        : h('p', { class: 'sfy-exit__assembly sfy-exit__assembly--none' }, 'No assembly point is set for this exit.');
      return h('li', { class: 'sfy-exit', data: { exit: exit.exitId } },
        h('h3', { class: 'sfy-exit__name' },
          h('span', { class: 'sfy-swatch', style: env.swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
          h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
          h('bdi', null, exit.name)),
        h('p', { class: 'sfy-exit__where' }, 'On ', h('bdi', null, exit.floorName), '. ', people),
        assembly,
        exit.roomIds.length > 0 ? h('ul', { class: 'sfy-rooms', 'aria-label': 'Rooms that go out by ' + exit.name }, exit.roomIds.map((id) => h('li', null, roomButton(rows.get(id))))) : null);
    });
    const missing = picture.missing.map((no) => {
      const row = rows.get(no.roomId);
      return h('li', { class: 'sfy-missing__row', data: { room: no.roomId } },
        roomButton(row),
        h('p', { class: 'sfy-missing__why', dir: 'auto' }, no.sentence),
        no.onlyByElevator ? h('p', { class: 'sfy-missing__why' }, 'Its only way out is by elevator, and an elevator is not used in an evacuation.') : null);
    });
    element.replaceChildren(
      h('h2', { class: 'mov-panel__title' }, 'Exits'),
      h('p', { class: 'sfy-panel__lead' }, 'Each room goes out by the exit it reaches soonest on foot, stairs counted and elevators never used. People are the rooms’ capacities.'),
      h('ol', { class: 'sfy-exits', 'aria-label': 'Exits' }, exits),
      h('h2', { class: 'mov-panel__sub', id: 'safety-missing' }, 'Rooms with no way out'),
      missing.length === 0
        ? h('p', { class: 'sfy-missing__none', data: { missing: '0' } }, 'Every room has a way out.')
        : h('ul', { class: 'sfy-missing', 'aria-labelledby': 'safety-missing', data: { missing: String(missing.length) } }, missing));
    if (held) {
      const again = element.querySelector('[data-room="' + CSS.escape(held) + '"].sfy-room');
      if (again) again.focus();
    }
  }

  return { element, update };
}
