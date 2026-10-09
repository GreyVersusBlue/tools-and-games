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
  { // SV2-17: four chosen groups, with the reason there can be no fifth
    id: 'movement-four-groups',
    hash: '#movement',
    open: movementShowing({ who: 'groups', groupIds: ['gsample06a', 'gsample06b', 'gsample07a', 'gsample08a'], transition: 3 }),
  },
  { id: 'movement-one-group', hash: '#movement', open: movementShowing({ who: 'groups', groupIds: ['gsample08a'], floors: 'fsample001' }) }, // SV2-17
  { id: 'movement-cleared', hash: '#movement', open: movementShowing({ who: 'groups', groupIds: [] }) }, // SV2-17
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
      await page.evaluate(async () => {
        const { setSlot } = await import(new URL('engine/actions.js', location.href).href);
        globalThis.sv2.store.apply(setSlot, { groupId: 'gsample07a', dayTypeId: 'dsample00a', period: 2, slot: { room: null } });
      });
      await page.waitForSelector('#inspector [data-summary="health"] li');
      await movementDrawn(page);
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
    // on Building: the last screen of the list decides where the next session opens
    hash: '#building',
    open: async (page) => {
      await page.waitForSelector('#search[data-search="ready"]');
      await page.click('#search');
      await page.keyboard.type('10');
      await page.waitForSelector('#search-results [role="option"]');
    },
  },
];
