import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

S = C.mat('Castle_Stone', (0.82, 0.77, 0.66), rough=0.88)
S2 = C.mat('Castle_Stone2', (0.72, 0.68, 0.58), rough=0.88)
roof_blue = C.mat('Castle_RoofBlue', (0.14, 0.32, 0.72), rough=0.5)
roof_red = C.mat('Castle_RoofRed', (0.72, 0.19, 0.15), rough=0.5)
wood = C.mat('Castle_Wood', (0.35, 0.22, 0.12), rough=0.8)
glass = C.mat('Castle_Glass', (0.9, 0.82, 0.5), rough=0.2, alpha=0.55)
dark = C.mat('Castle_Dark', (0.08, 0.07, 0.09), rough=0.7)

parts = []

def wall(x, z, w, d):
    parts.append(C.add_box('wall', (w, 12, d), (x, 6, z), mat_=S))
    parts.append(C.add_box('wallcap', (w + (1.6 if w <= d else 0), 0.6, d + (1.6 if d < w else 0)), (x, 12.3, z), mat_=S2))

wall(0, -40, 84, 4); wall(0, 40, 84, 4); wall(-40, 0, 4, 84); wall(40, 0, 4, 84)

# crenellations along top of walls
for t in range(-38, 39, 8):
    parts.append(C.add_box('cren_n', (2.2, 2.2, 1.6), (t, 13.6, -40), mat_=S2))
    parts.append(C.add_box('cren_s', (2.2, 2.2, 1.6), (t, 13.6, 40), mat_=S2))
    parts.append(C.add_box('cren_w', (1.6, 2.2, 2.2), (-40, 13.6, t), mat_=S2))
    parts.append(C.add_box('cren_e', (1.6, 2.2, 2.2), (40, 13.6, t), mat_=S2))

# corner towers
roof_cols = [roof_blue, roof_red, roof_blue, roof_red]
ti = 0
for sx in (-1, 1):
    for sz in (-1, 1):
        tx, tz = sx * 40, sz * 40
        parts.append(C.add_cyl('tower', 6.2, 7.0, 28, (tx, 13, tz), verts=14, mat_=S))
        parts.append(C.add_cyl('towertop', 7.6, 7.2, 1.8, (tx, 27.5, tz), verts=14, mat_=S2))
        for i in range(10):
            a = i * math.pi / 5
            parts.append(C.add_box('towercren', (1.6, 1.6, 1.6), (tx + math.cos(a) * 7.4, 29.3, tz + math.sin(a) * 7.4), mat_=S2))
        parts.append(C.add_cone('towerroof', 6.8, 12.5, (tx, 36.5, tz), verts=14, mat_=roof_cols[ti]))
        parts.append(C.add_box('towerwin', (0.4, 2.6, 1.2), (tx + sx * 5.3, 18, tz), mat_=dark))
        ti += 1

# mid-wall towers
for tx, tz in [(0, -40), (-40, 0), (40, 0)]:
    parts.append(C.add_cyl('midtower', 4.2, 4.8, 21, (tx, 10, tz), verts=12, mat_=S))
    parts.append(C.add_cone('midroof', 5.0, 8.5, (tx, 26, tz), verts=12, mat_=roof_red))

# gatehouse
parts.append(C.add_box('gate_l', (7, 18, 8), (-8, 9, 40), mat_=S))
parts.append(C.add_box('gate_r', (7, 18, 8), (8, 9, 40), mat_=S))
parts.append(C.add_box('gate_top', (10, 6, 8), (0, 15, 40), mat_=S))
parts.append(C.add_cone('gate_l_roof', 5.2, 6.6, (-8, 24.4, 40), verts=8, mat_=roof_blue))
parts.append(C.add_cone('gate_r_roof', 5.2, 6.6, (8, 24.4, 40), verts=8, mat_=roof_blue))
parts.append(C.add_box('gate_door', (9.2, 10, 0.4), (0, 5, 44.2), mat_=dark))
for i in range(-4, 5):
    parts.append(C.add_box('portcullis', (0.14, 4.6, 0.2), (i * 1.05, 9, 44.5), mat_=dark))

# keep (main central tower complex)
parts.append(C.add_box('keep_base', (32, 28, 28), (0, 14, -8), mat_=S))
parts.append(C.add_box('keep_cap', (34, 1, 30), (0, 28.4, -8), mat_=S2))
for dx, dz in [(-16, -22), (16, -22), (-16, 6), (16, 6)]:
    parts.append(C.add_cyl('keep_turret', 3.5, 3.8, 34, (dx, 17, -8 + dz), verts=10, mat_=S))
    parts.append(C.add_cone('keep_turret_roof', 4.2, 7, (dx, 38.5, -8 + dz), verts=10, mat_=roof_red))
parts.append(C.add_cyl('keep_tower', 9, 10, 26, (0, 42, -8), verts=16, mat_=S))
parts.append(C.add_cyl('keep_tower_cap', 11, 10, 2, (0, 55.5, -8), verts=16, mat_=S2))
for i in range(12):
    a = i * math.pi / 6
    parts.append(C.add_box('keep_cren', (2.2, 2.2, 2.2), (math.cos(a) * 10.6, 57.4, -8 + math.sin(a) * 10.6), mat_=S2))
parts.append(C.add_cone('keep_roof', 11.5, 22, (0, 68, -8), verts=16, mat_=roof_red))
for wx in (-9, 0, 9):
    parts.append(C.add_box('keep_win', (2.2, 4.2, 0.5), (wx, 18, -8 + 14.3), mat_=glass))

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'castle')
C.setup_ao_bake_and_wire(merged, size=1024, samples=20)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'castle.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
