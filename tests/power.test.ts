import { describe, expect, it } from 'vitest';
import { POWER } from '../src/data/power';
import { Power, type Load } from '../src/systems/Power';

type P = { key: string; x: number; z: number };

function setup(opts: { panels?: P[]; loads?: Load[]; solar?: number; shade?: number; lit?: (x: number) => number | null; battery?: number; dust?: number } = {}) {
  let loads = opts.loads ?? [];
  const p = new Power(
    {
      base: { x: 0, z: 0 },
      solar: opts.solar ?? 1,
      shade: opts.shade ?? 0,
      panels: () => opts.panels ?? [],
      exposure: (x) => (opts.lit ? opts.lit(x) : 1),
      loads: () => loads,
      dust: () => opts.dust ?? 0,
    },
    opts.battery !== undefined ? { battery: opts.battery } : null,
  );
  return { p, setLoads: (l: Load[]) => (loads = l) };
}

describe('energia da base: nada vem do nada', () => {
  it('o telhado gera, o habitat gasta; a sobra carrega a bateria', () => {
    const { p } = setup({ battery: 0 });
    p.update(10);
    expect(p.generation).toBeCloseTo(POWER.roofPanels * POWER.roofPanelKw);
    expect(p.demand).toBeCloseTo(POWER.lifeSupportKw);
    expect(p.battery).toBeCloseTo((p.generation - p.demand) * 10);
    expect(p.satisfaction).toBe(1);
  });

  it('gastando mais do que gera: a bateria segura, e vazia as máquinas desaceleram na proporção', () => {
    const { p } = setup({ battery: 10, loads: [{ id: 'electrolyzer', kw: 2.4 }, { id: 'workbench', kw: 1.2 }] });
    p.update(1);
    expect(p.satisfaction).toBe(1);
    p.update(100);
    expect(p.battery).toBe(0);
    p.update(1);
    expect(p.satisfaction).toBeCloseTo(p.generation / p.demand);
    expect(p.satisfaction).toBeLessThan(1);
  });

  it('painéis no chão: longe do cabo não liga, na sombra não gera na Lua (em Marte, um pouco)', () => {
    const panels = [
      { key: 'a', x: 3, z: 0 },
      { key: 'b', x: 5, z: 0 },
      { key: 'c', x: POWER.cableReach + 10, z: 0 },
    ];
    const lua = setup({ panels, lit: (x) => (x === 5 ? 0 : 1) }).p;
    lua.update(1);
    const [a, b, c] = lua.panels;
    expect(a).toMatchObject({ linked: true, kw: POWER.panelKw });
    expect(b.kw).toBe(0);
    expect(c).toMatchObject({ linked: false, kw: 0 });
    const marte = setup({ panels, solar: 0.43, shade: POWER.shadeMarte, lit: (x) => (x === 5 ? 0 : 1) }).p;
    marte.update(1);
    expect(marte.panels[0].kw).toBeCloseTo(POWER.panelKw * 0.43);
    expect(marte.panels[1].kw).toBeCloseTo(POWER.panelKw * 0.43 * POWER.shadeMarte);
  });

  it('tempestade de poeira tira sol dos painéis e dos espelhos do forno', () => {
    const { p } = setup({ solar: 0.43, dust: 1 });
    p.update(1);
    expect(p.sun).toBeCloseTo(0.43 * (1 - POWER.stormLoss));
    expect(p.roofKw).toBeCloseTo(POWER.roofPanels * POWER.roofPanelKw * p.sun);
  });

  it('a bateria volta do salvamento, dentro dos limites', () => {
    expect(setup({ battery: 123 }).p.serialize()).toEqual({ battery: 123 });
    expect(setup({ battery: 1e9 }).p.battery).toBe(POWER.batteryKj);
  });
});
