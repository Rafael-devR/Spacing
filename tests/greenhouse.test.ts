import { describe, expect, it } from 'vitest';
import { AIR, HULL, LAVA, REGOLITH } from '../src/data/blocks';
import { CHEST, FARM, GH, PARTS, PART_IDS, growthStage, totalCost } from '../src/data/greenhouse';
import { ITEMS, type ItemId } from '../src/data/items';
import { Greenhouse, anchorAt, doorApron, type GroundView } from '../src/systems/Greenhouse';
import { Inventory } from '../src/systems/Inventory';
import { greenhouseStructure } from '../src/world/greenhouseLayout';
import { LANDER } from '../src/world/terrain';

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

  it('baú aberto antes do cultivo: abrir de novo entrega só o lote novo', () => {
    const g = new Greenhouse({ chest: ['estufa'], site: null });
    const inv = new Inventory();
    expect(g.chestFull).toBe(true);
    expect(g.openChest(inv)).toMatchObject({ ok: true, lots: ['cultivo'] });
    expect(inv.count('greenhouse_plan')).toBe(0);
    expect(inv.count('potato')).toBe(4);
    expect(g.chestFull).toBe(false);
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

  it('recusa colada no módulo de pouso', () => {
    const g = new Greenhouse();
    const b = anchorAt(LANDER.x + 4, LANDER.z);
    expect(g.check(flat(30), null, b.x, b.z).reason).toBe('lander');
    const far = anchorAt(LANDER.x + 20, LANDER.z + 20);
    expect(g.check(flat(30), null, far.x, far.z).ok).toBe(true);
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
  const site = (parts: (typeof PART_IDS)[number][]) => ({ x: 10, z: 10, floorY: 30, parts, done: false, beds: [] });
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

describe('estufa: canteiros e batata', () => {
  const done = (): Greenhouse => {
    const g = new Greenhouse();
    g.placeSite(0, 0, 30);
    const inv = kit();
    while (g.nextPart()) g.deliver(inv);
    g.finish();
    return g;
  };

  it('canteiro só na estufa pronta, por dentro e fora do corredor da porta', () => {
    const g = new Greenhouse();
    g.placeSite(0, 0, 30);
    expect(g.bedSpot(2, 2)).toBe('notDone');
    const d = done();
    expect(d.bedSpot(0, 2)).toBe('outside'); // parede
    expect(d.bedSpot(GH.doorAt, GH.size - 2)).toBe('outside'); // logo depois da porta
    expect(d.bedSpot(GH.doorAt, GH.size - 3)).toBe('outside');
    expect(d.bedSpot(GH.doorAt, 1)).toBeNull();
    expect(d.placeBed(1, 1)).toBe(true);
    expect(d.bedSpot(1, 1)).toBe('taken');
  });

  it('o ciclo inteiro: solo, plantar, crescer com água, parar sem água, regar com gelo, colher 3', () => {
    const g = done();
    g.placeBed(1, 1);
    const b = g.bedAt(1, 1)!;
    const inv = new Inventory();
    expect(g.bedAction(b, inv)).toBe('needSoil');
    inv.add('soil', 1, false);
    expect(g.useBed(b, inv)?.action).toBe('soil');
    expect(g.bedAction(b, inv)).toBe('needSeed');
    inv.add('potato', 1, false);
    expect(g.useBed(b, inv)?.action).toBe('plant');
    expect(inv.count('potato')).toBe(0);
    // cresce enquanto há água; para quando seca
    let t = 0;
    while (b.water > 0 && t < 400) { g.step(1); t++; }
    const g0 = b.crop!.growth;
    expect(g0).toBeGreaterThan(0.2);
    expect(g0).toBeLessThan(1);
    g.step(30);
    expect(b.crop!.growth).toBe(g0);
    expect(g.bedAction(b, inv)).toBe('needWater');
    inv.add('ice', 3, false);
    expect(g.useBed(b, inv)?.action).toBe('water');
    expect(b.water).toBe(1);
    for (let i = 0; i < 400 && b.crop!.growth < 1; i++) {
      if (b.water < 0.1) g.useBed(b, inv);
      g.step(1);
    }
    expect(growthStage(b.crop!.growth)).toBe(4);
    expect(g.bedAction(b, inv)).toBe('harvest');
    expect(g.useBed(b, inv)).toEqual({ action: 'harvest', harvested: FARM.harvest });
    expect(inv.count('potato')).toBe(FARM.harvest);
    expect(b.crop).toBeNull();
    expect(b.soil).toBe(true);
  });

  it('em Marte (menos luz) cresce mais devagar', () => {
    const a = done(), m = done();
    for (const g of [a, m]) {
      g.placeBed(1, 1);
      const b = g.bedAt(1, 1)!;
      b.soil = true;
      b.water = 1;
      b.crop = { growth: 0 };
    }
    a.step(30, 1);
    m.step(30, 0.66);
    expect(m.bedAt(1, 1)!.crop!.growth).toBeLessThan(a.bedAt(1, 1)!.crop!.growth);
  });

  it('o estágio visível vai de 0 (semente) a 4 (madura)', () => {
    expect(growthStage(0)).toBe(0);
    expect(growthStage(0.3)).toBe(1);
    expect(growthStage(0.99)).toBe(3);
    expect(growthStage(1)).toBe(4);
  });
});
