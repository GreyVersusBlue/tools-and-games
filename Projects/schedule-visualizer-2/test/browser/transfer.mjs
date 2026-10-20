// Send to another device, in a real browser: node test/browser/transfer.mjs
//
// Two pages of one Chromium, each in a browser context of its own (so each
// has its own IndexedDB and is the editing tab of its own project), talk
// over WebRTC on this machine with no ICE server. The test carries the two
// codes between them through the paste fields, as a person copying them
// would. At 1280 by 900 by the keyboard: the sample school sent, progress on
// both sides, the receiver told what each project holds and asked, a
// snapshot and a recovery point taken before it is replaced as one undo step,
// and the sender told it was received and applied. At 390 by 844 with touch:
// the same by finger, the dialog's title and Close in view. Then: keeping
// one's own project; a part damaged on the way (the hash refuses it, nothing
// changes, the sender is told); codes refused with their sentences; a code
// pasted outside the field; a read-only tab refusing to receive; the camera
// path with a fake camera showing the QR code on a canvas (the decoder) and
// with a fake BarcodeDetector, the camera asked for only on Scan and stopped
// on Close; sendFrames keeping the channel's buffer under its mark; the plain
// statement after 20 s with no channel, on both sides, the receiver still
// taking the project after it; axe on both dialogs in both themes.
//
// Every wait is on a state the page sets: the dialogs' data-state,
// data-parts and data-no-channel, the camera's data-camera, a figure.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, startServer, launch, TOOL_DIR } from './harness.mjs';
import { SENTENCES } from '../../ui/project/transfer/words.js';
import { SNAPSHOT_NAME } from '../../ui/project/transfer/receive.js';
import { SENTENCES as ENGINE } from '../../engine/transfer.js';
import { NO_CHANNEL_MS, BUFFER_HIGH } from '../../ui/project/transfer/peer.js';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const SAMPLE_NAME = 'Marrowby Middle School (sample)';
const SEND = 'transfer-send';
const RECEIVE = 'transfer-receive';

let server;
let browser;
const contexts = [];

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- helpers

// A planner in a browser context of its own: its own storage, so it is the
// editing tab of its own project.
async function device(size) {
  const context = await browser.createBrowserContext();
  context.__engine = browser.__engine;
  contexts.push(context);
  const session = await openPlanner({ hash: '#project', server, browser: context, ...size });
  await editable(session.page);
  await catchDownloads(session.page);
  return { session, page: session.page, context };
}

async function done(...devices) {
  for (const each of devices) {
    await each.session.close();
    await each.context.close();
    contexts.splice(contexts.indexOf(each.context), 1);
  }
}

function editable(page) {
  return page.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
}

async function catchDownloads(page) {
  await page.evaluate(() => {
    globalThis.sv2test = { downloads: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (!this.hasAttribute('download')) return click.call(this);
      globalThis.sv2test.downloads.push(this.download);
      return undefined;
    };
  });
}

const figure = (page, name) => page.$eval('.figures__item[data-figure="' + name + '"] dd', (el) => el.textContent);

// A new device opens on the sample school. sample(page, true) makes sure
// it is there; sample(page, false) removes it, leaving an empty project.
async function sample(page, wanted, how) {
  const now = await page.$eval('#sample-school', (el) => el.dataset.sample === 'true');
  if (now !== wanted) {
    if (how === 'tap') await page.tap('#sample-school [data-action="sample"]');
    else await page.click('#sample-school [data-action="sample"]');
  }
  await page.waitForFunction((want) => document.querySelector('#sample-school')?.dataset.sample === String(want), { timeout: 10000 }, wanted);
}

// The dialog is in one of `states`; then which.
async function reaches(page, id, states, timeout) {
  const list = Array.isArray(states) ? states : [states];
  await page.waitForFunction((which, wanted) => {
    const el = document.getElementById(which);
    return el && wanted.includes(el.dataset.state);
  }, { timeout: timeout || 15000 }, id, list);
  return page.$eval('#' + id, (el) => el.dataset.state);
}

// The text of the dialog's status line, and of a line in its body, checked
// to have a box first.
async function said(page, id, line) {
  return page.$eval('#' + id + ' [data-line="' + (line || 'status') + '"]', (el) => {
    if (el.getClientRects().length === 0) throw new Error('the line has no box');
    return el.textContent;
  });
}

