// HTML validity over every built page. Run from anywhere:
//   node Numina/test/a11y/html.mjs
// Exits non-zero on any message (repo convention, #13).
//
// It lives beside axe.mjs and runs in the same CI job because it wants the same
// thing axe wants and nothing else in the build can give: a reading of the
// finished document. It needs no browser, which is why it is a 28 MB install
// rather than a 300 MB one, and it reads the committed output — the same files
// the host serves.
//
// Why this is worth a check rather than a glance. The markdown that became this
// site is converted rulebook text with `html: true` set on markdown-it, so a
// literal angle bracket in the book is an HTML tag on the page. Three places had
// one when this check was written and all three were losing text a player needs:
// the Search verbal is literally `Search for <Item Type>` and the page showed
// `Search for ` followed by nothing, with the rest of the paragraph swallowed
// into a phantom <Item> element; the Weapon Construction chapter's two
// `<To Be Inserted Later>` placeholders rendered as empty <To> elements; and the
// Diagnose skill's `'Diagnose <Trait>'` lost both calls it names. Nothing else
// would have caught any of them. A browser parses all of it without complaint,
// axe audits what the parse produced rather than what the author wrote, and the
// text is present in the source file, so a search of src/ finds it.
//
// What is switched off below is code style, not validity: where the doctype's
// case lands, whether a boolean attribute is written `defer` or `defer=""`, and
// trailing whitespace are all decisions of the template engine that wrote the
// file, not of anyone who could act on the message. 3,096 of the 3,709 messages
// on the first run were trailing whitespace inside Nunjucks output.
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { HtmlValidate } from "html-validate";

const here = dirname(fileURLToPath(import.meta.url));
const numina = resolve(here, "..", "..");

// Where the built pages are. pagefind/ is a third party's output and none of it
// is a page; source-material/ is the converted book's provenance, not the site.
const PAGE_DIRS = ["lore", "mechanics", "new-to-numina", "search"];

const config = {
  extends: ["html-validate:recommended"],
  rules: {
    // Style, and all of it the template engine's hand rather than an author's.
    "doctype-style": "off",
    "attribute-boolean-style": "off",
    "attribute-empty-style": "off",
    "no-trailing-whitespace": "off",
    // markdown-it-anchor slugs a heading with encodeURIComponent, so "Q: Can I
    // play a villain?" becomes id="q%3A-can-i-play-a-villain%3F". HTML5 allows
    // any id with no whitespace in it, which `relaxed` is the setting for; the
    // default rule is stricter than the spec. These ids are also a published
    // interface — they are the fragments players cite — so the answer to 223 of
    // them is not a new slugify (#327).
    "valid-id": ["error", { relaxed: true }],
    // H32 is a technique for forms that submit, and three of this site's four
    // forms never do: the builder, the packet picker and the all-skills filter
    // are groups of controls a script reads, and two of them already call
    // preventDefault on submit. A submit button on any of them would be a
    // button that does nothing. Turning the rule off is not dropping its one
    // real finding — the header search form, the only form here with an action,
    // had no submit button on all 58 pages and now has one, and test/smoke.mjs
    // is what holds it there (#328).
    "wcag/h32": "off",
  },
};

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

const files = [join(numina, "index.html")].filter(exists);
for (const dir of PAGE_DIRS) {
  const p = join(numina, dir);
  if (exists(p)) files.push(...walk(p));
}

if (files.length < 50) {
  console.error(`FAIL  only ${files.length} built pages found — run \`npm run build\` in Numina/ first`);
  process.exit(1);
}

const validator = new HtmlValidate(config);
let failures = 0;
for (const file of files) {
  const report = await validator.validateFile(file);
  if (report.valid) continue;
  for (const result of report.results) {
    for (const message of result.messages) {
      failures++;
      console.error(
        `FAIL  ${relative(numina, file)}:${message.line}:${message.column}  ${message.ruleId}  ${message.message}`
      );
    }
  }
}

if (failures) {
  console.error(`\n${failures} HTML validity problem${failures === 1 ? "" : "s"} in ${files.length} pages`);
  process.exit(1);
}
console.log(`  ok  ${files.length} built pages are valid HTML`);
