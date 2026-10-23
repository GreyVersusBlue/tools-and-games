// The print preview in a real browser: node test/browser/print.mjs
//
// Opens the planner on the sample school and calls the preview sheet's own
// function with the page's context (globalThis.sv2.ctx), so no other unit's
// screen is needed. For each output it checks the document in the frame: the
// page rule the browser parsed, the header, light paper under a dark screen,
// and that nothing of the editor is in it. Then the paper choices, printing,
// closing, hostile names, and what Chromium really lays out on paper (the
// document printed to PDF: the sheet's size and the number of sheets).

import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, TOOL_PATH, loadModule } from './harness.mjs';

let session;
let page;

// Open the preview for one output and wait until its document is laid out.
async function openPreview(output, options) {
  await page.evaluate(async (id, opts) => {
    const at = (file) => new URL(file, location.href).href;
    const { openPrintPreview } = await import(at('ui/components/print-preview.js'));
    const sheet = openPrintPreview(globalThis.sv2.ctx, id, opts);
    globalThis.sv2test = { sheet };
    await sheet.ready();
  }, output, options || {});
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
}

async function closePreview() {
  await page.evaluate(() => globalThis.sv2test.sheet.close());
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
}

// What the frame's document is, read from the page.
function readDocument() {
  return page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe');
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    const pageRules = [];
    for (const sheet of doc.styleSheets) {
      for (const rule of sheet.cssRules) if (rule.constructor.name === 'CSSPageRule') pageRules.push({ size: rule.style.getPropertyValue('size'), margin: rule.style.getPropertyValue('margin'), own: sheet.ownerNode.id });
    }
    const first = doc.querySelector('.page');
    const classes = new Set();
    for (const el of doc.querySelectorAll('*')) for (const name of el.classList) classes.add(name);
    const corridor = doc.querySelector('.plan__corridor');
    return {
      title: doc.title,
      theme: doc.documentElement.dataset.theme,
      output: doc.documentElement.dataset.output,
      pageSizeText: doc.getElementById('page-size').textContent,
      pageRules,
      school: Array.from(doc.querySelectorAll('.doc-head__school')).map((el) => el.textContent),
      what: Array.from(doc.querySelectorAll('.doc-head__what')).map((el) => el.textContent),
      date: Array.from(doc.querySelectorAll('.doc-head__date')).map((el) => el.textContent),
      pages: doc.querySelectorAll('.page').length,
      sheetColour: view.getComputedStyle(first).backgroundColor,
      ink: view.getComputedStyle(doc.body).color,
      font: view.getComputedStyle(doc.body).fontFamily,
      pageWidth: first.getBoundingClientRect().width,
      corridor: corridor ? view.getComputedStyle(corridor).fill : null,
      svgs: doc.querySelectorAll('svg.plan').length,
      scripts: doc.querySelectorAll('script').length,
      images: doc.querySelectorAll('img, image, canvas').length,
      classes: Array.from(classes).sort(),
      sandbox: frame.getAttribute('sandbox'),
      frameWidth: frame.getBoundingClientRect().width,
      stage: (() => {
        const stage = document.querySelector('.preview__stage');
        return { scroll: stage.scrollWidth, client: stage.clientWidth };
      })(),
      status: document.querySelector('.preview__status').textContent,
      heading: document.querySelector('.preview__title').textContent,
      marked: doc.querySelectorAll('.is-marked').length,
      // each plan against the sheet it is on: how far it reaches past the margins (0 when inside), and the sheet's own height
      plans: Array.from(doc.querySelectorAll('.plan-figure__plan')).map((plan) => {
        const sheet = plan.closest('.page');
        const style = view.getComputedStyle(sheet);
        const outer = sheet.getBoundingClientRect();
        const inner = plan.getBoundingClientRect();
        return {
          past: Math.max(0, outer.left + parseFloat(style.paddingLeft) - inner.left, inner.right - (outer.right - parseFloat(style.paddingRight)), inner.bottom - (outer.bottom - parseFloat(style.paddingBottom))),
          sheetHeight: outer.height,
          width: inner.width,
        };
      }),
    };
  });
}

before(async () => {
  // the device asks for dark, so the planner around the sheet is dark
  session = await openPlanner({ hash: '#project', theme: 'dark' });
  page = session.page;
});

after(async () => {
  if (session) await session.close();
});

// A case that failed with the sheet open must not leave it over the next one.
afterEach(async () => {
  await page.evaluate(() => {
    if (document.getElementById('print-preview') && globalThis.sv2test && globalThis.sv2test.sheet) globalThis.sv2test.sheet.close();
    const stray = document.getElementById('print-preview');
    if (stray) stray.remove();
  });
});

const OUTPUTS = [
  { id: 'floor-plan', name: 'Floor plan', pages: 3, sheets: 3, what: ['Floor plan: Floor 1', 'Floor plan: Floor 2', 'Floor plan: Floor 3'] },
  { id: 'room-list', name: 'Room list', pages: 1, sheets: 1, what: ['Room list'] },
  { id: 'checks', name: 'Checks report', pages: 1, sheets: 3, what: ['Checks report'] },
];

// Words that would name a mark of the editor.
const EDITOR_MARK = /select|hover|cursor|handle|preview|focus|active/i;

