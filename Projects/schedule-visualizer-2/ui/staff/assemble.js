// The assembler: one self-contained document made from the staff browser's
// own files. The planner's preview is this document with no data in it, fed by
// messages; a published file is the same document with the data inline. So
// what staff receive is what the preview showed.
//
//   const page = await assemble(pageReader(), data);    in the planner
//   const page = await assemble(read, data);            in Node, with a reader
//
// `read(path, 'text' | 'bytes')` answers with a file of this tool by its path
// from the tool's folder ('staff/main.js', 'fonts/x.woff2'). The inputs are
// read once per reader and kept, so publishing again asks for nothing.
//
// The modules are joined by the linker rule (ARCHITECTURE 8). A module may use
//
//   import { a, b } from './x.js';        on one line, starting the line
//   export function | async function | const | let | class name
//
// and nothing else of the module system: no default export, no `as`, no
// `import *`, no re-export, no import(), no import.meta, no worker, and no
// `await` outside a function except in the entry module. Each module becomes
//
//   const { a, b } = (() => { …the module… return { a, b }; })();
//
// in the order its imports need, and the entry module comes last inside
// `await (async () => { … })();`. A module's private names stay private; an
// exported name has to be the only one of that name in the whole file.
//
// This file uses nothing of the page until pageReader() or one of the two
// preview functions is called, so the tests run link() and assemble() in Node.

import { MODULES, ENTRY, PAGE } from '../../staff/manifest.js';
import { DATA_ELEMENT_ID, PREVIEW_READY, PREVIEW_DATA } from '../../staff/source.js';
import { toBase64 } from '../../engine/publish-crypto.js';

export class LinkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LinkError';
  }
}

// Names a module may not export: every module's exports share one scope in the
// assembled script, so an export called `location` would stand in front of the
// page's own for all of them.
const TAKEN = new Set([
  'window', 'document', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage', 'console', 'crypto', 'fetch',
  'globalThis', 'self', 'top', 'parent', 'name', 'status', 'event', 'open', 'close', 'focus', 'blur', 'print', 'stop', 'origin',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Math', 'JSON', 'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'Error', 'TypeError',
  'Uint8Array', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'Blob', 'Intl', 'undefined', 'NaN', 'Infinity',
]);

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'await']); // `await` for `for await (…)`
// After one of these a slash starts a regular expression, not a division.
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

const CODE = 0;
const COMMENT = 1;
const TEXT = 2;

function isWordStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isWord(ch) {
  return isWordStart(ch) || (ch >= '0' && ch <= '9');
}

