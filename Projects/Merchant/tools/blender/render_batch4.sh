#!/bin/sh
# Batch 4 finals (event plates and title), headless. Run from anywhere: sh scripts/render_batch4.sh
# BLENDER may be set to the Blender 5.3 executable; default is the Steam copy.
cd "$(dirname "$0")/.."
B="${BLENDER:-/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe}"
run() { echo "== $*"; "$B" -b --factory-startup -P "$@" 2>&1 | grep -E "RENDERED|SHIPPED|CHECK|Error|Traceback|GPU:|NO GPU|guard"; }
run scripts/a17_events.py -- --final --plate all
run scripts/a18_title.py -- --final
python scripts/batch_report.py 4
echo "== done"