const SEND_ENDS = ['applied', 'not-taken', 'lost', 'failed'];
const RECEIVE_ENDS = ['confirm', 'applied', 'kept', 'lost', 'failed'];

const codeOf = (page, kind) => page.$eval('textarea[data-code="' + kind + '"]', (el) => el.value);

// Press a control by the keyboard: focus it, then Enter.
async function press(page, selector) {
  await page.focus(selector);
  await page.keyboard.press('Enter');
}

// Put a code into a paste field the way a paste does (one insertion), then
// Connect: by Tab and Enter, or by finger.
async function paste(page, kind, code, how) {
  const field = 'textarea[data-paste="' + kind + '"]';
  if (how === 'tap') await page.tap(field);
  else await page.focus(field);
  await page.keyboard.sendCharacter(code);
  if (how === 'tap') {
    await page.tap('[data-action="connect-' + kind + '"]');
  } else {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'connect-' + kind, 'Tab from the field goes to Connect');
    await page.keyboard.press('Enter');
  }
}

// Every value data-parts took on the dialog, from now on, rebuilt from the
// mutation records (a value set and replaced in one task is still counted).
async function watchParts(page, id) {
  await page.waitForSelector('#' + id);
  await page.evaluate((which) => {
    const el = document.getElementById(which);
    const seen = [];
    globalThis.sv2parts = seen;
    let last = el.dataset.parts;
    new MutationObserver((records) => {
      const values = records.map((record) => record.oldValue).slice(1).concat([el.dataset.parts]);
      for (const value of values) {
        if (value && value !== last) seen.push(value);
        last = value;
      }
    }).observe(el, { attributes: true, attributeFilter: ['data-parts'], attributeOldValue: true });
  }, id);
}

function rising(seen, total, side) {
  assert.ok(seen.length >= 2, side + ' showed its progress more than once: ' + seen.join(', '));
  assert.equal(seen[seen.length - 1], total + '/' + total, side + ' ended at every part');
  const done = seen.map((value) => Number(value.split('/')[0]));
  for (let i = 1; i < done.length; i += 1) assert.ok(done[i] > done[i - 1], side + ' only went up: ' + seen.join(', '));
}

// Every record in a store of this page's databases.
function idb(page, storeName) {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open(name === 'recovery' ? 'sv2-recovery' : 'sv2');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const all = db.transaction(name, 'readonly').objectStore(name).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result.map((record) => ({ name: record.name, reason: record.reason })));
      };
      all.onerror = () => reject(all.error);
    };
  }), storeName);
}

// Sender's offer to receiver, receiver's reply to sender, by the paste
// fields. Leaves both waiting on the transfer.
async function connect(a, b, how) {
  if (how === 'tap') await a.page.tap('[data-action="send-project"]');
  else await press(a.page, '[data-action="send-project"]');
  await reaches(a.page, SEND, 'offer');
  const offer = await codeOf(a.page, 'offer');
  assert.match(offer, /^SV2:[A-Za-z0-9_-]+$/);
  if (how === 'tap') await b.page.tap('[data-action="receive-project"]');
  else await press(b.page, '[data-action="receive-project"]');
  await reaches(b.page, RECEIVE, 'offer');
  await paste(b.page, 'offer', offer, how);
  await reaches(b.page, RECEIVE, 'reply');
  const answer = await codeOf(b.page, 'answer');
  await watchParts(a.page, SEND);
  await watchParts(b.page, RECEIVE);
  await paste(a.page, 'answer', answer, how);
  return { offer, answer };
}

// The QR code on screen is drawn, square, and inside the dialog.
async function qrShown(page, id) {
  return page.$eval('#' + id + ' svg.xfer__qr', (svg) => {
    const box = svg.getBoundingClientRect();
    const dialog = svg.closest('dialog').getBoundingClientRect();
    return { width: Math.round(box.width), square: Math.abs(box.width - box.height) < 1, inside: box.left >= dialog.left && box.right <= dialog.right, version: Number(svg.dataset.version) };
  });
}

// The dialog's title and Close lie inside the window.
async function headInView(page, id) {
  return page.$eval('#' + id, (dialog) => {
    const head = dialog.querySelector('.xfer__head').getBoundingClientRect();
    const close = dialog.querySelector('[data-action="close-transfer"]').getBoundingClientRect();
    return head.top >= 0 && close.top >= 0 && close.bottom <= innerHeight && close.right <= innerWidth && close.height >= 44;
  });
}

