// The congestion report's scenario section (spec 7.7, 9.3; SV2-71) in plain
// Node: what ui/prints/congestion.js prints for an open scenario before its
// comparison comes, once it has come, when it failed or is stale, with a
// change that no longer applies, with hostile and non-Latin names, and that
// it is the same section whether the report is of the movement view's state
// or worked out here. The comparison is made the way the scenario lane makes
// it (ui/engine-client.js): scenarioRun on a pipeline of its own, then
// compareResults against the main result with the changes reconcile keeps.
//
//   node test/engine/prints-congestion-scenario.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline, scenarioRun } from '../../engine/worker.js';
import { buildGraph } from '../../engine/graph.js';
import { trimResult, compareResults, reconcile, changeWords } from '../../engine/scenario.js';
import { esc } from '../../ui/prints/document.js';
import * as congestionPrint from '../../ui/prints/congestion.js';
import { school, group, room, PINNED } from './helpers.mjs';

const DAY_A = 'dsample00a';
const NOW = { now: PINNED };

// 7C out of the room it shares with 6C in Period 2 (into 204, which 7B has
// then), and 8A's Period 7 out of 303, so its long walk from the Gym goes.
function twoChanges() {
  return [
    { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' },
    { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample08a', period: 6, roomId: 'rsample101' },
  ];
}

function withScenario(project, name, changes) {
  project.scenario = { name, changes, compared: null };
  return project;
}

// The lane's answer for the project's open scenario, as the engine client gives it.
function comparisonOf(project) {
  const main = createPipeline().run(project);
  const result = scenarioRun(createPipeline(), project, undefined);
  const changes = reconcile(project, project.scenario).changes;
  return { result, compare: compareResults(trimResult(main), result, { changes }), changes, versions: null, where: 'main', generation: 1 };
}

function sectionOf(html) {
  const found = html.match(/<section class="doc-section doc-scenario[^"]*">[\s\S]*?<\/section>/g) || [];
  assert.ok(found.length <= 1, 'one scenario section at most');
  return found.length === 0 ? '' : found[0];
}

// What a reader sees: the tags gone, the escapes read back.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
function text(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]).replace(/\s+/g, ' ').trim();
}

// The rows of the table that follows a heading, cell texts.
function rowsAfter(html, heading) {
  const from = html.indexOf(heading);
  assert.notEqual(from, -1, 'no heading ' + heading);
  const start = html.indexOf('<tbody>', from);
  const end = html.indexOf('</tbody>', start);
  return html.slice(start, end).split('</tr>').filter((row) => row.includes('<tr>'))
    .map((row) => Array.from(row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)).map((cell) => text(cell[1])));
}

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

const sample = withScenario(school(), 'Ease the 2nd floor', twoChanges());
const answer = comparisonOf(sample);

test('no scenario open prints no section, whatever comparison is handed in', () => {
  const plain = school();
  assert.equal(congestionPrint.scenarioSection(plain, answer), '');
  assert.equal(congestionPrint.scenarioSection(plain, undefined), '');
  const { html } = congestionPrint.render(plain, { scenario: answer }, NOW);
  assert.equal(countOf(html, 'doc-scenario'), 0);
  assert.equal(countOf(html, 'cenario'), 0);
});

test('while the comparison is being worked out, or with nothing to work it out, the section says the report is of the schedule as it stands', () => {
  const sentence = '<p class="doc-none">Every figure above was worked out for the schedule as it stands. What the scenario <span dir="auto">Ease the 2nd floor</span> would change is still being worked out.</p>';
  // the preview with no answer yet hands no derived.scenario; with no engine it never does
  for (const derived of [null, undefined, {}, { results: null }]) {
    const section = sectionOf(congestionPrint.render(sample, derived, NOW).html);
    assert.ok(section.includes(sentence), 'pending with derived ' + JSON.stringify(derived));
    assert.equal(countOf(section, '<table'), 0, 'no figures while pending');
    // a sentence alone does not take a sheet of its own
    assert.equal(countOf(section, 'new-sheet'), 0);
  }
  assert.ok(congestionPrint.scenarioSection(sample, undefined).includes(sentence));
});

