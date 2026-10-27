// The screens the sweeps visit: no-offsite.mjs opens each and counts requests,
// a11y/axe.mjs runs axe-core on each in both themes. A unit that adds a screen
// (a section, a sub-tab, a dialog, a state worth checking) adds a line here
// and both sweeps cover it.
//
//   { id, hash, open }
//   hash   the address to load
//   open   optional: async (page) => {} to bring up what the address alone does
//          not show (a dialog, a menu, an emptied project)
//   viewport  optional: { width, height, mobile } the page is loaded at, with
//          touch when `mobile` (SV2-57); the next screen without one is at
//          the sweep's own size again (harness.mjs's visit)
//   close  optional: async (page) => {} that a sweep runs once it has checked
//          the screen, to put away what `open` started outside the page (the
//          second tab of the read-only screen, SV2-32g1)
//
// A screen with the print preview open is checked twice by axe.mjs: the
// planner's page, and the document inside the preview's frame (SV2-32g1).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { go, loadModule, waitForSection } from './harness.mjs';

const TRACE_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'images', 'floor-plan.png');

const press = (key) => async (page) => {
  await page.keyboard.press(key);
};

async function removeSample(page) {
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForFunction(() => document.getElementById('sample-chip').hidden);
}

// SV2-24: the Staff browser section once its preview frame has been fed.
async function staffLive(page) {
  await page.waitForFunction(() => document.querySelector('.stf-preview')?.dataset.preview === 'live', { timeout: 30000 });
}

// SV2-11: the Schedule section draws again a moment after a change.
async function scheduleDrawn(page) {
  await page.waitForFunction(() => document.querySelector('.sch') && document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('link[data-sheet="schedule"]').sheet !== null);
}

// SV2-11: an empty project, then one of the schedule's tabs.
const scheduleEmpty = (tab) => async (page) => {
  await removeSample(page);
  await page.evaluate((hash) => {
    location.hash = hash;
  }, '#schedule/' + tab);
  await page.waitForSelector('.sch [data-tab="' + tab + '"] .sch-empty');
  await scheduleDrawn(page);
};

// SV2-12: the Grid tab once its own stylesheet has loaded.
async function gridDrawn(page) {
  await scheduleDrawn(page);
  await page.waitForFunction(() => document.querySelector('link[data-sheet="grid"]')?.sheet && document.querySelector('.grd'));
}

// SV2-12: stage a block in the grid as a spreadsheet's paste would. Staged
// edits make the browser ask before the page is left, so the question is
// answered here for the sweep's next page load: leave.
async function gridStaged(page) {
  if (!page.sv2LeavesStagedEdits) {
    page.sv2LeavesStagedEdits = true;
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'beforeunload') dialog.accept();
    });
  }
  await gridDrawn(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '301\t302\tPortable 4\r\n101\t203\tGym\r\n');
    const cell = document.querySelector('.grd-cell--slot');
    cell.focus();
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.grd-bar');
  await scheduleDrawn(page);
}

// SV2-12: the grid read by teacher or by room.
const gridRows = (rows) => async (page) => {
  await gridDrawn(page);
  await page.evaluate((value) => document.querySelector('.grd-toolbar input[value="' + value + '"]').click(), rows);
  await page.waitForFunction((value) => document.querySelector('.grd').dataset.rows === value && document.querySelector('.grd-table--read'), {}, rows);
  await scheduleDrawn(page);
};

// SV2-40: the grid on a phone, where Group and the periods are what shows.
// The screen is loaded at a phone's size with touch (its `viewport`, SV2-72e;
// it used to be resized here, with no touch).
async function gridOnPhone(page) {
  await page.waitForFunction(() => window.innerWidth === 390);
  await gridDrawn(page);
  await page.waitForFunction(() => document.querySelector('.grd-cell--grade').getClientRects().length === 0);
}

// SV2-38: a screen of the schedule on a phone, loaded at a phone's size with
// touch (its `viewport`, SV2-72e).
async function scheduleOnPhone(page) {
  // the section says which width its last drawing was for
  await page.waitForFunction(() => window.innerWidth === 390 && document.querySelector('.sch')?.dataset.narrow === 'true');
  await scheduleDrawn(page);
}

// SV2-38: the Checks tab on a phone, a finding's buttons under its sentence.
async function checksOnPhone(page) {
  await scheduleOnPhone(page);
  await page.waitForSelector('.sch-checks .sch-finding__cell');
}

// SV2-70: the Fix dialog on the sample school's double-booked room, answered;
// `others` turns the switch on (the other teachers' rooms asked for too).
const fixOpen = (options) => async (page) => {
  const opts = options || {};
  await scheduleDrawn(page);
  await page.waitForSelector('.sch-findings tr[data-finding="room-double:dsample00a:1:rsample203"] [data-action="fix"]', { timeout: 30000 });
  await page.click('.sch-findings tr[data-finding="room-double:dsample00a:1:rsample203"] [data-action="fix"]');
  await page.waitForFunction(() => document.getElementById('fix-dialog')?.dataset.state === 'answered', { timeout: 30000 });
  if (opts.others) {
    await page.click('#fix-dialog [data-part="others"]');
    await page.waitForFunction(() => document.getElementById('fix-dialog').dataset.others === 'true' && document.getElementById('fix-dialog').dataset.state === 'answered', { timeout: 30000 });
  }
};

// SV2-38: the Groups tab on a phone after a group is chosen: its card, "All
// groups", and the editor.
async function groupEditorOnPhone(page) {
  await scheduleOnPhone(page);
  await page.evaluate(() => document.querySelectorAll('.sch-group')[1].click());
  await page.waitForFunction(() => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-groups').dataset.folded === 'true' && document.querySelector('.sch-editor').getClientRects().length > 0);
}

// SV2-40: the Teachers table with the cell of the sample's double-booking in
// focus, its sentence drawn under it.
async function gridTeachersMarked(page) {
  await gridRows('teachers')(page);
  await page.focus('.grd-table--read .is-marked');
}

// SV2-06: the plan is drawn once its own stylesheet has loaded.
async function planReady(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.bld');
    return Boolean(section) && section.dataset.styled === 'true' && section.editor.view.width > 0;
  });
}

// SV2-06: click the first room of the floor on screen, with the tool whose key is given.
async function clickRoom(page, key) {
  await planReady(page);
  await page.keyboard.press(key);
  const at = await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const room = editor.floor.spaces.find((space) => space.kind === 'room');
    const box = editor.canvas.getBoundingClientRect();
    const place = editor.view.toScreen((room.cells[0] % editor.floor.width) + 0.5, Math.floor(room.cells[0] / editor.floor.width) + 0.5);
    return { x: box.left + place.x, y: box.top + place.y };
  });
  await page.mouse.click(at.x, at.y);
}

