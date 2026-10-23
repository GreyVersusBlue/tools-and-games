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
import { readFileSync } from 'node:fs';

import { PUBLISHED_SETTINGS, readerSeesChange } from '../../ui/staff/preview.js';
import { publishDocument } from '../../ui/staff/targets.js';
import { failureSentence, feedPreview, LinkError, ReadError } from '../../ui/staff/assemble.js';
import { publishedModel } from '../../engine/publish-data.js';
import { watchPreview, PREVIEW_READY, PREVIEW_DATA } from '../../staff/source.js';
import { school, clock } from '../engine/helpers.mjs';
import { diskReader } from '../publish/reader.mjs';
import { openSchool } from '../../staff/model.js';
import { signFit, signWidth } from '../../staff/views/door-sign.js';
import { directionsView } from '../../staff/views/directions.js';
import * as staffSection from '../../ui/staff/index.js';
import { facts, viewHandle, unnotedStands, unnotedOf, fileMade, followTab } from '../../ui/staff/index.js';
import { READ_ONLY_MADE } from '../../ui/staff/form.js';
import { createStore } from '../../engine/store.js';
import { replaceProject, notePublished } from '../../engine/actions.js';
import { sampleSchool, SAMPLE_PROJECT_ID } from '../../data/sample-school.js';
import { makeIds } from '../engine/helpers.mjs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noteCountOf } from '../../staff/notes.js';
import { render as renderBatch, batchCount, batchWords, BATCHES, UPRIGHT_ASKED, UPRIGHT_COVER, UPRIGHT_SENTENCE, UPRIGHT_ALL_SENTENCE } from '../../ui/prints/batch.js';
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

// A planner window and a frame, as far as the two ends of the preview use
// them. As in a browser, the frame's window (`frame.contentWindow`) is one
// object whatever page it holds; each page has its own inner window, with its
// own listeners, and a message posted to the frame reaches the page it holds
// now. `navigate(src)` gives the frame another page (the one before keeps
// running until `load()`, as a page being replaced does) and `load()` fires
// the frame's load event. `inner` is the first page.
function pair() {
  const origin = 'http://127.0.0.1:1';
  const listeners = { top: [], load: [] };
  const top = { location: { origin }, addEventListener: (type, fn) => listeners.top.push(fn), removeEventListener: (type, fn) => { listeners.top = listeners.top.filter((each) => each !== fn); } };
  const pages = [];
  const proxy = { postMessage: (data) => pages[pages.length - 1].postMessage(data) };
  const parent = { postMessage: (data) => listeners.top.forEach((fn) => fn({ source: proxy, origin, data })) };
  const page = () => {
    const own = [];
    const inner = {
      location: { origin },
      parent,
      addEventListener: (type, fn) => own.push(fn),
      removeEventListener() {},
      setInterval: () => 1,
      clearInterval() {},
      postMessage: (data) => own.forEach((fn) => fn({ source: parent, origin, data })),
    };
    pages.push(inner);
    return inner;
  };
  const inner = page();
  const frame = {
    src: 'blob:first',
    contentWindow: proxy,
    addEventListener: (type, fn) => { if (type === 'load') listeners.load.push(fn); },
    removeEventListener: (type, fn) => { listeners.load = listeners.load.filter((each) => each !== fn); },
    load: () => listeners.load.forEach((fn) => fn()),
    navigate: (src) => {
      frame.src = src;
      return page();
    },
  };
  return { top, inner, frame };
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
  frame.load();
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
  frame.load();
  watchPreview(inner, (value, with_) => got.push([value, with_]));
  assert.equal(datas, 1, 'the first page asked, and there was nothing to give it');
  // "Try again": the frame is given a new page, and a change lands before that page has asked
  const second = frame.navigate('blob:second');
  data = { n: 1 };
  assert.equal(feed.send(), false, 'the page that is going away is sent nothing');
  assert.equal(datas, 1, 'the planner is not asked for data on its account, so it never counts the old page as live');
  assert.equal(asked, 0, 'and "forget the kept key" is not used up');
  assert.deepEqual(got, []);
  // the new page loads and asks
  frame.load();
  watchPreview(second, (value, with_) => got.push([value, with_]));
  assert.deepEqual(got, [[{ n: 1 }, { forget: true }]]);
  assert.equal(feed.send(), true, 'and from then on a change is sent');
  assert.equal(got.length, 2);
});

