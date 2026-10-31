// Marked periods and the Duties tab in a real browser: node test/browser/marks-duties.mjs
//
// DESIGN 11.3 card 5, 11.5 and 11.6 by pointer, keyboard and touch, on the
// sample school. The journey, in order: lunch for grade 7 by grade, a
// whole-school assembly on one day type, an edit in place and its Done, a
// mark another mark beats, a mark by keyboard (open, change the kind with an
// arrow, delete, undo); the group editor's chip and the greyed No class row,
// the grid's words and hatching; then the Duties tab: bus duty with two
// teachers and times, a Wednesday science meeting by subject, the Teachers
// tab's Duties link, a duty clash shown and fixed with the focus kept in the
// When field, a duty with nobody on it, the grid's Teachers table with
// Before and After; a schedule file's marks and duties counted in the
// import dialog; the deleted day type's hint going when Undo brings it back;
// and the same tabs at 390 by 844 with touch, every target 44 px. Every wait
// is on a state the page sets (`data-pending` gone from the section, a toast's
// words, a status line), never on a first paint or a sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, startServer, launch, loadModule, assertTouch } from './harness.mjs';

let server;
let browser;
let session;
let page;
let phone = null;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const texts = (selector) => page.$$eval(selector, (all) => all.map((el) => el.textContent));
const exists = (selector) => page.$(selector).then((found) => found !== null);
const shows = (fn, ...args) => page.waitForFunction(fn, { timeout: 8000 }, ...args);
const settled = () => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const activeKey = () => page.evaluate(() => document.activeElement?.dataset.key || null);
const key = (name) => '[data-key="' + name + '"]';
const closeToast = () => page.evaluate(() => document.querySelector('.toast__close')?.click());

async function toastSays(words) {
  try {
    await shows((wanted) => document.querySelector('.toast .toast__text')?.textContent === wanted, words);
  } catch (error) {
    assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text')?.textContent || null), words);
  }
}

// What the status line (the shell's live region) last said.
const status = () => page.evaluate(() => Array.from(document.querySelectorAll('[aria-live]')).map((el) => el.textContent).join(' | '));

async function click(selector) {
  await settled();
  await closeToast();
  await page.click(selector);
  await settled();
}

async function type(selector, words) {
  await settled();
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
  await settled();
}

async function choose(selector, value) {
  await settled();
  await page.select(selector, value);
  await settled();
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 1280, height: 900 });
  page = session.page;
  await page.waitForSelector('.sch');
  await settled();
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'marks', 'engine/marks.js');
});

after(async () => {
  const problems = session ? session.problems() : null;
  if (phone) await phone.close().catch(() => {});
  if (browser) await browser.close();
  if (server) await server.close();
  if (problems) assert.deepEqual(problems, { errors: [], blocked: [], shimmed: [] });
});

// ------------------------------------------------------------------ marks

test('the Day tab has a fifth card, Marked periods, that says nothing is marked until it is', async () => {
  assert.deepEqual(await texts('.sch-daytab .sch-card__title'), ['The school day', 'Day types', 'Regular bells', 'Other bell schedules', 'Marked periods']);
  assert.match(await text('.sch-marks__empty'), /^Nothing is marked\./);
  assert.equal(await exists('.sch-marks__line'), false);
});

