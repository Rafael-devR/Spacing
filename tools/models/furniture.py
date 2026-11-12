# Móveis da base (docs/design/MODELOS.md): um arquivo com um nó por tipo (data/base.ts FurnitureKind). O código clona o
# nó do tipo e põe onde os dados mandam (render/baseModel.ts). Cada tipo, no seu próprio espaço: chão em y = 0, centro do
# espaço que ocupa em x = z = 0, costas na parede (z = -d/2) e frente para +z (o sul do jogo). Largura w ao longo da parede.
# Peças acesas de um móvel: nó "lit_<tipo>"; o resto é "body_<tipo>". Coordenadas do jogo (lib.G).
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

HULL = '#dfe3ea'
SEAM = '#c3c7d2'
METAL = '#8c90a0'
DARK = '#3d4252'
ORANGE = '#ff7a2f'
ICE = '#9fe8ff'
BLUE = '#4c6fd6'

# tamanho (w, d) de cada tipo: tem de bater com data/base.ts
SIZES = {
    'bed': (2, 1), 'locker': (1, 1), 'console': (1, 1), 'shelf': (1, 1),
    'plants': (2, 1), 'table': (2, 1), 'tank': (1, 1), 'crates': (1, 1),
}
made = []


class Piece:
    """monta um móvel deslocado em x (para os tipos não se sobreporem na prévia)"""

    def __init__(self, kind, ox):
        self.kind, self.ox = kind, ox
        self.body, self.lit, self.marks = [], [], []

    def mark(self, name, x, y, z):
        self.marks.append((name, x, y, z))

    def box(self, x0, y0, z0, x1, y1, z1, color, vary=0.06, bev=0.0, seed=1, lit=False, fn=None):
        o = lib.gbox('p', x0 + self.ox, y0, z0, x1 + self.ox, y1, z1, color, vary=vary, bev=bev, seed=seed, fn=fn)
        (self.lit if lit else self.body).append(o)
        return o

    def cyl(self, verts, r1, r2, h, x, y, z, color, vary=0.06, lit=False, seed=1):
        o = lib.gcyl('c', verts, r1, r2, h, x + self.ox, y, z, color, vary=vary, seed=seed)
        (self.lit if lit else self.body).append(o)
        return o

    def rod(self, a, b, r, color, verts=6, lit=False):
        o = lib.grod('r', (a[0] + self.ox, a[1], a[2]), (b[0] + self.ox, b[1], b[2]), r, color, verts=verts)
        (self.lit if lit else self.body).append(o)
        return o

    def finish(self, ao=True):
        root = lib.gempty(self.kind, self.ox, 0, 0)
        body = lib.join(f'body_{self.kind}', self.body)
        if ao:
            lib.bake_ao(body, strength=0.5, distance=0.5, samples=24)
        parts = [body]
        if self.lit:
            parts.append(lib.join(f'lit_{self.kind}', self.lit))
        for o in parts:
            lib.set_origin(o, self.ox, 0, 0)  # a malha fica em volta do nó do tipo
            lib.parent(o, root)
            made.append(o)
        for (name, x, y, z) in self.marks:
            lib.parent(lib.gempty(name, x + self.ox, y, z), root)
        return root


# ---- beliche (2×1): duas camas, escada, luz de leitura ----
p = Piece('bed', 0)
for sx in (-0.95, 0.95):
    for sz in (-0.42, 0.42):
        p.box(sx - 0.04, 0, sz - 0.04, sx + 0.04, 1.85, sz + 0.04, DARK, vary=0.03)
for y in (0.32, 1.32):
    p.box(-0.95, y, -0.46, 0.95, y + 0.1, 0.46, METAL, vary=0.04)
    p.box(-0.9, y + 0.1, -0.42, 0.9, y + 0.28, 0.42, BLUE, vary=0.05, bev=0.03, seed=int(y * 10))
    p.box(-0.86, y + 0.28, -0.36, -0.46, y + 0.38, 0.36, '#f4f1ea', vary=0.04, bev=0.03)  # travesseiro
    p.box(0.05, y + 0.28, -0.42, 0.9, y + 0.33, 0.42, ORANGE, vary=0.06, seed=3)  # coberta dobrada
p.box(-0.95, 0.9, 0.42, 0.95, 0.98, 0.46, DARK, vary=0.03)  # grade da de cima
for i in range(4):
    y = 0.4 + i * 0.36
    p.rod((0.95, y, 0.47), (0.95, y, 0.36), 0.02, SEAM)
