import { describe, expect, it } from 'vitest';
import { AstronautAnimator, GESTURE_TIME, JOINTS, type AnimState, type Pose } from '../src/render/astronautAnim';
import { DUSTY, dustOf } from '../src/render/dustFx';
import { HULL, ICE, IRON, MARS_DUST, REGOLITH } from '../src/data/blocks';

const base: AnimState = { speed: 0, maxSpeed: 4.6, onGround: true, vy: 0, turn: 0, mining: false, holding: false, dead: false };

/** roda a animação por `secs` segundos a 60 quadros e devolve o maior valor de `f(pose)` visto */
function run(a: AstronautAnimator, s: Partial<AnimState>, secs: number, f: (p: Pose) => number = () => 0): number {
  let max = -Infinity;
  for (let t = 0; t < secs; t += 1 / 60) max = Math.max(max, f(a.update(1 / 60, { ...base, ...s })));
  return max;
}

const finite = (p: Pose): boolean =>
  JOINTS.every((j) => Number.isFinite(p.j[j].x) && Number.isFinite(p.j[j].y) && Number.isFinite(p.j[j].z)) &&
  Number.isFinite(p.hipY) && Number.isFinite(p.stretch);

describe('animação do astronauta', () => {
  it('parado: pose calma, perto do repouso', () => {
    const a = new AstronautAnimator();
    const swing = run(a, {}, 3, (p) => Math.abs(p.j.legL.x));
    expect(swing).toBeLessThan(0.15);
    expect(finite(a.pose)).toBe(true);
  });

  it('correr balança as pernas mais que andar, e os pés nunca param no lugar', () => {
    const walk = run(new AstronautAnimator(), { speed: 1.5 }, 3, (p) => Math.abs(p.j.legL.x));
    const sprint = run(new AstronautAnimator(), { speed: 4.6 }, 3, (p) => Math.abs(p.j.legL.x));
    expect(walk).toBeGreaterThan(0.25);
    expect(sprint).toBeGreaterThan(walk);
    // correndo, os cotovelos dobram
    const a = new AstronautAnimator();
    run(a, { speed: 4.6 }, 2);
    expect(a.pose.j.foreL.x).toBeLessThan(-0.6);
  });

  it('caindo: os braços sobem; subindo, não tanto', () => {
    const rise = new AstronautAnimator();
    run(rise, { onGround: false, vy: 5 }, 0.5);
    const fall = new AstronautAnimator();
    run(fall, { onGround: false, vy: -8 }, 1);
    expect(-fall.pose.j.armL.z).toBeGreaterThan(1.4);
    expect(fall.pose.j.armR.z).toBeGreaterThan(1.4);
    expect(-rise.pose.j.armL.z).toBeLessThan(-fall.pose.j.armL.z);
  });

  it('pouso: agacha (quadril desce, joelhos dobram) e volta', () => {
    const a = new AstronautAnimator();
    run(a, {}, 1);
    a.landed(1);
    const knee = run(a, {}, 0.2, (p) => p.j.shinL.x);
    expect(knee).toBeGreaterThan(0.4);
    expect(a.pose.stretch).not.toBe(1);
    run(a, {}, 2);
    expect(Math.abs(a.pose.j.shinL.x)).toBeLessThan(0.2);
  });

  it('minerando e segurando item: o braço direito vai para a frente', () => {
    const m = new AstronautAnimator();
    run(m, { mining: true }, 1);
    expect(m.pose.j.armR.x).toBeLessThan(-1);
    const h = new AstronautAnimator();
    run(h, { holding: true }, 1);
    expect(h.pose.j.foreR.x).toBeLessThan(-0.8);
  });

  it('gestos acabam sozinhos', () => {
    const a = new AstronautAnimator();
    for (const g of Object.keys(GESTURE_TIME) as (keyof typeof GESTURE_TIME)[]) {
      a.play(g);
      expect(a.currentGesture).toBe(g);
      run(a, {}, GESTURE_TIME[g] + 0.1);
      expect(a.currentGesture).toBeNull();
      expect(finite(a.pose)).toBe(true);
    }
  });

  it('morto: deitado de costas', () => {
    const a = new AstronautAnimator();
    run(a, { dead: true }, 2);
    expect(a.pose.j.hips.x).toBeLessThan(-1.1);
  });

  it('quadros longos (aba em segundo plano) não explodem as molas', () => {
    const a = new AstronautAnimator();
    a.landed(1);
    for (let i = 0; i < 20; i++) a.update(0.5, { ...base, speed: 4.6 });
    expect(finite(a.pose)).toBe(true);
    expect(Math.abs(a.pose.hipY)).toBeLessThan(1);
  });
});

describe('poeira dos pés', () => {
  it('chão solto solta poeira com a cor dele; metal, gelo e casco não', () => {
    expect(dustOf(REGOLITH)).not.toBeNull();
    const moon = dustOf(REGOLITH)!, mars = dustOf(MARS_DUST)!;
    // Marte é avermelhado: mais vermelho que azul; a Lua é clara e neutra
    expect(mars.cloud[0]).toBeGreaterThan(mars.cloud[2] * 1.5);
    expect(moon.cloud[0]).toBeGreaterThan(mars.cloud[0]);
    for (const b of [IRON, ICE, HULL]) expect(dustOf(b)).toBeNull();
    for (const v of DUSTY.values()) expect(v).toBeGreaterThan(0);
  });
});
