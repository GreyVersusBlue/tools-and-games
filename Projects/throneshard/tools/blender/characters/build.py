# blender -b --python build.py -- <out_dir> <name> [name...]   (see build.sh)
import sys, os, json, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charkit import *
import defs_heroes, defs_units
REG = {**defs_heroes.REG, **defs_units.REG}

argv = sys.argv[sys.argv.index('--') + 1:]
out_dir, names = argv[0], argv[1:]
prev = os.environ.get('PREVIEW_DIR')
if names == ['all']:
    names = list(REG)
for n in names:
    try:
        fn, opts = REG[n]
        C = fn()
        C.finish(out_dir, tris=opts['tris'], tex=opts['tex'], preview_dir=prev)
    except Exception:
        traceback.print_exc()
        print('FAILED', n)
