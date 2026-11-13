// Estufa (docs/design/ESTUFA.md, ADR 0016): uma cápsula de vidro separada da base, para plantar no futuro. Nesta primeira parte o
// jogador só a obtém: pega o projeto e o material no baú da base, posiciona o holograma no terreno, entrega o material peça por
// peça (cada peça entregue fica em baixa qualidade) e finaliza (tudo vira alta qualidade). Tudo que é número está aqui.
import type { ItemCounts } from '../systems/Inventory';

/** tamanho externo, em blocos (a porta fica no meio do lado sul) */
export const GH = {
  /** câmera de segurança por dentro: recuo do canto, altura, lente (paisagem e retrato) */
  camInset: 1.25, camHeight: 3.4, camFov: 74, camFovTall: 92,
  size: 7,
  /** altura das paredes, em blocos acima do piso (a porta é um vão de 2) */
  wallHeight: 3,
  /** quanto o chão sob a estufa pode variar (blocos) para ela poder ser assentada */
  tolerance: 1,
  /** folga mínima até a base (blocos) */
  baseGap: 4,
  /** folga mínima do centro do módulo de pouso até a borda da estufa (blocos) */
  landerGap: 7,
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

export type ChestItem = 'greenhouse_plan' | 'iron_bar' | 'brick' | 'basalt_fiber' | 'glass' | 'potato' | 'soil' | 'planter';
export type ChestLot = 'estufa' | 'cultivo';

/**
 * O que vem no baú da base, em lotes (a história decide de onde isso vem; por ora o baú já traz). Abrir o baú entrega os lotes
 * que ainda não foram pegos: quem abriu antes de o cultivo existir encontra só o lote novo.
 */
export const CHEST_LOTS: Record<ChestLot, { item: ChestItem; n: number }[]> = {
  estufa: [
    { item: 'greenhouse_plan', n: 1 },
    { item: 'brick', n: 20 },
    { item: 'iron_bar', n: 24 },
    { item: 'basalt_fiber', n: 4 },
    { item: 'glass', n: 10 },
  ],
  cultivo: [
    { item: 'planter', n: 2 },
    { item: 'soil', n: 4 },
    { item: 'potato', n: 4 },
  ],
};
export const CHEST_LOT_IDS: ChestLot[] = ['estufa', 'cultivo'];
/** tudo o que o baú tem, somado */
export const CHEST: { item: ChestItem; n: number }[] = CHEST_LOT_IDS.flatMap((l) => CHEST_LOTS[l]);

/**
 * Cultivo (docs/design/ESTUFA.md). Os canteiros só ficam dentro da estufa pronta (o vidro deixa a luz entrar e segura a
 * radiação). A batata precisa de solo fértil e de água; sem água ela para de crescer e murcha, mas não morre. Cresce só com
 * o jogo aberto.
 */
export const FARM = {
  /** segundos da semente à batata madura, com água, na luz da Lua (Marte é mais escuro: mais devagar) */
  growSeconds: 180,
  /** quanto tempo um enchimento de água dura enquanto a planta cresce (segundos) */
  waterSeconds: 110,
  /** abaixo disso o canteiro pede água (0..1) */
  thirsty: 0.35,
  /** batatas na colheita (uma pode voltar para a terra como semente) */
  harvest: 3,
  /** distância (blocos) até o canteiro para o botão de ação */
  reach: 1.35,
  /** estágios visíveis: semente, broto, folhas, moita, madura */
  stages: 5,
} as const;

/** estágio visível (0 = semente ... 4 = madura) do crescimento 0..1 */
export function growthStage(growth: number): number {
  return growth >= 1 ? FARM.stages - 1 : Math.min(FARM.stages - 2, Math.floor(growth * (FARM.stages - 1)));
}

export interface BedSave {
  /** a célula do canteiro (dentro da estufa) */
  x: number;
  z: number;
  /** tem solo fértil */
  soil: boolean;
  /** água, 0..1 */
  water: number;
  /** a planta: crescimento 0..1 (1 = madura); null = vazio */
  crop: { growth: number } | null;
}

/** soma do custo de todas as peças */
export function totalCost(): ItemCounts {
  const out: Record<string, number> = {};
  for (const p of PARTS) for (const [k, n] of Object.entries(p.cost)) out[k] = (out[k] ?? 0) + (n ?? 0);
  return out as ItemCounts;
}

/** o que está no salvamento: o baú foi aberto? e a obra, se existir */
export interface GreenhouseSave {
  /** lotes do baú já pegos */
  chest: ChestLot[];
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
  /** canteiros (só na estufa pronta) */
  beds: BedSave[];
}
