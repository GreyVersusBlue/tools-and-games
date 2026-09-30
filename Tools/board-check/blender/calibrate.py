# The calibration frame: nine 3 by 3 room-unit markers on the wall plane at
# the points budget.json names, rendered with Workbench at the room camera's
# own size to out/calibrate.png (untracked). validate.mjs --rendered finds
# each marker and holds its centre to budget.json's tolerance in room units.
# If room_camera()'s lens or shift is wrong, this is where it shows: the
# markers land somewhere other than (x - frame.x, y - frame.y).
#
#   blender -b --factory-startup -P blender/calibrate.py

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import common as C  # noqa: E402

C.check_version()
scene = C.reset()
cam = C.BUDGET['camera']
fx, fy, fw, fh = cam['frame']

black = C.material('black', 0x000000, unlit=True)
white = C.material('white', 0xffffff, unlit=True)

bm = bmesh.new()
C.box(bm, (C.rx(fx - 50), 0.0, C.rz(fy + fh + 50)), (C.rx(fx + fw + 50), 0.02, C.rz(fy - 50)))
C.mesh_object('wall', bm, [black])

bm = bmesh.new()
for x, y in C.BUDGET['calibration']['markers']:
    C.box(bm, (C.rx(x - 1.5), -0.005, C.rz(y + 1.5)), (C.rx(x + 1.5), 0.0, C.rz(y - 1.5)))
C.mesh_object('markers', bm, [white])

C.room_camera(scene)
out = C.render(os.path.join(C.SITE, C.BUDGET['calibration']['file']), engine='BLENDER_WORKBENCH')
print('calibrate: wrote', out)
