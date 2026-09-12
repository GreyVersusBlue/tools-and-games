// Checks on src/js/build-rules.js, the character builder's arithmetic.
// Run from anywhere: node Numina/test/build-rules.test.mjs. Exits non-zero on
// any failure (repo convention). Wired into `npm test` after skills.test.mjs.
//
// What it pins, and why each pin exists:
//   - the module's own constants against the sentences in the rulebook that
//     set them, so a cap edited without a source change is a visible break;
//   - every cap and every escalating cost, each with the build that trips it;
//   - the four ids the module names literally (the two Aspect boosts, the
//     per-Aspect skill, Third Aspect) are still ids skills.json carries, so a
//     rulebook bump that renames one fails here rather than quietly lifting a
//     restriction to nothing;
//   - every Included skill priced at zero and granted rather than purchased;
//   - one known-good 50 CP build costed to the CP exactly;
//   - and the refusals: an attribute whose cost the book does not publish, and
//     a skill whose Cost cell says See Description, leave `cp.exact` false and
//     `cp.spent` a floor. That is the assertion this whole phase stands on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ASPECT_BOOST_SKILLS,
  ASPECT_MAX,
  ASPECT_SKILL_MAX,
  CP_BUDGET,
  CULTURE_SKILL_MAX,
  EXCELLENCY_MAX,
  EXPRESSION_MAX,
  FOUNDATION_SKILL_MAX,
  PER_ASPECT_SKILL,
  THIRD_ASPECT_SKILL,
  buildCatalog,
  emptyBuild,
  offered,
  priceBuild,
  tierCost,
  tierTotal,
} from "../src/js/build-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "src", "_data", "skills.json"), "utf8"));
const catalog = buildCatalog(data);

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}

// A build is only ever described by what it changes; everything else sits at
// the empty build's value, so a test says what it is about and nothing else.
const base = {
  aspects: ["arcane"],
  culture: "aluvair",
  domain: "air",
  foundation: "military",
};
const price = (over = {}) => priceBuild({ ...base, ...over }, catalog);
const codes = (verdict) => verdict.problems.map((p) => p.code);
const has = (verdict, code) => codes(verdict).includes(code);

// --- the numbers the rulebook sets -----------------------------------------

console.log("# constants against their source sentences");
ok(CP_BUDGET === 50, `50 CP to spend (${CP_BUDGET})`);
ok(ASPECT_MAX === 2 && ASPECT_SKILL_MAX === 3, "up to 2 Aspects, up to 3 Aspect skills");
ok(FOUNDATION_SKILL_MAX === 2 && CULTURE_SKILL_MAX === 2, "up to 2 Foundation skills and 2 Culture skills");
ok(EXCELLENCY_MAX === 3 && EXPRESSION_MAX === 2, "3 Excellencies is a hard limit; 2 Expressions at creation");
ok(tierCost(1) === 5 && tierCost(2) === 6 && tierCost(3) === 7, `the tier ladder is 5, 6, 7 (${[1, 2, 3].map(tierCost).join(", ")})`);
ok(tierTotal(0) === 0 && tierTotal(1) === 5 && tierTotal(2) === 11 && tierTotal(3) === 18, `tier totals 0, 5, 11, 18 (${[0, 1, 2, 3].map(tierTotal).join(", ")})`);

// --- the module's data matches skills.json ---------------------------------

console.log("# the builder's data is skills.json's data");
ok(catalog.aspects.size === data.aspects.length && catalog.aspects.size === 9, `9 Aspects (${catalog.aspects.size})`);
ok(catalog.foundations.size === 20, `20 Foundations (${catalog.foundations.size})`);
ok(catalog.cultures.size === 16, `16 Cultures (${catalog.cultures.size})`);
ok(catalog.domains.size === 6, `6 Domains (${catalog.domains.size})`);
ok(catalog.expressions.size === 15, `15 Expressions (${catalog.expressions.size})`);
ok(catalog.adventurerSkills.length === 9, `9 free Adventurer skills (${catalog.adventurerSkills.length})`);
ok(catalog.byId.size === data.skills.length, `every skill is in the index (${catalog.byId.size})`);
// The four literal ids. A rulebook bump that renames one of these would leave
// the restriction it enforces matching nothing at all.
for (const id of [...ASPECT_BOOST_SKILLS, PER_ASPECT_SKILL, THIRD_ASPECT_SKILL]) {
  ok(catalog.byId.has(id), `named id still exists: ${id}`);
}
// Every Foundation's Type points at a table with skills in it. The extractor
// throws if the group is missing; this is the other half — it is not empty.
const emptyGroup = [...catalog.foundations.values()].filter((f) => catalog.skillsOfGroup("Foundation type", f.skillGroup).length === 0);
ok(emptyGroup.length === 0, `every Foundation's Type has skills${emptyGroup.length ? `: ${emptyGroup.map((f) => f.name).join(", ")}` : ` (${catalog.foundations.size} Foundations, 4 Types)`}`);