p.box(-0.8, 1.66, -0.46, -0.55, 1.74, -0.36, DARK)
p.box(-0.78, 1.62, -0.42, -0.57, 1.66, -0.32, '#ffe2a8', lit=True)
p.finish()

# ---- armário (1×1): duas portas, respiros, faixa acesa ----
p = Piece('locker', 3)
p.box(-0.42, 0, -0.45, 0.42, 1.92, 0.25, SEAM, bev=0.03)
p.box(-0.42, 0, 0.2, 0.42, 0.1, 0.27, ORANGE, vary=0.03)
for sx in (-1, 1):
    p.box(sx * 0.02 if sx > 0 else -0.4, 0.14, 0.25, 0.4 if sx > 0 else -0.02, 1.85, 0.28, HULL, vary=0.04, seed=sx + 5)
    p.box(sx * 0.07 - 0.015, 0.9, 0.28, sx * 0.07 + 0.015, 1.15, 0.31, DARK)
    for i in range(4):
        y = 1.5 + i * 0.07
        p.box(sx * 0.21 - 0.12, y, 0.28, sx * 0.21 + 0.12, y + 0.03, 0.29, DARK, vary=0.02)
p.box(-0.3, 1.88, 0.26, 0.3, 1.9, 0.29, ICE, lit=True)
p.finish()

# ---- console (1×1): mesa, tela inclinada (a imagem é posta pelo código no ponto "screen"), teclado ----
p = Piece('console', 6)
p.box(-0.43, 0, -0.45, 0.43, 0.78, 0.15, SEAM, bev=0.02)
p.box(-0.45, 0.78, -0.45, 0.45, 0.84, 0.3, DARK, vary=0.03)
p.box(-0.35, 0.84, 0.0, 0.35, 0.87, 0.22, '#2a2f3d', vary=0.03)
for i in range(6):
    for k in range(2):
        p.box(-0.3 + i * 0.1, 0.87, 0.04 + k * 0.08, -0.23 + i * 0.1, 0.89, 0.1 + k * 0.08, '#6a7082', vary=0.1, seed=i + k * 7)
p.box(-0.06, 0.84, -0.4, 0.06, 1.0, -0.3, DARK)
p.box(-0.42, 0.98, -0.42, 0.42, 1.52, -0.36, DARK, vary=0.03)
for i, c in enumerate(('#7dff9a', '#ffb347', '#5fd0ff')):
    p.box(0.3 - i * 0.08, 0.8, 0.3, 0.34 - i * 0.08, 0.83, 0.31, c, lit=True)
p.mark('console_screen', 0, 1.25, -0.355)
p.finish()

# ---- prateleira (1×1): estante de metal com caixas e latas ----
p = Piece('shelf', 9)
for sx in (-0.42, 0.42):
    for sz in (-0.42, 0.18):
        p.box(sx - 0.03, 0, sz - 0.03, sx + 0.03, 1.9, sz + 0.03, DARK, vary=0.03)
rnd = random.Random(4)
for j, y in enumerate((0.1, 0.62, 1.14, 1.66)):
    p.box(-0.45, y, -0.45, 0.45, y + 0.04, 0.21, METAL, vary=0.04)
    if y > 1.6:
        continue
    x = -0.4
    while x < 0.3:
        w = rnd.uniform(0.14, 0.3)
        h = rnd.uniform(0.15, 0.4)
        if rnd.random() < 0.4:
            p.cyl(8, w / 2.4, w / 2.4, h, x + w / 2, y + 0.04, -0.12, rnd.choice((ORANGE, '#5fd0ff', '#e8ac3c', HULL)), seed=j)
        else:
            p.box(x, y + 0.04, -0.4, x + w - 0.02, y + 0.04 + h, 0.12, rnd.choice((SEAM, '#a9b3c6', '#7a8296', '#d9c9a8')), seed=j + 9)
        x += w + 0.02
p.finish()

# ---- horta hidropônica (2×1): bandejas com plantas e barra de luz de cultivo ----
p = Piece('plants', 12)
for sx in (-0.92, 0.92):
    p.box(sx - 0.04, 0, -0.42, sx + 0.04, 1.9, -0.34, DARK, vary=0.03)
    p.box(sx - 0.04, 0, 0.14, sx + 0.04, 1.9, 0.22, DARK, vary=0.03)
