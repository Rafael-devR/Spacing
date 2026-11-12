// Planetas como dados (docs/design/MARTE.md): tudo o que muda de um planeta para o outro sem mudar o código.
export type PlanetId = 'lua' | 'marte';

export interface PlanetDef {
  id: PlanetId;
  name: string;
  /** semente do mundo (mudar invalida o salvamento do planeta) */
  seed: number;
  /** chave do salvamento no localStorage: cada planeta tem o seu */
  saveKey: string;
  /** região, mostrada na tela inicial e na pausa */
  region: string;
  pitch: string;
  sky: {
    top: string;
    bottom: string;
    /** estrelas no céu (dia em Marte: não) */
    stars: boolean;
    /** as duas luas de Marte no céu */
    moons: boolean;
    /** névoa baixa nas crateras */
    mist: string;
  };
  light: { sky: string; ground: string; hemi: number; sun: string; sunPower: number };
  physics: {
    /** gravidade do astronauta (blocos/s²) e impulso do pulo */
    gravity: number;
    jump: number;
    /** queda: sem dano até esta velocidade */
    fallSafeSpeed: number;
    /** pedaços de bloco e lascas */
    debrisGravity: number;
    /** freio do ar nos pedaços (por segundo; 0 = vácuo) */
    debrisDrag: number;
    /** itens caídos na morte */
    lootGravity: number;
  };
  /** atmosfera: som abafado e vento ao fundo */
  air: boolean;
  /** quanto tempo uma pegada fica no chão (s) */
  footprintLife: number;
  footprintColor: [number, number, number];
}

export const PLANETS: Record<PlanetId, PlanetDef> = {
  lua: {
    id: 'lua',
    name: 'Lua',
    seed: 20261111,
    saveKey: 'spacing.save',
    region: 'Missão 01 · Cratera Shackleton',
    pitch: 'Seu módulo pousou no polo sul da Lua. Minere regolito, gelo e minérios, construa com blocos e prepare o caminho para um planeta com vida.',
    sky: { top: '#1a1636', bottom: '#5d4f86', stars: true, moons: false, mist: '#8b8fd8' },
    light: { sky: '#a39ae6', ground: '#5b4a44', hemi: 1.55, sun: '#fff0dc', sunPower: 3.3 },
    physics: { gravity: 15, jump: 7.4, fallSafeSpeed: 14, debrisGravity: 0.45, debrisDrag: 0, lootGravity: 9 },
    air: false,
    footprintLife: 45,
    footprintColor: [0.1, 0.085, 0.14],
  },
  marte: {
    id: 'marte',
    name: 'Marte',
    seed: 20261112,
    saveKey: 'spacing.save.marte',
    region: 'Expedição Marte · Elysium Planitia',
    pitch: 'Seu módulo pousou em Elysium Planitia, perto de Cerberus Fossae. Poeira vermelha, tempestades, redemoinhos, minerais que contam a história da água e um vulcão que ainda não dormiu.',
    sky: { top: '#a8674a', bottom: '#e2b48a', stars: false, moons: true, mist: '#d39a72' },
    light: { sky: '#e2bca2', ground: '#5c3426', hemi: 1.45, sun: '#fff0e2', sunPower: 2.9 },
    physics: { gravity: 30, jump: 9.2, fallSafeSpeed: 16, debrisGravity: 3.5, debrisDrag: 0.6, lootGravity: 13 },
    air: true,
    footprintLife: 240,
    footprintColor: [0.16, 0.05, 0.03],
  },
};

export function isPlanetId(v: unknown): v is PlanetId {
  return v === 'lua' || v === 'marte';
}
