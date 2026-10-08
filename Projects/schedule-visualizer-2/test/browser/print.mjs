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

import { openPlanner, go, TOOL_PATH } from './harness.mjs';

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

test('the previews asked for nothing outside the tool and nothing went wrong on the page', async () => {
  const problems = session.problems();
  assert.deepEqual(problems.errors, []);
  assert.deepEqual(problems.blocked, []);
  const outside = session.requests.filter((url) => !url.startsWith(session.base + '/') && !url.startsWith('about:') && !url.startsWith('data:'));
  assert.deepEqual(outside, []);
  const asked = session.requests.filter((url) => url.startsWith(session.base + TOOL_PATH)).map((url) => url.slice((session.base + TOOL_PATH).length));
  assert.ok(asked.includes('ui/print.css'), 'the sheet\'s stylesheet was loaded');
});
