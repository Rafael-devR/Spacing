# Ajudantes dos scripts de modelos (docs/design/MODELOS.md). Rodam dentro do Blender sem janela:
#   blender -b -P tools/models/<modelo>.py -- <saída.glb> [prévia.png]
# Convenções: 1 unidade = 1 bloco; Z para cima no Blender (o glTF sai com Y para cima); o chão é z = 0.
# Cores são sRGB em hex, guardadas por canto de face ("Col"), para cada face ter a sua cor (estilo low poly facetado).
import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise


def args():
    """argumentos depois de `--`: saída .glb e, opcional, a imagem de prévia"""
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return (a[0] if a else '/tmp/model.glb'), (a[1] if len(a) > 1 else None)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    return o


def apply_all(o):
    """aplica modificadores e transformações (rotação e escala) no objeto"""
    active(o)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def bevel(o, width=0.04, segments=1, angle=40):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    return apply_all(o)


def paint(o, color, vary=0.0, seed=1, fn=None):
    """Pinta cada face: `color` (hex) com brilho variando ±vary/2. `fn(face)` pode devolver outra cor (hex) por face."""
    me = o.data
    attr = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    rnd = random.Random(seed)
    for p in me.polygons:
        base = hex_rgb((fn(p) if fn else None) or color)
        f = 1 - vary / 2 + rnd.random() * vary
        c = tuple(min(1.0, ch * f) for ch in base) + (1.0,)
        for li in p.loop_indices:
            attr.data[li].color_srgb = c
    me.color_attributes.active_color = attr
    return o


def jitter(o, amount, seed=1, keep_z=False):
    """amassa a malha: cada vértice anda um pouco ao acaso (folha metálica, rocha)"""
    rnd = random.Random(seed)
    for v in o.data.vertices:
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0 if keep_z else rnd.uniform(-1, 1)))
        v.co += d * amount
    return o


def subdivide(o, cuts=1):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bm.to_mesh(o.data)
    bm.free()
    return o


def cyl(name, verts, r1, r2, depth, z, x=0.0, y=0.0, rot=None, cap=True):
    """cilindro ou tronco de cone com a base em z (não o centro)"""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=(x, y, z + depth / 2),
                                    end_fill_type='NGON' if cap else 'NOTHING')
    o = bpy.context.object
    o.name = name
    if rot:
        o.rotation_euler = rot
    return o


def cube(name, sx, sy, sz, x=0.0, y=0.0, z=0.0, rot=None):
    """caixa com a base em z"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    if rot:
        o.rotation_euler = rot
    return apply_all(o)


def rod(name, a, b, r, verts=6):
    """barra (cilindro) de `a` até `b`"""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return apply_all(o)


def empty(name, loc):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    return o


def join(name, objs):
    objs = [o for o in objs if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    return o


def bake_ao(o, strength=0.65, distance=1.2, samples=48, ground=True):
    """Assa oclusão ambiente nas cores dos vértices: cantos e encaixes ficam mais escuros. Multiplica a cor `Col`."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = distance
    floor = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
        floor = bpy.context.object
    me = o.data
    col = me.color_attributes['Col']
    ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = ao
    # o Cycles só assa em objetos com material
    if not me.materials:
        me.materials.append(bpy.data.materials.new('bake'))
    active(o)
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    for i in range(len(col.data)):
        a = ao.data[i].color[0]
        k = 1 - strength * (1 - a)
        c = col.data[i].color  # linear
        col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes['Col']
    me.materials.clear()
    if floor:
        bpy.data.objects.remove(floor)
    return o


def stats(objs):
    tris = 0
    for o in objs:
        if o.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return tris


def export(path, anim=False, normals=True):
    """`anim`: exporta a linha do tempo da cena como uma animação só (o jogo toca em laço). `normals=False`: sem normais (o
    jogo desenha facetado pela derivada da posição), e os vértices ficam compartilhados entre as faces: arquivo bem menor."""
    bpy.ops.object.select_all(action='DESELECT')
    extra = {'export_animation_mode': 'SCENE', 'export_force_sampling': True} if anim else {}
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_materials='NONE', export_vertex_color='ACTIVE',
        export_normals=normals, export_texcoords=False, export_apply=True, export_yup=True,
        export_animations=anim, **extra,
    )


