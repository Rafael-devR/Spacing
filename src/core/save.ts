// Salvamento com versão e migração. Toda mudança de formato ganha uma versão nova,
// uma função de migração e um teste (tests/save.test.ts).
import { isItemId } from '../data/items';
import type { EquipmentSave } from '../systems/Equipment';
import { EQUIP_SLOTS, EQUIPMENT, isEquipId } from '../data/equipment';
import type { PropType } from '../data/props';
import { SUITS, type SuitId } from '../data/survival';
import type { LootSave } from '../entities/LootPiles';
import { Inventory, type InventorySave, type ItemCounts } from '../systems/Inventory';
import type { SurvivalSave } from '../systems/Survival';
import type { ExplorationSave } from '../systems/Exploration';
import type { CraftingSave, JobSave } from '../systems/Crafting';
import type { PowerSave } from '../systems/Power';
import { isStationId, STATIONS } from '../data/stations';

export const SAVE_KEY = 'spacing.save';
/** chave usada pela v0.1, sem campo de versão */
export const LEGACY_SAVE_KEY = 'spacing.save.v1';
export const PREFS_KEY = 'spacing.prefs.v1';
export const SAVE_VERSION = 8;

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
  /** espaços do inventário (v4); versões antigas guardavam só quantidades */
  inventory: InventorySave;
  player: { x: number; y: number; z: number } | null;
  missions: { step: number; count: number };
  /** medidores do traje (v3); null = traje cheio */
  suit: SurvivalSave | null;
  /** itens caídos no chão esperando ser recolhidos (v3) */
  loot: LootSave[];
  /** equipamentos no traje, fora do inventário (v5) */
  equipment: EquipmentSave;
  /** base (v5): estava dentro ao salvar e onde renasce */
  base: BaseSave;
  /** mapa descoberto (v6): chunk "cx,cz" → máscara de 16 bits dos ladrilhos vistos */
  explored: ExplorationSave;
  /** estações construídas e trabalhos em andamento ou esperando (v7; vagas e lotes na v8) */
  crafting: CraftingSave;
  /** energia da base (v8): carga da bateria; null = cheia */
  power: PowerSave | null;
}

