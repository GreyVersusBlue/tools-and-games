// The staff browser's parts that are plain functions: addresses, the storage
// guard, dates, what a piece of data is, the search, and the lookups; and the
// stylesheet's tokens against the planner's. The screens themselves are
// driven in Chromium by test/browser/staff-shell.mjs.
//
//   node test/publish/staff.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseHash, makeHash } from '../../staff/router.js';
import { openStorage, STORAGE_PREFIX, NOT_KEPT_SENTENCE } from '../../staff/storage.js';
import { dayText, momentText, isStale, isOlderThanSeen } from '../../staff/dates.js';
import { readPublished, NEWER_SENTENCE, DAMAGED_SENTENCE, NOT_OURS_SENTENCE, DATA_ELEMENT_ID, PREVIEW_READY, PREVIEW_DATA, PREVIEW_EVERY_MS, watchPreview, inlineData, siblingData } from '../../staff/source.js';
import { openSchool } from '../../staff/model.js';
import { DAY_TYPE_KEY, BELLS_KEY, DAY_ON_KEY, todayOf, todayDate, clockNow, readDayOn, keepDayOn, forgetDayOn, chosenDayType, chosenBells, dayOnDate, meetingPeriods } from '../../staff/clock.js';
import { ME_KEY, NOTES_KEY } from '../../staff/notes.js';
import { searchIndex, searchSchool, foldText, FIND_LIMIT } from '../../staff/find.js';
import { publishedModel } from '../../engine/publish-data.js';
import { lockPublished, unlockPublished } from '../../engine/publish-crypto.js';
import { teacherDay } from '../../engine/teacher-day.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { readTool, toolFile, partsOf } from './reader.mjs';

const clock = () => new Date('2026-09-01T12:00:00Z');
const model = (change) => {
  const project = sampleSchool();
  if (change) change(project);
  return publishedModel(project, { clock });
};
const names = (kind) => kind.items.map((item) => item.name);

// ---------------------------------------------------------------- a file from an earlier version

// test/publish/frozen/sv2-m4.html is a published file as the tool at sv2-m4
// made it (its first comment says how). Spec 18: it still opens. Here today's
// reader is handed what it holds; test/a11y/staff-axe.mjs opens it in Chromium.
test('a published file frozen from an earlier version reads in today\'s staff browser, behind the same passcode', async () => {
  const data = JSON.parse(partsOf(readTool('test/publish/frozen/sv2-m4.html')).data);
  const envelope = readPublished(data);
  assert.equal(envelope.kind, 'locked', 'the frozen file is read as a locked schedule, not refused');
  const opened = await unlockPublished(data, 'bulldogs2015');
  assert.ok(opened, 'the default passcode of that version opens it with today\'s key derivation');
  const read = readPublished(opened.model);
  assert.equal(read.kind, 'open', 'its schedule is read as today\'s format, not as an older or damaged one');
  const school = openSchool(read.model);
  assert.equal(school.name, 'Marrowby Middle School (sample)');
  assert.equal(school.teachers.length, sampleSchool().teachers.length);
  assert.equal(opened.model.publishedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(teacherDay(read.model, 'tsample007', 'dsample00a').length, read.model.settings.periods);
});

// The frozen file is only a file from an earlier version while nobody
// changes it. Its bytes are pinned here: an edit, a regeneration, a formatter
// or an editor's save fails this case. Regenerating it on purpose (from the
// commit its first comment names) means writing the new hash and size here
// and saying why in the commit. A checkout that writes CRLF reads as the
// same bytes (line endings are taken out, as baseline.mjs takes them out).
const FROZEN_SHA256 = 'fc0d6d0bc91c951553f00a86e53acacbe7d10f211838f4676324d2e34dd2c454';
const FROZEN_BYTES = 488642;

test('the frozen file is the file that was frozen, byte for byte', () => {
  const raw = readFileSync(toolFile('test/publish/frozen/sv2-m4.html'));
  const bytes = Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  assert.equal(bytes.length, FROZEN_BYTES, 'test/publish/frozen/sv2-m4.html is not the size it was frozen at');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FROZEN_SHA256, 'test/publish/frozen/sv2-m4.html is not the file that was frozen: it is never edited');
});

// ---------------------------------------------------------------- addresses

test('every address of ARCHITECTURE 8 reads into a view, an id and a query', () => {
  assert.deepEqual(parseHash('#/teacher/tsample001'), { view: 'teacher', id: 'tsample001', query: {} });
  assert.deepEqual(parseHash('#/group/gsample06a'), { view: 'group', id: 'gsample06a', query: {} });
  assert.deepEqual(parseHash('#/room/rsample101'), { view: 'room', id: 'rsample101', query: {} });
  assert.deepEqual(parseHash('#/map/fsample001'), { view: 'map', id: 'fsample001', query: {} });
  assert.deepEqual(parseHash('#/free'), { view: 'free', id: '', query: {} });
  assert.deepEqual(parseHash('#/now'), { view: 'now', id: '', query: {} });
  assert.deepEqual(parseHash('#/common?t=tsample001,tsample002'), { view: 'common', id: '', query: { t: 'tsample001,tsample002' } });
  assert.deepEqual(parseHash('#/coverage/tsample003'), { view: 'coverage', id: 'tsample003', query: {} });
  assert.deepEqual(parseHash('#/sub/tsample003'), { view: 'sub', id: 'tsample003', query: {} });
  assert.deepEqual(parseHash('#/directions?from=rsample101&to=rsample303'), { view: 'directions', id: '', query: { from: 'rsample101', to: 'rsample303' } });
  assert.deepEqual(parseHash('#/staffing'), { view: 'staffing', id: '', query: {} });
  assert.deepEqual(parseHash('#/me'), { view: 'me', id: '', query: {} });
});

test('an empty address is the search page, and a broken one never throws', () => {
  for (const empty of ['', '#', '#/', undefined, null]) assert.deepEqual(parseHash(empty), { view: 'search', id: '', query: {} }, String(empty));
  assert.deepEqual(parseHash('#/teacher/%E0%A4%A'), { view: 'teacher', id: '%E0%A4%A', query: {} });
  assert.deepEqual(parseHash('#/search?q=%zz&&=&x'), { view: 'search', id: '', query: { q: '%zz', '': '', x: '' } });
  assert.deepEqual(parseHash('#teacher/t1/extra/parts'), { view: 'teacher', id: 't1', query: {} });
});

