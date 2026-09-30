# The Conversion Codex's own data

Three files, all owned by the Pathfinder Converter area. Neither lives in
`Pathfinder/data/`, which the Anathema Archive owns and only
`Pathfinder/fetch json data.py` writes (#350). The PF2e side of every spell
lookup reads that folder under its README's contract, rather than copying it.

## `pf1-spells.json`

Every PF1e spell on Archives of Nethys (1e), 3,024 of them as of 2026-09-29,
one object per line, sorted by name. Regenerate with
`python fetch-pf1-spells.py` from the folder above; it caches pages in the
system temp folder and writes its parse log there too.

| Field | Example |
| --- | --- |
| `name` | `"Fireball"` |
| `level` | `3`, the lowest level across every class list |
| `school`, `subschool`, `descriptors` | `"evocation"`, absent, `["fire"]` |
| `levels` | `{"sorcerer": 3, "wizard": 3, "magus": 3}` |
| `castingTime`, `components`, `range`, `area`, `target`, `effect`, `duration`, `save`, `sr` | the spell's header lines, as text |
| `source` | `"PRPG Core Rulebook pg. 283"` |
| `description` | plain text, paragraphs joined by a blank line |
| `mythic` | the mythic rider, when the page has one |

Empty fields are left out. 15 pages on Nethys have no Level line the script
can read (Genesis, True Creation, Surelife and a few others) and are missing.

## `spell-map.json`

The curated map from a PF1e spell to its PF2e Remaster equivalent:

```json
{ "map": { "Magic Missile": { "to": ["Force Barrage"], "fit": "exact", "note": "" } } }
```

`fit` is `exact` (the same spell), `close` (the same job, different
mechanics), `partial` (covers some of it) or `none`. `note` tells a GM what
differs. `match-spells.py` shortlists candidates for whoever edits it; the map
itself is hand-checked. Every `to` name must exist in `Pathfinder/data/spell.json`;
`Pathfinder/tests/converter-spells.test.mjs` fails if one does not.

## `embeds.json`

The actions PF2e spells embed by Foundry id (`@Embed[Compendium.pf2e.actionspf2e.Item.<id> inline]`),
as `{ "<id>": { "name", "description" } }`, sliced from
`Pathfinder/data/action.json` so the page does not fetch 1.3 MB for them. One
action as of 2026-09-29: Dragon's Protection, embedded by Divine Dragon's Watch.
Regenerate with `node Pathfinder/converter-assets/vendor-embeds.mjs` from the
repo root. `Pathfinder/tests/converter-spells.test.mjs` fails when the file no
longer matches what `action.json` holds, or when a spell embeds an id it lacks.
The action text is Paizo content under the ORC License, like the rest of
`Pathfinder/data/`; see that folder's README for the notice.

## Licence

PF1e spell text is Paizo content under the Open Game License v1.0a, copied from
[Archives of Nethys](https://aonprd.com) under Paizo's
[Community Use Policy](https://paizo.com/licenses/communityuse). This is a
free, non-commercial reference, not published, endorsed or approved by Paizo.
Pathfinder is a registered trademark of Paizo Inc.

Open Game License v1.0a, Section 15: Pathfinder Roleplaying Game Core Rulebook
© 2009, Paizo Publishing, LLC; Author: Jason Bulmahn, based on material by
Jonathan Tweet, Monte Cook, and Skip Williams. Further spell text comes from
the Pathfinder Roleplaying Game books named in each entry's `source` field,
© Paizo Inc. and their respective authors.
