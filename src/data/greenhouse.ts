// Estufa (docs/design/ESTUFA.md, ADR 0016): uma cápsula de vidro separada da base, para plantar no futuro. Nesta primeira parte o
// jogador só a obtém: pega o projeto e o material no baú da base, posiciona o holograma no terreno, entrega o material peça por
// peça (cada peça entregue fica em baixa qualidade) e finaliza (tudo vira alta qualidade). Tudo que é número está aqui.
import type { ItemCounts } from '../systems/Inventory';

/** tamanho externo, em blocos (a porta fica no meio do lado sul) */
export const GH = {
  size: 7,
  /** altura das paredes, em blocos acima do piso (a porta é um vão de 2) */
  wallHeight: 3,
  /** quanto o chão sob a estufa pode variar (blocos) para ela poder ser assentada */
  tolerance: 1,
  /** folga mínima até a base (blocos) */
  baseGap: 4,
  /** alcance, em blocos além da borda, para entregar material */
  reach: 3.2,
  /** a porta: coluna ao longo do lado sul */
  doorAt: 3,
} as const;

export type PartId = 'floor' | 'wallS' | 'wallW' | 'wallE' | 'wallN' | 'frame' | 'glass';

export interface PartDef {
  id: PartId;
  name: string;
  /** o que a peça pede (itens do jogo: nada vem do nada) */
  cost: ItemCounts;
}

/** na ordem em que são entregues */
export const PARTS: PartDef[] = [
  { id: 'floor', name: 'Piso', cost: { brick: 8 } },
  { id: 'wallS', name: 'Parede sul (com a porta)', cost: { iron_bar: 3, brick: 2 } },
  { id: 'wallW', name: 'Parede oeste', cost: { iron_bar: 4, brick: 2 } },
  { id: 'wallE', name: 'Parede leste', cost: { iron_bar: 4, brick: 2 } },
  { id: 'wallN', name: 'Parede norte', cost: { iron_bar: 4, brick: 2 } },
  { id: 'frame', name: 'Estrutura da cúpula', cost: { iron_bar: 6, basalt_fiber: 3 } },
  { id: 'glass', name: 'Vidro da cúpula', cost: { glass: 8 } },
];

export const PART_IDS: PartId[] = PARTS.map((p) => p.id);

export function partDef(id: PartId): PartDef {
  return PARTS.find((p) => p.id === id) as PartDef;
}

/** o que vem no baú da base (a história decide de onde isso vem; por ora o baú já traz) */
export const CHEST: { item: 'greenhouse_plan' | 'iron_bar' | 'brick' | 'basalt_fiber' | 'glass'; n: number }[] = [
  { item: 'greenhouse_plan', n: 1 },
  { item: 'brick', n: 20 },
  { item: 'iron_bar', n: 24 },
  { item: 'basalt_fiber', n: 4 },
  { item: 'glass', n: 10 },
];

/** soma do custo de todas as peças */
export function totalCost(): ItemCounts {
  const out: Record<string, number> = {};
  for (const p of PARTS) for (const [k, n] of Object.entries(p.cost)) out[k] = (out[k] ?? 0) + (n ?? 0);
  return out as ItemCounts;
}

/** o que está no salvamento: o baú foi aberto? e a obra, se existir */
export interface GreenhouseSave {
  chestOpened: boolean;
  site: SiteSave | null;
}

export interface SiteSave {
  /** canto mínimo (x, z) e altura do piso (a célula do piso) */
  x: number;
  z: number;
  floorY: number;
  /** peças entregues, na ordem de PARTS */
  parts: PartId[];
  /** finalizada: tudo em alta qualidade */
  done: boolean;
}
