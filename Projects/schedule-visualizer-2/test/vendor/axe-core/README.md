# axe-core

This is axe-core 4.14.0, the accessibility checker by Deque Systems, used only by the tests in `test/a11y/`. No page of the tool loads it.

- `axe.min.js`, `LICENSE` and `LICENSE-3RD-PARTY.txt` are copied unchanged from the npm package `axe-core` 4.14.0, fetched on 2026-10-08 with `npm pack axe-core` (nothing was installed).
- Licence: Mozilla Public License 2.0. The file is used as distributed and is not modified.

To update: run `npm pack axe-core` in a scratch folder, copy the same three files out of the tarball, change the version in this file, and run `node test/a11y/contrast.mjs`, which fails when the version here and the one in `axe.min.js` differ.
