// The Building inspector's files, in a real browser: node test/browser/building-files.mjs
//
// On the sample school (SV2-32c, spec 17): the Rooms tab saves the floor plan
// as a PNG, the floor on show or every floor in one picture, labelled and
// cropped as the print is; the picture is a real PNG of the size it says,
// on white, in the plan's own colours and faces; a hostile name is drawn as
// text and the picture is still made; a floor with nothing drawn saves
// nothing and says so; a plan larger than the browser's canvas is saved a
// size down, and one too large for any is refused. The room list's CSV
// from Building is byte for byte the file Schedule › Import's Rooms export
// saves. Every read waits on a state the page sets: the file handed over,
// or the status line's words.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go } from './harness.mjs';
import { planReady } from './draw-pointer.mjs';

const NOW = '2026-09-01T12:00:00.000Z';
const SCHOOL = 'Marrowby Middle School (sample)';
const HOSTILE = '<img src=x onerror=alert(1)> "Dr." O\'Brien & Ñandú, 王老师';

let session;
let page;
// Every dialog the browser itself put up: a name that ran as markup would
// alert, and that would stop the page for good.
const dialogs = [];

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const until = (what, fn, ...args) => page.waitForFunction(fn, { timeout: 15000 }, ...args).catch((error) => {
  throw new Error(what + ' (' + error.message + ')');
});

// The files the Rooms tab hands over, kept instead of saved.
async function keepFiles() {
  await page.evaluate(() => {
    globalThis.sv2test = { files: [] };
    document.querySelector('#rooms-export').exports.hooks.deliver = (file) => globalThis.sv2test.files.push(file);
  });
}

// Press a button of the Rooms tab's files and wait for the file, or for the
// status line to say why there is none.
async function save(action) {
  const before = await page.evaluate(() => globalThis.sv2test.files.length);
  await page.evaluate(() => {
    document.getElementById('rooms-export-status').textContent = '';
  });
  await page.click('#rooms-export [data-action="' + action + '"]');
  await until('the ' + action + ' button handed over no file and said nothing', (count) => globalThis.sv2test.files.length > count
    || (document.getElementById('rooms-export-status').textContent !== '' && document.getElementById('rooms-export-status').textContent !== 'Making the image…' && !document.querySelector('#rooms-export[data-busy]')), before);
  return page.evaluate((count) => {
    const file = globalThis.sv2test.files[count] || null;
    return {
      status: document.getElementById('rooms-export-status').textContent,
      file: file ? { fileName: file.fileName, mime: file.mime, width: file.width, height: file.height, type: file.blob ? file.blob.type : null, text: file.text === undefined ? null : file.text } : null,
    };
  }, before);
}

// The last PNG handed over: its first bytes, the size its header says, and
// the colour at a few of its pixels (read back from the PNG itself).
function readPng(points) {
  return page.evaluate(async (at) => {
    const file = globalThis.sv2test.files[globalThis.sv2test.files.length - 1];
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const bitmap = await createImageBitmap(file.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    g.drawImage(bitmap, 0, 0);
    const colour = ([x, y]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    return {
      signature: Array.from(bytes.slice(0, 8)),
      header: { width: view.getUint32(16), height: view.getUint32(20) },
      bitmap: { width: bitmap.width, height: bitmap.height },
      colours: at.map(colour),
    };
  }, points);
}

// The picture the PNG was drawn from, asked of the same module, and where a
// room's first cell and a corridor cell of the floor lie in it, in pixels of
// the picture: the plan's placing and its crop, read from its own markup.
function pictureOf(floorId) {
  return page.evaluate(async (id, when) => {
    const { planImage } = await import(new URL('ui/prints/floor-plan.js', location.href).href);
    const project = globalThis.sv2.store.project;
    const image = planImage(project, { floorId: id, now: new Date(when) });
    const floor = project.building.floors.find((each) => each.id === image.floors[0].id);
    const placed = /<svg class="plan" xmlns="http:\/\/www.w3.org\/2000\/svg" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(image.svg).slice(1).map(Number);
    const [x, y, width, , vx, vy, vw] = placed;
    const scale = width / vw; // pixels of the picture for a unit of the plan (20 a cell)
    const where = (cell, dx, dy) => [x + ((cell % floor.width) * 20 + dx * 20 - vx) * scale, y + (Math.floor(cell / floor.width) * 20 + dy * 20 - vy) * scale];
    const room = floor.spaces.find((space) => space.kind === 'room' && space.subjectId);
    const corridor = floor.cells.indexOf('#');
    // the fill the plan gives the room, from its own markup
    const fill = new RegExp('<g class="plan__space plan__space--room">\\n<path class="plan__fill" fill="(#[0-9a-f]{6})"').exec(image.svg)[1];
    return { width: image.width, height: image.height, floors: image.floors.length, roomCell: where(Math.min(...room.cells), 0.25, 0.25), corridorCell: where(corridor, 0.5, 0.5), firstRoomFill: fill, firstRoomId: floor.spaces.find((space) => space.kind === 'room').id, room: room.id, headingBand: [32, y - 8] };
  }, floorId, NOW);
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const near = (a, b, by) => a.every((value, i) => Math.abs(value - b[i]) <= by);

before(async () => {
  session = await openPlanner({ hash: '#building' });
  page = session.page;
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss().catch(() => {});
  });
  await page.evaluate(async (when) => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setOnboarding, { dismissed: true });
    // the date in the heading and in the file's name: a pinned clock
    globalThis.sv2.ctx.clock = () => new Date(when);
  }, NOW);
  await planReady(page);
  await page.click('#inspector [data-tab="rooms"]');
  await page.waitForSelector('#rooms-export [data-action="plan-png"]');
  await keepFiles();
});

