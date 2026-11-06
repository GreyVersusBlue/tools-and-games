// link-guard.mjs — finds relative <a href> targets that do not exist.
//
// Why: Pathfinder's campaigns.html and characters.html each linked "Back to
// greyversusblue.com" to Pathfinder/index.html, a page that never existed, and
// every check here passed because check-integrity.mjs scans <a> for nothing
// (offsite sweep: an <a href> is a navigation, not a request). That reasoning
// is right for offsite hosts and wrong for local files: a local <a> that
// resolves to nothing is a 404 the visitor clicks into (TG-60, 2026-11-04).
//
// This resolver is deliberately narrow, because it was broken once before (#34:
// a guard that has never been seen to fail is not a guard). It is exported to
// check-integrity.mjs together with selfTest(), which feeds it a tree of
// fixtures, one good and one bad case per rule, on every run.
//
// What is resolved: every <a ... href="..."> (and <area>) in an .html, with
//   - ?query and #fragment stripped, %20 and friends decoded;
//   - a leading / meaning the site root, anything else relative to the page;
//   - a directory resolving to its index.html (a directory with none is broken);
// What is skipped: http(s):, mailto:, tel:, javascript:, data:, blob: and any
// other scheme, protocol-relative //host, a pure #fragment, an empty href,
// anything with a template placeholder (${...}, {{...}}, <%...%>) that this
// check cannot know at rest, and anything inside an HTML comment.
//
// Exemptions live in EXEMPT below, as `page -> [href, ...]`, each with a
// reason. An exemption that is not checked is a blind spot, so check-integrity
// fails an exemption whose link is no longer present on that page (it was
// fixed or removed: delete the line).

import path from 'node:path';

export const EXEMPT = {
  // 'Dir/page.html': { 'href as written': 'why this may point at nothing' },
};

const A_TAG = /<(?:a|area)\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
const SKIP_SCHEME = /^[a-z][a-z0-9+.-]*:/i;          // http:, mailto:, tel:, javascript:, data:, ...
const PLACEHOLDER = /\$\{|\{\{|\{%|<%|%7B%7B/i;

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

// Blank out comments without moving any character, so line numbers hold.
const blankComments = src =>
  src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));

// -> the path to test, or null when the href is not this check's business.
export function localTarget(pageAbs, siteRoot, href) {
  href = href.trim();
  if (!href || href.startsWith('#') || href.startsWith('//')) return null;
  if (SKIP_SCHEME.test(href) || PLACEHOLDER.test(href)) return null;
  const clean = href.split(/[?#]/)[0];
  if (!clean) return null;
  let dec;
  try { dec = decodeURIComponent(clean); } catch { dec = clean; }
  return dec.startsWith('/')
    ? path.join(siteRoot, dec)
    : path.resolve(path.dirname(pageAbs), dec);
}

// `fsx` is { exists(p), isDir(p) } so selfTest can run on an in-memory tree.
// -> [{ line, href, why }]
export function findBrokenLinks(pageAbs, siteRoot, src, fsx) {
  const out = [];
  const text = blankComments(src);
  for (const m of text.matchAll(A_TAG)) {
    const href = m[1] ?? m[2];
    const target = localTarget(pageAbs, siteRoot, href);
    if (target === null) continue;
    if (!target.startsWith(siteRoot)) { out.push({ line: lineOf(src, m.index), href, why: 'leaves the site root' }); continue; }
    if (!fsx.exists(target)) { out.push({ line: lineOf(src, m.index), href, why: 'no such file' }); continue; }
    if (fsx.isDir(target) && !fsx.exists(path.join(target, 'index.html'))) {
      out.push({ line: lineOf(src, m.index), href, why: 'directory has no index.html' });
    }
  }
  return out;
}

// Fixture tree: a site at /s with a handful of files. Every rule gets a case
// that must be flagged and one that must pass. -> [problem strings], empty if
// the resolver behaves.
export function selfTest() {
  const root = path.resolve('/s');
  const files = new Set(['a/page.html', 'a/b c.html', 'index.html', 'a/sub/index.html', 'a/x.pdf'].map(f => path.join(root, f)));
  const dirs = new Set([root, path.join(root, 'a'), path.join(root, 'a/sub'), path.join(root, 'a/empty')]);
  const fsx = {
    exists: p => files.has(p) || dirs.has(p),
    isDir: p => dirs.has(p),
  };
  const page = path.join(root, 'a/page.html');
  const run = html => findBrokenLinks(page, root, html, fsx);
  const a = href => `<a class="x" href="${href}">t</a>`;
  const problems = [];
  const expect = (label, html, want) => {
    const got = run(html).length;
    if (got !== want) problems.push(`${label}: wanted ${want} broken, got ${got}`);
  };

  expect('missing sibling is flagged', a('missing.html'), 1);
  expect('present sibling passes', a('x.pdf'), 0);
  expect('../ climb to a real page passes', a('../index.html'), 0);
  expect('../ climb to a missing page is flagged', a('../nope.html'), 1);
  expect('root-absolute real page passes', a('/index.html'), 0);
  expect('root-absolute missing page is flagged', a('/a/none.html'), 1);
  expect('query and fragment are stripped', a('x.pdf?v=2#p3'), 0);
  expect('query on a missing file is still flagged', a('missing.html?v=2'), 1);
  expect('%20 decodes', a('b%20c.html'), 0);
  expect('directory with index.html passes', a('sub/'), 0);
  expect('directory without a trailing slash passes', a('sub'), 0);
  expect('directory without index.html is flagged', a('empty/'), 1);
  expect('a climb out of the site is flagged', a('../../etc/passwd'), 1);
  expect('single-quoted href is read', `<a href='missing.html'>t</a>`, 1);
  expect('<area href> is read', `<area href="missing.html">`, 1);
  for (const skip of ['https://x.example/nope', 'http://x.example/', 'mailto:a@b.c', 'tel:555', 'javascript:void(0)',
    'data:text/plain,hi', '//cdn.example/x', '#top', '', '?x=1', '${base}/x.html', '{{ url }}'])
    expect(`skips ${JSON.stringify(skip)}`, a(skip), 0);
  expect('a commented-out link is ignored', `<!-- ${a('missing.html')} -->`, 0);
  expect('a link after a comment still counts', `<!-- c -->\n${a('missing.html')}`, 1);
  const hit = run(`<p>x</p>\n\n${a('missing.html')}`)[0];
  if (!hit || hit.line !== 3) problems.push(`line number: wanted 3, got ${hit && hit.line}`);
  return problems;
}
