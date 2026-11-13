# Astronauta (docs/design/PERSONAGEM.md, ADR 0017), feito a partir das imagens do dono em docs/art/reference/personagem/:
# chibi voxel (blocos de cantos chanfrados), capacete grande quase quadrado com visor escuro e um brilho quadrado, fones laranja,
# traje branco com faixas escuras nos braços e nas pernas, luvas e botas escuras, alças e cinto escuros, placa laranja no
# peito, mochila branca. Um nó (vazio) por articulação, com o pivô no lugar da junta; as malhas daquela parte do corpo ficam
# penduradas nele. O código (render/astronaut.ts) monta o esqueleto a partir das posições dos nós e anima tudo por código
# (render/astronautAnim.ts): nada de animação no arquivo.
# Coordenadas do jogo (lib.G): pés em y = 0, frente para +z, altura 1.5 (a caixa de colisão do jogador).
# Nomes: `glow_*` visor (vidro escuro que brilha de leve), `fx_bit` (o código pinta).
# Pontos: `grip_r` (onde a luva direita segura um item), `holster` (a broca no cinto).
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

SUIT = '#ecebf2'
SUIT_SH = '#dddce6'
FRAME = '#f6f5fb'
DARK = '#2c2d3b'
DARK2 = '#414254'
GREY = '#5d5e70'
ORANGE = '#ff6a14'
ORANGE_D = '#e2560f'
VISOR = '#14151f'
SHINE = '#a9a8bb'

made = []


def rbox(name, x0, y0, z0, x1, y1, z1, color, bev=0.04, seg=1, vary=0.03, seed=1):
    """caixa chanfrada entre dois cantos (jogo)"""
    o = lib.gbox(name, x0, y0, z0, x1, y1, z1, color, vary=vary, seed=seed)
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = bev
    m.segments = seg
    lib.apply_all(o)
    return lib.paint(o, color, vary=vary, seed=seed)


def gy(o, p):
    """altura (y do jogo) do centro da face"""
    return (o.matrix_world @ p.center).z


def banded(name, r1, r2, y0, y1, x, z, color, bands=(), band_color=DARK, verts=8):
    """Membro octogonal de pé (de y0 a y1, uma face virada para a frente) com faixas escuras no mesmo cilindro: a malha é
    cortada nas bordas das faixas, então a faixa fica rente ao traje."""
    o = lib.cyl(name, verts, r1, r2, y1 - y0, y0, x=x, y=-z)
    o.rotation_euler = (0, 0, math.pi / verts)
    lib.apply_all(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for a, b in bands:
        for yb in (a, b):
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, yb - o.location.z), plane_no=(0, 0, 1))
    bm.to_mesh(o.data)
    bm.free()
    return lib.paint(o, color, vary=0.03, fn=lambda p: band_color if any(a < gy(o, p) < b for a, b in bands) else None)


def vbox(name, x0, y0, z0, x1, y1, z1, color, bands=(), band_color=DARK, bev=0.012):
    """Bloco (estilo voxel) com cantos levemente chanfrados e faixas escuras rentes: a malha é cortada nas bordas das faixas."""
    o = rbox(name, x0, y0, z0, x1, y1, z1, color, bev=bev)
    if bands:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for a, b in bands:
            for yb in (a, b):
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, yb - o.location.z), plane_no=(0, 0, 1))
        bm.to_mesh(o.data)
        bm.free()
        lib.paint(o, color, vary=0.03, fn=lambda p: band_color if any(a < gy(o, p) < b for a, b in bands) else None)
    return o


def limb(name, hw, y0, y1, x, z, color, bands=(), band_color=DARK, hd=None):
    """membro quadrado de pé (meia largura hw, meia profundidade hd), de y0 a y1"""
    hd = hw if hd is None else hd
    return vbox(name, x - hw, y0, z - hd, x + hw, y1, z + hd, color, bands=bands, band_color=band_color)


def lowball(name, r, x, y, z, color, sx=1.0, sy=1.0, sz=1.0, seg=8, rings=6):
    """esfera de poucas faces (junta de ombro, cotovelo, joelho)"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=lib.G(x, y, z))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)
    o.rotation_euler = (0, 0, math.pi / seg)
    lib.apply_all(o)
    return lib.paint(o, color, vary=0.03)


def keep_faces(o, test):
    """apaga as faces que não passam no teste"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    drop = [bm.faces[p.index] for p in o.data.polygons if not test(p)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    return o