test('a comparison on the sample school with two changes prints the changes, the figures with their signs, the findings and the places both ways', () => {
  const section = congestionPrint.scenarioSection(sample, answer);
  assert.ok(section.startsWith('<section class="doc-section doc-scenario new-sheet">'), 'the comparison starts a sheet');
  assert.ok(section.includes('<h2>The scenario: <span dir="auto">Ease the 2nd floor</span></h2>'));

  // the changes, in the chips' words
  const changes = rowsAfter(section, 'Its changes');
  assert.deepEqual(changes.map((row) => row[0]), ['1', '2']);
  assert.deepEqual(changes.map((row) => row[1]), twoChanges().map((change) => changeWords(sample, change).text));
  assert.equal(changes[0][1], '7C · A Day · Period 2: 203 → 204, taught by Mme. Dufrêne instead of Ms. Vandermeer');
  assert.equal(countOf(section, 'no longer appl'), 0, 'nothing is dropped');

  // the figures: before, after and the difference with its sign
  const f = answer.compare.figures;
  assert.deepEqual([f.walking.difference, f.crowding.difference, f.late.difference, f.findings.warning.difference, f.busiest.difference], [-48, 23, -1, -1, 0],
    'the sample\'s figures moved: the expectations below are of the crowd model as it was');
  const figures = Object.fromEntries(rowsAfter(section, 'Before and after').map((row) => [row[0], row.slice(1)]));
  assert.deepEqual(figures['Walking, all walks together'], ['153 min 48 s', '153 min', '−48 s']);
  assert.deepEqual(figures['Lost to the crowd'], ['7 min 58 s', '8 min 21 s', '+23 s']);
  assert.deepEqual(figures['Busiest place'], ['177 students, Main Corridor, by Door B', '177 students, Main Corridor, by Door B', 'no change']);
  assert.deepEqual(figures['Late walks'], ['1', '0', '−1']);
  assert.deepEqual(figures['Walks with no way through'], ['0', '0', 'no change']);
  assert.deepEqual(figures.Problems, ['1', '1', 'no change']);
  assert.deepEqual(figures.Warnings, ['1', '0', '−1']);
  assert.deepEqual(figures.Notes, ['2', '2', 'no change']);
  // the direction is in the markup as a class beside the word, never colour alone
  assert.ok(section.includes('<td class="is-number doc-change is-less">−48 s</td>'));
  assert.ok(section.includes('<td class="is-number doc-change is-more">+23 s</td>'));

  // new and resolved findings
  const added = rowsAfter(section, 'New findings');
  assert.deepEqual(added, [['Problem', 'Room 204 has two groups in Period 2 on A Day: 7B and 7C. One of them needs another room or another period.']]);
  const resolved = rowsAfter(section, 'Resolved findings');
  assert.deepEqual(resolved.map((row) => row[0]), ['Problem', 'Warning']);
  assert.match(resolved[0][1], /^Room 203 has two groups in Period 2 on A Day: 6C and 7C\./);
  assert.match(resolved[1][1], /^8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day/);
  assert.ok(section.includes('2 findings stay as they are.'));

  // places busier and quieter, in words and signs
  const busier = rowsAfter(section, 'Places that get busier');
  assert.equal(busier.length, Math.min(congestionPrint.SCENARIO_PLACES, answer.compare.places.busier.length));
  assert.deepEqual(busier[0], ['Upper Corridor', 'A Day', '147', '175', '+28 busier']);
  assert.ok(busier.every((row) => /^\+\d+ busier$/.test(row[4])));
  // "East" is a place on two floors: the floor is said
  assert.ok(busier.some((row) => row[0] === 'East on Floor 2') && busier.some((row) => row[0] === 'East on Floor 3'));
  const quieter = rowsAfter(section, 'Places that get quieter');
  assert.deepEqual(quieter, [['Music Wing', 'A Day', '53', '25', '−28 quieter']]);
});

