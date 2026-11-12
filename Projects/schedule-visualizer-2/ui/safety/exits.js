// The Exits tab of the Safety inspector (spec 10.1; DESIGN 5.5): every exit,
// numbered as the key under the map numbers it, with the rooms that go out
// by it and how many people they hold (byExit), and the rooms with no way
// out, each with the routing engine's sentence (noRoute). A room's name is a
// button that shows its way out on the map.
//
//   exitsPanel(env) -> { element, update() }
//     env   { picture(), project(), picked(), swatch(number), themeKey(), pick(roomId),
//             home() (puts the focus on the map) }
//
// A room's button that held the focus and is gone with its room gives the
// focus to the button now in its place in the panel, or the one before, or
// with none left to the map.

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { HEAVY_SHARE, HEAVY_MARGIN } from '../../engine/exit-load.js';

const CAPACITY_UNSET = (n) => (n === 1 ? '1 room has no capacity set and is not counted' : n + ' rooms have no capacity set and are not counted');

// the load warning's words (DESIGN 14.2, 14.7 item 2)
export const HEAVY_WORDS = 'Far more than the others';
export const BLOCKED_WORDS = 'Blocked in this trial';
export const HEAVY_ADVICE = 'The tool does not know door widths. Check this door and the way to it in your next drill.';
export const heavyRule = (basis) => 'Why: an exit is flagged when its share is ' + HEAVY_SHARE + ' times an even share and at least ' + HEAVY_MARGIN[basis === 'rooms' ? 'rooms' : 'people'] + ' ' + (basis === 'rooms' ? 'rooms' : 'people') + ' more.';
export const BASIS_ROOMS_SAYS = 'Most rooms have no capacity set, so this compares rooms, not people.';
export const BASIS_LINK = 'Set capacities in Building › Rooms.';

// "12 rooms, 420 people": an exit's figures; under a trial, what they were
function figuresOf(exit) {
  if (exit.rooms === 0) return 'No room goes out this way.';
  return count(exit.rooms, 'room') + ', ' + count(exit.people, 'person', 'people') + (exit.uncounted > 0 ? ' (' + CAPACITY_UNSET(exit.uncounted) + ')' : '') + '.';
}

// a sentence as parts when the engine gives them (typed names set apart), else as it is
function sentenceOf(load) {
  if (Array.isArray(load.sentenceParts)) return load.sentenceParts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
  return [load.sentence];
}

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

  // The load warning (spec 10.1): with a heavy exit a warning block in words, its sentence and
  // advice, and the rule that flagged it; with one way out only, a note; and, when the figures
  // compare rooms, the line that says so with a link to where capacities are set.
  function loadBlock(picture) {
    const load = picture.load;
    if (!load) return null;
    const heavy = load.heavy.length > 0;
    const parts = [];
    if (heavy) {
      parts.push(h('div', { class: 'sfy-warn', role: 'group', 'aria-label': 'Warning', data: { part: 'load-warning' } },
        h('p', { class: 'sfy-warn__head' }, h('strong', null, 'Warning')),
        h('p', { class: 'sfy-warn__sentence', data: { part: 'load-sentence' } }, ...sentenceOf(load)),
        h('p', { class: 'sfy-warn__advice' }, HEAVY_ADVICE),
        h('p', { class: 'sfy-warn__rule', data: { part: 'load-rule' } }, heavyRule(load.basis))));
    } else if (load.sentence) {
      parts.push(h('p', { class: 'sfy-note', role: 'note', data: { part: 'load-note' } }, ...sentenceOf(load)));
    }
    if (load.basis === 'rooms') {
      parts.push(h('p', { class: 'sfy-note', data: { part: 'load-basis' } }, BASIS_ROOMS_SAYS + ' ', h('button', { type: 'button', class: 'mov-link', data: { action: 'to-rooms' }, on: { click: () => env.ctx.navigate('#building') } }, BASIS_LINK)));
    }
    return parts.length === 0 ? null : h('div', { class: 'sfy-load', data: { part: 'load' } }, parts);
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
    const heldAt = held ? Array.from(element.querySelectorAll('.sfy-room')).indexOf(document.activeElement) : -1;
    drawnFor = picture;
    drawnTheme = env.themeKey();
    drawnPicked = env.picked();
    const rows = new Map(picture.rows.map((row) => [row.roomId, row]));
    const exits = picture.exits.map((exit) => {
      const people = exit.blocked ? BLOCKED_WORDS + '.' : figuresOf(exit);
      const was = exit.was ? h('span', { class: 'sfy-exit__was', data: { part: 'was' } }, ' Was ' + count(exit.was.rooms, 'room') + ', ' + count(exit.was.people, 'person', 'people') + '.') : null;
      const assembly = typeof exit.assembly === 'string' && exit.assembly.trim() !== ''
        ? h('p', { class: 'sfy-exit__assembly' }, 'Assembly point: ', h('bdi', null, exit.assembly))
        : h('p', { class: 'sfy-exit__assembly sfy-exit__assembly--none' }, 'No assembly point is set for this exit.');
      return h('li', { class: 'sfy-exit', data: { exit: exit.exitId } },
        h('h3', { class: 'sfy-exit__name' },
          h('span', { class: 'sfy-swatch', style: env.swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
          h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
          h('bdi', null, exit.name)),
        h('p', { class: 'sfy-exit__where' }, 'On ', h('bdi', null, exit.floorName), '. ', exit.blocked ? h('strong', { class: 'sfy-heavy sfy-heavy--blocked', data: { part: 'blocked' } }, people) : people, was, exit.heavy ? [' ', h('strong', { class: 'sfy-heavy', data: { part: 'heavy' } }, HEAVY_WORDS)] : null),
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
      loadBlock(picture),
      h('p', { class: 'sfy-panel__lead' }, 'Each room goes out by the exit it reaches soonest on foot, stairs counted and elevators never used. People are the rooms’ capacities.'),
      h('ol', { class: 'sfy-exits', 'aria-label': 'Exits' }, exits),
      h('h2', { class: 'mov-panel__sub', id: 'safety-missing' }, 'Rooms with no way out'),
      missing.length === 0
        ? h('p', { class: 'sfy-missing__none', data: { missing: '0' } }, 'Every room has a way out.')
        : h('ul', { class: 'sfy-missing', 'aria-labelledby': 'safety-missing', data: { missing: String(missing.length) } }, missing));
    if (held) {
      const again = element.querySelector('[data-room="' + CSS.escape(held) + '"].sfy-room');
      if (again) again.focus();
      else {
        const buttons = element.querySelectorAll('.sfy-room');
        if (buttons.length > 0) buttons[Math.min(Math.max(heldAt, 0), buttons.length - 1)].focus();
        else env.home();
      }
    }
  }

  return { element, update };
}
