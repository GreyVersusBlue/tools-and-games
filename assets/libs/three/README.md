# The site's own copy of three.js

`three.module.min.js` is three.js **r169**, the minified ES module build
(`package/build/three.module.min.js` from `npm pack three@0.169.0`, 687,458
bytes, ~170 KB gzipped). `addons/` holds the ten files the bloom chain
imports, copied byte-for-byte from `Projects/school-generator/libs/addons/`,
which is the same r169:

| File | Imported by |
| --- | --- |
| `addons/postprocessing/EffectComposer.js` | `landing.html` |
| `addons/postprocessing/RenderPass.js` | `landing.html` |
| `addons/postprocessing/UnrealBloomPass.js` | `landing.html` |
| `addons/postprocessing/OutputPass.js` | `landing.html` |
| `addons/postprocessing/ShaderPass.js`, `MaskPass.js`, `Pass.js` | `EffectComposer.js`, `UnrealBloomPass.js` |
| `addons/shaders/CopyShader.js`, `LuminosityHighPassShader.js`, `OutputShader.js` | the passes above |

`LICENSE` is three.js's MIT licence from the same tarball.

Only `landing.html` uses this folder. It reaches it through an import map
(`"three": "./assets/libs/three/three.module.min.js"`, `"three/addons/":
"./assets/libs/three/addons/"`), the same shape `Projects/school-generator/`
uses for its own copy.

## Why a copy at the root, and why minified

Locked decision #17 says every *project* vendors its own three.js so parallel
sessions never share a file. `landing.html` is not a project; like
`index.html`, `404.html` and `newindex.html` it is the site itself (locked
decision #51), and the site's shared runtime files live under `assets/`
(`assets/fonts/`, `assets/js/gvb-save.js`, decision #43). This folder is that
rule applied to three.js.

The minified build is used, not the 1.3 MB unminified copy the projects carry,
because this page is meant to be opened on a phone: 170 KB over the wire
instead of ~320 KB, same API, same revision. The projects keep the readable
build because they are debugged in place; nothing on the landing page is.

## Why the folder is called `libs`

`Tools/board-check/check-integrity.mjs` skips any path containing `/libs/`
when it parses every script on the site and sweeps for offsite hosts (locked
decision #58) — vendored bundles false-positive on their own licence headers
and would cost the sweep seconds each run. Naming this folder `libs` puts it
under the rule that already covers every project's copy. The page's own inline
module is still parsed and swept in full.

## Re-verifying

```
cd Tools/board-check && npm install      # vendors three-0.169.0 for the harness
cmp ../../assets/libs/three/three.module.min.js node_modules/three/build/three.module.min.js
for f in postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass,ShaderPass,Pass,MaskPass} shaders/{CopyShader,LuminosityHighPassShader,OutputShader}; do
  cmp "../../assets/libs/three/addons/$f.js" "../../Projects/school-generator/libs/addons/$f.js"
done
```