// ---------------------------------------------------------------- the keyboard at 1280

test('by the keyboard at 1280 by 900: the sample school goes over, is asked about, replaces the other project with a snapshot and a recovery point first, and the sender hears it was applied', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  try {
    await sample(a.page, true);
    await sample(b.page, false);
    assert.equal(await figure(b.page, 'rooms'), '0');
    const pointsBefore = (await idb(b.page, 'recovery')).length;

    // every connection either page makes is asked for with no ICE server
    for (const page of [a.page, b.page]) {
      await page.evaluate(() => {
        const Real = globalThis.RTCPeerConnection;
        globalThis.sv2configs = [];
        globalThis.RTCPeerConnection = function made(config) {
          globalThis.sv2configs.push(JSON.parse(JSON.stringify(config === undefined ? null : config)));
          return new Real(config);
        };
        globalThis.RTCPeerConnection.prototype = Real.prototype;
      });
    }
    await connect(a, b, 'keyboard');
    const chunks = Number(await a.page.$eval('#' + SEND, (el) => el.dataset.chunks));
    assert.equal(chunks, 4, 'the sample school is four parts of 16 KB');
    for (const page of [a.page, b.page]) assert.deepEqual(await page.evaluate(() => globalThis.sv2configs), [{ iceServers: [] }], 'one connection, no ICE server');

    assert.equal(await reaches(b.page, RECEIVE, RECEIVE_ENDS), 'confirm', 'the receiver asks before anything is replaced');
    await reaches(a.page, SEND, ['sent', 'sending']);
    rising(await b.page.evaluate(() => globalThis.sv2parts), chunks, 'the receiver');
    rising(await a.page.evaluate(() => globalThis.sv2parts), chunks, 'the sender');

    // the question: what arrived, what is here, the snapshot; the safe answer focused
    assert.equal(await said(b.page, RECEIVE), 'The whole project has arrived and checks out. Replace your project with it?');
    assert.match(await said(b.page, RECEIVE, 'arrived'), new RegExp('^It is ' + SAMPLE_NAME.replace(/[()]/g, '\\$&') + '\\. It holds 3 floors, 13 rooms, 12 teachers, 8 groups, \\d+ subjects and 2 day types\\.$'));
    assert.match(await said(b.page, RECEIVE, 'here'), /^It takes the place of everything in this project: 1 floor, no rooms, no teachers, no groups, \d+ subjects and 2 day types\.$/);
    assert.equal(await said(b.page, RECEIVE, 'safety'), 'A recovery point of this project is taken first, with a snapshot of it, “' + SNAPSHOT_NAME + '”, that you can restore from Snapshots at any time. Undo brings it back while this tab stays open.');
    assert.equal(await b.page.evaluate(() => document.activeElement.dataset.action), 'keep-project', 'Keep my project, the safe one, is focused');
    assert.equal(await figure(b.page, 'rooms'), '0', 'nothing is replaced before the answer');

    await b.page.keyboard.down('Shift');
    await b.page.keyboard.press('Tab');
    await b.page.keyboard.up('Shift');
    assert.equal(await b.page.evaluate(() => document.activeElement.textContent), 'Replace my project');
    await b.page.keyboard.press('Enter');

    assert.equal(await reaches(b.page, RECEIVE, RECEIVE_ENDS.slice(1)), 'applied');
    assert.match(await said(b.page, RECEIVE), /^Received and applied: 3 floors, 13 rooms, .* are here now\. Undo brings back the project that was here\.$/);
    assert.equal(await reaches(a.page, SEND, SEND_ENDS), 'applied', 'the sender hears the project was applied');
    assert.equal(await said(a.page, SEND), SENTENCES.applied);

    // replaced, one undo step, with the snapshot and the recovery point
    await b.page.keyboard.press('Escape');
    await b.page.waitForFunction(() => document.getElementById('transfer-receive') === null);
    assert.equal(await b.page.evaluate(() => document.activeElement.dataset.action), 'receive-project', 'the focus goes back to the opener');
    assert.equal(await figure(b.page, 'rooms'), '13');
    assert.equal(await b.page.evaluate(() => globalThis.sv2.store.project.settings.schoolName), SAMPLE_NAME);
    assert.equal(await b.page.evaluate(() => globalThis.sv2.store.project.id), await a.page.evaluate(() => globalThis.sv2.store.project.id), 'the project keeps its identity');
    const snapshots = await idb(b.page, 'snapshots');
    assert.deepEqual(snapshots.map((each) => each.name), [SNAPSHOT_NAME], 'a snapshot was taken before the replacement');
    const points = await idb(b.page, 'recovery');
    assert.ok(points.length > pointsBefore && points.some((each) => each.reason === 'import'), 'a recovery point "import" was taken: ' + JSON.stringify(points));
    await b.page.evaluate(() => globalThis.sv2.ctx.undo());
    await b.page.waitForFunction(() => document.querySelector('.figures__item[data-figure="rooms"] dd')?.textContent === '0');

    await a.page.keyboard.press('Escape');
    await a.page.waitForFunction(() => document.getElementById('transfer-send') === null);
    assert.equal(await a.page.evaluate(() => document.activeElement.dataset.action), 'send-project');
    for (const each of [a, b]) assert.deepEqual(each.session.problems().errors, []);
  } finally {
    await done(a, b);
  }
});

