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
];
