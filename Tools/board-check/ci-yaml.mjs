// ci-yaml.mjs — a reader for the YAML shapes .github/workflows/*.yml use, and
// nothing else. ci-touched.mjs is its only caller.
//
// Why not a package: Tools/board-check depends on no YAML library, the one in
// Numina/node_modules is Numina's own (locked #17, nothing is shared across
// projects), and the workflow files here stay inside a small subset: block
// maps, block sequences, flow lists like `[main]`, quoted and plain scalars,
// `|` block scalars, `#` comments. Anything outside that subset throws with a
// line number rather than being read wrongly, and ci-touched.test.mjs parses
// every workflow file in the repo so a new shape fails there first.
//
// Values come back as strings, numbers, booleans (true/false only, so the
// `on:` key stays the string "on"), arrays and plain objects.

const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s'"#\-\[{][^:]*?|-[^\s:][^:]*?):(?:\s+(.*))?$/;

export function parseYaml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(raw => ({ raw }));
  lines.forEach((l, i) => { l.no = i + 1; l.indent = l.raw.match(/^ */)[0].length; l.body = l.raw.trim(); });
  let at = 0;

  const fail = (l, msg) => { throw new Error(`workflow YAML line ${l ? l.no : 'end'}: ${msg}`); };
  const isBlank = l => l.body === '' || l.body.startsWith('#');
  const skipBlank = () => { while (at < lines.length && isBlank(lines[at])) at++; };

  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") { if (i === 0 || /[\s\[,{]/.test(s[i - 1])) q = c; }
      else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s.trimEnd();
  }

  function scalar(s, l) {
    s = stripComment(s.trim());
    if (s === '') return null;
    if (s[0] === '"') {
      if (!s.endsWith('"') || s.length < 2) fail(l, `unterminated string: ${s}`);
      return s.slice(1, -1).replace(/\\(["\\\/nt])/g, (_, c) => ({ n: '\n', t: '\t' }[c] || c));
    }
    if (s[0] === "'") {
      if (!s.endsWith("'") || s.length < 2) fail(l, `unterminated string: ${s}`);
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s[0] === '[') {
      if (!s.endsWith(']')) fail(l, `flow list must close on its own line: ${s}`);
      const inner = s.slice(1, -1).trim();
      if (inner === '') return [];
      return inner.split(',').map(x => scalar(x, l));
    }
    if (s[0] === '{' || s[0] === '&' || s[0] === '*' || s[0] === '!' || s[0] === '>') fail(l, `unsupported YAML: ${s}`);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  function blockScalar(l, head) {
    const strip = /-/.test(head);
    const keep = /\+/.test(head);
    const parent = l.indent;
    const out = [];
    let indent = -1;
    at++;
    while (at < lines.length) {
      const n = lines[at];
      if (n.body === '') { out.push(''); at++; continue; }
      if (n.indent <= parent) break;
      if (indent < 0) indent = n.indent;
      if (n.indent < indent) break;
      out.push(n.raw.slice(indent));
      at++;
    }
    while (out.length && out[out.length - 1] === '' && !keep) out.pop();
    return out.join('\n') + (strip || out.length === 0 ? '' : '\n');
  }

  function block(minIndent) {
    skipBlank();
    if (at >= lines.length) return null;
    const l = lines[at];
    if (l.indent < minIndent) return null;
    return /^-(\s|$)/.test(l.body) ? sequence(l.indent) : mapping(l.indent);
  }

  function sequence(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      const l = lines[at];
      if (!l || l.indent !== indent || !/^-(\s|$)/.test(l.body)) break;
      const rest = l.body.slice(1).trim();
      if (rest === '' || rest.startsWith('#')) { at++; out.push(block(indent + 1)); continue; }
      if (KEY.test(stripComment(rest))) {
        // "- key: value": re-read the rest of the line as the first key of a map
        // sitting two columns in (after "- ").
        const col = l.raw.indexOf(rest, indent + 1);
        lines[at] = { ...l, raw: ' '.repeat(col) + rest, indent: col, body: rest };
        out.push(mapping(col));
      } else {
        at++;
        out.push(scalar(rest, l));
      }
    }
    return out;
  }

  function mapping(indent) {
    const out = {};
    for (;;) {
      skipBlank();
      const l = lines[at];
      if (!l || l.indent !== indent) break;
      if (/^-(\s|$)/.test(l.body)) break;
      const m = KEY.exec(stripComment(l.body));
      if (!m) fail(l, `cannot read this line as "key: value": ${l.body}`);
      let key = m[1];
      if (key[0] === '"' || key[0] === "'") key = scalar(key, l);
      const rest = (m[2] || '').trim();
      if (key in out) fail(l, `duplicate key ${key}`);
      if (/^[|>][-+]?$/.test(rest)) {
        if (rest[0] === '>') fail(l, 'folded block scalars (>) are not supported');
        out[key] = blockScalar(l, rest);
      } else if (rest === '' || rest.startsWith('#')) {
        at++;
        skipBlank();
        const n = lines[at];
        if (n && n.indent > indent) out[key] = block(indent + 1);
        else if (n && n.indent === indent && /^-(\s|$)/.test(n.body)) out[key] = sequence(indent);
        else out[key] = null;
      } else {
        at++;
        out[key] = scalar(rest, l);
        const n = lines[at];
        if (n && !isBlank(n) && n.indent > indent) fail(n, 'a plain scalar continued on the next line is not supported');
      }
    }
    return out;
  }

  const doc = block(0);
  skipBlank();
  if (at < lines.length) fail(lines[at], `unexpected content: ${lines[at].body}`);
  return doc;
}
