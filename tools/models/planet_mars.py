# Marte da tela de título (docs/design/TITULO.md): corpo low poly facetado com poeira vermelha, terras escuras, as planícies
# baixas do norte, o cânion largo perto do equador e as calotas polares; por cima, blocos: o vulcão enorme e três menores em
# degraus (o jeito do jogo, mundo de blocos), gelo em blocos na beira das calotas e pedras. Cor por vértice.
import math
import os
import random
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

R = 15
rnd = random.Random(11)
CR = lib.craters(11, 22, 0.05, 0.1) + lib.craters(23, 6, 0.12, 0.2)
OLYMPUS = Vector((0.62, -0.7, 0.32)).normalized()
THARSIS = [Vector((0.2, -0.95, 0.05 + k * 0.12)).normalized() for k in (-1, 0, 1)]


def ang(a, b):
    return math.acos(max(-1.0, min(1.0, a.dot(b))))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def canyon(d):
    """cânion: faixa torta perto do equador, de um lado do planeta (0..1)"""
    lon = math.atan2(d.y, d.x)
    if not (-1.0 < lon < 0.9):
        return 0.0
    fade = smooth(-1.0, -0.7, lon) * (1 - smooth(0.6, 0.9, lon))
    band = abs(d.z + 0.08 - 0.07 * math.sin(lon * 4))
    return max(0.0, 1 - band / 0.055) * fade


def north(d):
    """planícies baixas do norte (0..1)"""
    return smooth(0.15, 0.45, d.z + lib.fbm(d * 2.0, 2) * 0.15)


def cap(d):
    return abs(d.z) > 0.88 - 0.05 * lib.fbm(d * 5, 2)


def crater(d):
    dh, floor, rim = 0.0, 0.0, 0.0
    for c, r in CR:
        u = ang(d, c) / r
        if u > 1.8:
            continue
        depth = r * R * 0.24
        if u < 1:
            dh += -depth * (1 - u * u) + depth * 0.25
            floor = max(floor, 1 - u * 0.5)
        else:
            k = 1 - (u - 1) / 0.8
            dh += depth * 0.25 * k * k
            rim = max(rim, k)
    return dh, floor, rim


def height(d):
    dh, _, _ = crater(d)
    tharsis = smooth(0.55, 0.0, ang(d, THARSIS[1])) * 0.5
    olymp = smooth(0.3, 0.0, ang(d, OLYMPUS)) * 0.35
    return R + lib.fbm(d * 2.4, 4) * 0.32 - north(d) * 0.35 + dh * (1 - north(d) * 0.7) - canyon(d) * 1.6 + tharsis + olymp


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def to_hex(c):
    return '#' + ''.join(f'{max(0, min(255, round(x * 255))):02x}' for x in c)


DUST = lib.hex_rgb('#c6643a')
DARK = lib.hex_rgb('#6c3324')
LOW = lib.hex_rgb('#a9532f')
CANYON = lib.hex_rgb('#713521')
ICE = lib.hex_rgb('#f1ece4')
LIGHT = lib.hex_rgb('#e09468')


def color(d, r):
    if cap(d):
        return to_hex(mix(ICE, lib.hex_rgb('#d9cfc4'), max(0.0, lib.fbm(d * 9, 2))))
    _, floor, rim = crater(d)
    n = lib.fbm(d * 6.5, 3)
    c = mix(DUST, LOW, north(d))
    c = mix(c, DARK, smooth(0.1, 0.35, lib.fbm(d * 2.1 + Vector((1.3, 4.2, 0.4)), 3)))
    c = tuple(x * (1 + n * 0.16) for x in c)
    c = mix(c, tuple(x * 0.68 for x in c), floor * 0.75)
    c = mix(c, LIGHT, rim * rim * 0.55)
    c = mix(c, CANYON, canyon(d))
    return to_hex(c)


body = lib.lowpoly_planet('mars', R, 6, height, color)

blocks = []
ROCK = ['#8a3f27', '#9c4a2e', '#743421', '#b05a36']
LAVA = ['#a8573a', '#b2603f', '#9a5034', '#bd6a45']


def on_ground(d, s, sink=0.3):
    return d * (height(d) + s * (0.5 - sink))


# o vulcão enorme e os três de Tharsis, em degraus
blocks += lib.terraces(OLYMPUS, height(OLYMPUS) - 0.3, 0.45, [3.6, 3.0, 2.4, 1.9, 1.4, 1.0],
                       lambda k, i: '#4e231a' if k == 5 else LAVA[(i + k) % 4], hole=0.5)
for t in THARSIS:
    blocks += lib.terraces(t, height(t) - 0.25, 0.4, [1.6, 1.1, 0.7], lambda k, i: LAVA[(i * 3 + k) % 4], hole=0.3)
# gelo em blocos na beira das calotas (às vezes dois de altura)
for _ in range(260):
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    if not (0.8 < abs(d.z) < 0.93):
        continue
    s = rnd.uniform(0.2, 0.4)
    col = rnd.choice(['#f4f0ea', '#e4e9f0', '#ffffff', '#d8d2ca'])
    yaw = rnd.uniform(0, math.pi)
    blocks.append((on_ground(d, s), s, d, yaw, col))
    if rnd.random() < 0.3:
        blocks.append((on_ground(d, s) + d * s, s * 0.8, d, yaw, col))
# anéis de blocos nas bordas das crateras maiores
for c, r in CR:
    if r > 0.1:
        blocks += lib.crater_ring(c, r * 1.08, height, 0.26, ['#d88d5e', '#c97a4c', '#e29a6a', '#b86a40'], rnd)
# pedras: em volta das crateras, na beira do cânion e soltas
for c, r in CR:
    for _ in range(int(r * 45)):
        d = lib.scatter_dir(rnd, c, r * 1.7)
        s = rnd.uniform(0.08, 0.2)
        blocks.append((on_ground(d, s), s, d, rnd.uniform(0, math.pi), rnd.choice(ROCK)))
n = 0
while n < 140:
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    if 0.05 < canyon(d) < 0.5:
        n += 1
        s = rnd.uniform(0.14, 0.32)
        blocks.append((on_ground(d, s), s, d, rnd.uniform(0, math.pi), rnd.choice(ROCK)))
for _ in range(100):
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    if cap(d):
        continue
    s = rnd.uniform(0.07, 0.16)
    blocks.append((on_ground(d, s), s, d, rnd.uniform(0, math.pi), rnd.choice(ROCK)))

rocks = lib.surface_blocks('mars_blocks', blocks)
print('blocos', len(blocks))
print('TRIANGULOS', lib.stats([body, rocks]))
lib.export(out, normals=False)
if prev:
    body.location.z = rocks.location.z = R + 1
    lib.preview(prev, target=(0, 0, R + 1), dist=R * 4.2, pitch=12, yaw=-30)
