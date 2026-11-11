// Catálogo de eventos do jogo. Todo evento novo entra aqui, com o formato do que carrega.
import { EventBus } from '../core/events';
import type { BlockId } from '../data/blocks';
import type { ItemId } from '../data/items';
import type { EquipId, EquipSlot } from '../data/equipment';
import type { PropType } from '../data/props';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type GameState = 'loading' | 'menu' | 'playing' | 'paused' | 'dead';

export type DeathCause = 'asphyxia' | 'meteor' | 'fall';

export type Meter = 'o2' | 'battery' | 'integrity';

export type DenyReason = 'notBlock' | 'noItems' | 'blocked' | 'emptySlot';

export interface GameEvents {
  /** o jogador quebrou um bloco */
  'block:broken': Vec3Like & { id: BlockId };
  /** o jogador colocou um bloco */
  'block:placed': Vec3Like & { id: BlockId };
  /** qualquer alteração de bloco no mundo (jogador, meteoro, ...) */
  'world:blockChanged': Vec3Like & { id: BlockId };
  /** o jogador minerou um objeto solto */
  'prop:broken': Vec3Like & { type: PropType };
  /** um item chegou ao inventário */
  'item:collected': { item: ItemId; amount: number };
  /** contagem do inventário mudou (item null = vários itens) */
  'inventory:changed': { item: ItemId | null };
  /** o jogador escolheu outro espaço na barra (item null = espaço vazio) */
  'inventory:selected': { index: number; item: ItemId | null };
  /** não coube tudo no inventário; `amount` ficou de fora */
  'inventory:full': { item: ItemId; amount: number };
  /** a mochila abriu ou fechou */
  'bag:toggled': { open: boolean };
  /** um golpe da furadeira acertou o alvo */
  'mine:hit': Vec3Like & { target: 'block' | 'prop' };
  /** uma ação foi recusada (sem item, lugar ocupado, ...) */
  'action:denied': { reason: DenyReason; item?: ItemId };
  /** modo de construção ligado/desligado */
  'build:mode': { on: boolean };
  'player:step': Vec3Like;
  'player:jump': Vec3Like;
  'player:land': Vec3Like & { speed: number };
  'debris:clink': Vec3Like & { speed: number };
  'debris:kick': Vec3Like & { speed: number };
  /** um meteoro começou a cair; x, y, z = de onde ele vem; `id` serve para achar a posição dele em voo */
  'meteor:incoming': Vec3Like & { id: number };
  'meteor:impact': Vec3Like & { id: number; distance: number; meteorite: boolean };
  'mission:started': { id: string; hint?: string };
  /** o painel da missão precisa ser redesenhado */
  'mission:updated': { step: number };
  'mission:completed': { id: string; title: string };
  /** o jogador chegou para entregar, mas faltam itens */
  'mission:missing': { items: { item: ItemId; missing: number }[] };
  'game:stateChanged': { from: GameState; to: GameState };

  // ---- sobrevivência (docs/design/SOBREVIVENCIA.md) ----
  /** medidor cruzou um limite de aviso; level 0 = voltou ao normal */
  'suit:warning': { meter: Meter; level: 0 | 1 | 2 };
  /** começou ou parou a asfixia (oxigênio em zero) */
  'suit:asphyxia': { on: boolean };
  /** entrou ou saiu da área pressurizada (recarga) */
  'suit:recharge': { on: boolean };
  'player:damaged': { amount: number; cause: DeathCause; integrity: number };
  'player:died': Vec3Like & { cause: DeathCause };
  'player:respawned': Vec3Like;
  // ---- base (docs/design/BASE.md) ----
  /** entrou ou saiu da base (depois da câmara de pressurização) */
  'base:entered': { module: string };
  'base:exited': { module: string };
  /** a bancada começou ou terminou de fabricar */
  'craft:started': { recipe: string; seconds: number };
  'craft:finished': { recipe: string };
  /** um equipamento entrou no traje */
  'equipment:changed': { slot: EquipSlot; id: EquipId };
  /** descansou no beliche */
  'player:rested': Vec3Like;

  /** itens caíram no chão (morte) */
  'loot:dropped': Vec3Like & { pieces: number };
}

export type GameBus = EventBus<GameEvents>;

export function createBus(): GameBus {
  return new EventBus<GameEvents>();
}
