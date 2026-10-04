// The character builder's markup, as strings. A build, the catalog and a
// verdict in; the HTML of each step and of the verdict panel out. No DOM, so
// test/builder.test.mjs can assert what the page shows without a browser, and
// builder.js is left with nothing but events, storage and innerHTML.
//
// The form is the state. Every control is named for the build field it writes
// (`name="aspectSkills" value="<skill id>"`, `name="attr:prowess"`), so
// builder.js can read a build straight back out of the form with no bookkeeping
// of its own, and rendering a step from a build marks its controls checked.
//
// What is listed is exactly what build-rules.js's offered() returns for the
// build so far — the picker renders rules, it does not restate them. The one
// thing added on top is the wording around the lists, which quotes the chapter.
import { EXPRESSION_MAX, PER_ASPECT_SKILL, PREREQUISITES, PURCHASE_LIMITS, excellencyName, heldExcellencies, offered } from "./build-rules.js";

export const STEP_TITLES = {
  1: "Choose 1 or 2 Aspects",
  2: "Choose 1 Foundation",
  3: "Choose 1 Culture",
  4: "Choose your one Domain",
  5: "Choose up to three Excellencies",
  6: "Choose up to two Expressions",
  7: "Purchase Skills",
  8: "Purchase Prowess, Fortitude and Insight",
  9: "Purchase Purpose",
  10: "Purchase Vitality",
};

// The chapter's own note under each step, quoted rather than paraphrased.
const STEP_NOTES = {
  1: "These Aspects do not cost CP. You can purchase a total of 3 Aspect skills from your Aspects.",
  2: "This Foundation does not cost CP. You can purchase up to 2 Foundation skills from your Foundation.",
  3: "This Culture does not cost CP. You can purchase up to 2 Culture skills from your Culture.",
  4: "This Domain does not cost CP. Its Determination skill is included; its other skills are bought in step 7.",
  5: "Your first Excellency costs five CP, each subsequent Excellency costs one additional CP. Three is a hard limit, and Excellency purchases must be unlocked in-game. Each Excellency's Included skill comes with it; its other skills are bought in step 7.",
  6: "Your first Expression costs five CP, each subsequent Expression costs one additional CP. Two at character creation; a third trades away the third Excellency slot. Each Expression's first skill is included.",
  7: "Skills come from all the different things you have selected previously and also include Open Skills.",
  8: "Spend these attributes to use skills.",
  9: "Void and Purpose allow you to refresh your other attributes after taking a Short or Long Rest. Void cannot currently be purchased.",
  10: "Vitality defines how many hits your character can take before they fall Unstable.",
};

