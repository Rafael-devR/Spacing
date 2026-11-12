import { describe, expect, it } from 'vitest';
import { HISTORY_SIZE } from '../src/data/bench';
import { Probe, Recorder, SUB } from '../src/bench/probe';
import {
  compareReports, effectResult, findings, latency, resolutionResult, seriesOf, setupDiff, stepStat, summarize, thermalResult,
  type ResolutionPoint,
} from '../src/bench/report';
import { BENCH_HISTORY_KEY, loadHistory, saveReport, withoutSeries } from '../src/bench/store';
import type { KeyValueStore } from '../src/core/save';
import { NO_CHUNKS, record, rep, report } from './bench-fixture';

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

  it('os percentis de CPU e de latência não são o máximo (um quadro lento isolado não vira o p95 nem o p99)', () => {
    const rec = new Recorder();
    const p = new Probe();
    for (let i = 0; i < 100; i++) {
      p.reset();
      p.add(SUB.render, i === 99 ? 50 : 2);
      rec.push(8.3, i === 99 ? 40 : 3, p);
    }
    const s = summarize(rec, 120, NO_CHUNKS);
    expect(s.cpu.maxMs).toBe(40);
    expect(s.cpu.p95Ms).toBe(3);
    expect(s.cpu.p99Ms).toBe(3);
    const render = s.subsystems.find((x) => x.id === 'render');
    expect(render?.maxMs).toBe(50);
    expect(render?.p95Ms).toBe(2);
    const lat = latency([...Array.from({ length: 99 }, () => 10), 200]);
    expect(lat?.p95Ms).toBe(10);
    expect(lat?.maxMs).toBe(200);
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
