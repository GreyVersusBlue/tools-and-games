// Build-time cross-linking.
//
// CONTENT-GUIDE rule 5 says to link between pages; 39 ported chapters contain
// zero links, because nobody was going to hand-link 39 chapters. This links the
// first mention of each glossary term, nation and skill name in a page's
// rendered body to its canonical page, and nothing else:
//
//   - first mention per page only, and a mention the page already links itself
//     counts as that first mention, so a hand-written link is never doubled and
//     a second run over the output changes nothing;
//   - never inside a heading, a table header, an existing link, a code span, or
//     a script;
//   - never to the page it is already on.
//
// The term list is derived, not written down: skills.json, the nations
// collection and the glossary's own `##` headings. What *is* written down is
// src/_data/autolink.json, the terms too ambiguous to link, each with the
// collision it avoids.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { skillAnchors } from "./skill-anchors.mjs";

const SKIP_TAGS = new Set(["a", "code", "pre", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6", "th"]);

/** Terms whose text is a word the chapters use in its ordinary sense are worth
 *  linking only when the match is unmistakable. One-word skill names are not:
 *  `Attack`, `Shield`, `Research` and `Living` are skills *and* words on every
 *  page they appear. Glossary terms and nations are proper nouns of the setting
 *  and stay in at one word. */
const MIN_SKILL_WORDS = 2;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern for one term: apostrophes and quotes match either shape (the
 *  typographer curls them in the HTML but not in the JSON), runs of whitespace
 *  match any whitespace, and an optional plural `s` comes along so "Domains"
 *  links as readily as "Domain". */
function termPattern(term) {
  const body = escapeRegex(term)
    .replace(/['’]/g, "['’]")
    .replace(/\s+/g, "\\s+");
  const plural = /[a-z]$/i.test(term) && !/s$/i.test(term) ? "s?" : "";
  return `(?<![A-Za-z0-9_])${body}${plural}(?![A-Za-z0-9_])`;
}

/**
 * The term list, plus what was left out and why, so the build can print a
 * summary instead of asking anyone to read a 39-chapter diff.
 *
 * @param {object} sources
 * @param {Array} sources.skills      skills.json's `skills`
 * @param {Map}   sources.skillAnchors id → anchor, from skill-anchors.mjs
 * @param {Array} sources.nations     [{ name, url }]
 * @param {Array} sources.glossary    [{ term, anchor }]
 * @param {Array} sources.exclude     [{ term, why }]
 */
export function buildTerms({ skills, skillAnchors, nations, glossary, exclude }) {
  const excluded = new Map(exclude.map((e) => [e.term, e.why]));
  const terms = new Map();
  const dropped = new Map();
  const skipped = [];

  const add = (term, href, kind) => {
    if (excluded.has(term)) {
      skipped.push({ term, kind, why: `excluded: ${excluded.get(term)}` });
      return;
    }
    // Two different pages claim the same words. Neither can be linked without
    // guessing which one the sentence meant, so the term stays dropped however
    // many more records claim it (four tables carry a `Holding`).
    if (dropped.has(term)) return;
    if (terms.has(term)) {
      const first = terms.get(term);
      if (first.href !== href) {
        terms.delete(term);
        dropped.set(term, true);
        skipped.push({ term, kind, why: `ambiguous: ${first.href} and ${href}` });
      }
      return;
    }
    terms.set(term, { term, href, kind });
  };

  for (const g of glossary) add(g.term, `/lore/glossary/#${g.anchor}`, "glossary");
  for (const n of nations) add(n.name, n.url, "nation");
  for (const skill of skills) {
    if (skill.name.trim().split(/\s+/).length < MIN_SKILL_WORDS) {
      skipped.push({ term: skill.name, kind: "skill", why: "one word: reads as an ordinary noun" });
      continue;
    }
    const [page] = skill.source.split("#");
    add(skill.name, `${page}#${skillAnchors.get(skill.id)}`, "skill");
  }

  // Longest first, so "Aspect Armor" wins over "Aspect" at the same position.
  const ordered = [...terms.values()].sort((a, b) => b.term.length - a.term.length);
  const pattern = ordered.length
    ? new RegExp(ordered.map((t) => termPattern(t.term)).join("|"), "g")
    : null;
  const lookup = new Map();
  for (const t of ordered) lookup.set(t.term.replace(/['’]/g, "'").replace(/\s+/g, " ").toLowerCase(), t);
  return { terms: ordered, pattern, lookup, skipped };
}

/**
 * The `<main>` element's contents, by offset. Everything here works on the body
 * region only: the sidebar links every page in the section including the one
 * being rendered, and cross-linking navigation chrome would be noise.
 */
export function mainRegion(html) {
  const open = html.indexOf("<main");
  if (open === -1) return null;
  const start = html.indexOf(">", open) + 1;
  const end = html.lastIndexOf("</main>");
  return end > start ? { start, end, head: html.slice(open, start) } : null;
}

/**
 * Link the first mention of each term in one page's body HTML.
 *
 * Returns the rewritten HTML and the terms it linked. Idempotent: run it over
 * its own output and nothing moves, because a mention already wrapped in a link
 * to the same target is what marks the term used.
 */
export function autolink(html, { pageUrl, terms, pattern, lookup, prefix = "/" }) {
  if (!pattern) return { html, linked: [] };
  const href = (url) => prefix + url.replace(/^\//, "");

  // Any target this page already links — hand-written by an author, or added by
  // a previous run of this function — is spent before the scan starts.
  const used = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/g)) used.add(m[1]);

  const linked = [];
  const skipDepth = [];
  let out = "";
  let cursor = 0;

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>|<!--[\s\S]*?-->/g;
  let tag;
  const flushText = (text) => {
    if (skipDepth.length > 0) return text;
    return text.replace(pattern, (match) => {
      const key = match.replace(/['’]/g, "'").replace(/\s+/g, " ").toLowerCase();
      const entry = lookup.get(key) ?? lookup.get(key.replace(/s$/, ""));
      if (!entry) return match;
      const target = href(entry.href);
      if (used.has(target)) return match;
      if (entry.href.split("#")[0] === pageUrl) return match; // never self-link
      used.add(target);
      linked.push({ term: entry.term, kind: entry.kind, href: entry.href, page: pageUrl });
      return `<a class="autolink" href="${target}">${match}</a>`;
    });
  };

  while ((tag = tagRe.exec(html)) !== null) {
    out += flushText(html.slice(cursor, tag.index));
    const [raw, closing, name, selfClosing] = tag;
    if (name) {
      const lower = name.toLowerCase();
      if (SKIP_TAGS.has(lower) && !selfClosing) {
        if (closing) {
          const at = skipDepth.lastIndexOf(lower);
          if (at !== -1) skipDepth.splice(at, 1);
        } else skipDepth.push(lower);
      }
    }
    out += raw;
    cursor = tag.index + raw.length;
  }
  out += flushText(html.slice(cursor));
  return { html: out, linked };
}

/**
 * `## Heading` lines of the glossary, with the ids markdown-it-anchor gives
 * them. A trailing parenthetical is dropped from the term — the heading reads
 * "Character Points (CP)" and the prose says "Character Points".
 *
 * The heading is rendered before it is slugged. markdown-it-anchor slugs the
 * inline token's *content*, which the typographer has already been over, so
 * "Fortune's Bend" is `fortune%E2%80%99s-bend` on the page and slugging the raw
 * markdown would point thirteen links at a fragment that does not exist.
 */
export function glossaryTerms(markdown, slugify, renderInline) {
  const out = [];
  for (const m of markdown.matchAll(/^##\s+(.+?)\s*$/gm)) {
    const heading = m[1].trim();
    const rendered = renderInline(heading).replace(/<[^>]+>/g, "");
    out.push({ term: heading.replace(/\s*\([^)]*\)\s*$/, "").trim(), anchor: slugify(rendered) });
  }
  return out;
}

/**
 * The whole vocabulary, read off the repo. One loader, called by
 * eleventy.config.mjs at build time and by test/smoke.mjs afterwards — two
 * copies of this wiring would be two things to keep in step, and the second
 * would be the one testing itself.
 *
 * Nation URLs come from the filename, which is where Eleventy gets them too
 * (no nation sets a permalink). If that ever stops being true the smoke test's
 * link resolver says so on the next run.
 */
export function buildVocabulary(root, { exclude } = {}) {
  const md = markdownIt({ html: true, typographer: true });
  const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
  const skills = readJson("src/_data/skills.json").skills;

  const nationsDir = join(root, "src/lore/nations");
  // Sorted: readdirSync's order is filesystem-dependent, and the committed
  // build has to be the same on a fresh CI runner as it is here.
  const nations = readdirSync(nationsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const front = readFileSync(join(nationsDir, file), "utf8").match(/^name:\s*(.+?)\s*$/m);
      if (!front) throw new Error(`autolink: ${file} has no name in its frontmatter`);
      return { name: front[1].replace(/^["']|["']$/g, ""), url: `/lore/nations/${file.replace(/\.md$/, "")}/` };
    });

  return buildTerms({
    skills,
    skillAnchors: skillAnchors(skills),
    nations,
    glossary: glossaryTerms(
      readFileSync(join(root, "src/lore/glossary.md"), "utf8"),
      markdownItAnchor.defaults.slugify,
      (text) => md.renderInline(text)
    ),
    exclude: exclude ?? readJson("src/_data/autolink.json").exclude,
  });
}