after(async () => {
  if (session) await session.close();
});

test('the Rooms tab saves the floor on show and every floor as an image, and the room list as CSV, under the print buttons', async () => {
  assert.deepEqual(await page.$$eval('#rooms-export button', (all) => all.map((button) => button.dataset.action + ':' + button.textContent + (button.hidden ? ' (hidden)' : ''))),
    ['plan-png:Save Floor 1 as an image', 'plan-png-all:Save every floor as an image', 'rooms-csv:Save the room list as CSV']);
  assert.equal(await text('#rooms-files .bi-heading'), 'Save as a file');
  const order = await page.$$eval('#inspector-rooms > *', (all) => all.map((el) => el.id));
  assert.ok(order.indexOf('rooms-files') > order.indexOf('rooms-print'), 'the files come after the prints: ' + order.join(', '));
});

test('this floor as a PNG: a real PNG of the size it says, the picture at twice its size, on white, the room in the plan\'s own colour and the heading drawn', async () => {
  const floorId = await page.evaluate(() => document.querySelector('.bld').editor.floor.id);
  const picture = await pictureOf(floorId);
  const saved = await save('plan-png');
  assert.ok(saved.file, 'no file: ' + saved.status);
  assert.equal(saved.file.fileName, SCHOOL + ' - floor plan - Floor 1 - 2026-09-01.png');
  assert.equal(saved.file.mime, 'image/png');
  assert.equal(saved.file.type, 'image/png');
  assert.deepEqual([saved.file.width, saved.file.height], [picture.width * 2, picture.height * 2], 'twice the picture, which is well under the caps');
  assert.equal(saved.status, 'Saved ' + saved.file.fileName + ', ' + saved.file.width + ' by ' + saved.file.height + ' pixels.');
  const png = await readPng([[2, 2], [saved.file.width - 3, saved.file.height - 3], picture.roomCell.map((v) => v * 2), picture.corridorCell.map((v) => v * 2)]);
  assert.deepEqual(png.signature, [137, 80, 78, 71, 13, 10, 26, 10], 'the PNG signature');
  assert.deepEqual(png.header, { width: saved.file.width, height: saved.file.height }, 'the size its header says');
  assert.deepEqual(png.bitmap, png.header);
  const [corner, far, room, corridor] = png.colours;
  assert.deepEqual(corner, [255, 255, 255], 'white paper at the corner');
  assert.deepEqual(far, [255, 255, 255], 'and at the far corner: cropped with room to spare, nothing cut');
  assert.ok(near(room, hex(picture.firstRoomFill), 6), 'the room\'s cell is ' + room + ', its fill ' + picture.firstRoomFill);
  assert.ok(near(corridor, [255, 255, 255], 6), 'a corridor cell is white, as on paper: ' + corridor);
});

