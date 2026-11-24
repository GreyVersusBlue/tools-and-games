#!/bin/sh
# Batch 3 finals (the ten wide views), headless. Run from anywhere: sh scripts/render_batch3.sh
# BLENDER may be set to the Blender 5.3 executable; default is the Steam copy.
cd "$(dirname "$0")/.."
B="${BLENDER:-/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe}"
run() { echo "== $*"; "$B" -b --factory-startup -P "$@" 2>&1 | grep -E "RENDERED|SHIPPED|CHECK|Error|Traceback|GPU:|NO GPU|guard"; }
for s in a05_cairo_gate a06_alexandria a07_redsea a08_sahara a09_pass a10_caravanserai a11_sahel a12_bazaar a13_malabar a14_venice; do
  run scripts/$s.py -- --final
done
python scripts/batch_report.py 3
echo "== done"
