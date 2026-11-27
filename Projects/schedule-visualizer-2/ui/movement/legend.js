// The legend card at the bottom right of the movement map (DESIGN 5.3; spec
// 7.3, 7.5): what each of the five bands means in numbers, the unit, whether
// the picture is the busiest moment or the total over the day, whether the
// scale is relative or absolute, and how many exclusion zones are left out.
//
//   legend({ measure(value), scale(value), folded, fold(folded) })
//     -> { element, line, update(project, picture, chosen), setDocked(docked), bringOut(), docked, open }
//
// The card never covers a floor (DESIGN 5.3). Where it would, at the fitted
// zoom, and always on a phone, the view docks it (`setDocked(true)`): the
// card is away and `line`, one line under the map, says the scale in short,
// "Load · 1 to 177 · Relative", with a "Scale" button that brings the card
// over the map until its own button puts it away again (`bringOut()` does
// what Scale does). Docked and away, the card is still laid out (unseen), so
// the view can measure the room it needs. The focus goes with it: docking a
// card that holds the focus puts the focus on Scale, and a line that holds it
// gives it to the card when the card stands on the map again.
//
// `chosen` is { mode }, the colour scale as the project has it now. While the
// answer for a change of scale is awaited the picture, and so the numbers,
// are still the old scale's; the toggle shows what was just chosen.
//
// With one group on screen there is no load colouring, and the card says so.
// So with a teacher: the line is the teacher's subject colour, ink with none,
// and a dashed one is a walk with a free period between (DESIGN 17.2).
//
// With crowd-aware routes the card says so in the words DESIGN 17.1 gives ("a
// what-if: checks use the usual routes"), and, while a group's row in Summary
// has its usual route drawn, what the faint dashed line is. `chosen.usual` is
// that group's name ('' with none). The docked line ends "· crowd-aware".
//
// With Going to or Rooms of subject set the card says whose walks it counts
// ("Load of walks into Room 204") and that the relative scale is of those
// walks only, with a link to the absolute scale (DESIGN 17.7 item 13).

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

// The scale in one line, for the legend docked under the map: "Load · 1 to
// 177 · Relative". With one group there is no load colouring to give.
export function lineText(picture) {
  const text = scaleLine(picture);
  return text !== '' && picture.routesMode === 'crowd' ? text + ' \u00b7 crowd-aware' : text;
}

function scaleLine(picture) {
  if (!picture || picture.mode === 'empty') return '';
  if (picture.mode === 'teacher') return 'One teacher \u00b7 dashed: with a free period between';
  if (picture.mode === 'single') return 'One group · its own colour';
  const load = picture.load;
  if (!load) return 'Load';
  if (picture.filter) {
    const first = load.edges[0];
    const last = load.edges[load.edges.length - 1];
    const range = !(load.max > 0) && load.mode !== 'absolute' ? 'nobody crosses' : first.from + ' to ' + (last.to === null ? last.from + ' or more' : last.to);
    return loadTitle(picture) + ' \u00b7 ' + range + ' \u00b7 ' + (load.mode === 'absolute' ? 'Absolute' : 'Relative to these walks');
  }
  const first = load.edges[0];
  const last = load.edges[load.edges.length - 1];
  const range = !(load.max > 0) && load.mode !== 'absolute' ? 'nobody crosses' : first.from + ' to ' + (last.to === null ? last.from + ' or more' : last.to);
  return 'Load · ' + range + ' · ' + (load.mode === 'absolute' ? 'Absolute' : 'Relative');
}

