// Finding things in the building (spec 4.8).
//
// attachSearch(input, ctx) is the top bar's search box: it finds rooms by
// number, teacher, subject or wing, and other spaces by label, on every
// floor, and lists them under the box. Up and Down move through the list,
// Enter chooses, Escape closes it. Choosing a result goes to
// #building/<floorId>?room=<spaceId>.
//
// createFinder(ed) is the Building section's side of that address, and of
// every "Show me": it brings a room or some cells into the middle of the
// plan, on whatever floor they are, and marks them until the next click.

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { roomName } from '../../engine/findings.js';
import { inspectorSheet } from './inspector/sheet.js';

const MOST = 12;

// Everything that can be found, in the building's order.
//   { id, floorId, floorName, name, detail, words: [lowercase text to match] }
export function searchIndex(project) {
  const entries = [];
  const several = project.building.floors.length > 1;
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') {
        const teachers = space.teacherIds.map((id) => project.teachers.find((teacher) => teacher.id === id)).filter(Boolean).map((teacher) => teacher.name);
        const subject = space.subjectId ? project.subjects.find((each) => each.id === space.subjectId) : null;
        const detail = teachers.concat(subject ? [subject.name] : [], space.wing.trim() === '' ? [] : [space.wing], several ? [floor.name] : []);
        entries.push({
          id: space.id,
          floorId: floor.id,
          floorName: floor.name,
          name: roomName(space, true),
          detail: detail.join(' · '),
          words: [space.number, roomName(space), ...teachers, subject ? subject.name : '', subject ? subject.code : '', space.wing].map((text) => String(text).toLowerCase()),
        });
      } else {
        if (space.label.trim() === '') continue;
        entries.push({
          id: space.id,
          floorId: floor.id,
          floorName: floor.name,
          name: space.label,
          detail: [space.otherKind === 'other' ? 'other space' : space.otherKind].concat(several ? [floor.name] : []).join(' · '),
          words: [space.label.toLowerCase(), space.otherKind],
        });
      }
    }
  }
  return entries;
}

