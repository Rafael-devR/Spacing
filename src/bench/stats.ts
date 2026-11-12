// Estatísticas do teste de desempenho (docs/design/BENCHMARK.md). Funções puras: sem DOM, sem three.js, sem estado,
// para poderem ser testadas. Todos os tempos em milissegundos, salvo dito o contrário.

/** taxas de atualização de tela reconhecidas (Hz) */
export const REFRESH_RATES = [60, 90, 120, 144] as const;

/** média (0 se vazio) */
export function mean(v: ArrayLike<number>): number {
  const n = v.length;
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i];
  return s / n;
}

/** cópia ordenada (numericamente, do menor para o maior) */
export function sorted(v: ArrayLike<number>): Float64Array {
  return Float64Array.from(v as ArrayLike<number>).sort();
}

/** percentil `p` (0..1) de uma lista JÁ ORDENADA, pelo método do posto mais próximo (sem interpolar) */
export function percentile(sortedValues: ArrayLike<number>, p: number): number {
  const n = sortedValues.length;
  if (!n) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sortedValues[i];
}

/** mediana de uma lista JÁ ORDENADA (média dos dois do meio se o tamanho for par) */
export function median(sortedValues: ArrayLike<number>): number {
  const n = sortedValues.length;
  if (!n) return 0;
  const m = n >> 1;
  return n % 2 ? sortedValues[m] : (sortedValues[m - 1] + sortedValues[m]) / 2;
}

/** desvio padrão (da população) */
export function stddev(v: ArrayLike<number>): number {
  const n = v.length;
  if (n < 2) return 0;
  const m = mean(v);
  let s = 0;
  for (let i = 0; i < n; i++) s += (v[i] - m) * (v[i] - m);
  return Math.sqrt(s / n);
}

/**
 * Jitter: a média da diferença (em módulo) entre quadros consecutivos. Um 60 FPS perfeito tem jitter 0; um que mistura
 * quadros de 8,3 e 25 ms tem jitter alto mesmo com a média certa.
 */
export function jitter(intervals: ArrayLike<number>): number {
  const n = intervals.length;
  if (n < 2) return 0;
  let s = 0;
  for (let i = 1; i < n; i++) s += Math.abs(intervals[i] - intervals[i - 1]);
  return s / (n - 1);
}

export interface RefreshDetection {
  /** taxa reconhecida mais próxima da medida (Hz) */
  hz: number;
  /** taxa medida, sem arredondar (Hz) */
  rawHz: number;
  /** mediana dos intervalos (ms) */
  medianMs: number;
  /** período de um quadro na taxa reconhecida (ms) */
  budgetMs: number;
  /** intervalos usados */
  samples: number;
}

/**
 * Taxa de atualização da tela a partir dos intervalos do requestAnimationFrame: mediana dos intervalos, convertida em Hz
 * e arredondada para a taxa conhecida mais próxima (em Hz). A mediana ignora os quadros perdidos do começo.
 */
export function detectRefreshRate(intervalsMs: ArrayLike<number>, rates: readonly number[] = REFRESH_RATES): RefreshDetection {
  const s = sorted(Array.from(intervalsMs as ArrayLike<number>).filter((v) => v > 0 && Number.isFinite(v)));
  const med = median(s);
  const rawHz = med > 0 ? 1000 / med : 0;
  let hz = rates[0];
  for (const r of rates) if (Math.abs(r - rawHz) < Math.abs(hz - rawHz)) hz = r;
  return { hz, rawHz, medianMs: med, budgetMs: 1000 / hz, samples: s.length };
}

/** período de um quadro (ms) numa taxa (Hz) */
export const budgetOf = (hz: number): number => 1000 / hz;

/** Quadros perdidos: intervalo maior que `factor` vezes o período do alvo (1,5 por padrão). */
export function framesLost(intervals: ArrayLike<number>, periodMs: number, factor = 1.5): number {
  let n = 0;
  const limit = periodMs * factor;
  for (let i = 0; i < intervals.length; i++) if (intervals[i] > limit) n++;
  return n;
}

/** A sequência mais longa de quadros seguidos acima do limite (`factor` × período). */
export function longestOffTarget(intervals: ArrayLike<number>, periodMs: number, factor = 1.5): number {
  let best = 0, run = 0;
  const limit = periodMs * factor;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] > limit) best = Math.max(best, ++run);
    else run = 0;
  }
  return best;
}

