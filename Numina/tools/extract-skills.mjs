// Turns the skill tables in src/mechanics/skills/*.md into src/_data/skills.json.
//
//   node tools/extract-skills.mjs          # rewrite src/_data/skills.json
//   node tools/extract-skills.mjs --check  # exit 1 if the committed file is stale
//
// Re-runnable and deterministic: sorted object keys, no timestamps, records in
// document order. A rulebook version bump is "replace the chapter markdown,
// re-run this, read the JSON diff" (CONTENT-GUIDE.md, "Skill data").
//
// The rule that shapes everything below: a cell the extractor has not been told
// about is an error, never a zero. `Included`, `See Description`, `Thread Skill`
// and `1x / Short Rest` all sit in columns whose header says "Cost" or
// "Attribute", and a parser that coerced them would produce a number that looks
// right and is wrong forever. Every non-numeric shape is modelled by name, and
// anything else throws with the file, line and cell that caused it.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(root, "src", "mechanics", "skills");
export const OUTPUT = join(root, "src", "_data", "skills.json");

// The rulebook these tables were converted from (CONTENT-GUIDE.md, chapter map).
const SOURCE_BOOK = "rules-2026-v3.51";

// What the skills in each file are grouped by. The group itself is the nearest
// heading above the table.
const GROUP_KIND = {
  "aspects": "Aspect",
  "cultures": "Culture",
  "domains": "Domain",
  "expressions": "Expression",
  "excellencies": "Excellency",
  "foundations": "Foundation type",
  "index": "Adventurer",
  "open-skills": "Open",
};

// Every table header the extractor knows. A header not in this list is an
// error: the crafting chapter's 96 formula rows are deliberately absent (a
// different shape, left for later), and so is anything a v3.52 bump adds.
const SHAPES = {
  "Skill Name|Cost|Verbal|Description": "skill",
  "Skill Name|CP Cost|Verbal|Description": "skill",
  "Skill Name|Cost|Verbal|Description|Attribute": "skill",
  // Inferno's table alone heads its Verbal column "Effect / Verbal".
  "Skill Name|Cost|Effect / Verbal|Description|Attribute": "skill",
  "Culture|Research Topic": "culture",
  "Attribute|Starting Value|Cost to Increase|Max": "attribute",
  "Name|Alignment|Primary Skill": "hidden",
  "Coin|Shape|Value": "currency",
};

const ATTRIBUTE_NAMES = ["Prowess", "Insight", "Fortitude"];

// The Aspects and Foundations a character chooses from are `###` headings, not
// table rows: each is free, each grants a set of skills that lives in a table
// somewhere else, and nothing in any table says which ones exist. A build
// cannot be checked without the lists — "up to 2 Foundation skills from your
// Foundation" needs to know that Mariner is a Place and Stargazer a Specialty.
//
// Both sections are fenced by the headings that bracket them rather than by a
// pattern, because a pattern would quietly swallow the next section's headings
// the day one is added. A heading inside the fence that does not parse throws
// with its file and line, like every other shape here.
const HEADING_LISTS = {
  aspects: { after: "Aspects", key: "aspects", until: "Aspect Armament Skills" },
  foundations: { after: "Available Foundations", key: "foundations", until: "Foundation Skills" },
};

// The four Foundation Types, each the name of the skill table its Foundations
// draw from: Type "Place" → the "Place Skills" table.
const FOUNDATION_TYPES = ["Place", "Specialty", "Resource", "Interaction"];

// markdown-it-anchor's default slugify, so `source` anchors match the ids the
// build emits. test/skills.test.mjs checks every anchor against the built HTML,
// so if the build's slugify ever changes this fails there rather than drifting.
function anchor(text) {
  return encodeURIComponent(String(text).trim().toLowerCase().replace(/\s+/g, "-"));
}

