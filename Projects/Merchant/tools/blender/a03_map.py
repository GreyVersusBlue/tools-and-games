"""A03 the map table: a carved and painted relief model of the lands from
West Africa to India, built from real data.

    blender -b --factory-startup -P scripts/a03_map.py -- --preview
    blender -b --factory-startup -P scripts/a03_map.py -- --final

Inputs (inputs/geo, see inputs.json):
  ne_50m_land.geojson, ne_50m_lakes.geojson, ne_50m_rivers_lake_centerlines.geojson
  (Natural Earth, public domain) and etopo1_4min.asc (NOAA ETOPO1 Ice, public
  domain, 4 arc-minute subset 10W-80E, 5N-48N, from NOAA ERDDAP).

Writes map-cairo (still), map-cairo-geo.json (out/), and the red-dot check
previews/map-check.png.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C          # noqa: E402
import kit_arch as A        # noqa: E402
import bpy                  # noqa: E402
from mathutils import Vector  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402

GEO = os.path.join(C.INPUTS, "geo")

LON0, LON1, LAT0, LAT1 = -10.0, 80.0, 5.0, 48.0
KX = math.cos(math.radians(27.0))           # equirectangular, scaled for lat 27
MODEL_W = 1.60                               # metres
S = MODEL_W / ((LON1 - LON0) * KX)           # metres per degree of latitude
MODEL_H = (LAT1 - LAT0) * S
SUN_PRESET = "late"
EXAG = 15.0                                  # vertical exaggeration
M_PER_DEG = 111_320.0
ZS = S / M_PER_DEG * EXAG                    # model metres per metre of real height
LAND_BASE = 0.0022                           # carved step at the coast
TABLE_Z = 0.80
MODEL_Z = TABLE_Z + 0.030                    # sea surface of the model
TEX_W = 4096
TEX_H = int(round(TEX_W * (LAT1 - LAT0) / (LON1 - LON0)))

# lakes in Natural Earth that did not exist (or not in this shape) in the 1300s
MODERN_WATER = {"Lake Nasser", "Kainji Reservoir", "Lake Volta", "Kakhovka Reservoir",
                "Toktogul Res.", "Lake Tharthar", "Razzaza Lake", "Shardara Bögeni",
                "Sarygamysh Köli", "South Aral Sea", "North Aral Sea", "Barsakelmes Lake"}
RIVERS = {"Nile", "Rosetta Branch", "Damietta Branch", "El Bahr el Abyad", "Bahr el Jebel",
          "El Bahr el Azraq", "Abay", "Niger", "Tigris", "Dicle", "Euphrates", "Firat",
          "Al Furat", "Shatt al Arab"}

STOPS = {
    "Cairo": (30.04, 31.24), "Alexandria": (31.20, 29.92), "Venice": (45.44, 12.33),
    "Constantinople": (41.01, 28.98), "Tunis": (36.80, 10.18), "Qus": (25.92, 32.76),
    "Aydhab": (22.33, 36.49), "Jeddah": (21.49, 39.19), "Aden": (12.79, 45.03),
    "Calicut": (11.25, 75.78), "Caffa": (45.03, 35.38), "Trebizond": (41.00, 39.72),
    "Damascus": (33.51, 36.29), "Aleppo": (36.20, 37.16), "Tabriz": (38.08, 46.29),
    "Samarkand": (39.65, 66.96), "Hormuz": (27.10, 56.45), "Timbuktu": (16.77, -3.01),
    "Gao": (16.27, -0.04), "Taghaza": (23.60, -5.00), "Sijilmasa": (31.28, -4.28),
    "Tuat": (27.87, -0.29), "Awjila": (29.11, 21.29),
}


# --------------------------------------------------------------------------
# data
# --------------------------------------------------------------------------
def load_etopo():
    path = os.path.join(GEO, "etopo1_4min.asc")
    hdr = {}
    with open(path) as f:
        for _ in range(6):
            k, v = f.readline().split()
            hdr[k.lower()] = float(v)
        data = np.loadtxt(f, dtype=np.float32)
    assert data.shape == (int(hdr["nrows"]), int(hdr["ncols"])), data.shape
    # rows run north to south in ESRI ASCII
    return data, hdr


def lonlat_to_px(lon, lat):
    return (np.asarray(lon) - LON0) / (LON1 - LON0) * TEX_W, (LAT1 - np.asarray(lat)) / (LAT1 - LAT0) * TEX_H


def rings_of(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for p in geom["coordinates"] for r in p]
    return []


def raster_polys(rings, w=TEX_W, h=TEX_H):
    """Even-odd scanline fill of lon/lat rings onto the texture grid."""
    segs = []
    for ring in rings:
        a = np.asarray(ring, dtype=np.float64)
        if a[:, 0].max() < LON0 - 1 or a[:, 0].min() > LON1 + 1 or a[:, 1].max() < LAT0 - 1 or a[:, 1].min() > LAT1 + 1:
            continue
        x, y = lonlat_to_px(a[:, 0], a[:, 1])
        segs.append(np.stack([x[:-1], y[:-1], x[1:], y[1:]], 1))
    if not segs:
        return np.zeros((h, w), bool)
    E = np.concatenate(segs)
    x0, y0, x1, y1 = E.T
    mask = np.zeros((h, w), bool)
    cols = np.arange(w) + 0.5
    for r in range(h):
        yc = r + 0.5
        hit = ((y0 <= yc) & (y1 > yc)) | ((y1 <= yc) & (y0 > yc))
        if not hit.any():
            continue
        xa, ya, xb, yb = x0[hit], y0[hit], x1[hit], y1[hit]
        xs = np.sort(xa + (yc - ya) * (xb - xa) / (yb - ya))
        cnt = np.searchsorted(xs, cols)
        mask[r] = (cnt % 2) == 1
    return mask


def raster_lines(lines, w=TEX_W, h=TEX_H, step=0.35):
    m = np.zeros((h, w), bool)
    for line in lines:
        a = np.asarray(line, dtype=np.float64)
        x, y = lonlat_to_px(a[:, 0], a[:, 1])
        for i in range(len(x) - 1):
            n = int(max(abs(x[i + 1] - x[i]), abs(y[i + 1] - y[i])) / step) + 1
            t = np.linspace(0, 1, n)
            xi = np.clip((x[i] + (x[i + 1] - x[i]) * t).astype(int), 0, w - 1)
            yi = np.clip((y[i] + (y[i + 1] - y[i]) * t).astype(int), 0, h - 1)
            m[yi, xi] = True
    return m


def dilate(m, n):
    m = m.copy()
    for _ in range(n):
        p = np.pad(m, 1)
        m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def blur(a, n=1):
    a = a.astype(np.float32)
    for _ in range(n):
        p = np.pad(a, 1, mode="edge")
        a = (p[1:-1, 1:-1] * 4 + p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 8.0
    return a


def resample(grid, w, h):
    """Bilinear resample a (rows, cols) grid that spans the extent, centre
    registered at the corners (ETOPO grid-registration), onto w x h pixel
    centres."""
    gr, gc = grid.shape
    xs = (np.arange(w) + 0.5) / w * (gc - 1)
    ys = (np.arange(h) + 0.5) / h * (gr - 1)
    x0 = np.floor(xs).astype(int).clip(0, gc - 2)
    y0 = np.floor(ys).astype(int).clip(0, gr - 2)
    fx = (xs - x0)[None, :]
    fy = (ys - y0)[:, None]
    g = grid
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy).astype(np.float32)


def value_noise(w, h, cells, salt):
    r = np.random.default_rng(C.SEED + salt)
    g = r.random((cells + 1, int(cells * w / h) + 2)).astype(np.float32)
    return resample(g, w, h)


def build_textures(elev):
    """Returns colour RGBA (h, w, 4) float, sea mask, river mask."""
    land_geo = json.load(open(os.path.join(GEO, "ne_50m_land.geojson"), encoding="utf-8"))
    lakes_geo = json.load(open(os.path.join(GEO, "ne_50m_lakes.geojson"), encoding="utf-8"))
    riv_geo = json.load(open(os.path.join(GEO, "ne_50m_rivers_lake_centerlines.geojson"), encoding="utf-8"))
    land = raster_polys([r for f in land_geo["features"] for r in rings_of(f["geometry"])])
    lake_rings = [r for f in lakes_geo["features"] if f["properties"].get("name") not in MODERN_WATER
                  for r in rings_of(f["geometry"])]
    lakes = raster_polys(lake_rings)
    E = resample(elev, TEX_W, TEX_H)
    # the Aral Sea before its 20th-century shrinking: its basin below ~53 m
    lon = LON0 + (np.arange(TEX_W) + 0.5) / TEX_W * (LON1 - LON0)
    lat = LAT1 - (np.arange(TEX_H) + 0.5) / TEX_H * (LAT1 - LAT0)
    LON, LAT = np.meshgrid(lon, lat)
    aral = (LON > 58.0) & (LON < 61.9) & (LAT > 43.3) & (LAT < 46.9) & (E < 53.0)
    water = (~land) | lakes | aral
    rivers = raster_lines([c for f in riv_geo["features"] if f["properties"].get("name") in RIVERS
                           for c in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiLineString"
                                     else [f["geometry"]["coordinates"]])])
    rivers = dilate(rivers, 1) & ~water

    # ---- painted land colours ------------------------------------------
    small = 1024
    sh = int(small * TEX_H / TEX_W)
    ws = resample(water.astype(np.float32), small, sh) > 0.5
    rs = resample(rivers.astype(np.float32), small, sh) > 0.05
    near_sea = blur(dilate(ws, 14).astype(np.float32), 6)       # ~1.2 deg
    near_riv = blur(dilate(rs, 3).astype(np.float32), 3)        # ~0.25 deg
    near_sea = resample(near_sea, TEX_W, TEX_H)
    near_riv = resample(near_riv, TEX_W, TEX_H)

    sand = np.array([0.68, 0.60, 0.45], np.float32)
    steppe = np.array([0.55, 0.52, 0.36], np.float32)
    green = np.array([0.34, 0.38, 0.22], np.float32)
    savanna = np.array([0.52, 0.46, 0.28], np.float32)
    rock = np.array([0.46, 0.40, 0.34], np.float32)
    high = np.array([0.66, 0.64, 0.62], np.float32)
    snow = np.array([0.90, 0.90, 0.91], np.float32)

    def ramp(v, a, b):
        """0 below a, 1 above b, smooth between (works for a > b too)."""
        t = np.clip((v - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    def soft_box(lon0, lon1, lat0, lat1, soft=2.0):
        return (ramp(LON, lon0 - soft, lon0 + soft) * ramp(LON, lon1 + soft, lon1 - soft)
                * ramp(LAT, lat0 - soft, lat0 + soft) * ramp(LAT, lat1 + soft, lat1 - soft))

    g = np.zeros_like(E)                                 # 0 = desert, 1 = green
    west_of_iran = ramp(LON, 47.0, 42.0)
    # Mediterranean, Black Sea and Atlantic shores of the north
    north_shore = np.maximum(ramp(LAT, 31.5, 34.5), ramp(LAT, 29.5, 32.5) * ramp(LON, 13.0, 9.0))
    g = np.maximum(g, near_sea * north_shore * west_of_iran)
    # Europe and northern Anatolia generally green
    g = np.maximum(g, ramp(LAT, 39.5, 43.0) * west_of_iran)
    # Caucasus and the south Caspian shore
    g = np.maximum(g, soft_box(39, 54, 36.5, 44, 1.5) * near_sea * 0.9)
    g = np.maximum(g, soft_box(39, 47, 41, 44, 1.5) * 0.7)
    # Nile valley and delta, Mesopotamia, Niger
    g = np.maximum(g, near_riv * 1.0)
    delta = np.clip(1.0 - np.hypot((LON - 31.0) / 1.6, (LAT - 30.9) / 0.75), 0, 1) ** 0.5
    g = np.maximum(g, delta)
    # the Sahel and savanna, greening southward
    sav = ramp(LAT, 16.0, 10.0) * ramp(LON, 42.0, 36.0)
    # Ethiopian and Yemeni highlands
    g = np.maximum(g, ramp(E, 1400, 2300) * soft_box(34, 46, 0, 16, 1.5) * 0.9)
    # India: Malabar coast and the south very green, the north plain less so
    g = np.maximum(g, ramp(LON, 71.5, 73.5) * ramp(LAT, 22.0, 17.0) * np.clip(near_sea * 1.4, 0.45, 1))
    g = np.maximum(g, ramp(LON, 75.5, 78.5) * ramp(LAT, 32.0, 27.0) * ramp(LAT, 19.0, 23.0) * 0.6)
    # Central Asian steppe north of the deserts
    stp = ramp(LAT, 40.0, 44.0) * ramp(LON, 43.0, 48.0)
    g = blur(g, 3)

    nz = value_noise(TEX_W, TEX_H, 60, 1) * 0.6 + value_noise(TEX_W, TEX_H, 220, 2) * 0.4
    g = np.clip(g + (nz - 0.5) * 0.18, 0, 1)
    col = sand[None, None, :] * (1 - g[..., None]) + green[None, None, :] * g[..., None]
    col = col * (1 - sav[..., None] * (1 - g[..., None])) + savanna * (sav[..., None] * (1 - g[..., None]))
    col = col * (1 - stp[..., None] * 0.7 * (1 - g[..., None])) + steppe * (stp[..., None] * 0.7 * (1 - g[..., None]))
    # mountains: grey-brown, then pale grey, a little white on the highest
    m1 = np.clip((E - 1100.0) / 1400.0, 0, 1)[..., None] * 0.85
    col = col * (1 - m1) + rock * m1
    m2 = np.clip((E - 3300.0) / 900.0, 0, 1)[..., None]
    col = col * (1 - m2) + high * m2
    m3 = np.clip((E - 4400.0) / 500.0, 0, 1)[..., None]
    col = col * (1 - m3) + snow * m3
    # painted, hand-mixed: a little brush mottling
    col = col * (0.94 + 0.12 * nz[..., None])
    # sea: enamel, deeper water a shade darker; kept calm
    depth = np.clip(-E / 3000.0, 0, 1)
    sea = np.array([0.035, 0.150, 0.190], np.float32)[None, None, :] * (1.08 - 0.25 * depth[..., None])
    wf = blur(water.astype(np.float32), 1)[..., None]
    col = col * (1 - wf) + sea * wf
    rf = blur(rivers.astype(np.float32), 1)[..., None]
    col = col * (1 - rf) + np.array([0.04, 0.13, 0.15], np.float32) * rf
    rgba = np.concatenate([col, np.ones_like(col[..., :1])], -1)
    return rgba, water, rivers, E


def make_image(name, arr, noncolor=False):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr, np.ones_like(arr)], -1)
    # Blender images are stored bottom row first
    im.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    else:
        # values above were authored as display colours: store as sRGB
        pass
    im.pack()
    return im


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def model_xy(lon, lat):
    return ((np.asarray(lon) - LON0) * KX * S - MODEL_W / 2, (np.asarray(lat) - LAT0) * S - MODEL_H / 2)


def build_relief(elev, water_tex):
    gr, gc = elev.shape
    lon = np.linspace(LON0, LON1, gc)
    lat = np.linspace(LAT1, LAT0, gr)
    LON, LAT = np.meshgrid(lon, lat)
    # land/sea at each vertex from the Natural Earth mask
    px = np.clip(((LON - LON0) / (LON1 - LON0) * TEX_W).astype(int), 0, TEX_W - 1)
    py = np.clip(((LAT1 - LAT) / (LAT1 - LAT0) * TEX_H).astype(int), 0, TEX_H - 1)
    wat = water_tex[py, px]
    h = np.maximum(blur(elev, 1), 0.0)
    z = np.where(wat, 0.0, LAND_BASE + h * ZS).astype(np.float32)
    X, Y = model_xy(LON, LAT)
    co = np.stack([X, Y, z + MODEL_Z], -1).astype(np.float32).reshape(-1, 3)
    # faces
    idx = np.arange(gr * gc).reshape(gr, gc)
    a = idx[:-1, :-1].ravel()
    b = idx[1:, :-1].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[:-1, 1:].ravel()
    quads = np.stack([a, b, c, d], 1)             # counter-clockwise seen from above
    me = bpy.data.meshes.new("Relief")
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.ravel())
    nl = quads.size
    me.loops.add(nl)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(0, nl, 4, dtype=np.int32))
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name="UV")
    U = ((LON - LON0) / (LON1 - LON0)).ravel()
    V = ((LAT - LAT0) / (LAT1 - LAT0)).ravel()
    luv = np.stack([U[quads.ravel()], V[quads.ravel()]], 1).astype(np.float32)
    uv.data.foreach_set("uv", luv.ravel())
    me.shade_smooth()
    me.validate()
    ob = bpy.data.objects.new("Relief", me)
    C.link(ob)
    return ob, z


def relief_material(col_img, water_img, river_img):
    b = C._NB("relief")
    tc = b.n("ShaderNodeTexCoord")

    def tex(img):
        t = b.n("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Cubic"
        b.link(tc.outputs["UV"], t.inputs["Vector"])
        return t

    tcol = tex(col_img)
    twat = tex(water_img)
    triv = tex(river_img)
    # land: painted plaster, matt, with brush and carving texture
    vec = b.coords(1.0)
    nz = b.noise(vec, 160.0, 6, 0.6)
    land = b.n("ShaderNodeBsdfPrincipled")
    b.link(tcol.outputs["Color"], land.inputs["Base Color"])
    land.inputs["Roughness"].default_value = 0.78
    land.inputs["Specular IOR Level"].default_value = 0.35
    bp = b.bump(nz.outputs["Fac"], 0.12, 0.0006)
    b.link(bp.outputs[0], land.inputs["Normal"])
    # sea and river inlay: enamel
    sea = b.bsdf
    b.link(tcol.outputs["Color"], sea.inputs["Base Color"])
    sea.inputs["Roughness"].default_value = 0.4
    sea.inputs["Coat Weight"].default_value = 1.0
    sea.inputs["Coat Roughness"].default_value = 0.10
    sw = b.noise(vec, 6.0, 3, 0.5)
    bp2 = b.bump(sw.outputs["Fac"], 0.015, 0.001)
    b.link(bp2.outputs[0], sea.inputs["Coat Normal"])
    # inlaid rivers sit a hair below the land surface
    rb = b.bump(triv.outputs["Color"], 0.25, 0.0006)
    b.link(rb.outputs[0], sea.inputs["Normal"])
    fac = b.math("MAXIMUM", twat.outputs["Color"], triv.outputs["Color"])
    mx = b.n("ShaderNodeMixShader")
    b.link(fac, mx.inputs["Fac"])
    b.link(land.outputs[0], mx.inputs[1])
    b.link(sea.outputs[0], mx.inputs[2])
    b.link(mx.outputs[0], b.out.inputs["Surface"])
    return b.m


# --------------------------------------------------------------------------
# scene
# --------------------------------------------------------------------------
def build():
    C.reset()
    C.setup_render(*C.STILL_MASTER, exposure=-1.0)
    elev, hdr = load_etopo()
    rgba, water, rivers, E = build_textures(elev)
    col_img = make_image("map_colour", rgba)
    wat_img = make_image("map_water", blur(water.astype(np.float32), 1), True)
    riv_img = make_image("map_rivers", blur(rivers.astype(np.float32), 1), True)
    relief, zgrid = build_relief(elev, water)
    relief.data.materials.append(relief_material(col_img, wat_img, riv_img))

    # the model's carved wooden tray and the table under it
    rim = 0.028
    tray = C.box_mesh("Tray", (MODEL_W + 2 * rim, MODEL_H + 2 * rim, 0.035),
                      (0, 0, MODEL_Z - 0.0175 - 0.002), C.M("walnut", scale=1.0))
    C.bevel(tray, 0.006, 3)
    for sx, sy, w, d in ((0, 1, MODEL_W + 2 * rim, rim), (0, -1, MODEL_W + 2 * rim, rim),
                         (1, 0, rim, MODEL_H + 2 * rim), (-1, 0, rim, MODEL_H + 2 * rim)):
        fr = C.box_mesh("Frame", (w, d, 0.012),
                        (sx * (MODEL_W / 2 + rim / 2), sy * (MODEL_H / 2 + rim / 2), MODEL_Z + 0.004),
                        C.M("walnut", scale=1.0))
        C.bevel(fr, 0.004, 3)
    top = C.box_mesh("Table", (2.6, 1.7, 0.05), (0, 0, TABLE_Z - 0.025), C.M("walnut", scale=0.8, val=0.7))
    C.bevel(top, 0.006, 3)

    # room with a big window in the west wall; sun low from the north-west
    # the window runs almost the whole west wall so the sun falls on the
    # whole model; the room is long to the north so no wall shades it
    A.room(-2.4, 2.8, -2.4, 4.6, 3.6, C.M("lime_plaster"), floor_mat=C.M("limestone", scale=0.5),
           window=("W", 0.3, 0.45, 6.7, 3.4), thick=0.3)
    C.sky(SUN_PRESET, sun_turn=-62.0)

    cam = C.tilt_camera("normal", (0.0, 0.004, MODEL_Z), 2.12, 70.0)
    return cam, zgrid


def geo_json(cam, zgrid, ship=(1920, 1080)):
    s = bpy.context.scene
    gr, gc = zgrid.shape

    def surf_z(lon, lat):
        fx = (lon - LON0) / (LON1 - LON0) * (gc - 1)
        fy = (LAT1 - lat) / (LAT1 - LAT0) * (gr - 1)
        x0, y0 = int(min(max(math.floor(fx), 0), gc - 2)), int(min(max(math.floor(fy), 0), gr - 2))
        tx, ty = fx - x0, fy - y0
        z = (zgrid[y0, x0] * (1 - tx) * (1 - ty) + zgrid[y0, x0 + 1] * tx * (1 - ty)
             + zgrid[y0 + 1, x0] * (1 - tx) * ty + zgrid[y0 + 1, x0 + 1] * tx * ty)
        return float(z) + MODEL_Z

    def px(lon, lat):
        x, y = model_xy(lon, lat)
        co = world_to_camera_view(s, cam, Vector((float(x), float(y), surf_z(lon, lat))))
        return round(co.x * ship[0], 1), round((1.0 - co.y) * ship[1], 1)

    grid = []
    for lat in range(int(LAT0), int(LAT1) + 1):
        for lon in range(int(LON0), int(LON1) + 1):
            x, y = px(lon, lat)
            grid.append({"lat": lat, "lon": lon, "x": x, "y": y})
    stops = {}
    for k, (lat, lon) in STOPS.items():
        x, y = px(lon, lat)
        stops[k] = {"lat": lat, "lon": lon, "x": x, "y": y}
    return {
        "image": {"file": "map-cairo.webp", "width": ship[0], "height": ship[1]},
        "extent": {"lon_min": LON0, "lon_max": LON1, "lat_min": LAT0, "lat_max": LAT1},
        "projection": "equirectangular, x scaled by cos(27 deg); rendered through a perspective camera, "
                      "so use the grid to interpolate, not a linear formula",
        "note": "pixel positions taken on the model's surface (relief included) through the render camera; "
                "origin top-left, y down",
        "grid": grid,
        "stops": stops,
    }


def plot_check(img_path, js, out_path):
    """Red dots for the stops, small grey crosses for every 5-degree grid
    crossing, drawn onto a copy of the picture."""
    im = bpy.data.images.load(img_path)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    sx, sy = w / js["image"]["width"], h / js["image"]["height"]

    def dot(x, y, r, col):
        yy, xx = np.ogrid[:h, :w]
        m = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
        a[m, :3] = col

    for gp in js["grid"]:
        if gp["lat"] % 5 == 0 and gp["lon"] % 5 == 0:
            dot(gp["x"] * sx, gp["y"] * sy, max(1.5, 2.0 * sx), (0.85, 0.85, 0.85))
    for k, sp in js["stops"].items():
        dot(sp["x"] * sx, sp["y"] * sy, max(2.5, 5.0 * sx), (1.0, 0.0, 0.0))
    out = bpy.data.images.new("check", w, h, alpha=True)
    out.pixels.foreach_set(np.ascontiguousarray(a[::-1]).ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save()
    print("CHECK", out_path)


def main():
    global SUN_PRESET
    C.parse_args(lambda p: p.add_argument("--sun", default=SUN_PRESET))
    SUN_PRESET = C.ARGS.sun
    cam, zgrid = build()
    path = C.save_still("map-cairo")
    js = geo_json(cam, zgrid)
    if C.ARGS.final:
        jp = os.path.join(C.OUT, "map-cairo-geo.json")
        check_src, check_out = path, os.path.join(C.PREVIEWS, "map-check.png")
    else:
        jp = os.path.join(C.SCRATCH, "map-cairo-geo.json")
        check_src, check_out = path, os.path.join(C.SCRATCH, "map-check.png")
    with open(jp, "w") as f:
        json.dump(js, f, indent=1)
    print("JSON", jp)
    plot_check(check_src, js, check_out)
    C.write_log("a03")


main()
