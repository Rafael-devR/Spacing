// Teste de desempenho completo: cenários, efeitos e escalas como dados (docs/design/BENCHMARK.md, ADR 0007).
// O código do teste (src/bench/) só interpreta isto. Mudou um cenário? Suba BENCH_VERSION: resultados de versões
// diferentes não se comparam direto, e a tela de resultado avisa.
import { BLOCK_DATA, REGOLITH } from './blocks';
import { DRILLS, mineSeconds } from './drills';

/** versão do conjunto de cenários (4: os meteoros ganharam fogo, fumaça e onda de choque, o que pesa nos cenários com meteoro) */
export const BENCH_VERSION = 4;

export type BenchMode = 'quick' | 'full';

/** taxas de atualização-alvo, a principal primeiro (celular de 120 Hz) */
export const BENCH_TARGETS = [120, 60] as const;

/** segundos medindo os intervalos do requestAnimationFrame para descobrir a taxa da tela */
export const DETECT_SECONDS = 2;
/** quantos resultados ficam guardados no aparelho */
export const HISTORY_SIZE = 10;
/** minutos do teste de aquecimento (modo completo) */
export const THERMAL_MINUTES = 10;
/** segundos de cada minuto do teste de aquecimento */
export const THERMAL_MINUTE_SECONDS = 60;

/** O que o roteiro faz num cenário. Tudo opcional: o cenário "parado olhando" não faz nada. */
export interface BenchActions {
  /** blocos quebrados por segundo (cada um com os efeitos da mineração e um golpe de broca) */
  breakRate?: number;
  /** segundos entre meteoros (0 ou ausente = nenhum) */
  meteorEvery?: number;
  /** meteoros soltos de cada vez (padrão 1) */
  meteorCount?: number;
  /** caminhada em linha reta, em blocos por segundo (o astronauta normal anda a 4,6) */
  walk?: number;
  /** caminhada em círculo em volta do ponto de partida */
  circle?: { radius: number; speed: number };
  /** segundos por volta de 360° da câmera */
  spin?: number;
  /** zoom que entra e sai: oscila entre `min` e `max` (distância da câmera) a cada `period` segundos */
  zoom?: { period: number; min: number; max: number };
  /** itens soltos voando até o astronauta: a cada `every` segundos, `count` itens */
  items?: { every: number; count: number };
  /** abre e fecha o mapa do tablet a cada `period` segundos */
  mapEvery?: number;
  /** entra e sai da base, repetidamente */
  baseCycle?: boolean;
  /** partículas soltas por segundo (carga constante para medir efeitos) */
  emit?: number;
}

export interface BenchScenario {
  id: string;
  /** segundos medidos em cada modo (ausente = o cenário não roda nesse modo) */
  seconds: Partial<Record<BenchMode, number>>;
  /** segundos iniciais descartados (o roteiro já roda: compila shaders, carrega chunks). Padrão: 2 */
  warmup?: number;
  /** onde o cenário começa: numa região fixa e virgem, ou na porta da base */
  origin: 'region' | 'base';
  actions: BenchActions;
}

/** quantos blocos por segundo a broca de cristal quebra sem parar (regolito: dureza ÷ velocidade da broca) */
export const CRYSTAL_BREAK_RATE = 1 / mineSeconds(DRILLS.crystal, BLOCK_DATA[REGOLITH].hardness);

/**
 * Os cenários, na ordem em que rodam. Os cinco primeiros são os do teste anterior; "preparar a região" não descarta o
 * começo (carregar a região é justamente o que ele mede).
 */
export const BENCH_SCENARIOS: BenchScenario[] = [
  { id: 'prepare', warmup: 0, seconds: { quick: 4, full: 6 }, origin: 'region', actions: {} },
  { id: 'mining', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { breakRate: 30 } },
  { id: 'meteors', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { breakRate: 6, meteorEvery: 0.9 } },
  { id: 'walk', seconds: { quick: 6, full: 12 }, origin: 'region', actions: { walk: 26 } },
  { id: 'everything', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { walk: 9, breakRate: 20, meteorEvery: 1.1 } },
  { id: 'idle', seconds: { quick: 4, full: 8 }, origin: 'region', actions: {} },
  { id: 'spin', seconds: { quick: 5, full: 10 }, origin: 'region', actions: { spin: 5 } },
  { id: 'zoom', seconds: { quick: 6, full: 12 }, origin: 'region', actions: { zoom: { period: 6, min: 16, max: 46 } } },
  { id: 'circle', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { circle: { radius: 14, speed: 9 } } },
  { id: 'crystal', seconds: { quick: 6, full: 30 }, origin: 'region', actions: { breakRate: CRYSTAL_BREAK_RATE } },
  { id: 'explosion', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { meteorEvery: 2.5, meteorCount: 3 } },
  { id: 'map', seconds: { quick: 6, full: 10 }, origin: 'region', actions: { mapEvery: 3 } },
  { id: 'base', seconds: { quick: 12, full: 16 }, origin: 'base', actions: { baseCycle: true } },
  { id: 'items', seconds: { quick: 5, full: 10 }, origin: 'region', actions: { items: { every: 1.2, count: 60 } } },
  // tudo junto, andando, por 60 s no modo completo
  {
    id: 'worst',
    seconds: { quick: 12, full: 60 },
    origin: 'region',
    actions: { walk: 14, breakRate: 30, meteorEvery: 0.7, meteorCount: 2, items: { every: 2, count: 40 } },
  },
];

