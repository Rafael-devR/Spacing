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
// Marte (docs/design/MARTE.md)
export const MARS_DUST: BlockId = 9;
export const MARS_ROCK: BlockId = 10;
export const DARK_SAND: BlockId = 11;
export const SEDIMENT: BlockId = 12;
export const VOLCANIC: BlockId = 13;
export const HEMATITE: BlockId = 14;
export const OLIVINE: BlockId = 15;
export const GYPSUM: BlockId = 16;
/** lava: brilha, não se minera e queima o traje (ficção pedida pelo dono, ver MARTE.md) */
export const LAVA: BlockId = 17;

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
  /** multiplicador das cores do bloco inteiro; acima de 1 faz o bloco brilhar (lava) */
  glow?: number;
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
  [MARS_DUST]: { name: 'Poeira marciana', top: '#a8644a', color: '#8c4f3a', bottom: '#764232', hardness: 0.35, drop: 'marsdust' },
  [MARS_ROCK]: { name: 'Rocha marciana', top: '#7f4c3c', color: '#6c3f32', hardness: 0.8, drop: 'marsrock' },
  [DARK_SAND]: { name: 'Areia escura', top: '#4b3b3a', color: '#3e3030', hardness: 0.3, drop: 'darksand' },
  [SEDIMENT]: { name: 'Rocha sedimentar', top: '#c99a72', color: '#b98a64', hardness: 0.7, drop: 'sediment' },
  [VOLCANIC]: { name: 'Basalto vulcânico', top: '#5e4a46', color: '#4c3c39', hardness: 1.1, tier: 1, drop: 'volcanic' },
  [HEMATITE]: { name: 'Hematita', top: '#8a4c39', color: '#7a4332', ore: '#5d6f8a', oreMul: 1.15, hardness: 1.3, drop: 'hematite' },
  [OLIVINE]: { name: 'Olivina', top: '#5e4a46', color: '#4c3c39', ore: '#8fc34a', oreMul: 1.35, hardness: 1.4, tier: 1, drop: 'olivine' },
  [GYPSUM]: { name: 'Gipsita', top: '#b98a64', color: '#a87b58', ore: '#f4efe6', oreMul: 1.1, hardness: 0.9, drop: 'gypsum' },
  [LAVA]: { name: 'Lava', top: '#ff5a14', color: '#d8401a', bottom: '#8a2a14', glow: 1.7, hardness: Infinity, drop: null },
};

/** blocos que queimam o traje ao pisar ou encostar */
export const HOT_BLOCKS: ReadonlySet<BlockId> = new Set([LAVA]);
