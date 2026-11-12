# Interior do Habitat 01 (docs/design/MODELOS.md): piso, forro das paredes, porta de dentro e janelas. Os móveis e as
# estações são modelos à parte (furniture.py, workbench.py, furnace.py, electrolyzer.py), postos pelo código onde os
# dados mandam (data/base.ts). Só a câmera de dentro vê este modelo (render/indoors.ts).
# Cada parede sai em duas peças, porque o corte abaixa só a parte de cima das paredes viradas para a câmera:
#   wall_<lado>_lo  (y 1..2, sempre de pé)      wall_<lado>_hi  (y 2..4, abaixa; o pivô fica em y = 2)
# Peças acesas da mesma parede: lit_wall_<lado>_lo/hi; vidro: glow_wall_<lado>_hi. Lados: n, s, w, e.
# Coordenadas do jogo (lib.G), origem no canto noroeste de baixo do módulo, como o casco (habitat.py).
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

SX, SZ, H = lib.HAB['SX'], lib.HAB['SZ'], lib.HAB['H']
TOP = H + 1
D0, D1 = lib.HAB['DOOR_AT'], lib.HAB['DOOR_AT'] + 1
WIN_Z = (2.5, 4.5, 6.5)  # as mesmas janelas do casco

PANEL = '#dfe3ea'
PANEL2 = '#d2d7e0'
SEAM = '#aab0bd'
DARK = '#3d4252'
TOPC = '#5a6072'
METAL = '#8c90a0'
ORANGE = '#ff7a2f'
ICE = '#9fe8ff'
GLASS = '#1d2650'

# peças por grupo de saída: nome -> lista
groups = {}


def put(group, o):
    groups.setdefault(group, []).append(o)
    return o


def top_dark(f):
    return TOPC if f.normal.z > 0.8 else None


# ---- piso: placas alternadas, faixa escura até a porta e faixa de atenção ----
FX0, FX1, FZ0, FZ1 = 1, SX - 1, 1, SZ - 1
floor = lib.gbox('floor', FX0, 0.9, FZ0, FX1, 1.0, FZ1, '#b9bcc6', vary=0.0)
put('floor', floor)
for i in range(FX0, FX1):
    for k in range(FZ0, FZ1):
        c = '#bfc2cc' if (i + k) % 2 else '#b1b5c0'
        put('floor', lib.gbox('plate', i + 0.03, 1.0, k + 0.03, i + 0.97, 1.012, k + 0.97, c, vary=0.03, seed=i * 31 + k))
# passarela escura da porta até o meio
put('floor', lib.gbox('walk', D0 + 0.1, 1.012, SZ / 2 - 0.5, D1 - 0.1, 1.02, FZ1, '#5a6072', vary=0.03))
for i in range(5):
    x = D0 - 0.4 + i * 0.4
    put('floor', lib.gbox('hazard', x, 1.012, FZ1 - 0.32, x + 0.2, 1.022, FZ1 - 0.06, '#f2b233', vary=0.03))

# ---- paredes: caixa da célula de parede (o topo fica escuro, aparece quando a de cima abaixa) ----
SIDES = {
    'n': dict(along='x', a0=0, a1=SX, c0=0, inner=1, sgn=1),
    's': dict(along='x', a0=0, a1=SX, c0=SZ - 1, inner=SZ - 1, sgn=-1),
    'w': dict(along='z', a0=1, a1=SZ - 1, c0=0, inner=1, sgn=1),
    'e': dict(along='z', a0=1, a1=SZ - 1, c0=SX - 1, inner=SX - 1, sgn=-1),
}


def slab(group, side, s0, s1, y0, y1, depth0, depth1, color, vary=0.05, seed=1, fn=None, name='p'):
    """caixa colada na face de dentro da parede: de s0 a s1 ao longo dela, de depth0 a depth1 para dentro da sala"""
    d = SIDES[side]
    p0, p1 = d['inner'] + d['sgn'] * depth0, d['inner'] + d['sgn'] * depth1
    p0, p1 = min(p0, p1), max(p0, p1)
    if d['along'] == 'x':
        o = lib.gbox(name, s0, y0, p0, s1, y1, p1, color, vary=vary, seed=seed, fn=fn)
    else:
        o = lib.gbox(name, p0, y0, s0, p1, y1, s1, color, vary=vary, seed=seed, fn=fn)
    return put(group, o)


