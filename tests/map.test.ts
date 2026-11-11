import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MINE_SHAKE } from '../src/app/config';
import { REGOLITH } from '../src/data/blocks';
import { buildMapChunk, SKIRT } from '../src/render/blockMap';
import { IsoRig } from '../src/render/IsoRig';
import { Exploration, REVEAL_RADIUS, TILE } from '../src/systems/Exploration';

describe('tremor da câmera ao minerar', () => {
  const rig = (): IsoRig => new IsoRig(new THREE.PerspectiveCamera());

  it('golpes e quebras seguidos não acumulam (broca rápida)', () => {
    const r = rig();
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
    expect(MINE_SHAKE.break ** 2 * 0.9).toBeLessThan(0.05);
  });
});

describe('mapa descoberto aos poucos', () => {
  it('começa vazio e revela em volta de onde o astronauta está', () => {
    const e = new Exploration();
    expect(e.at(0, 0)).toBe(false);
    const n = e.revealAround(0, 0);
    expect(n).toBeGreaterThan(0);
    expect(e.at(0, 0)).toBe(true);
    expect(e.at(REVEAL_RADIUS - TILE, 0)).toBe(true);
    expect(e.at(REVEAL_RADIUS + TILE * 2, 0)).toBe(false);
    expect(e.at(0, -(REVEAL_RADIUS + TILE * 2))).toBe(false);
  });

  it('é um círculo, não um quadrado', () => {
    const e = new Exploration();
    e.revealAround(0, 0);
    const d = REVEAL_RADIUS * 0.85;
    expect(e.at(d, 0)).toBe(true);
    expect(e.at(d, d)).toBe(false); // canto: mais longe que o raio
  });

  it('andar revela mais, e ficar parado não revela nada novo', () => {
    const e = new Exploration();
    const a = e.revealAround(0, 0);
    expect(e.revealAround(0, 0)).toBe(0);
    const b = e.revealAround(60, 0);
    expect(b).toBeGreaterThan(0);
    expect(e.revealed).toBe(a + b);
    expect(e.at(60, 0)).toBe(true);
    expect(e.at(30, 0)).toBe(false); // o meio do caminho não foi visto: só onde ele esteve
  });

  it('funciona em coordenadas negativas e avisa quais chunks mudaram', () => {
    const changed: string[][] = [];
    const bus = { emit: (_: string, p: { chunks: string[] }) => changed.push(p.chunks) } as never;
    const e = new Exploration(bus);
    e.revealAround(-100, -37, 6);
    expect(e.at(-100, -37)).toBe(true);
    expect(e.at(-90, -37)).toBe(false);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('-7,-3');
  });

  it('volta igual do salvamento', () => {
    const e = new Exploration();
    e.revealAround(10, -20);
    e.revealAround(-50, 33);
    const back = new Exploration(undefined, JSON.parse(JSON.stringify(e.serialize())));
    expect(back.revealed).toBe(e.revealed);
    for (const [x, z] of [[10, -20], [-50, 33], [0, 0], [200, 200]]) expect(back.at(x, z)).toBe(e.at(x, z));
  });
});

describe('blocos do mapa', () => {
  const flat = () => ({ y: 10, id: REGOLITH });
  const tops = (g: THREE.BufferGeometry): number => {
    const n = g.getAttribute('normal');
    let c = 0;
    for (let i = 0; i < n.count; i += 4) if (n.getY(i) > 0.5) c++;
    return c;
  };

  it('nada descoberto, nada desenhado', () => {
    expect(buildMapChunk(0, 0, () => false, flat)).toBeNull();
  });

  it('um topo por coluna descoberta, na altura real do bloco', () => {
    const seen = (x: number, z: number) => x >= 0 && x < 4 && z >= 0 && z < 4;
    const g = buildMapChunk(0, 0, seen, flat)!;
    expect(tops(g)).toBe(16);
    const p = g.getAttribute('position');
    let maxY = -Infinity;
    for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
    expect(maxY).toBe(11); // topo do bloco em y 10
  });

  it('a borda do que foi descoberto desce numa saia', () => {
    const seen = (x: number, z: number) => x === 3 && z === 3;
    const g = buildMapChunk(0, 0, seen, flat)!;
    const p = g.getAttribute('position');
    let minY = Infinity;
    for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i));
    expect(minY).toBe(11 - SKIRT);
    expect(p.count).toBe(4 * 5); // topo e quatro lados
  });

  it('degraus viram paredes só onde o vizinho é mais baixo', () => {
    // dois blocos lado a lado: o da esquerda 3 mais alto
    const seen = (x: number, z: number) => (x === 0 || x === 1) && z === 0;
    const surf = (x: number) => ({ y: x === 0 ? 13 : 10, id: REGOLITH });
    const g = buildMapChunk(0, 0, seen, surf)!;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    // a parede entre os dois vai de 11 (topo do baixo) a 14 (topo do alto), virada para +x
    let wall = false;
    for (let i = 0; i < n.count; i += 4) {
      if (n.getX(i) < 0.5) continue;
      const ys = [0, 1, 2, 3].map((k) => p.getY(i + k));
      if (p.getX(i) === 1 && Math.min(...ys) === 11 && Math.max(...ys) === 14) wall = true;
    }
    expect(wall).toBe(true);
  });

  it('não mostra minério: ferro tem a cor da rocha', () => {
    const seen = (x: number, z: number) => x === 0 && z === 0;
    const rock = buildMapChunk(0, 0, seen, () => ({ y: 0, id: 3 }))!.getAttribute('color');
    const iron = buildMapChunk(0, 0, seen, () => ({ y: 0, id: 6 }))!.getAttribute('color');
    expect(Array.from(iron.array)).toEqual(Array.from(rock.array));
  });
});
