// Stairwells in the planner (spec 4.5's wish, DESIGN 16.7 and 16.12 items 2, 10
// and 12): the two dialogs, and the words the stair's properties, the Floor
// tab's list and the menu share.
//
//   openMakeStairwell(ed, connectionId, opener)
//     "Make one stairwell": the sentence says every letter that changes, the
//     Letter field is the well's letter (prefilled with the lowest flight's).
//   openStairwellThrough(ed, { floorId, cell }, opener)
//     "Stairwell through floors…": every floor by level with a tick, each row
//     saying what is at that row and column ("empty, will become stairs",
//     "corridor, cannot join here"); a floor the stairs already join at that
//     place is ticked and fixed ("Stairs C, joined"); the button names the
//     letter the engine will give, and a sentence names every letter that changes.
//   stairwellFacts(project, letter) -> the words of one stairwell, or null
//   offerOfRun(project, connectionId) -> what Make one stairwell would do, or null
//
// The engine decides (engine/stairwells.js): the dialogs run the action on a
// copy of the project to say what it would do before it does it, and the real
// run is one store action, one undo step. Both dialogs have a scrolling body
// and a footer pinned at the bottom (16.12 item 10), set here on the dialog
// itself, so at 844 × 390 the buttons are always on screen.

import { h } from '../components/dom.js';
import { list } from '../components/words.js';
import { ActionError, scheduleOutcome } from '../../engine/actions.js';
import { makeStairwell, stairwellThrough } from '../../engine/stairwells.js';
import { cellKind, stairwells, stairsLetter, nameKey, WELL_MOST, ELEVATOR_KIND } from '../../engine/schema.js';

// An action run on a copy of the project to read what it would say, with ids
// that are only for this look.
let looks = 0;
const LOOK = { ids: (kind) => kind + 'look' + String(looks++).padStart(5, '0') };

function look(project, act, payload) {
  const after = act(project, payload, LOOK);
  return { after, outcome: scheduleOutcome(after) || {} };
}

const hasWell = (connection) => typeof connection.well === 'string' && connection.well.trim() !== '';

// "Floors 1, 2 and 3" for floors named "Floor N"; otherwise the names as typed.
// Floors that run on one after another from Floor 1 to Floor 4 read "Floors 1 to 4".
export function floorsSentence(names) {
  const numbers = names.map((name) => /^Floor (\d+)$/.exec(name));
  if (names.length > 1 && numbers.every(Boolean)) {
    const values = numbers.map((match) => Number(match[1]));
    const run = values.every((value, i) => i === 0 || value === values[i - 1] + 1);
    if (run && values.length > 2) return 'Floors ' + values[0] + ' to ' + values[values.length - 1];
    return 'Floors ' + list(numbers.map((match) => match[1]));
  }
  return list(names);
}

// The engine's sentence after a join, with its floors in the dialog's words:
// the engine lists them ("on Floors 1, 2 and 3"), the dialog's button and
// sentence said "Floors 1 to 3", and the toast says what the dialog said.
// `outcome.floors` is the names the engine listed, in its order.
export function inDialogWords(outcome) {
  const text = outcome && typeof outcome.text === 'string' ? outcome.text : '';
  const names = outcome && Array.isArray(outcome.floors) ? outcome.floors : [];
  if (names.length < 2) return text;
  const numbered = names.map((name) => /^Floor (\S+)$/.exec(name));
  const listed = numbered.every(Boolean) ? 'Floors ' + list(numbered.map((match) => match[1])) : list(names);
  return text.includes(listed) ? text.replace(listed, floorsSentence(names)) : text;
}

function levelOf(building, floorId) {
  const found = building.floors.find((floor) => floor.id === floorId);
  return found ? found.level : 0;
}

function floorName(building, floorId) {
  const found = building.floors.find((floor) => floor.id === floorId);
  return found ? found.name : 'a floor that is gone';
}

