import { describe, expect, it } from 'vitest';
import { HISTORY_SIZE } from '../src/data/bench';
import type { EnvInfo } from '../src/bench/env';
import { Probe, Recorder, SUB } from '../src/bench/probe';
import {
  compareReports, effectResult, findings, latency, resolutionResult, seriesOf, setupDiff, stepStat, summarize, thermalResult,
  type BenchReport, type ResolutionPoint, type ScenarioResult, type Summary,
} from '../src/bench/report';
import { BENCH_HISTORY_KEY, loadHistory, saveReport, withoutSeries } from '../src/bench/store';
import { detectRefreshRate } from '../src/bench/stats';
import type { KeyValueStore } from '../src/core/save';

const NO_CHUNKS: Summary['chunks'] = {
  gen: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
  mesh: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
  remesh: { count: 0, totalMs: 0, avgMs: 0, maxMs: 0 },
};

/** grava `n` quadros de `ms` (e `cpu` ms de CPU) */
function record(intervals: number[], cpu = 3, setup?: (p: Probe, i: number) => void): Recorder {
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
const rep = (ms: number, n: number): number[] => Array.from({ length: n }, () => ms);

describe('resumo de um trecho do teste', () => {
  it('120 Hz liso: sustenta 120 e 60, ritmo regular, FPS apresentado ≈ 120', () => {
    const s = summarize(record(rep(1000 / 120, 600)), 120, NO_CHUNKS);
    expect(s.frames).toBe(600);
    expect(s.stats.fpsEffective).toBeCloseTo(120, 0);
    expect(s.fpsPresented).toBeCloseTo(120, 0);
    expect(s.pacing.regular).toBe(true);
    expect(s.targets.map((t) => t.sustains)).toEqual([true, true]);
    expect(s.gpu).toBeNull();
    expect(s.steps.cappedFrames).toBe(0);
  });

  it('60 FPS regular e 60 FPS irregular numa tela de 120 Hz têm a mesma média e ritmos diferentes', () => {
    const V = 1000 / 120;
    const smooth = rep(2 * V, 300);
    const irregular: number[] = [];
    for (let i = 0; i < 100; i++) irregular.push(V, 2 * V, 3 * V); // média 2 vsyncs, mas misturando 8,3 / 16,7 / 25
    const a = summarize(record(smooth), 120, NO_CHUNKS);
    const b = summarize(record(irregular), 120, NO_CHUNKS);
    expect(a.stats.meanMs).toBeCloseTo(b.stats.meanMs, 1);
    expect(a.pacing.regular).toBe(true);
    expect(b.pacing.regular).toBe(false);
    expect(b.stats.jitterMs).toBeGreaterThan(a.stats.jitterMs);
    expect(a.targets[1].sustains).toBe(true);
  });

  it('conta os quadros que bateram no limite de passos e mede cada subsistema', () => {
    const s = summarize(
      record(rep(8.3, 10), 4, (p, i) => {
        p.add(SUB.sim, 1);
        if (i < 3) p.capped = true;
      }),
      120,
      NO_CHUNKS,
    );
    expect(s.steps.cappedFrames).toBe(3);
    expect(s.steps.cappedPct).toBeCloseTo(30);
    const sim = s.subsystems.find((x) => x.id === 'sim');
    expect(sim?.meanMs).toBeCloseTo(1);
    expect(s.cpu.meanMs).toBeCloseTo(4);
  });

  it('GPU só aparece se o aparelho mediu', () => {
    const rec = record(rep(8.3, 10));
    expect(summarize(rec, 120, NO_CHUNKS).gpu).toBeNull();
    rec.gpu.push(3);
    rec.gpu.push(5);
    expect(summarize(rec, 120, NO_CHUNKS).gpu?.meanMs).toBeCloseTo(4);
  });

  it('a série para o gráfico vem em baldes', () => {
    const s = seriesOf(record(rep(10, 100)), 250);
    expect(s.bucketMs).toBe(250);
    expect(s.avg.length).toBe(4);
    expect(s.avg[0]).toBeCloseTo(10);
  });

  it('latência: lista vazia é null (não disponível)', () => {
    expect(latency([])).toBeNull();
    expect(latency([10, 20, 30])?.meanMs).toBe(20);
  });
});

describe('efeitos, resolução e aquecimento', () => {
  const mk = (over: Partial<ReturnType<typeof stepStat>>): ReturnType<typeof stepStat> => ({
    frames: 100, meanMs: 8.3, p99Ms: 9, fps: 120, cpuMs: 3, renderMs: 2, syncMs: null, gpuMs: null, ...over,
  });

  it('o custo do efeito vem da GPU quando medida, senão do render com espera da GPU', () => {
    const gpu = effectResult('bloom', false, mk({ gpuMs: 4 }), mk({ gpuMs: 1.5 }));
    expect(gpu.costSource).toBe('gpu');
    expect(gpu.costMs).toBeCloseTo(2.5);
    const sync = effectResult('fog', true, mk({ syncMs: 9 }), mk({ syncMs: 7.5 }));
    expect(sync.costSource).toBe('sync');
    expect(sync.costMs).toBeCloseTo(1.5);
    expect(sync.activeInGame).toBe(true);
    expect(effectResult('msaa', true, mk({ fps: 90 }), mk({ fps: 120 })).fpsDelta).toBe(-30);
  });

  it('stepStat usa o render com espera da GPU só quando foi medido', () => {
    const rec = record(rep(8.3, 20));
    expect(stepStat(rec).syncMs).toBeNull();
    rec.sync.push(5);
    expect(stepStat(rec).syncMs).toBe(5);
    expect(stepStat(rec).renderMs).toBeCloseTo(2);
  });

  it('a curva de resolução acha a maior escala que ainda sustenta 120 e 60', () => {
    const pt = (scale: number, s120: boolean, s60: boolean, skipped = false): ResolutionPoint => ({
      scale, width: 100, height: 100, skipped, stat: null, sustains: [s120, s60],
    });
    const r = resolutionResult([pt(0.5, true, true), pt(0.75, true, true), pt(1, false, true), pt(1.5, false, true), pt(2, false, false, true)]);
    expect(r.max120).toBe(0.75);
    expect(r.max60).toBe(1.5);
    expect(resolutionResult([pt(1, false, false)]).max60).toBeNull();
  });

  it('aquecimento: perder 10% ou mais até o fim é segurar o desempenho por calor', () => {
    const series = { bucketMs: 1000, avg: [], max: [] };
    const m = (minute: number, fps: number) => ({ minute, fps, meanMs: 1000 / fps, p99Ms: 10, cpuMs: 3, battery: null });
    const hot = thermalResult([m(1, 120), m(2, 110), m(3, 100), m(4, 95)], series);
    expect(hot.throttled).toBe(true);
    expect(hot.fpsSlope).toBeLessThan(0);
    expect(thermalResult([m(1, 120), m(2, 119), m(3, 120), m(4, 118)], series).throttled).toBe(false);
    expect(thermalResult([m(1, 120), m(2, 60)], series).throttled).toBe(false); // poucos minutos para concluir
  });
});

// ---------- conclusões, comparação e histórico ----------

const ENV: EnvInfo = {
  userAgent: 'x', cores: 8, deviceMemoryGb: null,
  gl: { renderer: 'GPU A', vendor: 'V', version: 'WebGL 2', glsl: null, webgl2: true, maxTextureSize: 4096, maxRenderbufferSize: null, maxSamples: 4, extensions: [], timerQuery: false },
  devicePixelRatio: 3, screen: { width: 400, height: 900 }, viewport: { width: 400, height: 800 }, orientation: 'portrait-primary',
  battery: null, perfMemory: false, longTask: true, longAnimationFrame: false, eventTiming: true,
};

function scenario(id: string, intervals: number[], hz = 120, cpu = 3): ScenarioResult {
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

function report(over: Partial<BenchReport> = {}, intervals = rep(1000 / 120, 300), hz = 120): BenchReport {
  const refresh = detectRefreshRate(rep(1000 / hz, 100));
  const sc = scenario('idle', intervals, hz);
  return {
    version: 2, gameVersion: '0.3.0', date: '2026-11-12T10:00:00.000Z', mode: 'quick', scale: 1, seconds: 100, env: ENV, refresh,
    graphics: { quality: 'alto', auto: false, pixelRatio: 2, shadow: 2048, samples: 4, bloom: true, css: [400, 800], buffer: [800, 1600] },
    muted: false, overall: sc.summary, scenarios: [sc], effects: null, resolution: null, thermal: null,
    input: { touch: null, fallback: null, touchCount: 0 },
    memory: { heapStartMb: null, heapEndMb: null, saveBytes: null, resourceCount: null, resourceBytes: null },
    battery: null, findings: [], ...over,
  };
}

describe('conclusões', () => {
  it('sempre traz a investigação do laço principal; aponta um limite de 60 quando a tela é de 120 Hz e o ritmo é regular em 2 vsyncs', () => {
    const capped = report({}, rep(1000 / 60, 300));
    const f = findings(capped).map((x) => x.id);
    expect(f).toEqual(expect.arrayContaining(['loopRaf', 'fixedStep', 'dtClamp', 'cap', 'noGpuTimer']));
    const free = findings(report()).map((x) => x.id);
    expect(free).toContain('nocap');
    expect(free).not.toContain('cap');
  });

  it('avisa quando o aparelho segura o desempenho por calor e quando há tarefas longas', () => {
    const r = report();
    r.thermal = { minutes: [], fpsSlope: -3, dropPct: 0.2, throttled: true, series: { bucketMs: 1000, avg: [], max: [] } };
    r.scenarios[0].longTasks = { count: 4, totalMs: 400, maxMs: 200, worst: [] };
    const f = findings(r).map((x) => x.id);
    expect(f).toContain('thermal');
    expect(f).toContain('longTasks');
  });
});

describe('comparação com o resultado anterior', () => {
  it('mostra melhor, pior ou igual por métrica', () => {
    const before = report({}, rep(1000 / 60, 300));
    const now = report();
    const rows = compareReports(now, before);
    const fps = rows.find((x) => x.key === 'fps');
    expect(fps?.cmp.verdict).toBe('better');
    expect(rows.find((x) => x.key === 'p99')?.cmp.verdict).toBe('better');
    expect(compareReports(before, now).find((x) => x.key === 'fps')?.cmp.verdict).toBe('worse');
    expect(compareReports(now, report()).every((x) => x.cmp.verdict === 'same')).toBe(true);
  });

  it('avisa o que mudou no aparelho ou no teste', () => {
    const a = report();
    expect(setupDiff(a, report())).toEqual([]);
    const b = report({ graphics: { ...a.graphics, quality: 'baixo', pixelRatio: 1 }, mode: 'full', version: 3 });
    expect(setupDiff(a, b).sort()).toEqual(['mode', 'pixelRatio', 'quality', 'version']);
  });
});

function fakeStore(limitBytes = Infinity): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limitBytes) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

describe('histórico dos resultados', () => {
  it('guarda no máximo os últimos 10, o mais novo primeiro, numa chave própria', () => {
    const store = fakeStore();
    for (let i = 0; i < HISTORY_SIZE + 3; i++) saveReport(store, report({ date: `2026-11-${10 + i}T00:00:00Z` }));
    const h = loadHistory(store);
    expect(h).toHaveLength(HISTORY_SIZE);
    expect(h[0].date).toBe(`2026-11-${10 + HISTORY_SIZE + 2}T00:00:00Z`);
    expect([...store.data.keys()]).toEqual([BENCH_HISTORY_KEY]);
    expect(BENCH_HISTORY_KEY).not.toBe('spacing.save');
    expect(BENCH_HISTORY_KEY).not.toBe('spacing.prefs.v1');
  });

  it('sem armazenamento ou com ele cheio, segue sem guardar e não lança', () => {
    expect(saveReport(null, report()).saved).toBe(false);
    const full = fakeStore(10);
    const out = saveReport(full, report());
    expect(out.saved).toBe(false);
    expect(out.history).toHaveLength(1);
    expect(loadHistory(null)).toEqual([]);
  });

  it('quando o espaço aperta, tira os gráficos antes de perder resultados', () => {
    const big = report();
    big.scenarios[0].series = seriesOf(record(rep(10, 4000)), 250);
    const smallSize = JSON.stringify({ version: 1, entries: [withoutSeries(big)] }).length;
    const store = fakeStore(smallSize + 50);
    const out = saveReport(store, big);
    expect(out.saved).toBe(true);
    expect(out.history[0].scenarios[0].series.avg).toEqual([]);
  });

  it('ignora lixo guardado', () => {
    const store = fakeStore();
    store.setItem(BENCH_HISTORY_KEY, JSON.stringify({ version: 1, entries: [{ a: 1 }, 'x', report()] }));
    expect(loadHistory(store)).toHaveLength(1);
    store.setItem(BENCH_HISTORY_KEY, '{quebrado');
    expect(loadHistory(store)).toEqual([]);
  });
});
