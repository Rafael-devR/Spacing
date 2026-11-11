// Salvamento com versão e migração. Toda mudança de formato ganha uma versão nova,
// uma função de migração e um teste (tests/save.test.ts).
import { isItemId, type ItemId } from '../data/items';
import type { PropType } from '../data/props';

export const SAVE_KEY = 'spacing.save';
/** chave usada pela v0.1, sem campo de versão */
export const LEGACY_SAVE_KEY = 'spacing.save.v1';
export const PREFS_KEY = 'spacing.prefs.v1';
export const SAVE_VERSION = 2;

export interface ExtraPropSave {
  wx: number;
  wz: number;
  type: PropType;
  variant: number;
  rot: number;
  scale: number;
  key: string;
}

export interface WorldSave {
  /** chave do chunk "cx,cz" -> pares [índice do bloco, id do bloco] */
  edits: Record<string, [number, number][]>;
  removedProps: string[];
  extraProps: ExtraPropSave[];
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  seed: number;
  savedAt: number;
  world: WorldSave;
  inventory: Partial<Record<ItemId, number>>;
  player: { x: number; y: number; z: number } | null;
  missions: { step: number; count: number };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, ou nada se o navegador bloquear o acesso */
export function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJSON(store: KeyValueStore | null, key: string): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeJSON(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function cleanWorld(v: unknown): WorldSave {
  const w = isObj(v) ? v : {};
  const edits: WorldSave['edits'] = {};
  if (isObj(w.edits)) {
    for (const [k, list] of Object.entries(w.edits)) {
      if (!Array.isArray(list)) continue;
      edits[k] = list.filter(
        (e): e is [number, number] => Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number',
      );
    }
  }
  const removedProps = Array.isArray(w.removedProps) ? w.removedProps.filter((k): k is string => typeof k === 'string') : [];
  const extraProps = Array.isArray(w.extraProps) ? (w.extraProps.filter(isObj) as unknown as ExtraPropSave[]) : [];
  return { edits, removedProps, extraProps };
}

function cleanInventory(v: unknown): SaveData['inventory'] {
  const out: SaveData['inventory'] = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) {
    if (isItemId(k) && typeof n === 'number' && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

/**
 * Converte qualquer formato conhecido para o atual.
 * v1 (v0.1.0): sem campo `version`, salvo em `spacing.save.v1`.
 * v2: igual ao v1 mais `version`, `seed` e `savedAt`.
 */
export function migrate(raw: unknown, seed: number): SaveData | null {
  if (!isObj(raw)) return null;
  const version = raw.version === undefined ? 1 : raw.version;
  if (version !== 1 && version !== SAVE_VERSION) return null; // de uma versão futura: não arrisca
  const p = isObj(raw.player) ? raw.player : null;
  const m = isObj(raw.missions) ? raw.missions : {};
  return {
    version: SAVE_VERSION,
    seed: version === 1 ? seed : num(raw.seed, seed),
    savedAt: num(raw.savedAt, 0),
    world: cleanWorld(raw.world),
    inventory: cleanInventory(raw.inventory),
    player: p ? { x: num(p.x, 0.5), y: num(p.y, 30), z: num(p.z, 0.5) } : null,
    missions: { step: Math.max(0, Math.floor(num(m.step, 0))), count: Math.max(0, Math.floor(num(m.count, 0))) },
  };
}

/** Lê o salvamento atual; se só houver o da v0.1, migra, grava no formato novo e apaga o antigo. */
export function loadSave(store: KeyValueStore | null, seed: number): SaveData | null {
  const current = migrate(readJSON(store, SAVE_KEY), seed);
  if (current) return current;
  const legacy = migrate(readJSON(store, LEGACY_SAVE_KEY), seed);
  if (legacy && writeJSON(store, SAVE_KEY, legacy)) store?.removeItem(LEGACY_SAVE_KEY);
  return legacy;
}

export function writeSave(store: KeyValueStore | null, data: Omit<SaveData, 'version' | 'savedAt'>): boolean {
  return writeJSON(store, SAVE_KEY, { ...data, version: SAVE_VERSION, savedAt: Date.now() });
}

export function clearSave(store: KeyValueStore | null): void {
  try {
    store?.removeItem(SAVE_KEY);
    store?.removeItem(LEGACY_SAVE_KEY);
  } catch {
    /* sem armazenamento */
  }
}
