#!/bin/sh
# Batch 2 finals, headless. Run from anywhere: sh scripts/render_batch2.sh
# BLENDER may be set to the Blender 5.3 executable; default is the Steam copy.
cd "$(dirname "$0")/.."
B="${BLENDER:-/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe}"
run() { echo "== $*"; "$B" -b --factory-startup -P "$@" 2>&1 | grep -E "RENDERED|SHIPPED|COMPOSITE|CHECK|Error|Traceback|GPU:|NO GPU"; }
run scripts/a01_desk.py -- --final --light dusk
run scripts/a01_desk.py -- --final --light night
for t in caravan dhow galley nileboat mules; do run scripts/a04_tokens.py -- --final --token $t; done
for g in pepper silk gold salt porcelain glass paper linen sugar incense copper wool; do run scripts/a15_goods.py -- --final --good $g; done
run scripts/a16_objects.py -- --final --obj all
run scripts/preview_tokens_on_map.py --
python scripts/batch_report.py 2
echo "== done"
