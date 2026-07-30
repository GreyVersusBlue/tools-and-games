# tools & games

A personal collection of browser-based games, tools, and TTRPG projects — mostly single-file or lightweight multi-file HTML/JS builds, hosted as a static site.

**Live site:** [greyversusblue.com](https://greyversusblue.com)

## Repo structure

| Path | What it is |
| --- | --- |
| `index.html` / `404.html` | The site shell — landing page and board of everything below |
| `Projects/` | The games — each is its own subfolder with its own assets and (mostly) its own save data |
| `Tools/` | Standalone utilities — classroom tools, reference browsers, etc. |
| `Pathfinder/` | Reference data (PF2e Remaster rules JSON) shared by the TTRPG-adjacent tools |
| `Claude Prompts/` | Development notes, prompts, and session handoff docs from building/maintaining the site with AI assistance |
| `Audio/`, `assets/` | Shared media, fonts, and JS (including a shared save/load module used across games) |
| `gvb-site-handoff-v*.md` | Running log of site-wide maintenance sessions — what changed, what broke, what's still open |

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

Most of these were built and are maintained in collaboration with Claude, including large multi-project maintenance passes tracked in the `gvb-site-handoff-v*.md` files at the repo root. Those documents are a running record of site-wide fixes (shared save module, offsite-request audits, previews, etc.) — useful context if you're picking up work on this repo after a break.

There's a small internal test/check suite (`npm run games`, `npm run tools`, `npm run check`, `npm run previews`, etc. — see individual project folders) used to catch regressions across the games and tools before publishing.

## License

Personal project — not currently licensed for reuse. Feel free to poke around and play, but please don't redistribute the code or assets.
