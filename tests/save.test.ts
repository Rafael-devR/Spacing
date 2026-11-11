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
    const data = { seed: 3, world: V1.world as never, inventory: { ice: 2 }, player: null, missions: { step: 0, count: 0 } };
    expect(writeSave(store, data)).toBe(true);
    const back = loadSave(store, 3);
    expect(back?.inventory).toEqual({ ice: 2 });
    expect(back?.player).toBeNull();
    expect(back?.savedAt).toBeGreaterThan(0);
  });

  it('sem armazenamento (navegador bloqueado) não quebra', () => {
    expect(loadSave(null, 1)).toBeNull();
    expect(writeSave(null, { seed: 1, world: { edits: {}, removedProps: [], extraProps: [] }, inventory: {}, player: null, missions: { step: 0, count: 0 } })).toBe(false);
  });
});
