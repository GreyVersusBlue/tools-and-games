import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

export const PATH_PREFIX = "/Projects/Numina/";

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

  // Converted book content is plain markdown — no template syntax inside .md files.
  eleventyConfig.setTemplateFormats(["md", "njk", "html"]);
  // Passthrough-only docs, not pages.
  eleventyConfig.ignores.add("src/fonts/README.md");
  eleventyConfig.setFrontMatterParsingOptions({ excerpt: false });

  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

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
