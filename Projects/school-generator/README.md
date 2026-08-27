# School Generator

Draw a school in plan, then walk through it.

Storeys, rooms, walls, doors and windows, stairs and ramps and lifts, a graded
site, a roof. Draw four walls, then cut the doors and windows into them; the
eraser deletes anything you click, whichever tool placed it. The walkthrough
has collision, gravity, footsteps, room acoustics, a positioned sun, a start
point you choose, and a school's worth of people walking their timetable. It
reads what you have drawn — occupant load, travel distance,
accessible route, glazing ratio, reverberation time — and it will generate a
whole building from a student count and a sentence.

A single page, no build step, no dependencies beyond a vendored three.js.

## Running it

It has to be **served**, not opened from disk: the tool is ES modules and a
browser refuses those over `file://`. Any static server will do.

```
cd Projects/school-generator
npx serve            # or: python3 -m http.server
```

Then open the address it prints. If something has gone wrong, the page says so
in words rather than showing you a toolbar that doesn't work — see
`js/bootcheck.js`.

The optional `server/` directory is a different thing: a design store and a
session relay, for keeping designs somewhere other than a browser and for
drawing with somebody else. It has its own README and needs no dependencies
either.

## Tests

Three passes. The first needs nothing but Node; the other two need a browser
and are optional tooling — a machine without Playwright loses those, not the
suite.

```
node --test 'test/*.test.mjs'      # 1,700+ assertions over every pure module
node test/visual/run.mjs           # the printed sheets and the editor chrome
node test/tools/run.mjs            # the drawing tools and the walk, on the real page
```

The glob in the first one is not decoration: `node --test test/` resolves the
path as a module on Node 22 and dies with `MODULE_NOT_FOUND` before it runs
anything.

All three run on every pull request that touches this directory — see
`.github/workflows/school-generator-ci.yml`.

## Where things are

```
index.html      the page: chrome, styles, and the boot guard
js/             the tool — one module per question, ~80 of them
libs/           vendored three.js and the addons it uses
test/           one suite per pure module, plus visual/ and tools/
server/         the optional design store and session relay
tools/          the walkthrough exporter
assets/         textures and imported models
```

The architecture, the conventions that were learned the hard way, and the
standing backlog are all in **[WISHLIST.md](WISHLIST.md)** — read the
conventions section before your first edit. Every entry in it is a mistake
somebody made once.

The most recent audit of the whole thing, including what is and isn't
covered by tests, is
[`school-generator-audit-2026-08.md`](../../school-generator-audit-2026-08.md)
at the repository root.

## The one rule

**Add a pure module and its test suite together.** No exceptions. The geometry
never touches three.js; the tools never do geometry. Everything else in the
WISHLIST's conventions section follows from that one.