// ---------------------------------------------------------------- touch at 390

test('by finger at 390 by 844: the same, with the title and Close in view and the QR code inside the dialog', async () => {
  const size = { width: 390, height: 844, mobile: true };
  const a = await device(size);
  const b = await device(size);
  try {
    await sample(a.page, true, 'tap');
    await sample(b.page, false, 'tap');
    await a.page.tap('[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    const qr = await qrShown(a.page, SEND);
    assert.ok(qr.square && qr.inside, 'the QR code is square and inside the dialog: ' + JSON.stringify(qr));
    assert.ok(qr.width >= 3 * (17 + 4 * qr.version + 8) - 1, 'at least 3 px a module: ' + JSON.stringify(qr));
    assert.ok(await headInView(a.page, SEND), 'the title and Close are in view');
    // scrolled to the body's last control, that control and the head are both in view
    const last = await a.page.$eval('#' + SEND, (dialog) => {
      const button = dialog.querySelector('[data-action="scan-answer"]');
      button.scrollIntoView({ block: 'nearest' });
      const box = button.getBoundingClientRect();
      return box.top >= dialog.querySelector('.xfer__head').getBoundingClientRect().bottom && box.bottom <= innerHeight;
    });
    assert.ok(last, 'the last control comes into view under the head');
    assert.ok(await headInView(a.page, SEND), 'the title and Close stay in view with the body scrolled');
    await a.page.tap('[data-action="close-transfer"]');
    await a.page.waitForFunction(() => document.getElementById('transfer-send') === null);

    await connect(a, b, 'tap');
    await reaches(b.page, RECEIVE, 'confirm');
    assert.ok(await headInView(b.page, RECEIVE), 'the receiver\'s title and Close are in view');
    rising(await b.page.evaluate(() => globalThis.sv2parts), 4, 'the receiver');
    await b.page.tap('[data-action="replace-project"]');
    await reaches(b.page, RECEIVE, 'applied');
    await reaches(a.page, SEND, 'applied');
    rising(await a.page.evaluate(() => globalThis.sv2parts), 4, 'the sender');
    await b.page.tap('[data-action="close-transfer"]');
    await b.page.waitForFunction(() => document.getElementById('transfer-receive') === null);
    assert.equal(await figure(b.page, 'rooms'), '13');
    for (const each of [a, b]) assert.deepEqual(each.session.problems().errors, []);
  } finally {
    await done(a, b);
  }
});

test('on a phone on its side, 844 by 390, the QR code is whole in the window under the dialog\'s head', async () => {
  const a = await device({ width: 844, height: 390, mobile: true });
  try {
    await a.page.tap('[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    // scrolled to the code: all of it lies between the head and the window's foot
    const placed = await a.page.$eval('#transfer-send', (dialog) => {
      const svg = dialog.querySelector('svg.xfer__qr');
      svg.scrollIntoView({ block: 'center' });
      const qr = svg.getBoundingClientRect();
      const head = dialog.querySelector('.xfer__head').getBoundingClientRect();
      return { top: qr.top, bottom: qr.bottom, head: head.bottom, window: innerHeight };
    });
    assert.ok(placed.top >= placed.head && placed.bottom <= placed.window, 'the QR code is whole in view: ' + JSON.stringify(placed));
    assert.ok(await headInView(a.page, SEND));
  } finally {
    await done(a);
  }
});

// ---------------------------------------------------------------- refusals

test('Keep my project changes nothing, and the sender is told the project was not taken', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  try {
    await sample(a.page, true);
    await sample(b.page, false);
    await connect(a, b, 'keyboard');
    await reaches(b.page, RECEIVE, 'confirm');
    await b.page.keyboard.press('Enter');
    assert.equal(await reaches(b.page, RECEIVE, 'kept'), 'kept');
    assert.equal(await said(b.page, RECEIVE), SENTENCES.kept);
    await reaches(a.page, SEND, 'not-taken');
    assert.equal(await said(a.page, SEND), SENTENCES.notTaken);
    assert.equal(await figure(b.page, 'rooms'), '0');
    assert.deepEqual(await idb(b.page, 'snapshots'), [], 'no snapshot for a project kept');
  } finally {
    await done(a, b);
  }
});

test('a part damaged on the way: the hash refuses it, nothing changes, and the sender hears it was not taken', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  try {
    await sample(a.page, true);
    await sample(b.page, false);
    // the sender's second part has one byte changed as it goes
    await a.page.evaluate(() => {
      const send = RTCDataChannel.prototype.send;
      let binary = 0;
      RTCDataChannel.prototype.send = function sent(data) {
        if (typeof data !== 'string') {
          binary += 1;
          if (binary === 2) {
            const copy = new Uint8Array(data);
            copy[100] ^= 0xff;
            return send.call(this, copy);
          }
        }
        return send.call(this, data);
      };
    });
    await connect(a, b, 'keyboard');
    await reaches(b.page, RECEIVE, 'failed');
    assert.equal(await said(b.page, RECEIVE), ENGINE.wrongHash);
    await reaches(a.page, SEND, 'not-taken');
    assert.equal(await figure(b.page, 'rooms'), '0');
    assert.deepEqual(await idb(b.page, 'snapshots'), []);
    // the other way: Go to Import a project file closes on the Project file card's button
    await press(b.page, '#transfer-receive [data-action="transfer-import"]');
    await b.page.waitForFunction(() => document.getElementById('transfer-receive') === null && document.activeElement?.dataset.action === 'import-project');
  } finally {
    await done(a, b);
  }
});