// "Load of walks into Room 204" with a filter set, else "Load".
export function loadTitle(picture) {
  return picture && picture.filter ? 'Load of walks ' + picture.filter.words.map((part) => part.text).join('') : 'Load';
}

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
  // with a filter set and the relative scale: the way to the scale that compares
  const scaleLink = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'use-absolute' }, on: { click: () => options.scale('absolute') } }, 'Use the absolute scale');
  const zones = h('p', { class: 'mov-legend__note', data: { legend: 'zones' } });
  const body = h('div', { class: 'mov-legend__body' }, what, bands, measureBox, scaleBox, scaleNote, scaleLink, zones);
  const single = h('p', { class: 'mov-legend__what', hidden: true, data: { legend: 'single' } });
  // crowd-aware routes: what the picture is of, and what the faint dashed line is (DESIGN 17.1, 17.7 items 6 and 7)
  const routesNote = h('p', { class: 'mov-legend__note', hidden: true, data: { legend: 'routes' } });
  const usualNote = h('p', { class: 'mov-legend__note', hidden: true, data: { legend: 'usual' } });
  // the card can be folded to its title, to see the map under it; docked, the
  // same button puts the card away and leaves the line
  let folded = options.folded === true;
  let docked = false;
  let open = false;
  const toggle = h('button', { type: 'button', class: 'mov-link mov-legend__toggle', 'aria-expanded': String(!folded), data: { action: 'fold-legend' } }, folded ? 'Show' : 'Hide');
  toggle.addEventListener('click', () => {
    if (docked) {
      setOpen(false);
      scaleButton.focus();
      return;
    }
    folded = !folded;
    draw();
    if (options.fold) options.fold(folded);
  });
  const element = h('aside', { class: 'mov-legend', 'aria-labelledby': titleId, hidden: true, data: { folded: String(folded), docked: 'false', open: 'false' } }, h('div', { class: 'mov-legend__head' }, title, toggle), body, single, routesNote, usualNote);

  // ---- docked: one line under the map
  const lineWords = h('span', { class: 'mov-legend-line__words', data: { legend: 'line' } });
  const scaleButton = h('button', { type: 'button', class: 'mov-link mov-legend-line__open', 'aria-expanded': 'false', data: { action: 'scale' } }, 'Scale');
  scaleButton.addEventListener('click', () => {
    setOpen(!open);
    if (open) toggle.focus();
  });
  // the way to the absolute scale, on the docked line too: the card brought out over a small map can be taller than it
  const lineAbsolute = h('button', { type: 'button', class: 'mov-link', hidden: true, data: { action: 'use-absolute-docked' }, on: { click: () => options.scale('absolute') } }, 'Use the absolute scale');
  const line = h('div', { class: 'mov-legend-line', hidden: true, data: { legend: 'dock' } }, lineWords, lineAbsolute, scaleButton);

  function draw() {
    // docked, the card is whole whenever it is brought out: folding is for the card that stands on the map
    const isFolded = folded && !docked;
    toggle.textContent = isFolded ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!isFolded));
    element.dataset.folded = String(isFolded);
    element.dataset.docked = String(docked);
    element.dataset.open = String(docked && open);
    // away, it is out of the reader's way and out of the keyboard's
    element.inert = docked && !open;
    line.hidden = !docked || element.hidden;
    scaleButton.setAttribute('aria-expanded', String(open));
  }

  function setOpen(next) {
    open = next && docked;
    draw();
  }

  function setDocked(next) {
    if (next === docked) return;
    const focused = document.activeElement;
    const held = next ? element.contains(focused) : line.contains(focused);
    docked = next;
    open = false;
    draw();
    if (held) (next ? scaleButton : toggle).focus();
  }

  // the card brought out over the map, as Scale does, with the focus on its own button
  function bringOut() {
    if (!docked) return;
    setOpen(true);
    toggle.focus();
  }

  return {
    element,
    line,
    setDocked,
    bringOut,
    get docked() {
      return docked;
    },
    get open() {
      return docked && open;
    },
    update(project, picture, chosen) {
      element.hidden = picture.mode === 'empty';
      const lens = picture.routesMode === 'crowd' && picture.mode !== 'empty';
      routesNote.hidden = !lens;
      routesNote.textContent = lens ? 'Crowd-aware routes (a what-if): the lines and the load are the crowd-aware ones; checks use the usual routes. A group on another way is marked in Summary.' : '';
      const usual = lens && chosen && typeof chosen.usual === 'string' && chosen.usual !== '' ? chosen.usual : '';
      usualNote.hidden = usual === '';
      usualNote.replaceChildren(...(usual === '' ? [] : ['Faint and dashed: the usual route of ', h('bdi', null, usual), '.']));
      lineWords.textContent = lineText(picture);
      lineAbsolute.hidden = true;
      draw();
      if (picture.mode === 'empty') return;
      const group = picture.mode === 'single' ? picture.groups[0] : null;
      const teacher = picture.mode === 'teacher' ? picture.teacher : null;
      body.hidden = Boolean(group) || Boolean(teacher) || !picture.load;
      single.hidden = !group && !teacher;
      title.textContent = teacher ? 'One teacher' : group ? 'One group' : loadTitle(picture);
      if (teacher) {
        single.replaceChildren(h('span', { class: 'mov-swatch', style: 'background:' + (teacher.colour || 'var(--ink)') }), ' ', h('bdi', null, teacher.teacher.name), ': the line is ', teacher.colour ? 'the teacher\u2019s subject colour' : 'ink, since the teacher has no subject', '. A dashed line is a walk with a free period between. Corridors are not coloured by load.');
        return;
      }
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
      scale.set(chosen && (chosen.mode === 'absolute' || chosen.mode === 'relative') ? chosen.mode : load.mode);
      const only = picture.filter ? 'Relative to ' + 'walks ' + picture.filter.words.map((part) => part.text).join('') + ' only' : null;
      scaleNote.textContent = load.mode === 'absolute'
        ? 'Absolute: fixed loads, set in Project, so two pictures compare.'
        : only !== null ? only + (load.max > 0 ? ': fifths of the busiest cell, ' + load.max + '.' : '. Nobody crosses a corridor here.')
          : load.max > 0 ? 'Relative: fifths of the busiest cell on screen, ' + load.max + '.' : 'Relative: fifths of the busiest cell on screen. Nobody crosses a corridor here.';
      scaleLink.hidden = !(picture.filter && load.mode !== 'absolute');
      lineAbsolute.hidden = scaleLink.hidden;
      zones.textContent = load.zones === 0
        ? 'No exclusion zones.'
        : count(load.zones, 'exclusion zone') + (load.zones === 1 ? ' is' : ' are') + ' left out of the scale.';
    },
  };
}
