import { describe, expect, it } from 'vitest';
import { BLOCK_DATA } from '../src/data/blocks';
import { DRILL_ORDER, DRILLS, drillForTier, mineSeconds } from '../src/data/drills';
import { EQUIP_SLOTS, EQUIPMENT, isEquipId, type EquipId } from '../src/data/equipment';
import { ITEMS } from '../src/data/items';
import { PROPS } from '../src/data/props';
import { RECIPES } from '../src/data/recipes';
import { Crafting } from '../src/systems/Crafting';
import { Equipment } from '../src/systems/Equipment';
import { Inventory } from '../src/systems/Inventory';

describe('brocas (dados)', () => {
  it('ficam em ordem: cada uma é mais forte e mais rápida que a anterior', () => {
    for (let i = 1; i < DRILL_ORDER.length; i++) {
      const a = DRILLS[DRILL_ORDER[i - 1]], b = DRILLS[DRILL_ORDER[i]];
      expect(b.tier).toBeGreaterThan(a.tier);
      expect(b.speed).toBeGreaterThan(a.speed);
      expect(b.drain).toBeGreaterThanOrEqual(a.drain);
    }
    expect(DRILLS.basic.tier).toBe(0);
    expect(DRILLS.basic.speed).toBe(1);
  });

  it('todo equipamento de broca aponta para uma broca e fica no encaixe da broca', () => {
    for (const id of Object.keys(EQUIPMENT) as EquipId[]) {
      const e = EQUIPMENT[id];
      if (e.drill) {
        expect(DRILLS[e.drill]).toBeDefined();
        expect(e.slot).toBe('drill');
      }
      expect(EQUIP_SLOTS).toContain(e.slot);
    }
  });

  it('o nível pedido por blocos e minérios existe em alguma broca', () => {
    const top = DRILLS[DRILL_ORDER[DRILL_ORDER.length - 1]].tier;
    for (const b of Object.values(BLOCK_DATA)) expect(b.tier ?? 0).toBeLessThanOrEqual(top);
    for (const p of Object.values(PROPS)) expect(p.tier ?? 0).toBeLessThanOrEqual(top);
  });

  it('a primeira missão continua possível só com a broca inicial', () => {
    // meteorito (e o ferro, a rocha e o gelo do começo) quebram com a broca do traje
    expect(PROPS.meteorite.tier ?? 0).toBe(0);
    for (const k of [2, 3, 5, 6]) expect(BLOCK_DATA[k].tier ?? 0).toBe(0);
  });

  it('cada broca tem uma receita com itens que existem e dá para chegar nela', () => {
    for (const id of Object.keys(EQUIPMENT) as EquipId[]) {
      if (!EQUIPMENT[id].drill) continue;
      const r = RECIPES.find((x) => x.output.kind === 'equip' && x.output.equip === id);
      expect(r, id).toBeDefined();
      for (const item of Object.keys(r!.inputs)) expect(ITEMS[item as keyof typeof ITEMS]).toBeDefined();
    }
  });

  it('drillForTier devolve a broca mais fraca que serve', () => {
    expect(drillForTier(0).id).toBe('basic');
    expect(drillForTier(1).id).toBe('iron');
    expect(drillForTier(2).id).toBe('crystal');
  });

  it('broca melhor quebra mais rápido', () => {
    expect(mineSeconds(DRILLS.crystal, 1.5)).toBeLessThan(mineSeconds(DRILLS.iron, 1.5));
    expect(mineSeconds(DRILLS.iron, 1.5)).toBeLessThan(mineSeconds(DRILLS.basic, 1.5));
  });
});

describe('broca equipada', () => {
  it('sem equipamento, a broca é a do traje', () => {
    expect(new Equipment().drill.id).toBe('basic');
  });

  it('equipar uma broca troca a que está em uso', () => {
    const eq = new Equipment();
    eq.equip('drill_iron');
    expect(eq.drill.id).toBe('iron');
    eq.equip('drill_crystal');
    expect(eq.drill.id).toBe('crystal');
    expect(eq.has('drill_iron')).toBe(false); // ocupa o mesmo encaixe
  });

  it('uma broca melhor cobre as piores (não se fabrica para trás)', () => {
    const eq = new Equipment();
    expect(eq.covers('drill_iron')).toBe(false);
    eq.equip('drill_crystal');
    expect(eq.covers('drill_iron')).toBe(true);
    expect(eq.covers('map')).toBe(false);
  });

  it('o salvamento guarda a broca e ignora uma desconhecida', () => {
    const eq = new Equipment(undefined, { drill: 'drill_iron', map: 'map' });
    expect(eq.drill.id).toBe('iron');
    expect(eq.has('map')).toBe(true);
    const bad = new Equipment(undefined, { drill: 'drill_ouro' as unknown as EquipId });
    expect(bad.drill.id).toBe('basic');
    expect(isEquipId('drill_iron')).toBe(true);
  });
});

describe('fabricar brocas', () => {
  const setup = (items: Record<string, number>): { crafting: Crafting; inv: Inventory; eq: Equipment } => {
    const inv = new Inventory(undefined, items as never);
    const eq = new Equipment();
    return { crafting: new Crafting({ inventory: inv, equipment: eq }), inv, eq };
  };
  const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

  it('gasta os materiais e equipa a broca ao terminar', () => {
    const { crafting, inv, eq } = setup({ iron: 5, rock: 4 });
    expect(crafting.check(recipe('drill_iron')).ok).toBe(true);
    expect(crafting.start(recipe('drill_iron'))).toBe(true);
    expect(inv.count('iron')).toBe(1);
    crafting.update(10);
    expect(eq.drill.id).toBe('iron');
  });

  it('recusa sem materiais e depois de ter uma broca igual ou melhor', () => {
    const { crafting, eq } = setup({ iron: 1 });
    expect(crafting.check(recipe('drill_iron')).missing.length).toBeGreaterThan(0);
    eq.equip('drill_crystal');
    const full = setup({ iron: 9, rock: 9 });
    full.eq.equip('drill_crystal');
    expect(full.crafting.check(recipe('drill_iron')).owned).toBe(true);
    expect(full.crafting.start(recipe('drill_iron'))).toBe(false);
  });
});
