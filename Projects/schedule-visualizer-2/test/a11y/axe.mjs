// The accessibility sweep: node test/a11y/axe.mjs
//
// Opens every screen in test/browser/screens.mjs, once with the device asking
// for light and once for dark, runs axe-core (vendored, test/vendor/axe-core)
// on it and fails on any violation of WCAG 2.0 and 2.1 at A and AA and of
// axe's best practices. A rule that is knowingly not met goes in ALLOW with
// its reason; the list is meant to stay short, and an entry that no longer
// matches anything fails the run so it cannot outlive its reason.
//
// axe also returns "incomplete" results: things it could not decide (text
// over a gradient, for one). They are printed, not failed.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, visit, launch, startServer, TOOL_DIR } from '../browser/harness.mjs';
import { SCREENS } from '../browser/screens.mjs';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// { rule, screen (optional, an id from screens.mjs), reason }
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

function describe(violation) {
  const where = violation.nodes.map((node) => '      ' + node.target.join(' ') + '\n        ' + String(node.failureSummary || '').replace(/\n\s*/g, ' ')).join('\n');
  return '  ' + violation.id + ' (' + violation.impact + '): ' + violation.help + '\n' + where;
}

for (const theme of ['light', 'dark']) {
  test(theme + ' theme', async (t) => {
    const session = await openPlanner({ browser, server, theme });
    try {
      for (const screen of SCREENS) {
        await t.test(screen.id, async () => {
          await visit(session, screen);
          const scheme = await session.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
          assert.equal(scheme, theme, 'the page should be following the device into the ' + theme + ' theme');
          await session.page.addScriptTag({ path: AXE });
          const result = await session.page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }), TAGS);
          assert.ok(result.passes.length > 10, 'axe ran very few rules (' + result.passes.length + '), so it did not check the page');
          const violations = result.violations.filter((violation) => {
            const entry = ALLOW.find((allowed) => allowed.rule === violation.id && (!allowed.screen || allowed.screen === screen.id));
            if (entry) used.add(entry);
            return !entry;
          });
          if (result.incomplete.length > 0) t.diagnostic(screen.id + ' (' + theme + '): axe could not decide ' + result.incomplete.map((item) => item.id + ' ×' + item.nodes.length).join(', '));
          assert.equal(violations.length, 0, 'axe found ' + violations.length + ' violation' + (violations.length === 1 ? '' : 's') + ' on ' + screen.id + ' in the ' + theme + ' theme:\n' + violations.map(describe).join('\n'));
        });
      }
    } finally {
      await session.close();
    }
  });
}

test('every entry in the allow-list still matches something', () => {
  assert.deepEqual(ALLOW.filter((entry) => !used.has(entry)).map((entry) => entry.rule + (entry.screen ? ' on ' + entry.screen : '')), []);
});
