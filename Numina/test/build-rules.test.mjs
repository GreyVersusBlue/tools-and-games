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
  PREREQUISITES,
  PURCHASE_LIMITS,
  QUICK_REFLEXES,
  THIRD_ASPECT_SKILL,
  TWICE_SKILLS,
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
ok(everyIncluded.length === 60, `60 Included skills in the book (${everyIncluded.length})`);
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
ok(!flags(price({ excellencies: ["Ballista"] })).includes("hidden-approval") && flags(price({ excellencies: ["Ballista"] })).includes("excellency-unlock"), "a chapter Excellency must be unlocked in-game and needs no Staff approval");
// A save from when the name was typed (#306): any case, priced under the
// book's spelling, and a name on no list priced as it was.
const oldSave = price({ excellencies: ["deadeye", "tempest", "Something Devon Invented"] });
ok(oldSave.purchases.filter((p) => p.step === 5).map((p) => `${p.name}:${p.cp}`).join(",") === "Deadeye:5,Tempest:6,Something Devon Invented:7", `typed names price under the book's spelling, and an unlisted one still prices (${oldSave.purchases.filter((p) => p.step === 5).map((p) => `${p.name}:${p.cp}`).join(",")})`);
ok(oldSave.provisional.some((p) => p.code === "hidden-approval" && p.name === "Deadeye") && oldSave.provisional.filter((p) => p.code === "hidden-approval").length === 1, "and a hidden one typed in lower case is still flagged, under the name the purchase carries");
const twice = price({ excellencies: ["Deadeye", "deadeye"] });
ok(twice.problems.some((p) => p.code === "duplicate-selection" && p.step === 5) && twice.cp.spent === 5, `the same Excellency twice is a problem and is charged once (${twice.cp.spent})`);
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

// --- the skills inside an Excellency (#841, #843) ---------------------------