// SV2-51 item 6. The page being replaced asks once more after the frame was
// given the new address, before the new page has loaded: the frame's window
// is the same object for both pages, so the message looks like the new
// page's. It must not count: until SV2-51 it ended the wait for the new page
// to open (state.opened), and the data went to the page that was going.
test('a late "ready" from the page being replaced is not taken for the new page: only a "ready" after the frame\'s load for its address counts', () => {
  const { top, inner, frame } = pair();
  const got = [];
  const late = [];
  let asks = 0;
  const feed = feedPreview(top, frame, () => {
    asks += 1;
    return { n: asks };
  });
  // before the first page has loaded, its "ready" is not counted either
  inner.parent.postMessage({ type: PREVIEW_READY });
  assert.equal(asks, 0, 'a frame that has not loaded its address has no page that asked');
  frame.load();
  watchPreview(inner, (value) => late.push(value));
  assert.equal(asks, 1, 'the first page loaded and asked');
  // "Try again": a new address; the old page, still there, asks again
  const second = frame.navigate('blob:second');
  inner.parent.postMessage({ type: PREVIEW_READY });
  assert.equal(asks, 1, 'the old page\'s late "ready" does not ask the planner for data on the new page\'s account');
  assert.equal(feed.send(), false, 'and nothing is sent to the frame');
  assert.deepEqual(late, [{ n: 1 }], 'the old page got only what it was sent while it was the frame\'s page');
  watchPreview(second, (value) => got.push(value));
  assert.deepEqual(got, [], 'the new page asked before its load: not yet');
  frame.load();
  second.parent.postMessage({ type: PREVIEW_READY });
  assert.equal(asks, 2);
  assert.deepEqual(got, [{ n: 2 }], 'the new page, loaded, asks and is answered');
  feed.stop();
  frame.load();
  second.parent.postMessage({ type: PREVIEW_READY });
  assert.equal(asks, 2, 'a stopped feed answers nothing');
});