// 'both', 'up' or 'down' for a flight; 'other' when it is between two places on one level.
function wayOfFlight(building, flight) {
  if (flight.direction !== 'ab' && flight.direction !== 'ba') return 'both';
  const a = levelOf(building, flight.a.floorId);
  const b = levelOf(building, flight.b.floorId);
  if (a === b) return 'other';
  return flight.direction === (a < b ? 'ab' : 'ba') ? 'up' : 'down';
}

const WAY_WORDS = { both: 'both ways', up: 'up only', down: 'down only', mixed: 'the flights differ' };

// The words of one stairwell, read from the building: { letter, stops, flights,
// parts, way ('both' | 'up' | 'down' | 'mixed'), wayWords, span, sentence }.
export function stairwellFacts(project, letter) {
  const building = project.building;
  const found = stairwells(building).find((well) => nameKey(well.letter) === nameKey(letter));
  if (!found) return null;
  const ids = new Set(found.connectionIds);
  const flights = building.connections.filter((connection) => ids.has(connection.id));
  const ways = new Set(flights.map((flight) => wayOfFlight(building, flight)));
  const way = ways.size === 1 && !ways.has('other') ? Array.from(ways)[0] : 'mixed';
  const stops = found.stops.map((stop) => ({ floorId: stop.floorId, cell: stop.cell, floorName: floorName(building, stop.floorId) }));
  const span = stops.length > 0 ? stops[0].floorName + ' to ' + stops[stops.length - 1].floorName : '';
  return {
    letter: found.letter,
    stops,
    flights: flights.length,
    flightIds: found.connectionIds,
    parts: found.parts,
    way,
    wayWords: WAY_WORDS[way],
    span,
    sentence: span + ': stops on ' + list(stops.map((stop) => stop.floorName)) + '.',
  };
}

// "Stairs A", "Stairs A and B", "Stairs A, B and C".
function stairsList(letters) {
  return 'Stairs ' + list(letters);
}

// What Make one stairwell would do for the run of flights through this one, as
// the engine would do it (a copy of the project is changed, never the real one):
// { letter, letters, floors, flights } or null where the engine refuses
// (fewer than three floors, a floor reached twice, already a stairwell).
export function offerOfRun(project, connectionId) {
  try {
    const { after, outcome } = look(project, makeStairwell, { connectionId });
    const before = new Map(project.building.connections.map((connection) => [connection.id, connection]));
    const letters = after.building.connections.filter((connection) => hasWell(connection) && before.has(connection.id) && !hasWell(before.get(connection.id))).map((connection) => stairsLetter(before.get(connection.id)));
    return { letter: outcome.letter, letters, floors: outcome.floors || [], flights: outcome.flights || letters.length };
  } catch (error) {
    if (error instanceof ActionError) return null;
    throw error;
  }
}

// What the Make one stairwell question says for a letter: every letter that
// changes is named (DESIGN 16.12 item 2).
export function makeSentence(letters, floors, letter) {
  const changed = letters.filter((each) => nameKey(each) !== nameKey(letter));
  const first = changed.length > 0
    ? stairsList(changed) + (changed.length === 1 ? ' will be called ' : ' will all be called ') + letter + ' on every floor, map, poster and set of directions. '
    : 'Stairs ' + letter + ' keeps its letter on every floor, map, poster and set of directions. ';
  return first + stairsList(letters) + ' become Stairwell ' + letter + ', on ' + floorsSentence(floors) + '.';
}

// ---------------------------------------------------------------- the dialogs