// --- an empty build --------------------------------------------------------

console.log("# the empty build");
const blank = priceBuild(emptyBuild(catalog), catalog);
ok(blank.cp.spent === 0 && blank.cp.remaining === CP_BUDGET, `nothing chosen spends nothing (${blank.cp.spent})`);
ok(blank.cp.exact === true, "nothing chosen is exactly costed");
ok(blank.granted.length === 9, `every character starts with the 9 Adventurer skills (${blank.granted.length})`);
ok(blank.unofficial === true, "every verdict says it is unofficial");
for (const code of ["aspect-required", "foundation-required", "culture-required", "domain-required"]) {
  ok(has(blank, code), `the empty build reports ${code}`);
}
ok(price().legal === true, "the four free choices alone are a legal build");
ok(price().cp.spent === 0, `the four free choices cost nothing (${price().cp.spent})`);

// --- caps ------------------------------------------------------------------

console.log("# caps");
ok(has(price({ aspects: [] }), "aspect-required"), "no Aspect is illegal");
ok(has(price({ aspects: ["arcane", "beast", "shade"] }), "aspect-cap"), "three Aspects without Third Aspect is illegal");
ok(has(price({ aspects: ["arcane", "arcane"] }), "duplicate-selection"), "the same Aspect twice is illegal");
ok(has(price({ aspects: ["wizard"] }), "unknown-aspect"), "an Aspect that is not in the book is illegal");
// Third Aspect is the one thing that lifts the Aspect cap, and it lifts only
// that: the three-Aspect-skill limit is "regardless of how many Aspects".
const withThird = price({
  aspects: ["arcane", "beast", "shade"],
  expressions: ["aspected"],
  expressionSkills: [THIRD_ASPECT_SKILL],
});
// Asserted as "legal", not as "no aspect-cap": a renamed Third Aspect id
// would raise unknown-skill and never reach the cap check, and an absence
// test would call that a pass.
ok(withThird.legal === true, `the Aspected Expression's Third Aspect allows a third Aspect${withThird.legal ? "" : `: ${codes(withThird).join(", ")}`}`);
ok(
  has(price({ aspectSkills: ["aspects/aspects/blast-aspect", "aspects/aspects/unravel-magic", "aspects/aspects/invoke-aspect", "aspects/aspects/aspect-fury"] }), "aspect-skill-cap"),
  "a fourth Aspect skill is illegal"
);
ok(
  has(price({ aspects: ["arcane", "beast", "shade"], expressions: ["aspected"], expressionSkills: [THIRD_ASPECT_SKILL], aspectSkills: ["aspects/aspects/blast-aspect", "aspects/aspects/unravel-magic", "aspects/aspects/invoke-aspect", "aspects/aspects/aspect-fury"] }), "aspect-skill-cap"),
  "a third Aspect does not buy a fourth Aspect skill"
);
ok(has(price({ aspectSkills: ASPECT_BOOST_SKILLS }), "aspect-boost-cap"), "Extra Attribute and Aspect Armor together are illegal");
ok(price({ aspectSkills: [ASPECT_BOOST_SKILLS[0]] }).legal === true, "one of the two boosts is fine");
// Tongue of Aspect is the one selection a build may hold twice, and only once
// per Aspect.
const twoTongues = price({ aspects: ["arcane", "beast"], aspectSkills: [PER_ASPECT_SKILL, PER_ASPECT_SKILL] });
ok(twoTongues.legal === true, `Tongue of Aspect twice with two Aspects is legal${twoTongues.legal ? "" : `: ${codes(twoTongues).join(", ")}`}`);
ok(twoTongues.cp.spent === 4, `and is charged twice (${twoTongues.cp.spent})`);
ok(
  has(price({ aspects: ["arcane"], aspectSkills: [PER_ASPECT_SKILL, PER_ASPECT_SKILL] }), "duplicate-selection"),
  "Tongue of Aspect twice with one Aspect is illegal"
);
ok(
  has(price({ aspectSkills: ["aspects/aspects/blast-aspect", "aspects/aspects/blast-aspect"] }), "duplicate-selection"),
  "any other Aspect skill twice is illegal"
);

