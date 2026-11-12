import { describe, expect, it } from 'vitest';
import { BENCH_EFFECTS, BENCH_ORIGIN, BENCH_ORIGIN_STEP, BENCH_SCENARIOS, RESOLUTION_SCALES, THERMAL_MINUTES, plannedSeconds } from '../src/data/bench';
import { originOf, seeded } from '../src/bench/actions';
import { buildSteps } from '../src/bench/runner';

const total = (mode: 'quick' | 'full', scale = 1): number => buildSteps(mode, scale).reduce((a, s) => a + s.seconds + s.warmup, 0);

describe('passos do teste', () => {
  it('o modo rápido roda só os cenários, na ordem dos dados', () => {
    const steps = buildSteps('quick');
    expect(steps.map((s) => s.id)).toEqual(BENCH_SCENARIOS.map((s) => s.id));
    expect(steps.every((s) => s.section === 'scenarios')).toBe(true);
  });

  it('o modo completo acrescenta efeitos, resolução e aquecimento, nesta ordem', () => {
    const steps = buildSteps('full');
    const sections = steps.map((s) => s.section);
    const first = (k: string): number => sections.indexOf(k as never);
    expect(first('scenarios')).toBe(0);
    expect(first('effects')).toBeGreaterThan(first('scenarios'));
    expect(first('resolution')).toBeGreaterThan(first('effects'));
    expect(first('thermal')).toBeGreaterThan(first('resolution'));
    expect(steps.filter((s) => s.section === 'effects')).toHaveLength(1 + BENCH_EFFECTS.length * 2);
    expect(steps.filter((s) => s.section === 'resolution').map((s) => s.scale)).toEqual([...RESOLUTION_SCALES]);
    expect(steps.filter((s) => s.section === 'thermal').map((s) => s.minute)).toEqual(Array.from({ length: THERMAL_MINUTES }, (_, i) => i + 1));
  });

  it('cada efeito é medido ligado e desligado, um de cada vez', () => {
    const fx = buildSteps('full').filter((s) => s.section === 'effects' && s.effect !== 'baseline');
    for (const e of BENCH_EFFECTS) {
      const mine = fx.filter((s) => typeof s.effect === 'object' && s.effect.id === e.id).map((s) => (typeof s.effect === 'object' ? s.effect.on : null));
      expect(mine).toEqual([true, false]);
    }
  });

  it('a duração dos passos bate com a planejada (modo rápido ≈ 2 min, completo ≈ 15 min)', () => {
    expect(total('quick')).toBeCloseTo(plannedSeconds('quick'), 5);
    expect(total('full')).toBeCloseTo(plannedSeconds('full'), 5);
    expect(total('quick')).toBeGreaterThan(100);
    expect(total('quick')).toBeLessThan(150);
    expect(total('full') / 60).toBeGreaterThan(14);
    expect(total('full') / 60).toBeLessThan(17);
  });

  it('um teste encurtado (para os testes automáticos) ainda mede alguns quadros em cada passo', () => {
    for (const s of buildSteps('full', 0.01)) expect(s.seconds).toBeGreaterThanOrEqual(0.35);
    expect(total('full', 0.01)).toBeLessThan(plannedSeconds('full') * 0.2);
  });

  it('comparações esperam a GPU; cenários e aquecimento não', () => {
    for (const s of buildSteps('full')) expect(!!s.sync).toBe(s.section === 'effects' || s.section === 'resolution');
  });

  it('cada cenário parte da sua região; as comparações de efeitos ficam todas na mesma', () => {
    const steps = buildSteps('full');
    const origins = steps.filter((s) => s.section === 'scenarios').map((s) => s.origin);
    expect(new Set(origins).size).toBe(origins.length);
    expect(new Set(steps.filter((s) => s.section === 'effects').map((s) => s.origin)).size).toBe(1);
    const resolution = steps.filter((s) => s.section === 'resolution').map((s) => s.origin);
    expect(new Set(resolution).size).toBe(resolution.length);
  });
});

describe('roteiro (partes puras)', () => {
  it('os pontos de partida são fixos e distantes um do outro', () => {
    expect(originOf(0)).toEqual(BENCH_ORIGIN);
    expect(originOf(3).x - originOf(2).x).toBe(BENCH_ORIGIN_STEP);
  });

  it('o sorteio com semente repete a mesma sequência e a semente muda a sequência', () => {
    const a = seeded(7), b = seeded(7), c = seeded(8);
    const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