// Read a module's text once: which characters are code, which are comment and
// which are inside a string, a template or a regular expression; every word
// that is code; and where `await` stands outside any function.
function scan(id, source) {
  const length = source.length;
  const state = new Uint8Array(length);
  const words = [];
  const topAwaits = [];
  const blocks = []; // open braces: 'fn', 'block' or 'template' (a ${ } inside a template)
  const parens = []; // open parentheses: the word before each
  let functions = 0;
  let last = ''; // the last word or mark that was code
  let lastWasValue = false;
  let closedParen = '';
  let i = 0;

  const fail = (what, at) => {
    throw new LinkError(id + ', line ' + lineOf(source, at) + ': ' + what);
  };

  const readTemplate = (from) => {
    // from is just past the opening backtick, or just past a } that ended ${ }
    let at = from;
    while (at < length) {
      const ch = source[at];
      if (ch === '\\') {
        state[at] = TEXT;
        if (at + 1 < length) state[at + 1] = TEXT;
        at += 2;
      } else if (ch === '`') {
        state[at] = TEXT;
        return { at: at + 1, open: false };
      } else if (ch === '$' && source[at + 1] === '{') {
        state[at] = TEXT;
        state[at + 1] = TEXT;
        return { at: at + 2, open: true };
      } else {
        state[at] = TEXT;
        at += 1;
      }
    }
    return fail('a template string is never closed.', from);
  };

  while (i < length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < length && source[i] !== '\n') {
        state[i] = COMMENT;
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) fail('a comment is never closed.', i);
      for (let at = i; at < end + 2; at += 1) state[at] = COMMENT;
      i = end + 2;
    } else if (ch === '\'' || ch === '"') {
      const from = i;
      state[i] = TEXT;
      i += 1;
      while (i < length && source[i] !== ch) {
        if (source[i] === '\n') fail('a string runs past the end of its line.', from);
        state[i] = TEXT;
        if (source[i] === '\\') {
          i += 1;
          if (i < length) state[i] = TEXT;
        }
        i += 1;
      }
      if (i >= length) fail('a string is never closed.', from);
      state[i] = TEXT;
      i += 1;
      last = 'text';
      lastWasValue = true;
    } else if (ch === '`') {
      state[i] = TEXT;
      const result = readTemplate(i + 1);
      i = result.at;
      if (result.open) blocks.push('template');
      last = 'text';
      lastWasValue = true;
    } else if (ch === '/' && !lastWasValue) {
      const from = i;
      let inClass = false;
      state[i] = TEXT;
      i += 1;
      while (i < length && (inClass || source[i] !== '/')) {
        if (source[i] === '\n') fail('a regular expression runs past the end of its line.', from);
        state[i] = TEXT;
        if (source[i] === '\\') {
          i += 1;
          if (i < length) state[i] = TEXT;
        } else if (source[i] === '[') {
          inClass = true;
        } else if (source[i] === ']') {
          inClass = false;
        }
        i += 1;
      }
      if (i >= length) fail('a regular expression is never closed.', from);
      state[i] = TEXT;
      i += 1;
      while (i < length && isWord(source[i])) {
        state[i] = TEXT;
        i += 1;
      }
      last = 'text';
      lastWasValue = true;
    } else if (isWordStart(ch)) {
      const from = i;
      while (i < length && isWord(source[i])) i += 1;
      const word = source.slice(from, i);
      const property = last === '.';
      words.push({ word, at: from, property, before: last });
      if (word === 'await' && !property && functions === 0) topAwaits.push(from);
      last = property ? 'name' : word;
      lastWasValue = property || !BEFORE_REGEX.has(word);
    } else if (ch >= '0' && ch <= '9') {
      while (i < length && (isWord(source[i]) || source[i] === '.')) i += 1;
      last = 'number';
      lastWasValue = true;
    } else if (ch === '(') {
      parens.push(last);
      last = '(';
      lastWasValue = false;
      i += 1;
    } else if (ch === ')') {
      closedParen = parens.length > 0 ? parens.pop() : '';
      last = ')';
      lastWasValue = true;
      i += 1;
    } else if (ch === '{') {
      const isFunction = last === '=>' || (last === ')' && !CONTROL.has(closedParen));
      blocks.push(isFunction ? 'fn' : 'block');
      if (isFunction) functions += 1;
      last = '{';
      lastWasValue = false;
      i += 1;
    } else if (ch === '}') {
      const kind = blocks.pop();
      if (kind === undefined) fail('a } closes nothing.', i);
      if (kind === 'fn') functions -= 1;
      if (kind === 'template') {
        state[i] = TEXT;
        const result = readTemplate(i + 1);
        i = result.at;
        if (result.open) blocks.push('template');
        last = 'text';
        lastWasValue = true;
      } else {
        last = '}';
        lastWasValue = true;
        i += 1;
      }
    } else if (ch === '=' && next === '>') {
      last = '=>';
      lastWasValue = false;
      i += 2;
    } else if (ch === ']') {
      last = ']';
      lastWasValue = true;
      i += 1;
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
    } else if (ch === '+' && next === '+') {
      // x++ / y is a division; ++ keeps what came before it
      i += 2;
    } else if (ch === '-' && next === '-') {
      i += 2;
    } else {
      last = ch;
      lastWasValue = false;
      i += 1;
    }
  }
  if (blocks.length > 0) fail('a { is never closed.', length - 1);
  return { state, words, topAwaits };
}

