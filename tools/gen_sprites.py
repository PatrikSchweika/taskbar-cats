#!/usr/bin/env python3
"""Generate pixel-art cat sprite frames as SVG.

Cats are drawn parametrically onto a 32x32 character grid, then emitted as
run-length-merged SVG rects. Poses are data (see POSES); anatomy is code (see
the draw_* functions), so tweaking the art means editing numbers, not 100+
hand-authored files.

Output: src/assets/cats/<palette>/<anim>_<n>.svg
Run:    python3 tools/gen_sprites.py
"""

import math
import os
import shutil

SIZE = 32          # grid is SIZE x SIZE, viewBox is 0 0 SIZE SIZE
BASELINE = 31      # y of the ground; the cat's feet rest here

# Grid character -> semantic role. Palettes map these to hex colours.
#   '.' transparent   'B' body fur      'D' dark fur/stripes/points
#   'L' light fur     'K' outline       'E' eye      'P' pink (nose/ears/paws)
#   'W' eye highlight
TRANSPARENT = '.'


# --------------------------------------------------------------------------
# Canvas
# --------------------------------------------------------------------------

class Canvas:
    def __init__(self, size=SIZE):
        self.size = size
        self.g = [[TRANSPARENT] * size for _ in range(size)]

    def put(self, x, y, ch):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.size and 0 <= y < self.size:
            self.g[y][x] = ch

    def get(self, x, y):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.size and 0 <= y < self.size:
            return self.g[y][x]
        return TRANSPARENT

    def ellipse(self, cx, cy, rx, ry, ch, only_over=None):
        """Filled ellipse. only_over: if set, paint only where the existing
        cell is one of these chars (used for stripes/patches)."""
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx = (x - cx) / max(rx, 0.001)
                dy = (y - cy) / max(ry, 0.001)
                if dx * dx + dy * dy <= 1.0:
                    if only_over is None or self.get(x, y) in only_over:
                        self.put(x, y, ch)

    def rect(self, x0, y0, w, h, ch, only_over=None):
        for y in range(int(round(y0)), int(round(y0 + h))):
            for x in range(int(round(x0)), int(round(x0 + w))):
                if only_over is None or self.get(x, y) in only_over:
                    self.put(x, y, ch)

    def thick_line(self, x0, y0, x1, y1, ch, w=2):
        """Line with a square brush of width w."""
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(steps + 1):
            t = i / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            half = (w - 1) / 2.0
            for oy in range(w):
                for ox in range(w):
                    self.put(x - half + ox, y - half + oy, ch)

    def arc(self, cx, cy, r, a0, a1, ch, w=2):
        """Arc from angle a0 to a1 (degrees, 0 = +x, CCW in screen coords
        means -y)."""
        steps = int(abs(a1 - a0) * 1.2) + 2
        prev = None
        for i in range(steps + 1):
            a = math.radians(a0 + (a1 - a0) * i / steps)
            x = cx + r * math.cos(a)
            y = cy - r * math.sin(a)
            if prev is not None:
                self.thick_line(prev[0], prev[1], x, y, ch, w)
            prev = (x, y)

    def triangle(self, p0, p1, p2, ch):
        xs = [p0[0], p1[0], p2[0]]
        ys = [p0[1], p1[1], p2[1]]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if _in_tri(x, y, p0, p1, p2):
                    self.put(x, y, ch)

    def outline(self, ch='K', over=('B', 'D', 'L', 'P', 'W')):
        """Add a 1px outline around every opaque cell."""
        add = []
        for y in range(self.size):
            for x in range(self.size):
                if self.g[y][x] != TRANSPARENT:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if self.get(x + dx, y + dy) in over:
                        add.append((x, y))
                        break
        for x, y in add:
            self.put(x, y, ch)

    def flip_h(self):
        for row in self.g:
            row.reverse()


def _sign(ax, ay, bx, by, cx, cy):
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)


def _in_tri(x, y, p0, p1, p2):
    d1 = _sign(x, y, p0[0], p0[1], p1[0], p1[1])
    d2 = _sign(x, y, p1[0], p1[1], p2[0], p2[1])
    d3 = _sign(x, y, p2[0], p2[1], p0[0], p0[1])
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


# --------------------------------------------------------------------------
# Palettes
# --------------------------------------------------------------------------
# 'points' draws extremities (ears/muzzle/legs/tail) in D, siamese-style.
# 'patches' paints fixed calico-style blotches over the body.

