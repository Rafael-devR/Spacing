# Módulo de pouso (docs/design/MODELOS.md). Mesmo tamanho do modelo antigo de render/models.ts: pés num raio de 1,7,
# altura ~4. O corpo sai numa malha só; as janelas, numa peça "glow_*" (o jogo dá brilho próprio a ela). As luzes de
# status e o feixe continuam no código, nos pontos marcados pelos vazios "lamp_*" e "beam".
# Direções: no jogo (Y para cima) um ponto (x, y, z) do Blender vira (x, z, -y).
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from mathutils import Vector  # noqa: E402

out, prev = lib.args()
lib.reset()

GOLD = '#e8ac3c'
WHITE = '#e4e6ec'
SILVER = '#b5b9c4'
GREY = '#8c90a0'
DARK = '#3a3d48'
WINDOW = '#283157'
# a perna da escada aponta para onde o astronauta nasce (+x, +z no jogo = +x, -y aqui)
FRONT = math.radians(-45)
parts = []


def dirv(a, r=1.0, z=0.0):
    return Vector((math.cos(a) * r, math.sin(a) * r, z))


# ---- estágio de descida: octógono dourado, com a folha térmica amassada ----
d = lib.cyl('descent', 8, 1.15, 1.15, 0.95, 1.05)
d.rotation_euler.z = math.radians(22.5)
lib.apply_all(d)
lib.subdivide(d, 2)
lib.jitter(d, 0.025, seed=3)
# o topo do estágio é um convés de metal; os lados, folha dourada
lib.paint(d, GOLD, vary=0.32, seed=4, fn=lambda p: '#a9adb8' if p.normal.z > 0.8 else (DARK if p.normal.z < -0.8 else None))
parts.append(d)
for z in (1.0, 1.97):
    rim = lib.cyl('rim', 8, 1.19, 1.19, 0.09, z, cap=False)
    rim.rotation_euler.z = math.radians(22.5)
    lib.bevel(rim, 0.02)
    parts.append(lib.paint(rim, DARK, vary=0.1))
bell = lib.cyl('bell', 10, 0.52, 0.3, 0.5, 0.52, cap=False)
lib.bevel(bell, 0.02)
parts.append(lib.paint(bell, '#5b5f6e', vary=0.12))
throat = lib.cyl('throat', 10, 0.3, 0.3, 0.06, 0.98)
parts.append(lib.paint(throat, DARK))

# ---- pernas: amortecedor, dois apoios, pé ----
for k in range(4):
    a = math.radians(45 + 90 * k)
    top = dirv(a, 1.02, 1.8)
    foot = dirv(a, 1.66, 0.16)
    parts.append(lib.paint(lib.rod('leg', top, foot, 0.07, 8), SILVER, vary=0.1))
    knee = top.lerp(foot, 0.55)
    for s in (-1, 1):
        base = dirv(a + s * math.radians(28), 1.08, 1.12)
        parts.append(lib.paint(lib.rod('strut', base, knee, 0.035, 6), GREY, vary=0.1))
    pad = lib.cyl('pad', 10, 0.34, 0.24, 0.1, 0.0, x=foot.x, y=foot.y)
    lib.bevel(pad, 0.02)
    parts.append(lib.paint(pad, '#9aa0ae', vary=0.1))
    parts.append(lib.paint(lib.rod('pin', foot + Vector((0, 0, -0.02)), foot + Vector((0, 0, 0.16)), 0.05, 6), DARK))

# ---- escada e plataforma na perna da frente ----
top, foot = dirv(FRONT, 1.02, 1.8), dirv(FRONT, 1.66, 0.16)
side = Vector((-math.sin(FRONT), math.cos(FRONT), 0)) * 0.16
out_ = dirv(FRONT, 0.06)
for s in (-1, 1):
    parts.append(lib.paint(lib.rod('rail', top + side * s + out_, foot + side * s + out_ + Vector((0, 0, 0.1)), 0.022, 5), SILVER))
for i in range(1, 8):
    p = top.lerp(foot + Vector((0, 0, 0.1)), i / 8) + out_
    parts.append(lib.paint(lib.rod('rung', p - side, p + side, 0.018, 4), SILVER))
pp = dirv(FRONT, 1.22)
porch = lib.cube('porch', 0.36, 0.5, 0.05, x=pp.x, y=pp.y, z=1.98, rot=(0, 0, FRONT))
parts.append(lib.paint(porch, GREY, vary=0.1))

