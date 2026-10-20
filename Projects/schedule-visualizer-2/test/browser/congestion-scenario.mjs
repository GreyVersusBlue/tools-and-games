// The congestion report's scenario section in a real browser (SV2-71):
//   node test/browser/congestion-scenario.mjs
//
// Opens a scenario on the sample school through the scenario actions, then
// opens the congestion report twice: from Movement's Export tab, which hands
// the preview the movement view's own state, and from the preview opened with
// { opener } alone, as the scenario lab does. Each time it waits for the
// preview to say the scenario's comparison is in the document on show
// (data-scenario="answered", data-ready="true"), reads the section in the
// frame and checks the two are the same text. It also opens the report while
// the comparison never comes, while it fails, with no engine, and with an
// answer that makes showing it throw, and reads what is said. Last, the
// answer arrives while a change of paper is still being laid out (its font
// files held back through the DevTools protocol, so the document has loaded
// and waits on doc.fonts.ready): the answer waits for that document, and
// ready() resolves. And the other way round (SV2-72d): a paper chosen while
// the answer's own document waits on its faces ends that wait, so a ready()
// taken then resolves once the paper's document is laid out.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from './harness.mjs';

let session;
let page;

const DAY_A = 'dsample00a';
const NAME = 'Ease the 2nd floor · 七年 <b>';
const CHANGES = [
  { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' },
  { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample08a', period: 6, roomId: 'rsample101' },
];

const view = (fn, ...args) => page.evaluate(fn, ...args);

// The movement view has the answer for the project as it is now, and has drawn it.
async function settled() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 15000 });
}

// The scenario section of the document on show, as a reader sees it.
function section() {
  return view(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    const found = doc.querySelectorAll('.doc-scenario');
    if (found.length !== 1) return { count: found.length };
    const el = found[0];
    const rows = (selector) => {
      const table = el.querySelector(selector);
      return table ? Array.from(table.querySelectorAll('tbody tr')).map((row) => Array.from(row.cells).map((cell) => cell.textContent.trim())) : null;
    };
    return {
      count: 1,
      boxes: el.getClientRects().length,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      heading: el.querySelector('h2').textContent,
      sheet: el.classList.contains('new-sheet'),
      changes: rows('.doc-table--changes'),
      figures: rows('.doc-table--scenario'),
      places: Array.from(el.querySelectorAll('.doc-table--scenario-places')).map((table) => Array.from(table.querySelectorAll('tbody tr')).map((row) => Array.from(row.cells).map((cell) => cell.textContent.trim()))),
      script: doc.querySelectorAll('script, b').length,
    };
  });
}

async function closePreview() {
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
}

// A case that failed may have left its sheet open: each case starts with none.
async function noPreview() {
  if (await page.$('#print-preview')) await closePreview();
}

// The preview opened with the opener alone, as the scenario lab opens it.
// The module comes in by a module script the page loads itself (an import()
// inside page.evaluate came back "Promise was collected" here), and the
// sheet is opened in a synchronous evaluate.
async function openFromLab() {
  if (!(await view(() => typeof globalThis.sv2open === 'function'))) {
    await page.addScriptTag({ type: 'module', content: "import { openPrintPreview } from './ui/components/print-preview.js'; globalThis.sv2open = openPrintPreview;" });
    await page.waitForFunction(() => typeof globalThis.sv2open === 'function');
  }
  await view(() => {
    const opener = document.querySelector('#inspector [data-action="print-congestion"]');
    globalThis.sv2preview = globalThis.sv2open(globalThis.sv2.ctx, 'congestion', { opener });
  });
}

before(async () => {
  session = await openPlanner({ hash: '#movement', theme: 'light', width: 1440, height: 900 });
  page = session.page;
  await settled();
  // the scenario, through the actions as the lab will apply them
  await view(async (name, changes) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    const store = globalThis.sv2.store;
    store.apply(actions.newScenario, { name });
    for (const change of changes) store.apply(actions.addScenarioChange, { change });
  }, NAME, CHANGES);
  await settled();
  await page.click('#inspector [role="tab"][data-tab="export"]');
  await page.waitForSelector('#inspector [data-panel="export"] [data-action="print-congestion"]');
});

after(async () => {
  await view(async () => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(actions.discardScenario, {});
  });
  const problems = session.problems();
  await session.close();
  assert.deepEqual(problems.errors, [], 'no page error');
});

let fromMovement = null;

