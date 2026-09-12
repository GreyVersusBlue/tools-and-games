import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { pageIndex, skillAnchors, addSkillAnchors } from "./tools/skill-anchors.mjs";
import { autolink, buildVocabulary, mainRegion } from "./tools/autolink.mjs";

export const PATH_PREFIX = "/Numina/";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(join(here, rel), "utf8"));

// A page gets an "On this page" table of contents when it is long enough to be
// hard to scan AND actually has structure to navigate. Frontmatter `toc: true`
// or `toc: false` overrides the heuristic either way.
const TOC_MIN_WORDS = 1200;
const TOC_MIN_HEADINGS = 4;
// h3 groups longer than this render as multiple columns so they stay scannable
// (Core Rules' "Effects and Calls" alone has 55 subsections).
const TOC_WIDE_GROUP = 8;

// Visible, copyable permalink on every h2/h3. The § mark is drawn by CSS rather
// than sitting in the markup: Pagefind builds its sub-result titles from the
// heading's own text, so any real characters here (a symbol, or visually hidden
// label text) would show up in search results as "Vitality §Link to this
// section". The accessible name comes from aria-label instead.
const renderPermalink = markdownItAnchor.permalink.linkInsideHeader({
  class: "heading-anchor",
  symbol: '<span class="heading-anchor__mark" aria-hidden="true"></span>',
  placement: "after",
  ariaHidden: false,
  renderAttrs: () => ({
    "aria-label": "Link to this section",
    title: "Link to this section",
    "data-pagefind-ignore": "",
  }),
});

