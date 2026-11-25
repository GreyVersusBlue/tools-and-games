// The small card of a corridor cell (DESIGN 5.3): the place's name, the load,
// and the groups that use it and how many times. It shows for the cell under
// the pointer, the cell that was tapped, and the cell the keyboard cursor
// rests on. SV2-19 adds who is there now during playback, in `extra`.
//
//   cellCardView({ showInto(roomId) }) -> { element, extra, show(card, at, picture, settings), showRoom(room, at), place(), hide(), text(card, picture, settings) }
//     card   what model.js's cellCard gave
//     room   { roomId, parts, floorName }: a room's card, a tapped room's, with the one button
//            "Show walks into Room 204" (DESIGN 17.3), which calls showInto(roomId)
//     at     { x, y, size } in pixels inside the map: the cell's top left and its side
//   place() puts the card beside its cell again, for whoever changed its
//   height after it was shown (playback's line in `extra`).

import { h } from '../components/dom.js';
import { unitWord, walkNamed, walkWords } from './model.js';

const SHOWN = 8;

// "Walks into Room 204: 50 · everyone: 310", the card's two figures when a
// filter is set (DESIGN 17.7 item 13); '' with none.
export function figuresWords(card) {
  if (!card.filter || card.everyone === null || card.everyone === undefined) return '';
  return 'Walks ' + card.filter.words.map((part) => part.text).join('') + ': ' + card.load + ' \u00b7 everyone: ' + card.everyone;
}

// What a teacher's card says: which of the teacher's walks cross the cell.
export function teacherWords(card, settings) {
  const teacher = card.teacher && card.teacher.teacher ? card.teacher.teacher.name : 'The teacher';
  const walks = card.teacher ? card.teacher.walks : [];
  if (walks.length === 0) return teacher + ' does not walk through here.';
  return teacher + ' walks here: ' + walks.map((walk) => walkWords(settings, walk.period, walk.toPeriod) + (walk.across.length > 0 ? ', with a free period between' : '')).join('; ') + '.';
}

export function loadWords(card, picture, settings) {
  if (card.measure === 'teacher') return teacherWords(card, settings);
  const n = card.load;
  const unit = unitWord(card.unit, n);
  if (n === 0) return 'Nobody on screen crosses here.';
  if (card.measure === 'transition') return n + ' ' + unit + ' in ' + picture.transition.name + '.';
  if (card.measure === 'total') return n + ' ' + unit + ' over the day.';
  return n + ' ' + unit + ' at its busiest' + (card.peak !== null ? ', ' + walkNamed(settings, picture.transitions, card.peak) : '') + '.';
}

function times(n) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
}

export function cellCardView(options) {
  const place = h('p', { class: 'mov-card__place' });
  const load = h('p', { class: 'mov-card__load' });
  const zone = h('p', { class: 'mov-card__zone', hidden: true }, 'In an exclusion zone: left out of the colour scale.');
  const figures = h('p', { class: 'mov-card__figures', hidden: true, data: { card: 'figures' } });
  const groups = h('ul', { class: 'mov-card__groups' });
  // a room's card: the one button that filters the map to walks into it
  const into = h('button', { type: 'button', class: 'btn mov-card__into', hidden: true, data: { action: 'show-into' } });
  let intoRoom = null;
  into.addEventListener('click', () => {
    if (intoRoom !== null && options && options.showInto) options.showInto(intoRoom);
  });
  const extra = h('div', { class: 'mov-card__extra', data: { slot: 'playback' } });
  const element = h('div', { class: 'mov-card', hidden: true, data: { card: 'cell' } }, place, load, figures, zone, groups, into, extra);

  // Beside the cell, on whichever side has the room for the card as tall as it is now.
  let shownAt = null;
  function beside() {
    if (!shownAt || element.hidden) return;
    const at = shownAt;
    const host = element.offsetParent || element.parentElement;
    if (!host) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = at.x + at.size + 10;
    if (left + width > host.clientWidth - 8) left = at.x - width - 10;
    let top = at.y + at.size + 10;
    if (top + height > host.clientHeight - 8) top = at.y - height - 10;
    element.style.left = Math.max(8, left) + 'px';
    element.style.top = Math.max(8, top) + 'px';
  }

  function text(card, picture, settings) {
    const who = card.groups.map((each) => each.group.name + ' ' + times(each.times));
    const two = figuresWords(card);
    return card.place.name + ', ' + card.floorName + '. ' + loadWords(card, picture, settings) + (two !== '' ? ' ' + two + '.' : '') + (who.length > 0 ? ' ' + who.join(', ') + '.' : '');
  }

  return {
    element,
    extra,
    text,
    show(card, at, picture, settings) {
      place.replaceChildren(...card.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)), h('span', { class: 'mov-card__floor' }, ' · ', h('bdi', null, card.floorName)));
      load.textContent = loadWords(card, picture, settings);
      load.hidden = false;
      const two = figuresWords(card);
      figures.textContent = two;
      figures.hidden = two === '';
      into.hidden = true;
      intoRoom = null;
      zone.hidden = !card.excluded;
      const shown = card.groups.slice(0, SHOWN);
      groups.replaceChildren(
        ...shown.map((each) => h('li', { data: { group: each.group.id } }, h('span', { class: 'mov-swatch', style: 'background:' + each.group.colour }), h('bdi', null, each.group.name), h('span', { class: 'mov-card__times' }, times(each.times)))),
        ...(card.groups.length > shown.length ? [h('li', { class: 'mov-card__more' }, 'and ' + (card.groups.length - shown.length) + ' more')] : []),
      );
      groups.hidden = card.groups.length === 0;
      element.hidden = false;
      shownAt = at;
      beside();
    },
    // A room's card (a tap on a room of the map): its name and floor, and "Show walks into Room 204".
    showRoom(room, at) {
      place.replaceChildren(...room.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)), h('span', { class: 'mov-card__floor' }, ' \u00b7 ', h('bdi', null, room.floorName)));
      load.textContent = '';
      load.hidden = true;
      figures.hidden = true;
      zone.hidden = true;
      groups.replaceChildren();
      groups.hidden = true;
      intoRoom = room.roomId;
      into.replaceChildren('Show walks into ', ...room.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      into.hidden = false;
      element.hidden = false;
      shownAt = at;
      beside();
    },
    place: beside,
    hide() {
      element.hidden = true;
      shownAt = null;
    },
  };
}