# ---------- coordenadas do jogo ----------
# Modelos que encaixam em lugares do jogo (base, móveis, estações) pensam como o jogo: x, y para cima, z para o sul.
# Jogo (x, y, z) = Blender (x, -z, y).

# medidas do módulo da base (data/base.ts HAB_MODULE; render/baseModel.ts HABITAT_SHELL confere)
HAB = {'SX': 11, 'SZ': 9, 'H': 3, 'DOOR_AT': 5}


def G(x, y, z):
    return (x, -z, y)


def gbox(name, x0, y0, z0, x1, y1, z1, color, vary=0.08, bev=0.0, seed=1, fn=None):
    """caixa entre dois cantos, em coordenadas do jogo"""
    o = cube(name, x1 - x0, z1 - z0, y1 - y0, x=(x0 + x1) / 2, y=-(z0 + z1) / 2, z=y0)
    if bev:
        bevel(o, bev)
    return paint(o, color, vary=vary, seed=seed, fn=fn)


def gcyl(name, verts, r1, r2, h, x, y, z, color, vary=0.08, seed=1, cap=True, bev=0.0):
    """cilindro de pé com a base em (x, y, z) do jogo"""
    o = cyl(name, verts, r1, r2, h, y, x=x, y=-z, cap=cap)
    if bev:
        bevel(o, bev)
    else:
        apply_all(o)
    return paint(o, color, vary=vary, seed=seed)


def grod(name, a, b, r, color, verts=6, vary=0.06):
    return paint(rod(name, G(*a), G(*b), r, verts), color, vary=vary)


def gempty(name, x, y, z):
    return empty(name, G(x, y, z))