// The footer pinned and the body scrolling, on the dialog itself.
function pin(dialog) {
  const element = dialog.element;
  element.style.display = 'flex';
  element.style.flexDirection = 'column';
  element.style.maxHeight = 'min(40rem, calc(100dvh - var(--s-4)))';
  element.style.overflow = 'hidden';
  const title = element.querySelector('.dialog__title');
  const body = element.querySelector('.dialog__body');
  const buttons = element.querySelector('.dialog__buttons');
  title.style.flex = 'none';
  body.style.flex = '1 1 auto';
  body.style.minHeight = '0';
  body.style.overflow = 'auto';
  buttons.style.flex = 'none';
  buttons.style.marginTop = 'var(--s-3)';
  buttons.style.paddingTop = 'var(--s-3)';
  buttons.style.borderTop = 'var(--border)';
  // a finger's size
  for (const button of buttons.querySelectorAll('button')) button.style.minHeight = '44px';
  // a button that cannot be used yet is aria-disabled, not disabled (app.css styles
  // it set aside, and it stays in the Tab order): its press, by click, Enter or
  // Space, stops here, before the dialog's own handler closes the dialog
  buttons.addEventListener('click', (event) => {
    const pressed = event.target.closest ? event.target.closest('button') : null;
    if (pressed && pressed.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  return { body, buttons: Array.from(buttons.querySelectorAll('button')) };
}

// The app's way to set a button aside: aria-disabled, the reason in `note`.
function setOff(button, off, note) {
  button.setAttribute('aria-disabled', String(off));
  if (off) button.setAttribute('aria-describedby', note.id);
  else button.removeAttribute('aria-describedby');
}

function giveBack(ed, opener) {
  // a menu item that has gone is no place to return to: the plan takes the focus
  if (!(opener && opener.isConnected)) ed.canvas.focus({ preventScroll: true });
}

// Make one stairwell: the sentence and the Letter field. Resolves true once made.
export function openMakeStairwell(ed, connectionId, opener) {
  const project = ed.project;
  const offer = ed.attempt(() => {
    const found = offerOfRun(project, connectionId);
    if (found) return found;
    // the engine's refusal, in words
    look(project, makeStairwell, { connectionId });
    return null;
  });
  if (!offer) return Promise.resolve(false);
  const sentence = h('p', { id: 'stairwell-sentence', dir: 'auto' }, makeSentence(offer.letters, offer.floors, offer.letter));
  const input = h('input', { class: 'field__input', id: 'stairwell-letter', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(WELL_MOST * 2) });
  input.value = offer.letter;
  const note = h('p', { class: 'bld-inspector__small', id: 'stairwell-note', role: 'status', hidden: true });
  const dialog = ed.ctx.openDialog({
    id: 'stairwell-make-dialog',
    title: 'Make one stairwell',
    opener: opener || ed.canvas,
    body: [
      sentence,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'stairwell-letter' }, 'Letter'), input),
      note,
    ],
    buttons: [
      { label: 'Make Stairwell ' + offer.letter, value: 'yes', kind: 'primary' },
      { label: 'Cancel', value: null },
    ],
  });
  const { buttons } = pin(dialog);
  const make = buttons[0];
  let refused = false;
  const reread = () => {
    const letter = input.value.trim();
    try {
      const { outcome } = look(ed.project, makeStairwell, { connectionId, letter: input.value });
      sentence.textContent = makeSentence(offer.letters, offer.floors, outcome.letter || letter);
      make.textContent = 'Make Stairwell ' + (outcome.letter || letter);
      note.hidden = true;
      note.textContent = '';
      setOff(make, false, note);
      refused = false;
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      make.textContent = 'Make one stairwell';
      note.hidden = false;
      note.textContent = error.message;
      setOff(make, true, note);
      refused = true;
    }
  };
  input.addEventListener('input', reread);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!refused) dialog.close('yes');
    }
  });
  input.focus();
  input.select();
  return dialog.closed.then((answer) => {
    if (answer !== 'yes') {
      ed.say('No stairwell was made.');
      giveBack(ed, opener);
      return false;
    }
    const done = ed.commit(makeStairwell, { connectionId, letter: input.value }, { done: inDialogWords, toast: inDialogWords });
    giveBack(ed, opener);
    return done !== null;
  });
}