for (const output of OUTPUTS) {
  test('the preview of the ' + output.name.toLowerCase() + ': the page rule, the header, light paper, and no mark of the editor', async () => {
    const planner = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(planner, 'rgb(21, 24, 28)', 'the planner itself is in the dark theme');
    await openPreview(output.id);
    const seen = await readDocument();
    assert.equal(seen.heading, 'Print: ' + output.name);
    assert.equal(seen.output, output.id);
    assert.equal(seen.title, output.name + ' · Marrowby Middle School (sample)');
    // the page size rule: as written, and as the browser understood it
    assert.equal(seen.pageSizeText, '@page { size: letter portrait; }');
    assert.deepEqual(seen.pageRules.filter((rule) => rule.own === 'page-size').map((rule) => rule.size), ['letter portrait']);
    assert.deepEqual(seen.pageRules.filter((rule) => rule.own !== 'page-size').map((rule) => rule.margin), ['12mm 12mm 16mm'], 'and the margins come from print.css');
    // the header of spec 3.16 on every sheet
    assert.equal(seen.pages, output.pages);
    assert.deepEqual(seen.what, output.what);
    assert.deepEqual(seen.school, output.what.map(() => 'Marrowby Middle School (sample)'));
    assert.equal(seen.date.length, output.pages);
    for (const date of seen.date) assert.match(date, /^\d{1,2} [A-Z][a-z]+ 20\d\d$/);
    // light paper under a dark screen
    assert.equal(seen.theme, 'light');
    assert.equal(seen.sheetColour, 'rgb(255, 255, 255)');
    assert.equal(seen.ink, 'rgb(31, 35, 40)');
    assert.match(seen.font, /Public Sans/);
    if (output.id === 'floor-plan') {
      assert.equal(seen.svgs, 3);
      assert.equal(seen.corridor, 'rgb(255, 255, 255)', 'a corridor is the light theme\'s white, not the dark theme\'s grey');
      // each plan is inside its sheet's margins, on a sheet that is one US Letter sheet tall, and uses the width it has
      assert.equal(seen.plans.length, 3);
      for (const plan of seen.plans) {
        assert.ok(plan.past <= 0.5, 'a plan reaches ' + plan.past + ' px past the margins of its sheet');
        assert.ok(Math.abs(plan.sheetHeight - 1056) <= 1, 'a sheet is 1056 px tall, drew ' + plan.sheetHeight);
        assert.ok(plan.width > 600, 'a plan 40 cells wide fills most of the 725 px between the margins, drew ' + plan.width);
      }
    }
    if (output.id === 'checks') assert.ok(seen.marked >= 1, 'the double-booked room is marked on the grid');
    // nothing of the editor, and nothing that runs
    assert.deepEqual(seen.classes.filter((name) => EDITOR_MARK.test(name)), []);
    assert.equal(seen.scripts, 0);
    assert.equal(seen.images, 0);
    assert.equal(seen.sandbox, 'allow-same-origin allow-modals');
    // the sheet is a US Letter sheet wide, and the frame fits the window
    assert.ok(Math.abs(seen.pageWidth - 816) <= 1, 'a US Letter sheet is 816 px wide, drew ' + seen.pageWidth);
    assert.ok(seen.stage.scroll <= seen.stage.client, 'the preview does not scroll sideways');
    // the count is the one Chromium prints (the PDF case below): a grid starts its own sheet
    assert.equal(seen.status, 'US Letter, portrait. About ' + output.sheets + (output.sheets === 1 ? ' sheet.' : ' sheets.'));
    await closePreview();
  });
}

test('a room selected in the editor leaves no mark on the printed plan', async () => {
  await go(page, '#building');
  await page.waitForFunction(() => {
    const section = document.querySelector('.bld');
    return Boolean(section) && section.dataset.styled === 'true' && section.editor.view.width > 0;
  });
  const floorId = await page.evaluate(() => document.querySelector('.bld').editor.floor.id);
  const plan = () => page.evaluate(() => document.querySelector('#print-preview iframe').contentDocument.querySelector('svg.plan').outerHTML);

  await openPreview('floor-plan', { floorId });
  const before = await plan();
  await closePreview();

  // select the first room with the Select tool
  await page.keyboard.press('v');
  const at = await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const room = editor.floor.spaces.find((space) => space.kind === 'room');
    const box = editor.canvas.getBoundingClientRect();
    const place = editor.view.toScreen((room.cells[0] % editor.floor.width) + 0.5, Math.floor(room.cells[0] / editor.floor.width) + 0.5);
    return { x: box.left + place.x, y: box.top + place.y };
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('#room-number');
  await page.mouse.move(at.x + 40, at.y + 10); // and a hovered cell

  await openPreview('floor-plan', { floorId });
  const after = await plan();
  const seen = await readDocument();
  assert.equal(seen.pages, 1, 'the one floor asked for');
  assert.equal(after, before, 'the plan is the same with a room selected and a cell hovered');
  assert.deepEqual(seen.classes.filter((name) => EDITOR_MARK.test(name)), []);
  await closePreview();
  await go(page, '#project');
});

test('the paper size and orientation change the page rule and the sheet, and are the project\'s setting', async () => {
  await openPreview('room-list');
  assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#print-preview .seg__input:checked')).map((input) => input.value)), ['letter', 'portrait']);

  await page.click('#print-preview input[value="a4"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]');
  let seen = await readDocument();
  assert.equal(seen.pageSizeText, '@page { size: A4 portrait; }');
  assert.deepEqual(seen.pageRules.filter((rule) => rule.own === 'page-size').map((rule) => rule.size.toLowerCase()), ['a4 portrait']);
  assert.ok(Math.abs(seen.pageWidth - 793.7) <= 1, 'an A4 sheet is 794 px wide, drew ' + seen.pageWidth);
  assert.match(seen.status, /^A4, portrait\./);

  await page.click('#print-preview input[value="landscape"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a4 landscape"]');
  seen = await readDocument();
  assert.equal(seen.pageSizeText, '@page { size: A4 landscape; }');
  assert.deepEqual(seen.pageRules.filter((rule) => rule.own === 'page-size').map((rule) => rule.size.toLowerCase()), ['a4 landscape']);
  assert.ok(Math.abs(seen.pageWidth - 1122.5) <= 1, 'an A4 sheet on its side is 1123 px wide, drew ' + seen.pageWidth);
  assert.ok(seen.stage.scroll <= seen.stage.client, 'and it is scaled to fit');
  assert.ok(seen.frameWidth < 1122, 'the frame is drawn smaller than the sheet when the window is');

  const kept = await page.evaluate(() => ({ paper: globalThis.sv2.store.project.settings.paper, undo: globalThis.sv2.store.undoLabel }));
  assert.deepEqual(kept.paper, { size: 'a4', orientation: 'landscape' });
  assert.equal(kept.undo, 'Change the paper orientation');
  await closePreview();

  // the next preview opens on the paper last chosen
  await openPreview('checks');
  seen = await readDocument();
  assert.equal(seen.pageSizeText, '@page { size: A4 landscape; }');
  await closePreview();
  await page.evaluate(() => {
    globalThis.sv2.store.undo();
    globalThis.sv2.store.undo();
  });
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.settings.paper), { size: 'letter', orientation: 'portrait' });
});

// SV2-32c
test('the paper choice offers the eight sizes in order; a poster size is the sheet on show, says where to print it, and is the project\'s setting', async () => {
  await openPreview('floor-plan');
  try {
    await posters();
  } finally {
    // the paper is put back whatever failed, so the cases after this one start on US Letter
    await page.evaluate(() => {
      const { store } = globalThis.sv2;
      while (store.project.settings.paper.size !== 'letter' && store.undoLabel && /paper/.test(store.undoLabel)) store.undo();
    });
  }
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.settings.paper), { size: 'letter', orientation: 'portrait' });
});

