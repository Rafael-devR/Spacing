# Rochas dos meteoros em voo (docs/design/METEOROS.md). Três formas para não ficarem todos iguais: o código sorteia uma
# (nós "rock_a", "rock_b", "rock_c", cada um em volta do próprio centro) e a gira enquanto cai.
# Cada rocha tem o corpo escuro ("body_<x>", cor por vértice com oclusão) e manchas de brasa por cima ("lit_<x>", acesas de
# verdade: cor acima de 1 no jogo, o bloom pega). Diâmetro de cerca de 1 bloco; o código escala pelo tamanho do meteoro.
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

out, prev = lib.args()
lib.reset()

CRUST = ['#2b2630', '#352f3a', '#3f3843', '#241f29']
EMBER = ['#ff8a2a', '#ffb347', '#ff6a1f', '#ffd27a']
made = []
UP = 0.6  # só para a prévia não enterrar a rocha no chão (o jogo ignora a posição do nó)


def rock(name, ox, seed, squash):
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.5, location=(ox, 0, UP))
    body = bpy.context.object
    body.name = f'body_{name}'
    body.scale = squash
    lib.apply_all(body)
    # amassada: cada vértice anda um pouco para dentro ou para fora, e algumas "mordidas" tiram pedaços
    for v in body.data.vertices:
        v.co *= 0.80 + rnd.random() * 0.4
    for _ in range(3):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
        for v in body.data.vertices:
            k = v.co.normalized().dot(d)
            if k > 0.72:
                v.co *= 1 - (k - 0.72) * 0.55
    body.data.update()
    lib.paint(body, CRUST[0], vary=0.45, seed=seed, fn=lambda p: CRUST[(p.index * 7 + seed) % len(CRUST)])

    # brasas: faces perto de alguns pontos viram manchas acesas, um pouco acima da rocha
    centers = [Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized() * 0.5 for _ in range(3)]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    chosen = [f for f in bm.faces if min((f.calc_center_median() - c).length for c in centers) < 0.3 and rnd.random() > 0.2]
    lb = bmesh.new()
    for f in chosen:
        lb.faces.new([lb.verts.new(v.co + f.normal * 0.03) for v in f.verts])
    bm.free()
    me = bpy.data.meshes.new(f'lit_{name}')
    lb.to_mesh(me)
    lb.free()
    lit = bpy.data.objects.new(f'lit_{name}', me)
    lit.location = (ox, 0, UP)
    bpy.context.scene.collection.objects.link(lit)
    lib.paint(lit, EMBER[0], vary=0.3, seed=seed + 5, fn=lambda p: EMBER[(p.index * 3 + seed) % len(EMBER)])

    lib.bake_ao(body, strength=0.55, distance=0.4, samples=32, ground=False)
    root = lib.gempty(f'rock_{name}', ox, UP, 0)
    bpy.context.view_layer.update()  # a matriz do pai só existe depois disto (lib.parent a usa)
    for o in (body, lit):
        lib.parent(o, root)
        made.append(o)


rock('a', 0, 11, (1.0, 0.85, 0.8))
rock('b', 2, 23, (0.8, 1.0, 0.9))
rock('c', 4, 37, (0.95, 0.9, 1.0))

print('TRIANGULOS', lib.stats(made))
if prev:
    lib.preview(prev, target=(2, 0, 0), dist=6, yaw=0, pitch=20, size=900)
lib.export(out)