// SV2-13: hand a file to one of the page's file inputs, as the picker would.
async function chooseFile(page, selector, name, body) {
  await page.evaluate((which, fileName, contents) => {
    const input = document.querySelector(which);
    const data = new DataTransfer();
    data.items.add(new File([contents], fileName));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, name, body);
}

// SV2-13: the Import tab once its own stylesheet has loaded.
async function importDrawn(page) {
  await scheduleDrawn(page);
  await page.waitForFunction(() => document.querySelector('link[data-sheet="import"]')?.sheet && document.querySelector('.imp'));
}

// SV2-13: one of the tool's own files for the project on screen, as text.
const fileText = (page, kind) => page.evaluate(async (which) => {
  const { buildExport } = await import(new URL('engine/exports.js', location.href).href);
  return buildExport(globalThis.sv2.store.project, which, {}).text;
}, kind);

// SV2-13: a groups CSV read, with a column to correct, a room that is not in
// the building, a group that is already here and a new name being asked for.
async function importGroupsRead(page) {
  await importDrawn(page);
  await chooseFile(page, '.imp input[data-file="groups"]', 'groups.csv', 'Group,Grade,Students,Third,Period 1\r\n6A,6,24,101,201\r\n9Z,9,twenty,999,Annex 4\r\n,,,,102\r\n');
  await page.waitForSelector('.imp-mapping');
  await scheduleDrawn(page);
  await page.click('[data-key="imp-groups:all:rename"]');
  await page.waitForSelector('[data-key="imp-groups:name:6a"]');
  await scheduleDrawn(page);
}

// SV2-13: a mapping that cannot be used, a teachers file with no Teacher
// column, a subjects preview, and a schedule file that is not one.
async function importRefused(page) {
  await importDrawn(page);
  await chooseFile(page, '.imp input[data-file="groups"]', 'no names.csv', 'Room,Period 1\r\n101,201\r\n');
  await page.waitForSelector('.imp [data-problems="mapping"]');
  await scheduleDrawn(page);
  await chooseFile(page, '.imp input[data-file="teachers"]', 'rooms.csv', 'Staff,Rooms\r\nMs. Halloran,101\r\n');
  await page.waitForSelector('.imp [data-problems="teachers"]');
  await scheduleDrawn(page);
  await chooseFile(page, '.imp input[data-file="subjects"]', 'subjects.csv', 'Code,Subject,Colour\r\nMATH,Maths,teal\r\nDRAMA,Drama,#26f\r\n,,\r\n');
  await page.waitForSelector('.imp [data-panel="subjects"] .imp-preview');
  await scheduleDrawn(page);
  await chooseFile(page, '.imp input[data-file="schedule"]', 'not a schedule.json', '{"format":"sv2-building","version":1}');
  await page.waitForSelector('.imp [data-refused="schedule"]');
  await scheduleDrawn(page);
}

// SV2-13: a schedule file read, with every group already here answered for one by one.
async function importScheduleRead(page) {
  await importDrawn(page);
  await chooseFile(page, '.imp input[data-file="schedule"]', 'schedule.json', await fileText(page, 'schedule'));
  await page.waitForSelector('.imp [data-clash="imp-schedule"] table');
  await scheduleDrawn(page);
}

// SV2-13: an import that has been done, with its line on the tab and its toast.
async function importDone(page) {
  await importDrawn(page);
  await chooseFile(page, '.imp input[data-file="teachers"]', 'staff.csv', 'Teacher,Notes\r\nMx. Oakhollow,Part time\r\n');
  await page.waitForSelector('.imp [data-action="import-teachers"]');
  await scheduleDrawn(page);
  await page.click('.imp [data-action="import-teachers"]');
  await page.waitForSelector('.imp [data-done="teachers"]');
  await scheduleDrawn(page);
}

// SV2-13: the Project file card asking before it replaces the project.
async function projectImportQuestion(page) {
  await chooseFile(page, '#project-file input[data-file="project"]', 'school.json', await fileText(page, 'project'));
  await page.waitForSelector('dialog.dialog[open]');
}

// SV2-13: the Project file card after a file it refused.
async function projectImportRefused(page) {
  await chooseFile(page, '#project-file input[data-file="project"]', 'cut short.json', (await fileText(page, 'project')).slice(0, 500));
  await page.waitForSelector('#project-file [data-result="refused"]');
}

// SV2-07: a tab of the building inspector.
const inspectorTab = (tab) => async (page) => {
  await planReady(page);
  await page.click('#inspector [data-tab="' + tab + '"]');
  await page.waitForSelector('#inspector-' + tab);
  await page.waitForFunction(() => document.querySelector('link[data-sheet="building-inspector"]').sheet !== null);
};

// SV2-17: the movement view once it has the routes and has drawn them.
async function movementDrawn(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && Number(movement.canvas.dataset.drawn || 0) > 0;
  });
}

// SV2-17: the movement view with something chosen on it.
const movementShowing = (patch) => async (page) => {
  await movementDrawn(page);
  await page.evaluate((next) => document.querySelector('.mov').movement.change(next), patch);
  await movementDrawn(page);
};

// SV2-80b (asked for when SV2-79 landed): Movement with a bell schedule named
// "Early Release", periods 5 to 8 not meeting, chosen in the Bells control.
async function movementEarlyRelease(page) {
  await movementDrawn(page);
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.addBellSchedule, { id: 'bsample0er', name: 'Early Release', short: '', fromDayTypeId: store.project.dayTypes[0].id });
    store.apply(actions.setBellSchedule, { bellScheduleId: 'bsample0er', off: [4, 5, 6, 7] });
  });
  await movementDrawn(page);
  await page.evaluate(() => document.querySelector('.mov').movement.change({ bellsId: 'bsample0er' }));
  await movementDrawn(page);
  await page.waitForFunction(() => /with Early Release bells/.test(document.querySelector('#movement-line .mov-line__words')?.textContent || ''));
}

// SV2-19: playback moved by its scrubber to a second of Period 6 to Period 7,
// the sample school's long walk, with the settings behind More open or not.
const playbackAt = (seconds, more) => async (page) => {
  await movementShowing({ transition: 5 })(page);
  if (more) await page.click('[data-bar="playback"] [data-action="more"]');
  await page.$eval('[data-bar="playback"] [data-control="scrubber"]', (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
  await page.waitForFunction(() => document.querySelector('[data-bar="playback"]').dataset.started === 'true');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

// SV2-68: the scenario lab with a scenario open on the sample school (a move
// that changes who teaches, a swap of periods, a swap of rooms), drawn and
// its comparison answered; `dropped` deletes the room the move goes to.
const scenarioOpen = (options) => async (page) => {
  const opts = options || {};
  await page.waitForFunction(() => document.querySelector('.scn') && document.querySelector('.scn').dataset.styled === 'true', { timeout: 20000 });
  await page.evaluate(async (drop) => {
    const { newScenario, addScenarioChange, deleteSpaces } = await import(new URL('engine/actions.js', location.href).href);
    const store = globalThis.sv2.store;
    store.apply(newScenario, { name: 'Library swap' });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
    store.apply(addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample06a', periodA: 0, periodB: 3 } });
    store.apply(addScenarioChange, { change: { kind: 'swapRooms', dayTypeId: 'dsample00a', groupA: 'gsample08a', groupB: 'gsample08b', period: 1 } });
    if (drop) store.apply(deleteSpaces, { spaceIds: ['rsample101'] });
  }, opts.dropped === true);
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    return el.dataset.mode === 'open' && el.dataset.compare === 'ready' && !el.scenarios.pending && el.scenarios.plan.project === globalThis.sv2.store.project && Number(document.getElementById('scenarios-plan').dataset.drawn || 0) > 0;
  }, { timeout: 30000 });
  if (opts.apply) {
    await page.click('[data-action="apply"]');
    await page.waitForSelector('#scenario-apply[open]');
  }
};

// SV2-69: the scenario lab's difference map: 7A moved out of the Library
// for Period 3, the comparison narrowed to Period 3 to Period 4 (corridors
// busier and quieter at full strength), painted, with the card of the
// strongest busier cell up under the pointer.
const differenceShown = async (page) => {
  await page.waitForFunction(() => document.querySelector('.scn') && document.querySelector('.scn').dataset.styled === 'true', { timeout: 20000 });
  await page.evaluate(async () => {
    const { newScenario, addScenarioChange } = await import(new URL('engine/actions.js', location.href).href);
    const store = globalThis.sv2.store;
    document.querySelector('.scn').scenarios.memory.transition = 2;
    store.apply(newScenario, { name: 'Library move' });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    return el.dataset.difference === 'shown' && !el.scenarios.pending && el.difference.answer === el.scenarios.answer && el.difference.painted.made === el.dataset.differenceMade;
  }, { timeout: 30000 });
  // the cell brought to the middle of the map, painted there, then pointed at
  const drawn = await page.evaluate(() => {
    const el = document.querySelector('.scn');
    const hot = el.difference.state().busier.sort((a, b) => b.delta - a.delta)[0];
    const was = Number(document.getElementById('scenarios-plan').dataset.drawn || 0);
    el.scenarios.plan.show(hot.floorId, [hot.cell]);
    el.scenarios.plan.paint();
    return was;
  });
  await page.waitForFunction((was) => Number(document.getElementById('scenarios-plan').dataset.drawn || 0) > was, {}, drawn);
  const at = await page.evaluate(() => {
    const el = document.querySelector('.scn');
    const hot = el.difference.state().busier.sort((a, b) => b.delta - a.delta)[0];
    const middle = el.scenarios.plan.cellAt(hot.floorId, hot.cell);
    const box = document.getElementById('scenarios-plan').getBoundingClientRect();
    return { x: box.left + middle.x, y: box.top + middle.y };
  });
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => !document.querySelector('[data-card="difference"]').hidden);
};

// SV2-67: the Safety section once its map is styled, measured and drawn for
// the project in the store.
async function safetyDrawn(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.sfy');
    return el && el.dataset.styled === 'true' && el.safety && el.safety.picture && el.safety.plan.project === globalThis.sv2.store.project && Number(document.getElementById('safety-plan').dataset.drawn || 0) > 0;
  }, { timeout: 20000 });
}

// SV2-67: the Safety inspector on one of its tabs.
const safetyTab = (tab) => async (page) => {
  await page.click('.sfy-inspector .tabs__tab[data-tab="' + tab + '"]');
  await page.waitForFunction((which) => document.querySelector('.sfy-panel[data-panel="' + which + '"]')?.getClientRects().length > 0, {}, tab);
};