/** faixas do histograma de tempo de quadro, em ms: [0,a) [a,b) … [z,∞) */
export const HISTOGRAM_EDGES = [6, 10, 14, 18, 22, 26, 34, 50, 100] as const;

/** Conta quantos valores caem em cada faixa: `edges.length + 1` contagens, a última aberta (≥ último limite). */
export function histogram(values: ArrayLike<number>, edges: readonly number[] = HISTOGRAM_EDGES): number[] {
  const out = new Array<number>(edges.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) {
    let b = 0;
    while (b < edges.length && values[i] >= edges[b]) b++;
    out[b]++;
  }
  return out;
}

/** rótulo de cada faixa do histograma ("< 6", "6–10", …, "≥ 100") */
export function histogramLabels(edges: readonly number[] = HISTOGRAM_EDGES): string[] {
  const labels = [`< ${edges[0]}`];
  for (let i = 1; i < edges.length; i++) labels.push(`${edges[i - 1]}–${edges[i]}`);
  labels.push(`≥ ${edges[edges.length - 1]}`);
  return labels;
}

export interface Pacing {
  /** % de quadros cujo intervalo é um múltiplo inteiro do período do vsync (dentro da tolerância) */
  alignedPct: number;
  /** o múltiplo mais comum (2 = um quadro novo a cada 2 vsyncs: 60 FPS numa tela de 120 Hz) */
  dominantMultiple: number;
  /** % de quadros no múltiplo mais comum: mede a regularidade do ritmo */
  regularPct: number;
  /** quantos quadros houve em cada múltiplo (índice 0 = 1 vsync, 1 = 2 vsyncs … o último junta os maiores) */
  multiples: number[];
  /** média da variação do múltiplo entre quadros consecutivos (0 = ritmo constante) */
  switchMean: number;
  /** o ritmo é regular: quase todos os quadros no mesmo múltiplo */
  regular: boolean;
}

/** maior múltiplo contado em `Pacing.multiples` (acima disso, junta tudo no último) */
export const PACING_MAX_MULTIPLE = 8;

/**
 * Pacing: como os quadros se distribuem no tempo em relação ao vsync da tela (`vsyncMs` = período real da tela).
 * - `alignedPct`: quantos intervalos são múltiplos inteiros do vsync (±`tol` de um período). Intervalos que não são
 *   múltiplos mostram um relógio que não está preso ao vsync.
 * - `regularPct`: quantos quadros estão no múltiplo mais comum. Numa tela de 120 Hz, um 60 FPS fluido tem todos os
 *   quadros em 2 vsyncs (16,7 ms): regularPct ≈ 100%. Um 60 FPS irregular mistura 1, 2 e 3 vsyncs (8,3, 16,7 e 25 ms):
 *   também fica alinhado, mas com regularPct baixo e `switchMean` alto. É isso que separa os dois casos.
 */
export function pacing(intervals: ArrayLike<number>, vsyncMs: number, tol = 0.2): Pacing {
  const n = intervals.length;
  const multiples = new Array<number>(PACING_MAX_MULTIPLE).fill(0);
  if (!n || vsyncMs <= 0) return { alignedPct: 0, dominantMultiple: 0, regularPct: 0, multiples, switchMean: 0, regular: false };
  let aligned = 0, switches = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const ratio = intervals[i] / vsyncMs;
    const k = Math.max(1, Math.round(ratio));
    if (Math.abs(ratio - k) <= tol) aligned++;
    multiples[Math.min(k, PACING_MAX_MULTIPLE) - 1]++;
    if (i) switches += Math.abs(k - prev);
    prev = k;
  }
  let dom = 0;
  for (let k = 1; k < PACING_MAX_MULTIPLE; k++) if (multiples[k] > multiples[dom]) dom = k;
  const regularPct = (multiples[dom] / n) * 100;
  return {
    alignedPct: (aligned / n) * 100,
    dominantMultiple: dom + 1,
    regularPct,
    multiples,
    switchMean: n > 1 ? switches / (n - 1) : 0,
    regular: regularPct >= 90,
  };
}

/** FPS efetivo: quadros por segundo que o jogo realmente entregou (quadros ÷ tempo). */
export function fpsEffective(intervals: ArrayLike<number>): number {
  const m = mean(intervals);
  return m > 0 ? 1000 / m : 0;
}