PALETTES = {
    'tabby-orange': dict(B='#e8913c', D='#c26a1e', L='#ffe0b5', K='#6b3d13',
                         E='#3f7a44', P='#f2939f', W='#ffffff',
                         stripes=True),
    'grey-tabby':   dict(B='#98a0ab', D='#6f7883', L='#d6dce3', K='#414952',
                         E='#5aa06a', P='#e79dab', W='#ffffff',
                         stripes=True),
    'black':        dict(B='#3c3c46', D='#292930', L='#57576a', K='#15151a',
                         E='#e2bd3f', P='#c97f8d', W='#ffffff'),
    'white':        dict(B='#f4f2ee', D='#dedad2', L='#ffffff', K='#9c958a',
                         E='#4d84bb', P='#f2a3b2', W='#ffffff'),
    'siamese':      dict(B='#e6d8c0', D='#5b4335', L='#f7efe0', K='#43301f',
                         E='#4fb0d6', P='#dba0aa', W='#ffffff',
                         points=True),
    'calico':       dict(B='#f7f1e6', D='#e07f31', L='#ffffff', K='#5b4a3c',
                         E='#6ea24f', P='#f397a5', W='#ffffff',
                         patches=True),
}

ORDER = ['K', 'D', 'B', 'L', 'P', 'E', 'W']


# --------------------------------------------------------------------------
# Anatomy
# --------------------------------------------------------------------------

def _fur(pal, extremity=False):
    """Base colour for a part; siamese points use D on extremities."""
    return 'D' if (extremity and pal.get('points')) else 'B'


def draw_head(c, pal, hx, hy, r=5.4, look_up=0.0, eye='open', ear_perk=0.0):
    """Head centred at (hx, hy), facing right."""
    ec = _fur(pal, extremity=True)

    # Ears: two triangles rooted on the skull, tips leaning back when not perked.
    lean = 1.4 * (1.0 - ear_perk)
    for base_x, tip_dx in ((hx - 3.4, -1.0), (hx + 2.2, 1.0)):
        tip = (base_x + tip_dx * 0.6 - lean * 0.6, hy - r - 3.4 + lean * 0.8)
        c.triangle((base_x - 1.4, hy - r + 1.2),
                   (base_x + 2.0, hy - r + 0.4), tip, ec)
        # inner ear
        c.triangle((base_x - 0.2, hy - r + 0.6),
                   (base_x + 1.2, hy - r + 0.2),
                   (tip[0] + tip_dx * 0.2, tip[1] + 1.6), 'P')

    c.ellipse(hx, hy, r, r * 0.92, _fur(pal))
    # muzzle / cheek
    c.ellipse(hx + r * 0.55, hy + r * 0.42, r * 0.52, r * 0.40,
              'D' if pal.get('points') else 'L')

    if pal.get('stripes'):
        for i in range(3):
            c.rect(hx - 2.5 + i * 2, hy - r * 0.95, 1, 2.4, 'D', only_over=('B',))

    # Eye. Sits forward on the skull; rides up a little when looking up.
    ey = hy - 0.6 - look_up * 1.4
    ex = hx + 1.7
    if eye == 'closed':
        c.rect(ex - 1.2, ey, 3, 1, 'K')
    else:
        h = 2 if eye == 'open' else 1
        c.rect(ex - 1, ey - h / 2.0, 2, h + 1, 'E')
        c.put(ex + 0.5, ey - h / 2.0, 'W')

    # Nose + mouth
    c.put(hx + r * 0.92, hy + r * 0.30, 'P')
    c.put(hx + r * 0.92, hy + r * 0.30 + 1, 'K')


def draw_tail(c, pal, x, y, angle, curl=1.0, length=9):
    """Tail as a quadratic bezier rooted at (x, y) and extending outward.

    angle in degrees: 180 = straight back, 90 = straight up. `curl` bends the
    tip perpendicular to that direction.
    """
    tc = _fur(pal, extremity=True)
    a = math.radians(angle)
    dx, dy = math.cos(a), -math.sin(a)
    tipx, tipy = x + dx * length, y + dy * length
    # control point pushed perpendicular to the tail's axis
    mx, my = x + dx * length * 0.5, y + dy * length * 0.5
    ctrlx, ctrly = mx + (-dy) * curl * 4.0, my + dx * curl * 4.0

    prev = None
    steps = 14
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        px = u * u * x + 2 * u * t * ctrlx + t * t * tipx
        py = u * u * y + 2 * u * t * ctrly + t * t * tipy
        if prev is not None:
            # taper: thick at the root, thinner at the tip
            w = 3 if t < 0.65 else 2
            c.thick_line(prev[0], prev[1], px, py, tc, w)
        prev = (px, py)

    if pal.get('stripes'):
        for t in (0.45, 0.72, 0.95):
            u = 1 - t
            px = u * u * x + 2 * u * t * ctrlx + t * t * tipx
            py = u * u * y + 2 * u * t * ctrly + t * t * tipy
            c.thick_line(px, py, px, py, 'D', w=2)