def joint(name, x, y, z, parts, ao=True, extra=()):
    """um nó na junta (x, y, z) com as malhas daquela parte do corpo; `extra` são malhas e pontos que ficam separados"""
    root = lib.gempty(name, x, y, z)
    body = lib.join(f'body_{name}', parts) if parts else None
    if body and ao:
        lib.bake_ao(body, strength=0.35, distance=0.1, samples=12, ground=False)
    bpy.context.view_layer.update()
    for o in ([body] if body else []) + list(extra):
        lib.parent(o, root)
        made.append(o)
    print('PARTE', name, lib.stats(([body] if body else []) + list(extra)))
    return root


# Estilo voxel (o dono pediu "mais voxel", combinando com o mundo de blocos): tudo é bloco de canto levemente chanfrado.
# Proporções de chibi ("mais fofinho, mais cartoon"): a cabeça é quase metade da altura e mais larga que os ombros; corpo
# curto; braços e pernas curtos; luvas e botas grandes.

# ---------------- cabeça: capacete-bloco grande, visor fundo com moldura, fones laranja ----------------
HX, HY0, HY1, HZ = 0.39, 0.86, 1.5, 0.34   # meia largura, base, topo, meia profundidade
head = [rbox('helmet', -HX, HY0, -HZ, HX, HY1, HZ, SUIT, bev=0.07, seg=1, vary=0.02)]
# moldura clara um pouco saliente; o vidro escuro um tico mais para fora, com a borda clara aparecendo em volta
FX, FY0, FY1 = 0.32, 0.95, 1.42
head.append(rbox('frame', -FX, FY0, HZ - 0.1, FX, FY1, HZ + 0.025, FRAME, bev=0.03, vary=0.02))
VX, VY0, VY1 = 0.275, 0.99, 1.38
visor = rbox('glow_visor', -VX, VY0, HZ - 0.08, VX, VY1, HZ + 0.04, VISOR, bev=0.025, vary=0.04)
# brilhos no vidro: o quadrado do canto de cima (à direita de quem olha) e um menor ao lado
head.append(rbox('shine', 0.13, 1.26, HZ + 0.035, 0.205, 1.335, HZ + 0.05, SHINE, bev=0.006, vary=0.0))
head.append(rbox('shine2', 0.08, 1.29, HZ + 0.035, 0.11, 1.32, HZ + 0.048, SHINE, bev=0.004, vary=0.0))
# fones: blocos laranja dos dois lados, com um miolo mais escuro
for sx in (-1, 1):
    a, b = sorted((sx * (HX - 0.03), sx * (HX + 0.07)))
    head.append(rbox(f'ear_{sx}', a, 1.04, -0.13, b, 1.32, 0.13, ORANGE, bev=0.025, vary=0.03))
    a, b = sorted((sx * (HX + 0.06), sx * (HX + 0.08)))
    head.append(rbox(f'earc_{sx}', a, 1.12, -0.06, b, 1.24, 0.06, ORANGE_D, bev=0.008, vary=0.03))
joint('head', 0, 0.86, 0, head, extra=[visor])

# ---------------- gola escura entre o capacete e o tronco ----------------
collar = rbox('collar', -0.19, 0.8, -0.15, 0.19, 0.89, 0.15, DARK, bev=0.015)

# ---------------- tronco: bloco, placa laranja, alças e cinto escuros ----------------
torso = [
    rbox('chest', -0.215, 0.49, -0.16, 0.215, 0.83, 0.16, SUIT, bev=0.03),
    rbox('badge', -0.085, 0.65, 0.14, 0.085, 0.745, 0.185, ORANGE, bev=0.015),
    collar,
]
for sx in (-1, 1):
    a, b = sorted((sx * 0.125, sx * 0.165))
    torso.append(rbox(f'strap_{sx}', a, 0.52, 0.13, b, 0.82, 0.172, DARK, bev=0.008))
    torso.append(rbox(f'strapb_{sx}', a, 0.58, -0.172, b, 0.82, -0.13, DARK, bev=0.008))
joint('torso', 0, 0.49, 0, torso)

# ---------------- quadril: calção, cinto com fivela cinza ----------------
joint('pelvis', 0, 0.45, 0, [
    rbox('hips', -0.2, 0.33, -0.15, 0.2, 0.51, 0.15, SUIT_SH, bev=0.03),
    rbox('belt', -0.225, 0.46, -0.17, 0.225, 0.54, 0.17, DARK, bev=0.015),
    rbox('buckle', -0.06, 0.47, 0.16, 0.06, 0.53, 0.183, GREY, bev=0.01),
], extra=[lib.gempty('holster', -0.25, 0.46, 0.02)])

