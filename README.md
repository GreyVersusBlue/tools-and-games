# tools & games

A personal collection of browser-based games, tools, and TTRPG projects — mostly single-file or lightweight multi-file HTML/JS builds, hosted as a static site.

**Live site:** [greyversusblue.com](https://greyversusblue.com)

## Repo structure

| Path | What it is |
| --- | --- |
| `index.html` / `404.html` | The site shell — landing page and board of everything below |
| `landing.html` | A studio-style landing mockup of the same site — Three.js hero, editorial sections, mobile-first; not linked from the board (like `newindex.html`) |
| `Projects/` | The games — each is its own subfolder with its own assets and (mostly) its own save data |
| `Tools/` | Standalone utilities — classroom tools, reference browsers, etc. |
| `Pathfinder/` | Reference data (PF2e Remaster rules JSON) shared by the TTRPG-adjacent tools |
| `BACKLOG.md` | Every open idea on the site, ranked — the entry point for picking up work |
| `Audio/`, `assets/` | Shared media, fonts, and JS (including a shared save/load module used across games) |
| `HISTORY.md` | What already shipped — 58 locked design decisions, ten site sessions, and every project's phase log |
| `CLAUDE.md` | House rules, the npm scripts and where each runs, ownership, and the definition of done for a session |

## Games

- **The Absalom Inheritance** — isometric CRPG built on PF2e Remaster rules
- **Aphelion** — cozy 3D life-sim about a lone astronaut maintaining a ship
- **Castle Conundrum** — 3D castle-exploration riddle game
- **Closing Time** — real estate agent sim (buying and selling modes)
- **Corner & Kettle** — coffee shop management sim
- **Daredevil** — narrative RPG following stuntman Duke Harlan
- **Golden Hour** — sunset beach-walk sim (waves, wildlife, passing boats and planes)
- **Integer Foundry** — factory/logic incremental math game
- **The Fourth Quarter** — sports management sim
- **The Fracture Cycle** — short branching narrative game with multiple endings
- **Torchbearer** — PF2e Remaster adventure engine

## Tools

- **Final Grade Checker** — grade/report-card calculator for teachers
- **Schedule Browser / Schedule Visualizer** — school schedule lookup tools
- **Name Picker** / **Seating Chart Generator** — classroom randomizers
- **Anathema Archive** — PF2e Remaster rules compendium browser (à la Archives of Nethys)

## Notes on how this repo is maintained

Most of these were built and are maintained in collaboration with Claude. Two files at the repo root carry that record. **`BACKLOG.md`** is the entry point: every open idea, ranked, with the per-project `WISHLIST.md` files holding the plans it links to. **`HISTORY.md`** is what already shipped — 58 numbered design decisions that code across the repo cites by number, ten site-wide maintenance sessions, three rounds of a parallel prompt system since retired, and each project's own phase or sprint log. `CLAUDE.md` has the house rules and the definition of done. Useful context if you're picking up work on this repo after a break.

There's a small internal test/check suite used to catch regressions across the games and tools before publishing. **The site-wide scripts all live in `Tools/board-check/`** — `npm run check`, `npm run games`, `npm run tools`, `npm run previews`, `npm run social:check` and the rest — not in the individual project folders; most projects' own suites are a bare `node` invocation against a file in their `test/` folder. `CLAUDE.md` has the full table of what runs where.

## License

Personal project — not currently licensed for reuse. Feel free to poke around and play, but please don't redistribute the code or assets.
