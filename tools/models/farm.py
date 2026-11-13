# Cultivo (docs/design/ESTUFA.md): o canteiro, o solo (seco e molhado) e a batata em cada estágio. Um nó por peça, todos na
# origem; o código põe o canteiro numa célula da estufa e mostra o solo e o estágio da planta por cima (render/greenhouseModel.ts).
# Espaço local, coordenadas do jogo (lib.G): a célula vai de -0.5 a 0.5 em x e z, y = 0 é o topo do piso da estufa.
# A terra fica em y ≈ 0.40 e as plantas nascem dali. A luz de estado do canteiro é a malha `fx_led` (o código pinta).
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

FRAME = '#c3c7d2'
SIDE = '#8a7f74'
DARK = '#3d4252'
SOIL_DRY = '#8a6446'
SOIL_WET = '#4f3424'
GREEN = '#5aa04a'
GREEN_L = '#6fbf5a'
STEM = '#4d8a3c'
YELLOW = '#b9b04a'
DRY = '#a89a4a'
DRY_D = '#7d6a3a'
TUBER = '#c79a5b'
PETAL = '#f2eefa'
POLLEN = '#f2c230'
SOIL_Y = 0.40

roots = []
made = []


def mesh(name, verts, faces, color, vary=0.06, seed=1, fn=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([lib.G(*v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return lib.paint(o, color, vary=vary, seed=seed, fn=fn)


def node(name, body, ao=False, extra=()):
    root = lib.gempty(name, 0, 0, 0)
    b = lib.join(f'body_{name}', body)
    if ao:
        lib.bake_ao(b, strength=0.5, distance=0.3, samples=16)
    bpy.context.view_layer.update()
    for o in [b, *extra]:
        lib.parent(o, root)
        made.append(o)
    roots.append(root)
    print('PARTE', name, lib.stats([b, *extra]))
    return root


def leaf(c, yaw, pitch, length, width, color, seed=1, thick=0.012):
    """folha: octaedro achatado e comprido (vê-se dos dois lados) saindo de `c` na direção (yaw, pitch)"""
    c = Vector(c)
    d = Vector((math.cos(pitch) * math.sin(yaw), math.sin(pitch), math.cos(pitch) * math.cos(yaw)))
    side = Vector((math.cos(yaw), 0, -math.sin(yaw)))
    up = d.cross(side).normalized()
    mid = c + d * length * 0.45
    v = [c, c + d * length, mid + side * width / 2, mid + up * thick, mid - side * width / 2, mid - up * thick]
    f = [(0, 2, 3), (0, 3, 4), (0, 4, 5), (0, 5, 2), (1, 3, 2), (1, 4, 3), (1, 5, 4), (1, 2, 5)]
    return mesh('leaf', [tuple(x) for x in v], f, color, vary=0.12, seed=seed)


def blob(name, r, sx, sy, sz, x, y, z, color, seed=1, sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=lib.G(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)  # Blender: (x, y = -z do jogo, z = y do jogo)
    lib.apply_all(o)
    lib.jitter(o, r * 0.12, seed=seed)
    return lib.paint(o, color, vary=0.1, seed=seed)


# ---------------------------------------------------------------- canteiro
H = 0.45
parts = []
parts.append(lib.gbox('base', -0.45, 0, -0.45, 0.45, 0.04, 0.45, DARK, vary=0.02))
for (x0, x1, z0, z1) in ((-0.45, 0.45, -0.45, -0.39), (-0.45, 0.45, 0.39, 0.45), (-0.45, -0.39, -0.39, 0.39), (0.39, 0.45, -0.39, 0.39)):
    parts.append(lib.gbox('side', x0, 0.04, z0, x1, H - 0.04, z1, SIDE, vary=0.1, seed=int((x0 + z0) * 10) + 20))
for sx in (-1, 1):
    for sz in (-1, 1):
        parts.append(lib.gbox('post', sx * 0.47 - 0.05, 0, sz * 0.47 - 0.05, sx * 0.47 + 0.05, H + 0.02, sz * 0.47 + 0.05, FRAME, vary=0.04, bev=0.015))
for (x0, x1, z0, z1) in ((-0.45, 0.45, -0.47, -0.39), (-0.45, 0.45, 0.39, 0.47), (-0.47, -0.39, -0.39, 0.39), (0.39, 0.47, -0.39, 0.39)):
    parts.append(lib.gbox('rim', x0, H - 0.04, z0, x1, H, z1, FRAME, vary=0.04))
# faixa no meio da lateral e o fundo da cavidade
for (x0, x1, z0, z1) in ((-0.42, 0.42, -0.465, -0.44), (-0.42, 0.42, 0.44, 0.465)):
    parts.append(lib.gbox('band', x0, 0.2, z0, x1, 0.24, z1, FRAME, vary=0.03))
parts.append(lib.gbox('floor', -0.39, 0.04, -0.39, 0.39, 0.3, 0.39, '#3a2a1e', vary=0.05))
# dreno do lado oeste
parts.append(lib.grod('spout', (-0.45, 0.1, 0.15), (-0.53, 0.07, 0.15), 0.03, DARK, verts=6))
# placa da luz de estado (a luz é o fx_led)
parts.append(lib.gbox('ledplate', 0.2, 0.26, 0.45, 0.38, 0.36, 0.47, DARK, vary=0.02))
led = lib.gbox('fx_led', 0.26, 0.28, 0.465, 0.32, 0.34, 0.485, '#7fe08a', vary=0.0)
node('planter', parts, ao=True, extra=(led,))


# ---------------------------------------------------------------- solo
def soil(name, color, spots=False, seed=3):
    rnd = random.Random(seed)
    n, a = 5, 0.385
    verts, faces = [], []
    for j in range(n + 1):
        for i in range(n + 1):
            x, z = -a + 2 * a * i / n, -a + 2 * a * j / n
            edge = i in (0, n) or j in (0, n)
            y = SOIL_Y - 0.01 if edge else SOIL_Y - 0.012 + rnd.random() * 0.026
            verts.append((x, y, z))
    w = n + 1
    for j in range(n):
        for i in range(n):
            faces.append((j * w + i, j * w + i + 1, (j + 1) * w + i + 1, (j + 1) * w + i))
    top = mesh(name, verts, faces, color, vary=0.22, seed=seed)
    body = [top, lib.gbox('fill', -a, 0.3, -a, a, SOIL_Y - 0.012, a, color, vary=0.05)]
    for k in range(4):  # torrões
        x, z = rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3)
        body.append(blob('clod', 0.03, 1.2, 0.6, 1.0, x, SOIL_Y + 0.01, z, color, seed=seed + k, sub=1))
    if spots:
        for k in range(4):
            x, z = rnd.uniform(-0.28, 0.28), rnd.uniform(-0.28, 0.28)
            body.append(lib.gbox('wet', x - 0.06, SOIL_Y + 0.004, z - 0.04, x + 0.06, SOIL_Y + 0.012, z + 0.04, '#2a1b12', vary=0.05))
    return body


node('soil_dry', soil('soil', SOIL_DRY, seed=3))
node('soil_wet', soil('soil', SOIL_WET, spots=True, seed=4))


# ---------------------------------------------------------------- batata
def leaflets(p, yaw, pitch, length, color, seed, droop=False):
    """folha composta da batata: um folíolo na ponta e um par de folíolos menores, num pecíolo curto"""
    rnd = random.Random(seed)
    d = Vector((math.cos(pitch) * math.sin(yaw), math.sin(pitch), math.cos(pitch) * math.cos(yaw)))
    out = [leaf(tuple(p), yaw, pitch, length, length * 0.62, color, seed=seed)]
    q = Vector(p) + d * length * 0.35
    for sd in (-1, 1):
        out.append(leaf(tuple(q), yaw + sd * rnd.uniform(1.0, 1.4), pitch - (0.25 if droop else 0.05), length * 0.55, length * 0.38,
                        color, seed=seed + sd + 5))
    return out


def plant(stems, height, spread, leaves, leaf_len, seed, colors=(GREEN, GREEN_L), droop=0.0, flowers=0, yellow_low=False):
    """moita de batata: hastes que se abrem do centro, folhas compostas ao longo delas. `droop` dobra as hastes (murcha)."""
    rnd = random.Random(seed)
    out = []
    tops = []
    for s in range(stems):
        yaw = s * 2 * math.pi / stems + rnd.uniform(-0.3, 0.3)
        h = height * rnd.uniform(0.7, 1.0)
        r = spread * rnd.uniform(0.6, 1.0)
        base = Vector((rnd.uniform(-0.03, 0.03), SOIL_Y, rnd.uniform(-0.03, 0.03)))
        mid = base + Vector((math.sin(yaw) * r * 0.35, h * 0.65, math.cos(yaw) * r * 0.35))
        tip = base + Vector((math.sin(yaw) * r, h, math.cos(yaw) * r))
        if droop:
            mid = base + Vector((math.sin(yaw) * r * 0.3, h * 0.7, math.cos(yaw) * r * 0.3))
            tip = mid + Vector((math.sin(yaw) * r * 0.7, -h * droop * 0.55, math.cos(yaw) * r * 0.7))
        sr = 0.006 + height * 0.012
        col_s = DRY_D if droop else STEM
        out.append(lib.grod('stem', tuple(base), tuple(mid), sr, col_s, verts=4))
        out.append(lib.grod('stem', tuple(mid), tuple(tip), sr * 0.75, col_s, verts=4))
        tops.append(tip)
        for k in range(leaves):
            t = (k + 1) / (leaves + 1)
            p = mid.lerp(tip, t)
            side = 1 if (k + s) % 2 else -1
            ly = yaw + side * rnd.uniform(0.8, 1.3)
            pitch = (-0.7 - rnd.uniform(0, 0.4)) if droop else rnd.uniform(-0.35, 0.05)
            col = colors[(k + s) % len(colors)]
            if yellow_low and k == 0:
                col = YELLOW
            if droop:
                col = DRY if (k + s) % 2 else DRY_D
            out += leaflets(tuple(p), ly, pitch, leaf_len * rnd.uniform(0.85, 1.15), col, seed=seed * 31 + s * 7 + k, droop=bool(droop))
        out += leaflets(tuple(tip), yaw, (-0.9 if droop else rnd.uniform(-0.1, 0.25)), leaf_len * 0.9,
                        (DRY if droop else colors[0]), seed=seed + s * 3, droop=bool(droop))
    for k in range(flowers):
        t = tops[(k * 2) % len(tops)]
        c = t + Vector((0, 0.06, 0))
        out.append(lib.grod('pedicel', tuple(t), tuple(c), 0.006, STEM, verts=3))
        out.append(lib.gcyl('petal', 5, 0.05, 0.045, 0.012, c.x, c.y, c.z, PETAL, vary=0.05))
        out.append(lib.gbox('pollen', c.x - 0.013, c.y + 0.012, c.z - 0.013, c.x + 0.013, c.y + 0.032, c.z + 0.013, POLLEN, vary=0.0))
    return out


mound = [blob('mound', 0.12, 1.0, 0.4, 1.0, 0, SOIL_Y, 0, '#6b4a32', seed=8, sub=1)]
node('potato_0', mound + [blob('seed', 0.045, 1.2, 0.8, 1.0, 0.03, SOIL_Y + 0.05, -0.02, TUBER, seed=9, sub=1)])
node('potato_1', [blob('mound', 0.1, 1.0, 0.3, 1.0, 0, SOIL_Y, 0, '#6b4a32', seed=10, sub=1)] + plant(3, 0.13, 0.07, 0, 0.06, seed=11))
node('potato_2', plant(5, 0.26, 0.18, 1, 0.14, seed=12))
node('potato_3', plant(6, 0.42, 0.3, 2, 0.2, seed=13))
tubers = [blob('tuber', 0.07, 1.3, 0.8, 1.0, x, SOIL_Y + 0.01, z, TUBER, seed=20 + i, sub=1)
          for i, (x, z) in enumerate(((0.24, 0.16), (-0.2, 0.22), (0.05, -0.27)))]
node('potato_4', plant(6, 0.46, 0.31, 2, 0.2, seed=13, flowers=4, yellow_low=True) + tubers)
node('potato_dry', plant(5, 0.28, 0.28, 1, 0.16, seed=14, droop=0.6))

print('TRIANGULOS', lib.stats(made))
if prev:
    # fila de cima: cada nó sozinho; fila da frente: o canteiro montado (solo molhado + planta) em cada estágio
    names = [r.name for r in roots]
    for i, r in enumerate(roots):
        r.location = lib.G(i * 1.1 - 4.4, 0, -1.4)
    bpy.context.view_layer.update()
    copies = []
    for i, st in enumerate(['potato_0', 'potato_1', 'potato_2', 'potato_3', 'potato_4', 'potato_dry']):
        for nm in ('planter', 'soil_dry' if st == 'potato_dry' else 'soil_wet', st):
            src = next(r for r in roots if r.name == nm)
            for ch in src.children:
                c = ch.copy()
                c.data = ch.data
                bpy.context.scene.collection.objects.link(c)
                c.parent = None
                c.matrix_world = ch.matrix_world.copy()
                c.location = c.location + __import__('mathutils').Vector(lib.G(i * 1.3 - 3.2 - (names.index(nm) * 1.1 - 4.4), 0, 1.4))
                copies.append(c)
    bpy.context.view_layer.update()
    lib.preview(prev, target=lib.G(0.3, 0.3, 0.4), dist=9.5, yaw=0, pitch=32, size=1300)
    for c in copies:
        bpy.data.objects.remove(c)
    for r in roots:
        r.location = (0, 0, 0)
    bpy.context.view_layer.update()
lib.export(out)
