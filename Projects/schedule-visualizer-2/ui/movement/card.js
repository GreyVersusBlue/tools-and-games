// The small card of a corridor cell (DESIGN 5.3): the place's name, the load,
// and the groups that use it and how many times. It shows for the cell under
// the pointer, the cell that was tapped, and the cell the keyboard cursor
// rests on. SV2-19 adds who is there now during playback, in `extra`.
//
//   cellCardView() -> { element, extra, show(card, at, picture, settings), hide(), text(card, picture, settings) }
//     card   what model.js's cellCard gave
//     at     { x, y, size } in pixels inside the map: the cell's top left and its side

import { h } from '../components/dom.js';
import { periodName } from '../../engine/bells.js';
import { unitWord } from './model.js';

const SHOWN = 8;

function loadWords(card, picture, settings) {
  const n = card.load;
  const unit = unitWord(card.unit, n);
  if (n === 0) return 'Nobody on screen crosses here.';
  if (card.measure === 'transition') return n + ' ' + unit + ' in ' + picture.transition.name + '.';
  if (card.measure === 'total') return n + ' ' + unit + ' over the day.';
  return n + ' ' + unit + ' at its busiest' + (card.peak !== null ? ', ' + periodName(settings, card.peak) + ' to ' + periodName(settings, card.peak + 1) : '') + '.';
}

function times(n) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
}

export function cellCardView() {
  const place = h('p', { class: 'mov-card__place' });
  const load = h('p', { class: 'mov-card__load' });
  const zone = h('p', { class: 'mov-card__zone', hidden: true }, 'In an exclusion zone: left out of the colour scale.');
  const groups = h('ul', { class: 'mov-card__groups' });
  const extra = h('div', { class: 'mov-card__extra', data: { slot: 'playback' } });
  const element = h('div', { class: 'mov-card', hidden: true, data: { card: 'cell' } }, place, load, zone, groups, extra);

  function text(card, picture, settings) {
    const who = card.groups.map((each) => each.group.name + ' ' + times(each.times));
    return card.place.name + ', ' + card.floorName + '. ' + loadWords(card, picture, settings) + (who.length > 0 ? ' ' + who.join(', ') + '.' : '');
  }

  return {
    element,
    extra,
    text,
    show(card, at, picture, settings) {
      place.replaceChildren(...card.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text)), h('span', { class: 'mov-card__floor' }, ' · ', h('bdi', null, card.floorName)));
      load.textContent = loadWords(card, picture, settings);
      zone.hidden = !card.excluded;
      const shown = card.groups.slice(0, SHOWN);
      groups.replaceChildren(
        ...shown.map((each) => h('li', { data: { group: each.group.id } }, h('span', { class: 'mov-swatch', style: 'background:' + each.group.colour }), h('bdi', null, each.group.name), h('span', { class: 'mov-card__times' }, times(each.times)))),
        card.groups.length > shown.length ? h('li', { class: 'mov-card__more' }, 'and ' + (card.groups.length - shown.length) + ' more') : null,
      );
      groups.hidden = card.groups.length === 0;
      element.hidden = false;
      // beside the cell, on whichever side has the room
      const host = element.offsetParent || element.parentElement;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      let left = at.x + at.size + 10;
      if (left + width > host.clientWidth - 8) left = at.x - width - 10;
      let top = at.y + at.size + 10;
      if (top + height > host.clientHeight - 8) top = at.y - height - 10;
      element.style.left = Math.max(8, left) + 'px';
      element.style.top = Math.max(8, top) + 'px';
    },
    hide() {
      element.hidden = true;
    },
  };
}
