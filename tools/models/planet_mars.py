# Marte voxel da tela de título (docs/design/TITULO.md): poeira vermelha, terras escuras, um cânion largo perto do equador, um
# vulcão enorme e as calotas polares brancas. Cor por vértice; o jogo põe a luz, a atmosfera fina e o fundo de estrelas.
import math
import os
import sys

from mathutils import noise, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

R = 15
CR = lib.craters(11, 7, 0.07, 0.18)
VOLCANO = Vector((0.55, -0.62, 0.3)).normalized()


def dark(d):
    return noise.noise(d * 2.1 + Vector((1.3, 4.2, 0.4)))


def canyon(d):
    """cânion: uma faixa torta perto do equador, de um lado do planeta"""
    lon = math.atan2(d.y, d.x)
    if not (-1.2 < lon < 0.6):
        return 0.0
    band = abs(d.z - 0.12 * math.sin(lon * 3))
    return max(0.0, 1 - band / 0.06)


def height(d):
    dh, _ = lib.crater_shape(d, CR, 0.8)
    v = max(0.0, 1 - math.acos(max(-1, min(1, d.dot(VOLCANO)))) / 0.32)
    return R + noise.noise(d * 2.2) * 0.55 + dh - canyon(d) * 1.4 + v * v * 2.4


def color(d, depth, vox):
    j = (hash(vox) % 9) / 9
    if abs(d.z) > 0.9 - 0.03 * noise.noise(d * 6):
        return ['#f2ede6', '#e6e0d8', '#fbf7f1'][int(j * 3)]
    if depth > 1.4:
        return '#5a2a1a'
    if canyon(d) > 0.2:
        return ['#7a3a22', '#843f25', '#6f341f'][int(j * 3)]
    v = math.acos(max(-1, min(1, d.dot(VOLCANO))))
    if v < 0.32:
        return ['#a5583a', '#b0603f', '#9a5034'][int(j * 3)] if v > 0.05 else '#5e2c1c'
    _, kind = lib.crater_shape(d, CR, 0.8)
    if kind == 1:
        return ['#d58a5a', '#de9666'][int(j * 2)]
    if dark(d) > 0.2:
        return ['#7d3b25', '#86412a', '#733522'][int(j * 3)]
    return ['#c0582f', '#cb6236', '#b4502b', '#d06d40'][int(j * 4)]


o = lib.voxel_planet('mars', R, height, color)
lib.stats([o])
lib.export(out)
if prev:
    o.location.z = R + 1
    lib.preview(prev, target=(0, 0, R + 1), dist=R * 4.2, pitch=12)
