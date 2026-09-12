// Checks on src/_data/skills.json, the record of the rulebook's skill tables.
// Run from anywhere: node Numina/test/skills.test.mjs. Exits non-zero on any
// failure (repo convention). Wired into `npm test` after smoke.mjs.
//
// What it pins, and why each pin exists:
//   - the committed JSON is byte-for-byte what tools/extract-skills.mjs
//     produces today, so a chapter edit without a re-run fails here the way a
//     src/ edit without a rebuild fails CI;
//   - every pipe-table row in the chapter markdown is in the JSON exactly once,
//     counted here by a rule that knows nothing about headers or shapes;
//   - every `source` anchor is an id the built HTML actually emits;
//   - ids are unique, and a handful are pinned literally so a change to the
//     slug rule is a visible break, not a silent re-key of every record;
//   - the totals (189 skills, 29 tables, 16 cultures, 6 attribute rows, 22
//     hidden) so a table dropped by a bad merge fails instead of shrinking.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extract, serialize, OUTPUT } from "../tools/extract-skills.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(root, "src", "mechanics", "skills");

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}

console.log("# skills.json");
const committed = readFileSync(OUTPUT, "utf8");
const data = JSON.parse(committed);
const fresh = serialize(extract());
ok(committed === fresh, "committed skills.json matches a fresh extraction (else: node tools/extract-skills.mjs)");

// Every table row, once. The count below is independent of the extractor: a
// pipe line is a row unless it is a header (the line before a separator) or
// the separator itself. It knows nothing about column shapes, so a table the
// extractor silently skipped, or a row it swallowed, shows up as a mismatch.
let sourceRows = 0;
for (const file of readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"))) {
  const lines = readFileSync(join(SKILLS_DIR, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const isSeparator = /^\|\s*:?-{3,}/.test(lines[i]);
    const isHeader = /^\|\s*:?-{3,}/.test(lines[i + 1] ?? "");
    if (!isSeparator && !isHeader) sourceRows++;
  }
}
const records = data.skills.length + data.cultures.length + data.attributes.length + data.hidden.length + data.currency.length;
ok(records === sourceRows, `every source table row is a record exactly once (${records} records, ${sourceRows} rows in the markdown)`);

// Totals, pinned. Update these when the rulebook changes, in the same commit
// as the JSON diff that explains them.
ok(data.skills.length === 189, `189 skills (${data.skills.length})`);
ok(data.tables.length === 29, `29 skill tables (${data.tables.length})`);
ok(data.cultures.length === 16, `16 cultures (${data.cultures.length})`);
ok(data.attributes.length === 6, `6 attribute chart rows (${data.attributes.length})`);
ok(data.hidden.length === 22, `22 hidden Excellencies and Expressions (${data.hidden.length})`);
ok(data.tables.reduce((n, t) => n + t.rows, 0) === data.skills.length, "table row counts sum to the skill count");

console.log("# ids");
const ids = [...data.skills, ...data.cultures, ...data.attributes, ...data.hidden, ...data.currency].map((r) => r.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
ok(dupes.length === 0, `ids unique within their lists${dupes.length ? `: ${[...new Set(dupes)].join(", ")}` : ""}`);
const skillIds = new Set(data.skills.map((s) => s.id));
ok(skillIds.size === data.skills.length, "skill ids unique");
// Same name, different group, different id: four tables each carry "Holding".
for (const id of [
  "domains/air/airs-determination",
  "foundations/place-skills/holding",
  "foundations/interaction-skills/holding",
  "cultures/culture-skills/resource-contacts",
  "index/adventurer-skills/first-aid",
  "open-skills/open-skills/two-weapon-fighting",
  "aspects/aspects/tongue-of-aspect",
]) ok(skillIds.has(id), `stable id: ${id}`);

console.log("# shapes");
const COST_KINDS = new Set(["cp", "included", "see-description"]);
const ATTR_KINDS = new Set(["unlisted", "blank", "none", "see-description", "thread", "spend", "uses"]);
const badCost = data.skills.filter((s) => !COST_KINDS.has(s.cost.kind) || (s.cost.kind === "cp") !== Number.isInteger(s.cost.cp));
ok(badCost.length === 0, `every cost is cp/included/see-description with cp only on cp${badCost.length ? `: ${badCost.map((s) => s.id).join(", ")}` : ""}`);
const badAttr = data.skills.filter((s) => !ATTR_KINDS.has(s.attribute.kind));
ok(badAttr.length === 0, `every attribute cell has a named shape${badAttr.length ? `: ${badAttr.map((s) => s.id).join(", ")}` : ""}`);
const badSpend = data.skills.filter((s) => s.attribute.kind === "spend" && !(s.attribute.amount >= 1 && ["Prowess", "Insight", "Fortitude"].includes(s.attribute.name)));
ok(badSpend.length === 0, "every spend names Prowess, Insight or Fortitude with an amount ≥ 1");
const numericCp = data.skills.filter((s) => s.cost.kind === "cp").length;
ok(numericCp === 157, `157 skills carry a numeric CP cost (${numericCp}); 30 Included, 2 See Description`);
const empty = data.skills.filter((s) => !s.name || !s.description || !s.group || !s.groupKind);
ok(empty.length === 0, `no record with an empty name, description or group${empty.length ? `: ${empty.map((s) => s.id).join(", ")}` : ""}`);
ok(data.skills.every((s) => typeof s.thread === "boolean"), "thread is a boolean on every skill");
ok(data.attributes.every((a) => ["cp", "none", "unpublished"].includes(a.costToIncrease.kind)), "attribute chart costs are cp/none/unpublished");
ok(data.hidden.every((h) => (h.kind === "Expression") === (h.elements.length === 0)), "hidden Expressions have no elements; hidden Excellencies have at least one");

// Every source anchor resolves to an id the built page emits. Read from the
// committed build, the same thing smoke.mjs checks and Firebase serves.
console.log("# sources");
const idsByPage = new Map();
function pageIds(url) {
  if (!idsByPage.has(url)) {
    const html = readFileSync(join(root, url.slice(1), "index.html"), "utf8");
    idsByPage.set(url, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsByPage.get(url);
}
const everything = [...data.skills, ...data.cultures, ...data.attributes, ...data.hidden, ...data.currency, ...data.tables];
const badSource = [];
for (const r of everything) {
  const m = r.source?.match(/^(\/mechanics\/skills\/(?:[a-z-]+\/)?)#(.+)$/);
  if (!m) { badSource.push(`${r.id ?? r.group}: ${r.source}`); continue; }
  let has = false;
  try { has = pageIds(m[1]).has(m[2]); } catch { has = false; }
  if (!has) badSource.push(`${r.id ?? r.group}: ${r.source}`);
}
ok(badSource.length === 0, `every source anchor exists in the built HTML (${everything.length} checked)${badSource.length ? `:\n      ${badSource.slice(0, 10).join("\n      ")}` : ""}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
