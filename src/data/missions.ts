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
