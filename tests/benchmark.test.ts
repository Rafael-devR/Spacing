import { Group, Line, Mesh, Points, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { countVisible, phaseAt, seeded } from '../src/app/Benchmark';
import { compare, percentile, Running, sameSetup, summarize, Timer, WorstFrames, type BenchResult } from '../src/core/benchStats';
import { BENCH_KEY, isBenchResult, loadBench, saveBench } from '../src/core/benchStore';
import type { KeyValueStore } from '../src/core/save';
import { BENCH_PHASES, BENCH_SECONDS, BENCH_START } from '../src/data/benchmark';
import { AIR } from '../src/data/blocks';
import { createMaterials } from '../src/render/materials';
import { PropFactory } from '../src/render/models';
import { World } from '../src/world/World';

function memoryStore(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}

/** um resultado válido mínimo, com FPS médio `fps` */
function result(fps: number, over: Partial<BenchResult> = {}): BenchResult {
  const stats = summarize([1000 / fps, 1000 / fps], [4, 4]);
  const avg = { avg: 1, max: 2 };
  const timing = { count: 1, totalMs: 1, avgMs: 1, maxMs: 1 };
  return {
    version: 1, scenario: 1, date: '2026-11-11T12:00:00.000Z', gameVersion: '0.3.0', seconds: 51, scale: 1,
    device: { userAgent: 'x', cores: 8, memoryGb: 8, gpu: 'GPU', touch: true },
    graphics: { quality: 'medio', auto: false, pixelRatio: 1.5, shadow: 2048, samples: 4, bloom: false, css: [800, 400], buffer: [1200, 600], dpr: 3 },
    muted: false, overall: stats, phases: [{ id: 'warmup', ...stats }], worst: [{ ms: 40, phase: 'mining', at: 5 }],
    chunks: { generated: timing, meshed: timing, remeshed: timing, loaded: avg },
    scene: { calls: avg, triangles: avg, objects: avg, debris: avg, particles: avg, drops: avg, loot: avg, meteors: avg },
    memory: { startMb: null, endMb: null },
    ...over,
  };
}

describe('estatísticas do teste de desempenho', () => {
  it('FPS médio, mínimo e dos 1% piores a partir dos tempos de quadro', () => {
    // 99 quadros de 10 ms (100 FPS) e um de 100 ms
    const ms = [...Array(99).fill(10), 100];
    const s = summarize(ms, ms.map(() => 5));
    expect(s.frames).toBe(100);
    expect(s.seconds).toBeCloseTo(1.09, 5);
    expect(s.avgFps).toBeCloseTo(100 / 1.09, 3); // 91,7 FPS: a média esconde a travada
    expect(s.minFps).toBeCloseTo(10, 5); // o pior quadro: 100 ms
    expect(s.low1Fps).toBeCloseTo(10, 5); // 1% de 100 quadros é 1 quadro
    expect(s.maxMs).toBe(100);
    expect(s.p95Ms).toBe(10);
    expect(s.p99Ms).toBe(10);
    expect(s.cpuAvgMs).toBe(5);
  });

  it('conta os quadros lentos por limite', () => {
    const s = summarize([16, 34, 40, 60, 120, 200], []);
    expect(s.over33).toBe(5);
    expect(s.over50).toBe(3);
    expect(s.over100).toBe(2);
  });

  it('lista vazia não dá NaN', () => {
    const s = summarize([], []);
    expect(s.avgFps).toBe(0);
    expect(s.minFps).toBe(0);
    expect(Number.isNaN(s.avgMs)).toBe(false);
  });

  it('percentil sem interpolar', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(a, 0.5)).toBe(5);
    expect(percentile(a, 0.95)).toBe(10);
    expect(percentile(a, 0)).toBe(1);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('guarda só os N piores quadros, do pior para o menos pior', () => {
    const w = new WorstFrames(3);
    for (const ms of [10, 50, 20, 90, 30, 70, 5]) w.add({ ms, phase: 'mining', at: ms });
    expect(w.all.map((f) => f.ms)).toEqual([90, 70, 50]);
  });

  it('média e máximo de uma série, e soma de tempos', () => {
    const r = new Running();
    for (const v of [2, 4, 9]) r.add(v);
    expect(r.value).toEqual({ avg: 5, max: 9 });
    expect(new Running().value).toEqual({ avg: 0, max: 0 });
    const t = new Timer();
    t.add(1);
    t.add(3);
    expect(t.value).toEqual({ count: 2, totalMs: 4, avgMs: 2, maxMs: 3 });
  });
});

describe('comparar antes e depois', () => {
  it('FPS maior é melhor; milissegundos menores são melhores', () => {
    expect(compare(60, 40, true).verdict).toBe('better');
    expect(compare(30, 40, true).verdict).toBe('worse');
    expect(compare(10, 20, false).verdict).toBe('better');
    expect(compare(30, 20, false).verdict).toBe('worse');
  });

  it('variação pequena é ruído, não melhora', () => {
    expect(compare(40.5, 40, true).verdict).toBe('same');
    expect(compare(39.5, 40, true).verdict).toBe('same');
    expect(compare(41, 40, true).verdict).toBe('better'); // 2,5%
  });

  it('percentual e diferença', () => {
    const c = compare(45, 30, true);
    expect(c.diff).toBe(15);
    expect(c.pct).toBeCloseTo(0.5, 5);
    expect(compare(5, 0, true).pct).toBeNull(); // antes 0: sem percentual, mas não quebra
  });

  it('só compara direto o mesmo cenário, qualidade, resolução e som', () => {
    const a = result(60);
    expect(sameSetup(a, result(30))).toBe(true);
    expect(sameSetup(a, result(30, { scenario: 2 }))).toBe(false);
    expect(sameSetup(a, result(30, { graphics: { ...a.graphics, quality: 'alto' } }))).toBe(false);
    expect(sameSetup(a, result(30, { graphics: { ...a.graphics, buffer: [1000, 500] } }))).toBe(false);
    expect(sameSetup(a, result(30, { muted: true }))).toBe(false);
  });
});

describe('último resultado guardado', () => {
  it('sem nada guardado, nada para mostrar', () => {
    expect(loadBench(memoryStore())).toEqual({ last: null, previous: null });
    expect(loadBench(null)).toEqual({ last: null, previous: null });
  });

  it('guarda o último e o anterior (o que era o último vira o anterior)', () => {
    const store = memoryStore();
    saveBench(store, result(20));
    expect(loadBench(store).last?.overall.avgFps).toBeCloseTo(20);
    expect(loadBench(store).previous).toBeNull();
    saveBench(store, result(45));
    saveBench(store, result(60));
    const b = loadBench(store);
    expect(b.last?.overall.avgFps).toBeCloseTo(60);
    expect(b.previous?.overall.avgFps).toBeCloseTo(45); // só dois: o de 20 saiu
  });

  it('fica fora do salvamento do jogo', () => {
    expect(BENCH_KEY).not.toBe('spacing.save');
    const store = memoryStore();
    saveBench(store, result(30));
    expect(Object.keys(store.data)).toEqual([BENCH_KEY]);
  });

  it('descarta lixo, versão futura e dados quebrados', () => {
    expect(isBenchResult(null)).toBe(false);
    expect(isBenchResult({ version: 2 })).toBe(false);
    expect(isBenchResult({ ...result(30), version: 9 })).toBe(false);
    expect(isBenchResult({ ...result(30), overall: { avgFps: 'x' } })).toBe(false);
    expect(isBenchResult(result(30))).toBe(true);
    const store = memoryStore();
    store.setItem(BENCH_KEY, '{nao e json');
    expect(loadBench(store)).toEqual({ last: null, previous: null });
    store.setItem(BENCH_KEY, JSON.stringify({ last: { x: 1 }, previous: result(33) }));
    const b = loadBench(store);
    expect(b.last).toBeNull();
    expect(b.previous?.overall.avgFps).toBeCloseTo(33);
  });

  it('um resultado sobrevive ao ciclo gravar e ler', () => {
    const store = memoryStore();
    const r = result(37.5);
    saveBench(store, r);
    expect(loadBench(store).last).toEqual(JSON.parse(JSON.stringify(r)));
  });
});

describe('cenário do teste', () => {
  it('reproduz o que pesa: quebrar blocos, meteoros, andar rápido e tudo junto', () => {
    const has = (f: (p: (typeof BENCH_PHASES)[number]) => boolean): boolean => BENCH_PHASES.some(f);
    expect(has((p) => p.breakRate >= 20)).toBe(true);
    expect(has((p) => p.meteorEvery > 0)).toBe(true);
    expect(has((p) => p.walk >= 4.6 * 4)).toBe(true); // bem mais rápido que o astronauta normal
    expect(has((p) => p.breakRate > 0 && p.meteorEvery > 0 && p.walk > 0)).toBe(true);
    expect(new Set(BENCH_PHASES.map((p) => p.id)).size).toBe(BENCH_PHASES.length);
  });

  it('dura cerca de 1 minuto e começa longe da base e da sonda', () => {
    expect(BENCH_SECONDS).toBeGreaterThan(30);
    expect(BENCH_SECONDS).toBeLessThanOrEqual(75);
    expect(Math.hypot(BENCH_START.x, BENCH_START.z)).toBeGreaterThan(200);
  });

  it('acha a etapa pelo tempo decorrido, também no teste abreviado', () => {
    expect(phaseAt(0)?.phase.id).toBe('warmup');
    expect(phaseAt(BENCH_PHASES[0].seconds)?.phase.id).toBe('mining');
    expect(phaseAt(BENCH_SECONDS - 0.01)?.phase.id).toBe('everything');
    expect(phaseAt(BENCH_SECONDS)).toBeNull();
    expect(phaseAt(BENCH_SECONDS * 0.1 - 0.001, 0.1)?.phase.id).toBe('everything');
    expect(phaseAt(BENCH_SECONDS * 0.1, 0.1)).toBeNull();
  });

  it('o sorteio com semente repete a mesma sequência', () => {
    const a = seeded(7), b = seeded(7), c = seeded(8);
    const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('conta só os objetos desenháveis e visíveis', () => {
    const scene = new Scene();
    expect(countVisible(scene)).toBe(0);
    const visible = new Mesh(), hidden = new Mesh(), group = new Group(), nested = new Mesh(), points = new Points(), line = new Line();
    hidden.visible = false;
    group.add(nested);
    scene.add(visible, hidden, group, points, line);
    expect(countVisible(scene)).toBe(4); // malha, malha dentro do grupo, pontos e linha; o escondido e o grupo vazio não contam
    group.visible = false; // esconder o grupo esconde o que está dentro
    expect(countVisible(scene)).toBe(3);
  });
});

describe('medição de chunks no mundo', () => {
  function makeWorld(): World {
    const mats = createMaterials();
    const w = new World(new Scene(), 20261111, mats.terrain, new PropFactory(mats.props));
    w.radius = 1;
    return w;
  }

  it('fora do teste não mede nada (o custo é só uma checagem)', () => {
    const w = makeWorld();
    expect(w.perf).toBeNull();
    w.update(0, 0, 99, 0);
    expect(w.chunkCount).toBeGreaterThan(0);
  });

  it('mede gerar chunks e malhar chunks novos', () => {
    const w = makeWorld();
    const gen: number[] = [], mesh: [number, boolean][] = [];
    w.perf = { onGenerate: (ms) => gen.push(ms), onMesh: (ms, edit) => mesh.push([ms, edit]) };
    w.update(0, 0, 99, 0);
    expect(gen.length).toBeGreaterThanOrEqual(w.chunkCount - 1);
    expect(mesh.length).toBeGreaterThan(0);
    expect(mesh.every(([, edit]) => !edit)).toBe(true);
    expect([...gen, ...mesh.map(([ms]) => ms)].every((ms) => ms >= 0)).toBe(true);
  });

  it('refazer a malha depois de quebrar um bloco é medido à parte', () => {
    const w = makeWorld();
    w.update(0, 0, 99, 0);
    const mesh: boolean[] = [];
    w.perf = { onGenerate: () => undefined, onMesh: (_ms, edit) => mesh.push(edit) };
    const top = w.topY(5, 5);
    w.setBlock(5, top, 5, AIR);
    expect(mesh).toEqual([true]);
    // andar até um chunk novo mede de novo como malha nova
    w.update(200, 0, 99, 0);
    expect(mesh.some((e) => !e)).toBe(true);
  });

  it('o ponto de partida do teste é terreno de verdade', () => {
    const w = makeWorld();
    const y = w.topY(BENCH_START.x, BENCH_START.z);
    expect(y).toBeGreaterThan(2);
    expect(new Vector3(BENCH_START.x, y, BENCH_START.z).y).toBe(y);
  });
});