ok(has(price({ foundation: null }), "foundation-required"), "no Foundation is illegal");
ok(has(price({ foundation: "wastrel" }), "unknown-foundation"), "a Foundation that is not in the book is illegal");
ok(
  has(price({ foundationSkills: ["foundations/place-skills/attack", "foundations/place-skills/defense", "foundations/place-skills/boon"] }), "foundation-skill-cap"),
  "a third Foundation skill is illegal"
);
// Military is a Place Foundation, so a Specialty skill is the wrong table.
ok(has(price({ foundationSkills: ["foundations/specialty-skills/expose"] }), "foundation-skill-group"), "a Foundation skill from another Type is illegal");
ok(price({ foundationSkills: ["foundations/place-skills/attack"] }).legal === true, "a Place skill on a Place Foundation is fine");

ok(has(price({ culture: null }), "culture-required"), "no Culture is illegal");
ok(
  has(price({ cultureSkills: ["cultures/culture-skills/appreciation", "cultures/culture-skills/camaraderie", "cultures/culture-skills/garb"] }), "culture-skill-cap"),
  "a third Culture skill is illegal"
);
ok(has(price({ domain: null }), "domain-required"), "no Domain is illegal");
ok(has(price({ domainSkills: ["domains/earth/earths-touch"] }), "domain-skill-group"), "a skill from another Domain is illegal");
ok(has(price({ openSkills: ["open-skills/open-skills/agility", "open-skills/open-skills/agility"] }), "duplicate-selection"), "the same Open skill twice is illegal");
ok(has(price({ openSkills: ["domains/air/airs-touch"] }), "wrong-group"), "a Domain skill in the Open list is illegal");
ok(has(price({ openSkills: ["open-skills/open-skills/nonesuch"] }), "unknown-skill"), "a skill id that is not in skills.json is illegal");

ok(has(price({ excellencies: ["One", "Two", "Three", "Four"] }), "excellency-cap"), "a fourth Excellency is illegal");
ok(!has(price({ excellencies: ["One", "Two", "Three"] }), "excellency-cap"), "three Excellencies is legal");
ok(has(price({ expressions: ["performer", "oracle", "savant", "prodigy"] }), "expression-cap"), "a fourth Expression is illegal");
// The trade is the interesting one: a third Expression is paid for out of the
// third Excellency slot, so holding both is not legal.
const traded = price({ expressions: ["performer", "oracle", "savant"], excellencies: ["One", "Two", "Three"] });
ok(has(traded, "excellency-cap"), "a third Expression and a third Excellency together are illegal");
ok(!has(price({ expressions: ["performer", "oracle", "savant"], excellencies: ["One", "Two"] }), "excellency-cap"), "a third Expression with two Excellencies is legal");
ok(
  has(price({ expressionSkills: ["expressions/performer/composition"] }), "expression-skill-group"),
  "an Expression skill without its Expression is illegal"
);
ok(
  !has(price({ expressions: ["performer"], expressionSkills: ["expressions/performer/composition"] }), "expression-skill-group"),
  "an Expression skill with its Expression is fine"
);

// --- escalating costs ------------------------------------------------------

console.log("# escalating costs");
ok(price({ excellencies: ["One"] }).cp.spent === 5, `one Excellency costs 5 (${price({ excellencies: ["One"] }).cp.spent})`);
ok(price({ excellencies: ["One", "Two"] }).cp.spent === 11, `two Excellencies cost 11 (${price({ excellencies: ["One", "Two"] }).cp.spent})`);
ok(price({ excellencies: ["One", "Two", "Three"] }).cp.spent === 18, `three Excellencies cost 18 (${price({ excellencies: ["One", "Two", "Three"] }).cp.spent})`);
ok(price({ expressions: ["performer"] }).cp.spent === 5, `one Expression costs 5 (${price({ expressions: ["performer"] }).cp.spent})`);
ok(price({ expressions: ["performer", "oracle"] }).cp.spent === 11, `two Expressions cost 11 (${price({ expressions: ["performer", "oracle"] }).cp.spent})`);
ok(
  price({ expressions: ["performer", "oracle", "savant"], excellencies: ["One", "Two"] }).cp.spent === 18 + 11,
  `a traded third Expression costs 18, plus 11 for two Excellencies (${price({ expressions: ["performer", "oracle", "savant"], excellencies: ["One", "Two"] }).cp.spent})`
);

// --- Included is zero, and granted rather than purchased -------------------