// SV2-67: the sample school with one room on Floor 1 that opens onto nothing.
async function safetyCutOff(page) {
  await safetyDrawn(page);
  await page.evaluate(async () => {
    const { sampleSchool } = await import(new URL('data/sample-school.js', location.href).href);
    const project = sampleSchool();
    const floor = project.building.floors[0];
    const owned = new Set(floor.spaces.flatMap((space) => space.cells));
    const empty = (x, y) => x >= 0 && y >= 0 && x < floor.width && y < floor.height && floor.cells[y * floor.width + x] === '.' && !owned.has(y * floor.width + x);
    let at = null;
    for (let y = 1; y < floor.height - 3 && !at; y += 1) {
      for (let x = 1; x < floor.width - 3 && !at; x += 1) {
        let ok = true;
        for (let dy = -1; dy <= 2 && ok; dy += 1) for (let dx = -1; dx <= 2 && ok; dx += 1) if (!empty(x + dx, y + dy)) ok = false;
        if (ok) at = [x, y];
      }
    }
    const [x, y] = at;
    floor.spaces.push({ id: 'rsafetycut', kind: 'room', cells: [y * floor.width + x, y * floor.width + x + 1, (y + 1) * floor.width + x, (y + 1) * floor.width + x + 1], number: 'Annex 9', teacherIds: [], subjectId: null, wing: '', capacity: 12, shared: false, doors: [] });
    // the theme stays the one the project has (a sweep may have chosen it)
    project.settings.theme = globalThis.sv2.store.project.settings.theme;
    globalThis.sv2.store.replace(project);
  });
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.missing === '1');
  await safetyDrawn(page);
}

// SV2-32g1: the preview sheet opened by a screen's own button, its document
// laid out in the frame.
async function previewReady(page) {
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 30000 });
}
const printFrom = (button) => async (page) => {
  await page.waitForSelector(button);
  await page.click(button);
  await previewReady(page);
};

// SV2-32g1: the shell's question dialog, open, and the one asked for: its
// title (ui/components/dialog.js's .dialog__title) is `title`, a string to
// match whole or a RegExp, and it is the only dialog open. Most of the
// planner's questions are made by confirm(), which gives a dialog no id, so
// the title is what tells one from another (SV2-32g1b: any open dialog used
// to do). Throws with the titles that are open when the one wanted is not.
async function asked(page, title) {
  const wanted = title instanceof RegExp ? title : new RegExp('^' + String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const open = () => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((dialog) => (dialog.querySelector('.dialog__title') || dialog).textContent.trim().slice(0, 120)));
  try {
    await page.waitForFunction((source, flags) => {
      const match = new RegExp(source, flags);
      return Array.from(document.querySelectorAll('dialog.dialog[open] .dialog__title')).some((heading) => match.test(heading.textContent.trim()));
    }, { timeout: 15000 }, wanted.source, wanted.flags);
  } catch (error) {
    throw new Error('asked: no open dialog is titled ' + wanted + '; open: ' + JSON.stringify(await open()) + ' (' + error.message + ')');
  }
  const seen = await open();
  if (seen.length !== 1) throw new Error('asked: ' + seen.length + ' dialogs are open, wanted only ' + wanted + ': ' + JSON.stringify(seen));
}

// SV2-32g1: a store action, applied as the page would: the module loaded by
// the harness's loadModule (an import() awaited inside page.evaluate is the
// flaky pattern its comment names), applied in the next turn.
async function act(page, name, payload) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((action, given) => globalThis.sv2.store.apply(globalThis.sv2modules.actions[action], given), name, payload);
}

// SV2-32g1b: an IndexedDB request on the page's own database, settled: the
// promise it returns rejects with the reason when the database cannot be
// opened, is blocked, or the transaction fails or is aborted.
const IDB_HELPER = `
  globalThis.sv2idb = (store, write) => new Promise((resolve, reject) => {
    const opened = indexedDB.open('sv2');
    opened.onerror = () => reject(new Error('indexedDB.open(sv2) failed: ' + (opened.error && opened.error.message)));
    opened.onblocked = () => reject(new Error('indexedDB.open(sv2) is blocked by another connection'));
    opened.onsuccess = () => {
      const db = opened.result;
      let tx;
      try {
        tx = db.transaction(store, 'readwrite');
        write(tx.objectStore(store));
      } catch (error) {
        db.close();
        reject(new Error('writing ' + store + ' failed: ' + error.message));
        return;
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error('writing ' + store + ' failed: ' + (tx.error && tx.error.message)));
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('writing ' + store + ' was aborted: ' + (tx.error ? tx.error.message : 'no reason given')));
      };
    };
  });
`;
async function idbReady(page) {
  await page.evaluate(IDB_HELPER);
}

// SV2-32g1: a field typed over and left, as a person commits it.
async function retype(page, selector, typed) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(typed);
  await page.keyboard.press('Enter');
}

// SV2-32g1: the Floor tab of the Building inspector with the sample school's
// first floor traced over the fixture image, its controls drawn.
async function traced(page) {
  await inspectorTab('floor')(page);
  const input = await page.$('#trace-file');
  await input.uploadFile(TRACE_FIXTURE);
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].image !== null);
  await page.waitForSelector('#trace-move');
}

// SV2-32g1: one of the trace modes started from its button on the Floor tab.
const traceMode = (button, shown) => async (page) => {
  await traced(page);
  await page.click(button);
  try {
    await page.waitForSelector(shown, { timeout: 15000 });
  } catch (error) {
    throw new Error('the trace mode of ' + button + ' did not start: ' + shown + ' never matched (' + error.message + ')');
  }
};

// SV2-32g1: a project file of the page's own, handed to a file input.
const fileOf = (selector, name, kind, title) => async (page) => {
  await chooseFile(page, selector, name, await fileText(page, kind));
  await asked(page, title);
};

// SV2-32g1: one of the three Clear buttons on Project with the device keeping
// as many snapshots as it keeps (30, storage/snapshots.js), which is when
// Clear asks before going on: there is no snapshot to take first.
const clearAsks = (which, title) => async (page) => {
  await page.waitForSelector('#clear [data-action="clear-' + which + '"]');
  await idbReady(page);
  await page.evaluate(() => globalThis.sv2idb('snapshots', (objects) => {
    for (let i = 0; i < 30; i += 1) objects.put({ id: 'nfill' + String(i).padStart(5, '0'), name: 'Kept ' + i, takenAt: '2026-01-01T00:00:00.000Z', bytes: 2, project: {} });
  }));
  await page.click('#clear [data-action="clear-' + which + '"]');
  await asked(page, title);
};

// SV2-32g1: the sample school changed, so it is someone's work, and a
// recovery point taken of it, listed on the card.
async function withRecoveryPoint(page) {
  await act(page, 'setSetting', { key: 'schoolName', value: 'Larkspur Middle School' });
  await page.evaluate(() => globalThis.sv2.storage.takeRecoveryPoint('timer'));
  await page.waitForFunction(() => Number(document.getElementById('recovery').dataset.points || 0) > 0);
}

// SV2-32g1: the saved project unreadable, and the page loaded again over it,
// with a recovery point to offer.
async function startUpRecovery(page) {
  await withRecoveryPoint(page);
  await page.waitForFunction(async () => {
    await globalThis.sv2.storage.flush();
    return globalThis.sv2.storage.pending === false;
  }, { polling: 50 });
  await idbReady(page);
  await page.evaluate(() => globalThis.sv2idb('project', (objects) => {
    objects.put({ savedAt: '2026-09-01T12:00:00.000Z', project: { format: 'sv2-project', version: 1, building: 'not a building' }, exportedAt: null }, 'current');
  }));
  // The page loaded again as visit() loads one, but for the section: the
  // shell draws its section and sets data-ready only once the start-up
  // question is answered (ui/app.js awaits ctx.storage.ready before route()),
  // so here the question is what is waited for, then the fonts.
  const url = page.url();
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
  // the four start-up questions share #recovery-dialog: this is the one for
  // an unreadable project with a recovery point to offer (storage/session.js)
  await asked(page, 'The saved project could not be read.');
  await page.evaluate(() => document.fonts.ready);
  const restore = await page.evaluate(() => Array.from(document.querySelectorAll('#recovery-dialog[open] button')).map((button) => button.textContent.trim()));
  if (!restore.some((words) => words.startsWith('Restore the recovery point from '))) throw new Error('start-up-recovery: the dialog offers no "Restore the recovery point" button: ' + JSON.stringify(restore));
}


