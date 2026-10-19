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
// and, when a scenario is open in the project, what the scenario changes
// (spec 9.3): its changes, the figures of spec 9.2 before, after and the
// difference, the findings it brings and the ones it resolves, and the
// places it makes busier and quieter.
//
// render(project, derived, options) → { title, html }
//   project   the project as it is now (the store's). Its open scenario is
//             the one the scenario section is about, whoever opened the
//             report, so it prints the same from Movement and from the lab.
//   derived   as the movement picture takes it (./movement.js); left out,
//             the results are worked out here. derived.scenario is the
//             scenario's comparison, as the scenario lane answers it
//             (store.derived.scenario() → { result, compare, changes, … }),
//             for scenarioSection below; the print preview asks for it and
//             shows the report again when it comes.
//   options.movement   { project, results, graph }: the movement view's own
//             state, forwarded by the preview sheet. Given, the report's
//             day sections are of that project with those results.
//   and what every output takes (document.js)
//
//   worstTransitions(project, results, dayTypeId) → [{ period, name, times, seconds, walks, waiting, late }]
//     every transition somebody walks in, worst first: most waiting, then
//     most late walks, then the earlier one
//   lateWalks(project, results, dayTypeId) → the late walks as tables.js rows, slowest first
//   scenarioSection(project, comparison) → markup, '' with no scenario open
//     comparison   undefined while it is being worked out (or with no engine
//                  to work it out); null when the lane answered null; an
//                  Error or { failed: message } when it failed; else the
//                  lane's answer. An answer for other changes than the
//                  scenario's own as it is now is stale and never printed.
//   SCENARIO_PLACES   how many places busier, and how many quieter, it lists

import { ownDayTypes, findDayType } from '../../engine/day-types.js';
import { reconcile, changeWords } from '../../engine/scenario.js';
import { sortFindings, SEVERITIES } from '../../engine/findings.js';
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
// The places a scenario changes most, each way. Five a side keeps the two
// tables to about a third of a sheet beside the figures; the lab shows the rest.
export const SCENARIO_PLACES = 5;

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

// ---------------------------------------------------------------- the scenario

// The scenario's name as the planner's labels say it: as typed, or "New
// scenario" when nothing is left of it after white space and the zero-width
// characters (engine/actions.js keeps this rule for its labels, unexported).
function scenarioName(scenario) {
  const name = scenario.name;
  return typeof name !== 'string' || name.replace(/[\s​-‍⁠﻿]/g, '') === '' ? 'New scenario' : name;
}

// Parts of words as markup: a name as typed keeps its own direction.
function partsHtml(parts) {
  return parts.map((part) => (part.name ? '<span dir="auto">' + esc(part.text) + '</span>' : esc(part.text))).join('');
}

// A difference with its sign, so it reads on paper without colour: "+2",
// "−1 min 5 s" (a real minus), "no change".
function signed(n, words) {
  if (n === 0) return 'no change';
  return (n > 0 ? '+' : '−') + (words ? words(Math.abs(n)) : String(Math.abs(n)));
}

// More of each figure is worse, so the direction is said in a word too.
function changeCell(n, words) {
  const way = n > 0 ? ' is-more' : n < 0 ? ' is-less' : '';
  return '<td class="is-number doc-change' + way + '">' + esc(signed(n, words)) + '</td>';
}

// Whether a comparison is for the scenario as it is now: the changes it was
// worked out with are the very changes reconcile keeps today, in order.
function current(comparison, kept) {
  const changes = comparison && Array.isArray(comparison.changes) ? comparison.changes : null;
  return changes !== null && changes.length === kept.length && changes.every((change, i) => change === kept[i]);
}

function placeHtml(project, row, names) {
  const place = row.place || {};
  const floor = place.floorId ? project.building.floors.find((each) => each.id === place.floorId) : null;
  const onFloor = place.kind !== 'connection' && names.get(place.name) > 1 && floor && floor.name !== place.name;
  return partsHtml(row.parts || [{ text: row.name || '', name: true }]) + (onFloor ? ' on <span dir="auto">' + esc(floor.name) + '</span>' : '');
}

function busiestHtml(project, side, names) {
  if (!side) return 'nobody walks';
  return side.load + ' ' + unitWord(side.unit, side.load) + ', ' + placeHtml(project, side, names);
}

