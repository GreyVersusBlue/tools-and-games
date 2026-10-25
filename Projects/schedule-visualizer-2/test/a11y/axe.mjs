// The accessibility sweep: node test/a11y/axe.mjs
//
// Opens every screen in test/browser/screens.mjs four times: with the device
// asking for light, with it asking for dark, with the device asking for
// light and dark chosen from the planner's theme menu (SV2-32g1), and with the
// device asking for dark and light chosen from the menu (SV2-32g1b). It runs
// axe-core (vendored, test/vendor/axe-core) on each and fails on any
// violation of WCAG 2.0 and 2.1 at A and AA and of axe's best practices.
// Where the screen has the print preview open, axe also runs inside the
// preview's frame, on the document that goes to paper (SV2-32g1). A rule that is knowingly not met goes in ALLOW with
// its reason; the list is meant to stay short, and an entry that no longer
// matches anything fails the run so it cannot outlive its reason.
//
// axe also returns "incomplete" results: things it could not decide (text
// over a gradient, for one). They are printed, not failed.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { openPlanner, visit, go, launch, startServer, TOOL_DIR, sameOrigin } from '../browser/harness.mjs';
import { SCREENS } from '../browser/screens.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// The four passes: what the device asks for, what the theme menu chooses
// (none: the project follows the device), and the theme the page must end up
// in. Each chosen pass is the mirror of the other: the device asks for one
// theme and the person chooses the other.
const PASSES = [
  { name: 'light theme', device: 'light', expect: 'light' },
  { name: 'dark theme', device: 'dark', expect: 'dark' },
  { name: 'dark theme chosen from the theme menu', device: 'light', choose: 'Dark', expect: 'dark' },
  { name: 'light theme chosen from the theme menu', device: 'dark', choose: 'Light', expect: 'light' },
];

// The light paper of the print preview's frame: tokens.css's light --paper,
// the desk the sheets lie on (print.css, @media screen).
const LIGHT_PAPER = 'rgb(246, 243, 236)';
const DEVICE_KEY = 'sv2:device';

// { rule, screen (optional, an id from screens.mjs), where (optional:
// 'print' for the document inside the print preview; the page otherwise), reason }
const ALLOW = [];

const used = new Set();
let browser;
let server;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// A screen's opening motion (a dialog rises over 200 ms with its opacity going
// from 0 to 1) is not the page a reader uses. CI's runner once caught a danger
// button at 80% opacity and read its red as 4.31 to 1 against the card; the
// page at rest is 4.5 or better. So axe runs after every animation on the
// page has finished.
async function atRest(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

function describe(violation) {
  const where = violation.nodes.map((node) => '      ' + node.target.join(' ') + '\n        ' + String(node.failureSummary || '').replace(/\n\s*/g, ' ')).join('\n');
  return '  ' + violation.id + ' (' + violation.impact + '): ' + violation.help + '\n' + where;
}

// Dark chosen by pointer, as a person would: from the theme menu that the top
// bar's theme switch opens, or, on a phone, where the top bar has no theme
// switch (DESIGN 4), from Theme in Project › Settings, and then back to the
// screen's own address. The project keeps the choice, so it is made on each
// screen's fresh project before the screen opens. The theme the device
// remembers (sv2:device's `theme`, which the planner writes whenever the
// theme changes and reads before the project on load, ui/app.js) is cleared
// before each screen loads (forget), so each screen starts following the
// device and the menu's choice is really made, not found made already.
async function forget(session) {
  const { page } = session;
  if (!sameOrigin(page.url(), session.base) || page.url().startsWith('about:')) await page.goto(session.url('#project'), { waitUntil: 'load' });
  await page.evaluate((key) => {
    const held = JSON.parse(localStorage.getItem(key) || '{}');
    if (held && typeof held === 'object' && 'theme' in held) {
      delete held.theme;
      localStorage.setItem(key, JSON.stringify(held));
    }
  }, DEVICE_KEY);
}

async function choose(page, pass, hash) {
  const value = pass.expect;
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  assert.equal(before, pass.device, 'before the theme menu is used the screen should follow the device (' + pass.device + '), so the choice is really made');
  if (await page.$eval('#theme', (el) => el.getClientRects().length > 0)) {
    await page.click('#theme');
    await page.waitForSelector('.menu[role="menu"]');
    const pressed = await page.evaluate((words) => {
      const item = Array.from(document.querySelectorAll('.menu[role="menu"] [role^="menuitem"]')).find((each) => each.textContent.trim().endsWith(words));
      if (!item) return false;
      item.click();
      return true;
    }, pass.choose);
    assert.ok(pressed, 'the theme menu has no item "' + pass.choose + '"');
    await page.waitForFunction(() => document.querySelector('.menu[role="menu"]') === null);
  } else {
    await go(page, '#project');
    await page.click('#settings input[name="theme"][value="' + value + '"]');
    await go(page, hash);
  }
  await page.waitForFunction((wanted) => document.documentElement.dataset.theme === wanted, {}, value);
}

// axe inside the print preview's frame. The frame is sandboxed without
// scripts, so a script tag put there never runs and the frame's own timers
// never fire; what does run is code evaluated into it from outside, and its
// promises. So axe's source is evaluated into the frame, its timers are lent
// as promise callbacks (axe waits on them with no delay that matters here),
// and its answer is left on the planner's page, which can wait for it. Null
// when no preview is open.
const AXE_SOURCE = fs.readFileSync(AXE, 'utf8');
// A screen whose id starts print- is one of the previews, and has to have
// one open: without it, nothing on paper would be checked.
async function inFrame(page, screen) {
  const handle = await page.$('#print-preview[open] iframe');
  if (!handle) {
    if (screen.id.startsWith('print-')) throw new Error(screen.id + ' is a print preview screen and no preview frame is open, so the document on paper was not checked');
    return null;
  }
  const frame = await handle.contentFrame();
  await frame.evaluate(AXE_SOURCE + '\n;void 0');
  await frame.evaluate((tags) => {
    const up = window.parent;
    const stopped = new Set();
    let last = 0;
    window.setTimeout = (run, ms, ...args) => {
      last += 1;
      const id = last;
      Promise.resolve().then(() => {
        if (!stopped.has(id)) run(...args);
      });
      return id;
    };
    window.clearTimeout = (id) => stopped.add(id);
    up.sv2FrameAxe = null;
    globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }).then(
      (result) => {
        const look = (el) => getComputedStyle(el);
        const transparent = (colour) => colour === 'rgba(0, 0, 0, 0)' || colour === 'transparent';
        const ground = transparent(look(document.body).backgroundColor) ? look(document.documentElement).backgroundColor : look(document.body).backgroundColor;
        up.sv2FrameAxe = JSON.stringify({ scheme: look(document.documentElement).colorScheme, ground, passes: result.passes.length, violations: result.violations, incomplete: result.incomplete.map((item) => ({ id: item.id, nodes: item.nodes.length })) });
      },
      (error) => {
        up.sv2FrameAxe = JSON.stringify({ error: String(error && error.message) });
      });
  }, TAGS);
  await page.waitForFunction(() => globalThis.sv2FrameAxe !== null, { timeout: 30000 });
  const answer = JSON.parse(await page.evaluate(() => globalThis.sv2FrameAxe));
  if (answer.error) throw new Error('axe failed inside the print preview: ' + answer.error);
  return answer;
}

