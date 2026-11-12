import { Group, Line, Mesh, Points, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { originOf } from '../src/bench/actions';
import { countVisible } from '../src/bench/runner';
import { BENCH_SCENARIOS } from '../src/data/bench';
import { AIR } from '../src/data/blocks';
import { createMaterials } from '../src/render/materials';
import { PropFactory } from '../src/render/models';
import { World } from '../src/world/World';

describe('contagem de objetos da cena', () => {
  it('conta só os objetos desenháveis e visíveis', () => {
    const scene = new Scene();
    expect(countVisible(scene)).toBe(0);
    const visible = new Mesh(), hidden = new Mesh(), group = new Group(), nested = new Mesh(), points = new Points(), line = new Line();
    hidden.visible = false;
    group.add(nested);
    scene.add(visible, hidden, group, points, line);
    expect(countVisible(scene)).toBe(4); // malha, malha dentro do grupo, pontos e linha; o escondido e o grupo vazio não contam
    group.visible = false; // esconder o grupo esconde o que está dentro
    expect(countVisible(scene)).toBe(3);
  });
});

describe('medição de chunks no mundo', () => {
  function makeWorld(): World {
    const mats = createMaterials();
    const w = new World(new Scene(), 20261111, mats.terrain, new PropFactory(mats.props));
    w.radius = 1;
    return w;
  }

  it('fora do teste não mede nada (o custo é só uma checagem)', () => {
    const w = makeWorld();
    expect(w.perf).toBeNull();
    w.update(0, 0, 99, 0);
    expect(w.chunkCount).toBeGreaterThan(0);
  });

  it('mede gerar chunks e malhar chunks novos', () => {
    const w = makeWorld();
    const gen: number[] = [], mesh: [number, boolean][] = [];
    w.perf = { onGenerate: (ms) => gen.push(ms), onMesh: (ms, edit) => mesh.push([ms, edit]) };
    w.update(0, 0, 99, 0);
    expect(gen.length).toBeGreaterThanOrEqual(w.chunkCount - 1);
    expect(mesh.length).toBeGreaterThan(0);
    expect(mesh.every(([, edit]) => !edit)).toBe(true);
    expect([...gen, ...mesh.map(([ms]) => ms)].every((ms) => ms >= 0)).toBe(true);
  });

  it('refazer a malha depois de quebrar um bloco é medido à parte', () => {
    const w = makeWorld();
    w.update(0, 0, 99, 0);
    const mesh: boolean[] = [];
    w.perf = { onGenerate: () => undefined, onMesh: (_ms, edit) => mesh.push(edit) };
    const top = w.topY(5, 5);
    w.setBlock(5, top, 5, AIR);
    expect(mesh).toEqual([true]);
    // andar até um chunk novo mede de novo como malha nova
    w.update(200, 0, 99, 0);
    expect(mesh.some((e) => !e)).toBe(true);
  });

  it('o ponto de partida de cada cenário é terreno de verdade', () => {
    const w = makeWorld();
    for (let i = 0; i < BENCH_SCENARIOS.length; i++) {
      const o = originOf(i);
      expect(w.topY(o.x, o.z)).toBeGreaterThan(2);
    }
  });
});