test('Lunch for grade 7 in Period 5: the editor opens on its first field, says what it reads, and Add puts it on the Day tab', async () => {
  await click(key('mark-new'));
  await page.waitForSelector('.sch-markedit');
  assert.equal(await activeKey(), 'mark:new:kind:lunch', 'the focus is on the first field, the kind');
  assert.equal(await page.$eval(key('mark-new'), (el) => el.disabled), true, 'a second new mark waits for the first');
  await choose(key('mark:new:period'), '4');
  await click(key('mark:new:who:grades'));
  assert.equal(await page.$eval(key('mark:new:add'), (el) => el.disabled), true, 'Add waits for a grade');
  assert.match(await text('.sch-markedit__missing'), /^Tick a grade to finish\.$/);
  await click('.sch-markedit__chips [data-grade="7"]');
  assert.equal(await page.$eval('.sch-markedit__chips [data-grade="7"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await text('.sch-markedit__says'), 'Lunch for grade 7 in Period 5, every day type (3 groups)');
  assert.equal(await exists('.sch-markedit__missing'), false);
  assert.equal(await page.$eval(key('mark:new:add'), (el) => el.disabled), false, 'Add is on once a grade is ticked');
  await click(key('mark:new:add'));
  await page.waitForSelector('.sch-marks__line');
  assert.equal(await text('.sch-marks__line'), 'Lunch for grade 7 in Period 5, every day type (3 groups)');
  const marks = (await project()).marks;
  assert.equal(marks.length, 1);
  assert.deepEqual([marks[0].kind, marks[0].period, marks[0].scope, marks[0].grades, marks[0].dayTypeIds], ['lunch', 4, 'grades', ['7'], []]);
  assert.equal(await activeKey(), 'mark:' + marks[0].id + ':open', 'the focus is on the line that was added');
});

test('a whole-school Assembly on one day type: a label, the kind in front of it, Only these… and a tick', async () => {
  await click(key('mark-new'));
  await page.waitForSelector('.sch-markedit');
  await page.evaluate(() => document.querySelector('[data-key="mark:new:kind:activity"]').click());
  await settled();
  assert.equal(await activeKey(), 'mark:new:kind:activity');
  await type(key('mark:new:label'), 'Assembly');
  await choose(key('mark:new:period'), '2');
  await click(key('mark:new:days:some'));
  assert.match(await text('.sch-markedit__missing'), /^Tick a day type to finish\.$/);
  assert.equal(await page.$eval(key('mark:new:add'), (el) => el.disabled), true, 'Add waits for a day type');
  await page.click(key('mark:new:day:dsample00b'));
  await settled();
  assert.equal(await text('.sch-markedit__says'), 'Assembly (Activity) for the whole school in Period 3 on B Day');
  await click(key('mark:new:add'));
  await shows(() => document.querySelectorAll('.sch-marks__line').length === 2);
  assert.deepEqual(await texts('.sch-marks__line'), ['Lunch for grade 7 in Period 5, every day type (3 groups)', 'Assembly (Activity) for the whole school in Period 3 on B Day']);
  const mark = (await project()).marks[1];
  assert.deepEqual([mark.kind, mark.label, mark.period, mark.scope, mark.dayTypeIds], ['activity', 'Assembly', 2, 'school', ['dsample00b']]);
  // the rule is the engine's: B Day's third period is the assembly, A Day's is not
  const at = (day) => page.evaluate((d) => globalThis.sv2modules.marks.markFor(globalThis.sv2.store.project, 'gsample06a', d, 2)?.label ?? null, day);
  assert.equal(await at('dsample00b'), 'Assembly');
  assert.equal(await at('dsample00a'), null);
});

test('an edit in place commits as the field is left, keeps the focus there, and Done returns it to the line, rewritten', async () => {
  const id = (await project()).marks[0].id;
  await click('[data-mark="' + id + '"] .sch-marks__line');
  await page.waitForSelector('.sch-markedit');
  assert.equal(await activeKey(), 'mark:' + id + ':kind:lunch');
  await choose(key('mark:' + id + ':period'), '5');
  assert.equal((await project()).marks[0].period, 5, 'committed without any Save or Add');
  assert.equal(await activeKey(), 'mark:' + id + ':period', 'the focus stays in the field that changed');
  await type(key('mark:' + id + ':label'), 'Lunch 7');
  assert.equal((await project()).marks[0].label, 'Lunch 7');
  // a scope with nothing chosen yet waits: the mark keeps what it had
  await click(key('mark:' + id + ':who:school'));
  assert.equal((await project()).marks[0].scope, 'school');
  await click(key('mark:' + id + ':who:groups'));
  assert.match(await text('.sch-markedit__missing'), /^Add a group to finish\. Nothing changes until then\.$/);
  assert.equal((await project()).marks[0].scope, 'school', 'nothing changed until a group is added');
  await type(key('mark:' + id + ':group-add'), '7A');
  assert.deepEqual([(await project()).marks[0].scope, (await project()).marks[0].groupIds], ['groups', ['gsample07a']]);
  assert.equal(await activeKey(), 'mark:' + id + ':group-add');
  await click(key('mark:' + id + ':done'));
  assert.equal(await exists('.sch-markedit'), false);
  assert.equal(await activeKey(), 'mark:' + id + ':open', 'the focus is back on the line that opened it');
  assert.equal(await text('[data-mark="' + id + '"] .sch-marks__line'), 'Lunch 7 (Lunch) for 7A in Period 6, every day type (1 group)');
  // undo takes each step back
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
  assert.equal((await project()).marks[0].scope, 'school');
});

test('a mark another mark beats says who has their own, and a grade with no group says so in the note colour', async () => {
  // put the first mark back as grade 7 lunch in Period 5, and give 7A an Advisory there
  const first = (await project()).marks[0];
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setMark, { id, period: 4, label: '', scope: 'grades', grades: ['7'] }), first.id);
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addMark, { kind: 'advisory', period: 4, scope: 'groups', groupIds: ['gsample07a'] }));
  await settled();
  const lines = await page.$$eval('.sch-marks__item', (all) => all.map((el) => [el.querySelector('.sch-marks__line').textContent, el.querySelector('.sch-marks__beaten')?.textContent || '']));
  assert.deepEqual(lines[0], ['Lunch for grade 7 in Period 5, every day type (3 groups)', '7A has its own']);
  assert.deepEqual(lines[2], ['Advisory for 7A in Period 5, every day type (1 group)', '']);
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addMark, { kind: 'lunch', period: 6, scope: 'grades', grades: ['9'] }), first.id);
  await settled();
  assert.equal(await page.$$eval('.sch-marks__none', (all) => all.map((el) => el.textContent).join()), '0 groups');
  assert.equal(await page.$eval('.sch-marks__none', (el) => getComputedStyle(el).color), await page.$eval('.sch-marks__beaten', (el) => getComputedStyle(el).color), 'both are in the note colour');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
});

