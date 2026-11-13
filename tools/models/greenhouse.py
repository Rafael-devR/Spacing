# Estufa (docs/design/ESTUFA.md): a cápsula de vidro 7×7 que o jogador constrói peça por peça. Um nó por peça e por qualidade
# (`<peça>_low` = entregue, crua; `<peça>_high` = finalizada). O código mostra um ou outro e faz o holograma a partir do `_low`
# (render/greenhouseModel.ts). Espaço local, coordenadas do jogo (lib.G): x e z de 0 a 7 (z = 7 é o sul, onde fica a porta),
# y = 0 é a base da célula do piso, o piso termina em y = 1, as paredes vão de 1 a 4 e a cúpula sobe de 4 a 7. As medidas
# batem com a colisão (src/world/greenhouseLayout.ts). Malhas: body_/glass_/lit_ + nome do nó (render/gltfModels.ts).
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

N = 7
WALL_TOP = 4.0
DOME = 3.0
RX = 3.42  # o arco fica um pouco para dentro da borda
DOOR = 3   # coluna da porta (x de 3 a 4) na parede sul

RAW = '#8f8576'
RAW_DARK = '#5c554b'
RAW_BOLT = '#3f3a33'
METAL = '#e2e6ee'
SEAM = '#b9bfca'
DARK = '#3d4252'
TRIM = '#3f9bb8'
LIGHT = '#7fe7ff'
GLASS = '#9fe4f2'
TARP = '#cdd3d0'
ORANGE = '#ff7a2f'

ARCH_Z = (0.2, 1.85, 3.5, 5.15, 6.8)
roots = []
made = []


class Part:
    def __init__(self, node):
        self.node = node
        self.body, self.glass, self.lit = [], [], []

    def box(self, x0, y0, z0, x1, y1, z1, color, kind='body', vary=0.06, bev=0.0, seed=1, jit=0.0):
        o = lib.gbox('p', x0, y0, z0, x1, y1, z1, color, vary=vary, bev=bev, seed=seed)
        if jit:
            lib.jitter(o, jit, seed=seed)
        getattr(self, kind).append(o)
        return o

    def rod(self, a, b, r, color, kind='body', verts=6):
        o = lib.grod('r', a, b, r, color, verts=verts)
        getattr(self, kind).append(o)
        return o

    def add(self, o, kind='body'):
        getattr(self, kind).append(o)
        return o

    def finish(self, ao=True):
        root = lib.gempty(self.node, 0, 0, 0)
        parts = []
        if self.body:
            b = lib.join(f'body_{self.node}', self.body)
            if ao:
                lib.bake_ao(b, strength=0.45, distance=0.6, samples=16)
            parts.append(b)
        if self.glass:
            parts.append(lib.join(f'glass_{self.node}', self.glass))
        if self.lit:
            parts.append(lib.join(f'lit_{self.node}', self.lit))
        bpy.context.view_layer.update()
        for o in parts:
            lib.parent(o, root)
            made.append(o)
        roots.append(root)
        print('PARTE', self.node, lib.stats(parts))
        return root