test('from Movement\'s button the report carries the scenario\'s changes, figures, findings and places once its comparison comes', async () => {
  await noPreview();
  assert.equal(await view(() => globalThis.sv2.store.project.scenario.changes.length), 2);
  await page.click('#inspector [data-action="print-congestion"]');
  await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"]', { timeout: 20000 });
  fromMovement = await section();
  assert.equal(fromMovement.count, 1);
  assert.ok(fromMovement.boxes > 0, 'the section is laid out');
  assert.equal(fromMovement.heading, 'The scenario: ' + NAME, 'the name as typed');
  assert.equal(fromMovement.script, 0, 'no name became markup');
  assert.ok(fromMovement.sheet, 'the comparison starts a sheet');
  assert.deepEqual(fromMovement.changes, [
    ['1', '7C · A Day · Period 2: 203 → 204, taught by Mme. Dufrêne instead of Ms. Vandermeer'],
    ['2', '8A · A Day · Period 7: 303 → 101, taught by Ms. Halloran instead of Ms. O\'Fennimore'],
  ]);
  const figures = Object.fromEntries(fromMovement.figures.map((row) => [row[0], row.slice(1)]));
  // SV2-72d: times as the lab shows them, from an hour in hours and minutes, no-break spaces inside
  const plain = (cells) => cells.map((cell) => cell.replace(/\u00a0/g, ' '));
  assert.deepEqual(plain(figures['Walking, all walks together']), ['2 h 34 min', '2 h 33 min', '−1 min']);
  assert.deepEqual(plain(figures['Lost to the crowd']), ['7 min 58 s', '8 min 21 s', '+23 s']);
  assert.ok(figures['Lost to the crowd'].every((cell) => !cell.includes(' ')), 'no breaking space inside a time');
  assert.deepEqual(figures['Late walks'], ['1', '0', '−1']);
  assert.ok(fromMovement.text.includes('New findings 1') && fromMovement.text.includes('Resolved findings 2'));
  assert.deepEqual(fromMovement.places[0][0], ['Upper Corridor', 'A Day', '147', '175', '+28 busier']);
  assert.deepEqual(fromMovement.places[1], [['Music Wing', 'A Day', '53', '25', '−28 quieter']]);
  await closePreview();
});

test('opened with { opener } alone, as the lab opens it, the section is the same text', async () => {
  await noPreview();
  assert.ok(fromMovement, 'the case before ran');
  await openFromLab();
  await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"]', { timeout: 20000 });
  const fromLab = await section();
  assert.ok(fromLab.boxes > 0);
  assert.equal(fromLab.text, fromMovement.text);
  assert.deepEqual(fromLab.figures, fromMovement.figures);
  await closePreview();
  // and the focus went back to the opener
  assert.equal(await view(() => document.activeElement && document.activeElement.dataset.action), 'print-congestion');
});