function figuresTable(project, compare, names) {
  const f = compare.figures;
  const time = (n) => esc(seconds(n));
  const row = (label, side, words) => '<tr><th scope="row">' + esc(label) + '</th>'
    + '<td class="is-number">' + (words ? time(side.before) : side.before) + '</td><td class="is-number">' + (words ? time(side.after) : side.after) + '</td>'
    + changeCell(side.difference, words) + '</tr>';
  const out = ['<table class="doc-table doc-table--scenario">',
    '<thead><tr><th scope="col">Figure</th><th scope="col" class="is-number">Before</th><th scope="col" class="is-number">After</th><th scope="col" class="is-number">Difference</th></tr></thead>',
    '<tbody>',
    row('Walking, all walks together', f.walking, seconds),
    row('Lost to the crowd', f.crowding, seconds),
    '<tr><th scope="row">Busiest place</th><td>' + busiestHtml(project, f.busiest.before, names) + '</td><td>' + busiestHtml(project, f.busiest.after, names) + '</td>' + changeCell(f.busiest.difference, null) + '</tr>',
    row('Late walks', f.late, null),
    row('Walks with no way through', f.failed, null)];
  for (const severity of SEVERITIES) out.push(row(SEVERITY_ROWS[severity], f.findings[severity], null));
  out.push('</tbody></table>');
  return out.join('\n');
}

const SEVERITY_ROWS = { problem: 'Problems', warning: 'Warnings', note: 'Notes' };
const SEVERITY_WORDS = { problem: 'Problem', warning: 'Warning', note: 'Note' };

function findingsTable(project, heading, findings, none) {
  const out = ['<h3>' + esc(heading) + ' <span class="doc-count">' + findings.length + '</span></h3>'];
  if (findings.length === 0) {
    out.push('<p class="doc-none">' + esc(none) + '</p>');
    return out.join('\n');
  }
  out.push('<table class="doc-table doc-table--findings doc-table--scenario-findings">',
    '<thead><tr><th scope="col">Severity</th><th scope="col">Finding</th></tr></thead><tbody>');
  for (const finding of sortFindings(findings, project)) {
    out.push('<tr><th scope="row"><span class="mark mark--' + esc(finding.severity) + '">' + esc(SEVERITY_WORDS[finding.severity] || finding.severity) + '</span></th><td>' + esc(finding.text) + '</td></tr>');
  }
  out.push('</tbody></table>');
  return out.join('\n');
}

function placeChanges(project, heading, rows, way, unit, names, none) {
  const out = ['<h3>' + esc(heading) + '</h3>'];
  if (rows.length === 0) {
    out.push('<p class="doc-none">' + esc(none) + '</p>');
    return out.join('\n');
  }
  const days = ownDayTypes(project).length > 1;
  out.push('<table class="doc-table doc-table--scenario-places">',
    '<thead><tr><th scope="col">Place</th>' + (days ? '<th scope="col">Day type</th>' : '') + '<th scope="col" class="is-number">Before</th><th scope="col" class="is-number">After</th><th scope="col" class="is-number">Change</th></tr></thead><tbody>');
  for (const row of rows) {
    const day = findDayType(project, row.dayTypeId);
    out.push('<tr><th scope="row">' + placeHtml(project, row, names) + '</th>'
      + (days ? '<td>' + (day ? '<span dir="auto">' + esc(day.name) + '</span>' : '') + '</td>' : '')
      + '<td class="is-number">' + row.before + '</td><td class="is-number">' + row.after + '</td>'
      + '<td class="is-number doc-change ' + (way === 'busier' ? 'is-more' : 'is-less') + '">' + esc(signed(row.difference, null) + ' ' + way) + '</td></tr>');
  }
  out.push('</tbody></table>');
  out.push('<p class="doc-meaning">' + esc('Loads are ' + unitWord(unit, 2) + ' at the place\'s busiest moment of the day.') + '</p>');
  return out.join('\n');
}

