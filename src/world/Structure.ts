// Estruturas construídas (a base) por cima do terreno de voxels.
// Uma estrutura ocupa uma caixa de células e, dentro dela, manda no mundo: o World pergunta a ela que bloco
// existe ali antes de olhar o terreno. Assim a colisão do jogador, dos destroços e o raio de mira tratam
// paredes, piso e móveis como blocos sólidos, sem a estrutura fazer parte dos chunks (ela tem modelo próprio).
// Detalhes em docs/design/BASE.md.
import { AIR, HULL, type BlockId } from '../data/blocks';

/** o que existe em cada célula da estrutura */
export const enum Cell {
  Air = 0,
  Floor = 1,
  Wall = 2,
  /** parede acima da primeira fileira: some no corte quando o jogador está dentro */
  WallHigh = 3,
  Roof = 4,
  /** móvel: sólido, nunca some */
  Furniture = 5,
  /** porta: sólida quando fechada */
  Door = 6,
}

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  /** inclusivo */
  x1: number;
  y1: number;
  z1: number;
}

export class Structure {
  readonly box: Box;
  private readonly cells: Uint8Array;
  private readonly sx: number;
  private readonly sy: number;
  private readonly sz: number;
  /** porta aberta (célula de porta vira ar) */
  doorOpen = false;
  /** corte ativo: telhado e paredes altas não bloqueiam a mira (o jogador está dentro e vê o interior) */
  cutaway = false;

  constructor(
    readonly id: string,
    box: Box,
  ) {
    this.box = box;
    this.sx = box.x1 - box.x0 + 1;
    this.sy = box.y1 - box.y0 + 1;
    this.sz = box.z1 - box.z0 + 1;
    this.cells = new Uint8Array(this.sx * this.sy * this.sz);
  }

  contains(x: number, y: number, z: number): boolean {
    const b = this.box;
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
  }

  /** a coluna (x, z) fica embaixo ou dentro da estrutura */
  coversColumn(x: number, z: number): boolean {
    const b = this.box;
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  }

  private i(x: number, y: number, z: number): number {
    const b = this.box;
    return x - b.x0 + (z - b.z0) * this.sx + (y - b.y0) * this.sx * this.sz;
  }

  set(x: number, y: number, z: number, c: Cell): void {
    if (this.contains(x, y, z)) this.cells[this.i(x, y, z)] = c;
  }

  cell(x: number, y: number, z: number): Cell {
    return this.contains(x, y, z) ? (this.cells[this.i(x, y, z)] as Cell) : Cell.Air;
  }

  /**
   * Bloco nesta célula. `visible` = para a mira (raio): com o corte ativo, telhado e paredes altas
   * deixam o raio passar.
   */
  block(x: number, y: number, z: number, visible = false): BlockId {
    const c = this.cell(x, y, z);
    switch (c) {
      case Cell.Air:
        return AIR;
      case Cell.Door:
        return this.doorOpen ? AIR : HULL;
      case Cell.Roof:
      case Cell.WallHigh:
        return visible && this.cutaway ? AIR : HULL;
      default:
        return HULL;
    }
  }
}