/** carga de cada minuto do teste de aquecimento: pesada e constante, igual em todos os minutos */
export const THERMAL_SCENARIO: BenchScenario = {
  id: 'thermal',
  seconds: { full: THERMAL_MINUTE_SECONDS },
  warmup: 0,
  origin: 'region',
  actions: { circle: { radius: 16, speed: 10 }, breakRate: 10, meteorEvery: 1.5 },
};

/**
 * Carga das etapas de efeitos e de resolução: o astronauta parado, com partículas e destroços constantes. Parado,
 * qualquer diferença de custo vem do efeito ligado ou desligado, não do que acontece na cena.
 */
export const MATRIX_SCENARIO: BenchScenario = { id: 'matrix', seconds: { full: 2 }, warmup: 1, origin: 'region', actions: { emit: 200 } };

/** carga da curva de resolução: a do cenário "tudo ao mesmo tempo" (um jogo de verdade), por 4 s */
export const RESOLUTION_SCENARIO: BenchScenario = {
  id: 'resolution',
  seconds: { full: 4 },
  warmup: 2,
  origin: 'region',
  actions: { walk: 9, breakRate: 20, meteorEvery: 1.1 },
};

/** segundos a mais de aquecimento no primeiro passo das comparações (a região volta a ser carregada) */
export const MATRIX_PREROLL = 2;

export type EffectId = 'bloom' | 'msaa' | 'shadow' | 'chromatic' | 'vignette' | 'noise' | 'fog' | 'glow' | 'particles';

export interface BenchEffect {
  id: EffectId;
  /** como é ligado e desligado só dentro do teste (docs/design/BENCHMARK.md) */
  method: 'post-preset' | 'grade-shader' | 'renderer' | 'scene' | 'material-define' | 'visibility';
}

/** Os efeitos medidos, um por vez, ligados e desligados. Nenhum é removido do jogo: o teste só os alterna na memória. */
export const BENCH_EFFECTS: BenchEffect[] = [
  { id: 'bloom', method: 'post-preset' },
  { id: 'msaa', method: 'post-preset' },
  { id: 'shadow', method: 'renderer' },
  { id: 'chromatic', method: 'grade-shader' },
  { id: 'vignette', method: 'grade-shader' },
  { id: 'noise', method: 'grade-shader' },
  { id: 'fog', method: 'scene' },
  { id: 'glow', method: 'material-define' },
  { id: 'particles', method: 'visibility' },
];

/** escalas de resolução, em relação ao tamanho atual do desenho */
export const RESOLUTION_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** primeiro ponto de partida do teste (blocos): longe da base e da sonda; cada cenário usa o seu, a ORIGIN_STEP do anterior */
export const BENCH_ORIGIN = { x: 520, z: 520 };
export const BENCH_ORIGIN_STEP = 400;
/** direção das caminhadas em linha reta (é normalizada) */
export const BENCH_HEADING = { x: 1, z: 0.4 };
/** raio, em volta do astronauta, onde os blocos são quebrados */
export const BENCH_BREAK_RADIUS = 5;
/** semente do sorteio dos blocos quebrados */
export const BENCH_SEED = 20261111;

/** Duração planejada (segundos) de um modo: aquecimentos e medidas, sem a detecção da taxa de atualização. */
export function plannedSeconds(mode: BenchMode, scale = 1): number {
  let s = 0;
  for (const sc of BENCH_SCENARIOS) {
    const sec = sc.seconds[mode];
    if (sec === undefined) continue;
    s += (sec + (sc.warmup ?? 2)) * scale;
  }
  if (mode === 'full') {
    const step = (sc: BenchScenario): number => ((sc.seconds.full ?? 0) + (sc.warmup ?? 2)) * scale;
    s += step(MATRIX_SCENARIO) * (1 + BENCH_EFFECTS.length * 2) + MATRIX_PREROLL * scale; // linha de base e cada efeito ligado e desligado
    s += step(RESOLUTION_SCENARIO) * RESOLUTION_SCALES.length;
    s += THERMAL_MINUTES * step(THERMAL_SCENARIO);
  }
  return s;
}