console.log("# Excellency skills");
const B = (name) => `excellencies/ballista/${name}`;
const HEAT = "excellencies/forge-fire/heat-the-forge";
const inside = data.skills.filter((s) => s.groupKind === "Excellency");
ok(inside.length === 239 && inside.filter((s) => s.cost.kind === "cp" && s.cost.cp > 0).length === 209 && inside.filter((s) => s.cost.kind === "included").length === 30, `239 skills in the Excellency tables: 209 with a CP number above zero, 30 Included (${inside.length})`);
const spentOn = (over) => price(over).cp.spent;
ok(spentOn({ excellencies: ["Ballista"], excellencySkills: [B("refresh-quiver"), B("extended-quiver")] }) === 5 + 4 + 2, `a skill inside an Excellency costs its printed CP on top of the Excellency: 5 + 4 + 2 (${spentOn({ excellencies: ["Ballista"], excellencySkills: [B("refresh-quiver"), B("extended-quiver")] })})`);
const ballista = price({ excellencies: ["Ballista"], excellencySkills: [B("refresh-quiver")] });
ok(ballista.legal && ballista.cp.exact && ballista.purchases.some((p) => p.id === B("refresh-quiver") && p.cp === 4 && p.step === 7), "and it is a legal, exactly priced step 7 purchase");
ok(price({ excellencies: ["ballista"], excellencySkills: [B("refresh-quiver")] }).legal, "a held name in another case still owns its table");
ok(ballista.granted.some((g) => g.id === B("trio-of-arrows") && g.cp === 0 && g.step === 5), "a chapter Excellency grants its Included skill at zero, in step 5");
// Slayer's Included row is its fourth. Granting by position would hand over
// Immolate, which costs CP.
const slayer = price({ excellencies: ["Slayer"] });
ok(slayer.granted.some((g) => g.id === "excellencies/slayer/char-the-flesh") && !slayer.granted.some((g) => g.id === "excellencies/slayer/immolate") && slayer.cp.spent === 5, "the grant is the row whose cost is Included, not the first row: Slayer's is its fourth");
ok(spentOn({ excellencies: ["Ballista"], excellencySkills: [B("trio-of-arrows")] }) === 5 && price({ excellencies: ["Ballista"], excellencySkills: [B("trio-of-arrows")] }).granted.filter((g) => g.id === B("trio-of-arrows")).length === 1, "an Included skill in the list is not charged and not granted twice");
const before = (v) => v.granted.filter((g) => g.step === 5).length;
ok(before(price({ excellencies: ["Deadeye"] })) === 0 && before(price({ excellencies: ["Something Devon Invented"] })) === 0, "a hidden Excellency and a name on no list grant nothing: the book prints no table for either");
const stray = price({ excellencies: ["Ballista"], excellencySkills: ["excellencies/stalker/first-blood"] });
ok(stray.problems.some((p) => p.code === "excellency-skill-group" && p.step === 7 && /Stalker Excellency/.test(p.message)), "a skill from an Excellency the build does not hold is a problem, and names the Excellency");
ok(has(price({ excellencySkills: [B("refresh-quiver")] }), "excellency-skill-group") && has(price({ excellencies: ["Deadeye"], excellencySkills: [B("refresh-quiver")] }), "excellency-skill-group"), "with no Excellency, or only a hidden one, the same");
const alchemy = price({ excellencies: ["Ballista"], excellencySkills: ["excellencies/alchemist-water-fire/on-the-fly-alchemy"] });
ok(alchemy.problems.some((p) => p.code === "excellency-skill-group" && /the Alchemist Excellency, which/.test(p.message)), "the message gives a multi-aligned Excellency its name without the heading's brackets");
ok(has(price({ excellencies: ["Ballista"], excellencySkills: ["open-skills/open-skills/agility"] }), "wrong-group") && has(price({ excellencies: ["Ballista"], openSkills: [B("refresh-quiver")] }), "wrong-group"), "an Open skill in the Excellency list is in the wrong group, and an Excellency skill in the Open list");
// "You can purchase this skill twice" is on two rows and no others.
ok(TWICE_SKILLS.length === 2 && TWICE_SKILLS.every((id) => /You can purchase this skill twice/.test(catalog.byId.get(id)?.description ?? "")), "both twice-purchasable rows are in skills.json and still say so");
const saysRepeat = data.skills.filter((s) => s.groupKind === "Excellency" && /purchase this skill/i.test(s.description)).map((s) => s.id);
ok(saysRepeat.length === 2 && saysRepeat.every((id) => TWICE_SKILLS.includes(id)), `and no other Excellency row says anything about purchasing it again (${saysRepeat.length})`);
const heat = (n) => price({ excellencies: ["Forge fire"], excellencySkills: Array(n).fill(HEAT) });
ok(heat(1).cp.spent === 8 && heat(2).cp.spent === 11 && heat(2).legal, `Heat the Forge twice is legal and costs its 3 CP twice (${heat(2).cp.spent})`);
ok(has(heat(3), "duplicate-selection") && heat(3).cp.spent === 11 && /purchased twice/.test(heat(3).problems[0].message), "a third is a problem and is not charged");
const doubled = price({ excellencies: ["Ballista"], excellencySkills: [B("refresh-quiver"), B("refresh-quiver")] });
ok(has(doubled, "duplicate-selection") && doubled.cp.spent === 9, "any other Excellency skill twice is a problem and is charged once");

// --- more than once, and something first (#844, #845) -----------------------

