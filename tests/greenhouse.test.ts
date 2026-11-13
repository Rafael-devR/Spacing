import { describe, expect, it } from 'vitest';
import { AIR, HULL, LAVA, REGOLITH } from '../src/data/blocks';
import { CHEST, GH, PARTS, PART_IDS, totalCost } from '../src/data/greenhouse';
import { ITEMS, type ItemId } from '../src/data/items';
import { Greenhouse, anchorAt, doorApron, type GroundView } from '../src/systems/Greenhouse';
import { Inventory } from '../src/systems/Inventory';
import { greenhouseStructure } from '../src/world/greenhouseLayout';

const flat = (h: number, over: Record<string, number> = {}): GroundView => ({
  topY: (x, z) => over[`${x},${z}`] ?? h,
  getBlock: (x, y, z) => (y <= (over[`${x},${z}`] ?? h) ? REGOLITH : AIR),
});

const kit = (): Inventory => {
  const inv = new Inventory();
  for (const c of CHEST) inv.add(c.item, c.n, false);
  return inv;
};

describe('estufa: dados', () => {
  it('o baú traz o projeto e material de sobra para construir tudo', () => {
    const need = totalCost();
    for (const [k, n] of Object.entries(need) as [ItemId, number][]) {
      const have = CHEST.filter((c) => c.item === k).reduce((a, c) => a + c.n, 0);
      expect(have, k).toBeGreaterThanOrEqual(n);
    }
    expect(CHEST.some((c) => c.item === 'greenhouse_plan')).toBe(true);
    expect(ITEMS.greenhouse_plan.site).toBe('greenhouse');
  });

  it('as peças têm ids únicos e custo em itens que existem', () => {
    expect(new Set(PART_IDS).size).toBe(PARTS.length);
    for (const p of PARTS) for (const k of Object.keys(p.cost)) expect(ITEMS[k as ItemId], k).toBeDefined();
  });
});

describe('estufa: baú', () => {
  it('abre uma vez e dá o kit', () => {
    const g = new Greenhouse();
    const inv = new Inventory();
    expect(g.openChest(inv).ok).toBe(true);
    expect(inv.count('greenhouse_plan')).toBe(1);
    expect(inv.count('glass')).toBeGreaterThanOrEqual(8);
    expect(g.openChest(inv)).toEqual({ ok: false, reason: 'opened' });
    expect(inv.count('greenhouse_plan')).toBe(1);
  });

  it('mochila cheia: não tira nada e o baú continua fechado', () => {
    const g = new Greenhouse();
    const inv = new Inventory();
    for (let i = 0; i < 32; i++) inv.add('rock', 64, false);
    expect(g.openChest(inv)).toEqual({ ok: false, reason: 'full' });
    expect(g.chestOpened).toBe(false);
    expect(inv.count('greenhouse_plan')).toBe(0);
  });
});

describe('estufa: onde assentar', () => {
  const a = anchorAt(20, 20);

  it('o holograma fica centrado no bloco mirado', () => {
    expect(a).toEqual({ x: 20 - 3, z: 20 - 3 });
  });

  it('chão plano e chão com 1 bloco de diferença servem; o piso fica no ponto mais alto', () => {
    const g = new Greenhouse();
    expect(g.check(flat(30), null, a.x, a.z)).toMatchObject({ ok: true, floorY: 30 });
    const r = g.check(flat(30, { [`${a.x + 2},${a.z + 2}`]: 31 }), null, a.x, a.z);
    expect(r).toMatchObject({ ok: true, floorY: 31 });
  });

  it('recusa chão desnivelado, lava, a base por perto, o jogador em cima e uma porta presa', () => {
    const g = new Greenhouse();
    expect(g.check(flat(30, { [`${a.x},${a.z}`]: 33 }), null, a.x, a.z).reason).toBe('uneven');
    const lava: GroundView = { ...flat(30), getBlock: (x, y, z) => (x === a.x + 1 && z === a.z + 1 && y === 30 ? LAVA : REGOLITH) };
    expect(g.check(lava, null, a.x, a.z).reason).toBe('lava');
    const base = { x0: a.x - 3, z0: a.z - 3, x1: a.x + 1, z1: a.z + 1 };
    expect(g.check(flat(30), { ...base, y0: 30, y1: 36 }, a.x, a.z).reason).toBe('base');
    expect(g.check(flat(30), null, a.x, a.z, { x: a.x + 3.5, z: a.z + 3.5 }).reason).toBe('player');
    const [ax, az] = doorApron(a.x, a.z)[1];
    expect(g.check(flat(30, { [`${ax},${az}`]: 36 }), null, a.x, a.z).reason).toBe('door');
  });

  it('só uma obra por vez', () => {
    const g = new Greenhouse();
    g.placeSite(a.x, a.z, 30);
    expect(g.check(flat(30), null, 100, 100).reason).toBe('exists');
  });
});

