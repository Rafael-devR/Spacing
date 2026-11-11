// Estatísticas do teste de desempenho (docs/design/DESEMPENHO.md): funções puras, sem DOM nem three.js, para testar.
import { HITCH_MS, WORST_FRAMES } from '../data/benchmark';
import type { QualityName } from '../render/post';

export interface FrameStats {
  frames: number;
  seconds: number;
  /** quadros ÷ tempo */
  avgFps: number;
  /** o pior quadro vira FPS (1000 ÷ ms do maior intervalo) */
  minFps: number;
  /** FPS dos 1% piores quadros: mostra as travadinhas que a média esconde */
  low1Fps: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** quadros acima de 33 ms (menos de 30 FPS), 50 ms e 100 ms */
  over33: number;
  over50: number;
  over100: number;
  /** tempo de CPU do JavaScript por quadro (sem esperar a GPU nem o vsync) */
  cpuAvgMs: number;
  cpuMaxMs: number;
}

export interface Avg {
  avg: number;
  max: number;
}

export interface Timing {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface WorstFrame {
  ms: number;
  phase: string;
  /** segundos desde o início do teste */
  at: number;
}

export interface PhaseResult extends FrameStats {
  id: string;
}

export interface BenchResult {
  version: 1;
  /** versão do cenário (data/benchmark.ts): só dá para comparar resultados do mesmo cenário */
  scenario: number;
  date: string;
  gameVersion: string;
  /** duração real do teste, em segundos */
  seconds: number;
  /** 1 = cenário completo; menos que 1 = teste abreviado (só para testes automáticos) */
  scale: number;
  device: { userAgent: string; cores: number | null; memoryGb: number | null; gpu: string | null; touch: boolean };
  graphics: {
    quality: QualityName;
    /** a qualidade veio do modo automático */
    auto: boolean;
    pixelRatio: number;
    shadow: number;
    samples: number;
    bloom: boolean;
    /** tamanho da tela em pixels CSS e do desenho em pixels reais */
    css: [number, number];
    buffer: [number, number];
    dpr: number;
  };
  muted: boolean;
  overall: FrameStats;
  phases: PhaseResult[];
  worst: WorstFrame[];
  chunks: {
    generated: Timing;
    /** malha de chunk novo */
    meshed: Timing;
    /** malha refeita depois de quebrar ou colocar bloco */
    remeshed: Timing;
    loaded: Avg;
  };
  scene: { calls: Avg; triangles: Avg; objects: Avg; debris: Avg; particles: Avg; drops: Avg; loot: Avg; meteors: Avg };
  memory: { startMb: number | null; endMb: number | null };
}

/** valor no percentil `p` (0..1) de uma lista já ordenada, sem interpolar */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Estatísticas de uma lista de tempos de quadro (ms) e dos tempos de CPU (ms) dos mesmos quadros. */
export function summarize(frameMs: ArrayLike<number>, cpuMs: ArrayLike<number>): FrameStats {
  const n = frameMs.length;
  if (!n) {
    return { frames: 0, seconds: 0, avgFps: 0, minFps: 0, low1Fps: 0, avgMs: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, over33: 0, over50: 0, over100: 0, cpuAvgMs: 0, cpuMaxMs: 0 };
  }
  const sorted = Float64Array.from(frameMs).sort();
  let total = 0, over33 = 0, over50 = 0, over100 = 0;
  for (let i = 0; i < n; i++) {
    const v = frameMs[i];
    total += v;
    if (v > HITCH_MS[0]) over33++;
    if (v > HITCH_MS[1]) over50++;
    if (v > HITCH_MS[2]) over100++;
  }
  const maxMs = sorted[n - 1];
  const worstN = Math.max(1, Math.ceil(n * 0.01));
  let worstSum = 0;
  for (let i = n - worstN; i < n; i++) worstSum += sorted[i];
  let cpuTotal = 0, cpuMax = 0;
  for (let i = 0; i < cpuMs.length; i++) {
    cpuTotal += cpuMs[i];
    if (cpuMs[i] > cpuMax) cpuMax = cpuMs[i];
  }
  return {
    frames: n,
    seconds: total / 1000,
    avgFps: total > 0 ? (n * 1000) / total : 0,
    minFps: maxMs > 0 ? 1000 / maxMs : 0,
    low1Fps: worstSum > 0 ? 1000 / (worstSum / worstN) : 0,
    avgMs: total / n,
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs,
    over33, over50, over100,
    cpuAvgMs: cpuMs.length ? cpuTotal / cpuMs.length : 0,
    cpuMaxMs: cpuMax,
  };
}

/** Guarda os N piores quadros vistos, do pior para o menos pior. */
export class WorstFrames {
  private readonly list: WorstFrame[] = [];
  constructor(private readonly size = WORST_FRAMES) {}

  add(f: WorstFrame): void {
    if (this.list.length >= this.size && f.ms <= this.list[this.list.length - 1].ms) return;
    this.list.push(f);
    this.list.sort((a, b) => b.ms - a.ms);
    if (this.list.length > this.size) this.list.length = this.size;
  }

  get all(): WorstFrame[] {
    return this.list.map((f) => ({ ...f }));
  }
}

/** Média e máximo de uma série, sem guardar os valores. */
export class Running {
  private sum = 0;
  private n = 0;
  private maxV = 0;
  add(v: number): void {
    this.sum += v;
    this.n++;
    if (v > this.maxV) this.maxV = v;
  }
  get value(): Avg {
    return { avg: this.n ? this.sum / this.n : 0, max: this.maxV };
  }
}

/** Soma de tempos (gerar chunk, malhar chunk). */
export class Timer {
  private count = 0;
  private total = 0;
  private maxV = 0;
  add(ms: number): void {
    this.count++;
    this.total += ms;
    if (ms > this.maxV) this.maxV = ms;
  }
  get value(): Timing {
    return { count: this.count, totalMs: this.total, avgMs: this.count ? this.total / this.count : 0, maxMs: this.maxV };
  }
}

export type Verdict = 'better' | 'worse' | 'same';

export interface Comparison {
  diff: number;
  /** variação em relação ao anterior (0,1 = 10% a mais); null se o anterior era 0 */
  pct: number | null;
  verdict: Verdict;
}

/**
 * Compara o resultado de agora com o anterior. `higherIsBetter`: FPS sim, milissegundos não.
 * Variações dentro de `tolerance` (2% por padrão) contam como iguais: ruído de medição.
 */
export function compare(now: number, before: number, higherIsBetter: boolean, tolerance = 0.02): Comparison {
  const diff = now - before;
  const pct = before !== 0 ? diff / Math.abs(before) : null;
  const rel = pct ?? (diff === 0 ? 0 : Math.sign(diff));
  if (Math.abs(rel) <= tolerance) return { diff, pct, verdict: 'same' };
  return { diff, pct, verdict: diff > 0 === higherIsBetter ? 'better' : 'worse' };
}

/** As configurações de tela e qualidade são as mesmas? Se não, o resultado anterior não é comparável direto. */
export function sameSetup(a: BenchResult, b: BenchResult): boolean {
  return (
    a.scenario === b.scenario &&
    a.scale === b.scale &&
    a.graphics.quality === b.graphics.quality &&
    a.graphics.buffer[0] === b.graphics.buffer[0] &&
    a.graphics.buffer[1] === b.graphics.buffer[1] &&
    a.muted === b.muted
  );
}