test('the heading is drawn in the tool\'s own face, carried in the picture: the PNG differs from the same picture drawn without the faces', async () => {
  const floorId = await page.evaluate(() => document.querySelector('.bld').editor.floor.id);
  const saved = await save('plan-png');
  assert.ok(saved.file, saved.status);
  const compared = await page.evaluate(async (id, when) => {
    const { planImage } = await import(new URL('ui/prints/floor-plan.js', location.href).href);
    const { planFaces } = await import(new URL('ui/building/plan-png.js', location.href).href);
    const faces = await planFaces();
    const file = globalThis.sv2test.files[globalThis.sv2test.files.length - 1];
    const bitmap = await createImageBitmap(file.blob);
    const band = (source, width, height) => {
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, width, height);
      g.drawImage(source, 0, 0, width, height);
      return g.getImageData(0, 0, width, 160).data;
    };
    const plain = planImage(globalThis.sv2.store.project, { floorId: id, now: new Date(when) });
    const image = new Image();
    const url = URL.createObjectURL(new Blob([plain.svg], { type: 'image/svg+xml' }));
    image.src = url;
    await image.decode();
    const saved = band(bitmap, bitmap.width, bitmap.height);
    const without = band(image, bitmap.width, bitmap.height);
    URL.revokeObjectURL(url);
    let dark = 0;
    let differ = 0;
    for (let i = 0; i < saved.length; i += 4) {
      if (saved[i] < 128) dark += 1;
      if (Math.abs(saved[i] - without[i]) > 40) differ += 1;
    }
    return { faces: faces.map((face) => face.family + ' ' + face.weight + ' ' + face.url.slice(0, 22)), dark, differ };
  }, floorId, NOW);
  assert.deepEqual(compared.faces, ['Barlow Semi Condensed 500 data:font/woff2;base', 'Barlow Semi Condensed 600 data:font/woff2;base', 'Public Sans 400 data:font/woff2;base', 'Public Sans 600 data:font/woff2;base', 'Public Sans 700 data:font/woff2;base']);
  assert.ok(compared.dark > 500, 'the heading is drawn: ' + compared.dark + ' dark pixels in its band');
  assert.ok(compared.differ > 200, 'the heading is in another face than the browser\'s own: ' + compared.differ + ' pixels differ');
});

test('every floor as a PNG: one picture with the three floors one under the other, named for the school and the day', async () => {
  const picture = await pictureOf('all');
  assert.equal(picture.floors, 3);
  const saved = await save('plan-png-all');
  assert.ok(saved.file, saved.status);
  assert.equal(saved.file.fileName, SCHOOL + ' - floor plan - 2026-09-01.png');
  assert.deepEqual([saved.file.width, saved.file.height], [picture.width * 2, picture.height * 2]);
  const png = await readPng([picture.roomCell.map((v) => v * 2)]);
  assert.ok(near(png.colours[0], hex(picture.firstRoomFill), 6), 'Floor 1\'s room is where the picture puts it: ' + png.colours[0]);
  assert.ok(saved.file.height > saved.file.width, 'three floors stacked are taller than wide');
});

test('names that are markup are drawn as text: the image is still made and nothing runs', async () => {
  const before = await page.evaluate(() => globalThis.sv2.store.undoLabel);
  await page.evaluate(async (name) => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    store.apply(actions.setSetting, { key: 'schoolName', value: name });
    const floor = store.project.building.floors[0];
    store.apply(actions.renameFloor, { id: floor.id, name: name + ' 1' });
    const room = floor.spaces.find((space) => space.kind === 'room');
    store.apply(actions.setRoomFields, { roomId: room.id, number: name + ' 101' });
  }, HOSTILE);
  try {
    await until('the button did not take the floor\'s new name', (name) => document.querySelector('#rooms-export [data-action="plan-png"]').textContent === 'Save ' + name + ' 1 as an image', HOSTILE);
    const one = await save('plan-png');
    assert.ok(one.file, 'the floor alone: ' + one.status);
    // what a file system refuses is left out of the school's name and the floor's, as for every export
    const plain = 'img src=x onerror=alert(1) Dr. O\'Brien & Ñandú, 王老师';
    assert.equal(one.file.fileName, plain + ' - floor plan - ' + plain + ' 1 - 2026-09-01.png');
    assert.doesNotMatch(one.file.fileName, /[<>:"/\\|?*]/, 'nothing a file system refuses');
    const all = await save('plan-png-all');
    assert.ok(all.file, 'every floor: ' + all.status);
    assert.deepEqual(dialogs, [], 'a name ran as markup');
    assert.equal(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length), 0);
  } finally {
    await page.evaluate(() => {
      const { store } = globalThis.sv2;
      store.undo();
      store.undo();
      store.undo();
    });
  }
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), before);
});

test('a floor with nothing drawn saves nothing and says why; the room list still saves', async () => {
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.addFloor, { name: 'Annex' });
  });
  const floorId = await page.evaluate(() => globalThis.sv2.store.project.building.floors.at(-1).id);
  await go(page, '#building/' + floorId);
  await page.click('#inspector [data-tab="rooms"]');
  await until('the Rooms tab did not follow the new floor', () => document.querySelector('#rooms-export [data-action="plan-png"]')?.textContent === 'Save Annex as an image');
  try {
    const saved = await save('plan-png');
    assert.equal(saved.file, null, 'a file of nothing');
    assert.equal(saved.status, 'Nothing is drawn on Annex yet, so there is no plan to save.');
    const csv = await save('rooms-csv');
    assert.ok(csv.file && csv.file.text.startsWith('﻿Room,Floor,'), 'the room list is the building\'s, whatever floor is on show');
  } finally {
    await page.evaluate(() => globalThis.sv2.store.undo());
    await go(page, '#building');
    await page.click('#inspector [data-tab="rooms"]');
    await page.waitForSelector('#rooms-export [data-action="plan-png"]');
  }
});