// SV2-32g1: this page the second tab on the project, read-only: the page
// leaves, a tab of its own opens the project and holds it, and this one comes
// back to find it held. `close` shuts that other tab.
async function secondTab(page) {
  const url = page.url();
  await page.goto('about:blank');
  // a tab of this page's own browser context, so the two share the lock:
  // Playwright's harness page has a context of its own (harness.mjs plainPage)
  const first = page.__engine === 'playwright' ? await page.context().newPage() : await page.browserContext().newPage();
  page.sv2FirstTab = first;
  await first.goto(url, { waitUntil: 'load' });
  await first.waitForFunction(() => globalThis.sv2 && globalThis.sv2.storage && globalThis.sv2.storage.state.readOnly === false && document.getElementById('banner-read-only') === null);
  await page.goto(url, { waitUntil: 'load' });
  await waitForSection(page, (new URL(url).hash.replace(/^#/, '').split('/')[0]) || 'building');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('#banner-read-only');
  await page.waitForFunction(() => globalThis.sv2.storage.state.readOnly === true);
}
async function closeSecondTab(page) {
  if (page.sv2FirstTab) await page.sv2FirstTab.close();
  page.sv2FirstTab = null;
}

// SV2-32g1: the Getting started card at a width that folds it, unfolded or not.
const gettingStarted = (unfold) => async (page) => {
  await page.waitForSelector('#getting-started:not([hidden])');
  if (unfold) {
    await page.click('#getting-started [data-action="steps"]');
    await page.waitForSelector('#getting-started.getting-started--open');
  }
};

// SV2-32g1b: the sample's left-out area on its first floor (a corridor
// cell), right-clicked, and the cell menu's item whose words match `item`
// used, to the question it asks (ui/building/menu.js).
const cellMenuItem = (item, title) => async (page) => {
  await planReady(page);
  const at = await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const zone = globalThis.sv2.store.project.building.zones.find((each) => each.floorId === editor.floor.id);
    if (!zone) return null;
    const box = editor.canvas.getBoundingClientRect();
    const place = editor.view.toScreen(zone.x + 0.5, zone.y + 0.5);
    return { x: box.left + place.x, y: box.top + place.y };
  });
  if (!at) throw new Error('the floor on show has no left-out area to right-click');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.menu[role="menu"]');
  const items = await page.evaluate((source, flags) => {
    const match = new RegExp(source, flags);
    const all = Array.from(document.querySelectorAll('.menu[role="menu"] [role^="menuitem"]'));
    const wanted = all.find((each) => match.test(each.textContent.trim()));
    if (wanted) wanted.click();
    return wanted ? null : all.map((each) => each.textContent.trim());
  }, item.source, item.flags);
  if (items) throw new Error('the cell menu has no item ' + item + ': ' + JSON.stringify(items));
  await asked(page, title);
};

// SV2-32g1: the planner's dialogs, previews and states the audit of
// 2026-10-22 found no sweep visiting.
const SV2_32G1 = [
  { // the size made smaller than what is drawn: the question before anything is cut off
    id: 'building-resize-dialog',
    hash: '#building',
    open: async (page) => {
      await inspectorTab('floor')(page);
      // Enter in the field resizes (ui/building/inspector/floor.js); a click
      // on Resize after it once landed under the dialog (SV2-32g1b)
      await retype(page, '#floor-width', '20');
      await page.waitForSelector('#resize-dialog[open]');
      await asked(page, /^Resize Floor 1 to 20 × \d+ and remove what is cut off\?$/);
    },
  },
  {
    id: 'building-delete-floor',
    hash: '#building/fsample002',
    open: async (page) => {
      await inspectorTab('floor')(page);
      await page.click('#floor-delete');
      await asked(page, 'Delete Floor 2?');
    },
  },
  { // connect mode's banner, and the question it asks of two stairs on one floor
    id: 'building-connect-same-floor',
    hash: '#building/fsample002',
    open: async (page) => {
      await planReady(page);
      await page.evaluate(() => document.querySelector('.bld').editor.connect.start({ floorId: 'fsample002', cell: 332 }));
      await page.waitForSelector('#connect-banner:not([hidden])');
      const at = await page.evaluate(() => {
        const editor = document.querySelector('.bld').editor;
        const box = editor.canvas.getBoundingClientRect();
        const place = editor.view.toScreen((353 % editor.floor.width) + 0.5, Math.floor(353 / editor.floor.width) + 0.5);
        return { x: box.left + place.x, y: box.top + place.y };
      });
      await page.mouse.click(at.x, at.y);
      await asked(page, 'Connect two stairs on Floor 2?');
    },
  },
  { // a project of someone's own, and the sample school asked for over it
    id: 'project-replace-with-sample',
    hash: '#project',
    open: async (page) => {
      await removeSample(page);
      const floorId = await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].id);
      await act(page, 'paintCorridor', { floorId, cells: [0] });
      await page.click('#sample-school [data-action="sample"]');
      await asked(page, 'Replace this project with the sample school?');
    },
  },
  {
    id: 'scenarios-discard',
    hash: '#scenarios',
    open: async (page) => {
      await scenarioOpen()(page);
      await page.click('.scn [data-action="discard"]');
      await asked(page, /^Discard the scenario .+\?$/);
    },
  },
  { // a project file to compare with, over the open scenario
    id: 'scenarios-file-replace',
    hash: '#scenarios',
    open: async (page) => {
      await scenarioOpen()(page);
      await fileOf('.scn input[data-file="compare"]', 'Larkspur.json', 'project', /^Replace the scenario .+ with the comparison\?$/)(page);
    },
  },
  { // the Day tab asked for fewer periods than the schedule uses
    id: 'schedule-remove-periods',
    hash: '#schedule/day',
    open: async (page) => {
      await scheduleDrawn(page);
      await retype(page, '[data-key="day-periods"]', '6');
      await asked(page, /^Remove .+ from every day\?$/);
    },
  },
  { id: 'project-building-import', hash: '#project', open: fileOf('#project-file input[data-file="building"]', 'Larkspur building.json', 'building', /^Replace the building with the one in .Larkspur building\.json.\?$/) },
  {
    id: 'project-recovery-point-delete',
    hash: '#project',
    open: async (page) => {
      await withRecoveryPoint(page);
      await page.click('#recovery [data-action="delete"]');
      await asked(page, /^Delete the recovery point from .+\?$/);
    },
  },
  {
    id: 'project-snapshot-delete',
    hash: '#project',
    open: async (page) => {
      await page.click('[data-field="snapshot-name"]');
      await page.keyboard.type('Before moving 7th grade');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.snap__item [data-action="delete"]');
      await page.click('.snap__item [data-action="delete"]');
      await asked(page, /^Delete the snapshot .Before moving 7th grade.\?$/);
    },
  },
  { id: 'project-clear-building', hash: '#project', open: clearAsks('building', 'Clear the building?') },
  { id: 'project-clear-schedule', hash: '#project', open: clearAsks('schedule', 'Clear the schedule?') },
  { id: 'project-clear-new', hash: '#project', open: clearAsks('new', 'Start a new project in place of this one?') },
  { id: 'start-up-recovery', hash: '#project', open: startUpRecovery },
  { id: 'read-only-tab', hash: '#project', open: secondTab, close: closeSecondTab },
  { id: 'read-only-tab-building', hash: '#building', open: secondTab, close: closeSecondTab },
  { id: 'building-trace-image', hash: '#building', open: traced },
  { id: 'building-trace-moving', hash: '#building', open: traceMode('#trace-move', '#trace-move[aria-pressed="true"]') },
  { id: 'building-trace-scaling', hash: '#building', open: traceMode('#trace-scale', '#scale-mode[data-kind="scale"]:not([hidden])') },
  { id: 'building-trace-placing', hash: '#building', open: traceMode('#trace-place', '#scale-mode[data-kind="place"]:not([hidden])') },
  { id: 'building-trace-fit-floor', hash: '#building', open: async (page) => { // SV2-32g1b: "Fit the floor to the image" asks first
    await traced(page);
    // the image comes in fitted to the floor's height and centred across
    // it (on the sample, 40 by 14 cells, it covers columns 10.7 to 29.3), so
    // fitting the floor to it would cut what is drawn and is refused without
    // asking. Placed at the floor's top left one cell wider than the floor,
    // the image covers all of it and the floor only grows (41 by 31)
    const placed = await page.evaluate(() => {
      const floor = globalThis.sv2.store.project.building.floors[0];
      return { floorId: floor.id, image: { scale: (floor.width + 1) / floor.image.width, x: 0, y: 0 }, how: 'keys' };
    });
    await act(page, 'placeTraceImage', placed);
    await page.click('#trace-floor-fit');
    await asked(page, 'Make Floor 1 41 × 31 cells, the size of its image?');
  } },
  { id: 'building-corridor-name', hash: '#building', open: cellMenuItem(/^(Name this corridor|Rename the corridor .+)…$/, 'What is this corridor called?') }, // SV2-32g1b
  { id: 'building-zone-label', hash: '#building', open: cellMenuItem(/^Label the left-out area .+…$/, 'What is this left-out area?') }, // SV2-32g1b
  { id: 'getting-started-folded', hash: '#building', viewport: { width: 820, height: 900 }, open: gettingStarted(false) },
  { id: 'getting-started-open', hash: '#building', viewport: { width: 820, height: 900 }, open: gettingStarted(true) },
  { id: 'getting-started-empty', hash: '#project', open: async (page) => {
    await removeSample(page);
    // the card is Building's: Building drawn first, so a card left on Project is not what is checked
    await go(page, '#building');
    await page.waitForSelector('#getting-started:not([hidden]) [data-action="load-sample"]');
  } },
  // every output in ui/prints/index.js's OUTPUTS that no screen above opens
  { id: 'print-floor-plan', hash: '#building', open: async (page) => {
    await inspectorTab('rooms')(page);
    await printFrom('#print-floor-plan')(page);
  } },
  { id: 'print-room-list', hash: '#building', open: async (page) => {
    await inspectorTab('rooms')(page);
    await printFrom('#print-room-list')(page);
  } },
  { id: 'print-teacher-schedules', hash: '#staff', open: async (page) => {
    await staffLive(page);
    await printFrom('.pub [data-print="teacher-schedules"]')(page);
  } },
  { id: 'print-door-signs', hash: '#staff', open: async (page) => {
    await staffLive(page);
    await printFrom('.pub [data-print="door-signs"]')(page);
  } },
  { id: 'print-room-schedules', hash: '#staff', open: async (page) => {
    await staffLive(page);
    await printFrom('.pub [data-print="room-schedules"]')(page);
  } },
  { id: 'print-whole-school', hash: '#staff', open: async (page) => {
    await staffLive(page);
    await printFrom('.pub [data-print="whole-school"]')(page);
  } },
  { id: 'print-groups', hash: '#schedule/grid', open: async (page) => {
    await gridDrawn(page);
    await printFrom('#print-grid-groups')(page);
  } },
  { id: 'print-teachers', hash: '#schedule/teachers', open: async (page) => {
    await scheduleDrawn(page);
    await printFrom('#print-teachers')(page);
  } },
  { id: 'print-teacher-grid', hash: '#schedule/grid', open: async (page) => {
    await gridRows('teachers')(page);
    await printFrom('#print-grid-teachers')(page);
  } },
  { id: 'print-room-grid', hash: '#schedule/grid', open: async (page) => {
    await gridRows('rooms')(page);
    await printFrom('#print-grid-rooms')(page);
  } },
  { id: 'print-travel-time', hash: '#movement', open: async (page) => {
    await movementDrawn(page);
    await page.click('#inspector [role="tab"][data-tab="tables"]');
    await page.waitForSelector('#inspector [data-travel="day"] tbody');
    await printFrom('#print-travel-time')(page);
  } },
  { id: 'print-congestion-scenario', hash: '#scenarios', open: async (page) => {
    await scenarioOpen()(page);
    await printFrom('.scn [data-action="congestion"]')(page);
  } },
];

