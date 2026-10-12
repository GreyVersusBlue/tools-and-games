// The congestion report (spec 7.7): the page that turns the movement picture
// into a proposal. For each day type that is its own copy, with every group
// of the school walking:
//
//   the three worst transitions   by the time all groups together lose to the
//                                 crowd, with the busiest place of each
//   the ten busiest places        the hotspot table: load, the transition it
//                                 peaks in, the groups, the delay there
//   groups that cannot arrive in time   every late walk, slowest first
//
// and, when a scenario is open in the project, what the scenario changes.
// The comparison of a scenario with the schedule is not built yet, so that
// part is left out and one sentence says so.
//
// render(project, derived, options) → { title, html }
//   derived   as the movement picture takes it (./movement.js); left out,
//             the results are worked out here
//   options.movement   { project, results, graph }: the movement view's own
//             state, forwarded by the preview sheet. Given, the report is of
//             that project with those results.
//   and what every output takes (document.js)
//
//   worstTransitions(project, results, dayTypeId) → [{ period, name, times, seconds, walks, waiting, late }]
//     every transition somebody walks in, worst first: most waiting, then
//     most late walks, then the earlier one
//   lateWalks(project, results, dayTypeId) → the late walks as tables.js rows, slowest first

import { ownDayTypes } from '../../engine/day-types.js';
import { loads } from '../../engine/load.js';
import { count, list } from '../components/words.js';
import { transitionsOf, unitWord } from '../movement/model.js';
import { rankedPlaces } from '../movement/hotspots.js';
import { transitionRows, lateWords } from '../movement/tables.js';
import { esc, frame } from './document.js';
import { printedFrom, placesTable, seconds, PLACES_ON_PAPER } from './movement.js';

export const id = 'congestion';
export const name = 'Congestion report';

export const WORST_TRANSITIONS = 3;

function crowdDay(results, dayTypeId) {
  return results.crowd && Array.isArray(results.crowd.days) ? results.crowd.days.find((day) => day.dayTypeId === dayTypeId) || null : null;
}

export function worstTransitions(project, results, dayTypeId) {
  const day = crowdDay(results, dayTypeId);
  const transitions = transitionsOf(project, dayTypeId);
  const found = [];
  for (const transition of day ? day.transitions : []) {
    const named = transitions[transition.period];
    if (!named || transition.groups.length === 0) continue;
    let waiting = 0;
    let late = 0;
    for (const group of transition.groups) {
      waiting += group.waiting;
      if (group.late === true) late += 1;
    }
    found.push({ period: transition.period, name: named.name, times: named.times, seconds: named.seconds, walks: transition.groups.length, waiting, late });
  }
  return found.sort((a, b) => b.waiting - a.waiting || b.late - a.late || a.period - b.period);
}

export function lateWalks(project, results, dayTypeId) {
  const found = [];
  for (let period = 0; period + 1 < project.settings.periods; period += 1) {
    for (const row of transitionRows(project, results, dayTypeId, period).rows) if (row.late) found.push(row);
  }
  return found.sort((a, b) => b.over - a.over || b.total - a.total || a.period - b.period);
}

function dayLoad(project, results, graph, dayTypeId) {
  const held = Array.isArray(results.loads) ? results.loads.find((load) => load && load.dayTypeId === dayTypeId) : null;
  return held || loads(project, results.routes, dayTypeId, graph);
}

function place(row) {
  return row.parts.map((part) => esc(part.text)).join('') + (row.floorName ? ' on ' + esc(row.floorName) : '');
}

