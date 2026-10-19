// The Door cards tab of the Safety inspector (spec 10.2; DESIGN 5.5): print
// the cards to post by each door, and every room's way out in words.
//
// Three ways to print, each opening the print preview with the output
// 'door-cards' (ui/prints/door-cards.js), where the paper and the
// orientation are chosen:
//   the picked room's card      the room picked on the map or in a list
//   the rooms ticked            a choice made in the list below, one box a room
//   every room's card           the whole building, in room order
// The list is the map's text alternative (spec 3.10): floor by floor, each
// room with the number of its exit in the key, the exit, the walking time
// and the first step of its card, or the reason it has no way out. A
// room's "Show" button shows its way out on the map.
//
//   doorCardsPanel(env) -> { element, update() }
//     env   { ctx, picture(), project(), picked(), chosen() (a Set of room
//             ids, kept by the section), swatch(number), themeKey(), pick(roomId),
//             home() (puts the focus on the map) }
//
// The focus is never left on nothing: Untick all hides itself, and gives
// the focus to the list's first box; a row whose room is gone gives it to
// the same control of the row now in its place, or of the row before, or
// with no row left to the map.

import { h, uid } from '../components/dom.js';
import { openPrintPreview } from '../components/print-preview.js';
import { roomLine } from './model.js';

export const CHOOSE_FIRST = 'Tick rooms in the list below first.';

