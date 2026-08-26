// Reading a sentence into a brief. The suite is mostly about the two things
// that keep this honest: a number only counts what it is touching, and every
// word the parser didn't act on comes back in `ignored`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBrief, numbersIn, roomWordsIn, adjacencyIn } from '../js/brief.js';
import { DEFAULT_BRIEF, MIN_STUDENTS, MAX_STUDENTS, normalizeBrief } from '../js/program.js';

const parse = (s) => parseBrief(s);

test('digits and number words both read', () => {
  assert.deepEqual(numbersIn('600 students').map((n) => n.n), [600]);
  assert.deepEqual(numbersIn('six hundred students').map((n) => n.n), [600]);
  assert.deepEqual(numbersIn('twelve hundred kids').map((n) => n.n), [1200]);
  assert.deepEqual(numbersIn('thirty two').map((n) => n.n), [32]);
  assert.deepEqual(numbersIn('1,450 pupils').map((n) => n.n), [1450]);
});

test('a number reads what it is next to, on either side', () => {
  assert.equal(parse('600 students').brief.students, 600);
  assert.equal(parse('enrollment of 900').brief.students, 900);
  assert.equal(parse('capacity is about 750').brief.students, 750);
  assert.equal(parse('three storeys').brief.storeys, 3);
  assert.equal(parse('seed 42').brief.seed, 42);
});

test('a number four words away from a keyword does not read as it', () => {
  // The bug this rule exists for: "600 students on two storeys" read the two
  // as a second enrollment, because "students" was still inside the window.
  const r = parse('a middle school for 600 students on two storeys');
  assert.equal(r.brief.students, 600);
  assert.equal(r.brief.storeys, 2);
  assert.equal(r.matched.filter((m) => m.field === 'students').length, 1);
});

test('a noun counts one number', () => {
  // "600 students, 3 levels" used to read the 3 as a second enrollment: the
  // word "students" was still inside the backward window and a comma passes
  // as a joiner, so the brief came back as 30 students on 2 storeys and the
  // echo said "600 students, 30 students".
  for (const text of [
    '600 students, 3 levels',
    'a school for 600 students over 3 floors',
    '600 students and 3 storeys',
  ]) {
    const r = parse(text);
    assert.equal(r.brief.students, 600, text);
    assert.equal(r.brief.storeys, 3, text);
    assert.equal(r.matched.filter((m) => m.field === 'students').length, 1, text);
  }
});

test('a bare plausible number is read as enrollment, and said to be', () => {
  const r = parse('elementary for 350');
  assert.equal(r.brief.students, 350);
  assert.ok(r.matched.some((m) => /read as enrollment/.test(m.phrase)));
});

test('every grade band reads, with junior high above high', () => {
  assert.equal(parse('a junior high').brief.band, 'middle');
  assert.equal(parse('a middle school').brief.band, 'middle');
  assert.equal(parse('a high school').brief.band, 'high');
  assert.equal(parse('secondary school').brief.band, 'high');
  assert.equal(parse('an elementary school').brief.band, 'elementary');
  assert.equal(parse('a primary school').brief.band, 'elementary');
  assert.equal(parse('grades 9-12').brief.band, 'high');
});

test('storeys read as words as well as numbers', () => {
  assert.equal(parse('a single-storey school').brief.storeys, 1);
  assert.equal(parse('two-storey').brief.storeys, 2);
  assert.equal(parse('on three levels').brief.storeys, 3);
  assert.equal(parse('all on one floor').brief.storeys, 1);
});

test('a negative reads before its positive', () => {
  assert.equal(parse('with a gym').brief.gym, true);
  assert.equal(parse('no gym').brief.gym, false);
  assert.equal(parse('a school with no cafeteria but a library').brief.cafeteria, false);
  assert.equal(parse('a school with no cafeteria but a library').brief.library, true);
  assert.equal(parse('building only, no site').brief.site, false);
});

test('what it did not understand comes back', () => {
  // "campus" used to be one of the words in this sentence, and used to be
  // ignored. Phase 17 gave it a scheme to mean, which is exactly what this
  // table is for and exactly why the sentence had to change.
  const r = parse('a warm, community-facing place that feels welcoming');
  assert.equal(r.matched.length, 0);
  assert.equal(r.echo, 'nothing recognised');
  for (const word of ['warm', 'community-facing', 'place', 'feels']) {
    assert.ok(r.ignored.includes(word), `${word} should have been reported as ignored`);
  }
  // ...and the brief is untouched, rather than half-guessed.
  assert.deepEqual(r.brief, parseBrief('').brief);
});

test('a campus is a scheme now, and it outranks the court in it', () => {
  assert.equal(parse('a campus for 800 middle schoolers').brief.scheme, 'campus');
  assert.equal(parse('teaching pavilions round a quadrangle').brief.scheme, 'campus');
  // ...but a quadrangle on its own is still the courtyard scheme.
  assert.equal(parse('a school round a quadrangle').brief.scheme, 'courtyard');
});

