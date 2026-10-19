// The comparison, in the inspector (spec 9.2, DESIGN 5.4): Before / After /
// Difference for the figures, the groups whose travel changes (biggest
// first, edited groups marked in words), the places that change most, and
// the findings new, resolved and unchanged. Every figure comes from the
// scenario lane (store.derived.scenario(), ARCHITECTURE 6.6 "The scenario
// lane as built"); nothing is worked out here. While the lane is working
// the panel says so and keeps the last answer, marked as old.
//
// comparePanel(env) -> { element, update(state) }
//   env.ctx, env.memory (memory.dayTypeId, memory.transition), env.ask()
//   (ask the lane again with the memory's options)
//   state: { project, compare (or null), scenario (open or not), pending, old, failed }

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { figureRows, groupRows, placeRow, transitionChoices } from './model.js';

const SEVERITY = { problem: 'Problem', warning: 'Warning', note: 'Note' };

function partsToNodes(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function trend(worse) {
  if (worse === null || worse === undefined) return null;
  return h('span', { class: 'scn-trend', data: { trend: worse ? 'worse' : 'better' } }, worse ? 'worse' : 'better');
}

export function comparePanel(env) {
  const ctx = env.ctx;
  const memory = env.memory;
  const title = h('h2', { class: 'scn-compare__title' }, 'Before and after');
  const daySelect = h('select', { class: 'field__input', id: 'scenario-compare-day', data: { key: 'scenario-compare-day' } });
  const whenSelect = h('select', { class: 'field__input', id: 'scenario-compare-when', data: { key: 'scenario-compare-when' } });
  daySelect.addEventListener('change', () => {
    memory.dayTypeId = daySelect.value === '' ? null : daySelect.value;
    env.ask();
  });
  whenSelect.addEventListener('change', () => {
    memory.transition = whenSelect.value === '' ? null : Number(whenSelect.value);
    env.ask();
  });
  const options = h('div', { class: 'scn-compare__options' },
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'scenario-compare-day' }, 'Day type'), daySelect),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'scenario-compare-when' }, 'Places: the whole day or one transition'), whenSelect));
  const status = h('p', { class: 'scn-compare__status', role: 'status', data: { part: 'status' } });
  const body = h('div', { class: 'scn-compare__body', data: { part: 'body' } });
  const element = h('div', { class: 'scn-compare', data: { state: 'none' } }, title, options, status, body);

  let optionsKey = '';
  function drawOptions(project) {
    const days = ownDayTypes(project);
    const transitions = transitionChoices(project);
    const key = JSON.stringify([days.map((day) => [day.id, day.name]), transitions.map((each) => each.label)]);
    if (key !== optionsKey) {
      optionsKey = key;
      daySelect.replaceChildren(h('option', { value: '' }, 'Every day type'), ...days.map((day) => h('option', { value: day.id }, day.name)));
      whenSelect.replaceChildren(h('option', { value: '' }, 'The whole day'), ...transitions.map((each) => h('option', { value: each.value }, each.label)));
    }
    if (memory.dayTypeId !== null && !days.some((day) => day.id === memory.dayTypeId)) memory.dayTypeId = null;
    if (memory.transition !== null && !(memory.transition < transitions.length)) memory.transition = null;
    daySelect.value = memory.dayTypeId === null ? '' : memory.dayTypeId;
    whenSelect.value = memory.transition === null ? '' : String(memory.transition);
  }

  function figuresTable(compare) {
    const rows = figureRows(compare);
    return h('table', { class: 'scn-table scn-figures', data: { part: 'figures' } },
      h('caption', { class: 'vh' }, 'The scenario’s figures before, after, and the difference'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'), h('th', { scope: 'col' }, 'Difference'))),
      h('tbody', null, rows.map((row) => h('tr', { data: { figure: row.id, trend: row.worse === null ? 'same' : row.worse ? 'worse' : 'better' } },
        h('th', { scope: 'row' }, row.label),
        h('td', { class: 'num' }, row.before),
        h('td', { class: 'num' }, row.after),
        h('td', { class: 'num' }, row.difference, trend(row.worse))))));
  }

  function busiestLine(compare) {
    const busy = compare.figures.busiest;
    const at = (side) => (side ? [h('bdi', null, side.name), ' (' + side.load + ')'] : ['nowhere']);
    return h('p', { class: 'scn-compare__busiest', data: { part: 'busiest' } }, 'The busiest place before: ', ...at(busy.before), '; after: ', ...at(busy.after), '.');
  }

  function groupsBlock(project, compare) {
    const found = groupRows(project, compare);
    const heading = h('h3', { class: 'scn-compare__heading', id: 'scenario-groups-title' }, 'Travel time by group');
    if (found.rows.length === 0) return h('section', { 'aria-labelledby': 'scenario-groups-title', data: { part: 'groups' } }, heading, h('p', null, 'No group’s travel time changes.'));
    return h('section', { 'aria-labelledby': 'scenario-groups-title', data: { part: 'groups' } }, heading,
      h('table', { class: 'scn-table scn-groups' },
        h('caption', { class: 'vh' }, 'Each group’s travel time over the day, biggest change first'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Group'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'), h('th', { scope: 'col' }, 'Change'))),
        h('tbody', null, found.rows.map((row) => h('tr', { data: { group: row.groupId, edited: String(row.edited), trend: row.worse === null ? 'same' : row.worse ? 'worse' : 'better' } },
          h('th', { scope: 'row' }, row.typed ? h('bdi', null, row.name) : row.name, row.edited ? h('span', { class: 'scn-tag', data: { tag: 'edited' } }, 'edited') : null),
          h('td', { class: 'num' }, row.before),
          h('td', { class: 'num' }, row.after),
          h('td', { class: 'num' }, row.change, trend(row.worse)))))),
      found.same > 0 ? h('p', { class: 'scn-compare__note' }, count(found.same, 'other group') + (found.same === 1 ? ' walks' : ' walk') + ' as before.') : null);
  }

  function placesBlock(compare) {
    const unit = (compare.figures.busiest.after || compare.figures.busiest.before || { unit: 'students' }).unit;
    const heading = h('h3', { class: 'scn-compare__heading', id: 'scenario-places-title' }, memory.transition === null ? 'Places that change most' : 'Places that change most in this transition');
    const listOf = (rows, label, part) => h('div', { class: 'scn-places', data: { part } },
      h('h4', { class: 'scn-places__title' }, label + ' (' + rows.length + ')'),
      rows.length === 0 ? h('p', { class: 'scn-compare__note' }, 'None.') : h('ul', { class: 'scn-places__list' }, rows.map((row) => {
        const each = placeRow(row, unit);
        return h('li', { data: { place: each.placeId } }, h('span', { dir: 'auto' }, partsToNodes(each.parts)), ': ' + each.before + ' → ' + each.after + ' ' + unit + ' (' + each.change + ')');
      })));
    return h('section', { 'aria-labelledby': 'scenario-places-title', data: { part: 'places' } }, heading,
      listOf(compare.places.busier, 'Busier', 'busier'), listOf(compare.places.quieter, 'Quieter', 'quieter'));
  }

  function findingsBlock(compare) {
    const item = (finding) => h('li', { data: { finding: finding.id, severity: finding.severity } }, h('span', { class: 'scn-severity' }, SEVERITY[finding.severity] + ': '), h('span', { dir: 'auto' }, finding.text));
    const listOf = (findings, label, part, open) => {
      const inner = findings.length === 0 ? h('p', { class: 'scn-compare__note' }, 'None.') : h('ul', { class: 'scn-findings__list' }, findings.map(item));
      if (open) return h('div', { class: 'scn-findings', data: { part } }, h('h4', { class: 'scn-findings__title' }, label + ' (' + findings.length + ')'), inner);
      return h('details', { class: 'scn-findings', data: { part } }, h('summary', null, label + ' (' + findings.length + ')'), inner);
    };
    return h('section', { 'aria-labelledby': 'scenario-findings-title', data: { part: 'findings' } },
      h('h3', { class: 'scn-compare__heading', id: 'scenario-findings-title' }, 'Findings'),
      listOf(compare.findings.new, 'New', 'new', true),
      listOf(compare.findings.resolved, 'Resolved', 'resolved', true),
      listOf(compare.findings.unchanged, 'Unchanged', 'unchanged', false));
  }

  // what the body was drawn from: the answer, and the project's groups (a
  // group renamed or deleted while the answer is old is named as it is now)
  let shownCompare = null;
  let shownGroups = null;
  function update(state) {
    drawOptions(state.project);
    const mode = !state.scenario ? 'none' : state.pending && !state.compare ? 'working' : state.failed && !state.compare ? 'failed' : state.old ? 'old' : 'ready';
    element.dataset.state = mode;
    options.hidden = !state.scenario;
    if (!state.scenario) {
      status.textContent = '';
      shownCompare = null;
      body.replaceChildren(h('p', { class: 'scn-compare__note' }, 'Start a scenario, and this compares it with the real schedule: walking, crowding, the busiest place, late arrivals and findings, before and after.'));
      return;
    }
    if (state.failed) status.textContent = 'The comparison could not be worked out: ' + state.failed + (state.compare ? ' The figures below are from before your last change.' : '');
    else if (state.pending) status.textContent = state.compare ? 'Working out the comparison again. The figures below are from before your last change.' : 'Working out the comparison…';
    else status.textContent = '';
    if (!state.compare) {
      shownCompare = null;
      body.replaceChildren();
      return;
    }
    if (state.compare === shownCompare && state.project.groups === shownGroups) return;
    shownCompare = state.compare;
    shownGroups = state.project.groups;
    const keep = body.querySelectorAll('details[open]');
    const opened = new Set(Array.from(keep).map((el) => el.dataset.part));
    body.replaceChildren(figuresTable(state.compare), busiestLine(state.compare), groupsBlock(state.project, state.compare), placesBlock(state.compare), findingsBlock(state.compare));
    for (const part of opened) {
      const again = body.querySelector('details[data-part="' + part + '"]');
      if (again) again.open = true;
    }
  }

  return { element, update, ctx };
}
