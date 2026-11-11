import { describe, expect, it } from 'vitest';
import { BENCH_EFFECTS, BENCH_SCENARIOS, BENCH_TARGETS, CRYSTAL_BREAK_RATE, MATRIX_SCENARIO, RESOLUTION_SCALES, THERMAL_MINUTES, plannedSeconds } from '../src/data/bench';
import {
  bucketSeries, budgetOf, compare, detectRefreshRate, fpsEffective, fpsPresented, frameStats, framesLost, highestSustained,
  histogram, histogramLabels, jitter, longestOffTarget, mean, median, pacing, percentile, slope, sorted, stddev, targetFluidity,
} from '../src/bench/stats';

const V120 = 1000 / 120;
const V60 = 1000 / 60;
/** n quadros de `ms` */
const rep = (ms: number, n: number): number[] => Array.from({ length: n }, () => ms);

describe('estatísticas básicas', () => {
  it('média, mediana e desvio padrão', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
    expect(median(sorted([5, 1, 3]))).toBe(3);
    expect(median(sorted([4, 1, 3, 2]))).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    expect(stddev([5])).toBe(0);
  });

  it('percentil pelo posto mais próximo', () => {
    const s = sorted(Array.from({ length: 1000 }, (_, i) => i + 1));
    expect(percentile(s, 0.5)).toBe(500);
    expect(percentile(s, 0.95)).toBe(950);
    expect(percentile(s, 0.99)).toBe(990);
    expect(percentile(s, 0.999)).toBe(999);
    expect(percentile(s, 1)).toBe(1000);
    expect(percentile(s, 0)).toBe(1);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('ordenar é numérico, não alfabético', () => {
    expect(Array.from(sorted([10, 9, 100, 1]))).toEqual([1, 9, 10, 100]);
  });
});

describe('jitter', () => {
  it('é zero num ritmo perfeito', () => {
    expect(jitter(rep(V60, 100))).toBe(0);
  });

  it('é a média da diferença entre quadros consecutivos', () => {
    expect(jitter([10, 20, 10, 20])).toBe(10);
    expect(jitter([10, 12, 14])).toBe(2);
    expect(jitter([10])).toBe(0);
  });

  it('um ritmo que mistura 8,3, 16,7 e 25 ms tem jitter alto mesmo com a média certa', () => {
    const mix: number[] = [];
    for (let i = 0; i < 90; i++) mix.push(V120, V60 * 1, V120 * 3);
    const smooth = rep(mean(mix), mix.length);
    expect(mean(mix)).toBeCloseTo(mean(smooth), 6);
    expect(jitter(smooth)).toBe(0);
    expect(jitter(mix)).toBeGreaterThan(8);
  });
});

describe('taxa de atualização da tela', () => {
  it('arredonda a mediana dos intervalos para a taxa mais próxima', () => {
    expect(detectRefreshRate(rep(8.33, 200)).hz).toBe(120);
    expect(detectRefreshRate(rep(16.7, 200)).hz).toBe(60);
    expect(detectRefreshRate(rep(11.1, 200)).hz).toBe(90);
    expect(detectRefreshRate(rep(6.94, 200)).hz).toBe(144);
  });

  it('é a mediana: alguns quadros perdidos no começo não mudam a taxa', () => {
    const iv = [60, 45, 30, ...rep(8.33, 240)];
    const d = detectRefreshRate(iv);
    expect(d.hz).toBe(120);
    expect(d.rawHz).toBeCloseTo(120, 0);
    expect(d.budgetMs).toBeCloseTo(8.333, 2);
    expect(d.samples).toBe(243);
  });

  it('mede a taxa bruta e mostra o período da taxa reconhecida', () => {
    const d = detectRefreshRate(rep(8.9, 100)); // 112 Hz bruto
    expect(d.rawHz).toBeCloseTo(112.4, 1);
    expect(d.hz).toBe(120);
    expect(d.budgetMs).toBeCloseTo(budgetOf(120), 6);
  });

  it('uma tela presa em 30 Hz cai na menor taxa conhecida e a taxa bruta mostra a verdade', () => {
    const d = detectRefreshRate(rep(33.3, 100));
    expect(d.hz).toBe(60);
    expect(d.rawHz).toBeCloseTo(30, 0);
  });

  it('ignora valores inválidos e não quebra sem amostras', () => {
    expect(detectRefreshRate([]).hz).toBe(60);
    expect(detectRefreshRate([0, NaN, -3, ...rep(16.7, 10)]).hz).toBe(60);
  });
});

describe('quadros perdidos e sequência fora do alvo', () => {
  it('perdido = intervalo maior que 1,5 vez o período do alvo', () => {
    // alvo 120 Hz: período 8,33; limite 12,5 ms
    expect(framesLost([8.3, 8.3, 12.4, 12.6, 16.7, 25], V120)).toBe(3);
    // alvo 60 Hz: limite 25 ms
    expect(framesLost([16.7, 24.9, 25.1, 33, 50], V60)).toBe(3);
  });

  it('a mesma sequência pesa diferente conforme o alvo', () => {
    const smooth60 = rep(V60, 100);
    expect(framesLost(smooth60, V120)).toBe(100); // a 120 Hz, um 60 FPS perde todos
    expect(framesLost(smooth60, V60)).toBe(0);
  });

  it('maior sequência seguida de quadros fora do alvo', () => {
    const iv = [8, 8, 30, 30, 30, 8, 30, 30, 8];
    expect(longestOffTarget(iv, V60)).toBe(5 - 2); // os 30 ms passam de 25 ms: três seguidos
    expect(longestOffTarget(iv, V120)).toBe(3);
    expect(longestOffTarget([], V60)).toBe(0);
  });
});

describe('histograma', () => {
  it('conta por faixa de milissegundos e fecha a última faixa', () => {
    const h = histogram([5, 6, 9.9, 10, 16.7, 16.7, 25, 33, 49, 120, 500]);
    //          <6 6–10 10–14 14–18 18–22 22–26 26–34 34–50 50–100 ≥100
    expect(h).toEqual([1, 2, 1, 2, 0, 1, 1, 1, 0, 2]);
    expect(h.reduce((a, b) => a + b, 0)).toBe(11);
  });

  it('tem um rótulo para cada faixa', () => {
    const labels = histogramLabels();
    expect(labels).toHaveLength(histogram([]).length);
    expect(labels[0]).toBe('< 6');
    expect(labels[labels.length - 1]).toBe('≥ 100');
  });

  it('aceita faixas próprias', () => {
    expect(histogram([1, 5, 15], [2, 10])).toEqual([1, 1, 1]);
  });
});

describe('pacing: distingue o 60 FPS fluido do irregular numa tela de 120 Hz', () => {
  it('60 FPS fluido: todos os quadros em 2 vsyncs, ritmo regular', () => {
    const p = pacing(rep(V60, 300), V120);
    expect(p.alignedPct).toBe(100);
    expect(p.dominantMultiple).toBe(2);
    expect(p.regularPct).toBe(100);
    expect(p.switchMean).toBe(0);
    expect(p.regular).toBe(true);
  });

  it('60 FPS irregular: mistura 1, 2 e 3 vsyncs. Alinhado, mas não regular', () => {
    const mix: number[] = [];
    for (let i = 0; i < 100; i++) mix.push(V120, V120 * 3, V60, V120 * 3, V120);
    // média = 60 FPS (16,67 ms) como no caso fluido
    expect(mean(mix)).toBeCloseTo(V60, 4);
    const p = pacing(mix, V120);
    expect(p.alignedPct).toBe(100); // os intervalos são múltiplos exatos do vsync
    expect(p.regular).toBe(false);
    expect(p.regularPct).toBeLessThan(50);
    expect(p.switchMean).toBeGreaterThan(1);
    expect(p.multiples.slice(0, 3)).toEqual([200, 100, 200]);
  });

  it('os dois têm o mesmo FPS médio e o pacing os separa', () => {
    const fluid = rep(V60, 300);
    const rough: number[] = [];
    for (let i = 0; i < 100; i++) rough.push(V120, V120 * 3, V60);
    expect(fpsEffective(fluid)).toBeCloseTo(fpsEffective(rough), 3);
    expect(pacing(fluid, V120).regular).toBe(true);
    expect(pacing(rough, V120).regular).toBe(false);
  });

  it('intervalos que não são múltiplos do vsync saem do alinhamento', () => {
    const p = pacing([12.5, 12.5, 12.5, 12.5], V120); // 1,5 vsync: no meio de dois múltiplos
    expect(p.alignedPct).toBe(0);
    const near = pacing([8.4, 16.8, 25.1, 16.5], V120);
    expect(near.alignedPct).toBe(100);
  });

  it('agrupa os múltiplos grandes no último e não quebra sem dados', () => {
    const p = pacing([V120 * 20, V120 * 9], V120);
    expect(p.multiples[p.multiples.length - 1]).toBe(2);
    expect(pacing([], V120).alignedPct).toBe(0);
    expect(pacing([16], 0).dominantMultiple).toBe(0);
  });
});

describe('FPS efetivo e apresentado', () => {
  it('com o relógio alinhado ao vsync, efetivo e apresentado coincidem', () => {
    expect(fpsEffective(rep(V60, 100))).toBeCloseTo(60, 6);
    expect(fpsPresented(rep(V60, 100), V120)).toBeCloseTo(60, 6);
    expect(fpsEffective(rep(V120, 100))).toBeCloseTo(120, 6);
    expect(fpsPresented(rep(V120, 100), V120)).toBeCloseTo(120, 6);
    // um pouco de ruído no relógio não muda nada
    expect(fpsPresented(rep(V120 * 1.05, 100), V120)).toBeCloseTo(120, 6);
  });

  it('quando os quadros caem entre dois vsyncs, o apresentado fica abaixo do efetivo', () => {
    const iv = rep(V120 * 1.4, 200); // 11,7 ms: ~85 FPS entregues, mas cada quadro passa de um vsync e ocupa dois
    expect(fpsEffective(iv)).toBeCloseTo(85.7, 0);
    expect(fpsPresented(iv, V120)).toBeCloseTo(60, 6);
    const slow = rep(V120 * 2.6, 100); // 21,7 ms ≈ 46 FPS; ocupa 3 vsyncs: 40 FPS apresentados
    expect(fpsEffective(slow)).toBeCloseTo(46.2, 0);
    expect(fpsPresented(slow, V120)).toBeCloseTo(40, 6);
  });

  it('o apresentado nunca passa da taxa da tela', () => {
    for (const ms of [2, 6, 8.33, 9, 11.7, 16.7, 20, 33, 50]) expect(fpsPresented(rep(ms, 50), V120)).toBeLessThanOrEqual(120.0001);
  });


  it('sem quadros, zero', () => {
    expect(fpsEffective([])).toBe(0);
    expect(fpsPresented([], V120)).toBe(0);
  });
});

describe('estatísticas de tempo de quadro', () => {
  it('média, mediana, p95, p99, p99,9, desvio, jitter, mínimo e máximo', () => {
    const iv = [...rep(10, 998), 50, 200];
    const s = frameStats(iv);
    expect(s.frames).toBe(1000);
    expect(s.meanMs).toBeCloseTo(10.23, 6);
    expect(s.medianMs).toBe(10);
    expect(s.p95Ms).toBe(10);
    expect(s.p99Ms).toBe(10);
    expect(s.p999Ms).toBe(50);
    expect(s.maxMs).toBe(200);
    expect(s.minMs).toBe(10);
    expect(s.stdMs).toBeGreaterThan(0);
    expect(s.jitterMs).toBeGreaterThan(0);
    expect(s.seconds).toBeCloseTo(10.23, 6);
    expect(s.fpsEffective).toBeCloseTo(97.75, 1);
  });

  it('lista vazia: tudo zero, nunca NaN', () => {
    const s = frameStats([]);
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
  });
});

describe('fluidez em relação a 120 e a 60 Hz', () => {
  it('60 FPS perfeitos: sustenta 60, não sustenta 120', () => {
    const iv = rep(V60, 600);
    const a = targetFluidity(iv, 60), b = targetFluidity(iv, 120);
    expect(a.sustains).toBe(true);
    expect(a.lost).toBe(0);
    expect(a.fpsPct).toBeCloseTo(100, 6);
    expect(b.sustains).toBe(false);
    expect(b.lostPct).toBe(100);
    expect(b.fpsPct).toBeCloseTo(50, 6);
    expect(b.longestOff).toBe(600);
  });

  it('120 FPS perfeitos sustentam os dois alvos', () => {
    const iv = rep(V120, 600);
    expect(targetFluidity(iv, 120).sustains).toBe(true);
    expect(targetFluidity(iv, 60).sustains).toBe(true);
  });

  it('uma travada rara não derruba, uma frequente derruba', () => {
    const few = [...rep(V120, 990), ...rep(40, 10)]; // 1% de quadros ruins
    expect(targetFluidity(few, 120).lostPct).toBeCloseTo(1, 6);
    const many = [...rep(V120, 900), ...rep(40, 100)];
    expect(targetFluidity(many, 120).sustains).toBe(false);
    expect(targetFluidity(many, 60).lost).toBe(100);
  });

  it('sem quadros não sustenta nada', () => {
    expect(targetFluidity([], 120).sustains).toBe(false);
  });
});

describe('série para o gráfico', () => {
  it('reduz a pontos de bucketMs em bucketMs, com média e máximo', () => {
    // 10 quadros de 10 ms (100 ms) e um de 80 ms: o ponto do fim do tempo fica só com o quadro lento
    const iv = [...rep(10, 10), 80];
    const s = bucketSeries(iv, 50);
    expect(s.avg).toEqual([10, 10, 80]);
    expect(s.max).toEqual([10, 10, 80]);
    // uma travada no meio de um ponto aparece no máximo, e a média a dilui
    const m = bucketSeries([10, 10, 10, 10, 90], 100);
    expect(m.max).toEqual([90]);
    expect(m.avg).toEqual([26]);
  });

  it('a duração coberta é a mesma dos quadros', () => {
    const iv = rep(8.33, 600);
    const s = bucketSeries(iv, 250);
    expect(s.avg.length).toBeGreaterThanOrEqual(19);
    expect(s.avg.length).toBeLessThanOrEqual(21);
  });

  it('série vazia', () => {
    expect(bucketSeries([], 250)).toEqual({ avg: [], max: [] });
  });
});

describe('tendência (aquecimento) e comparação', () => {
  it('inclinação: o FPS cai ao longo dos minutos', () => {
    expect(slope([1, 2, 3, 4], [60, 58, 56, 54])).toBeCloseTo(-2, 10);
    expect(slope([1, 2, 3], [50, 50, 50])).toBe(0);
    expect(slope([1], [3])).toBe(0);
  });

  it('FPS maior é melhor; milissegundos menores são melhores; ruído é igual', () => {
    expect(compare(110, 100, true).verdict).toBe('better');
    expect(compare(90, 100, true).verdict).toBe('worse');
    expect(compare(5, 10, false).verdict).toBe('better');
    expect(compare(100.5, 100, true).verdict).toBe('same');
    expect(compare(5, 0, true).pct).toBeNull();
  });

  it('maior escala que o aparelho sustenta, só se todas as menores também sustentam', () => {
    expect(highestSustained([0.5, 0.75, 1, 1.25], [true, true, true, false])).toBe(1);
    expect(highestSustained([0.5, 0.75, 1], [true, false, true])).toBe(0.5);
    expect(highestSustained([0.5, 0.75], [false, false])).toBeNull();
  });
});

// ---------- cenários como dados ----------

describe('cenários do teste (dados)', () => {
  it('têm os cinco cenários do teste anterior e os novos pedidos', () => {
    const ids = BENCH_SCENARIOS.map((s) => s.id);
    for (const id of ['prepare', 'mining', 'meteors', 'walk', 'everything', 'idle', 'spin', 'zoom', 'circle', 'crystal', 'explosion', 'map', 'base', 'items', 'worst']) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('o modo rápido dura cerca de 2 minutos e o completo cerca de 15 (com os 10 do aquecimento)', () => {
    const quick = plannedSeconds('quick');
    const full = plannedSeconds('full');
    expect(quick).toBeGreaterThan(100);
    expect(quick).toBeLessThan(150);
    expect(full).toBeGreaterThan(14 * 60);
    expect(full).toBeLessThan(17 * 60);
    expect(THERMAL_MINUTES).toBe(10);
  });

  it('o escalonamento do tempo encurta tudo na mesma proporção', () => {
    expect(plannedSeconds('quick', 0.5)).toBeCloseTo(plannedSeconds('quick') / 2, 6);
  });

  it('cada cenário descarta 2 s de aquecimento, menos o que mede o carregamento da região', () => {
    for (const s of BENCH_SCENARIOS) expect(s.warmup ?? 2).toBe(s.id === 'prepare' ? 0 : 2);
  });

  it('a broca de diamante quebra sem parar por 30 s no modo completo, na velocidade da broca de cristal', () => {
    const c = BENCH_SCENARIOS.find((s) => s.id === 'crystal')!;
    expect(c.seconds.full).toBe(30);
    expect(c.actions.breakRate).toBeCloseTo(CRYSTAL_BREAK_RATE, 10);
    expect(CRYSTAL_BREAK_RATE).toBeGreaterThan(5); // bem mais rápido que a broca do traje (2,9 blocos/s)
    expect(CRYSTAL_BREAK_RATE).toBeLessThan(10);
  });

  it('o pior caso dura 60 s no modo completo e junta tudo', () => {
    const w = BENCH_SCENARIOS.find((s) => s.id === 'worst')!;
    expect(w.seconds.full).toBe(60);
    const a = w.actions;
    expect(a.walk).toBeGreaterThan(0);
    expect(a.breakRate).toBeGreaterThan(0);
    expect(a.meteorEvery).toBeGreaterThan(0);
    expect(a.items?.count).toBeGreaterThan(0);
  });

  it('a câmera gira 360° em 5 s e o cenário da base começa na porta', () => {
    expect(BENCH_SCENARIOS.find((s) => s.id === 'spin')!.actions.spin).toBe(5);
    expect(BENCH_SCENARIOS.find((s) => s.id === 'base')!.origin).toBe('base');
  });

  it('o alvo principal é 120 Hz e o secundário 60 Hz', () => {
    expect([...BENCH_TARGETS]).toEqual([120, 60]);
  });

  it('mede os nove efeitos pedidos e as seis escalas de resolução', () => {
    expect(BENCH_EFFECTS.map((e) => e.id)).toEqual(['bloom', 'msaa', 'shadow', 'chromatic', 'vignette', 'noise', 'fog', 'glow', 'particles']);
    expect([...RESOLUTION_SCALES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it('a carga dos efeitos é fixa: parado, só com partículas', () => {
    const a = MATRIX_SCENARIO.actions;
    expect(a.emit).toBeGreaterThan(0);
    expect(a.walk ?? 0).toBe(0);
    expect(a.breakRate ?? 0).toBe(0);
  });
});
