#!/bin/sh
# Batch 1 finals, headless. Run from anywhere: sh scripts/render_batch1.sh
# BLENDER may be set to the Blender 5.3 executable; default is the Steam copy.
cd "$(dirname "$0")/.."
B="${BLENDER:-/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe}"
run() { echo "== $*"; "$B" -b --factory-startup -P "$@" 2>&1 | grep -E "RENDERED|SHIPPED|JSON|CHECK|Error|Traceback|GPU:|NO GPU"; }
run scripts/a00_look_test.py -- --final --light both
run scripts/a01_desk.py -- --final --light day
run scripts/a03_map.py -- --final
run scripts/a04_tokens.py -- --final --token caravan
run scripts/a15_goods.py -- --final --good pepper
run scripts/a15_goods.py -- --final --good silk
echo "== done"
