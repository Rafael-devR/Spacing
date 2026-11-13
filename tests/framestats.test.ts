// Estatísticas dos tempos de quadro (core/framestats.ts).
import { describe, expect, it } from 'vitest';
import { FrameStats } from '../src/core/framestats';

const fill = (s: FrameStats, ms: number, n: number): void => {
  for (let i = 0; i < n; i++) s.push(ms);
};

describe('FrameStats', () => {
  it('sem quadros, tudo zero', () => {
    expect(new FrameStats().summary()).toMatchObject({ fps: 0, low1Fps: 0, frames: 0 });
  });

  it('quadros uniformes: FPS, tempo médio e 1% low batem', () => {
    const s = new FrameStats();
    fill(s, 16.667, 300);
    const r = s.summary();
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.avgMs).toBeCloseTo(16.667, 2);
    expect(r.low1Fps).toBeCloseTo(60, 0);
    expect(r.maxMs).toBeCloseTo(16.667, 2);
  });

  it('1% low: poucos quadros lentos derrubam o 1% low mas quase não mexem na média', () => {
    const s = new FrameStats();
    for (let i = 0; i < 300; i++) s.push(i % 50 === 0 ? 50 : 16.667); // 6 quadros de 50 ms em 300
    const r = s.summary(5000, 5000);
    expect(r.fps).toBeGreaterThan(55);
    expect(r.low1Fps).toBeLessThan(25); // os piores 1% (3 quadros) são de 50 ms: 20 FPS
    expect(r.maxMs).toBe(50);
  });

  it('a janela curta olha só o último segundo', () => {
    const s = new FrameStats();
    fill(s, 33.33, 300); // 30 FPS por 10 s
    fill(s, 16.667, 60); // depois 60 FPS por 1 s
    expect(s.summary().fps).toBeCloseTo(60, 0);
    expect(s.summary().low1Fps).toBeLessThan(35); // a janela longa ainda lembra dos 30
  });

  it('pausa e tempos absurdos não entram', () => {
    const s = new FrameStats();
    fill(s, 16.667, 50);
    s.push(5000);
    s.push(-1);
    s.push(0);
    expect(s.summary().frames).toBe(50);
  });

  it('o gasto de CPU do quadro entra na média', () => {
    const s = new FrameStats();
    for (let i = 0; i < 30; i++) {
      s.push(16.667);
      s.setCpu(8);
    }
    expect(s.summary().cpuMs).toBeCloseTo(8, 3);
  });

  it('recent devolve os últimos, do mais antigo ao mais novo', () => {
    const s = new FrameStats();
    for (const v of [10, 20, 30, 40]) s.push(v);
    expect(s.recent(3)).toEqual([20, 30, 40]);
    expect(s.recent(10)).toEqual([10, 20, 30, 40]);
  });

  it('o anel dá a volta sem perder o que é novo', () => {
    const s = new FrameStats();
    fill(s, 10, 2000);
    fill(s, 20, 5);
    expect(s.recent(5)).toEqual([20, 20, 20, 20, 20]);
    expect(s.summary().frames).toBeGreaterThan(100);
  });
});
