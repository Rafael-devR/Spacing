import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MINE_SHAKE } from '../src/app/config';
import { MAP_CELLS, MAP_STEP, sampleRelief } from '../src/render/holoMap';
import { IsoRig } from '../src/render/IsoRig';

describe('tremor da câmera ao minerar', () => {
  const rig = (): IsoRig => new IsoRig(new THREE.PerspectiveCamera());

  it('golpes e quebras seguidos não acumulam (broca rápida)', () => {
    const r = rig();
    // 40 blocos quebrando em sequência, cada um com golpes, sem tempo para o tremor baixar
    for (let i = 0; i < 40; i++) {
      r.kick(MINE_SHAKE.hit);
      r.kick(MINE_SHAKE.hit);
      r.kick(MINE_SHAKE.break);
      r.update(0.05, new THREE.Vector3());
    }
    expect(r.shaking).toBeLessThanOrEqual(MINE_SHAKE.break);
  });

  it('o tremor de soma (meteoro, pouso) continua somando até o máximo', () => {
    const r = rig();
    r.shake(0.5);
    r.shake(0.4);
    expect(r.shaking).toBeCloseTo(0.9);
    r.shake(0.5);
    expect(r.shaking).toBe(1);
  });

  it('um golpe de mineração não diminui um tremor maior em andamento', () => {
    const r = rig();
    r.shake(0.8);
    r.kick(MINE_SHAKE.hit);
    expect(r.shaking).toBeCloseTo(0.8);
  });

  it('o tremor de mineração é leve', () => {
    // amplitude = nível² × 0,9 blocos
    expect(MINE_SHAKE.break ** 2 * 0.9).toBeLessThan(0.05);
  });
});

describe('relevo do mapa do tablet', () => {
  it('tem uma amostra a cada MAP_STEP blocos e cobre a área inteira', () => {
    const seen: [number, number][] = [];
    const r = sampleRelief((x, z) => (seen.push([x, z]), 0), 100, -40, 4, MAP_STEP);
    expect(r.length).toBe(25);
    expect(seen[0]).toEqual([100 - 2 * MAP_STEP, -40 - 2 * MAP_STEP]);
    expect(seen[seen.length - 1]).toEqual([100 + 2 * MAP_STEP, -40 + 2 * MAP_STEP]);
  });

  it('é suavizado: um bloco isolado não aparece inteiro (o mapa não detalha o terreno)', () => {
    const spike = (x: number, z: number): number => (x === 0 && z === 0 ? 30 : 0);
    const r = sampleRelief(spike, 0, 0, 4, 2);
    const n = 5;
    const center = r[2 * n + 2];
    expect(center).toBeGreaterThan(0);
    expect(center).toBeLessThan(30 / 4); // média com os vizinhos
  });

  it('mantém a forma de uma rampa', () => {
    const r = sampleRelief((x) => x, 0, 0, 6, 2);
    const n = 7;
    expect(r[3 * n + 1]).toBeLessThan(r[3 * n + 5]);
  });

  it('cobre uma área grande o bastante para ver a cratera', () => {
    expect(MAP_CELLS * MAP_STEP).toBeGreaterThanOrEqual(128);
  });
});