test('an address made is the address read back, whatever was typed into it', () => {
  for (const q of ['hall', 'room 101', 'a&b=c', '50%', '#/?', 'Dufrêne', '東京', 'a+b', '</script>']) {
    const hash = makeHash('search', '', { q });
    assert.deepEqual(parseHash(hash), { view: 'search', id: '', query: { q } }, hash);
  }
  assert.equal(makeHash('teacher', 'tsample001'), '#/teacher/tsample001');
  assert.equal(makeHash('search', '', { q: '' }), '#/search');
  assert.equal(makeHash('common', '', { t: 'a,b' }), '#/common?t=a%2Cb');
  assert.deepEqual(parseHash(makeHash('common', '', { t: 'a,b' })).query, { t: 'a,b' });
  assert.deepEqual(parseHash(makeHash('room', 'r/1 ?')), { view: 'room', id: 'r/1 ?', query: {} });
});

// ---------------------------------------------------------------- the storage guard

function fakeBackend() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
  };
}

// Seven since SV2-81 (on purpose: dayOn, the reader's "Not right?" answer,
// and bells, chosen by hand beside day; ARCHITECTURE 17.9). The names are the
// ones the modules write with, so a renamed constant fails here too.
test('the seven keys are sv2staff:<school>:me, notes, day, key, seen, dayOn and bells', () => {
  assert.deepEqual([ME_KEY, NOTES_KEY, DAY_TYPE_KEY, DAY_ON_KEY, BELLS_KEY], ['me', 'notes', 'day', 'dayOn', 'bells']);
  const backend = fakeBackend();
  const store = openStorage('psample001', () => backend);
  for (const name of ['me', 'notes', 'day', 'key', 'seen', 'dayOn', 'bells']) store.set(name, name + '-value');
  assert.deepEqual(Array.from(backend.items.keys()), ['sv2staff:psample001:me', 'sv2staff:psample001:notes', 'sv2staff:psample001:day', 'sv2staff:psample001:key', 'sv2staff:psample001:seen', 'sv2staff:psample001:dayOn', 'sv2staff:psample001:bells']);
  assert.equal(STORAGE_PREFIX, 'sv2staff:');
  assert.equal(store.key('me'), 'sv2staff:psample001:me');
  assert.equal(store.get('me'), 'me-value');
  assert.equal(store.get('nothing'), null);
  assert.equal(store.kept, true);
  store.remove('me');
  assert.equal(store.get('me'), null);
  assert.equal(backend.items.has('sv2staff:psample001:me'), false);
});

test('one school\'s settings are not another\'s', () => {
  const backend = fakeBackend();
  openStorage('pschool00a', () => backend).set('me', 'tsample001');
  assert.equal(openStorage('pschool00b', () => backend).get('me'), null);
  assert.equal(openStorage('pschool00a', () => backend).get('me'), 'tsample001');
});

test('storage that refuses a write falls back to memory and says so once', () => {
  let told = 0;
  const backend = fakeBackend();
  backend.setItem = () => { throw new Error('QuotaExceededError'); };
  const store = openStorage('psample001', () => backend, () => { told += 1; });
  assert.equal(told, 0, 'nothing is said until something could not be kept');
  assert.equal(store.set('me', 'tsample001'), false);
  assert.equal(store.get('me'), 'tsample001', 'the value is there for as long as the page is open');
  store.set('day', 'dsample00a');
  store.set('me', 'tsample002');
  assert.equal(store.get('me'), 'tsample002');
  assert.equal(told, 1, 'said once');
  assert.equal(store.kept, false);
  store.remove('me');
  assert.equal(store.get('me'), null);
  assert.equal(NOT_KEPT_SENTENCE, 'This browser does not keep settings for files opened this way.');
});

test('storage that is absent, or that throws when asked for, falls back the same way', () => {
  for (const getBackend of [() => null, () => undefined, () => { throw new Error('SecurityError'); }, () => ({})]) {
    let told = 0;
    const store = openStorage('psample001', getBackend, () => { told += 1; });
    assert.equal(store.get('key'), null);
    store.set('key', 'abc');
    store.set('seen', 'x');
    assert.equal(store.get('key'), 'abc');
    assert.equal(told, 1);
    store.remove('key');
    assert.equal(store.get('key'), null);
  }
});

test('storage that takes a write and does not keep it is treated as refusing', () => {
  let told = 0;
  const backend = fakeBackend();
  backend.setItem = () => {};
  const store = openStorage('psample001', () => backend, () => { told += 1; });
  store.set('me', 'tsample001');
  assert.equal(store.get('me'), 'tsample001');
  assert.equal(told, 1);
});

test('storage that throws on reading gives nothing rather than an error', () => {
  const backend = fakeBackend();
  backend.getItem = () => { throw new Error('SecurityError'); };
  const store = openStorage('psample001', () => backend);
  assert.equal(store.get('me'), null);
});

// ---------------------------------------------------------------- dates

test('a publish date is the reader\'s own day, with the year when it is not this year', () => {
  const now = new Date('2026-10-08T09:00:00Z');
  assert.equal(dayText('2026-09-12T12:00:00.000Z', now, 'en-GB', 'UTC'), '12 September');
  assert.equal(dayText('2026-09-12T12:00:00.000Z', now, 'en-US', 'UTC'), 'September 12');
  assert.equal(dayText('2025-09-12T12:00:00.000Z', now, 'en-GB', 'UTC'), '12 September 2025');
  assert.equal(dayText('2026-09-12T12:00:00.000Z', undefined, 'en-GB', 'UTC'), '12 September 2026');
  // half past eleven at night in UTC is already the next day in Auckland, and still the 12th in Honolulu
  assert.equal(dayText('2026-09-12T23:30:00.000Z', now, 'en-GB', 'Pacific/Auckland'), '13 September');
  assert.equal(dayText('2026-09-12T23:30:00.000Z', now, 'en-GB', 'Pacific/Honolulu'), '12 September');
  assert.equal(dayText('not a date', now, 'en-GB', 'UTC'), 'an unknown date');
  assert.match(momentText('2026-09-01T12:00:00.000Z', 'en-GB', 'UTC'), /^1 September 2026(,| at) 12:00/);
  assert.equal(momentText(undefined), 'an unknown time');
});

