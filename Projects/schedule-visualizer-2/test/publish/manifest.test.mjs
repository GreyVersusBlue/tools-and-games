// staff/manifest.js against what the staff browser really loads: the import
// closure of staff/main.js has to be exactly the list, so a published file
// carries every module it needs and none it does not.
//
//   node test/publish/manifest.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { importsOf } from '../../ui/staff/assemble.js';
import { MODULES, ENTRY, PAGE } from '../../staff/manifest.js';
import { VIEWS } from '../../staff/views.js';
import { readTool, toolFile, TOOL_DIR } from './reader.mjs';

// The engine modules a published file carries (ARCHITECTURE 8).
const ENGINE = ['bells', 'day-types', 'directions', 'findings', 'graph', 'publish-crypto', 'routing', 'schema', 'teacher-day'].map((name) => 'engine/' + name + '.js');

function closure(entry) {
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const next of importsOf(id, readTool(id))) walk(next);
  };
  walk(entry);
  return Array.from(seen).sort();
}

function filesUnder(folder) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name.endsWith('.js')) found.push(path.relative(TOOL_DIR, file).split(path.sep).join('/'));
    }
  };
  walk(toolFile(folder));
  return found;
}

test('the manifest is exactly what staff/main.js loads, directly or through another module', () => {
  assert.deepEqual(MODULES.slice().sort(), closure(ENTRY));
});

test('the engine modules on it are exactly the nine of ARCHITECTURE 8', () => {
  assert.deepEqual(MODULES.filter((id) => id.startsWith('engine/')).sort(), ENGINE);
});

test('everything else on it is the staff browser\'s own, and every staff module is on it', () => {
  const rest = MODULES.filter((id) => !id.startsWith('engine/'));
  for (const id of rest) assert.match(id, /^staff\/[a-z0-9/-]+\.js$/, id);
  assert.deepEqual(rest.slice().sort(), filesUnder('staff').filter((id) => id !== 'staff/manifest.js').sort(), 'a file under staff/ that no published file would carry, or the other way round');
  assert.equal(new Set(MODULES).size, MODULES.length, 'a module is listed twice');
});

test('the entry and the page are where the manifest says', () => {
  assert.equal(ENTRY, 'staff/main.js');
  assert.equal(PAGE, 'staff/index.html');
  assert.equal(MODULES[MODULES.length - 1], ENTRY);
  const page = readTool(PAGE);
  assert.ok(page.includes('<script type="module" src="main.js"></script>'));
  assert.ok(page.includes('<link rel="stylesheet" href="staff.css">'));
});

test('no staff module reaches the planner, storage, or the engine modules a published file does not carry', () => {
  for (const id of MODULES.filter((module) => module.startsWith('staff/'))) {
    for (const next of importsOf(id, readTool(id))) {
      assert.ok(next.startsWith('staff/') || ENGINE.includes(next), id + ' imports ' + next);
    }
  }
});

test('every address of ARCHITECTURE 8 has a view, and each view has its own name', () => {
  const ids = VIEWS.map((view) => view.id);
  assert.deepEqual(ids.slice().sort(), ['common', 'coverage', 'directions', 'door', 'free', 'group', 'map', 'me', 'now', 'room', 'search', 'staffing', 'sub', 'teacher']);
  for (const view of VIEWS) {
    assert.equal(typeof view.title, 'function', view.id);
    assert.equal(typeof view.render, 'function', view.id);
    assert.ok(['search', 'map', 'now', 'me'].includes(view.nav), view.id + ' marks a bar item that exists');
    assert.ok(view.flag === null || ['teacher', 'group', 'room', 'map', 'free', 'now', 'common', 'coverage', 'sub', 'directions', 'staffing'].includes(view.flag), view.id + ' has a flag the publish settings have');
  }
});

test('the page says what to do where scripts do not run, and is laid out for a phone', () => {
  const page = readTool(PAGE);
  const noscript = page.slice(page.indexOf('<noscript>'), page.indexOf('</noscript>'));
  assert.ok(noscript.length > 200, 'a <noscript> block with something to say');
  assert.match(noscript, /Safari or Chrome/);
  assert.match(noscript, /Mail, Files, Gmail or Drive/);
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(page, /<meta charset="utf-8">/);
  assert.ok(!/\son[a-z]+\s*=/.test(page), 'an inline event handler');
});
