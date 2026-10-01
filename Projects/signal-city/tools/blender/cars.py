# Signal City's car sheet (WISHLIST.md B2): every archetype in js/sprites.js,
# in each of its four palettes, top-down, in sprites.js's metres, packed into
# assets/sprites/cars.png with its atlas in assets/sprites/cars.json.
#
#   blender -b --factory-startup -t 4 -P tools/blender/cars.py
#   blender -b --factory-startup -t 4 -P tools/blender/cars.py -- standard/0/0
#
# With no frame named it renders the whole sheet and writes it. Naming frames
# renders only those, into tools/blender/out/, and writes nothing the game
# loads: that is for looking at one car while its build is changed.
#
# Each build below follows the draw function of the same name in sprites.js,
# part for part and number for number: the same hull points and corner radius,
# the same glass, trim, lamps and wheels, stood up in z so the light has
# something to fall across. A frame is named <archetype>/<palette>/<state>.
# The state is 0 except on the two archetypes whose draw() reads t: rideshare
# has four (t = 0, 0.25, 0.5, 0.75, the four spriteFor caches) and emergency two
# (the light bar's two halves, swapped). The trailer is its own row,
# trailer/<palette>/0, in the cab's palettes.

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

C.check_version()

# Heights in metres. Nothing in the game reads them; they only decide what
# stands over what, and where the light falls.
BODY = (0.30, 0.95)          # the hull's sides
CROWN = ((0.10, 0.10), (0.10, 0.06), (0.12, 0.03))
BODY_TOP = BODY[1] + sum(r for _, r in CROWN)
CAB = (0.95, 1.22)           # the glasshouse
CAB_CROWN = ((0.08, 0.10), (0.10, 0.05))
CAB_TOP = CAB[1] + sum(r for _, r in CAB_CROWN)
ON_BODY = BODY_TOP + 0.01    # a lamp, a seam or a stripe on the paint
ON_ROOF = CAB_TOP + 0.02     # a rack, a sign or a placard over the glass

CHROME = '#dfe3e7'
RUBBER = '#16181b'
SANS_LINE = 6.5 / 48         # sprites.js's placard lettering, in metres