test('a copy is stale after its date and not a moment before', () => {
  const data = model();
  assert.equal(data.staleAfter, '2026-10-31T12:00:00.000Z');
  assert.equal(isStale(data, new Date('2026-09-01T12:00:00Z')), false);
  assert.equal(isStale(data, new Date('2026-10-31T12:00:00.000Z')), false);
  assert.equal(isStale(data, new Date('2026-10-31T12:00:00.001Z')), true);
  assert.equal(isStale(data, new Date('2027-01-01T00:00:00Z')), true);
  assert.equal(isStale({ staleAfter: 'nonsense' }, new Date()), false);
});

test('a copy is older than one seen before only when that one was published later', () => {
  const data = model();
  assert.equal(isOlderThanSeen(data, '2026-09-20T07:00:00.000Z'), true);
  assert.equal(isOlderThanSeen(data, '2026-09-01T12:00:00.000Z'), false);
  assert.equal(isOlderThanSeen(data, '2026-08-01T12:00:00.000Z'), false);
  assert.equal(isOlderThanSeen(data, null), false);
  assert.equal(isOlderThanSeen(data, 'garbage'), false);
});

// ---------------------------------------------------------------- what a piece of data is

test('a published model reads as open, and a locked one as locked', async () => {
  const data = model();
  assert.deepEqual(readPublished(data), { kind: 'open', model: data });
  const envelope = await lockPublished(data, 'bulldogs2015', { random: seededRandom(1), iterations: 1000 });
  assert.deepEqual(readPublished(envelope), { kind: 'locked', envelope });
});

test('a newer format is refused with advice, for an open file and a locked one', async () => {
  assert.deepEqual(readPublished({ ...model(), version: 2 }), { kind: 'newer', message: NEWER_SENTENCE });
  const envelope = await lockPublished(model(), 'bulldogs2015', { random: seededRandom(1), iterations: 1000 });
  assert.deepEqual(readPublished({ ...envelope, version: 2 }), { kind: 'newer', message: NEWER_SENTENCE });
  assert.deepEqual(readPublished({ format: 'sv2-published', version: 99 }), { kind: 'newer', message: NEWER_SENTENCE });
  assert.match(NEWER_SENTENCE, /Ask the office for a new copy/);
});

test('anything else is damaged or not ours, in a sentence, and never thrown', async () => {
  for (const value of [null, undefined, 7, 'text', [], {}, { format: 'sv2-project', version: 1 }, { format: 'sv2-building', version: 1 }]) {
    assert.deepEqual(readPublished(value), { kind: 'damaged', message: NOT_OURS_SENTENCE }, JSON.stringify(value));
  }
  const breaks = [
    (m) => { m.version = 0; },
    (m) => { m.version = '1'; },
    (m) => { delete m.version; },
    (m) => { delete m.settings; },
    (m) => { m.settings.periods = 0; },
    (m) => { delete m.building; },
    (m) => { m.building.floors = {}; },
    (m) => { m.building.floors[0].cells = 5; },
    (m) => { delete m.building.connections; },
    (m) => { m.teachers = null; },
    (m) => { m.teachers[0] = 'Ms. Halloran'; },
    (m) => { delete m.groups[0].days; },
    (m) => { m.dayTypes = []; },
    (m) => { delete m.publish; },
    (m) => { m.publish.views = null; },
    (m) => { delete m.publishedAt; },
    (m) => { delete m.staleAfter; },
    (m) => { m.id = 5; },
  ];
  for (const [index, change] of breaks.entries()) {
    const data = JSON.parse(JSON.stringify(model()));
    change(data);
    assert.deepEqual(readPublished(data), { kind: 'damaged', message: DAMAGED_SENTENCE }, 'break ' + index);
  }
  const envelope = await lockPublished(model(), 'bulldogs2015', { random: seededRandom(1), iterations: 1000 });
  assert.equal(readPublished({ ...envelope, data: 'x' }).kind, 'damaged');
});

test('the names both sides of the preview use are the ones ARCHITECTURE 8 gives', () => {
  assert.equal(DATA_ELEMENT_ID, 'sv2-published');
  assert.equal(PREVIEW_READY, 'sv2-preview-ready');
  assert.equal(PREVIEW_DATA, 'sv2-published');
  assert.equal(PREVIEW_EVERY_MS, 500);
});

test('a hosted data file is not looked for yet', async () => {
  assert.deepEqual(await siblingData(), { found: false });
});

test('the data inside a page is read from its element, and a cut-short one is said to be broken', () => {
  const doc = (text) => ({ getElementById: (id) => (id === 'sv2-published' && text !== null ? { textContent: text } : null) });
  assert.deepEqual(inlineData(doc(null)), { found: false });
  assert.deepEqual(inlineData(doc('{"format":"sv2-published","name":"\\u003c/script>"}')), { found: true, value: { format: 'sv2-published', name: '</script>' } });
  assert.deepEqual(inlineData(doc('{"format":"sv2-publ')), { found: true, broken: true });
});

// A window as far as watchPreview uses one.
function fakeWindow(origin) {
  const listeners = [];
  const posted = [];
  const timers = [];
  const win = {
    location: { origin },
    parent: { postMessage: (message, target) => posted.push({ message, target }) },
    addEventListener: (type, fn) => listeners.push(fn),
    removeEventListener: (type, fn) => listeners.splice(listeners.indexOf(fn), 1),
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: (id) => { timers[id - 1] = null; },
  };
  return { win, posted, listeners, tick: () => timers.forEach((fn) => fn && fn()), send: (event) => listeners.slice().forEach((fn) => fn(event)) };
}

test('the preview frame says it is ready until it is answered, then goes on listening', () => {
  const frame = fakeWindow('http://127.0.0.1:8123');
  const got = [];
  const stop = watchPreview(frame.win, (data) => got.push(data));
  assert.deepEqual(frame.posted, [{ message: { type: 'sv2-preview-ready' }, target: 'http://127.0.0.1:8123' }]);
  frame.tick();
  frame.tick();
  assert.equal(frame.posted.length, 3, 'it asks again every half second');
  frame.send({ source: frame.win.parent, origin: 'http://127.0.0.1:8123', data: { type: 'sv2-published', data: { n: 1 } } });
  frame.tick();
  frame.tick();
  assert.equal(frame.posted.length, 3, 'once answered it stops asking');
  frame.send({ source: frame.win.parent, origin: 'http://127.0.0.1:8123', data: { type: 'sv2-published', data: { n: 2 } } });
  assert.deepEqual(got, [{ n: 1 }, { n: 2 }], 'and every later copy still arrives');
  stop();
  assert.equal(frame.listeners.length, 0);
});