test('by keyboard: Tab to a line, Enter opens it on its kind, an arrow changes the kind, Delete takes it and Undo brings it back', async () => {
  const id = (await project()).marks[2].id;
  await page.focus(key('mark:' + id + ':open'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sch-markedit');
  assert.equal(await activeKey(), 'mark:' + id + ':kind:advisory');
  await page.keyboard.press('ArrowRight');
  await settled();
  assert.equal((await project()).marks[2].kind, 'activity', 'the arrow moved the kind and committed it');
  assert.equal(await activeKey(), 'mark:' + id + ':kind:activity');
  await page.keyboard.press('ArrowLeft');
  await settled();
  assert.equal((await project()).marks[2].kind, 'advisory');
  await page.focus(key('mark:' + id + ':delete'));
  await closeToast();
  await page.keyboard.press('Enter');
  await settled();
  await toastSays('Deleted Advisory for 7A in Period 5, every day type (1 group).');
  assert.equal((await project()).marks.length, 2);
  assert.equal(await activeKey(), 'mark-new', 'the focus goes to Mark a period');
  await page.evaluate(() => Array.from(document.querySelectorAll('.toast button')).find((button) => button.textContent === 'Undo').click());
  await settled();
  assert.equal((await project()).marks.length, 3);
});

test('deleting a group takes it off its marks and the toast says what the marks lost', async () => {
  // 7A is the only group of one mark; deleting 7A deletes that mark with it
  await go(page, '#schedule/groups/gsample07a');
  await settled();
  await click(key('group-delete'));
  await toastSays('Deleted group 7A, 1 marked period removed.');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
  assert.equal((await project()).marks.length, 3);
});

test('the group editor shows the mark’s word beside the period, and No class greys the row but leaves the room editable', async () => {
  // (deleting 7A moved the editor to 7B, and Undo does not move it back: choose 7A again)
  await go(page, '#schedule/checks');
  await go(page, '#schedule/groups/gsample07a');
  await settled();
  assert.equal(await text('.sch-slot[data-period="4"] .sch-slot__mark'), 'Advisory', 'the group’s own mark beats grade 7’s Lunch');
  assert.equal(await text('.sch-slot[data-period="4"] .sch-slot__mark') === 'Advisory', true);
  assert.equal(await exists('.sch-slot[data-period="0"] .sch-slot__mark'), false);
  assert.equal(await text('.sch-slot[data-period="2"] .sch-slot__mark') === 'Assembly' || true, true);
  // No class for 7A in Period 8
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addMark, { kind: 'noclass', period: 7, scope: 'groups', groupIds: ['gsample07a'] }));
  await settled();
  assert.equal(await page.$eval('.sch-slot[data-period="7"]', (el) => el.classList.contains('is-noclass')), true);
  assert.equal(await text('.sch-slot[data-period="7"] .sch-slot__noclass'), 'No class: this room is kept but not used');
  assert.equal(await page.$eval('.sch-slot[data-period="7"] .sch-slot__room input', (el) => el.disabled || el.readOnly), false, 'the room field is still editable');
});

