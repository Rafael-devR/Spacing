# Forno solar (docs/design/MODELOS.md, render/stationModels.ts). Espaço 1×1: chão em y = 0, frente para +z. Câmara de
# tijolo com porta e janela de quartzo, gaiola com o tubo de luz que desce dos espelhos do telhado até o teto (y = 3).
# Peças que o código acende: fx_window (janela, esquenta), fx_core_tall (luz no tubo), fx_ring (anel do bocal).
# Peças com "tall" no nome vão até o teto e saem do ícone. Animação em laço: ventilador e fole do ar quente.
# Pontos: lamp (luz de estado), vent (de onde saem as brasas).
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()
lib.timeline(48)

HULL, SEAM, METAL, DARK, ORANGE = '#dfe3ea', '#c3c7d2', '#8c90a0', '#3d4252', '#ff7a2f'
BRICK = ('#b6a48e', '#a8957d', '#c2b19a')
CEIL = 3.0
body = []

body.append(lib.gbox('base', -0.42, 0, -0.4, 0.42, 0.16, 0.38, DARK, vary=0.03, bev=0.02))
# câmara de tijolo: fileiras alternadas
rnd = random.Random(3)
y = 0.16
row = 0
while y < 1.0:
    h = min(0.12, 1.0 - y)
    off = 0.1 if row % 2 else 0
    x = -0.38 - off
    while x < 0.38:
        x1 = min(x + 0.2, 0.38)
        x0 = max(x, -0.38)
        if x1 - x0 > 0.02:
            body.append(lib.gbox('brick', x0 + 0.005, y + 0.005, -0.36, x1 - 0.005, y + h - 0.005, 0.33, rnd.choice(BRICK), vary=0.05, seed=row))
        x += 0.2
    y += h
    row += 1
body.append(lib.gbox('mortar', -0.37, 0.16, -0.35, 0.37, 1.0, 0.32, '#8f8170', vary=0.02))
body.append(lib.gbox('cap', -0.41, 1.0, -0.39, 0.41, 1.1, 0.36, HULL, bev=0.02))
body.append(lib.gbox('cap_band', -0.41, 1.04, 0.36, 0.41, 1.07, 0.37, ORANGE, vary=0.02))
# porta com janela e trinco
body.append(lib.gbox('door', -0.27, 0.34, 0.33, 0.27, 0.86, 0.38, METAL, bev=0.015))
body.append(lib.gbox('latch', -0.2, 0.38, 0.38, 0.2, 0.42, 0.41, DARK, vary=0.02))
body.append(lib.gbox('hinge', -0.29, 0.4, 0.33, -0.26, 0.8, 0.39, DARK, vary=0.02))
window = lib.gbox('fx_window', -0.18, 0.5, 0.38, 0.18, 0.76, 0.385, '#ff8a3d', vary=0.0)
body.append(lib.gbox('vent_slot', -0.15, 0.9, 0.33, 0.15, 0.96, 0.36, DARK, vary=0.02))
# termômetro na lateral
body.append(lib.gcyl('gauge', 10, 0.07, 0.07, 0.03, 0, 0, 0, SEAM))
g = body.pop()
g.location = lib.G(0.4, 0.7, 0.05)
g.rotation_euler = (0, math.pi / 2, 0)
lib.apply_all(g)
body.append(g)
# bocal do tubo de luz e gaiola até o teto
body.append(lib.gcyl('socket', 8, 0.14, 0.11, 0.24, 0, 1.1, -0.12, METAL, bev=0.01))
ring = lib.gcyl('fx_ring', 10, 0.12, 0.12, 0.04, 0, 1.34, -0.12, '#ffb070')
tall = []
for k in range(3):
    a = k * 2 * math.pi / 3
    x, z = math.cos(a) * 0.09, -0.12 + math.sin(a) * 0.09
    tall.append(lib.grod('cage', (x, 1.34, z), (x, CEIL, z), 0.015, SEAM, verts=4))
for yy in (1.9, 2.5):
    tall.append(lib.gcyl('hoop', 8, 0.105, 0.105, 0.03, 0, yy, -0.12, METAL, cap=False))
tall.append(lib.gcyl('mount', 8, 0.16, 0.16, 0.06, 0, CEIL - 0.06, -0.12, DARK))
core = lib.gcyl('fx_core_tall', 6, 0.04, 0.04, CEIL - 1.38, 0, 1.38, -0.12, '#ffd08a')

# ventilador (lado esquerdo) e fole (atrás à direita)
body.append(lib.gbox('fan_box', -0.44, 0.3, -0.25, -0.41, 0.7, 0.15, DARK, vary=0.03))
blades = []
for k in range(5):
    b = lib.gbox('blade', -0.005, -0.02, -0.015, 0.0, 0.02, 0.15, '#6a7082', vary=0.03)
    b.location = lib.G(-0.445, 0.5, -0.05)
    b.rotation_euler = (k * 2 * math.pi / 5, 0, 0)
    lib.apply_all(b)
    blades.append(b)
fan = lib.join('fan', blades)
lib.set_origin(fan, -0.445, 0.5, -0.05)
body.append(lib.gcyl('bellows_base', 8, 0.08, 0.08, 0.12, 0.28, 1.1, -0.28, DARK))
piston = lib.join('piston', [
    lib.gcyl('rod', 6, 0.03, 0.03, 0.3, 0.28, 1.15, -0.28, METAL),
    lib.gcyl('head', 8, 0.06, 0.06, 0.05, 0.28, 1.45, -0.28, ORANGE),
])
lib.set_origin(piston, 0.28, 1.15, -0.28)

lib.gempty('lamp', 0.27, 0.95, 0.38)
lib.gempty('vent', 0, 0.93, 0.4)
furnace = lib.join('furnace', body)
lib.bake_ao(furnace, strength=0.5, distance=0.4, samples=24)
cage = lib.join('tall_cage', tall)

lib.keys(fan, 'rotation_euler', [(0, (0, 0, 0)), (48, (math.pi * 2 * 4, 0, 0))])
p0 = lib.G(0.28, 1.15, -0.28)
lib.keys(piston, 'location', [(0, p0), (24, (p0[0], p0[1], p0[2] - 0.12)), (48, p0)])

print('TRIANGULOS', lib.stats([furnace, cage, core, ring, window, fan, piston]))
if prev:
    lib.preview(prev, target=(0, 0, 1.3), dist=5.5, yaw=25, pitch=18)
lib.export(out, anim=True)
