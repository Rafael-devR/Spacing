// Ondas de choque (render/shockwave.ts): da onda no mundo para o anel na tela, sem WebGL.
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHOCK } from '../src/data/meteors';
import { ShockWaves } from '../src/render/shockwave';

const ASPECT = 1.5;
const slots = (): THREE.Vector4[] => Array.from({ length: SHOCK.max }, () => new THREE.Vector4());

let cam: THREE.PerspectiveCamera;
beforeEach(() => {
  cam = new THREE.PerspectiveCamera(50, ASPECT, 0.1, 500);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
});

describe('ShockWaves', () => {
  it('a onda no centro da vista aparece no meio da tela, e o raio cresce até o máximo', () => {
    const w = new ShockWaves();
    w.add(0, 0, 0);
    const a = slots(), b = slots();
    expect(w.fill(cam, ASPECT, a, b)).toBe(1);
    expect(a[0].x).toBeCloseTo(0.5, 4);
    expect(a[0].y).toBeCloseTo(0.5, 4);
    expect(a[0].z).toBeCloseTo(0, 4); // acabou de nascer
    w.update(SHOCK.life * 0.2);
    w.fill(cam, ASPECT, a, b);
    const early = a[0].z;
    w.update(SHOCK.life * 0.5);
    w.fill(cam, ASPECT, a, b);
    expect(a[0].z).toBeGreaterThan(early);
  });

  it('um bloco a 10 de distância ocupa 1/(2·10·tan(fov/2)) da altura da tela', () => {
    const w = new ShockWaves();
    w.add(0, 0, 0, 1, { radius: 1, life: 1 });
    w.update(0.999); // quase no fim: o raio chegou quase a 1 bloco
    const a = slots(), b = slots();
    w.fill(cam, ASPECT, a, b);
    const k = 1 / (2 * 10 * Math.tan(THREE.MathUtils.degToRad(25)));
    expect(a[0].z).toBeCloseTo(k, 2);
  });

  it('a força e o brilho da borda caem até zero, e a onda some no fim da vida', () => {
    const w = new ShockWaves();
    w.add(0, 0, 0);
    const a = slots(), b = slots();
    w.fill(cam, ASPECT, a, b);
    const s0 = a[0].w, rim0 = b[0].y;
    expect(s0).toBeCloseTo(SHOCK.strength, 6);
    w.update(SHOCK.life * 0.6);
    w.fill(cam, ASPECT, a, b);
    expect(a[0].w).toBeLessThan(s0);
    expect(b[0].y).toBeLessThan(rim0);
    w.update(SHOCK.life);
    expect(w.count).toBe(0);
    expect(w.fill(cam, ASPECT, a, b)).toBe(0);
  });

  it('impacto maior, onda maior e mais forte (com teto na força)', () => {
    const small = new ShockWaves(), big = new ShockWaves();
    small.add(0, 0, 0, 1);
    big.add(0, 0, 0, 2);
    small.update(SHOCK.life * 0.9);
    big.update(SHOCK.life * 0.9);
    const a = slots(), b = slots(), a2 = slots(), b2 = slots();
    small.fill(cam, ASPECT, a, b);
    big.fill(cam, ASPECT, a2, b2);
    expect(a2[0].z).toBeGreaterThan(a[0].z * 1.5);
    const strong = new ShockWaves();
    strong.add(0, 0, 0, 10);
    strong.fill(cam, ASPECT, a, b);
    expect(a[0].w).toBeLessThanOrEqual(SHOCK.strength * 1.4 + 1e-9);
  });

  it('atrás da câmera não entra', () => {
    const w = new ShockWaves();
    w.add(0, 0, 30);
    expect(w.fill(cam, ASPECT, slots(), slots())).toBe(0);
  });

  it('mais ondas que o shader aguenta: ficam as mais novas', () => {
    const w = new ShockWaves();
    for (let i = 0; i < 6; i++) {
      w.add(i - 3, 0, 0);
      w.update(0.01);
    }
    const a = slots(), b = slots();
    expect(w.fill(cam, ASPECT, a, b)).toBe(SHOCK.max);
    // a primeira posição é a mais nova (x = 2): fica à direita do centro
    expect(a[0].x).toBeGreaterThan(a[SHOCK.max - 1].x);
  });

  it('o ar tremendo some se ninguém o renova, e fica enquanto renovam', () => {
    const w = new ShockWaves();
    w.haze(7, 0, 0, 0, 1.5, 1.5, 0.012);
    const a = slots(), b = slots();
    expect(w.fill(cam, ASPECT, a, b)).toBe(1);
    expect(a[0].w).toBeCloseTo(0.012, 6);
    w.update(0.1);
    w.haze(7, 0.2, 0, 0, 1.5, 1.5, 0.012);
    w.update(0.1);
    expect(w.count).toBe(1);
    w.update(0.2);
    expect(w.count).toBe(0);
  });

  it('a onda de impacto passa na frente do ar tremendo quando faltam vagas', () => {
    const w = new ShockWaves();
    w.haze(1, 0, 0, 0, 1, 1, 0.01);
    for (let i = 0; i < SHOCK.max; i++) w.add(0, 0, 0);
    const a = slots(), b = slots();
    expect(w.fill(cam, ASPECT, a, b)).toBe(SHOCK.max);
    for (let i = 0; i < SHOCK.max; i++) expect(b[i].y).toBeGreaterThan(0); // todas de impacto (a de ar não tem borda)
  });
});
