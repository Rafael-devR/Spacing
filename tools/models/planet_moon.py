# Lua da tela de título (docs/design/TITULO.md): corpo low poly facetado (icosfera deslocada) com mares escuros, terras altas
# claras, crateras com borda e pico central, duas crateras novas com raios claros; por cima, blocos: pedras soltas em volta das
# crateras e alguns montes em degraus, que dão o jeito do jogo (mundo de blocos). Cor por vértice; o jogo põe luz e atmosfera.
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
rnd = random.Random(7)
# crateras: muitas pequenas, algumas médias, duas bacias grandes
CR = lib.craters(7, 34, 0.05, 0.11) + lib.craters(17, 10, 0.12, 0.22) + lib.craters(29, 2, 0.26, 0.32)
# duas crateras novas, com raios claros (como Tycho e Copérnico)
RAYED = [(Vector((0.35, -0.8, -0.45)).normalized(), 0.07), (Vector((-0.55, -0.6, 0.55)).normalized(), 0.055)]
CR += RAYED


def mare(d):
    """mares: manchas grandes e escuras (0 = terra alta, 1 = mar)"""
    m = lib.fbm(d * 1.3 + Vector((3.1, 0.7, 2.2)), 3)
    return max(0.0, min(1.0, (m - 0.05) / 0.25))


def crater(d):
    """(altura, fundo 0..1, borda 0..1)"""
    dh, floor, rim = 0.0, 0.0, 0.0
    for c, r in CR:
        a = math.acos(max(-1.0, min(1.0, d.dot(c))))
        u = a / r
        if u > 1.8:
            continue
        depth = r * R * 0.3
        if u < 1:
            h = -depth * (1 - u * u) + depth * 0.25
            # pico central nas grandes
            if r > 0.11 and u < 0.22:
                h += depth * 0.55 * (1 - u / 0.22)
            dh += h
            floor = max(floor, 1 - u * 0.5)
        else:
            k = 1 - (u - 1) / 0.8
            dh += depth * 0.25 * k * k
            rim = max(rim, k)
    return dh, floor, rim


def rays(d):
    """raios claros que saem das crateras novas"""
    s = 0.0
    for c, r in RAYED:
        a = math.acos(max(-1.0, min(1.0, d.dot(c))))
        if a < r or a > r * 7:
            continue
        t, b = lib.tangent_basis(c)
        az = math.atan2(d.dot(b), d.dot(t))
        ray = max(0.0, lib.fbm(Vector((math.cos(az) * 3.5, math.sin(az) * 3.5, r * 40)), 2))
        s = max(s, min(1.0, ray * 2.2) * (1 - (a - r) / (r * 6)))
    return s


def height(d):
    dh, _, _ = crater(d)
    return R + lib.fbm(d * 2.6, 4) * 0.35 - mare(d) * 0.35 + dh


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def to_hex(c):
    return '#' + ''.join(f'{max(0, min(255, round(x * 255))):02x}' for x in c)


HIGH = lib.hex_rgb('#bfb9ae')
MARE = lib.hex_rgb('#4b4a50')
BRIGHT = lib.hex_rgb('#ece8df')


def color(d, r):
    _, floor, rim = crater(d)
    n = lib.fbm(d * 7.0, 3)
    c = mix(HIGH, MARE, mare(d))
    c = tuple(x * (1 + n * 0.18) for x in c)
    c = mix(c, tuple(x * 0.62 for x in c), floor * 0.8)
    c = mix(c, BRIGHT, rim * rim * 0.6)
    c = mix(c, BRIGHT, rays(d) * 0.75)
    return to_hex(c)


body = lib.lowpoly_planet('moon', R, 6, height, color)

blocks = []
ROCK = ['#a9a49c', '#9b968f', '#bfbab1', '#8d8983', '#c9c4bb']


def on_ground(d, s, sink=0.3):
    return d * (height(d) + s * (0.5 - sink))


# pedras em volta das crateras (mais nas grandes)
for c, r in CR:
    for _ in range(int(r * 55)):
        d = lib.scatter_dir(rnd, c, r * 1.7)
        s = rnd.uniform(0.08, 0.22) * (1.4 if r > 0.15 else 1)
        blocks.append((on_ground(d, s), s, d, rnd.uniform(0, math.pi), rnd.choice(ROCK)))
# anéis de blocos nas bordas das crateras maiores
for c, r in CR:
    if r > 0.1:
        blocks += lib.crater_ring(c, r * 1.08, height, 0.26, ['#d9d4ca', '#cbc6bc', '#e6e1d7', '#bdb8ae'], rnd)
# pedras soltas pelo resto
for _ in range(120):
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    s = rnd.uniform(0.07, 0.16)
    blocks.append((on_ground(d, s), s, d, rnd.uniform(0, math.pi), rnd.choice(ROCK)))
# montes em degraus nas terras altas
placed = 0
while placed < 9:
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    if mare(d) > 0.1 or crater(d)[1] > 0:
        continue
    placed += 1
    size = rnd.uniform(1.4, 2.4)
    steps = [size, size * 0.66, size * 0.36]
    blocks += lib.terraces(d, height(d) - 0.25, 0.32, steps, lambda k, i: ['#b1aca3', '#c2bdb4', '#d3cec5'][k] if i % 5 else '#a29d95')

rocks = lib.surface_blocks('moon_blocks', blocks)
print('blocos', len(blocks))
print('TRIANGULOS', lib.stats([body, rocks]))
lib.export(out, normals=False)
if prev:
    body.location.z = rocks.location.z = R + 1
    lib.preview(prev, target=(0, 0, R + 1), dist=R * 4.2, pitch=12)
