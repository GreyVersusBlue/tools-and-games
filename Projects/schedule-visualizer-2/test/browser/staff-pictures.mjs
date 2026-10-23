// Every staff page saved as an image (spec 12.4 and 17), driven in Chromium
// from a published file on disk: node test/browser/staff-pictures.mjs
//
//   First in plain Node: what each picture is called, and the scale a page
//   is drawn at. Then the file itself, assembled here exactly as the planner
//   assembles it and opened from file://, with the clock pinned through
//   `sv2StaffClock` and the browser's zone set to New York.
//
// The picture is held to the page: a screenshot of the page and the picture
// the page made are cut into squares of 6 page pixels, and a square with ink
// in one has ink in the other. What paper leaves out (the buttons under the
// page) is paper in the picture. Every wait is on the line the page writes
// when the image has been handed over.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launch } from './harness.mjs';
import { diskReader } from '../publish/reader.mjs';
import { publishDocument } from '../../ui/staff/targets.js';
import { seededRandom } from '../../engine/ids.js';
import { sampleSchool } from '../../data/sample-school.js';
import { pictureName, pictureScale, fileWords, PICTURE_LEAVES, PICTURE_SCALE, PICTURE_WIDE_SCALE, PICTURE_MOST_SIDE, PICTURE_TOO_LONG, PICTURE_SAVED } from '../../staff/page.js';

const ZONE = 'America/New_York';
const AT_0950 = '2026-09-01T13:50:00Z'; // A Day: Period 3
const HOSTILE = '<img src=x onerror="window.__pwned=1"> </script><b>"Ünï" 東京 ‮evil\u0001';
const future = () => new Date('2999-01-01T12:00:00Z');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-staff-pictures-'));
const read = diskReader();
const files = {};
let browser;

async function write(name, change) {
  const project = sampleSchool();
  project.publish.passcode = '';
  if (change) change(project);
  const published = await publishDocument(read, project, { clock: future, random: seededRandom('staff-pictures ' + name) });
  const file = path.join(scratch, name + '.html');
  writeFileSync(file, published.html);
  files[name] = { file, url: pathToFileURL(file).href };
}

// ---------------------------------------------------------------- plain Node

test('a picture is named for what it is, then for the page\'s heading, in letters and digits only', () => {
  assert.equal(pictureName('door', 'Door sign: Room 101'), 'door-sign-room-101.png', 'the heading\'s "Door sign" is not said twice');
  assert.equal(pictureName('sub', 'Substitute plan: Dr. Quillfeather'), 'substitute-plan-dr-quillfeather.png');
  assert.equal(pictureName('group', '6A'), 'group-6a.png', 'a group\'s page says it is a group');
  assert.equal(pictureName('room', 'Room 203'), 'room-203.png');
  assert.equal(pictureName('room', 'Cafeteria'), 'room-cafeteria.png');
  assert.equal(pictureName('map', 'Building map: Floor 1'), 'building-map-floor-1.png');
  assert.equal(pictureName('free', 'Free right now'), 'free-right-now.png');
  assert.equal(pictureName('coverage', 'Coverage: Dr. Quillfeather'), 'coverage-dr-quillfeather.png');
  assert.equal(pictureName('staffing', 'Staffing'), 'staffing.png');
  assert.equal(pictureName('group', HOSTILE), 'group-img-src-x-onerror-window-pwned-1-script-b-ünï-東京-evil.png', 'markup, quotes, a direction mark and a control character are never in a file name');
  assert.equal(pictureName('group', '../../etc/passwd'), 'group-etc-passwd.png');
  assert.equal(pictureName('group', '   '), 'group.png', 'a heading of nothing names the view alone');
  assert.equal(pictureName('nothing', ''), 'page.png');
  const long = pictureName('group', 'Ж'.repeat(300));
  assert.ok(Array.from(long).length <= 84, 'at most 80 letters before ".png": ' + Array.from(long).length);
  assert.ok(Buffer.byteLength(long) < 255, 'a disk takes the name: ' + Buffer.byteLength(long) + ' bytes');
  assert.equal(fileWords('  Ms. O’Neil  '), 'ms-o-neil');
});