test('codes that are not right are refused with their sentences, and a code pasted outside the field is taken', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  try {
    await press(a.page, '[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    const offer = await codeOf(a.page, 'offer');
    await press(b.page, '[data-action="receive-project"]');
    await reaches(b.page, RECEIVE, 'offer');

    await paste(b.page, 'offer', 'hello', 'keyboard');
    await b.page.waitForFunction(() => document.querySelector('#transfer-receive [data-line="refused"]').textContent !== '');
    assert.equal(await said(b.page, RECEIVE, 'refused'), ENGINE.notCode);
    const broken = offer.slice(0, 40) + (offer[40] === 'A' ? 'B' : 'A') + offer.slice(41);
    await b.page.$eval('textarea[data-paste="offer"]', (el) => { el.value = ''; });
    await paste(b.page, 'offer', broken, 'keyboard');
    await b.page.waitForFunction((text) => document.querySelector('#transfer-receive [data-line="refused"]').textContent === text, { timeout: 5000 }, ENGINE.mistyped);
    // the sender's own code given back to it as a reply
    await paste(a.page, 'answer', offer, 'keyboard');
    await a.page.waitForFunction((text) => document.querySelector('#transfer-send [data-line="refused"]')?.textContent === text, { timeout: 5000 }, ENGINE.wantedAnswer);
    assert.equal(await reaches(a.page, SEND, 'offer'), 'offer', 'a refused reply leaves the code shown');

    // pasted with the focus on Close, not in the field
    await b.page.focus('#transfer-receive [data-action="close-transfer"]');
    await b.page.evaluate((code) => {
      const data = new DataTransfer();
      data.setData('text/plain', '  ' + code + '\n');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, offer);
    await reaches(b.page, RECEIVE, 'reply');
    assert.equal(await b.page.$eval('#transfer-receive [data-line="status"]', (el) => el.textContent), SENTENCES.replyShown);
  } finally {
    await done(a, b);
  }
});

test('a read-only tab cannot receive, and says why', async () => {
  const b = await device({ width: 1280, height: 900 });
  const second = await openPlanner({ hash: '#project', server, browser: b.context, width: 1280, height: 900, keep: true });
  try {
    await second.page.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && globalThis.sv2.storage.state.readOnly === true, { timeout: 15000 });
    await press(second.page, '[data-action="receive-project"]');
    await reaches(second.page, RECEIVE, 'read-only');
    assert.equal(await said(second.page, RECEIVE), SENTENCES.readOnly);
  } finally {
    await second.close();
    await done(b);
  }
});

