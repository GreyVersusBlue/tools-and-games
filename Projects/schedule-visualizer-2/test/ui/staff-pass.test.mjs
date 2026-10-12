// The pure pieces of the Staff browser section's M4 pass (SV2-45), in plain
// Node:
//   node test/ui/staff-pass.test.mjs
//
// The seven settings the preview compares against the seven a file carries,
// the publish time read once, which failures get which sentence, the "forget
// the kept key" flag on its way to the frame, and the words a reader's
// directions are written in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PUBLISHED_SETTINGS } from '../../ui/staff/preview.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { failureSentence, feedPreview, LinkError, ReadError } from '../../ui/staff/assemble.js';
import { publishedModel } from '../../engine/publish-data.js';
import { watchPreview, PREVIEW_READY, PREVIEW_DATA } from '../../staff/source.js';
import { school, clock } from '../engine/helpers.mjs';
import { diskReader } from '../publish/reader.mjs';
import { openSchool } from '../../staff/model.js';
import { signFit, signWidth } from '../../staff/views/door-sign.js';
import { noteCountOf } from '../../staff/notes.js';
import { render as renderBatch, batchCount, batchWords } from '../../ui/prints/batch.js';
import { GROUPS } from '../run.mjs';
import { readTool } from '../publish/reader.mjs';

test('the settings the preview is fed again for are the settings a published file carries: seven, the same seven, in the same order', () => {
  const carried = Object.keys(publishedModel(school(), { clock }).settings);
  assert.equal(carried.length, 7);
  assert.deepEqual(PUBLISHED_SETTINGS, carried);
  // and none of them is a setting only the planner uses
  for (const key of ['theme', 'paper', 'defaultHeadCount', 'checks', 'colourScale']) assert.ok(!PUBLISHED_SETTINGS.includes(key), key);
});

test('a file is published at one moment: the clock is read once, so the day in the name is the day inside the file across midnight', async () => {
  const project = school();
  project.publish.passcode = '';
  // 23:59:59.900 local on the first reading, the next day on any later one
  const times = [new Date(2026, 8, 1, 23, 59, 59, 900), new Date(2026, 8, 2, 0, 0, 1)];
  let read = 0;
  const ticking = () => {
    read += 1;
    return times[Math.min(read, times.length) - 1];
  };
  const made = await publishDocument(diskReader(), project, { clock: ticking, random: () => 0.5 });
  assert.equal(read, 1, 'the clock was read ' + read + ' times');
  assert.ok(made.fileName.endsWith(' - 2026-09-01.html'), made.fileName);
  assert.equal(made.model.publishedAt, times[0].toISOString());
});

test('which failure gets which sentence: the tool\'s own as written, the connection\'s for files that never came, and never the browser\'s own words', () => {
  const words = { connection: 'CONNECTION', other: 'OTHER' };
  const crypto = new Error('This browser cannot open a locked file here: it has no encryption for pages opened this way. Open the file in Safari, Chrome, Edge or Firefox.');
  assert.equal(failureSentence(crypto, words), crypto.message, 'publish-crypto.js\'s sentence is said as it is');
  assert.equal(failureSentence(new LinkError('staff/x.js exports `location`.'), words), 'staff/x.js exports `location`.');
  const cause = new TypeError('Failed to fetch');
  const never = new ReadError('The staff browser\'s file staff/x.js could not be loaded.', cause);
  assert.equal(failureSentence(never, words), 'CONNECTION');
  assert.equal(never.cause, cause, 'what the browser said is kept for the console');
  assert.equal(failureSentence(cause, words), 'OTHER', '"Failed to fetch" is the browser\'s, and is not a connection the tool saw fail');
  assert.equal(failureSentence(new RangeError('Invalid array length'), words), 'OTHER');
  assert.equal(failureSentence(new LinkError(''), words), 'OTHER');
  assert.equal(failureSentence(undefined, words), 'OTHER');
  assert.equal(failureSentence('a string', words), 'OTHER');
});

// A planner window and a frame window, as far as the two ends of the preview use one.
function pair() {
  const origin = 'http://127.0.0.1:1';
  const listeners = { top: [], frame: [] };
  const top = { location: { origin }, addEventListener: (type, fn) => listeners.top.push(fn), removeEventListener() {} };
  const inner = {
    location: { origin },
    parent: null,
    addEventListener: (type, fn) => listeners.frame.push(fn),
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    postMessage: (data) => listeners.frame.forEach((fn) => fn({ source: inner.parent, origin, data })),
  };
  inner.parent = { postMessage: (data) => listeners.top.forEach((fn) => fn({ source: inner, origin, data })) };
  return { top, inner, frame: { contentWindow: inner } };
}

test('"forget the kept key" travels with the one copy it is for: beside the data, once, and only when a message really goes', () => {
  const { top, inner, frame } = pair();
  const got = [];
  let data = null;
  let flags = { forget: true };
  let asked = 0;
  const feed = feedPreview(top, frame, () => data, () => {
    asked += 1;
    const now = flags;
    flags = null;
    return now;
  });
  watchPreview(inner, (value, with_) => got.push([value, with_]));
  assert.deepEqual(got, [], 'with nothing to show nothing is sent');
  assert.equal(asked, 0, 'and the flag is not used up by a message that did not go');
  data = { n: 1 };
  assert.equal(feed.send(), true);
  data = { n: 2 };
  feed.send();
  assert.deepEqual(got, [[{ n: 1 }, { forget: true }], [{ n: 2 }, { forget: false }]]);
});

