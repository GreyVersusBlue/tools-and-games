// The inspector of the building editor (DESIGN 5.1): the panel on the right
// of the plan, with five tabs.
//
//   Properties   the fields of what is selected
//   Rooms        every room of the floor, sortable and edited in place
//   Floor        the floor's name, size and traced image, and what is on it
//   Checks       what the building checks found, each with "Show me"
//   Exits        every exit of the building
//
// Only the tab on show is drawn; the others catch up when they are opened.
// A tab is { element, update({ project, floor, selection }) } and lives in
// ./inspector/.

import { h } from '../components/dom.js';
import { tabs } from '../components/tabs.js';
import { inspectorSheet } from './inspector/sheet.js';
import { propertiesPanel } from './inspector/properties.js';
import { roomsPanel } from './inspector/rooms.js';
import { floorPanel } from './inspector/floor.js';
import { checksPanel } from './inspector/checks.js';
import { exitsPanel } from './inspector/exits.js';

// buildingInspector({ ctx, store, editor(), trace, show(where), toSurface() })
//   -> { element, update(project, floor, selection), focusNumber(), showTab(id), focusExit(id), focusZone(id) }
export function buildingInspector(options) {
  inspectorSheet();
  const panels = {
    properties: propertiesPanel(options),
    rooms: roomsPanel(options),
    floor: floorPanel(options),
    checks: checksPanel(options),
    exits: exitsPanel(options),
  };
  let state = null;

  function draw() {
    if (state) panels[view.selected].update(state);
  }

  const view = tabs({
    label: 'Inspector',
    selected: 'properties',
    onSelect: () => draw(),
    items: [
      { id: 'properties', label: 'Properties', panel: () => panels.properties.element },
      { id: 'rooms', label: 'Rooms', panel: () => panels.rooms.element },
      { id: 'floor', label: 'Floor', panel: () => panels.floor.element },
      { id: 'checks', label: 'Checks', panel: () => panels.checks.element },
      { id: 'exits', label: 'Exits', panel: () => panels.exits.element },
    ],
  });
  const element = h('div', { class: 'bld-inspector' }, view.element);

  function open(id) {
    view.select(id);
    draw();
  }

  return {
    element,
    update(project, floor, selection) {
      state = { project, floor, selection };
      draw();
    },
    // Put the cursor in the room number, everything in it selected.
    focusNumber() {
      open('properties');
      return panels.properties.focusNumber();
    },
    focusExit(exitId) {
      open('exits');
      return panels.exits.focusExit(exitId);
    },
    focusZone(zoneId) {
      open('floor');
      return panels.floor.focusZone(zoneId);
    },
    showTab(id) {
      open(id);
      const tab = element.querySelector('[role="tab"][data-tab="' + id + '"]');
      if (tab) tab.focus();
    },
    get tab() {
      return view.selected;
    },
  };
}
