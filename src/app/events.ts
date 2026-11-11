// Catálogo de eventos do jogo. Todo evento novo entra aqui, com o formato do que carrega.
import { EventBus } from '../core/events';
import type { BlockId } from '../data/blocks';
import type { ItemId } from '../data/items';
import type { PropType } from '../data/props';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type GameState = 'loading' | 'menu' | 'playing' | 'paused';

export type DenyReason = 'notBlock' | 'noItems' | 'blocked';

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
  /** o jogador escolheu outro item na barra */
  'inventory:selected': { index: number; item: ItemId };
  /** um golpe da furadeira acertou o alvo */
  'mine:hit': Vec3Like & { target: 'block' | 'prop' };
  /** uma ação foi recusada (sem item, lugar ocupado, ...) */
  'action:denied': { reason: DenyReason; item?: ItemId };
  /** modo de construção ligado/desligado */
  'build:mode': { on: boolean };
  'player:step': Vec3Like;
  'player:jump': Vec3Like;
  'player:land': Vec3Like & { speed: number };
  'debris:clink': { speed: number };
  'debris:kick': { speed: number };
  /** um meteoro começou a cair */
  'meteor:incoming': Vec3Like;
  'meteor:impact': Vec3Like & { distance: number; meteorite: boolean };
  'mission:started': { id: string; hint?: string };
  /** o painel da missão precisa ser redesenhado */
  'mission:updated': { step: number };
  'mission:completed': { id: string; title: string };
  /** o jogador chegou para entregar, mas faltam itens */
  'mission:missing': { items: { item: ItemId; missing: number }[] };
  'game:stateChanged': { from: GameState; to: GameState };
}

export type GameBus = EventBus<GameEvents>;

export function createBus(): GameBus {
  return new EventBus<GameEvents>();
}