test('a feed with no flags sends the data alone, as before', () => {
  const { top, inner, frame } = pair();
  const sent = [];
  inner.postMessage = (data) => sent.push(data);
  const feed = feedPreview(top, frame, () => ({ n: 1 }));
  inner.parent.postMessage({ type: PREVIEW_READY });
  feed.send();
  assert.deepEqual(sent, [{ type: PREVIEW_DATA, data: { n: 1 } }, { type: PREVIEW_DATA, data: { n: 1 } }]);
});

test('the staff browser\'s directions are written for a reader: every walk is in squares, and a way with no stairs that does not exist is said plainly', () => {
  const opened = openSchool(publishedModel(school(), { clock }));
  const rooms = (number) => opened.rooms.find((room) => room.number === number).id;
  const written = opened.directions(opened.route(rooms('101'), rooms('302')));
  const walks = written.steps.filter((step) => step.kind === 'walk');
  assert.ok(walks.length >= 3, 'the walk crosses the building');
  for (const step of walks) assert.match(step.text, /^Walk \d+ squares?\b/, step.text);
  assert.doesNotMatch(written.text, /\bcells?\b/);
  const refused = opened.directions(opened.route(rooms('101'), rooms('302'), { avoidStairs: true }));
  assert.equal(refused.text, 'There is no way from Room 101 to Room 302 without stairs.');
});

// ---------------------------------------------------------------- the door sign's fit (item 5)

test('the sign measures a number as it is drawn: a symbol or a tile drawn as an emoji is two wide, an accent, the emoji mark and a joiner are none', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  const cases = [
    ['204', 3, 'Latin digits'],
    ['\u6771\u4EAC', 4, 'two CJK characters'],
    ['\u2600', 2, 'a sun, U+2600'],
    ['\u2B50', 2, 'a star, U+2B50'],
    ['\u{1F004}', 2, 'a tile, U+1F004'],
    ['\u{1F170}', 2, 'a lettered square, U+1F170'],
    ['\u2600\uFE0F', 2, 'the sun with the mark that asks for its emoji form'],
    ['e\u0301', 1, 'e with a combining accent is one letter'],
    ['Cafe\u0301', 4, 'and a word with one is as long as its letters'],
    [family, 2, 'a family of three, joined, is one emoji'],
    [family + family, 4, 'two families'],
    ['A' + family + '1', 4, 'a joined emoji between two characters'],
    ['\u{1F468}\u{1F469}', 4, 'two people not joined are two'],
    ['', 0, 'nothing'],
  ];
  for (const [text, width, name] of cases) assert.equal(signWidth(text), width, name);
  // and so the fit: seven Latin characters wide is full size
  assert.equal(signFit(family.repeat(3)), 1, 'three families are six wide');
  assert.equal(signFit(family.repeat(4)), 7 / 8);
  assert.equal(signFit('e\u0301'.repeat(7)), 1, 'seven accented letters fit as seven do');
  assert.equal(signFit('\u2600'.repeat(4)), 7 / 8, 'four suns are eight wide');
});

// ---------------------------------------------------------------- the batch's count (item 6)

test('how many sheets a batch is comes from the school the sheets are made from: the published copy, opened once the way render opens it', () => {
  const project = school();
  // the published copy is made from these parts of a project; a count that never reads them was counted from somewhere else
  let read = 0;
  const watched = new Proxy(project, {
    get(target, key) {
      if (key === 'publish') read += 1;
      return target[key];
    },
  });
  for (const batch of ['doors', 'teachers']) {
    read = 0;
    const counted = batchCount(watched, batch);
    assert.ok(read > 0, batch + ': counted from the published copy');
    const html = renderBatch(project, null, { batch, now: clock() }).html;
    assert.equal(counted, html.split('data-sheet="' + (batch === 'doors' ? 'door' : 'teacher') + '"').length - 1, batch + ': the count is the number of sheets');
  }
  assert.deepEqual(batchWords(project), { teachers: '12 teachers', rooms: '13 rooms' });
});

// ---------------------------------------------------------------- a note's count (item 11)

test('a note\'s count is a number of the field\'s 200 and names no unit: the field counts an emoji as two', () => {
  assert.equal(noteCountOf('n'.repeat(180)), '');
  assert.equal(noteCountOf('n'.repeat(181)), '181 of 200');
  assert.equal(noteCountOf('\u{1F642}'.repeat(91)), '182 of 200', '91 faces, 182 of what the field allows');
  assert.doesNotMatch(noteCountOf('n'.repeat(200)), /character/);
});

// ---------------------------------------------------------------- README (item 9)

test('README\'s test table names every suite test/run.mjs lists, once, and no file that is not one', () => {
  const readme = readTool('README.md').replace(/\r\n?/g, '\n');
  const at = readme.indexOf('\n## What each test file covers\n');
  assert.notEqual(at, -1, 'README has the section');
  const section = readme.slice(at + 1).split('\n## ')[0];
  const named = [...section.matchAll(/^\| `test\/([^`]+)` \| (.+) \|$/gm)].map((row) => row[1]);
  const listed = Array.from(new Set(Object.values(GROUPS).flat()));
  assert.deepEqual(named.filter((file, index) => named.indexOf(file) !== index), [], 'a file is in the table twice');
  assert.deepEqual(listed.filter((file) => !named.includes(file)), [], 'suites test/run.mjs runs that the table does not name');
  assert.deepEqual(named.filter((file) => !listed.includes(file)), [], 'files in the table that test/run.mjs does not run');
  for (const row of section.matchAll(/^\| `test\/([^`]+)` \| (.+) \|$/gm)) assert.ok(row[2].trim().length >= 12, row[1] + ' says what it covers');
});
