# Astronauta (docs/design/PERSONAGEM.md): chibi fofinho, capacete grande e visor escuro. Um nó (vazio) por articulação, com o
# pivô no lugar da junta; as malhas daquela parte do corpo ficam penduradas nele. O código (render/astronaut.ts) monta o
# esqueleto a partir das posições dos nós e anima tudo por código (render/astronautAnim.ts): nada de animação no arquivo.
# Coordenadas do jogo (lib.G): pés em y = 0, frente para +z, altura ~1.5 (a caixa de colisão do jogador).
# Nomes: `glow_*` visor (vidro escuro que brilha de leve), `lit_*` luzes acesas, `fx_beacon` e `fx_bit` (o código pinta).
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

SUIT = '#f4f2ec'
SUIT_SH = '#dedcd5'
ORANGE = '#ff7a2f'
ORANGE_D = '#e2601c'
DARK = '#4a5163'
DARKER = '#30353f'
VISOR = '#1b2238'
GOLD = '#e8b04a'
GLOVE = '#e6e8ee'
BOOT = '#5b6274'
SOLE = '#363b47'
WHITE = '#ffffff'

made = []
roots = []


def ball(name, r, x, y, z, color, sx=1.0, sy=1.0, sz=1.0, seg=12, rings=8, vary=0.05, seed=1):
    """esfera achatada/esticada com o centro em (x, y, z) do jogo"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=lib.G(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)  # Blender: x, y (= -z do jogo), z (= y do jogo)
    lib.apply_all(o)
    return lib.paint(o, color, vary=vary, seed=seed)


def tube(name, r1, r2, y0, y1, x, z, color, verts=10, bev=0.0, vary=0.05):
    """cilindro de pé, de y0 a y1"""
    return lib.gcyl(name, verts, r1, r2, y1 - y0, x, y0, z, color, vary=vary, bev=bev)


def rbox(name, x0, y0, z0, x1, y1, z1, color, bev=0.04, vary=0.05, seed=1):
    o = lib.gbox(name, x0, y0, z0, x1, y1, z1, color, vary=vary, seed=seed)
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = bev
    m.segments = 2 if bev >= 0.05 else 1
    lib.apply_all(o)
    return lib.paint(o, color, vary=vary, seed=seed)


def ring(name, r, thick, x, y, z, color, axis='y', seg=14):
    """anel (toro) deitado; `axis` = eixo do jogo que atravessa o furo"""
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=5, major_radius=r, minor_radius=thick, location=lib.G(x, y, z))
    o = bpy.context.object
    o.name = name
    if axis == 'z':
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'x':
        o.rotation_euler = (0, math.pi / 2, 0)
    lib.apply_all(o)
    return lib.paint(o, color, vary=0.04)


def joint(name, x, y, z, parts, ao=True, extra=()):
    """um nó na junta (x, y, z) com as malhas daquela parte do corpo; `extra` são malhas que ficam separadas (luzes)"""
    root = lib.gempty(name, x, y, z)
    body = lib.join(f'body_{name}', parts) if parts else None
    if body and ao:
        lib.bake_ao(body, strength=0.45, distance=0.12, samples=12, ground=False)
    bpy.context.view_layer.update()
    for o in ([body] if body else []) + list(extra):
        lib.parent(o, root)
        made.append(o)
    roots.append(root)
    print('PARTE', name, lib.stats(([body] if body else []) + list(extra)))
    return root


# ---------------- cabeça: capacete grande, visor escuro com brilhos e moldura dourada ----------------
HY = 1.2  # centro do capacete
head = [
    ball('helmet', 0.34, 0, HY, 0, SUIT, sx=1.06, sy=0.96, sz=1.0, seg=16, rings=10, vary=0.03),
    ring('neck', 0.2, 0.045, 0, 0.92, 0, DARK, axis='y', seg=16),
    # fones laterais (redondinhos, laranja) e a luz de capacete
    lib.gcyl('ear_l', 12, 0.1, 0.09, 0.07, 0, 0, 0, ORANGE),
    lib.gcyl('ear_r', 12, 0.1, 0.09, 0.07, 0, 0, 0, ORANGE),
    ball('lamp_case', 0.06, 0.17, HY + 0.27, 0.17, DARK, sz=1.2, seg=8, rings=6),
]
# fones: cilindros deitados no eixo x, nos dois lados do capacete
for o, sx in ((head[2], -1), (head[3], 1)):
    o.rotation_euler = (0, math.pi / 2 * sx, 0)
    lib.apply_all(o)
    o.location = lib.G(sx * 0.345, HY - 0.02, 0)
    lib.apply_all(o)
    bpy.context.view_layer.update()
# o visor é uma esfera mais à frente que fura o capacete: o contorno do furo é um oval largo. As faces do visor logo na saída
# do capacete viram a moldura dourada (malha do corpo); o resto é o vidro escuro.
VZ = 0.075


def helmet_dist(o, p):
    """quão fora do capacete (elipsoide) está o centro da face: 1 = na casca"""
    c = o.matrix_world @ p.center
    x, y, z = c.x, c.z, -c.y  # Blender -> jogo
    return math.sqrt((x / (0.34 * 1.06)) ** 2 + ((y - HY) / (0.34 * 0.96)) ** 2 + (z / 0.34) ** 2)


def keep_faces(o, test):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    me = o.data
    drop = [bm.faces[p.index] for p in me.polygons if not test(p)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return o


EDGE = 1.018
visor = ball('glow_visor', 0.3, 0, HY - 0.02, VZ, VISOR, sy=0.78, seg=22, rings=14, vary=0.06)
rim = ball('rim', 0.3, 0, HY - 0.02, VZ, GOLD, sy=0.78, seg=22, rings=14, vary=0.03)
keep_faces(rim, lambda p: helmet_dist(rim, p) < EDGE and (rim.matrix_world @ p.center).y < -0.05)
keep_faces(visor, lambda p: helmet_dist(visor, p) >= EDGE)
head.append(rim)
shine = [
    ball('lit_shine_a', 0.05, -0.11, HY + 0.05, 0.345, WHITE, sx=1.6, sy=0.65, sz=0.35, seg=8, rings=5),
    ball('lit_shine_b', 0.024, -0.025, HY + 0.095, 0.345, WHITE, sz=0.45, seg=6, rings=4),
]
shine[0].rotation_euler = (0, -0.45, 0)
lamp = ball('lit_lamp', 0.035, 0.17, HY + 0.27, 0.235, '#fff3c8', seg=8, rings=5)
joint('head', 0, 0.94, 0, head, extra=[visor, lib.join('lit_shine', shine), lamp])

# ---------------- tronco: peito arredondado, painel com botões, faixas laranja ----------------
torso = [
    rbox('chest', -0.23, 0.5, -0.17, 0.23, 0.93, 0.17, SUIT, bev=0.1),
    rbox('panel', -0.12, 0.64, 0.15, 0.12, 0.82, 0.2, DARK, bev=0.025),
    rbox('stripe_l', -0.235, 0.78, -0.12, -0.17, 0.84, 0.175, ORANGE, bev=0.015),
    rbox('stripe_r', 0.17, 0.78, -0.12, 0.235, 0.84, 0.175, ORANGE, bev=0.015),
    ball('badge', 0.04, -0.16, 0.86, 0.17, ORANGE, sz=0.4, seg=8, rings=6),
]
buttons = [
    ball('b1', 0.022, -0.07, 0.7, 0.205, '#57e389', sz=0.6, seg=8, rings=5),
    ball('b2', 0.022, 0.0, 0.7, 0.205, '#ffd34a', sz=0.6, seg=8, rings=5),
    ball('b3', 0.022, 0.07, 0.7, 0.205, '#ff5a4a', sz=0.6, seg=8, rings=5),
    rbox('screen', -0.085, 0.745, 0.195, 0.085, 0.79, 0.21, '#6fd8ff', bev=0.006),
]
joint('torso', 0, 0.5, 0, torso, extra=[lib.join('lit_panel', buttons)])

# ---------------- quadril: cinto e calção ----------------
joint('pelvis', 0, 0.47, 0, [
    rbox('hips', -0.2, 0.36, -0.14, 0.2, 0.52, 0.14, SUIT_SH, bev=0.07),
    rbox('belt', -0.215, 0.46, -0.155, 0.215, 0.53, 0.155, DARK, bev=0.025),
    rbox('buckle', -0.05, 0.465, 0.15, 0.05, 0.525, 0.17, GOLD, bev=0.01),
    rbox('pouch', -0.22, 0.4, -0.06, -0.19, 0.5, 0.07, DARKER, bev=0.012),
])

# ---------------- mochila (balança atrasada): tanques laranja, saída de ar ----------------
joint('pack', 0, 0.9, -0.17, [
    rbox('pack_box', -0.2, 0.55, -0.36, 0.2, 0.97, -0.15, '#d3d7e0', bev=0.06),
    tube('tank_l', 0.065, 0.065, 0.6, 0.94, -0.105, -0.37, ORANGE, verts=10),
    tube('tank_r', 0.065, 0.065, 0.6, 0.94, 0.105, -0.37, ORANGE, verts=10),
    ball('cap_l', 0.065, -0.105, 0.94, -0.37, ORANGE_D, sy=0.6, seg=10, rings=5),
    ball('cap_r', 0.065, 0.105, 0.94, -0.37, ORANGE_D, sy=0.6, seg=10, rings=5),
    rbox('vent', -0.1, 0.58, -0.39, 0.1, 0.64, -0.33, DARKER, bev=0.012),
])

# ---------------- antena com a luz que pisca (mola própria) ----------------
joint('antenna', 0.13, 0.96, -0.27, [
    tube('mast', 0.014, 0.01, 0.96, 1.26, 0.13, -0.27, DARK, verts=6),
    tube('mast_base', 0.035, 0.035, 0.94, 0.99, 0.13, -0.27, DARKER, verts=8),
], ao=False, extra=[ball('fx_beacon', 0.04, 0.13, 1.29, -0.27, '#ff3b30', seg=8, rings=6)])

# ---------------- braços: ombro, antebraço com punho laranja, luva ----------------
for side, sx in (('l', -1), ('r', 1)):
    x = 0.29 * sx
    joint(f'arm_{side}', x, 0.86, 0, [
        ball(f'shoulder_{side}', 0.1, x, 0.86, 0, SUIT, seg=12, rings=8),
        tube(f'upper_{side}', 0.078, 0.072, 0.68, 0.86, x, 0, SUIT, verts=10),
        ball(f'pad_{side}', 0.085, x + 0.012 * sx, 0.885, 0, ORANGE, sx=1.0, sy=0.55, sz=1.05, seg=12, rings=6),
    ])
    joint(f'fore_{side}', x, 0.68, 0, [
        ball(f'elbow_{side}', 0.074, x, 0.68, 0, SUIT_SH, seg=10, rings=6),
        tube(f'lower_{side}', 0.072, 0.07, 0.54, 0.68, x, 0, SUIT, verts=10),
        ring(f'cuff_{side}', 0.072, 0.024, x, 0.545, 0, ORANGE, axis='y', seg=12),
    ])
    hand = [
        ball(f'mitt_{side}', 0.072, x, 0.47, 0.005, GLOVE, sx=0.8, sy=1.05, sz=1.0, seg=10, rings=7),
        ball(f'thumb_{side}', 0.032, x - 0.035 * sx, 0.49, 0.05, GLOVE, seg=8, rings=5),
    ]
    extra = [lib.gempty('grip_r', x, 0.455, 0.035)] if side == 'r' else []
    joint(f'hand_{side}', x, 0.53, 0, hand, extra=extra)

# ---------------- pernas: coxa, canela com joelheira, bota ----------------
for side, sx in (('l', -1), ('r', 1)):
    x = 0.115 * sx
    joint(f'leg_{side}', x, 0.44, 0, [
        tube(f'thigh_{side}', 0.1, 0.092, 0.27, 0.45, x, 0, SUIT, verts=10),
    ])
    joint(f'shin_{side}', x, 0.27, 0, [
        ball(f'knee_{side}', 0.088, x, 0.27, 0.01, SUIT_SH, seg=10, rings=6),
        ball(f'kneepad_{side}', 0.06, x, 0.27, 0.075, ORANGE, sz=0.5, seg=10, rings=6),
        tube(f'calf_{side}', 0.09, 0.085, 0.12, 0.27, x, 0, SUIT, verts=10),
    ])
    joint(f'foot_{side}', x, 0.12, 0, [
        rbox(f'boot_{side}', x - 0.095, 0.03, -0.1, x + 0.095, 0.17, 0.13, BOOT, bev=0.05),
        rbox(f'toe_{side}', x - 0.088, 0.03, 0.04, x + 0.088, 0.12, 0.16, '#c9ccd4', bev=0.04),
        rbox(f'sole_{side}', x - 0.1, 0.0, -0.105, x + 0.1, 0.04, 0.165, SOLE, bev=0.015),
    ])

# ---------------- broca de mão (na luva ao minerar; no cinto no resto do tempo). Pivô na empunhadura. ----------------
joint('drill', 0, 0, 0, [
    rbox('d_grip', -0.035, -0.08, -0.04, 0.035, 0.05, 0.04, DARKER, bev=0.012),
    rbox('d_body', -0.06, 0.02, -0.07, 0.06, 0.12, 0.17, DARK, bev=0.025),
    rbox('d_stripe', -0.062, 0.055, -0.02, 0.062, 0.085, 0.12, ORANGE, bev=0.008),
    rbox('d_chuck', -0.04, 0.03, 0.17, 0.04, 0.11, 0.22, '#9aa0ad', bev=0.012),
], extra=[lib.paint(lib.rod('fx_bit', lib.G(0, 0.07, 0.22), lib.G(0, 0.07, 0.4), 0.035, verts=6), '#ffb03a')])

print('TRIANGULOS', lib.stats(made))
if prev:
    bpy.context.view_layer.update()
    lib.preview(prev, target=lib.G(0, 0.75, 0), dist=4.2, yaw=12, pitch=10, size=900)
lib.export(out)