function lineOf(source, at) {
  let line = 1;
  for (let i = 0; i < at && i < source.length; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

const IMPORT_LINE = /^import \{ ([A-Za-z_$][A-Za-z0-9_$]*(?:, [A-Za-z_$][A-Za-z0-9_$]*)*) \} from '(\.\.?\/[A-Za-z0-9_.\/-]+\.js)';[ \t]*$/;
const EXPORT_LINE = /^export (?:async function|function|const|let|class) ([A-Za-z_$][A-Za-z0-9_$]*)\b/;

function resolve(fromId, specifier) {
  const parts = fromId.split('/');
  parts.pop();
  for (const piece of specifier.split('/')) {
    if (piece === '.') continue;
    if (piece === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(piece);
    }
  }
  return parts.join('/');
}

function why(line) {
  if (/^import\s*\(/.test(line)) return 'a dynamic import() is not allowed';
  if (/^import\s*\./.test(line)) return 'import.meta is not allowed';
  if (/^import\s+\*/.test(line)) return '`import *` is not allowed; name what is imported';
  if (/^import\s+['"]/.test(line)) return 'an import that names nothing is not allowed';
  if (/^import\s+[A-Za-z_$]/.test(line)) return 'a default import is not allowed; import by name';
  if (/^import\b.*\bas\b/.test(line)) return '`as` is not allowed in an import';
  if (/^import\b/.test(line)) return 'an import is written on one line as `import { a, b } from \'./x.js\';`';
  if (/^export\s+default\b/.test(line)) return 'a default export is not allowed; export by name';
  if (/^export\s*\*/.test(line)) return 'a re-export is not allowed';
  if (/^export\s*\{/.test(line)) return /\bfrom\b/.test(line) ? 'a re-export is not allowed' : 'an export list is not allowed; put `export` directly before the declaration';
  return '`export` goes directly before function, async function, const, let or class, and one name';
}

// Read one module by the linker rule. Gives { id, imports, exports, body }
// with the import lines blanked and the `export ` prefixes gone, or throws a
// LinkError that names the module, the line and the rule it broke.
export function readModule(id, source, options) {
  const entry = Boolean(options && options.entry);
  if (typeof source !== 'string') throw new LinkError(id + ' could not be read.');
  const text = source.replace(/\r\n?/g, '\n');
  const lowered = text.toLowerCase();
  if (lowered.includes('</script')) throw new LinkError(id + ', line ' + lineOf(text, lowered.indexOf('</script')) + ': the text "<' + '/script" would end the published file\'s script early. Build the tag from two strings.');
  if (text.includes('<!--')) throw new LinkError(id + ', line ' + lineOf(text, text.indexOf('<!--')) + ': the text "<!-' + '-" is read as markup inside a script. Build it from two strings.');
  const { state, words, topAwaits } = scan(id, text);
  const fail = (what, at) => {
    throw new LinkError(id + ', line ' + lineOf(text, at) + ': ' + what + '.');
  };

  for (let at = text.indexOf('</'); at !== -1; at = text.indexOf('</', at + 2)) {
    if (state[at] === CODE) fail('a < stands directly before a / in code; put a space between them', at);
  }

  const imports = [];
  const exports = [];
  const cuts = []; // [from, to) ranges to blank
  for (const { word, at, property, before } of words) {
    if (property) continue;
    if (word === 'import' || word === 'export') {
      const lineStart = text.lastIndexOf('\n', at - 1) + 1;
      let lineEnd = text.indexOf('\n', at);
      if (lineEnd === -1) lineEnd = text.length;
      const line = text.slice(at, lineEnd);
      if (at !== lineStart) fail(word === 'import' ? why(line) + ' (and an import starts its line)' : '`export` starts its line', at);
      if (word === 'import') {
        const match = IMPORT_LINE.exec(line);
        if (!match) fail(why(line), at);
        const from = resolve(id, match[2]);
        if (from === null) fail('the import of ' + match[2] + ' leaves the tool\'s folder', at);
        imports.push({ from, names: match[1].split(', '), line: lineOf(text, at) });
        cuts.push([at, lineEnd]);
      } else {
        const match = EXPORT_LINE.exec(line);
        if (!match) fail(why(line), at);
        if (exports.includes(match[1])) fail(match[1] + ' is exported twice', at);
        if (TAKEN.has(match[1])) fail('an export may not be called ' + match[1] + ', which the page already has', at);
        exports.push(match[1]);
        cuts.push([at, at + 'export '.length]);
      }
    } else if (word === 'Worker' || word === 'SharedWorker') {
      if (before === 'new') fail('a published file cannot start a worker', at);
    }
  }
  if (!entry && topAwaits.length > 0) fail('`await` outside a function is allowed in ' + ENTRY + ' only (an arrow function that awaits needs braces)', topAwaits[0]);

  let body = '';
  let from = 0;
  for (const [start, end] of cuts) {
    body += text.slice(from, start);
    from = end;
  }
  body += text.slice(from);
  return { id, imports, exports, body };
}

// link([{ id, source }], entryId) → the text of one module script. The order
// comes from the imports; the list's own order only settles ties.
export function link(modules, entryId) {
  const read = new Map();
  for (const module of modules) {
    if (read.has(module.id)) throw new LinkError(module.id + ' is listed twice.');
    read.set(module.id, readModule(module.id, module.source, { entry: module.id === entryId }));
  }
  if (!read.has(entryId)) throw new LinkError('The entry module ' + entryId + ' is not among the modules.');

  const owner = new Map();
  for (const module of read.values()) {
    for (const name of module.exports) {
      if (owner.has(name)) throw new LinkError(module.id + ' and ' + owner.get(name) + ' both export ' + name + '. Exported names share one scope in the published file, so each has to be the only one.');
      owner.set(name, module.id);
    }
  }
  for (const module of read.values()) {
    for (const wanted of module.imports) {
      const target = read.get(wanted.from);
      if (!target) throw new LinkError(module.id + ', line ' + wanted.line + ': it imports ' + wanted.from + ', which is not in the list of modules (staff/manifest.js).');
      if (wanted.from === entryId) throw new LinkError(module.id + ', line ' + wanted.line + ': nothing may import the entry module.');
      for (const name of wanted.names) {
        if (!target.exports.includes(name)) throw new LinkError(module.id + ', line ' + wanted.line + ': ' + wanted.from + ' does not export ' + name + '.');
      }
    }
  }

  const order = [];
  const mark = new Map(); // id -> 'open' | 'done'
  const visit = (id, trail) => {
    if (mark.get(id) === 'done') return;
    if (mark.get(id) === 'open') throw new LinkError('The modules import each other in a circle: ' + trail.slice(trail.indexOf(id)).concat(id).join(' → ') + '.');
    mark.set(id, 'open');
    for (const wanted of read.get(id).imports) visit(wanted.from, trail.concat(id));
    mark.set(id, 'done');
    order.push(id);
  };
  for (const module of modules) if (module.id !== entryId) visit(module.id, []);
  visit(entryId, []);

  let script = '';
  for (const id of order) {
    const module = read.get(id);
    const body = module.body.endsWith('\n') ? module.body : module.body + '\n';
    script += '// ---- ' + id + '\n';
    if (id === entryId) {
      script += 'await (async () => {\n' + body + '})();\n';
    } else if (module.exports.length === 0) {
      script += '(() => {\n' + body + '})();\n';
    } else {
      const names = module.exports.join(', ');
      script += 'const { ' + names + ' } = (() => {\n' + body + 'return { ' + names + ' };\n})();\n';
    }
  }
  return script.split('</').join('<\\/');
}

// The import lines of one module, as the ids they resolve to. For the test
// that holds staff/manifest.js to what staff/main.js really loads.
export function importsOf(id, source) {
  return readModule(id, source, { entry: true }).imports.map((wanted) => wanted.from);
}

// A value as JSON that is safe inside a script element: no `<` (so no closing
// tag and no comment opener), and the two line separators that JSON allows
// raw escaped.
export function encodeData(value) {
  return JSON.stringify(value)
    .split('<').join('\\u003c')
    .split(' ').join('\\u2028')
    .split(' ').join('\\u2029');
}

const FONT_URL = /url\(\s*(['"]?)\.\.\/fonts\/([A-Za-z0-9_.-]+\.woff2)\1\s*\)/g;

// The font files a stylesheet names, each once, in the order met.
export function fontsOf(css) {
  const names = [];
  for (const match of css.matchAll(FONT_URL)) if (!names.includes(match[2])) names.push(match[2]);
  return names;
}

// A stylesheet with its fonts inside it. `fonts` maps a file name to bytes.
export function inlineStyles(name, css, fonts) {
  const text = css.replace(/\r\n?/g, '\n');
  if (text.toLowerCase().includes('</style')) throw new LinkError(name + ' holds the text "<' + '/style", which would end the published file\'s styles early.');
  if (/@import\b/i.test(text)) throw new LinkError(name + ' uses @import; a published file has one stylesheet inside it.');
  const out = text.replace(FONT_URL, (whole, quote, file) => {
    const bytes = fonts[file];
    if (!bytes) throw new LinkError(name + ' names the font ' + file + ', which was not read.');
    return 'url(data:font/woff2;base64,' + toBase64(bytes) + ')';
  });
  for (const match of out.matchAll(/url\(\s*['"]?([^'")]{0,60})/g)) {
    if (!match[1].startsWith('data:')) throw new LinkError(name + ' asks for ' + match[1] + '; a published file can only carry fonts from ../fonts/ and data it holds itself.');
  }
  return out;
}

const STYLE_LINK = /<link rel="stylesheet" href="([A-Za-z0-9_.-]+\.css)">/g;
const SCRIPT_TAG = /<script type="module" src="([A-Za-z0-9_.-]+\.js)"><\/script>/g;

function folderOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

// Read everything a published file is made of, and join what can be joined
// ahead of the data: { page, styles: [{ tag, css }], scriptTag, script }.
export async function loadInputs(read) {
  const folder = folderOf(PAGE);
  const page = (await read(PAGE, 'text')).replace(/\r\n?/g, '\n');
  const links = Array.from(page.matchAll(STYLE_LINK));
  const scripts = Array.from(page.matchAll(SCRIPT_TAG));
  if (links.length === 0) throw new LinkError(PAGE + ' has no <link rel="stylesheet" href="…"> in the form the assembler reads.');
  if (scripts.length !== 1 || folder + scripts[0][1] !== ENTRY) throw new LinkError(PAGE + ' needs exactly one <script type="module" src="…"></script>, for ' + ENTRY + '.');
  const rest = page.replace(STYLE_LINK, '').replace(SCRIPT_TAG, '');
  for (const match of rest.matchAll(/\b(?:src|href|action|poster|srcset)\s*=\s*["']?([^"'\s>]*)/gi)) {
    if (!match[1].startsWith('data:') && !match[1].startsWith('#')) throw new LinkError(PAGE + ' points at ' + match[1] + '; a published file can ask for nothing.');
  }
  if (page.includes('id="' + DATA_ELEMENT_ID + '"')) throw new LinkError(PAGE + ' already has an element with the id ' + DATA_ELEMENT_ID + '.');

  const styles = [];
  for (const match of links) {
    const name = folder + match[1];
    const css = await read(name, 'text');
    const fonts = {};
    for (const file of fontsOf(css)) fonts[file] = await read('fonts/' + file, 'bytes');
    styles.push({ tag: match[0], css: inlineStyles(name, css, fonts) });
  }

  const modules = [];
  for (const id of MODULES) modules.push({ id, source: await read(id, 'text') });
  const script = link(modules, ENTRY);
  return { page, styles, scriptTag: scripts[0][0], script };
}

// The document. `data` undefined or null gives the one with no data in it,
// which the preview frame loads and feeds by message.
export function buildDocument(inputs, data) {
  let page = inputs.page;
  for (const style of inputs.styles) {
    if (!page.includes(style.tag)) throw new LinkError('The page lost a stylesheet link it had when it was read.');
    page = page.split(style.tag).join('<style>\n' + style.css + '</style>');
  }
  const inline = data === undefined || data === null ? '' : '<script type="application/json" id="' + DATA_ELEMENT_ID + '">' + encodeData(data) + '</' + 'script>\n';
  return page.split(inputs.scriptTag).join(inline + '<script type="module">\n' + inputs.script + '</' + 'script>');
}

const kept = new WeakMap();

// The inputs for a reader, read once.
export function inputsFor(read) {
  if (!kept.has(read)) {
    const loading = loadInputs(read);
    kept.set(read, loading);
    loading.catch(() => kept.delete(read));
  }
  return kept.get(read);
}

// assemble(read, data) → the text of one self-contained document.
export async function assemble(read, data) {
  return buildDocument(await inputsFor(read), data);
}

let ownFiles = null;

// The reader the planner uses: its own files, from its own address, and
// nothing else. The same function is returned every time, so the inputs are
// asked for once however often a file is published.
export function pageReader() {
  if (ownFiles) return ownFiles;
  const root = new URL('../../', import.meta.url);
  ownFiles = async function read(path, kind) {
    const address = new URL(path, root);
    if (address.origin !== root.origin || !address.href.startsWith(root.href)) throw new LinkError(path + ' is outside the tool\'s own folder.');
    const response = await fetch(address);
    if (!response.ok) throw new LinkError('The staff browser\'s file ' + path + ' could not be loaded (' + response.status + '). Check the connection and try again; nothing was published.');
    return kind === 'bytes' ? new Uint8Array(await response.arrayBuffer()) : response.text();
  };
  return ownFiles;
}

// ---------------------------------------------------------------- the preview

function originOf(win) {
  return win.location.origin;
}

// The planner's side of the preview (ARCHITECTURE 8): answer the frame's
// "ready" with the data, and send it again whenever asked. Both sides check
// who is talking: only this frame's window, only this page's own origin.
//
//   const feed = feedPreview(window, iframe, () => data);
//   feed.send();   after the project changed
//   feed.stop();
export function feedPreview(win, frame, getData) {
  const own = originOf(win);
  const target = own === 'null' ? '*' : own;
  let ready = false;
  const send = () => {
    if (!ready || !frame.contentWindow) return false;
    frame.contentWindow.postMessage({ type: PREVIEW_DATA, data: getData() }, target);
    return true;
  };
  const listen = (event) => {
    if (event.source !== frame.contentWindow || event.origin !== own) return;
    if (!event.data || event.data.type !== PREVIEW_READY) return;
    ready = true;
    send();
  };
  win.addEventListener('message', listen);
  return {
    send,
    stop() {
      win.removeEventListener('message', listen);
    },
  };
}