export function scenarioSection(project, comparison) {
  const scenario = project.scenario;
  if (!scenario) return '';
  const name = scenarioName(scenario);
  const called = 'the scenario <span dir="auto">' + esc(name) + '</span>';
  // a sentence alone follows the day sections; the comparison starts a sheet of its own
  const out = ['<section class="doc-section doc-scenario">', '<h2>The scenario: <span dir="auto">' + esc(name) + '</span></h2>'];
  const close = () => {
    out.push('</section>');
    return out.join('\n');
  };
  const say = (text) => out.push('<p class="doc-none">' + text + '</p>');

  if (comparison === undefined) {
    say('Every figure above was worked out for the schedule as it stands. What ' + called + ' would change is still being worked out.');
    return close();
  }
  if (comparison === null) {
    say('What ' + called + ' would change could not be worked out for this report, so nothing of it is printed. Close the report and open it again to try once more.');
    return close();
  }
  if (comparison instanceof Error || typeof comparison.failed === 'string') {
    const message = comparison instanceof Error ? comparison.message : comparison.failed;
    say('What ' + called + ' would change could not be worked out: <span dir="auto">' + esc(message) + '</span>' + (/[.!?]$/.test(message) ? '' : '.') + ' Nothing of it is printed.');
    return close();
  }
  const view = reconcile(project, scenario);
  if (!current(comparison, view.changes) || !comparison.compare) {
    say('The scenario has changed since its effect was worked out, so nothing of it is printed. Close the report and open it again for its figures.');
    return close();
  }
  out[0] = '<section class="doc-section doc-scenario new-sheet">';
  const compare = comparison.compare;
  const result = comparison.result || {};
  const names = new Map();
  for (const place of result.places && Array.isArray(result.places.places) ? result.places.places : []) {
    if (place.kind !== 'connection') names.set(place.name, (names.get(place.name) || 0) + 1);
  }
  const loadsOf = Array.isArray(result.loads) ? result.loads.filter(Boolean) : [];
  const unit = loadsOf.length > 0 ? loadsOf[0].unit : 'students';

  out.push('<p class="doc-lead">' + 'What ' + called + esc(' would change, worked out against the schedule as it stands. The figures above are the schedule\'s own; nothing here has been applied.') + '</p>');
  if (scenario.compared && typeof scenario.compared === 'object') {
    const file = typeof scenario.compared.fileName === 'string' && scenario.compared.fileName !== '' ? '<span dir="auto">' + esc(scenario.compared.fileName) + '</span>' : 'another project file';
    const added = Array.isArray(scenario.compared.addedGroups) ? scenario.compared.addedGroups : [];
    const removed = Array.isArray(scenario.compared.removedGroups) ? scenario.compared.removedGroups : [];
    out.push('<p class="doc-meaning">It is this project compared with ' + file + '.'
      + (added.length > 0 ? ' Only in that file: ' + added.map((each) => '<span dir="auto">' + esc(each) + '</span>').join(', ') + '.' : '')
      + (removed.length > 0 ? ' Only in this project: ' + removed.map((each) => '<span dir="auto">' + esc(each) + '</span>').join(', ') + '.' : '') + '</p>');
  }

  // its changes, in the words of the lab's chips
  out.push('<h3>Its changes <span class="doc-count">' + view.changes.length + '</span></h3>');
  if (view.changes.length === 0) out.push('<p class="doc-none">No change of it applies to the schedule as it stands.</p>');
  else out.push('<table class="doc-table doc-table--changes"><tbody>' + view.changes.map((change, i) => '<tr><th scope="row" class="is-number">' + (i + 1) + '</th><td>' + partsHtml(changeWords(project, change).parts) + '</td></tr>').join('') + '</tbody></table>');
  if (view.dropped.length > 0) {
    out.push('<p class="doc-meaning">' + esc(count(view.dropped.length, 'change') + (view.dropped.length === 1 ? ' no longer applies' : ' no longer apply') + ' and ' + (view.dropped.length === 1 ? 'is' : 'are') + ' left out:') + '</p>');
    for (const each of view.dropped) out.push('<p class="doc-dropped">' + partsHtml(each.parts) + '</p>');
  }

  // the figures
  out.push('<h3>Before and after</h3>');
  out.push('<p class="doc-meaning">' + esc('Every own day type together. Before is the schedule as it stands, after is with the changes above. A + is more and a − is less; for every figure here, less is better.') + '</p>');
  out.push(figuresTable(project, compare, names));

  // the findings
  const found = compare.findings;
  out.push(findingsTable(project, 'New findings', found.new, 'It brings no new finding.'));
  out.push(findingsTable(project, 'Resolved findings', found.resolved, 'It resolves no finding.'));
  out.push('<p class="doc-meaning">' + esc(count(found.unchanged.length, 'finding') + (found.unchanged.length === 1 ? ' stays as it is.' : ' stay as they are.')) + '</p>');

  // the places
  const places = compare.places;
  out.push(placeChanges(project, 'Places that get busier', places.busier.slice(0, SCENARIO_PLACES), 'busier', unit, names, 'No place gets busier.'));
  out.push(placeChanges(project, 'Places that get quieter', places.quieter.slice(0, SCENARIO_PLACES), 'quieter', unit, names, 'No place gets quieter.'));
  return close();
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
  // the scenario is the one open now, in the project given: the same
  // whether the day sections are the movement view's or worked out here
  body.push(scenarioSection(given, derived && 'scenario' in derived ? derived.scenario : undefined));
  return frame(project, { output: id, what: name, pages: [{ body: body.filter((part) => part !== '').join('\n') }], options: opts });
}