class Car:
    """What one draw function lays down, as parts in a scene."""

    def __init__(self, palette):
        self.p = palette
        self.n = 0
        self.mats = {}

    def _name(self, kind):
        self.n += 1
        return f'{kind}{self.n:02d}'

    def mat(self, kind, hexv, **kw):
        key = (kind, hexv, tuple(sorted(kw.items())))
        if key not in self.mats:
            make = {'paint': C.paint_mat, 'matte': C.matte_mat, 'glass': C.glass_mat,
                    'lamp': C.lamp_mat}[kind]
            self.mats[key] = make(f'{kind}{len(self.mats):02d}', hexv, **kw)
        return self.mats[key]

    def hull(self, pts, r, colour=None, z=BODY):
        C.slab(self._name('hull'), (pts, r), *z,
               self.mat('paint', colour or self.p['body']), crown=CROWN)

    def box(self, x, y, w, h, r, z, colour, crown=(), kind='paint', **kw):
        """A raised block of its own height: a bag, a sign, a light bar, an
        exhaust stack, a compartment roof. It casts a shadow."""
        C.slab(self._name('box'), C.rrect(x, y, w, h, r), z[0], z[1],
               self.mat(kind, colour, **kw), crown=crown)

    def glass(self, x, y, w, h, r, colour=None):
        C.slab(self._name('glass'), C.rrect(x, y, w, h, r), *CAB,
               self.mat('glass', colour or self.p['glass']), crown=CAB_CROWN)

    def plate(self, x, y, w, h, r, colour, z=ON_BODY, kind='matte', **kw):
        C.plate(self._name('plate'), C.rrect(x, y, w, h, r), z, self.mat(kind, colour, **kw))

    def poly(self, pts, colour, z=ON_BODY, kind='matte', **kw):
        C.plate(self._name('plate'), (pts, 0.0), z, self.mat(kind, colour, **kw))

    def strip(self, pts, width, colour, z=ON_BODY, kind='matte'):
        """A stroke along a polyline, as a band `width` wide."""
        left, right = [], []
        for i, (x, y) in enumerate(pts):
            a = pts[max(i - 1, 0)]
            b = pts[min(i + 1, len(pts) - 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            k = (dx * dx + dy * dy) ** 0.5
            nx, ny = -dy / k * width / 2, dx / k * width / 2
            left.append((x + nx, y + ny))
            right.append((x - nx, y - ny))
        self.poly(left + right[::-1], colour, z, kind)

    def glow(self, x, y, w, h, colour, alpha, inner, outer, centre, z):
        """Light spilling over the car or the road: emission over the film's
        transparency, fading out from `centre`, inside the rectangle
        sprites.js fills."""
        m = C.glow_mat(self._name('glowmat'), colour, alpha, inner, outer, centre)
        C.plate(self._name('glow'), C.rrect(x, y, w, h, 0.0), z, m)

    def line(self, x0, y0, x1, y1, width, colour, z=ON_BODY):
        """A straight stroke, as a thin plate along it."""
        if x0 == x1:
            self.plate(x0 - width / 2, min(y0, y1), width, abs(y1 - y0), 0.0, colour, z)
        else:
            self.plate(min(x0, x1), y0 - width / 2, abs(x1 - x0), width, 0.0, colour, z)

    def wheels(self, axle_x, half_w, length=0.72, thick=0.30, peek=0.10):
        m = self.mat('matte', RUBBER, roughness=0.9)
        for x in axle_x:
            for s in (-1, 1):
                y = -half_w - peek if s < 0 else half_w + peek - thick
                C.wheel(self._name('wheel'), x, y, length, thick, m)


# ------------------------------------------------------------------ builds

def standard(c, state):
    half_w = 1.8 / 2
    c.wheels([1.35, -1.35], half_w)
    c.hull([(2.30, -0.58), (2.30, 0.58), (1.60, 0.90), (-1.75, 0.90),
            (-2.30, 0.64), (-2.30, -0.64), (-1.75, -0.90), (1.60, -0.90)], 0.34)
    c.glass(-0.95, -0.62, 1.85, 1.24, 0.30)
    seam = C.darken(c.p['body'], 0.2)
    c.line(1.00, -0.70, 1.00, 0.70, 0.04, seam)
    c.line(-1.35, -0.70, -1.35, 0.70, 0.04, seam)
    c.plate(2.06, -0.52, 0.22, 1.04, 0.09, c.p['accent'])
    c.plate(-2.26, -0.56, 0.20, 1.12, 0.08, c.p['accent'])

def granny(c, state):
    half_w = 1.9 / 2
    c.wheels([1.80, -1.80], half_w, length=0.78)
    c.hull([(2.90, -0.70), (2.90, 0.70), (2.55, 0.95), (-2.70, 0.95),
            (-2.90, 0.80), (-2.90, -0.80), (-2.70, -0.95), (2.55, -0.95)], 0.16)
    c.glass(-0.80, -0.66, 1.70, 1.32, 0.22)
    seam = C.darken(c.p['body'], 0.22)
    c.line(-1.10, -0.82, -1.10, 0.82, 0.045, seam)
    c.line(-2.55, -0.82, -2.55, 0.82, 0.045, seam)
    for s in (-1, 1):
        c.plate(-2.45, s * 0.86 - 0.045, 4.95, 0.09, 0.045, CHROME, kind='paint')
    c.box(2.74, -0.74, 0.20, 1.48, 0.07, (BODY[0], BODY[1] - 0.2), CHROME)
    c.box(-2.94, -0.74, 0.20, 1.48, 0.07, (BODY[0], BODY[1] - 0.2), CHROME)
    c.plate(2.40, -0.90, 0.26, 0.34, 0.08, c.p['accent'])
    c.plate(2.40, 0.56, 0.26, 0.34, 0.08, c.p['accent'])


def aggressive(c, state):
    half_w = 2.2 / 2
    c.wheels([1.55, -1.55], half_w, length=0.86, thick=0.34, peek=0.12)
    c.hull([(2.50, -0.86), (2.50, 0.86), (2.35, 1.10), (-2.35, 1.10),
            (-2.50, 0.86), (-2.50, -0.86), (-2.35, -1.10), (2.35, -1.10)], 0.20)
    dark = C.darken(c.p['glass'], 0.35)
    c.glass(-0.55, -0.80, 1.65, 1.60, 0.20, dark)
    c.glass(-2.05, -0.74, 0.60, 1.48, 0.16, dark)
    for s in (-1, 1):
        c.box(-1.60, s * 0.70 - 0.06, 3.00, 0.12, 0.06, (CAB[0], ON_ROOF + 0.04),
              C.darken(c.p['accent'], 0.1))
    c.plate(2.28, -0.78, 0.22, 1.56, 0.08, c.p['accent'])


def tourist(c, state):
    half_w = 2.0 / 2
    c.wheels([1.60, -1.50], half_w, length=0.78)
    c.hull([(2.50, -0.62), (2.50, 0.62), (1.90, 1.00), (-2.00, 1.00),
            (-2.50, 0.72), (-2.50, -0.72), (-2.00, -1.00), (1.90, -1.00)], 0.52)
    c.glass(-1.95, -0.70, 3.35, 1.40, 0.42)
    rack = '#1e2024'
    for s in (-1, 1):
        c.box(-1.70, s * 0.72 - 0.04, 2.80, 0.08, 0.0, (CAB[0], ON_ROOF + 0.03), rack, kind='matte')
    c.box(-1.30, -0.58, 2.05, 1.16, 0.22, (CAB[0], ON_ROOF + 0.12), c.p['accent'],
          crown=((0.06, 0.06), (0.10, 0.03)), kind='matte')
    strap = C.darken(c.p['accent'], 0.35)
    top = ON_ROOF + 0.22
    c.line(-0.70, -0.58, -0.70, 0.58, 0.05, strap, top)
    c.line(0.20, -0.58, 0.20, 0.58, 0.05, strap, top)


def trucker(c, state):
    half_w = 2.4 / 2
    c.wheels([0.80, -0.70], half_w, length=0.82, thick=0.36, peek=0.12)
    for s in (-1, 1):
        c.box(-1.42, s * 0.92 - 0.11, 0.30, 0.22, 0.10, (BODY[0], CAB_TOP + 0.3), '#3c4148',
              kind='matte', roughness=0.5)
    c.hull([(1.30, -0.92), (1.30, 0.92), (1.18, 1.20), (-1.30, 1.20),
            (-1.30, -1.20), (1.18, -1.20)], 0.18)
    c.glass(0.35, -0.86, 0.80, 1.72, 0.16)
    c.plate(1.10, -0.84, 0.22, 1.68, 0.07, CHROME, kind='paint')
    c.plate(-1.15, -0.42, 0.70, 0.84, 0.16, '#2a2e34')


def trailer(c, state):
    """Painted the way drawTrailer() is: the box in the cab's accent, the
    stripe in the cab's body colour."""
    half_w = 2.5 / 2
    c.wheels([-3.30, -4.05], half_w, length=0.78, thick=0.34, peek=0.10)
    c.hull([(4.50, -1.18), (4.50, 1.18), (-4.50, 1.18), (-4.50, -1.18)], 0.16,
           colour=c.p['accent'])
    for s in (-1, 1):
        c.plate(-4.20, s * 0.96 - 0.10, 8.40, 0.20, 0.09, c.p['body'], kind='paint')
    c.line(-4.34, -1.10, -4.34, 1.10, 0.05, C.darken(c.p['accent'], 0.28))
    for s in (-1, 1):
        c.plate(1.70, s * 0.90 - 0.09, 0.36, 0.18, 0.07, '#2a2e34')


def student(c, state):
    half_w = 1.7 / 2
    c.wheels([1.10, -1.10], half_w, length=0.66, thick=0.28)
    c.hull([(1.90, -0.56), (1.90, 0.56), (1.35, 0.85), (-1.70, 0.85),
            (-1.90, 0.66), (-1.90, -0.66), (-1.70, -0.85), (1.35, -0.85)], 0.40)
    c.glass(-1.45, -0.60, 2.15, 1.20, 0.30)
    c.plate(1.66, -0.50, 0.22, 1.00, 0.08, c.p['accent'])
    # The roof placard, 0.2 m back of centre as sprites.js translates it, and
    # its lettering at the same size: 11 px at 1/48 is 0.23 m.
    x = -0.20
    c.box(x - 0.645, -0.465, 1.29, 0.93, 0.12, (CAB[0], ON_ROOF + 0.02), '#7a5c00', kind='matte')
    c.plate(x - 0.62, -0.44, 1.24, 0.88, 0.10, '#ffd21e', ON_ROOF + 0.03)
    ink = c.mat('matte', '#241c00')
    C.text(c._name('text'), 'STUDENT', x, -SANS_LINE, 11 / 48, ON_ROOF + 0.04, ink)
    C.text(c._name('text'), 'DRIVER', x, SANS_LINE, 11 / 48, ON_ROOF + 0.04, ink)


def rideshare(c, state):
    t = state / 4
    pulse = 0.62 + 0.38 * math.sin(t * 3.4)
    c.glow(-2.4, -1.9, 4.8, 3.8, '#ffffff', 0.30 * pulse, 0.15, 1.9, (-0.10, 0.0), 0.03)
    half_w = 1.7 / 2
    c.wheels([1.25, -1.25], half_w, length=0.68, thick=0.28)
    c.hull([(2.20, -0.54), (2.20, 0.54), (1.50, 0.85), (-1.65, 0.85),
            (-2.20, 0.60), (-2.20, -0.60), (-1.65, -0.85), (1.50, -0.85)], 0.36)
    c.glass(-0.85, -0.58, 1.70, 1.16, 0.28)
    c.plate(2.00, -0.46, 0.20, 0.92, 0.08, c.p['accent'])
    # The lit roof sign: its rim, its face brightening with the pulse, and the
    # white panel inside it.
    c.box(-0.505, -0.325, 1.01, 0.65, 0.13, (CAB[0], ON_ROOF + 0.08), C.darken(c.p['accent'], 0.35),
          kind='matte')
    c.plate(-0.48, -0.30, 0.96, 0.60, 0.12, C.lighten(c.p['accent'], 0.35 * pulse), ON_ROOF + 0.09,
            kind='lamp', strength=round(0.45 * pulse, 4))
    c.plate(-0.30, -0.16, 0.60, 0.32, 0.08, '#ffffff', ON_ROOF + 0.10,
            kind='lamp', strength=round(0.55 * pulse, 4))


RED, BLUE = '#e8332b', '#2f6fe6'


def emergency(c, state):
    half_w = 2.2 / 2
    c.wheels([1.80, -1.70], half_w, length=0.84, thick=0.34, peek=0.11)
    c.hull([(2.80, -0.88), (2.80, 0.88), (2.62, 1.10), (-2.62, 1.10),
            (-2.80, 0.88), (-2.80, -0.88), (-2.62, -1.10), (2.62, -1.10)], 0.22)
    c.glass(1.35, -0.82, 0.85, 1.64, 0.18)
    for s in (-1, 1):
        c.plate(-2.50, s * 0.82 - 0.14, 5.00, 0.28, 0.12, c.p['accent'], kind='paint')
    # The light bar: state 0 is sprites.js's t = 0 (red on the -y half), state 1
    # its t = 0.25 (swapped). Each half throws its colour over the roof around
    # it, where drawEmergency() lays its flare.
    left, right = (RED, BLUE) if state == 0 else (BLUE, RED)
    c.box(0.55, -0.98, 0.42, 1.96, 0.10, (BODY[0], ON_BODY + 0.12), '#2a2e34', kind='matte')
    c.plate(0.60, -0.92, 0.32, 0.86, 0.08, left, ON_BODY + 0.13, kind='lamp', strength=2.0)
    c.plate(0.60, 0.06, 0.32, 0.86, 0.08, right, ON_BODY + 0.13, kind='lamp', strength=2.0)
    c.glow(0.30, -1.35, 0.92, 1.35, left, 0.45, 0.2, 1.1, (0.76, -0.49), ON_BODY + 0.15)
    c.glow(0.30, 0.0, 0.92, 1.35, right, 0.45, 0.2, 1.1, (0.76, 0.49), ON_BODY + 0.15)


def motorcade(c, state):
    half_w = 2.1 / 2
    c.wheels([1.60, -1.60], half_w, length=0.84, thick=0.34, peek=0.12)
    c.hull([(2.60, -0.82), (2.60, 0.82), (2.42, 1.05), (-2.42, 1.05),
            (-2.60, 0.82), (-2.60, -0.82), (-2.42, -1.05), (2.42, -1.05)], 0.22)
    dark = C.darken(c.p['glass'], 0.3)
    c.glass(-0.60, -0.78, 1.70, 1.56, 0.20, dark)
    c.glass(-2.12, -0.72, 0.60, 1.44, 0.16, dark)
    c.box(0.30, -0.92, 0.34, 1.84, 0.08, (CAB[0], ON_ROOF + 0.06), '#2a2e34', kind='matte')
    c.plate(2.38, -0.74, 0.20, 1.48, 0.08, c.p['accent'])
    for s in (-1, 1):
        c.line(2.10, s * 0.88, 2.10, s * 1.35, 0.05, CHROME, ON_BODY + 0.3)
        c.poly([(2.10, s * 1.35), (1.60, s * 1.30), (2.10, s * 1.10)], c.p['accent'], ON_BODY + 0.31)


def procession(c, state):
    half_w = 1.9 / 2
    c.wheels([1.75, -1.60], half_w, length=0.76)
    c.hull([(2.80, -0.66), (2.80, 0.66), (2.30, 0.92), (-2.60, 0.95),
            (-2.80, 0.78), (-2.80, -0.78), (-2.60, -0.95), (2.30, -0.92)], 0.26)
    c.glass(0.55, -0.66, 0.80, 1.32, 0.22)
    # The long rear compartment, its roof a shade lighter than the body.
    c.box(-2.45, -0.72, 2.85, 1.44, 0.18, CAB, C.lighten(c.p['body'], 0.08), crown=CAB_CROWN)
    for s in (-1, 1):
        pts = []
        for k in range(9):
            u = k / 8
            x = (1 - u) ** 2 * -0.35 + 2 * (1 - u) * u * -1.00 + u * u * -1.75
            y = (1 - u) ** 2 * s * 0.80 + 2 * (1 - u) * u * s * 0.55 + u * u * s * 0.80
            pts.append((x, y))
        c.strip(pts, 0.07, CHROME, CAB_TOP + 0.02, kind='paint')
    c.plate(2.62, -0.62, 0.16, 0.34, 0.06, '#fff4c2', kind='lamp', strength=1.0)
    c.plate(2.62, 0.28, 0.16, 0.34, 0.06, '#fff4c2', kind='lamp', strength=1.0)
    c.plate(-2.78, -0.60, 0.18, 1.20, 0.07, c.p['accent'])


BUILDS = {
    'standard': (standard, 1),
    'granny': (granny, 1),
    'aggressive': (aggressive, 1),
    'tourist': (tourist, 1),
    'trucker': (trucker, 1),
    'trailer': (trailer, 1),
    'student': (student, 1),
    'rideshare': (rideshare, 4),
    'emergency': (emergency, 2),
    'motorcade': (motorcade, 1),
    'procession': (procession, 1),
}


# ------------------------------------------------------------------ the run

def frames_of(spec):
    """Every frame the sheet holds: (name, archetype, palette, state, length,
    width), in a fixed order."""
    out = []
    for a in spec['archetypes']:
        if a['name'] not in BUILDS:
            continue
        _, states = BUILDS[a['name']]
        for v, pal in enumerate(a['palettes']):
            for s in range(states):
                out.append((f"{a['name']}/{v}/{s}", a['name'], pal, s, a['length'], a['width']))
        if a['name'] == 'trucker' and 'trailer' in BUILDS:
            t = spec['trailer']
            for v, pal in enumerate(a['palettes']):
                out.append((f'trailer/{v}/0', 'trailer', pal, 0, t['length'], t['width']))
    return out


def main():
    b = C.budget()
    sheet = b['sheets']['cars']
    ppm, pad = b['ppm'], b['pad']
    wanted = C.args()
    todo = frames_of(C.spec())
    if wanted:
        todo = [f for f in todo if f[0] in wanted]
        missing = set(wanted) - {f[0] for f in todo}
        if missing:
            print(f'cars.py: no frame named {", ".join(sorted(missing))}')
            sys.exit(1)
    scene = C.reset()
    frames = {}
    t0 = time.time()
    for name, arch, pal, state, length, width in todo:
        C.clear()
        BUILDS[arch][0](Car(pal), state)
        w, h = C.frame_size(length, width, ppm, pad)
        path = os.path.join(C.OUT, 'frames', name.replace('/', '-') + '.png')
        frames[name] = C.render_frame(scene, w, h, ppm, path)
        print(f'cars.py: {name} {w}x{h} ({time.time() - t0:.1f} s)')
    if wanted:
        return
    w, h, px = C.write_sheet(frames, sheet['width'], sheet['png'], sheet['atlas'], ppm, pad)
    print(f'cars.py: {len(frames)} frames, sheet {w}x{h}, written to {sheet["png"]}')
    print(f'cars.py: contact sheet {C.contact_sheet("cars", w, h, px)}')


main()
