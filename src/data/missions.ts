// Missões como dados (ADR 0004). A cadeia abaixo é a provisória da v0.1; a história de verdade
// entra na v0.6 (docs/STORY.md). O sistema em systems/Missions.ts só interpreta estes dados.
import type { ItemId } from './items';
import type { PropType } from './props';

interface StepBase {
  id: string;
  title: string;
  text: string;
  /** dica mostrada quando o objetivo começa */
  hint?: string;
}

export type MissionStep =
  | (StepBase & { kind: 'collect'; item: ItemId; n: number })
  /** chegar perto de um objeto (hoje só o meteorito, que cai quando o passo começa) */
  | (StepBase & { kind: 'reach'; prop: PropType })
  /** minerar um objeto */
  | (StepBase & { kind: 'prop'; prop: PropType })
  /** levar itens ao módulo de pouso */
  | (StepBase & { kind: 'deliver'; needs: Partial<Record<ItemId, number>> })
  | (StepBase & { kind: 'end' });

export const MISSION_01: MissionStep[] = [
  {
    id: 'regolith', kind: 'collect', item: 'regolith', n: 8,
    title: 'Primeiros passos', text: 'Colete regolito da superfície',
    hint: 'Segure em cima de um bloco claro da superfície para minerar.',
  },
  {
    id: 'ice', kind: 'collect', item: 'ice', n: 3,
    title: 'Água congelada', text: 'Encontre gelo no fundo de uma cratera',
    hint: 'O gelo fica nas partes mais baixas, onde a névoa se acumula.',
  },
  {
    id: 'iron', kind: 'collect', item: 'iron', n: 4,
    title: 'Metal para reparos', text: 'Colete minério de ferro',
    hint: 'Blocos com pepitas laranja. Cave para baixo para achar mais.',
  },
  {
    id: 'meteor', kind: 'reach', prop: 'meteorite',
    title: 'Impacto!', text: 'Investigue o meteorito que caiu',
    hint: 'Siga o feixe azul.',
  },
  {
    id: 'sample', kind: 'prop', prop: 'meteorite',
    title: 'Amostra do espaço', text: 'Minere o meteorito',
    hint: 'Ele é duro: segure por mais tempo.',
  },
  {
    id: 'repair', kind: 'deliver', needs: { rock: 6, iron: 4, crystal: 3 },
    title: 'Reparar o módulo', text: 'Leve os materiais ao módulo de pouso',
    hint: 'Chegue perto do módulo com tudo no inventário.',
  },
  {
    id: 'done', kind: 'end',
    title: 'Sinal enviado', text: 'Módulo reparado. Próxima missão: construir um foguete.',
  },
];

/** Marte (provisório, docs/design/MARTE.md): minerais que contam a história da água e do vulcão */
export const MISSION_MARS: MissionStep[] = [
  {
    id: 'mdust', kind: 'collect', item: 'marsdust', n: 8,
    title: 'Chão vermelho', text: 'Colete poeira marciana',
    hint: 'A cor vem do óxido de ferro: Marte é, literalmente, enferrujado.',
  },
  {
    id: 'hematite', kind: 'collect', item: 'hematite', n: 4,
    title: 'Esferas de hematita', text: 'Ache as esferas escuras no chão ou a hematita nas rochas',
    hint: 'Bolinhas escuras soltas na poeira. O Opportunity achou iguais em 2004: elas se formam na água.',
  },
  {
    id: 'gypsum', kind: 'collect', item: 'gypsum', n: 3,
    title: 'Veios brancos', text: 'Colete gipsita nas paredes do cânion',
    hint: 'O cânion fica ao sul do módulo. Os veios brancos nas camadas são sinal de água antiga.',
  },
  {
    id: 'olivine', kind: 'collect', item: 'olivine', n: 3,
    title: 'Pedras verdes', text: 'Colete olivina no basalto do vulcão',
    hint: 'O vulcão fica a noroeste. Cuidado com a lava: ela queima o traje.',
  },
  {
    id: 'samples', kind: 'deliver', needs: { hematite: 4, gypsum: 3, olivine: 3 },
    title: 'Amostras para casa', text: 'Leve as amostras ao módulo de pouso',
    hint: 'Chegue perto do módulo com tudo no inventário.',
  },
  {
    id: 'done', kind: 'end',
    title: 'Amostras analisadas', text: 'A água esteve aqui. Próximo passo: um abrigo em Marte.',
  },
];