// What is at the stairs' row and column on one floor, for the row's words:
// { ok, text }. ok is whether a stairwell can stop there.
function placeWords(building, origin, floor, cell) {
  const x = cell % origin.width;
  const y = Math.floor(cell / origin.width);
  if (x >= floor.width || y >= floor.height) return { ok: false, text: 'no such place, the floor is smaller: cannot join here' };
  const at = y * floor.width + x;
  const kind = cellKind(floor, at, building);
  if (kind === 'empty') return { ok: true, text: 'empty, will become stairs' };
  if (kind === 'stairs') {
    const holder = building.connections.find((connection) => hasWell(connection) && [connection.a, connection.b].some((end) => end.floorId === floor.id && end.cell === at));
    if (holder && floor.id !== origin.id) return { ok: false, text: 'stairs of Stairwell ' + holder.well.trim() + ': cannot join here' };
    return { ok: true, text: 'stairs' };
  }
  if (kind === 'corridor') return { ok: false, text: 'corridor, cannot join here' };
  if (kind === 'elevator') return { ok: false, text: 'an elevator stop, cannot join here' };
  if (kind === 'room') {
    const room = floor.spaces.find((space) => space.kind === 'room' && space.cells.includes(at));
    const name = room && room.number.trim() !== '' ? 'Room ' + room.number : 'a room';
    return { ok: false, text: name + ', cannot join here' };
  }
  const other = floor.spaces.find((space) => space.kind === 'other' && space.cells.includes(at));
  return { ok: false, text: (other && other.label.trim() !== '' ? other.label : 'another space') + ', cannot join here' };
}

// The floors the stairs at the starting stop already join at the same row and
// column, through plain flights: Map floorId -> the letter of the flight that
// reaches it. They are part of the stairwell from the start.
function joinedHere(building, origin, cell) {
  const x = cell % origin.width;
  const y = Math.floor(cell / origin.width);
  const at = (end) => {
    const floor = building.floors.find((each) => each.id === end.floorId);
    return Boolean(floor) && end.cell % floor.width === x && Math.floor(end.cell / floor.width) === y;
  };
  const flights = building.connections.filter((connection) => connection.kind !== ELEVATOR_KIND && !hasWell(connection) && at(connection.a) && at(connection.b));
  const joined = new Map();
  const reached = new Set([origin.id]);
  for (let grown = true; grown;) {
    grown = false;
    for (const flight of flights) {
      const [p, q] = [flight.a.floorId, flight.b.floorId];
      if (reached.has(p) === reached.has(q)) continue;
      const other = reached.has(p) ? q : p;
      reached.add(other);
      joined.set(other, stairsLetter(flight));
      grown = true;
    }
  }
  return joined;
}

// What the letters line says: every letter that changes (DESIGN 16.12 item 2),
// or that the letter is kept. Empty for new stairs.
export function throughLettersSentence(kept, letter) {
  if (kept.length === 0) return '';
  const changed = kept.filter((each) => nameKey(each) !== nameKey(letter));
  if (changed.length === 0) return stairsList(kept) + (kept.length === 1 ? ' keeps its letter' : ' keep their letter') + ' on every floor, map, poster and set of directions.';
  return stairsList(changed) + (changed.length === 1 ? ' will be called ' : ' will all be called ') + letter + ' on every floor, map, poster and set of directions.';
}