async function posters() {
  assert.deepEqual(await page.$$eval('#print-preview .seg:has(input[value="a4"]) .seg__option', (all) => all.map((option) => option.querySelector('input').value + ':' + option.textContent)),
    ['letter:US Letter', 'a4:A4', 'tabloid:Tabloid', 'a3:A3', 'a2:A2', 'a1:A1', 'a0:A0', 'poster-24x36:24 × 36 in']);
  await page.click('#print-preview input[value="a0"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a0 portrait"]');
  let seen = await readDocument();
  assert.equal(seen.pageSizeText, '@page { size: 841mm 1189mm; }');
  assert.deepEqual(seen.pageRules.filter((rule) => rule.own === 'page-size').map((rule) => rule.size), ['841mm 1189mm']);
  assert.ok(Math.abs(seen.pageWidth - 841 * 96 / 25.4) <= 1, 'an A0 sheet is 3179 px wide, drew ' + seen.pageWidth);
  assert.ok(seen.stage.scroll <= seen.stage.client, 'and it is scaled to fit');
  assert.equal(seen.pages, 3);
  assert.deepEqual(seen.plans.map((plan) => plan.past), [0, 0, 0], 'each plan inside its sheet\'s margins');
  assert.ok(seen.plans.every((plan) => plan.width > 2800), 'each plan fills the poster\'s width: ' + seen.plans.map((plan) => Math.round(plan.width)).join(', '));
  assert.equal(seen.status, 'A0, portrait. About 3 sheets. A poster size: most office printers cannot take it, so print it at a print shop, or choose Save as PDF in the print dialog and take the file there.');
  assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.settings.paper), { size: 'a0', orientation: 'portrait' });
  await page.click('#print-preview input[value="tabloid"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="tabloid portrait"]');
  seen = await readDocument();
  assert.equal(seen.status, 'Tabloid, portrait. About 3 sheets.', 'tabloid is office paper');
  await closePreview();
}

test('in a tab that cannot change the project, the paper chosen still changes the sheet on show', async () => {
  await openPreview('room-list');
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    globalThis.sv2test.apply = store.apply;
    store.apply = () => {
      throw new Error('This tab is read-only.');
    };
  });
  try {
    await page.click('#print-preview input[value="landscape"]');
    await page.waitForSelector('#print-preview[data-ready="true"][data-paper="letter landscape"]');
    const seen = await readDocument();
    assert.equal(seen.pageSizeText, '@page { size: letter landscape; }');
    assert.ok(Math.abs(seen.pageWidth - 1056) <= 1, 'a US Letter sheet on its side is 1056 px wide, drew ' + seen.pageWidth);
    assert.deepEqual(await page.evaluate(() => globalThis.sv2.store.project.settings.paper), { size: 'letter', orientation: 'portrait' }, 'the project is as it was');
  } finally {
    await page.evaluate(() => {
      globalThis.sv2.store.apply = globalThis.sv2test.apply;
    });
  }
  await closePreview();
});

test('Print prints the frame and nothing else; Ctrl+P in the sheet does the same', async () => {
  await openPreview('checks');
  await page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe');
    globalThis.sv2test.prints = [];
    frame.contentWindow.print = () => globalThis.sv2test.prints.push(document.title);
    window.print = () => globalThis.sv2test.prints.push('the planner');
  });
  const planner = await page.title();
  await page.click('#print-preview [data-action="print"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('p');
  await page.keyboard.up('Control');
  const seen = await page.evaluate(() => ({ prints: globalThis.sv2test.prints, title: document.title }));
  // the job is named for the document while it prints, and the planner's title comes back
  assert.deepEqual(seen.prints, ['Checks report · Marrowby Middle School (sample)', 'Checks report · Marrowby Middle School (sample)']);
  assert.equal(seen.title, planner);
  assert.notEqual(planner, seen.prints[0]);
  await closePreview();
});

test('a print button opens the sheet, Escape closes it, and focus goes back to the button', async () => {
  await page.evaluate(async () => {
    const at = (file) => new URL(file, location.href).href;
    const { printButton } = await import(at('ui/components/print-preview.js'));
    const { printButtons } = await import(at('ui/prints/index.js'));
    const entry = printButtons.find((button) => button.output === 'floor-plan');
    const button = printButton(globalThis.sv2.ctx, entry, () => ({ floorId: globalThis.sv2.store.project.building.floors[1].id }));
    document.querySelector('main').append(button);
  });
  assert.equal(await page.$eval('#print-floor-plan', (button) => button.textContent), 'Print the floor plan');
  await page.focus('#print-floor-plan');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const seen = await readDocument();
  assert.deepEqual(seen.what, ['Floor plan: Floor 2'], 'the floor the screen had on show');
  assert.equal(await page.$eval('#print-preview .preview__select', (select) => select.selectedOptions[0].textContent), 'Floor 2');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'close', 'the safe button has focus');

  // every floor, from the sheet
  await page.select('#print-preview .preview__select', 'all');
  await page.waitForFunction(() => document.querySelector('#print-preview iframe').contentDocument.querySelectorAll('.page').length === 3);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'print-floor-plan');
  await page.evaluate(() => document.getElementById('print-floor-plan').remove());
});

test('hostile names are shown as typed in the frame and run nothing', async () => {
  const names = {
    school: '<img src=x onerror="top.__pwned = 1"> & </title><script>top.__pwned = 2</script>',
    floor: '"><svg onload="top.__pwned = 3">',
    teacher: 'Ms. <b onclick="top.__pwned = 4">O\'Neil</b>',
  };
  await page.evaluate(async (typed) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    store.apply(actions.setSetting, { key: 'schoolName', value: typed.school });
    store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: typed.floor });
    store.apply(actions.editTeacher, { id: store.project.teachers[0].id, name: typed.teacher });
  }, names);
  const now = await page.evaluate(() => ({ school: globalThis.sv2.store.project.settings.schoolName, floor: globalThis.sv2.store.project.building.floors[0].name, teacher: globalThis.sv2.store.project.teachers[0].name }));
  assert.deepEqual(now, names, 'the model holds the names as typed');

  for (const output of OUTPUTS) {
    await openPreview(output.id);
    const seen = await readDocument();
    assert.equal(seen.title, output.name + ' · ' + names.school, output.id);
    assert.equal(seen.school[0], names.school, output.id);
    assert.equal(seen.scripts, 0, output.id);
    assert.equal(seen.images, 0, output.id);
    const text = await page.evaluate(() => {
      const doc = document.querySelector('#print-preview iframe').contentDocument;
      return { body: doc.body.textContent, handlers: Array.from(doc.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((attribute) => /^on/i.test(attribute.name))).length, bold: doc.querySelectorAll('b').length };
    });
    assert.equal(text.handlers, 0, output.id);
    assert.equal(text.bold, 0, output.id);
    if (output.id === 'floor-plan') assert.equal(seen.what[0], 'Floor plan: ' + names.floor);
    if (output.id !== 'floor-plan') assert.ok(text.body.includes(names.teacher), output.id + ': the teacher as typed');
    if (output.id === 'room-list') assert.ok(text.body.includes(names.floor), 'the floor as typed');
    await closePreview();
  }
  assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
  await page.evaluate(() => {
    globalThis.sv2.store.undo();
    globalThis.sv2.store.undo();
    globalThis.sv2.store.undo();
  });
});

