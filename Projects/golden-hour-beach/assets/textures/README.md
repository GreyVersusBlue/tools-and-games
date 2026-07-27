# Vendored textures

`aerial_beach_01_diff_1k.jpg` and `aerial_beach_01_nor_gl_1k.jpg` — the sand under
the whole beach. 1024×1024, 370 KB for the pair.

Source: [Poly Haven — Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01),
fetched from `dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_beach_01/`.
Poly Haven publishes everything under **CC0** — public domain, no attribution
required. The credit is here because it's the decent thing, not the legal thing.

## Why these are in the repo

`terrain.js` used to hotlink them, which left this page as the only thing on
greyversusblue.com that reached an outside host while a visitor was on it. Session
7 vendored them:

- 370 KB, in a repo whose Castle Conundrum asset kit alone is 178 MB
- no more handing a third party the IP address of everyone who opens the beach
- everybody sees the same shoreline, and it doesn't change if Poly Haven
  reorganises its CDN paths

The procedural canvas texture in `terrain.js` is still there and still the first
thing on screen; these load over the top of it. Delete them and the beach goes
back to looking hand-mixed rather than breaking.
