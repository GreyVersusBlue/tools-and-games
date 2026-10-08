// Shared by the publish tests and the staff browser's browser test: a reader
// for the assembler that takes the tool's files from disk, and counts what it
// was asked for. Not a suite.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function toolFile(name) {
  return path.join(TOOL_DIR, ...name.split('/'));
}

export function readTool(name) {
  return readFileSync(toolFile(name), 'utf8');
}

// diskReader() → read(path, kind), with read.asked: every path it was asked for.
export function diskReader() {
  const asked = [];
  const read = async (name, kind) => {
    asked.push(name);
    const bytes = readFileSync(toolFile(name));
    return kind === 'bytes' ? new Uint8Array(bytes) : bytes.toString('utf8');
  };
  read.asked = asked;
  return read;
}

// A reader over an object of { path: text }, for modules written in a test.
export function memoryReader(files) {
  return async (name) => {
    if (!(name in files)) throw new Error('no file ' + name);
    return files[name];
  };
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// The parts of an assembled document.
export function partsOf(html) {
  const scriptOpen = '<script type="module">\n';
  const from = html.indexOf(scriptOpen);
  const to = html.lastIndexOf('</script>');
  const styleFrom = html.indexOf('<style>\n');
  const styleTo = html.indexOf('</style>');
  const dataOpen = '<script type="application/json" id="sv2-published">';
  const dataFrom = html.indexOf(dataOpen);
  return {
    script: from === -1 ? null : html.slice(from + scriptOpen.length, to),
    style: styleFrom === -1 ? null : html.slice(styleFrom + '<style>\n'.length, styleTo),
    data: dataFrom === -1 ? null : html.slice(dataFrom + dataOpen.length, html.indexOf('</script>', dataFrom)),
  };
}
