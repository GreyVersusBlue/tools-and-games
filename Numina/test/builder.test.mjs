// Checks on the character builder page's two pure modules and its built HTML:
// src/js/build-state.js (the localStorage record and the URL fragment) and
// src/js/build-view.js (the markup of each step and of the verdict), plus the
// page itself as `npm run build` wrote it. Run from anywhere:
// node Numina/test/builder.test.mjs. Exits non-zero on any failure. Wired into
// `npm test` fourth, after build-rules.test.mjs, and needs a built site.
//
// What it pins, and why:
//   - the fragment and the save both round-trip the 50 CP build, and the
//     storage key is the one the page shipped with (#36);
//   - a fragment nothing wrote, a foreign save and an unversioned save all
//     come back as a build rather than a throw (#37);
//   - each step's markup lists what offered() offers and nothing else: the
//     Foundation's own table, the Culture's purchasable rows, no list at all
//     for Excellencies, a Tongue of Aspect box per chosen Aspect;
//   - a step's signature moves only when its offering does, which is the
//     guard that keeps a typed Excellency name focused;
//   - the verdict says "at least" and quotes the chart when a purchase is
//     unpriced, and says the number when every purchase has one;
//   - the card prints every granted and purchased skill with its verbal and
//     its attribute cost, the six attributes, and a CP line that is the floor
//     and never a total when a purchase is unpriced (#314);
//   - print.css hides the builder's form and verdict on that page and does
//     not hide the card;
//   - the built page carries both JSON islands, the island's skill count is
//     skills.json's, and every anchor URL in it resolves to an id on the
//     chapter it points at.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PER_ASPECT_SKILL, buildCatalog, priceBuild } from "../src/js/build-rules.js";
import { STORAGE_KEY, decodeBuild, deserialize, encodeBuild, isEmpty, repair, serialize } from "../src/js/build-state.js";
import { attributeCostLabel, esc, renderCard, renderStep, renderStepProblems, renderSummary, renderVerdict, stepSignature } from "../src/js/build-view.js";
import { jsonIsland } from "../tools/json-island.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/Numina/";
const data = JSON.parse(readFileSync(join(root, "src", "_data", "skills.json"), "utf8"));
const catalog = buildCatalog(data);

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}
const count = (html, re) => (html.match(re) ?? []).length;

// The same 50 CP build build-rules.test.mjs costs to the CP.
const fifty = {
  aspects: ["arcane"],
  aspectSkills: ["aspects/aspects/extra-attribute", "aspects/aspects/blast-aspect", "aspects/aspects/unravel-magic"],
  culture: "aluvair",
  cultureSkills: ["cultures/culture-skills/appreciation", "cultures/culture-skills/camaraderie"],
  domain: "air",
  domainSkills: ["domains/air/airs-touch", "domains/air/airs-grace", "domains/air/airs-skill"],
  excellencies: ["Deadeye"],
  expressions: ["performer"],
  expressionSkills: ["expressions/performer/composition"],
  foundation: "military",
  foundationSkills: ["foundations/place-skills/attack", "foundations/place-skills/holding"],
  openSkills: ["open-skills/open-skills/agility", "open-skills/open-skills/archery", "open-skills/open-skills/disarm-traps", "open-skills/open-skills/true-sight"],
};

// --- the built page, read once ----------------------------------------------

const pagePath = join(root, "mechanics", "character-builder", "index.html");
ok(existsSync(pagePath), "the builder page is built (run `npm run build` first)");
const page = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";
const islandOf = (id) => {
  const m = page.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
};
const islandSkills = islandOf("numina-skills");
const links = islandOf("numina-skill-links") ?? { hrefs: {}, prefix: PREFIX };

// --- the fragment and the save ----------------------------------------------