def draw_leg(c, pal, x, top, bottom, lift=0.0, forward=0.0):
    """One leg from `top` down to `bottom`, optionally lifted and swung."""
    lc = _fur(pal, extremity=True)
    bx = x + forward
    by = bottom - lift
    c.thick_line(x, top, bx, by, lc, w=3)
    # paw
    c.rect(bx - 1.5, by - 1, 4, 2, 'D' if pal.get('points') else 'L')


def apply_body_pattern(c, pal, cx, cy, rx, ry):
    if pal.get('stripes'):
        for i in range(4):
            sx = cx - rx * 0.6 + i * (rx * 0.42)
            c.ellipse(sx, cy - ry * 0.25, 1.0, ry * 0.75, 'D', only_over=('B',))
    if pal.get('patches'):
        c.ellipse(cx - rx * 0.45, cy - ry * 0.30, rx * 0.42, ry * 0.62, 'D',
                  only_over=('B',))
        c.ellipse(cx + rx * 0.40, cy + ry * 0.10, rx * 0.30, ry * 0.45, 'K',
                  only_over=('B', 'L'))


# --------------------------------------------------------------------------
# Body plans
# --------------------------------------------------------------------------

def draw_quadruped(c, pal, p):
    """Standing / walking / running: horizontal body on four legs."""
    crouch = p.get('crouch', 0.0)
    bob = p.get('bob', 0.0)

    cx, cy = 13.8 + p.get('body_dx', 0.0), 21.0 + crouch * 2.0 + bob
    rx, ry = 7.6, 5.0 - crouch * 0.6
    body_bottom = cy + ry * 0.8
    ph = p.get('phase', 0.0)
    swing = p.get('swing', 0.0)

    draw_tail(c, pal, cx - rx + 0.5, cy - 1.5,
              p.get('tail_angle', 118), p.get('tail_curl', 1.0),
              length=p.get('tail_len', 8))

    # Back legs first (far side), then front, so the near pair overlaps.
    for i, (lx, off) in enumerate(((7.0, 0.0), (9.5, 0.5),
                                   (18.0, 0.25), (20.5, 0.75))):
        a = (ph + off) * 2 * math.pi
        lift = max(0.0, math.sin(a)) * swing
        fwd = math.cos(a) * swing * 0.9
        draw_leg(c, pal, lx, body_bottom - 1, BASELINE, lift, fwd)

    c.ellipse(cx, cy, rx, ry, _fur(pal))
    c.ellipse(cx + 1, cy + ry * 0.55, rx * 0.7, ry * 0.45, 'L')
    apply_body_pattern(c, pal, cx, cy, rx, ry)

    draw_head(c, pal,
              cx + rx + 1.5 + p.get('head_dx', 0.0),
              cy - 4.0 + crouch * 1.5 + p.get('head_dy', 0.0),
              look_up=p.get('look_up', 0.0),
              eye=p.get('eye', 'open'),
              ear_perk=p.get('ear_perk', 0.4))


def draw_sitting(c, pal, p):
    """Haunches down, front legs straight, tail curled up behind."""
    cx, cy = 14.0, 24.0
    rx, ry = 7.0, 6.2

    # Haunch, then chest rising to the shoulders
    c.ellipse(cx - 2.5, cy + 1.0, 5.4, 5.0, _fur(pal))
    c.ellipse(cx + 2.0, cy - 1.0, rx * 0.8, ry, _fur(pal))
    c.ellipse(cx + 4.0, cy + 1.5, 3.4, 4.4, 'L')
    apply_body_pattern(c, pal, cx, cy, rx, ry)

    # Tail drawn AFTER the haunch, or the haunch buries it.
    draw_tail(c, pal, cx - rx + 1, BASELINE - 4,
              p.get('tail_angle', 138), p.get('tail_curl', 1.2),
              length=p.get('tail_len', 8))

    # Front legs straight down to the floor
    for lx in (17.5, 20.0):
        draw_leg(c, pal, lx, cy + 0.5, BASELINE, 0.0, 0.0)

    draw_head(c, pal, cx + 7.0 + p.get('head_dx', 0.0),
              cy - 8.0 + p.get('head_dy', 0.0),
              look_up=p.get('look_up', 0.0),
              eye=p.get('eye', 'open'),
              ear_perk=p.get('ear_perk', 0.8))