export function esc(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Descriptions keep the chapter's `**bold**` and `*italic*` markers; everything
// else is text. Bold goes first: its stars would otherwise pair up as italics.
function prose(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function costLabel(cost) {
  if (cost.kind === "cp") return cost.cp === 0 ? "0 CP" : `${cost.cp} CP`;
  if (cost.kind === "included") return "Included";
  return "See description";
}

const count = (list, id) => list.filter((x) => x === id).length;

// `links` is what the page hands over: `hrefs`, every skill id to its anchor
// URL as the build computed it, and `prefix`, the site's path prefix, so a
// record's own `source` ("/mechanics/skills/aspects/#arcane") becomes a URL.
const pageHref = (links, source) => (source ? links.prefix.replace(/\/$/, "") + source : null);
const ruleLink = (href, name) => (href ? `<a class="builder__link" href="${esc(href)}">Rules for ${esc(name)}</a>` : "");

// One skill, with everything the wishlist asked for inline: cost, verbal,
// description, and a link to the row's own anchor in its chapter.
function skillItem(skill, field, checked, links, extra = {}) {
  const href = links.hrefs[skill.id];
  const attrs = extra.attrs ?? "";
  const label = extra.label ?? skill.name;
  return (
    `<li class="builder__skill" data-skill="${esc(skill.id)}">` +
    `<label class="builder__pick"><input type="checkbox" name="${field}" value="${esc(skill.id)}"${checked ? " checked" : ""}${attrs}> ` +
    `<span class="builder__name">${esc(label)}</span> <span class="builder__cost">${esc(costLabel(skill.cost))}</span></label>` +
    (skill.verbal ? `<span class="builder__verbal">Verbal: “${esc(skill.verbal)}”</span>` : "") +
    `<span class="builder__desc">${prose(skill.description)}</span>` +
    ruleLink(href, skill.name) +
    `</li>`
  );
}

// A skill's boxes: one, or one per purchase its row allows, all with the one
// value, the way Tongue of Aspect is a box per Aspect. The form reads a build
// as one entry per ticked box, so they tick in order on the next render.
const NTH = ["", "", "second", "third"];
function purchaseItems(skill, field, chosen, links) {
  const taken = count(chosen, skill.id);
  let html = skillItem(skill, field, taken > 0, links);
  for (let n = 2; n <= (PURCHASE_LIMITS.get(skill.id) ?? 1); n++) {
    html += skillItem(skill, field, taken >= n, links, { label: `${skill.name} (${NTH[n] ?? `purchase ${n}`} purchase)`, attrs: ` data-repeat="${n - 1}"` });
  }
  return html;
}

function skillList(skills, field, chosen, links, heading, cap = null) {
  if (!skills.length) return "";
  const capText = cap ? ` <span class="builder__cap">up to ${cap}</span>` : "";
  return (
    `<h3 class="builder__group">${esc(heading)}${capText}</h3>` +
    `<ul class="builder__skills">${skills.map((s) => skillItem(s, field, chosen.includes(s.id), links)).join("")}</ul>`
  );
}

function choiceItem(field, type, value, checked, label, detail, href = null, linkLabel = label) {
  return (
    `<li class="builder__choice"><label class="builder__pick"><input type="${type}" name="${field}" value="${esc(value)}"${checked ? " checked" : ""}> ` +
    `<span class="builder__name">${esc(label)}</span></label>` +
    (detail ? `<span class="builder__desc">${prose(detail)}</span>` : "") +
    ruleLink(href, linkLabel) +
    `</li>`
  );
}

function radioList(field, choices, chosen, describe, links) {
  return (
    `<ul class="builder__choices">` +
    choiceItem(field, "radio", "", !chosen, "Not chosen yet", "") +
    choices.map((c) => choiceItem(field, "radio", c.id, chosen === c.id, c.name, describe(c), pageHref(links, c.source))).join("") +
    `</ul>`
  );
}

// --- the steps --------------------------------------------------------------

function step1(build, catalog, offer, links) {
  const chosen = build.aspects;
  const aspects = chosen.map((id) => catalog.aspects.get(id)).filter(Boolean);
  let html = `<ul class="builder__choices">`;
  for (const a of offer.choices) {
    html += choiceItem("aspects", "checkbox", a.id, chosen.includes(a.id), a.name, (a.costumeRequirement ? "Makeup / Costume Requirements: " : "") + a.presentation, pageHref(links, a.source));
  }
  html += `</ul>`;
  // Tongue of Aspect is bought per Aspect, so it is one box per chosen Aspect
  // rather than one box; every other Aspect skill is bought once.
  const perAspect = offer.skills.find((s) => s.id === PER_ASPECT_SKILL);
  const others = offer.skills.filter((s) => s.id !== PER_ASPECT_SKILL);
  const taken = count(build.aspectSkills, PER_ASPECT_SKILL);
  html += `<h3 class="builder__group">Aspect skills <span class="builder__cap">up to ${offer.skillMax}</span></h3><ul class="builder__skills">`;
  html += others.map((s) => skillItem(s, "aspectSkills", build.aspectSkills.includes(s.id), links)).join("");
  if (perAspect) {
    if (aspects.length === 0) {
      html += skillItem(perAspect, "aspectSkills", taken > 0, links, { label: `${perAspect.name} (choose an Aspect first)`, attrs: " disabled" });
    }
    aspects.forEach((a, i) => {
      html += skillItem(perAspect, "aspectSkills", i < taken, links, { label: `${perAspect.name} (${a.name})`, attrs: ` data-repeat="${i}"` });
    });
  }
  html += `</ul>`;
  return html;
}

function step2(build, catalog, offer, links) {
  const foundation = build.foundation ? catalog.foundations.get(build.foundation) : null;
  let html = radioList("foundation", offer.choices, build.foundation, (f) => `${f.type}: ${f.detail}`, links);
  if (foundation) {
    html += skillList(offer.skills, "foundationSkills", build.foundationSkills, links, `${foundation.name} draws from ${foundation.skillGroup}`, offer.skillMax);
  } else {
    html += `<p class="builder__hint">Choose a Foundation to see its skills. Each Foundation's Type names the table its skills come from.</p>`;
  }
  return html;
}

function step3(build, catalog, offer, links) {
  let html = radioList("culture", offer.choices, build.culture, (c) => `Research topic: ${c.researchTopic}`, links);
  if (build.culture) {
    html += skillList(offer.skills, "cultureSkills", build.cultureSkills, links, "Culture skills", offer.skillMax);
    const included = catalog.cultureSkills.filter((s) => !offer.skills.includes(s));
    if (included.length) html += `<p class="builder__hint">Included with any Culture: ${included.map((s) => esc(s.name)).join(", ")}.</p>`;
  } else {
    html += `<p class="builder__hint">Choose a Culture to buy its skills.</p>`;
  }
  return html;
}

function step4(build, catalog, offer, links) {
  let html = radioList("domain", offer.choices, build.domain, () => "", links);
  if (build.domain && catalog.domains.has(build.domain)) {
    const domain = catalog.domains.get(build.domain);
    const included = catalog.skillsOfGroup("Domain", domain.name).filter((s) => s.cost.kind === "included" || (s.cost.kind === "cp" && s.cost.cp === 0));
    html += `<p class="builder__hint">Included with ${esc(domain.name)}: ${included.map((s) => esc(s.name)).join(", ") || "nothing"}. Its other skills are in step 7.</p>`;
  }
  return html;
}

// The chapter's Excellencies, then the hidden table's, each a box whose value
// is the Excellency's name, which is what a build has always held (#306, #839).
// The alignment is shown and filters nothing: "You may take any Excellency
// regardless of your chosen Domain". A name the build holds that is on neither
// list was typed before there was a list; it gets a box of its own so the form
// still carries it. A chapter Excellency names the Included row of its table,
// which comes with it; the rest of the table is step 7's. A hidden Excellency
// has no table, and the step says so. A hidden Excellency's link is labelled for the
// table it lands on, not for itself: the link does not wrap, and one hidden
// name is a sentence 125 characters long, which put the page 509 px wider than
// a phone.
const sameName = (a, b) => String(a).trim().toLowerCase() === b.toLowerCase();
function alignment(x, catalog) {
  if (!x.domains.length) return "";
  return x.domains.length === catalog.domains.size ? "Universal" : `Aligned to ${x.domains.join(" / ")}`;
}
function step5(build, catalog, offer, links) {
  const item = (x) => {
    const included = x.group ? catalog.skillsOfGroup("Excellency", x.group).filter((s) => s.cost.kind === "included") : [];
    const detail = [alignment(x, catalog), x.hidden ? `Primary skill: ${x.primarySkill}` : "", included.length ? `Included: ${included.map((s) => s.name).join(", ")}` : ""].filter(Boolean).join(". ");
    return choiceItem("excellencies", "checkbox", x.name, build.excellencies.some((n) => sameName(n, x.name)), x.name, detail, pageHref(links, x.source), x.hidden ? "the hidden table" : x.name);
  };
  let html = `<ul class="builder__choices">${offer.choices.filter((x) => !x.hidden).map(item).join("")}</ul>`;
  html += `<h3 class="builder__group">Hidden Excellencies <span class="builder__cap">require Staff approval</span></h3>`;
  html += `<ul class="builder__choices">${offer.choices.filter((x) => x.hidden).map(item).join("")}</ul>`;
  if (offer.unlisted.length) {
    html += `<h3 class="builder__group">Typed into an earlier version of this page</h3><ul class="builder__choices" data-unlisted>`;
    html += offer.unlisted.map((name) => choiceItem("excellencies", "checkbox", name, true, name, "Not on the rulebook's list or its hidden table. Priced as an Excellency all the same.", "")).join("");
    html += `</ul>`;
  }
  html += `<p class="builder__cap">up to ${offer.max}, whatever your Domain</p>`;
  html += `<p class="builder__hint">An Excellency's Included skill comes with it, and the rest of its table is bought in step 7. A hidden Excellency has no skill table in the rulebook, so nothing inside one is listed or priced on this page.</p>`;
  return html;
}

function step6(build, catalog, offer, links) {
  let html = `<ul class="builder__choices">`;
  for (const e of offer.choices) {
    const first = catalog.skillsOfGroup("Expression", e.name).find((s) => s.cost.kind === "included");
    html += choiceItem("expressions", "checkbox", e.id, build.expressions.includes(e.id), e.name, first ? `Included: ${first.name}` : "", pageHref(links, e.source));
  }
  html += `</ul>`;
  html += `<p class="builder__cap">up to ${EXPRESSION_MAX} at character creation</p>`;
  return html;
}

function step7(build, catalog, offer, links) {
  const domain = build.domain ? catalog.domains.get(build.domain) : null;
  const expressions = build.expressions.map((id) => catalog.expressions.get(id)).filter(Boolean);
  let html = "";
  const domainSkills = offer.skills.filter((s) => s.groupKind === "Domain");
  if (domain) html += skillList(domainSkills, "domainSkills", build.domainSkills, links, `${domain.name} Domain skills`);
  else html += `<p class="builder__hint">Choose a Domain in step 4 to see its skills.</p>`;
  // An Excellency's table, less its Included row, which step 5 granted. A row
  // whose description says it can be purchased twice is two boxes. An Included
  // row that asks for another skill has no box to say so beside, so the line
  // goes under the heading (#845). A hidden Excellency, or a name typed before
  // step 5 had a list, has no table to show.
  const held = heldExcellencies(build, catalog);
  for (const x of held.filter((x) => x.group)) {
    const skills = offer.skills.filter((s) => s.groupKind === "Excellency" && s.group === x.group);
    html += `<h3 class="builder__group">${esc(x.name)} Excellency skills</h3>`;
    for (const { needs, skill } of PREREQUISITES) {
      const wants = catalog.byId.get(skill);
      if (wants?.group !== x.group) continue;
      html += `<p class="builder__hint" data-prerequisite="${esc(skill)}">${esc(wants.name)}, which comes with ${esc(x.name)}, has a prerequisite of the ${esc(catalog.byId.get(needs).name)} skill. It is under Open skills, below.</p>`;
    }
    html += `<ul class="builder__skills">${skills.map((s) => purchaseItems(s, "excellencySkills", build.excellencySkills, links)).join("")}</ul>`;
  }
  const tableless = [...held.filter((x) => !x.group).map((x) => x.name), ...offered(build, catalog)[5].unlisted];
  if (tableless.length) {
    html += `<p class="builder__hint" data-no-table>No skill table in the rulebook for ${tableless.map(esc).join(", ")}, so nothing inside ${tableless.length === 1 ? "it" : "them"} is listed or priced here.</p>`;
  }
  if (!held.length && !tableless.length) html += `<p class="builder__hint">Choose an Excellency in step 5 to see its skills.</p>`;
  for (const e of expressions) {
    const skills = offer.skills.filter((s) => s.groupKind === "Expression" && s.group === e.name);
    html += skillList(skills, "expressionSkills", build.expressionSkills, links, `${e.name} Expression skills`);
  }
  if (!expressions.length) html += `<p class="builder__hint">Choose an Expression in step 6 to see its skills.</p>`;
  const open = offer.skills.filter((s) => s.groupKind === "Open");
  // Quick Reflexes is the one Open skill with more than one box (#844).
  html += `<h3 class="builder__group">Open skills</h3><ul class="builder__skills">${open.map((s) => purchaseItems(s, "openSkills", build.openSkills, links)).join("")}</ul>`;
  return html;
}

function attributeStep(build, catalog, offer) {
  let html = `<ul class="builder__attributes">`;
  for (const id of offer.attributes) {
    const chart = catalog.attributes.get(id);
    const value = build.attributes[id] ?? chart.startingValue;
    // Void never reaches here: offered() lists only what the chart lets a
    // player buy, so a cost of kind "none" has no field to disable. A branch
    // for it was removed after a deliberate break of it left the suite green
    // (#147).
    const cost = chart.costToIncrease;
    const costText =
      cost.kind === "cp"
        ? `${cost.cp} CP per point`
        : `cost per point is “${cost.raw}” in the chart and is not published — this build's total becomes a floor`;
    html +=
      `<li class="builder__attribute"><label class="builder__pick"><span class="builder__name">${esc(chart.name)}</span> ` +
      `<input type="number" name="attr:${esc(id)}" value="${value}" min="${chart.startingValue}" max="${chart.max}" step="1" inputmode="numeric"></label>` +
      `<span class="builder__desc">Starts at ${chart.startingValue}, up to ${chart.max}; ${esc(costText)}.</span></li>`;
  }
  html += `</ul>`;
  return html;
}

// The signature of what a step offers. builder.js re-renders a step only when
// this changes, so ticking a box never rebuilds the box under the pointer.
// Step 5's does not move with the names it was handed from an old save: one of
// those unticked stays on the page until the next load, so it can be ticked
// back.
export function stepSignature(step, build, catalog) {
  const offer = offered(build, catalog)[step];
  const ids = [...(offer.choices ?? []).map((c) => c.id), ...(offer.skills ?? []).map((s) => s.id)];
  if (step === 1) ids.push(`aspects:${build.aspects.join(",")}`);
  if (step === 2) ids.push(`foundation:${build.foundation}`);
  if (step === 3) ids.push(`culture:${build.culture}`);
  if (step === 4) ids.push(`domain:${build.domain}`);
  if (step === 7) ids.push(`domain:${build.domain}`, `excellencies:${build.excellencies.map((n) => String(n).trim().toLowerCase()).join(",")}`, `expressions:${build.expressions.join(",")}`);
  return ids.join("|");
}

export function renderStep(step, build, catalog, links) {
  const offer = offered(build, catalog)[step];
  switch (step) {
    case 1:
      return step1(build, catalog, offer, links);
    case 2:
      return step2(build, catalog, offer, links);
    case 3:
      return step3(build, catalog, offer, links);
    case 4:
      return step4(build, catalog, offer, links);
    case 5:
      return step5(build, catalog, offer, links);
    case 6:
      return step6(build, catalog, offer, links);
    case 7:
      return step7(build, catalog, offer, links);
    default:
      return attributeStep(build, catalog, offer);
  }
}

export function stepNote(step) {
  return STEP_NOTES[step];
}

// --- the verdict ------------------------------------------------------------

function problemList(problems) {
  if (!problems.length) return "";
  return `<ul class="builder__problems">${problems.map((p) => `<li data-problem="${esc(p.code)}">${esc(p.message)}</li>`).join("")}</ul>`;
}

// The problems that belong under one step's heading.
export function renderStepProblems(verdict, step) {
  return problemList(verdict.problems.filter((p) => p.step === step));
}

// The bill. The headline is the one line that has to be right: "exactly" only
// when every purchase has a published price, "at least" otherwise, with the
// unpriced purchases named in the chart's own words rather than hidden (#305).
export function renderVerdict(verdict) {
  const { cp } = verdict;
  const headline = cp.exact
    ? `<strong>${cp.spent} CP</strong> of ${cp.budget} spent, <strong>${cp.remaining}</strong> remaining`
    : `<strong>at least ${cp.spent} CP</strong> of ${cp.budget} spent, at most <strong>${cp.remaining}</strong> remaining — ${cp.unpriced.length} purchase${cp.unpriced.length === 1 ? "" : "s"} unpriced`;
  let html = `<p class="builder__headline" data-exact="${cp.exact}">${headline}</p>`;
  if (cp.unpriced.length) {
    html += `<div class="builder__unpriced"><p><strong>Not priced by this page.</strong> The rulebook gives no number for these, so they are in the build but not in the total:</p><ul>`;
    for (const u of cp.unpriced) html += `<li><strong>${esc(u.what)}</strong> — the chart says “${esc(u.raw)}”; ${esc(u.why)}.</li>`;
    html += `</ul></div>`;
  }
  const n = verdict.problems.length;
  html += `<p class="builder__legal" data-legal="${verdict.legal}">${n === 0 ? "No problems with this build." : `${n} problem${n === 1 ? "" : "s"}, listed under the steps they belong to:`}</p>`;
  html += problemList(verdict.problems);
  if (verdict.provisional.length) {
    html += `<div class="builder__provisional"><p><strong>Needs Staff.</strong></p><ul>`;
    for (const f of verdict.provisional) html += `<li data-flag="${esc(f.code)}">${esc(f.message)}</li>`;
    html += `</ul></div>`;
  }
  html += `<h3>Purchases</h3>`;
  if (!verdict.purchases.length) html += `<p class="builder__hint">Nothing bought yet.</p>`;
  else {
    // Wrapped like every other table on the site: div.table-scroll carries
    // the horizontal scroll so the <table> keeps its rows and columns.
    html += `<div class="table-scroll"><table class="builder__bill"><thead><tr><th>Step</th><th>Purchase</th><th>CP</th></tr></thead><tbody>`;
    for (const p of verdict.purchases) html += `<tr><td>${p.step}</td><td>${esc(p.name)}</td><td>${p.cp === null ? "unpriced" : p.cp}</td></tr>`;
    html += `</tbody></table></div>`;
  }
  const granted = verdict.granted.filter((g) => g.step !== 0);
  html += `<h3>Included with your choices</h3>`;
  html += granted.length ? `<p>${granted.map((g) => esc(g.name)).join(", ")}.</p>` : `<p class="builder__hint">Nothing yet; a Culture, a Domain, each Excellency in the chapter and each Expression each include a skill.</p>`;
  const adventurer = verdict.granted.filter((g) => g.step === 0);
  html += `<h3>Adventurer skills, free to every character</h3><p>${adventurer.map((g) => esc(g.name)).join(", ")}.</p>`;
  return html;
}

// The one line that follows the player down the page: the total, and how many
// problems there are, without the lists.
export function renderSummary(verdict) {
  const { cp } = verdict;
  const n = verdict.problems.length;
  const total = cp.exact ? `${cp.spent} of ${cp.budget} CP` : `at least ${cp.spent} of ${cp.budget} CP, ${cp.unpriced.length} unpriced`;
  const state = n === 0 ? "no problems" : `${n} problem${n === 1 ? "" : "s"}`;
  return `<span class="builder__summary-cp" data-exact="${cp.exact}">${total}</span> <span class="builder__summary-state" data-legal="${verdict.legal}">${state}</span>`;
}

// --- the card ---------------------------------------------------------------
// One sheet, carried to the event. It prints the two lists the wishlist named,
// `verdict.granted` and `verdict.purchases`, each skill with its verbal and its
// attribute cost from the catalog record, then the six attributes at their
// values and the CP line. When a purchase is unpriced the CP line is the floor
// the verdict computed, in the chart's own words, never a total (#305): the
// card cannot print a number the rulebook does not. Problems and Staff flags
// print too, because a sheet that hides them is a sheet Staff will reject.

const FROM_LABEL = {
  Adventurer: () => "Adventurer",
  Aspect: () => "Aspect",
  Culture: () => "Culture",
  Domain: (skill) => `${skill.group} Domain`,
  Excellency: (skill) => `${excellencyName(skill.group)} Excellency`,
  Expression: (skill) => `${skill.group} Expression`,
  "Foundation type": (skill) => `Foundation (${skill.group})`,
  Open: () => "Open",
};

export function attributeCostLabel(attribute) {
  if (!attribute) return "";
  switch (attribute.kind) {
    case "none":
      return "—";
    case "thread":
      return "Thread skill";
    case "unlisted":
    case "blank":
      return "";
    default:
      return attribute.raw ?? "";
  }
}

function cardRow(entry, catalog, verdict) {
  // An Excellency (step 5) or an Expression (step 6) is a purchase with no
  // skill record behind it: the name is the Excellency's or the Expression's.
  const skill = entry.id ? catalog.byId.get(entry.id) ?? null : null;
  const from = skill ? (FROM_LABEL[skill.groupKind] ?? (() => skill.group))(skill) : entry.step === 6 ? "Expression" : "Excellency";
  const cost = entry.cp === null ? "unpriced" : entry.cp === 0 ? "Included" : String(entry.cp);
  let note = skill?.verbal ? `“${esc(skill.verbal)}”` : "";
  if (!skill) {
    // Its notes are the verdict's flags for that name, which is where
    // "hidden, needs Staff approval" comes from (#306).
    const hidden = verdict.provisional.some((f) => f.name === entry.name && f.code === "hidden-approval");
    note = hidden ? "Hidden — Staff approval" : "Unlocked in-game";
  }
  return (
    `<tr data-sheet-skill="${esc(entry.id ?? "")}" data-sheet-step="${entry.step}">` +
    `<td class="sheet__skill">${esc(entry.name)}</td><td>${esc(from)}</td>` +
    `<td class="sheet__cp">${esc(cost)}</td><td>${esc(attributeCostLabel(skill?.attribute))}</td><td class="sheet__verbal">${note}</td></tr>`
  );
}

const nameOf = (map, id) => (id && map.has(id) ? map.get(id).name : null);
const blank = (label) => `<span class="sheet__blank"><span class="sheet__blank-label">${label}</span> <span class="sheet__blank-line"></span></span>`;

export function renderCard(build, verdict, catalog, { url = "" } = {}) {
  const { cp } = verdict;
  const aspects = build.aspects.map((id) => nameOf(catalog.aspects, id)).filter(Boolean);
  const foundation = build.foundation ? catalog.foundations.get(build.foundation) : null;
  const expressions = build.expressions.map((id) => nameOf(catalog.expressions, id)).filter(Boolean);
  const excellencies = build.excellencies.filter((n) => String(n).trim());
  const dt = (label, value) => `<div class="sheet__choice"><dt>${label}</dt><dd>${value ? esc(value) : "<span class=\"sheet__none\">—</span>"}</dd></div>`;

  let html = `<div class="sheet" data-exact="${cp.exact}" data-legal="${verdict.legal}">`;
  html += `<header class="sheet__head"><p class="sheet__title">Numina character card</p>` +
    `<p class="sheet__unofficial">Unofficial — priced from greyversusblue.com/Numina's reading of the skill tables, not by Staff.</p>` +
    `<p class="sheet__blanks">${blank("Character")} ${blank("Player")}</p></header>`;

  html += `<dl class="sheet__choices">` +
    dt("Aspects", aspects.join(", ")) +
    dt("Foundation", foundation ? `${foundation.name} (${foundation.type})` : "") +
    dt("Culture", nameOf(catalog.cultures, build.culture)) +
    dt("Domain", nameOf(catalog.domains, build.domain)) +
    dt("Excellencies", excellencies.join(", ")) +
    dt("Expressions", expressions.join(", ")) +
    `</dl>`;

  // Step order, grants before purchases within a step, and Adventurer's step
  // 0 first: the sheet reads top to bottom the way the chapter builds.
  const rows = [...verdict.granted, ...verdict.purchases.filter((p) => p.step <= 7)].sort((a, b) => a.step - b.step || Number(a.cp !== 0) - Number(b.cp !== 0));
  html += `<div class="table-scroll"><table class="sheet__skills"><thead><tr><th>Skill</th><th>From</th><th>CP</th><th>Uses</th><th>Verbal</th></tr></thead><tbody>`;
  html += rows.map((r) => cardRow(r, catalog, verdict)).join("");
  html += `</tbody></table></div>`;

  html += `<div class="table-scroll"><table class="sheet__attributes"><thead><tr>${verdict.attributes.map((a) => `<th>${esc(a.name)}</th>`).join("")}</tr></thead>` +
    `<tbody><tr>${verdict.attributes.map((a) => `<td data-sheet-attribute="${esc(a.id)}">${a.value}</td>`).join("")}</tr></tbody></table></div>`;

  const attributeBuys = verdict.purchases.filter((p) => p.step >= 8);
  const spent = cp.exact
    ? `<strong>${cp.spent} CP</strong> of ${cp.budget} spent, ${cp.remaining} remaining.`
    : `<strong>At least ${cp.spent} CP</strong> of ${cp.budget} spent, at most ${cp.remaining} remaining.`;
  html += `<p class="sheet__cp-line" data-exact="${cp.exact}">${spent}`;
  if (attributeBuys.length) html += ` Attributes bought: ${attributeBuys.map((p) => `${esc(p.name)} (${p.cp === null ? "unpriced" : `${p.cp} CP`})`).join(", ")}.`;
  html += `</p>`;
  if (cp.unpriced.length) {
    html += `<p class="sheet__unpriced"><strong>Not in the total:</strong> ` +
      cp.unpriced.map((u) => `${esc(u.what)} — the chart says “${esc(u.raw)}”`).join("; ") + `.</p>`;
  }
  if (verdict.problems.length) {
    html += `<p class="sheet__problems"><strong>${verdict.problems.length} problem${verdict.problems.length === 1 ? "" : "s"} — not a legal build as it stands:</strong> ` +
      verdict.problems.map((p) => esc(p.message)).join("; ") + `.</p>`;
  }
  if (verdict.provisional.length) {
    html += `<p class="sheet__provisional"><strong>Needs Staff:</strong> ${verdict.provisional.map((f) => esc(f.message)).join("; ")}.</p>`;
  }
  if (url) html += `<p class="sheet__url">This build: ${esc(url)}</p>`;
  html += `</div>`;
  return html;
}
