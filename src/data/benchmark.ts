// Cenário do teste de desempenho (docs/design/DESEMPENHO.md). O teste roda sozinho, sempre igual, numa região fixa e
// longe da base, e mede o que mais pesa no jogo. Mudar os números aqui muda o que o teste mede: resultados de
// versões diferentes do cenário não são comparáveis, então mexa nisto só junto com `BENCH_SCENARIO`.

/** versão do cenário: sobe quando as etapas ou os números mudam */
export const BENCH_SCENARIO = 1;

/** onde o teste começa (blocos): região fixa, longe da base e da sonda, para o mundo carregado ser sempre o mesmo */
export const BENCH_START = { x: 520, z: 520 };
/** para onde o astronauta anda nas etapas de caminhada (vetor; é normalizado) */
export const BENCH_HEADING = { x: 1, z: 0.4 };
/** raio, em volta do astronauta, onde os blocos são quebrados */
export const BENCH_BREAK_RADIUS = 5;
/** semente do sorteio dos blocos quebrados: o teste quebra sempre a mesma sequência */
export const BENCH_SEED = 20261111;

export type BenchPhaseId = 'warmup' | 'mining' | 'meteors' | 'walk' | 'everything';

export interface BenchPhase {
  id: BenchPhaseId;
  /** duração em segundos (tempo real) */
  seconds: number;
  /** blocos quebrados por segundo */
  breakRate: number;
  /** segundos entre meteoros (0 = nenhum) */
  meteorEvery: number;
  /** velocidade de caminhada em blocos por segundo (0 = parado); o astronauta normal anda a 4,6 */
  walk: number;
}

export const BENCH_PHASES: BenchPhase[] = [
  // carrega a região, compila shaders e deixa o jogo estabilizar
  { id: 'warmup', seconds: 3, breakRate: 0, meteorEvery: 0, walk: 0 },
  // muitos blocos quebrados rápido: destroços, partículas, itens voando até o astronauta, som, tremor, malhas refeitas
  { id: 'mining', seconds: 12, breakRate: 30, meteorEvery: 0, walk: 0 },
  // meteoros caindo (rastro, luz, cratera, explosão de destroços) por cima de tudo que ficou no ar
  { id: 'meteors', seconds: 10, breakRate: 6, meteorEvery: 0.9, walk: 0 },
  // caminhada a quase 6 vezes a velocidade normal: força a geração de chunks novos o tempo todo
  { id: 'walk', seconds: 14, breakRate: 0, meteorEvery: 0, walk: 26 },
  // tudo junto: andando, quebrando blocos e com meteoros
  { id: 'everything', seconds: 12, breakRate: 20, meteorEvery: 1.1, walk: 9 },
];

/** duração total do cenário completo, em segundos */
export const BENCH_SECONDS = BENCH_PHASES.reduce((s, p) => s + p.seconds, 0);

/** limites (ms) para contar quadros ruins: 33 ms = abaixo de 30 FPS, 50 ms = 20 FPS, 100 ms = travada */
export const HITCH_MS = [33.4, 50, 100] as const;
/** quantos dos piores quadros guardar */
export const WORST_FRAMES = 5;