function stripTags(html) {
  return html
    .replace(/<a class="heading-anchor"[\s\S]*?<\/a>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Build the TOC from the *rendered* page HTML, so it reflects exactly the
// heading ids markdown-it-anchor emitted (no second slugify to drift out of sync).
function tocData(content) {
  const html = String(content ?? "");
  const groups = [];
  for (const m of html.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const [, level, id, inner] = m;
    const text = stripTags(inner);
    if (!text) continue;
    if (level === "2" || groups.length === 0) groups.push({ id, text, children: [] });
    else groups[groups.length - 1].children.push({ id, text });
  }
  for (const g of groups) g.wide = g.children.length > TOC_WIDE_GROUP;
  const count = groups.reduce((n, g) => n + 1 + g.children.length, 0);
  const words = stripTags(html).split(/\s+/).filter(Boolean).length;
  return {
    groups,
    count,
    words,
    qualifies: words >= TOC_MIN_WORDS && count >= TOC_MIN_HEADINGS,
  };
}

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  const md = markdownIt({ html: true, typographer: true }).use(markdownItAnchor, {
    tabIndex: false,
    // Ids on every heading level (glossary/search anchors rely on them);
    // the visible permalink only on the levels players cite.
    permalink: (slug, opts, state, idx) => {
      const tag = state.tokens[idx].tag;
      if (tag === "h2" || tag === "h3") renderPermalink(slug, opts, state, idx);
    },
  });
  eleventyConfig.setLibrary("md", md);

  eleventyConfig.addFilter("tocData", tocData);

  // Look up a built page by URL. Replaces a `collections.all |
  // selectattr("url", "equalto", pg.url) | first` chain in the two section
  // landing pages: Nunjucks has no `equalto` test, so selectattr fell through
  // to a plain truthiness filter and every card rendered collections.all[0]'s
  // summary. It also made the build machine-dependent, because collections.all
  // is ordered by file date and file dates do not survive a git clone.
  eleventyConfig.addFilter("pageByUrl", (pages, url) =>
    pages.find((page) => page.url === url)
  );

  // Which nav section a given page belongs to, by URL prefix (sidebar) or by
  // its own frontmatter `section` title (page layout crumb) — one lookup each
  // so a new top-level section only needs a nav.json entry, no template edits.
  eleventyConfig.addFilter("sectionForUrl", (sections, url) =>
    sections.find((s) => url.startsWith(s.url))
  );
  eleventyConfig.addFilter("sectionForTitle", (sections, title) =>
    sections.find((s) => s.title === title)
  );

  // Converted book content is plain markdown — no template syntax inside .md files.
  eleventyConfig.setTemplateFormats(["md", "njk", "html"]);
  // Passthrough-only docs, not pages.
  eleventyConfig.ignores.add("src/fonts/README.md");
  eleventyConfig.setFrontMatterParsingOptions({ excerpt: false });

  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // Every published page's URL, sorted. Sorted rather than left in date order
  // because file dates do not survive a git clone, and a sitemap that reshuffles
  // on a fresh checkout would fail the "did you rebuild?" check in CI.
  eleventyConfig.addCollection("sitemap", (api) =>
    api.getAll().map((item) => item.url).filter(Boolean).sort()
  );

  eleventyConfig.addCollection("nations", (api) =>
    api
      .getFilteredByGlob("src/lore/nations/*.md")
      .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99))
  );

  // --- Skill anchors and cross-links -------------------------------------
  //
  // Both run as transforms, after EleventyHtmlBasePlugin has already rewritten
  // the page's own hrefs, so both emit URLs that carry the path prefix. Both are
  // scoped to <main>: the sidebar links every page in the section including this
  // one, and linking terms in navigation chrome would be noise.
  const skills = readJson("src/_data/skills.json").skills;
  const anchorPages = pageIndex(skills);
  const anchorsById = skillAnchors(skills);

  // The canonical link to one skill, for the index page. Same anchor the
  // transform below puts on the row, from the same map — the index cannot point
  // at a fragment the chapter does not have.
  eleventyConfig.addFilter("skillHref", (skill) => {
    const anchor = anchorsById.get(skill.id);
    if (!anchor) throw new Error(`skillHref: no anchor for ${skill.id}`);
    return `${skill.source.split("#")[0]}#${anchor}`;
  });
  // The builder page inlines skills.json and one URL per skill id. The URLs
  // come from the same anchor map the transform below stamps on the chapter
  // rows, already carrying the path prefix because a JSON island is not an
  // href attribute and EleventyHtmlBasePlugin will not rewrite it.
  eleventyConfig.addFilter("skillLinks", (skillList) => {
    const hrefs = {};
    for (const skill of skillList) {
      const anchor = anchorsById.get(skill.id);
      if (!anchor) throw new Error(`skillLinks: no anchor for ${skill.id}`);
      hrefs[skill.id] = `${PATH_PREFIX.replace(/\/$/, "")}${skill.source.split("#")[0]}#${anchor}`;
    }
    return { hrefs, prefix: PATH_PREFIX };
  });
  // JSON inside a <script type="application/json"> is inert except for one
  // sequence: "</" would close the element early. Escaped as "<\/", which is
  // the same string to JSON.parse.
  eleventyConfig.addFilter("jsonIsland", (value) => JSON.stringify(value).replace(/<\//g, "<\\/"));

  let vocabulary = null;
  let summary = null;
  // Reset per build, not per config load: `eleventy --serve` reruns the
  // transforms on every save and the counters would otherwise keep climbing.
  const resetSummary = () => {
    summary = { links: 0, pages: 0, byKind: {}, byTerm: new Map(), anchors: 0 };
  };
  resetSummary();
  eleventyConfig.on("eleventy.before", resetSummary);

  eleventyConfig.addTransform("skillAnchors", function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    const region = mainRegion(content);
    if (!region) return content;
    const { html, added } = addSkillAnchors(
      content.slice(region.start, region.end),
      this.page.url,
      anchorPages
    );
    summary.anchors += added;
    return content.slice(0, region.start) + html + content.slice(region.end);
  });

  eleventyConfig.addTransform("autolink", function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    const region = mainRegion(content);
    if (!region || /data-autolink="off"/.test(region.head)) return content;
    if (!vocabulary) vocabulary = buildVocabulary(here);
    const { html, linked } = autolink(content.slice(region.start, region.end), {
      pageUrl: this.page.url,
      ...vocabulary,
      prefix: PATH_PREFIX,
    });
    if (linked.length) {
      summary.pages++;
      summary.links += linked.length;
      for (const hit of linked) {
        summary.byKind[hit.kind] = (summary.byKind[hit.kind] ?? 0) + 1;
        summary.byTerm.set(hit.term, (summary.byTerm.get(hit.term) ?? 0) + 1);
      }
    }
    return content.slice(0, region.start) + html + content.slice(region.end);
  });

  // The diff this pair produces is every ported chapter's HTML. The summary is
  // what to read instead (the wishlist's Phase 2 says so in as many words).
  eleventyConfig.on("eleventy.after", () => {
    if (!vocabulary) return;
    const kinds = Object.entries(summary.byKind)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    // Ties broken by name: pages are transformed concurrently, so insertion
    // order is not stable and two runs of the same build should print the same
    // line.
    const top = [...summary.byTerm.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([t, n]) => `${t} ×${n}`)
      .join(", ");
    const unlinked = vocabulary.terms.filter((t) => !summary.byTerm.has(t.term)).length;
    console.log(
      `[numina] ${summary.anchors} skill anchors; ` +
        `${summary.links} cross-links on ${summary.pages} pages (${kinds}); ` +
        `${vocabulary.terms.length} terms, ${unlinked} never matched, ` +
        `${vocabulary.skipped.length} not eligible`
    );
    console.log(`[numina] most linked: ${top}`);
  });

  return {
    dir: {
      input: "src",
      output: ".",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    pathPrefix: PATH_PREFIX,
  };
}
