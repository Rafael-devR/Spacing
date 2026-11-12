# Eletrolisador (docs/design/MODELOS.md, render/stationModels.ts). Espaço 1×1: chão em y = 0, frente para +z. Cuba de
# vidro com água e dois eletrodos; o gás sobe para dois tanques atrás (H₂ alto, faixa laranja; O₂ baixo, faixa azul).
# Animação em laço (2 s): bolhas subindo dos eletrodos (o dobro do lado do H₂), bomba e ponteiros dos manômetros.
# Peças que o código controla: fx_liquid (água, brilha mais quando trabalha), fx_arc (faísca entre eletrodos),
# glass_tub (vidro), lit_bubble_* (somem quando a máquina para). Ponto: lamp (luz de estado).
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()
N = 48
lib.timeline(N)

HULL, SEAM, METAL, DARK, ORANGE, BLUE = '#dfe3ea', '#c3c7d2', '#8c90a0', '#3d4252', '#ff8a3d', '#4fb8ff'
body = []

body.append(lib.gbox('base', -0.43, 0, -0.4, 0.43, 0.18, 0.4, DARK, vary=0.03, bev=0.02))
body.append(lib.gbox('base_band', -0.43, 0.12, 0.4, 0.43, 0.15, 0.41, ORANGE, vary=0.02))
# tanques
for (x, r, h, band) in ((-0.2, 0.17, 1.2, ORANGE), (0.22, 0.15, 0.62, BLUE)):
    body.append(lib.gcyl('tank', 12, r, r, h, x, 0.18, -0.22, HULL, seed=int(x * 10)))
    body.append(lib.gcyl('dome', 12, r, r * 0.35, r * 0.6, x, 0.18 + h, -0.22, HULL))
    body.append(lib.gcyl('band', 12, r + 0.006, r + 0.006, 0.1, x, 0.18 + h * 0.7, -0.22, band))
    body.append(lib.gcyl('valve', 6, 0.03, 0.03, 0.08, x, 0.18 + h + r * 0.6, -0.22, METAL))
# manômetros (frente dos tanques) com ponteiros que tremem
needles = []
for (name, x, y) in (('needle_h', -0.2, 0.95), ('needle_o', 0.22, 0.6)):
    d = lib.gcyl('dial', 10, 0.065, 0.065, 0.02, 0, 0, 0, '#f4f1ea')
    d.location = lib.G(x, y, -0.22 + 0.16)
    d.rotation_euler = (math.pi / 2, 0, 0)
    lib.apply_all(d)
    body.append(d)
    n = lib.gbox(name, x - 0.006, y, -0.22 + 0.185, x + 0.006, y + 0.05, -0.22 + 0.19, '#d23a2a', vary=0.0)
    lib.set_origin(n, x, y, -0.22 + 0.185)
    needles.append(n)
# cuba: vidro, água, eletrodos e canos até os tanques
glass = lib.gbox('glass_tub', -0.31, 0.19, 0.02, 0.31, 0.61, 0.32, '#bff4ff', vary=0.0)
liquid = lib.gbox('fx_liquid', -0.29, 0.2, 0.04, 0.29, 0.5, 0.3, '#3a8fd8', vary=0.0)
body.append(lib.gbox('tub_rim', -0.32, 0.61, 0.01, 0.32, 0.64, 0.33, METAL, vary=0.03))
for sx in (-1, 1):
    body.append(lib.gbox('electrode', sx * 0.15 - 0.025, 0.24, 0.145, sx * 0.15 + 0.025, 0.7, 0.195, METAL, vary=0.03))
    tx = -0.2 if sx < 0 else 0.22
    body.append(lib.grod('pipe', (sx * 0.15, 0.7, 0.17), (tx, 0.95 if sx < 0 else 0.7, -0.08), 0.022, METAL))
arc = lib.gbox('fx_arc', -0.14, 0.66, 0.165, 0.14, 0.675, 0.175, '#9fe8ff', vary=0.0)
# bomba na lateral
body.append(lib.gbox('pump', 0.33, 0.18, 0.05, 0.43, 0.42, 0.3, SEAM, vary=0.04, bev=0.01))
pump = lib.gcyl('piston', 6, 0.03, 0.03, 0.18, 0.38, 0.42, 0.17, METAL)
lib.set_origin(pump, 0.38, 0.42, 0.17)
lib.gempty('lamp', 0.3, 0.28, 0.41)

# bolhas: 6 do lado do H₂ (esquerda), 3 do O₂
bubbles = []
spots = [(-0.15, i / 6) for i in range(6)] + [(0.15, i / 3 + 0.1) for i in range(3)]
for i, (bx, phase) in enumerate(spots):
    zz = 0.17 + math.cos(i * 1.7) * 0.07
    b = lib.paint(lib.cyl('b', 4, 0.022, 0.0, 0.03, 0), '#e8fbff')
    bpy_obj = b
    lib.apply_all(b)
    b.name = f'lit_bubble_{i}'
    bubbles.append(b)
    y0, y1 = 0.24, 0.5
    # sobe de y0 a y1 no laço, começando na fase; volta ao fundo num quadro
    ftop = round((1 - phase) * N) % N or N
    pts = [(0, y0 + (y1 - y0) * phase), (ftop, y1)]
    if ftop < N:
        pts += [(ftop + 1, y0), (N, y0 + (y1 - y0) * phase)]
    lib.keys(b, 'location', [(f, lib.G(bx + math.sin(i * 2.3) * 0.03, yy, zz)) for f, yy in pts])

lib.keys(pump, 'location', [(0, lib.G(0.38, 0.42, 0.17)), (12, lib.G(0.38, 0.5, 0.17)), (24, lib.G(0.38, 0.42, 0.17)),
                            (36, lib.G(0.38, 0.5, 0.17)), (48, lib.G(0.38, 0.42, 0.17))])
for k, n in enumerate(needles):
    lib.keys(n, 'rotation_euler', [(0, (0, -0.5, 0)), (12 + k * 6, (0, 0.6, 0)), (30, (0, 0.2, 0)), (48, (0, -0.5, 0))])

el = lib.join('electrolyzer', body)
lib.bake_ao(el, strength=0.5, distance=0.4, samples=24)
print('TRIANGULOS', lib.stats([el, glass, liquid, arc, pump] + needles + bubbles))
if prev:
    lib.preview(prev, target=(0, 0, 0.6), dist=3.6, yaw=25, pitch=20)
lib.export(out, anim=True)