def draw_scratching(c, pal, p):
    """Reared onto the hind legs, both front paws clawing forward and up.

    The head sits high and to the LEFT of the strike zone so the forelegs read
    as limbs rather than merging into the muzzle.
    """
    reach = p.get('reach', 0.0)      # 0 = wound up, 1 = fully extended
    hx, hy = 10.5, 24.5

    draw_tail(c, pal, hx - 2.5, hy + 2.0, 118 + reach * 12, 1.1, length=7)

    # Hind legs planted on the ground
    for lx in (8.5, 11.5):
        draw_leg(c, pal, lx, hy + 2.0, BASELINE, 0.0, 0.0)

    # Rump -> waist -> chest, leaning forward. Three ellipses of shrinking
    # radius give an arched back instead of one rectangular slab.
    c.ellipse(hx, hy + 1.5, 5.6, 4.8, _fur(pal))
    c.ellipse(hx + 1.8, hy - 3.5, 4.4, 4.8, _fur(pal))
    c.ellipse(hx + 3.4, hy - 8.0, 3.8, 4.0, _fur(pal))
    c.ellipse(hx + 4.6, hy - 5.0, 2.4, 4.2, 'L')
    apply_body_pattern(c, pal, hx + 1.0, hy - 2.0, 5.2, 6.5)

    draw_head(c, pal, hx + 2.5 + p.get('head_dx', 0.0), hy - 13.0,
              look_up=0.25, eye=p.get('eye', 'open'), ear_perk=0.3)

    # Forelegs LAST so they sit above the torso. They reach out to the RIGHT
    # and BELOW the head, into the strike zone.
    pawc = 'D' if pal.get('points') else 'L'
    sx, sy = hx + 5.0, hy - 8.0
    for dy in (0.0, 3.5):
        px = sx + 5.0 + reach * 4.5
        py = sy + dy - reach * 1.5
        c.thick_line(sx, sy + dy, px, py, _fur(pal, extremity=True), w=3)
        c.rect(px - 1, py - 1.5, 3, 3, pawc)
        if reach > 0.4:
            for i in range(3):
                c.put(px + 2, py - 2.0 + i * 1.5, 'W')


def draw_sleeping(c, pal, p):
    """Curled into a loaf, tail wrapped round the front."""
    breathe = p.get('breathe', 0.0)
    cx, cy = 15.0, 25.0 - breathe
    rx, ry = 9.5, 5.4 + breathe

    draw_tail(c, pal, cx + rx - 2, cy + ry - 2, 340, 1.5, length=11)

    c.ellipse(cx, cy, rx, ry, _fur(pal))
    c.ellipse(cx, cy + ry * 0.5, rx * 0.85, ry * 0.5, 'L')
    apply_body_pattern(c, pal, cx, cy, rx, ry)

    # Head tucked down against the body
    draw_head(c, pal, cx + 6.0, cy - 1.5, r=4.6,
              eye='closed', ear_perk=0.0)

    # zzz
    for i, (zx, zy) in enumerate(((24, 9), (27, 5))):
        if breathe > 0 or i == 0:
            c.rect(zx, zy, 3, 1, 'W')
            c.rect(zx, zy + 2, 3, 1, 'W')
            c.put(zx + 2, zy + 1, 'W')
            c.put(zx + 1, zy + 1, 'W')


# --------------------------------------------------------------------------
# Poses: animation name -> list of frame parameter dicts
# --------------------------------------------------------------------------