// SV2-78: more day types. `manyDays` gives the sample a C Day and a D Day
// with their own classes, a Testing Day the same as B Day, and an Early
// Release bell schedule whose periods 5 to 8 do not meet; `twelveDays` fills
// the list to the most a project has.
async function manyDays(page) {
  await scheduleDrawn(page);
  await act(page, 'addDayType', { name: 'C Day', own: true });
  await act(page, 'addDayType', { name: 'D Day', own: true });
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addDayType, { name: 'Testing Day', own: false, sameAs: globalThis.sv2.store.project.dayTypes[1].id }));
  await act(page, 'addBellSchedule', { name: 'Early Release' });
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setBellSchedule, { bellScheduleId: globalThis.sv2.store.project.bellSchedules[0].id, off: [4, 5, 6, 7] }));
  await scheduleDrawn(page);
}

async function twelveDays(page) {
  await manyDays(page);
  for (const name of ['E Day', 'F Day', 'G Day', 'H Day', 'I Day', 'J Day', 'K Day']) await act(page, 'addDayType', { name, own: true });
  await scheduleDrawn(page);
}

// SV2-78: B Day made the same as A Day through its Change… dialog.
async function sameAsA(page) {
  await page.click('[data-key="daytype:dsample00b:change"]');
  await page.waitForSelector('#day-kind-dialog[open]');
  await page.click('#day-kind-dialog input[value="dsample00a"]');
  await page.click('#day-kind-dialog .btn--primary');
  await page.waitForSelector('.sch-dtrow--same');
}

const dayTypeId = (page, index) => page.evaluate((at) => globalThis.sv2.store.project.dayTypes[at].id, index);

const SV2_78 = [
  { id: 'schedule-day-types', hash: '#schedule/day', open: manyDays },
  {
    id: 'schedule-day-kind-dialog',
    hash: '#schedule/day',
    open: async (page) => {
      await manyDays(page);
      await page.click('[data-key="daytype:' + (await dayTypeId(page, 2)) + ':change"]');
      await page.waitForSelector('#day-kind-dialog[open]');
      await page.click('#day-kind-dialog input[value="' + (await dayTypeId(page, 0)) + '"]');
    },
  },
  {
    id: 'schedule-day-row-menu',
    hash: '#schedule/day',
    open: async (page) => {
      await manyDays(page);
      await page.click('[data-key="daytype:' + (await dayTypeId(page, 2)) + ':menu"]');
      await page.waitForSelector('.menu[role="menu"]');
    },
  },
  {
    id: 'schedule-day-copy-dialog',
    hash: '#schedule/day',
    open: async (page) => {
      await manyDays(page);
      await page.click('[data-key="daytype:' + (await dayTypeId(page, 2)) + ':menu"]');
      await page.waitForSelector('.menu[role="menu"]');
      await page.evaluate(() => Array.from(document.querySelectorAll('.menu__item')).find((item) => item.textContent === 'Copy classes from…').click());
      await page.waitForSelector('#day-copy-dialog[open]');
    },
  },
  { id: 'schedule-day-twelve', hash: '#schedule/day', open: twelveDays },
  { id: 'schedule-day-phone', hash: '#schedule/day', viewport: { width: 390, height: 844, mobile: true }, open: manyDays },
  { id: 'schedule-group-day-chips', hash: '#schedule/groups/gsample06a', open: manyDays },
  { id: 'schedule-group-day-chips-phone', hash: '#schedule/groups/gsample06a', viewport: { width: 390, height: 844, mobile: true }, open: manyDays },
  {
    id: 'schedule-group-copy-dialog',
    hash: '#schedule/groups/gsample06a',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-day[data-day="dsample00b"] [data-action="copy-day"]');
      await page.waitForSelector('#group-copy-dialog[open]');
    },
  },
  {
    id: 'schedule-grid-day-type',
    hash: '#schedule/grid',
    open: async (page) => {
      await manyDays(page);
      await gridDrawn(page);
      await page.waitForSelector('[data-key="grid-day"]');
    },
  },
  {
    id: 'schedule-grid-copy-dialog',
    hash: '#schedule/grid',
    open: async (page) => {
      await manyDays(page);
      await gridDrawn(page);
      await page.click('.grd-toolbar [data-action="bulk"]');
      await page.waitForSelector('.menu[role="menu"]');
      await page.evaluate(() => Array.from(document.querySelectorAll('.menu__item')).find((item) => item.textContent === 'Copy classes from…').click());
      await page.waitForSelector('#grid-copy-dialog[open]');
    },
  },
];

// SV2-80: the Calendar tab. A calendar from 31 August 2026 to 11 June 2027
// with Early Release Wednesdays, a winter break and a snow day, put in by the
// store; the sweeps do not pin the clock, so today may be outside it.
async function calendarMade(page) {
  await scheduleDrawn(page);
  await act(page, 'addBellSchedule', { name: 'Early Release' });
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    const early = store.project.bellSchedules[0].id;
    const weekdays = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ day: w < 5 ? 'rotation' : 'closed', bells: w === 2 ? early : null }));
    store.apply(actions.makeCalendar, { start: '2026-08-31', end: '2027-06-11', weekdays, breaks: [{ from: '2026-12-21', to: '2027-01-01', label: 'Winter break' }] });
    store.apply(actions.setCalendarDates, { dates: ['2026-10-14'], day: 'closed', label: 'Snow day' });
  });
  await page.waitForSelector('.cal-year .cal-day');
  await scheduleDrawn(page);
}

async function calendarDialog(page) {
  await calendarMade(page);
  await dateDialogOn(page);
}

