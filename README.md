# tools & games

Browser games, a Pathfinder 2e reference shelf and a LARP rules site, built by
Devon with Claude and served as plain static files at
**[greyversusblue.com](https://greyversusblue.com)**.

No build step, no bundler, no runtime npm dependency, and no offsite requests:
every font, model and library a page needs is vendored next to it. The repo
root is the site, so every file here is a live URL.

## Games

Each lives in its own folder under `Projects/` and keeps its own saves.

| Game | What it is |
| --- | --- |
| [The Absalom Inheritance](https://greyversusblue.com/Projects/absalom_inheritance.html) | Isometric dungeon crawler on PF2e Remaster rules |
| [Aphelion](https://greyversusblue.com/Projects/aphelion/) | A lone astronaut keeps the ship alive, one quiet shift at a time |
| [Bell to Bell](https://greyversusblue.com/Projects/bell-to-bell/) | 3D classroom sim: forty-seven minutes, twelve kids, one period |
| [Blue Hour](https://greyversusblue.com/Projects/blue-hour-trail/) | Walk a fog-bound switchback trail after dark, up to a fire lookout |
| [Closing Time](https://greyversusblue.com/Projects/Closing%20Time/) | Climb the ranks as a real estate agent, one deal at a time |
| [Corner & Kettle](https://greyversusblue.com/Projects/corner-and-kettle/) | Run a coffee shop, one order at a time |
| [Daredevil](https://greyversusblue.com/Projects/daredevil/) | Narrative RPG: stuntman Duke Harlan chases the next big stunt |
| [Faire Weekend](https://greyversusblue.com/Projects/Ren-Faire-Claude/) | Build the grounds, book the acts, run a renaissance faire |
| [The Fourth Quarter](https://greyversusblue.com/Projects/fourth-quarter/) | Sports bar management sim in 3D ([the original 2D build](https://greyversusblue.com/Projects/The-Fourth-Quarter.html) is still up) |
| [The Fracture Cycle](https://greyversusblue.com/Projects/the-fracture-cycle.html) | Choose-your-own-adventure through Dota 2's lore |
| [Golden Hour](https://greyversusblue.com/Projects/golden-hour-beach/) | Walk a sunset beach: waves, gulls, a dolphin past the break |
| [Hearth](https://greyversusblue.com/Projects/hearth/) | An island village that lives its years without you |
| [Integer Foundry](https://greyversusblue.com/Projects/integer-foundry.html) | Route numbers through belts and forges to fill every order |
| [Orbital](https://greyversusblue.com/Projects/orbital/) | Launch a probe and let gravity fly it to the marker |
| [School Generator](https://greyversusblue.com/Projects/school-generator/) | Draw or generate a school, read its code report, walk its halls |
| [Signal City](https://greyversusblue.com/Projects/signal-city/) | Program the traffic lights, never the cars |
| [Torchbearer](https://greyversusblue.com/Projects/torchbearer.html) | Solo PF2e Remaster adventure engine |

**Castle Conundrum**, a first-person medieval murder mystery, is on the board
but lives in [its own repo](https://github.com/GreyVersusBlue/castle-conundrum)
and is served from <https://greyversusblue.github.io/castle-conundrum/>.

## Pathfinder and Numina

- **[Anathema Archive](https://greyversusblue.com/Pathfinder/Anathema_Archive.html)**:
  a search tool over PF2e rules data. The data in `Pathfinder/data/` is Paizo
  content under the ORC License (and OGL for legacy books); see
  [`Pathfinder/data/README.md`](Pathfinder/data/README.md) for the notice.
- **[Campaigns](https://greyversusblue.com/Pathfinder/campaigns.html)** and
  **[Characters](https://greyversusblue.com/Pathfinder/characters.html)**:
  campaigns run, scenarios played and characters built.
- **[Numina](https://greyversusblue.com/Numina/)**: lore, rules and player guides
  for a LARP set in the world of Aeledd. The one exception to "no build step":
  an Eleventy site whose built output is committed.

## Tools

The five classroom tools (Final Grade Checker, Image to PDF, Name Picker,
Seating Chart Generator, Schedule Visualizer) are archived. Their pages under
`Tools/` still work, but new classroom work lives at
[aspermylessonplan.com](https://aspermylessonplan.com/). `Tools/board-check/`
is the site's own test harness, and `Tools/prompt-builder.html` is a small
standalone utility.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `404.html` | The board: every project as a pinned notice |
| `Projects/` | The games |
| `Pathfinder/`, `Numina/` | The TTRPG and LARP pages |
| `Tools/` | Archived classroom tools, plus `board-check/` |
| `assets/`, `Audio/` | Site-wide fonts, previews, social cards and the shared save module (`assets/js/gvb-save.js`) |
| `BACKLOG.md` | Open work, ranked. Start here |
| `HISTORY.md` | What shipped, and the numbered decisions code cites |
| `ARCHIVE.md` | Work that will not be done |
| `CLAUDE.md` | House rules, where each test suite runs, and how a session works the backlog |

## Tests

Site-wide checks run from `Tools/board-check/`:

```
cd Tools/board-check
npm install
npm run check          # integrity and collisions
npm run social:check   # generated social tags are current
```

Most projects have their own suite as a bare `node` script under their `test/`
or `tests/` folder; `CLAUDE.md` lists where each one runs. GitHub Actions runs
the site checks on every pull request, and each project's suite on the pull
requests that touch it.

## License

Personal project, not licensed for reuse. Play and poke around, but please
don't redistribute the code or assets. Pathfinder content belongs to Paizo Inc.
and is used under the licences noted in `Pathfinder/data/README.md`.
