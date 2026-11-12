// Baforadas (render/puffs.ts): o pool, a vida e o que vai para a GPU, sem WebGL.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Puffs, type PuffSpec } from '../src/render/puffs';

const spec = (over: Partial<PuffSpec> = {}): PuffSpec => ({
  x: 1, y: 2, z: 3, vx: 0, vy: 1, vz: 0, size: 2, growTo: 3, life: 1, from: [1, 0.5, 0.25], ...over,
});

/** o atributo `aColor` do desenho (a opacidade de cada instância fica no 4º valor) */
function alphaOf(m: THREE.Mesh, i: number): number {
  return (m.geometry.getAttribute('aColor') as THREE.BufferAttribute).getW(i);
}
function sizeOf(m: THREE.Mesh, i: number): number {
  return (m.geometry.getAttribute('aShape') as THREE.BufferAttribute).getX(i);
}

describe('Puffs', () => {
  it('nasce, anda, cresce e some no fim da vida', () => {
    const scene = new THREE.Scene();
    const puffs = new Puffs(scene, 8, 8);
    expect(puffs.spawn('fire', spec({ life: 1 }))).toBe(true);
    expect(puffs.active).toBe(1);
    const fire = puffs.meshes[1];
    puffs.update(0.5);
    expect(puffs.active).toBe(1);
    expect(alphaOf(fire, 0)).toBeGreaterThan(0);
    expect(sizeOf(fire, 0)).toBeGreaterThan(2); // cresceu
    const pos = fire.geometry.getAttribute('aCenter') as THREE.BufferAttribute;
    expect(pos.getY(0)).toBeCloseTo(2.5, 5); // subiu 1 bloco/s por meio segundo
    puffs.update(0.6);
    expect(puffs.active).toBe(0);
    expect((fire.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });

  it('encheu: ignora as novas; vaga liberada serve de novo', () => {
    const puffs = new Puffs(new THREE.Scene(), 2, 2);
    expect(puffs.spawn('smoke', spec())).toBe(true);
    expect(puffs.spawn('smoke', spec())).toBe(true);
    expect(puffs.spawn('smoke', spec())).toBe(false);
    puffs.update(2);
    expect(puffs.active).toBe(0);
    expect(puffs.spawn('smoke', spec())).toBe(true);
  });

  it('fogo e fumaça são camadas separadas, uma aditiva e outra normal', () => {
    const puffs = new Puffs(new THREE.Scene(), 4, 4);
    const [smoke, fire] = puffs.meshes;
    expect((fire.material as THREE.ShaderMaterial).blending).toBe(THREE.AdditiveBlending);
    expect((smoke.material as THREE.ShaderMaterial).blending).toBe(THREE.NormalBlending);
    puffs.spawn('fire', spec());
    puffs.update(0.1);
    expect((fire.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect((smoke.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });

  it('a cor vai da de saída para a de chegada', () => {
    const puffs = new Puffs(new THREE.Scene(), 4, 4);
    puffs.spawn('fire', spec({ life: 1, from: [4, 4, 4], to: [0, 0, 0] }));
    const fire = puffs.meshes[1];
    puffs.update(0.05);
    const c = fire.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const early = c.getX(0);
    puffs.update(0.8);
    expect(c.getX(0)).toBeLessThan(early);
  });

  it('o freio e a gravidade mexem na velocidade', () => {
    const puffs = new Puffs(new THREE.Scene(), 4, 4);
    puffs.spawn('smoke', spec({ vx: 10, vy: 0, drag: 5, gravity: 4, life: 5 }));
    const pos = puffs.meshes[0].geometry.getAttribute('aCenter') as THREE.BufferAttribute;
    puffs.update(1);
    expect(pos.getX(0)).toBeLessThan(1 + 10); // freou
    expect(pos.getY(0)).toBeLessThan(2); // caiu
  });

  it('clear() apaga tudo e deixa o desenho vazio', () => {
    const puffs = new Puffs(new THREE.Scene(), 4, 4);
    puffs.spawn('fire', spec());
    puffs.spawn('smoke', spec());
    puffs.clear();
    expect(puffs.active).toBe(0);
    for (const m of puffs.meshes) expect((m.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });
});