console.log("# purchase limits and prerequisites");
const quickRow = catalog.byId.get(QUICK_REFLEXES);
ok(/You can purchase this skill up to 3 times/.test(quickRow?.description ?? "") && quickRow.cost.kind === "cp" && quickRow.cost.cp === 1, "Quick Reflexes is in skills.json, prints one Cost of 1, and still says up to 3 times");
const saysAgain = data.skills.filter((s) => /purchase this skill (twice|up to)/i.test(s.description)).map((s) => s.id).sort();
ok(saysAgain.length === 3 && saysAgain.join() === [...PURCHASE_LIMITS.keys()].sort().join(), `the limits name every row in the book that says so, and no other (${saysAgain.length})`);
ok(PURCHASE_LIMITS.get(QUICK_REFLEXES) === 3 && TWICE_SKILLS.every((id) => PURCHASE_LIMITS.get(id) === 2), "Quick Reflexes three times; Heat the Forge and Extended Healing stay at two");
const quick = (n) => price({ openSkills: Array(n).fill(QUICK_REFLEXES) });
ok(quick(1).cp.spent === 1 && quick(1).legal, `Quick Reflexes once is 1 CP and legal, as it was (${quick(1).cp.spent})`);
ok(quick(2).cp.spent === 2 && quick(2).legal, `twice is legal and 2 CP (${quick(2).cp.spent})`);
ok(quick(3).cp.spent === 3 && quick(3).legal && quick(3).cp.exact, `three times is legal and 3 CP (${quick(3).cp.spent})`);
ok(quick(3).purchases.filter((p) => p.id === QUICK_REFLEXES && p.cp === 1 && p.step === 7).length === 3, "each purchase is its own step 7 line at the printed 1 CP");
ok(has(quick(4), "duplicate-selection") && quick(4).cp.spent === 3 && quick(4).purchases.length === 3, `a fourth is a problem and is not charged (${quick(4).cp.spent})`);
ok(quick(4).problems.some((p) => p.code === "duplicate-selection" && p.step === 7 && /Quick Reflexes is selected 4 times; its description allows it to be purchased up to 3 times/.test(p.message)), "and the message quotes the row's own limit");
ok(has(price({ excellencies: ["Ordinator"], excellencySkills: Array(3).fill(TWICE_SKILLS[1]) }), "duplicate-selection") && price({ excellencies: ["Ordinator"], excellencySkills: Array(3).fill(TWICE_SKILLS[1]) }).cp.spent === 11, "Extended Healing a third time is still a problem: a limit of 3 is Quick Reflexes' alone");

const [bowRule] = PREREQUISITES;
const BOW = "excellencies/tornado-air-lightning/bow-and-sword";
const ARCHERY = "open-skills/open-skills/archery";
ok(PREREQUISITES.length === 1 && bowRule.skill === BOW && bowRule.needs === ARCHERY && /pre-requisite of the Archery skill/.test(catalog.byId.get(BOW)?.description ?? ""), "the one checked prerequisite is Bow and Sword's, and its row still says so");
ok(data.skills.filter((s) => s.name === "Archery").length === 1 && catalog.byId.get(ARCHERY).groupKind === "Open", "the book has one skill named Archery, an Open skill");
const asks = data.skills.filter((s) => /requisite/i.test(s.description)).map((s) => s.id).sort();
ok(asks.join() === ["domains/ice/ices-skill", "excellencies/combatant-lightning-ice/armored-for-war", BOW].join(), `three rows state a prerequisite: this one and the two that want medium armor (${asks.length})`);
const tornado = price({ excellencies: ["Tornado"] });
ok(tornado.granted.some((g) => g.id === BOW) && !tornado.legal && has(tornado, "prerequisite-missing"), "Tornado without Archery is a problem");
ok(tornado.problems.filter((p) => p.code === "prerequisite-missing").length === 1 && tornado.problems.some((p) => p.code === "prerequisite-missing" && p.step === 7 && p.message === "Bow and Sword, which comes with the Tornado Excellency, has a prerequisite of the Archery skill, which this character does not have"), "reported once, under step 7, naming both skills and the Excellency");
ok(tornado.cp.spent === 5, `and the Excellency is charged as before (${tornado.cp.spent})`);
const archer = price({ excellencies: ["tornado"], openSkills: [ARCHERY] });
ok(archer.legal && !has(archer, "prerequisite-missing") && archer.cp.spent === 5 + 3, `Tornado with Archery is legal: 5 + 3 (${archer.cp.spent})`);
ok(!has(price({ excellencies: ["Ballista", "Combatant"] }), "prerequisite-missing") && !has(price({ domain: "ice", domainSkills: ["domains/ice/ices-skill"] }), "prerequisite-missing") && !has(price(), "prerequisite-missing"), "no other build is asked for it, and medium armor is not checked");

// The save from before the list existed: no excellencySkills at all.
const old = priceBuild({ ...base, excellencies: ["Ballista", "Deadeye"], excellencySkills: undefined }, catalog);
ok(old.cp.spent === 11 && old.legal && old.purchases.length === 2, `a build with no Excellency skill list prices as it did: two Excellencies, 11 CP (${old.cp.spent})`);
ok("excellencySkills" in emptyBuild(catalog) && emptyBuild(catalog).excellencySkills.length === 0, "the empty build has the list, empty");

// --- what the picker will offer -------------------------------------------

