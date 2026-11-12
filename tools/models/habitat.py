# Casco de fora do Habitat 01 (docs/design/MODELOS.md). Só o lado de fora: por dentro a base continua montada em código
# (habitat_interior.py), numa camada que só a câmera de dentro vê. Medidas do módulo em lib.HAB (= data/base.ts): 11×9
# blocos por fora, 3 de altura livre, porta no meio da parede sul. O modelo antigo serviu de referência, não de molde:
# cantos em coluna, abóbada no telhado, janelas de verdade com moldura, radiadores, câmara de entrada com marquise,
# painéis solares num mastro. As pernas (vão até o chão, que muda), as luzes e a placa ficam no código, nos pontos marcados.
# Coordenadas: o script pensa no jogo (x, y para cima, z para o sul) e converte: jogo (x, y, z) = Blender (x, -z, y).
# A origem é o canto noroeste de baixo do módulo (o mesmo `group.position` do código).
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

SX, SZ, H = lib.HAB['SX'], lib.HAB['SZ'], lib.HAB['H']
TOP = H + 1  # alto das paredes (o telhado é a célula de cima)
HULL = '#e4e6ec'
SEAM = '#c3c7d2'
METAL = '#8c90a0'
DARK = '#4b4f60'
ORANGE = '#ff7a2f'
ICE = '#9fe8ff'
CELL = ('#24305e', '#2c3a72')
WIN_Z = (2.5, 4.5, 6.5)  # centro das janelas leste e oeste (as mesmas por dentro)

parts = []   # corpo (uma malha só)
lit = []     # janelas acesas (material que brilha)
DOOR = (lib.HAB['DOOR_AT'], lib.HAB['DOOR_AT'] + 1)  # x da porta na parede sul


def G(x, y, z):
    return (x, -z, y)


def box(name, x0, y0, z0, x1, y1, z1, color, vary=0.08, bev=0.0, seed=1, fn=None, into=None):
    o = lib.cube(name, x1 - x0, z1 - z0, y1 - y0, x=(x0 + x1) / 2, y=-(z0 + z1) / 2, z=y0)
    if bev:
        lib.bevel(o, bev)
    lib.paint(o, color, vary=vary, seed=seed, fn=fn)
    (parts if into is None else into).append(o)
    return o


def arc_mesh(name, x0, x1, cz, y, r, sy, segs, color, caps=True, vary=0.06, seed=1):
    """meia abóbada: arco de raio r (achatado por sy) no plano yz, puxado de x0 a x1"""
    bm = bmesh.new()
    rings = []
    for x in (x0, x1):
        ring = []
        for i in range(segs + 1):
            a = math.pi * i / segs
            ring.append(bm.verts.new(G(x, y + math.sin(a) * r * sy, cz + math.cos(a) * r)))
        rings.append(ring)
    for i in range(segs):
        a, b = rings[0], rings[1]
        bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    if caps:
        bm.faces.new(rings[0])
        bm.faces.new(rings[1])
    # normais para fora: as faces do arco se afastam do eixo; as tampas apontam para as pontas
    axis_y, axis_z = -cz, y  # eixo em coordenadas do Blender (y, z)
    for f in bm.faces:
        f.normal_update()
        c = f.calc_center_median()
        if len(f.verts) == 4:
            want = (0.0, c.y - axis_y, c.z - axis_z)
        else:
            want = (-1.0 if c.x < (x0 + x1) / 2 else 1.0, 0.0, 0.0)
        if f.normal.x * want[0] + f.normal.y * want[1] + f.normal.z * want[2] < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    lib.paint(o, color, vary=vary, seed=seed)
    parts.append(o)
    return o


# ---- base: plataforma de metal sobre uma armação escura ----
box('plinth', 0, 0.12, 0, SX, 1.0, SZ, METAL, bev=0.06, seed=2)
box('frame', 0.3, 0.0, 0.3, SX - 0.3, 0.14, SZ - 0.3, DARK)
# rodapé escuro em volta das paredes
for (x0, z0, x1, z1) in ((0, -0.04, SX, 0.0), (0, SZ, DOOR[0] - 0.45, SZ + 0.04), (DOOR[1] + 0.45, SZ, SX, SZ + 0.04),
                         (-0.04, 0, 0, SZ), (SX, 0, SX + 0.04, SZ)):
    box('skirt', x0, 1.0, z0, x1, 1.14, z1, DARK, vary=0.04)