/**
 * FPS apresentado: quantas imagens diferentes a tela mostra por segundo, se cada quadro só aparece no vsync seguinte ao
 * fim do seu intervalo: um quadro de 11,7 ms numa tela de 120 Hz (8,3 ms) passou de um vsync e ocupa dois. É a taxa da
 * tela dividida pela média dos vsyncs ocupados (`tol` de um período de folga para o ruído do relógio).
 *
 * Numa tela em que o requestAnimationFrame já vem alinhado ao vsync, os intervalos são múltiplos exatos e o apresentado
 * coincide com o efetivo; ele só fica abaixo quando os intervalos caem entre dois vsyncs (relógio sem vsync, GPU atrasada).
 */
export function fpsPresented(intervals: ArrayLike<number>, vsyncMs: number, tol = 0.2): number {
  const n = intervals.length;
  if (!n || vsyncMs <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.max(1, Math.ceil(intervals[i] / vsyncMs - tol));
  return 1000 / vsyncMs / (s / n);
}

export interface FrameStats {
  frames: number;
  seconds: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  stdMs: number;
  jitterMs: number;
  minMs: number;
  maxMs: number;
  fpsEffective: number;
}

/** Estatísticas de tempo de quadro de uma lista de intervalos (ms). */
export function frameStats(intervals: ArrayLike<number>): FrameStats {
  const n = intervals.length;
  if (!n) return { frames: 0, seconds: 0, meanMs: 0, medianMs: 0, p95Ms: 0, p99Ms: 0, p999Ms: 0, stdMs: 0, jitterMs: 0, minMs: 0, maxMs: 0, fpsEffective: 0 };
  const s = sorted(intervals);
  let total = 0;
  for (let i = 0; i < n; i++) total += intervals[i];
  return {
    frames: n,
    seconds: total / 1000,
    meanMs: total / n,
    medianMs: median(s),
    p95Ms: percentile(s, 0.95),
    p99Ms: percentile(s, 0.99),
    p999Ms: percentile(s, 0.999),
    stdMs: stddev(intervals),
    jitterMs: jitter(intervals),
    minMs: s[0],
    maxMs: s[n - 1],
    fpsEffective: total > 0 ? (n * 1000) / total : 0,
  };
}

export interface TargetFluidity {
  targetHz: number;
  periodMs: number;
  lost: number;
  lostPct: number;
  longestOff: number;
  /** % de quadros dentro de 1,5× o período */
  onTargetPct: number;
  /** FPS efetivo em % do alvo (100 = alcança o alvo) */
  fpsPct: number;
  /** sustenta o alvo: p99 dentro de 1,5× o período, até 1% de quadros perdidos e FPS efetivo ≥ 95% do alvo */
  sustains: boolean;
}

/** Fluidez em relação a um alvo (120 ou 60 Hz): quadros perdidos, maior sequência ruim e se o alvo é sustentado. */
export function targetFluidity(intervals: ArrayLike<number>, targetHz: number): TargetFluidity {
  const periodMs = budgetOf(targetHz);
  const n = intervals.length;
  const lost = framesLost(intervals, periodMs);
  const lostPct = n ? (lost / n) * 100 : 0;
  const fps = fpsEffective(intervals);
  const p99 = n ? percentile(sorted(intervals), 0.99) : 0;
  return {
    targetHz,
    periodMs,
    lost,
    lostPct,
    longestOff: longestOffTarget(intervals, periodMs),
    onTargetPct: n ? 100 - lostPct : 0,
    fpsPct: targetHz > 0 ? (fps / targetHz) * 100 : 0,
    sustains: n > 0 && p99 <= periodMs * 1.5 && lostPct <= 1 && fps >= targetHz * 0.95,
  };
}

/**
 * Reduz uma série de tempos de quadro a pontos de `bucketMs` em `bucketMs` de tempo decorrido, guardando a média e o
 * máximo de cada ponto: dá para desenhar o gráfico sem guardar todos os quadros.
 */
export function bucketSeries(intervals: ArrayLike<number>, bucketMs: number): { avg: number[]; max: number[] } {
  const avg: number[] = [], max: number[] = [];
  if (!intervals.length || bucketMs <= 0) return { avg, max };
  let t = 0, sum = 0, count = 0, top = 0, edge = bucketMs;
  for (let i = 0; i < intervals.length; i++) {
    t += intervals[i];
    sum += intervals[i];
    count++;
    if (intervals[i] > top) top = intervals[i];
    if (t >= edge) {
      avg.push(round1(sum / count));
      max.push(round1(top));
      sum = count = top = 0;
      edge += bucketMs;
    }
  }
  if (count) {
    avg.push(round1(sum / count));
    max.push(round1(top));
  }
  return { avg, max };
}

export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** inclinação da reta que melhor passa pelos pontos (mínimos quadrados): para ver se o FPS cai ao longo dos minutos */
export function slope(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(Array.from(xs).slice(0, n)), my = mean(Array.from(ys).slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den > 0 ? num / den : 0;
}

export type Verdict = 'better' | 'worse' | 'same';

export interface Comparison {
  diff: number;
  /** variação relativa ao anterior (0,1 = 10% a mais); null se o anterior era 0 */
  pct: number | null;
  verdict: Verdict;
}

/**
 * Compara o resultado de agora com o anterior. `higherIsBetter`: FPS sim, milissegundos não. Variações dentro de
 * `tolerance` (2%) contam como iguais: ruído de medição.
 */
export function compare(now: number, before: number, higherIsBetter: boolean, tolerance = 0.02): Comparison {
  const diff = now - before;
  const pct = before !== 0 ? diff / Math.abs(before) : null;
  const rel = pct ?? (diff === 0 ? 0 : Math.sign(diff));
  if (Math.abs(rel) <= tolerance) return { diff, pct, verdict: 'same' };
  return { diff, pct, verdict: diff > 0 === higherIsBetter ? 'better' : 'worse' };
}

/** Maior valor de `xs` cujo `ok` é verdadeiro e todos os menores também (para achar até que escala o aparelho sustenta o alvo). */
export function highestSustained(xs: readonly number[], ok: readonly boolean[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (!ok[i]) break;
    best = xs[i];
  }
  return best;
}

/** Quanto tempo a tela ficou em cada taxa durante o teste (telas adaptativas mudam entre 60 e 120 Hz). */
export interface RefreshObserved {
  /** segundos observados em cada taxa reconhecida (só as que apareceram) */
  seconds: { hz: number; seconds: number; pct: number }[];
  totalSeconds: number;
  /** a maior taxa vista (com pelo menos 2 s) */
  peakHz: number;
  /** % do tempo abaixo da maior taxa vista */
  belowPeakPct: number;
  /** a taxa de cada janela de 1 s, em ordem (para ver quando a tela caiu) */
  timeline: number[];
  /** o veredito de 120 Hz é confiável: a tela ficou em 90 Hz ou mais em pelo menos 90% do tempo */
  reliable120: boolean;
}

/**
 * Acompanha a taxa da tela durante o teste inteiro. A cada janela de `windowMs`, a taxa vem dos quadros MAIS RÁPIDOS da
 * janela (percentil 10 dos intervalos): se a tela está em 120 Hz, aparecem quadros de 8,3 ms mesmo que alguns se atrasem;
 * se só há quadros de 16,7 ms, a tela está em 60 Hz (ou o jogo não passa de 60, o que a página não distingue).
 */
export class RefreshTracker {
  private buf: number[] = [];
  private acc = 0;
  private readonly secs = new Map<number, number>();
  private readonly line: number[] = [];

  constructor(private readonly windowMs = 1000) {}

  push(intervalMs: number): void {
    if (!(intervalMs > 0)) return;
    this.buf.push(intervalMs);
    this.acc += intervalMs;
    if (this.acc >= this.windowMs) this.flush();
  }

  private flush(): void {
    if (this.buf.length >= 3) {
      const p10 = percentile(sorted(this.buf), 0.1);
      const hz = detectRefreshRate([p10]).hz;
      this.secs.set(hz, (this.secs.get(hz) ?? 0) + this.acc / 1000);
      this.line.push(hz);
    }
    this.buf = [];
    this.acc = 0;
  }

  result(): RefreshObserved {
    const total = [...this.secs.values()].reduce((a, b) => a + b, 0);
    const seconds = [...this.secs.entries()].sort((a, b) => b[0] - a[0]).map(([hz, s]) => ({ hz, seconds: round1(s), pct: total ? round1((100 * s) / total) : 0 }));
    const peak = seconds.find((x) => x.seconds >= 2)?.hz ?? seconds[0]?.hz ?? 0;
    const above = seconds.filter((x) => x.hz >= 90).reduce((a, x) => a + x.seconds, 0);
    const below = total ? (100 * seconds.filter((x) => x.hz < peak).reduce((a, x) => a + x.seconds, 0)) / total : 0;
    return {
      seconds,
      totalSeconds: round1(total),
      peakHz: peak,
      belowPeakPct: round1(below),
      timeline: [...this.line],
      reliable120: total > 0 && above / total >= 0.9,
    };
  }
}
