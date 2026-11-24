# Merchant art scripts

The Blender scripts that made the pictures in `../../assets/art/`, from
`ART.md`. Devon renders them on his Windows machine with Blender 5.3; nothing
here runs in the browser and nothing in the game imports it.

- `common.py` and the `kit_*.py` files are shared by the picture scripts.
- `aNN_*.py` makes picture `ANN` of `ART.md` section 4.
- `render_batchN.sh` renders one batch headless. Set `BLENDER` to the
  Blender executable if it is not the default path in the script.
- `inputs.json` lists every outside input (textures, models, terrain), each
  CC0 or public domain, with its library and what it was used for.

A picture is in the game only when its manifest entry in
`../../assets/art/manifest.json` reads `"final": true`. The rest are still the
placeholders `../make-placeholders.mjs` makes, waiting on the requests in
the art list's next version.
