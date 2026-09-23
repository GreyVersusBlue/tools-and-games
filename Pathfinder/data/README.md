# `Pathfinder/data/` is a published interface

Devon answered on 2026-09-13 (locked decision #350): this is public PF2e
Remaster reference data copied into the site, and **any project may read it.**
It stopped being private to the Anathema Archive that day. The Absalom
Inheritance and Torchbearer had both wanted it for six rounds and had both
stopped short of using it, which was the right call until someone said so.

## What a reader may do

- **Fetch it at runtime** from the same origin, e.g.
  `fetch('../../Pathfinder/data/spell.json')`. It is served from this repo, so
  it is not an offsite request. Check `manifest.json` first: it names every
  category's `file`, its `count` and its `sizeMB`, and several files are over
  a megabyte. The Archive loads only the manifest at boot and a category on
  demand; a game should do the same.
- **Or vendor the slice it needs** into its own folder, the way #17 already
  allows for anything else. Pick this when the page has to boot with no network
  (Torchbearer's rule) or needs three stat blocks rather than 1,414 actions.

## What a reader may not do

- **Write here.** The Anathema Archive area owns this folder, and
  `Pathfinder/fetch json data.py` is the only thing that regenerates it.
- **Depend on a field without a test for it.** A project that reads this data
  adds an assertion to its own suite for every field it relies on, and adds
  `Pathfinder/data/**` to its own workflow's `paths:` list. Then a regeneration
  that renames or drops a field turns that project's CI red on the pull request
  that did it, instead of breaking a live page quietly.

## What the owner owes readers

The Archive may still regenerate or reshape these files. Before merging a
change that renames, moves or drops a file or a field, search the repo for
`Pathfinder/data` and run the suite of every project that turns up.

## Licence

Everything in this folder is Paizo's game content. It comes from the
[Foundry VTT pf2e system](https://github.com/foundryvtt/pf2e)'s compendium packs,
reshaped by `Pathfinder/fetch json data.py`, and every entry keeps the
`system.publication` block that names its source book and licence. As of the
2026-09-23 count, 8,403 entries carry `"license": "ORC"` and 3,660 carry
`"license": "OGL"` (legacy, pre-Remaster books).

**ORC Notice.** This product is licensed under the ORC License, located at the
Library of Congress at TX 9-307-067, and available online at various locations
including www.paizo.com/orclicense, www.azoralaw.com/orclicense,
www.gencon.com/orclicense and others. All warranties are disclaimed as set
forth therein.

**Attribution.** This product is based on the following Licensed Material:
the Pathfinder Remaster rulebooks and supplements named in each entry's
`system.publication.title` (among them Pathfinder Player Core, Player Core 2,
GM Core and Monster Core), © Paizo Inc. and published under the ORC License.

**Reserved Material.** Paizo's trade dress, trademarks, proper names, setting
and lore are not Licensed Material under the ORC License. Where this data
carries them, it does so under Paizo's
[Community Use Policy](https://paizo.com/licenses/communityuse): this is a
free, non-commercial reference, not published, endorsed or approved by Paizo.
Pathfinder is a registered trademark of Paizo Inc.

**OGL entries.** The entries tagged `"license": "OGL"` come from legacy
(pre-Remaster) books released under the Open Game License v1.0a, which asks
for its own licence text and a Section 15 copyright notice rather than the ORC
notice above.