// Record ids: lowercase ASCII words joined by hyphens. "Air's Determination" →
// "airs-determination", "Resource/Contacts" → "resource-contacts".
function slug(text) {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unescapeCell(text) {
  return text.replace(/\\([<>|])/g, "$1").trim();
}

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

// --- cell shapes -----------------------------------------------------------

function parseCost(raw, where) {
  if (/^\d+$/.test(raw)) return { cp: Number(raw), kind: "cp" };
  if (/^included$/i.test(raw)) return { kind: "included" };
  if (/^see description$/i.test(raw)) return { kind: "see-description" };
  if (raw === "") fail(where, "blank Cost cell — decide what a blank cost means before it is coerced");
  fail(where, `unrecognised Cost cell ${JSON.stringify(raw)}`);
}

// The Attribute column mixes a spend ("1 Fortitude"), a flag ("This is a
// Thread Skill"), a use limit ("1x / Short Rest") and prose. Each keeps `raw`
// so the reading is auditable against the source.
function parseAttribute(raw, where) {
  if (raw === undefined) return { kind: "unlisted" }; // four-column table
  if (raw === "") return { kind: "blank", raw };
  if (/^n\/a$/i.test(raw)) return { kind: "none", raw };
  if (/^n\/a see description$/i.test(raw)) return { kind: "see-description", raw };
  if (/^(this is a )?thread skill$/i.test(raw)) return { kind: "thread", raw };
  let m = raw.match(/^(\d+) (Prowess|Insight|Fortitude)$/);
  if (m) return { amount: Number(m[1]), kind: "spend", name: m[2], raw };
  // A bare attribute name (Greater Aspect Attack: "Prowess", whose description
  // says "Spend one attribute") is read as a spend of one.
  if (ATTRIBUTE_NAMES.includes(raw)) return { amount: 1, kind: "spend", name: raw, raw };
  m = raw.match(/^(\d+)x \/ ((?:Short|Long) Rest|event)$/);
  if (m) return { count: Number(m[1]), kind: "uses", per: m[2], raw };
  // The crafting Excellencies (Alchemist, Arcaneer, Tinkerer, Poison Blade) put
  // "See Formula" where the others put a spend: the cost is coin, components
  // and/or attributes named by the item's formula, which lives in the crafting
  // chapter and is not parsed at all. It is not see-description — nothing in
  // the row's own description says what is spent.
  if (/^see formula$/i.test(raw)) return { kind: "see-formula", raw };
  // Tempest's Touch Death has no limit and no spend: it triggers when you die.
  if (/^at will$/i.test(raw)) return { kind: "at-will", raw };
  // Dervish's Strong winds: a Thread Skill whose own description says it breaks
  // the three-Thread-Skills-per-effect rule. `raw` keeps the "Extra".
  if (/^extra thread skill$/i.test(raw)) return { kind: "thread", raw };
  // Tinkerer's Just use anything spends a charge off a tinkered item.
  if (/^expend one tinkered item$/i.test(raw)) return { kind: "expend", raw };
  fail(where, `unrecognised Attribute cell ${JSON.stringify(raw)}`);
}

// "Thread Skill" in the Verbal column is a flag, not something anyone says.
function parseVerbal(raw) {
  // Dervish's Strong winds prints its N/A inside quotes. A quoted nothing is
  // still nothing, so the quotes come off before the N/A test, not after.
  const m = raw.match(/^(['"])(.*)\1$/);
  const inner = m ? m[2] : raw;
  if (inner === "" || /^n\/a$/i.test(inner)) return { thread: false, verbal: null };
  if (/^thread skill$/i.test(inner)) return { thread: true, verbal: null };
  return { thread: false, verbal: inner };
}

function parseName(raw) {
  const m = raw.match(/^(.*?)(\*+)$/);
  return m ? { footnote: m[2], name: m[1].trim() } : { name: raw };
}

// An Aspect heading is a bare name. The paragraph under it is the presentation
// requirement the player has to wear; seven of the nine prefix it with
// "Makeup / Costume Requirements:" and Plant and Shade do not, so the prefix is
// stripped where it appears and `costumeRequirement` records which form the
// book used rather than pretending they are the same shape.
function parseAspectHeading(heading, body, where) {
  if (/[(:]/.test(heading)) fail(where, `unrecognised Aspect heading ${JSON.stringify(heading)}`);
  if (!body) fail(where, `Aspect ${JSON.stringify(heading)} has no presentation paragraph under it`);
  const m = body.match(/^Makeup \/ Costume Requirements:\s*(.+)$/s);
  return {
    costumeRequirement: Boolean(m),
    id: slug(heading),
    name: heading,
    presentation: m ? m[1].trim() : body,
  };
}

// A Foundation heading is "Name (Type: what the Type applies to)". The Type is
// the whole point: it names the skill table this Foundation's two purchasable
// skills must come from. `detail` keeps its colons — Heroic's is
// "Modules: An adventure led by an NPC ...".
function parseFoundationHeading(heading, body, where) {
  const m = heading.match(/^(.+?) \((.+?): (.+)\)$/);
  if (!m) fail(where, `unrecognised Foundation heading ${JSON.stringify(heading)}`);
  const [, name, type, detail] = m;
  if (!FOUNDATION_TYPES.includes(type)) {
    fail(where, `Foundation ${JSON.stringify(name)} has Type ${JSON.stringify(type)}, not one of ${FOUNDATION_TYPES.join(", ")}`);
  }
  return { detail, id: slug(name), name, skillGroup: `${type} Skills`, type };
}

const HEADING_PARSERS = { aspects: parseAspectHeading, foundations: parseFoundationHeading };

// --- markdown walking -------------------------------------------------------

function splitRow(line) {
  const cells = line.trim().split(/(?<!\\)\|/);
  return cells.slice(1, -1).map(unescapeCell);
}

// Yields every pipe table in a file with the heading it sits under.
function* tables(file, text) {
  const lines = text.split("\n");
  let heading = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{2,3}) (.+?)\s*$/);
    if (h) { heading = h[2]; continue; }
    if (!lines[i].startsWith("|")) continue;
    if (!/^\|\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue;
    const where = `${file}:${i + 1}`;
    if (!heading) fail(where, "table with no heading above it");
    const header = splitRow(lines[i]);
    const shape = SHAPES[header.join("|")];
    if (!shape) fail(where, `unrecognised table header ${JSON.stringify(header)}`);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].startsWith("|"); j++) {
      const cells = splitRow(lines[j]);
      if (cells.length !== header.length) {
        fail(`${file}:${j + 1}`, `${cells.length} cells in a ${header.length}-column table`);
      }
      rows.push({ cells, line: j + 1 });
    }
    yield { header, heading, line: i + 1, rows, shape };
    i = j - 1;
  }
}

// Yields the `###` headings of one file with the text of the paragraph under
// each, between the `after` heading and the `until` heading. A fence whose two
// ends are not both found throws: a renamed section must be noticed, not
// silently emptied.
function* fencedHeadings(file, text, fence) {
  const lines = text.split("\n");
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3}) (.+?)\s*$/);
    if (m) headings.push({ line: i + 1, text: m[2] });
  }
  const start = headings.findIndex((h) => h.text === fence.after);
  const end = headings.findIndex((h) => h.text === fence.until);
  if (start < 0) fail(file, `no ${JSON.stringify(fence.after)} heading to start the ${fence.key} list at`);
  if (end < 0) fail(file, `no ${JSON.stringify(fence.until)} heading to end the ${fence.key} list at`);
  if (end <= start) fail(file, `${JSON.stringify(fence.until)} is above ${JSON.stringify(fence.after)} in ${file}`);
  for (const h of headings.slice(start + 1, end)) {
    const body = [];
    for (let i = h.line; i < lines.length && !/^#{2,3} /.test(lines[i]); i++) {
      if (lines[i].trim() === "") { if (body.length) break; continue; }
      body.push(lines[i].trim());
    }
    yield { body: body.join(" "), heading: h.text, line: h.line };
  }
}

