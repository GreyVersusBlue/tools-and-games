import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

stone = C.mat('WM_Stone', (0.55, 0.54, 0.5), rough=0.9)
wall = C.mat('WM_Wall', (0.94, 0.9, 0.78), rough=0.8)
cap = C.mat('WM_Cap', (0.54, 0.35, 0.2), rough=0.75)
wood = C.mat('WM_Wood', (0.42, 0.27, 0.15), rough=0.8)
roof = C.mat('WM_Roof', (0.71, 0.28, 0.17), rough=0.6)
glass = C.mat('WM_Glass', (0.85, 0.92, 1.0), rough=0.1, alpha=0.4)
blade_frame = C.mat('WM_BladeFrame', (0.35, 0.23, 0.13), rough=0.8)
blade_cloth = C.mat('WM_BladeCloth', (0.92, 0.89, 0.79), rough=0.85)

# ---------------- tower body (fixed part)
body = []
body.append(C.add_cyl('base', 7.4, 7.9, 3, (0, 1, 0), verts=14, mat_=stone))
body.append(C.add_cyl('tower', 3.7, 6.2, 22, (0, 12, 0), verts=16, mat_=wall))
body.append(C.add_cyl('capbase', 5.2, 5.25, 0.5, (0, 8, 0), verts=14, mat_=cap))
for i in range(12):
    a = i * math.pi / 6
    body.append(C.add_box(f'capbeam{i}', (0.15, 1.3, 0.15), (math.cos(a) * 5.25, 8.9, math.sin(a) * 5.25), mat_=wood))
body.append(C.add_cyl('caprim', 5.5, 5.5, 0.25, (0, 9.4, 0), verts=14, mat_=wood))
body.append(C.add_cone('roof', 5.4, 7, (0, 25.5, 0), verts=14, mat_=roof))
body.append(C.add_sphere('finial', 0.7, (0, 29.3, 0), mat_=wood))
body.append(C.add_box('door', (2.3, 4.6, 0.5), (0, 3.4, 6.0), mat_=wood))
body.append(C.add_box('window1', (1.1, 1.6, 0.4), (-3.5, 16, 0), mat_=glass))
body.append(C.add_box('window2', (1.1, 1.6, 0.4), (4.9, 14, 0), mat_=glass))

for p in body:
    C.shade_flat(p)
body_merged = C.join(body, 'windmill_body')
C.setup_ao_bake_and_wire(body_merged, size=768, samples=24)

# ---------------- blades: SEPARATE object, origin (pivot) at hub, hub mounted at front face
# hub sits 20.5m up, 4.3m out along the tower's forward (depth) axis - matches the JS pivot.
HUB_Y, HUB_Z = 20.5, 4.3
blade_parts = []
blade_parts.append(C.add_cyl('hub_cyl', 1.1, 1.1, 2.6, (0, 0, 0), rot=(math.radians(90), 0, 0), verts=8, mat_=wood))
blade_parts.append(C.add_box('hub_box', (2.2, 2.2, 2.4), (0, 0, 0), mat_=wood))
for k in range(4):
    a = k * math.pi / 2
    dx, dy = -math.sin(a), math.cos(a)
    px, py = math.cos(a), math.sin(a)
    blade_parts.append(C.add_box(f'spar{k}', (0.75, 23, 0.7), (dx * 11.5, dy * 11.5, 1.3),
                                  rot=(0, 0, a), mat_=blade_frame))
    blade_parts.append(C.add_box(f'rail_o{k}', (0.35, 15.6, 0.3), (dx * 15.2 + px * 3.6, dy * 15.2 + py * 3.6, 1.05),
                                  rot=(0, 0, a), mat_=blade_frame))
    blade_parts.append(C.add_box(f'rail_i{k}', (0.35, 15.6, 0.3), (dx * 15.2 + px * 0.6, dy * 15.2 + py * 0.6, 1.05),
                                  rot=(0, 0, a), mat_=blade_frame))
    for r in range(8):
        d = 8 + r * 1.95
        blade_parts.append(C.add_box(f'crossbar{k}_{r}', (3.4, 0.22, 0.24), (dx * d + px * 2.1, dy * d + py * 2.1, 1.05),
                                      rot=(0, 0, a), mat_=blade_frame))
        if r % 2 == 0:
            blade_parts.append(C.add_box(f'cloth{k}_{r}', (3.3, 1.7, 0.08), (dx * (d + 0.95) + px * 2.1, dy * (d + 0.95) + py * 2.1, 1.0),
                                          rot=(0, 0, a), mat_=blade_cloth))

for p in blade_parts:
    C.shade_flat(p)
blades_merged = C.join(blade_parts, 'blades')
C.place_mine(blades_merged, 0, HUB_Y, HUB_Z)
C.setup_ao_bake_and_wire(blades_merged, size=768, samples=24)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'windmill.glb'))
C.export_glb(out, objects=[body_merged, blades_merged])
C.report_size(out)
print('TRIS body', len(body_merged.data.polygons), 'blades', len(blades_merged.data.polygons))