test('on a phone-sized window the sheet fills the window and the preview still fits', async () => {
  await page.setViewport({ width: 390, height: 760, deviceScaleFactor: 1 });
  await openPreview('checks');
  const seen = await readDocument();
  const box = await page.$eval('#print-preview', (el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.deepEqual(box, { width: 390, height: 760 });
  assert.ok(seen.stage.scroll <= seen.stage.client);
  assert.ok(seen.frameWidth <= 390);
  await closePreview();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
});

// What Chromium puts on paper. The document is loaded as a page of its own
// (from the planner's address, so its stylesheets are found) and printed to
// PDF with the document's own page size: the sheet has to be the size the
// page rule names, and each output has to take the sheets it should.
test('printed to PDF: the sheet is the size the page rule names, and a floor plan is one sheet a floor', async () => {
  const paper = await session.browser.newPage();
  try {
    await paper.goto(session.url(''), { waitUntil: 'load' });
    const cases = [
      { id: 'floor-plan', paper: { size: 'letter', orientation: 'portrait' }, box: [612, 792], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'a4', orientation: 'landscape' }, box: [842, 595], sheets: 3 },
      { id: 'room-list', paper: { size: 'a4', orientation: 'portrait' }, box: [595, 842], sheets: 1 },
      { id: 'checks', paper: { size: 'letter', orientation: 'landscape' }, box: [792, 612], sheets: 3 },
      { id: 'checks', paper: { size: 'letter', orientation: 'portrait' }, box: [612, 792], sheets: 3 },
      // SV2-32c: tabloid, A3 and the posters, each floor still one sheet
      { id: 'floor-plan', paper: { size: 'tabloid', orientation: 'portrait' }, box: [792, 1224], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'a3', orientation: 'landscape' }, box: [1191, 842], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'a2', orientation: 'portrait' }, box: [1191, 1684], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'a1', orientation: 'landscape' }, box: [2384, 1684], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'a0', orientation: 'portrait' }, box: [2384, 3370], sheets: 3 },
      { id: 'floor-plan', paper: { size: 'poster-24x36', orientation: 'landscape' }, box: [2592, 1728], sheets: 3 },
    ];
    for (const one of cases) {
      const at = one.id + ' on ' + one.paper.size + ' ' + one.paper.orientation;
      await paper.goto(session.url(''), { waitUntil: 'load' });
      await paper.evaluate(async (id, chosen) => {
        const { renderOutput } = await import(new URL('ui/prints/index.js', location.href).href);
        const { sampleSchool } = await import(new URL('data/sample-school.js', location.href).href);
        const { html } = renderOutput(id, sampleSchool(), null, { paper: chosen, now: '2026-09-01T12:00:00Z' });
        document.open();
        document.write(html);
        document.close();
        await new Promise((resolve) => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', resolve, { once: true });
        });
        await document.fonts.ready;
      }, one.id, one.paper);
      assert.equal(await paper.evaluate(() => getComputedStyle(document.querySelector('.doc-head__what')).fontWeight), '700', at + ': print.css is applied');
      const pdf = Buffer.from(await paper.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
      const boxes = Array.from(pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map((match) => [Math.round(Number(match[3])), Math.round(Number(match[4]))]);
      assert.ok(boxes.length >= 1, at + ': the PDF names no sheet size');
      for (const box of boxes) assert.deepEqual(box, one.box, at + ': the sheet, in points');
      const sheets = (pdf.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
      assert.equal(sheets, one.sheets, at + ': sheets of paper');
    }
  } finally {
    await paper.close();
  }
});

test('the sheet\'s rules come from the print.css link the page already has: opening a preview adds no second one', async () => {
  const links = () => page.$$eval('link[rel="stylesheet"]', (all) => all.filter((link) => new URL(link.href).pathname.endsWith('ui/print.css')).map((link) => ({ marked: link.dataset.sheet || null, loaded: Boolean(link.sheet) })));
  await openPreview('room-list');
  assert.deepEqual(await links(), [{ marked: 'print', loaded: true }], 'one link to ui/print.css, the one index.html carries');
  await closePreview();
  await openPreview('floor-plan');
  assert.equal((await links()).length, 1, 'and a second preview adds none');
  await closePreview();
});