def cell(group, side, s0, s1, y0, y1, seed):
    """a própria célula da parede (do lado de fora até a face de dentro)"""
    d = SIDES[side]
    if d['along'] == 'x':
        o = lib.gbox('wall', s0, y0, d['c0'], s1, y1, d['c0'] + 1, PANEL, vary=0.04, seed=seed, fn=top_dark)
    else:
        o = lib.gbox('wall', d['c0'], y0, s0, d['c0'] + 1, y1, s1, PANEL, vary=0.04, seed=seed, fn=top_dark)
    return put(group, o)


SEEDS = {'n': 3, 's': 5, 'w': 7, 'e': 9}
for side, d in SIDES.items():
    lo, hi = f'wall_{side}_lo', f'wall_{side}_hi'
    a0, a1 = d['a0'], d['a1']
    # trecho visto de dentro (sem os cantos que as outras paredes cobrem)
    i0, i1 = (1, SX - 1) if d['along'] == 'x' else (1, SZ - 1)
    door = side == 's'
    spans = [(a0, D0), (D1, a1)] if door else [(a0, a1)]
    ispans = [(i0, D0), (D1, i1)] if door else [(i0, i1)]
    for (s0, s1) in spans:
        cell(lo, side, s0, s1, 1.0, 2.0, seed=SEEDS[side])
        cell(hi, side, s0, s1, 2.0, TOP, seed=SEEDS[side] + 1)
    if door:
        cell(hi, side, D0, D1, 3.0, TOP, seed=7)
    for (s0, s1) in ispans:
        # rodapé aceso, rodapé escuro, linha laranja
        slab(f'lit_{lo}', side, s0, s1, 1.0, 1.06, 0, 0.05, ICE, vary=0.03, name='strip')
        slab(lo, side, s0, s1, 1.06, 1.22, 0, 0.04, DARK, vary=0.03)
        slab(lo, side, s0, s1, 1.6, 1.66, 0, 0.02, ORANGE, vary=0.03)
        # luminária no alto
        slab(hi, side, s0 + 0.15, s1 - 0.15, TOP - 0.36, TOP - 0.2, 0, 0.12, DARK, vary=0.03)
        slab(f'lit_{hi}', side, s0 + 0.2, s1 - 0.2, TOP - 0.33, TOP - 0.24, 0.11, 0.13, ICE, vary=0.03, name='strip')
        # painéis: nervuras a cada bloco, faixas de painel mais escuro alternadas
        s = s0
        k = 0
        while s < s1 - 0.01:
            e = min(s + 1, s1)
            if k % 2:
                slab(hi, side, s + 0.04, e - 0.04, 2.0, TOP - 0.4, 0, 0.015, PANEL2, vary=0.03, seed=k)
                slab(lo, side, s + 0.04, e - 0.04, 1.22, 2.0, 0, 0.015, PANEL2, vary=0.03, seed=k)
            if s > s0:
                slab(hi, side, s - 0.04, s + 0.04, 2.0, TOP - 0.36, 0, 0.05, SEAM, vary=0.03)
                slab(lo, side, s - 0.04, s + 0.04, 1.22, 2.0, 0, 0.05, SEAM, vary=0.03)
            s = e
            k += 1

# ---- janelas leste e oeste (vidro escuro: lá fora é o espaço) ----
for side in ('w', 'e'):
    for z in WIN_Z:
        slab(f'wall_{side}_hi', side, z - 0.52, z + 0.52, 2.32, 3.18, 0, 0.07, DARK, vary=0.03, name='frame')
        slab(f'glow_wall_{side}_hi', side, z - 0.42, z + 0.42, 2.42, 3.08, 0.07, 0.08, GLASS, vary=0.06, name='glass')

# ---- parede norte: canos da ventilação e moldura da janela da Terra ----
for (y, r) in ((TOP - 0.62, 0.07), (TOP - 0.8, 0.05)):
    put('wall_n_hi', lib.grod('pipe', (1.2, y, 1 + 0.1 + r), (SX - 1.2, y, 1 + 0.1 + r), r, METAL, verts=6))
