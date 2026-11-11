import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { exteriorOnly, INTERIOR_LAYER, showIndoors } from '../src/render/indoors';

describe('camada do interior da base', () => {
  it('põe a base na camada do interior, menos as partes de fora', () => {
    const base = new THREE.Group();
    const wall = new THREE.Mesh();
    const legs = exteriorOnly(new THREE.Group());
    const leg = new THREE.Mesh();
    legs.add(leg);
    base.add(wall, legs);
    showIndoors(base);
    const inside = new THREE.Layers();
    inside.set(INTERIOR_LAYER);
    const world = new THREE.Layers();
    expect(wall.layers.test(inside)).toBe(true);
    expect(wall.layers.test(world)).toBe(true); // continua visível de fora
    expect(legs.layers.test(inside)).toBe(false);
    expect(leg.layers.test(inside)).toBe(false);
  });

  it('o terreno, que não entra na camada, some para a câmera de dentro', () => {
    const chunk = new THREE.Mesh();
    const cam = new THREE.PerspectiveCamera();
    cam.layers.set(INTERIOR_LAYER);
    expect(chunk.layers.test(cam.layers)).toBe(false);
  });
});