# ---- paredes (casco branco) com colunas nos cantos ----
C = 0.4  # as paredes começam depois da coluna
box('wall_n', C, 1.0, 0, SX - C, TOP, 1, HULL, seed=3)
box('wall_s1', C, 1.0, SZ - 1, DOOR[0], TOP, SZ, HULL, seed=4)
box('wall_s2', DOOR[1], 1.0, SZ - 1, SX - C, TOP, SZ, HULL, seed=5)
box('lintel', DOOR[0], 3.0, SZ - 1, DOOR[1], TOP, SZ, HULL, seed=6)
box('wall_w', 0, 1.0, C, 1, TOP, SZ - C, HULL, seed=7)
box('wall_e', SX - 1, 1.0, C, SX, TOP, SZ - C, HULL, seed=8)
for (cx, cz) in ((0.5, 0.5), (SX - 0.5, 0.5), (0.5, SZ - 0.5), (SX - 0.5, SZ - 0.5)):
    col = lib.cyl('column', 8, 0.6, 0.6, TOP - 0.95 + 0.2, 0.95, x=cx, y=-cz)
    col.rotation_euler.z = math.radians(22.5)
    lib.bevel(col, 0.04)
    parts.append(lib.paint(col, SEAM, vary=0.08, seed=9))

# faixa laranja (a marca da base) e nervuras do casco
BAND = (1.58, 1.78)
for (x0, z0, x1, z1) in ((C, -0.05, SX - C, 0.0), (C, SZ, DOOR[0] - 0.45, SZ + 0.05), (DOOR[1] + 0.45, SZ, SX - C, SZ + 0.05),
                         (-0.05, C, 0.0, SZ - C), (SX, C, SX + 0.05, SZ - C)):
    box('band', x0, BAND[0], z0, x1, BAND[1], z1, ORANGE, vary=0.05)
RADIATORS = ((1.3, 3.1), (SX - 3.1, SX - 1.3))
x = 1.5
while x < SX - 1.2:
    if not any(a - 0.2 < x < b + 0.2 for a, b in RADIATORS):
        box('rib', x - 0.05, 1.14, -0.04, x + 0.05, TOP, 0.0, SEAM, vary=0.04)
    if x < DOOR[0] - 0.8 or DOOR[1] + 2.5 < x:  # longe da porta e da placa
        box('rib', x - 0.05, 1.14, SZ, x + 0.05, TOP, SZ + 0.04, SEAM, vary=0.04)
    x += 1.5
for z in (1.5, 3.5, 5.5, 7.5):
    box('rib', -0.04, 1.14, z - 0.05, 0.0, TOP, z + 0.05, SEAM, vary=0.04)
    box('rib', SX, 1.14, z - 0.05, SX + 0.04, TOP, z + 0.05, SEAM, vary=0.04)

# ---- janelas leste e oeste: moldura escura e vidro aceso (a luz azul-gelo de dentro) ----
for z in WIN_Z:
    for (xo, s) in ((0.0, -1), (SX, 1)):
        a, b = sorted((xo, xo + s * 0.07))
        box('frame_win', a, 2.38, z - 0.48, b, 3.12, z + 0.48, DARK, vary=0.04)
        a, b = sorted((xo, xo + s * 0.09))
        box('glow_win', a, 2.48, z - 0.38, b, 3.02, z + 0.38, ICE, vary=0.05, into=lit)

# ---- parede norte: dois radiadores de aletas ----
for (x0, x1) in RADIATORS:
    box('radiator', x0, 1.35, -0.12, x1, 3.75, 0.0, DARK, vary=0.04)
    for i in range(8):
        y = 1.5 + i * 0.28
        box('fin', x0 + 0.08, y, -0.2, x1 - 0.08, y + 0.1, -0.12, '#b5b9c4', vary=0.05, seed=20 + i)