// the date dialog on 15 October, once the calendar is on screen
async function dateDialogOn(page) {
  await page.$eval('.cal-day[data-date="2026-10-15"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => document.querySelector('.toast__close')?.click());
  await page.$eval('.cal-day[data-date="2026-10-15"]', (el) => el.click());
  await page.waitForFunction(() => document.getElementById('calendar-date-dialog')?.open === true && document.getElementById('calendar-date-dialog').getAnimations().every((each) => each.playState === 'finished'));
}

const SV2_80 = [
  { id: 'schedule-calendar-empty', hash: '#schedule/calendar', open: scheduleDrawn },
  {
    id: 'schedule-calendar-setup',
    hash: '#schedule/calendar',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('[data-action="make-a-calendar"]');
      await page.waitForSelector('.cal-setup');
      await page.click('[data-key="cal-setup-add-break"]');
      await page.waitForSelector('[data-key="cal-setup-break:0:from"]');
    },
  },
  { id: 'schedule-calendar-year', hash: '#schedule/calendar', open: calendarMade },
  {
    id: 'schedule-calendar-run',
    hash: '#schedule/calendar',
    open: async (page) => {
      await calendarMade(page);
      await page.focus('.cal-day[data-date="2026-12-14"]');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');
      await page.waitForFunction(() => document.querySelector('.cal-status').textContent !== '');
    },
  },
  { id: 'schedule-calendar-dialog', hash: '#schedule/calendar', open: calendarDialog },
  {
    id: 'schedule-calendar-list',
    hash: '#schedule/calendar',
    open: async (page) => {
      await calendarMade(page);
      await page.click('.cal-list__summary');
      await page.waitForSelector('.cal-list__table');
    },
  },
  {
    id: 'schedule-calendar-import',
    hash: '#schedule/calendar',
    open: async (page) => {
      await calendarMade(page);
      await page.evaluate(() => document.querySelector('.toast__close')?.click());
      await page.click('[data-action="import-dates"]');
      await page.waitForSelector('#calendar-import[open]');
      await page.evaluate(() => document.getElementById('calendar-import').calendarRead('holidays.csv', 'Date,Day type,Note\r\n2026-11-26,No school,Thanksgiving\r\n2026-11-27,,Day after\r\n'));
      await page.waitForSelector('.cal-import__table');
    },
  },
  {
    id: 'schedule-calendar-print',
    hash: '#schedule/calendar',
    open: async (page) => {
      await calendarMade(page);
      await page.evaluate(() => document.querySelector('.toast__close')?.click());
      await page.click('#print-calendar');
      await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 30000 });
    },
  },
  { id: 'schedule-calendar-phone', hash: '#schedule/calendar', viewport: { width: 390, height: 844, mobile: true }, open: calendarMade },
  {
    id: 'schedule-calendar-dialog-phone',
    hash: '#schedule/calendar',
    viewport: { width: 390, height: 844, mobile: true },
    open: async (page) => {
      await calendarMade(page);
      await page.click('[data-key="cal-show-months"]');
      await page.waitForFunction(() => document.querySelector('.cal-year').hidden === false);
      await dateDialogOn(page);
    },
  },
  {
    id: 'staff-publish-calendar',
    hash: '#schedule/calendar',
    open: async (page) => {
      await calendarMade(page);
      await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setPublishSetting, { key: 'lastPublishedAt', value: '2026-08-31T12:00:00.000Z' }));
      await go(page, '#staff');
      await staffLive(page);
      await page.waitForFunction(() => document.querySelector('[data-says="calendar-changed"]')?.hidden === false);
    },
  },
];

