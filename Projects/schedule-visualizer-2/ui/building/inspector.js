// The inspector of the building editor, as far as this unit builds it: a
// panel with two tabs. Properties shows what is selected and has the one
// field that cannot wait, the selected room's number (a newly placed room is
// selected with this field in focus so the number can be typed at once).
// Floor says what the floor is. Everything else a room, a floor, the checks
// and the exits have arrives with the full inspector, which replaces this file.

import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { tabs } from '../components/tabs.js';
import { NOT_BUILT } from '../components/card.js';
import { setRoomFields } from '../../engine/actions.js';
import { roomName } from '../../engine/findings.js';

// buildingInspector({ store, toSurface() }) -> { element, update(project, floor, selection), focusNumber(), showTab(id) }
export function buildingInspector(options) {
  const properties = h('div', { class: 'bld-inspector__panel', id: 'inspector-properties' });
  const floorPanel = h('div', { class: 'bld-inspector__panel', id: 'inspector-floor' });
  const view = tabs({
    label: 'Inspector',
    selected: 'properties',
    items: [
      { id: 'properties', label: 'Properties', panel: () => properties },
      { id: 'floor', label: 'Floor', panel: () => floorPanel },
    ],
  });
  const element = h('div', { class: 'bld-inspector' }, view.element);
  let shown = null;
  let number = null;

  function numberField(room) {
    // Enter keeps the number and goes back to the plan, with the tool still
    // in hand. A refusal (the number is taken) keeps the focus here.
    let byEnter = false;
    const made = field({
      id: 'room-number',
      label: 'Room number',
      name: 'roomNumber',
      value: room.number,
      commit: (value) => {
        const enter = byEnter;
        byEnter = false;
        options.store.apply(setRoomFields, { roomId: room.id, number: value });
        if (enter) options.toSurface();
      },
    });
    // heard before the field's own listener, which does the keeping
    made.input.addEventListener('keydown', (event) => {
      byEnter = event.key === 'Enter';
    }, true);
    // heard after it: Enter on a number that was not changed has nothing to
    // keep, and goes back to the plan all the same
    made.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !byEnter) return;
      byEnter = false;
      if (made.input.getAttribute('aria-invalid') !== 'true') options.toSurface();
    });
    made.input.addEventListener('blur', () => {
      byEnter = false;
    });
    return made;
  }

  function update(project, floor, selection) {
    const spaces = selection.map((id) => floor.spaces.find((space) => space.id === id)).filter(Boolean);
    const key = spaces.map((space) => space.id).join(' ');
    const one = spaces.length === 1 ? spaces[0] : null;
    if (key !== shown) {
      shown = key;
      number = null;
      if (spaces.length === 0) {
        properties.replaceChildren(
          h('h2', { class: 'bld-inspector__title' }, 'Nothing is selected'),
          h('p', null, 'Click a room with the Select tool to see it here. A room you have just drawn is selected already.'),
        );
      } else if (!one) {
        properties.replaceChildren(
          h('h2', { class: 'bld-inspector__title' }, spaces.length + ' spaces are selected'),
          h('p', null, 'Drag one to move them together. Delete removes them. Ctrl+C copies them, and Ctrl+V pastes the copy where the pointer is, on any floor.'),
        );
      } else if (one.kind === 'room') {
        number = numberField(one);
        properties.replaceChildren(
          h('h2', { class: 'bld-inspector__title', id: 'inspector-title' }),
          number.element,
          h('p', { class: 'bld-inspector__small' }, 'A room needs a number before a group can be scheduled into it. A name works too: Gym, Library.'),
          h('p', { class: 'bld-inspector__small' }, 'Its teachers, subject, capacity and doors go here. ' + NOT_BUILT),
        );
      } else {
        properties.replaceChildren(
          h('h2', { class: 'bld-inspector__title', id: 'inspector-title' }),
          h('p', null, 'An other space is shown and labelled, and nobody is scheduled into it or walks through it.'),
          h('p', { class: 'bld-inspector__small' }, 'Its label, kind and colour go here. ' + NOT_BUILT),
        );
      }
    }
    if (one) {
      const title = properties.querySelector('#inspector-title');
      const name = one.kind === 'room' ? roomName(one, true) : (one.label.trim() === '' ? 'An other space' : one.label);
      if (title.textContent !== name) title.textContent = name;
      if (number) number.set(one.number);
    }
    const about = floor.name + ' is ' + floor.width + ' × ' + floor.height + ' squares.';
    if (floorPanel.dataset.about !== about) {
      floorPanel.dataset.about = about;
      floorPanel.replaceChildren(
        h('h2', { class: 'bld-inspector__title' }, floor.name),
        h('p', null, about),
        h('p', { class: 'bld-inspector__small' }, 'Renaming the floor, changing its size and tracing over a photo of your floor plan go here. ' + NOT_BUILT),
      );
    }
  }

  return {
    element,
    update,
    // Put the cursor in the room number, everything in it selected.
    focusNumber() {
      view.select('properties');
      if (!number) return false;
      number.input.focus();
      number.input.select();
      return true;
    },
    showTab(id) {
      view.select(id);
      const tab = element.querySelector('[role="tab"][data-tab="' + id + '"]');
      if (tab) tab.focus();
    },
  };
}
