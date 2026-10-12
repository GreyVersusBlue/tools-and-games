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
import { render as renderBatch, batchCount, batchWords, BATCHES, UPRIGHT_ASKED, UPRIGHT_COVER, UPRIGHT_SENTENCE } from '../../ui/prints/batch.js';
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

// SV2-49 item 6
test('a frame given another address holds a page that has not asked: nothing is sent to it, nothing is asked of the planner, and the flag waits for the page that asks', () => {
  const { top, inner, frame } = pair();
  frame.src = 'blob:first';
  const got = [];
  let data = null;
  let flags = { forget: true };
  let datas = 0;
  let asked = 0;
  const feed = feedPreview(top, frame, () => {
    datas += 1;
    return data;
  }, () => {
    asked += 1;
    const now = flags;
    flags = null;
    return now;
  });
  watchPreview(inner, (value, with_) => got.push([value, with_]));
  assert.equal(datas, 1, 'the first page asked, and there was nothing to give it');
  // "Try again": the frame is given a new page, and a change lands before that page has asked
  frame.src = 'blob:second';
  data = { n: 1 };
  assert.equal(feed.send(), false, 'the page that is going away is sent nothing');
  assert.equal(datas, 1, 'the planner is not asked for data on its account, so it never counts the old page as live');
  assert.equal(asked, 0, 'and "forget the kept key" is not used up');
  assert.deepEqual(got, []);
  // the new page asks
  inner.parent.postMessage({ type: PREVIEW_READY });
  assert.deepEqual(got, [[{ n: 1 }, { forget: true }]]);
  assert.equal(feed.send(), true, 'and from then on a change is sent');
  assert.equal(got.length, 2);
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

// SV2-49 item 4: each row of the SV2-45 review's table, and the rules behind them.
test('the sign measures what is drawn, not what is stored: a flag, a skin tone, a tag flag, a text-form symbol, marks in any script, a joiner between letters, Hangul in parts', () => {
  const rows = [
    ['\u{1F1FA}\u{1F1F8}', 2, 'a flag is two letters and one picture'],
    ['\u{1F44D}\u{1F3FD}', 2, 'a thumbs up with a skin tone'],
    ['\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', 2, 'the flag of England: a black flag and six tags'],
    ['❤︎', 1, 'a heart asked for in its text form'],
    ['ที่', 1, 'a Thai consonant with a vowel sign and a tone mark'],
    ['A⃝', 1, 'A in an enclosing circle'],
    ['a‍b', 2, 'a joiner between two letters joins nothing'],
    ['‍204', 3, 'a joiner with nothing before it hides nothing'],
  ];
  for (const [text, width, name] of rows) assert.equal(signWidth(text), width, name);

  const more = [
    // flags: pairs, never a run
    ['\u{1F1FA}\u{1F1F8}\u{1F1EB}\u{1F1F7}', 4, 'two flags'],
    ['\u{1F1FA}\u{1F1F8}\u{1F1EB}', 4, 'a flag and one letter left over'],
    ['\u{1F1FA}A\u{1F1F8}', 5, 'two flag letters apart are two'],
    // what takes no room
    ['\u{1F44D}\u{1F3FB}\u{1F44D}\u{1F3FF}', 4, 'the lightest and the darkest skin tone'],
    ['1️⃣', 1, 'a keycap is its digit'],
    ['שּ', 1, 'a Hebrew letter with a point'],
    ['بَ', 1, 'an Arabic letter with a vowel mark'],
    ['a‌b', 2, 'a non-joiner is not drawn'],
    ['東︀', 2, 'a variation selector after a CJK character'],
    // a joiner joins two pictures, and only two pictures
    ['\u{1F469}\u{1F3FD}‍\u{1F680}', 2, 'a person with a skin tone, joined to a rocket'],
    ['\u{1F469}‍A', 3, 'a picture, a joiner and a letter: the letter keeps its room'],
    ['A‍\u{1F469}', 3, 'a letter, a joiner and a picture'],
    ['क्‍ष', 2, 'a joiner inside a Devanagari cluster hides no letter'],
    // wide symbols outside the two blocks
    ['⌚', 2, 'a watch, U+231A'],
    ['⌛', 2, 'an hourglass, U+231B'],
    ['⏰', 2, 'an alarm clock, U+23F0'],
    ['⏩', 2, 'U+23E9'],
    ['◾', 2, 'U+25FE'],
    ['→', 1, 'an arrow is a narrow symbol'],
    ['✓', 2, 'a check mark is in the block that is measured wide'],
    ['✓︎', 1, 'and narrow in its text form'],
    ['東︎', 2, 'the text-form mark narrows a symbol, never a CJK character'],
    // Hangul: whole, and in parts
    ['한', 2, 'a Hangul syllable'],
    ['한', 2, 'the same syllable written as its three parts'],
    ['한글', 4, 'two syllables in parts'],
    ['ｶﾞ', 2, 'halfwidth katakana are narrow'],
  ];
  for (const [text, width, name] of more) assert.equal(signWidth(text), width, name);
  assert.equal(signFit('\u{1F1FA}\u{1F1F8}'.repeat(3) + 'A'), 1, 'three flags and a letter are seven wide');
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

// ---------------------------------------------------------------- the preview's sheet count (item 1)

// print-preview.js draws a page, so its one pure function is read out of its
// source and run here: the same lines the page runs.
function sheetCounter() {
  const source = readTool('ui/components/print-preview.js');
  const from = source.indexOf('export function sheetsOf(');
  const body = source.slice(from, source.indexOf('\n}\n', from) + 3).replace('export function', 'function');
  return new Function(body + '\nreturn sheetsOf;')();
}

test('sheets are counted from what is on paper: the gap, the dashed line and the room the screen draws where a sheet starts are not paper', () => {
  const sheetsOf = sheetCounter();
  const printable = 950;
  // a cover of 300, then three signs of 946 each; on screen each sign starts 38 px after the one before ends and carries 24 px of line and room
  const mark = { before: 38, inside: 24 };
  const sign = 946 + mark.inside;
  const starts = [0, 300 + mark.before];
  for (let i = 0; i < 3; i += 1) starts.push(starts[starts.length - 1] + sign + (i < 2 ? mark.before : 0));
  assert.equal(sheetsOf(starts, [mark, mark, mark], printable), 4, 'the cover and one sheet a sign');
  // counted from the gaps between the starts, as before, each sign is 1008 px and two sheets
  assert.equal(sheetsOf(starts, [{ before: 0, inside: 0 }, { before: 0, inside: 0 }, { before: 0, inside: 0 }], printable), 7);
  // a sign that is really taller than the paper is two sheets
  assert.equal(sheetsOf([0, 338, 338 + 24 + 960], [mark], printable), 3);
  // a stretch exactly as long as the sheet is one; a pixel over is still one (the rounding the browser does); two over is two
  assert.equal(sheetsOf([0, 950], [], printable), 1);
  assert.equal(sheetsOf([0, 951], [], printable), 1);
  assert.equal(sheetsOf([0, 952], [], printable), 2);
  // nothing on a stretch is still the sheet it starts
  assert.equal(sheetsOf([0, 0], [], printable), 1);
  // SV2-49 item 9: a page that opens on a new sheet is that sheet, with no blank one counted ahead of it
  assert.equal(sheetsOf([0, mark.before, mark.before + mark.inside + 900], [mark], printable), 1, 'nothing stands before the first new sheet');
  assert.equal(sheetsOf([0, 20, 40], [mark], printable), 1, 'nor when the screen\'s gap is all there is before it');
  assert.equal(sheetsOf([0, 0, 24 + 900, 24 + 900 + 38 + 24 + 900], [{ before: 0, inside: 24 }, mark], printable), 2, 'two sheets from the top, and two counted');
  // a line of real paper before the first new sheet is a sheet, as a cover is
  assert.equal(sheetsOf([0, mark.before + 12, mark.before + 12 + mark.inside + 900], [mark], printable), 2);
  // and only the first stretch is ever left out: an empty sheet later in the page is still a sheet
  assert.equal(sheetsOf([0, 300 + 38, 300 + 38 + 24 + 38, 300 + 38 + 24 + 38 + 24 + 900], [mark, mark], printable), 3);
});

// ---------------------------------------------------------------- door signs are upright (item 2)

test('a door sign is never laid on its side: asked for landscape the batch is portrait and its cover says so; a teacher schedule keeps what was asked', () => {
  const project = school();
  for (const size of ['letter', 'a4']) {
    const rule = { letter: 'letter', a4: 'A4' }[size];
    for (const day of [false, true]) {
      const turned = renderBatch(project, null, { batch: 'doors', day, now: clock(), paper: { size, orientation: 'landscape' } }).html;
      assert.ok(turned.includes('data-paper="' + size + '" data-orientation="portrait"'), size + ': the root');
      assert.ok(turned.includes('<style id="page-size">@page { size: ' + rule + ' portrait; }</style>'), size + ': the page rule');
      // SV2-49 item 9: this project is set to portrait, so the cover does not say the project chose landscape
      assert.ok(turned.includes(UPRIGHT_ASKED), size + ': the cover says why');
      assert.ok(!turned.includes('chosen for this project'), size + ': and blames nothing on the project\'s setting');
      const upright = renderBatch(project, null, { batch: 'doors', day, now: clock(), paper: { size, orientation: 'portrait' } }).html;
      assert.ok(!upright.includes(UPRIGHT_COVER) && !upright.includes(UPRIGHT_ASKED), 'asked for portrait there is nothing to say');
      assert.equal(turned.replace(' ' + UPRIGHT_ASKED, ''), upright, size + ': but for that sentence it is the portrait document');
    }
    const teachers = renderBatch(project, null, { batch: 'teachers', now: clock(), paper: { size, orientation: 'landscape' } }).html;
    assert.ok(teachers.includes('data-orientation="landscape"') && !teachers.includes(UPRIGHT_COVER) && !teachers.includes(UPRIGHT_ASKED));
  }
  // the project's own setting, with nothing asked
  const set = school();
  set.settings.paper = { size: 'a4', orientation: 'landscape' };
  assert.ok(renderBatch(set, null, { batch: 'doors', now: clock() }).html.includes('data-paper="a4" data-orientation="portrait"'));
  // there the cover names the project's setting, whether or not the request asked for landscape too
  for (const paper of [undefined, { size: 'a4', orientation: 'landscape' }, { size: 'a4', orientation: 'portrait' }]) {
    const html = renderBatch(set, null, { batch: 'doors', now: clock(), paper }).html;
    assert.ok(html.includes(UPRIGHT_COVER) && !html.includes(UPRIGHT_ASKED), 'the project is set to landscape: ' + JSON.stringify(paper || null));
  }
  // and the entries say so, for the preview sheet
  assert.deepEqual(BATCHES.map((batch) => [batch.id, batch.upright === true, batch.uprightSays || null]), [
    ['teacher-schedules', false, null],
    ['door-signs', true, UPRIGHT_SENTENCE],
    ['door-signs-day', true, UPRIGHT_SENTENCE],
  ]);
});
