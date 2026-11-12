// Câmera isométrica (render/IsoRig.ts): o soco de zoom do impacto.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { IsoRig } from '../src/render/IsoRig';

function rig(): { rig: IsoRig; cam: THREE.PerspectiveCamera } {
  const cam = new THREE.PerspectiveCamera(30, 1.5, 0.1, 500);
  const r = new IsoRig(cam);
  r.snap(new THREE.Vector3(0, 0, 0));
  return { rig: r, cam };
}
const distance = (cam: THREE.Camera): number => cam.position.length();

describe('IsoRig: soco de zoom', () => {
  it('a câmera chega perto de uma vez e volta ao normal', () => {
    const { rig: r, cam } = rig();
    const normal = distance(cam);
    r.punch(2);
    r.update(0.001, new THREE.Vector3());
    expect(distance(cam)).toBeLessThan(normal - 1.5);
    for (let i = 0; i < 90; i++) r.update(1 / 60, new THREE.Vector3());
    expect(distance(cam)).toBeCloseTo(normal, 1);
    expect(r.punching).toBe(0);
  });

  it('a mola balança: passa do ponto normal antes de assentar', () => {
    const { rig: r, cam } = rig();
    const normal = distance(cam);
    r.punch(2);
    let max = 0;
    for (let i = 0; i < 60; i++) {
      r.update(1 / 60, new THREE.Vector3());
      max = Math.max(max, distance(cam) - normal);
    }
    expect(max).toBeGreaterThan(0); // chegou a ficar mais longe que o normal
    expect(max).toBeLessThan(1); // mas pouco
  });

  it('com o tremor desligado (shakeScale 0) não há soco', () => {
    const { rig: r, cam } = rig();
    r.shakeScale = 0;
    const normal = distance(cam);
    r.punch(3);
    r.update(0.001, new THREE.Vector3());
    expect(distance(cam)).toBeCloseTo(normal, 3);
  });

  it('vários socos seguidos não somam: vale o maior', () => {
    const { rig: r } = rig();
    r.punch(1);
    r.punch(1);
    r.punch(0.5);
    expect(r.punching).toBe(1);
  });
});
