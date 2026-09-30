import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

hull = C.mat('Sail_Hull', (0.85, 0.83, 0.78), rough=0.55)
deck = C.mat('Sail_Deck', (0.7, 0.52, 0.33), rough=0.7)
cabin_m = C.mat('Sail_Cabin', (0.9, 0.88, 0.82), rough=0.6)
mast = C.mat('Sail_Mast', (0.93, 0.93, 0.93), rough=0.4, metal=0.2)
sail_m = C.mat('Sail_Cloth', (0.95, 0.94, 0.9), rough=0.8)
sail2 = C.mat('Sail_Cloth2', (0.96, 0.94, 0.88), rough=0.8)

parts = []
parts.append(C.add_box('hull', (2.8, 1.5, 8.5), (0, 0.35, 0), mat_=hull))
parts.append(C.add_box('cabin', (1.7, 1.1, 2.3), (0, 0.9, -4.6), mat_=cabin_m))
parts.append(C.add_box('cockpit', (1.9, 1.0, 3.2), (0, 1.4, 0.5), mat_=deck))
parts.append(C.add_box('deck', (2.5, 0.15, 8.1), (0, 1.03, 0), mat_=deck))
parts.append(C.add_cyl('mast', 0.12, 0.16, 11.5, (0, 6.4, -0.6), verts=8, mat_=mast))

# mainsail / jib: thin vertical triangular wedges (3-sided cone tapering to an apex, flattened in
# the depth axis). add_cyl's default (no rotation) already stands tall along mine's y_up axis.
def sail(name, half_width, height, cx, base_y, cz, mat_):
    o = C.add_cyl(name, half_width, 0.03, height, (cx, base_y + height / 2, cz), verts=3, mat_=mat_)
    o.scale = (o.scale[0], 0.12, o.scale[2])  # flatten along blender-Y ( = mine's -z_depth )
    return o

parts.append(sail('mainsail', 4.6, 9.2, 0, 1.6, -0.6, sail_m))
parts.append(sail('jib', 2.9, 5.8, 0, 2.2, 2.8, sail2))

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'boat_sail')
img = C.setup_ao_bake_and_wire(merged, size=512, samples=24)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'boat_sail.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