console.log("# Included skills");
const everyIncluded = data.skills.filter((s) => s.cost.kind === "included");
ok(everyIncluded.length === 30, `30 Included skills in the book (${everyIncluded.length})`);
const withDomain = price({ domain: "water" });
ok(
  withDomain.granted.some((g) => g.id === "domains/water/waters-determination" && g.cp === 0),
  "choosing a Domain grants its Determination at zero"
);
ok(
  price({ culture: "aluvair" }).granted.some((g) => g.id === "cultures/culture-skills/resource-contacts" && g.cp === 0),
  "choosing a Culture grants Resource/Contacts at zero"
);
ok(
  price({ expressions: ["performer"] }).granted.some((g) => g.id === "expressions/performer/protective-performance" && g.cp === 0),
  "buying an Expression grants its Included skill at zero"
);
ok(
  price({ expressions: ["performer"] }).purchases.every((p) => p.id !== "expressions/performer/protective-performance"),
  "an Included skill is never a purchase"
);
// An Included skill does not eat an allowance. Resource/Contacts plus two
// bought Culture skills is three skills and still legal.
ok(
  !has(price({ cultureSkills: ["cultures/culture-skills/resource-contacts", "cultures/culture-skills/appreciation", "cultures/culture-skills/camaraderie"] }), "culture-skill-cap"),
  "an Included Culture skill does not count against the two purchases"
);
ok(
  price({ cultureSkills: ["cultures/culture-skills/resource-contacts"] }).cp.spent === 0,
  "selecting an Included skill adds nothing to the bill"
);

// --- what this module refuses to price -------------------------------------

console.log("# refusals");
const raised = price({ attributes: { prowess: 4 } });
ok(raised.cp.exact === false, "raising Prowess makes the total inexact");
ok(raised.cp.spent === 0, `and adds nothing to the floor, because the number is not published (${raised.cp.spent})`);
ok(raised.cp.unpriced.length === 1 && raised.cp.unpriced[0]?.raw === "Cost of next attribute", `the refusal carries the chart's own words (${raised.cp.unpriced[0]?.raw})`);
ok(raised.cp.unpriced[0]?.what === "Prowess +2", `and says what it could not price (${raised.cp.unpriced[0]?.what})`);
const vit = price({ attributes: { vitality: 5 } });
ok(vit.cp.exact === false && vit.cp.unpriced[0]?.raw === "Cost of next Vitality", "Vitality is unpriced too, in its own chart's words");
// Purpose is the one attribute with a number in the chart, so it is priced.
const purpose = price({ attributes: { purpose: 7 } });
ok(purpose.cp.exact === true && purpose.cp.spent === 8, `Purpose is 4 CP a point, so +2 is 8 (${purpose.cp.spent}, exact ${purpose.cp.exact})`);
ok(has(price({ attributes: { void: 3 } }), "attribute-not-purchasable"), "Void cannot be purchased");
ok(has(price({ attributes: { prowess: 11 } }), "attribute-cap"), "Prowess above 10 is illegal");
ok(has(price({ attributes: { vitality: 8 } }), "attribute-cap"), "Vitality above 7 is illegal");
ok(!has(price({ attributes: { vitality: 7 } }), "attribute-cap"), "Vitality at 7 is legal");
ok(has(price({ attributes: { prowess: 1 } }), "attribute-below-start"), "Prowess below its starting 2 is illegal");
ok(has(price({ attributes: { prowess: 2.5 } }), "attribute-not-a-number"), "a fractional attribute is illegal");
// The two See Description costs get the same treatment as the attribute curve.
const seeDescription = price({ expressions: ["aspected"], expressionSkills: ["expressions/aspected/aspect-versatility"] });
ok(seeDescription.cp.exact === false, "a See Description cost makes the total inexact");
ok(
  seeDescription.cp.unpriced.some((u) => u.raw === "See Description"),
  "and is recorded as unpriced rather than free"
);
ok(
  seeDescription.purchases.some((p) => p.id === "expressions/aspected/aspect-versatility" && p.cp === null),
  "a See Description purchase carries no number"
);

// --- what staff still has to approve --------------------------------------