test('the preview frame takes data only from its parent, only from its own origin, only of the right type', () => {
  const frame = fakeWindow('http://127.0.0.1:8123');
  const got = [];
  watchPreview(frame.win, (data) => got.push(data));
  const good = { source: frame.win.parent, origin: 'http://127.0.0.1:8123', data: { type: 'sv2-published', data: { n: 1 } } };
  frame.send({ ...good, source: {} });
  frame.send({ ...good, source: frame.win });
  frame.send({ ...good, origin: 'http://127.0.0.1:9999' });
  frame.send({ ...good, origin: 'null' });
  frame.send({ ...good, data: { type: 'sv2-preview-ready' } });
  frame.send({ ...good, data: null });
  frame.send({ ...good, data: 'sv2-published' });
  assert.deepEqual(got, [], 'a message from anywhere else is not data');
  frame.tick();
  assert.equal(frame.posted.length, 2, 'and does not count as an answer');
  frame.send(good);
  assert.deepEqual(got, [{ n: 1 }]);
});

test('a preview opened from a file on disk has the origin "null" on both sides and still works', () => {
  const frame = fakeWindow('null');
  const got = [];
  watchPreview(frame.win, (data) => got.push(data));
  assert.equal(frame.posted[0].target, '*', 'a page with no origin can only be addressed as anyone; the ready message carries nothing');
  frame.send({ source: frame.win.parent, origin: 'null', data: { type: 'sv2-published', data: { n: 1 } } });
  assert.deepEqual(got, [{ n: 1 }]);
});

// ---------------------------------------------------------------- the lookups

test('the school\'s lookups give the engine\'s own answers', () => {
  const data = model();
  const school = openSchool(data);
  assert.equal(school.name, 'Marrowby Middle School (sample)');
  assert.equal(school.teacher('tsample001').name, 'Ms. Halloran');
  assert.equal(school.teacher('tnobody000'), null);
  assert.equal(school.group('gsample06a').name, '6A');
  assert.equal(school.room('rsample101').number, '101');
  assert.equal(school.roomName(school.room('rsample101')), 'Room 101');
  assert.equal(school.roomName(school.room('rsamplegym')), 'Gym');
  assert.equal(school.floorOfRoom('rsample303').name, 'Floor 3');
  assert.equal(school.subject(null), null);
  assert.equal(school.rooms.length, 13);
  assert.equal(school.periodName(0), 'Period 1');
  assert.equal(school.time('14:05'), '2:05 PM');
  assert.deepEqual(school.teacherDay('tsample001', 'dsample00a'), teacherDay(data, 'tsample001', 'dsample00a'));
  assert.equal(school.bells('dsample00a').length, 8);
  assert.equal(school.groupDay('gsample06a', 'dsample00a').length, 8);
  assert.equal(school.ownDayTypes().length, 2);
  assert.equal(school.graph(), school.graph(), 'the walkable building is worked out once');
  const found = school.route('rsamplegym', 'rsample303');
  assert.equal(found.seconds, 259);
  assert.ok(school.directions(found).steps.length > 3);
});

test('a school with no name is called by the plain words, and a view left out is known', () => {
  const school = openSchool(model((project) => {
    project.settings.schoolName = '   ';
    project.publish.views.coverage = false;
  }));
  assert.equal(school.name, 'Staff schedule');
  assert.equal(school.has('coverage'), false);
  assert.equal(school.has('teacher'), true);
});

// ---------------------------------------------------------------- the search

const index = () => searchIndex(openSchool(model()));

test('one search finds teachers, groups and rooms together, grouped by kind', () => {
  const found = searchSchool(index(), '6');
  assert.deepEqual(names(found.groups), ['6A', '6B', '6C']);
  assert.equal(found.teachers.total, 0);
  assert.equal(found.rooms.total, 0);
  const library = searchSchool(index(), 'library');
  assert.deepEqual(names(library.teachers), ['Mr. Pennywhistle'], 'a teacher is found by subject and by room');
  assert.deepEqual(names(library.rooms), ['Library']);
  assert.equal(library.total, 2);
});

test('a teacher is found by part of the name, whatever the case or the accents', () => {
  assert.deepEqual(names(searchSchool(index(), 'hall').teachers), ['Ms. Halloran']);
  assert.deepEqual(names(searchSchool(index(), 'HALLORAN').teachers), ['Ms. Halloran']);
  assert.deepEqual(names(searchSchool(index(), 'dufrene').teachers), ['Mme. Dufrêne']);
  assert.deepEqual(names(searchSchool(index(), 'Dufrêne').teachers), ['Mme. Dufrêne']);
  assert.deepEqual(names(searchSchool(index(), 'o\'fenn').teachers), ['Ms. O\'Fennimore']);
  assert.equal(foldText('  Mme.   DUFRÊNE '), 'mme. dufrene');
});

test('a room is found by its number, and its teacher comes with it', () => {
  const found = searchSchool(index(), '101');
  assert.deepEqual(names(found.rooms), ['Room 101']);
  assert.deepEqual(names(found.teachers), ['Ms. Halloran']);
  assert.match(found.rooms.items[0].detail, /^Floor 1 · Ms\. Halloran · Mathematics$/);
  assert.match(found.teachers.items[0].detail, /^Mathematics · Room 101$/);
  assert.equal(found.rooms.items[0].id, 'rsample101');
});

test('a subject finds its teachers and its rooms, by name or by code', () => {
  const byName = searchSchool(index(), 'mathematics');
  assert.deepEqual(names(byName.teachers), ['Mr. Brightwater', 'Ms. Halloran']);
  assert.deepEqual(names(byName.rooms), ['Room 101', 'Room 102']);
  assert.deepEqual(names(searchSchool(index(), 'MATH').teachers), ['Mr. Brightwater', 'Ms. Halloran']);
});