test('a name\'s vowel signs and accents stay with its letters, and the name stays one a disk takes', () => {
  // Devanagari's vowel signs are marks (\p{M}), not letters
  assert.equal(fileWords('दीपा'), 'दीपा');
  assert.equal(pictureName('teacher', 'दीपा'), 'schedule-दीपा.png');
  assert.equal(pictureName('group', 'Kristiina Ka\u0301rdenas'), 'group-kristiina-kárdenas.png', 'a decomposed accent is composed with its letter');
  assert.equal(pictureName('group', 'تَعَلُّم'), 'group-تَعَلُّم.png', 'Arabic\'s vowel marks are kept');
  assert.equal(pictureName('group', '\u0301\u0308 6A'), 'group-6a.png', 'a mark with no letter before it is not a word');
  assert.equal(pictureName('room', 'CON'), 'room-con.png', 'a reserved name is never the whole name');
  assert.equal(pictureName('nothing', 'NUL'), 'page-nul.png');
  assert.equal(pictureName('room', 'Room 101.'), 'room-101.png', 'no dot before ".png" but its own');
  const long = pictureName('teacher', 'दीपा '.repeat(60));
  assert.ok(Array.from(long).length <= 84, 'at most 80 characters before ".png": ' + Array.from(long).length);
  assert.ok(!/-\.png$/.test(long), long);
});

test('a page is drawn three times over on a phone, twice on a desktop, less only where a canvas cannot hold it, and refused under one', () => {
  assert.equal(pictureScale(422, 2000), PICTURE_SCALE);
  assert.equal(pictureScale(752, 2000), PICTURE_WIDE_SCALE);
  // 6,000 page pixels tall at three is 18,000: past a canvas's side
  assert.equal(pictureScale(422, 6000), 2.5);
  assert.ok(Math.ceil(6000 * pictureScale(422, 6000)) <= PICTURE_MOST_SIDE);
  // the area cap: 1,000 by 8,000 at two is 32 million pixels, at 1.25 12.5 million
  assert.equal(pictureScale(1000, 8000), 1.25);
  assert.equal(pictureScale(752, 40000), 0, 'a page a canvas cannot hold at one image pixel a page pixel is refused');
});

// ---------------------------------------------------------------- in the browser

before(async () => {
  await write('open');
  await write('hostile', (project) => {
    project.settings.schoolName = HOSTILE + ' School';
    project.groups[0].name = HOSTILE;
  });
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
});

// A page in a profile of its own, in New York, with the clock pinned. `share`
// is 'files' for a share sheet that takes a file, 'refuses' for one that
// cannot (so the image is a download).
async function openPage(options) {
  const opts = options || {};
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const phone = (opts.width || 390) < 900;
  await page.setViewport({ width: opts.width || 390, height: opts.height || 760, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await page.emulateTimezone(ZONE);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme || 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((at, share) => {
    globalThis.sv2StaffClock = { now: () => at, every: 3600000 };
    globalThis.sv2Shared = [];
    globalThis.sv2Files = [];
    globalThis.sv2Downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clicked() {
      if (this.hasAttribute('download')) globalThis.sv2Downloads.push({ name: this.download, href: this.href });
      else click.call(this);
    };
    Object.defineProperty(navigator, 'share', { configurable: true, value: (what) => {
      globalThis.sv2Shared.push({ title: what.title, files: what.files ? what.files.map((file) => ({ name: file.name, type: file.type })) : null });
      for (const file of what.files || []) globalThis.sv2Files.push(file);
      return Promise.resolve();
    } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (what) => share === 'files' && Boolean(what && what.files && what.files.length > 0) });
  }, AT_0950, opts.share || 'refuses');
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return { page, context, requests, errors, close: () => context.close() };
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('app').dataset.state === 'open', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
}

async function move(page, to, title) {
  await page.evaluate((next) => { location.hash = next; }, to);
  await page.waitForFunction((want, where) => location.hash === where && document.querySelector('h1').textContent === want, { timeout: 5000 }, title, to);
  // every map on the page drawn at the width it has
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.map')).every((frame) => {
    const canvas = frame.querySelector('canvas');
    return frame.dataset.cell && canvas.width === Math.round(frame.clientWidth);
  }), { timeout: 5000 });
}

