// JSON for a <script type="application/json"> element. The element's content
// is inert except for one sequence: "</" would let a "</script>" inside a
// description close the element early and turn the rest of the data into
// markup. Escaped as "<\/", which JSON.parse reads back as the same string.
// The builder page inlines skills.json this way; test/builder.test.mjs
// checks the escape with a value that carries the sequence.
export function jsonIsland(value) {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}