test('the floor plan offers the traced image only when a floor has one to show; it is off until ticked, and is drawn from the bytes on the device where the screen has it', async () => {
  const control = '#print-preview [data-control="trace"]';
  const box = control + ' input[type="checkbox"]';
  const inFrame = () => page.evaluate(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    return Array.from(doc.querySelectorAll('image')).map((image) => ({
      turn: image.parentNode.getAttribute('transform'),
      box: ['x', 'y', 'width', 'height'].map((name) => image.getAttribute(name)).join(' '),
      opacity: image.getAttribute('opacity'),
      kind: image.getAttribute('href').slice(0, 23),
      under: image.closest('svg').querySelector('.plan__trace + path') !== null && image.closest('svg').firstElementChild === image.parentNode,
      floor: image.closest('.page').querySelector('.doc-head__what').textContent,
    }));
  });
  const laidOut = (images) => page.waitForFunction((wanted) => {
    const sheet = document.querySelector('#print-preview');
    return sheet.dataset.ready === 'true' && sheet.querySelector('iframe').contentDocument.querySelectorAll('image').length === wanted;
  }, { timeout: 10000 }, images);

  const choose = (value) => page.$eval('#print-preview .preview__select', (select, wanted) => {
    select.value = wanted;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

  // the sample school has no traced image: nothing is offered
  await openPreview('floor-plan');
  assert.notEqual(await page.$(control), null, 'the floor plan\'s sheet has the control');
  assert.equal(await page.$eval(control, (el) => el.hidden), true);
  await closePreview();
  await openPreview('room-list');
  assert.equal(await page.$(control), null, 'no other output has it');
  await closePreview();

  // an invented picture for Floor 1, kept on the device the way an imported one is: turned, scaled, half clear
  await page.evaluate(async () => {
    const { ctx, store } = globalThis.sv2;
    const canvas = new OffscreenCanvas(80, 40);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 80, 40);
    g.fillStyle = '#204080';
    g.fillRect(10, 10, 60, 20);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    await ctx.storage.putImage('iprinted01', { blob, type: blob.type, width: 80, height: 40 });
    const { setTraceImage } = await import(new URL('engine/actions.js', location.href).href);
    store.apply(setTraceImage, { floorId: store.project.building.floors[0].id, image: { imageId: 'iprinted01', width: 80, height: 40, scale: 0.25, x: 4, y: 2, rotation: 15, opacity: 0.5 } });
  });
  try {
    await openPreview('floor-plan');
    assert.equal(await page.$eval(control, (el) => el.hidden), false, 'a floor has an image to show, so the tick is offered');
    assert.equal(await page.$eval(control + ' label', (el) => el.textContent), 'Show the traced image under the plan');
    assert.equal(await page.$eval(box, (el) => el.checked), false, 'off by default');
    assert.deepEqual(await inFrame(), [], 'and so not on the paper');

    await page.click(box);
    await laidOut(1);
    // 80 by 40 pixels at 0.25 cells a pixel is 20 by 10 cells at (4, 2); a cell is 20 units; the middle is cell (14, 7)
    assert.deepEqual(await inFrame(), [{ turn: 'rotate(15 280 140)', box: '80 40 400 200', opacity: '0.5', kind: 'data:image/jpeg;base64,', under: true, floor: 'Floor plan: Floor 1' }]);
    assert.equal(await page.evaluate(() => globalThis.sv2test.sheet.state.traceImage), true);
    // the bytes in the document are the picture that was kept
    assert.deepEqual(await page.evaluate(async () => {
      const href = document.querySelector('#print-preview iframe').contentDocument.querySelector('image').getAttribute('href');
      const bitmap = await createImageBitmap(await (await fetch(href)).blob());
      return [bitmap.width, bitmap.height];
    }), [80, 40]);
    assert.match(await page.$eval('.preview__status', (el) => el.textContent), /^US Letter, portrait\. About 3 sheets\.$/);

    // a floor with no image: the tick goes, and comes back with the floor
    await choose(await page.evaluate(() => globalThis.sv2.store.project.building.floors[1].id));
    await laidOut(0);
    assert.equal(await page.$eval(control, (el) => el.hidden), true);
    await choose('all');
    await laidOut(1);
    assert.equal(await page.$eval(control, (el) => el.hidden), false);

    await page.click(box);
    await laidOut(0);
    assert.equal(await page.$eval(box, (el) => el.checked), false);
    await closePreview();

    // hidden on screen is not offered on paper
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      const { setTraceImage } = await import(new URL('engine/actions.js', location.href).href);
      store.apply(setTraceImage, { floorId: store.project.building.floors[0].id, image: { visible: false } });
    });
    await openPreview('floor-plan');
    assert.equal(await page.$eval(control, (el) => el.hidden), true);
    await closePreview();
    await page.evaluate(() => globalThis.sv2.store.undo());
  } finally {
    await page.evaluate(() => {
      const { store } = globalThis.sv2;
      while (store.project.building.floors[0].image !== null && store.history.past.length > 0) store.undo();
    });
  }
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].image), null, 'the school is as it was for the cases after this one');
});

// ---------------------------------------------------------------- SV2-32d: the schedule's prints and the travel times

// The Schedule section has drawn the project as it is.
function scheduleDrawn() {
  return page.waitForFunction(() => {
    const section = document.querySelector('.sch');
    const sheet = document.querySelector('link[data-sheet="schedule"]');
    return Boolean(section) && section.dataset.pending !== 'true' && Boolean(sheet) && sheet.sheet !== null;
  });
}

// Press a print button the screen drew, and wait for the document it opened
// to be laid out. The button is pressed where it is: it must be the thing at
// its own middle.
async function pressPrint(selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (button) => button.scrollIntoView({ block: 'center' }));
  const hit = await page.$eval(selector, (button) => {
    const box = button.getBoundingClientRect();
    const there = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return there === button || button.contains(there);
  });
  assert.ok(hit, selector + ' is under something');
  await page.click(selector);
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
}

// The document in the preview as tables: each sheet's heading, and each
// table's rows (each row's cells as text), whether its head row repeats on
// each sheet, and how far it reaches past its sheet's margins.
function readTables() {
  return page.evaluate(() => {
    const sheet = document.querySelector('#print-preview');
    const frame = sheet.querySelector('iframe');
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    return {
      heading: sheet.querySelector('.preview__title').textContent,
      title: doc.title,
      theme: doc.documentElement.dataset.theme,
      paper: sheet.dataset.paper,
      sheets: Number(sheet.dataset.sheets),
      status: sheet.querySelector('.preview__status').textContent,
      what: Array.from(doc.querySelectorAll('.doc-head__what'), (el) => el.textContent),
      school: Array.from(doc.querySelectorAll('.doc-head__school'), (el) => el.textContent),
      dates: doc.querySelectorAll('.doc-head__date').length,
      sheetColour: view.getComputedStyle(doc.querySelector('.page')).backgroundColor,
      scripts: doc.querySelectorAll('script').length,
      html: frame.srcdoc,
      tables: Array.from(doc.querySelectorAll('table'), (table) => {
        const page = table.closest('.page');
        const style = view.getComputedStyle(page);
        const outer = page.getBoundingClientRect();
        const inner = table.getBoundingClientRect();
        return {
          page: page.querySelector('.doc-head__what').textContent,
          head: Array.from(table.querySelectorAll('thead th'), (cell) => cell.textContent),
          repeats: view.getComputedStyle(table.querySelector('thead')).display,
          rows: Array.from(table.querySelectorAll('tbody tr'), (row) => Array.from(row.children, (cell) => cell.textContent)),
          past: Math.max(0, outer.left + parseFloat(style.paddingLeft) - inner.left, inner.right - (outer.right - parseFloat(style.paddingRight))),
          period: table.closest('[data-period]') ? table.closest('[data-period]').dataset.period : null,
        };
      }),
    };
  });
}