// Press a page's image button and wait for the line under it to say how it
// went. → that line.
async function save(page, selector) {
  const button = selector || '.page__body [data-output="picture"]';
  await page.evaluate((s) => {
    for (const line of document.querySelectorAll('[data-says="picture"]')) line.textContent = '';
    document.querySelector(s).scrollIntoView({ block: 'center' });
  }, button);
  await page.click(button);
  await page.waitForFunction((s) => {
    const line = document.querySelector(s).parentElement.querySelector('[data-says="picture"]');
    return line.textContent !== '' && line.textContent !== 'Making the image…';
  }, { timeout: 10000 }, button);
  return page.evaluate((s) => document.querySelector(s).parentElement.querySelector('[data-says="picture"]').textContent, button);
}

// The newest image the page handed over, read back: its bytes' signature,
// size, the colour of its corner and how much is drawn on it.
const readImage = (page, from) => page.evaluate(async (source) => {
  const blob = source === 'shared' ? globalThis.sv2Files[globalThis.sv2Files.length - 1] : await (await fetch(globalThis.sv2Downloads[globalThis.sv2Downloads.length - 1].href)).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const paper = Array.from(data.slice(0, 4));
  const inkAt = (x, y) => {
    const at = (y * canvas.width + x) * 4;
    return Math.abs(data[at] - paper[0]) + Math.abs(data[at + 1] - paper[1]) + Math.abs(data[at + 2] - paper[2]) > 60;
  };
  let ink = 0;
  for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) if (inkAt(x, y)) ink += 1;
  return {
    type: blob.type,
    signature: Array.from(bytes.slice(0, 8)).join(' '),
    width: view.getUint32(16),
    height: view.getUint32(20),
    paper: paper.join(','),
    ink,
  };
}, from);

