// Blocos do mundo. Cores em sRGB (hex); o registro em world/registry.ts as converte para linear.
import type { ItemId } from './items';

export type BlockId = number;

export const AIR: BlockId = 0;
export const BEDROCK: BlockId = 1;
export const REGOLITH: BlockId = 2;
export const ROCK: BlockId = 3;
export const BASALT: BlockId = 4;
export const ICE: BlockId = 5;
export const IRON: BlockId = 6;
export const CRYSTAL: BlockId = 7;
/** casco da base: só existe dentro de estruturas (world/Structure.ts), nunca nos chunks */
export const HULL: BlockId = 8;

export interface BlockData {
  name: string;
  /** cor das laterais (e do topo, se `top` não for dado) */
  color: string;
  top?: string;
  bottom?: string;
  /** cor das pepitas de minério que saem das faces */
  ore?: string;
  /** multiplicador da cor do minério; acima de 1 faz brilhar */
  oreMul?: number;
  /** segundos para quebrar com a broca inicial */
  hardness: number;
  /** nível mínimo da broca (data/drills.ts); ausente = 0, qualquer broca */
  tier?: number;
  drop: ItemId | null;
}

export const BLOCK_DATA: Record<BlockId, BlockData> = {
  [BEDROCK]: { name: 'Rocha-mãe', color: '#3d3646', hardness: Infinity, drop: null },
  [REGOLITH]: { name: 'Regolito', top: '#ddd3c3', color: '#b5a796', bottom: '#9a8d7d', hardness: 0.35, drop: 'regolith' },
  [ROCK]: { name: 'Rocha lunar', top: '#a39a91', color: '#8f867e', hardness: 0.8, drop: 'rock' },
  [BASALT]: { name: 'Basalto', top: '#7a7183', color: '#5d5567', hardness: 1.1, tier: 1, drop: 'basalt' },
  [ICE]: { name: 'Gelo', top: '#e4f6fb', color: '#a6d9ea', hardness: 0.6, drop: 'ice' },
  [IRON]: { name: 'Ferro', top: '#9c9187', color: '#8a8077', ore: '#e07a38', hardness: 1.4, drop: 'iron' },
  [CRYSTAL]: {
    name: 'Cristal',
    top: '#77708a',
    color: '#665e78',
    ore: '#8ff1ff',
    oreMul: 1.6,
    hardness: 1.5,
    tier: 1,
    drop: 'crystal',
  },
  [HULL]: { name: 'Casco da base', color: '#d9dde6', hardness: Infinity, drop: null },
};