function daySection(project, results, graph, dayType, first) {
  const transitions = transitionsOf(project, dayType.id);
  const load = dayLoad(project, results, graph, dayType.id);
  const ask = (transition) => ({ dayTypeId: dayType.id, groups: project.groups, load, max: load ? load.max.busiest : 0, transition, measure: 'busiest', transitions });
  const places = load ? rankedPlaces(project, results, graph, ask(null)) : [];
  const worst = worstTransitions(project, results, dayType.id);
  const late = lateWalks(project, results, dayType.id);
  const lateGroups = new Set(late.map((row) => row.group.id)).size;

  const out = ['<section class="doc-section' + (first ? '' : ' new-sheet') + '">', '<h2>' + esc(dayType.name) + '</h2>'];
  if (places.length === 0) {
    out.push('<p class="doc-lead">' + esc('Nobody crosses a corridor on ' + dayType.name + ' yet, so there is nothing to report.') + '</p>', '</section>');
    return out.join('\n');
  }
  const top = places[0];
  out.push('<p class="doc-lead">On ' + esc(dayType.name) + ' the busiest place is ' + place(top) + ': ' + top.load + ' ' + unitWord(top.unit, top.load) + (top.when ? ' in ' + esc(top.when) : '') + '. '
    + esc(late.length === 0
      ? 'Every group arrives in time.'
      : count(lateGroups, 'group') + ' cannot arrive in time, on ' + count(late.length, 'walk') + '.')
    + '</p>');

  // the worst transitions
  out.push('<h2>The ' + (worst.length < WORST_TRANSITIONS ? '' : WORST_TRANSITIONS + ' ') + 'worst transitions</h2>');
  out.push('<p class="doc-meaning">Worst first, by the time all groups together lose to the crowd.</p>');
  out.push('<table class="doc-table doc-table--worst">',
    '<thead><tr><th scope="col">Transition</th><th scope="col">Passing time</th><th scope="col" class="is-number">Groups walking</th><th scope="col" class="is-number">Lost to the crowd</th><th scope="col" class="is-number">Late walks</th><th scope="col">Busiest place</th></tr></thead>',
    '<tbody>');
  for (const each of worst.slice(0, WORST_TRANSITIONS)) {
    const busiest = rankedPlaces(project, results, graph, ask(each.period))[0] || null;
    out.push('<tr><th scope="row">' + esc(each.name) + '</th>'
      + '<td>' + esc((each.times ? each.times + ', ' : '') + seconds(each.seconds)) + '</td>'
      + '<td class="is-number">' + each.walks + '</td>'
      + '<td class="is-number">' + (each.waiting === 0 ? 'none' : esc(seconds(each.waiting))) + '</td>'
      + '<td class="is-number">' + each.late + '</td>'
      + '<td>' + (busiest ? place(busiest) + ': ' + busiest.load + ' ' + unitWord(busiest.unit, busiest.load) : '') + '</td></tr>');
  }
  out.push('</tbody></table>');

  // the busiest places
  out.push('<h2>The ' + (places.length < PLACES_ON_PAPER ? places.length : PLACES_ON_PAPER) + ' busiest places</h2>');
  out.push('<p class="doc-meaning">' + esc('Each place at its busiest moment. Delay is the waiting the crowd model found there in the transition named.'
    + (load.zones > 0 ? ' ' + count(load.zones, 'exclusion zone') + (load.zones === 1 ? ' is' : ' are') + ' left out.' : '')) + '</p>');
  out.push(placesTable(places, { limit: PLACES_ON_PAPER }));

  // who is late
  out.push('<h2>Groups that cannot arrive in time</h2>');
  if (late.length === 0) {
    out.push('<p class="doc-none">Every group arrives in time on ' + esc(dayType.name) + '.</p>');
  } else {
    out.push('<table class="doc-table doc-table--late">',
      '<thead><tr><th scope="col">Group</th><th scope="col">Transition</th><th scope="col">From</th><th scope="col">To</th><th scope="col" class="is-number">Walking</th><th scope="col" class="is-number">Waiting</th><th scope="col" class="is-number">Total</th><th scope="col" class="is-number">Passing time</th><th scope="col">Late</th></tr></thead>',
      '<tbody>');
    for (const row of late) {
      out.push('<tr><th scope="row">' + esc(row.group.name) + '</th>'
        + '<td>' + esc(transitions[row.period] ? transitions[row.period].name : '') + '</td>'
        + '<td>' + esc(row.from) + '</td><td>' + esc(row.to) + '</td>'
        + '<td class="is-number">' + esc(seconds(row.walking)) + '</td>'
        + '<td class="is-number">' + (row.waiting === 0 ? 'none' : esc(seconds(row.waiting))) + '</td>'
        + '<td class="is-number">' + esc(seconds(row.total)) + '</td>'
        + '<td class="is-number">' + esc(seconds(row.passingSeconds)) + '</td>'
        + '<td>' + esc(lateWords(row)) + '</td></tr>');
    }
    out.push('</tbody></table>');
  }
  out.push('</section>');
  return out.join('\n');
}

// What is said of an open scenario until its comparison exists.
export function scenarioSection(project) {
  const scenario = project.scenario;
  if (!scenario) return '';
  const changes = Array.isArray(scenario.changes) ? scenario.changes.length : 0;
  const called = typeof scenario.name === 'string' && scenario.name.trim() !== '' ? ', ' + esc(scenario.name) + ',' : '';
  return '<section class="doc-section doc-scenario">\n<h2>The scenario</h2>\n'
    + '<p class="doc-none">A scenario' + called + ' is open with ' + count(changes, 'change') + '. What it would change is left out of this report: the comparison is not built yet, and every figure here is the schedule as it stands.</p>\n'
    + '</section>';
}

export function render(given, derived, options) {
  const opts = options || {};
  const { project, results, graph } = printedFrom(given, derived, opts);
  const own = ownDayTypes(project);
  const body = own.map((dayType, index) => daySection(project, results, graph, dayType, index === 0));
  const followers = project.dayTypes.filter((dayType) => !own.includes(dayType));
  if (followers.length > 0) {
    body.push('<p class="doc-meaning">' + esc(list(followers.map((dayType) => dayType.name)) + (followers.length === 1 ? ' is' : ' are') + ' the same as ' + project.dayTypes[0].name + ' and ' + (followers.length === 1 ? 'has' : 'have') + ' no figures of ' + (followers.length === 1 ? 'its' : 'their') + ' own.') + '</p>');
  }
  body.push(scenarioSection(project));
  return frame(project, { output: id, what: name, pages: [{ body: body.filter((part) => part !== '').join('\n') }], options: opts });
}