export function extract() {
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")).sort();
  const out = { aspects: [], attributes: [], cultures: [], currency: [], foundations: [], hidden: [], skills: [], sourceBook: SOURCE_BOOK, tables: [] };
  const ids = new Set();

  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    const page = stem === "index" ? "/mechanics/skills/" : `/mechanics/skills/${stem}/`;
    const text = readFileSync(join(SKILLS_DIR, file), "utf8");

    const fence = HEADING_LISTS[stem];
    if (fence) {
      for (const h of fencedHeadings(file, text, fence)) {
        const record = HEADING_PARSERS[fence.key](h.heading, h.body, `${file}:${h.line}`);
        out[fence.key].push({ ...record, source: `${page}#${anchor(h.heading)}` });
      }
    }

    for (const t of tables(file, text)) {
      const source = `${page}#${anchor(t.heading)}`;
      const where = `${file}:${t.line}`;

      if (t.shape === "skill") {
        const groupKind = GROUP_KIND[stem];
        if (!groupKind) fail(where, `skill table in a file with no group kind: ${file}`);
        const group = t.heading;
        out.tables.push({ file, group, groupKind, line: t.line, rows: t.rows.length, source });
        for (const { cells, line } of t.rows) {
          const rowWhere = `${file}:${line}`;
          const [nameRaw, costRaw, verbalRaw, description, attributeRaw] = cells;
          const { name, footnote } = parseName(nameRaw);
          const id = `${stem}/${slug(group)}/${slug(name)}`;
          if (ids.has(id)) fail(rowWhere, `duplicate id ${id}`);
          ids.add(id);
          const { verbal, thread: threadVerbal } = parseVerbal(verbalRaw);
          const attribute = parseAttribute(attributeRaw, rowWhere);
          const thread = threadVerbal || attribute.kind === "thread" || /thread skill/i.test(description);
          const record = {
            attribute,
            cost: parseCost(costRaw, rowWhere),
            description,
            group,
            groupKind,
            id,
            name,
            source,
            thread,
            verbal,
          };
          if (footnote) record.footnote = footnote;
          out.skills.push(record);
        }
      } else if (t.shape === "culture") {
        for (const { cells } of t.rows) {
          out.cultures.push({ id: slug(cells[0]), name: cells[0], researchTopic: cells[1], source });
        }
      } else if (t.shape === "attribute") {
        for (const { cells, line } of t.rows) {
          const rowWhere = `${file}:${line}`;
          const { name, footnote } = parseName(cells[0]);
          const record = {
            costToIncrease: parseCostToIncrease(cells[2], rowWhere),
            id: slug(name),
            max: integer(cells[3], rowWhere),
            name,
            source,
            startingValue: integer(cells[1], rowWhere),
          };
          if (footnote) record.footnote = footnote;
          out.attributes.push(record);
        }
      } else if (t.shape === "hidden") {
        for (const { cells } of t.rows) {
          const { name, footnote } = parseName(cells[0]);
          const isExpression = cells[1] === "Expression";
          const record = {
            alignment: cells[1],
            elements: isExpression ? [] : cells[1].split("/").map((s) => s.trim()),
            id: slug(name),
            kind: isExpression ? "Expression" : "Excellency",
            name,
            primarySkill: cells[2],
            source,
          };
          if (footnote) record.footnote = footnote;
          out.hidden.push(record);
        }
      } else if (t.shape === "currency") {
        for (const { cells } of t.rows) {
          out.currency.push({ coin: cells[0], id: slug(cells[0]), shape: cells[1], source, value: cells[2] });
        }
      }
    }
  }

  // A Foundation's Type names the table its skills come from. If a Type ever
  // appears with no matching table — a v3.52 that adds a fifth Type, or a
  // renamed heading — the mapping is a dead link and the build says so here
  // rather than the builder silently offering a Foundation no skill fits.
  const groups = new Set(out.tables.filter((t) => t.groupKind === "Foundation type").map((t) => t.group));
  for (const f of out.foundations) {
    if (!groups.has(f.skillGroup)) {
      fail("foundations.md", `Foundation ${JSON.stringify(f.name)} is a ${f.type}, and there is no ${JSON.stringify(f.skillGroup)} table`);
    }
  }

  return out;
}