test('places are cut to SCENARIO_PLACES each way, biggest change first', () => {
  const rows = answer.compare.places.busier;
  const many = Array.from({ length: congestionPrint.SCENARIO_PLACES + 3 }, (unused, i) => ({ ...rows[i % rows.length], difference: 100 - i, after: rows[i % rows.length].before + 100 - i }));
  const wide = { ...answer, compare: { ...answer.compare, places: { ...answer.compare.places, busier: many } } };
  const busier = rowsAfter(congestionPrint.scenarioSection(sample, wide), 'Places that get busier');
  assert.equal(busier.length, congestionPrint.SCENARIO_PLACES);
  assert.deepEqual(busier.map((row) => row[4]), many.slice(0, congestionPrint.SCENARIO_PLACES).map((row) => '+' + row.difference + ' busier'));
  const none = { ...answer, compare: { ...answer.compare, places: { ...answer.compare.places, busier: [], quieter: [] } } };
  const section = congestionPrint.scenarioSection(sample, none);
  assert.ok(section.includes('<p class="doc-none">No place gets busier.</p>') && section.includes('<p class="doc-none">No place gets quieter.</p>'));
});

test('a change that no longer applies is left out of the figures and said in a line of its own', () => {
  const project = withScenario(school(), 'With a lost room', twoChanges().concat([{ kind: 'move', dayTypeId: DAY_A, groupId: 'gsample06a', period: 3, roomId: 'rgonegone00' }]));
  const comparison = comparisonOf(project);
  assert.equal(comparison.changes.length, 2);
  const section = congestionPrint.scenarioSection(project, comparison);
  assert.equal(rowsAfter(section, 'Its changes').length, 2);
  assert.ok(section.includes('<p class="doc-meaning">1 change no longer applies and is left out:</p>'));
  const dropped = section.match(/<p class="doc-dropped">([\s\S]*?)<\/p>/g) || [];
  assert.equal(dropped.length, 1);
  assert.equal(text(dropped[0]), reconcile(project, project.scenario).dropped[0].sentence);
  assert.match(text(dropped[0]), /the room it moves to is no longer in the building\.$/);
  // the figures are those of the two that apply
  assert.deepEqual(rowsAfter(section, 'Before and after'), rowsAfter(congestionPrint.scenarioSection(sample, answer), 'Before and after'));
});

test('a comparison that failed, or came back null, is said in a sentence and prints no figures', () => {
  const failed = congestionPrint.scenarioSection(sample, { failed: 'The worker stopped <b>' });
  assert.ok(failed.includes('<p class="doc-none">What the scenario <span dir="auto">Ease the 2nd floor</span> would change could not be worked out: <span dir="auto">The worker stopped &lt;b&gt;</span>. Nothing of it is printed.</p>'));
  const thrown = congestionPrint.scenarioSection(sample, new Error('Out of memory.'));
  assert.ok(thrown.includes('could not be worked out: <span dir="auto">Out of memory.</span> Nothing of it is printed.'));
  const nothing = congestionPrint.scenarioSection(sample, null);
  assert.ok(nothing.includes('<p class="doc-none">What the scenario <span dir="auto">Ease the 2nd floor</span> would change could not be worked out for this report, so nothing of it is printed. Close the report and open it again to try once more.</p>'));
  for (const section of [failed, thrown, nothing]) {
    assert.equal(countOf(section, '<table'), 0);
    assert.equal(countOf(section, 'new-sheet'), 0);
  }
});

test('a comparison worked out for other changes than the scenario has now is stale and never printed', () => {
  // the scenario changed after the comparison was made: a new change list, as every scenario action makes
  const moved = { ...sample, scenario: { ...sample.scenario, changes: twoChanges() } };
  const section = congestionPrint.scenarioSection(moved, answer);
  assert.ok(section.includes('<p class="doc-none">The scenario has changed since its effect was worked out, so nothing of it is printed. Close the report and open it again for its figures.</p>'));
  assert.equal(countOf(section, '<table'), 0);
  // one change fewer, the same objects otherwise
  const fewer = { ...sample, scenario: { ...sample.scenario, changes: sample.scenario.changes.slice(0, 1) } };
  assert.equal(countOf(congestionPrint.scenarioSection(fewer, answer), '<table'), 0);
  // an answer with no changes at all is not this scenario's either
  assert.equal(countOf(congestionPrint.scenarioSection(sample, { ...answer, changes: undefined }), '<table'), 0);
});

