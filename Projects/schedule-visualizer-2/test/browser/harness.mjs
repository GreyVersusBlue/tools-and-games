// The glue between this tool's browser tests and the site's harness
// (Tools/board-check/harness.mjs, imported read-only): serve the checkout this
// file is in, open the planner, collect what went wrong.
//
//   const session = await openPlanner({ hash: '#project' });
//   session.page        the page, loaded and ready
//   session.url(hash)   the planner's address
//   session.requests    every request the page made, as URLs
//   session.problems()  page errors, console errors, failed requests; and what
//                       the harness refused or shimmed (offsite requests)
//   await session.close()
//
// `--base http://127.0.0.1:8123` on the command line (or SV2_BASE in the
// environment) uses a server that is already running instead of starting one.
// The host is 127.0.0.1, never localhost: the harness treats anything else as
// offsite.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, prepPage, serve, SITE } from '../../../../Tools/board-check/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = path.resolve(HERE, '..', '..');
export const TOOL_PATH = '/' + path.relative(SITE, TOOL_DIR).split(path.sep).join('/') + '/';

export function baseFromArgs() {
  const at = process.argv.indexOf('--base');
  const given = at !== -1 ? process.argv[at + 1] : process.env.SV2_BASE;
  return given ? String(given).replace(/\/+$/, '') : null;
}

// A server for the checkout on a free port, unless one was named.
export async function startServer() {
  const given = baseFromArgs();
  if (given) return { base: given, close: async () => {} };
  const server = await serve(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    base,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

// Wait until the shell has drawn the section the address names.
export async function waitForSection(page, id) {
  await page.waitForFunction(
    (wanted) => document.documentElement.dataset.ready === 'true'
      && document.querySelector('.surface__layout')?.dataset.section === wanted
      && document.querySelector('.rail__item[aria-current="page"]')?.dataset.section === wanted,
    { timeout: 15000 },
    id,
  );
}

// Empty this origin's IndexedDB, so a page load starts as a new device does:
// with no saved project and no recovery points. localStorage is left alone
// (the theme a test chose is meant to last). Without this, one screen's edits
// would be the next screen's saved project.
export async function clearSaved(page, base) {
  const client = typeof page.createCDPSession === 'function' ? await page.createCDPSession() : await page.context().newCDPSession(page);
  await client.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'indexeddb' });
  await client.detach();
}

// openPlanner({ hash, width, height, theme, mobile, device, keep })
//   theme    'light' or 'dark': what the device prefers (prefers-color-scheme)
//   device   an object to put in localStorage under sv2:device before the page loads
//   keep     true: load whatever project this browser has saved (a second tab, a reload)
export async function openPlanner(options) {
  const opts = options || {};
  const server = opts.server || (await startServer());
  const browser = opts.browser || (await launch());
  const page = await prepPage(browser, server.base, { width: opts.width || 1280, height: opts.height || 900, dsf: 1, mobile: opts.mobile === true });
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  if (opts.theme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.theme }]);
  if (opts.device) {
    await page.evaluateOnNewDocument((value) => {
      try {
        if (localStorage.getItem('sv2:device') === null) localStorage.setItem('sv2:device', value);
      } catch (error) { /* the page will say so itself */ }
    }, JSON.stringify(opts.device));
  }
  const url = (hash) => server.base + TOOL_PATH + (hash || '');
  const hash = opts.hash || '';
  if (opts.keep !== true) await clearSaved(page, server.base);
  await page.goto(url(hash), { waitUntil: 'load' });
  await waitForSection(page, (hash.replace(/^#/, '').split('/')[0]) || 'building');
  await page.evaluate(() => document.fonts.ready);
  return {
    page,
    browser,
    server,
    base: server.base,
    url,
    requests,
    problems() {
      return { errors: page.__errs.slice(), blocked: page.__blocked.slice(), shimmed: page.__shimmed.slice() };
    },
    async close() {
      await page.close();
      if (!opts.browser) await browser.close();
      if (!opts.server) await server.close();
    },
  };
}

// Go to another address in the same page and wait for its section.
export async function go(page, hash) {
  await page.evaluate((next) => {
    location.hash = next;
  }, hash);
  await waitForSection(page, hash.replace(/^#/, '').split('/')[0]);
}

// Load one screen of screens.mjs from scratch: a fresh page load with no
// saved project (unless the screen says `keep: true`), then whatever the
// screen needs opened.
export async function visit(session, screen) {
  const { page } = session;
  await page.goto('about:blank');
  if (screen.keep !== true) await clearSaved(page, session.base);
  await page.goto(session.url(screen.hash), { waitUntil: 'load' });
  await waitForSection(page, screen.hash.replace(/^#/, '').split('/')[0]);
  await page.evaluate(() => document.fonts.ready);
  if (screen.open) await screen.open(page);
}

export { launch };
