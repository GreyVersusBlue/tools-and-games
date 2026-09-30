import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

hull = C.mat('Motor_Hull', (0.82, 0.2, 0.16), rough=0.5)
deck = C.mat('Motor_Deck', (0.94, 0.93, 0.88), rough=0.6)
wind = C.mat('Motor_Wind', (0.24, 0.3, 0.36), rough=0.3, metal=0.2)
trim = C.mat('Motor_Trim', (0.8, 0.2, 0.16), rough=0.5)

parts = []
parts.append(C.add_box('hull', (2.6, 1.3, 7.0), (0, 0.4, 0), mat_=hull))
parts.append(C.add_box('deck', (2.0, 1.0, 3.2), (0, 1.1, -0.7), mat_=deck))
parts.append(C.add_box('windshield', (1.7, 0.6, 2.4), (0, 1.9, -0.9), mat_=wind))
parts.append(C.add_box('bow', (1.4, 1.4, 1.4), (0, 0.75, 3.5), rot=(math.radians(17), 0, 0), mat_=trim))

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'boat_motor')
img = C.setup_ao_bake_and_wire(merged, size=512, samples=24)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'boat_motor.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
