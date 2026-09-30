#!/bin/bash
# Regenerates assets/structures/*.glb (+ baked textures) from tools/blender/structures/build.py.
#   tools/blender/structures/build.sh [name ...]   (default: all) — needs Blender 5.x and node (gltf-transform via npx)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BLENDER=${BLENDER:-blender}
command -v $BLENDER >/dev/null || BLENDER=~/.local/bin/blender
OUT=${OUT:-/tmp/throneshard-structures-build}
DEST="$ROOT/assets/structures"
GT=${GT:-npx --yes @gltf-transform/cli@4}
mkdir -p "$OUT" "$DEST"
$BLENDER -b --python "$HERE/build.py" -- "$OUT" "$@" 2>&1 | grep -E "BUILT|FAILED|Error|Traceback|  File|line [0-9]" || true
for f in "$OUT"/*.glb; do
  n=$(basename "$f" .glb)
  [ "$f" -nt "$DEST/$n.glb" ] || continue
  $GT optimize "$f" "$DEST/$n.glb" --compress meshopt --texture-compress webp --texture-size 1024 --simplify false --join false --instance false --flatten false >/dev/null \
    && echo "optimized $n $(du -h "$DEST/$n.glb" | cut -f1)"
done
