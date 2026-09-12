// The Numina character build, as arithmetic. A build in, a verdict out: what it
// costs, what is illegal, what is capped, what staff still has to approve, and
// what this file refuses to price.
//
// Pure: no DOM, no fetch, no imports. Runs the same under Node (test/
// build-rules.test.mjs) and in the page, which hands it the same
// src/_data/skills.json the build reads.
//
//   import { buildCatalog, emptyBuild, priceBuild } from "./build-rules.js";
//   const catalog = buildCatalog(skillsJson);
//   const verdict = priceBuild({ ...emptyBuild(), domain: "air" }, catalog);
//
// The rule that shapes everything below is the one the extractor already
// follows: a number the rulebook does not publish is not guessed at. The cost
// to raise Prowess, Insight, Fortitude or Vitality is "Cost of next attribute"
// in the book's own chart — circular, and the escalating numbers are in no
// converted chapter (BACKLOG.md Q32). A builder that invented a curve would
// hand a player a build that costs 50 CP on screen and something else at the
// character-approval desk, which is worse than no builder at all. So those
// purchases land in `cp.unpriced`, `cp.exact` goes false, and `cp.spent` is a
// floor rather than a total. Same for the two skills whose Cost cell says "See
// Description".
//
// Everything here is unofficial. Excellency and Expression purchases "must be
// unlocked in-game", hidden ones need Staff approval, and a third Expression
// needs an email. Those are `verdict.provisional`, part of the verdict rather
// than fine print.

// src/mechanics/new-players.md: "You start with 50 Character Points (CP)."
export const CP_BUDGET = 50;

// building-a-character.md, steps 5 and 6: "Your first Excellency costs five CP,
// each subsequent Excellency costs one additional CP", and Expressions the
// same. Three Excellencies is "a hard limit"; two Expressions is the limit at
// character creation.
export const FIRST_TIER_COST = 5;
export const EXCELLENCY_MAX = 3;
export const EXPRESSION_MAX = 2;

// expressions.md: "In some cases, a player may take a 3rd Expression by giving
// up their 3rd Excellency slot ... please email NuminaRules@gmail.com".
export const EXPRESSION_MAX_TRADED = 3;
export const RULES_EMAIL = "NuminaRules@gmail.com";

// Step 1: "Characters may have up to two Aspects" and "you may purchase a total
// of three Aspect Skills, regardless of how many Aspects you have". The
// Aspected Expression's Third Aspect skill is the only thing that lifts the
// first number, and it does not lift the second.
export const ASPECT_MAX = 2;
export const ASPECT_SKILL_MAX = 3;
export const THIRD_ASPECT_SKILL = "expressions/aspected/third-aspect";

// Steps 2 and 3: "You may purchase up to two Foundation Skills", "up to 2
// Culture skills from your Culture".
export const FOUNDATION_SKILL_MAX = 2;
export const CULTURE_SKILL_MAX = 2;

// aspects.md: "From your Aspect Skills **you may only select one extra
// Attribute or Armor increasing ability**". These are the two rows that do it.
// test/build-rules.test.mjs checks both ids are still in skills.json, so a
// rulebook bump that renames either fails there instead of quietly lifting the
// restriction.
export const ASPECT_BOOST_SKILLS = ["aspects/aspects/extra-attribute", "aspects/aspects/aspect-armor"];

// aspects.md's footnote: "Tongue of Aspect is purchased per Aspect ... buying
// Tongue of Aspect for two different Aspects counts as two separate Aspect
// skill purchases." The only selection a build may hold twice.
export const PER_ASPECT_SKILL = "aspects/aspects/tongue-of-aspect";

// The nth purchase of an escalating tier: 5, 6, 7. Costs the tiers, not the
// count, so an over-cap build still gets a number rather than a blank.
export function tierCost(n) {
  return FIRST_TIER_COST + n - 1;
}
export function tierTotal(count) {
  let total = 0;
  for (let n = 1; n <= count; n++) total += tierCost(n);
  return total;
}

