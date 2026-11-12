import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MICROGRAVITY } from '../src/data/physics';
import { Debris } from '../src/entities/Debris';
import type { Player } from '../src/entities/Player';
import type { World } from '../src/world/World';

// mundo vazio com o chão em y = 0 (Debris trata y < 0 como sólido)
const emptyWorld = { peekBlock: () => 0 } as unknown as World;
const far = { pos: new THREE.Vector3(30, 0, 30), vel: new THREE.Vector3() } as unknown as Player;

function make(): Debris {
  return new Debris(new THREE.Scene(), emptyWorld, new THREE.MeshBasicMaterial());
}

function run(d: Debris, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) d.update(1 / 60, far);
}

interface Item {
  pos: THREE.Vector3;
}
/** o primeiro pedaço (o estado interno é o que a física mexe; a matriz só o repete) */
const first = (d: Debris): Item => (d as unknown as { items: Item[] }).items[0];
const heightOf = (d: Debris): number => first(d).pos.y;

describe('destroços em microgravidade', () => {
  it('a gravidade é leve (bem abaixo da lunar)', () => {
    expect(MICROGRAVITY).toBeGreaterThan(0);
    expect(MICROGRAVITY).toBeLessThan(1.62);
  });

  it('um pedaço solto no alto continua no alto depois de 2 segundos', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 20, 0), new THREE.Vector3(), 0.3, [1, 1, 1], 0);
    run(d, 2);
    // com a gravidade de antes (16) cairia 32 blocos; agora cai cerca de 1
    expect(heightOf(d)).toBeGreaterThan(18);
  });

  it('continua flutuando depois de 5 segundos e só desce devagar', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 20, 0), new THREE.Vector3(), 0.3, [1, 1, 1], 0);
    run(d, 5);
    const h = heightOf(d);
    expect(h).toBeGreaterThan(13);
    expect(h).toBeLessThan(20);
  });

  it('sem ar, a velocidade horizontal não diminui no alto', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 20, 0), new THREE.Vector3(2, 0, 0), 0.3, [1, 1, 1], 0);
    run(d, 3);
    expect(first(d).pos.x).toBeGreaterThan(5.5); // 2 blocos/s × 3 s = 6
  });

  it('por fim chega ao chão e para', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(), 0.3, [1, 1, 1], 0);
    run(d, 20);
    expect(heightOf(d)).toBeLessThan(0.5);
  });
});

// ---------- destroços de explosão: brasa que esfria, fumaça no voo e quebra em pedaços ----------

interface Inst {
  meshes: THREE.InstancedMesh[];
  items: { size: number; kind: number; i: number }[];
}
const inner = (d: Debris): Inst => d as unknown as Inst;
/** cor do primeiro destroço (a instância que ele ocupa no desenho) */
const colorOf = (d: Debris): THREE.Color => {
  const it = inner(d).items[0];
  const c = new THREE.Color();
  inner(d).meshes[it.kind].getColorAt(it.i, c);
  return c;
};

describe('destroços de explosão', () => {
  it('sai incandescente (cor acima de 1) e esfria até a cor da rocha', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 40, 0), new THREE.Vector3(), 0.3, [0.2, 0.2, 0.2], 0, { heat: 2 });
    const start = colorOf(d).r;
    expect(start).toBeGreaterThan(1.5);
    run(d, 1);
    const mid = colorOf(d).r;
    expect(mid).toBeLessThan(start);
    expect(mid).toBeGreaterThan(0.2);
    run(d, 1.5);
    expect(colorOf(d).r).toBeCloseTo(0.2, 3);
  });

  it('sem calor, a cor é a da rocha desde o começo', () => {
    const d = make();
    d.spawn(new THREE.Vector3(0, 40, 0), new THREE.Vector3(), 0.3, [0.2, 0.3, 0.4], 0);
    run(d, 1);
    const c = colorOf(d);
    expect(c.r).toBeCloseTo(0.2, 3);
    expect(c.b).toBeCloseTo(0.4, 3);
  });

  it('solta fumaça enquanto voa, pelo tempo pedido, e para', () => {
    const d = make();
    const calls: number[] = [];
    d.onTrail = (_x, y) => calls.push(y);
    d.spawn(new THREE.Vector3(0, 40, 0), new THREE.Vector3(3, 0, 0), 0.4, [0.3, 0.3, 0.3], 0, { trail: 1 });
    run(d, 3);
    expect(calls.length).toBeGreaterThan(12); // uma a cada 0,05 s durante 1 s
    expect(calls.length).toBeLessThanOrEqual(22);
  });

  it('sem pedir fumaça, não solta', () => {
    const d = make();
    let n = 0;
    d.onTrail = () => n++;
    d.spawn(new THREE.Vector3(0, 40, 0), new THREE.Vector3(3, 0, 0), 0.4, [0.3, 0.3, 0.3], 0);
    run(d, 1);
    expect(n).toBe(0);
  });

  it('quebra em pedaços ao bater forte no chão, uma vez só', () => {
    const d = make();
    const broke: number[] = [];
    d.onBreak = (_x, _y, _z, size) => broke.push(size);
    d.spawn(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -9, 0), 0.5, [0.3, 0.3, 0.3], 0, { splinters: 3 });
    run(d, 1);
    expect(broke).toHaveLength(1);
    expect(inner(d).items).toHaveLength(1 + 3);
    // o pedaço grande encolheu e os novos são menores
    const sizes = inner(d).items.map((i) => i.size).sort((a, b) => b - a);
    expect(sizes[0]).toBeLessThan(0.5);
    expect(sizes[1]).toBeLessThan(sizes[0]);
    run(d, 6); // quica de novo: não quebra outra vez
    expect(broke).toHaveLength(1);
  });

  it('pedaço sem `splinters` não quebra', () => {
    const d = make();
    let broke = 0;
    d.onBreak = () => broke++;
    d.spawn(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -9, 0), 0.5, [0.3, 0.3, 0.3], 0);
    run(d, 1);
    expect(broke).toBe(0);
    expect(inner(d).items).toHaveLength(1);
  });

  it('batida fraca não quebra', () => {
    const d = make();
    let broke = 0;
    d.onBreak = () => broke++;
    d.spawn(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, -1, 0), 0.5, [0.3, 0.3, 0.3], 0, { splinters: 3 });
    run(d, 2);
    expect(broke).toBe(0);
  });
});