def set_origin(o, x, y, z):
    """muda a origem (pivô) do objeto para o ponto do jogo, sem mexer na malha"""
    sc = bpy.context.scene
    sc.cursor.location = G(x, y, z)
    active(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    sc.cursor.location = (0, 0, 0)
    return o


def parent(child, par):
    """pendura `child` em `par` sem mudar onde ele está"""
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()
    return child


# ---------- animação (laços que o jogo toca enquanto a máquina trabalha) ----------
FPS = 24


def timeline(frames):
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start = 0
    sc.frame_end = frames


def keys(o, path, frames_values):
    """quadros-chave lineares: [(quadro, valor), ...] em `path` ('location', 'rotation_euler', 'scale')"""
    for f, v in frames_values:
        setattr(o, path, v)
        o.keyframe_insert(data_path=path, frame=f)
    if o.animation_data and o.animation_data.action:
        act = o.animation_data.action
        curves = getattr(act, 'fcurves', None)
        if curves is None:  # Blender 4.4+: camadas e faixas
            curves = [c for layer in act.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]
        for c in curves:
            for k in c.keyframe_points:
                k.interpolation = 'LINEAR'
    return o


def preview(path, target=(0, 0, 1.8), dist=9.0, size=640, yaw=45.0, pitch=28.0):
    """Imagem de prévia com o Cycles em CPU, usando as cores dos vértices (só para olhar; não vai para o .glb)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.render.resolution_x = size
    sc.render.resolution_y = int(size * 0.75)
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.05, 0.09, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    mat = bpy.data.materials.new('prev')
    mat.use_nodes = True
    nt = mat.node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    added = []
    for o in sc.objects:
        if o.type == 'MESH' and not o.data.materials:
            o.data.materials.append(mat)
            added.append(o)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new('floor')
    fm.diffuse_color = (0.55, 0.52, 0.5, 1)
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.4, 0.38, 1)
    floor.data.materials.append(fm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    yw, pt = math.radians(yaw), math.radians(pitch)
    t = Vector(target)
    cam.location = t + Vector((math.sin(yw) * math.cos(pt), -math.cos(yw) * math.cos(pt), math.sin(pt))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    sc.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # desfaz o que era só da prévia
    for o in added:
        o.data.materials.clear()
    for o in (floor, cam, sun):
        bpy.data.objects.remove(o)


# ---------- planetas voxel (tela de título, docs/design/TITULO.md) ----------

def voxel_planet(name, radius, height, color, ao=0.22):
    """Planeta feito de cubos de 1 unidade, centrado na origem. `height(dir)` dá o raio da superfície na direção `dir`
    (Vector unitário); `color(dir, depth, voxel)` dá a cor hex de cada cubo (`depth` = quanto abaixo da superfície, em cubos).
    Só as faces que dão para fora entram na malha. Cada face escurece um pouco conforme os cubos em volta dela (oclusão
    simples, para o relevo aparecer sem sombra de luz). Devolve o objeto."""
    lim = int(radius * 1.35) + 2
    solid = {}
    for x in range(-lim, lim):
        for y in range(-lim, lim):
            for z in range(-lim, lim):
                c = Vector((x + 0.5, y + 0.5, z + 0.5))
                r = c.length
                if r > lim:
                    continue
                d = c.normalized()
                h = height(d)
                if r <= h:
                    solid[(x, y, z)] = (d, h - r)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = {}

    def vert(p):
        v = verts.get(p)
        if v is None:
            v = verts[p] = bm.verts.new(p)
        return v

    # as 6 faces de um cubo: direção do vizinho e os 4 cantos (em volta da face, sentido anti-horário visto de fora)
    faces = [
        ((1, 0, 0), [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]),
        ((-1, 0, 0), [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)]),
        ((0, 1, 0), [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)]),
        ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
        ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
        ((0, 0, -1), [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)]),
    ]
    cols = []
    for (x, y, z), (d, depth) in solid.items():
        base = hex_rgb(color(d, depth, (x, y, z)))
        for (nx, ny, nz), corners in faces:
            if (x + nx, y + ny, z + nz) in solid:
                continue
            # oclusão: quantos dos 8 cubos em volta da face (na camada de fora) estão ocupados
            occ = 0
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    if a == 0 and b == 0:
                        continue
                    if nx:
                        q = (x + nx, y + a, z + b)
                    elif ny:
                        q = (x + a, y + ny, z + b)
                    else:
                        q = (x + a, y + b, z + nz)
                    occ += q in solid
            k = 1 - ao * occ / 8
            f = bm.faces.new([vert((x + cx, y + cy, z + cz)) for cx, cy, cz in corners])
            cols.append((f, tuple(ch * k for ch in base) + (1.0,)))
    bm.to_mesh(me)
    bm.free()
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for p, (_, c) in zip(me.polygons, cols):
        for li in p.loop_indices:
            attr.data[li].color_srgb = c
    me.color_attributes.active_color = attr
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def craters(seed, n, rmin, rmax):
    """crateras sorteadas: (direção, raio angular)"""
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
        out.append((d, rnd.uniform(rmin, rmax)))
    return out


def crater_shape(d, list_, depth):
    """quanto as crateras mudam a altura (negativo no fundo, positivo na borda) e se o ponto é fundo (-1), borda (1) ou nada (0)"""
    dh, kind = 0.0, 0
    for c, r in list_:
        a = math.acos(max(-1.0, min(1.0, d.dot(c))))
        u = a / r
        if u < 1:
            dh -= depth * (0.8 + r * 4) * (1 - u * u)
            kind = -1
        elif u < 1.3:
            dh += depth * 0.7 * (1 - (u - 1) / 0.3)
            kind = kind or 1
    return dh, kind


# ---------- planetas low poly com blocos (tela de título, docs/design/TITULO.md) ----------
# O corpo é uma icosfera deslocada (facetas grandes, low poly) e por cima vão blocos: pedras, montes em degraus, gelo. Cor por
# vértice (POINT), para os vértices serem compartilhados e o arquivo ficar pequeno; o jogo desenha facetado.


def lowpoly_planet(name, radius, subdiv, height, color):
    """Icosfera de raio 1 deslocada: `height(dir)` dá o raio em cada direção; `color(dir, r)` dá a cor hex do vértice."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        v.co = d * height(d)
    bm.to_mesh(me)
    bm.free()
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for v in me.vertices:
        attr.data[v.index].color_srgb = hex_rgb(color(v.co.normalized(), v.co.length)) + (1.0,)
    me.color_attributes.active_color = attr
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def surface_blocks(name, blocks, shade=0.25):
    """Blocos em pé na superfície: cada um é (centro, aresta, direção para cima, giro em radianos, cor hex). Os quatro cantos
    de baixo escurecem (`shade`), o que dá volume sem sombra. Sem a face de baixo (fica enterrada)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    cols = []
    for c, s, up, yaw, hexc in blocks:
        q = up.to_track_quat('Z', 'Y')
        rot = q.to_matrix() @ Matrix.Rotation(yaw, 3, 'Z')
        h = s / 2
        vs = []
        for z in (-h, h):
            for x, y in ((-h, -h), (h, -h), (h, h), (-h, h)):
                vs.append(bm.verts.new(c + rot @ Vector((x, y, z))))
        base = hex_rgb(hexc)
        for i, v in enumerate(vs):
            k = 1 - shade if i < 4 else 1.0
            cols.append(tuple(ch * k for ch in base) + (1.0,))
        b0, b1, b2, b3, t0, t1, t2, t3 = vs
        bm.faces.new((t0, t1, t2, t3))
        for a, b, tb, ta in ((b0, b1, t1, t0), (b1, b2, t2, t1), (b2, b3, t3, t2), (b3, b0, t0, t3)):
            bm.faces.new((a, b, tb, ta))
    bm.to_mesh(me)
    bm.free()
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i, c in enumerate(cols):
        attr.data[i].color_srgb = c
    me.color_attributes.active_color = attr
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def fbm(p, octaves=4, lac=2.1, gain=0.5):
    """ruído fractal (-1..1, aproximado)"""
    s, a, f = 0.0, 1.0, 1.0
    for _ in range(octaves):
        s += noise.noise(p * f) * a
        f *= lac
        a *= gain
    return s


def tangent_basis(up):
    """dois vetores perpendiculares a `up`"""
    t = up.cross(Vector((0, 0, 1)) if abs(up.z) < 0.9 else Vector((1, 0, 0))).normalized()
    return t, up.cross(t)


def scatter_dir(rnd, center, ang):
    """direção sorteada dentro de um ângulo `ang` (radianos) em volta de `center`"""
    t, b = tangent_basis(center)
    a = rnd.uniform(0, math.tau)
    r = ang * math.sqrt(rnd.random())
    return (center * math.cos(r) + (t * math.cos(a) + b * math.sin(a)) * math.sin(r)).normalized()


def terraces(center, base, cube, layers, color, hole=0.0):
    """Monte em degraus feito de blocos alinhados numa grade no plano tangente: `layers` é a lista de raios (em unidades), do
    degrau de baixo para o de cima; cada degrau só põe blocos no anel que o de cima não cobre (o miolo não aparece).
    `base` é o raio da superfície no centro; `color(k, i)` dá a cor do bloco `i` do degrau `k`; `hole`: cratera no topo."""
    t, b = tangent_basis(center)
    out = []
    n = int(layers[0] / cube) + 1
    for k, rad in enumerate(layers):
        inner = layers[k + 1] - cube if k + 1 < len(layers) else hole
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                x, y = i * cube, j * cube
                r = math.hypot(x, y)
                if r > rad or r < inner:
                    continue
                # a superfície cai com a curvatura: o bloco desce junto
                drop = r * r / (2 * base)
                p = center * (base + (k + 0.35) * cube - drop) + t * x + b * y
                out.append((p, cube * 1.02, center, 0.0, color(k, i * 31 + j)))
    return out


def crater_ring(center, ang, height, cube, colors, rnd, gap=0.15):
    """Anel de blocos na borda de uma cratera (raio angular `ang`): um bloco a cada passo, alguns faltando, alguns dobrados."""
    t, b = tangent_basis(center)
    out = []
    n = int(math.tau * ang * 15 / cube)
    for i in range(n):
        if rnd.random() < gap:
            continue
        a = math.tau * i / n
        d = (center * math.cos(ang) + (t * math.cos(a) + b * math.sin(a)) * math.sin(ang)).normalized()
        s = cube * rnd.uniform(0.8, 1.15)
        col = rnd.choice(colors)
        out.append((d * (height(d) + s * 0.2), s, d, a, col))
        if rnd.random() < 0.25:
            out.append((d * (height(d) + s * 1.1), s * 0.75, d, a + 0.3, col))
    return out