export function doorCardsPanel(env) {
  const base = uid('cards');
  const pickedButton = h('button', { type: 'button', class: 'btn btn--primary', data: { print: 'picked' }, on: { click: (event) => print('picked', event.currentTarget) } });
  const chosenButton = h('button', { type: 'button', class: 'btn', data: { print: 'chosen' }, on: { click: (event) => print('chosen', event.currentTarget) } });
  const allButton = h('button', { type: 'button', class: 'btn', data: { print: 'all' }, on: { click: (event) => print('all', event.currentTarget) } });
  const clearButton = h('button', { type: 'button', class: 'btn btn--quiet', data: { action: 'untick' }, on: { click: untick } }, 'Untick all');
  const pickedHint = h('p', { class: 'sfy-cards__hint' }, 'Pick a room on the map for its card alone.');
  const list = h('div', { class: 'sfy-list' });
  const element = h('div', { class: 'mov-panel sfy-panel', data: { panel: 'cards' } },
    h('h2', { class: 'mov-panel__title' }, 'Door cards'),
    h('p', { class: 'sfy-panel__lead' }, 'A card to post by a room’s door: its way out on the map, in numbered steps, and the assembly point. The paper is chosen in the preview.'),
    h('div', { class: 'sfy-cards__print' }, pickedButton, pickedHint, chosenButton, allButton, clearButton),
    h('h3', { class: 'mov-panel__sub', id: base + '-ways' }, 'Every room’s way out'),
    h('p', { class: 'sfy-panel__lead' }, 'Tick the rooms whose cards you want together.'),
    list);
  let drawnFor = null;
  let drawnTheme = null;

  function rooms() {
    const picture = env.picture();
    return picture ? picture.rows : [];
  }

  function print(which, opener) {
    if (which === 'chosen' && env.chosen().size === 0) {
      env.ctx.announce(CHOOSE_FIRST);
      return;
    }
    const options = { opener };
    if (which === 'picked') options.roomIds = [env.picked()];
    else if (which === 'chosen') options.roomIds = rooms().filter((row) => env.chosen().has(row.roomId)).map((row) => row.roomId);
    openPrintPreview(env.ctx, 'door-cards', options);
  }

  function untick() {
    const held = document.activeElement === clearButton;
    env.chosen().clear();
    for (const box of list.querySelectorAll('input[type="checkbox"]')) box.checked = false;
    buttons();
    env.ctx.announce('No room is ticked.');
    if (held) {
      const box = list.querySelector('input[type="checkbox"]');
      if (box) box.focus();
      else env.home();
    }
  }

  function buttons() {
    const picture = env.picture();
    const picked = env.picked() && picture ? picture.byRoom.get(env.picked()) : null;
    pickedButton.hidden = !picked;
    pickedHint.hidden = Boolean(picked);
    if (picked) {
      pickedButton.replaceChildren('Print the card for ', h('bdi', null, picked.name));
      pickedButton.dataset.room = picked.roomId;
    }
    const n = env.chosen().size;
    chosenButton.textContent = n === 0 ? 'Print the rooms ticked' : n === 1 ? 'Print the 1 room ticked' : 'Print the ' + n + ' rooms ticked';
    if (n === 0) {
      chosenButton.setAttribute('aria-disabled', 'true');
      chosenButton.title = CHOOSE_FIRST;
    } else {
      chosenButton.removeAttribute('aria-disabled');
      chosenButton.removeAttribute('title');
    }
    chosenButton.dataset.count = String(n);
    clearButton.hidden = n === 0;
    allButton.textContent = 'Print every room’s card (' + rooms().length + ')';
  }

  function drawList() {
    const picture = env.picture();
    const project = env.project();
    const held = list.contains(document.activeElement) ? document.activeElement.id : null;
    // where it was, for a row that will not be drawn again
    const heldRow = held ? document.activeElement.closest('.sfy-row') : null;
    const heldAt = heldRow ? Array.from(list.querySelectorAll('.sfy-row')).indexOf(heldRow) : -1;
    const heldKind = held ? (document.activeElement.matches('.sfy-row__box') ? '.sfy-row__box' : '.sfy-row__show') : null;
    const byFloor = new Map(project.building.floors.map((floor) => [floor.id, []]));
    for (const row of picture.rows) if (byFloor.has(row.floorId)) byFloor.get(row.floorId).push(row);
    const groups = [];
    for (const floor of project.building.floors) {
      const rows = byFloor.get(floor.id);
      if (rows.length === 0) continue;
      groups.push(h('fieldset', { class: 'sfy-floor', data: { floor: floor.id } },
        h('legend', { class: 'sfy-floor__name' }, h('bdi', null, floor.name)),
        h('ul', { class: 'sfy-rows' }, rows.map((row) => {
          const id = base + '-' + row.roomId;
          const box = h('input', { type: 'checkbox', class: 'sfy-row__box', id, data: { room: row.roomId }, 'aria-describedby': id + '-way' });
          box.checked = env.chosen().has(row.roomId);
          box.addEventListener('change', () => {
            if (box.checked) env.chosen().add(row.roomId);
            else env.chosen().delete(row.roomId);
            buttons();
          });
          const way = h('p', { class: 'sfy-row__way', id: id + '-way', dir: 'auto', data: { way: row.ok ? 'ok' : 'none' } },
            row.ok ? h('span', { class: 'sfy-swatch sfy-swatch--small', style: env.swatch(row.exitNumber), 'aria-hidden': 'true' }, String(row.exitNumber)) : null,
            row.ok ? ' ' : null,
            h('bdi', null, roomLine(row, picture)));
          return h('li', { class: 'sfy-row', data: { room: row.roomId, ok: String(row.ok) } },
            h('div', { class: 'sfy-row__head' },
              box,
              h('label', { class: 'sfy-row__name', for: id }, h('bdi', null, row.name)),
              h('button', { type: 'button', class: 'mov-link sfy-row__show', id: id + '-show', data: { action: 'show', room: row.roomId }, on: { click: () => env.pick(row.roomId) } }, 'Show', h('span', { class: 'vh' }, ' ', row.name, ' on the map'))),
            way);
        }))));
    }
    list.replaceChildren(...groups);
    if (held) {
      const again = document.getElementById(held);
      if (again) again.focus();
      else {
        const rows = list.querySelectorAll('.sfy-row');
        const row = rows.length > 0 ? rows[Math.min(Math.max(heldAt, 0), rows.length - 1)] : null;
        const control = row ? row.querySelector(heldKind) : null;
        if (control) control.focus();
        else env.home();
      }
    }
  }

  function update() {
    const picture = env.picture();
    if (!picture) return;
    if (drawnFor !== picture || drawnTheme !== env.themeKey()) {
      drawnFor = picture;
      drawnTheme = env.themeKey();
      drawList();
    }
    buttons();
  }

  return { element, update };
}