function integer(raw, where) {
  if (!/^\d+$/.test(raw)) fail(where, `expected an integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

// The attribute chart's "Cost of next attribute" is circular: the escalating
// numbers are not in the converted markdown (WISHLIST.md, Q32). It is modelled
// as unpublished rather than guessed at.
function parseCostToIncrease(raw, where) {
  if (/^\d+$/.test(raw)) return { cp: Number(raw), kind: "cp" };
  if (/^n\/a$/i.test(raw)) return { kind: "none", raw };
  if (/^cost of next (attribute|vitality)$/i.test(raw)) return { kind: "unpublished", raw };
  fail(where, `unrecognised Cost to Increase cell ${JSON.stringify(raw)}`);
}

// JSON with every object's keys sorted, so the file is diffable and the same
// on every machine.
export function serialize(data) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sortKeys(data), null, 2) + "\n";
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const data = extract();
  const json = serialize(data);
  const summary = `${data.skills.length} skills in ${data.tables.length} tables, ${data.aspects.length} aspects, ${data.foundations.length} foundations, ${data.cultures.length} cultures, ${data.attributes.length} attribute rows, ${data.hidden.length} hidden, ${data.currency.length} coins`;
  if (process.argv.includes("--check")) {
    let committed = "";
    try { committed = readFileSync(OUTPUT, "utf8"); } catch { /* missing counts as stale */ }
    if (committed !== json) {
      console.error(`FAIL  src/_data/skills.json is stale — run node tools/extract-skills.mjs (${summary})`);
      process.exit(1);
    }
    console.log(`  ok  src/_data/skills.json matches the source tables (${summary})`);
  } else {
    writeFileSync(OUTPUT, json);
    console.log(`wrote src/_data/skills.json: ${summary}`);
  }
}
