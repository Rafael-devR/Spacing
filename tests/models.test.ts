import { describe, expect, it } from 'vitest';
import { Group, Object3D, Mesh, BufferGeometry, MeshBasicMaterial } from 'three';
import { createLander } from '../src/render/models';

/** os .glb do jogo, como data URL (sem depender das APIs do Node) */
const GLBS = import.meta.glob('../src/assets/models/*.glb', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;

/** orçamento de triângulos por modelo (docs/design/MODELOS.md): o celular já desenha o terreno e a sombra */
const BUDGET: Record<string, number> = { lander: 3000 };
/** pontos que o código procura em cada modelo */
const MARKERS: Record<string, string[]> = { lander: ['lamp_0', 'lamp_1', 'lamp_2', 'beam'] };

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[] }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { count: number }[];
  materials?: unknown[];
}

/** só o JSON do .glb (o primeiro bloco depois do cabeçalho) */
function readGlb(dataUrl: string): Gltf {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const view = new DataView(b.buffer);
  const text = (from: number, to: number): string => new TextDecoder().decode(b.subarray(from, to));
  expect(text(0, 4)).toBe('glTF');
  const len = view.getUint32(12, true);
  expect(text(16, 20)).toBe('JSON');
  return JSON.parse(text(20, 20 + len)) as Gltf;
}

const files = Object.keys(GLBS).map((p) => p.slice(p.lastIndexOf('/') + 1));
const fileOf = (f: string): string => GLBS[Object.keys(GLBS).find((p) => p.endsWith('/' + f)) as string];

describe('modelos do Blender', () => {
  it('todo modelo tem orçamento e marcadores conhecidos', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(Object.keys(BUDGET), f).toContain(f.replace('.glb', ''));
  });

  it.each(files)('%s: dentro do orçamento, com cor por vértice, sem materiais e com os pontos marcados', (f) => {
    const id = f.replace('.glb', '');
    const g = readGlb(fileOf(f));
    let tris = 0;
    for (const m of g.meshes)
      for (const p of m.primitives) {
        tris += (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
        expect(p.attributes.COLOR_0, `${id}: ${m.name} sem cor por vértice`).toBeDefined();
        expect(p.attributes.NORMAL).toBeDefined();
      }
    expect(tris).toBeLessThanOrEqual(BUDGET[id]);
    expect(g.materials ?? []).toHaveLength(0);
    const names = g.nodes.map((n) => n.name);
    for (const k of MARKERS[id]) expect(names, `${id}: falta o ponto ${k}`).toContain(k);
  });
});

describe('módulo de pouso', () => {
  it('com o modelo do Blender, as luzes e o feixe vão para os pontos marcados', () => {
    const body = new Group();
    body.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
    for (let i = 0; i < 3; i++) {
      const o = new Object3D();
      o.name = `lamp_${i}`;
      o.position.set(i, 3, i * 2);
      body.add(o);
    }
    const tip = new Object3D();
    tip.name = 'beam';
    tip.position.set(0.3, 4.1, 0);
    body.add(tip);
    const l = createLander(body);
    expect(l.group.children).toContain(body);
    const lamps = l.group.children.filter((c) => (c as Mesh).geometry?.type === 'OctahedronGeometry');
    expect(lamps.map((c) => c.position.toArray())).toEqual([[0, 3, 0], [1, 3, 2], [2, 3, 4]]);
    const beam = l.group.children.find((c) => (c as Mesh).geometry?.type === 'CylinderGeometry')!;
    expect(beam.position.toArray()).toEqual([0.3, 24.1, 0]);
  });

  it('sem o modelo (não carregou), monta o corpo em código', () => {
    const l = createLander(null);
    expect(l.group.children.length).toBeGreaterThan(20);
    l.setRepaired(true);
    l.update(1);
  });
});
