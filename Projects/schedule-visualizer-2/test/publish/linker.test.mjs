// The linker rule (ARCHITECTURE 8): what a module may use of the module
// system, each form it may not, and what the joined script is. Then the
// assembler around it: the stylesheet with its fonts inside, the data made
// safe for a script element, and the inputs read once.
//
//   node test/publish/linker.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { link, readModule, importsOf, encodeData, fontsOf, inlineStyles, loadInputs, buildDocument, assemble, inputsFor, LinkError } from '../../ui/staff/assemble.js';
import { MODULES, ENTRY, PAGE } from '../../staff/manifest.js';
import { publishedModel } from '../../engine/publish-data.js';
import { sampleSchool } from '../../data/sample-school.js';
import { diskReader, readTool, partsOf } from './reader.mjs';

const clock = () => new Date('2026-09-01T12:00:00Z');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'sv2-linker-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let serial = 0;
// Run a linked script for real, as the module script a published file has.
async function run(script) {
  serial += 1;
  const file = path.join(scratch, 'linked-' + serial + '.mjs');
  writeFileSync(file, script);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, 'node --check: ' + check.stderr);
  globalThis.sv2Linked = [];
  await import(pathToFileURL(file).href);
  return globalThis.sv2Linked;
}

const refuses = (modules, pattern, entry) => assert.throws(() => link(modules, entry || 'staff/main.js'), (error) => {
  assert.ok(error instanceof LinkError, 'a LinkError, got ' + error);
  assert.match(error.message, pattern);
  return true;
});

const main = (source) => ({ id: 'staff/main.js', source });
const lib = (source, id) => ({ id: id || 'staff/lib.js', source });