// What a person might type, for every name the section prints.
const HOSTILE = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onmouseover='x", '&amp;lt;', '</section><h1>'];
const NON_LATIN = ['七年三組', 'غرفة ٢٠٤', 'Ελληνικά', 'מעבדה'];
const TAGS = new Set(['section', 'h2', 'h3', 'p', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);

test('hostile and non-Latin names print as typed and never as markup', () => {
  const project = school();
  project.scenario = null;
  group(project, '7C').name = HOSTILE[0] + NON_LATIN[0];
  room(project, '204').number = NON_LATIN[1] + HOSTILE[1];
  for (const floor of project.building.floors) for (const corridor of floor.corridors) if (corridor.name === 'Upper Corridor') corridor.name = HOSTILE[4] + NON_LATIN[3];
  project.teachers.find((teacher) => teacher.name === 'Mme. Dufrêne').name = HOSTILE[2] + NON_LATIN[2];
  project.dayTypes[0].name = HOSTILE[3] + ' A';
  withScenario(project, HOSTILE[1] + NON_LATIN[2], twoChanges());
  const comparison = comparisonOf(project);
  const section = congestionPrint.scenarioSection(project, comparison);
  assert.ok(section.includes('<table'), 'the comparison printed');
  for (const raw of HOSTILE) assert.equal(countOf(section, raw), 0, 'as markup: ' + raw);
  for (const name of [project.scenario.name, group(project, HOSTILE[0] + NON_LATIN[0]).name, NON_LATIN[1] + HOSTILE[1], HOSTILE[4] + NON_LATIN[3], HOSTILE[2] + NON_LATIN[2]]) {
    assert.ok(section.includes('<span dir="auto">' + esc(name)), 'printed as typed, in its own direction: ' + name);
  }
  assert.ok(section.includes(esc(HOSTILE[3] + ' A')), 'the day type as typed');
  const stray = Array.from(section.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)).map((match) => match[1]).filter((tag) => !TAGS.has(tag));
  assert.deepEqual(stray, [], 'a tag the section does not make');
  assert.doesNotMatch(section.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, 'an event handler attribute');
  // a name that is all white space and zero-width characters reads as the planner's labels say it
  project.scenario = { ...project.scenario, name: ' ​﻿ ' };
  assert.ok(congestionPrint.scenarioSection(project, undefined).includes('What the scenario <span dir="auto">New scenario</span> would change'));
});

test('the section is the same from the movement view\'s state and from a bare render, for the same comparison', () => {
  // the movement view holds the project its answer was worked out for, which
  // may be from before the scenario was opened: the section is the project given's
  const before = school();
  const movement = { project: before, results: createPipeline().run(before), graph: buildGraph(before) };
  const fromMovement = congestionPrint.render(sample, { scenario: answer }, { ...NOW, movement }).html;
  const bare = congestionPrint.render(sample, { scenario: answer }, NOW).html;
  const section = sectionOf(fromMovement);
  assert.ok(section.includes('<h3>Before and after</h3>'), 'the comparison is in it');
  assert.equal(section, sectionOf(bare));
  assert.equal(section, congestionPrint.scenarioSection(sample, answer));
  // pending, the same too
  assert.equal(sectionOf(congestionPrint.render(sample, null, { ...NOW, movement }).html), sectionOf(congestionPrint.render(sample, null, NOW).html));
  // and the day sections are still the movement view's: the report without its scenario section is the bare one's
  assert.equal(fromMovement.replace('\n' + section, ''), congestionPrint.render(before, null, { ...NOW, movement }).html);
});
