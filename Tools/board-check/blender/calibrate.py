# The calibration frame: nine 3 by 3 room-unit markers on the wall plane at
# the points budget.json names, rendered with Workbench at the size of the
# plate budget.json's calibration names (the room plate, 3200 by 1800, its
# pixels stretched by render() to hold the 2000 by 1300 frame) to
# out/calibrate.png (untracked). validate.mjs --rendered finds each marker
# and holds its centre to budget.json's tolerance in room units. If
# room_camera()'s lens or shift is wrong, or render()'s stretch is, this is
# where it shows: the markers land somewhere other than where the page will
# draw that room point.
#
# The markers are all on the wall plane, which the camera puts 1:1 at any
# distance, so they cannot see the distance. The tabletop disc can: a flat
# circle built where tavern.py builds table 0's top, whose drawn ellipse the
# canvas flattens to 0.28 (paintTable's r * 0.28). validate.mjs measures the
# disc's height over its width and holds it to that.
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

top = C.BUDGET['calibration']['tabletop']
tx, ty, r = top['table']
Y = C.depth_for(ty + r * 0.55)              # tavern.py's own placement
k = (Y + cam['distance']) / cam['distance']
bm = bmesh.new()
C.cone(bm, r * C.UNIT * k, r * C.UNIT * k, 0.002,
       C.Matrix.Translation(C.at_depth(tx, ty - r * 0.1, Y)), 64)
C.mesh_object('tabletop', bm, [white])

C.room_camera(scene)
plate = C.BUDGET['plates'][C.BUDGET['calibration']['plate']]
out = C.render(os.path.join(C.SITE, C.BUDGET['calibration']['file']), plate['width'], plate['height'],
               engine='BLENDER_WORKBENCH')
print('calibrate: wrote', out)