// Stairwell through floors…: resolves true once joined.
export function openStairwellThrough(ed, where, opener) {
  const building = ed.project.building;
  const origin = building.floors.find((floor) => floor.id === where.floorId);
  if (!origin) return Promise.resolve(false);
  const cell = where.cell;
  const column = (cell % origin.width) + 1;
  const row = Math.floor(cell / origin.width) + 1;
  // every floor by level, the highest first, as the building stands
  const order = building.floors.map((floor, index) => ({ floor, index })).sort((a, b) => b.floor.level - a.floor.level || b.index - a.index);
  const ticks = new Map();
  const joined = joinedHere(building, origin, cell);
  const rows = order.map(({ floor }) => {
    const here = floor.id === origin.id;
    const fixed = here || joined.has(floor.id);
    const what = joined.has(floor.id) ? { ok: true, text: 'Stairs ' + joined.get(floor.id) + ', joined' } : placeWords(building, origin, floor, cell);
    const box = h('input', { type: 'checkbox', class: 'stairwell-tick', data: { floor: floor.id }, style: 'flex: none; width: 24px; height: 24px; margin: 0' });
    box.checked = fixed;
    box.disabled = fixed || !what.ok;
    ticks.set(floor.id, { box, ok: what.ok, here });
    const words = floor.name + ': ' + (here ? 'this floor, ' : '') + what.text;
    return h('li', { class: 'stairwell-row', style: 'list-style: none; margin: 0; padding: 0' },
      h('label', { style: 'display: flex; align-items: center; gap: var(--s-2); min-height: 44px' }, box, h('span', { dir: 'auto' }, words)));
  });
  const note = h('p', { class: 'bld-inspector__small', id: 'stairwell-through-note', role: 'status' });
  const letters = h('p', { id: 'stairwell-through-letters', dir: 'auto', hidden: true });
  const dialog = ed.ctx.openDialog({
    id: 'stairwell-through-dialog',
    title: 'Stairwell through floors',
    opener: opener || ed.canvas,
    body: [
      h('p', null, 'A stairwell has its stairs at the same row and column on every floor. These stairs are at row ' + row + ', column ' + column + ' on ' + origin.name + '. Tick the floors it runs through.'),
      h('ul', { id: 'stairwell-floors', style: 'margin: 0; padding: 0; display: grid; gap: var(--s-1)', 'aria-label': 'Floors the stairwell runs through' }, rows),
      letters,
      note,
    ],
    buttons: [
      { label: 'Join floors as a stairwell', value: 'yes', kind: 'primary' },
      { label: 'Cancel', value: null },
    ],
  });
  const { buttons } = pin(dialog);
  const join = buttons[0];
  const chosen = () => order.map(({ floor }) => floor).filter((floor) => ticks.get(floor.id).box.checked);
  // the letter, and the letters that change, as the engine would do it, on a copy
  const preview = (floors) => {
    const project = ed.project;
    try {
      const { after, outcome } = look(project, stairwellThrough, { floorId: origin.id, cell, floorIds: floors.map((floor) => floor.id).filter((id) => id !== origin.id) });
      const before = new Map(project.building.connections.map((connection) => [connection.id, connection]));
      const kept = after.building.connections.filter((connection) => hasWell(connection) && before.has(connection.id) && !hasWell(before.get(connection.id))).map((connection) => stairsLetter(before.get(connection.id)));
      return { letter: outcome.letter, kept: Array.from(new Set(kept)) };
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return { refusal: error.message };
    }
  };
  const reread = () => {
    const floors = chosen().slice().reverse();
    const enough = floors.length >= 3;
    const plan = enough ? preview(floors) : null;
    const ready = Boolean(plan && !plan.refusal);
    setOff(join, !ready, note);
    join.textContent = ready ? 'Join ' + floorsSentence(floors.map((floor) => floor.name)) + ' as Stairwell ' + plan.letter : 'Join floors as a stairwell';
    note.textContent = ready ? '' : plan ? plan.refusal : 'Tick at least one more floor: a stairwell is for three or more.';
    letters.textContent = ready ? throughLettersSentence(plan.kept, plan.letter) : '';
    letters.hidden = letters.textContent === '';
  };
  for (const { box } of ticks.values()) box.addEventListener('change', reread);
  reread();
  // the first floor to tick takes the focus: the body is where the work is
  const first = rows.length > 0 ? order.map(({ floor }) => ticks.get(floor.id)).find((tick) => !tick.box.disabled) : null;
  if (first) first.box.focus();
  return dialog.closed.then((answer) => {
    if (answer !== 'yes') {
      ed.say('No stairwell was made.');
      giveBack(ed, opener);
      return false;
    }
    const floorIds = chosen().map((floor) => floor.id).filter((id) => id !== origin.id);
    const done = ed.commit(stairwellThrough, { floorId: origin.id, cell, floorIds }, { done: inDialogWords, toast: inDialogWords });
    giveBack(ed, opener);
    return done !== null;
  });
}