console.log("# the fragment");
ok(STORAGE_KEY === "numina.build", `the storage key is numina.build and does not change (${STORAGE_KEY})`);
const fragment = encodeBuild(fifty, catalog);
ok(fragment.startsWith("a=arcane&as="), `the fragment is written in step order (${fragment.slice(0, 40)}…)`);
ok(!fragment.includes("at="), "attributes at their starting value are not in the fragment");
ok(JSON.stringify(decodeBuild(`#${fragment}`, catalog)) === JSON.stringify(repair(fifty, catalog)), "the 50 CP build round-trips through the fragment");
ok(encodeBuild({}, catalog) === "" && isEmpty(decodeBuild("", catalog), catalog), "the empty build is an empty fragment, and back");
ok(isEmpty(decodeBuild("#step-5", catalog), catalog), "a heading fragment decodes to the empty build, not a throw");
ok(isEmpty(decodeBuild("a=&f=&at=prowess:", catalog), catalog), "empty values decode to the empty build (`at=prowess:` is not Prowess 0)");
const awkward = { aspects: ["arcane"], excellencies: ["Dead, eye & co=1/2 ✓"] };
ok(decodeBuild(encodeBuild(awkward, catalog), catalog).excellencies[0] === awkward.excellencies[0], "a typed Excellency with every separator in it round-trips");
const raised = decodeBuild(encodeBuild({ ...fifty, attributes: { purpose: 7, prowess: 3 } }, catalog), catalog);
ok(raised.attributes.purpose === 7 && raised.attributes.prowess === 3 && raised.attributes.void === 2, "raised attributes round-trip and untouched ones sit at their start");
ok(decodeBuild("at=prowess:abc,purpose:9", catalog).attributes.prowess === 2, "a non-numeric attribute in the fragment falls back to its starting value");

console.log("# the save");
const saved = serialize(fifty, catalog);
ok(JSON.parse(saved).v === 1, "the save is versioned");
ok(JSON.stringify(deserialize(saved, catalog)) === JSON.stringify(repair(fifty, catalog)), "the 50 CP build round-trips through the save");
const unversioned = deserialize(JSON.stringify(fifty), catalog);
ok(unversioned && unversioned.foundation === "military" && unversioned.openSkills.length === 4, "an unversioned save reads as version 0 and comes through repair (#37)");
ok(deserialize("not json", catalog) === null && deserialize("42", catalog) === null, "a save that is not a build is null, not a throw");
const mangled = repair({ aspects: "arcane", foundation: 7, openSkills: [null, "", " x "], attributes: { prowess: "3", vitality: "two", purpose: 4.5 } }, catalog);
ok(
  mangled.aspects.length === 0 && mangled.foundation === null && mangled.openSkills.length === 1 && mangled.openSkills[0] === "x",
  "repair coerces a string where a list should be, a number where an id should be, and blanks out of a list"
);
ok(mangled.attributes.prowess === 3 && mangled.attributes.vitality === 2 && mangled.attributes.purpose === 5, "repair reads a numeric string, and puts a non-integer back to the chart's start");
ok(!("unknownField" in repair({ unknownField: 1 }, catalog)), "repair drops a field the build does not have");

// --- the steps ---------------------------------------------------------------

console.log("# the steps");
const empty = repair({}, catalog);
const render = (step, build) => renderStep(step, repair(build, catalog), catalog, links);

const s1 = render(1, empty);
ok(count(s1, /name="aspects"/g) === 9, `step 1 lists the 9 Aspects as checkboxes (${count(s1, /name="aspects"/g)})`);
ok(count(s1, /name="aspectSkills"/g) === catalog.aspectSkills.length, `step 1 lists every Aspect skill (${count(s1, /name="aspectSkills"/g)} of ${catalog.aspectSkills.length})`);
ok(/Tongue of Aspect \(choose an Aspect first\)[\s\S]*?/.test(s1) && /value="aspects\/aspects\/tongue-of-aspect" disabled/.test(s1), "with no Aspect chosen, Tongue of Aspect is one disabled box");
const s1two = render(1, { aspects: ["arcane", "shade"], aspectSkills: [PER_ASPECT_SKILL] });
ok(count(s1two, /value="aspects\/aspects\/tongue-of-aspect"/g) === 2, "with two Aspects chosen, Tongue of Aspect is one box per Aspect");
ok(count(s1two, /value="aspects\/aspects\/tongue-of-aspect" checked/g) === 1, "and one purchase checks the first of them");
ok(/Tongue of Aspect \(Arcane\)/.test(s1two) && /Tongue of Aspect \(Shade\)/.test(s1two), "each Tongue box names its Aspect");
ok(count(s1two, /name="aspects" value="[a-z]+" checked/g) === 2, "chosen Aspects render checked");
ok(/Makeup \/ Costume Requirements: You exhibit/.test(s1) && !/Makeup \/ Costume Requirements: [^<]*Shade/.test(s1), "an Aspect's presentation carries the costume prefix only where the book has it");

