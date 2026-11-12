// O resultado do teste: tipos, resumos (funções puras, testadas em tests/bench-report.test.ts), análise dos efeitos,
// da resolução e do aquecimento, conclusões, comparação com o resultado anterior e o resumo em texto.
import { BENCH_TARGETS, type BenchMode, type EffectId } from '../data/bench';
import type { EnvInfo } from './env';
import type { Creations } from './counters';
import type { LongSummary } from './observers';
import type { Recorder } from './probe';
import { SUB, SUBSYSTEMS, type SubsystemId } from './probe';
import {
  bucketSeries, compare, frameStats, fpsPresented, histogram, highestSustained, mean, pacing, percentile, round1, round2, slope,
  sorted, targetFluidity, type Comparison, type FrameStats, type Pacing, type RefreshDetection, type TargetFluidity,
} from './stats';

export interface Gauge {
  avg: number;
  max: number;
}

/** o que se mede da cena, amostrado algumas vezes por segundo */
export const SCENE_KEYS = [
  'calls', 'triangles', 'lines', 'points', 'geometries', 'textures', 'programs', 'objects', 'debris', 'particles', 'drops', 'loot',
  'meteors', 'chunks', 'pixels',
] as const;
export type SceneKey = (typeof SCENE_KEYS)[number];
export type SceneStats = Record<SceneKey, Gauge>;

