import { describe, expect, it } from 'vitest';
import { choosePlanet } from '../src/core/planet';
import { BLOCK_DATA, DARK_SAND, GYPSUM, HOT_BLOCKS, LAVA, MARS_DUST, OLIVINE, SEDIMENT } from '../src/data/blocks';
import { ITEMS, ITEM_ORDER } from '../src/data/items';
import { MISSION_MARS } from '../src/data/missions';
import { PLANETS } from '../src/data/planets';
import { PROPS } from '../src/data/props';
import { CANYON, MarsTerrain, VOLCANO } from '../src/world/marsTerrain';
import { CH, CS, idx } from '../src/world/terrain';

const T = new MarsTerrain(PLANETS.marte.seed);

function column(x: number, z: number): number[] {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const g = T.generate(cx, cz);
  const lx = x - cx * CS, lz = z - cz * CS;
  const out: number[] = [];
  for (let y = 0; y < CH; y++) out.push(g.data[idx(lx, y, lz)]);
  return out;
}
const topOf = (col: number[]): number => {
  for (let y = col.length - 1; y >= 0; y--) if (col[y] !== 0) return col[y];
  return 0;
};

describe('planeta', () => {
  it('a Lua é o padrão; o endereço manda mais que a escolha guardada', () => {
    expect(choosePlanet('', null)).toBe('lua');
    expect(choosePlanet('', 'marte')).toBe('marte');
    expect(choosePlanet('?planeta=lua', 'marte')).toBe('lua');
    expect(choosePlanet('?planeta=jupiter', 'nada')).toBe('lua');
  });

  it('cada planeta tem semente e salvamento próprios; a Lua continua com a chave antiga', () => {
    expect(PLANETS.lua.saveKey).toBe('spacing.save');
    expect(PLANETS.marte.saveKey).not.toBe(PLANETS.lua.saveKey);
    expect(PLANETS.marte.seed).not.toBe(PLANETS.lua.seed);
  });

  it('Marte tem gravidade maior: pulo mais baixo que na Lua', () => {
    const jumpH = (p: { gravity: number; jump: number }): number => (p.jump * p.jump) / (2 * p.gravity);
    expect(jumpH(PLANETS.marte.physics)).toBeLessThan(jumpH(PLANETS.lua.physics) * 0.85);
    expect(jumpH(PLANETS.marte.physics)).toBeGreaterThan(1.05); // ainda sobe um bloco
    expect(PLANETS.marte.physics.debrisGravity).toBeGreaterThan(PLANETS.lua.physics.debrisGravity * 3);
  });
});

describe('terreno de Marte', () => {
  it('é determinístico', () => {
    const a = T.generate(2, -3), b = new MarsTerrain(PLANETS.marte.seed).generate(2, -3);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('o pouso é plano e coberto de poeira vermelha', () => {
    const h = [-3, 0, 3].flatMap((x) => [-3, 0, 3].map((z) => T.column(x, z).h));
    expect(Math.max(...h) - Math.min(...h)).toBeLessThanOrEqual(1);
    expect(topOf(column(2, 2))).toBe(MARS_DUST);
  });

  it('a caldeira do vulcão tem lava e fica bem acima da planície', () => {
    expect(topOf(column(VOLCANO.x, VOLCANO.z))).toBe(LAVA);
    expect(T.column(VOLCANO.x + VOLCANO.caldera + 1, VOLCANO.z).h).toBeGreaterThan(T.column(0, 0).h + 10);
    expect(T.column(VOLCANO.x, VOLCANO.z).h).toBeLessThan(CH - 5);
  });

  it('o cânion desce até o fundo e o fundo é de areia escura', () => {
    const z = Math.round(T.canyonZ(0));
    expect(T.column(0, z).h).toBeLessThanOrEqual(CANYON.floor + 1);
    expect(topOf(column(0, z))).toBe(DARK_SAND);
  });

  it('há gipsita nas camadas do cânion e olivina no vulcão', () => {
    const found = new Set<number>();
    const cz = Math.floor(T.canyonZ(0) / CS);
    for (let cx = -3; cx <= 3; cx++) for (let dz = -1; dz <= 1; dz++) T.generate(cx, cz + dz).data.forEach((b) => found.add(b));
    expect(found.has(GYPSUM)).toBe(true);
    expect(found.has(SEDIMENT)).toBe(true);
    const vx = Math.floor(VOLCANO.x / CS), vz = Math.floor(VOLCANO.z / CS);
    const volc = new Set<number>();
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) T.generate(vx + a, vz + b).data.forEach((v) => volc.add(v));
    expect(volc.has(OLIVINE)).toBe(true);
  });

  it('todo bloco gerado existe; só pedras e esferas de hematita soltas', () => {
    for (const [cx, cz] of [[0, 0], [-5, 4], [3, -4]]) {
      const g = T.generate(cx, cz);
      g.data.forEach((b) => b && expect(BLOCK_DATA[b], `bloco ${b}`).toBeDefined());
      for (const p of g.props) expect(['marsBoulder', 'blueberries']).toContain(p.type);
    }
  });
});

describe('dados de Marte', () => {
  it('lava queima e não se minera', () => {
    expect(HOT_BLOCKS.has(LAVA)).toBe(true);
    expect(BLOCK_DATA[LAVA].hardness).toBe(Infinity);
    expect(BLOCK_DATA[LAVA].drop).toBeNull();
  });

  it('todo bloco de Marte que solta algo solta um item que existe e está na ordem', () => {
    for (const d of Object.values(BLOCK_DATA)) if (d.drop) expect(ITEM_ORDER).toContain(d.drop);
    for (const p of Object.values(PROPS)) expect(ITEMS[p.drop]).toBeDefined();
  });

  it('as missões de Marte pedem itens que existem em Marte e terminam', () => {
    expect(MISSION_MARS.at(-1)?.kind).toBe('end');
    for (const s of MISSION_MARS) {
      if (s.kind === 'collect') expect(ITEMS[s.item]).toBeDefined();
      if (s.kind === 'deliver') for (const k of Object.keys(s.needs)) expect(ITEM_ORDER).toContain(k);
    }
  });
});