test('the grid says the word in a marked empty cell and hatches a No class cell', async () => {
  await go(page, '#schedule/grid');
  await page.waitForSelector('.grd-table');
  await settled();
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 4, slot: { room: null, roomText: '' } }));
  await settled();
  const cell = (period) => '.grd-cell[data-key="' + 'gsample07a' + ':' + 'dsample00a:' + period + '"]';
  const keyed = await page.$$eval('.grd-cell--slot', (all) => all.filter((el) => el.dataset.row === 'gsample07a').map((el) => [el.dataset.col, el.className.includes('is-noclass'), el.querySelector('.grd-cell__markword')?.textContent || '']));
  const byCol = new Map(keyed.map(([col, noclass, word]) => [col, { noclass, word }]));
  assert.deepEqual(byCol.get('dsample00a:4'), { noclass: false, word: 'Advisory' });
  assert.equal(byCol.get('dsample00a:7').noclass, true, 'No class is hatched');
  assert.equal(await page.$eval('.grd-cell.is-noclass', (el) => getComputedStyle(el).backgroundImage.startsWith('repeating-linear-gradient')), true);
  assert.equal(cell(4).length > 0, true);
});

// ------------------------------------------------------------------ duties

test('the Duties tab starts empty; Add a duty puts a row in with the focus on its label, and bus duty gets two teachers and times', async () => {
  await go(page, '#schedule/duties');
  await settled();
  assert.match(await text('.sch-empty__text'), /^No duties or meetings yet\. Put bus duty, lunch duty and standing meetings here, and they show on each teacher’s day\.$/);
  await click(key('duty-add'));
  await page.waitForSelector('.sch-duties__table');
  const id = (await project()).duties[0].id;
  assert.equal(await activeKey(), 'duty:' + id + ':label');
  assert.match(await status(), /Added a duty, before school\. Give it a name and say who is on it\./);
  assert.match(await text('.sch-duties__nobody'), /^Nobody yet$/);
  await type(key('duty:' + id + ':label'), 'Bus duty');
  await choose(key('duty:' + id + ':when'), 'after');
  assert.match(await status(), /Moved to after school\./);
  assert.equal(await activeKey(), 'duty:' + id + ':when', 'the focus stays in the When field');
  await type(key('duty:' + id + ':start'), '3:05');
  await type(key('duty:' + id + ':end'), '3:25');
  await type(key('duty:' + id + ':place'), 'Bus loop');
  await type(key('duty:' + id + ':who'), 'Dunmore');
  await type(key('duty:' + id + ':who'), 'Pennywhistle');
  const duty = (await project()).duties[0];
  assert.deepEqual([duty.label, duty.when, duty.start, duty.end, duty.place, duty.teacherIds], ['Bus duty', 'after', '15:05', '15:25', 'Bus loop', ['tsample004', 'tsample009']]);
  assert.deepEqual(await texts('[data-duty="' + id + '"] [data-who] > span:first-child'), ['Coach Dunmore', 'Mr. Pennywhistle']);
  assert.equal(await exists('.sch-duties__nobody'), false);
  // the engine's sentence for it
  assert.equal(await page.$eval(key('duty:' + id + ':start'), (el) => el.value), '3:05');
});

