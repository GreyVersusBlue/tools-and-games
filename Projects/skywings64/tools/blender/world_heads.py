import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

rock = C.mat('Heads_Rock', (0.56, 0.53, 0.47), rough=0.92)
rock2 = C.mat('Heads_Rock2', (0.49, 0.47, 0.42), rough=0.92)
faces = [
    C.mat('Heads_Face0', (0.79, 0.76, 0.68), rough=0.85),
    C.mat('Heads_Face1', (0.74, 0.71, 0.63), rough=0.85),
    C.mat('Heads_Face2', (0.82, 0.79, 0.71), rough=0.85),
    C.mat('Heads_Face3', (0.71, 0.68, 0.60), rough=0.85),
]
dark = C.mat('Heads_Dark', (0.11, 0.10, 0.09), rough=0.7)
eye_m = C.mat('Heads_Eye', (0.87, 0.85, 0.80), rough=0.5)
accent = [
    C.mat('Heads_Hair0', (0.53, 0.5, 0.44), rough=0.85),
    C.mat('Heads_Crown1', (0.82, 0.68, 0.22), rough=0.4, metal=0.5),
    C.mat('Heads_Cap2', (0.6, 0.58, 0.52), rough=0.8),
    C.mat('Heads_Helm3', (0.36, 0.42, 0.48), rough=0.4, metal=0.4),
]

parts = []
# base cliff mass behind heads
parts.append(C.add_box('cliff_base', (250, 8, 62), (0, 4, 2), mat_=rock))
parts.append(C.add_box('cliff_face', (270, 134, 38), (0, 5 + 67, -40), mat_=rock2))
parts.append(C.add_box('cliff_top', (250, 16, 20), (0, 5 + 8, -15), mat_=rock))
for i in range(6):
    x = -110 + i * 44
    parts.append(C.add_box(f'crag{i}', (26, 55, 15), (x, 5 + 45, -22), rot=(0, 0, math.radians((i % 2) * 6 - 3)), mat_=rock2))

def head(hx, hz, idx):
    yB = 5
    cl = faces[idx]
    p = []
    p.append(C.add_box('shoulders', (44, 22, 28), (hx, yB + 11, hz), mat_=cl))
    p.append(C.add_cyl('neck', 8, 10, 10, (hx, yB + 27, hz), verts=10, mat_=cl))
    p.append(C.add_sphere('skull', 15, (hx, yB + 42, hz), mat_=cl, seg=14, ring=10))
    p.append(C.add_sphere('jaw', 11.5, (hx, yB + 32, hz + 5), mat_=cl, seg=12, ring=8))
    p.append(C.add_sphere('chin', 5.4, (hx, yB + 26, hz + 11), mat_=cl))
    p.append(C.add_box('brow', (27, 3.4, 5), (hx, yB + 46.8, hz + 12.6), mat_=cl))
    p.append(C.add_box('nose_bridge', (4.6, 11.4, 5.4), (hx, yB + 39, hz + 15.2), mat_=cl))
    p.append(C.add_sphere('nose_tip', 3.3, (hx, yB + 33.6, hz + 16.6), mat_=cl))
    for s in (-1, 1):
        p.append(C.add_sphere('cheek', 5.2, (hx + s * 9.5, yB + 38, hz + 11.5), mat_=cl))
        p.append(C.add_sphere('ear', 3.6, (hx + s * 14.6, yB + 40.5, hz - 0.5), mat_=cl))
        p.append(C.add_box('eye_socket', (5.6, 2.5, 1.6), (hx + s * 6.6, yB + 44, hz + 13.6), mat_=dark))
        p.append(C.add_sphere('eye', 1.1, (hx + s * 6.6, yB + 43.8, hz + 14.4), mat_=eye_m))
    p.append(C.add_box('mouth', (10, 1.3, 1.5), (hx, yB + 30.4, hz + 14.6), mat_=dark))
    p.append(C.add_box('lip', (9, 1.4, 1.6), (hx, yB + 31.9, hz + 14.6), mat_=cl))
    am = accent[idx]
    if idx == 0:
        p.append(C.add_sphere('hair', 14, (hx, yB + 53, hz - 1), mat_=am, seg=12, ring=6))
    elif idx == 1:
        p.append(C.add_cyl('crown', 13, 14, 5, (hx, yB + 56, hz), verts=8, mat_=am))
        for k in range(8):
            a = k * math.pi / 4
            p.append(C.add_cone('spike', 2.4, 6, (hx + math.cos(a) * 12.5, yB + 62, hz + math.sin(a) * 12.5), verts=4, mat_=am))
    elif idx == 2:
        p.append(C.add_sphere('cap', 15, (hx, yB + 51.5, hz - 1), mat_=am, seg=12, ring=6))
        p.append(C.add_box('band', (10, 2, 2.2), (hx, yB + 32.3, hz + 15.5), mat_=am))
    else:
        p.append(C.add_cone('helm', 15.5, 20, (hx, yB + 61, hz), verts=4, mat_=am))
        p.append(C.add_cyl('helm_base', 15.5, 15.5, 2.5, (hx, yB + 53, hz), verts=4, mat_=am))
    return p

for i in range(4):
    hx = (i - 1.5) * 56
    parts += head(hx, 2, i)

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'heads')
print('TRIS pre-bake', len(merged.data.polygons))
C.setup_ao_bake_and_wire(merged, size=1024, samples=20)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'heads.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
