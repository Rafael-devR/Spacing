// Registro de blocos pronto para renderizar: dados + cores lineares por face.
import { hexToLinear, type RGB } from '../core/color';
import { BLOCK_DATA, type BlockData, type BlockId } from '../data/blocks';

export interface BlockDef extends BlockData {
  topL: RGB;
  sideL: RGB;
  botL: RGB;
  oreL: RGB | null;
}

function build(d: BlockData): BlockDef {
  const side = d.color;
  return {
    ...d,
    topL: hexToLinear(d.top ?? d.color),
    sideL: hexToLinear(side),
    botL: hexToLinear(d.bottom ?? side, d.bottom ? 1 : 0.8),
    oreL: d.ore ? hexToLinear(d.ore, d.oreMul ?? 1) : null,
  };
}

/** indexado pelo id do bloco; posições sem bloco (ar) ficam vazias */
export const BLOCKS: BlockDef[] = [];
for (const [id, d] of Object.entries(BLOCK_DATA)) BLOCKS[Number(id)] = build(d);

export function blockDef(id: BlockId): BlockDef {
  const d = BLOCKS[id];
  if (!d) throw new Error(`Bloco desconhecido: ${id}`);
  return d;
}