const s2 = render(2, empty);
ok(count(s2, /type="radio" name="foundation"/g) === 21, `step 2 is 20 Foundations plus "Not chosen yet" (${count(s2, /type="radio" name="foundation"/g)})`);
ok(count(s2, /name="foundationSkills"/g) === 0 && /Choose a Foundation to see its skills/.test(s2), "with no Foundation, step 2 lists no skills and says why");
const place = catalog.skillsOfGroup("Foundation type", "Place Skills");
const s2mil = render(2, { foundation: "military", foundationSkills: ["foundations/place-skills/attack"] });
ok(count(s2mil, /name="foundationSkills"/g) === place.length, `Military lists the ${place.length} Place skills (${count(s2mil, /name="foundationSkills"/g)})`);
ok(/Military draws from Place Skills/.test(s2mil) && /up to 2/.test(s2mil), "and says which table, and the cap");
ok(/value="foundations\/place-skills\/attack" checked/.test(s2mil), "a chosen Foundation skill renders checked");
ok(/value="military" checked/.test(s2mil) && !/value="" checked/.test(s2mil), "the chosen Foundation's radio is the checked one");
ok(/Place: Physical Challenges/.test(s2mil), "a Foundation shows its Type and detail");

const s3 = render(3, { culture: "aluvair" });
ok(count(s3, /type="radio" name="culture"/g) === 17, `step 3 is 16 Cultures plus "Not chosen yet" (${count(s3, /type="radio" name="culture"/g)})`);
ok(count(s3, /name="cultureSkills"/g) === 5 && !/name="cultureSkills" value="cultures\/culture-skills\/resource-contacts"/.test(s3), "the five purchasable Culture skills are listed and the Included one is not");
ok(/Included with any Culture: Resource\/Contacts/.test(s3), "the Included Culture skill is named as included instead");
ok(/Research topic: Natural Phenomena/.test(s3), "a Culture shows its research topic");

const s4 = render(4, { domain: "air" });
ok(count(s4, /type="radio" name="domain"/g) === 7, `step 4 is 6 Domains plus "Not chosen yet" (${count(s4, /type="radio" name="domain"/g)})`);
ok(/Included with Air: /.test(s4) && count(s4, /name="domainSkills"/g) === 0, "step 4 names the Domain's included skill and sells nothing (that is step 7)");

const s5 = render(5, { excellencies: ["Deadeye", "Ritual Curse Removal"] });
ok(count(s5, /type="text" name="excellencies"/g) === 3 && count(s5, /type="checkbox"/g) === 0, "step 5 is three text fields and no list (#306)");
ok(/value="Deadeye"/.test(s5) && /value="Ritual Curse Removal"/.test(s5) && /data-index="2" value=""/.test(s5), "typed Excellencies fill the fields in order, the third blank");

const s6 = render(6, { expressions: ["performer"] });
ok(count(s6, /name="expressions"/g) === 15, `step 6 lists the 15 Expressions (${count(s6, /name="expressions"/g)})`);
ok(/value="performer" checked/.test(s6), "a chosen Expression renders checked");
ok(/Included: /.test(s6), "each Expression names its included first skill");