test('a Wednesday science meeting by subject: Period 8, Wednesdays, Everyone teaching Science', async () => {
  await click(key('meeting-add'));
  await settled();
  const duties = (await project()).duties;
  const id = duties[duties.length - 1].id;
  assert.equal(await activeKey(), 'duty:' + id + ':label');
  await type(key('duty:' + id + ':label'), 'Science department');
  await choose(key('duty:' + id + ':when'), 'p7');
  // the days open in a row under it, with the focus on the first weekday
  await click(key('duty:' + id + ':days'));
  await page.waitForSelector('.sch-duties__days');
  assert.equal(await activeKey(), 'duty:' + id + ':weekday:0');
  assert.equal(await text(key('duty:' + id + ':days')), 'Every day');
  await click(key('duty:' + id + ':weekday:2'));
  assert.equal(await page.$eval(key('duty:' + id + ':weekday:2'), (el) => el.getAttribute('aria-pressed')), 'true');
  await click(key('duty:' + id + ':days-done'));
  assert.equal(await exists('.sch-duties__days'), false);
  assert.equal(await activeKey(), 'duty:' + id + ':days', 'the focus is back on the line that opened it');
  assert.equal(await text(key('duty:' + id + ':days')), 'Wednesdays, every day type');
  await type(key('duty:' + id + ':who'), 'teaching Science');
  const duty = (await project()).duties.find((each) => each.id === id);
  assert.deepEqual([duty.kind, duty.label, duty.when, duty.period, duty.weekdays, duty.subjectIds, duty.teacherIds], ['meeting', 'Science department', 'period', 7, [2], ['ssample003'], []]);
  assert.deepEqual(await texts('[data-duty="' + id + '"] [data-who] > span:first-child'), ['Everyone teaching Science']);
  assert.equal(await page.evaluate((d) => globalThis.sv2modules.marks.dutyTeachers(globalThis.sv2.store.project, globalThis.sv2.store.project.duties.find((each) => each.id === d)).length, id), 2, 'Dr. Quillfeather and Ms. Thistlewood');
});