# ---- câmara de entrada: marquise, batentes, soleira e degrau ----
box('post', DOOR[0] - 0.32, 1.0, SZ - 0.1, DOOR[0], 3.35, SZ + 0.4, DARK, bev=0.03)
box('post', DOOR[1], 1.0, SZ - 0.1, DOOR[1] + 0.32, 3.35, SZ + 0.4, DARK, bev=0.03)
box('head', DOOR[0] - 0.32, 3.0, SZ - 0.1, DOOR[1] + 0.32, 3.4, SZ + 0.4, DARK, bev=0.03)
box('canopy', DOOR[0] - 0.65, 3.4, SZ - 0.1, DOOR[1] + 0.65, 3.56, SZ + 0.7, ORANGE, bev=0.03, vary=0.05)
# faixas de atenção nos batentes
for x in (DOOR[0] - 0.34, DOOR[1] + 0.3):
    for i in range(4):
        y = 1.2 + i * 0.5
        box('hazard', x, y, SZ + 0.1, x + 0.04, y + 0.22, SZ + 0.36, '#f2b233', vary=0.04)
box('threshold', DOOR[0], 0.96, SZ - 1, DOOR[1], 1.0, SZ + 0.45, METAL, vary=0.04)
box('step', DOOR[0] - 0.25, 0.0, SZ + 0.45, DOOR[1] + 0.25, 0.55, SZ + 1.0, METAL, bev=0.03)
box('step_edge', DOOR[0] - 0.25, 0.55, SZ + 0.92, DOOR[1] + 0.25, 0.58, SZ + 1.0, ORANGE, vary=0.03)

# ---- telhado: laje com beiral, abóbada com nervuras ----
box('roof', -0.06, TOP, -0.06, SX + 0.06, TOP + 0.36, SZ + 0.06, HULL, bev=0.05, seed=11)
box('eave', -0.1, TOP - 0.04, -0.1, SX + 0.1, TOP + 0.06, SZ + 0.1, DARK, vary=0.04)
VY = TOP + 0.36
VR = SZ / 2 - 0.75
VS = 1.35 / VR  # achatamento: a abóbada sobe 1,35
arc_mesh('vault', 0.7, SX - 0.7, SZ / 2, VY, VR, VS, 12, HULL, seed=12)
n = 6
for i in range(n + 1):  # as das pontas abraçam a tampa da abóbada
    x = 0.62 + (SX - 0.74 - 0.62) * i / n
    arc_mesh('vault_rib', x, x + 0.12, SZ / 2, VY, VR + 0.05, (1.35 + 0.05) / (VR + 0.05), 12, SEAM, caps=True)
VTOP = VY + 1.35

# ---- painéis solares num mastro no meio da abóbada ----
lib_m = lib.rod('mast', G(SX / 2, VTOP - 0.1, SZ / 2), G(SX / 2, VTOP + 1.1, SZ / 2), 0.07, 8)
parts.append(lib.paint(lib_m, METAL))
parts.append(lib.paint(lib.rod('boom', G(1.3, VTOP + 1.1, SZ / 2), G(SX - 1.3, VTOP + 1.1, SZ / 2), 0.045, 6), METAL))
TILT = math.radians(22)  # inclinados para o sul
for (x0, x1) in ((1.2, SX / 2 - 0.35), (SX / 2 + 0.35, SX - 1.2)):
    w, d = x1 - x0, 2.0
    p = lib.cube('panel', w, d, 0.05, x=(x0 + x1) / 2, y=-SZ / 2, z=VTOP + 1.12)
    lib.subdivide(p, 3)
    p.rotation_euler.x = TILT
    lib.apply_all(p)

    def cells(f, x0=x0, w=w):
        if abs(f.normal.z) < 0.5:
            return SEAM
        i = int((f.center.x - x0) / w * 4)
        j = int((f.center.y + SZ / 2 + 1.0) / 2.0 * 4)
        return CELL[(i + j) % 2] if f.normal.z > 0 else DARK
    lib.paint(p, CELL[0], vary=0.06, seed=30, fn=cells)
    parts.append(p)
    box('panel_rim', x0 - 0.04, VTOP + 1.08, SZ / 2 - 0.05, x1 + 0.04, VTOP + 1.14, SZ / 2 + 0.05, SEAM, vary=0.03)

