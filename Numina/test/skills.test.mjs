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
//   - the totals (189 skills, 29 tables, 9 aspects, 20 foundations, 16
//     cultures, 6 attribute rows, 22 hidden) so a table dropped by a bad merge
//     fails instead of shrinking;
//   - the two heading-derived lists: nine Aspects and twenty Foundations, each
//     Foundation's Type naming a skill table that exists.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extract, serialize, OUTPUT } from "../tools/extract-skills.mjs";
import { skillAnchors } from "../tools/skill-anchors.mjs";

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
ok(data.aspects.length === 9, `9 Aspects (${data.aspects.length})`);
ok(data.foundations.length === 20, `20 Foundations (${data.foundations.length})`);
ok(data.tables.reduce((n, t) => n + t.rows, 0) === data.skills.length, "table row counts sum to the skill count");

// The Aspect and Foundation lists come from `###` headings, not table rows, so
// nothing above counts them. What is worth pinning is the shape a build reads:
// every Aspect has the presentation paragraph a player has to wear, and every
// Foundation's Type names a skill table that exists with skills in it.
console.log("# aspects and foundations");
const TYPES = new Set(["Place", "Specialty", "Resource", "Interaction"]);
const thinAspect = data.aspects.filter((a) => !a.name || !a.presentation);
ok(thinAspect.length === 0, `every Aspect has a name and a presentation paragraph${thinAspect.length ? `: ${thinAspect.map((a) => a.id).join(", ")}` : ""}`);
// Seven of the nine prefix that paragraph with "Makeup / Costume
// Requirements:" and Plant and Shade do not. Pinned because the difference is
// in the book, not in the parser.
const prefixed = data.aspects.filter((a) => a.costumeRequirement).length;
ok(prefixed === 7, `7 of the 9 Aspects label their paragraph a costume requirement (${prefixed})`);
const badType = data.foundations.filter((f) => !TYPES.has(f.type) || f.skillGroup !== `${f.type} Skills` || !f.detail);
ok(badType.length === 0, `every Foundation has one of the four Types, its skill table and its detail${badType.length ? `: ${badType.map((f) => f.id).join(", ")}` : ""}`);
const foundationGroups = new Set(data.tables.filter((t) => t.groupKind === "Foundation type").map((t) => t.group));
const orphanType = data.foundations.filter((f) => !foundationGroups.has(f.skillGroup));
ok(orphanType.length === 0, `every Foundation's Type names a table that exists${orphanType.length ? `: ${orphanType.map((f) => `${f.name} → ${f.skillGroup}`).join(", ")}` : ` (${foundationGroups.size} tables)`}`);
const typeCounts = [...TYPES].map((t) => data.foundations.filter((f) => f.type === t).length);
ok(typeCounts.every((n) => n > 0), `all four Types are used: ${[...TYPES].map((t, i) => `${t} ${typeCounts[i]}`).join(", ")}`);
// Ids are unique within each list, and only within it: "Arcane" is both an
// Aspect and a Foundation, which is why these two are not in the flat id
// check below.
for (const [label, records] of [["aspects", data.aspects], ["foundations", data.foundations]]) {
  const seen = records.map((r) => r.id);
  ok(new Set(seen).size === seen.length, `${label} ids unique within the list (${seen.length})`);
}
ok(
  data.aspects.some((a) => a.id === "arcane") && data.foundations.some((f) => f.id === "arcane"),
  "arcane is both an Aspect and a Foundation, so the two lists are keyed separately"
);

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
const everything = [...data.skills, ...data.cultures, ...data.attributes, ...data.hidden, ...data.currency, ...data.tables, ...data.aspects, ...data.foundations];
const badSource = [];
for (const r of everything) {
  const m = r.source?.match(/^(\/mechanics\/skills\/(?:[a-z-]+\/)?)#(.+)$/);
  if (!m) { badSource.push(`${r.id ?? r.group}: ${r.source}`); continue; }
  let has = false;
  try { has = pageIds(m[1]).has(m[2]); } catch { has = false; }
  if (!has) badSource.push(`${r.id ?? r.group}: ${r.source}`);
}
ok(badSource.length === 0, `every source anchor exists in the built HTML (${everything.length} checked)${badSource.length ? `:\n      ${badSource.slice(0, 10).join("\n      ")}` : ""}`);

// Every skill's own anchor, the one the All Skills index and any pasted link
// point at. The build throws if a record has no row to put an anchor on; this
// is the other direction — the committed HTML actually carries the id, on the
// page the record says it is on, and the four repeated names resolve to four
// different rows rather than collapsing onto one.
console.log("# skill anchors");
const anchors = skillAnchors(data.skills);
const badAnchor = [];
for (const skill of data.skills) {
  const page = skill.source.split("#")[0];
  let has = false;
  try { has = pageIds(page).has(anchors.get(skill.id)); } catch { has = false; }
  if (!has) badAnchor.push(`${skill.id} → ${page}#${anchors.get(skill.id)}`);
}
ok(badAnchor.length === 0, `every skill anchor is an id in the built HTML (${data.skills.length})${badAnchor.length ? `:\n      ${badAnchor.slice(0, 10).join("\n      ")}` : ""}`);
const pairs = new Set(data.skills.map((s) => `${s.source.split("#")[0]}#${anchors.get(s.id)}`));
ok(
  pairs.size === data.skills.length,
  `no two skills on a page share an anchor (${pairs.size} distinct page+anchor pairs for ${data.skills.length} skills)`
);
const holdings = data.skills.filter((s) => s.name === "Holding").map((s) => anchors.get(s.id));
ok(new Set(holdings).size === 4, `the four Foundations' Holdings get four anchors: ${holdings.join(", ")}`);

// The All Skills index lists all of them, each linked to its own anchor.
const indexHtml = readFileSync(join(root, "mechanics", "skills", "all-skills", "index.html"), "utf8");
const rows = [...indexHtml.matchAll(/<tr data-group="[^"]*"[\s\S]*?<a href="([^"]+)">/g)].map((m) => m[1]);
ok(rows.length === data.skills.length, `All Skills lists every skill (${rows.length} rows, ${data.skills.length} records)`);
const missingRow = data.skills.filter(
  (s) => !rows.includes(`/Numina${s.source.split("#")[0]}#${anchors.get(s.id)}`)
);
ok(missingRow.length === 0, `every All Skills row links its own anchor${missingRow.length ? `: ${missingRow.slice(0, 5).map((s) => s.id).join(", ")}` : ""}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