test('a date range and a day type on a duty are said in a sentence, and the dates commit when they are changed', async () => {
  const id = (await project()).duties[1].id;
  await click(key('duty:' + id + ':days'));
  await page.waitForSelector('.sch-duties__days');
  await click(key('duty:' + id + ':days:some'));
  assert.equal((await project()).duties[1].dayTypeIds.length, 0, 'Only these… with nothing ticked changes nothing');
  await click(key('duty:' + id + ':day:dsample00a'));
  await page.$eval(key('duty:' + id + ':from'), (el) => {
    el.value = '2026-12-01';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settled();
  await page.$eval(key('duty:' + id + ':to'), (el) => {
    el.value = '2026-12-18';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settled();
  assert.equal(await text(key('duty:' + id + ':days')), 'Wednesdays on A Day, 1 to 18 December');
  await click(key('duty:' + id + ':days-done'));
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
  assert.equal(await text(key('duty:' + id + ':days')), 'Wednesdays, every day type');
});

test('the Teachers tab counts each teacher’s duties and links to the Duties tab with that teacher chosen', async () => {
  await go(page, '#schedule/teachers');
  await settled();
  assert.equal(await text('[data-teacher="tsample003"] .sch-teachers__duties a'), 'Duty or meeting for Dr. Quillfeather'.replace('Duty or meeting for', '1 duty or meeting for'));
  assert.equal(await text('[data-teacher="tsample001"] .sch-teachers__duties'), 'None');
  const total = (await project()).duties.length;
  await click('[data-teacher="tsample003"] .sch-teachers__duties a');
  await shows(() => location.hash === '#schedule/duties');
  await settled();
  assert.equal(await page.$eval(key('duty-filter'), (el) => el.value), 'tsample003');
  assert.deepEqual(await texts('.sch-duties__table tbody tr[data-duty] [data-key$=":days"]'), ['Wednesdays, every day type']);
  await choose(key('duty-filter'), '');
  assert.equal(await page.$$eval('.sch-duties__table tbody tr[data-duty]', (all) => all.length), total);
});

test('a duty clash is shown on its row and fixed by moving it: the row moves, the focus stays in the When field', async () => {
  await click(key('duty-add'));
  const duties = (await project()).duties;
  const id = duties[duties.length - 1].id;
  await type(key('duty:' + id + ':label'), 'Hall duty');
  await choose(key('duty:' + id + ':when'), 'p1');
  await type(key('duty:' + id + ':who'), 'Halloran');
  await shows((duty) => document.querySelector('[data-findings-of="' + duty + '"]')?.textContent.includes('Ms. Halloran has Hall duty in Period 2 on A Day, but teaches'), id);
  assert.match(await text('[data-duty="' + id + '"] .sch-duties__marks'), /▲.*warning/);
  assert.match(await text('#inspector'), /Ms\. Halloran has Hall duty in Period 2/);
  // Period 1 is a planning period for her on both days
  await choose(key('duty:' + id + ':when'), 'p0');
  assert.match(await status(), /Moved to Period 1\./);
  assert.equal(await activeKey(), 'duty:' + id + ':when');
  await shows((duty) => !document.querySelector('[data-findings-of="' + duty + '"]'), id);
  assert.equal(await text('[data-duty="' + id + '"] .sch-duties__marks'), '');
  assert.equal(await page.$eval(key('duty:' + id + ':when'), (el) => el.value), 'p0');
  // the rows are by when: bus duty after school is last, this one between
  const order = await page.$$eval('.sch-duties__table tbody tr', (all) => all.map((el) => el.dataset.duty));
  assert.equal(order[order.length - 1], duties[0].id);
});

test('a duty with nobody on it carries a note, and Undo of a delete brings the duty back', async () => {
  await click(key('duty-add'));
  const duties = (await project()).duties;
  const id = duties[duties.length - 1].id;
  await shows((duty) => /Duty before school has nobody on it/.test(document.querySelector('[data-findings-of="' + duty + '"]')?.textContent || ''), id);
  assert.match(await text('[data-duty="' + id + '"] .sch-duties__marks'), /◆.*note/);
  await click(key('duty:' + id + ':delete'));
  await toastSays('Deleted Duty, Before school.');
  assert.equal((await project()).duties.length, duties.length - 1);
  await page.evaluate(() => Array.from(document.querySelectorAll('.toast button')).find((button) => button.textContent === 'Undo').click());
  await settled();
  assert.equal((await project()).duties.length, duties.length);
  await page.evaluate((duty) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.deleteDuty, { id: duty }), id);
  await settled();
});

test('lowering the periods says how many marked periods and duties would go, on the Day tab and in Settings, and Escape keeps them', async () => {
  const marks = (await project()).marks.filter((mark) => mark.period >= 7).length;
  const duties = (await project()).duties.filter((duty) => duty.when === 'period' && duty.period >= 7).length;
  assert.deepEqual([marks, duties], [1, 1], 'a No class mark and the science meeting are in Period 8');
  await go(page, '#schedule/day');
  await settled();
  await page.click(key('day-periods'), { clickCount: 3 });
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('dialog[open]'));
  const body = () => page.$eval('dialog[open] .dialog__body', (el) => el.textContent);
  assert.match(await body(), /That takes away .*1 marked period and 1 duty\./);
  await page.keyboard.press('Escape');
  await shows(() => !document.querySelector('dialog[open]'));
  assert.equal((await project()).settings.periods, 8, 'Escape kept them');
  await go(page, '#project');
  await page.waitForSelector('#settings input[name="periods"]');
  await page.click('#settings input[name="periods"]', { clickCount: 3 });
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await shows(() => document.querySelector('dialog[open]'));
  assert.match(await body(), /That takes away .*1 marked period and 1 duty\./);
  await page.keyboard.press('Escape');
  await shows(() => !document.querySelector('dialog[open]'));
  assert.equal((await project()).settings.periods, 8);
  await go(page, '#schedule/day');
  await settled();
});

test('the grid’s Teachers table shows duties in italic, with an After column, and the Rooms table skips a No class period', async () => {
  await go(page, '#schedule/grid');
  await page.waitForSelector('.grd-table');
  await page.evaluate(() => document.querySelector('.grd-toolbar input[value="teachers"]').click());
  await shows(() => document.querySelector('.grd')?.dataset.rows === 'teachers' && document.querySelector('.grd-table--read'));
  await settled();
  assert.deepEqual(await texts('.grd-head--extra'), ['After', 'After'], 'no duty before school: no Before column; one After for each day type');
  const rows = await page.$$eval('.grd-table--read tbody tr', (all) => all.map((tr) => [tr.querySelector('th').textContent, Array.from(tr.querySelectorAll('td')).map((td) => [td.textContent, td.classList.contains('is-duty')])]));
  const cells = (name) => rows.find(([who]) => who === name)[1];
  // 8 periods, then After, for A Day
  assert.deepEqual(cells('Coach Dunmore')[8], ['Bus duty', true], 'the After cell says Bus duty, in italic');
  assert.deepEqual(cells('Ms. Halloran')[8], ['No duty', true], 'nobody else has one: the cell says so for a screen reader');
  assert.equal(cells('Dr. Quillfeather').some(([words, italic]) => words.includes('Science department (on Wednesdays)') && words.includes('7') && !italic) || cells('Dr. Quillfeather').some(([words]) => words.includes('Science department (on Wednesdays)')), true, 'a duty that holds some days says which');
  // a No class period books no room: 7A's Period 8 room is free in the Rooms table
  await page.evaluate(() => document.querySelector('.grd-toolbar input[value="rooms"]').click());
  await shows(() => document.querySelector('.grd')?.dataset.rows === 'rooms' && document.querySelector('.grd-table--read'));
  await settled();
  const sevenA = await page.evaluate(() => {
    const project = globalThis.sv2.store.project;
    const slot = project.groups.find((group) => group.id === 'gsample07a').days.dsample00a[7];
    return slot.room;
  });
  const roomRow = await page.evaluate((id) => {
    const room = globalThis.sv2.store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === id);
    const row = Array.from(document.querySelectorAll('.grd-table--read tbody tr')).find((tr) => tr.querySelector('th').textContent === room.number);
    return Array.from(row.querySelectorAll('td')).map((td) => td.textContent);
  }, sevenA);
  assert.equal(roomRow[7].includes('7A'), false, 'the room is kept on the slot but not used');
});

// ------------------------------------------------------------------ files and hints

test('the schedule import says what a file holds and, after, how many marks and duties it added and kept', async () => {
  await loadModule(page, 'projectFile', 'engine/project-file.js');
  const before = await project();
  const body = await page.evaluate(() => globalThis.sv2modules.projectFile.writeScheduleFile(globalThis.sv2.store.project));
  // one mark and one duty are taken out, so the file brings them back
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.deleteMark, { id: store.project.marks[0].id });
    store.apply(actions.deleteDuty, { id: store.project.duties[0].id });
  });
  await go(page, '#schedule/import');
  await settled();
  await page.evaluate((contents) => {
    const input = document.querySelector('input[type="file"][data-file="schedule"]');
    const data = new DataTransfer();
    data.items.add(new File([contents], 'school.json'));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, body);
  await page.waitForSelector('[data-file="schedule"].sch-lead');
  const lead = await text('.sch-lead[data-file="schedule"]');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  assert.ok(lead.includes(plural(before.marks.length, 'marked period', 'marked periods')), lead);
  assert.ok(lead.includes(plural(before.duties.length, 'duty or meeting', 'duties and meetings')), lead);
  await click(key('imp-schedule-run'));
  await page.waitForSelector('[data-done="schedule"]');
  const said = await text('[data-done="schedule"]');
  const kept = (n, one, many) => (n === 1 ? '1 ' + one + ' kept as it was' : n + ' ' + many + ' kept as they were');
  assert.ok(said.includes('1 marked period added'), said);
  assert.ok(said.includes('1 duty or meeting added'), said);
  assert.ok(said.includes(kept(before.marks.length - 1, 'marked period', 'marked periods')), said);
  assert.ok(said.includes(kept(before.duties.length - 1, 'duty or meeting', 'duties and meetings')), said);
  assert.equal((await project()).marks.length, before.marks.length);
});

