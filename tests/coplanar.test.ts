import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COPLANAR_STEP, separateCoplanar } from '../src/render/coplanar';

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, z);
  return m;
};
const topY = (m: THREE.Mesh): number => {
  const p = m.geometry.attributes.position;
  let y = -Infinity;
  for (let i = 0; i < p.count; i++) y = Math.max(y, p.getY(i) + m.position.y);
  return y;
};

describe('separateCoplanar (z-fighting dos modelos)', () => {
  it('a face de cima que divide o plano com outra sobe um degrau', () => {
    const root = new THREE.Group();
    const big = box(2, 1, 2, 0, 0, 0); // topo em y = 0.5
    const small = box(1, 0.5, 1, 0, 0.25, 0); // topo também em 0.5
    root.add(big, small);
    const moved = separateCoplanar(root);
    expect(moved).toBeGreaterThan(0);
    expect(topY(big)).toBeCloseTo(0.5, 6);
    expect(topY(small)).toBeCloseTo(0.5 + COPLANAR_STEP, 6);
  });

  it('modelos sem faces coplanares não mudam', () => {
    const root = new THREE.Group();
    root.add(box(1, 1, 1, 0, 0, 0), box(1, 1, 1, 3, 0, 0));
    expect(separateCoplanar(root)).toBe(0);
  });

  it('faces coplanares que só se encostam pela borda não contam', () => {
    const root = new THREE.Group();
    root.add(box(1, 1, 1, 0, 0, 0), box(1, 1, 1, 1, 0, 0)); // lado a lado, topos no mesmo plano mas sem sobrepor
    expect(separateCoplanar(root)).toBe(0);
  });
});
