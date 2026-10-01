#!/bin/bash
# Regenerates assets/models/chars/*.glb from the CC0 source packs.
#   tools/blender/characters/build.sh [name ...|all]     (default: all)  — needs Blender 5.x and node (gltf-transform)
# Source packs are expected under $ART_SRC (default ~/.cache/throneshard-art); fetch_sources.mjs downloads them.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BLENDER=${BLENDER:-blender}
command -v $BLENDER >/dev/null || BLENDER=~/.local/bin/blender
OUT=${OUT:-/tmp/throneshard-chars-build}
DEST="$ROOT/assets/models/chars"
GT=${GT:-npx --yes @gltf-transform/cli@4}
mkdir -p "$OUT/raw" "$DEST"
NAMES=${@:-all}
if [ "$NAMES" = "all" ] || [[ " $NAMES " == *" anims "* ]]; then
  $BLENDER -b --python "$HERE/build_anims.py" -- "$OUT/raw/anims.glb" >/dev/null 2>&1
  $GT optimize "$OUT/raw/anims.glb" "$DEST/anims.glb" --compress meshopt --simplify false >/dev/null
  NAMES=${NAMES//anims/}
fi
[ -z "${NAMES// /}" ] && exit 0
$BLENDER -b --python "$HERE/build.py" -- "$OUT/raw" $NAMES 2>&1 | grep -E "BUILT|FAILED|Error|Traceback|  File|line [0-9]" | grep -v "Missing image" || true
for f in "$OUT"/raw/*.glb; do
  n=$(basename "$f" .glb); [ "$n" = anims ] && continue
  [ "$f" -nt "$DEST/$n.glb" ] || continue
  $GT optimize "$f" "$DEST/$n.glb" --compress meshopt --texture-compress webp --simplify false >/dev/null && echo "optimized $n $(du -h "$DEST/$n.glb" | cut -f1)"
done
