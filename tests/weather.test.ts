import { describe, expect, it } from 'vitest';
import { WEATHER, Weather } from '../src/systems/Weather';

function run(w: Weather, seconds: number, step = 0.1): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds; t += step) {
    const p = w.update(step);
    if (p) out.push(p);
  }
  return out;
}

describe('clima de Marte', () => {
  it('começa calmo, sem poeira', () => {
    const w = new Weather(3);
    expect(w.phase).toBe('calm');
    expect(w.level).toBe(0);
  });

  it('as fases seguem a ordem calmo → chegando → tempestade → passando → calmo', () => {
    const w = new Weather(5);
    const total = WEATHER.firstCalm[1] + WEATHER.coming[1] + WEATHER.storm[1] + WEATHER.clearing[1] + 1;
    expect(run(w, total)).toEqual(['coming', 'storm', 'clearing', 'calm']);
  });

  it('a poeira sobe até 1 na tempestade e volta a 0', () => {
    const w = new Weather(7);
    let max = 0;
    for (let t = 0; t < 400; t += 0.1) {
      w.update(0.1);
      max = Math.max(max, w.level);
      expect(w.level).toBeGreaterThanOrEqual(0);
      expect(w.level).toBeLessThanOrEqual(1);
    }
    expect(max).toBeGreaterThan(0.99);
  });

  it('o vento fica mais forte na tempestade', () => {
    const w = new Weather(9);
    const calm = w.windSpeed;
    w.level = 1;
    expect(w.windSpeed).toBeGreaterThan(calm * 3);
    expect(Math.hypot(w.windX, w.windZ)).toBeCloseTo(w.windSpeed);
  });

  it('mesma semente, mesmo clima', () => {
    const a = new Weather(11), b = new Weather(11);
    expect(run(a, 300)).toEqual(run(b, 300));
    expect(a.level).toBe(b.level);
  });
});
