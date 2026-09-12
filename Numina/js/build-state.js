// How a Numina build is kept and shared: the localStorage record and the URL
// fragment. Pure, no DOM, no storage access of its own — build-rules.js does
// the arithmetic, this file does the packing, and builder.js is the only thing
// that touches the browser.
//
// Two rules from the repo's CLAUDE.md shape it. The storage key never changes
// (#36): a renamed key abandons every player mid-build. And `repair` runs on
// every load (#37): whatever comes out of storage or a pasted URL is coerced
// to the build shape before build-rules.js sees it, so an old save, a hand-
// edited fragment or a truncated paste prices as a build with problems rather
// than throwing. Unknown ids are not dropped here — priceBuild() reports them
// by name, which is what a player pasting a build from an older rulebook
// wants to see.

// Matches `numina.theme`, the one key the site already keeps.
export const STORAGE_KEY = "numina.build";
export const SAVE_VERSION = 1;

// Fragment keys, short because the fragment is meant to be pasted into a chat.
// The order here is the book's step order, which is also the order the
// fragment is written in.
const FRAGMENT_KEYS = [
  ["a", "aspects"],
  ["as", "aspectSkills"],
  ["f", "foundation"],
  ["fs", "foundationSkills"],
  ["c", "culture"],
  ["cs", "cultureSkills"],
  ["d", "domain"],
  ["ds", "domainSkills"],
  ["x", "excellencies"],
  ["e", "expressions"],
  ["es", "expressionSkills"],
  ["o", "openSkills"],
];
const LIST_FIELDS = new Set(FRAGMENT_KEYS.filter(([, field]) => field !== "foundation" && field !== "culture" && field !== "domain").map(([, f]) => f));
const SINGLE_FIELDS = ["foundation", "culture", "domain"];

// Skill ids carry "/" and a typed Excellency name can carry anything, so each
// value is percent-encoded. encodeURIComponent already escapes the three
// separators this format uses (",", "&", "="); "/" is put back afterwards
// because it is legal in a fragment and the ids read better with it.
function encodeValue(text) {
  return encodeURIComponent(String(text)).replace(/%2F/gi, "/");
}
function decodeValue(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const cleanList = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const cleanSingle = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Coerces anything to the shape priceBuild() reads. Every list is an array of
// non-empty strings; every single choice is a string or null; every attribute
// is a whole number, or dropped so the chart's starting value applies. Runs on
// every load, not only on version drift.
export function repair(input, catalog) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const build = {};
  for (const field of LIST_FIELDS) build[field] = cleanList(raw[field]);
  for (const field of SINGLE_FIELDS) build[field] = cleanSingle(raw[field]);
  build.attributes = {};
  const known = catalog ? [...catalog.attributes.keys()] : Object.keys(raw.attributes ?? {});
  for (const id of known) {
    const value = raw.attributes?.[id];
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isInteger(n)) build.attributes[id] = n;
    else if (catalog) build.attributes[id] = catalog.attributes.get(id).startingValue;
  }
  return build;
}

// True when the build chooses nothing and buys nothing, which is when the
// fragment is empty and storage is better cleared than written.
export function isEmpty(build, catalog) {
  const b = repair(build, catalog);
  if ([...LIST_FIELDS].some((f) => b[f].length)) return false;
  if (SINGLE_FIELDS.some((f) => b[f])) return false;
  return !catalog || [...catalog.attributes].every(([id, a]) => b.attributes[id] === a.startingValue);
}

// The build as a URL fragment: `a=arcane&f=military&x=Deadeye&at=purpose:6`.
// Only what differs from the empty build is written, so a fresh page has no
// fragment at all and an attribute at its starting value is not mentioned.
export function encodeBuild(input, catalog) {
  const build = repair(input, catalog);
  const parts = [];
  for (const [key, field] of FRAGMENT_KEYS) {
    const value = build[field];
    if (Array.isArray(value)) {
      if (value.length) parts.push(`${key}=${value.map(encodeValue).join(",")}`);
    } else if (value) {
      parts.push(`${key}=${encodeValue(value)}`);
    }
  }
  const raised = Object.entries(build.attributes).filter(([id, n]) => !catalog || n !== catalog.attributes.get(id)?.startingValue);
  if (raised.length) parts.push(`at=${raised.map(([id, n]) => `${encodeValue(id)}:${n}`).join(",")}`);
  return parts.join("&");
}

// The inverse. A fragment nothing wrote — a heading id, a stray word — decodes
// to the empty build rather than throwing, because a link to this page with
// `#step-5` on it is a link, not a build.
export function decodeBuild(fragment, catalog) {
  const text = String(fragment ?? "").replace(/^#/, "");
  const raw = { attributes: {} };
  const fieldOf = new Map(FRAGMENT_KEYS);
  for (const part of text.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const values = part.slice(eq + 1).split(",").map(decodeValue);
    if (key === "at") {
      for (const pair of values) {
        const colon = pair.lastIndexOf(":");
        if (colon < 0 || !pair.slice(colon + 1).trim()) continue;
        raw.attributes[pair.slice(0, colon)] = Number(pair.slice(colon + 1));
      }
    } else if (fieldOf.has(key)) {
      const field = fieldOf.get(key);
      raw[field] = LIST_FIELDS.has(field) ? values : values[0];
    }
  }
  return repair(raw, catalog);
}

// The localStorage record. Versioned so a later shape change can migrate; an
// unversioned or foreign record reads as version 0 and comes through repair.
export function serialize(build, catalog) {
  return JSON.stringify({ v: SAVE_VERSION, build: repair(build, catalog) });
}

export function deserialize(text, catalog) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const version = Number.isInteger(parsed.v) ? parsed.v : 0;
  // Version 0 is a bare build, or anything else: repair decides what it is.
  const build = version >= 1 ? parsed.build : parsed;
  return repair(build, catalog);
}
