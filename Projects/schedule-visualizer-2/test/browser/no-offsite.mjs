// Zero offsite requests: node test/browser/no-offsite.mjs
//
// Three checks.
// 1. The files the page can load are read as text and may name no address
//    outside the tool. This needs no browser and covers code no screen reaches.
// 2. Every screen in screens.mjs is opened and the harness's two lists must be
//    empty: page.__blocked (offsite URLs it refused) and page.__shimmed (font
//    requests it answered itself, which a real visit would send to Google).
// 3. Every request the page made is counted here, not by the harness, and each
//    must be for a file inside this tool's own folder: the harness lets
//    anything on 127.0.0.1 through, so its lists alone do not prove that.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { openPlanner, visit, TOOL_DIR, TOOL_PATH } from './harness.mjs';
import { SCREENS } from './screens.mjs';

// What the page can load. test/ and the markdown files are not part of it.
const SHIPPED = ['index.html', 'manifest.webmanifest', 'icon.svg', 'ui', 'engine', 'data', 'storage', 'staff', 'vendor'];
const TEXT = ['.html', '.js', '.css', '.svg', '.webmanifest', '.json'];
// An XML namespace is a name, not a request.
const NAMES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink'];

function shippedFiles() {
  const found = [];
  const walk = (file) => {
    let stat;
    try {
      stat = statSync(file);
    } catch (error) {
      return;
    }
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) walk(path.join(file, name));
    else if (TEXT.includes(path.extname(file))) found.push(file);
  };
  for (const name of SHIPPED) walk(path.join(TOOL_DIR, name));
  return found;
}

export function offsiteAddresses(text) {
  const found = [];
  for (const match of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)<>]*/gi)) {
    const address = match[0];
    if (!/^https?:/i.test(address)) {
      // a protocol-relative address only counts where it could be loaded
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      if (!/(?:src=|href=|url\(|import\s|from\s)\s*["'`(]?$/i.test(before)) continue;
    }
    if (NAMES.some((name) => address.startsWith(name))) continue;
    found.push(address);
  }
  return found;
}

// The site writes a block of share-card tags into index.html between these
// markers (Tools/board-check/sync-social-tags.mjs): og:url and og:image name
// the page's own public address on greyversusblue.com. They are the values of
// <meta content="…">, which no browser loads, and the site's own integrity
// sweep checks that block. Everything outside the block is scanned as before.
const SOCIAL_BLOCK = /<!-- gvb:social:start[\s\S]*?<!-- gvb:social:end -->/;

export function scannedText(file, text) {
  return path.basename(file) === 'index.html' ? text.replace(SOCIAL_BLOCK, '') : text;
}

test('the scanner sees an address in each place one can hide', () => {
  const block = '<!-- gvb:social:start x -->\n<meta property="og:url" content="https://greyversusblue.com/Projects/schedule-visualizer-2/">\n<!-- gvb:social:end -->\n';
  assert.deepEqual(offsiteAddresses(scannedText('a/index.html', block)), []);
  assert.deepEqual(offsiteAddresses(scannedText('a/index.html', block + '<link href="https://greyversusblue.com/x.css">')), ['https://greyversusblue.com/x.css']);
  assert.deepEqual(offsiteAddresses(scannedText('a/main.js', block)), ['https://greyversusblue.com/Projects/schedule-visualizer-2/']);
  assert.deepEqual(offsiteAddresses('<link href="https://fonts.googleapis.com/css2?family=Inter">'), ['https://fonts.googleapis.com/css2?family=Inter']);
  assert.deepEqual(offsiteAddresses('background: url(//cdn.example.com/a.png)'), ['//cdn.example.com/a.png']);
  assert.deepEqual(offsiteAddresses("import x from 'http://example.com/x.js'"), ['http://example.com/x.js']);
  assert.deepEqual(offsiteAddresses('svg.setAttribute("xmlns", "http://www.w3.org/2000/svg") // a comment'), []);
});

test('no file the page can load names an address outside the tool', () => {
  const files = shippedFiles();
  assert.ok(files.length > 20, 'expected to read the tool\'s files, found ' + files.length);
  const hits = [];
  for (const file of files) {
    for (const address of offsiteAddresses(scannedText(file, readFileSync(file, 'utf8')))) hits.push(path.relative(TOOL_DIR, file) + ': ' + address);
  }
  assert.deepEqual(hits, []);
});

let session;

before(async () => {
  session = await openPlanner({ intercept: true });
});

after(async () => {
  if (session) await session.close();
});

for (const screen of SCREENS) {
  test('screen ' + screen.id + ' asks for nothing outside the tool\'s folder', async () => {
    session.requests.length = 0;
    session.page.__blocked.length = 0;
    session.page.__shimmed.length = 0;
    session.page.__errs.length = 0;
    await visit(session, screen);
    const { errors, blocked, shimmed } = session.problems();
    assert.deepEqual(blocked, [], 'offsite requests the harness refused');
    assert.deepEqual(shimmed, [], 'font requests the harness answered itself; a real visit sends these offsite');
    const own = session.base + TOOL_PATH;
    // an address the page made itself is no request to anywhere: the staff preview's frame is a blob: page, and each font inside it a data: one
    const made = session.requests.filter((url) => url !== 'about:blank' && !/^(blob|data):/.test(url));
    assert.ok(made.length > 0, 'the page made no request at all, so nothing was counted');
    assert.deepEqual(made.filter((url) => !url.startsWith(own)), [], 'requests outside ' + own);
    assert.deepEqual(errors, [], 'errors on the page');
  });
}