// A skill counts against a "purchase up to N" cap when buying it costs
// something. The Culture table's Resource/Contacts, each Domain's
// Determination and each Expression's first row are Included — granted with
// the choice, not purchased out of the allowance. A See Description cost is
// counted: unknown is not free.
function isPurchase(skill) {
  return skill.cost.kind === "cp" ? skill.cost.cp > 0 : skill.cost.kind !== "included";
}

function slug(text) {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// --- the catalog ------------------------------------------------------------

// Indexes skills.json into the lookups the rules need. Groups are read out of
// the data, never listed here: the six Domains and fifteen Expressions are
// whatever tables the chapters carry.
export function buildCatalog(data) {
  const byId = new Map(data.skills.map((s) => [s.id, s]));
  const groupsOfKind = (kind) =>
    data.tables
      .filter((t) => t.groupKind === kind)
      .map((t) => ({ id: slug(t.group), name: t.group, source: t.source }));
  const skillsOfGroup = (kind, group) => data.skills.filter((s) => s.groupKind === kind && s.group === group);

  return {
    aspects: new Map(data.aspects.map((a) => [a.id, a])),
    aspectSkills: data.skills.filter((s) => s.groupKind === "Aspect"),
    attributes: new Map(data.attributes.map((a) => [a.id, a])),
    adventurerSkills: data.skills.filter((s) => s.groupKind === "Adventurer"),
    byId,
    cultures: new Map(data.cultures.map((c) => [c.id, c])),
    cultureSkills: data.skills.filter((s) => s.groupKind === "Culture"),
    domains: new Map(groupsOfKind("Domain").map((g) => [g.id, g])),
    expressions: new Map(groupsOfKind("Expression").map((g) => [g.id, g])),
    foundations: new Map(data.foundations.map((f) => [f.id, f])),
    // Hidden Excellencies and Expressions, by lowercased name: an Excellency
    // typed in by name is matched against these so the verdict can say it
    // needs Staff approval.
    hiddenByName: new Map(data.hidden.map((h) => [h.name.toLowerCase(), h])),
    openSkills: data.skills.filter((s) => s.groupKind === "Open"),
    skillsOfGroup,
  };
}

// A build with nothing chosen and every attribute at its starting value. The
// shape `priceBuild` expects; a missing key is read as empty rather than
// throwing, so a saved build from an older page still prices.
export function emptyBuild(catalog) {
  const attributes = {};
  if (catalog) for (const [id, a] of catalog.attributes) attributes[id] = a.startingValue;
  return {
    aspects: [],
    aspectSkills: [],
    attributes,
    culture: null,
    cultureSkills: [],
    domain: null,
    domainSkills: [],
    excellencies: [],
    expressions: [],
    expressionSkills: [],
    foundation: null,
    foundationSkills: [],
    openSkills: [],
  };
}

// --- the verdict ------------------------------------------------------------

class Verdict {
  constructor() {
    this.problems = [];
    this.provisional = [];
    this.granted = [];
    this.purchases = [];
    this.unpriced = [];
    this.spent = 0;
  }
  problem(code, step, message) {
    this.problems.push({ code, message, step });
  }
  flag(code, message, extra = {}) {
    this.provisional.push({ code, message, ...extra });
  }
  // A cost the rulebook does not publish. Recorded, never guessed.
  unknown(what, raw, why) {
    this.unpriced.push({ raw, what, why });
  }
}

const list = (v) => (Array.isArray(v) ? v : []);

// Resolves selected ids against the catalog, rejecting unknown ids and
// duplicates, and returns the records that survived.
function resolve(verdict, ids, step, catalog, { allowRepeat = null, repeatLimit = 0 } = {}) {
  const seen = new Map();
  const out = [];
  for (const id of ids) {
    const skill = catalog.byId.get(id);
    if (!skill) {
      verdict.problem("unknown-skill", step, `No skill with id ${JSON.stringify(id)} in skills.json`);
      continue;
    }
    const times = (seen.get(id) ?? 0) + 1;
    seen.set(id, times);
    if (times > 1) {
      const allowed = id === allowRepeat && times <= repeatLimit;
      if (!allowed) {
        verdict.problem(
          "duplicate-selection",
          step,
          id === allowRepeat
            ? `${skill.name} is purchased per Aspect, and this build has ${repeatLimit} Aspect(s) to purchase it for`
            : `${skill.name} is selected ${times} times; a skill is bought once`
        );
        continue;
      }
    }
    out.push(skill);
  }
  return out;
}

// Prices the resolved skills, splitting them into purchases, free grants and
// costs the book leaves to a conversation.
function charge(verdict, skills, step) {
  for (const skill of skills) {
    if (skill.cost.kind === "cp") {
      verdict.spent += skill.cost.cp;
      (skill.cost.cp > 0 ? verdict.purchases : verdict.granted).push({ cp: skill.cost.cp, id: skill.id, name: skill.name, step });
    } else if (skill.cost.kind === "included") {
      verdict.granted.push({ cp: 0, id: skill.id, name: skill.name, step });
    } else {
      verdict.purchases.push({ cp: null, id: skill.id, name: skill.name, step });
      verdict.unknown(skill.name, "See Description", "the Cost cell says See Description; the number depends on what is bought");
    }
  }
}

// Every skill a choice hands over for free, so the card can print them and the
// allowance does not pay for them twice.
function grantIncluded(verdict, skills, step) {
  for (const skill of skills) {
    if (isPurchase(skill)) continue;
    verdict.granted.push({ cp: 0, id: skill.id, name: skill.name, step });
  }
}

export function priceBuild(input, catalog) {
  const build = { ...emptyBuild(catalog), ...input };
  const v = new Verdict();

  // Step 0: every player is an Adventurer. "Adventurer skills do not cost any
  // CP" (building-a-character.md).
  for (const skill of catalog.adventurerSkills) {
    v.granted.push({ cp: 0, id: skill.id, name: skill.name, step: 0 });
  }

  // --- Step 1: Aspects -----------------------------------------------------
  const aspectIds = list(build.aspects);
  const aspects = [];
  for (const id of aspectIds) {
    if (!catalog.aspects.has(id)) v.problem("unknown-aspect", 1, `No Aspect named ${JSON.stringify(id)}`);
    else if (aspects.some((a) => a.id === id)) v.problem("duplicate-selection", 1, `${catalog.aspects.get(id).name} is chosen twice`);
    else aspects.push(catalog.aspects.get(id));
  }
  const thirdAspect = list(build.expressionSkills).includes(THIRD_ASPECT_SKILL);
  const aspectMax = ASPECT_MAX + (thirdAspect ? 1 : 0);
  if (aspects.length < 1) {
    v.problem("aspect-required", 1, "Every character must have at least one Aspect");
  } else if (aspects.length > aspectMax) {
    v.problem(
      "aspect-cap",
      1,
      thirdAspect
        ? `${aspects.length} Aspects; the Aspected Expression's Third Aspect allows ${aspectMax}`
        : `${aspects.length} Aspects; a character may have up to ${ASPECT_MAX} without the Aspected Expression's Third Aspect`
    );
  }

  const aspectSkills = resolve(v, list(build.aspectSkills), 1, catalog, {
    allowRepeat: PER_ASPECT_SKILL,
    repeatLimit: aspects.length,
  });
  for (const skill of aspectSkills) {
    if (skill.groupKind !== "Aspect") v.problem("wrong-group", 1, `${skill.name} is not an Aspect skill`);
  }
  const aspectPurchases = aspectSkills.filter(isPurchase);
  if (aspectPurchases.length > ASPECT_SKILL_MAX) {
    v.problem("aspect-skill-cap", 1, `${aspectPurchases.length} Aspect skills; up to ${ASPECT_SKILL_MAX} may be purchased regardless of how many Aspects you have`);
  }
  const boosts = aspectSkills.filter((s) => ASPECT_BOOST_SKILLS.includes(s.id));
  if (boosts.length > 1) {
    v.problem("aspect-boost-cap", 1, `${boosts.map((s) => s.name).join(" and ")}: only one extra Attribute or Armor increasing ability may be selected`);
  }
  charge(v, aspectSkills, 1);

  // --- Step 2: Foundation --------------------------------------------------
  const foundation = build.foundation ? catalog.foundations.get(build.foundation) ?? null : null;
  if (!build.foundation) v.problem("foundation-required", 2, "Choose one Foundation");
  else if (!foundation) v.problem("unknown-foundation", 2, `No Foundation named ${JSON.stringify(build.foundation)}`);

  const foundationSkills = resolve(v, list(build.foundationSkills), 2, catalog);
  for (const skill of foundationSkills) {
    if (skill.groupKind !== "Foundation type") {
      v.problem("wrong-group", 2, `${skill.name} is not a Foundation skill`);
    } else if (foundation && skill.group !== foundation.skillGroup) {
      v.problem(
        "foundation-skill-group",
        2,
        `${skill.name} is a ${skill.group} skill; ${foundation.name} is a ${foundation.type} Foundation and draws from ${foundation.skillGroup}`
      );
    }
  }
  const foundationPurchases = foundationSkills.filter(isPurchase);
  if (foundationPurchases.length > FOUNDATION_SKILL_MAX) {
    v.problem("foundation-skill-cap", 2, `${foundationPurchases.length} Foundation skills; up to ${FOUNDATION_SKILL_MAX} may be purchased`);
  }
  charge(v, foundationSkills, 2);

  // --- Step 3: Culture -----------------------------------------------------
  const culture = build.culture ? catalog.cultures.get(build.culture) ?? null : null;
  if (!build.culture) v.problem("culture-required", 3, "Choose one Culture");
  else if (!culture) v.problem("unknown-culture", 3, `No Culture named ${JSON.stringify(build.culture)}`);
  if (culture) grantIncluded(v, catalog.cultureSkills, 3);

  const cultureSkills = resolve(v, list(build.cultureSkills), 3, catalog);
  for (const skill of cultureSkills) {
    if (skill.groupKind !== "Culture") v.problem("wrong-group", 3, `${skill.name} is not a Culture skill`);
  }
  const culturePurchases = cultureSkills.filter(isPurchase);
  if (culturePurchases.length > CULTURE_SKILL_MAX) {
    v.problem("culture-skill-cap", 3, `${culturePurchases.length} Culture skills; up to ${CULTURE_SKILL_MAX} may be purchased`);
  }
  charge(v, cultureSkills.filter(isPurchase), 3);

  // --- Step 4: Domain ------------------------------------------------------
  const domain = build.domain ? catalog.domains.get(build.domain) ?? null : null;
  if (!build.domain) v.problem("domain-required", 4, "Choose one Domain");
  else if (!domain) v.problem("unknown-domain", 4, `No Domain named ${JSON.stringify(build.domain)}`);
  if (domain) grantIncluded(v, catalog.skillsOfGroup("Domain", domain.name), 4);

  const domainSkills = resolve(v, list(build.domainSkills), 7, catalog);
  for (const skill of domainSkills) {
    if (skill.groupKind !== "Domain") v.problem("wrong-group", 7, `${skill.name} is not a Domain skill`);
    else if (domain && skill.group !== domain.name) {
      v.problem("domain-skill-group", 7, `${skill.name} is an ${skill.group} skill; this character's Domain is ${domain.name}`);
    }
  }
  charge(v, domainSkills.filter(isPurchase), 7);

  // --- Steps 5 and 6: Excellencies and Expressions -------------------------
  // The Excellencies chapter is a 34-word stub with no conversion behind it
  // (BACKLOG.md Q33), so there is no list to pick from: an Excellency is a name
  // the player types, priced by its tier and checked against the hidden table.
  const excellencies = list(build.excellencies).map((name) => String(name).trim()).filter(Boolean);
  const expressionIds = list(build.expressions);
  const expressions = [];
  for (const id of expressionIds) {
    if (!catalog.expressions.has(id)) v.problem("unknown-expression", 6, `No Expression named ${JSON.stringify(id)}`);
    else if (expressions.some((e) => e.id === id)) v.problem("duplicate-selection", 6, `${catalog.expressions.get(id).name} is chosen twice`);
    else expressions.push(catalog.expressions.get(id));
  }

  // The trade: a third Expression costs the third Excellency slot.
  const tradedSlot = expressions.length > EXPRESSION_MAX;
  const excellencyMax = EXCELLENCY_MAX - (tradedSlot ? 1 : 0);
  if (excellencies.length > excellencyMax) {
    v.problem(
      "excellency-cap",
      5,
      tradedSlot
        ? `${excellencies.length} Excellencies and a third Expression; the third Expression is paid for with the third Excellency slot, so ${excellencyMax} is the limit here`
        : `${excellencies.length} Excellencies; ${EXCELLENCY_MAX} is a hard limit`
    );
  }
  if (expressions.length > EXPRESSION_MAX_TRADED) {
    v.problem("expression-cap", 6, `${expressions.length} Expressions; ${EXPRESSION_MAX} at character creation, or ${EXPRESSION_MAX_TRADED} by giving up the third Excellency slot`);
  }

  v.spent += tierTotal(excellencies.length);
  v.spent += tierTotal(expressions.length);
  excellencies.forEach((name, i) => {
    v.purchases.push({ cp: tierCost(i + 1), id: null, name, step: 5 });
    v.flag("excellency-unlock", `${name}: Excellency purchases must be unlocked in-game`, { name });
    const hidden = catalog.hiddenByName.get(name.toLowerCase());
    if (hidden && hidden.kind === "Excellency") {
      v.flag("hidden-approval", `${hidden.name} is a hidden Excellency and requires Staff approval before it is unlocked`, { name: hidden.name });
    }
  });
  expressions.forEach((expression, i) => {
    v.purchases.push({ cp: tierCost(i + 1), id: expression.id, name: expression.name, step: 6 });
    v.flag("expression-unlock", `${expression.name}: Expression purchases must be unlocked in-game`, { name: expression.name });
    grantIncluded(v, catalog.skillsOfGroup("Expression", expression.name), 6);
    if (i + 1 > EXPRESSION_MAX) {
      v.flag(
        "third-expression",
        `A third Expression trades away the third Excellency slot; email ${RULES_EMAIL} and Staff will confirm the build`,
        { email: RULES_EMAIL, name: expression.name }
      );
    }
  });

  // --- Step 7: Expression and Open skills ----------------------------------
  const expressionSkills = resolve(v, list(build.expressionSkills), 7, catalog);
  for (const skill of expressionSkills) {
    if (skill.groupKind !== "Expression") v.problem("wrong-group", 7, `${skill.name} is not an Expression skill`);
    else if (!expressions.some((e) => e.name === skill.group)) {
      v.problem("expression-skill-group", 7, `${skill.name} belongs to the ${skill.group} Expression, which this character does not have`);
    }
  }
  charge(v, expressionSkills.filter(isPurchase), 7);

  const openSkills = resolve(v, list(build.openSkills), 7, catalog);
  for (const skill of openSkills) {
    if (skill.groupKind !== "Open") v.problem("wrong-group", 7, `${skill.name} is not an Open skill`);
  }
  charge(v, openSkills, 7);

  // --- Steps 8, 9 and 10: attributes and Vitality --------------------------
  // The chart's own order, which is the book's: Prowess, Insight, Fortitude,
  // Void, Purpose, then Vitality on its own chart. Only Purpose carries a
  // number. The rule that skill-granted points do not move the ladder has
  // nothing to bite on while the one priced attribute is flat.
  const STEP_OF = { prowess: 8, insight: 8, fortitude: 8, void: 9, purpose: 9, vitality: 10 };
  const attributes = [];
  for (const [id, chart] of catalog.attributes) {
    const step = STEP_OF[id] ?? 8;
    const raw = build.attributes?.[id];
    const value = raw === undefined || raw === null || raw === "" ? chart.startingValue : Number(raw);
    if (!Number.isInteger(value)) {
      v.problem("attribute-not-a-number", step, `${chart.name} is ${JSON.stringify(raw)}, which is not a whole number`);
      continue;
    }
    const bought = value - chart.startingValue;
    attributes.push({ bought, id, max: chart.max, name: chart.name, startingValue: chart.startingValue, step, value });
    if (bought < 0) {
      v.problem("attribute-below-start", step, `${chart.name} is ${value}; every character starts with ${chart.startingValue}`);
      continue;
    }
    if (value > chart.max) {
      v.problem("attribute-cap", step, `${chart.name} is ${value}; you cannot purchase more than ${chart.max}`);
    }
    if (bought === 0) continue;
    if (chart.costToIncrease.kind === "cp") {
      v.spent += bought * chart.costToIncrease.cp;
      v.purchases.push({ cp: bought * chart.costToIncrease.cp, id, name: `${chart.name} +${bought}`, step });
    } else if (chart.costToIncrease.kind === "none") {
      v.problem("attribute-not-purchasable", step, `${chart.name} cannot currently be purchased (${chart.costToIncrease.raw} in the chart)`);
    } else {
      v.purchases.push({ cp: null, id, name: `${chart.name} +${bought}`, step });
      v.unknown(
        `${chart.name} +${bought}`,
        chart.costToIncrease.raw,
        "the chart's Cost to Increase is circular and the escalating numbers are in no converted chapter, so this build cannot be costed to the CP"
      );
    }
  }

  // --- The bill ------------------------------------------------------------
  const exact = v.unpriced.length === 0;
  if (v.spent > CP_BUDGET) {
    v.problem(
      "over-budget",
      7,
      exact
        ? `${v.spent} CP spent of ${CP_BUDGET}`
        : `at least ${v.spent} CP spent of ${CP_BUDGET}, and ${v.unpriced.length} purchase(s) are unpriced`
    );
  }

  return {
    attributes,
    cp: {
      budget: CP_BUDGET,
      exact,
      remaining: CP_BUDGET - v.spent,
      spent: v.spent,
      unpriced: v.unpriced,
    },
    granted: v.granted,
    legal: v.problems.length === 0,
    problems: v.problems,
    provisional: v.provisional,
    purchases: v.purchases,
    unofficial: true,
  };
}

// What each step may offer, given what is chosen so far. The picker reads this
// rather than re-deriving the groupings; the numbers it reports are the caps
// above, so a rule changes in one place.
export function offered(input, catalog) {
  const build = { ...emptyBuild(catalog), ...input };
  const foundation = build.foundation ? catalog.foundations.get(build.foundation) : null;
  const domain = build.domain ? catalog.domains.get(build.domain) : null;
  const expressions = list(build.expressions).map((id) => catalog.expressions.get(id)).filter(Boolean);
  return {
    1: { choices: [...catalog.aspects.values()], max: ASPECT_MAX, skills: catalog.aspectSkills, skillMax: ASPECT_SKILL_MAX },
    2: {
      choices: [...catalog.foundations.values()],
      max: 1,
      skills: foundation ? catalog.skillsOfGroup("Foundation type", foundation.skillGroup) : [],
      skillMax: FOUNDATION_SKILL_MAX,
    },
    3: { choices: [...catalog.cultures.values()], max: 1, skills: catalog.cultureSkills.filter(isPurchase), skillMax: CULTURE_SKILL_MAX },
    4: { choices: [...catalog.domains.values()], max: 1, skills: [], skillMax: null },
    5: { choices: null, max: EXCELLENCY_MAX, skills: [], skillMax: null },
    6: { choices: [...catalog.expressions.values()], max: EXPRESSION_MAX, skills: [], skillMax: null },
    7: {
      choices: null,
      max: null,
      skills: [
        ...(domain ? catalog.skillsOfGroup("Domain", domain.name).filter(isPurchase) : []),
        ...expressions.flatMap((e) => catalog.skillsOfGroup("Expression", e.name).filter(isPurchase)),
        ...catalog.openSkills,
      ],
      skillMax: null,
    },
    8: { attributes: ["prowess", "insight", "fortitude"], choices: null, max: null },
    9: { attributes: ["purpose"], choices: null, max: null },
    10: { attributes: ["vitality"], choices: null, max: null },
  };
}