// The squares of `cell` page pixels that have ink, in the newest picture
// handed over (drawn at `frame.scale`, the page `frame.left` and `frame.top`
// page pixels in) and in a screenshot of `frame.selector`, from the page's
// top to `frame.bottom` page pixels.
async function inkSquares(page, from, frame, cell) {
  const target = await page.$(frame.selector);
  const shot = await target.screenshot({ encoding: 'base64', captureBeyondViewport: true });
  return page.evaluate(async (source, shotData, box, side, leaves) => {
    const blob = source === 'shared' ? globalThis.sv2Files[globalThis.sv2Files.length - 1] : await (await fetch(globalThis.sv2Downloads[globalThis.sv2Downloads.length - 1].href)).blob();
    const read = async (made) => {
      const bitmap = await createImageBitmap(made);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const g = canvas.getContext('2d');
      g.drawImage(bitmap, 0, 0);
      return { width: canvas.width, height: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const picture = await read(blob);
    const screen = await read(await (await fetch('data:image/png;base64,' + shotData)).blob());
    const scale = box.scale;
    // Where the page starts down the picture: the offset, from box.top to
    // 150 page pixels under it, at which the rows with ink line up best with
    // the screenshot's. The lines the picture puts over a page are its own
    // size, so the test finds the page under them rather than working the
    // height out again.
    const paperOf = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
    const rowsOf = (image, step, left, paper) => {
      const rows = [];
      for (let y = 0; y < Math.floor(image.height / step); y += 1) {
        let ink = false;
        const yy = Math.round((y + 0.5) * step);
        for (let x = Math.round(left); x < Math.round(left + box.width * step) && !ink; x += 1) {
          const at = (yy * image.width + x) * 4;
          if (Math.abs(image.data[at] - paper[0]) + Math.abs(image.data[at + 1] - paper[1]) + Math.abs(image.data[at + 2] - paper[2]) > 90) ink = true;
        }
        rows.push(ink);
      }
      return rows;
    };
    const screenRows = rowsOf(screen, 1, 0, paperOf(screen, 0, 0)).slice(0, Math.floor(box.bottom));
    const pictureRows = rowsOf(picture, scale, box.left * scale, paperOf(picture, 0, 0));
    let best = { top: box.top, same: -1 };
    for (let top = box.top; top <= box.top + (box.search || 0); top += 1) {
      let same = 0;
      screenRows.forEach((ink, y) => {
        if (ink === Boolean(pictureRows[y + top])) same += 1;
      });
      if (same > best.same) best = { top, same };
    }
    // A square has ink when two or more of its rows of page pixels do: a
    // hairline (a table's rule, a card's edge) is one row on either side, and
    // the browser and the picture can each put it in the square above.
    const squares = (image, step, left, top, paper) => {
      const out = [];
      for (let row = 0; row * side < box.bottom; row += 1) {
        for (let col = 0; (col + 1) * side <= box.width; col += 1) {
          let rows = 0;
          for (let py = row * side + 1; py < (row + 1) * side - 1; py += 1) {
            const y = Math.round((py + 0.5) * step + top - 0.5);
            for (let x = Math.round((col * side + 1) * step + left); x < Math.round(((col + 1) * side - 1) * step + left); x += 1) {
              const at = (y * image.width + x) * 4;
              if (Math.abs(image.data[at] - paper[0]) + Math.abs(image.data[at + 1] - paper[1]) + Math.abs(image.data[at + 2] - paper[2]) > 90) {
                rows += 1;
                break;
              }
            }
          }
          out.push(rows >= 2);
        }
      }
      return out;
    };
    // the squares wholly inside something a picture leaves out
    const frameBox = document.querySelector(box.selector).getBoundingClientRect();
    // (one laid over the page, the map's ring, has the map under it: those
    // squares are not compared and may have ink; each box of a thing counts
    // squares and a link that wraps is two boxes, not the box around both)
    const outs = Array.from(document.querySelector(box.selector).querySelectorAll(leaves)).flatMap((each) => Array.from(each.getClientRects(), (rect) => ({ rect, over: getComputedStyle(each).position === 'absolute' }))).filter((out) => out.rect.width > 0 && out.rect.height > 0);
    const left = [];
    for (let row = 0; row * side < box.bottom; row += 1) {
      for (let col = 0; (col + 1) * side <= box.width; col += 1) {
        const x = frameBox.left + col * side;
        const y = frameBox.top + row * side;
        const inside = outs.filter(({ rect }) => x >= rect.left && x + side <= rect.right && y >= rect.top && y + side <= rect.bottom);
        left.push(inside.length === 0 ? 0 : inside.some((out) => out.over) ? 2 : 1);
      }
    }
    return {
      left,
      picture: squares(picture, scale, box.left * scale, best.top * scale, paperOf(picture, 0, 0)),
      top: best.top,
      cols: Math.floor(box.width / side),
      screen: squares(screen, 1, 0, 0, paperOf(screen, 0, 0)),
      size: [picture.width, picture.height],
    };
  }, from, shot, frame, cell, PICTURE_LEAVES);
}

// How far a picture's squares agree with the screenshot's: a square agrees
// when the other has ink in it, or in the square over or under it, exactly
// when it has ink itself (a hairline on a square's edge falls in either).
// The squares inside something the picture leaves out (PICTURE_LEAVES) are
// not compared; `leftInked` counts those the picture drew on.
function agreement(squares) {
  const near = (list, at) => Boolean(list[at] || list[at - squares.cols] || list[at + squares.cols]);
  let same = 0;
  let of = 0;
  let leftInked = 0;
  squares.screen.forEach((ink, at) => {
    if (squares.left[at]) {
      if (squares.left[at] === 1 && squares.picture[at]) leftInked += 1;
      return;
    }
    of += 1;
    if (ink ? near(squares.picture, at) : !squares.picture[at] || near(squares.screen, at)) same += 1;
  });
  return { same, of, part: same / of, inked: squares.screen.filter(Boolean).length, left: squares.left.filter(Boolean).length, leftInked };
}

// Where a page is: its width and height, and how far from its top its
// buttons start.
const measure = (page) => page.evaluate(() => {
  const body = document.querySelector('.page__body').getBoundingClientRect();
  const outputs = document.querySelector('.page__body > .page__outputs');
  return { width: body.width, height: body.height, outputsTop: outputs ? outputs.getBoundingClientRect().top - body.top : body.height };
});

const PAGES = [
  ['#/group/gsample06a', '6A', 'group-6a.png'],
  ['#/room/rsample203', 'Room 203', 'room-203.png'],
  ['#/map/fsample001', 'Building map: Floor 1', 'building-map-floor-1.png'],
  ['#/staffing', 'Staffing', 'staffing.png'],
  ['#/free', 'Free right now', 'free-right-now.png'],
  ['#/now?g=gsample06a', 'Where right now', 'where-right-now.png'],
  ['#/common?t=tsample001,tsample002', 'Common planning', 'common-planning.png'],
  ['#/coverage/tsample003', 'Coverage: Dr. Quillfeather', 'coverage-dr-quillfeather.png'],
  ['#/sub/tsample003', 'Substitute plan: Dr. Quillfeather', 'substitute-plan-dr-quillfeather.png'],
  ['#/directions?from=rsample101&to=rsample303', 'Directions', 'directions.png'],
];

test('every page but a teacher\'s has "Save as image" beside "Print this page", and the picture is the page: the same squares inked, the buttons left out', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/search');
    for (const [address, title, name] of PAGES) {
      await move(page, address, title);
      assert.deepEqual(await page.evaluate(() => Array.from(document.querySelector('.page__body [data-output="picture"]').parentElement.querySelectorAll('button'), (button) => button.textContent)), ['Print this page', 'Save as image'], address);
      const where = await measure(page);
      const said = await save(page);
      assert.equal(said, PICTURE_SAVED + name + '.', address);
      const download = await page.evaluate(() => globalThis.sv2Downloads[globalThis.sv2Downloads.length - 1].name);
      assert.equal(download, name, address);
      const image = await readImage(page, 'saved');
      assert.equal(image.type, 'image/png', address);
      assert.equal(image.signature, '137 80 78 71 13 10 26 10', address + ': a PNG');
      const scale = PICTURE_SCALE;
      assert.equal(image.width, Math.ceil(Math.ceil(where.width + 32) * scale), address + ': the page\'s width and a margin, three times over');
      assert.equal(image.paper, '246,243,236,255', address + ': on the page\'s paper');
      // the school's line and the publish line are over the page: what is left of the height
      const squares = await inkSquares(page, 'saved', { selector: '.page__body', scale, left: 16, top: 16, search: 150, width: where.width, bottom: where.outputsTop }, 6);
      assert.ok(squares.top >= 16 + 30 && squares.top <= 16 + 60, address + ': the school\'s line and the publish line over the page, which starts ' + squares.top + ' px down');
      const agree = agreement(squares);
      assert.ok(agree.inked > 60, address + ': the screenshot has ink in ' + agree.inked + ' squares');
      assert.ok(agree.part > 0.95, address + ': ' + agree.same + ' of ' + agree.of + ' squares agree between the page and its picture');
      assert.equal(agree.leftInked, 0, address + ': nothing is drawn where the tabs, the map\'s buttons and the pickers are, of ' + agree.left + ' squares');
      // under the page, where its buttons are, the picture is paper
      const below = await inkSquares(page, 'saved', { selector: '.page__body', scale, left: 16, top: squares.top, width: where.width, bottom: where.height }, 6);
      const cols = Math.floor(where.width / 6);
      const firstRow = Math.ceil(where.outputsTop / 6) + 1;
      const buttons = below.picture.slice(firstRow * cols);
      const onScreen = below.screen.slice(firstRow * cols);
      assert.ok(onScreen.some(Boolean), address + ': the buttons are on screen');
      assert.equal(buttons.filter(Boolean).length, 0, address + ': no button is in the picture');
    }
    assert.deepEqual(session.requests.filter((url) => url !== files.open.url && !url.startsWith(files.open.url + '#') && !url.startsWith('data:') && !url.startsWith('blob:')), [], 'the pictures are made on the device');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('the door sign is saved as the sheet alone, at its own width, named for the room', async () => {
  for (const width of [390, 1280]) {
    const session = await openPage({ width, height: 900, share: 'files' });
    try {
      const { page } = session;
      await goto(page, files.open.url + '#/door/rsample101?day=1');
      await page.waitForFunction(() => document.querySelector('h1').textContent === 'Door sign: Room 101', { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.querySelector('[data-output="picture"]').textContent), 'Save the sign as an image');
      const sheet = await page.evaluate(() => {
        const box = document.querySelector('[data-sheet="door"]').getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      const said = await save(page, '[data-output="picture"]');
      assert.equal(said, 'Shared as door-sign-room-101.png.', 'width ' + width);
      assert.deepEqual(await page.evaluate(() => globalThis.sv2Shared.map((each) => each.files)), [[{ name: 'door-sign-room-101.png', type: 'image/png' }]]);
      const image = await readImage(page, 'shared');
      const scale = pictureScale(Math.ceil(sheet.width), Math.ceil(sheet.height));
      assert.deepEqual([image.width, image.height], [Math.ceil(Math.ceil(sheet.width) * scale), Math.ceil(Math.ceil(sheet.height) * scale)], 'width ' + width + ': the sheet, with no margin and no school line over it');
      const squares = await inkSquares(page, 'shared', { selector: '[data-sheet="door"]', scale, left: 0, top: 0, width: sheet.width, bottom: sheet.height }, 6);
      const agree = agreement(squares);
      assert.ok(agree.inked > 60, 'width ' + width + ': the sign has ink');
      assert.ok(agree.part > 0.95, 'width ' + width + ': ' + agree.same + ' of ' + agree.of + ' squares agree between the sign and its picture');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  }
});

test('a name with markup, a direction mark and a control character in it is drawn as text, and names nothing', async () => {
  const session = await openPage({ theme: 'dark' });
  try {
    const { page } = session;
    await goto(page, files.hostile.url + '#/group/gsample06a');
    await page.waitForFunction(() => document.querySelector('h1').textContent.startsWith('<img'), { timeout: 5000 });
    const where = await measure(page);
    const said = await save(page);
    const name = 'group-img-src-x-onerror-window-pwned-1-script-b-ünï-東京-evil.png';
    assert.equal(said, PICTURE_SAVED + name + '.');
    const image = await readImage(page, 'saved');
    assert.equal(image.paper, '21,24,28,255', 'in the dark theme the picture is dark');
    const squares = await inkSquares(page, 'saved', { selector: '.page__body', scale: PICTURE_SCALE, left: 16, top: 16, search: 150, width: where.width, bottom: where.outputsTop }, 6);
    const agree = agreement(squares);
    assert.ok(agree.part > 0.95, agree.same + ' of ' + agree.of + ' squares agree');
    assert.equal(agree.leftInked, 0);
    assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.page__body img, .page__body b').length), 0);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a page too long for any canvas says so and hands nothing over', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/staffing');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'Staffing', { timeout: 5000 });
    await page.evaluate(() => {
      document.querySelector('.page__body h1').after(Object.assign(document.createElement('div'), { style: 'height: 40000px' }));
    });
    assert.equal(await save(page), PICTURE_TOO_LONG);
    assert.equal(await page.evaluate(() => globalThis.sv2Downloads.length), 0);
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});

test('a page with nothing to print has nothing to save either', async () => {
  const session = await openPage();
  try {
    const { page } = session;
    await goto(page, files.open.url + '#/me');
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'My schedule', { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => {
      const row = document.querySelector('[data-actions="print"]');
      return [Boolean(row), row ? row.hidden : null, Boolean(row && row.querySelector('[data-output="picture"]'))];
    }), [true, true, true], 'the row is there and hidden with Print');
    assert.deepEqual(session.errors, []);
  } finally {
    await session.close();
  }
});