test('modules are wrapped, ordered by their imports, and the entry runs last', async () => {
  const script = link([
    main('import { greet } from \'./b.js\';\nglobalThis.sv2Linked.push(greet(\'main\'));\n'),
    { id: 'staff/b.js', source: 'import { shout } from \'../engine/a.js\';\nexport function greet(name) {\n  return shout(\'hello \' + name);\n}\nglobalThis.sv2Linked.push(\'b\');\n' },
    { id: 'engine/a.js', source: 'export const LOUD = \'!\';\nexport function shout(text) {\n  return text + LOUD;\n}\nglobalThis.sv2Linked.push(\'a\');\n' },
  ], 'staff/main.js');
  assert.deepEqual(await run(script), ['a', 'b', 'hello main!']);
  assert.ok(script.indexOf('// ---- engine/a.js') < script.indexOf('// ---- staff/b.js'));
  assert.ok(script.indexOf('// ---- staff/b.js') < script.indexOf('// ---- staff/main.js'));
  assert.match(script, /const \{ LOUD, shout \} = \(\(\) => \{/);
  assert.match(script, /return \{ LOUD, shout \};\n\}\)\(\);/);
  assert.match(script, /await \(async \(\) => \{/);
  assert.doesNotMatch(script, /^\s*import\b/m, 'no import line is left');
  assert.doesNotMatch(script, /^\s*export\b/m, 'no export prefix is left');
});

test('every allowed export form comes through: function, async function, const, let, class', async () => {
  const script = link([
    main('import { one, two, THREE, four, Five } from \'./lib.js\';\nglobalThis.sv2Linked.push(one(), await two(), THREE, four, new Five().n);\n'),
    lib('export function one() {\n  return 1;\n}\nexport async function two() {\n  return 2;\n}\nexport const THREE = 3;\nexport let four = 4;\nexport class Five {\n  constructor() {\n    this.n = 5;\n  }\n}\n'),
  ], 'staff/main.js');
  assert.deepEqual(await run(script), [1, 2, 3, 4, 5]);
});

test('two modules with the same private name do not collide', async () => {
  const script = link([
    main('import { fromA } from \'./a.js\';\nimport { fromB } from \'./b.js\';\nconst helper = () => \'main\';\nglobalThis.sv2Linked.push(fromA(), fromB(), helper());\n'),
    { id: 'staff/a.js', source: 'const SECRET = \'a\';\nfunction helper() {\n  return SECRET;\n}\nexport function fromA() {\n  return helper();\n}\n' },
    { id: 'staff/b.js', source: 'const SECRET = \'b\';\nfunction helper() {\n  return SECRET;\n}\nexport function fromB() {\n  return helper();\n}\n' },
  ], 'staff/main.js');
  assert.deepEqual(await run(script), ['a', 'b', 'main']);
});

test('a private name that matches another module\'s export stays the module\'s own', async () => {
  const script = link([
    main('import { label } from \'./a.js\';\nimport { other } from \'./b.js\';\nglobalThis.sv2Linked.push(label(), other());\n'),
    { id: 'staff/a.js', source: 'export function label() {\n  return \'a\';\n}\n' },
    { id: 'staff/b.js', source: 'function label() {\n  return \'b own\';\n}\nexport function other() {\n  return label();\n}\n' },
  ], 'staff/main.js');
  assert.deepEqual(await run(script), ['a', 'b own']);
});

test('two modules exporting one name are refused, since exports share a scope', () => {
  refuses([main(''), lib('export const view = 1;\n', 'staff/a.js'), lib('export const view = 2;\n', 'staff/b.js')], /staff\/b\.js and staff\/a\.js both export view/);
});

test('each disallowed form of the module system is refused, with the module and the line', () => {
  const cases = [
    ['a default export', 'const x = 1;\nexport default x;\n', /staff\/lib\.js, line 2: a default export is not allowed/],
    ['a default export of a function', 'export default function () {}\n', /a default export is not allowed/],
    ['an export list', 'const x = 1;\nexport { x };\n', /an export list is not allowed/],
    ['an export with as', 'const x = 1;\nexport { x as y };\n', /an export list is not allowed/],
    ['a re-export', 'export { a } from \'./a.js\';\n', /a re-export is not allowed/],
    ['a star re-export', 'export * from \'./a.js\';\n', /a re-export is not allowed/],
    ['export var', 'export var x = 1;\n', /`export` goes directly before function, async function, const, let or class/],
    ['an exported generator', 'export function* gen() {}\n', /`export` goes directly before/],
    ['an exported destructuring', 'export const { a, b } = {};\n', /`export` goes directly before/],
    ['an indented export', 'if (true) {\n  export const x = 1;\n}\n', /line 2: `export` starts its line/],
    ['import with as', 'import { a as b } from \'./a.js\';\n', /`as` is not allowed in an import/],
    ['import star', 'import * as a from \'./a.js\';\n', /`import \*` is not allowed/],
    ['a default import', 'import a from \'./a.js\';\n', /a default import is not allowed/],
    ['a default import beside names', 'import a, { b } from \'./a.js\';\n', /a default import is not allowed/],
    ['an import for its effects', 'import \'./a.js\';\n', /an import that names nothing is not allowed/],
    ['an import over two lines', 'import {\n  a,\n} from \'./a.js\';\n', /an import is written on one line/],
    ['an import with double quotes', 'import { a } from "./a.js";\n', /an import is written on one line/],
    ['an import from a bare name', 'import { a } from \'a\';\n', /an import is written on one line/],
    ['an import from a web address', 'import { a } from \'https://example.invalid/a.js\';\n', /an import is written on one line/],
    ['an import with no semicolon', 'import { a } from \'./a.js\'\n', /an import is written on one line/],
    ['a dynamic import', 'export async function load() {\n  return import(\'./a.js\');\n}\n', /line 2: a dynamic import\(\) is not allowed/],
    ['a dynamic import at the start of a line', 'import(\'./a.js\');\n', /a dynamic import\(\) is not allowed/],
    ['import.meta', 'export const here = import.meta.url;\n', /import\.meta is not allowed/],
    ['a worker', 'export const w = new Worker(\'w.js\');\n', /cannot start a worker/],
    ['a shared worker', 'export const w = new SharedWorker(\'w.js\');\n', /cannot start a worker/],
    ['await at the top level', 'export const x = await Promise.resolve(1);\n', /`await` outside a function is allowed in staff\/main\.js only/],
    ['await at the top level inside a block', 'if (true) {\n  await Promise.resolve();\n}\nexport const x = 1;\n', /line 2: `await` outside a function/],
    ['for await at the top level', 'for await (const x of []) {\n}\nexport const y = 1;\n', /`await` outside a function/],
    ['an export named like something the page has', 'export const location = 1;\n', /an export may not be called location/],
    ['the same name exported twice', 'export const x = 1;\nexport function x() {}\n', /x is exported twice/],
    ['a closing script tag in a string', 'export const tag = \'</script>\';\n', /would end the published file's script early/],
    ['a closing script tag in a comment, in capitals', '// </SCRIPT>\nexport const x = 1;\n', /would end the published file's script early/],
    ['a closing script tag in a template', 'export const tag = `</script >`;\n', /would end the published file's script early/],
    ['an HTML comment opener', 'export const x = \'<!-- hello\';\n', /is read as markup inside a script/],
    ['a < directly before a regular expression', 'export const x = 1 </a/.test(\'a\');\n', /a < stands directly before a \/ in code/],
  ];
  for (const [name, source, pattern] of cases) {
    assert.throws(() => link([main(''), lib(source), lib('export const a = 1;\nexport const b = 2;\n', 'staff/a.js')], 'staff/main.js'), (error) => {
      assert.ok(error instanceof LinkError, name + ': a LinkError, got ' + error);
      assert.match(error.message, pattern, name);
      return true;
    }, name);
  }
});

test('the entry module may await at the top level; nothing may import it', async () => {
  const script = link([main('const value = await Promise.resolve(7);\nglobalThis.sv2Linked.push(value);\n')], 'staff/main.js');
  assert.deepEqual(await run(script), [7]);
  refuses([main('export const x = 1;\n'), lib('import { x } from \'./main.js\';\nexport const y = x;\n')], /nothing may import the entry module/);
  refuses([lib('export const x = 1;\n')], /The entry module staff\/main\.js is not among the modules/);
});

test('await inside a function is allowed anywhere, in every shape a function has', async () => {
  const script = link([
    main('import { a, b, c, d } from \'./lib.js\';\nglobalThis.sv2Linked.push(await a(), await b(), await c.run(), await new d().go());\n'),
    lib([
      'export async function a() {',
      '  if (true) {',
      '    for (const x of [1]) {',
      '      return await Promise.resolve(x);',
      '    }',
      '  }',
      '  return 0;',
      '}',
      'export const b = async () => {',
      '  try {',
      '    return await Promise.resolve(2);',
      '  } catch (error) {',
      '    return await Promise.resolve(-2);',
      '  }',
      '};',
      'export const c = {',
      '  async run() {',
      '    const text = `${await Promise.resolve(3)}`;',
      '    return Number(text);',
      '  },',
      '};',
      'export class d {',
      '  async go() {',
      '    while (true) {',
      '      return await Promise.resolve(4);',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')),
  ], 'staff/main.js');
  assert.deepEqual(await run(script), [1, 2, 3, 4]);
});

test('the words import, export and await in a comment, a string, a template or a regular expression are left alone', async () => {
  const source = [
    '// import x from "nowhere"; export default 1; await nothing; new Worker()',
    '/* import("./a.js")',
    'export * from "./a.js";',
    '*/',
    'export const text = \'import("x") and export default and import.meta and await\';',
    'export const template = `',
    'export const hidden = 1;',
    'import { a } from "./nowhere.js";',
    '${\'in\' + `ner ${1 + 1}`} await`;',
    'export const pattern = /import\\(|export default|[/"\'`]await/;',
    'export const half = 10 / 2 / 1;',
    'export const quoted = "it\'s // not a comment";',
    'export function divide(a, b) {',
    '  return a / b; // import("z")',
    '}',
    '',
  ].join('\n');
  const script = link([
    main('import { text, template, pattern, half, quoted, divide } from \'./lib.js\';\nglobalThis.sv2Linked.push(text, template, pattern.source, half, quoted, divide(6, 3));\n'),
    lib(source),
  ], 'staff/main.js');
  const got = await run(script);
  assert.equal(got[0], 'import("x") and export default and import.meta and await');
  assert.equal(got[1], '\nexport const hidden = 1;\nimport { a } from "./nowhere.js";\ninner 2 await');
  assert.equal(got[2], 'import\\(|export default|[/"\'`]await');
  assert.equal(got[3], 5);
  assert.equal(got[4], 'it\'s // not a comment');
  assert.equal(got[5], 2);
});

test('every </ in code is written <\\/, and means the same', async () => {
  const script = link([
    main('import { closing, pattern } from \'./lib.js\';\nglobalThis.sv2Linked.push(closing, pattern.test(\'</b>\'));\n'),
    lib('// a </div> in a comment\nexport const closing = \'</b>\' + `</i>`;\nexport const pattern = /<\\/b>/;\n'),
  ], 'staff/main.js');
  assert.ok(!script.includes('</'), 'a </ is left in the script');
  assert.deepEqual(await run(script), ['</b></i>', true]);
});

test('an import of something that is not there, or not exported, is refused', () => {
  refuses([main('import { a } from \'./gone.js\';\n')], /staff\/main\.js, line 1: it imports staff\/gone\.js, which is not in the list of modules/);
  refuses([main('import { missing } from \'./lib.js\';\n'), lib('export const present = 1;\n')], /staff\/lib\.js does not export missing/);
  refuses([main('import { a } from \'../../outside.js\';\n')], /leaves the tool's folder|not in the list of modules/);
});

test('modules that import each other in a circle are refused, and the circle is named', () => {
  refuses([
    main('import { a } from \'./a.js\';\n'),
    { id: 'staff/a.js', source: 'import { b } from \'./b.js\';\nexport const a = 1;\n' },
    { id: 'staff/b.js', source: 'import { a } from \'./a.js\';\nexport const b = 2;\n' },
  ], /in a circle: staff\/a\.js → staff\/b\.js → staff\/a\.js/);
});

test('a module listed twice is refused', () => {
  refuses([main(''), lib('export const a = 1;\n'), lib('export const b = 1;\n')], /staff\/lib\.js is listed twice/);
});

test('imports resolve across folders, and a module with no exports is still run', async () => {
  const script = link([
    main('import { deep } from \'./views/deep.js\';\nglobalThis.sv2Linked.push(deep());\n'),
    { id: 'staff/views/deep.js', source: 'import { base } from \'../../engine/base.js\';\nimport { near } from \'../near.js\';\nexport function deep() {\n  return base + near;\n}\n' },
    { id: 'engine/base.js', source: 'export const base = \'engine+\';\n' },
    { id: 'staff/near.js', source: 'export const near = \'near\';\n' },
    { id: 'staff/effect.js', source: 'globalThis.sv2Linked.push(\'effect\');\n' },
  ], 'staff/main.js');
  assert.deepEqual(await run(script), ['effect', 'engine+near']);
  assert.deepEqual(importsOf('staff/views/deep.js', 'import { base } from \'../../engine/base.js\';\nimport { near } from \'../near.js\';\n'), ['engine/base.js', 'staff/near.js']);
});

test('a module with Windows line endings links to the same script', () => {
  const unix = [main('import { a } from \'./lib.js\';\nconst b = a;\n'), lib('export const a = 1;\n')];
  const windows = unix.map((module) => ({ id: module.id, source: module.source.split('\n').join('\r\n') }));
  assert.equal(link(windows, 'staff/main.js'), link(unix, 'staff/main.js'));
});

test('readModule gives a module\'s imports, its exports and its body', () => {
  const read = readModule('staff/x.js', 'import { a, b } from \'./y.js\';\nexport const c = a + b;\nfunction hidden() {}\nexport function d() {}\n');
  assert.deepEqual(read.imports, [{ from: 'staff/y.js', names: ['a', 'b'], line: 1 }]);
  assert.deepEqual(read.exports, ['c', 'd']);
  assert.equal(read.body, '\nconst c = a + b;\nfunction hidden() {}\nfunction d() {}\n');
});

// ---------------------------------------------------------------- the real modules

test('the staff browser\'s own modules link, and node --check passes on the result', async () => {
  const modules = MODULES.map((id) => ({ id, source: readTool(id) }));
  const script = link(modules, ENTRY);
  const file = path.join(scratch, 'staff.mjs');
  writeFileSync(file, script);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const id of MODULES) assert.equal(script.split('// ---- ' + id + '\n').length, 2, id + ' is in the script once');
  assert.ok(!script.includes('</'), 'a </ is left in the script');
  assert.ok(!/<\/script/i.test(script));
  assert.ok(script.trimEnd().endsWith('})();'));
  assert.ok(script.lastIndexOf('// ---- ') === script.indexOf('// ---- ' + ENTRY), 'the entry is last');
});

// ---------------------------------------------------------------- data and styles

test('data is written so that nothing in it can end the script or open a comment', () => {
  const value = { name: '</script><script>alert(1)</script>', note: '<!-- x -->', lines: 'a\u2028b\u2029c', plain: 'x < y', quote: '"\\' };
  const text = encodeData(value);
  assert.ok(!text.includes('<'), 'a < is left');
  assert.ok(!text.includes('\u2028') && !text.includes('\u2029'));
  assert.ok(text.includes('\\u003c/script>'));
  assert.deepEqual(JSON.parse(text), value);
});

test('a stylesheet\'s fonts go inside it as data, each named file once', () => {
  const css = '@font-face { src: url(../fonts/a.woff2) format("woff2"); }\n@font-face { src: url("../fonts/b.woff2"); }\n.x { src: url( \'../fonts/a.woff2\' ); }\n';
  assert.deepEqual(fontsOf(css), ['a.woff2', 'b.woff2']);
  const out = inlineStyles('staff/staff.css', css, { 'a.woff2': new Uint8Array([1, 2, 3]), 'b.woff2': new Uint8Array([255]) });
  assert.equal(out, '@font-face { src: url(data:font/woff2;base64,AQID) format("woff2"); }\n@font-face { src: url(data:font/woff2;base64,/w==); }\n.x { src: url(data:font/woff2;base64,AQID); }\n');
});

test('a stylesheet that could end the page\'s styles, or that asks for anything else, is refused', () => {
  const refused = (css, pattern) => assert.throws(() => inlineStyles('staff/staff.css', css, {}), (error) => error instanceof LinkError && pattern.test(error.message));
  refused('.x::after { content: "</style>"; }', /would end the published file's styles early/);
  refused('.x::after { content: "</STYLE >"; }', /would end the published file's styles early/);
  refused('@import "other.css";', /uses @import/);
  refused('.x { background: url(picture.png); }', /asks for picture\.png/);
  refused('.x { background: url("https://example.invalid/a.png"); }', /asks for https:\/\/example\.invalid/);
  refused('.x { background: url(//example.invalid/a.png); }', /asks for \/\/example\.invalid/);
  refused('@font-face { src: url(../fonts/missing.woff2); }', /names the font missing\.woff2, which was not read/);
  assert.equal(inlineStyles('s.css', '.x { background: url(data:image/png;base64,AAAA); }', {}), '.x { background: url(data:image/png;base64,AAAA); }');
});

// ---------------------------------------------------------------- the document

test('the assembled document is one file: styles, fonts, code and data inside, and nothing it asks for', async () => {
  const model = publishedModel(sampleSchool(), { clock });
  const html = await assemble(diskReader(), model);
  const parts = partsOf(html);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(html.split('<script type="module">').length, 2, 'one module script');
  assert.equal(html.split('<style>').length, 2, 'one style element');
  assert.equal(html.split('id="sv2-published"').length, 2, 'one data element');
  assert.ok(html.indexOf('id="sv2-published"') < html.indexOf('<script type="module">'), 'the data comes before the code');
  assert.deepEqual(JSON.parse(parts.data), model);
  assert.ok(!/<link\b[^>]*stylesheet/i.test(html), 'a stylesheet link is left');
  assert.ok(!/<script\b[^>]*\bsrc=/i.test(html), 'a script with a src is left');
  assert.ok(!/url\(\s*['"]?\.\.\//.test(parts.style), 'a font is still named by its file');
  assert.equal(parts.style.split('url(data:font/woff2;base64,').length - 1, 4, 'the four fonts are inside');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) assert.match(match[1], /^(data:|#)/, 'the page points at ' + match[1]);
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'the page names a web address');
  assert.ok(html.includes('<noscript>'));
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('with no data the document has no data element: that is the preview\'s page', async () => {
  const read = diskReader();
  const empty = await assemble(read, null);
  assert.equal(partsOf(empty).data, null);
  assert.equal(await assemble(read), empty);
  const full = await assemble(read, { format: 'sv2-published' });
  assert.equal(partsOf(full).script, partsOf(empty).script, 'the code is the same with data as without');
  assert.equal(partsOf(full).style, partsOf(empty).style);
});

test('a school name that tries to close the script is carried as data and nothing else', async () => {
  const project = sampleSchool();
  const hostile = '</script><script>globalThis.broken = true</script><!-- \u2028 $& $1 $`';
  project.settings.schoolName = hostile;
  const model = publishedModel(project, { clock });
  const html = await assemble(diskReader(), model);
  assert.equal(html.split('</script>').length, 3, 'two script elements, each closed once');
  assert.equal(html.split('<script').length, 3);
  assert.ok(!html.includes('globalThis.broken = true</script>'));
  assert.equal(JSON.parse(partsOf(html).data).settings.schoolName, hostile);
});

test('the inputs are read once per reader, however many documents are made', async () => {
  const read = diskReader();
  const first = await assemble(read, { n: 1 });
  const asked = read.asked.slice();
  const second = await assemble(read, { n: 2 });
  await assemble(read, null);
  await Promise.all([assemble(read, { n: 3 }), assemble(read, { n: 4 })]);
  assert.deepEqual(read.asked, asked, 'a file was read again');
  assert.notEqual(first, second);
  const expected = [PAGE, 'staff/staff.css', 'fonts/public-sans-latin-400-normal.woff2', 'fonts/public-sans-latin-600-normal.woff2', 'fonts/public-sans-latin-700-normal.woff2', 'fonts/barlow-semi-condensed-latin-600-normal.woff2'].concat(MODULES);
  assert.deepEqual(asked, expected, 'exactly the page, its stylesheet, its fonts and the manifest\'s modules, each once');
  assert.equal(inputsFor(read), inputsFor(read));
  const other = diskReader();
  await assemble(other, null);
  assert.equal(other.asked.length, expected.length, 'another reader reads for itself');
});

test('a reader that fails is asked again next time, not remembered as failed', async () => {
  let fail = true;
  const disk = diskReader();
  const read = async (name, kind) => {
    if (fail && name === 'staff/staff.css') throw new Error('offline');
    return disk(name, kind);
  };
  await assert.rejects(assemble(read, null), /offline/);
  fail = false;
  assert.ok((await assemble(read, null)).includes('<style>'));
});

test('a page the assembler cannot make self-contained is refused', async () => {
  const page = readTool(PAGE);
  const withPage = (text) => {
    const disk = diskReader();
    return async (name, kind) => (name === PAGE ? text : disk(name, kind));
  };
  await assert.rejects(loadInputs(withPage(page.replace('<link rel="stylesheet" href="staff.css">', ''))), /has no <link rel="stylesheet"/);
  await assert.rejects(loadInputs(withPage(page.replace('<script type="module" src="main.js"></script>', ''))), /needs exactly one <script type="module"/);
  await assert.rejects(loadInputs(withPage(page.replace('</head>', '<link rel="preload" href="extra.woff2"></head>'))), /points at extra\.woff2/);
  await assert.rejects(loadInputs(withPage(page.replace('<div id="app"', '<img src="https://example.invalid/pixel.gif"><div id="app"'))), /points at https:\/\/example\.invalid/);
  const inputs = await loadInputs(withPage(page));
  assert.ok(buildDocument(inputs, null).includes('<div id="app"'));
});