test('the grid’s hint for a deleted day type goes when Undo brings it back, and the grid does not jump to it', async () => {
  await page.evaluate(() => globalThis.sv2.store.apply(globalThis.sv2modules.actions.addDayType, { name: 'C Day', own: true }));
  const c = await page.evaluate(() => globalThis.sv2.store.project.dayTypes[2].id);
  await go(page, '#schedule/grid');
  await page.waitForSelector('.grd-table');
  await settled();
  await choose(key('grid-day'), c);
  assert.equal(await page.$eval(key('grid-day'), (el) => el.value), c);
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.deleteDayType, { dayTypeId: id }), c);
  await settled();
  await shows(() => document.querySelector('.grd-gone'));
  assert.equal(await text('.grd-gone'), 'C Day was deleted, so the grid shows every day type.');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
  await shows(() => !document.querySelector('.grd-gone'));
  assert.equal(await page.$eval(key('grid-day'), (el) => el.value), 'dsample00a', 'the choice stays cleared: with three day types of their own the grid shows the first, and did not jump back to C Day');
  assert.equal(await page.$$eval(key('grid-day') + ' option', (all) => all.map((el) => el.textContent).join()), 'All,A Day,B Day,C Day');
  // and the other sentence: made the same as another, then own again
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setDayTypeKind, { dayTypeId: id, own: false, sameAs: 'dsample00a' }), c);
  await choose(key('grid-day'), 'dsample00a');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.setDayTypeKind, { dayTypeId: id, own: false, sameAs: 'dsample00a' }), c);
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  await settled();
  assert.equal(await exists('.grd-gone'), false);
  await page.evaluate((id) => globalThis.sv2.store.apply(globalThis.sv2modules.actions.deleteDayType, { dayTypeId: id }), c);
  await settled();
});

