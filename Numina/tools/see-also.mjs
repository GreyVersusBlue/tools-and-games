// "See also" blocks, generated from the data rather than written by hand.
//
// Three relations, and all three already exist as data the site ships:
//
//   Domain     → the Excellencies aligned to it. skills.json's Excellency
//                tables carry `domains`, read out of excellencies.md's own
//                heading structure by tools/extract-skills.mjs.
//   Nation     → its culture row, its Research Topic and the culture skills,
//                from skills.json's `cultures`; plus every timeline event that
//                names it, from timeline.json's `nations`.
//   Event      → the nations it names. Same `nations` key, read the other way.
//
// A hand-written list of these would be wrong within two rulebook versions:
// Phase 5 alone moved skills.json from 189 skills in 29 tables to 428 in 59.
// Nothing here names an Excellency, a skill or an event; the only thing a human
// writes is each nation's `culture` frontmatter, which is the nation's own data
// and is checked both ways by test/smoke.mjs (16 nations, 16 cultures, one
// each).
//
// Blocks carry data-pagefind-ignore. They are navigation, and every target in
// them is indexed on the page it lives on: without it, "Ballista" would match
// the Domains chapter as well as the Excellencies chapter, and the first hit
// would be the one that only links to the second.
//
// A block is a <div> with a heading, not an <aside>. <aside> is a complementary
// landmark and a landmark needs a unique accessible name: the Domains chapter
// carries six of these, one per Domain, and six landmarks called "See also"
// fail html-validate's unique-landmark (and axe's landmark-unique) exactly as
// hard as six unnamed ones. A nation page would also have put a second unnamed
// complementary beside the infobox. The heading is what names the block, which
// is what a reader navigating by heading uses anyway (#326).
import { skillAnchors } from "./skill-anchors.mjs";

// The id a timeline event gets on /lore/history/, and the fragment a nation page
// links it by. Prefixed so it cannot collide with a markdown heading's own id on
// that page — html-validate's no-dup-id is the check that would catch it if it
// ever did.
export function eventAnchor(title) {
  const slug = String(title)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `event-${slug}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Domain name → the Excellencies aligned to it, in chapter order.
 *
 * Built from the Excellency tables' `domains`, so a Domain with no Excellency
 * aligned to it gets no entry and an Excellency aligned to a Domain that does
 * not exist is already an error in extract-skills.mjs.
 */
export function excellenciesByDomain(skills) {
  const byDomain = new Map();
  for (const table of skills.tables) {
    if (table.groupKind !== "Excellency") continue;
    for (const domain of table.domains ?? []) {
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push({ text: table.group, href: table.source });
    }
  }
  return byDomain;
}

/**
 * Every section-level See also block on the site, as page URL → heading id →
 * groups. Today that is the Domains chapter and nothing else.
 *
 * Both the page and the heading id come from the Domain table's own `source`
 * (`/mechanics/skills/domains/#air`), which extract-skills.mjs wrote with
 * markdown-it-anchor's slugify. Recomputing the id here would be a second
 * slugify to drift out of sync with the first.
 */
export function sectionBlocks(skills) {
  const byDomain = excellenciesByDomain(skills);
  const pages = new Map();
  for (const table of skills.tables) {
    if (table.groupKind !== "Domain") continue;
    const links = byDomain.get(table.group);
    if (!links) continue;
    const [page, id] = table.source.split("#");
    if (!pages.has(page)) pages.set(page, {});
    pages.get(page)[id] = [{ label: "Excellencies", items: links }];
  }
  return pages;
}

/**
 * One nation's See also groups: its culture, and its place in the timeline.
 *
 * `nation` is { name, culture, slug }. The culture has to resolve — a nation
 * whose `culture` names no row in skills.json throws here rather than rendering
 * a block with a hole in it.
 */
export function nationSeeAlso(skills, timeline, nation) {
  const culture = skills.cultures.find((c) => c.name === nation.culture);
  if (!culture) {
    throw new Error(
      `see-also: ${nation.name} names culture ${JSON.stringify(nation.culture)}, which is not in skills.json`
    );
  }
  // Each culture skill by its own row anchor, not by the table heading: the same
  // map skill-anchors.mjs stamps on the rows, so a link here lands on the row
  // rather than at the top of a six-row table.
  const anchors = skillAnchors(skills.skills);
  const cultureSkills = skills.skills
    .filter((s) => s.groupKind === "Culture")
    .map((s) => ({ ...s, rowHref: `${s.source.split("#")[0]}#${anchors.get(s.id)}` }));
  const events = timeline
    .filter((ev) => (ev.nations ?? []).includes(nation.slug))
    .sort((a, b) => a.sort - b.sort);

  const groups = [
    {
      label: "Culture",
      items: [{ text: culture.name, href: culture.source }],
    },
    {
      label: "Research Topic",
      items: [{ text: culture.researchTopic, href: culture.source }],
    },
    {
      label: "Culture skills",
      items: cultureSkills.map((s) => ({ text: s.name, href: s.rowHref })),
    },
  ];
  if (events.length) {
    groups.push({
      label: "In the timeline",
      items: events.map((ev) => ({
        text: `${ev.title} (${ev.date})`,
        href: `/lore/history/#${eventAnchor(ev.title)}`,
      })),
    });
  }
  return groups;
}

/**
 * One See also block. `groups` is [{ label, items: [{ text, href }] }].
 *
 * `prefix` is for the transform below, which runs after EleventyHtmlBasePlugin
 * and so has to write the path prefix itself. A template's output is still ahead
 * of that plugin, so a filter leaves it at the default.
 */
export function renderSeeAlso(groups, { level = 2, prefix = "/" } = {}) {
  const href = (url) => escapeHtml(prefix + String(url).replace(/^\//, ""));
  const rows = groups
    .filter((g) => g.items.length)
    .map((g) => {
      const links = g.items
        .map((i) => `<a href="${href(i.href)}">${escapeHtml(i.text)}</a>`)
        .join(", ");
      return `<dt>${escapeHtml(g.label)}</dt><dd>${links}</dd>`;
    });
  if (!rows.length) return "";
  return (
    `<div class="see-also" data-pagefind-ignore>` +
    `<h${level} class="see-also__title">See also</h${level}>` +
    `<dl>${rows.join("")}</dl>` +
    `</div>`
  );
}

/**
 * Put a See also block at the end of every `###` section whose id is a key of
 * `blocks`. Used for the Domains chapter, which is plain markdown and so cannot
 * carry template syntax (eleventy.config.mjs sets markdownTemplateEngine:
 * false) — the same reason the autolink and skill-anchor passes are transforms.
 *
 * "The end of the section" is the next h2 or h3, or the end of the region.
 * Inserting after the heading instead would put the block above the prose it is
 * a footnote to.
 *
 * Idempotent: a section that already carries a see-also block is left alone, so
 * running this over its own output moves nothing.
 */
export function insertSectionSeeAlso(html, blocks, { prefix = "/" } = {}) {
  const headings = [...html.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>/g)];
  let added = 0;
  const edits = [];
  for (let i = 0; i < headings.length; i++) {
    const [match, , id] = headings[i];
    const groups = blocks[id];
    if (!groups) continue;
    const start = headings[i].index + match.length;
    const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
    if (html.slice(start, end).includes('class="see-also"')) continue;
    edits.push({ at: end, html: renderSeeAlso(groups, { level: 4, prefix }) });
    added++;
  }
  let out = html;
  for (const edit of edits.reverse()) out = out.slice(0, edit.at) + edit.html + out.slice(edit.at);
  return { html: out, added };
}
