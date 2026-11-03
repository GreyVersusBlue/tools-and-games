// What the open scenario closes, drawn over the floors of the scenario lab's
// plan (spec 9.1; DESIGN 12.4): a closed corridor's cells and the two ends of
// a closed stairs connection get a cross-hatch in the ink, never the
// difference map's tints, so a closure is told from a change in load by its
// pattern and not by a colour. The chips (with "Trial only") are the text
// alternative; the lab's legend says "Closed in this trial".
//
// The first half has no canvas in it and runs in Node:
//
//   closedMarks(project, levers) -> { cells: Map<floorId, number[]>, ends: Map<floorId, number[]> }
//     the corridor cells and the stairs ends the levers close, each list
//     sorted and without repeats; a lever whose floor, connection or cell is
//     gone from the building is left out (the lab hands the levers reconcile
//     kept, so this is a guard)
//   hatchStep(size) -> px   the gap between two hatch lines at a cell size
//
// The second half draws:
//
//   closedOverlay(read) -> (g, view, floor, theme) => {}   for map.overlays
//     read()  null, or { marks, preview }: closedMarks' answer and, while a
//             corridor is being picked, { floorId, cells } the place under the
//             cursor, outlined in the accent (never filled, so the plan under
//             it stays in view)
//     the function sets `closedOverlay.drawn`, the count of cells it hatched
//     in its last call, for the page to publish (data-closed-drawn)

export const HATCH_LEAST = 3;

export function hatchStep(size) {
  return Math.max(HATCH_LEAST, Math.round(size / 4));
}

function addTo(map, floorId, cell) {
  if (!map.has(floorId)) map.set(floorId, new Set());
  map.get(floorId).add(cell);
}

export function closedMarks(project, levers) {
  const building = project.building ? project.building : project;
  const floors = new Map(building.floors.map((floor) => [floor.id, floor]));
  const cells = new Map();
  const ends = new Map();
  for (const lever of Array.isArray(levers) ? levers : []) {
    if (!lever) continue;
    if (lever.kind === 'corridor') {
      const floor = floors.get(lever.floorId);
      if (!floor || !Array.isArray(lever.cells)) continue;
      for (const cell of lever.cells) if (Number.isInteger(cell) && cell >= 0 && cell < floor.cells.length) addTo(cells, floor.id, cell);
    } else if (lever.kind === 'way' && lever.way === 'closed') {
      const connection = (building.connections || []).find((each) => each.id === lever.connectionId);
      if (!connection) continue;
      for (const end of [connection.a, connection.b]) {
        const floor = floors.get(end.floorId);
        if (floor && Number.isInteger(end.cell) && end.cell >= 0 && end.cell < floor.cells.length) addTo(ends, floor.id, end.cell);
      }
    }
  }
  const sorted = (map) => new Map(Array.from(map, ([id, set]) => [id, Array.from(set).sort((a, b) => a - b)]));
  return { cells: sorted(cells), ends: sorted(ends) };
}

// ---- drawing

// Two sets of diagonals across one cell's box, clipped to it: a cross-hatch.
function hatch(g, x, y, size, step) {
  g.save();
  g.beginPath();
  g.rect(x, y, size, size);
  g.clip();
  g.beginPath();
  for (let d = -size; d <= size * 2; d += step) {
    g.moveTo(x + d, y);
    g.lineTo(x + d - size, y + size);
    g.moveTo(x + d - size, y);
    g.lineTo(x + d, y + size);
  }
  g.stroke();
  g.restore();
}

export function closedOverlay(read) {
  const draw = (g, view, floor, theme) => {
    draw.drawn = 0;
    const given = read();
    if (!given) return;
    const size = view.size;
    const left = Math.max(0, Math.floor(-view.x / size));
    const right = Math.min(floor.width - 1, Math.floor((view.width - view.x) / size));
    const top = Math.max(0, Math.floor(-view.y / size));
    const bottom = Math.min(floor.height - 1, Math.floor((view.height - view.y) / size));
    const inWindow = (cell) => {
      const x = cell % floor.width;
      const y = Math.floor(cell / floor.width);
      return x >= left && x <= right && y >= top && y <= bottom;
    };
    const at = (cell) => ({ x: Math.round(view.x + (cell % floor.width) * size), y: Math.round(view.y + Math.floor(cell / floor.width) * size) });
    g.save();
    if (given.marks) {
      const step = hatchStep(size);
      g.strokeStyle = theme.ink;
      g.lineWidth = size >= 16 ? 1.5 : 1;
      g.globalAlpha = 0.9;
      for (const group of [given.marks.cells.get(floor.id), given.marks.ends.get(floor.id)]) {
        if (!group) continue;
        for (const cell of group) {
          if (!inWindow(cell)) continue;
          const box = at(cell);
          hatch(g, box.x, box.y, Math.round(size), step);
          draw.drawn += 1;
        }
      }
    }
    if (given.preview && given.preview.floorId === floor.id) {
      g.globalAlpha = 1;
      g.strokeStyle = theme.accent;
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      for (const cell of given.preview.cells) {
        if (!inWindow(cell)) continue;
        const box = at(cell);
        g.strokeRect(box.x + 1, box.y + 1, Math.round(size) - 2, Math.round(size) - 2);
      }
    }
    g.restore();
  };
  draw.drawn = 0;
  return draw;
}
