import { describe, expect, it } from 'vitest';
import {
  LEGACY_SAVE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  loadSave,
  migrate,
  writeSave,
  type KeyValueStore,
  type SaveData,
  renewWorld,
} from '../src/core/save';
import { Inventory, type InventorySave } from '../src/systems/Inventory';

const totals = (s: InventorySave | undefined) => new Inventory(undefined, s ?? null).totals();
const slots = (counts: Record<string, number>) => new Inventory(undefined, counts).serialize();

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

// formato exato que a v0.1.0 gravava em `spacing.save.v1`
/** um salvamento v9 mínimo, com um pouco de progresso */
const V9_BASE = {
  seed: 20261111, savedAt: 1, world: { edits: {}, removedProps: [], extraProps: [] },
  inventory: { slots: [{ item: 'iron', n: 5 }], selected: 0 }, player: null, missions: { step: 2, count: 1 }, suit: null, loot: [],
  equipment: { map: 'map' }, base: { inside: false, respawn: 'base', visited: true }, explored: {},
  crafting: { built: ['furnace'], jobs: [] }, power: { battery: 100 },
};

const V1 = {
  world: { edits: { '0,0': [[4437, 0], [5120, 3]] }, removedProps: ['5,7'], extraProps: [] },
  inventory: { regolith: 12, iron: 3, bogus: 9, gold: -2 },
  player: { x: 4.2, y: 18, z: -3.5 },
  missions: { step: 2, count: 1 },
};

