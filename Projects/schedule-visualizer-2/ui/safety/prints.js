// The Prints tab of the Safety inspector (spec 10.3; DESIGN 14.5 and 14.7 items 1, 4, 7, 10;
// ARCHITECTURE 20.5, 20.6 and 20.9 items 4, 9, 12): the three safety prints, each a card with
// its choices and one button that opens the print preview sheet (paper and orientation are the
// sheet's, as for every print).
//
//   Evacuation posters   a radio pair, One per floor / One per named corridor; the floors, or the
//                        named corridors by floor, as ticks (all ticked); with no named corridor,
//                        the sentence that says so with a link to Building; with corridors chosen,
//                        the rooms that open onto no named corridor; a warning block naming the
//                        rooms with no way out on what is ticked; Preview posters
//   Lockdown maps        the floors as ticks; Preview lockdown maps
//   Map pack             the sections as ticks (Step-free ways out only when something step-free
//                        is marked); Preview the map pack
//
// A tick list of more than six items gets "All" and "None". Preview with nothing ticked is
// aria-disabled, its reason beside it, and keeps the focus. All, None and the radio say the count
// in the page's polite region ("3 of 3 floors ticked"). While a trial is on the tab says the
// prints are the building as built, never the trial (the prints never read it).
//
//   printsPanel(env) -> { element, update() }
//     env   { ctx, project(), picture(), asBuilt() (the plain pass), home() }
//
// The preview gets `floorIds` and `corridorIds`, never `floorId` (the sheet forces that over a
// caller's; ARCHITECTURE 20.9 item 12), and `opener`, the button, which takes the focus back.

import { h, uid } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { openPrintPreview } from '../components/print-preview.js';
import { count } from '../components/words.js';
import { routingGraph } from '../../engine/routing.js';
import { corridorRooms, roomsOnNoNamedCorridor } from '../../engine/exit-load.js';
import { corridorsFor, NO_CORRIDOR_NAMED } from '../prints/evacuation-poster.js';
import { SECTIONS, DEFAULT_SECTIONS } from '../prints/map-pack.js';
import { hasStepMarks, AS_BUILT_LINE } from './ways.js';

export const PRINTS_HEAD = 'Prints';
export const ALL_NONE_FROM = 7;       // a tick list of more than six gets All and None
export const TICK_FLOOR = 'Tick at least one floor.';
export const TICK_CORRIDOR = 'Tick at least one corridor.';
export const TICK_SECTION = 'Tick at least one section.';
export const NO_FLOORS = 'The building has no floors yet.';
export const POSTERS_LEAD = 'A poster to put up on each floor or in each corridor, with every way out in its exit’s colour.';
export const LOCKDOWN_LEAD = 'A plain map of each floor with a reference grid and an index of rooms, for the emergency plan and for responders. It shows places, never people.';
export const PACK_LEAD = 'The floor plans, lockdown maps and evacuation posters for every floor, with a cover and the exits and assembly points, in one document. Print it, or choose Save as PDF in the print dialog to keep it as one file.';
export const NOTES = { posters: ' (one per floor)', cards: ' (one or two pages a room)' };

const floorNoun = (n) => (n === 1 ? 'floor' : 'floors');
const corridorNoun = (n) => (n === 1 ? 'corridor' : 'corridors');
const sectionNoun = (n) => (n === 1 ? 'section' : 'sections');

