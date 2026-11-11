import { describe, expect, it } from 'vitest';
import {
  LEGACY_SAVE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  loadSave,
  migrate,
  writeSave,
  type KeyValueStore,
} from '../src/core/save';

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
    expect(migrate(V1, 1)!.inventory).toEqual({ regolith: 12, iron: 3 });
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

  it('recusa lixo e versões futuras', () => {
    expect(migrate(null, 1)).toBeNull();
    expect(migrate('texto', 1)).toBeNull();
    expect(migrate({ ...V1, version: 99 }, 1)).toBeNull();
  });

  it('ao carregar, move o salvamento antigo para a chave nova', () => {
    const store = memoryStore({ [LEGACY_SAVE_KEY]: JSON.stringify(V1) });
    const s = loadSave(store, 7);
    expect(s?.inventory.regolith).toBe(12);
    expect(store.data[LEGACY_SAVE_KEY]).toBeUndefined();
    expect(JSON.parse(store.data[SAVE_KEY]).version).toBe(SAVE_VERSION);
  });

  it('grava e lê de volta o mesmo conteúdo', () => {
    const store = memoryStore();
    const data = {
      seed: 3, world: V1.world as never, inventory: { ice: 2 }, player: null, missions: { step: 0, count: 0 },
      suit: { suit: 'emergency' as const, o2: 40, battery: 10, integrity: 75 },
      loot: [{ item: 'iron' as const, amount: 3, x: 1, y: 18, z: 2, pile: 1 }],
    };
    expect(writeSave(store, data)).toBe(true);
    const back = loadSave(store, 3);
    expect(back?.inventory).toEqual({ ice: 2 });
    expect(back?.player).toBeNull();
    expect(back?.savedAt).toBeGreaterThan(0);
    expect(back?.suit).toEqual({ suit: 'emergency', o2: 40, battery: 10, integrity: 75 });
    expect(back?.loot).toEqual([{ item: 'iron', amount: 3, x: 1, y: 18, z: 2, pile: 1 }]);
  });

  it('sem armazenamento (navegador bloqueado) não quebra', () => {
    expect(loadSave(null, 1)).toBeNull();
    expect(
      writeSave(null, {
        seed: 1, world: { edits: {}, removedProps: [], extraProps: [] }, inventory: {}, player: null,
        missions: { step: 0, count: 0 }, suit: null, loot: [],
      }),
    ).toBe(false);
  });
});
