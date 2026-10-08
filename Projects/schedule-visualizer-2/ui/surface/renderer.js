// Draws one floor of the building on a canvas (DESIGN 5.1): the empty grid,
// corridors, stairs with their connection letters, rooms and other spaces in
// their colours with one outline each and gaps for doors, exits, corridor
// names, exclusion zones, and on top the marks of the editor: a tool's
// preview, the selection, the hovered cell and the keyboard cursor.
//
// Only what is in the window is drawn. Every boundary is rounded to a whole
// pixel, so cells meet with no seam at any zoom.
//
//   const renderer = createRenderer(canvas);
//   renderer.resize(width, height, devicePixelRatio)
//   renderer.draw(scene)
//
// scene = {
//   project, floor, view,          the data and the viewport (viewport.js)
//   selection,                     ids of the selected rooms and spaces
//   hover,                         a cell index, or null
//   cursor,                        a cell index when the keyboard cursor shows, or null
//   preview,                       what a tool is about to do (below), or null
//   underlay(g, view, floor),      drawn under the cells: a traced image
//   overlays: [(g, view, floor, theme) => {}],   drawn over the plan and under
//                                  the editor's marks: route lanes, loads
// }
//
// preview is one of
//   { kind: 'cells', cells, as: 'corridor' | 'stairs' | 'erase' }
//   { kind: 'rect', rect: { x, y, w, h }, as: 'room' | 'other' | 'box' }
//   { kind: 'move', ids, dx, dy, blocked }
//   { kind: 'anchor', cell }       where a two-click line starts

import { mix, labelOn, parse, contrast, ROOM_STRENGTH, OTHER_STRENGTH } from '../colour.js';
import { CELL_CORRIDOR, CELL_STAIRS } from '../../engine/schema.js';

const TOKENS = ['paper', 'card', 'ink', 'ink-2', 'line', 'line-strong', 'accent', 'accent-ink', 'accent-soft', 'problem', 'warning', 'grid', 'corridor', 'corridor-edge', 'stairs', 'room-default'];
// Below this many pixels a label is left out rather than drawn unreadable.
const MIN_LABEL = 9;
const MAX_LABEL = 18;
const SIDES = ['n', 'e', 's', 'w'];

function camel(name) {
  return name.replace(/-(.)/g, (match, letter) => letter.toUpperCase());
}

// The geometry of one room or other space: the rows it fills, its outline as
// straight pieces (door edges apart), its box and where its label goes. Kept
// by the space object, which a change to the space replaces.
const shapes = new WeakMap();

function shapeOf(space, width) {
  const held = shapes.get(space);
  if (held && held.width === width) return held;
  const inside = new Set(space.cells);
  const doors = new Set((space.doors || []).map((door) => door.cell + ':' + door.side));
  const cells = space.cells.slice().sort((a, b) => a - b);
  const runs = [];
  const edges = { n: [], e: [], s: [], w: [] };
  const doorEdges = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    const last = runs[runs.length - 1];
    if (last && last.y === y && last.x1 === x) last.x1 = x + 1;
    else runs.push({ y, x0: x, x1: x + 1 });
    const open = {
      n: !inside.has(cell - width),
      s: !inside.has(cell + width),
      w: x === 0 || !inside.has(cell - 1),
      e: x === width - 1 || !inside.has(cell + 1),
    };
    for (const side of SIDES) {
      if (!open[side]) continue;
      // a piece is [fixed line, from, to]: a row line for n and s, a column line for e and w
      const piece = side === 'n' ? [y, x, x + 1] : side === 's' ? [y + 1, x, x + 1] : side === 'w' ? [x, y, y + 1] : [x + 1, y, y + 1];
      if (doors.has(cell + ':' + side)) doorEdges.push({ side, piece });
      else edges[side].push(piece);
    }
  }
  // join the pieces that run on, so a dashed outline is dashed evenly
  const lines = { across: [], down: [] };
  for (const side of SIDES) {
    const list = edges[side].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const into = side === 'n' || side === 's' ? lines.across : lines.down;
    for (const piece of list) {
      const last = into[into.length - 1];
      if (last && last.side === side && last.at === piece[0] && last.to === piece[1]) last.to = piece[2];
      else into.push({ side, at: piece[0], from: piece[1], to: piece[2] });
    }
  }
  // the label goes in the middle of a rectangle, or on the widest row of any other shape
  let anchor;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (cells.length === w * h) {
    anchor = { x: x0 + w / 2, y: y0 + h / 2, w, h };
  } else {
    const middle = (y0 + y1) / 2;
    let best = runs[0];
    for (const run of runs) {
      const wider = run.x1 - run.x0 - (best.x1 - best.x0);
      if (wider > 0 || (wider === 0 && Math.abs(run.y - middle) < Math.abs(best.y - middle))) best = run;
    }
    anchor = { x: (best.x0 + best.x1) / 2, y: best.y + 0.5, w: best.x1 - best.x0, h: 1 };
  }
  const shape = { width, runs, lines, doorEdges, box: { x0, y0, x1: x1 + 1, y1: y1 + 1 }, anchor };
  shapes.set(space, shape);
  return shape;
}