# ---- antena com luz (canto nordeste) e prato de comunicação (noroeste) ----
parts.append(lib.paint(lib.rod('antenna', G(SX - 0.55, TOP + 0.3, 0.55), G(SX - 0.55, TOP + 2.6, 0.55), 0.04, 6), METAL))
for y in (TOP + 1.2, TOP + 1.9):
    parts.append(lib.paint(lib.rod('spar', G(SX - 0.85, y, 0.55), G(SX - 0.25, y, 0.55), 0.02, 4), METAL))
ped = lib.cyl('pedestal', 8, 0.28, 0.2, 0.3, TOP + 0.36, x=1.0, y=-1.0)
parts.append(lib.paint(ped, DARK))
dish = lib.cyl('dish', 12, 0.08, 0.62, 0.22, 0, cap=False)
dish.location = G(1.0, TOP + 0.75, 1.0)
dish.rotation_euler = (math.radians(35), 0, math.radians(30))
lib.apply_all(dish)
parts.append(lib.paint(dish, HULL, vary=0.06))
parts.append(lib.paint(lib.rod('dish_arm', G(1.0, TOP + 0.6, 1.0), G(1.0, TOP + 0.85, 1.0), 0.06, 6), METAL))
# caixa de ventilação no canto sudeste
box('vent', SX - 1.9, TOP + 0.36, SZ - 1.3, SX - 0.5, TOP + 0.72, SZ - 0.4, METAL, bev=0.03, seed=40)
for i in range(4):
    x = SX - 1.75 + i * 0.32
    box('grille', x, TOP + 0.72, SZ - 1.2, x + 0.16, TOP + 0.75, SZ - 0.5, DARK, vary=0.03)

# ---- folhas da porta: peças à parte, que o código abre (correm para dentro da parede) ----
leaves = []
for (name, x0, x1, sx) in (('door_l', DOOR[0], DOOR[0] + 0.5, 1), ('door_r', DOOR[0] + 0.5, DOOR[1], -1)):
    own = []
    box(name, x0 + 0.01, 1.0, SZ - 0.62, x1 - 0.01, 3.0, SZ - 0.38, SEAM, vary=0.04, into=own)
    sx0 = x1 - 0.1 if sx > 0 else x0 + 0.04
    box(name + '_stripe', sx0, 1.4, SZ - 0.64, sx0 + 0.06, 2.6, SZ - 0.36, ORANGE, vary=0.03, into=own)
    box(name + '_window', x0 + 0.14, 2.3, SZ - 0.645, x1 - 0.14, 2.7, SZ - 0.355, '#283157', vary=0.03, into=own)
    leaves.append(lib.join(name, own))

# ---- pontos que o código usa ----
for i, (lx, lz) in enumerate(((0.5, 0.5), (SX - 0.5, 0.5), (0.5, SZ - 0.5), (SX - 0.5, SZ - 0.5), (SX / 2, 0.5), (SX / 2, SZ - 0.5))):
    lib.empty(f'leg_{i}', G(lx, 0.0, lz))
lib.empty('door_lamp', G(SX / 2, 3.22, SZ + 0.5))
lib.empty('antenna_lamp', G(SX - 0.55, TOP + 2.72, 0.55))
for i, (bx, bz) in enumerate(((0.5, 0.5), (SX - 0.5, 0.5), (0.5, SZ - 0.5), (SX - 0.5, SZ - 0.5))):
    lib.empty(f'beacon_{i}', G(bx, TOP + 0.5, bz))
lib.empty('sign', G(DOOR[1] + 1.55, 2.45, SZ + 0.02))

body = lib.join('habitat', parts)
glow = lib.join('lit_windows', lit)
lib.bake_ao(body, strength=0.55, distance=1.2)
print('TRIANGULOS', lib.stats([body, glow] + leaves), 'corpo', lib.stats([body]))
if prev:
    lib.preview(prev, target=(SX / 2, -SZ / 2, 2.6), dist=26, yaw=20, pitch=32)
    lib.preview(prev.replace('.png', '-porta.png'), target=(SX / 2, -SZ, 2.0), dist=8, yaw=10, pitch=15, size=480)
lib.export(out)
