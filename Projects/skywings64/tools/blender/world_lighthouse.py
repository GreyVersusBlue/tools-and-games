import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

grey = C.mat('LH_Base', (0.42, 0.41, 0.40), rough=0.9)
white = C.mat('LH_White', (0.92, 0.90, 0.85), rough=0.6)
red = C.mat('LH_Red', (0.72, 0.13, 0.10), rough=0.55)
metal = C.mat('LH_Metal', (0.12, 0.12, 0.14), rough=0.4, metal=0.6)
glass = C.mat('LH_Glass', (0.75, 0.9, 1.0), rough=0.05, metal=0.0, alpha=0.35)
gold = C.mat('LH_Gold', (0.9, 0.75, 0.25), rough=0.3, metal=0.7)
wood = C.mat('LH_Wood', (0.24, 0.14, 0.08), rough=0.8)
cottage_wall = C.mat('LH_Cottage', (0.85, 0.80, 0.68), rough=0.85)
cottage_roof = C.mat('LH_CottageRoof', (0.62, 0.24, 0.15), rough=0.7)

parts = []

# base plinth
parts.append(C.add_cyl('base', 9.2, 10.8, 6, (0, 3, 0), verts=16, mat_=grey))

# tapered striped tower: 6 bands, 8m tall each, r 7.5 -> 1.65
BANDS = 6
BH = 8
y = 6
r0 = 7.5
for k in range(BANDS):
    r1 = r0 - k * 0.55
    r2 = r0 - (k + 1) * 0.55
    m = white if k % 2 == 0 else red
    parts.append(C.add_cyl(f'band{k}', r1, r2, BH, (0, y + BH / 2, 0), verts=18, mat_=m))
    y += BH
top = y  # 54

# gallery deck + railing
parts.append(C.add_cyl('gallery_deck', 6.9, 6.2, 1.2, (0, top + 0.6, 0), verts=18, mat_=metal))
for i in range(24):
    a = i * math.pi / 12
    parts.append(C.add_box(f'rail{i}', (0.16, 2.0, 0.16), (math.cos(a) * 6.7, top + 2.0, math.sin(a) * 6.7), mat_=metal))
parts.append(C.add_cyl('rail_top', 6.8, 6.8, 0.2, (0, top + 3.05, 0), verts=18, mat_=metal))

# lantern room base + glass
parts.append(C.add_cyl('lantern_base', 3.9, 4.4, 1.6, (0, top + 1.9, 0), verts=14, mat_=white))
parts.append(C.add_cyl('lantern_glass', 3.7, 3.7, 4.6, (0, top + 4.9, 0), verts=14, mat_=glass))
for i in range(12):
    a = i * math.pi / 6 + 0.26
    parts.append(C.add_box(f'lmullion{i}', (0.35, 4.6, 0.35), (math.cos(a) * 3.7, top + 4.9, math.sin(a) * 3.7), mat_=metal))
parts.append(C.add_cyl('lantern_top', 4.3, 4.3, 0.8, (0, top + 7.6, 0), verts=14, mat_=metal))

# roof + finial
parts.append(C.add_cone('roof', 4.5, 6.4, (0, top + 11.2, 0), verts=14, mat_=red))
parts.append(C.add_sphere('finial', 0.9, (0, top + 14.8, 0), mat_=gold))
parts.append(C.add_cyl('antenna', 0.08, 0.08, 3.0, (0, top + 16.5, 0), verts=6, mat_=metal))

# door
parts.append(C.add_box('door', (0.8, 3.4, 1.9), (7.3, 9.5, 0), mat_=wood))

# keeper's cottage
cx, cz = -17, 3
parts.append(C.add_box('cottage_wall', (9, 5.5, 7), (cx, 3.0, cz), mat_=cottage_wall))
parts.append(C.add_box('cottage_roof', (10.5, 3.4, 8.2), (cx, 5.9, cz), rot=(0, math.radians(45), 0), mat_=cottage_roof))
parts.append(C.add_box('cottage_win1', (0.3, 1.6, 1.7), (cx + 4.6, 3.5, cz), mat_=glass))
parts.append(C.add_box('cottage_win2', (1.7, 1.6, 0.3), (cx, 3.5, cz + 3.6), mat_=glass))
parts.append(C.add_cyl('cottage_chimney', 0.6, 0.7, 3.4, (cx - 3, 8.5, cz - 2), verts=6, mat_=cottage_wall))
parts.append(C.add_box('cottage_step', (3, 0.4, 1.6), (cx + 7.7, 1.4, cz), mat_=grey))

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'lighthouse')
img = C.setup_ao_bake_and_wire(merged, size=1024, samples=24)

out = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'lighthouse.glb')
out = os.path.abspath(out)
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
