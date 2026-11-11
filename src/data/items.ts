// Itens do inventário.
import { BASALT, ICE, IRON, REGOLITH, ROCK, type BlockId } from './blocks';
import type { PropType } from './props';

export type ItemId = 'regolith' | 'rock' | 'basalt' | 'ice' | 'iron' | 'ilmenite' | 'gold' | 'crystal';

export interface ItemData {
  name: string;
  /** bloco que o item coloca ao construir; ausente = recurso, não constrói */
  block?: BlockId;
  /** como desenhar o ícone de um item que não é bloco */
  icon?: { block?: BlockId; prop?: PropType };
}

export const ITEMS: Record<ItemId, ItemData> = {
  regolith: { name: 'Regolito', block: REGOLITH },
  rock: { name: 'Rocha lunar', block: ROCK },
  basalt: { name: 'Basalto', block: BASALT },
  ice: { name: 'Gelo', block: ICE },
  iron: { name: 'Minério de ferro', icon: { block: IRON } },
  ilmenite: { name: 'Ilmenita', icon: { prop: 'ilmenite' } },
  gold: { name: 'Ouro', icon: { prop: 'gold' } },
  crystal: { name: 'Cristal lunar', icon: { prop: 'crystal' } },
};

/** ordem dos itens na barra de itens */
export const ITEM_ORDER: ItemId[] = ['regolith', 'rock', 'basalt', 'ice', 'iron', 'ilmenite', 'gold', 'crystal'];

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && v in ITEMS;
}

/** bloco que representa o item visualmente (ícone e item solto), se houver */
export function itemBlock(item: ItemId): BlockId | undefined {
  const d = ITEMS[item];
  return d.block ?? d.icon?.block;
}
