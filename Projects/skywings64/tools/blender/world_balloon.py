import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import bpy, bmesh

C.clear_scene()

PALETTE = [(0.91, 0.19, 0.16), (1.0, 0.95, 0.84), (0.18, 0.44, 0.91), (1.0, 0.82, 0.23),
           (0.18, 0.66, 0.29)]

# ---- envelope: lathe-revolved profile (teardrop balloon shape) with gore vertex colours
profile = [(0.30, 0), (0.42, 0.05), (0.66, 0.14), (0.90, 0.28), (1.0, 0.46),
           (0.94, 0.64), (0.74, 0.82), (0.40, 0.94), (0.02, 1.0)]
R, H = 11.0, 27.0
GORES = 12
SEGMENTS = GORES * 2

bm = bmesh.new()
ring_verts = []
for u, v in profile:
    ring = []
    for i in range(SEGMENTS):
        a = i / SEGMENTS * math.tau
        r = u * R
        ring.append(bm.verts.new((math.cos(a) * r, -math.sin(a) * r, v * H)))  # (x, -z_depth, y_up)
    ring_verts.append(ring)
bm.verts.ensure_lookup_table()

col_layer = bm.loops.layers.color.new('Col')
faces = []
for k in range(len(ring_verts) - 1):
    a_ring, b_ring = ring_verts[k], ring_verts[k + 1]
    for i in range(SEGMENTS):
        j = (i + 1) % SEGMENTS
        v0, v1, v2, v3 = a_ring[i], a_ring[j], b_ring[j], b_ring[i]
        try:
            f = bm.faces.new((v0, v1, v2, v3))
            faces.append((f, i // 2 % len(PALETTE)))
        except ValueError:
            pass
for f, gi in faces:
    col = PALETTE[gi]
    for loop in f.loops:
        loop[col_layer] = (*col, 1.0)

envelope_mesh = bpy.data.meshes.new('envelope')
bm.to_mesh(envelope_mesh)
bm.free()
envelope_obj = bpy.data.objects.new('envelope', envelope_mesh)
bpy.context.collection.objects.link(envelope_obj)

envelope_mat = bpy.data.materials.new('envelope')
envelope_mat.use_nodes = True
nt = envelope_mat.node_tree
bsdf = nt.nodes.get('Principled BSDF')
attr = nt.nodes.new('ShaderNodeAttribute')
attr.attribute_name = 'Col'
nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.55
envelope_obj.data.materials.append(envelope_mat)
C.place_mine(envelope_obj, 0, 7, 0)
bpy.ops.object.select_all(action='DESELECT')
envelope_obj.select_set(True)
bpy.context.view_layer.objects.active = envelope_obj
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
C.shade_flat(envelope_obj)

# ---- basket + burner + ropes
basket_m = C.mat('Balloon_Basket', (0.55, 0.38, 0.22), rough=0.85)
basket_rim = C.mat('Balloon_Rim', (0.4, 0.26, 0.15), rough=0.85)
rope_m = C.mat('Balloon_Rope', (0.22, 0.16, 0.1), rough=0.9)
burner_m = C.mat('Balloon_Burner', (0.4, 0.42, 0.44), rough=0.4, metal=0.6)
flame_m = C.mat('Balloon_Flame', (1.0, 0.62, 0.2), rough=0.5, emissive=(1.0, 0.5, 0.1))

parts = [envelope_obj]
parts.append(C.add_box('basket', (2.6, 1.4, 2.6), (0, 0.7, 0), mat_=basket_m))
parts.append(C.add_box('basket_rim', (2.9, 0.15, 2.9), (0, 1.5, 0), mat_=basket_rim))
for sx in (-1, 1):
    for sz in (-1, 1):
        parts.append(C.add_cyl(f'rope{sx}{sz}', 0.05, 0.05, math.hypot(3.1, 6.9), (sx * 2.75, 4.95, sz * 2.75),
                                rot=(math.atan2(3.1, 6.9) * sz, 0, math.atan2(3.1, 6.9) * -sx), verts=4, mat_=rope_m))
parts.append(C.add_cyl('burner', 0.35, 0.35, 0.9, (0, 3.6, 0), verts=8, mat_=burner_m))
parts.append(C.add_cone('flame', 0.45, 2.4, (0, 5.7, 0), verts=8, mat_=flame_m))

for p in parts[1:]:
    C.shade_flat(p)

merged = C.join(parts, 'balloon')
# keep envelope material name distinct; re-check slot name survived join
img = C.setup_ao_bake_and_wire(merged, size=512, samples=20)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'models', 'balloon.glb'))
C.export_glb(out, objects=[merged])
C.report_size(out)
print('TRIS', len(merged.data.polygons))
print('MATERIALS', [s.material.name for s in merged.material_slots])
