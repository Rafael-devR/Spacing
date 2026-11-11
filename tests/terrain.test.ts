import { describe, expect, it } from 'vitest';
import { CH, CS, Terrain, idx } from '../src/terrain.js';
import { AIR, BEDROCK } from '../src/blocks.js';

describe('Terrain', () => {
  it('gera o mesmo chunk para a mesma semente', () => {
    const a = new Terrain(1337).generate(2, -3);
    const b = new Terrain(1337).generate(2, -3);
    expect(a.data).toEqual(b.data);
    expect(a.props).toEqual(b.props);
  });

  it('gera mundos diferentes para sementes diferentes', () => {
    const a = new Terrain(1).generate(0, 0);
    const b = new Terrain(2).generate(0, 0);
    expect(a.data).not.toEqual(b.data);
  });

  it('tem rocha-mãe na base e ar acima da superfície', () => {
    const chunk = new Terrain(20261111).generate(0, 0);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        expect(chunk.data[idx(x, 0, z)]).toBe(BEDROCK);
        expect(chunk.data[idx(x, CH - 1, z)]).toBe(AIR);
      }
    }
    expect(chunk.maxY).toBeGreaterThan(3);
    expect(chunk.maxY).toBeLessThan(CH - 5);
  });

  it('mantém o planalto de pouso plano ao redor da origem', () => {
    const t = new Terrain(20261111);
    const h = t.column(0, 0).h;
    for (const [x, z] of [[2, 1], [-3, -2], [0, 3], [4, 0]]) {
      expect(t.column(x, z).h).toBe(h);
    }
  });
});