test('while the comparison has not come the section says the report is of the schedule as it stands; a failed one, none to ask and a throwing show say so', async () => {
  await noPreview();
  // the page's own scenario() set aside meanwhile, and put back whatever happens
  await view(() => {
    const derived = globalThis.sv2.store.derived;
    globalThis.sv2test = { scenario: derived.scenario };
  });
  try {
    // a lane that never answers
    await view(() => {
      globalThis.sv2.store.derived.scenario = () => new Promise(() => {});
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="asked"][data-ready="true"]');
    const pending = await section();
    assert.ok(pending.boxes > 0);
    assert.equal(pending.text, 'The scenario: ' + NAME + ' Every figure above was worked out for the schedule as it stands. What the scenario ' + NAME + ' would change is still being worked out.');
    assert.equal(pending.figures, null);
    await closePreview();

    // one that fails
    await view(() => {
      globalThis.sv2.store.derived.scenario = () => Promise.reject(new Error('The worker stopped'));
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"]');
    const failed = await section();
    assert.equal(failed.text, 'The scenario: ' + NAME + ' What the scenario ' + NAME + ' would change could not be worked out: The worker stopped. Nothing of it is printed.');
    assert.equal(failed.figures, null);
    await closePreview();

    // none to ask: the section says so at once, never "still being worked out"
    await view(() => {
      globalThis.sv2.store.derived.scenario = undefined;
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="unavailable"][data-ready="true"]');
    const none = await section();
    assert.equal(none.text, 'The scenario: ' + NAME + ' Every figure above was worked out for the schedule as it stands. What the scenario ' + NAME + ' would change cannot be worked out here, so nothing of it is printed.');
    await closePreview();

    // an answer that makes the render throw (instanceof asks its prototype,
    // and this one refuses): the flag says so and the document before stands
    await view(() => {
      const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('no prototype'); } });
      globalThis.sv2.store.derived.scenario = () => Promise.resolve(hostile);
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="failed"][data-ready="true"]');
    const stood = await section();
    assert.equal(stood.text, pending.text, 'the pending document stands');
    assert.equal(await view(() => Promise.race([globalThis.sv2preview.ready().then(() => 'ready'), new Promise((done) => setTimeout(() => done('pending'), 5000))])), 'ready');
    await closePreview();
  } finally {
    await view(() => {
      globalThis.sv2.store.derived.scenario = globalThis.sv2test.scenario;
    });
  }
});

// Hold back the next requests for the report's font files, through the
// DevTools protocol (the same under Puppeteer and Playwright; the cache off,
// so a face already read is asked for again) until release(). Held
// stylesheets would not do: the frame's load event waits for them, and the
// preview's wait only starts at that event.
async function holdFaces() {
  const client = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
  const held = [];
  client.on('Fetch.requestPaused', (event) => held.push(event.requestId));
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*/fonts/public-sans-*' }] });
  let released = false;
  return {
    held,
    async release() {
      if (released) return;
      released = true;
      for (const requestId of held.splice(0)) await client.send('Fetch.continueRequest', { requestId }).catch(() => {});
      await client.send('Fetch.disable').catch(() => {});
      await client.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
      await client.detach().catch(() => {});
    },
  };
}

test('an answer that arrives while a change of paper is still laid out waits for it, and ready() resolves', async () => {
  await noPreview();
  let hold = null;
  await view(() => {
    const derived = globalThis.sv2.store.derived;
    globalThis.sv2test = { scenario: derived.scenario };
  });
  try {
    // the real answer, handed over only when the test says
    await view(() => {
      const real = globalThis.sv2test.scenario;
      globalThis.sv2.store.derived.scenario = () => new Promise((resolve, reject) => {
        globalThis.sv2answer = () => real().then(resolve, reject);
      });
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="asked"][data-ready="true"][data-paper="letter portrait"]');
    // the next document's faces are held back, so its layout waits on them
    hold = await holdFaces();
    await view(() => {
      document.querySelector('#print-preview input[value="a4"]').click();
      globalThis.sv2ready = globalThis.sv2preview.ready().then(() => 'ready');
    });
    for (let tries = 0; hold.held.length === 0 && tries < 200; tries += 1) await new Promise((done) => setTimeout(done, 25));
    assert.ok(hold.held.length > 0, 'the paper\'s document asked for its faces');
    assert.equal(await view(() => document.getElementById('print-preview').dataset.ready), 'false', 'the paper\'s document is still being laid out');
    // the answer comes now, then the faces
    await view(() => globalThis.sv2answer());
    await new Promise((done) => setTimeout(done, 200));
    await hold.release();
    assert.equal(await view(() => Promise.race([globalThis.sv2ready, new Promise((done) => setTimeout(() => done('pending'), 5000))])), 'ready', 'ready() taken during the paper\'s layout resolves');
    await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"][data-paper="a4 portrait"]', { timeout: 20000 });
    const answered = await section();
    assert.deepEqual(answered.figures, fromMovement.figures, 'the answer is in the document on show');
    assert.equal(await view(() => Promise.race([globalThis.sv2preview.ready().then(() => 'ready'), new Promise((done) => setTimeout(() => done('pending'), 5000))])), 'ready');
    // the paper back as it was
    await page.click('#print-preview input[value="letter"]');
    await page.waitForSelector('#print-preview[data-ready="true"][data-paper="letter portrait"]');
    await closePreview();
  } finally {
    if (hold) await hold.release();
    await view(() => {
      globalThis.sv2.store.derived.scenario = globalThis.sv2test.scenario;
    });
  }
});

test('SV2-72d 6: a paper chosen while the answer\'s own document is laid out ends that layout\'s wait, and a ready() taken then resolves', async () => {
  await noPreview();
  let hold = null;
  await view(() => {
    globalThis.sv2test = { scenario: globalThis.sv2.store.derived.scenario };
  });
  try {
    await view(() => {
      const real = globalThis.sv2test.scenario;
      globalThis.sv2.store.derived.scenario = () => new Promise((resolve, reject) => {
        globalThis.sv2answer = () => real().then(resolve, reject);
      });
    });
    await openFromLab();
    await page.waitForSelector('#print-preview[open][data-scenario="asked"][data-ready="true"][data-paper="letter portrait"]');
    // the answer's document asks for its faces and is held there
    hold = await holdFaces();
    await view(() => globalThis.sv2answer());
    await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="false"]', { timeout: 20000 });
    for (let tries = 0; hold.held.length === 0 && tries < 200; tries += 1) await new Promise((done) => setTimeout(done, 25));
    assert.ok(hold.held.length > 0, 'the answer\'s document asked for its faces');
    // taken now, ready() is the answer's layout (a task of its own, before the paper)
    await view(() => {
      globalThis.sv2answerReady = 'pending';
      globalThis.sv2preview.ready().then(() => {
        globalThis.sv2answerReady = 'ready';
      });
    });
    await page.click('#print-preview input[value="a4"]');
    assert.equal(await view(() => document.getElementById('print-preview').dataset.ready), 'false', 'the paper\'s document is being laid out');
    // the faces come now (the paper's document asks for the same files, so
    // it waits on the same requests)
    await hold.release();
    await page.waitForSelector('#print-preview[open][data-scenario="answered"][data-ready="true"][data-paper="a4 portrait"]', { timeout: 20000 });
    assert.equal(await view(() => globalThis.sv2answerReady), 'ready', 'the answer\'s layout, replaced, no longer waits');
    const answered = await section();
    assert.deepEqual(answered.figures, fromMovement.figures, 'the answer is in the document on show');
    await page.click('#print-preview input[value="letter"]');
    await page.waitForSelector('#print-preview[data-ready="true"][data-paper="letter portrait"]');
    await closePreview();
  } finally {
    if (hold) await hold.release();
    await view(() => {
      globalThis.sv2.store.derived.scenario = globalThis.sv2test.scenario;
    });
  }
});