test('every word typed has to match, in any order', () => {
  assert.deepEqual(names(searchSchool(index(), 'math 102').teachers), ['Mr. Brightwater']);
  assert.deepEqual(names(searchSchool(index(), '102 math').teachers), ['Mr. Brightwater']);
  assert.equal(searchSchool(index(), 'math gym').total, 0);
});

test('a name that starts with what was typed comes before one that only contains it', () => {
  const school = openSchool(model((project) => {
    project.teachers[0].name = 'Anders Lee';
    project.teachers[1].name = 'Lee Anders';
    project.teachers[2].name = 'Coleen Park';
  }));
  assert.deepEqual(names(searchSchool(searchIndex(school), 'lee').teachers), ['Lee Anders', 'Anders Lee', 'Coleen Park']);
});

test('room numbers sort as numbers', () => {
  const school = openSchool(model((project) => {
    const rooms = project.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room'));
    rooms[0].number = 'B10';
    rooms[1].number = 'B9';
    rooms[2].number = 'B100';
  }));
  assert.deepEqual(names(searchSchool(searchIndex(school), 'b').rooms).filter((name) => /^Room B/.test(name)), ['Room B9', 'Room B10', 'Room B100']);
});

test('nothing typed finds nothing, and so does something that is not there', () => {
  for (const empty of ['', '   ', null, undefined]) assert.equal(searchSchool(index(), empty).total, 0);
  const none = searchSchool(index(), 'zzzz');
  assert.equal(none.total, 0);
  assert.deepEqual(none.teachers.items, []);
  assert.equal(none.query, 'zzzz');
});

test('a hostile name is found and handed back exactly as typed', () => {
  const hostile = '<img src=x onerror=alert(1)> "O\'Brien" 東京';
  const school = openSchool(model((project) => { project.teachers[0].name = hostile; }));
  const found = searchSchool(searchIndex(school), '東京');
  assert.deepEqual(names(found.teachers), [hostile]);
  assert.deepEqual(names(searchSchool(searchIndex(school), '<img').teachers), [hostile]);
});

test('a long list is cut at 40 a kind, and the full count is kept', () => {
  const data = model();
  for (let n = 0; n < 60; n += 1) data.teachers.push({ id: 'textra' + String(n).padStart(4, '0'), name: 'Extra Teacher ' + n, subjectId: null, roomIds: [], notes: '' });
  const found = searchSchool(searchIndex(openSchool(data)), 'extra');
  assert.equal(FIND_LIMIT, 40);
  assert.equal(found.teachers.items.length, 40);
  assert.equal(found.teachers.total, 60);
  assert.equal(found.teachers.items[2].name, 'Extra Teacher 2');
});

// ---------------------------------------------------------------- the stylesheet

function tokens(css) {
  // { 'light --paper': '#f6f3ec', ... } for each block a token is set in
  const found = new Map();
  const blocks = [
    ['shared', /\n:root \{([^}]*)\}/],
    ['light', /\n:root,\n\[data-theme="light"\],\n\[data-theme="auto"\] \{([^}]*)\}/],
    ['dark', /\n\[data-theme="dark"\] \{([^}]*)\}/],
    ['dark-auto', /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\),\s*\[data-theme="auto"\] \{([^}]*)\}/],
  ];
  for (const [name, pattern] of blocks) {
    const match = pattern.exec(css);
    assert.ok(match, 'the ' + name + ' block');
    for (const line of match[1].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) found.set(name + ' ' + line[1], line[2].trim());
  }
  return found;
}

test('every token the staff stylesheet shares with the planner\'s has the planner\'s value', () => {
  const planner = tokens(readTool('ui/tokens.css'));
  const staff = tokens(readTool('staff/staff.css'));
  const own = ['--bar-height', '--rail-width', '--column', '--tap', '--stale-paper', '--note-paper', '--map-corridor'];
  let shared = 0;
  for (const [key, value] of staff) {
    const name = key.split(' ')[1];
    if (own.includes(name)) {
      assert.ok(!planner.has(key), name + ' is now a planner token too; use the planner\'s');
      continue;
    }
    assert.ok(planner.has(key), key + ' is not a planner token');
    assert.equal(value, planner.get(key), key);
    shared += 1;
  }
  assert.ok(shared > 90, 'expected the tokens of four blocks, compared ' + shared);
  for (const name of ['--paper', '--card', '--ink', '--ink-2', '--accent', '--accent-ink', '--line-strong', '--problem', '--warning', '--note']) {
    for (const block of ['light', 'dark', 'dark-auto']) assert.ok(staff.has(block + ' ' + name), block + ' ' + name);
  }
  assert.equal(staff.get('dark --stale-paper'), staff.get('dark-auto --stale-paper'));
  assert.equal(staff.get('dark --note-paper'), staff.get('dark-auto --note-paper'));
});

test('the stylesheet is laid out for a phone first, as DESIGN 7 says', () => {
  const css = readTool('staff/staff.css');
  assert.match(css, /--base-phone: 17px;/);
  assert.match(css, /\nhtml \{\n  font-size: var\(--base-phone\);/);
  assert.match(css, /--bar-height: 56px;/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /\.field__input \{[^}]*font-size: max\(16px, 1rem\);/);
  assert.match(css, /\.app\[data-typing="true"\] \.bar \{\n  display: none;/);
  assert.match(css, /\.map \{[^}]*touch-action: pan-y;/);
  assert.match(css, /\.gate \{[^}]*justify-content: safe center;/, 'a centred screen that can scroll needs `safe`');
  assert.ok(!/@import/.test(css));
  for (const match of css.matchAll(/url\(([^)]*)\)/g)) assert.match(match[1], /^\.\.\/fonts\/[a-z0-9-]+\.woff2$/, 'the stylesheet asks for ' + match[1]);
});

// ---------------------------------------------------------------- today (SV2-81)

// A school of A, B and C Day (C its own), an Early Release schedule on
// Wednesdays, and a calendar from Monday 31 August 2026, the rotation A, B, C
// on weekdays: Mon 31 Aug A, Tue 1 Sep B, Wed 2 Sep C (Early Release), Thu 3
// Sep A. Published on `published`.
function todaySchool(published, change) {
  const project = sampleSchool();
  const a = project.dayTypes[0];
  project.dayTypes.push({ id: 'dtoday000c', name: 'C Day', own: true, sameAs: null, short: '', bells: a.bells.map((bell) => ({ ...bell })) });
  for (const group of project.groups) group.days.dtoday000c = group.days[a.id].map((slot) => ({ ...slot }));
  project.bellSchedules = [{ id: 'btodayer00', name: 'Early Release', short: '', bells: a.bells.map((bell) => ({ ...bell })), off: [6, 7] }];
  project.calendar = {
    start: '2026-08-31',
    end: '2027-06-11',
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day: day < 5 ? 'rotation' : 'closed', bells: day === 2 ? 'btodayer00' : null })),
    rotation: [a.id, 'dsample00b', 'dtoday000c'],
    dates: [{ date: '2026-11-26', day: 'closed', bells: null, label: 'Thanksgiving' }],
    changedAt: null,
  };
  if (change) change(project);
  return openSchool(publishedModel(project, { clock: () => new Date(published || '2026-08-25T12:00:00Z') }));
}

