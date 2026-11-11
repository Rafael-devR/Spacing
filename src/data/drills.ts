// Brocas do astronauta (docs/design/BROCAS.md). Uma broca tem velocidade, nível e gasto de bateria.
// O nível diz que blocos e minérios ela consegue quebrar: o alvo tem um nível mínimo (`tier` em blocks.ts e
// props.ts). Brocas melhores são equipamentos fabricados na bancada (data/equipment.ts e recipes.ts).
// Nova broca = uma entrada aqui, uma em equipment.ts e uma receita.

export type DrillId = 'basic' | 'iron' | 'crystal';

export interface DrillData {
  id: DrillId;
  name: string;
  /** texto curto da bancada */
  description: string;
  /** quebra alvos de nível até este */
  tier: number;
  /** multiplicador da velocidade de mineração (1 = broca inicial) */
  speed: number;
  /** multiplicador do gasto de bateria */
  drain: number;
  /** cor da ponta no astronauta e no ícone */
  bit: string;
  /** brilho da ponta (hex); ausente = sem brilho */
  glow?: string;
  /** tamanho da ponta no astronauta */
  bitScale: number;
}

export const DRILLS: Record<DrillId, DrillData> = {
  basic: {
    id: 'basic',
    name: 'Broca de regolito',
    description: 'A broca do traje. Quebra regolito, rocha, gelo e ferro.',
    tier: 0,
    speed: 1,
    drain: 1,
    bit: '#ffb03a',
    bitScale: 1,
  },
  iron: {
    id: 'iron',
    name: 'Broca de ferro',
    description: 'Ponta de ferro temperado: quebra 1,7 vez mais rápido e abre basalto, cristal e ilmenita.',
    tier: 1,
    speed: 1.7,
    drain: 1.15,
    bit: '#c9ced9',
    bitScale: 1.2,
  },
  crystal: {
    id: 'crystal',
    name: 'Broca de cristal',
    description: 'Ponta de cristal lunar: 2,6 vezes mais rápida e a única que corta ouro. Gasta mais bateria.',
    tier: 2,
    speed: 2.6,
    drain: 1.35,
    bit: '#8ff1ff',
    glow: '#2a8fa8',
    bitScale: 1.4,
  },
};

/** da mais fraca para a mais forte */
export const DRILL_ORDER: DrillId[] = ['basic', 'iron', 'crystal'];

/** a broca mais fraca que quebra alvos desse nível */
export function drillForTier(tier: number): DrillData {
  for (const id of DRILL_ORDER) if (DRILLS[id].tier >= tier) return DRILLS[id];
  return DRILLS[DRILL_ORDER[DRILL_ORDER.length - 1]];
}

/** segundos a menos ou a mais: tempo real para quebrar um alvo de dureza `hardness` com a broca */
export function mineSeconds(drill: DrillData, hardness: number): number {
  return hardness / drill.speed;
}
