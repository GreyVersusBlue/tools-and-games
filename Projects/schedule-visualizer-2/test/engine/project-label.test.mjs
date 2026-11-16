// The project's label (ARCHITECTURE 21.5, SV2-113): node test/engine/project-label.test.mjs
//
// The name a project goes by when several are kept, apart from the school's
// name. The action, validate and repair, with names as typed. Every case runs
// on the sample school and the store's clock is pinned.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { PROJECT_LABEL_MOST } from '../../engine/scenario.js';
import { openProjectName } from '../../ui/project/clear.js';
import { sampleSchool } from '../../data/sample-school.js';
import { school, clock, makeIds, assertValid } from './helpers.mjs';

const { setProjectLabel, ActionError } = actions;
const refusedWith = (code) => (error) => error instanceof ActionError && error.code === code;

function storeOf(project) {
  return createStore({ project: project || school(), clock, ids: makeIds(5) });
}

const HOSTILE = '<b>"This" year</b> ‮ 来年 😀 & \'q\'';

test('setProjectLabel: the label as typed but for the spaces round it; one undo step with its label; no counter moves', () => {
  const store = storeOf();
  const before = store.project;
  assert.equal('label' in before, false, 'a project starts with no label');
  store.apply(setProjectLabel, { label: '  Next year’s proposal  ' });
  assert.equal(store.project.label, 'Next year’s proposal');
  assert.equal(store.undoLabel, 'Set the project label to Next year’s proposal');
  assert.deepEqual(setProjectLabel.bumps, []);
  assert.equal(store.project.groups, before.groups, 'the schedule is the very same object');
  assert.equal(store.project.building, before.building);
  assertValid(store.project);
  store.undo();
  assert.equal('label' in store.project, false);
  store.redo();
  assert.equal(store.project.label, 'Next year’s proposal');
});

test('setProjectLabel: a name of any characters is stored exactly as typed, inner spaces included, and shown as text', () => {
  const store = storeOf();
  store.apply(setProjectLabel, { label: HOSTILE });
  assert.equal(store.project.label, HOSTILE);
  assert.equal(store.undoLabel, 'Set the project label to ' + HOSTILE);
  store.apply(setProjectLabel, { label: 'A    B\tC' });
  assert.equal(store.project.label, 'A    B\tC');
  assertValid(store.project);
});

test('setProjectLabel: blank (white space and zero-width characters only) takes the label away; the same label, or none when none is set, is no step', () => {
  const store = storeOf();
  store.apply(setProjectLabel, { label: 'This year' });
  store.apply(setProjectLabel, { label: '​ ⁠﻿\t' });
  assert.equal('label' in store.project, false, 'no label at all, not an empty one');
  assert.equal(store.undoLabel, 'Clear the project label');
  const steps = store.undoDepth;
  store.apply(setProjectLabel, { label: '   ' });
  assert.equal(store.undoDepth, steps, 'nothing to clear');
  store.apply(setProjectLabel, { label: 'This year' });
  const again = store.undoDepth;
  store.apply(setProjectLabel, { label: ' This year ' });
  assert.equal(store.undoDepth, again, 'the same label, once trimmed');
});

test('setProjectLabel: at most 60 characters after trimming, counted by character; longer is refused too-long with how long it was; not text is refused bad-value', () => {
  assert.equal(PROJECT_LABEL_MOST, 60);
  const store = storeOf();
  store.apply(setProjectLabel, { label: 'x'.repeat(60) });
  assert.equal(store.project.label.length, 60);
  store.apply(setProjectLabel, { label: '  ' + 'y'.repeat(60) + '   ' });
  assert.equal(store.project.label, 'y'.repeat(60), 'spaces round it do not count');
  const smiles = '😀'.repeat(60);
  store.apply(setProjectLabel, { label: smiles });
  assert.equal(Array.from(store.project.label).length, 60, '60 characters that are 120 UTF-16 units');
  assertValid(store.project);
  const held = store.project;
  assert.throws(() => store.apply(setProjectLabel, { label: 'x'.repeat(61) }), (error) => refusedWith('too-long')(error) && error.message === 'A label is at most 60 characters. This one is 61. Shorten it and try again.');
  assert.throws(() => store.apply(setProjectLabel, { label: smiles + '😀' }), refusedWith('too-long'));
  for (const bad of [7, null, undefined, ['a'], {}]) assert.throws(() => store.apply(setProjectLabel, { label: bad }), refusedWith('bad-value'));
  assert.throws(() => store.apply(setProjectLabel, null), refusedWith('bad-value'));
  assert.equal(store.project, held, 'a refusal changes nothing');
});