for x in (1.6, SX / 2, SX - 1.6):
    slab('wall_n_hi', 'n', x - 0.06, x + 0.06, TOP - 0.92, TOP - 0.5, 0, 0.26, DARK)
EX = SX - 3.0  # centro da janela da Terra (o código põe a imagem no ponto "earth")
slab('wall_n_hi', 'n', EX - 1.05, EX + 1.05, 2.0, 3.12, 0, 0.06, DARK, name='earth_frame')
lib.gempty('earth', EX, 2.56, 1.07)

# ---- parede oeste: grade de ventilação; leste: quadro elétrico ----
for i in range(5):
    slab('wall_w_hi', 'w', 6.2 + i * 0.12, 6.26 + i * 0.12, 2.1, 2.3, 0, 0.04, DARK)
slab('wall_e_hi', 'e', 1.3, 2.1, 2.05, 2.75, 0, 0.1, '#c3c7d2', name='panel')
slab('lit_wall_e_hi', 'e', 1.4, 1.55, 2.55, 2.62, 0.1, 0.11, '#7dff9a', name='led')
slab('lit_wall_e_hi', 'e', 1.65, 1.8, 2.55, 2.62, 0.1, 0.11, '#ffb347', name='led')

# ---- porta por dentro: batentes, verga e as folhas (peças à parte, o código abre) ----
IZ = SZ - 1  # face de dentro da parede sul
for (x0, x1) in ((D0 - 0.24, D0), (D1, D1 + 0.24)):
    put('wall_s_lo', lib.gbox('jamb', x0, 1.0, IZ - 0.1, x1, 2.0, IZ + 0.02, DARK, vary=0.03))
    put('wall_s_hi', lib.gbox('jamb', x0, 2.0, IZ - 0.1, x1, 3.24, IZ + 0.02, DARK, vary=0.03))
put('wall_s_hi', lib.gbox('head', D0 - 0.24, 3.0, IZ - 0.1, D1 + 0.24, 3.24, IZ + 0.02, DARK, vary=0.03))
for x in (D0 - 0.2, D1 + 0.06):
    for i in range(3):
        y = 1.3 + i * 0.55
        put('wall_s_hi' if y >= 2 else 'wall_s_lo', lib.gbox('hazard', x, y, IZ - 0.11, x + 0.14, y + 0.2, IZ - 0.09, '#f2b233', vary=0.03))
lib.gempty('door_in_lamp', (D0 + D1) / 2, 3.33, IZ - 0.06)
leaves = []
for (name, x0, x1, sx) in (('door_in_l', D0, D0 + 0.5, 1), ('door_in_r', D0 + 0.5, D1, -1)):
    own = [lib.gbox(name, x0 + 0.01, 1.0, SZ - 0.62, x1 - 0.01, 3.0, SZ - 0.38, '#c3c7d2', vary=0.04)]
    sx0 = x1 - 0.1 if sx > 0 else x0 + 0.04
    own.append(lib.gbox('stripe', sx0, 1.4, SZ - 0.64, sx0 + 0.06, 2.6, SZ - 0.36, ORANGE, vary=0.03))
    own.append(lib.gbox('window', x0 + 0.14, 2.3, SZ - 0.645, x1 - 0.14, 2.7, SZ - 0.355, GLASS, vary=0.03))
    leaves.append(lib.join(name, own))

# ---- juntar por grupo, assar a oclusão nas peças de corpo ----
made = []
for name, objs in groups.items():
    o = lib.join(name, objs)
    if name.startswith('wall') or name == 'floor':
        lib.bake_ao(o, strength=0.45, distance=0.8, samples=24, ground=False)
    made.append(o)
# as de cima giram em torno de y = 2 (o código só muda a escala em y)
for o in made:
    if o.name.endswith('_hi'):
        lib.set_origin(o, 0, 2.0, 0)
print('TRIANGULOS', lib.stats(made + leaves), 'pecas', sorted(o.name for o in made))
if prev:
    lib.preview(prev, target=(SX / 2, -SZ / 2, 1.5), dist=21, yaw=20, pitch=58)
lib.export(out)