describe('estufa: construir por partes', () => {
  it('entrega na ordem, gasta o material e só finaliza com todas as peças', () => {
    const g = new Greenhouse();
    g.placeSite(0, 0, 30);
    const inv = kit();
    const before = inv.count('brick');
    expect(g.nextPart()?.id).toBe('floor');
    expect(g.finish()).toBe(false);
    const r = g.deliver(inv);
    expect(r.ok).toBe(true);
    expect(inv.count('brick')).toBe(before - 8);
    expect(g.nextPart()?.id).toBe('wallS');
    while (g.nextPart()) expect(g.deliver(inv).ok).toBe(true);
    expect(g.complete).toBe(true);
    expect(g.done).toBe(false);
    expect(g.finish()).toBe(true);
    expect(g.done).toBe(true);
    expect(g.finish()).toBe(false);
  });

  it('sem material: diz o que falta e não gasta nada', () => {
    const g = new Greenhouse();
    g.placeSite(0, 0, 30);
    const inv = new Inventory();
    inv.add('brick', 5, false);
    const r = g.deliver(inv);
    expect(r).toEqual({ ok: false, missing: { brick: 3 } });
    expect(inv.count('brick')).toBe(5);
    expect(g.delivered).toBe(0);
  });

  it('spent() soma o que já foi entregue', () => {
    const g = new Greenhouse();
    g.placeSite(0, 0, 30);
    const inv = kit();
    g.deliver(inv);
    g.deliver(inv);
    expect(g.spent()).toEqual({ brick: 10, iron_bar: 3 });
  });
});

describe('estufa: colisão', () => {
  const site = (parts: (typeof PART_IDS)[number][]) => ({ x: 10, z: 10, floorY: 30, parts, done: false });
  const fy = 30;

  it('o chão nivelado é sólido desde o início e não há paredes sem peças', () => {
    const s = greenhouseStructure(site([]));
    expect(s.block(13, fy, 13)).toBe(HULL);
    expect(s.block(10, fy + 1, 10)).toBe(AIR);
    expect(s.block(13, fy + 1, 13)).toBe(AIR);
  });

  it('paredes fecham com as peças, e o vão da porta (2 de altura) fica sempre aberto', () => {
    const s = greenhouseStructure(site(['floor', 'wallS', 'wallN', 'wallW', 'wallE']));
    const x = 10 + GH.doorAt, zS = 10 + GH.size - 1;
    for (let dx = 0; dx < GH.size; dx++) {
      const wx = 10 + dx;
      expect(s.block(wx, fy + 1, 10), 'norte').toBe(HULL);
      if (wx === x) {
        expect(s.block(wx, fy + 1, zS)).toBe(AIR);
        expect(s.block(wx, fy + 2, zS)).toBe(AIR);
        expect(s.block(wx, fy + 3, zS)).toBe(HULL); // a verga
      } else expect(s.block(wx, fy + 1, zS), 'sul').toBe(HULL);
    }
    for (let dz = 1; dz < GH.size - 1; dz++) {
      expect(s.block(10, fy + 2, 10 + dz), 'oeste').toBe(HULL);
      expect(s.block(10 + GH.size - 1, fy + 2, 10 + dz), 'leste').toBe(HULL);
    }
    expect(s.block(13, fy + 1, 13)).toBe(AIR); // por dentro, livre
    expect(s.block(13, fy + GH.wallHeight + 1, 13)).toBe(AIR); // sem a estrutura da cúpula, sem teto
  });

  it('a estrutura da cúpula fecha o teto', () => {
    const s = greenhouseStructure(site(['frame']));
    expect(s.block(13, fy + GH.wallHeight + 1, 13)).toBe(HULL);
  });
});
