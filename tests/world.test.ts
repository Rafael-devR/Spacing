import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { World } from '../src/world/World';
import { PropFactory } from '../src/render/models';
import { createMaterials } from '../src/render/materials';
import { meshPadded, meshSingle } from '../src/world/mesher';
import { AIR, IRON, REGOLITH } from '../src/data/blocks';
import type { WorldSave } from '../src/core/save';

function makeWorld(saved?: WorldSave) {
  const mats = createMaterials();
  const world = new World(new Scene(), 20261111, mats.terrain, new PropFactory(mats.props));
  world.radius = 1;
  world.load(saved); // o save é carregado antes de qualquer chunk ser gerado, como no jogo
  world.update(0, 0, 99, 0);
  return world;
}

describe('World', () => {
  it('quebrar um bloco o remove e rebaixa a altura da coluna', () => {
    const world = makeWorld();
    const top = world.topY(5, 5);
    expect(world.getBlock(5, top, 5)).not.toBe(AIR);
    world.setBlock(5, top, 5, AIR);
    expect(world.getBlock(5, top, 5)).toBe(AIR);
    expect(world.topY(5, 5)).toBe(top - 1);
  });

  it('não altera a rocha-mãe (y = 0)', () => {
    const world = makeWorld();
    expect(world.setBlock(5, 0, 5, AIR)).toBe(false);
  });

  it('o raio de mira atinge o topo do terreno, de cima para baixo', () => {
    const world = makeWorld();
    const top = world.topY(5, 5);
    const hit = world.raycast(new Vector3(5.5, 45, 5.5), new Vector3(0, -1, 0));
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([5, top, 5]);
    expect(hit!.normal).toEqual([0, 1, 0]);
  });

  it('guarda as edições para salvar e restaurar', () => {
    const world = makeWorld();
    const top = world.topY(6, 6);
    world.setBlock(6, top, 6, AIR);
    const saved = JSON.parse(JSON.stringify(world.serialize()));
    const fresh = makeWorld(saved);
    expect(fresh.getBlock(6, top, 6)).toBe(AIR);
  });
});

describe('Mesher', () => {
  it('um bloco isolado gera 6 faces sem valores inválidos', () => {
    const m = meshSingle(REGOLITH);
    expect(m.position.length / 3).toBe(36);
    expect([...m.position, ...m.normal, ...m.color].every(Number.isFinite)).toBe(true);
  });

  it('minério gera pepitas além das faces do cubo', () => {
    expect(meshSingle(IRON).position.length).toBeGreaterThan(meshSingle(REGOLITH).position.length);
  });

  it('faces internas entre blocos vizinhos não são geradas', () => {
    const w = 2, d = 1, h = 1;
    const pad = new Uint8Array((w + 2) * (d + 2) * h);
    pad[1 + 1 * (w + 2)] = REGOLITH;
    pad[2 + 1 * (w + 2)] = REGOLITH;
    const two = meshPadded(pad, w, d, h, 0, 0, 0, false);
    expect(two.position.length / 3).toBe(60); // 2 cubos x 36 - 2 faces internas x 6
  });
});
