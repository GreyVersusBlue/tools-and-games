// The pure pieces of the Staff browser section's M4 pass (SV2-45), in plain
// Node:
//   node test/ui/staff-pass.test.mjs
//
// The seven settings the preview compares against the seven a file carries,
// the publish time read once, which failures get which sentence, and the
// "forget the kept key" flag on its way to the frame.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PUBLISHED_SETTINGS } from '../../ui/staff/preview.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { failureSentence, feedPreview, LinkError, ReadError } from '../../ui/staff/assemble.js';
import { publishedModel } from '../../engine/publish-data.js';
import { watchPreview, PREVIEW_READY, PREVIEW_DATA } from '../../staff/source.js';
import { school, clock } from '../engine/helpers.mjs';
import { diskReader } from '../publish/reader.mjs';

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
