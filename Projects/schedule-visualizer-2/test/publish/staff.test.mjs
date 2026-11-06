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
import { DAY_TYPE_KEY, BELLS_KEY, DAY_ON_KEY, todayOf, todayDate, clockNow, readDayOn, keepDayOn, forgetDayOn, dropFollowOnNewer, chosenDayType, chosenBells, dayOnDate, meetingPeriods } from '../../staff/clock.js';
import { ME_KEY, NOTES_KEY } from '../../staff/notes.js';
import { searchIndex, searchSchool, foldText, FIND_LIMIT } from '../../staff/find.js';
import { publishedModel } from '../../engine/publish-data.js';
import { lockPublished, unlockPublished } from '../../engine/publish-crypto.js';
import { teacherDay, isFree } from '../../engine/teacher-day.js';
import { newMark, newDuty } from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { dutyDate, everyTeacherDay, groupSlots, groupMark, takenBy, takingDuty, sometimesIn, sometimesWords, dutyTimes, dutyPlace, edgeDuties, entryWords } from '../../staff/clock.js';
import { freeTeachers, emptyRooms } from '../../staff/views/free.js';
import { coverageFor } from '../../staff/views/coverage.js';
import { roomUse } from '../../staff/views/room.js';
import { doorSignMarkup } from '../../staff/views/door-sign.js';
import { dayKindsOf } from '../../staff/views/teacher.js';
import { lockScreenLayout } from '../../staff/outputs.js';
import { commonPeriods } from '../../staff/views/common.js';
import { render as renderBatch } from '../../ui/prints/batch.js';
import { render as renderChecks } from '../../ui/prints/checks-report.js';
import { seededRandom } from '../../engine/ids.js';
import { oneWayStairs } from '../../staff/views/map.js';
import { stepFreeNotes } from '../../staff/map.js';
import { routeFloors, routeCrossings } from '../../staff/views/directions.js';
import { paint, F2, F3 } from '../fixtures/step-free.mjs';
// The sample before its calendar, bell schedules, marks and duties (SV2-82): the cases here build their own.
import { plainSchool as sampleSchool } from '../engine/helpers.mjs';
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

// The day a clock reads is the device's zone's, so a case that is written in UTC
// pins UTC for its body and puts the machine's zone back (the moment-of-the-click
// case below does the same with its own zone).
function inZone(zone, body) {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    body();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

// An answer as the page keeps it: the date and the moment of the click.
const answered = (date, dayTypeId, at, bellsId) => ({ date, dayTypeId, bellsId: bellsId || null, at: at || date + 'T10:00:00.000Z' });

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
  inZone('UTC', () => {
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
});

test('the one-answer shape dayOn had reads as whichever it was', () => {
  const school = todaySchool();
  const old = (follow) => JSON.stringify({ date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, follow });
  const just = readDayOn(todayCtx(school, '2026-09-01T10:00:00Z', { dayOn: old(false) }));
  assert.deepEqual(just, { just: { date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, at: null }, follow: null });
  const follow = readDayOn(todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: old(true) }));
  assert.deepEqual(follow, { just: null, follow: { date: '2026-09-01', dayTypeId: 'dtoday000c', bellsId: null, at: null } });
  assert.equal(todayOf(todayCtx(school, '2026-09-03T10:00:00Z', { dayOn: old(true) })).by, 'follow');
});