export function printsPanel(env) {
  const base = uid('prints');
  // what is chosen: the way of the posters, and what is left unticked (so that a floor drawn later is ticked)
  const fresh = () => ({ projectId: null, by: 'floor', postersOff: new Set(), corridorsOff: new Set(), lockdownOff: new Set(), sections: new Set(DEFAULT_SECTIONS) });
  let state = fresh();

  const trialLine = h('p', { class: 'sfy-panel__lead sfy-trial-line', role: 'note', hidden: true, data: { line: 'as-built' } }, AS_BUILT_LINE);

  // ---- the posters card
  const postersHead = h('h3', { class: 'mov-panel__sub', id: base + '-posters-head' }, 'Evacuation posters');
  const by = choice({
    name: base + '-by',
    labelledBy: postersHead.id,
    value: state.by,
    options: [{ value: 'floor', label: 'One per floor' }, { value: 'corridor', label: 'One per named corridor' }],
    onChange(value) {
      state.by = value;
      draw();
      const n = value === 'floor' ? env.project().building.floors.length : namedCorridors().length;
      env.ctx.announce(value === 'floor' ? 'One per floor: ' + count(n, 'floor') : 'One per named corridor: ' + count(n, 'corridor'));
    },
  });
  const postersTicks = h('div', { class: 'sfy-prints__ticks', data: { ticks: 'posters' } });
  const postersNote = h('p', { class: 'sfy-cards__hint', data: { line: 'corridor-note' }, hidden: true });
  const postersWarn = h('div', { class: 'sfy-prints__warn', data: { part: 'no-way-out-slot' } });
  const postersButton = previewButton('posters', 'Preview posters');
  const postersReason = h('span', { class: 'sfy-cards__hint', id: base + '-posters-reason', data: { part: 'reason' }, hidden: true });
  postersButton.setAttribute('aria-describedby', postersReason.id);
  const postersCard = h('section', { class: 'sfy-card sfy-prints__card', 'aria-labelledby': postersHead.id, data: { card: 'posters' } },
    postersHead, h('p', { class: 'sfy-panel__lead' }, POSTERS_LEAD), by.element, postersTicks, postersNote, postersWarn,
    h('div', { class: 'sfy-prints__go' }, postersButton, postersReason));

  // ---- the lockdown card
  const lockdownHead = h('h3', { class: 'mov-panel__sub', id: base + '-lockdown-head' }, 'Lockdown maps');
  const lockdownTicks = h('div', { class: 'sfy-prints__ticks', data: { ticks: 'lockdown' } });
  const lockdownButton = previewButton('lockdown', 'Preview lockdown maps');
  const lockdownReason = h('span', { class: 'sfy-cards__hint', id: base + '-lockdown-reason', data: { part: 'reason' }, hidden: true });
  lockdownButton.setAttribute('aria-describedby', lockdownReason.id);
  const lockdownCard = h('section', { class: 'sfy-card sfy-prints__card', 'aria-labelledby': lockdownHead.id, data: { card: 'lockdown' } },
    lockdownHead, h('p', { class: 'sfy-panel__lead' }, LOCKDOWN_LEAD), lockdownTicks,
    h('div', { class: 'sfy-prints__go' }, lockdownButton, lockdownReason));

  // ---- the map pack card
  const packHead = h('h3', { class: 'mov-panel__sub', id: base + '-pack-head' }, 'Map pack');
  const packTicks = h('div', { class: 'sfy-prints__ticks', data: { ticks: 'pack' } });
  const packButton = previewButton('pack', 'Preview the map pack');
  const packReason = h('span', { class: 'sfy-cards__hint', id: base + '-pack-reason', data: { part: 'reason' }, hidden: true });
  packButton.setAttribute('aria-describedby', packReason.id);
  const packCard = h('section', { class: 'sfy-card sfy-prints__card', 'aria-labelledby': packHead.id, data: { card: 'pack' } },
    packHead, h('p', { class: 'sfy-panel__lead' }, PACK_LEAD), packTicks,
    h('div', { class: 'sfy-prints__go' }, packButton, packReason));

  const element = h('div', { class: 'mov-panel sfy-panel sfy-prints', data: { panel: 'prints' } },
    h('h2', { class: 'mov-panel__title' }, PRINTS_HEAD), trialLine, postersCard, lockdownCard, packCard);

  let drawnFor = null;

  function previewButton(which, label) {
    const button = h('button', { type: 'button', class: 'btn btn--primary sfy-prints__preview', data: { preview: which } }, label);
    button.addEventListener('click', (event) => {
      const why = reasonFor(which);
      if (why !== '') {
        event.preventDefault();
        env.ctx.announce(why);
        return;
      }
      open(which, button);
    });
    return button;
  }

  const namedCorridors = () => corridorsFor(env.project(), null);

  // the ids ticked now, in the building's order
  function ticked(which) {
    const project = env.project();
    if (which === 'posters') {
      return state.by === 'floor'
        ? project.building.floors.filter((floor) => !state.postersOff.has(floor.id)).map((floor) => floor.id)
        : namedCorridors().filter(({ corridor }) => !state.corridorsOff.has(corridor.id)).map(({ corridor }) => corridor.id);
    }
    if (which === 'lockdown') return project.building.floors.filter((floor) => !state.lockdownOff.has(floor.id)).map((floor) => floor.id);
    return SECTIONS.filter((section) => state.sections.has(section.id) && (section.id !== 'step-free' || hasStepMarks(project.building))).map((section) => section.id);
  }

  function reasonFor(which) {
    const project = env.project();
    if (which === 'pack') return ticked('pack').length === 0 ? TICK_SECTION : '';
    if (project.building.floors.length === 0) return NO_FLOORS;
    if (which === 'posters' && state.by === 'corridor' && namedCorridors().length === 0) return 'There is no named corridor to print.';
    if (ticked(which).length > 0) return '';
    return which === 'posters' && state.by === 'corridor' ? TICK_CORRIDOR : TICK_FLOOR;
  }

  function open(which, button) {
    const chosen = ticked(which);
    if (which === 'posters') openPrintPreview(env.ctx, 'evacuation-poster', state.by === 'floor' ? { opener: button, by: 'floor', floorIds: chosen } : { opener: button, by: 'corridor', corridorIds: chosen });
    else if (which === 'lockdown') openPrintPreview(env.ctx, 'lockdown-map', { opener: button, floorIds: chosen });
    else openPrintPreview(env.ctx, 'map-pack', { opener: button, sections: chosen, stepFree: chosen.includes('step-free') });
  }

  // a tick list: [{ id, text, typed, note }] as ticks (typed: a name, set in a bdi), with All and None past six; `groups` sets a legend over a run
  function tickList(kind, groups, off, noun, onChange) {
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    const out = [];
    const countLine = h('p', { class: 'sfy-cards__hint', data: { part: 'count' } });
    const sync = () => {
      const on = groups.reduce((sum, group) => sum + group.items.filter((item) => !off.has(item.id)).length, 0);
      countLine.textContent = on + ' of ' + total + ' ' + noun(total) + ' ticked';
      return countLine.textContent;
    };
    if (total >= ALL_NONE_FROM) {
      const all = h('button', { type: 'button', class: 'btn btn--quiet', id: base + '-' + kind + '-all', 'aria-label': 'All ' + noun(2), data: { action: 'all', ticks: kind } }, 'All');
      const none = h('button', { type: 'button', class: 'btn btn--quiet', id: base + '-' + kind + '-none', 'aria-label': 'None of the ' + noun(2), data: { action: 'none', ticks: kind } }, 'None');
      const set = (on) => {
        for (const group of groups) for (const item of group.items) {
          if (on) off.delete(item.id);
          else off.add(item.id);
        }
        for (const box of element.querySelectorAll('.sfy-tick__box[data-ticks="' + kind + '"]')) box.checked = on;
        onChange();
        env.ctx.announce(sync());
      };
      all.addEventListener('click', () => set(true));
      none.addEventListener('click', () => set(false));
      out.push(h('div', { class: 'sfy-prints__all', role: 'group', 'aria-label': 'Tick ' + noun(2) }, all, none));
    }
    for (const group of groups) {
      const items = group.items.map((item) => {
        const box = h('input', { type: 'checkbox', class: 'sfy-tick__box', id: base + '-' + kind + '-' + item.id, data: { ticks: kind, id: item.id } });
        box.checked = !off.has(item.id);
        box.addEventListener('change', () => {
          if (box.checked) off.delete(item.id);
          else off.add(item.id);
          sync();
          onChange();
        });
        return h('li', { class: 'sfy-tick', data: { id: item.id } }, box, h('label', { class: 'sfy-tick__label', for: box.id }, h('span', { class: 'sfy-tick__words' }, item.typed ? h('bdi', null, item.text) : item.text, item.note || null)));
      });
      const list = h('ul', { class: 'sfy-ticks__list' }, items);
      out.push(group.legend
        ? h('fieldset', { class: 'sfy-ticks sfy-ticks--floor', data: { ticks: kind } }, h('legend', { class: 'sfy-ticks__legend' }, group.legend), list)
        : h('fieldset', { class: 'sfy-ticks', data: { ticks: kind } }, h('legend', { class: 'sfy-ticks__legend' }, group.title), list));
    }
    sync();
    out.push(countLine);
    return out;
  }

  // the rooms with no way out on what is ticked, each with the sheet it will be missing from
  function warning(picture, project) {
    const rows = picture ? picture.rows.filter((row) => !row.ok) : [];
    if (rows.length === 0 || ticked('posters').length === 0) return [];
    const lines = [];
    if (state.by === 'floor') {
      const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
      const on = new Set(ticked('posters'));
      for (const row of rows) {
        if (on.has(row.floorId) && floors.has(row.floorId)) lines.push({ row, where: floors.get(row.floorId).name, kind: 'floor' });
      }
    } else {
      const graph = routingGraph(project);
      const named = new Map(namedCorridors().map(({ corridor, floor }) => [corridor.id, { corridor, floor }]));
      for (const id of ticked('posters')) {
        const inside = new Set(corridorRooms(project, graph, id));
        const here = named.get(id);
        for (const row of rows) if (inside.has(row.roomId) && here) lines.push({ row, where: here.corridor.name, kind: 'corridor' });
      }
    }
    if (lines.length === 0) return [];
    return [h('div', { class: 'sfy-warn', role: 'group', 'aria-label': 'Warning', data: { part: 'no-way-out' } },
      h('p', { class: 'sfy-warn__head' }, h('strong', null, 'Warning')),
      h('ul', { class: 'sfy-prints__missing' }, lines.map(({ row, where }) => h('li', { data: { room: row.roomId } },
        h('bdi', null, row.name), ' has no way out and its route will be missing from the ', h('bdi', null, where), ' poster.'))))];
  }

  function corridorLine(picture, project) {
    postersNote.hidden = true;
    postersNote.replaceChildren();
    if (state.by !== 'corridor') return;
    if (namedCorridors().length === 0) {
      const [first, rest] = NO_CORRIDOR_NAMED.split('Building');
      postersNote.replaceChildren(first, h('button', { type: 'button', class: 'mov-link', data: { action: 'to-building' }, on: { click: () => env.ctx.navigate('#building') } }, 'Building'), rest);
      postersNote.hidden = false;
      return;
    }
    const left = roomsOnNoNamedCorridor(project, routingGraph(project)).length;
    if (left > 0) {
      postersNote.textContent = count(left, 'room') + (left === 1 ? ' opens' : ' open') + ' onto no named corridor and ' + (left === 1 ? 'is' : 'are') + ' on no corridor poster; the floor posters show ' + (left === 1 ? 'it' : 'them') + '.';
      postersNote.hidden = false;
    }
  }

  function reasons() {
    for (const [which, button, reason] of [['posters', postersButton, postersReason], ['lockdown', lockdownButton, lockdownReason], ['pack', packButton, packReason]]) {
      const why = reasonFor(which);
      if (why === '') {
        button.removeAttribute('aria-disabled');
        reason.hidden = true;
        reason.textContent = '';
      } else {
        button.setAttribute('aria-disabled', 'true');
        reason.hidden = false;
        reason.textContent = why;
      }
    }
  }

  function afterTicks() {
    const picture = env.asBuilt();
    postersWarn.replaceChildren(...warning(picture, env.project()));
    reasons();
  }

  // everything drawn again: the building changed, or the radio did. The focus goes back to the same control.
  function draw() {
    const project = env.project();
    // another project: its own choices, not the last one's
    if (state.projectId !== project.id) state = Object.assign(fresh(), { projectId: project.id });
    const picture = env.asBuilt();
    const held = element.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : null;
    const floors = project.building.floors.map((floor) => ({ id: floor.id, text: floor.name, typed: true }));
    const corridors = namedCorridors();
    // a tick list forgets what no longer exists, so a floor drawn later is ticked
    for (const set of [state.postersOff, state.lockdownOff]) for (const id of Array.from(set)) if (!floors.some((floor) => floor.id === id)) set.delete(id);
    for (const id of Array.from(state.corridorsOff)) if (!corridors.some(({ corridor }) => corridor.id === id)) state.corridorsOff.delete(id);
    by.set(state.by);
    if (state.by === 'floor') postersTicks.replaceChildren(...tickList('posters', [{ title: 'Floors', items: floors }], state.postersOff, floorNoun, afterTicks));
    else {
      const groups = [];
      for (const floor of project.building.floors) {
        const here = corridors.filter((entry) => entry.floor.id === floor.id);
        if (here.length > 0) groups.push({ legend: h('bdi', null, floor.name), items: here.map(({ corridor }) => ({ id: corridor.id, text: corridor.name, typed: true })) });
      }
      postersTicks.replaceChildren(...(groups.length === 0 ? [] : tickList('posters', groups, state.corridorsOff, corridorNoun, afterTicks)));
    }
    lockdownTicks.replaceChildren(...tickList('lockdown', [{ title: 'Floors', items: floors }], state.lockdownOff, floorNoun, afterTicks));
    const steps = hasStepMarks(project.building);
    const items = SECTIONS.filter((section) => section.id !== 'step-free' || steps).map((section) => ({ id: section.id, text: section.label, typed: false, note: NOTES[section.id] || null }));
    const sectionOff = { has: (id) => !state.sections.has(id), add: (id) => state.sections.delete(id), delete: (id) => state.sections.add(id) };
    packTicks.replaceChildren(...tickList('pack', [{ title: 'Sections', items }], sectionOff, sectionNoun, afterTicks));
    corridorLine(picture, project);
    afterTicks();
    if (held) {
      const again = document.getElementById(held);
      if (again) again.focus();
    }
  }

  function update() {
    const picture = env.picture();
    if (!picture) return;
    trialLine.hidden = !picture.trial;
    const built = env.asBuilt();
    if (drawnFor !== built) {
      drawnFor = built;
      draw();
    }
  }

  return { element, update };
}