// ---------------------------------------------------------------- the camera

// A fake camera on the receiving page: a canvas showing the sending page's
// QR code (or nothing), its captureStream as the camera's stream.
async function fakeCamera(page, svgMarkup) {
  await page.evaluate(async (markup) => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 720;
    const g = canvas.getContext('2d');
    let image = null;
    if (markup) {
      image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
      await image.decode();
    }
    // a camera keeps sending frames; so does this
    const paint = () => {
      g.fillStyle = '#d8d4cc';
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (image) g.drawImage(image, 300, 180, 360, 360);
    };
    paint();
    globalThis.sv2camera = { asked: 0, streams: [], timer: setInterval(paint, 50) };
    navigator.mediaDevices.getUserMedia = async () => {
      globalThis.sv2camera.asked += 1;
      const stream = canvas.captureStream(20);
      globalThis.sv2camera.streams.push(stream);
      return stream;
    };
  }, svgMarkup);
}

const tracksLive = (page) => page.evaluate(() => globalThis.sv2camera.streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === 'live').length);

test('the camera reads the sending device\'s QR code through the decoder, asked for only on Scan and stopped once read', async () => {
  const size = { width: 390, height: 844, mobile: true };
  const a = await device(size);
  const b = await device(size);
  try {
    await sample(a.page, true, 'tap');
    await a.page.tap('[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    // an svg in an HTML page serialises without its namespace; an image needs it
    const markup = await a.page.$eval('#transfer-send svg.xfer__qr', (svg) => svg.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    await fakeCamera(b.page, markup);
    await b.page.tap('[data-action="receive-project"]');
    await reaches(b.page, RECEIVE, 'offer');
    assert.equal(await b.page.evaluate(() => globalThis.sv2camera.asked), 0, 'the camera is not asked for before Scan');
    await b.page.tap('[data-action="scan-offer"]');
    await reaches(b.page, RECEIVE, 'reply', 20000);
    assert.equal(await b.page.evaluate(() => globalThis.sv2camera.asked), 1);
    assert.equal(await tracksLive(b.page), 0, 'the camera is stopped once the code is read');
    assert.equal(await b.page.$eval('textarea[data-paste="offer"]', (el) => el.value).catch(() => 'gone'), 'gone', 'the field went with the step');
    // and the reply goes back by paste, and the project over
    await watchParts(b.page, RECEIVE);
    await paste(a.page, 'answer', await codeOf(b.page, 'answer'), 'tap');
    await reaches(b.page, RECEIVE, 'confirm');
  } finally {
    await done(a, b);
  }
});

test('where the browser has a BarcodeDetector it reads the frames, and Close stops a camera that has read nothing', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  try {
    await press(a.page, '[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    const offer = await codeOf(a.page, 'offer');

    // nothing in front of the camera: Close stops it
    await fakeCamera(b.page, null);
    await press(b.page, '[data-action="receive-project"]');
    await reaches(b.page, RECEIVE, 'offer');
    await press(b.page, '[data-action="scan-offer"]');
    await b.page.waitForFunction(() => document.querySelector('#transfer-receive .xfer__camera')?.dataset.camera === 'on' && Number(document.querySelector('#transfer-receive .xfer__camera').dataset.reads) >= 3, { timeout: 10000 });
    assert.equal(await b.page.$eval('#transfer-receive .xfer__camera', (el) => el.dataset.reader), 'decoder');
    assert.equal(await tracksLive(b.page), 1);
    await press(b.page, '#transfer-receive [data-action="close-transfer"]');
    await b.page.waitForFunction(() => document.getElementById('transfer-receive') === null);
    assert.equal(await tracksLive(b.page), 0, 'Close stops the camera');

    // a detector that sees the code
    await b.page.evaluate((code) => {
      globalThis.sv2detected = 0;
      globalThis.BarcodeDetector = class {
        static async getSupportedFormats() {
          return ['qr_code', 'ean_13'];
        }

        async detect() {
          globalThis.sv2detected += 1;
          return [{ rawValue: code, format: 'qr_code' }];
        }
      };
    }, offer);
    await press(b.page, '[data-action="receive-project"]');
    await reaches(b.page, RECEIVE, 'offer');
    await press(b.page, '[data-action="scan-offer"]');
    await reaches(b.page, RECEIVE, 'reply');
    assert.ok(await b.page.evaluate(() => globalThis.sv2detected) >= 1, 'the detector was asked');
    assert.equal(await tracksLive(b.page), 0);
  } finally {
    await done(a, b);
  }
});

// ---------------------------------------------------------------- back-pressure

test('sendFrames keeps what waits in the channel under its mark, and every frame arrives in order', async () => {
  const a = await device({ width: 1280, height: 900 });
  try {
    await a.page.addScriptTag({ type: 'module', content: `
      import { sendFrames, BUFFER_HIGH } from './ui/project/transfer/peer.js';
      const one = new RTCPeerConnection({ iceServers: [] });
      const two = new RTCPeerConnection({ iceServers: [] });
      one.onicecandidate = (event) => event.candidate && two.addIceCandidate(event.candidate);
      two.onicecandidate = (event) => event.candidate && one.addIceCandidate(event.candidate);
      const channel = one.createDataChannel('sv2-transfer', { ordered: true });
      const got = [];
      two.ondatachannel = (event) => {
        event.channel.binaryType = 'arraybuffer';
        event.channel.onmessage = (message) => got.push(new DataView(message.data).getUint32(0));
      };
      await one.setLocalDescription(await one.createOffer());
      await two.setRemoteDescription(one.localDescription);
      await two.setLocalDescription(await two.createAnswer());
      await one.setRemoteDescription(two.localDescription);
      await new Promise((resolve) => { channel.onopen = resolve; });
      const frames = [];
      for (let i = 0; i < 400; i += 1) {
        const frame = new Uint8Array(16392);
        new DataView(frame.buffer).setUint32(0, i);
        frames.push(frame);
      }
      let most = 0;
      let waits = 0;
      channel.addEventListener('bufferedamountlow', () => { waits += 1; });
      await sendFrames(channel, frames, () => { most = Math.max(most, channel.bufferedAmount); });
      const end = channel.bufferedAmount;
      await new Promise((resolve) => { const check = () => (got.length === 400 ? resolve() : setTimeout(check, 20)); check(); });
      globalThis.sv2pressure = { most, waits, end, inOrder: got.every((value, i) => value === i), got: got.length, high: BUFFER_HIGH };
    ` });
    const result = await (await a.page.waitForFunction(() => globalThis.sv2pressure, { timeout: 30000 })).jsonValue();
    assert.ok(result.most <= BUFFER_HIGH + 16392, 'never more than the mark and one frame waiting: ' + JSON.stringify(result));
    assert.ok(result.waits >= 1, 'it waited for the buffer at least once: ' + JSON.stringify(result));
    assert.equal(result.end, 0, 'resolved only once the buffer was empty');
    assert.equal(result.got, 400);
    assert.ok(result.inOrder);
  } finally {
    await done(a);
  }
});

// ---------------------------------------------------------------- no channel

test('after ' + NO_CHANNEL_MS / 1000 + ' s with no channel both sides say so plainly and offer the project file, and a late connection still goes through', async () => {
  const a = await device({ width: 1280, height: 900 });
  const b = await device({ width: 1280, height: 900 });
  const c = await device({ width: 1280, height: 900 });
  try {
    await sample(a.page, true);
    await sample(b.page, false);
    // b waits on a reply a has not been given
    await press(a.page, '[data-action="send-project"]');
    await reaches(a.page, SEND, 'offer');
    const offer = await codeOf(a.page, 'offer');
    await press(b.page, '[data-action="receive-project"]');
    await reaches(b.page, RECEIVE, 'offer');
    // the page's own clock at the reply shown and at the statement
    await b.page.evaluate(() => {
      const el = document.getElementById('transfer-receive');
      globalThis.sv2times = {};
      new MutationObserver(() => {
        if (el.dataset.state === 'reply' && globalThis.sv2times.reply === undefined) globalThis.sv2times.reply = performance.now();
        if (el.dataset.noChannel === 'true' && globalThis.sv2times.said === undefined) globalThis.sv2times.said = performance.now();
      }).observe(el, { attributes: true });
    });
    await paste(b.page, 'offer', offer, 'keyboard');
    await reaches(b.page, RECEIVE, 'reply');
    const answer = await codeOf(b.page, 'answer');

    // c's sender is given a reply from a device that has gone
    await press(c.page, '[data-action="send-project"]');
    await reaches(c.page, SEND, 'offer');
    const other = await codeOf(c.page, 'offer');
    const gone = await device({ width: 1280, height: 900 });
    await press(gone.page, '[data-action="receive-project"]');
    await reaches(gone.page, RECEIVE, 'offer');
    await paste(gone.page, 'offer', other, 'keyboard');
    await reaches(gone.page, RECEIVE, 'reply');
    const dead = await codeOf(gone.page, 'answer');
    await done(gone);
    await paste(c.page, 'answer', dead, 'keyboard');
    await reaches(c.page, SEND, 'connecting');

    await c.page.waitForFunction(() => document.getElementById('transfer-send')?.dataset.noChannel === 'true', { timeout: NO_CHANNEL_MS + 10000 });
    // said at NO_CHANNEL_MS, or sooner when the connection itself says it failed
    assert.equal(await said(c.page, SEND, 'no-channel').then((text) => text.startsWith(SENTENCES.noChannelSending)), true);
    await press(c.page, '#transfer-send [data-action="transfer-export"]');
    await c.page.waitForFunction(() => globalThis.sv2test.downloads.length === 1);
    assert.match(await c.page.evaluate(() => globalThis.sv2test.downloads[0]), /\.json$/);

    await b.page.waitForFunction(() => document.getElementById('transfer-receive')?.dataset.noChannel === 'true', { timeout: NO_CHANNEL_MS + 10000 });
    const times = await b.page.evaluate(() => globalThis.sv2times);
    const waited = times.said - times.reply;
    assert.ok(waited >= NO_CHANNEL_MS - 50 && waited < NO_CHANNEL_MS + 3000, 'the receiver said it at ' + NO_CHANNEL_MS + ' ms after showing its reply: ' + Math.round(waited) + ' ms');
    assert.equal(await said(b.page, RECEIVE, 'no-channel').then((text) => text.startsWith(SENTENCES.noChannelReceiving)), true);
    assert.equal(await reaches(b.page, RECEIVE, 'reply'), 'reply', 'still waiting');

    // the late reply: the receiver still takes the project
    await paste(a.page, 'answer', answer, 'keyboard');
    await reaches(b.page, RECEIVE, 'confirm');
    assert.equal(await b.page.$eval('#transfer-receive', (el) => el.dataset.noChannel === undefined), true, 'the statement goes once connected');
  } finally {
    await done(a, b, c);
  }
});

// ---------------------------------------------------------------- axe

for (const theme of ['light', 'dark']) {
  test('axe finds nothing on the sending dialog and the receiving question, in the ' + theme + ' theme', async () => {
    const a = await device({ width: 1280, height: 900, theme });
    const b = await device({ width: 1280, height: 900, theme });
    try {
      await sample(a.page, true);
      await connect(a, b, 'keyboard');
      await reaches(b.page, RECEIVE, 'confirm');
      for (const page of [a.page, b.page]) {
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
        await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
        await page.addScriptTag({ path: AXE });
      }
      await press(a.page, '#transfer-send [data-action="close-transfer"]');
      await press(a.page, '[data-action="send-project"]');
      await reaches(a.page, SEND, 'offer');
      for (const [page, id] of [[a.page, SEND], [b.page, RECEIVE]]) {
        const found = await page.evaluate((which, tags) => globalThis.axe.run(document.getElementById(which), { runOnly: { type: 'tag', values: tags } }), id, TAGS);
        assert.ok(found.passes.length > 5, 'axe ran very few rules');
        assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], id);
      }
    } finally {
      await done(a, b);
    }
  });
}