rnd = random.Random(7)
for y in (0.35, 1.05):
    p.box(-0.92, y, -0.44, 0.92, y + 0.14, 0.24, SEAM, vary=0.04)
    p.box(-0.88, y + 0.14, -0.4, 0.88, y + 0.16, 0.2, '#2f6b8a', vary=0.04)  # água
    for i in range(7):
        x = -0.78 + i * 0.26
        for z in (-0.25, 0.05):
            h = rnd.uniform(0.18, 0.34)
            leaf = lib.gcyl('leaf', 5, rnd.uniform(0.09, 0.13), 0.02, h, x + p.ox, y + 0.15, z, rnd.choice(('#5fbf4a', '#4aa83f', '#7cd35b')), vary=0.2, seed=i)
            leaf.rotation_euler.z = rnd.uniform(0, 6.28)
            lib.apply_all(leaf)
            lib.jitter(leaf, 0.03, seed=i * 3 + int(z * 10))
            p.body.append(leaf)
    p.box(-0.86, y + 0.56, -0.2, 0.86, y + 0.6, -0.08, DARK, vary=0.03)
    p.box(-0.84, y + 0.54, -0.18, 0.84, y + 0.56, -0.1, '#ff9be8', lit=True)  # luz de cultivo (rosa)
p.box(-0.92, 1.86, -0.44, 0.92, 1.92, 0.24, METAL, vary=0.03)
p.finish()

# ---- mesa (2×1): tampo, pés, canecas e um tablet aceso ----
p = Piece('table', 16)
p.box(-0.9, 0.74, -0.42, 0.9, 0.8, 0.4, SEAM, bev=0.02)
p.box(-0.9, 0.7, -0.42, 0.9, 0.74, 0.4, DARK, vary=0.03)
for sx in (-0.8, 0.8):
    p.box(sx - 0.05, 0, -0.08, sx + 0.05, 0.7, 0.08, DARK, vary=0.03)
    p.box(sx - 0.05, 0, -0.35, sx + 0.05, 0.05, 0.35, DARK, vary=0.03)
p.cyl(8, 0.05, 0.05, 0.11, -0.45, 0.8, 0.05, ORANGE)
p.cyl(8, 0.05, 0.05, 0.11, -0.25, 0.8, -0.15, HULL)
p.box(0.15, 0.8, -0.2, 0.55, 0.82, 0.1, DARK, vary=0.03)
p.box(0.18, 0.82, -0.17, 0.52, 0.825, 0.07, '#5fd0ff', lit=True)
p.finish()

# ---- tanque de água (1×1): cilindro com faixa, visor de nível e canos para a parede ----
p = Piece('tank', 19)
p.cyl(12, 0.36, 0.36, 0.12, 0, 0, -0.08, DARK)
p.cyl(12, 0.33, 0.33, 1.45, 0, 0.12, -0.08, HULL, seed=2)
p.cyl(12, 0.335, 0.335, 0.1, 0, 0.9, -0.08, '#5fd0ff', seed=3)
p.cyl(12, 0.33, 0.12, 0.2, 0, 1.57, -0.08, SEAM)
p.box(-0.05, 0.3, 0.24, 0.05, 1.4, 0.27, DARK, vary=0.02)
p.box(-0.03, 0.32, 0.27, 0.03, 0.95, 0.28, '#5fd0ff', lit=True)
for y in (0.5, 1.3):
    p.rod((0.22, y, -0.2), (0.22, y, -0.5), 0.04, METAL)
p.finish()

# ---- caixas de carga (1×1): pilha com cintas ----
p = Piece('crates', 22)
p.box(-0.44, 0, -0.44, 0.4, 0.5, 0.36, '#c9a46b', bev=0.02, seed=1)
p.box(-0.36, 0.5, -0.4, 0.3, 0.92, 0.2, SEAM, bev=0.02, seed=2)
p.box(0.02, 0, 0.0, 0.44, 0.36, 0.42, '#7a8296', bev=0.02, seed=3)
for (x, y0, y1, z0, z1) in ((-0.2, 0, 0.5, -0.45, 0.37), (0.12, 0, 0.5, -0.45, 0.37)):
    p.box(x - 0.025, y0, z0, x + 0.025, y1 + 0.005, z1, ORANGE, vary=0.03)
p.box(-0.1, 0.62, 0.2, 0.1, 0.72, 0.21, '#f2b233', vary=0.02)
p.finish()

print('TRIANGULOS', lib.stats(made))
if prev:
    lib.preview(prev, target=(11, 0, 0.9), dist=17, yaw=0, pitch=25, size=900)
lib.export(out)