describe('salvamento', () => {
  it('migra o formato da v0.1 para o atual', () => {
    const s = migrate(V1, 42);
    expect(s).not.toBeNull();
    expect(s!.version).toBe(SAVE_VERSION);
    expect(s!.seed).toBe(42);
    expect(s!.world.edits['0,0']).toEqual([[4437, 0], [5120, 3]]);
    expect(s!.world.removedProps).toEqual(['5,7']);
    expect(s!.player).toEqual({ x: 4.2, y: 18, z: -3.5 });
    expect(s!.missions).toEqual({ step: 2, count: 1 });
  });

  it('descarta itens desconhecidos e quantidades inválidas', () => {
    // a placa de circuito é a do Mapa (v7), dada a quem ainda não o tem
    expect(totals(migrate(V1, 1)!.inventory)).toEqual({ regolith: 12, iron: 3, circuit: 1 });
  });

  it('v3 → v4: quantidades viram espaços, na ordem da barra', () => {
    const s = migrate({ ...V1, version: 3, inventory: { iron: 3, regolith: 70 } }, 1)!;
    expect(s.inventory.slots.slice(0, 4)).toEqual([
      { item: 'regolith', n: 64 },
      { item: 'regolith', n: 6 },
      { item: 'iron', n: 3 },
      { item: 'circuit', n: 1 },
    ]);
    expect(s.inventory.selected).toBe(0);
  });

  it('v4: limpa espaços inválidos e mantém a posição dos válidos', () => {
    const s = migrate({
      ...V1, version: SAVE_VERSION,
      inventory: { slots: [null, { item: 'gold', n: 2 }, { item: 'nada', n: 1 }, { item: 'ice', n: 999 }, 'x'], selected: 3 },
    }, 1)!;
    expect(s.inventory.slots.slice(0, 5)).toEqual([null, { item: 'gold', n: 2 }, null, { item: 'ice', n: 64 }, null]);
    expect(s.inventory.selected).toBe(3);
  });

  it('migra a v2 (Fundação) com traje cheio e sem itens no chão', () => {
    const s = migrate({ ...V1, version: 2, seed: 9, savedAt: 1 }, 1);
    expect(s?.version).toBe(SAVE_VERSION);
    expect(s?.seed).toBe(9);
    expect(s?.suit).toBeNull();
    expect(s?.loot).toEqual([]);
  });

  it('limpa medidores e itens caídos inválidos', () => {
    const s = migrate({
      ...V1, version: SAVE_VERSION,
      suit: { suit: 'inexistente', o2: 250, battery: -5, integrity: 'x' },
      loot: [
        { item: 'gold', amount: 2, x: 1, y: 2, z: 3, pile: 1 },
        { item: 'naoexiste', amount: 1, x: 0, y: 0, z: 0 },
        { item: 'iron', amount: 0, x: 0, y: 0, z: 0 },
        { item: 'iron', amount: 1, x: 'a', y: 0, z: 0 },
      ],
    }, 1);
    expect(s?.suit).toEqual({ suit: 'emergency', o2: 100, battery: 0, integrity: 100 });
    expect(s?.loot).toEqual([{ item: 'gold', amount: 2, x: 1, y: 2, z: 3, pile: 1 }]);
  });

  it('v4 → v5: sem equipamento, fora da base, renasce no módulo de pouso', () => {
    const s = migrate({ ...V1, version: 4, inventory: { slots: [], selected: 0 } }, 1)!;
    expect(s.equipment).toEqual({});
    expect(s.base).toEqual({ inside: false, respawn: 'lander', visited: false });
  });

  it('v5: limpa equipamento e base inválidos', () => {
    const s = migrate({
      ...V1, version: SAVE_VERSION, inventory: { slots: [], selected: 0 },
      equipment: { map: 'espada', capacete: 'map' }, base: { inside: 'sim', respawn: 'lua' },
      suit: { suit: 'emergency', o2: 50, battery: 50, integrity: 50, energy: 130 },
    }, 1)!;
    expect(s.equipment).toEqual({});
    expect(s.base).toEqual({ inside: false, respawn: 'lander', visited: false });
    expect(s.suit?.energy).toBe(100);
  });

  it('v5 → v6: mapa ainda não descoberto', () => {
    const s = migrate({ ...V1, version: 5, inventory: { slots: [], selected: 0 }, equipment: { map: 'map' } }, 1)!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.explored).toEqual({});
    expect(s.equipment).toEqual({ map: 'map' });
  });

  it('v6: limpa o mapa descoberto inválido', () => {
    const s = migrate({
      ...V1, version: SAVE_VERSION, inventory: { slots: [], selected: 0 },
      explored: { '1,2': 5, '-3,-4': 65535, 'x,1': 3, '0,0': 0, '5,5': 70000, '6,6': 1.5, '7,7': 'a' },
    }, 1)!;
    expect(s.explored).toEqual({ '1,2': 5, '-3,-4': 65535 });
  });

  it('recusa lixo e versões futuras', () => {
    expect(migrate(null, 1)).toBeNull();
    expect(migrate('texto', 1)).toBeNull();
    expect(migrate({ ...V1, version: 99 }, 1)).toBeNull();
  });

  it('ao carregar, move o salvamento antigo para a chave nova', () => {
    const store = memoryStore({ [LEGACY_SAVE_KEY]: JSON.stringify(V1) });
    const s = loadSave(store, 7);
    expect(totals(s?.inventory).regolith).toBe(12);
    expect(store.data[LEGACY_SAVE_KEY]).toBeUndefined();
    expect(JSON.parse(store.data[SAVE_KEY]).version).toBe(SAVE_VERSION);
  });

  it('grava e lê de volta o mesmo conteúdo', () => {
    const store = memoryStore();
    const data = {
      seed: 3, worldGen: 2, world: V1.world as never, inventory: slots({ ice: 2 }), player: null, missions: { step: 0, count: 0 },
      suit: { suit: 'emergency' as const, o2: 40, battery: 10, integrity: 75 },
      loot: [{ item: 'iron' as const, amount: 3, x: 1, y: 18, z: 2, pile: 1 }],
      equipment: { map: 'map' as const },
      base: { inside: true, respawn: 'base' as const, visited: true },
      explored: { '0,0': 0xffff, '-2,5': 0b1010 },
      crafting: {
        built: ['furnace' as const],
        jobs: [{ station: 'furnace' as const, slot: 2, recipe: 'glass', batch: 4, prep: 1, unit: 2.5, done: 6, taken: { glass: 1 }, paused: true }],
      },
      power: { battery: 300 },
      greenhouse: { chest: ['estufa' as const], site: { x: 10, z: -3, floorY: 31, parts: ['floor' as const, 'wallS' as const], done: false, beds: [] } },
    };
    expect(writeSave(store, data)).toBe(true);
    const back = loadSave(store, 3);
    expect(back?.inventory).toEqual(slots({ ice: 2 }));
    expect(back?.player).toBeNull();
    expect(back?.savedAt).toBeGreaterThan(0);
    expect(back?.greenhouse).toEqual(data.greenhouse);
    expect(back?.suit).toEqual({ suit: 'emergency', o2: 40, battery: 10, integrity: 75 });
    expect(back?.loot).toEqual([{ item: 'iron', amount: 3, x: 1, y: 18, z: 2, pile: 1 }]);
    expect(back?.equipment).toEqual({ map: 'map' });
    expect(back?.base).toEqual({ inside: true, respawn: 'base', visited: true });
    expect(back?.explored).toEqual({ '0,0': 0xffff, '-2,5': 0b1010 });
    expect(back?.crafting).toEqual(data.crafting);
    expect(back?.power).toEqual({ battery: 300 });
  });

  it('v7: de antes ganha a placa de circuito só se ainda não tem o Mapa; trabalhos inválidos somem', () => {
    const v6 = (equipment: object) => ({
      version: 6, seed: 3, world: V1.world, inventory: slots({ ice: 2 }), player: null, missions: { step: 0, count: 0 },
      suit: null, loot: [], equipment, base: { inside: false, respawn: 'lander', visited: false }, explored: {},
    });
    const noMap = migrate(v6({}), 3);
    expect(totals(noMap?.inventory)).toEqual({ ice: 2, circuit: 1 });
    expect(noMap?.crafting).toEqual({ built: [], jobs: [] });
    const withMap = migrate(v6({ map: 'map' }), 3);
    expect(totals(withMap?.inventory)).toEqual({ ice: 2 });
    const v7 = migrate(
      {
        ...v6({}), version: 7,
        crafting: {
          built: ['furnace', 'workbench', 'lixo'],
          jobs: [
            { station: 'electrolyzer', recipe: 'water', t: 50, duration: 40, left: { h2: 2, lixo: 3 }, rest: false },
            { station: 'nada', recipe: 'water', t: 1, duration: 2 },
            'lixo',
          ],
        },
      },
      3,
    );
    expect(totals(v7?.inventory)).toEqual({ ice: 2 });
    // v7 → v9: um trabalho por estação vira a vaga 0, lote 1, sem preparo; pronto com sobra vira `leftover`
    expect(v7?.crafting).toEqual({
      built: ['furnace'],
      jobs: [{ station: 'electrolyzer', slot: 0, recipe: 'water', batch: 1, prep: 0, unit: 40, done: 50, leftover: { h2: 2 }, delivered: true }],
    });
    expect(v7?.power).toBeNull();
  });

  it('sem armazenamento (navegador bloqueado) não quebra', () => {
    expect(loadSave(null, 1)).toBeNull();
    expect(
      writeSave(null, {
        seed: 1,
      worldGen: 1, world: { edits: {}, removedProps: [], extraProps: [] }, inventory: slots({}), player: null,
        missions: { step: 0, count: 0 }, suit: null, loot: [], equipment: {},
        base: { inside: false, respawn: 'lander', visited: false }, explored: {}, crafting: { built: [], jobs: [] }, power: null,
        greenhouse: { chest: [], site: null },
      }),
    ).toBe(false);
  });

  it('v10: guarda a versão do gerador; salvamentos antigos são do gerador 1', () => {
    expect(migrate({ ...V9_BASE, version: 9 }, 5)?.worldGen).toBe(1);
    expect(migrate({ ...V9_BASE, version: 10, worldGen: 2 }, 5)?.worldGen).toBe(2);
  });

  it('renewWorld: o progresso fica, o mundo é refeito e os painéis colocados voltam para o inventário', () => {
    const old = migrate({
      ...V9_BASE, version: 9, seed: 20261111,
      player: { x: 30, y: 20, z: 4 },
      world: {
        edits: { '0,0': [[5, 0]] }, removedProps: ['x9,9,solarPanel'],
        extraProps: [
          { wx: 4, wz: 4, type: 'solarPanel', variant: 0, rot: 0, scale: 1, key: 'x4,4,solarPanel' },
          { wx: 9, wz: 9, type: 'solarPanel', variant: 0, rot: 0, scale: 1, key: 'x9,9,solarPanel' },
          { wx: 7, wz: 7, type: 'meteorite', variant: 0, rot: 0, scale: 1, key: 'x7,7,meteorite' },
        ],
      },
      explored: { '0,0': 3 },
      loot: [{ item: 'ice', amount: 2, x: 1, y: 20, z: 1, pile: 0 }],
    }, 5)!;
    const fresh = renewWorld(old, 777, 2);
    expect(fresh.seed).toBe(777);
    expect(fresh.worldGen).toBe(2);
    expect(fresh.world).toEqual({ edits: {}, removedProps: [], extraProps: [] });
    expect(fresh.player).toBeNull();
    expect(fresh.loot).toEqual([]);
    expect(fresh.explored).toEqual({});
    const inv = new Inventory(undefined, fresh.inventory);
    expect(inv.count('solar_panel')).toBe(1);
    expect(inv.count('iron')).toBe(new Inventory(undefined, old.inventory).count('iron'));
    expect(fresh.equipment).toEqual(old.equipment);
    expect(fresh.crafting).toEqual(old.crafting);
  });
});