def mesh(name, verts, faces, color, vary=0.05, seed=1):
    """malha a partir de vértices do jogo (x, y, z)"""
    me = bpy.data.meshes.new(name)
    me.from_pydata([lib.G(*v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return lib.paint(o, color, vary=vary, seed=seed)


# ---------------------------------------------------------------- piso
p = Part('floor_low')
rnd = random.Random(3)
p.box(0, 0.9, 0, N, 0.95, N, RAW_BOLT, vary=0.02)
for i in range(N):  # tábuas/placas ao longo de x, cada uma com uma altura e um tom
    top = 1.0 - rnd.random() * 0.018
    z0 = i + 0.03 + rnd.random() * 0.02
    for j, (a, b) in enumerate(((0.02, 3.4), (3.45, N - 0.02))):
        p.box(a, 0.94, z0, b, top, i + 0.97, RAW, vary=0.12, seed=i * 7 + j, jit=0.006)
    for x in (0.25, 3.2, 3.7, 6.75):  # pregos
        p.box(x - 0.04, top, i + 0.46, x + 0.04, top + 0.004, i + 0.54, RAW_BOLT, vary=0.02)
p.finish()

p = Part('floor_high')
p.box(0, 0.9, 0, N, 0.993, N, METAL, vary=0.03, seed=4)
for k in range(1, N):  # juntas das placas do deque (frisos rente ao piso)
    if k not in (3, 4):
        p.box(k - 0.015, 0.993, 0.02, k + 0.015, 1.0, N - 0.02, '#9aa1ad', vary=0.02)
    p.box(0.02, 0.993, k - 0.015, N - 0.02, 1.0, k + 0.015, '#9aa1ad' if k not in (3, 4) else TRIM, vary=0.02)
for s_ in (DOOR, DOOR + 1):  # faixa azul do corredor da porta
    p.box(s_ - 0.03, 0.993, 0.02, s_ + 0.03, 1.0, N - 0.02, TRIM, vary=0.02)
p.box(0, 0.88, 0, N, 0.93, N, DARK, vary=0.02)
p.finish()


# ---------------------------------------------------------------- paredes
def strip(axis, c0, a0, a1, y0, y1, t0, t1):
    """caixa de uma parede: `axis` 'x' (corre em x, espessura em z a partir de c0) ou 'z'"""
    if axis == 'x':
        return (a0, y0, c0 + t0, a1, y1, c0 + t1)
    return (c0 + t0, y0, a0, c0 + t1, y1, a1)


def out_t(outer_low):
    """espessura do lado de fora (para rebites, luzes): outer_low = o lado de fora é o de coordenada menor"""
    return (-0.015, 0.03) if outer_low else (0.97, 1.015)


WALLS = {
    # nome: eixo, coordenada fixa, de, até, lado de fora é o menor?, porta
    'wallN': ('x', 0, 0, N, True, None),
    'wallS': ('x', N - 1, 0, N, False, DOOR),
    'wallW': ('z', 0, 1, N - 1, True, None),
    'wallE': ('z', N - 1, 1, N - 1, False, None),
}


def runs(a0, a1, door):
    return [(a0, a1)] if door is None else [(a0, door), (door + 1, a1)]


for name, (axis, c0, a0, a1, outer_low, door) in WALLS.items():
    seed = hash(name) % 97
    ot = out_t(outer_low)
    # ---- baixa qualidade: placas cruas em três fileiras, rebites, rodapé escuro
    p = Part(f'{name}_low')
    rnd = random.Random(seed)
    for (r0, r1) in runs(a0, a1, door):
        for k in range(r0, r1):
            for row in range(3):
                y0 = 1 + row + (0.02 if row else 0)
                th0 = 0.1 + rnd.random() * 0.05
                p.box(*strip(axis, c0, k + 0.015, k + 0.985, y0, y0 + 0.98, th0, 0.9 - rnd.random() * 0.04), RAW, vary=0.14,
                      seed=seed + k * 3 + row, jit=0.012)
                for (u, v) in ((0.15, 0.82), (0.85, 0.82)) if row != 1 else ():
                    o0, o1 = ot
                    bx = strip(axis, c0, k + u - 0.035, k + u + 0.035, y0 + v - 0.035, y0 + v + 0.035, o0 + 0.06, o1 - 0.06)
                    p.box(*bx, RAW_BOLT, vary=0.02)
        p.box(*strip(axis, c0, r0, r1, 1.0, 1.2, 0.05, 0.95), RAW_DARK, vary=0.06, seed=seed)
        # sarrafo de cima, torto
        p.box(*strip(axis, c0, r0, r1, 3.88, 4.0, 0.08, 0.92), RAW_DARK, vary=0.1, seed=seed + 1, jit=0.015)
    if door is not None:
        p.box(*strip(axis, c0, door + 0.02, door + 0.98, 3.02, 4.0, 0.1, 0.9), RAW, vary=0.12, seed=seed + 9, jit=0.01)
        p.box(*strip(axis, c0, door - 0.06, door + 1.06, 2.96, 3.06, 0.05, 0.95), RAW_DARK, vary=0.05)
    p.finish()

    # ---- alta qualidade: rodapé de metal com frisos e grades, faixa de luz, vidro com montantes e trilho de cima
    p = Part(f'{name}_high')
    for (r0, r1) in runs(a0, a1, door):
        p.box(*strip(axis, c0, r0, r1, 1.0, 1.92, 0.08, 0.92), METAL, vary=0.05, bev=0.02, seed=seed)
        p.box(*strip(axis, c0, r0, r1, 1.0, 1.08, 0.04, 0.96), DARK, vary=0.03)
        for k in range(r0 + 1, r1):  # juntas entre painéis
            p.box(*strip(axis, c0, k - 0.02, k + 0.02, 1.08, 1.9, 0.06, 0.94), SEAM, vary=0.02)
        # grade de ventilação no meio do trecho, por fora
        mid = (r0 + r1) / 2
        o0, o1 = ot
        p.box(*strip(axis, c0, mid - 0.32, mid + 0.32, 1.3, 1.62, min(o0, 0.06) if outer_low else 0.9, 0.1 if outer_low else max(o1, 0.94)),
              DARK, vary=0.02)
        for s in range(4):
            yy = 1.36 + s * 0.07
            p.box(*strip(axis, c0, mid - 0.29, mid + 0.29, yy, yy + 0.025, -0.03 if outer_low else 0.93, 0.07 if outer_low else 1.03),
                  SEAM, vary=0.02)
        # faixa de luz em cima do rodapé (dos dois lados)
        p.box(*strip(axis, c0, r0 + 0.04, r1 - 0.04, 1.92, 1.98, 0.06, 0.94), LIGHT, kind='lit', vary=0.0)
        p.box(*strip(axis, c0, r0, r1, 1.98, 2.06, 0.1, 0.9), METAL, vary=0.03)
        # vidro e montantes
        n = max(1, round((r1 - r0) / 1.5))
        step = (r1 - r0) / n
        for i in range(n):
            g0, g1 = r0 + i * step, r0 + (i + 1) * step
            p.box(*strip(axis, c0, g0 + 0.05, g1 - 0.05, 2.06, 3.86, 0.42, 0.58), GLASS, kind='glass', vary=0.0)
        for i in range(n + 1):
            m = r0 + i * step
            p.box(*strip(axis, c0, max(r0, m - 0.05), min(r1, m + 0.05), 2.06, 3.86, 0.34, 0.66), METAL, vary=0.03)
        p.box(*strip(axis, c0, r0, r1, 3.86, 4.0, 0.14, 0.86), METAL, vary=0.04, bev=0.02)
    if axis == 'x':  # pilares dos cantos (paredes norte e sul)
        for cx in (0, N - 1):
            p.box(cx + 0.06, 1.0, c0 + 0.06, cx + 0.94, 4.0, c0 + 0.94, SEAM, vary=0.05, bev=0.04, seed=cx)
            p.box(cx + 0.02, 3.9, c0 + 0.02, cx + 0.98, 4.02, c0 + 0.98, DARK, vary=0.03)
    if door is not None:
        # batentes, verga e luz da porta (por fora: z = 7)
        p.box(door - 0.0, 1.0, c0 + 0.04, door + 0.1, 3.0, c0 + 0.96, DARK, vary=0.03)
        p.box(door + 0.9, 1.0, c0 + 0.04, door + 1.0, 3.0, c0 + 0.96, DARK, vary=0.03)
        p.box(door, 2.9, c0 + 0.04, door + 1.0, 3.06, c0 + 0.96, DARK, vary=0.03)
        p.box(door + 0.02, 3.06, c0 + 0.12, door + 0.98, 3.86, c0 + 0.88, METAL, vary=0.04, bev=0.02)
        p.box(door, 3.86, c0 + 0.14, door + 1.0, 4.0, c0 + 0.86, METAL, vary=0.04)
        p.box(door + 0.3, 3.14, c0 + 0.96, door + 0.7, 3.24, c0 + 1.02, ORANGE, kind='lit', vary=0.0)
        p.box(door + 0.05, 1.0, c0 + 0.96, door + 0.95, 1.03, c0 + 1.0, TRIM, kind='lit', vary=0.0)
        # teclado ao lado da porta
        p.box(door + 1.12, 1.5, c0 + 0.9, door + 1.4, 1.86, c0 + 1.0, DARK, vary=0.02)
        p.box(door + 1.16, 1.68, c0 + 0.99, door + 1.36, 1.82, c0 + 1.02, LIGHT, kind='lit', vary=0.0)
        for (u, v) in ((0.0, 0.0), (0.08, 0.0), (0.0, -0.08), (0.08, -0.08)):
            p.box(door + 1.18 + u, 1.58 + v, c0 + 0.99, door + 1.24 + u, 1.63 + v, c0 + 1.015, SEAM, vary=0.02)
    p.finish()


# ---------------------------------------------------------------- estrutura da cúpula
def arch_pts(z, rx=RX, ry=DOME, n=8):
    return [(N / 2 + math.cos(a) * rx, WALL_TOP + math.sin(a) * ry, z) for a in (math.pi - i * math.pi / n for i in range(n + 1))]


p = Part('frame_low')
for i, z in enumerate(ARCH_Z):
    pts = arch_pts(z, ry=DOME - 0.08)
    for a, b in zip(pts, pts[1:]):
        p.rod(a, b, 0.1, RAW_DARK, verts=4)
    for x in (0.25, N - 0.25):  # grampos na base
        p.box(x - 0.16, 3.9, z - 0.14, x + 0.16, 4.18, z + 0.14, RAW_BOLT, vary=0.05, seed=i)
p.rod((N / 2, WALL_TOP + DOME - 0.12, 0.05), (N / 2, WALL_TOP + DOME - 0.12, N - 0.05), 0.11, RAW_DARK, verts=4)
for i, z in enumerate(ARCH_Z):  # amarras onde o arco cruza a cumeeira
    p.box(N / 2 - 0.15, WALL_TOP + DOME - 0.3, z - 0.15, N / 2 + 0.15, WALL_TOP + DOME + 0.02, z + 0.15, RAW_BOLT, vary=0.05, seed=i)
p.finish()

p = Part('frame_high')
for i, z in enumerate(ARCH_Z):
    pts = arch_pts(z)
    for a, b in zip(pts, pts[1:]):
        p.rod(a, b, 0.065, METAL, verts=5)
    for x in (0.18, N - 0.18):  # placas de junção na base
        p.box(x - 0.14, 3.98, z - 0.12, x + 0.14, 4.12, z + 0.12, SEAM, vary=0.03)
    p.box(N / 2 - 0.1, WALL_TOP + DOME - 0.14, z - 0.1, N / 2 + 0.1, WALL_TOP + DOME + 0.06, z + 0.1, SEAM, vary=0.03)
p.rod((N / 2, WALL_TOP + DOME - 0.04, 0.1), (N / 2, WALL_TOP + DOME - 0.04, N - 0.1), 0.07, METAL, verts=5)
for a, b in zip(ARCH_Z, ARCH_Z[1:]):  # luzes embaixo da cumeeira, entre os arcos
    m = (a + b) / 2
    p.box(N / 2 - 0.05, WALL_TOP + DOME - 0.17, m - 0.2, N / 2 + 0.05, WALL_TOP + DOME - 0.11, m + 0.2, LIGHT, kind='lit', vary=0.0)
    p.box(N / 2 - 0.08, WALL_TOP + DOME - 0.12, m - 0.24, N / 2 + 0.08, WALL_TOP + DOME - 0.06, m + 0.24, DARK, vary=0.02)
p.finish()


# ---------------------------------------------------------------- vidro (pele da cúpula)
def vault(name, color, sag=0.0, jit=0.0, segs=14, seed=1, rx=RX - 0.06, ry=DOME - 0.12, zs=None):
    """meio cilindro deitado ao longo de z; `sag` afunda a pele entre os arcos (lona)"""
    zs = zs or [0.05] + [z for a, b in zip(ARCH_Z, ARCH_Z[1:]) for z in (a, (a + b) / 2)] + [ARCH_Z[-1], N - 0.05]
    rnd = random.Random(seed)
    verts, faces = [], []
    for zi, z in enumerate(zs):
        # quanto afunda: zero nos arcos, máximo no meio do vão
        near = min(abs(z - a) for a in ARCH_Z)
        k = 1 - sag * min(1.0, near / 0.82)
        for i in range(segs + 1):
            a = math.pi - i * math.pi / segs
            j = (rnd.uniform(-1, 1) * jit) if 0 < i < segs else 0
            verts.append((N / 2 + math.cos(a) * rx * (k if 0 < i < segs else 1), WALL_TOP + math.sin(a) * ry * k + j, z))
    w = segs + 1
    for zi in range(len(zs) - 1):
        for i in range(segs):
            a, b = zi * w + i, zi * w + i + 1
            faces.append((a, b, b + w, a + w))
    o = mesh(name, verts, faces, color, vary=0.06, seed=seed)
    # tampas (meia elipse) nas duas pontas
    caps = []
    for z, flip in ((0.05, False), (N - 0.05, True)):
        cv = [(N / 2, WALL_TOP, z)] + [(N / 2 + math.cos(math.pi - i * math.pi / segs) * rx,
                                         WALL_TOP + math.sin(math.pi - i * math.pi / segs) * ry, z) for i in range(segs + 1)]
        cf = [(0, i + 2, i + 1) if flip else (0, i + 1, i + 2) for i in range(segs)]
        caps.append(mesh(name + '_cap', cv, cf, color, vary=0.06, seed=seed + 3))
    return [o] + caps


p = Part('glass_low')
for o in vault('t', TARP, sag=0.06, jit=0.04, seed=5):
    p.add(o)
p.finish()

p = Part('glass_high')
for o in vault('g', GLASS, seed=7):
    p.add(o, 'glass')
p.finish(ao=False)

print('TRIANGULOS', lib.stats(made))
if prev:
    # prévia: baixa qualidade à esquerda, alta à direita (só para olhar; volta para a origem antes de exportar)
    for r in roots:
        if r.name.endswith('_low'):
            r.location = lib.G(-8.5, 0, 0)
    bpy.context.view_layer.update()
    lib.preview(prev, target=lib.G(-0.5, 2.2, 3.5), dist=24, yaw=-25, pitch=30, size=1000)
    base, ext = os.path.splitext(prev)
    lib.preview(base + '_perto' + ext, target=lib.G(3.5, 2.2, 5.5), dist=11, yaw=-20, pitch=18, size=900)
    for r in roots:
        r.location = (0, 0, 0)
    bpy.context.view_layer.update()
lib.export(out)