export interface BaseSave {
  inside: boolean;
  respawn: 'lander' | 'base';
  /** já viu a base (aviso da IA uma vez só) */
  visited: boolean;
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

function cleanSuit(v: unknown): SurvivalSave | null {
  if (!isObj(v)) return null;
  const suit = typeof v.suit === 'string' && v.suit in SUITS ? (v.suit as SuitId) : 'emergency';
  const m = (k: string): number => Math.max(0, Math.min(100, num(v[k], 100)));
  const out: SurvivalSave = { suit, o2: m('o2'), battery: m('battery'), integrity: m('integrity') };
  if (typeof v.energy === 'number') out.energy = m('energy');
  return out;
}

function cleanLoot(v: unknown): LootSave[] {
  if (!Array.isArray(v)) return [];
  const out: LootSave[] = [];
  for (const l of v) {
    if (!isObj(l) || !isItemId(l.item) || typeof l.amount !== 'number' || l.amount <= 0) continue;
    const x = num(l.x, NaN), y = num(l.y, NaN), z = num(l.z, NaN);
    if (![x, y, z].every(Number.isFinite)) continue;
    out.push({ item: l.item, amount: Math.floor(l.amount), x, y, z, pile: Math.max(0, Math.floor(num(l.pile, 0))) });
  }
  return out;
}

function cleanEquipment(v: unknown): EquipmentSave {
  const out: EquipmentSave = {};
  if (!isObj(v)) return out;
  for (const slot of EQUIP_SLOTS) {
    const id = v[slot];
    if (isEquipId(id) && EQUIPMENT[id].slot === slot) out[slot] = id;
  }
  return out;
}

function cleanBase(v: unknown): BaseSave {
  const b = isObj(v) ? v : {};
  return { inside: b.inside === true, respawn: b.respawn === 'base' ? 'base' : 'lander', visited: b.visited === true };
}

/** v1 a v3: quantidades por item. Vira espaços na ordem de coleta. */
function countsToSlots(v: unknown): InventorySave {
  const counts: ItemCounts = {};
  if (isObj(v)) {
    for (const [k, n] of Object.entries(v)) {
      if (isItemId(k) && typeof n === 'number' && n > 0) counts[k] = Math.floor(n);
    }
  }
  return new Inventory(undefined, counts).serialize();
}

/** v4: espaços. Espaços inválidos ficam vazios. */
function cleanSlots(v: unknown): InventorySave {
  const raw = isObj(v) && Array.isArray(v.slots) ? v.slots : [];
  const slots = raw.map((s) =>
    isObj(s) && isItemId(s.item) && typeof s.n === 'number' && s.n > 0 ? { item: s.item, n: Math.floor(s.n) } : null,
  );
  const selected = isObj(v) ? Math.floor(num(v.selected, 0)) : 0;
  // o construtor limita tamanho de pilha, quantidade de espaços e seleção
  return new Inventory(undefined, { slots, selected }).serialize();
}

/** v6: só chaves "cx,cz" com máscara inteira de 1 a 0xffff. */
function cleanExplored(v: unknown): ExplorationSave {
  const out: ExplorationSave = {};
  if (!isObj(v)) return out;
  for (const [k, m] of Object.entries(v)) {
    if (!/^-?\d+,-?\d+$/.test(k) || typeof m !== 'number' || !Number.isInteger(m) || m <= 0 || m > 0xffff) continue;
    out[k] = m;
  }
  return out;
}

/**
 * v7 e v8: estações construídas e trabalhos. A v7 tinha um trabalho por estação (`t` e `duration`); a v8 tem vagas,
 * lotes e trabalho feito (`slot`, `batch`, `work`, `done`). O sistema confere de novo se a receita e a vaga existem.
 */
function cleanCrafting(v: unknown, version: number): CraftingSave {
  const c = isObj(v) ? v : {};
  const built = Array.isArray(c.built) ? c.built.filter((id) => isStationId(id) && !STATIONS[id].builtIn) : [];
  const jobs: JobSave[] = [];
  if (Array.isArray(c.jobs)) {
    for (const j of c.jobs) {
      if (!isObj(j) || !isStationId(j.station) || typeof j.recipe !== 'string') continue;
      const job: JobSave =
        version >= 8
          ? {
              station: j.station, slot: Math.max(0, Math.floor(num(j.slot, 0))), recipe: j.recipe,
              batch: Math.max(1, Math.floor(num(j.batch, 1))), work: Math.max(0, num(j.work, 0)), done: Math.max(0, num(j.done, 0)),
            }
          : { station: j.station, slot: 0, recipe: j.recipe, batch: 1, work: Math.max(0, num(j.duration, 0)), done: Math.max(0, num(j.t, 0)) };
      if (isObj(j.left)) {
        const left: JobSave['left'] = {};
        for (const [k, n] of Object.entries(j.left)) if (isItemId(k) && typeof n === 'number' && n > 0) left[k] = Math.floor(n);
        job.left = left;
      }
      if (typeof j.rest === 'boolean') job.rest = j.rest;
      jobs.push(job);
    }
  }
  return { built: built as CraftingSave['built'], jobs };
}

/**
 * Receitas novas da v7 (docs/design/CRAFTING.md): o Mapa passou a pedir uma placa de circuito. Quem ainda não
 * tem o Mapa recebe a placa "aproveitada do módulo de pouso", como num jogo novo.
 */
export function withStarterCircuit(inv: InventorySave, equipment: EquipmentSave): InventorySave {
  if (equipment.map) return inv;
  const i = new Inventory(undefined, inv);
  if (i.count('circuit') > 0) return inv;
  i.add('circuit', 1, false);
  return i.serialize();
}

/**
 * Converte qualquer formato conhecido para o atual.
 * v1 (v0.1.0): sem campo `version`, salvo em `spacing.save.v1`.
 * v2: igual ao v1 mais `version`, `seed` e `savedAt`.
 * v3: mais `suit` (medidores do traje) e `loot` (itens caídos na morte).
 * v4: `inventory` em espaços (`slots` e `selected`), como no Minecraft.
 * v5: `equipment` (equipamentos fora do inventário) e `base` (dentro da base, onde renasce).
 * v6: `explored` (mapa do tablet descoberto aos poucos). Antes disso, nada descoberto: o jogo revela em volta ao abrir.
 * v7: `crafting` (estações e trabalhos longos). Quem vem de antes e não tem o Mapa ganha a placa de circuito inicial.
 * v8: trabalhos com vaga e lote; `power` (bateria da base).
 */
export function migrate(raw: unknown, seed: number): SaveData | null {
  if (!isObj(raw)) return null;
  const version = raw.version === undefined ? 1 : raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > SAVE_VERSION) return null; // versão futura: não arrisca
  const p = isObj(raw.player) ? raw.player : null;
  const m = isObj(raw.missions) ? raw.missions : {};
  const equipment = version >= 5 ? cleanEquipment(raw.equipment) : {};
  const inventory = version >= 4 ? cleanSlots(raw.inventory) : countsToSlots(raw.inventory);
  return {
    version: SAVE_VERSION,
    seed: version === 1 ? seed : num(raw.seed, seed),
    savedAt: num(raw.savedAt, 0),
    world: cleanWorld(raw.world),
    inventory: version >= 7 ? inventory : withStarterCircuit(inventory, equipment),
    player: p ? { x: num(p.x, 0.5), y: num(p.y, 30), z: num(p.z, 0.5) } : null,
    missions: { step: Math.max(0, Math.floor(num(m.step, 0))), count: Math.max(0, Math.floor(num(m.count, 0))) },
    suit: version >= 3 ? cleanSuit(raw.suit) : null,
    loot: version >= 3 ? cleanLoot(raw.loot) : [],
    equipment,
    base: version >= 5 ? cleanBase(raw.base) : { inside: false, respawn: 'lander', visited: false },
    explored: version >= 6 ? cleanExplored(raw.explored) : {},
    crafting: version >= 7 ? cleanCrafting(raw.crafting, version) : { built: [], jobs: [] },
    power: version >= 8 && isObj(raw.power) && Number.isFinite(raw.power.battery) ? { battery: Math.max(0, num(raw.power.battery, 0)) } : null,
  };
}

/** Lê o salvamento atual; se só houver o da v0.1, migra, grava no formato novo e apaga o antigo. */
export function loadSave(store: KeyValueStore | null, seed: number, key = SAVE_KEY): SaveData | null {
  const current = migrate(readJSON(store, key), seed);
  if (current) return current;
  // o salvamento antigo (v0.1) só existe na Lua
  if (key !== SAVE_KEY) return null;
  const legacy = migrate(readJSON(store, LEGACY_SAVE_KEY), seed);
  if (legacy && writeJSON(store, SAVE_KEY, legacy)) store?.removeItem(LEGACY_SAVE_KEY);
  return legacy;
}

export function writeSave(store: KeyValueStore | null, data: Omit<SaveData, 'version' | 'savedAt'>, key = SAVE_KEY): boolean {
  return writeJSON(store, key, { ...data, version: SAVE_VERSION, savedAt: Date.now() });
}

export function clearSave(store: KeyValueStore | null, key = SAVE_KEY): void {
  try {
    store?.removeItem(key);
    if (key === SAVE_KEY) store?.removeItem(LEGACY_SAVE_KEY);
  } catch {
    /* sem armazenamento */
  }
}