export const SCREENS = [
  { id: 'building', hash: '#building' },
  { id: 'schedule-groups', hash: '#schedule/groups' },
  { id: 'schedule-grid', hash: '#schedule/grid' },
  { id: 'schedule-teachers', hash: '#schedule/teachers' },
  { id: 'schedule-subjects', hash: '#schedule/subjects' },
  { id: 'schedule-day', hash: '#schedule/day' },
  { id: 'schedule-checks', hash: '#schedule/checks' },
  { id: 'movement', hash: '#movement' },
  { id: 'scenarios', hash: '#scenarios' },
  { id: 'safety', hash: '#safety' },
  { id: 'staff', hash: '#staff' },
  { id: 'project', hash: '#project' },
  {
    id: 'help',
    hash: '#building',
    open: async (page) => {
      await press('?')(page);
      await page.waitForSelector('#help-dialog[open]');
    },
  },
  {
    id: 'theme-menu',
    hash: '#building',
    open: async (page) => {
      await page.click('#theme');
      await page.waitForSelector('.menu[role="menu"]');
    },
  },
  {
    id: 'school-name-being-edited',
    hash: '#building',
    open: async (page) => {
      await page.click('#school-name');
      await page.waitForSelector('#school-name-field');
    },
  },
  {
    id: 'undo-toast',
    hash: '#project',
    open: async (page) => {
      await page.click('#settings input[name="timeFormat"][value="24h"]');
      await page.click('#undo');
      await page.waitForSelector('.toast');
    },
  },
  {
    id: 'settings-refusal-and-picker',
    hash: '#project',
    open: async (page) => {
      await page.click('#settings input[name="periods"]', { clickCount: 3 });
      await page.keyboard.type('99');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#settings .field__refusal:not([hidden])');
      await page.click('#settings .picker__input');
      await page.keyboard.type('walk');
      await page.waitForSelector('#settings .picker__option');
    },
  },
  {
    id: 'confirm-dialog',
    hash: '#project',
    open: async (page) => {
      await page.click('#settings input[name="periods"]', { clickCount: 3 });
      await page.keyboard.type('6');
      await page.keyboard.press('Enter');
      await page.waitForSelector('dialog.dialog[open]');
    },
  },
  // SV2-11: the Schedule section's states
  { id: 'schedule-import', hash: '#schedule/import', open: scheduleDrawn }, // SV2-11
  { id: 'schedule-groups-empty', hash: '#project', open: scheduleEmpty('groups') }, // SV2-11
  { id: 'schedule-teachers-empty', hash: '#project', open: scheduleEmpty('teachers') }, // SV2-11
  { id: 'schedule-checks-empty', hash: '#project', open: scheduleEmpty('checks') }, // SV2-11
  {
    id: 'schedule-room-picker-open', // SV2-11
    hash: '#schedule/groups',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-slot .picker__input');
      await page.waitForSelector('.sch-slot .picker__option');
    },
  },
  { // SV2-38: a room number the building does not have is kept as typed (it
    // was refused when SV2-11 wrote this screen), with its line under the
    // field, and the next field's own line saying nothing matches
    id: 'schedule-room-not-in-building',
    hash: '#schedule/groups',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-slot .picker__input');
      await page.keyboard.type('B12');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-slot .sch-room__missing:not([hidden])');
      await scheduleDrawn(page);
      await page.click('.sch-slot[data-period="1"] .picker__input');
      await page.keyboard.type('zzz');
      await page.waitForFunction(() => document.querySelector('.sch-slot[data-period="1"] .sch-room__line').textContent !== '');
    },
  },
  { id: 'schedule-checks-phone', hash: '#schedule/checks', viewport: { width: 390, height: 844, mobile: true }, open: checksOnPhone }, // SV2-38; with touch since SV2-72e
  { id: 'schedule-group-editor-phone', hash: '#schedule/groups', viewport: { width: 390, height: 844, mobile: true }, open: groupEditorOnPhone }, // SV2-38; with touch since SV2-72e
  {
    id: 'schedule-slot-menu', // SV2-11
    hash: '#schedule/groups',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-slot__menu');
      await page.waitForSelector('.menu[role="menu"]');
    },
  },
  {
    id: 'schedule-day-same-as-a-day', // SV2-11
    hash: '#schedule/day',
    open: async (page) => {
      await scheduleDrawn(page);
      await sameAsA(page);
      await scheduleDrawn(page);
    },
  },
  {
    id: 'schedule-groups-same-as-a-day', // SV2-11
    hash: '#schedule/day',
    open: async (page) => {
      await scheduleDrawn(page);
      await sameAsA(page);
      await page.evaluate(() => {
        location.hash = '#schedule/groups';
      });
      await page.waitForSelector('.sch-day--same');
      await scheduleDrawn(page);
    },
  },
  {
    id: 'schedule-bell-refused-and-warned', // SV2-11
    hash: '#schedule/day',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-bells input[name="bell-end"]', { clickCount: 3 });
      await page.keyboard.type('7:00');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-bells [data-bell="end-before-start"]');
      await scheduleDrawn(page);
      await page.click('.sch-bells input[name="bell-start"]', { clickCount: 3 });
      await page.keyboard.type('noon');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-bells .field__refusal:not([hidden])');
    },
  },
  {
    id: 'schedule-teachers-look-alike', // SV2-11
    hash: '#schedule/teachers',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-teachers [data-action="add-teacher"]');
      await page.waitForFunction(() => document.activeElement && document.activeElement.value === 'New teacher');
      await scheduleDrawn(page);
      await page.keyboard.type('Ms Halloran');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-flag');
      await scheduleDrawn(page);
    },
  },
  {
    id: 'schedule-accept-dialog', // SV2-11
    hash: '#schedule/checks',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-findings [data-action="accept"]');
      await page.waitForSelector('#accept-dialog[open]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#accept-dialog .field__refusal:not([hidden])');
    },
  },
  { id: 'schedule-fix', hash: '#schedule/checks', open: fixOpen() }, // SV2-70: the Fix dialog, its sentences and Try it
  { id: 'schedule-fix-others', hash: '#schedule/checks', open: fixOpen({ others: true }) }, // SV2-70: the switch on
  { id: 'schedule-fix-phone', hash: '#schedule/checks', viewport: { width: 390, height: 844, mobile: true }, open: fixOpen() }, // SV2-70: a phone, with touch
  { id: 'schedule-fix-phone-side', hash: '#schedule/checks', viewport: { width: 844, height: 390, mobile: true }, open: fixOpen() }, // SV2-70b: a phone on its side, with touch
  {
    id: 'schedule-accepted-list', // SV2-11
    hash: '#schedule/checks',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-findings [data-action="accept"]');
      await page.waitForSelector('#accept-dialog[open]');
      await page.keyboard.type('Both coaches are there');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-findings--accepted');
      await scheduleDrawn(page);
    },
  },
  { id: 'project-empty', hash: '#project', open: removeSample },
  {
    id: 'building-empty',
    hash: '#project',
    open: async (page) => {
      await removeSample(page);
      await page.evaluate(() => {
        location.hash = '#building';
      });
      await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'building');
    },
  },
  { id: 'building-second-floor', hash: '#building/fsample002', open: planReady }, // SV2-06
  { // SV2-06
    id: 'building-room-selected',
    hash: '#building',
    open: async (page) => {
      await clickRoom(page, 'v');
      await page.waitForSelector('#room-number');
    },
  },
  { // SV2-06
    id: 'building-eraser-question',
    hash: '#building',
    open: async (page) => {
      await clickRoom(page, 'e');
      await page.waitForSelector('#erase-dialog[open]');
    },
  },
  { id: 'schedule-grid-staged', hash: '#schedule/grid', open: gridStaged }, // SV2-12
  { id: 'schedule-grid-empty', hash: '#project', open: scheduleEmpty('grid') }, // SV2-12
  { id: 'schedule-grid-teachers', hash: '#schedule/grid', open: gridRows('teachers') }, // SV2-12
  { id: 'schedule-grid-rooms', hash: '#schedule/grid', open: gridRows('rooms') }, // SV2-12
  { id: 'schedule-grid-phone', hash: '#schedule/grid', viewport: { width: 390, height: 844, mobile: true }, open: gridOnPhone }, // SV2-40; with touch since SV2-72e
  { id: 'schedule-grid-teachers-marked', hash: '#schedule/grid', open: gridTeachersMarked }, // SV2-40
  { // SV2-12: a cell being edited, with the rooms listed under it
    id: 'schedule-grid-editing',
    hash: '#schedule/grid',
    open: async (page) => {
      await gridDrawn(page);
      await page.focus('.grd-cell--slot');
      await page.keyboard.type('20');
      await page.waitForSelector('.grd-list:not([hidden]) .picker__option');
    },
  },
  { // SV2-12: Discard asks first
    id: 'schedule-grid-discard-dialog',
    hash: '#schedule/grid',
    open: async (page) => {
      await gridStaged(page);
      await page.evaluate(() => document.querySelector('.grd-bar [data-action="discard"]').click());
      await page.waitForSelector('dialog[open]');
    },
  },
  { id: 'schedule-import-groups-read', hash: '#schedule/import', open: importGroupsRead }, // SV2-13
  { id: 'schedule-import-refused', hash: '#schedule/import', open: importRefused }, // SV2-13
  { id: 'schedule-import-schedule-read', hash: '#schedule/import', open: importScheduleRead }, // SV2-13
  { id: 'schedule-import-done', hash: '#schedule/import', open: importDone }, // SV2-13
  { id: 'project-import-question', hash: '#project', open: projectImportQuestion }, // SV2-13
  { id: 'project-import-refused', hash: '#project', open: projectImportRefused }, // SV2-13
  { // SV2-14: the print preview sheet, on the checks report
    id: 'print-preview',
    hash: '#building',
    open: async (page) => {
      await page.evaluate(async () => {
        const { openPrintPreview } = await import(new URL('ui/components/print-preview.js', location.href).href);
        await openPrintPreview(globalThis.sv2.ctx, 'checks').ready();
      });
      await page.waitForSelector('#print-preview[open][data-ready="true"]');
    },
  },
  { id: 'movement-map', hash: '#movement', open: movementDrawn }, // SV2-17: every group, the legend, the summary
  { id: 'movement-phone-sideways', hash: '#movement', viewport: { width: 844, height: 390, mobile: true }, open: movementDrawn }, // SV2-57: a phone on its side, with touch
  { // SV2-17: four chosen groups, with the reason there can be no fifth
    id: 'movement-four-groups',
    hash: '#movement',
    open: movementShowing({ who: 'groups', groupIds: ['gsample06a', 'gsample06b', 'gsample07a', 'gsample08a'], transition: 3 }),
  },
  { id: 'movement-one-group', hash: '#movement', open: movementShowing({ who: 'groups', groupIds: ['gsample08a'], floors: 'fsample001' }) }, // SV2-17
  { id: 'movement-cleared', hash: '#movement', open: movementShowing({ who: 'groups', groupIds: [] }) }, // SV2-17
  { id: 'movement-early-release', hash: '#movement', open: movementEarlyRelease }, // SV2-80b: the Bells control with Early Release chosen, periods 5 to 8 off
  { id: 'movement-playback', hash: '#movement', open: playbackAt(120, false) }, // SV2-19: half way through a transition, every group a marker
  { id: 'movement-playback-late', hash: '#movement', open: playbackAt(250, true) }, // SV2-19: after the bell, one group late, the settings behind More
  { // SV2-17: the card of the corridor cell the keyboard cursor rests on
    id: 'movement-cell-card',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      const steps = await page.evaluate(() => {
        const movement = document.querySelector('.mov').movement;
        const busiest = movement.picture.busiest;
        const slot = movement.world.slots.find((each) => each.floor.id === busiest.floorId);
        return { right: slot.x + (busiest.cell % slot.floor.width) - slot.box.x, down: slot.y + Math.floor(busiest.cell / slot.floor.width) - slot.box.y };
      });
      await page.focus('#movement-plan');
      for (let i = 0; i < steps.down; i += 1) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < steps.right; i += 1) await page.keyboard.press('ArrowRight');
      await page.waitForSelector('.mov-card:not([hidden])');
    },
  },
  { // SV2-17: route health with routes that failed, and "Show me" on the first line
    id: 'movement-route-failed',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      // the import in one turn and the change in the next: one evaluate that
      // awaited the import and then changed the store had its promise
      // collected under it now and then ("Promise was collected")
      await page.evaluate(async () => {
        globalThis.sv2actions = await import(new URL('engine/actions.js', location.href).href);
      });
      await page.evaluate(() => {
        globalThis.sv2.store.apply(globalThis.sv2actions.setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 2, slot: { room: null } });
      });
      await page.click('#inspector [role="tab"][data-tab="summary"]');
      await page.waitForSelector('#inspector [data-summary="health"] li');
      await movementDrawn(page);
    },
  },
  { // SV2-43: the controls folded away behind Change, and the playback bar's More open
    id: 'movement-controls-folded',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.evaluate(() => {
        if (document.querySelector('.mov-top').dataset.folded !== 'true') document.querySelector('[data-action="change"]').click();
        document.querySelector('[data-action="more"]').click();
        // the choice is this screen's alone: the screens after it open as a new device does
        const device = JSON.parse(localStorage.getItem('sv2:device') || '{}');
        delete device.movement;
        localStorage.setItem('sv2:device', JSON.stringify(device));
      });
      await page.waitForFunction(() => document.querySelector('.mov-top').dataset.folded === 'true' && !document.querySelector('[data-part="more"]').hidden);
      await movementDrawn(page);
    },
  },
  { // SV2-43: the floors stacked; where the legend's card would cover a floor it is one line, and Scale brings the card out
    id: 'movement-legend-docked',
    hash: '#movement',
    open: async (page) => {
      await movementShowing({ floors: 'stacked' })(page);
      await page.evaluate(() => {
        if (document.querySelector('.mov-legend').dataset.docked === 'true') document.querySelector('[data-action="scale"]').click();
      });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.mov-legend')).visibility === 'visible');
    },
  },
  { // SV2-43: the last answer after a derive that failed: the muted map, its band, and the Summary's line
    id: 'movement-stale',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.evaluate(async () => {
        globalThis.sv2actions = await import(new URL('engine/actions.js', location.href).href);
        globalThis.sv2.store.derived.use({ results: () => new Promise((resolve, reject) => { setTimeout(() => reject(new Error('The engine stopped')), 0); }) });
      });
      await page.evaluate(() => {
        globalThis.sv2.store.apply(globalThis.sv2actions.editGroup, { id: 'gsample07a', name: '7A West' });
      });
      await page.waitForFunction(() => document.querySelector('.mov').dataset.stale === 'true');
      await page.click('#inspector [role="tab"][data-tab="summary"]');
      await page.waitForFunction(() => {
        const note = document.querySelector('#inspector [data-summary="stale"]');
        return note !== null && !note.hidden;
      });
    },
  },
  { // SV2-17: a tab of the inspector that another unit fills
    id: 'movement-inspector-hotspots',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="hotspots"]');
      await page.waitForSelector('#inspector [data-panel="hotspots"]');
    },
  },
  { // SV2-18: the hotspot table with a row opened to its cells and a place chosen on the map
    id: 'movement-hotspots-open',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="hotspots"]');
      await page.click('#inspector .mov-hot__row[data-rank="2"] [data-action="cells"]');
      await page.click('#inspector .mov-hot__row[data-rank="1"] [data-action="show"]');
      await page.waitForSelector('#inspector .mov-hot__row[data-rank="1"][aria-current="true"]');
    },
  },
  { // SV2-18: the travel-time tables
    id: 'movement-travel-time',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="tables"]');
      await page.waitForSelector('#inspector [data-travel="day"] tbody');
    },
  },
  { // SV2-18: the Export tab
    id: 'movement-export',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="export"]');
      await page.waitForSelector('#inspector [data-panel="export"] [data-action="png"]:not([aria-disabled])');
    },
  },
  { // SV2-18: the movement picture in the preview sheet
    id: 'movement-print-picture',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="export"]');
      await page.click('#inspector [data-action="print-picture"]');
      await page.waitForSelector('#print-preview[open][data-ready="true"]');
    },
  },
  { // SV2-18: the congestion report in the preview sheet
    id: 'movement-congestion-report',
    hash: '#movement',
    open: async (page) => {
      await movementDrawn(page);
      await page.click('#inspector [role="tab"][data-tab="export"]');
      await page.click('#inspector [data-action="print-congestion"]');
      await page.waitForSelector('#print-preview[open][data-ready="true"]');
    },
  },
  { id: 'movement-empty', hash: '#project', open: async (page) => { // SV2-17: no groups, so no map
    await removeSample(page);
    await page.evaluate(() => {
      location.hash = '#movement';
    });
    await page.waitForFunction(() => document.querySelector('.mov-empty') && !document.querySelector('.mov-empty').hidden);
  } },
  { id: 'building-inspector-rooms', hash: '#building', open: inspectorTab('rooms') }, // SV2-07
  { id: 'building-inspector-floor', hash: '#building', open: inspectorTab('floor') }, // SV2-07
  { id: 'building-inspector-checks', hash: '#building', open: inspectorTab('checks') }, // SV2-07
  { id: 'building-inspector-exits', hash: '#building', open: inspectorTab('exits') }, // SV2-07
  { // SV2-07: an image traced over that this device does not hold
    id: 'building-trace-image-missing',
    hash: '#building',
    open: async (page) => {
      await inspectorTab('floor')(page);
      await page.evaluate(async () => {
        const { setTraceImage } = await import(new URL('ui/building/trace.js', location.href).href);
        const { store } = globalThis.sv2;
        store.apply(setTraceImage, { floorId: store.project.building.floors[0].id, image: { imageId: 'iscreen0001', width: 800, height: 600, scale: 0.02, missing: true } });
      });
      await page.waitForSelector('#trace-missing:not([hidden])');
    },
  },
  { // SV2-07: the menu of a room cell
    id: 'building-cell-menu',
    hash: '#building',
    open: async (page) => {
      await clickRoom(page, 'v');
      await page.focus('#plan');
      await page.keyboard.down('Shift');
      await page.keyboard.press('F10');
      await page.keyboard.up('Shift');
      await page.waitForSelector('.menu[role="menu"]');
    },
  },
  { // SV2-07: connect mode's banner
    id: 'building-connect-mode',
    hash: '#building',
    open: async (page) => {
      await planReady(page);
      await page.evaluate(() => {
        const editor = document.querySelector('.bld').editor;
        editor.connect.start({ floorId: editor.floor.id, cell: editor.floor.cells.indexOf('S') });
      });
      await page.waitForSelector('#connect-banner:not([hidden])');
    },
  },
  { // SV2-07: what the search box found
    id: 'search-results',
    hash: '#building',
    open: async (page) => {
      await page.waitForSelector('#search[data-search="ready"]');
      await page.click('#search');
      await page.keyboard.type('10');
      await page.waitForSelector('#search-results [role="option"]');
    },
  },
  { id: 'staff-preview', hash: '#staff', open: staffLive }, // SV2-24: the preview frame fed, the publish form beside it
  { // SV2-24: batch printing, in the preview sheet (SV2-45: with the sentence where a door sign's orientation would be)
    id: 'staff-batch-print',
    hash: '#staff',
    open: async (page) => {
      await staffLive(page);
      await page.click('.pub [data-print="door-signs-day"]');
      await page.waitForSelector('#print-preview[open][data-ready="true"]');
    },
  },
  {
    // SV2-45: the publish form with "What is in it" open, its mark turned
    id: 'staff-contents-open',
    hash: '#staff',
    open: async (page) => {
      await staffLive(page);
      await page.click('#publish-contents > summary');
      await page.waitForFunction(() => document.querySelector('.pub input[data-view="teacher"]').getClientRects().length > 0);
    },
  },
  { id: 'scenarios-open', hash: '#scenarios', open: scenarioOpen() }, // SV2-68: a scenario's chips, the forms, the comparison, the bar
  { id: 'scenarios-phone', hash: '#scenarios', viewport: { width: 390, height: 844, mobile: true }, open: scenarioOpen() }, // SV2-68: a phone, with touch
  { id: 'scenarios-phone-sideways', hash: '#scenarios', viewport: { width: 844, height: 390, mobile: true }, open: scenarioOpen() }, // SV2-68: a phone on its side, with touch
  { id: 'scenarios-dropped', hash: '#scenarios', open: scenarioOpen({ dropped: true }) }, // SV2-68: a change that no longer applies, with Remove them
  { id: 'scenarios-apply', hash: '#scenarios', open: scenarioOpen({ apply: true }) }, // SV2-68: Apply's summary
  { id: 'scenarios-difference', hash: '#scenarios', open: differenceShown }, // SV2-69: the difference map painted, its card up, the table of the ten largest changes
  { id: 'safety-map', hash: '#safety', open: safetyDrawn }, // SV2-67: every room's way out by exit, the key, the Exits tab
  { id: 'safety-phone', hash: '#safety', viewport: { width: 390, height: 844, mobile: true }, open: safetyDrawn }, // SV2-67: a phone, with touch
  { id: 'safety-phone-sideways', hash: '#safety', viewport: { width: 844, height: 390, mobile: true }, open: safetyDrawn }, // SV2-67: a phone on its side, with touch
  { // SV2-67: one room's way out across two floors, with the marks' line, on the Door cards tab with rooms ticked
    id: 'safety-one-room',
    hash: '#safety',
    open: async (page) => {
      await safetyDrawn(page);
      await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample303'));
      await safetyTab('cards')(page);
      for (const id of ['rsample101', 'rsample204']) await page.click('.sfy-row[data-room="' + id + '"] .sfy-row__box');
      await page.waitForFunction(() => document.querySelector('.sfy-panel [data-print="chosen"]').dataset.count === '2');
    },
  },
  { id: 'safety-no-route', hash: '#safety', open: safetyCutOff }, // SV2-67: a room with no way out, listed with its sentence
  { // SV2-67: door cards for every room in the preview sheet
    id: 'safety-print',
    hash: '#safety',
    open: async (page) => {
      await safetyDrawn(page);
      await safetyTab('cards')(page);
      await page.click('.sfy-panel [data-print="all"]');
      await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 30000 });
    },
  },
  { // SV2-67: no exits marked: the sentence and the way to the building
    id: 'safety-no-exits',
    hash: '#safety',
    open: async (page) => {
      await safetyDrawn(page);
      await page.evaluate(async () => {
        const { sampleSchool } = await import(new URL('data/sample-school.js', location.href).href);
        const project = sampleSchool();
        for (const floor of project.building.floors) floor.exits = [];
        // the theme stays the one the project has (a sweep may have chosen it)
        project.settings.theme = globalThis.sv2.store.project.settings.theme;
        globalThis.sv2.store.replace(project);
      });
      await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'empty');
    },
  },
  ...SV2_78,
  ...SV2_80,
  ...SV2_32G1,
];