test('a feed with no flags sends the data alone, as before', () => {
  const { top, inner, frame } = pair();
  const sent = [];
  inner.postMessage = (data) => sent.push(data);
  const feed = feedPreview(top, frame, () => ({ n: 1 }));
  frame.load();
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

// ---------------------------------------------------------------- Publish's last asking (SV2-51 item 5)

// After the file went out, form.js asked for the checks of the project on
// screen (SV2-49). It was never the only asking: a project that moved, or the
// note of the publish, reaches update(), which asks; a read-only tab refuses
// every change, so its project is the one checksStand asked about, and the
// asking was answered from what askChecks kept. With the line restored the
// browser cases in publish.mjs stay green, which is how it was shown to do
// nothing; this holds it out.
test('once the file is out, Publish asks for no checks itself: update() does, for a project that moved or was noted', () => {
  const form = readFileSync(new URL('../../ui/staff/form.js', import.meta.url), 'utf8');
  const after = form.slice(form.indexOf('// From here the file is out'), form.indexOf('  button.addEventListener(\'click\', publish);'));
  assert.ok(after.length > 200, 'the part of publish() after the file goes out was found');
  assert.doesNotMatch(after, /askChecks\(/);
});

// SV2-53 item 1, the Foreman's parts.mjs: Publish says the schedule changed
// while the file was made when a reader would see a change, and a passcode
// turned on or off is one. Each project is read as the file it would make;
// until SV2-53 both were read with the made file's flag, so on-in-the-gap
// was no change and off-in-the-gap was.
test('a passcode turned on or off while the file is made is a change a reader sees; a theme is not', () => {
  const base = { id: 'p', settings: { schoolName: 'S', theme: 'auto' }, building: {}, subjects: [], teachers: [], dayTypes: [], groups: [], publish: { views: {}, passcode: '' } };
  const on = { ...base, publish: { ...base.publish, passcode: 'secret1' } };
  const other = { ...on, publish: { ...on.publish, passcode: 'secret2' } };
  const themed = { ...base, settings: { ...base.settings, theme: 'dark' } };
  assert.equal(readerSeesChange(base, on), true, 'turned on while the file was made');
  assert.equal(readerSeesChange(on, base), true, 'turned off while the file was made');
  assert.equal(readerSeesChange(on, other), true, 'a locked file with another passcode');
  assert.equal(readerSeesChange(base, themed), false, 'a theme is a new project and the same file');
  assert.equal(readerSeesChange(on, on), false, 'the same project');
  // the page's own use: form.js says MOVED_ON by this rule and no other
  const form = readFileSync(new URL('../../ui/staff/form.js', import.meta.url), 'utf8');
  assert.match(form, /const moved = readerSeesChange\(project, store\.project\);/);
});

// ---------------------------------------------------------------- the section's hooks and first line (SV2-51 item 10)

// A write to one of the two test hooks in the plain forms: hooks.deliver = …,
// hooks['deliver'] = …, Object.assign(hooks, …), Object.defineProperty(hooks,
// …) and Reflect.set(hooks, …), whatever the name in front of `hooks`. A write
// through another name (`const box = hooks; box.deliver = …`) is not seen
// here. What keeps the page's own modules off the hooks is that only
// ui/staff/index.js declares them and only form.js is handed them, and no
// module of the page writes them in a form seen here (the next two cases).
// Neither is a defence against code written to reach them. Until SV2-53 only
// the first form was looked for (SV2-53 item 4); until SV2-58 this case's
// title said it saw every way (SV2-58 item 1).
const HOOK_WRITES = [
  /\bhooks\s*\.\s*(assembled|deliver)\s*(=(?!=)|\?\?=|\|\|=|&&=)/,
  /\bhooks\s*\[\s*(['"`])(assembled|deliver)\1\s*\]\s*(=(?!=)|\?\?=|\|\|=|&&=)/,
  /\bhooks\s*\[\s*[^'"`\]\s][^\]]*\]\s*=(?!=)/,
  /\bObject\s*\.\s*(assign|defineProperty|defineProperties|setPrototypeOf)\s*\(\s*[\w$.]*\bhooks\b/,
  /\bReflect\s*\.\s*(set|defineProperty)\s*\(\s*[\w$.]*\bhooks\b/,
];
const setsTestHook = (source) => HOOK_WRITES.some((pattern) => pattern.test(source));

test('the guard sees the plain forms of a write to a test hook, and not the page\'s own hooks or a comparison', () => {
  const writes = [
    'hooks.deliver = (file) => file;',
    'hooks.assembled=wait;',
    "hooks['deliver'] = take;",
    'hooks["assembled"] = wait;',
    'hooks[`deliver`] = take;',
    'hooks[name] = take;',
    'Object.assign(hooks, { deliver: take });',
    'Object.assign(view.hooks, { assembled: wait });',
    "Object.defineProperty(hooks, 'deliver', { value: take });",
    "Reflect.set(hooks, 'deliver', take);",
    'hooks.deliver ??= take;',
  ];
  for (const source of writes) assert.equal(setsTestHook(source), true, source);
  const not = [
    'hooks.made = (published, noted) => {};',
    'hooks.published = published;',
    "if (typeof hooks.deliver === 'function') hooks.deliver(published);",
    "hooks['made'] = null;",
    'const deliver = hooks.deliver;',
  ];
  for (const source of not) assert.equal(setsTestHook(source), false, source);
});

// SV2-58 item 1. The hooks were exported from ui/staff/index.js and put on
// the view's element in every browser, so a module could import them under
// another name, or reach them through `.stf.staff`, and write them where the
// guard above does not look (the SV2-53 review's hook-guard.mjs: five such
// writes). Now the object is the module's own, and the view carries it only
// in a browser that says a test drives it (navigator.webdriver). That keeps
// the hooks out of a reader's ordinary page; a page's script can redefine
// the flag, so it is no defence against code that sets out to reach them
// (SV2-58b; until then this case's title said no module could).
test('the test hooks are out of a reader\'s ordinary page: ui/staff/index.js exports none, and the view carries them only where the browser says a test drives it', () => {
  assert.equal('hooks' in staffSection, false, 'ui/staff/index.js exports its hooks');
  for (const [name, value] of Object.entries(staffSection)) {
    assert.ok(!(value && typeof value === 'object' && 'deliver' in value), name + ' is the hooks under another name');
  }
  const testHooks = { deliver: null, assembled: null, published: null, made: null };
  const parts = { preview: { stop() {} }, form: { stop() {} } };
  const reader = viewHandle(parts, testHooks, false);
  assert.deepEqual(Object.keys(reader).sort(), ['form', 'preview'], 'a reader\'s browser: no hooks on the view');
  assert.equal(viewHandle(parts, testHooks, undefined).hooks, undefined, 'not when the browser does not say');
  const driven = viewHandle(parts, testHooks, true);
  assert.deepEqual(Object.keys(driven).sort(), ['form', 'hooks', 'preview']);
  assert.equal(driven.hooks, testHooks, 'a test\'s browser: the hooks themselves');
  // and the page's own use: the view is made by that rule from the browser's flag, not from anything the page can set
  const source = readFileSync(new URL('../../ui/staff/index.js', import.meta.url), 'utf8');
  assert.match(source, /^const hooks = \{ deliver: null, assembled: null, published: null, made: null \};$/m, 'declared, null, and not exported');
  assert.match(source, /element\.staff = viewHandle\(\{ preview: shown, form \}, hooks, automated\(\)\);/);
  assert.match(source, /const automated = \(\) => typeof navigator !== 'undefined' && navigator\.webdriver === true;/);
});

test('nothing in the page sets the test hooks', () => {
  const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const setters = [];
  let read = 0;
  for (const folder of ['ui', 'staff', 'engine', 'storage']) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(at);
        else if (entry.name.endsWith('.js')) {
          read += 1;
          if (setsTestHook(readFileSync(at, 'utf8'))) setters.push(path.relative(tool, at));
        }
      }
    };
    walk(path.join(tool, folder));
  }
  assert.ok(read > 100, 'the page\'s modules were read: ' + read);
  assert.deepEqual(setters, [], 'a module of the page sets a test hook');
});

test('the section\'s first line after a file the project did not note: read-only says so, and a refusal in an editing tab says the project could not record it', () => {
  const project = school();
  const readOnly = facts(project, 'read-only');
  const refused = facts(project, 'refused');
  assert.match(readOnly, /^This tab made a file just now\. The project does not record it while the tab is read-only\. It has /);
  assert.match(refused, /^This tab made a file just now\. The project could not record it\. It has /);
  assert.doesNotMatch(refused, /read-only/);
  assert.match(facts(project, null), /^No file has been made from this project yet\. /);
});

// SV2-53b. When "just now" stops being so the tab still made the file: the
// line said "No file has been made from this project yet" after it, which was
// false.
test('a file the project did not note, no longer just now, is still a file this tab made: "earlier", never "no file yet"', () => {
  const project = school();
  const readOnly = facts(project, 'read-only', false);
  const refused = facts(project, 'refused', false);
  assert.match(readOnly, /^This tab made a file earlier\. The project does not record it while the tab is read-only\. It has /);
  assert.match(refused, /^This tab made a file earlier\. The project could not record it\. It has /);
  for (const line of [readOnly, refused]) {
    assert.doesNotMatch(line, /just now|No file has been made/);
  }
  assert.match(facts(project, 'refused'), /^This tab made a file just now\./, 'just now unless told otherwise');
});

// SV2-58b. The tab's unrecorded file was kept by the project's id for the
// tab's life, and outlived its truth: the tab became the editor, or the
// project took up another tab's later file, and the line still said "This
// tab made a file earlier. The project does not record it while the tab is
// read-only." (the review's unnoted-stale.mjs). And the sample school's id is
// fixed, so a sample removed and loaded again inherited the old one's entry.
const MADE_AT = '2026-10-16T08:00:00.000Z';
const recording = (project, at) => ({ ...project, publish: { ...project.publish, lastPublishedAt: at } });

test('the tab\'s unrecorded file stands only while its line is true: a read-only one while the tab is read-only, and any one until the project records a later file', () => {
  const project = school();
  const readOnly = { unnoted: 'read-only', at: Date.parse(MADE_AT) };
  const refused = { unnoted: 'refused', at: Date.parse(MADE_AT) };
  assert.equal(unnotedStands(readOnly, project, true), true, 'read-only, nothing recorded');
  assert.equal(unnotedStands(readOnly, project, false), false, 'the tab is the editor now');
  assert.equal(unnotedStands(refused, project, false), true, 'a refusal is not about the tab being read-only');
  for (const entry of [readOnly, refused]) {
    assert.equal(unnotedStands(entry, recording(project, '2026-10-16T09:00:00.000Z'), true), false, entry.unnoted + ': a later file recorded');
    assert.equal(unnotedStands(entry, recording(project, '2026-10-15T09:00:00.000Z'), true), true, entry.unnoted + ': an earlier file recorded');
    assert.equal(unnotedStands(entry, recording(project, MADE_AT), true), true, entry.unnoted + ': a file recorded at the same moment is not later');
  }
  assert.equal(unnotedStands(null, project, true), false);
});

test('an entry that no longer stands is dropped, not kept for later: the line is the project\'s own again', () => {
  const project = { ...school(), id: 'pstale0001' };
  fileMade(project.id, READ_ONLY_MADE, project, MADE_AT);
  assert.equal(unnotedOf(project, true).unnoted, 'read-only');
  // another tab's later file, taken up
  const later = recording(project, '2026-10-16T09:00:00.000Z');
  assert.equal(unnotedOf(later, true), null);
  assert.equal(unnotedOf(project, true), null, 'dropped');
  assert.match(facts(later, null), /^The last file from this project was made on /);
  // the tab becomes the editor
  fileMade(project.id, READ_ONLY_MADE, project, MADE_AT);
  assert.equal(unnotedOf(project, false), null);
  assert.equal(unnotedOf(project, true), null, 'dropped, so read-only again does not bring it back');
  // a refusal stands in an editing tab, and a noted file takes it away
  fileMade(project.id, 'The project could not record it.', project, MADE_AT);
  assert.equal(unnotedOf(project, false).unnoted, 'refused');
  fileMade(project.id, true, project, MADE_AT);
  assert.equal(unnotedOf(project, false), null);
});

test('the sample school loaded again is a new project: it does not inherit the old one\'s file, and undo across a load keeps it', () => {
  const store = createStore({ project: sampleSchool(), clock, ids: makeIds(5) });
  followTab(store, null);
  followTab(store, null); // followed once, however often asked
  const made = () => unnotedOf(store.project, true);
  fileMade(SAMPLE_PROJECT_ID, READ_ONLY_MADE, store.project, MADE_AT);
  assert.equal(made().unnoted, 'read-only');
  // a change of the sample keeps it
  store.apply(notePublished, { at: '2026-09-01T12:00:00.000Z' });
  assert.equal(made().unnoted, 'read-only', 'a recorded file older than the entry');
  // the sample removed, and brought back by undo: the same project
  store.apply(replaceProject, { project: { ...sampleSchool(), id: 'pempty0001' }, label: 'Remove the sample school' });
  assert.equal(store.project.id, 'pempty0001');
  store.undo();
  assert.equal(store.project.id, SAMPLE_PROJECT_ID);
  assert.equal(made().unnoted, 'read-only', 'undo brings back the project the file was made beside');
  // removed, and loaded again: a new project with the same id
  store.apply(replaceProject, { project: { ...sampleSchool(), id: 'pempty0001' }, label: 'Remove the sample school' });
  store.apply(replaceProject, { project: sampleSchool(), label: 'Load the sample school' });
  assert.equal(store.project.id, SAMPLE_PROJECT_ID);
  assert.equal(made(), null, 'the sample loaded again made no file in this tab');
  assert.match(facts(store.project, null), /^No file has been made from this project yet\. /);
  // and a project read from the device over another (the store's replace)
  fileMade(SAMPLE_PROJECT_ID, 'The project could not record it.', store.project, MADE_AT);
  store.replace({ ...sampleSchool(), id: 'pempty0002' });
  store.replace(sampleSchool());
  assert.equal(made(), null, 'loaded by replace');
});

test('the tab becoming the editor drops its read-only files, whether or not the section is open, and keeps a refused one', () => {
  const listeners = [];
  const storage = { state: { readOnly: true }, subscribe: (fn) => listeners.push(fn) };
  followTab(null, storage);
  followTab(null, storage);
  assert.equal(listeners.length, 1, 'followed once');
  const a = { ...school(), id: 'peditor001' };
  const b = { ...school(), id: 'peditor002' };
  fileMade(a.id, READ_ONLY_MADE, a, MADE_AT);
  fileMade(b.id, 'The project could not record it.', b, MADE_AT);
  listeners[0]({ readOnly: true }, 'tabs');
  assert.equal(unnotedOf(a, true).unnoted, 'read-only', 'still read-only');
  listeners[0]({ readOnly: false }, 'tabs');
  assert.equal(unnotedOf(a, true), null, 'the editor now: read-only again does not bring it back');
  assert.equal(unnotedOf(b, false).unnoted, 'refused');
  fileMade(b.id, true, b, MADE_AT);
});

// ---------------------------------------------------------------- the step-free refusal's routes (SV2-51 item 4)

// Just enough of a document for a staff view to build its page in Node:
// elements with attributes, a dataset, children and text, and the three
// selectors page.js asks for.
class StubElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.dataset = {};
    this.className = '';
    this.hidden = false;
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof StubElement);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  addEventListener() {}

  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const node of nodes) this.appendChild(typeof node === 'object' ? node : { textContent: String(node) });
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  find(test) {
    for (const each of this.descendants()) if (test(each)) return each;
    return null;
  }

  querySelector(selector) {
    if (selector === '[data-print]') return this.find((el) => 'print' in el.dataset);
    if (selector === '[data-actions="print"]') return this.find((el) => el.dataset.actions === 'print');
    if (selector === '.page__outputs') return this.find((el) => el.className.split(' ').includes('page__outputs'));
    throw new Error('the stand-in document does not know ' + selector);
  }
}

function withStubDocument(run) {
  const had = { document: globalThis.document, location: globalThis.location };
  globalThis.document = { title: '', createElement: (tag) => new StubElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };
  globalThis.location = { protocol: 'file:', href: 'file:///staff.html' };
  try {
    return run();
  } finally {
    globalThis.document = had.document;
    globalThis.location = had.location;
  }
}

// The page's own use of directionsRefusal: the route the page looked for is
// handed to it, so a step-free way that does not exist costs the way without
// stairs and the way with them, two routes. Until SV2-51 the refusal looked
// for the step-free way again: three.
test('the Directions page refuses a step-free way that does not exist with two routes, not three, and still offers the way with stairs', () => {
  const opened = openSchool(publishedModel(school(), { clock }));
  const asked = [];
  const counted = Object.create(opened);
  counted.route = (from, to, options) => {
    asked.push(Boolean(options && options.avoidStairs));
    return opened.route(from, to, options);
  };
  const id = (number) => opened.rooms.find((room) => room.number === number).id;
  const page = withStubDocument(() => directionsView.render({ school: counted, replace() {} }, { id: '', query: { from: id('101'), to: id('302'), stepfree: '1' } }));
  assert.ok(page.textContent.includes('There is no way from Room 101 to Room 302 without stairs.'), page.textContent);
  assert.ok(page.find((el) => el.dataset.directions === 'stairs'), 'the way with stairs is offered');
  assert.deepEqual(asked, [true, false], 'the step-free way once, then the way with stairs');
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

// SV2-51 item 1: where SV2-49's count was short. A short count sets a number
// too large, so it wraps to a second line and can push a batch sheet onto two.
// SV2-49 pinned a keycap at 1, its digit; it is drawn as an emoji, two wide.
test('the sign does not count short: a keycap, an emoji-form mark after a narrow base, a joiner only between two pictures, a skin tone only after a picture, Hangul parts alone, the wide blocks SV2-49 missed', () => {
  const rows = [
    // a narrow character drawn as an emoji
    ['1\uFE0F\u20E3', 2, 'a keycap, as it is typed'],
    ['#\uFE0F\u20E3', 2, 'the number sign keycap'],
    ['1\u20E3', 2, 'a keycap without the emoji mark'],
    ['\u00A9\uFE0F', 2, 'a narrow base with U+FE0F'],
    ['\u2122\uFE0F', 2, 'the trade mark sign as an emoji'],
    ['1\uFE0F\u20E3'.repeat(3) + 'A', 7, 'three keycaps and a letter'],
    // a joiner joins two pictures and nothing else
    ['\u6771\u200D\u6771', 4, 'a joiner between two CJK characters joins nothing'],
    ['\u{20000}\u200D\u{20000}', 4, 'nor between two characters past U+20000'],
    ['\u2600\u200D\u2600', 2, 'between two pictures in U+2600 to U+27BF it does'],
    ['\u{1F468}\u200D\u200D\u{1F469}', 4, 'a second joiner in a row joins nothing'],
    ['\u{1F468}\u200D\u200D\u{1F469}\u200D\u{1F467}', 4, 'and the joiner after the next picture joins again'],
    ['\u{1F3F3}\uFE0F\u200D\u{1F308}', 2, 'a picture, its emoji mark, a joiner and a picture'],
    // a skin tone
    ['\u{1F3FD}', 2, 'a skin tone alone is a square of colour'],
    ['A\u{1F3FD}', 3, 'after a letter it is a square of its own'],
    ['\u6771\u{1F3FD}', 4, 'after a CJK character too'],
    ['\u{1F44D}\u{1F3FD}\u{1F3FD}', 4, 'a picture takes one tone; a second is a square'],
    // Hangul in parts
    ['\u1161', 2, 'a lone Hangul vowel is a glyph'],
    ['\u11AB', 2, 'a lone Hangul final is a glyph'],
    ['\u11AB\u1161', 4, 'a final then a vowel are two glyphs'],
    ['\uAC00\u11AB', 2, 'a final after a whole syllable of a consonant and a vowel is drawn inside it'],
    ['\uAC01\u11AB', 4, 'after a syllable that has its final already it is a glyph'],
    ['\uD7B0', 2, 'a lone vowel of the extended block'],
    ['\uA960\uD7B0', 2, 'and after a leading consonant of the extended block'],
    // the wide blocks
    ['\u4DC0', 2, 'a hexagram, U+4DC0'],
    ['\u4DFF', 2, 'U+4DFF'],
    ['\uFE10', 2, 'a vertical comma, U+FE10'],
    ['\uFE19', 2, 'U+FE19'],
    ['\uFE50', 2, 'a small comma, U+FE50'],
    ['\uFE6B', 2, 'U+FE6B'],
    ['\u{17000}', 2, 'Tangut, U+17000'],
    ['\u{18AFF}', 2, 'a Tangut component'],
    ['\u{1B000}', 2, 'a kana supplement, U+1B000'],
    ['\u{1B2FF}', 2, 'U+1B2FF'],
    // flag letters pair with each other and nothing else
    ['\u{1F1EC}\u200D\u{1F1E7}', 4, 'a joiner parts two flag letters'],
    ['\u{1F1EC}\u{1F3FD}\u{1F1E7}', 6, 'a skin tone between two flag letters is a square, and parts them'],
    // a symbol joined to a picture and asked for in its text form stands beside it
    ['\u{1F469}\u200D\u2764\uFE0E', 3, 'a person, a joiner and a heart in its text form'],
    ['\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F468}', 2, 'the couple with a heart is one picture'],
    // marks that are not drawn
    ['2\u00AD04', 3, 'a soft hyphen'],
    ['\u200F204', 3, 'a right-to-left mark'],
    ['\u2067204\u2069', 3, 'a direction isolate'],
  ];
  for (const [text, width, name] of rows) assert.equal(signWidth(text), width, name);
  assert.equal(signFit('1\uFE0F\u20E3'.repeat(4)), 7 / 8, 'four keycaps are eight wide, set smaller');
});

// SV2-53 item 2, the Foreman's sw2.mjs. A symbol asked for in its text form
// (U+FE0E) is a letter, not a picture: a joiner after it joins nothing and a
// skin tone after it is a square. A symbol with its skin tone is an emoji
// whatever follows. The two-em and three-em dashes are two and three letters
// long, and the letters the sign's face draws wider than a seventh of the line
// count their width (measured in Barlow Semi Condensed 600), so seven W's are
// set small enough to stay on one line (the browser case is staff-outputs.mjs).
// The line is a phone card's, whose borders are inside the sheet: there H and
// U are a hair over a seventh of it (SV2-58 item 3).
test('the sign does not count short after a text-form symbol, for a toned symbol, for the long dashes, or for the broad letters', () => {
  const rows = [
    ['\u2764\uFE0E\u200D\u{1F525}'.repeat(4), 12, 'a heart in text form, a joiner and fire, four times: the joiner joins nothing'],
    ['\u2764\uFE0E\u200D\u{1F525}', 3, 'once'],
    ['\u261D\uFE0E\u{1F3FD}', 3, 'a skin tone after a text-form symbol is a square of its own'],
    ['\u261D\uFE0E\u{1F3FD}'.repeat(4), 12, 'four times'],
    ['\u261D\u{1F3FD}\uFE0E', 2, 'a toned symbol is an emoji, whatever follows'],
    ['\u261D\u{1F3FD}', 2, 'as it is with nothing after it'],
    ['\u2E3A', 2, 'the two-em dash'],
    ['\u2E3B', 3, 'the three-em dash'],
    ['A\u2E3BB\u2E3BC', 9, 'letters between three-em dashes'],
    ['WWWWWWW', 10.5, 'seven W\'s are ten and a half letters'],
    ['MW-1004', 7.75, 'M and W are broad, the rest one each'],
    ['mw%@', 5.75, 'the broad lower-case letters and signs'],
    ['\u00C6\u00BE', 3.5, 'AE and three quarters'],
    ['HHHHHHH', 7.07, 'H is a hair over a seventh of a phone card\'s line (SV2-58 item 3), and only a hair (SV2-58b)'],
    ['UUUUUUU', 7.07, 'and U'],
    ['\u00D9\u00DA\u00DB\u00DC', 4.04, 'and the accented U\'s'],
    ['DDDDDDD', 7, 'the widest letters that are not broad fit seven'],
    ['#\uFE0F\u20E3', 2, 'a broad sign made a keycap is two, not more'],
  ];
  // a sum of hundredths is not exact in binary
  for (const [text, width, name] of rows) assert.ok(Math.abs(signWidth(text) - width) < 1e-9, name + ': ' + signWidth(text));
  assert.equal(signFit('WWWWWWW'), 7 / 10.5);
  assert.ok(Math.abs(signFit('HHHHHHH') - 7 / 7.07) < 1e-9);
  assert.equal(signFit('DDDDDDD'), 1);
});

// SV2-58b. SV2-58 counted H, U and the accented U's a quarter more than a
// letter, where a phone card's line needs 1.0033 of one at 356 px and 1.0057
// at 260 (0.557 em against a seventh of 3.886 and 3.877 em), so a room number
// of seven letters with one H in it, which stood at full size, was set at
// 0.966 of it (the review's width-diff58.mjs: 104,992 of 400,000 such numbers
// set smaller). They count 1.01: what the line forces, and no more.
test('H and U count what a phone card\'s line needs of them, a hundredth over a letter: seven letters with an H are set at all but full size', () => {
  const unit = (card) => (0.88 * card - 2) / (0.225 * card) / 7; // a seventh of the line, in em
  for (const card of [356, 320, 286, 260, 200, 176]) {
    assert.ok(signWidth('H') >= 0.557 / unit(card), 'H holds seven on a card ' + card + ' px wide');
  }
  assert.ok(signWidth('H') <= 1.01, 'H counts no more than its need rounded up to a hundredth: ' + signWidth('H'));
  for (const text of ['HALL 12', 'HUB-101', 'HUT-101', '\u00DCBER 12']) {
    assert.ok(signFit(text) > 0.99, text + ' is set at ' + signFit(text));
  }
  assert.equal(signFit('HALL 12'), 7 / 7.01);
  assert.equal(signFit('H-101'), 1, 'a short number with an H is at full size');
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
    ['room-schedules', false, null],
    ['whole-school', true, UPRIGHT_ALL_SENTENCE],
  ]);
});