// The entries that match what was typed: every word typed has to be in the
// entry somewhere. Those whose number or label starts with the text come first.
export function searchResults(project, text) {
  const wanted = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (wanted.length === 0) return [];
  const whole = wanted.join(' ');
  return searchIndex(project)
    .filter((entry) => wanted.every((word) => entry.words.some((have) => have.includes(word))))
    .map((entry, index) => ({ entry, index, rank: entry.words[0] === whole ? 0 : entry.words[0].startsWith(whole) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((each) => each.entry);
}

export function searchAddress(entry) {
  return '#building/' + entry.floorId + '?room=' + entry.id;
}

// The room an address names: "f…?room=r…" -> { floorId, roomId }.
export function parseBuildingRest(rest) {
  const [path, query] = String(rest || '').split('?');
  const found = /(?:^|&)room=([^&]*)/.exec(query || '');
  return { floorId: path.split('/')[0], roomId: found ? decodeURIComponent(found[1]) : null };
}

export function attachSearch(input, ctx) {
  inspectorSheet();
  const listId = 'search-results';
  const list = h('ul', { class: 'picker__list bld-search__list', role: 'listbox', id: listId, 'aria-label': 'What the search found', hidden: true });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.after(list);
  let shown = [];
  let active = -1;

  function mark() {
    Array.from(list.children).forEach((item, index) => {
      if (item.getAttribute('role') === 'option') item.setAttribute('aria-selected', String(index === active));
    });
    const now = active >= 0 ? list.children[active] : null;
    if (now) {
      input.setAttribute('aria-activedescendant', now.id);
      now.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function close() {
    list.hidden = true;
    shown = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function choose(entry) {
    close();
    input.value = '';
    ctx.navigate(searchAddress(entry));
    ctx.announce('Showing ' + entry.name + ' on ' + entry.floorName + '.');
  }

  function draw() {
    const text = input.value;
    if (text.trim() === '') {
      close();
      return;
    }
    const all = searchResults(ctx.store.project, text);
    shown = all.slice(0, MOST);
    active = shown.length > 0 ? 0 : -1;
    const items = shown.map((entry, index) => h('li', {
      class: 'picker__option',
      role: 'option',
      id: listId + '-' + index,
      'aria-selected': 'false',
      data: { room: entry.id, floor: entry.floorId },
      on: {
        // pointerdown, not click: the box must not lose the focus first
        pointerdown: (event) => {
          event.preventDefault();
          choose(entry);
        },
      },
    }, h('span', { class: 'bld-search__name' }, entry.name), entry.detail === '' ? null : h('span', { class: 'picker__detail' }, ' ' + entry.detail)));
    if (shown.length === 0) items.push(h('li', { class: 'picker__empty', role: 'presentation' }, 'No room or space in the building matches “' + text.trim() + '”. Search looks at room numbers, teachers, subjects, wings and labels.'));
    else if (all.length > shown.length) items.push(h('li', { class: 'picker__empty', role: 'presentation' }, 'And ' + count(all.length - shown.length, 'more') + '. Type more to narrow it down.'));
    list.replaceChildren(...items);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    mark();
    ctx.announce(shown.length === 0 ? 'Nothing found.' : count(all.length, 'result') + '. ' + shown[0].name + (shown[0].detail === '' ? '' : ', ' + shown[0].detail) + '.');
  }

  input.addEventListener('input', draw);
  input.addEventListener('focus', () => {
    if (input.value.trim() !== '') draw();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.hidden) {
        if (input.value.trim() !== '') {
          event.preventDefault();
          draw();
        }
        return;
      }
      event.preventDefault();
      if (shown.length === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
      ctx.announce(shown[active].name + (shown[active].detail === '' ? '' : ', ' + shown[active].detail) + '.');
    } else if (event.key === 'Enter') {
      if (!list.hidden && active >= 0 && shown[active]) {
        event.preventDefault();
        choose(shown[active]);
      }
    } else if (event.key === 'Escape') {
      if (!list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
  });
  input.dataset.search = 'ready';
  return { close };
}

// createFinder(ed) -> { show(where, say), clear(), overlay, marked }
//   where: { floorId, roomId, cells }: a room (or other space) by id, or
//   cells, or both. The floor comes on screen, the place comes to the middle
//   of the window, a room is selected, and the cells are marked.
export function createFinder(ed) {
  let marked = null;

  function clear() {
    if (!marked) return;
    marked = null;
    ed.schedule();
  }

  function show(where, say) {
    if (!where) return false;
    const floors = ed.project.building.floors;
    // a room is shown on the floor it is on now, whatever floor the asker knew
    const home = where.roomId ? floors.find((floor) => floor.spaces.some((space) => space.id === where.roomId)) : null;
    const floorId = home ? home.id : where.floorId;
    if (!floors.some((floor) => floor.id === floorId)) return false;
    if (floorId !== ed.floor.id) ed.openFloor(floorId);
    const floor = ed.floor;
    const space = where.roomId ? floor.spaces.find((each) => each.id === where.roomId) : null;
    if (space) ed.select([space.id]);
    const cells = Array.isArray(where.cells) && where.cells.length > 0 ? where.cells.filter((cell) => cell >= 0 && cell < floor.width * floor.height) : space ? space.cells : [];
    marked = cells.length > 0 ? { floorId: floor.id, cells } : null;
    if (cells.length > 0) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const cell of cells) {
        const x = cell % floor.width;
        const y = Math.floor(cell / floor.width);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
      ed.centreOn((x0 + x1) / 2, (y0 + y1) / 2);
      ed.cursor.moveTo(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2));
    }
    ed.schedule();
    if (say) ed.say(say);
    else if (space) ed.say('Showing ' + (space.kind === 'room' ? roomName(space) : space.label) + ' on ' + floor.name + '.');
    return true;
  }

  // The mark: a thick outline round the cells, in the accent with a light
  // line under it so it shows on any fill. Never printed: it is the editor's.
  function overlay(g, view, floor, theme) {
    if (!marked || marked.floorId !== floor.id) return;
    const inside = new Set(marked.cells);
    const size = view.size;
    const X = (column) => Math.round(view.x + column * size);
    const Y = (row) => Math.round(view.y + row * size);
    g.beginPath();
    for (const cell of marked.cells) {
      const x = cell % floor.width;
      const y = Math.floor(cell / floor.width);
      if (!inside.has(cell - floor.width)) {
        g.moveTo(X(x), Y(y));
        g.lineTo(X(x + 1), Y(y));
      }
      if (!inside.has(cell + floor.width)) {
        g.moveTo(X(x), Y(y + 1));
        g.lineTo(X(x + 1), Y(y + 1));
      }
      if (x === 0 || !inside.has(cell - 1)) {
        g.moveTo(X(x), Y(y));
        g.lineTo(X(x), Y(y + 1));
      }
      if (x === floor.width - 1 || !inside.has(cell + 1)) {
        g.moveTo(X(x + 1), Y(y));
        g.lineTo(X(x + 1), Y(y + 1));
      }
    }
    g.lineCap = 'square';
    g.strokeStyle = theme.card;
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = theme.accent;
    g.lineWidth = 4;
    g.stroke();
  }

  return {
    show,
    clear,
    overlay,
    get marked() {
      return marked;
    },
  };
}
