// mjs-guard.mjs — finds places where a browser is told to load a `.mjs` file.
//
// Why: the live server (nginx) answers `.mjs` with `application/octet-stream`,
// and a browser refuses to run a module script with that type. CI serves the
// same files with a correct type, so nothing there can see it. Orbital's
// "Begin flight" and two archived tools were dead on the live site for this
// reason (TG-57, TG-58). Until the server maps `.mjs`, a file the browser
// loads must be `.js` (it stays an ES module; Node reads a typeless `.js`
// that has `import`/`export` as one, or a package.json says "type":"module").
//
// `.mjs` is still fine for Node-only files (tests, board-check itself). The
// rule is only about what a page or a browser module reaches:
//   - `<script src="...mjs">` and `<link rel="modulepreload" href="...mjs">`
//   - a static `import ... from '...mjs'`, `import '...mjs'`, `export ... from
//     '...mjs'` or a dynamic `import('...mjs')`, in an inline `<script>` of an
//     .html or in any `.js` file (a `.mjs` that imports a `.mjs` is Node's
//     business, unless a page loads it, and the page's tag is already caught)
//   - `new Worker('...mjs')`, `serviceWorker.register('...mjs')`
//
// Exported for check-integrity.mjs, which also runs selfTest() so a detector
// that stopped detecting is itself a failure.

const MJS = String.raw`[^"'\`\s]+?\.mjs(?:[?#][^"'\`\s]*)?`;
const Q = String.raw`["']`;

const TAGS = new RegExp(
  String.raw`<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*${Q}${MJS}${Q}[^>]*>`, 'gi');
// "from '...mjs'" covers import and export-from, multi-line included;
// bare `import '...mjs'` and `import('...mjs')` are the other two shapes.
const MODULE_REFS = new RegExp(
  [String.raw`\bfrom\s*${Q}${MJS}${Q}`,
   String.raw`\bimport\s*${Q}${MJS}${Q}`,
   String.raw`\bimport\s*\(\s*${Q}${MJS}${Q}\s*\)`,
   String.raw`\bnew\s+(?:Shared)?Worker\(\s*${Q}${MJS}${Q}`,
   String.raw`\.register\(\s*${Q}${MJS}${Q}`].join('|'), 'g');

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

// -> [{ line, text }]. `kind` is 'html' or 'js'.
export function findBrowserMjs(kind, src) {
  const hits = [];
  if (kind === 'html') {
    for (const m of src.matchAll(TAGS)) hits.push({ line: lineOf(src, m.index), text: m[0].slice(0, 100) });
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const base = m.index + m[0].indexOf(m[1]);
      for (const r of m[1].matchAll(MODULE_REFS)) hits.push({ line: lineOf(src, base + r.index), text: r[0].slice(0, 100) });
    }
  } else {
    for (const r of src.matchAll(MODULE_REFS)) hits.push({ line: lineOf(src, r.index), text: r[0].slice(0, 100) });
  }
  return hits;
}

// Cases the detector must flag, and cases it must leave alone. Returns a list
// of problems (empty when the detector works).
export function selfTest() {
  const flagged = [
    ['html', '<script type="module" src="js/save.mjs"></script>'],
    ['html', "<script src='a/b.mjs?v=2' defer></script>"],
    ['html', '<link rel="modulepreload" href="x.mjs">'],
    ['html', "<script type=\"module\">\nimport {a} from './grade-math.mjs';\n</script>"],
    ['html', "<script type=\"module\">\nimport {\n a,\n b\n} from './seating.mjs';\n</script>"],
    ['html', "<script type=\"module\">const m = await import('./x.mjs');</script>"],
    ['js', "import './side.mjs';"],
    ['js', "export * from './re.mjs';"],
    ['js', 'const w = new Worker("w.mjs");'],
    ['js', "navigator.serviceWorker.register('/sw.mjs');"]
  ];
  const clean = [
    ['html', '<script type="module" src="js/save.js"></script>'],
    ['html', '<script>var s = "see test.mjs for the node side";</script>'],
    ['html', '<a href="notes.mjs">source</a>'],
    ['html', "<script type=\"module\">import {a} from './a.js';</script>"],
    ['js', "// node test.mjs runs this\nimport x from './x.js';"],
    ['js', "const t = 'foo.mjs';"]
  ];
  const problems = [];
  for (const [k, s] of flagged) if (!findBrowserMjs(k, s).length) problems.push(`missed: ${JSON.stringify(s).slice(0, 80)}`);
  for (const [k, s] of clean) if (findBrowserMjs(k, s).length) problems.push(`false hit: ${JSON.stringify(s).slice(0, 80)}`);
  return problems;
}
