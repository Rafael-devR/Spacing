# Ajudantes dos scripts de modelos (docs/design/MODELOS.md). Rodam dentro do Blender sem janela:
#   blender -b -P tools/models/<modelo>.py -- <saída.glb> [prévia.png]
# Convenções: 1 unidade = 1 bloco; Z para cima no Blender (o glTF sai com Y para cima); o chão é z = 0.
# Cores são sRGB em hex, guardadas por canto de face ("Col"), para cada face ter a sua cor (estilo low poly facetado).
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector


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


def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_materials='NONE', export_vertex_color='ACTIVE',
        export_normals=True, export_texcoords=False, export_apply=True, export_yup=True,
    )


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
