// Plataforma plana da base (world/basePad.ts): o terreno sob a base é igual em toda semente e o degrau é de blocos de verdade.
import { describe, expect, it } from 'vitest';
import { HULL } from '../src/data/blocks';
import { HAB_MODULE } from '../src/data/base';
import { PAD, applyBasePad, inPad, isLanding, padWeight } from '../src/world/basePad';
import { layoutModule } from '../src/world/baseLayout';
import { MarsTerrain } from '../src/world/marsTerrain';
import { CS, CH, Terrain, idx, type TerrainGen } from '../src/world/terrain';

const SEEDS = [1, 2, 3, 7, 42, 99, 123, 2026, 31337, 555, 20261111, 777, 4242];
const WORLDS: [string, (s: number) => TerrainGen & { spawnH: number }][] = [
  ['Lua', (s) => new Terrain(s)],
  ['Marte', (s) => new MarsTerrain(s)],
];
const o = HAB_MODULE.origin, size = HAB_MODULE.size;

/** o bloco do topo de uma coluna, lido do chunk gerado */
function topBlock(t: TerrainGen, x: number, z: number): number {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const data = t.generate(cx, cz).data;
  const h = t.column(x, z).h;
  return data[idx(x - cx * CS, h, z - cz * CS)];
}

describe.each(WORLDS)('plataforma da base (%s)', (_name, make) => {
  it.each(SEEDS)('semente %i: a pegada da base é plana, na altura do planalto do pouso', (seed) => {
    const t = make(seed);
    const padH = Math.floor(t.spawnH);
    for (let x = o.x; x < o.x + size.x; x++) for (let z = o.z; z < o.z + size.z; z++) expect(t.column(x, z).h, `${x},${z}`).toBe(padH);
    expect(layoutModule(HAB_MODULE, t).floorY).toBe(padH + 1);
  });

  it.each(SEEDS)('semente %i: o degrau é uma sacada de 3×2 blocos, rente ao piso, com a faixa plana na frente', (seed) => {
    const t = make(seed);
    const l = layoutModule(HAB_MODULE, t);
    const landing: [number, number][] = [];
    for (let x = o.x - 4; x < o.x + size.x + 4; x++) for (let z = o.z - 4; z < o.z + size.z + 12; z++) if (isLanding(x, z)) landing.push([x, z]);
    expect(landing).toHaveLength(6);
    for (const [x, z] of landing) expect(t.column(x, z).h, `sacada ${x},${z}`).toBe(l.floorY);
    // onde o astronauta sai da câmara: o topo da sacada está na altura em que ele pisa no piso (um bloco, rente)
    expect(t.column(Math.floor(l.outside.x), Math.floor(l.outside.z)).h + 1).toBe(l.outside.y);
    // depois da sacada, a faixa de chegada está um bloco abaixo (um degrau só, nunca 2 ou 3)
    const last = Math.max(...landing.map(([, z]) => z));
    for (let dz = 1; dz <= 5; dz++) expect(t.column(Math.floor(l.outside.x), last + dz).h, `faixa +${dz}`).toBe(l.floorY - 1);
  });

  it.each(SEEDS)('semente %i: a sacada é de metal (sem minerar) e o resto do chão da base não', (seed) => {
    const t = make(seed);
    const l = layoutModule(HAB_MODULE, t);
    expect(topBlock(t, Math.floor(l.outside.x), Math.floor(l.outside.z))).toBe(HULL);
    expect(topBlock(t, o.x + 2, o.z + 2)).not.toBe(HULL);
  });

  it.each(SEEDS)('semente %i: o relevo em volta volta ao natural sem paredões (no máximo 3 blocos entre colunas vizinhas)', (seed) => {
    const t = make(seed);
    let worst = 0;
    for (let x = o.x - 14; x < o.x + size.x + 14; x++)
      for (let z = o.z - 14; z < o.z + size.z + 22; z++)
        worst = Math.max(worst, Math.abs(t.column(x + 1, z).h - t.column(x, z).h), Math.abs(t.column(x, z + 1).h - t.column(x, z).h));
    expect(worst).toBeLessThanOrEqual(3);
  });

  it('nenhum objeto solto na plataforma nem na faixa de chegada', () => {
    const t = make(31337);
    for (const [cx, cz] of [[0, -1], [1, -1], [0, 0], [1, 0], [0, -2], [1, -2]] as const)
      for (const p of t.generate(cx, cz).props) expect(inPad(p.wx, p.wz), `${p.type} em ${p.wx},${p.wz}`).toBe(false);
  });

  it('o relevo guarda o limite de altura do mundo', () => {
    const t = make(5);
    for (const [x, z] of [[o.x, o.z], [o.x + 5, o.z + size.z + 2]] as const) expect(t.column(x, z).h).toBeLessThan(CH - 6);
  });
});

describe('basePad (conta pura)', () => {
  it('longe da base não muda a altura; dentro vira a da plataforma', () => {
    expect(applyBasePad(50.4, 200, 200, 45)).toBe(50.4);
    expect(applyBasePad(50.4, o.x + 3, o.z + 3, 45)).toBe(45);
    expect(padWeight(o.x + 3, o.z + 3)).toBe(1);
    expect(padWeight(o.x + 3, o.z - PAD.margin - PAD.blend - 1)).toBe(0);
  });

  it('a transição é contínua: o peso só cai (de dentro para fora) e nunca pula', () => {
    let prev = 1;
    for (let d = 0; d <= PAD.blend + 2; d += 0.25) {
      const w = padWeight(o.x + 3, o.z - PAD.margin - d);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - w).toBeLessThan(0.35);
      prev = w;
    }
  });
});
