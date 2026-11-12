// Itens do inventário. Cada item diz para que serve (`about`) e do que é feito por dentro (`traits`):
// calor, peso e raridade decidem quanto tempo ele leva numa estação (docs/design/CRAFTING.md).
import {
  BASALT, DARK_SAND, GYPSUM, HEMATITE, ICE, IRON, MARS_DUST, MARS_ROCK, OLIVINE, REGOLITH, ROCK, SEDIMENT, VOLCANIC, type BlockId,
} from './blocks';
import type { PropType } from './props';

export type ItemId =
  | 'regolith' | 'rock' | 'basalt' | 'ice' | 'iron' | 'ilmenite' | 'gold' | 'crystal'
  // Marte
  | 'marsdust' | 'marsrock' | 'darksand' | 'sediment' | 'volcanic' | 'hematite' | 'olivine' | 'gypsum'
  // fabricados (docs/design/CRAFTING.md)
  | 'iron_bar' | 'brick' | 'glass' | 'basalt_fiber' | 'h2' | 'o2' | 'tio2' | 'titanium' | 'silicon' | 'circuit'
  // energia (docs/design/ENERGIA.md)
  | 'solar_panel';

/** forma do modelo de um item fabricado (render/craftedModels.ts) */
export type CraftedModel = 'ingot' | 'brick' | 'pane' | 'spool' | 'tank' | 'powder' | 'wafer' | 'chip';

/**
 * Do que o item é feito, de 0 a 3. Entra na conta do tempo de fabricação (`recipeSeconds` em recipes.ts):
 * - heat: quanto calor ele aguenta ou precisa (fundir ferro, titânio, tijolo refratário);
 * - mass: quanto pesa por unidade (mais massa para aquecer, mover e montar);
 * - rarity: quão raro e delicado é (mais cuidado, menos pressa).
 */
export interface ItemTraits {
  heat: number;
  mass: number;
  rarity: number;
}

export interface ItemData {
  name: string;
  /** para que serve, em uma frase (tela das estações e mochila) */
  about: string;
  traits: ItemTraits;
  /** bloco que o item coloca ao construir; ausente = recurso, não constrói */
  block?: BlockId;
  /** como desenhar o ícone de um item que não é bloco */
  icon?: { block?: BlockId; prop?: PropType; model?: CraftedModel; color?: string };
  /** quantos cabem num espaço do inventário (padrão STACK_SIZE) */
  stack?: number;
  /** objeto que o item coloca no mundo no modo construir (ex.: painel solar) */
  place?: PropType;
  /** comida (ainda sem uso: a energia vem da comida, docs/design/BASE.md) */
  food?: { energy: number };
  /** cor de destaque (partículas e linhas da tela das estações) */
  tint: string;
}

/** espaços da barra de itens */
export const HOTBAR_SIZE = 8;
/** espaços da mochila (além da barra) */
export const BAG_SIZE = 24;
/** quantos itens cabem num espaço, se o item não disser outro número */
export const STACK_SIZE = 64;

const tr = (heat: number, mass: number, rarity: number): ItemTraits => ({ heat, mass, rarity });

