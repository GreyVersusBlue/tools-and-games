import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

export const PATH_PREFIX = "/Projects/Numina/";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  eleventyConfig.setLibrary(
    "md",
    markdownIt({ html: true, typographer: true }).use(markdownItAnchor, {
      tabIndex: false,
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