# ---------------- mochila: bloco branco, quadrado cinza, faixa escura embaixo, alças nos lados ----------------
joint('pack', 0, 0.8, -0.17, [
    rbox('pack_box', -0.19, 0.5, -0.36, 0.19, 0.87, -0.14, SUIT, bev=0.035),
    rbox('pack_band', -0.195, 0.5, -0.365, 0.195, 0.58, -0.135, GREY, bev=0.02),
    rbox('pack_patch', -0.07, 0.65, -0.378, 0.07, 0.78, -0.35, DARK2, bev=0.012),
    rbox('pack_side_l', -0.205, 0.63, -0.29, -0.185, 0.78, -0.21, DARK, bev=0.006),
    rbox('pack_side_r', 0.185, 0.63, -0.29, 0.205, 0.78, -0.21, DARK, bev=0.006),
])

# ---------------- braços: blocos que afinam do ombro ao pulso, placa laranja, faixas escuras, luva ----------------
# Cada bloco entra um pouco no de cima: ao dobrar o cotovelo ou o joelho a junta não abre buraco.
SH = 0.77  # altura do ombro
for side, sx in (('l', -1), ('r', 1)):
    x = 0.29 * sx
    a, b = sorted((x - 0.005 * sx, x + 0.09 * sx))
    joint(f'arm_{side}', x, SH, 0, [
        limb(f'upper_{side}', 0.08, 0.62, SH + 0.03, x, 0, SUIT, bands=[(0.665, 0.705)]),
        rbox(f'pad_{side}', a, 0.735, -0.07, b, 0.81, 0.07, ORANGE, bev=0.012),
    ])
    joint(f'fore_{side}', x, 0.64, 0, [
        limb(f'lower_{side}', 0.068, 0.52, 0.665, x, 0, SUIT, bands=[(0.555, 0.59)]),
        limb(f'cuff_{side}', 0.074, 0.495, 0.535, x, 0, DARK),
    ])
    t0, t1 = sorted((x - 0.04 * sx, x - 0.088 * sx))
    hand = [
        rbox(f'mitt_{side}', x - 0.06, 0.37, -0.065, x + 0.06, 0.5, 0.07, DARK, bev=0.02),
        rbox(f'thumb_{side}', t0, 0.42, 0.0, t1, 0.48, 0.065, DARK2, bev=0.012),
    ]
    extra = [lib.gempty('grip_r', x, 0.42, 0.02)] if side == 'r' else []
    joint(f'hand_{side}', x, 0.5, 0, hand, extra=extra)

# ---------------- pernas: blocos com duas faixas escuras, bota grandona ----------------
for side, sx in (('l', -1), ('r', 1)):
    x = 0.105 * sx
    joint(f'leg_{side}', x, 0.4, 0, [
        limb(f'thigh_{side}', 0.098, 0.26, 0.43, x, 0, SUIT, bands=[(0.31, 0.345)]),
    ])
    joint(f'shin_{side}', x, 0.27, 0, [
        limb(f'calf_{side}', 0.09, 0.13, 0.29, x, 0, SUIT, bands=[(0.18, 0.215)]),
    ])
    joint(f'foot_{side}', x, 0.13, 0, [
        rbox(f'boot_{side}', x - 0.11, 0.025, -0.12, x + 0.11, 0.17, 0.11, DARK, bev=0.025),
        rbox(f'toe_{side}', x - 0.105, 0.025, -0.02, x + 0.105, 0.12, 0.19, DARK, bev=0.025),
        rbox(f'sole_{side}', x - 0.115, 0.0, -0.125, x + 0.115, 0.035, 0.195, DARK2, bev=0.01),
    ])

# ---------------- broca de mão (na luva ao minerar; no cinto no resto do tempo). Pivô na empunhadura. ----------------
joint('drill', 0, 0, 0, [
    rbox('d_grip', -0.035, -0.08, -0.04, 0.035, 0.05, 0.04, DARK, bev=0.015),
    rbox('d_body', -0.06, 0.02, -0.07, 0.06, 0.125, 0.17, GREY, bev=0.03),
    rbox('d_stripe', -0.062, 0.055, -0.02, 0.062, 0.085, 0.12, ORANGE, bev=0.01),
    rbox('d_chuck', -0.04, 0.032, 0.16, 0.04, 0.112, 0.23, '#9aa0ad', bev=0.008),
], extra=[lib.paint(lib.rod('fx_bit', lib.G(0, 0.072, 0.23), lib.G(0, 0.072, 0.4), 0.035, verts=4), '#ffb03a')])

print('TRIANGULOS', lib.stats(made))
if prev:
    bpy.context.view_layer.update()
    lib.preview(prev, target=lib.G(0, 0.75, 0), dist=4.0, yaw=0, pitch=6, size=800)
    for tag, yaw in (('_34', 35), ('_lado', 90), ('_costas', 200)):
        lib.preview(prev.replace('.png', tag + '.png'), target=lib.G(0, 0.75, 0), dist=4.0, yaw=yaw, pitch=8, size=600)
lib.export(out)
