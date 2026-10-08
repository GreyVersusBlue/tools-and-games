// The recorded baseline of what staff receive (spec 18): the sample school is
// published at a fixed clock with a fixed source for the lock, and the result
// is compared with test/publish/baseline/. A change to what staff receive, in
// the data or in the code of the published file, fails here until the
// baseline is recorded again on purpose:
//
//   node test/publish/baseline.mjs            compare
//   node test/publish/baseline.mjs --update   record, deliberately; say why in the commit
//
//   baseline/published.json   the published data, readable
//   baseline/locked.json      the same behind the default passcode
//   baseline/code.txt         the hash and size of the document with no data in
//                             it, and of its script and its styles
//
// Nothing here reads the machine's time or zone, and line endings are taken
// out of it, so the same commit gives the same hashes on every machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishData, publishDocument } from '../../ui/staff/targets.js';
import { assemble } from '../../ui/staff/assemble.js';
import { unlockPublished } from '../../engine/publish-crypto.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { teacherDay } from '../../engine/teacher-day.js';
import { seededRandom } from '../../engine/ids.js';
import { readPublished } from '../../staff/source.js';
import { sampleSchool } from '../../data/sample-school.js';
import { diskReader, partsOf, sha256 } from './reader.mjs';

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'baseline');
const UPDATE = process.argv.includes('--update');
const HOW = ' What staff receive has changed. If that is meant, run `node test/publish/baseline.mjs --update` and say why in the commit.';

const clock = () => new Date('2026-09-01T12:00:00Z');
const random = () => seededRandom('sv2-baseline');
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

function recorded(name) {
  const file = path.join(BASELINE, name);
  assert.ok(existsSync(file), 'test/publish/baseline/' + name + ' is missing. Record the baseline with --update.');
  return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function codeText(html) {
  const parts = partsOf(html);
  const line = (name, text) => name.padEnd(9) + sha256(text) + '  ' + Buffer.byteLength(text, 'utf8') + ' bytes\n';
  return line('document', html) + line('script', parts.script) + line('styles', parts.style);
}

async function publishNow() {
  const made = await publishData(sampleSchool(), { clock, random: random() });
  const empty = await assemble(diskReader(), null);
  return { model: pretty(made.model), locked: pretty(made.data), code: codeText(empty), made };
}

if (UPDATE) {
  const now = await publishNow();
  mkdirSync(BASELINE, { recursive: true });
  writeFileSync(path.join(BASELINE, 'published.json'), now.model);
  writeFileSync(path.join(BASELINE, 'locked.json'), now.locked);
  writeFileSync(path.join(BASELINE, 'code.txt'), now.code);
  console.log('Recorded test/publish/baseline/ (published.json, locked.json, code.txt).');
}

test('the sample school publishes to the recorded data', async () => {
  const now = await publishNow();
  assert.equal(now.made.locked, true, 'the sample school has the default passcode, so it publishes locked');
  assert.equal(now.model, recorded('published.json'), 'the published data differs from the baseline.' + HOW);
});

test('behind the default passcode it is the recorded locked file, byte for byte', async () => {
  const now = await publishNow();
  assert.equal(now.locked, recorded('locked.json'), 'the locked file differs from the baseline.' + HOW);
});

test('the code of the published file is the recorded code', async () => {
  const now = await publishNow();
  const want = recorded('code.txt');
  if (now.code !== want) {
    const changed = now.code.split('\n').filter((line, i) => line !== want.split('\n')[i]).map((line) => line.split(' ')[0]).filter(Boolean);
    assert.fail('the published file\'s ' + changed.join(' and ') + ' differ from the baseline.' + HOW + '\n  recorded:\n' + want + '  now:\n' + now.code);
  }
});

test('the recorded locked file opens with bulldogs2015 and holds the recorded data', async () => {
  const envelope = JSON.parse(recorded('locked.json'));
  assert.equal(readPublished(envelope).kind, 'locked');
  assert.equal(envelope.kdf.iterations, 310000);
  const opened = await unlockPublished(envelope, 'bulldogs2015');
  assert.ok(opened, 'the default passcode did not open the recorded file');
  assert.deepEqual(opened.model, JSON.parse(recorded('published.json')));
  assert.equal(await unlockPublished(envelope, 'bulldogs2016'), null);
});

test('a published file from this version still reads: the recorded data is valid and the engine runs on it', () => {
  const model = JSON.parse(recorded('published.json'));
  assert.equal(readPublished(model).kind, 'open');
  assert.deepEqual(validate(model), []);
  assert.deepEqual(repair(model, { clock }).notes, []);
  assert.equal(model.format, 'sv2-published');
  assert.equal(model.version, 1);
  assert.equal(model.publishedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(teacherDay(model, 'tsample001', 'dsample00a').length, 8);
});

test('the recorded files hold no wall-clock time and nothing from this machine', () => {
  const all = recorded('published.json') + recorded('locked.json') + recorded('code.txt');
  const dates = all.match(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g) || [];
  assert.ok(dates.length >= 3);
  for (const date of dates) assert.ok(['2026-09-01T12:00:00.000Z', '2026-10-31T12:00:00.000Z'].includes(date), date + ' is not the pinned clock or 60 days after it');
  assert.ok(!/\/home\/|\\Users\\|C:\\/.test(all), 'a path from a machine');
});

test('a file target writes the same document under the school\'s name and the day', async () => {
  const read = diskReader();
  const published = await publishDocument(read, sampleSchool(), { clock, random: random() });
  // the day in a file's name is the publisher's own day, so it is worked out here the same way
  const day = clock();
  const local = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
  assert.equal(published.fileName, 'Marrowby Middle School (sample) - staff schedule - ' + local + '.html');
  assert.match(published.fileName, /^Marrowby Middle School \(sample\) - staff schedule - 2026-09-0[12]\.html$/);
  assert.equal(published.locked, true);
  assert.equal(pretty(JSON.parse(partsOf(published.html).data)), recorded('locked.json'));
  assert.equal(codeText(await assemble(read, null)), recorded('code.txt'));
  const open = sampleSchool();
  open.publish.passcode = '';
  const plain = await publishDocument(read, open, { clock, random: random() });
  assert.equal(plain.locked, false);
  assert.equal(pretty(JSON.parse(partsOf(plain.html).data)), recorded('published.json'), 'with protection off the file holds the model itself');
});
