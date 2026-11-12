# Bancada de fabricação (docs/design/MODELOS.md, render/Fabricator.ts). Espaço 2×1: chão em y = 0, frente para +z,
# tampo em y = 0,9 (o código desenha a grade do tampo e imprime a peça ali). O pórtico tem um carro com dois emissores; a
# animação (feita aqui, tocada em laço enquanto imprime) leva o carro de um lado para o outro e gira o ventilador.
# Pontos: emitter_0/1 (pontas dos emissores, presos ao carro: os lasers saem dali), lamp (luz de estado).
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()
lib.timeline(96)

HULL, SEAM, METAL, DARK, ORANGE = '#dfe3ea', '#c3c7d2', '#8c90a0', '#3d4252', '#ff7a2f'
BED_Y, RAIL_Y = 0.9, 2.06
body = []

# ---- mesa: gabinete com gavetas, tampo escuro, faixa laranja ----
body.append(lib.gbox('cab', -0.94, 0, -0.45, 0.94, 0.82, 0.33, HULL, bev=0.03, seed=2))
body.append(lib.gbox('top', -0.96, 0.82, -0.47, 0.96, BED_Y, 0.42, DARK, vary=0.03))
body.append(lib.gbox('stripe', -0.94, 0.6, 0.33, 0.94, 0.66, 0.35, ORANGE, vary=0.03))
for i in range(3):
    x0 = -0.86 + i * 0.58
    body.append(lib.gbox('drawer', x0, 0.1, 0.33, x0 + 0.52, 0.52, 0.35, SEAM, vary=0.04, seed=i))
    body.append(lib.gbox('handle', x0 + 0.16, 0.42, 0.35, x0 + 0.36, 0.45, 0.38, DARK, vary=0.02))
body.append(lib.gbox('kick', -0.9, 0, 0.3, 0.9, 0.08, 0.34, DARK, vary=0.02))
# moldura da área de impressão
for (x0, z0, x1, z1) in ((-0.62, -0.32, 0.62, -0.28), (-0.62, 0.28, 0.62, 0.32), (-0.62, -0.32, -0.58, 0.32), (0.58, -0.32, 0.62, 0.32)):
    body.append(lib.gbox('rim', x0, BED_Y, z0, x1, BED_Y + 0.03, z1, METAL, vary=0.03))

# ---- pórtico: colunas, braços e trilho ----
for sx in (-1, 1):
    body.append(lib.gbox('col', sx * 0.88 - 0.06, BED_Y, -0.36, sx * 0.88 + 0.06, RAIL_Y + 0.1, -0.24, METAL, bev=0.015))
    body.append(lib.gbox('arm', sx * 0.88 - 0.05, RAIL_Y + 0.02, -0.3, sx * 0.88 + 0.05, RAIL_Y + 0.12, 0.06, METAL, vary=0.03))
    # cabos descendo pela coluna
    body.append(lib.grod('cable', (sx * 0.8, BED_Y, -0.38), (sx * 0.8, RAIL_Y, -0.38), 0.018, DARK, verts=4))
body.append(lib.gbox('rail', -0.93, RAIL_Y + 0.02, -0.04, 0.93, RAIL_Y + 0.12, 0.06, DARK, vary=0.03))
body.append(lib.gbox('rail_top', -0.93, RAIL_Y + 0.12, -0.02, 0.93, RAIL_Y + 0.14, 0.04, ORANGE, vary=0.03))
# suporte de ferramentas na coluna da esquerda
body.append(lib.gbox('rack', -0.98, 1.2, -0.3, -0.94, 1.6, 0.1, DARK, vary=0.03))
for i, c in enumerate((ORANGE, SEAM, '#5fd0ff')):
    z = -0.2 + i * 0.12
    body.append(lib.grod('tool', (-0.99, 1.52, z), (-0.99, 1.25, z), 0.02, c, verts=4))

# ---- ventilador na lateral direita (gira) ----
fan_c = (0.955, 0.42, -0.08)
body.append(lib.gbox('fan_box', 0.94, 0.22, -0.28, 0.97, 0.62, 0.12, DARK, vary=0.03))
blades = []
for k in range(4):
    a = k * math.pi / 2
    b = lib.gbox('blade', 0.0, -0.025, -0.02, 0.005, 0.025, 0.16, '#6a7082', vary=0.03)
    b.location = lib.G(0.975, fan_c[1], fan_c[2])
    b.rotation_euler = (a, 0, 0)
    lib.apply_all(b)
    blades.append(b)
fan = lib.join('fan', blades)
lib.set_origin(fan, *fan_c)

# ---- carro com os dois emissores (anima) ----
car = [lib.gbox('car', -0.15, RAIL_Y - 0.1, -0.12, 0.15, RAIL_Y + 0.08, 0.12, HULL, bev=0.02, seed=5)]
car.append(lib.gbox('car_stripe', -0.1, RAIL_Y + 0.0, 0.12, 0.1, RAIL_Y + 0.03, 0.13, ORANGE, vary=0.02))
for sz in (-1, 1):
    noz = lib.gcyl('nozzle', 6, 0.012, 0.05, 0.14, 0, RAIL_Y - 0.24, sz * 0.08, DARK)
    car.append(noz)
carriage = lib.join('carriage', car)
lib.set_origin(carriage, 0, RAIL_Y, 0)
for i, sz in enumerate((-1, 1)):
    lib.parent(lib.gempty(f'emitter_{i}', 0, RAIL_Y - 0.25, sz * 0.08), carriage)
lib.gempty('lamp', 0.8, 0.74, 0.37)

bench = lib.join('workbench', body)
lib.bake_ao(bench, strength=0.5, distance=0.5, samples=24)

# ---- animação: o carro vai e volta (4 s), o ventilador gira ----
keys = [(0, 0.0), (24, 0.38), (48, 0.0), (72, -0.38), (96, 0.0)]
lib.keys(carriage, 'location', [(f, lib.G(x, RAIL_Y, 0)) for f, x in keys])
lib.keys(fan, 'rotation_euler', [(0, (0, 0, 0)), (96, (math.pi * 2 * 6, 0, 0))])

print('TRIANGULOS', lib.stats([bench, carriage, fan]))
if prev:
    lib.preview(prev, target=(0, 0, 1.0), dist=5, yaw=20, pitch=22)
lib.export(out, anim=True)