test('words it did act on are not reported as ignored', () => {
  const r = parse('a middle school for 600 students on two storeys');
  for (const word of ['students', 'storeys', 'middle', 'two', '600']) {
    assert.ok(!r.ignored.includes(word), `${word} was acted on and still reported ignored`);
  }
});

test('the echo names every field that moved, and only those', () => {
  const r = parse('high school, twelve hundred kids, no gym, seed 7');
  assert.match(r.echo, /1200 students/);
  assert.match(r.echo, /high school/);
  assert.match(r.echo, /without a gym/);
  assert.match(r.echo, /seed 7/);
  assert.ok(!/cafeteria/.test(r.echo), 'a field nobody mentioned should not be echoed');
});

test('out-of-range numbers clamp rather than break the parse', () => {
  assert.equal(parse('a school for 90000 students').brief.students, MAX_STUDENTS);
  assert.equal(parse('a school for 3 students').brief.students, MIN_STUDENTS);
  assert.equal(parse('nine storeys').brief.storeys, 4);
});

test('an empty or hostile input is the default brief', () => {
  for (const input of ['', null, undefined, '   ', '!!!', { nope: true }]) {
    const r = parseBrief(input);
    assert.deepEqual(r.brief, { ...DEFAULT_BRIEF });
    assert.equal(r.matched.length, 0);
  }
});

test('a base brief is the starting point, not a blank one', () => {
  const base = { students: 300, band: 'elementary', storeys: 1, seed: 9, gym: false,
    cafeteria: true, library: true, site: true };
  const r = parseBrief('make it two storeys', base);
  assert.equal(r.brief.storeys, 2);
  assert.equal(r.brief.students, 300, 'an unmentioned field should keep its value');
  assert.equal(r.brief.gym, false);
});

test('the same sentence always parses the same way', () => {
  const s = 'a two-storey middle school for 640 students with a library, seed 3';
  assert.deepEqual(parseBrief(s), parseBrief(s));
});


test('a sentence can name the scheme, and says so when it did', () => {
  const court = parseBrief('a two-storey courtyard school for 600');
  assert.equal(court.brief.scheme, 'courtyard');
  assert.match(court.echo, /courtyard plan/);
  assert.equal(parseBrief('a compact deep-plan middle school').brief.scheme, 'compact');
  assert.equal(parseBrief('a high school with three classroom wings').brief.scheme, 'spine');
  // The shape of the plan is the noun: "compact" in front of "courtyard" is
  // doing adjective duty and does not win the field.
  assert.equal(parseBrief('a compact courtyard school').brief.scheme, 'courtyard');
  // ...and a sentence that names no shape leaves whatever the sheet had.
  assert.equal(parseBrief('a middle school for 600').brief.scheme, 'spine');
  assert.equal(parseBrief('a middle school for 600', { scheme: 'compact' }).brief.scheme, 'compact');
});


test('two rooms and a relation come back as a rule', () => {
  const r = parseBrief('a middle school for 600 with the band room away from the library');
  assert.deepEqual(r.brief.adjacency, [{ a: 'music', b: 'library', want: 'apart' }]);
  assert.match(r.echo, /music away from library/);
  // The whole phrase counts as understood, so "band room" is not reported as
  // a word that was ignored.
  assert.ok(!r.ignored.includes('band'));
  assert.ok(!r.ignored.includes('library'));
});

test('both relations read, and more than one rule per sentence', () => {
  const r = parseBrief('put the gym next to the cafeteria and keep the science labs away from the music rooms');
  assert.equal(r.brief.adjacency.length, 2);
  assert.ok(r.brief.adjacency.some((x) => x.a === 'gym' && x.b === 'cafeteria' && x.want === 'near'));
  assert.ok(r.brief.adjacency.some((x) => x.want === 'apart' && x.a === 'science' && x.b === 'music'));
});

test('the longer room word wins the overlap it is inside', () => {
  const words = roomWordsIn('the science lab next to the computer lab');
  assert.deepEqual(words.map((w) => w.key), ['science', 'computer']);
});

test('a relation with nothing on one side of it is not a rule', () => {
  assert.deepEqual(parseBrief('a school away from the road').brief.adjacency, []);
  assert.deepEqual(parseBrief('the library next to the library').brief.adjacency, []);
  // ...and neither is one whose rooms are half a sentence apart.
  assert.deepEqual(
    adjacencyIn('the band room, which every school argues about, away from the library').rules,
    []);
});

test('a rule naming a room the schedule cannot make is dropped', () => {
  assert.deepEqual(normalizeBrief({ adjacency: [{ a: 'planetarium', b: 'library', want: 'apart' }] }).adjacency, []);
  assert.deepEqual(normalizeBrief({ adjacency: [{ a: 'music', b: 'music', want: 'apart' }] }).adjacency, []);
  assert.deepEqual(normalizeBrief({ adjacency: [{ a: 'music', b: 'library', want: 'beside' }] }).adjacency, []);
  assert.deepEqual(normalizeBrief({ adjacency: 'nonsense' }).adjacency, []);
  assert.equal(normalizeBrief({}).adjacency.length, 0);
});
