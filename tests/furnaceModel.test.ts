import { describe, expect, it } from 'vitest';
import { AMBIENT, FAN_MAX_SPEED, heat01, heatColor, MAX_TEMP, targetTemp, ThermalModel } from '../src/ui/station/thermal';
import { recipeById } from '../src/data/recipes';
import type { JobView } from '../src/systems/Crafting';

/** um trabalho mínimo para o teste (só o que o modelo lê) */
function job(recipe: string, over: Partial<JobView> = {}): JobView {
  return { recipe: recipeById(recipe), ready: false, paused: false, leftover: false, ...over } as JobView;
}

const run = (m: ThermalModel, target: number, secs: number): void => {
  for (let t = 0; t < secs; t += 1 / 60) m.update(1 / 60, target);
};

describe('forno: calor e ventoinha', () => {
  it('o alvo é a maior temperatura entre as vagas que trabalham, vezes a energia', () => {
    const jobs = [job('brick'), job('iron_bar'), null];
    expect(targetTemp(jobs, 1)).toBeCloseTo(1560, 0);
    expect(targetTemp(jobs, 0.5)).toBeCloseTo(AMBIENT + (1560 - AMBIENT) * 0.5, 0);
    expect(targetTemp(jobs, 0)).toBe(AMBIENT);
  });

  it('vaga pronta, pausada ou só com sobra não esquenta nada', () => {
    expect(targetTemp([job('iron_bar', { ready: true })], 1)).toBe(AMBIENT);
    expect(targetTemp([job('iron_bar', { paused: true })], 1)).toBe(AMBIENT);
    expect(targetTemp([job('iron_bar', { leftover: true })], 1)).toBe(AMBIENT);
    expect(targetTemp([null, null, null], 1)).toBe(AMBIENT);
  });

  it('esquenta em poucos segundos e esfria mais devagar do que esquentou', () => {
    const m = new ThermalModel();
    run(m, 1500, 4);
    expect(m.temp).toBeGreaterThan(1300);
    const peak = m.temp;
    run(m, AMBIENT, 4);
    // em 4 s subiu 94% do caminho; em 4 s de descida ainda restam mais de 20% do calor
    expect((m.temp - AMBIENT) / (peak - AMBIENT)).toBeGreaterThan(0.2);
    run(m, AMBIENT, 30);
    expect(m.temp).toBeLessThan(AMBIENT + 5);
  });

  it('a ventoinha gira com o calor, tem inércia e só para depois que a câmara esfriou', () => {
    const m = new ThermalModel();
    run(m, 1500, 6);
    expect(m.fan).toBeGreaterThan(0.8);
    run(m, AMBIENT, 1);
    expect(m.fan).toBeGreaterThan(0.2); // um segundo sem trabalho: ainda girando
    expect(m.cooling).toBe(true);
    run(m, AMBIENT, 40);
    expect(m.fan).toBe(0);
    expect(m.cooling).toBe(false);
  });

  it('o ângulo anda com a velocidade e nunca passa de uma volta', () => {
    const m = new ThermalModel();
    run(m, 1500, 6);
    const before = m.angle;
    m.update(0.05, 1500);
    expect(m.angle).not.toBe(before);
    for (let i = 0; i < 600; i++) {
      m.update(1 / 60, 1500);
      expect(m.angle).toBeLessThan(Math.PI * 2);
      expect(m.angle).toBeGreaterThanOrEqual(0);
    }
    expect(FAN_MAX_SPEED).toBeGreaterThan(0);
  });

  it('quadros longos (aba em segundo plano) não estragam o estado', () => {
    const m = new ThermalModel();
    for (let i = 0; i < 20; i++) m.update(5, 1500);
    expect(Number.isFinite(m.temp)).toBe(true);
    expect(m.temp).toBeLessThanOrEqual(1500);
  });

  it('a cor do calor vai do escuro ao quase branco, sem passar do fim da escala', () => {
    const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(lum(heatColor(AMBIENT))).toBeLessThan(lum(heatColor(900)));
    expect(lum(heatColor(900))).toBeLessThan(lum(heatColor(1500)));
    expect(heatColor(MAX_TEMP + 500)).toBe(heatColor(MAX_TEMP));
    expect(heatColor(-50)).toBe(heatColor(AMBIENT));
    expect(heat01(AMBIENT)).toBe(0);
    expect(heat01(MAX_TEMP)).toBe(1);
  });
});
