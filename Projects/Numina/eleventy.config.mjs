import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

export const PATH_PREFIX = "/Projects/Numina/";

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

  eleventyConfig.setLibrary(
    "md",
    markdownIt({ html: true, typographer: true }).use(markdownItAnchor, {
      tabIndex: false,
      // Ids on every heading level (glossary/search anchors rely on them);
      // the visible permalink only on the levels players cite.
      permalink: (slug, opts, state, idx) => {
        const tag = state.tokens[idx].tag;
        if (tag === "h2" || tag === "h3") renderPermalink(slug, opts, state, idx);
      },
    })
  );

  eleventyConfig.addFilter("tocData", tocData);

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