const s7none = render(7, empty);
ok(count(s7none, /name="domainSkills"/g) === 0 && count(s7none, /name="expressionSkills"/g) === 0, "step 7 with nothing chosen sells no Domain or Expression skill");
ok(count(s7none, /name="openSkills"/g) === catalog.openSkills.length, `but every Open skill (${count(s7none, /name="openSkills"/g)})`);
const s7 = render(7, fifty);
const airBuyable = catalog.skillsOfGroup("Domain", "Air").filter((s) => s.cost.kind === "cp" && s.cost.cp > 0).length;
const performerBuyable = catalog.skillsOfGroup("Expression", "Performer").filter((s) => s.cost.kind !== "included").length;
ok(count(s7, /name="domainSkills"/g) === airBuyable, `Air's ${airBuyable} purchasable skills are step 7's Domain list (${count(s7, /name="domainSkills"/g)})`);
ok(count(s7, /name="expressionSkills"/g) === performerBuyable, `Performer's ${performerBuyable} purchasable skills are its Expression list (${count(s7, /name="expressionSkills"/g)})`);
ok(!/name="domainSkills" value="domains\/air\/determination/.test(s7), "Air's Determination is not for sale in step 7");
ok(count(s7, /name="(domainSkills|expressionSkills|openSkills)" value="[^"]+" checked/g) === 8, `the 50 CP build's 8 step 7 purchases render checked (${count(s7, /name="(domainSkills|expressionSkills|openSkills)" value="[^"]+" checked/g)})`);
ok(/Verbal: “/.test(s7) && /class="builder__desc"/.test(s7), "skills show their verbal and description inline");

const s8 = render(8, { attributes: { prowess: 4 } });
ok(count(s8, /type="number"/g) === 3 && /name="attr:prowess" value="4" min="2" max="10"/.test(s8), "step 8 is Prowess, Insight and Fortitude as number fields with the chart's start and cap");
ok(count(s8, /not published/g) === 3, "and each says its cost per point is not published");
const s9 = render(9, empty);
ok(/name="attr:purpose"[^>]*max="10"/.test(s9) && /4 CP per point/.test(s9) && !/name="attr:void"/.test(s9), "step 9 is Purpose at 4 CP a point; Void, which cannot be bought, is not a field");
const s10 = render(10, empty);
ok(/name="attr:vitality"[^>]*max="7"/.test(s10) && /Cost of next Vitality/.test(s10), "step 10 is Vitality to 7, quoting its own chart");

console.log("# links");
const rendered = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => render(n, fifty)).join("");
const hrefs = [...rendered.matchAll(/class="builder__link" href="([^"]+)"/g)].map((m) => m[1]);
ok(hrefs.length > 100 && hrefs.every((h) => h.startsWith(PREFIX)), `every rules link carries the path prefix (${hrefs.length} links)`);
const skillHrefs = [...rendered.matchAll(/<li class="builder__skill" data-skill="([^"]+)"[\s\S]*?class="builder__link" href="([^"]+)"/g)];
ok(skillHrefs.length > 0 && skillHrefs.every(([, id, href]) => links.hrefs[id] === href), "every skill's link is the island's link for that id");
ok(/<a class="builder__link" href="\/Numina\/mechanics\/skills\/aspects\/#arcane">Rules for Arcane<\/a>/.test(rendered), "an Aspect links to its own heading");

console.log("# escaping");
ok(esc(`<a & "b">`) === "&lt;a &amp; &quot;b&quot;&gt;", "esc escapes the four characters that matter in markup");
const hostile = render(5, { excellencies: [`"><script>alert(1)</script>`] });
ok(!/<script>/.test(hostile) && /value="&quot;&gt;&lt;script&gt;/.test(hostile), "a typed Excellency cannot break out of its attribute");

// --- what re-renders ---------------------------------------------------------

console.log("# signatures");
const sig = (n, build) => stepSignature(n, repair(build, catalog), catalog);
ok(sig(2, { foundation: "military" }) !== sig(2, { foundation: "mariner" }), "step 2's signature moves with the Foundation");
ok(sig(5, { excellencies: ["a"] }) === sig(5, { excellencies: ["ab"] }), "step 5's signature does not move as a name is typed (the focus guard)");
ok(sig(7, { domain: "air" }) !== sig(7, { domain: "air", expressions: ["performer"] }), "step 7's signature moves with an Expression");
ok(sig(7, { domain: "air", openSkills: ["open-skills/open-skills/agility"] }) === sig(7, { domain: "air" }), "but not with a purchase in the step");
ok(sig(1, { aspects: ["arcane"] }) !== sig(1, { aspects: ["arcane", "shade"] }), "step 1's signature moves with the Aspects, which is what adds a Tongue box");

// --- the verdict ---------------------------------------------------------------

console.log("# the verdict");
const exact = priceBuild(fifty, catalog);
const vExact = renderVerdict(exact);
ok(/data-exact="true"/.test(vExact) && /<strong>50 CP<\/strong> of 50 spent, <strong>0<\/strong> remaining/.test(vExact), "the 50 CP build's headline is the number");
ok(/No problems with this build/.test(vExact) && !/builder__unpriced/.test(vExact), "and it has no problems and nothing unpriced");
ok(/data-flag="excellency-unlock"/.test(vExact) && /data-flag="expression-unlock"/.test(vExact), "its provisional flags are on the page, not in fine print");
ok(count(vExact, /<tr><td>\d+<\/td>/g) === exact.purchases.length, `the bill has one row per purchase (${exact.purchases.length})`);
const floor = priceBuild({ ...fifty, attributes: { prowess: 3 } }, catalog);
const vFloor = renderVerdict(floor);
ok(/data-exact="false"/.test(vFloor) && /at least 50 CP/.test(vFloor) && /1 purchase unpriced/.test(vFloor), "a raised Prowess turns the headline into a floor");
ok(/Prowess \+1<\/strong> — the chart says “Cost of next attribute”/.test(vFloor), "and names the purchase in the chart's own words (#305)");
ok(/<td>unpriced<\/td>/.test(vFloor), "the bill shows it as unpriced rather than as a number");
const broken = priceBuild({ ...fifty, aspects: ["arcane", "shade", "plant"] }, catalog);
ok(/data-problem="aspect-cap"/.test(renderStepProblems(broken, 1)) && renderStepProblems(broken, 2) === "", "a problem renders under its own step and no other");
ok(/3 problems|1 problem/.test(renderVerdict(broken)) && /data-legal="false"/.test(renderVerdict(broken)), "the verdict counts the problems");
ok(/50 of 50 CP/.test(renderSummary(exact)) && /no problems/.test(renderSummary(exact)), "the summary line is the total and the state");
ok(/at least 50 of 50 CP, 1 unpriced/.test(renderSummary(floor)), "and says so when it is a floor");

// --- the card ------------------------------------------------------------------

console.log("# the card");
const cardOf = (build, extra) => {
  const b = repair(build, catalog);
  return renderCard(b, priceBuild(b, catalog), catalog, extra);
};
const cardExact = cardOf(fifty, { url: "https://example.test/Numina/mechanics/character-builder/#a=arcane" });
const rowsOf = (html) => count(html, /<tr data-sheet-skill=/g);
const skillRows = exact.granted.length + exact.purchases.filter((p) => p.step <= 7).length;
ok(rowsOf(cardExact) === skillRows, `the card has one row per granted skill and per purchase through step 7 (${rowsOf(cardExact)} of ${skillRows})`);
ok(count(cardExact, /data-sheet-step="0"/g) === catalog.adventurerSkills.length, "the Adventurer skills lead the table");
const order = [...cardExact.matchAll(/data-sheet-step="(\d+)"/g)].map((m) => Number(m[1]));
ok(order.every((n, i) => i === 0 || n >= order[i - 1]), "and the rows run in step order");
ok(/<td class="sheet__skill">Unravel Magic<\/td><td>Aspect<\/td><td class="sheet__cp">2<\/td><td><\/td><td class="sheet__verbal">“Purge Will”<\/td>/.test(cardExact), "a skill row is name, source, CP, uses and the verbal in quotes");
ok(/<td class="sheet__skill">Protective Performance<\/td><td>Performer Expression<\/td><td class="sheet__cp">Included<\/td><td>1 Insight<\/td>/.test(cardExact), "an included Expression skill prints Included and its attribute cost");
ok(/<td class="sheet__skill">Air's Determination<\/td><td>Air Domain<\/td><td class="sheet__cp">Included<\/td>/.test(cardExact), "a 0 CP Domain grant prints Included too");
ok(/<td class="sheet__skill">Deadeye<\/td><td>Excellency<\/td><td class="sheet__cp">5<\/td><td><\/td><td class="sheet__verbal">Hidden — Staff approval<\/td>/.test(cardExact), "a hidden Excellency's row carries the Staff-approval note (#306)");
ok(/<td class="sheet__skill">Performer<\/td><td>Expression<\/td><td class="sheet__cp">5<\/td><td><\/td><td class="sheet__verbal">Unlocked in-game<\/td>/.test(cardExact), "an Expression purchase is a row of its own, not an Excellency");
ok(attributeCostLabel({ kind: "none", raw: "N/A" }) === "—" && attributeCostLabel({ kind: "thread", raw: "This is a Thread Skill" }) === "Thread skill" && attributeCostLabel({ kind: "unlisted" }) === "" && attributeCostLabel({ kind: "uses", raw: "1x / Short Rest" }) === "1x / Short Rest", "the uses column is a dash for none, Thread skill for a thread, blank for unlisted, and the chart's words otherwise");
const cells = [...cardExact.matchAll(/data-sheet-attribute="([a-z]+)">(\d+)</g)].map((m) => `${m[1]}:${m[2]}`);
ok(cells.join(",") === "prowess:2,insight:2,fortitude:2,void:2,purpose:5,vitality:2", `the six attributes print at their values in the chart's order (${cells.join(",")})`);
ok(/data-exact="true"/.test(cardExact) && /<strong>50 CP<\/strong> of 50 spent, 0 remaining\./.test(cardExact), "the 50 CP build's CP line is the number");
ok(/<dt>Aspects<\/dt><dd>Arcane<\/dd>/.test(cardExact) && /<dt>Foundation<\/dt><dd>Military \(Place: /.test(cardExact) && /<dt>Excellencies<\/dt><dd>Deadeye<\/dd>/.test(cardExact), "the choices print by name, the Foundation with its type");
ok(/Needs Staff:<\/strong> Deadeye: Excellency purchases must be unlocked in-game;/.test(cardExact) && !/sheet__problems/.test(cardExact), "the Staff flags print and a legal build prints no problems");
ok(/This build: https:\/\/example\.test\/Numina\/mechanics\/character-builder\/#a=arcane/.test(cardExact) && !/sheet__url/.test(cardOf(fifty)), "the share URL prints when the page gives one, and not otherwise");
ok(/sheet__blank-label">Character<\/span>/.test(cardExact) && /sheet__blank-label">Player<\/span>/.test(cardExact), "the card leaves a Character and a Player line to write in");

const cardFloor = cardOf({ ...fifty, attributes: { prowess: 3, purpose: 6 } });
ok(/data-exact="false"/.test(cardFloor) && /<strong>At least 54 CP<\/strong> of 50 spent, at most -4 remaining\./.test(cardFloor), "a raised Prowess makes the CP line a floor");
ok(!/<strong>\d+ CP<\/strong> of/.test(cardFloor), "and the card prints no total anywhere (#305)");
ok(/Attributes bought: Prowess \+1 \(unpriced\), Purpose \+1 \(4 CP\)\./.test(cardFloor), "attribute purchases print with their price, or unpriced");
ok(rowsOf(cardFloor) === rowsOf(cardExact), "and are not rows in the skill table");
ok(/Not in the total:<\/strong> Prowess \+1 — the chart says “Cost of next attribute”\./.test(cardFloor), "and the unpriced one is named in the chart's own words");
ok(/data-sheet-attribute="prowess">3</.test(cardFloor) && /data-sheet-attribute="purpose">6</.test(cardFloor), "the raised attributes print at their raised values");
ok(/1 problem — not a legal build as it stands:<\/strong> 54 CP spent of 50/.test(cardOf({ ...fifty, attributes: { purpose: 6 } })), "an over-budget build's card says so, not just the verdict");
ok(/data-legal="false"/.test(cardOf({ ...fifty, aspects: ["arcane", "shade", "plant"] })), "an illegal build is marked illegal on the card");
const cardEmpty = cardOf({});
ok(count(cardEmpty, /sheet__none/g) === 6 && rowsOf(cardEmpty) === catalog.adventurerSkills.length, "the empty build's card is six dashes and the Adventurer skills");
const cardHostile = cardOf({ excellencies: ["<b>Bold</b> & co"] });
ok(!/<b>Bold/.test(cardHostile) && /&lt;b&gt;Bold&lt;\/b&gt; &amp; co/.test(cardHostile), "a typed Excellency cannot put markup on the card");

// --- the built page ------------------------------------------------------------

console.log("# the built page");
ok(count(page, /data-step-body="\d+"/g) === 10 && count(page, /data-step-problems="\d+"/g) === 10, "the page has ten step bodies and ten problem slots");
ok(islandSkills?.skills?.length === data.skills.length, `the skills island carries all ${data.skills.length} records (${islandSkills?.skills?.length})`);
ok(Object.keys(links.hrefs).length === data.skills.length && links.prefix === PREFIX, "the links island has one URL per skill and the path prefix");
const idsOf = new Map();
const dangling = Object.entries(links.hrefs).filter(([, href]) => {
  const [url, fragment] = href.split("#");
  const file = join(root, url.slice(PREFIX.length), "index.html");
  if (!idsOf.has(file)) idsOf.set(file, existsSync(file) ? new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) : new Set());
  return !idsOf.get(file).has(fragment);
});
ok(dangling.length === 0, `every island URL resolves to an id on its chapter${dangling.length ? `: ${dangling.slice(0, 3).map(([id, h]) => `${id} → ${h}`).join(", ")}` : ""}`);
ok(/<script type="module" src="\/Numina\/js\/builder\.js"><\/script>/.test(page), "the page loads builder.js as a module");
for (const file of ["builder.js", "build-rules.js", "build-state.js", "build-view.js"]) {
  ok(existsSync(join(root, "js", file)), `js/${file} is in the build`);
}
ok(/data-builder(="")? hidden(="")?/.test(page) && /data-builder-needs-js/.test(page), "the form ships hidden with a no-JS notice beside it");
ok(/<body class="cardsheet">/.test(page) && /<main class="builder-page"/.test(page), "the page is on the cardsheet print treatment and its main is marked for print.css");
ok(/<div class="builder__card" data-card(="")?><\/div>/.test(page) && /<p class="print-action"><button type="button" onclick="window\.print\(\)">Print this card<\/button><\/p>/.test(page), "the page has the card slot and a print button");
// print.css must hide the form and the verdict on this page and leave the
// card alone, or the sheet is either the whole page or blank. Read as text:
// every selector of every rule that sets display: none, on the built copy.
const printCss = readFileSync(join(root, "css", "print.css"), "utf8");
const hiddenSelectors = [...printCss.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
for (const sel of [".builder-page .builder__form", ".builder-page .builder__verdict-section", ".builder-page .builder__bar", ".print-action"]) {
  ok(hiddenSelectors.includes(sel), `print.css hides ${sel}`);
}
ok(!hiddenSelectors.some((sel) => /\.sheet\b|\.builder__card$/.test(sel)), "and print.css does not hide the card");
// The island's one hazard, checked with a value that has it: the built data
// happens not to contain "</", so only a planted one can show the escape works.
const planted = jsonIsland({ d: "a </script> b" });
ok(!planted.includes("</script>") && JSON.parse(planted).d === "a </script> b", "a description containing </script> cannot close the island early");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
