// Dados de exemplo para os testes do teste de desempenho (sem WebGL)
import type { EnvInfo } from '../src/bench/env';
import { Probe, Recorder, SUB } from '../src/bench/probe';
import { seriesOf, summarize, type BenchReport, type ScenarioResult, type Summary } from '../src/bench/report';
import { detectRefreshRate } from '../src/bench/stats';

export const NO_CHUNKS: Summary['chunks'] = {
  gen: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
  mesh: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
  remesh: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
};

/** grava `n` quadros de `ms` (e `cpu` ms de CPU) */
export function record(intervals: number[], cpu = 3, setup?: (p: Probe, i: number) => void): Recorder {
  const rec = new Recorder();
  const p = new Probe();
  intervals.forEach((ms, i) => {
    p.reset();
    p.steps = 1;
    p.add(SUB.render, 2);
    setup?.(p, i);
    rec.push(ms, cpu, p);
  });
  return rec;
}
export const rep = (ms: number, n: number): number[] => Array.from({ length: n }, () => ms);

export const ENV: EnvInfo = {
  userAgent: 'x', cores: 8, deviceMemoryGb: null,
  gl: { renderer: 'GPU A', vendor: 'V', version: 'WebGL 2', glsl: null, webgl2: true, maxTextureSize: 4096, maxRenderbufferSize: null, maxSamples: 4, extensions: [], timerQuery: false },
  devicePixelRatio: 3, screen: { width: 400, height: 900 }, viewport: { width: 400, height: 800 }, orientation: 'portrait-primary',
  battery: null, perfMemory: false, longTask: true, longAnimationFrame: false, eventTiming: true,
};

export function scenario(id: string, intervals: number[], hz = 120, cpu = 3): ScenarioResult {
  const rec = record(intervals, cpu);
  return {
    id,
    summary: summarize(rec, hz, NO_CHUNKS),
    scene: {} as ScenarioResult['scene'],
    creations: { geometries: 0, materials: 0, textures: 0, objects: 0 },
    longTasks: { count: 0, totalMs: 0, maxMs: 0, worst: [] },
    longFrames: { count: 0, totalMs: 0, maxMs: 0, worst: [] },
    series: seriesOf(rec, 250),
  };
}

export function report(over: Partial<BenchReport> = {}, intervals = rep(1000 / 120, 300), hz = 120): BenchReport {
  const refresh = detectRefreshRate(rep(1000 / hz, 100));
  const sc = scenario('idle', intervals, hz);
  return {
    version: 2, gameVersion: '0.3.0', date: '2026-11-12T10:00:00.000Z', mode: 'quick', scale: 1, seconds: 100, env: ENV, refresh, refreshStart: refresh,
    refreshObserved: { seconds: [{ hz, seconds: 100, pct: 100 }], totalSeconds: 100, peakHz: hz, belowPeakPct: 0, timeline: [], reliable120: hz >= 90 },
    graphics: { quality: 'alto', auto: false, pixelRatio: 2, shadow: 2048, samples: 4, bloom: true, css: [400, 800], buffer: [800, 1600] },
    muted: false, overall: sc.summary, scenarios: [sc], effects: null, resolution: null, thermal: null,
    input: { touch: null, fallback: null, touchCount: 0 },
    memory: { heapStartMb: null, heapEndMb: null, saveBytes: null, resourceCount: null, resourceBytes: null },
    battery: null, findings: [], ...over,
  };
}