// What Chromium prints of a document: its sheets and their size in points.
async function printed(html) {
  const paper = await session.browser.newPage();
  try {
    await paper.goto(session.url(''), { waitUntil: 'load' });
    await paper.evaluate((markup) => {
      document.open();
      document.write(markup);
      document.close();
    }, html);
    await paper.waitForFunction(() => document.readyState === 'complete' && Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every((link) => link.sheet !== null));
    await paper.evaluate(() => document.fonts.ready.then(() => true));
    assert.equal(await paper.evaluate(() => getComputedStyle(document.querySelector('.doc-head__what')).fontWeight), '700', 'print.css is applied');
    const pdf = Buffer.from(await paper.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
    const boxes = Array.from(pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map((match) => [Math.round(Number(match[3])), Math.round(Number(match[4]))]);
    return { boxes, sheets: (pdf.match(/\/Type\s*\/Page\b(?!s)/g) || []).length };
  } finally {
    await paper.close();
  }
}

const SAMPLE_NAME = 'Marrowby Middle School (sample)';

test('the groups, the teacher list and the teachers and rooms by period print from the Import tab: a sheet a day type under the header, every row of the schedule, and the sheets Chromium prints', async () => {
  await go(page, '#schedule/import');
  await scheduleDrawn();
  const counts = await page.evaluate(() => {
    const project = globalThis.sv2.store.project;
    let rooms = 0;
    for (const floor of project.building.floors) rooms += floor.spaces.filter((space) => space.kind === 'room').length;
    return { groups: project.groups.length, teachers: project.teachers.length, rooms, groupNames: project.groups.map((group) => group.name), teacherNames: project.teachers.map((teacher) => teacher.name) };
  });
  const wanted = [
    { kind: 'groups', label: 'Print the groups', name: 'Groups', what: ['Groups: A Day', 'Groups: B Day'], rows: counts.groups, first: counts.groupNames },
    { kind: 'teachers', label: 'Print the teacher list', name: 'Teachers', what: ['Teachers'], rows: counts.teachers, first: counts.teacherNames },
    { kind: 'teacher-grid', label: 'Print the teachers by period', name: 'Teachers by period', what: ['Teachers by period: A Day', 'Teachers by period: B Day'], rows: counts.teachers, first: counts.teacherNames },
    { kind: 'room-grid', label: 'Print the rooms by period', name: 'Rooms by period', what: ['Rooms by period: A Day', 'Rooms by period: B Day'], rows: counts.rooms, first: null },
  ];
  for (const one of wanted) {
    const selector = '#print-export-' + one.kind;
    assert.equal(await page.$eval(selector, (button) => button.textContent), one.label);
    await pressPrint(selector);
    const seen = await readTables();
    const at = one.kind;
    assert.equal(seen.heading, 'Print: ' + one.name, at);
    assert.equal(seen.title, one.name + ' · ' + SAMPLE_NAME, at);
    assert.deepEqual(seen.what, one.what, at + ': a sheet a day type, each under its own header');
    assert.deepEqual(seen.school, one.what.map(() => SAMPLE_NAME), at);
    assert.equal(seen.dates, one.what.length, at);
    assert.equal(seen.theme, 'light', at);
    assert.equal(seen.sheetColour, 'rgb(255, 255, 255)', at + ': light paper under the dark planner');
    assert.equal(seen.scripts, 0, at);
    assert.equal(seen.tables.length, one.what.length, at + ': a table a sheet');
    for (const table of seen.tables) {
      assert.equal(table.repeats, 'table-header-group', at + ': the head row repeats on every sheet the table runs on to');
      assert.equal(table.rows.length, one.rows, at + ': every row');
      assert.ok(table.past <= 0.5, at + ': the table reaches ' + table.past + ' px past the margins of ' + table.page);
      if (one.first) assert.deepEqual(table.rows.map((row) => row[0].startsWith(one.first[table.rows.indexOf(row)])), one.first.map(() => true), at + ': in the schedule\'s order');
    }
    if (one.kind !== 'teachers') assert.deepEqual(seen.tables[0].head.slice(1, 3).map((cell) => cell.slice(0, 8)), ['Period 1', 'Period 2'], at + ': a column a period');
    // the count the preview says is the count Chromium prints, on the paper it names
    assert.equal(seen.sheets, one.what.length, at + ': one sheet a day type');
    assert.equal(seen.status, 'US Letter, portrait. About ' + seen.sheets + (seen.sheets === 1 ? ' sheet.' : ' sheets.'), at);
    const pdf = await printed(seen.html);
    assert.equal(pdf.sheets, seen.sheets, at + ': sheets of paper');
    for (const box of pdf.boxes) assert.deepEqual(box, [612, 792], at + ': US Letter, in points');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('print-preview') === null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'print-export-' + one.kind, at + ': focus goes back to the button');
  }
});

// SV2-32b: the sheet is named as the document names itself, so a school
// that says Block reads "Print: Teachers by block", not the output's static
// name, and the frame's own name follows.
test('in a school that says Block, the sheet and its frame are named as the document is: Teachers by block, Rooms by block', async () => {
  await loadModule(page, 'actions', 'engine/actions.js');
  const before = await page.evaluate(() => globalThis.sv2.store.history.past.length);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSetting, { key: 'periodWord', value: 'Block' }));
  try {
    await go(page, '#schedule/import');
    await scheduleDrawn();
    for (const [kind, what] of [['teacher-grid', 'Teachers by block'], ['room-grid', 'Rooms by block']]) {
      await pressPrint('#print-export-' + kind);
      const seen = await page.evaluate(() => {
        const sheet = document.querySelector('#print-preview');
        const frame = sheet.querySelector('iframe');
        return { heading: sheet.querySelector('.preview__title').textContent, frame: frame.title, title: frame.contentDocument.title, what: frame.contentDocument.querySelector('.doc-head__what').textContent };
      });
      assert.deepEqual(seen, { heading: 'Print: ' + what, frame: 'Preview of the ' + what.toLowerCase() + ' as it will print', title: what + ' · ' + SAMPLE_NAME, what: what + ': A Day' }, kind + ': ' + JSON.stringify(seen));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('print-preview') === null);
    }
  } finally {
    await page.evaluate((count) => {
      while (globalThis.sv2.store.history.past.length > count) globalThis.sv2.store.undo();
    }, before);
  }
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periodWord), 'Period', 'the school says Period again for the cases after this one');
});

