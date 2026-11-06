// The cells the Properties tab is about when no room or other space is
// selected: the stop whose Properties were asked for, the corridor cells
// whose step is being marked, any cell that "Marks…" was opened on.
//
// The plan's own selection holds spaces only (ui/building/index.js), so these
// cells are kept here, one set per editor, and the Properties tab reads them.
// A selected space takes the tab back, which clears them.
//
//   focusCells(ed, floorId, cells)   put these cells in Properties and open it
//   cellFocus(ed) -> { get(), set(floorId, cells), clear() }
//   returnToCell(ed, cell)           the keyboard cursor and the focus go back to the plan
//
// Whatever puts a cell in front of the user (the menu, a tool that selects
// cells) calls focusCells; nothing else needs to know how it is stored.

const held = new WeakMap();

export function cellFocus(ed) {
  if (!held.has(ed)) held.set(ed, { value: null });
  const box = held.get(ed);
  return {
    get: () => box.value,
    set(floorId, cells) {
      box.value = { floorId, cells: Array.from(new Set(cells)).sort((a, b) => a - b) };
    },
    clear() {
      box.value = null;
    },
  };
}

// Put cells in the Properties tab and show it. A selected room is let go first,
// so the tab is about the cells.
export function focusCells(ed, floorId, cells) {
  cellFocus(ed).set(floorId, cells);
  if (ed.selection.length > 0) ed.select([]);
  if (ed.inspector) ed.inspector.showTab('properties');
}

// The keyboard cursor goes to the cell, shown, and the plan takes the focus:
// where a menu action leaves the user (DESIGN 13.3).
export function returnToCell(ed, cell, visible = true) {
  const floor = ed.floor;
  if (cell < 0 || cell >= floor.width * floor.height) return;
  ed.cursor.moveTo(cell % floor.width, Math.floor(cell / floor.width), visible ? true : undefined);
  ed.canvas.focus({ preventScroll: true });
}