export function createRenderer(canvas) {
  const g = canvas.getContext('2d');
  let ratio = 1;
  let theme = null;
  let themeKey = null;
  const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const fills = new Map();
  const labels = new Map();
  let letters = { connections: null, floorId: null, byCell: new Map() };
  let surnames = { teachers: null, byId: new Map() };

  function readTheme() {
    const key = (document.documentElement.dataset.theme || '') + ':' + dark.matches;
    if (theme && key === themeKey) return theme;
    const style = getComputedStyle(canvas);
    const next = {};
    for (const name of TOKENS) {
      const value = style.getPropertyValue('--' + name).trim();
      next[camel(name)] = parse(value) ? value : '#888888';
    }
    next.font = style.getPropertyValue('--font-plan').trim() || 'sans-serif';
    theme = next;
    themeKey = key;
    fills.clear();
    labels.clear();
    return theme;
  }

  function fillOf(colour, strength) {
    const key = colour + strength;
    let fill = fills.get(key);
    if (!fill) {
      fill = parse(colour) ? mix(colour, theme.grid, strength) : theme.roomDefault;
      fills.set(key, fill);
    }
    return fill;
  }

  function labelOf(fill) {
    let label = labels.get(fill);
    if (!label) {
      label = labelOn(fill, theme.ink, theme.paper);
      labels.set(fill, label);
    }
    return label;
  }

  function font(weight, size) {
    return weight + ' ' + size + 'px ' + theme.font;
  }

  // The largest size from `size` down to the smallest readable one at which
  // the text fits in `room` pixels; 0 when none does.
  function fitSize(text, weight, size, room) {
    for (let s = Math.min(MAX_LABEL, Math.round(size)); s >= MIN_LABEL; s -= 1) {
      g.font = font(weight, s);
      if (g.measureText(text).width <= room) return s;
    }
    return 0;
  }

  function connectionLetters(project, floor) {
    const connections = project.building.connections;
    if (letters.connections === connections && letters.floorId === floor.id) return letters.byCell;
    const byCell = new Map();
    for (const connection of connections) {
      for (const end of [connection.a, connection.b]) {
        if (end.floorId !== floor.id) continue;
        if (!byCell.has(end.cell)) byCell.set(end.cell, []);
        if (!byCell.get(end.cell).includes(connection.label)) byCell.get(end.cell).push(connection.label);
      }
    }
    letters = { connections, floorId: floor.id, byCell };
    return byCell;
  }

  function surnameOf(project, teacherId) {
    if (surnames.teachers !== project.teachers) {
      const byId = new Map();
      for (const teacher of project.teachers) {
        const words = teacher.name.trim().split(/\s+/);
        byId.set(teacher.id, words[words.length - 1]);
      }
      surnames = { teachers: project.teachers, byId };
    }
    return surnames.byId.get(teacherId) || '';
  }

  function draw(scene) {
    const { project, floor, view } = scene;
    const t = readTheme();
    const size = view.size;
    const X = (column) => Math.round(view.x + column * size);
    const Y = (row) => Math.round(view.y + row * size);
    const seen = view.visible(floor);
    const width = floor.width;
    const selected = new Set(scene.selection || []);

    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = t.paper;
    g.fillRect(0, 0, view.width, view.height);

    // the floor: empty cells, the traced image, faint grid lines
    g.fillStyle = t.grid;
    g.fillRect(X(0), Y(0), X(width) - X(0), Y(floor.height) - Y(0));
    if (scene.underlay) {
      g.save();
      scene.underlay(g, view, floor);
      g.restore();
    }
    if (size >= 8) {
      g.beginPath();
      for (let x = seen.x0; x <= seen.x1; x += 1) {
        g.moveTo(X(x) + 0.5, Y(seen.y0));
        g.lineTo(X(x) + 0.5, Y(seen.y1));
      }
      for (let y = seen.y0; y <= seen.y1; y += 1) {
        g.moveTo(X(seen.x0), Y(y) + 0.5);
        g.lineTo(X(seen.x1), Y(y) + 0.5);
      }
      g.strokeStyle = t.paper;
      g.lineWidth = 1;
      g.stroke();
    }

    // corridors and stairs, a row at a time
    const stairs = [];
    for (let y = seen.y0; y < seen.y1; y += 1) {
      let start = -1;
      let kind = '';
      for (let x = seen.x0; x <= seen.x1; x += 1) {
        const character = x < seen.x1 ? floor.cells[y * width + x] : '';
        const now = character === CELL_CORRIDOR || character === CELL_STAIRS ? character : '';
        if (now !== kind) {
          if (kind !== '') {
            g.fillStyle = kind === CELL_CORRIDOR ? t.corridor : t.stairs;
            g.fillRect(X(start), Y(y), X(x) - X(start), Y(y + 1) - Y(y));
          }
          start = x;
          kind = now;
        }
        if (now === CELL_STAIRS) stairs.push(y * width + x);
      }
    }
    // their hairline, wherever a walkable cell meets one that is not
    g.beginPath();
    const walkable = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= floor.height) return false;
      const character = floor.cells[y * width + x];
      return character === CELL_CORRIDOR || character === CELL_STAIRS;
    };
    for (let y = seen.y0; y < seen.y1; y += 1) {
      for (let x = seen.x0; x < seen.x1; x += 1) {
        if (!walkable(x, y)) continue;
        if (!walkable(x, y - 1)) {
          g.moveTo(X(x), Y(y) + 0.5);
          g.lineTo(X(x + 1), Y(y) + 0.5);
        }
        if (!walkable(x, y + 1)) {
          g.moveTo(X(x), Y(y + 1) - 0.5);
          g.lineTo(X(x + 1), Y(y + 1) - 0.5);
        }
        if (!walkable(x - 1, y)) {
          g.moveTo(X(x) + 0.5, Y(y));
          g.lineTo(X(x) + 0.5, Y(y + 1));
        }
        if (!walkable(x + 1, y)) {
          g.moveTo(X(x + 1) - 0.5, Y(y));
          g.lineTo(X(x + 1) - 0.5, Y(y + 1));
        }
      }
    }
    g.strokeStyle = t.corridorEdge;
    g.lineWidth = 1;
    g.stroke();

    // rooms and other spaces
    const onScreen = [];
    for (const space of floor.spaces) {
      const shape = shapeOf(space, width);
      if (shape.box.x1 <= seen.x0 || shape.box.x0 >= seen.x1 || shape.box.y1 <= seen.y0 || shape.box.y0 >= seen.y1) continue;
      const subject = space.kind === 'room' && space.subjectId ? project.subjects.find((each) => each.id === space.subjectId) : null;
      const fill = space.kind === 'room' ? (subject ? fillOf(subject.colour, ROOM_STRENGTH) : t.roomDefault) : fillOf(space.colour, OTHER_STRENGTH);
      g.fillStyle = fill;
      for (const run of shape.runs) g.fillRect(X(run.x0), Y(run.y), X(run.x1) - X(run.x0), Y(run.y + 1) - Y(run.y));
      onScreen.push({ space, shape, fill });
    }
    const outline = (shape, dx, dy) => {
      for (const line of shape.lines.across) {
        g.moveTo(X(line.from + dx), Y(line.at + dy));
        g.lineTo(X(line.to + dx), Y(line.at + dy));
      }
      for (const line of shape.lines.down) {
        g.moveTo(X(line.at + dx), Y(line.from + dy));
        g.lineTo(X(line.at + dx), Y(line.to + dy));
      }
    };
    // a door is a gap: the edge keeps a fifth at each end
    const doorStubs = (shape) => {
      for (const door of shape.doorEdges) {
        const [at, from, to] = door.piece;
        const across = door.side === 'n' || door.side === 's';
        for (const [a, b] of [[from, from + 0.2], [to - 0.2, to]]) {
          if (across) {
            g.moveTo(X(a), Y(at));
            g.lineTo(X(b), Y(at));
          } else {
            g.moveTo(X(at), Y(a));
            g.lineTo(X(at), Y(b));
          }
        }
      }
    };
    g.lineCap = 'square';
    const line = size >= 12 ? 1.5 : 1;
    g.beginPath();
    for (const { space, shape } of onScreen) {
      if (space.kind === 'room' && space.number.trim() === '') continue;
      outline(shape, 0, 0);
      doorStubs(shape);
    }
    g.strokeStyle = t.ink2;
    g.lineWidth = line;
    g.stroke();
    // a room with no number: a dashed outline
    g.beginPath();
    for (const { space, shape } of onScreen) {
      if (space.kind !== 'room' || space.number.trim() !== '') continue;
      outline(shape, 0, 0);
      doorStubs(shape);
    }
    g.setLineDash([Math.max(3, size / 5), Math.max(3, size / 5)]);
    g.lineCap = 'butt';
    g.lineWidth = line + 0.5;
    g.stroke();
    g.setLineDash([]);

    // stairs: a chevron, the connection letter, and "!" where there is none
    const byCell = connectionLetters(project, floor);
    const stairsLabel = labelOf(t.stairs);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const cell of stairs) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      const left = X(x);
      const top = Y(y);
      const w = X(x + 1) - left;
      const letter = (byCell.get(cell) || []).join(' ');
      const lettered = letter !== '' && w >= 18;
      if (w >= 10) {
        const cx = left + w / 2;
        const cy = top + (lettered ? w * 0.3 : w * 0.5);
        const reach = w * 0.2;
        g.beginPath();
        g.moveTo(cx - reach, cy + reach / 2);
        g.lineTo(cx, cy - reach / 2);
        g.lineTo(cx + reach, cy + reach / 2);
        g.strokeStyle = stairsLabel;
        g.lineWidth = Math.max(1, w / 16);
        g.lineCap = 'butt';
        g.stroke();
      }
      if (lettered) {
        const s = fitSize(letter, 600, Math.max(MIN_LABEL, w * 0.42), w - 4);
        if (s > 0) {
          g.fillStyle = stairsLabel;
          g.fillText(letter, left + w / 2, top + w * 0.68);
        }
      }
      if (letter === '') {
        const r = Math.max(2, Math.min(7, w * 0.22));
        const cx = left + w - r - 1;
        const cy = top + r + 1;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fillStyle = t.problem;
        g.fill();
        if (r >= 5) {
          g.font = font(600, Math.round(r * 1.7));
          g.fillStyle = labelOf(t.problem);
          g.fillText('!', cx, cy + 0.5);
        }
      }
    }

    // exits: a thick dash on the edge that leads outside, the door name beyond it
    for (const exit of floor.exits) {
      const x = exit.cell % width;
      const y = Math.floor(exit.cell / width);
      if (x < seen.x0 - 1 || x > seen.x1 || y < seen.y0 - 1 || y > seen.y1) continue;
      const outside = (ox, oy) => ox < 0 || oy < 0 || ox >= width || oy >= floor.height || (floor.cells[oy * width + ox] === '.' && !floor.spaces.some((space) => space.cells.includes(oy * width + ox)));
      const side = outside(x, y - 1) ? 'n' : outside(x, y + 1) ? 's' : outside(x - 1, y) ? 'w' : outside(x + 1, y) ? 'e' : null;
      if (!side) continue;
      const thick = Math.max(3, Math.round(size / 6));
      g.beginPath();
      if (side === 'n' || side === 's') {
        const at = Y(side === 'n' ? y : y + 1);
        g.moveTo(X(x + 0.15), at);
        g.lineTo(X(x + 0.85), at);
      } else {
        const at = X(side === 'w' ? x : x + 1);
        g.moveTo(at, Y(y + 0.15));
        g.lineTo(at, Y(y + 0.85));
      }
      g.strokeStyle = t.accent;
      g.lineWidth = thick;
      g.lineCap = 'butt';
      g.stroke();
      const s = Math.min(MAX_LABEL, Math.max(MIN_LABEL, Math.round(size * 0.5)));
      if (exit.doorName !== '' && size >= 12) {
        g.font = font(600, s);
        g.fillStyle = contrast(t.accent, t.grid) >= 4.5 ? t.accent : t.ink;
        const gap = thick + 3;
        if (side === 'n' || side === 's') {
          g.textAlign = 'center';
          g.textBaseline = side === 'n' ? 'bottom' : 'top';
          g.fillText(exit.doorName, X(x + 0.5), Y(side === 'n' ? y : y + 1) + (side === 'n' ? -gap : gap));
        } else {
          g.textAlign = side === 'w' ? 'right' : 'left';
          g.textBaseline = 'middle';
          g.fillText(exit.doorName, X(side === 'w' ? x : x + 1) + (side === 'w' ? -gap : gap), Y(y + 0.5));
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
      }
    }

    // exclusion zones: a hatched rectangle and its label
    for (const zone of project.building.zones) {
      if (zone.floorId !== floor.id) continue;
      if (zone.x + zone.w <= seen.x0 || zone.x >= seen.x1 || zone.y + zone.h <= seen.y0 || zone.y >= seen.y1) continue;
      const left = X(zone.x);
      const top = Y(zone.y);
      const w = X(zone.x + zone.w) - left;
      const h = Y(zone.y + zone.h) - top;
      g.save();
      g.beginPath();
      g.rect(left, top, w, h);
      g.clip();
      g.beginPath();
      for (let d = -h; d < w; d += 8) {
        g.moveTo(left + d, top + h);
        g.lineTo(left + d + h, top);
      }
      g.strokeStyle = t.ink2;
      g.globalAlpha = 0.45;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      g.setLineDash([4, 3]);
      g.strokeStyle = t.ink2;
      g.lineWidth = 1;
      g.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
      g.setLineDash([]);
      const s = Math.min(13, Math.max(MIN_LABEL, Math.round(size * 0.45)));
      // a zone one row high keeps its label for the inspector: the corridor's name is there
      if (zone.label !== '' && s >= MIN_LABEL && h >= s * 2 + 12) {
        g.font = font(500, s);
        const wide = g.measureText(zone.label).width + 8;
        if (wide <= w) {
          g.fillStyle = t.card;
          g.fillRect(left + 2, top + 2, wide, s + 4);
          g.fillStyle = t.ink2;
          g.textAlign = 'left';
          g.fillText(zone.label, left + 6, top + 2 + (s + 4) / 2 + 0.5);
          g.textAlign = 'center';
        }
      }
    }

    // corridor names, along their run, in small capitals
    const nameSize = Math.min(13, Math.max(MIN_LABEL, Math.round(size * 0.5)));
    if (size >= 12) {
      for (const corridor of floor.corridors) {
        if (corridor.cells.length === 0 || corridor.name === '') continue;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -1;
        let y1 = -1;
        for (const cell of corridor.cells) {
          const x = cell % width;
          const y = Math.floor(cell / width);
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        if (x1 < seen.x0 || x0 >= seen.x1 || y1 < seen.y0 || y0 >= seen.y1) continue;
        const across = x1 - x0 >= y1 - y0;
        const text = corridor.name.toUpperCase();
        g.font = font(500, nameSize);
        if ('letterSpacing' in g) g.letterSpacing = '0.08em';
        const long = g.measureText(text).width;
        if (long <= ((across ? x1 - x0 : y1 - y0) + 1) * size - 8) {
          g.fillStyle = t.ink2;
          g.save();
          g.translate((X(x0) + X(x1 + 1)) / 2, (Y(y0) + Y(y1 + 1)) / 2);
          if (!across) g.rotate(-Math.PI / 2);
          g.fillText(text, 0, 0.5);
          g.restore();
        }
        if ('letterSpacing' in g) g.letterSpacing = '0px';
      }
    }

    // the labels of rooms and other spaces
    const base = Math.max(MIN_LABEL, size * 0.55);
    for (const { space, shape, fill } of onScreen) {
      const cx = view.x + shape.anchor.x * size;
      const cy = view.y + shape.anchor.y * size;
      const room = shape.anchor.w * size - 6;
      const tall = shape.anchor.h * size;
      if (space.kind === 'other') {
        if (space.label === '') continue;
        const s = fitSize(space.label, 500, base * 0.85, room);
        if (s === 0) continue;
        g.fillStyle = labelOf(fill);
        g.fillText(space.label, cx, cy + 0.5);
        continue;
      }
      if (space.number.trim() === '') {
        // "needs a number", or "?" when there is no room for the words
        const words = 'needs a number';
        let s = Math.min(13, Math.max(MIN_LABEL, Math.round(base * 0.8)));
        g.font = font(500, s);
        const fits = g.measureText(words).width + 10 <= room;
        const text = fits ? words : '?';
        if (!fits) {
          s = Math.max(MIN_LABEL, Math.min(MAX_LABEL, Math.round(base)));
          if (size < 12) continue;
          g.font = font(600, s);
        }
        const wide = Math.max(s + 6, g.measureText(text).width + 10);
        const high = s + 6;
        g.fillStyle = t.card;
        g.strokeStyle = t.warning;
        g.lineWidth = 1;
        g.beginPath();
        g.rect(Math.round(cx - wide / 2) + 0.5, Math.round(cy - high / 2) + 0.5, Math.round(wide), high);
        g.fill();
        g.stroke();
        g.fillStyle = t.warning;
        g.fillText(text, cx, cy + 1);
        continue;
      }
      const s = fitSize(space.number, 600, base, room);
      if (s === 0) continue;
      const ink = labelOf(fill);
      const surname = space.teacherIds.length > 0 ? surnameOf(project, space.teacherIds[0]) : '';
      const under = Math.max(MIN_LABEL, Math.round(s * 0.8));
      g.font = font(500, under);
      const twoLines = surname !== '' && tall >= s + under + 8 && g.measureText(surname).width <= room;
      g.fillStyle = ink;
      g.font = font(600, s);
      g.fillText(space.number, cx, cy + 0.5 - (twoLines ? under / 2 + 1 : 0));
      if (twoLines) {
        g.font = font(500, under);
        g.fillText(surname, cx, cy + 0.5 + s / 2 + 1);
      }
    }

    // what another view lays over the plan
    for (const overlay of scene.overlays || []) {
      g.save();
      overlay(g, view, floor, t);
      g.restore();
    }

    // ---- the editor's marks. None of these is ever printed.

    const preview = scene.preview;
    if (preview && preview.kind === 'cells') {
      g.fillStyle = preview.as === 'erase' ? t.problem : t.accent;
      g.globalAlpha = 0.4;
      for (const cell of preview.cells) {
        const x = cell % width;
        const y = Math.floor(cell / width);
        g.fillRect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
      }
      g.globalAlpha = 1;
    } else if (preview && preview.kind === 'rect') {
      const r = preview.rect;
      const left = X(r.x);
      const top = Y(r.y);
      const w = X(r.x + r.w) - left;
      const h = Y(r.y + r.h) - top;
      if (preview.as !== 'box') {
        g.fillStyle = t.accent;
        g.globalAlpha = 0.25;
        g.fillRect(left, top, w, h);
        g.globalAlpha = 1;
      } else {
        g.setLineDash([5, 4]);
      }
      g.strokeStyle = t.accent;
      g.lineWidth = 2;
      g.strokeRect(left + 1, top + 1, w - 2, h - 2);
      g.setLineDash([]);
    } else if (preview && preview.kind === 'move') {
      g.beginPath();
      for (const space of floor.spaces) {
        if (!preview.ids.includes(space.id)) continue;
        const shape = shapeOf(space, width);
        g.fillStyle = preview.blocked ? t.problem : t.accent;
        g.globalAlpha = 0.25;
        for (const run of shape.runs) g.fillRect(X(run.x0 + preview.dx), Y(run.y + preview.dy), X(run.x1 + preview.dx) - X(run.x0 + preview.dx), Y(run.y + 1 + preview.dy) - Y(run.y + preview.dy));
        g.globalAlpha = 1;
        outline(shape, preview.dx, preview.dy);
        for (const door of shape.doorEdges) {
          const [at, from, to] = door.piece;
          if (door.side === 'n' || door.side === 's') {
            g.moveTo(X(from + preview.dx), Y(at + preview.dy));
            g.lineTo(X(to + preview.dx), Y(at + preview.dy));
          } else {
            g.moveTo(X(at + preview.dx), Y(from + preview.dy));
            g.lineTo(X(at + preview.dx), Y(to + preview.dy));
          }
        }
      }
      g.setLineDash([5, 4]);
      g.strokeStyle = preview.blocked ? t.problem : t.accent;
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([]);
    } else if (preview && preview.kind === 'anchor') {
      const x = preview.cell % width;
      const y = Math.floor(preview.cell / width);
      g.fillStyle = t.accent;
      g.globalAlpha = 0.4;
      g.fillRect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
      g.globalAlpha = 1;
      g.strokeStyle = t.accent;
      g.lineWidth = 2;
      g.strokeRect(X(x) + 1, Y(y) + 1, X(x + 1) - X(x) - 2, Y(y + 1) - Y(y) - 2);
    }

    // the selection: a 2 px outline, and handles at the corners of its box
    if (selected.size > 0) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      g.beginPath();
      for (const space of floor.spaces) {
        if (!selected.has(space.id)) continue;
        const shape = shapeOf(space, width);
        outline(shape, 0, 0);
        for (const door of shape.doorEdges) {
          const [at, from, to] = door.piece;
          if (door.side === 'n' || door.side === 's') {
            g.moveTo(X(from), Y(at));
            g.lineTo(X(to), Y(at));
          } else {
            g.moveTo(X(at), Y(from));
            g.lineTo(X(at), Y(to));
          }
        }
        x0 = Math.min(x0, shape.box.x0);
        y0 = Math.min(y0, shape.box.y0);
        x1 = Math.max(x1, shape.box.x1);
        y1 = Math.max(y1, shape.box.y1);
      }
      g.strokeStyle = t.accent;
      g.lineWidth = 2;
      g.lineCap = 'square';
      g.stroke();
      if (x1 > x0) {
        for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
          g.fillStyle = t.card;
          g.fillRect(X(hx) - 4, Y(hy) - 4, 8, 8);
          g.strokeStyle = t.accent;
          g.lineWidth = 2;
          g.strokeRect(X(hx) - 3, Y(hy) - 3, 6, 6);
        }
      }
    }

    // the hovered cell: a thin outline
    if (scene.hover !== null && scene.hover !== undefined) {
      const x = scene.hover % width;
      const y = Math.floor(scene.hover / width);
      g.strokeStyle = t.accent;
      g.lineWidth = 1;
      g.strokeRect(X(x) + 0.5, Y(y) + 0.5, X(x + 1) - X(x) - 1, Y(y + 1) - Y(y) - 1);
    }

    // the keyboard cursor: dotted, with a light line under the dots so it
    // shows on any fill
    if (scene.cursor !== null && scene.cursor !== undefined) {
      const x = scene.cursor % width;
      const y = Math.floor(scene.cursor / width);
      const left = X(x) + 1.5;
      const top = Y(y) + 1.5;
      const w = X(x + 1) - X(x) - 3;
      const h = Y(y + 1) - Y(y) - 3;
      g.lineWidth = 3;
      g.strokeStyle = t.card;
      g.strokeRect(left, top, w, h);
      g.setLineDash([2, 2]);
      g.lineWidth = 2;
      g.strokeStyle = t.ink;
      g.strokeRect(left, top, w, h);
      g.setLineDash([]);
    }
  }

  return {
    draw,
    // The colours in use, for another view's overlay and for the tests.
    theme: () => readTheme(),
    resize(width, height, pixelRatio) {
      ratio = pixelRatio || 1;
      const w = Math.max(1, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
  };
}