// A page's ctx with the clock at a local moment (the zone is UTC: run.mjs
// sets it) and storage in memory.
function todayCtx(school, at, kept) {
  const backend = fakeBackend();
  const store = openStorage(school.data.id, () => backend);
  for (const [name, value] of Object.entries(kept || {})) store.set(name, value);
  return { school, store, now: () => new Date(at), backend };
}

const said = (today) => [today.date, today.calendar, today.school, today.dayType ? today.dayType.name : null, today.bellsId, today.by];

test('today by the calendar: a rotation day, a Wednesday\'s bells, no school, outside it, and a file with none', () => {
  const school = todaySchool();
  assert.deepEqual(said(todayOf(todayCtx(school, '2026-09-01T10:00:00Z'))), ['2026-09-01', 'known', true, 'B Day', null, 'calendar']);
  assert.deepEqual(said(todayOf(todayCtx(school, '2026-09-02T10:00:00Z'))), ['2026-09-02', 'known', true, 'C Day', 'btodayer00', 'calendar']);
  const closed = todayOf(todayCtx(school, '2026-11-26T10:00:00Z'));
  assert.deepEqual(said(closed), ['2026-11-26', 'known', false, null, null, 'calendar']);
  assert.equal(closed.label, 'Thanksgiving');
  assert.deepEqual(said(todayOf(todayCtx(school, '2027-07-01T10:00:00Z', { day: 'dsample00b' }))), ['2027-07-01', 'outside', true, 'B Day', null, 'hand']);
  const none = openSchool(publishedModel(sampleSchool(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  assert.deepEqual(said(todayOf(todayCtx(none, '2026-09-01T10:00:00Z'))), ['2026-09-01', 'none', true, 'A Day', null, null]);
  // where the calendar says, the hand choice is not what a page shows
  const ctx = todayCtx(school, '2026-09-02T10:00:00Z', { day: 'dsample00a', bells: 'btodayer00' });
  assert.equal(chosenDayType(ctx).name, 'C Day');
  assert.equal(chosenBells(ctx), 'btodayer00');
  const hand = todayCtx(school, '2027-07-01T10:00:00Z', { day: 'dsample00a', bells: 'btodayer00' });
  assert.equal(chosenDayType(hand).name, 'A Day');
  assert.equal(chosenBells(hand), 'btodayer00');
});

// An answer as the page keeps it: the date and the moment of the click.
const answered = (date, dayTypeId, at, bellsId, seenFile) => ({ date, dayTypeId, bellsId: bellsId || null, at: at || date + 'T10:00:00.000Z', ...(seenFile ? { seenFile } : {}) });

test('"Just today" holds for its date only; "follow" moves the rotation on from it', () => {
  const school = todaySchool();
  const just = todayCtx(school, '2026-09-01T10:00:00Z');
  keepDayOn(just, 'just', answered('2026-09-01', 'dtoday000c'));
  assert.deepEqual(said(todayOf(just)), ['2026-09-01', 'known', true, 'C Day', null, 'reader']);
  const nextDay = todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: just.store.get('dayOn') });
  assert.deepEqual(said(todayOf(nextDay)), ['2026-09-03', 'known', true, 'A Day', null, 'calendar'], 'the calendar\'s own day');

  const follow = todayCtx(school, '2026-09-01T10:00:00Z');
  keepDayOn(follow, 'follow', answered('2026-09-01', 'dtoday000c'));
  const after = todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: follow.store.get('dayOn') });
  const today = todayOf(after);
  assert.deepEqual(said(today), ['2026-09-03', 'known', true, 'B Day', null, 'follow'], 'C on the 1st, so A on the 2nd and B on the 3rd');
  assert.equal(today.since, '2026-09-01');
  // the Wednesday between keeps its bells: only the day was answered
  const wednesday = todayCtx(school, '2026-09-02T10:00:00Z', { dayOn: follow.store.get('dayOn') });
  assert.deepEqual(said(todayOf(wednesday)), ['2026-09-02', 'known', true, 'A Day', 'btodayer00', 'follow']);
});

test('dayOn holds two answers: "Just today" never removes a standing follow answer', () => {
  const school = todaySchool();
  const ctx = todayCtx(school, '2026-09-01T10:00:00Z');
  keepDayOn(ctx, 'follow', answered('2026-09-01', 'dtoday000c', '2026-09-01T10:00:00.000Z'));
  // the next day the reader says just that day is B
  const wednesday = todayCtx(school, '2026-09-02T10:00:00Z', { dayOn: ctx.store.get('dayOn') });
  keepDayOn(wednesday, 'just', answered('2026-09-02', 'dsample00b', '2026-09-02T10:00:00.000Z'));
  const kept = JSON.parse(wednesday.store.get('dayOn'));
  assert.deepEqual(Object.keys(kept).sort(), ['follow', 'just']);
  assert.equal(kept.follow.dayTypeId, 'dtoday000c');
  assert.equal(kept.just.dayTypeId, 'dsample00b');
  assert.deepEqual(said(todayOf(wednesday)), ['2026-09-02', 'known', true, 'B Day', null, 'reader'], 'the answer for today');
  // the day after, the follow answer from the 1st still holds: C, A, B
  const thursday = todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: wednesday.store.get('dayOn') });
  assert.deepEqual(said(todayOf(thursday)), ['2026-09-03', 'known', true, 'B Day', null, 'follow']);
  // the same day, the answer given last settles it, and the follow still holds for the days after
  const both = todayCtx(school, '2026-09-01T12:00:00Z');
  keepDayOn(both, 'follow', answered('2026-09-01', 'dtoday000c', '2026-09-01T10:00:00.000Z'));
  keepDayOn(both, 'just', answered('2026-09-01', 'dsample00a', '2026-09-01T11:00:00.000Z'));
  assert.equal(todayOf(both).dayType.name, 'A Day', 'just, given later');
  keepDayOn(both, 'follow', answered('2026-09-01', 'dtoday000c', '2026-09-01T11:30:00.000Z'));
  assert.equal(todayOf(both).dayType.name, 'C Day', 'follow, given later');
  assert.equal(JSON.parse(both.store.get('dayOn')).just.dayTypeId, 'dsample00a', 'and the other is still there');
  assert.deepEqual(said(todayOf(todayCtx(school, '2026-09-02T10:00:00Z', { dayOn: both.store.get('dayOn') }))), ['2026-09-02', 'known', true, 'A Day', 'btodayer00', 'follow']);
});