console.log("# offered");
const steps = offered(base, catalog);
ok(steps[1].choices.length === 9 && steps[1].skills.length === 11, `step 1 offers 9 Aspects and 11 Aspect skills (${steps[1].choices.length}, ${steps[1].skills.length})`);
ok(steps[2].skills.length === 6 && steps[2].skills.every((s) => s.group === "Place Skills"), `step 2 offers Military's six Place skills (${steps[2].skills.length})`);
ok(offered({ ...base, foundation: "stargazer" }, catalog)[2].skills.every((s) => s.group === "Specialty Skills"), "a Specialty Foundation offers Specialty skills");
ok(offered({ ...base, foundation: null }, catalog)[2].skills.length === 0, "no Foundation offers no Foundation skills");
ok(steps[3].skills.length === 5, `step 3 offers the five purchasable Culture skills, not the Included one (${steps[3].skills.length})`);
// Step 5 (#839): the chapter's 30 and the hidden table's 18, under names with
// the heading's brackets taken off, and the same list whatever the Domain.
const five = steps[5].choices;
ok(five.filter((x) => !x.hidden).length === 30 && five.filter((x) => x.hidden).length === 18, `step 5 offers the chapter's 30 Excellencies and the hidden table's 18 (${five.filter((x) => !x.hidden).length}, ${five.filter((x) => x.hidden).length})`);
ok(new Set(five.map((x) => x.name.toLowerCase())).size === 48, "no two of them share a name, so a name finds one Excellency");
ok(five.every((x) => x.hidden || (!/[()]/.test(x.name) && catalog.skillsOfGroup("Excellency", x.group).length > 0)), "a chapter Excellency's name carries no bracket, and its group still finds its skills");
ok(five.find((x) => x.id === "alchemist")?.domains.join("/") === "Water/Fire" && five.find((x) => x.id === "arcaneer")?.domains.length === 6, "each carries the alignment the extractor read: Alchemist Water / Fire, Arcaneer all six");
const fiveFor = (domain) => offered({ ...base, domain }, catalog)[5].choices.map((x) => x.id).join(",");
ok(base.domain === "air" && five.some((x) => !x.domains.includes("Air")) && fiveFor("air") === fiveFor("water") && fiveFor("air") === fiveFor(null), "the Domain filters nothing: an Air character is offered Excellencies not aligned to Air");
ok(steps[5].max === EXCELLENCY_MAX && steps[5].unlisted.length === 0, "step 5 reports the cap, and no unlisted name for a build that has none");
const kept = offered({ ...base, excellencies: ["Homebrew", "deadeye", " homebrew ", "Homebrew"] }, catalog)[5].unlisted;
ok(kept.length === 2 && kept[0] === "Homebrew" && kept[1] === "homebrew", `a name on neither list is offered back, once per spelling, and a listed one in any case is not (${JSON.stringify(kept)})`);
ok(steps[6].choices.length === 15, `step 6 offers 15 Expressions (${steps[6].choices.length})`);
// Step 7 is the Domain's eight, the owned Expressions' three each, and the 25
// Open skills.
ok(steps[7].skills.length === 8 + 25, `step 7 offers the Domain's 8 and 25 Open skills with no Expression bought (${steps[7].skills.length})`);
ok(
  offered({ ...base, expressions: ["performer"] }, catalog)[7].skills.length === 8 + 3 + 25,
  `buying the Performer Expression adds its three purchasable skills (${offered({ ...base, expressions: ["performer"] }, catalog)[7].skills.length})`
);

const seven = (excellencies) => offered({ ...base, excellencies }, catalog)[7].skills.filter((s) => s.groupKind === "Excellency");
ok(seven(["Ballista"]).length === 7 && seven(["Ballista"]).every((s) => s.group === "Ballista" && s.cost.kind === "cp"), `holding Ballista adds its 7 purchasable skills to step 7, and not its Included one (${seven(["Ballista"]).length})`);
ok(seven(["Deadeye", "Homebrew"]).length === 0 && seven([]).length === 0, "a hidden Excellency, a typed name and no Excellency add nothing");
ok(seven(["Ballista", "ballista", " BALLISTA "]).length === 7, "the same Excellency held twice lists its table once");
ok(seven(five.filter((x) => !x.hidden).map((x) => x.name)).length === 209, `all 30 chapter Excellencies together offer the 209 priced skills (${seven(five.filter((x) => !x.hidden).map((x) => x.name)).length})`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