// SV2-32b (from SV2-32d's review): in a fixed-layout grid every cell has
// its width, and the notes in it wrap there. With 9 periods on Letter
// upright, "not in the building" (about 27 mm on one line) ran over the next
// period's cell, and "Grade 6, head count 24" under a group's name (about
// 31 mm in a 24 mm box) over Period 1. Each line of text is measured as
// laid out (a Range's box), not by its element, whose box is the cell's.
test('with 9 periods on Letter upright, no slot, name or note in the grids runs past its own cell', async () => {
  await loadModule(page, 'actions', 'engine/actions.js');
  const before = await page.evaluate(() => globalThis.sv2.store.history.past.length);
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.setSetting, { key: 'periods', value: 9 });
    if (store.project.settings.paper.size !== 'letter') store.apply(actions.setSetting, { key: 'paper.size', value: 'letter' });
    if (store.project.settings.paper.orientation !== 'portrait') store.apply(actions.setSetting, { key: 'paper.orientation', value: 'portrait' });
    const group = store.project.groups[0];
    store.apply(actions.setSlot, { groupId: group.id, dayTypeId: store.project.dayTypes[0].id, period: 0, slot: { room: null, roomText: 'Portable 9' } });
  });
  try {
    await go(page, '#schedule/import');
    await scheduleDrawn();
    for (const kind of ['groups', 'teacher-grid', 'room-grid']) {
      await pressPrint('#print-export-' + kind);
      const seen = await page.evaluate(() => {
        const frame = document.querySelector('#print-preview iframe');
        const doc = frame.contentDocument;
        const view = frame.contentWindow;
        const over = [];
        let notes = 0;
        let parts = 0;
        for (const cell of doc.querySelectorAll('.doc-grid tbody th, .doc-grid tbody td')) {
          const box = cell.getBoundingClientRect();
          const style = view.getComputedStyle(cell);
          const left = box.left + parseFloat(style.paddingLeft) - 0.5;
          const right = box.right - parseFloat(style.paddingRight) + 0.5;
          for (const part of cell.querySelectorAll('.doc-grid__slot, .doc-grid__name, .doc-grid__time, .doc-grid__planning')) {
            parts += 1;
            if (part.classList.contains('doc-grid__time')) notes += 1;
            const range = doc.createRange();
            range.selectNodeContents(part);
            for (const line of range.getClientRects()) {
              if (line.left < left || line.right > right) over.push({ text: part.textContent, line: [Math.round(line.left), Math.round(line.right)], cell: [Math.round(left), Math.round(right)] });
            }
          }
        }
        return { over: over.slice(0, 5), count: over.length, notes, parts, missing: doc.querySelectorAll('.doc-grid__missing').length, periods: doc.querySelector('.doc-grid thead tr').children.length - 1, paper: [doc.documentElement.dataset.paper, doc.documentElement.dataset.orientation] };
      });
      assert.deepEqual(seen.paper, ['letter', 'portrait'], kind);
      assert.equal(seen.periods, 9, kind + ': the nine periods on one sheet, so the cells are their narrowest');
      // the teachers by period have no note under a name; the other two do
      assert.ok(seen.parts > seen.notes && (kind === 'teacher-grid' || seen.notes > 0), kind + ': there are notes to measure: ' + JSON.stringify(seen));
      if (kind === 'groups') assert.equal(seen.missing, 1, 'the slot in a room not in the building says so');
      assert.equal(seen.count, 0, kind + ': text past its own cell: ' + JSON.stringify(seen));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('print-preview') === null);
    }
  } finally {
    await page.evaluate((length) => {
      const { store } = globalThis.sv2;
      while (store.history.past.length > length) store.undo();
    }, before);
  }
  assert.equal(await page.evaluate(() => globalThis.sv2.store.project.settings.periods), 8, 'the school is as it was for the cases after this one');
});

test('a day too long for the sheet prints in parts from the Grid tab, each part inside the margins and a sheet of its own; on its side the day is one sheet', async () => {
  await loadModule(page, 'actions', 'engine/actions.js');
  const before = await page.evaluate(() => globalThis.sv2.store.history.past.length);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSetting, { key: 'periods', value: 12 }));
  try {
    await go(page, '#schedule/grid');
    await scheduleDrawn();
    await page.click('.grd-toolbar input[value="teachers"]');
    await page.waitForFunction(() => document.querySelector('.grd').dataset.rows === 'teachers' && document.querySelector('.sch').dataset.pending !== 'true' && document.getElementById('print-grid-teachers') !== null);
    assert.equal(await page.$eval('#print-grid-teachers', (button) => button.textContent), 'Print the teachers by period');
    await pressPrint('#print-grid-teachers');
    let seen = await readTables();
    assert.deepEqual(seen.what, ['Teachers by period: A Day, Period 1 to Period 6', 'Teachers by period: A Day, Period 7 to Period 12', 'Teachers by period: B Day, Period 1 to Period 6', 'Teachers by period: B Day, Period 7 to Period 12']);
    assert.deepEqual(seen.tables.map((table) => table.head.length), [7, 7, 7, 7], 'the names and six periods a part');
    assert.deepEqual(seen.tables[1].rows.map((row) => row[0]), seen.tables[0].rows.map((row) => row[0]), 'the names again on the second part');
    for (const table of seen.tables) assert.ok(table.past <= 0.5, table.page + ' reaches ' + table.past + ' px past the margins');
    assert.equal(seen.sheets, 4);
    let pdf = await printed(seen.html);
    assert.equal(pdf.sheets, 4, 'Chromium prints a sheet a part');

    // turned: twelve periods fit across, one sheet a day
    await page.click('#print-preview .seg__input[value="landscape"]');
    await page.waitForFunction(() => {
      const sheet = document.querySelector('#print-preview');
      return sheet.dataset.ready === 'true' && sheet.dataset.paper === 'letter landscape';
    });
    seen = await readTables();
    assert.deepEqual(seen.what, ['Teachers by period: A Day', 'Teachers by period: B Day']);
    assert.deepEqual(seen.tables.map((table) => table.head.length), [13, 13]);
    for (const table of seen.tables) assert.ok(table.past <= 0.5, table.page + ' on its side reaches ' + table.past + ' px past the margins');
    assert.equal(seen.sheets, 2);
    pdf = await printed(seen.html);
    assert.equal(pdf.sheets, 2);
    for (const box of pdf.boxes) assert.deepEqual(box, [792, 612], 'US Letter on its side, in points');
    await page.click('#print-preview [data-action="close"]');
    await page.waitForFunction(() => document.getElementById('print-preview') === null);

    // the rows set to Rooms print the rooms; to Groups, the groups
    await page.click('.grd-toolbar input[value="rooms"]');
    await page.waitForFunction(() => document.querySelector('.grd').dataset.rows === 'rooms' && document.querySelector('.sch').dataset.pending !== 'true' && document.getElementById('print-grid-rooms') !== null);
    await pressPrint('#print-grid-rooms');
    assert.deepEqual((await readTables()).what, ['Rooms by period: A Day', 'Rooms by period: B Day'], 'on its side still: the paper is the project\'s');
    await page.click('#print-preview [data-action="close"]');
    await page.waitForFunction(() => document.getElementById('print-preview') === null);
    await page.click('.grd-toolbar input[value="groups"]');
    await page.waitForFunction(() => document.querySelector('.grd').dataset.rows === 'groups' && document.querySelector('.sch').dataset.pending !== 'true' && document.getElementById('print-grid-groups') !== null);
    await pressPrint('#print-grid-groups');
    assert.deepEqual((await readTables()).what, ['Groups: A Day', 'Groups: B Day']);
    await page.click('#print-preview [data-action="close"]');
    await page.waitForFunction(() => document.getElementById('print-preview') === null);
  } finally {
    await page.evaluate((length) => {
      const { store } = globalThis.sv2;
      while (store.history.past.length > length) store.undo();
    }, before);
  }
  assert.deepEqual(await page.evaluate(() => [globalThis.sv2.store.project.settings.periods, globalThis.sv2.store.project.settings.paper.orientation]), [8, 'portrait'], 'the school is as it was for the cases after this one');
});