test('the one-answer shape dayOn had reads as whichever it was', () => {
  const school = todaySchool();
  const old = (follow) => JSON.stringify({ date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, follow });
  const just = readDayOn(todayCtx(school, '2026-09-01T10:00:00Z', { dayOn: old(false) }));
  assert.deepEqual(just, { just: { date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, at: null, seenFile: null }, follow: null });
  const follow = readDayOn(todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: old(true) }));
  // an answer from before the file was recorded takes the file open now as its own
  assert.deepEqual(follow, { just: null, follow: { date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, at: null, seenFile: school.data.publishedAt } });
  assert.equal(todayOf(todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: old(true) })).by, 'follow');
});

test('a follow answer is cleared by a file published after the one open when it was given, and by nothing else', () => {
  const FIRST = '2026-09-01T14:00:00.000Z';
  const answer = JSON.stringify({ just: null, follow: answered('2026-09-01', 'dtoday000c', '2026-09-01T15:00:00.000Z', null, FIRST) });
  // the same file, or an older one, again: kept
  const same = todayCtx(todaySchool(FIRST), '2026-09-03T10:00:00Z', { dayOn: answer });
  assert.equal(todayOf(same).by, 'follow');
  assert.equal(same.store.get('dayOn'), answer);
  assert.equal(todayOf(todayCtx(todaySchool('2026-09-01T09:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: answer })).by, 'follow');
  // the office republished at 18:00 the day the reader answered at 15:00: its calendar is the newer word
  const sameDay = todayCtx(todaySchool('2026-09-01T18:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: answer });
  assert.deepEqual(said(todayOf(sameDay)), ['2026-09-03', 'known', true, 'A Day', null, 'calendar']);
  assert.equal(sameDay.store.get('dayOn'), null, 'removed from the device');
  assert.equal(todayOf(todayCtx(todaySchool('2026-09-02T07:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: answer })).by, 'calendar');
  // an answer from before the file was recorded takes the file open when it is next read, and a later file clears it
  const dated = JSON.stringify({ date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, follow: true });
  const adopted = todayCtx(todaySchool('2026-09-01T20:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: dated });
  assert.equal(todayOf(adopted).by, 'follow');
  assert.equal(JSON.parse(adopted.store.get('dayOn')).follow.seenFile, '2026-09-01T20:00:00.000Z');
  assert.equal(todayOf(todayCtx(todaySchool('2026-09-02T07:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: adopted.store.get('dayOn') })).by, 'calendar');
  // the just answer stays when the follow answer goes: it only ever holds its own date
  const both = JSON.stringify({ just: answered('2026-09-03', 'dtoday000c', '2026-09-03T09:00:00.000Z'), follow: answered('2026-09-01', 'dtoday000c', '2026-09-01T15:00:00.000Z', null, FIRST) });
  const kept = todayCtx(todaySchool('2026-09-02T07:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: both });
  assert.equal(todayOf(kept).by, 'reader');
  assert.deepEqual(Object.keys(JSON.parse(kept.store.get('dayOn'))).sort(), ['follow', 'just']);
  assert.equal(JSON.parse(kept.store.get('dayOn')).follow, null);
});

test('skew: a follow answer given just after opening a file whose time is ahead of the phone\'s clock is not cleared by that file', () => {
  // the office's computer was 30 seconds ahead of the phone: the file says it
  // was published at 13:00:30, and the phone answers at 13:00:00
  const school = todaySchool('2026-09-02T13:00:30Z');
  const ctx = todayCtx(school, '2026-09-02T13:00:00Z');
  keepDayOn(ctx, 'follow', answered('2026-09-02', 'dsample00a', '2026-09-02T13:00:00.000Z'));
  assert.equal(JSON.parse(ctx.store.get('dayOn')).follow.seenFile, '2026-09-02T13:00:30.000Z', 'the file that was open');
  assert.equal(todayOf(ctx).by, 'reader', 'today');
  const next = todayCtx(school, '2026-09-03T13:00:00Z', { dayOn: ctx.store.get('dayOn') });
  assert.deepEqual(said(todayOf(next)), ['2026-09-03', 'known', true, 'B Day', null, 'follow'], 'A on the 2nd, so B on the 3rd');
  assert.notEqual(next.store.get('dayOn'), null);
  // the same file opened on another day, or a file published a second later, is what clears it
  const later = todayCtx(todaySchool('2026-09-02T13:00:31Z'), '2026-09-03T13:00:00Z', { dayOn: ctx.store.get('dayOn') });
  assert.equal(todayOf(later).by, 'calendar');
});

test('followJust: "As the calendar says" takes back today\'s just answer and the follow answer stays, until it is forgotten', () => {
  const school = todaySchool();
  const ctx = todayCtx(school, '2026-09-01T13:50:00Z');
  keepDayOn(ctx, 'follow', answered('2026-09-01', 'dtoday000c', '2026-09-01T13:50:00.000Z'));
  const wednesday = todayCtx(school, '2026-09-02T13:00:00Z', { dayOn: ctx.store.get('dayOn') });
  keepDayOn(wednesday, 'just', answered('2026-09-02', 'dsample00b', '2026-09-02T13:00:00.000Z'));
  forgetDayOn(wednesday, 'just');
  const kept = JSON.parse(wednesday.store.get('dayOn'));
  assert.equal(kept.just, null);
  assert.equal(kept.follow.dayTypeId, 'dtoday000c');
  assert.deepEqual(said(todayOf(wednesday)), ['2026-09-02', 'known', true, 'A Day', 'btodayer00', 'follow'], 'C on the 1st, so A on the 2nd');
  const thursday = todayCtx(school, '2026-09-03T13:00:00Z', { dayOn: wednesday.store.get('dayOn') });
  assert.deepEqual(said(todayOf(thursday)), ['2026-09-03', 'known', true, 'B Day', null, 'follow'], 'the follow answer still holds');
  forgetDayOn(thursday, 'follow');
  assert.equal(thursday.store.get('dayOn'), null, 'nothing is left: the key goes');
  assert.equal(todayOf(thursday).by, 'calendar');
  // forgetting the follow answer leaves a just answer
  const both = todayCtx(school, '2026-09-03T13:00:00Z', { dayOn: JSON.stringify({ just: answered('2026-09-03', 'dsample00b'), follow: answered('2026-09-01', 'dtoday000c', null, null, school.data.publishedAt) }) });
  forgetDayOn(both, 'follow');
  assert.equal(JSON.parse(both.store.get('dayOn')).just.dayTypeId, 'dsample00b');
  assert.equal(JSON.parse(both.store.get('dayOn')).follow, null);
});

test('on a date with no school the bells are the regular bells and no period is left out, whatever was chosen by hand', () => {
  const school = todaySchool();
  const hand = { day: 'dsample00a', bells: 'btodayer00' };
  const closed = todayCtx(school, '2026-11-26T10:00:00Z', hand);
  assert.equal(chosenBells(closed), null);
  assert.equal(meetingPeriods(school, chosenDayType(closed).id, chosenBells(closed)).size, school.data.settings.periods, 'every period meets');
  // the same hand choice on a school day or outside the calendar is kept
  assert.equal(chosenBells(todayCtx(school, '2027-07-01T10:00:00Z', hand)), 'btodayer00');
  assert.equal(chosenBells(todayCtx(school, '2026-09-02T10:00:00Z', hand)), 'btodayer00', 'and the Wednesday\'s own');
});

test('the day another date is: the calendar\'s when it knows the date, else the first day type with the regular bells; the hand choice is for today', () => {
  const school = todaySchool();
  const hand = { day: 'dsample00b', bells: 'btodayer00' };
  const ctx = todayCtx(school, '2026-09-01T10:00:00Z', hand);
  const of = (date) => { const day = dayOnDate(ctx, date); return [day.dayType.name, day.bellsId]; };
  assert.deepEqual(of('2026-09-01'), ['B Day', null], 'today: what the page shows for today');
  assert.deepEqual(of('2026-09-02'), ['C Day', 'btodayer00'], 'a Wednesday in the calendar');
  assert.deepEqual(of('2026-09-03'), ['A Day', null]);
  assert.deepEqual(of('2026-11-26'), ['A Day', null], 'no school: the first day type, the regular bells');
  assert.deepEqual(of('2027-07-01'), ['A Day', null], 'outside the calendar: the hand choice (B Day with Early Release) is not used');
  assert.deepEqual(of(''), ['B Day', null], 'no date is today');
  // the reader\'s follow answer carries on to later dates, and an answer for the date itself settles it
  keepDayOn(ctx, 'follow', answered('2026-09-01', 'dtoday000c'));
  assert.deepEqual(of('2026-09-03'), ['B Day', null], 'C on the 1st, so A, then B');
  assert.deepEqual(of('2026-09-01'), ['C Day', null]);
  // a hand choice with no calendar: today\'s, and no other date\'s
  const none = openSchool(publishedModel(sampleSchool(), { clock: () => new Date('2026-08-25T12:00:00Z') }));
  const bare = todayCtx(none, '2026-09-01T10:00:00Z', { day: 'dsample00b' });
  assert.equal(dayOnDate(bare, '2026-09-01').dayType.name, 'B Day');
  assert.equal(dayOnDate(bare, '2026-09-02').dayType.name, 'A Day');
});

test('an answer is dated by the moment of the click, in the reader\'s zone, and is not lost when storage is unavailable', () => {
  const school = todaySchool();
  // the page was drawn on the 1st; the click is on the 2nd
  const ctx = todayCtx(school, '2026-09-02T00:30:00Z');
  keepDayOn(ctx, 'just', answered(todayDate(ctx), 'dsample00b', clockNow(ctx).toISOString()));
  assert.equal(JSON.parse(ctx.store.get('dayOn')).just.date, '2026-09-02');
  // storage refused: the answer is kept for as long as the page is open
  const refused = { school, now: () => new Date('2026-09-01T10:00:00Z'), store: openStorage(school.data.id, () => { throw new Error('SecurityError'); }) };
  keepDayOn(refused, 'follow', answered('2026-09-01', 'dtoday000c'));
  assert.equal(todayOf(refused).dayType.name, 'C Day');
  assert.equal(refused.store.kept, false);
});

test('whatever was kept under dayOn that is not an answer reads as none and is left as it was', () => {
  const school = todaySchool();
  const none = { just: null, follow: null };
  for (const kept of ['not json', '[]', '{}', '{"just":3}', JSON.stringify({ date: '2026-13-01', dayTypeId: 'dsample00a' }), JSON.stringify({ date: '2026-09-01', dayTypeId: 'dnowhere00' }), JSON.stringify({ just: { date: '2026-09-01', dayTypeId: 'dnowhere00' }, follow: null })]) {
    const ctx = todayCtx(school, '2026-09-01T10:00:00Z', { dayOn: kept });
    assert.deepEqual(readDayOn(ctx), none, kept);
    assert.equal(todayOf(ctx).by, 'calendar', kept);
    assert.equal(ctx.store.get('dayOn'), kept);
  }
  // a bell schedule this copy does not have reads as the regular bells
  const ctx = todayCtx(school, '2026-09-01T10:00:00Z', { dayOn: JSON.stringify({ date: '2026-09-01', dayTypeId: 'dsample00a', bellsId: 'bnowhere00', follow: 'yes' }) });
  assert.deepEqual(readDayOn(ctx), { just: { date: '2026-09-01', dayTypeId: 'dsample00a', bellsId: null, at: null, seenFile: null }, follow: null });
});