export interface TimerStats {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

export interface SubsystemStats {
  id: SubsystemId;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}

/** Tudo o que se calcula dos quadros de um trecho do teste (um cenário, ou o conjunto deles). */
export interface Summary {
  frames: number;
  seconds: number;
  stats: FrameStats;
  histogram: number[];
  pacing: Pacing;
  /** FPS apresentados de verdade, contando quantos vsyncs cada quadro ocupou */
  fpsPresented: number;
  /** a mesma leitura contra cada taxa-alvo (120 e 60) */
  targets: TargetFluidity[];
  cpu: { meanMs: number; p95Ms: number; p99Ms: number; maxMs: number };
  steps: { mean: number; max: number; cappedFrames: number; cappedPct: number };
  subsystems: SubsystemStats[];
  /** tempo de GPU por quadro (timer query); null = o aparelho não oferece */
  gpu: { meanMs: number; p95Ms: number; samples: number } | null;
  chunks: { gen: TimerStats; mesh: TimerStats; remesh: TimerStats };
}

export interface SeriesData {
  bucketMs: number;
  avg: number[];
  max: number[];
}

export interface ScenarioResult {
  id: string;
  summary: Summary;
  scene: SceneStats;
  creations: Creations;
  longTasks: LongSummary;
  longFrames: LongSummary;
  series: SeriesData;
}

/** Um passo curto das comparações (efeito ligado/desligado, escala de resolução, minuto do aquecimento). */
export interface StepStat {
  frames: number;
  /** intervalo médio entre quadros (ms) */
  meanMs: number;
  p99Ms: number;
  fps: number;
  cpuMs: number;
  /** CPU gasta em render + sombra + pós-processamento (ms) */
  renderMs: number;
  /** render com espera da GPU (ms): mostra o custo real sem o vsync mascarar; null = não medido */
  syncMs: number | null;
  gpuMs: number | null;
}

export interface EffectResult {
  id: EffectId;
  /** o efeito já estava ligado no jogo (na qualidade em uso) */
  activeInGame: boolean;
  on: StepStat;
  off: StepStat;
  /** quanto o efeito custa por quadro (ms): GPU medida, senão render com espera da GPU */
  costMs: number;
  costSource: 'gpu' | 'sync';
  /** diferença de FPS (ligado − desligado) */
  fpsDelta: number;
}

export interface EffectsResult {
  baseline: StepStat;
  effects: EffectResult[];
}

export interface ResolutionPoint {
  scale: number;
  width: number;
  height: number;
  /** o aparelho não comporta esta escala */
  skipped: boolean;
  stat: StepStat | null;
  sustains: boolean[];
}

export interface ResolutionResult {
  points: ResolutionPoint[];
  /** maior escala em que o aparelho sustenta 120 e 60 FPS (null = nenhuma) */
  max120: number | null;
  max60: number | null;
}

export interface ThermalMinute {
  minute: number;
  fps: number;
  meanMs: number;
  p99Ms: number;
  cpuMs: number;
  /** nível da bateria no fim do minuto (0..1), se o navegador informa */
  battery: number | null;
}

export interface ThermalResult {
  minutes: ThermalMinute[];
  /** variação do FPS por minuto (negativa = esquentando e piorando) */
  fpsSlope: number;
  /** perda do último minuto em relação ao primeiro (0..1) */
  dropPct: number;
  throttled: boolean;
  series: SeriesData;
}

export interface Finding {
  id: string;
  level: 'ok' | 'info' | 'warn';
  params?: Record<string, string | number>;
}

export interface LatencyStats {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface BenchReport {
  /** versão do formato do arquivo e dos cenários (BENCH_VERSION) */
  version: number;
  gameVersion: string;
  date: string;
  mode: BenchMode;
  /** 1 = tempos reais; menor só nos testes automáticos */
  scale: number;
  seconds: number;
  env: EnvInfo;
  refresh: RefreshDetection;
  graphics: {
    quality: string;
    auto: boolean;
    pixelRatio: number;
    shadow: number;
    samples: number;
    bloom: boolean;
    css: [number, number];
    buffer: [number, number];
  };
  muted: boolean;
  overall: Summary;
  scenarios: ScenarioResult[];
  effects: EffectsResult | null;
  resolution: ResolutionResult | null;
  thermal: ThermalResult | null;
  input: {
    /** Event Timing (toque → quadro desenhado); null = o navegador não oferece */
    touch: LatencyStats | null;
    /** pointerdown → próximo quadro, quando o Event Timing não existe */
    fallback: LatencyStats | null;
    touchCount: number;
  };
  memory: {
    heapStartMb: number | null;
    heapEndMb: number | null;
    saveBytes: number | null;
    resourceCount: number | null;
    resourceBytes: number | null;
  };
  battery: { start: number; end: number; minutes: number; perMinute: number | null; charging: boolean } | null;
  findings: Finding[];
}

// ---------- resumos ----------

export function latency(values: readonly number[]): LatencyStats | null {
  if (!values.length) return null;
  const s = sorted(values);
  return { count: s.length, meanMs: round1(mean(s)), p95Ms: round1(percentile(s, 0.95)), maxMs: round1(s[s.length - 1]) };
}

function seriesStats(a: ArrayLike<number>): { mean: number; p95: number; max: number } {
  if (!a.length) return { mean: 0, p95: 0, max: 0 };
  const s = sorted(a);
  return { mean: mean(s), p95: percentile(s, 0.95), max: s[s.length - 1] };
}

/**
 * Resume os quadros de um trecho. `vsyncHz` é a taxa da tela detectada (o ritmo é medido contra o vsync dela);
 * `chunks` são os tempos de gerar e malhar chunks, que não vêm quadro a quadro.
 */
export function summarize(rec: Recorder, vsyncHz: number, chunks: Summary['chunks']): Summary {
  const iv = rec.interval.values;
  const vsyncMs = 1000 / vsyncHz;
  const st = frameStats(iv);
  const cpu = seriesStats(rec.cpu.values);
  const cpuSorted = sorted(rec.cpu.values);
  const stepVals = rec.steps.values;
  let stepMax = 0;
  for (let i = 0; i < stepVals.length; i++) if (stepVals[i] > stepMax) stepMax = stepVals[i];
  const subsystems = SUBSYSTEMS.map((id, i) => {
    const s = seriesStats(rec.subs[i].values);
    return { id, meanMs: s.mean, p95Ms: s.p95, maxMs: s.max };
  });
  const gpu = rec.gpu.n ? seriesStats(rec.gpu.values) : null;
  return {
    frames: iv.length,
    seconds: st.seconds,
    stats: st,
    histogram: histogram(iv),
    pacing: pacing(iv, vsyncMs),
    fpsPresented: fpsPresented(iv, vsyncMs),
    targets: BENCH_TARGETS.map((hz) => targetFluidity(iv, hz)),
    cpu: { meanMs: cpu.mean, p95Ms: cpu.p95, p99Ms: cpuSorted.length ? percentile(cpuSorted, 0.99) : 0, maxMs: cpu.max },
    steps: {
      mean: mean(stepVals),
      max: stepMax,
      cappedFrames: rec.cappedFrames,
      cappedPct: rec.frames ? (100 * rec.cappedFrames) / rec.frames : 0,
    },
    subsystems,
    gpu: gpu ? { meanMs: gpu.mean, p95Ms: gpu.p95, samples: rec.gpu.n } : null,
    chunks,
  };
}

export function seriesOf(rec: Recorder, bucketMs: number): SeriesData {
  const b = bucketSeries(rec.interval.values, bucketMs);
  return { bucketMs, avg: b.avg.map(round2), max: b.max.map(round2) };
}

/** Estatística de um passo curto (efeito, escala, minuto). */
export function stepStat(rec: Recorder): StepStat {
  const iv = rec.interval.values;
  const st = frameStats(iv);
  const render = SUB.render, shadow = SUB.shadow, post = SUB.post;
  let r = 0;
  for (const i of [render, shadow, post]) r += mean(rec.subs[i].values);
  return {
    frames: iv.length,
    meanMs: st.meanMs,
    p99Ms: st.p99Ms,
    fps: st.fpsEffective,
    cpuMs: mean(rec.cpu.values),
    renderMs: r,
    syncMs: rec.sync.n ? mean(rec.sync.values) : null,
    gpuMs: rec.gpu.n ? mean(rec.gpu.values) : null,
  };
}

/** Custo de um efeito: a diferença entre ligado e desligado, na GPU se medida, senão no render com espera da GPU. */
export function effectResult(id: EffectId, activeInGame: boolean, on: StepStat, off: StepStat): EffectResult {
  const useGpu = on.gpuMs !== null && off.gpuMs !== null;
  const costMs = useGpu ? (on.gpuMs as number) - (off.gpuMs as number) : (on.syncMs ?? on.renderMs) - (off.syncMs ?? off.renderMs);
  return { id, activeInGame, on, off, costMs: round2(costMs), costSource: useGpu ? 'gpu' : 'sync', fpsDelta: round1(on.fps - off.fps) };
}

/** Maior escala de resolução que ainda sustenta cada taxa-alvo. */
export function resolutionResult(points: ResolutionPoint[]): ResolutionResult {
  const scales = points.map((p) => p.scale);
  const max = (k: number): number | null =>
    highestSustained(scales, points.map((p) => !p.skipped && p.sustains[k]));
  return { points, max120: max(0), max60: max(1) };
}

/** Aquecimento: o FPS de cada minuto e se o aparelho piorou com o calor. */
export function thermalResult(minutes: ThermalMinute[], series: SeriesData): ThermalResult {
  const fps = minutes.map((m) => m.fps);
  const first = fps[0] ?? 0;
  const last = fps[fps.length - 1] ?? 0;
  const dropPct = first > 0 ? Math.max(0, (first - last) / first) : 0;
  return {
    minutes,
    fpsSlope: round2(slope(minutes.map((m) => m.minute), fps)),
    dropPct: round2(dropPct),
    // 10% a menos no fim já é o aparelho segurando o desempenho por calor
    throttled: minutes.length >= 3 && dropPct >= 0.1,
    series,
  };
}

// ---------- conclusões ----------

/**
 * Conclusões do teste. As fixas vêm da leitura do código (laço principal, passo fixo, limite de dt); as outras, das
 * medidas: só aparecem quando os números pedem. O texto de cada uma fica em src/i18n/pt-BR.ts (`bench.find.<id>`).
 */
export function findings(r: Pick<BenchReport, 'refresh' | 'overall' | 'scenarios' | 'thermal' | 'env'>): Finding[] {
  const out: Finding[] = [
    // investigação do limite de 60 FPS (README do BENCHMARK.md): nada no laço trava em 60, mas há trechos a 60 Hz
    { id: 'loopRaf', level: 'ok' },
    { id: 'fixedStep', level: 'info' },
    { id: 'dtClamp', level: 'info' },
  ];
  const hz = r.refresh.hz;
  const idle = r.scenarios.find((s) => s.id === 'idle');
  const probe = idle?.summary ?? r.overall;
  // a tela é de 120 Hz mas os quadros saem em múltiplos de 2 vsyncs com ritmo certinho: alguém limita a 60
  if (hz >= 90 && probe.pacing.regular && probe.pacing.dominantMultiple >= 2 && probe.cpu.p95Ms < (1000 / hz) * 0.8) {
    out.push({ id: 'cap', level: 'warn', params: { hz, fps: round1(probe.fpsPresented) } });
  } else if (hz >= 90 && probe.stats.fpsEffective >= hz * 0.9) {
    out.push({ id: 'nocap', level: 'ok', params: { hz } });
  }
  if (r.overall.steps.cappedFrames > 0) {
    out.push({ id: 'stepCap', level: 'warn', params: { n: r.overall.steps.cappedFrames, pct: round1(r.overall.steps.cappedPct) } });
  }
  const worst = [...r.scenarios].sort((a, b) => b.summary.stats.p99Ms - a.summary.stats.p99Ms)[0];
  if (worst) out.push({ id: 'worstScenario', level: 'info', params: { id: worst.id, p99: round1(worst.summary.stats.p99Ms) } });
  const gpuAvail = r.overall.gpu !== null;
  if (!gpuAvail) out.push({ id: 'noGpuTimer', level: 'info' });
  if (r.thermal?.throttled) out.push({ id: 'thermal', level: 'warn', params: { pct: Math.round(r.thermal.dropPct * 100) } });
  const longs = r.scenarios.reduce((n, s) => n + s.longTasks.count, 0);
  if (longs > 0) out.push({ id: 'longTasks', level: 'warn', params: { n: longs } });
  return out;
}

// ---------- comparação com o resultado anterior ----------

export interface CompareRow {
  key: 'fps' | 'p99' | 'jitter' | 'lost120' | 'presented' | 'cpu' | 'longest' | 'worstP99';
  now: number;
  before: number;
  cmp: Comparison;
}

/** Os números principais, agora contra o resultado guardado. Menos é melhor em tudo, menos nos FPS. */
export function compareReports(now: BenchReport, before: BenchReport): CompareRow[] {
  const o = now.overall, b = before.overall;
  const lost = (s: Summary): number => s.targets[0]?.lostPct ?? 0;
  const longest = (s: Summary): number => s.targets[0]?.longestOff ?? 0;
  const worstP99 = (r: BenchReport): number => Math.max(0, ...r.scenarios.map((s) => s.summary.stats.p99Ms));
  const rows: [CompareRow['key'], number, number, boolean][] = [
    ['fps', o.stats.fpsEffective, b.stats.fpsEffective, true],
    ['presented', o.fpsPresented, b.fpsPresented, true],
    ['p99', o.stats.p99Ms, b.stats.p99Ms, false],
    ['jitter', o.stats.jitterMs, b.stats.jitterMs, false],
    ['lost120', lost(o), lost(b), false],
    ['longest', longest(o), longest(b), false],
    ['cpu', o.cpu.meanMs, b.cpu.meanMs, false],
    ['worstP99', worstP99(now), worstP99(before), false],
  ];
  return rows.map(([key, n, v, hi]) => ({ key, now: n, before: v, cmp: compare(n, v, hi) }));
}

/** O que mudou no aparelho ou no teste desde o resultado anterior: se mudou, a comparação não é justa. */
export function setupDiff(now: BenchReport, before: BenchReport): string[] {
  const d: string[] = [];
  if (now.version !== before.version) d.push('version');
  if (now.mode !== before.mode) d.push('mode');
  if (now.refresh.hz !== before.refresh.hz) d.push('refresh');
  if (now.graphics.quality !== before.graphics.quality) d.push('quality');
  if (now.graphics.pixelRatio !== before.graphics.pixelRatio) d.push('pixelRatio');
  if (now.graphics.buffer[0] !== before.graphics.buffer[0] || now.graphics.buffer[1] !== before.graphics.buffer[1]) d.push('size');
  if (now.env.gl.renderer !== before.env.gl.renderer) d.push('device');
  return d;
}