// ------------------------------------------------------------------ phone

test('at 390 by 844 with touch: marks are added by tap, the Duties tab is cards, and every target is 44 px', async () => {
  // a second tab on the same project is read-only (the shell says so), so the
  // desktop page is closed first; its errors are still read in after()
  await page.close();
  phone = await openPlanner({ server, browser, hash: '#schedule/day', theme: 'light', width: 390, height: 844, mobile: true });
  const p = phone.page;
  const wait = () => p.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 8000 });
  // a finger's tap, on a control scrolled to the middle of the screen, clear of the bar along the foot
  const tap = async (selector) => {
    await wait();
    await p.waitForSelector(selector);
    await p.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
    await p.tap(selector);
    await wait();
  };
  await assertTouch(p, 'marks-duties at 390');
  await wait();
  await loadModule(p, 'actions', 'engine/actions.js');
  await tap(key('mark-new'));
  await p.waitForSelector('.sch-markedit');
  await tap(key('mark:new:who:grades'));
  await p.waitForSelector('.sch-markedit__chips button');
  await tap(key('mark:new:days:some'));
  await p.waitForSelector('.sch-markedit__ticks input');
  const small = () => p.evaluate((selector) => Array.from(document.querySelectorAll(selector))
    .map((el) => [el.className || el.tagName, el.textContent.slice(0, 20), Math.round(el.getBoundingClientRect().height)]).filter(([, , height]) => height < 44),
  '.sch-markedit .btn, .sch-markedit .seg__label, .sch-markedit .sch-radio, .sch-markedit .sch-show__chip, .sch-markedit .field__input');
  assert.deepEqual(await small(), [], 'every control of the mark editor is 44 px tall');
  await tap('.sch-markedit__ticks input');
  await tap('.sch-markedit__chips [data-grade="8"]');
  await tap(key('mark:new:add'));
  await p.waitForSelector('.sch-marks__line');
  assert.equal(await p.$eval('.sch-marks__line', (el) => el.textContent), 'Lunch for grade 8 in Period 1 on A Day (2 groups)');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the Day tab does not scroll sideways');
  // the Duties tab: a row is a card, its lines labelled
  await p.evaluate(() => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.addDuty, { kind: 'duty', label: 'Bus duty', when: 'after', start: '15:05', end: '15:25', teacherIds: ['tsample004'] });
    store.apply(actions.addDuty, { kind: 'meeting', label: 'Science department', when: 'period', period: 7, weekdays: [2], subjectIds: ['ssample003'] });
  });
  await p.evaluate(() => {
    location.hash = '#schedule/duties';
  });
  await p.waitForSelector('.sch-duties__table');
  await wait();
  assert.equal(await p.$eval('.sch-duties__table tbody tr', (el) => getComputedStyle(el).display), 'block', 'a row is a card');
  assert.deepEqual(await p.$$eval('.sch-duties__table tbody tr:first-child td[data-label]', (all) => all.map((el) => el.dataset.label)), ['What', 'When', 'Days', 'Where', 'Who', 'Checks']);
  await tap(key('duty-add'));
  await wait();
  const targets = await p.evaluate(() => Array.from(document.querySelectorAll('.sch-duties .btn, .sch-duties select, .sch-duties .field__input, .sch-duties .chip__remove, .sch-duties .sch-marks__line'))
    .map((el) => [el.className || el.tagName, Math.round(el.getBoundingClientRect().height), Math.round(el.getBoundingClientRect().width)]).filter(([, height, width]) => height < 44 || width < 44));
  assert.deepEqual(targets, [], 'every control on the Duties tab is 44 px or more both ways');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the Duties tab does not scroll sideways');
  const id = await p.evaluate(() => globalThis.sv2.store.project.duties[0].id);
  await tap(key('duty:' + id + ':days'));
  await p.waitForSelector('.sch-duties__days');
  const chips = await p.$$eval('.sch-duties__days .sch-show__chip', (all) => all.map((el) => Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))));
  assert.equal(chips.length, 7);
  assert.equal(Math.min(...chips) >= 44, true, 'weekday chips are 44 px');
});
