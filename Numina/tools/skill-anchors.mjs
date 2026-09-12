// A stable anchor for every skill, injected into the built HTML.
//
// `skills.json` already knows where every skill is: `source` is the page URL
// plus the anchor of the heading its table sits under, and `id` is
// file/group/name slugged. What the page itself had was a table row with no id,
// so a player who wanted to point at Air's Last Stand could link the Domains
// page and say "scroll to Air". This turns each row into
// /mechanics/skills/domains/#airs-last-stand.
//
// The row is matched by heading + first-cell text, not by row number. Position
// would silently re-point every anchor below an inserted row; the text match
// either finds the skill it was built from or throws.

/** Slug a skill name the way the record ids already are. */
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Straight apostrophes and single spaces, so markdown-it's typographer output
 *  ("Air’s Touch") compares equal to the record's name ("Air's Touch"). */
export function normalizeName(text) {
  return String(text)
    .replace(/['’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(html) {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// The extractor splits a trailing run of asterisks off the name into
// `footnote` (aspects.md's "Tongue of Aspect*"), so the cell keeps a marker the
// record does not. Same rule here, or that one row never matches.
function cellText(html) {
  const text = normalizeName(decodeEntities(html.replace(/<[^>]+>/g, "")));
  const marked = text.match(/^(.*?)(\*+)$/);
  return marked ? marked[1].trim() : text;
}

/**
 * Anchor per skill record, keyed by id.
 *
 * The anchor is the name segment of the id — that is the half a player would
 * paste. Four tables on the Foundations page each carry a `Holding`, so a name
 * that is not unique on its own page falls back to group-name
 * (#place-skills-holding). Uniqueness is per page because that is the scope a
 * fragment resolves in.
 */
export function skillAnchors(skills) {
  const perPage = new Map();
  for (const skill of skills) {
    const page = skill.source.split("#")[0];
    const short = slugify(skill.name);
    if (!perPage.has(page)) perPage.set(page, new Map());
    const counts = perPage.get(page);
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  const anchors = new Map();
  for (const skill of skills) {
    const page = skill.source.split("#")[0];
    const short = slugify(skill.name);
    const unique = perPage.get(page).get(short) === 1;
    anchors.set(skill.id, unique ? short : `${slugify(skill.group)}-${short}`);
  }
  return anchors;
}

/** The skills of one page, grouped for the injector: heading anchor + name → anchor. */
export function pageIndex(skills) {
  const anchors = skillAnchors(skills);
  const pages = new Map();
  for (const skill of skills) {
    const [page, heading] = skill.source.split("#");
    if (!pages.has(page)) pages.set(page, new Map());
    const key = `${heading}|${normalizeName(skill.name)}`;
    const entry = { skill, anchor: anchors.get(skill.id) };
    if (pages.get(page).has(key)) {
      throw new Error(`skill-anchors: two records share ${page}#${heading} "${skill.name}"`);
    }
    // Two rows on one page cannot carry the same id: the fragment would land on
    // whichever came first and the other skill would be unlinkable. The build is
    // the place to find that out, not a reader's pasted link.
    const clash = [...pages.get(page).values()].find((e) => e.anchor === entry.anchor);
    if (clash) {
      throw new Error(
        `skill-anchors: "${skill.name}" and "${clash.skill.name}" both want ${page}#${entry.anchor}`
      );
    }
    pages.get(page).set(key, entry);
  }
  return pages;
}

/**
 * Put an id on every skill row of one page's HTML and a copyable link in its
 * first cell. Throws when a record in the data has no row in the HTML, or when
 * an anchor would collide with an id the page already emits — either means the
 * markdown and `skills.json` have drifted apart, which is the whole reason the
 * data is generated.
 */
export function addSkillAnchors(html, pageUrl, pages) {
  const wanted = pages.get(pageUrl);
  if (!wanted) return { html, added: 0 };

  const existingIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const { skill, anchor } of wanted.values()) {
    if (existingIds.has(anchor)) {
      throw new Error(
        `skill-anchors: "${skill.name}" wants #${anchor} on ${pageUrl}, which is already an id on that page`
      );
    }
  }

  const seen = new Set();
  let heading = "";
  let added = 0;

  const out = html.replace(
    /<h([1-6])\b[^>]*\sid="([^"]+)"|<tr>\s*<td>([\s\S]*?)<\/td>/g,
    (match, level, headingId, firstCell) => {
      if (headingId !== undefined) {
        heading = headingId;
        return match;
      }
      const key = `${heading}|${cellText(firstCell)}`;
      const entry = wanted.get(key);
      if (!entry || seen.has(key)) return match;
      seen.add(key);
      added++;
      const { anchor, skill } = entry;
      // The mark is drawn by CSS, like the heading permalink: Pagefind builds
      // result text from the DOM, so a real character here would read back as
      // part of the skill's name.
      // A bare "#anchor", exactly like the heading permalink: clicking it puts
      // the absolute URL in the address bar, and the page never links itself.
      const link =
        `<a class="skill-anchor" href="#${anchor}"` +
        ` aria-label="Link to ${skill.name.replace(/"/g, "&quot;")}" title="Link to this skill"` +
        ` data-pagefind-ignore=""><span class="skill-anchor__mark" aria-hidden="true"></span></a>`;
      return `<tr id="${anchor}"><td>${firstCell}${link}</td>`;
    }
  );

  if (seen.size !== wanted.size) {
    const missing = [...wanted.entries()]
      .filter(([key]) => !seen.has(key))
      .map(([, { skill }]) => `${skill.source} "${skill.name}"`);
    throw new Error(
      `skill-anchors: ${missing.length} record(s) on ${pageUrl} have no matching table row:\n  ${missing.join("\n  ")}`
    );
  }
  return { html: out, added };
}