export const ITEMS: Record<ItemId, ItemData> = {
  regolith: {
    name: 'Regolito', block: REGOLITH, traits: tr(1, 0, 0), tint: '#ddd3c3',
    about: 'Poeira e cascalho de óxidos (sílica, ferro, alumínio). Vira tijolo, vidro e silício.',
  },
  rock: {
    name: 'Rocha lunar', block: ROCK, traits: tr(1, 1, 0), tint: '#a39a91',
    about: 'Pedra de construção. Faz o corpo do forno solar.',
  },
  basalt: {
    name: 'Basalto', block: BASALT, traits: tr(2, 2, 1), tint: '#7a7183',
    about: 'Rocha vulcânica dos mares lunares. Fundida e estirada vira fibra de basalto.',
  },
  ice: {
    name: 'Gelo', block: ICE, traits: tr(0, 1, 1), tint: '#a6d9ea',
    about: 'Água congelada das crateras. O eletrolisador separa em hidrogênio e oxigênio.',
  },
  iron: {
    name: 'Minério de ferro', icon: { block: IRON }, traits: tr(2, 2, 1), tint: '#e07a38',
    about: 'Rocha com ferro. No forno, o ferro funde e a escória é separada: barra de ferro.',
  },
  ilmenite: {
    name: 'Ilmenita', icon: { prop: 'ilmenite' }, traits: tr(3, 2, 2), tint: '#5a5368',
    about: 'FeTiO₃. Com hidrogênio no forno, dá ferro, óxido de titânio e água.',
  },
  gold: {
    name: 'Ouro', icon: { prop: 'gold' }, traits: tr(1, 2, 3), tint: '#ffb43a',
    about: 'Não oxida: contatos elétricos das placas de circuito.',
  },
  crystal: {
    name: 'Cristal lunar', icon: { prop: 'crystal' }, traits: tr(1, 1, 3), tint: '#8ff1ff',
    about: 'Ressoa com campos de energia (ficção). Ponta da broca de cristal e núcleo do domo.',
  },
  marsdust: {
    name: 'Poeira marciana', block: MARS_DUST, traits: tr(1, 0, 0), tint: '#a8644a',
    about: 'Regolito de Marte, vermelho de óxido de ferro. Por enquanto, construção.',
  },
  marsrock: {
    name: 'Rocha marciana', block: MARS_ROCK, traits: tr(1, 1, 0), tint: '#7f4c3c',
    about: 'Pedra de construção de Marte.',
  },
  darksand: {
    name: 'Areia escura', block: DARK_SAND, traits: tr(1, 0, 0), tint: '#4b3b3a',
    about: 'Areia basáltica das dunas. Construção (no futuro, vidro escuro).',
  },
  sediment: {
    name: 'Rocha sedimentar', block: SEDIMENT, traits: tr(1, 1, 0), tint: '#c99a72',
    about: 'Camadas depositadas pela água antiga. Construção.',
  },
  volcanic: {
    name: 'Basalto vulcânico', block: VOLCANIC, traits: tr(2, 2, 1), tint: '#5e4a46',
    about: 'Basalto do vulcão. No futuro, fibra de basalto em Marte.',
  },
  hematite: {
    name: 'Hematita', icon: { block: HEMATITE }, traits: tr(2, 2, 1), tint: '#5d6f8a',
    about: 'Fe₂O₃, o minério de ferro de Marte; forma-se na água. Amostra científica.',
  },
  olivine: {
    name: 'Olivina', icon: { block: OLIVINE }, traits: tr(3, 1, 1), tint: '#8fc34a',
    about: 'Mineral verde que aguenta calor (areia de fundição na Terra). Amostra científica.',
  },
  gypsum: {
    name: 'Gipsita', icon: { block: GYPSUM }, traits: tr(0, 1, 1), tint: '#f4efe6',
    about: 'CaSO₄·2H₂O: ~21% de água presa no cristal. Prova de água antiga.',
  },
  iron_bar: {
    name: 'Barra de ferro', icon: { model: 'ingot', color: '#b9bec9' }, traits: tr(2, 2, 1), tint: '#c9ced9',
    about: 'Ferro fundido e moldado. Base de ferramentas, brocas e máquinas.',
  },
  brick: {
    name: 'Tijolo de regolito', icon: { model: 'brick', color: '#c9b49a' }, traits: tr(3, 2, 0), tint: '#d6c2a6',
    about: 'Regolito sinterizado: os grãos se soldam sem derreter. Aguenta calor e impacto.',
  },
  glass: {
    name: 'Vidro', icon: { model: 'pane', color: '#9fe4f2' }, traits: tr(1, 0, 1), tint: '#bff4ff',
    about: 'Regolito fundido e resfriado rápido. Telas, visores e painéis solares.',
  },
  basalt_fiber: {
    name: 'Fibra de basalto', icon: { model: 'spool', color: '#6b6276' }, traits: tr(2, 1, 1), tint: '#a79fb4',
    about: 'Fios de basalto fundido. Reforço leve que aguenta calor: brocas e traje.',
  },
  h2: {
    name: 'Cilindro de H₂', icon: { model: 'tank', color: '#ff8a3d' }, traits: tr(0, 0, 1), tint: '#ffb27a', stack: 16,
    about: 'Hidrogênio da água. Reduz a ilmenita no forno; no futuro, combustível do foguete.',
  },
  o2: {
    name: 'Cilindro de O₂', icon: { model: 'tank', color: '#4fb8ff' }, traits: tr(0, 0, 1), tint: '#8fd6ff', stack: 16,
    about: 'Oxigênio de reserva: o traje conecta sozinho quando o ar fica em 15% longe da base.',
  },
  tio2: {
    name: 'Óxido de titânio', icon: { model: 'powder', color: '#eeeef2' }, traits: tr(3, 1, 2), tint: '#ffffff',
    about: 'TiO₂, pó branco que sobra da ilmenita. O eletrolisador tira o titânio dele.',
  },
  titanium: {
    name: 'Lingote de titânio', icon: { model: 'ingot', color: '#8d8fa8' }, traits: tr(3, 1, 3), tint: '#b8b6d6',
    about: 'Leve, duro e resistente ao calor. Brocas avançadas e, no futuro, o foguete.',
  },
  silicon: {
    name: 'Silício', icon: { model: 'wafer', color: '#5a6c8c' }, traits: tr(2, 0, 2), tint: '#9fb4dc',
    about: 'Tirado da sílica do regolito. Chips e células solares.',
  },
  circuit: {
    name: 'Placa de circuito', icon: { model: 'chip', color: '#2f8a5a' }, traits: tr(0, 0, 3), tint: '#7dffa8', stack: 16,
    about: 'Chip de silício com contatos de ouro. O cérebro do Mapa e das máquinas.',
  },
  solar_panel: {
    name: 'Painel solar', icon: { prop: 'solarPanel' }, place: 'solarPanel', traits: tr(1, 1, 2), tint: '#4f7fd8', stack: 8,
    about: 'Células de silício: transforma luz do sol em eletricidade para a base. Coloque no chão, ao sol e perto da base.',
  },
};

/** ordem de referência dos itens (ícones, conversão de salvamentos antigos) */
export const ITEM_ORDER: ItemId[] = [
  'regolith', 'rock', 'basalt', 'ice', 'iron', 'ilmenite', 'gold', 'crystal',
  'marsdust', 'marsrock', 'darksand', 'sediment', 'volcanic', 'hematite', 'olivine', 'gypsum',
  'iron_bar', 'brick', 'glass', 'basalt_fiber', 'h2', 'o2', 'tio2', 'titanium', 'silicon', 'circuit',
  'solar_panel',
];

export function isItemId(v: unknown): v is ItemId {
  return typeof v === 'string' && v in ITEMS;
}

export function stackSize(item: ItemId): number {
  return ITEMS[item].stack ?? STACK_SIZE;
}

/** bloco que representa o item visualmente (ícone e item solto), se houver */
export function itemBlock(item: ItemId): BlockId | undefined {
  const d = ITEMS[item];
  return d.block ?? d.icon?.block;
}