test('reading a follow answer compares no files: any number of reads, whatever file is open, leaves it where it is', () => {
  const answer = JSON.stringify({ just: null, follow: answered('2026-09-01', 'dtoday000c', '2026-09-01T15:00:00.000Z') });
  // the probe's first case: an answer from before `seenFile`, the device's `seen` older than the open file
  const ctx = todayCtx(todaySchool('2026-09-02T07:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: answer, seen: '2026-09-01T00:00:00.000Z' });
  ctx.store.set('seen', ctx.school.data.publishedAt); // what the shell does
  assert.notEqual(readDayOn(ctx).follow, null, 'first read');
  assert.notEqual(readDayOn(ctx).follow, null, 'second read');
  assert.equal(todayOf(ctx).by, 'follow');
  assert.equal(ctx.store.get('dayOn'), answer, 'nothing written by reading');
  // a field `seenFile` kept by an earlier copy is read past, and a new answer does not write one
  const old = JSON.stringify({ just: null, follow: { ...answered('2026-09-01', 'dtoday000c'), seenFile: '2026-09-01T14:00:00.000Z' } });
  const read = readDayOn(todayCtx(todaySchool(), '2026-09-03T10:00:00Z', { dayOn: old })).follow;
  assert.equal('seenFile' in read, false);
  const given = todayCtx(todaySchool(), '2026-09-01T10:00:00Z');
  keepDayOn(given, 'follow', answered('2026-09-01', 'dtoday000c'));
  assert.equal('seenFile' in JSON.parse(given.store.get('dayOn')).follow, false);
});

test('dropFollowOnNewer: a file newer than the device\'s seen ends a follow answer, a file no newer clears nothing, and "just" stays', () => {
  const both = JSON.stringify({ just: answered('2026-09-03', 'dtoday000c', '2026-09-03T09:00:00.000Z'), follow: answered('2026-09-01', 'dtoday000c', '2026-09-01T15:00:00.000Z') });
  const SEEN = '2026-09-01T14:00:00.000Z';
  const attempt = (publishedAt, seen) => {
    const ctx = todayCtx(todaySchool(publishedAt), '2026-09-03T10:00:00Z', { dayOn: both });
    dropFollowOnNewer(ctx, publishedAt, seen);
    return ctx;
  };
  for (const [name, publishedAt, seen] of [['the same file', SEEN, SEEN], ['an older copy', '2026-09-01T09:00:00.000Z', SEEN], ['a device that had opened nothing', SEEN, null], ['a damaged seen', SEEN, 'yesterday']]) {
    assert.equal(attempt(publishedAt, seen).store.get('dayOn'), both, name);
  }
  const newer = attempt('2026-09-01T14:00:01.000Z', SEEN);
  const kept = JSON.parse(newer.store.get('dayOn'));
  assert.equal(kept.follow, null, 'the follow answer is gone');
  assert.equal(kept.just.dayTypeId, 'dtoday000c', 'the just answer is not');
  assert.equal(todayOf(newer).by, 'reader');
  // with nothing but a follow answer, the key goes
  const alone = todayCtx(todaySchool('2026-09-02T07:00:00Z'), '2026-09-03T10:00:00Z', { dayOn: JSON.stringify({ just: null, follow: answered('2026-09-01', 'dtoday000c') }) });
  dropFollowOnNewer(alone, '2026-09-02T07:00:00.000Z', SEEN);
  assert.equal(alone.store.get('dayOn'), null);
  assert.equal(todayOf(alone).by, 'calendar');
  // storage the browser refuses: the answer lives in memory, and goes from memory
  const refused = openStorage('s', () => ({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('full'); } }), () => {});
  const mem = { school: todaySchool('2026-09-02T07:00:00Z'), store: refused, now: () => new Date('2026-09-03T10:00:00Z') };
  keepDayOn(mem, 'follow', answered('2026-09-01', 'dtoday000c'));
  assert.notEqual(readDayOn(mem).follow, null);
  dropFollowOnNewer(mem, '2026-09-02T07:00:00.000Z', SEEN);
  assert.equal(readDayOn(mem).follow, null);
});

test('a follow answer given just after opening a file whose time is ahead of the phone\'s clock stays until a newer file moves seen', () => {
  inZone('UTC', () => {
    // the office's computer was 30 seconds ahead of the phone: the file says it
    // was published at 13:00:30, and the phone answers at 13:00:00
    const school = todaySchool('2026-09-02T13:00:30Z');
    const ctx = todayCtx(school, '2026-09-02T13:00:00Z', { seen: school.data.publishedAt });
    keepDayOn(ctx, 'follow', answered('2026-09-02', 'dsample00a', '2026-09-02T13:00:00.000Z'));
    assert.equal(todayOf(ctx).by, 'reader', 'today');
    const next = todayCtx(school, '2026-09-03T13:00:00Z', { dayOn: ctx.store.get('dayOn') });
    assert.deepEqual(said(todayOf(next)), ['2026-09-03', 'known', true, 'B Day', null, 'follow'], 'A on the 2nd, so B on the 3rd');
    dropFollowOnNewer(next, school.data.publishedAt, school.data.publishedAt);
    assert.notEqual(next.store.get('dayOn'), null, 'the same file again');
    dropFollowOnNewer(next, '2026-09-02T13:00:31.000Z', school.data.publishedAt);
    assert.equal(todayOf(next).by, 'calendar', 'a file a second later');
  });
});

test('followJust: "As the calendar says" takes back today\'s just answer and the follow answer stays, until it is forgotten', () => {
  inZone('UTC', () => {
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
  // the date is read in the zone of the process, so the test sets its own: 00:30 UTC on the 2nd is 12:30 on the 2nd at UTC+12,
  // and the 1st at UTC-8, which the machine's own zone must not decide
  const zone = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    answeredByClick();
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

function answeredByClick() {
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
}

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
  assert.deepEqual(readDayOn(ctx), { just: { date: '2026-09-01', dayTypeId: 'dsample00a', bellsId: null, at: null }, follow: null });
});


// ---------------------------------------------------------------- marks and duties in the views (SV2-86)

// The invented sample with marks and duties laid on it (periods count from 0;
// A Day, tsample001 teaches periods 1 and 2 and is free in the rest):
//
//   Lunch for grade 6, every day type, period 3 (6A is then in the cafeteria)
//   No class for 6A on A Day, period 1
//   An assembly (an activity mark, the whole school) on B Day, period 7
//   tsample001: "Lunch duty" in period 3 at the cafeteria, every day
//   tsample001 and tsample002: "Bus duty" after school, 15:05 to 15:25
//   tsample002: "Door duty" before school, 07:40 to 07:55
//   the science teachers: a Wednesday meeting in period 4
const A = 'dsample00a';
const B = 'dsample00b';
function dutySchool(change) {
  const project = sampleSchool();
  const lunch = newMark('mduty00001', 'lunch', 3);
  lunch.scope = 'grades';
  lunch.grades = ['6'];
  const noclass = newMark('mduty00002', 'noclass', 1);
  noclass.scope = 'groups';
  noclass.groupIds = ['gsample06a'];
  noclass.dayTypeIds = [A];
  const assembly = newMark('mduty00003', 'activity', 7);
  assembly.label = 'Assembly';
  assembly.dayTypeIds = [B];
  project.marks = [lunch, noclass, assembly];
  const lunchDuty = newDuty('uduty00001', 'duty');
  Object.assign(lunchDuty, { label: 'Lunch duty', when: 'period', period: 3, place: 'Cafeteria', teacherIds: ['tsample001'] });
  const bus = newDuty('uduty00002', 'duty');
  Object.assign(bus, { label: 'Bus duty', when: 'after', start: '15:05', end: '15:25', place: 'Bus loop', teacherIds: ['tsample001', 'tsample002'] });
  const door = newDuty('uduty00003', 'duty');
  Object.assign(door, { label: 'Door duty', when: 'before', start: '07:40', end: '07:55', place: 'Front door', teacherIds: ['tsample002'] });
  const meeting = newDuty('uduty00004', 'meeting');
  Object.assign(meeting, { label: 'Science department', when: 'period', period: 4, weekdays: [2], subjectIds: ['ssample003'] });
  project.duties = [lunchDuty, bus, door, meeting];
  if (change) change(project);
  return project;
}
const dutyModel = (change) => openSchool(publishedModel(dutySchool(change), { clock }));

test('the marks and duties fixture is a valid project', () => {
  assert.deepEqual(validate(dutySchool()), []);
});

test('a school with no calendar, or a date outside it, still applies a sometimes duty by the device\'s date', () => {
  const school = dutyModel();
  assert.equal(school.data.calendar, null, 'the fixture has no calendar');
  const wednesday = todayCtx(school, '2026-09-02T10:00:00Z');
  assert.equal(todayOf(wednesday).known, false, 'nobody has said which day it is');
  assert.equal(dutyDate(wednesday, A), '2026-09-02', 'the day shown is today\'s, so its date decides');
  assert.equal(dutyDate(wednesday, B), null, 'another day type is not today');
  const names = (ctx) => freeTeachers(school, A, 4, dutyDate(ctx, A)).map((teacher) => teacher.id);
  assert.ok(!names(wednesday).includes('tsample003'), 'at the Wednesday meeting right now');
  assert.ok(names(todayCtx(school, '2026-09-03T10:00:00Z')).includes('tsample003'), 'free on the Thursday');
  assert.deepEqual(commonPeriods(school, ['tsample003', 'tsample010'], A, dutyDate(wednesday, A)).includes(4), false, 'common planning');
  // a calendar that does not reach the date is the same
  const outside = dutyModel((project) => { project.calendar = todaySchool().data.calendar; });
  const later = todayCtx(outside, '2027-09-01T10:00:00Z');
  assert.equal(todayOf(later).calendar, 'outside');
  assert.equal(dutyDate(later, A), '2027-09-01', 'a Wednesday outside the calendar');
  // the reader's own answer for another day type moves today to that one
  const chosen = todayCtx(school, '2026-09-02T10:00:00Z', { day: B });
  assert.equal(dutyDate(chosen, A), null);
  assert.equal(dutyDate(chosen, B), '2026-09-02');
});

test('the lock-screen image says a sometimes duty inside a period, with its days, and the always duty still takes the period', () => {
  const school = dutyModel((project) => { project.duties[3].label = '<b>Science</b>'; });
  const lines = (teacherId) => {
    const teacher = school.teacher(teacherId);
    const kinds = dayKindsOf(school, (dayType) => (school.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => [taught.groupId, taught.roomId])));
    return lockScreenLayout(school, teacher, kinds, {}).items.filter((item) => item.kind === 'text').map((item) => item.text);
  };
  const three = lines('tsample003');
  assert.ok(three.includes('Planning · <b>Science</b> (Wednesdays)'), 'the meeting, as typed, with its day: ' + three.filter((text) => /Science/.test(text)));
  assert.ok(lines('tsample001').includes('Lunch duty · Cafeteria'), 'an every-day duty reads as before, with no days after it');
  assert.ok(!lines('tsample001').some((text) => /Wednesdays/.test(text)), 'a teacher with no sometimes duty has no days after a period');
});

test('a teacher on duty is not free: Free right now lists the others, and a Wednesday duty takes the period on a Wednesday only', () => {
  const school = dutyModel();
  const names3 = (date) => freeTeachers(school, A, 3, date).map((teacher) => teacher.id);
  assert.ok(!names3(null).includes('tsample001'), 'the lunch duty takes period 3');
  const plain = openSchool(publishedModel(sampleSchool(), { clock }));
  assert.ok(freeTeachers(plain, A, 3).some((teacher) => teacher.id === 'tsample001'), 'free without the duty');
  // the science meeting is on Wednesdays only
  const free4 = (date) => freeTeachers(school, A, 4, date).map((teacher) => teacher.id);
  assert.ok(free4(null).includes('tsample003'), 'no date: a duty that holds on some days takes nothing');
  assert.ok(free4('2026-09-03').includes('tsample003'), 'a Thursday');
  assert.ok(!free4('2026-09-02').includes('tsample003'), 'a Wednesday: at the meeting');
  assert.ok(!free4('2026-09-02').includes('tsample010'), 'every science teacher, by subject');
  // the assembly takes period 7 on B Day for everyone who has no class then
  assert.deepEqual(freeTeachers(school, B, 7).map((teacher) => teacher.id), [], 'the whole school is at the assembly or teaching');
});

test('a free period that a duty or a mark takes reads as it, with the reason Coverage gives', () => {
  const school = dutyModel();
  const entry = (teacherId, dayTypeId, period, date) => everyTeacherDay(school, dayTypeId, date).get(teacherId)[period];
  const lunch = takenBy(school, entry('tsample001', A, 3), A, null);
  assert.deepEqual(lunch, { eyebrow: 'Duty', title: 'Lunch duty', place: 'Cafeteria', times: '', reason: 'On duty: Lunch duty' });
  const assembly = takenBy(school, entry('tsample004', B, 7), B, null);
  assert.equal(assembly.title, 'Assembly');
  assert.equal(assembly.reason, 'At an activity: Assembly');
  assert.equal(takenBy(school, entry('tsample001', A, 4), A, null), null, 'a free period nothing takes');
  assert.equal(takenBy(school, entry('tsample001', A, 1), A, null), null, 'a class is not taken by anything');
  const meeting = takenBy(school, entry('tsample003', A, 4, '2026-09-02'), A, '2026-09-02');
  assert.deepEqual([meeting.eyebrow, meeting.title, meeting.reason], ['Meeting', 'Science department', 'At a meeting: Science department']);
  // (the words of a taken period are nodes, read in the browser case; a free one is plain)
  assert.equal(entryWords(school, entry('tsample001', A, 4), { dayTypeId: A }).join(''), 'Planning');
  // a duty with no label shows its kind's word, and the reason has no colon
  const bare = dutyModel((project) => { project.duties[0].label = ''; });
  assert.equal(takenBy(bare, everyTeacherDay(bare, A).get('tsample001')[3], A, null).reason, 'On duty');
});

test('duties before and after the day are the teacher\'s own edges, with their times and places', () => {
  const school = dutyModel();
  const edges = edgeDuties(school, 'tsample002', A, null);
  assert.deepEqual(edges.before.map((duty) => [duty.label, dutyTimes(school, duty), dutyPlace(school, duty)]), [['Door duty', '7:40 AM to 7:55 AM', 'Front door']]);
  assert.deepEqual(edges.after.map((duty) => [duty.label, dutyTimes(school, duty), dutyPlace(school, duty)]), [['Bus duty', '3:05 PM to 3:25 PM', 'Bus loop']]);
  assert.deepEqual(edgeDuties(school, 'tsample003', A, null), { before: [], after: [] });
  // only a start, only an end, neither
  assert.equal(dutyTimes(school, { start: '07:40', end: '' }), 'from 7:40 AM');
  assert.equal(dutyTimes(school, { start: '', end: '07:55' }), 'until 7:55 AM');
  assert.equal(dutyTimes(school, { start: '', end: '' }), '');
});

test('a duty that holds on some days is listed with its days where no date settles it', () => {
  const school = dutyModel();
  const meeting = school.data.duties.find((duty) => duty.id === 'uduty00004');
  assert.equal(sometimesWords(school, meeting), 'Wednesdays');
  assert.equal(sometimesWords(school, { weekdays: [0, 4] }), 'Mondays and Fridays');
  assert.equal(sometimesWords(school, { weekdays: [], from: '2026-12-01', to: '2026-12-18' }), 'from 1 December to 18 December');
  assert.equal(sometimesWords(school, school.data.duties[0]), '', 'an every-day duty has no days');
  const day = everyTeacherDay(school, A).get('tsample003')[4];
  assert.deepEqual(sometimesIn(day, null).map((duty) => duty.id), ['uduty00004'], 'listed under the free period');
  assert.equal(takingDuty(day, null), null);
  const wednesday = everyTeacherDay(school, A, '2026-09-02').get('tsample003')[4];
  assert.equal(takingDuty(wednesday, '2026-09-02').id, 'uduty00004', 'taking it on the Wednesday');
  assert.deepEqual(sometimesIn(wednesday, '2026-09-02'), []);
});

test('rooms and groups: a No class period books no room; a lunch keeps its room', () => {
  const school = dutyModel();
  const plain = openSchool(publishedModel(sampleSchool(), { clock }));
  const room103 = (from) => emptyRooms(from, A, 1).some((room) => room.id === 'rsample103');
  assert.equal(room103(plain), false, '6A is in Room 103 in period 1');
  assert.equal(room103(school), true, 'with 6A at No class it is empty');
  assert.deepEqual(roomUse(school, 'rsample103', A)[1], [], 'the room page says empty');
  assert.equal(roomUse(plain, 'rsample103', A)[1].length, 1);
  assert.equal(groupMark(school, 'gsample06a', A, 1).kind, 'noclass');
  assert.equal(groupSlots(school, 'gsample06a', A)[1].room, null, 'an empty slot');
  // lunch: the group is still in the cafeteria
  assert.equal(groupSlots(school, 'gsample06a', A)[3].room, 'rsamplecaf');
  assert.equal(roomUse(school, 'rsamplecaf', A)[3].find((use) => use.group.id === 'gsample06a').mark.kind, 'lunch');
  // with bells that leave the period out, nobody is anywhere
  assert.equal(groupSlots(school, 'gsample06b', A, null).length, 8);
});

test('Coverage lists a teacher on duty under Not free with the reason, and not as a candidate', () => {
  const school = dutyModel();
  const cover = coverageFor(school, 'tsample002', A);
  const lunch = cover.find((item) => item.period === 3);
  assert.ok(lunch, 'Mr. Brightwater teaches in period 3');
  assert.ok(!lunch.candidates.some((candidate) => candidate.teacher.id === 'tsample001'), 'not a candidate');
  assert.deepEqual(lunch.notFree.filter((one) => one.teacher.id === 'tsample001').map((one) => one.reason), ['On duty: Lunch duty']);
  // the same page for the school without the duty has her as a candidate and nobody under Not free
  const plain = coverageFor(openSchool(publishedModel(sampleSchool(), { clock })), 'tsample002', A).find((item) => item.period === 3);
  assert.ok(plain.candidates.some((candidate) => candidate.teacher.id === 'tsample001'));
  assert.deepEqual(plain.notFree, []);
});

test('common planning: a teacher on duty is not free with the others', () => {
  const school = dutyModel();
  const plain = openSchool(publishedModel(sampleSchool(), { clock }));
  const both = (from) => commonPeriods(from, ['tsample001', 'tsample002'], A);
  assert.ok(!both(school).includes(3));
  assert.deepEqual(both(plain).filter((period) => period !== 3), both(school));
});

test('a file published before marks existed has neither list, and every view reads that as none', async () => {
  const data = JSON.parse(partsOf(readTool('test/publish/frozen/sv2-m4.html')).data);
  const opened = await unlockPublished(data, 'bulldogs2015');
  assert.equal(opened.model.marks, undefined, 'the frozen file has no marks');
  assert.equal(opened.model.duties, undefined, 'the frozen file has no duties');
  const school = openSchool(readPublished(opened.model).model);
  for (const dayType of school.dayTypes) {
    const days = everyTeacherDay(school, dayType.id);
    for (const teacher of school.teachers) {
      const day = days.get(teacher.id);
      assert.deepEqual(day.map((entry) => entry.kind), teacherDay(school.data, teacher.id, dayType.id).map((entry) => entry.kind));
      assert.ok(day.every((entry) => entry.marked === null && entry.duties.length === 0), 'nothing is marked');
      assert.ok(day.every((entry) => entry.kind === 'teaching' || isFree(entry)), 'every planning period is free');
      assert.ok(day.every((entry) => takenBy(school, entry, dayType.id, null) === null));
      assert.deepEqual(edgeDuties(school, teacher.id, dayType.id, null), { before: [], after: [] });
    }
    for (const group of school.groups) {
      assert.deepEqual(groupSlots(school, group.id, dayType.id), effectiveSchedule(school.data, group.id, dayType.id));
      assert.ok(groupSlots(school, group.id, dayType.id).every((slot, period) => groupMark(school, group.id, dayType.id, period) === null));
    }
    const a = school.teachers[0];
    assert.deepEqual(coverageFor(school, a.id, dayType.id).flatMap((item) => item.notFree), []);
  }
});

// A third day type that is a copy of A Day, so that nothing but a mark can tell the two apart.
const COPY = 'dcopy00000';
function copiedDay(project) {
  const a = project.dayTypes.find((dayType) => dayType.id === A);
  project.dayTypes.push({ id: COPY, name: 'A Day again', own: true, sameAs: null, short: '', bells: a.bells.map((bell) => ({ ...bell })) });
  for (const group of project.groups) group.days[COPY] = group.days[A].map((slot) => ({ ...slot }));
}

test('the door sign\'s day table prints a group\'s mark, and day types differing only by a mark id share a card unless the printed words differ', () => {
  const lunchOn = (id, dayTypeId, label) => {
    const mark = newMark(id, 'lunch', 3);
    mark.scope = 'grades';
    mark.grades = ['6'];
    mark.dayTypeIds = [dayTypeId];
    mark.label = label;
    return mark;
  };
  const sign = (change) => {
    const school = dutyModel((project) => { copiedDay(project); project.marks = []; change(project); });
    const room = school.room('rsamplecaf');
    const html = doorSignMarkup(school, room, { day: true });
    return { html, kinds: Number(/data-count="(\d+)"/.exec(html)[1]), rows: html.match(/<tr[^>]*>.*?<\/tr>/g) };
  };
  const none = sign(() => {});
  assert.equal(none.kinds, 2, 'A Day and its copy share a card, B Day has its own');
  assert.ok(!none.html.includes('(Lunch)'));
  const alike = sign((project) => { project.marks = [lunchOn('mdoor00001', A, ''), lunchOn('mdoor00002', COPY, '')]; });
  assert.ok(alike.rows.some((row) => row.includes('Period 4') && row.includes('6A (Lunch)')), 'the mark is printed by the group: ' + alike.rows.slice(3, 5));
  assert.equal(alike.kinds, 2, 'two marks with different ids and the same words do not split the card');
  const typed = sign((project) => { project.marks = [lunchOn('mdoor00001', A, '<i>Lunch</i> A'), lunchOn('mdoor00002', COPY, '')]; });
  assert.ok(typed.html.includes('6A (&lt;i&gt;Lunch&lt;/i&gt; A)') && !typed.html.includes('<i>'), 'a typed label is text, as typed');
  assert.equal(typed.kinds, 3, 'different words are different cards');
  // a school without marks has the sign it had
  const plain = openSchool(publishedModel(sampleSchool(), { clock }));
  assert.ok(!doorSignMarkup(plain, plain.room('rsamplecaf'), { day: true }).includes('6A ('));
});

test('the checks report trims a mark\'s label as the views do: a label of spaces falls back to the kind\'s words', () => {
  const spaces = (project) => { project.marks[2].label = '   '; };
  const html = renderChecks(dutySchool(spaces), null, { now: new Date('2026-09-01T12:00:00Z') }).html;
  assert.equal((html.match(/<span class="doc-grid__planning">\s*<\/span>/g) || []).length, 0, 'no blank cell');
  assert.ok(html.includes('<span class="doc-grid__planning">Activity</span>'), 'it reads Activity, as the views do');
  const school = dutyModel(spaces);
  const entry = school.teachers.map((teacher) => everyTeacherDay(school, B).get(teacher.id)[7]).find((each) => each.marked === 'activity');
  assert.equal(takenBy(school, entry, B, null).title, 'Activity');
});

test('every teacher\'s schedule in the batch print carries duties as rows, and marks as the free period\'s words', () => {
  const pinned = new Date('2026-09-01T12:00:00Z');
  const html = renderBatch(dutySchool(), null, { now: pinned, batch: 'teachers' }).html;
  const sheet = (id) => {
    const at = html.indexOf('data-sheet="teacher" data-id="' + id + '"');
    const next = html.indexOf('data-sheet="teacher"', at + 10);
    return html.slice(at, next === -1 ? html.length : next);
  };
  const two = sheet('tsample002');
  assert.match(two, /batch-day__edge"><th scope="row">Before school<span class="batch-day__time">7:40 AM to 7:55 AM<\/span><\/th><td>Door duty<\/td><td>Front door<\/td>/);
  assert.match(two, /batch-day__edge"><th scope="row">After school<span class="batch-day__time">3:05 PM to 3:25 PM<\/span><\/th><td>Bus duty<\/td><td>Bus loop<\/td>/);
  assert.ok(two.indexOf('Before school') < two.indexOf('Period 1'), 'above the first period');
  assert.ok(two.lastIndexOf('After school') > two.lastIndexOf('Period 8'), 'below the last');
  const one = sheet('tsample001');
  assert.match(one, /<td>Lunch duty<\/td><td>Cafeteria<\/td>/, 'a free period a duty takes');
  assert.match(one, /<span class="batch-day__quiet">Planning<\/span>/, 'the free ones are still planning');
  const three = sheet('tsample003');
  assert.match(three, /Science department <span class="batch-day__quiet">\(Wednesdays\)<\/span>/, 'a Wednesday duty is listed with its day');
  // a name with markup is text
  const hostile = renderBatch(dutySchool((project) => { project.duties[0].label = '<img src=x onerror=alert(1)>'; }), null, { now: pinned, batch: 'teachers' }).html;
  assert.ok(hostile.includes('&lt;img src=x onerror=alert(1)&gt;') && !hostile.includes('<img src=x'));
  // a project with neither list prints as it did
  assert.ok(!renderBatch(sampleSchool(), null, { now: pinned, batch: 'teachers' }).html.includes('batch-day__edge'));
});

test('the checks report\'s teacher grid names what takes a free period, and a free one stays Planning', () => {
  const html = renderChecks(dutySchool(), null, { now: new Date('2026-09-01T12:00:00Z') }).html;
  const row = (name) => {
    const at = html.indexOf('>' + name);
    return html.slice(at, html.indexOf('</tr>', at));
  };
  const halloran = row('Ms. Halloran');
  assert.ok(halloran.includes('<span class="doc-grid__planning">Lunch duty</span>'), 'period 4 is the lunch duty');
  assert.ok(halloran.includes('<span class="doc-grid__planning">Planning</span>'), 'the others are planning');
  assert.ok(html.includes('<span class="doc-grid__planning">Assembly</span>'), 'a school mark with a label of its own is named as typed');
});

// ---- elevators in the staff browser (SV2-105)

// Elevator D joins Floors 1, 2 and 3 as a chain: the first connection joins
// Floors 1 and 2, so a ride from Floor 1 to Floor 3 is on a car whose id
// names connection ends that are not the ride's.
function chain() {
  const project = sampleSchool();
  const [, f2, f3] = project.building.floors;
  const [a, b] = project.building.connections;
  a.kind = 'elevator';
  a.staffOnly = true;
  a.car = 'D';
  project.building.floors[0].lifts = [332];
  f2.lifts = [332];
  paint(f3, 332, 'S');
  f3.lifts = [332];
  b.kind = 'elevator';
  b.staffOnly = true;
  b.car = 'D';
  b.a = { floorId: F2, cell: 332 };
  b.b = { floorId: F3, cell: 332 };
  return project;
}

test('a ride is read from the route\'s cells: Floor 1 to Floor 3 on a car named by its first connection', () => {
  const school = openSchool(publishedModel(chain(), { clock: () => new Date('2026-09-01T12:00:00Z') }));
  const found = school.route('rsample101', 'rsample303', { avoidStairs: true });
  assert.equal(found.ok, true);
  assert.deepEqual([found.stairs, found.rides, found.connections.length], [0, 1, 1]);
  const [crossing] = routeCrossings(school, found);
  assert.deepEqual([crossing.kind, crossing.label, crossing.fromFloorId, crossing.toFloorId], ['ride', 'D', 'fsample001', F3]);
  const connection = school.data.building.connections.find((item) => item.id === found.connections[0]);
  assert.equal(connection.b.floorId, F2, 'the car\'s id is the first connection\'s, which joins Floors 1 and 2');
  const floors = routeFloors(school, found);
  assert.deepEqual(floors.map((part) => [part.floorId, part.stairs, part.via && part.via.kind]), [['fsample001', 'D', 'ride'], [F3, null, null]]);
});

test('routeFloors names stairs by their letter and a ride by the car\'s', () => {
  const project = chain();
  const school = openSchool(publishedModel(project, { clock: () => new Date('2026-09-01T12:00:00Z') }));
  const found = school.route('rsample101', 'rsample303');
  assert.deepEqual(routeCrossings(school, found).map((each) => [each.kind, each.label]), [['ride', 'D']]);
  // the sample's own building has stairs only
  const plain = openSchool(publishedModel(sampleSchool(), { clock: () => new Date('2026-09-01T12:00:00Z') }));
  const walked = plain.route('rsample101', 'rsample303');
  assert.deepEqual(routeFloors(plain, walked).map((part) => [part.stairs, part.via && part.via.kind]), [['A', 'stairs'], ['B', 'stairs'], [null, null]]);
});

test('an elevator is never a one-way stairs line, whatever its direction says', () => {
  const project = chain();
  project.building.connections[0].direction = 'ab';
  const data = publishedModel(project, { clock: () => new Date('2026-09-01T12:00:00Z') });
  assert.deepEqual(oneWayStairs(data, data.building.floors[0]), []);
  const stairs = sampleSchool();
  stairs.building.connections[0].direction = 'ab';
  const plain = publishedModel(stairs, { clock: () => new Date('2026-09-01T12:00:00Z') });
  assert.deepEqual(oneWayStairs(plain, plain.building.floors[0]).map((each) => each.text), ['Stairs A (up only)']);
});

test('the map\'s list names the stops, steps, step doors, step exits and refuges of a floor, as typed', () => {
  const project = chain();
  const [f1] = project.building.floors;
  f1.refuges = [{ id: 'asample001', cell: 283, name: '<i>Quiet</i> room' }];
  f1.notStepFree = [281, 282];
  f1.spaces[0].doors[0].stepFree = false;
  f1.exits[1].stepFree = false;
  const school = openSchool(publishedModel(project, { clock: () => new Date('2026-09-01T12:00:00Z') }));
  const notes = stepFreeNotes(school, school.data.building.floors[0]);
  assert.deepEqual(notes.map((note) => note.kind), ['elevator', 'refuge', 'step', 'door', 'exit']);
  assert.equal(notes[0].text, 'Elevator D (staff only): stops at Floor 1, Floor 2 and Floor 3');
  assert.equal(notes[1].text, '<i>Quiet</i> room');
  assert.match(notes[2].text, /^Step in .+ \(2 cells\)$/);
  assert.equal(notes[3].text, 'Step at a door of Room 101');
  assert.equal(notes[4].text, 'Steps outside exit Door B');
  assert.deepEqual(stepFreeNotes(school, school.data.building.floors[2]).map((note) => note.kind), ['elevator']);
});
