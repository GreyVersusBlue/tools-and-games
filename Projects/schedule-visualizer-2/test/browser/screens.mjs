// The screens the sweeps visit: no-offsite.mjs opens each and counts requests,
// a11y/axe.mjs runs axe-core on each in both themes. A unit that adds a screen
// (a section, a sub-tab, a dialog, a state worth checking) adds a line here
// and both sweeps cover it.
//
//   { id, hash, open }
//   hash   the address to load
//   open   optional: async (page) => {} to bring up what the address alone does
//          not show (a dialog, a menu, an emptied project)

const press = (key) => async (page) => {
  await page.keyboard.press(key);
};

async function removeSample(page) {
  await page.click('#sample-school [data-action="sample"]');
  await page.waitForFunction(() => document.getElementById('sample-chip').hidden);
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
  {
    id: 'schedule-room-refused-and-missing', // SV2-11
    hash: '#schedule/groups',
    open: async (page) => {
      await page.evaluate(() => import('./engine/actions.js').then((actions) => {
        const { store } = globalThis.sv2;
        store.apply(actions.setSlot, { groupId: store.project.groups[0].id, dayTypeId: store.project.dayTypes[0].id, period: 1, slot: { room: null, roomText: 'B12' } });
      }));
      await page.waitForSelector('.sch-room--missing');
      await scheduleDrawn(page);
      await page.click('.sch-slot .picker__input');
      await page.keyboard.type('zzz');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sch-room .field__refusal:not([hidden])');
    },
  },
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
      await page.click('.sch-daytype [data-action="revert"]');
      await page.waitForSelector('.sch-daytype--same');
      await scheduleDrawn(page);
    },
  },
  {
    id: 'schedule-groups-same-as-a-day', // SV2-11
    hash: '#schedule/day',
    open: async (page) => {
      await scheduleDrawn(page);
      await page.click('.sch-daytype [data-action="revert"]');
      await page.waitForSelector('.sch-daytype--same');
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
  // SV2-12: the grid's screens sit before the last one on purpose. The sweep's next
  // session opens with no address and waits for Building, and the page goes back to
  // the section it was last on, so the last screen here has to be a Building one.
  { id: 'schedule-grid-staged', hash: '#schedule/grid', open: gridStaged }, // SV2-12
  { id: 'schedule-grid-empty', hash: '#project', open: scheduleEmpty('grid') }, // SV2-12
  { id: 'schedule-grid-teachers', hash: '#schedule/grid', open: gridRows('teachers') }, // SV2-12
  { id: 'schedule-grid-rooms', hash: '#schedule/grid', open: gridRows('rooms') }, // SV2-12
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
];