POSES = {
    'idle': ('quad', [
        dict(phase=0.0, swing=0.0, tail_angle=108, tail_curl=1.0, ear_perk=0.5),
        dict(phase=0.0, swing=0.0, tail_angle=96, tail_curl=1.2, bob=1,
             ear_perk=0.5),
    ]),
    'walk': ('quad', [
        dict(phase=p / 4.0, swing=2.0, tail_angle=104 + (p % 2) * 10,
             tail_curl=1.0, bob=(p % 2) * 0.6, ear_perk=0.5)
        for p in range(4)
    ]),
    # Running: body shifted right so the streaming tail still fits the frame.
    'run': ('quad', [
        dict(phase=p / 4.0, swing=3.4, crouch=1.0, tail_angle=128,
             tail_curl=0.5, tail_len=6,
             bob=(1 if p % 2 else 0), ear_perk=0.15)
        for p in range(4)
    ]),
    'sit': ('sit', [
        dict(tail_angle=124, tail_curl=1.2, ear_perk=0.8),
        dict(tail_angle=116, tail_curl=1.4, ear_perk=0.8, head_dy=0.6),
    ]),
    'alert': ('sit', [
        dict(tail_angle=128, tail_curl=0.9, ear_perk=1.0, look_up=1.0,
             head_dy=-1.2, head_dx=0.6),
    ]),
    'scratch': ('scratch', [
        dict(reach=0.0), dict(reach=0.55), dict(reach=1.0), dict(reach=0.4),
    ]),
    'sleep': ('sleep', [
        dict(breathe=0.0), dict(breathe=1.0),
    ]),
}

PLANS = {
    'quad': draw_quadruped,
    'sit': draw_sitting,
    'scratch': draw_scratching,
    'sleep': draw_sleeping,
}


# --------------------------------------------------------------------------
# SVG emission
# --------------------------------------------------------------------------

def to_svg(c, pal):
    """Run-length merge each row into <rect> elements, grouped by colour."""
    runs = {}
    for y in range(c.size):
        x = 0
        while x < c.size:
            ch = c.g[y][x]
            if ch == TRANSPARENT:
                x += 1
                continue
            w = 1
            while x + w < c.size and c.g[y][x + w] == ch:
                w += 1
            runs.setdefault(ch, []).append((x, y, w))
            x += w

    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
        'width="%d" height="%d" shape-rendering="crispEdges">' %
        (c.size, c.size, c.size, c.size)
    ]
    for ch in ORDER:
        if ch not in runs:
            continue
        colour = pal.get(ch)
        if not colour:
            continue
        out.append('<g fill="%s">' % colour)
        for x, y, w in runs[ch]:
            out.append('<rect x="%d" y="%d" width="%d" height="1"/>' % (x, y, w))
        out.append('</g>')
    out.append('</svg>')
    return '\n'.join(out) + '\n'


def build_frame(pal, plan, params):
    c = Canvas()
    PLANS[plan](c, pal, params)
    c.outline(pal.get('K', 'K') and 'K')
    return c


def check_frame(c, label):
    """Art must not touch the left/right/top border. The bottom row is where
    the feet legitimately sit, so it is exempt."""
    bad = []
    if any(c.g[y][0] != TRANSPARENT for y in range(c.size)):
        bad.append('left')
    if any(c.g[y][c.size - 1] != TRANSPARENT for y in range(c.size)):
        bad.append('right')
    if any(c.g[0][x] != TRANSPARENT for x in range(c.size)):
        bad.append('top')
    if bad:
        raise SystemExit('%s: art clipped at %s edge(s)' % (label, '+'.join(bad)))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root = os.path.join(here, 'src', 'assets', 'cats')
    if os.path.isdir(root):
        shutil.rmtree(root)

    total = 0
    for name, pal in PALETTES.items():
        d = os.path.join(root, name)
        os.makedirs(d, exist_ok=True)
        for anim, (plan, frames) in POSES.items():
            for i, params in enumerate(frames):
                c = build_frame(pal, plan, params)
                check_frame(c, '%s/%s_%d' % (name, anim, i))
                path = os.path.join(d, '%s_%d.svg' % (anim, i))
                with open(path, 'w') as f:
                    f.write(to_svg(c, pal))
                total += 1
    print('wrote %d frames for %d palettes into %s'
          % (total, len(PALETTES), root))

    # A manifest the extension reads so it never has to guess frame counts.
    manifest = os.path.join(root, 'manifest.json')
    with open(manifest, 'w') as f:
        f.write('{\n')
        f.write('  "palettes": [%s],\n'
                % ', '.join('"%s"' % p for p in sorted(PALETTES)))
        f.write('  "animations": {\n')
        items = ['    "%s": %d' % (a, len(fr)) for a, (_, fr) in sorted(POSES.items())]
        f.write(',\n'.join(items))
        f.write('\n  }\n}\n')
    print('wrote', manifest)


if __name__ == '__main__':
    main()