describe('salvamento v11 e v12: estufa', () => {
  const base = { version: 10, seed: 5, worldGen: 1, world: { edits: {}, removedProps: [], extraProps: [] } };
  const ALL = ['floor', 'wallS', 'wallW', 'wallE', 'wallN', 'frame', 'glass'];

  it('antes da v11: baú fechado e sem obra', () => {
    expect(migrate(base, 5)?.greenhouse).toEqual({ chest: [], site: null });
  });

  it('v11: baú aberto vira o lote "estufa" (o lote do cultivo continua no baú)', () => {
    expect(migrate({ ...base, version: 11, greenhouse: { chestOpened: true, site: null } }, 5)?.greenhouse.chest).toEqual(['estufa']);
  });

  it('limpa a obra: peças desconhecidas somem, a ordem é a de entrega e "pronta" só com todas as peças', () => {
    const g = migrate(
      { ...base, version: 11, greenhouse: { chestOpened: true, site: { x: 1.7, z: 2, floorY: 30, parts: ['wallS', 'glass', 'floor', 'xxx'], done: true } } },
      5,
    )?.greenhouse;
    expect(g?.site).toEqual({ x: 1, z: 2, floorY: 30, parts: ['floor', 'wallS', 'glass'], done: false, beds: [] });
    expect(migrate({ ...base, version: 11, greenhouse: { site: { x: 'a' } } }, 5)?.greenhouse.site).toBeNull();
  });

  it('v12: canteiros só dentro das paredes e sem repetir; planta só com solo', () => {
    const beds = [
      { x: 2, z: 2, soil: true, water: 0.5, crop: { growth: 0.4 } },
      { x: 2, z: 2, soil: true, water: 1, crop: null }, // repetido
      { x: 0, z: 3, soil: false, water: 0, crop: null }, // na parede
      { x: 3, z: 3, soil: false, water: 2, crop: { growth: 0.2 } }, // sem solo: sem planta; água até 1
    ];
    const g = migrate({ ...base, version: 12, greenhouse: { chest: ['estufa', 'cultivo', 'x'], site: { x: 0, z: 0, floorY: 30, parts: ALL, done: true, beds } } }, 5)?.greenhouse;
    expect(g?.chest).toEqual(['estufa', 'cultivo']);
    expect(g?.site?.beds).toEqual([
      { x: 2, z: 2, soil: true, water: 0.5, crop: { growth: 0.4 } },
      { x: 3, z: 3, soil: false, water: 1, crop: null },
    ]);
  });

  it('mundo refeito: o projeto, o material entregue e os canteiros voltam para a mochila', () => {
    const beds = [{ x: 2, z: 2, soil: true, water: 0.5, crop: { growth: 1 } }, { x: 3, z: 2, soil: false, water: 0, crop: null }];
    const save = migrate({ ...base, version: 12, greenhouse: { chest: ['estufa'], site: { x: 0, z: 0, floorY: 30, parts: ALL, done: true, beds } } }, 5) as SaveData;
    const renewed = renewWorld(save, 9, 4);
    expect(renewed.greenhouse).toEqual({ chest: ['estufa'], site: null });
    const inv = new Inventory(undefined, renewed.inventory);
    expect(inv.count('greenhouse_plan')).toBe(1);
    expect(inv.count('brick')).toBe(16);
    expect(inv.count('planter')).toBe(2);
    expect(inv.count('soil')).toBe(1);
    expect(inv.count('potato')).toBe(3);
  });
});