# ---- cabine (estágio de subida): octógono afinando para cima ----
cab = lib.cyl('cabin', 8, 0.86, 0.72, 0.86, 2.06)
cab.rotation_euler.z = math.radians(22.5)  # uma face plana olha para a escada
lib.bevel(cab, 0.05, 2)
lib.paint(cab, WHITE, vary=0.1, seed=7)
parts.append(cab)
# a face da frente: centro e direções para pôr janela e escotilha
# a maior face quase vertical voltada para a escada (as faixas do chanfro são estreitas)
front = max((p for p in cab.data.polygons if p.normal.dot(dirv(FRONT)) > 0.9), key=lambda p: p.area)
n = (cab.matrix_world.to_3x3() @ front.normal).normalized()
right = n.cross(Vector((0, 0, 1))).normalized()
up = right.cross(n).normalized()
c0 = cab.matrix_world @ front.center + n * 0.01
hatch = lib.cube('hatch', 0.34, 0.04, 0.34, rot=(0, 0, 0))
hatch.rotation_euler = n.to_track_quat('Y', 'Z').to_euler()
hatch.location = c0 - up * 0.14
lib.apply_all(hatch)
lib.bevel(hatch, 0.015)
parts.append(lib.paint(hatch, SILVER, vary=0.08))
windows = []
for s in (-1, 1):
    w = lib.cyl('glow_window', 3, 0.13, 0.13, 0.04, 0)
    w.rotation_euler = n.to_track_quat('Z', 'Y').to_euler()
    w.location = c0 + up * 0.2 + right * s * 0.17 - n * 0.01
    lib.apply_all(w)
    windows.append(lib.paint(w, WINDOW))
# caixa de equipamentos atrás
ap = dirv(FRONT + math.pi, 0.86)
aft = lib.cube('aft', 0.42, 0.55, 0.5, x=ap.x, y=ap.y, z=2.12, rot=(0, 0, FRONT))
lib.bevel(aft, 0.03)
parts.append(lib.paint(aft, SILVER, vary=0.12))
# blocos de propulsores nos quatro lados (entre a frente e as laterais)
for k in range(4):
    a = FRONT + math.radians(45 + 90 * k)
    qp = dirv(a, 0.84)
    q = lib.cube('rcs', 0.16, 0.16, 0.16, x=qp.x, y=qp.y, z=2.55, rot=(0, 0, a))
    parts.append(lib.paint(q, GREY, vary=0.1))
    p = dirv(a, 0.84, 2.63)
    for v in (Vector((0, 0, 0.16)), Vector((0, 0, -0.16)), dirv(a, 0.16)):
        parts.append(lib.paint(lib.rod('nozzle', p, p + v, 0.03, 5), DARK))
# túnel de acoplamento no topo
tun = lib.cyl('tunnel', 8, 0.42, 0.38, 0.26, 2.9)
lib.bevel(tun, 0.02)
parts.append(lib.paint(tun, GREY, vary=0.1))
ring = lib.cyl('ring', 8, 0.44, 0.44, 0.05, 3.14, cap=False)
parts.append(lib.paint(ring, DARK))

# ---- antena: mastro e prato (o feixe do reparo sai daqui) ----
parts.append(lib.paint(lib.rod('mast', (0.3, 0, 2.9), (0.3, 0, 3.86), 0.028, 6), GREY))
dish = lib.cyl('dish', 10, 0.06, 0.34, 0.14, 3.84, x=0.3, cap=False)
parts.append(lib.paint(dish, WHITE, vary=0.1))
parts.append(lib.paint(lib.rod('feed', (0.3, 0, 3.86), (0.3, 0, 4.12), 0.015, 4), GREY))

# ---- bandeira, ao lado ----
FX, FY = 2.4, -1.2
parts.append(lib.paint(lib.rod('pole', (FX, FY, 0), (FX, FY, 1.85), 0.03, 6), WHITE))
parts.append(lib.paint(lib.rod('bar', (FX, FY, 1.8), (FX + 0.72, FY, 1.8), 0.015, 4), WHITE))
flag = lib.cube('flag', 0.7, 0.02, 0.42, x=FX + 0.37, y=FY, z=1.36)
lib.subdivide(flag, 3)
for v in flag.data.vertices:
    v.co.y += math.sin((v.co.x - FX) * 7) * 0.04
lib.paint(flag, '#ff7a2f', vary=0.08, fn=lambda p: '#f4f1ea' if 1.5 < p.center.z < 1.64 else None)
parts.append(flag)
parts.append(lib.paint(lib.cyl('base', 6, 0.14, 0.1, 0.06, 0, x=FX, y=FY), GREY))

# ---- pontos que o código usa ----
for i in range(3):
    a = math.radians(-120 * i)  # no jogo: ângulos 0, 120 e 240 graus no plano xz
    lib.empty(f'lamp_{i}', dirv(a, 0.7, 2.96))
lib.empty('beam', (0.3, 0, 4.12))

body = lib.join('lander', parts)
glow = lib.join('glow_windows', windows)
lib.bake_ao(body, strength=0.6, distance=0.9)
print('TRIANGULOS', lib.stats([body, glow]), 'corpo', lib.stats([body]))
if prev:
    lib.preview(prev, target=(0.4, 0, 1.8), dist=10.5)
    lib.preview(prev.replace('.png', '-cabine.png'), target=(0.3, -0.3, 2.6), dist=4.5, size=480)
lib.export(out)