console.log("# provisional");
const flags = (v) => v.provisional.map((p) => p.code);
ok(flags(price({ excellencies: ["Deadeye"] })).includes("excellency-unlock"), "every Excellency must be unlocked in-game");
ok(flags(price({ excellencies: ["Deadeye"] })).includes("hidden-approval"), "a hidden Excellency by name needs Staff approval");
ok(!flags(price({ excellencies: ["Something Devon Invented"] })).includes("hidden-approval"), "a name the hidden table does not carry is not flagged as hidden");
ok(flags(price({ expressions: ["performer"] })).includes("expression-unlock"), "every Expression must be unlocked in-game");
const thirdFlag = price({ expressions: ["performer", "oracle", "savant"], excellencies: ["One", "Two"] }).provisional.find((p) => p.code === "third-expression");
ok(thirdFlag?.email === "NuminaRules@gmail.com", `a third Expression carries the address to email (${thirdFlag?.email})`);
ok(!price({ expressions: ["performer", "oracle"] }).provisional.some((p) => p.code === "third-expression"), "two Expressions need no email");

// --- one known-good build, costed to the CP -------------------------------

console.log("# a 50 CP build");
// Arcane Aspect, Military Foundation, Aluvair Culture, Air Domain, one
// Excellency, the Performer Expression, three Aspect skills, two Place skills,
// two Culture skills, three Air skills, one Performer skill and four Open
// skills. Every cost is a number in a table, so the total is a total.
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
  openSkills: [
    "open-skills/open-skills/agility",
    "open-skills/open-skills/archery",
    "open-skills/open-skills/disarm-traps",
    "open-skills/open-skills/true-sight",
  ],
};
const full = priceBuild(fifty, catalog);
ok(full.problems.length === 0, `the 50 CP build is legal${full.problems.length ? `: ${full.problems.map((p) => p.message).join("; ")}` : ""}`);
ok(full.cp.exact === true, "the 50 CP build is exactly costed");
ok(full.cp.spent === 50, `the 50 CP build costs 50 (${full.cp.spent})`);
ok(full.cp.remaining === 0, `with nothing left (${full.cp.remaining})`);
// The bill adds up from its own lines, so a purchase counted twice shows here.
const fromLines = full.purchases.reduce((n, p) => n + (p.cp ?? 0), 0);
ok(fromLines === full.cp.spent, `the purchase lines sum to the total (${fromLines} vs ${full.cp.spent})`);
ok(full.granted.length === 9 + 3, `nine Adventurer skills plus the Culture, Domain and Expression grants (${full.granted.length})`);
// One more CP of anything, and it is over.
const over = priceBuild({ ...fifty, openSkills: [...fifty.openSkills, "open-skills/open-skills/pick-locks"] }, catalog);
ok(has(over, "over-budget"), "51 CP is over budget");
ok(over.cp.remaining === -1, `and says by how much (${over.cp.remaining})`);
// Over budget with an unpriced purchase in it says so rather than pretending.
const overInexact = priceBuild({ ...fifty, attributes: { prowess: 3 } }, catalog);
ok(!has(overInexact, "over-budget"), "an unpriced purchase on a 50 CP build is not called over budget");
ok(overInexact.cp.exact === false, "but it is not called exact either");

// --- what the picker will offer -------------------------------------------

console.log("# offered");
const steps = offered(base, catalog);
ok(steps[1].choices.length === 9 && steps[1].skills.length === 11, `step 1 offers 9 Aspects and 11 Aspect skills (${steps[1].choices.length}, ${steps[1].skills.length})`);
ok(steps[2].skills.length === 6 && steps[2].skills.every((s) => s.group === "Place Skills"), `step 2 offers Military's six Place skills (${steps[2].skills.length})`);
ok(offered({ ...base, foundation: "stargazer" }, catalog)[2].skills.every((s) => s.group === "Specialty Skills"), "a Specialty Foundation offers Specialty skills");
ok(offered({ ...base, foundation: null }, catalog)[2].skills.length === 0, "no Foundation offers no Foundation skills");
ok(steps[3].skills.length === 5, `step 3 offers the five purchasable Culture skills, not the Included one (${steps[3].skills.length})`);
ok(steps[5].choices === null, "step 5 offers no list of Excellencies, because the book publishes none");
ok(steps[6].choices.length === 15, `step 6 offers 15 Expressions (${steps[6].choices.length})`);
// Step 7 is the Domain's eight, the owned Expressions' three each, and the 25
// Open skills.
ok(steps[7].skills.length === 8 + 25, `step 7 offers the Domain's 8 and 25 Open skills with no Expression bought (${steps[7].skills.length})`);
ok(
  offered({ ...base, expressions: ["performer"] }, catalog)[7].skills.length === 8 + 3 + 25,
  `buying the Performer Expression adds its three purchasable skills (${offered({ ...base, expressions: ["performer"] }, catalog)[7].skills.length})`
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
