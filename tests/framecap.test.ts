// Limite de FPS (core/framecap.ts): a grade de tempo fixa, simulando o requestAnimationFrame de uma tela de 60 e de 120 Hz.
import { describe, expect, it } from 'vitest';
import { FrameCap } from '../src/core/framecap';

/** instantes dos quadros aceitos por `seconds` de uma tela de `hz`, com ruído de ±`jitter` ms em cada tick */
function simulate(capFps: number, hz: number, seconds = 10, jitter = 0.8, skip = (_i: number): boolean => false): number[] {
  const cap = new FrameCap(capFps > 0 ? 1000 / capFps : 0);
  const out: number[] = [];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const tick = 1000 / hz;
  for (let i = 0; i < seconds * hz; i++) {
    if (skip(i)) continue;
    const now = 1000 + i * tick + rnd() * jitter;
    if (cap.allow(now)) out.push(now);
  }
  return out;
}
const gaps = (t: number[]): number[] => t.slice(1).map((x, i) => x - t[i]);

describe('FrameCap', () => {
  it('sem limite desenha todo tick', () => {
    expect(simulate(0, 60).length).toBe(600);
  });

  it('30 FPS numa tela de 60 Hz: um quadro a cada 2 ticks, sem alternar com 3', () => {
    const t = simulate(30, 60);
    expect(t.length).toBeGreaterThanOrEqual(299);
    expect(t.length).toBeLessThanOrEqual(301);
    for (const g of gaps(t)) expect(Math.abs(g - 33.33)).toBeLessThan(2);
  });

  it('60 FPS numa tela de 120 Hz: um quadro a cada 2 ticks', () => {
    const t = simulate(60, 120);
    expect(t.length).toBeGreaterThanOrEqual(599);
    expect(t.length).toBeLessThanOrEqual(601);
    for (const g of gaps(t)) expect(Math.abs(g - 16.67)).toBeLessThan(2);
  });

  it('30 FPS numa tela de 120 Hz: um quadro a cada 4 ticks', () => {
    const t = simulate(30, 120);
    expect(t.length).toBeGreaterThanOrEqual(299);
    expect(t.length).toBeLessThanOrEqual(301);
    for (const g of gaps(t)) expect(Math.abs(g - 33.33)).toBeLessThan(2);
  });

  it('60 FPS numa tela de 60 Hz com ruído: não pula quadros à toa', () => {
    const t = simulate(60, 60, 10, 1.4);
    expect(t.length).toBeGreaterThanOrEqual(595);
  });

  it('60 FPS numa tela de 90 Hz (não é múltiplo): entrega os 60, não 45', () => {
    // o jeito antigo (esperar 15 ms desde o último quadro) só aceitava de 2 em 2 ticks de 11 ms: 45 FPS
    const t = simulate(60, 90);
    expect(t.length).toBeGreaterThanOrEqual(590);
    expect(t.length).toBeLessThanOrEqual(605);
  });

  it('um tick perdido não desvia a grade: o ritmo continua o mesmo depois', () => {
    // a tela perde um tick em volta do 200º (o navegador atrasou um quadro)
    const t = simulate(30, 60, 10, 0.5, (i) => i === 200);
    const after = gaps(t.filter((x) => x > 5000));
    for (const g of after) expect(Math.abs(g - 33.33)).toBeLessThan(2);
  });

  it('uma travada longa recomeça a grade, sem rajada de quadros para recuperar', () => {
    const cap = new FrameCap(1000 / 30);
    expect(cap.allow(1000)).toBe(true);
    expect(cap.allow(2000)).toBe(true); // 1 s depois (travada)
    expect(cap.allow(2016)).toBe(false); // não vem outro logo em seguida
    expect(cap.allow(2034)).toBe(true);
  });

  it('mudar o limite recomeça a grade', () => {
    const cap = new FrameCap(1000 / 30);
    cap.allow(0);
    cap.setCap(1000 / 60);
    expect(cap.allow(1)).toBe(true);
  });
});
