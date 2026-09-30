import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy

C.clear_scene()

log = C.mat('Cabin_Log', (0.55, 0.38, 0.22), rough=0.85)
log2 = C.mat('Cabin_Log2', (0.62, 0.44, 0.28), rough=0.85)
roof = C.mat('Cabin_Roof', (0.55, 0.16, 0.11), rough=0.6)
wood_dk = C.mat('Cabin_Door', (0.24, 0.14, 0.08), rough=0.8)
glass = C.mat('Cabin_Glass', (0.85, 0.92, 1.0), rough=0.1, alpha=0.4)
chim = C.mat('Cabin_Chimney', (0.45, 0.35, 0.32), rough=0.9)
porch = C.mat('Cabin_Porch', (0.42, 0.28, 0.16), rough=0.8)

parts = []
W, D = 7.2, 5.7
# stacked logs
for r in range(7):
    m = log if r % 2 else log2
    parts.append(C.add_box(f'log{r}', (W, 0.85, D), (0, 0.5 + r * 0.85, 0), mat_=m))
top = 0.5 + 7 * 0.85

# roof (prism approximated as two slanted boxes forming an A-frame)
ridge = top + 2.6
for s in (-1, 1):
    parts.append(C.add_box(f'roof{s}', (W + 1.6, 0.25, D + 1.2), (s * 2.1, top + 1.3, 0),
                            rot=(0, 0, math.radians(-s * 32)), mat_=roof))

# door + windows (front = +Z)
parts.append(C.add_box('door', (1.4, 3.3, 0.3), (0, 1.65 + 0.35, D / 2 + 0.05), mat_=wood_dk))
parts.append(C.add_box('win_l', (1.3, 1.3, 0.3), (-2.3, 3.1, D / 2 + 0.05), mat_=glass))
parts.append(C.add_box('win_r', (1.3, 1.3, 0.3), (2.3, 3.1, D / 2 + 0.05), mat_=glass))

# chimney
parts.append(C.add_box('chimney', (1.2, 3.2, 1.2), (2.2, top + 1.6, -1.2), mat_=chim))
parts.append(C.add_box('chimney_cap', (1.6, 0.3, 1.6), (2.2, top + 3.25, -1.2), mat_=chim))

# porch deck + posts
parts.append(C.add_box('porch_deck', (5.2, 0.3, 2.6), (0, 0.4, D / 2 + 1.3), mat_=porch))
for sx in (-2.3, 2.3):
    parts.append(C.add_box(f'porch_post{sx}', (0.2, 2.4, 0.2), (sx, 1.6, D / 2 + 2.4), mat_=porch))
parts.append(C.add_box('porch_beam', (4.9, 0.2, 0.3), (0, 2.85, D / 2 + 2.4), mat_=porch))

# woodpile
for l in range(3):
    parts.append(C.add_box(f'wood{l}', (0.5, 0.45, 2.2), (-5.2, 0.4 + l * 0.5, 0.5), mat_=log2))

for p in parts:
    C.shade_flat(p)

merged = C.join(parts, 'cabin')
img = C.setup_ao_bake_and_wire(merged, size=512, samples=24)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'cabin.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