test('validate: label is absent or text of at most 60 characters once trimmed; names are not otherwise checked', () => {
  const project = school();
  assertValid({ ...project, label: 'This year' });
  assertValid({ ...project, label: '' }, 'an empty label reads as none');
  assertValid({ ...project, label: HOSTILE });
  assertValid({ ...project, label: '  ' + 'x'.repeat(60) + '  ' }, 'trimmed first');
  assert.deepEqual(validate({ ...project, label: 'x'.repeat(61) }).map((finding) => finding.path), ['label']);
  assert.deepEqual(validate({ ...project, label: ' ' + 'x'.repeat(61) }).map((finding) => finding.path), ['label']);
  for (const bad of [5, null, ['a'], {}, true]) assert.deepEqual(validate({ ...project, label: bad }).map((finding) => finding.path), ['label'], JSON.stringify(bad));
});

test('repair: a label that is fine is left as it is and the project is the same object; not text is removed with a note; too long is cut with a note; the sample has none', () => {
  const sample = sampleSchool();
  assert.equal(repair(sample).project, sample);
  const labelled = { ...school(), label: 'This year' };
  const kept = repair(labelled);
  assert.equal(kept.project, labelled);
  assert.deepEqual(kept.notes, []);
  const spaced = { ...school(), label: '  ' + 'x'.repeat(60) + '  ' };
  assert.equal(repair(spaced).project, spaced, 'spaces round a label that fits are not a problem');

  const notText = repair({ ...school(), label: 42 });
  assert.equal('label' in notText.project, false);
  assert.deepEqual(notText.notes, ['The project label was not text and was removed.']);
  const long = repair({ ...school(), label: ' ' + 'ab'.repeat(40) + ' ' });
  assert.equal(long.project.label, 'ab'.repeat(30));
  assert.deepEqual(long.notes, ['The project label was longer than 60 characters and was cut.']);
  assertValid(long.project);
  const smiles = repair({ ...school(), label: '😀'.repeat(70) });
  assert.equal(Array.from(smiles.project.label).length, 60, 'cut by character, never through a pair');
  assertValid(smiles.project);
});

test('openProjectName: the label, else the school\'s name, else "Untitled project (started <date>)", with a typed name isolated and never interpreted', () => {
  const project = school();
  project.settings.schoolName = 'Harbour <b>View</b> School';
  assert.equal(openProjectName({ ...project, label: ' This year ' }), '⁨This year⁩');
  assert.equal(openProjectName(project), '⁨Harbour <b>View</b> School⁩');
  assert.equal(openProjectName({ ...project, label: '  ' }), '⁨Harbour <b>View</b> School⁩', 'a blank label shows the school name');
  const nameless = { ...project, label: '', settings: { ...project.settings, schoolName: ' ' }, created: '2026-11-04T23:59:00.000Z' };
  const zone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(openProjectName(nameless), 'Untitled project (started 4 November 2026)');
    process.env.TZ = 'Pacific/Auckland';
    assert.equal(openProjectName(nameless), 'Untitled project (started 5 November 2026)', 'the date is the reader\'s own day, as the rest of the planner words a date');
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  assert.equal(openProjectName({ ...nameless, created: 'x' }), 'Untitled project');
  assert.equal(openProjectName({ ...project, label: '‮<i>' }), '⁨<i>⁩', 'a right-to-left override is taken out of the name');
  const BIDI = ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'];
  assert.equal(openProjectName({ ...project, label: BIDI.join('A') + ' ⁩Year<b>' }), '\u2068AAAAAAAA Year<b>\u2069', 'every control, an isolate that would close ours early too, and the rest as typed');
  assert.equal(openProjectName({ ...project, label: BIDI.join('') }), '⁨Harbour <b>View</b> School⁩', 'a label of controls only is blank');
  assert.equal(openProjectName({ ...nameless, settings: { ...project.settings, schoolName: '‮⁩' } }).startsWith('Untitled project'), true, 'so is a school name of them');
  assert.equal(openProjectName({ ...project, label: '', settings: { ...project.settings, schoolName: 'S‮chool' } }), '⁨School⁩');
});
