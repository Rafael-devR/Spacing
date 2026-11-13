# Lua voxel da tela de título (docs/design/TITULO.md): esfera de cubos com mares escuros (basalto), terras altas claras e crateras
# com borda clara e fundo escuro, algumas com raios. Cor por vértice; o jogo põe a luz (sol de lado) e o fundo de estrelas.
import os
import random
import sys

from mathutils import noise, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

R = 15
CR = lib.craters(7, 16, 0.09, 0.3)
rnd = random.Random(3)


def mare(d):
    """mares: manchas grandes e escuras (ruído de baixa frequência)"""
    return noise.noise(d * 1.6 + Vector((3.1, 0.7, 2.2)))


def height(d):
    dh, _ = lib.crater_shape(d, CR, 1.0)
    return R + noise.noise(d * 2.4) * 0.45 - (0.5 if mare(d) > 0.18 else 0) + dh


def color(d, depth, v):
    _, kind = lib.crater_shape(d, CR, 1.0)
    j = (hash(v) % 7) / 7
    if depth > 1.4:
        return '#4c4a4a'
    if kind == -1:
        return ['#6f6c69', '#77736f', '#686562'][int(j * 3)]
    if kind == 1:
        return ['#d8d3ca', '#e2ddd3', '#cfcac0'][int(j * 3)]
    if mare(d) > 0.18:
        return ['#5f5c5b', '#66625f', '#585554', '#6b6764'][int(j * 4)]
    return ['#b3aea6', '#bdb8af', '#a9a49c', '#c4bfb6'][int(j * 4)]


o = lib.voxel_planet('moon', R, height, color)
lib.stats([o])
lib.export(out)
if prev:
    o.location.z = R + 1
    lib.preview(prev, target=(0, 0, R + 1), dist=R * 4.2, pitch=12)