test('the Teachers tab prints the teacher list', async () => {
  await go(page, '#schedule/teachers');
  await scheduleDrawn();
  assert.equal(await page.$eval('#print-teachers', (button) => button.textContent), 'Print the teacher list');
  await pressPrint('#print-teachers');
  const seen = await readTables();
  assert.deepEqual(seen.what, ['Teachers']);
  assert.deepEqual(seen.tables[0].head, ['Teacher', 'Subject code', 'Subject', 'Rooms', 'Notes']);
  assert.equal(seen.tables[0].rows.length, await page.evaluate(() => globalThis.sv2.store.project.teachers.length));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'print-teachers');
});

test('the Travel time tab prints its day type\'s tables: each transition\'s walks and the whole day\'s, in the tab\'s order, and the sheets Chromium prints', async () => {
  await go(page, '#movement');
  const settled = () => page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project;
  }, { timeout: 15000 });
  await settled();
  await page.click('#inspector [role="tab"][data-tab="tables"]');
  await page.waitForSelector('#inspector [data-panel="tables"] .mov-travel__group');
  // the tab's own order: the transition it shows, and the whole day
  const tab = await page.evaluate(() => {
    const panel = document.querySelector('#inspector [data-panel="tables"]');
    const names = (selector) => Array.from(panel.querySelectorAll(selector + ' .mov-travel__group .mov-travel__name'), (el) => el.textContent);
    return { period: panel.querySelector('[data-travel="transition"]').dataset.period, one: names('[data-travel="transition"]'), day: names('[data-travel="day"]') };
  });
  assert.equal(await page.$eval('#print-travel-time', (button) => button.textContent), 'Print the travel times');
  await pressPrint('#print-travel-time');
  const seen = await readTables();
  assert.equal(seen.heading, 'Print: Travel time');
  // SV2-32b: a late row is set apart on paper by more than its words, in
  // ways that print with no colour and no backgrounds: bold, and a heavy
  // rule down its left edge
  const marks = await page.evaluate(() => {
    const frame = document.querySelector('#print-preview iframe');
    const view = frame.contentWindow;
    const look = (row) => {
      const first = view.getComputedStyle(row.querySelector('th'));
      return { weight: first.fontWeight, edge: Math.round(parseFloat(first.borderLeftWidth) * 10) / 10, cells: Array.from(row.children, (cell) => view.getComputedStyle(cell).fontWeight) };
    };
    const rows = Array.from(frame.contentDocument.querySelectorAll('.doc-table--travel tbody tr'));
    const late = rows.filter((row) => row.classList.contains('is-late'));
    const plain = rows.filter((row) => !row.classList.contains('is-late'));
    return { late: late.length, plain: plain.length, lateLook: late.length ? look(late[0]) : null, plainLook: plain.length ? look(plain[0]) : null };
  });
  assert.ok(marks.late >= 1 && marks.plain >= 1, 'the sample school has late walks and walks in time: ' + JSON.stringify(marks));
  assert.ok(marks.lateLook.cells.every((weight) => Number(weight) >= 600), 'a late row is bold in every cell: ' + JSON.stringify(marks));
  assert.ok(marks.plainLook.cells.slice(1).every((weight) => Number(weight) < 600), 'a row in time is not: ' + JSON.stringify(marks));
  assert.ok(marks.lateLook.edge >= marks.plainLook.edge + 3, 'a late row has a heavy rule down its left edge: ' + JSON.stringify(marks));
  assert.deepEqual(seen.what, ['Travel time: A Day'], 'the day type on the map');
  const transitions = seen.tables.filter((table) => table.period !== null);
  const day = seen.tables.filter((table) => table.period === null);
  assert.ok(transitions.length >= 1);
  assert.equal(day.length, 1);
  const shown = transitions.find((table) => table.period === tab.period);
  assert.deepEqual(shown.rows.map((row) => row[0]), tab.one, 'the transition the tab shows, in its order');
  assert.deepEqual(day[0].rows.map((row) => row[0]), tab.day, 'the whole day, in the tab\'s order');
  for (const table of seen.tables) {
    assert.equal(table.repeats, 'table-header-group');
    assert.ok(table.past <= 0.5, table.page + ' reaches ' + table.past + ' px past the margins');
  }
  assert.ok(seen.sheets >= 2, 'the whole day starts a sheet');
  const pdf = await printed(seen.html);
  assert.equal(pdf.sheets, seen.sheets, 'the count the preview says is the count Chromium prints');
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);

  // B Day on the map: B Day on paper
  await page.evaluate(() => document.querySelector('.mov').movement.change({ dayTypeId: 'dsample00b' }));
  await settled();
  await page.waitForFunction(() => document.querySelector('#inspector [data-panel="tables"]').dataset.day === 'dsample00b');
  await pressPrint('#print-travel-time');
  assert.deepEqual((await readTables()).what, ['Travel time: B Day']);
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
  await page.evaluate(() => document.querySelector('.mov').movement.change({ dayTypeId: 'dsample00a' }));
  await settled();
  await go(page, '#project');
});

test('the previews asked for nothing outside the tool and nothing went wrong on the page', async () => {
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.blocked, []);
  const outside = session.requests.filter((url) => !url.startsWith(session.base + '/') && !url.startsWith('about:') && !url.startsWith('data:'));
  assert.deepEqual(outside, []);
  const asked = session.requests.filter((url) => url.startsWith(session.base + TOOL_PATH)).map((url) => url.slice((session.base + TOOL_PATH).length));
  assert.ok(asked.includes('ui/print.css'), 'the sheet\'s stylesheet was loaded');
});