function unallowed(violations, screen, where) {
  return violations.filter((violation) => {
    const entry = ALLOW.find((allowed) => allowed.rule === violation.id && (!allowed.screen || allowed.screen === screen.id) && (allowed.where || 'page') === where);
    if (entry) used.add(entry);
    return !entry;
  });
}

for (const pass of PASSES) {
  test(pass.name, async (t) => {
    const session = await openPlanner({ browser, server, theme: pass.device });
    try {
      for (const screen of SCREENS) {
        await t.test(screen.id, async () => {
          const chosen = pass.choose ? {
            ...screen,
            open: async (page) => {
              await choose(page, pass, screen.hash);
              if (screen.open) await screen.open(page);
            },
          } : screen;
          try {
            if (pass.choose) await forget(session);
            // inside the try, so a screen whose open() throws still has its
            // close() run: a second tab left holding the project would make
            // every later screen read-only (no-offsite.mjs does the same)
            await visit(session, chosen);
            await atRest(session.page);
            const scheme = await session.page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, theme: document.documentElement.dataset.theme }));
            assert.equal(scheme.scheme, pass.expect, 'the page should be in the ' + pass.expect + ' theme, ' + (pass.choose ? 'chosen by the person' : 'following the device'));
            if (pass.choose) assert.equal(scheme.theme, pass.expect, 'the theme should be the one chosen, not the device\'s');
            await session.page.addScriptTag({ path: AXE });
            const result = await session.page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }), TAGS);
            assert.ok(result.passes.length > 10, 'axe ran very few rules (' + result.passes.length + '), so it did not check the page');
            const violations = unallowed(result.violations, screen, 'page');
            if (result.incomplete.length > 0) t.diagnostic(screen.id + ' (' + pass.name + '): axe could not decide ' + result.incomplete.map((item) => item.id + ' ×' + item.nodes.length).join(', '));
            const paper = await inFrame(session.page, screen);
            let printed = [];
            if (paper) {
              // what the frame draws, not what the markup says (data-theme is written there and could not fail)
              assert.equal(paper.scheme, 'light', 'the print preview\'s document should be in the light colour scheme, whatever the screen');
              assert.equal(paper.ground, LIGHT_PAPER, 'the print preview\'s sheets should lie on the light paper (' + LIGHT_PAPER + '), whatever the screen');
              assert.ok(paper.passes > 5, 'axe ran very few rules inside the print preview (' + paper.passes + '), so it did not check the document');
              printed = unallowed(paper.violations, screen, 'print');
              if (paper.incomplete.length > 0) t.diagnostic(screen.id + ' (' + pass.name + ', print preview): axe could not decide ' + paper.incomplete.map((item) => item.id + ' ×' + item.nodes).join(', '));
            }
            assert.equal(violations.length, 0, 'axe found ' + violations.length + ' violation' + (violations.length === 1 ? '' : 's') + ' on ' + screen.id + ' in the ' + pass.name + ':\n' + violations.map(describe).join('\n'));
            assert.equal(printed.length, 0, 'axe found ' + printed.length + ' violation' + (printed.length === 1 ? '' : 's') + ' inside the print preview of ' + screen.id + ' in the ' + pass.name + ':\n' + printed.map(describe).join('\n'));
          } finally {
            if (screen.close) await screen.close(session.page);
          }
        });
      }
    } finally {
      await session.close();
    }
  });
}

test('every entry in the allow-list still matches something', () => {
  assert.deepEqual(ALLOW.filter((entry) => !used.has(entry)).map((entry) => entry.rule + (entry.screen ? ' on ' + entry.screen : '') + (entry.where ? ' (' + entry.where + ')' : '')), []);
});
