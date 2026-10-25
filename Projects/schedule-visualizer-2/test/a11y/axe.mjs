// The accessibility sweep: node test/a11y/axe.mjs
//
// Opens every screen in test/browser/screens.mjs three times: with the device
// asking for light, with it asking for dark, and with the device asking for
// light and dark chosen from the planner's theme menu (SV2-32g1). It runs
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

import { openPlanner, visit, go, launch, startServer, TOOL_DIR } from '../browser/harness.mjs';
import { SCREENS } from '../browser/screens.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// The three passes: what the device asks for, what the theme menu chooses
// (none: the project follows the device), and the theme the page must end up in.
const PASSES = [
  { name: 'light theme', device: 'light', expect: 'light' },
  { name: 'dark theme', device: 'dark', expect: 'dark' },
  { name: 'dark theme chosen from the theme menu', device: 'light', choose: 'Dark', expect: 'dark' },
];

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
// screen's fresh project before the screen opens.
async function choose(page, pass, hash) {
  const value = pass.expect;
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
async function inFrame(page) {
  const handle = await page.$('#print-preview[open] iframe');
  if (!handle) return null;
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
        up.sv2FrameAxe = JSON.stringify({ theme: document.documentElement.dataset.theme, passes: result.passes.length, violations: result.violations, incomplete: result.incomplete.map((item) => ({ id: item.id, nodes: item.nodes.length })) });
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
          await visit(session, chosen);
          try {
            await atRest(session.page);
            const scheme = await session.page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, theme: document.documentElement.dataset.theme }));
            assert.equal(scheme.scheme, pass.expect, 'the page should be in the ' + pass.expect + ' theme, ' + (pass.choose ? 'chosen by the person' : 'following the device'));
            if (pass.choose) assert.equal(scheme.theme, pass.expect, 'the theme should be the one chosen, not the device\'s');
            await session.page.addScriptTag({ path: AXE });
            const result = await session.page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }), TAGS);
            assert.ok(result.passes.length > 10, 'axe ran very few rules (' + result.passes.length + '), so it did not check the page');
            const violations = unallowed(result.violations, screen, 'page');
            if (result.incomplete.length > 0) t.diagnostic(screen.id + ' (' + pass.name + '): axe could not decide ' + result.incomplete.map((item) => item.id + ' ×' + item.nodes.length).join(', '));
            const paper = await inFrame(session.page);
            let printed = [];
            if (paper) {
              assert.equal(paper.theme, 'light', 'the print preview\'s document is printed light, whatever the screen');
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