test('a picture the browser cannot hold at twice its size is saved a size down and says so; one it cannot hold at any size is refused', async () => {
  const got = await page.evaluate(async (when) => {
    const { planPng } = await import(new URL('ui/building/plan-png.js', location.href).href);
    const project = globalThis.sv2.store.project;
    const floorId = project.building.floors[0].id;
    const asked = [];
    const half = await planPng(project, { floorId, now: new Date(when), holds: (w, h) => { asked.push([w, h]); return asked.length > 1; } });
    const none = await planPng(project, { floorId, now: new Date(when), holds: () => false });
    return { half: { ok: half.ok, width: half.width, height: half.height, fell: half.fell, asked }, none };
  }, NOW);
  const picture = await pictureOf((await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].id)));
  assert.deepEqual(got.half.asked[0], [picture.width * 2, picture.height * 2], 'twice the picture asked first');
  assert.deepEqual([got.half.ok, got.half.fell, got.half.width, got.half.height], [true, 1, picture.width, picture.height], 'then the picture at its own size');
  assert.deepEqual(got.none, { ok: false, text: 'This browser could not make an image of this plan at any size. Print it instead, or save it as a PDF from the print dialog.' });
});

test('the room list\'s CSV from Building is the file Schedule › Import\'s Rooms export saves, byte for byte', async () => {
  // a room number that is markup and a quote, so the two files have something to differ on
  await page.evaluate(async (name) => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    const room = store.project.building.floors[1].spaces.find((space) => space.kind === 'room');
    store.apply(actions.setRoomFields, { roomId: room.id, number: name });
  }, HOSTILE);
  try {
    // both through the real download, a link with a download name: its bytes are read instead of saved
    await page.evaluate(() => {
      globalThis.sv2test.downloads = [];
      globalThis.sv2test.click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function clicked() {
        if (!this.hasAttribute('download')) return globalThis.sv2test.click.call(this);
        const name = this.download;
        return fetch(this.href).then((response) => response.arrayBuffer()).then((buffer) => {
          globalThis.sv2test.downloads.push({ name, bytes: Array.from(new Uint8Array(buffer)) });
        });
      };
      document.querySelector('#rooms-export').exports.hooks.deliver = null;
    });
    await page.click('#rooms-export [data-action="rooms-csv"]');
    await until('Building\'s CSV was not downloaded', () => globalThis.sv2test.downloads.length === 1);
    await go(page, '#schedule/import');
    await page.waitForSelector('[data-action="export-rooms"]');
    await page.click('[data-action="export-rooms"]');
    await until('Import\'s Rooms export was not downloaded', () => globalThis.sv2test.downloads.length === 2);
    const [building, schedule] = await page.evaluate(() => globalThis.sv2test.downloads);
    assert.equal(building.name, SCHOOL + ' - rooms - 2026-09-01.csv');
    assert.equal(building.name, schedule.name, 'the same name');
    assert.deepEqual(building.bytes.slice(0, 3), [0xef, 0xbb, 0xbf], 'a byte-order mark first');
    assert.deepEqual(building.bytes, schedule.bytes, 'the same bytes');
    const csv = new TextDecoder().decode(new Uint8Array(building.bytes));
    assert.ok(csv.includes('"' + HOSTILE.replace(/"/g, '""') + '"'), 'the room number as typed, quoted for CSV');
    const rooms = await page.evaluate(() => globalThis.sv2.store.project.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.kind === 'room').length);
    assert.equal(csv.trimEnd().split('\r\n').length, rooms + 1, 'a header and a row for every room of every floor');
  } finally {
    await page.evaluate(() => {
      HTMLAnchorElement.prototype.click = globalThis.sv2test.click;
      document.querySelector('#rooms-export')?.exports && (document.querySelector('#rooms-export').exports.hooks.deliver = (file) => globalThis.sv2test.files.push(file));
      globalThis.sv2.store.undo();
    });
    await go(page, '#building');
  }
});

test('nothing outside the tool was asked for and nothing went wrong on the page', async () => {
  assert.deepEqual(session.offsite, []);
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(dialogs, []);
});
