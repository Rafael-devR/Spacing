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
