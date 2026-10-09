// The legend card at the bottom right of the movement map (DESIGN 5.3; spec
// 7.3, 7.5): what each of the five bands means in numbers, the unit, whether
// the picture is the busiest moment or the total over the day, whether the
// scale is relative or absolute, and how many exclusion zones are left out.
//
//   legend({ measure(value), scale(value), folded, fold(folded) }) -> { element, update(project, picture) }
//
// With one group on screen there is no load colouring, and the card says so.

import { h, uid } from '../components/dom.js';
import { choice as segmented } from '../components/choice.js';
import { count } from '../components/words.js';
import { unitWord } from './model.js';

// "1–35", "142+", or a dash for a band no whole load can fall in. `words`
// gives the same for a screen reader: "1 to 35", "142 or more", "no load".
export function bandText(edge, words) {
  if (edge.to === null) return words ? edge.from + ' or more' : edge.from + '+';
  if (edge.from > edge.to) return words ? 'no load' : '—';
  if (edge.from === edge.to) return String(edge.from);
  return edge.from + (words ? ' to ' : '–') + edge.to;
}

const BAND_NAMES = ['quiet', '', '', '', 'busy'];

export function legend(options) {
  const titleId = uid('mov-legend');
  const title = h('h2', { class: 'mov-legend__title', id: titleId }, 'Load');
  const what = h('p', { class: 'mov-legend__what', data: { legend: 'what' } });
  const bands = h('ol', { class: 'mov-legend__bands', data: { legend: 'bands' } });
  const measureId = uid('mov-measure');
  const measure = segmented({
    name: 'movement-measure',
    labelledBy: measureId,
    value: 'busiest',
    onChange: options.measure,
    options: [{ value: 'busiest', label: 'Busiest moment' }, { value: 'total', label: 'Total over the day' }],
  });
  const measureBox = h('div', { class: 'mov-legend__row' }, h('span', { class: 'vh', id: measureId }, 'What the colours count'), measure.element);
  const scaleId = uid('mov-scale');
  const scale = segmented({
    name: 'movement-scale',
    labelledBy: scaleId,
    value: 'relative',
    onChange: options.scale,
    options: [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }],
  });
  const scaleBox = h('div', { class: 'mov-legend__row' }, h('span', { class: 'vh', id: scaleId }, 'The colour scale'), scale.element);
  const scaleNote = h('p', { class: 'mov-legend__note', data: { legend: 'scale' } });
  const zones = h('p', { class: 'mov-legend__note', data: { legend: 'zones' } });
  const body = h('div', { class: 'mov-legend__body' }, what, bands, measureBox, scaleBox, scaleNote, zones);
  const single = h('p', { class: 'mov-legend__what', hidden: true, data: { legend: 'single' } });
  // the card can be folded to its title, to see the map under it
  let folded = options.folded === true;
  const toggle = h('button', { type: 'button', class: 'mov-link mov-legend__toggle', 'aria-expanded': String(!folded), data: { action: 'fold-legend' } }, folded ? 'Show' : 'Hide');
  toggle.addEventListener('click', () => {
    folded = !folded;
    toggle.textContent = folded ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!folded));
    element.dataset.folded = String(folded);
    if (options.fold) options.fold(folded);
  });
  const element = h('aside', { class: 'mov-legend', 'aria-labelledby': titleId, hidden: true, data: { folded: String(folded) } }, h('div', { class: 'mov-legend__head' }, title, toggle), body, single);

  return {
    element,
    update(project, picture) {
      element.hidden = picture.mode === 'empty';
      if (picture.mode === 'empty') return;
      const group = picture.mode === 'single' ? picture.groups[0] : null;
      body.hidden = Boolean(group) || !picture.load;
      single.hidden = !group;
      title.textContent = group ? 'One group' : 'Load';
      if (group) {
        single.replaceChildren(h('span', { class: 'mov-swatch', style: 'background:' + group.colour }), ' ', h('bdi', null, group.name), ': the line is the group’s own colour. Corridors are coloured by load when more than one group is shown.');
        return;
      }
      if (!picture.load) return;
      const load = picture.load;
      const many = unitWord(load.unit, 2);
      element.dataset.unit = load.unit;
      element.dataset.mode = load.mode;
      element.dataset.measure = load.measure;
      what.textContent = load.measure === 'transition'
        ? many[0].toUpperCase() + many.slice(1) + ' crossing a corridor cell in ' + picture.transition.name + '.'
        : load.measure === 'total'
          ? 'Total over the day: ' + many + ' crossing a corridor cell, every transition added up.'
          : 'Busiest moment: the most ' + many + ' crossing a corridor cell in any one transition.';
      bands.replaceChildren(...load.edges.map((edge) => h('li', { class: 'mov-legend__band', data: { band: String(edge.band), from: String(edge.from), to: edge.to === null ? '' : String(edge.to) } },
        h('span', { class: 'mov-legend__swatch', style: 'background:var(--load-' + edge.band + ')', 'aria-hidden': 'true' }, String(edge.band)),
        h('span', { class: 'vh' }, 'Band ' + edge.band + (BAND_NAMES[edge.band - 1] ? ', ' + BAND_NAMES[edge.band - 1] : '') + ': ' + bandText(edge, true) + ' ' + many),
        h('span', { class: 'mov-legend__range', 'aria-hidden': 'true' }, bandText(edge, false)))));
      measureBox.hidden = load.measure === 'transition';
      measure.set(load.measure === 'total' ? 'total' : 'busiest');
      scale.set(load.mode);
      scaleNote.textContent = load.mode === 'absolute'
        ? 'Absolute: fixed loads, set in Project, so two pictures compare.'
        : load.max > 0 ? 'Relative: fifths of the busiest cell on screen, ' + load.max + '.' : 'Relative: fifths of the busiest cell on screen. Nobody crosses a corridor here.';
      zones.textContent = load.zones === 0
        ? 'No exclusion zones.'
        : count(load.zones, 'exclusion zone') + (load.zones === 1 ? ' is' : ' are') + ' left out of the scale.';
    },
  };
}
