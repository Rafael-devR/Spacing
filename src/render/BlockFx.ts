// Juice de bloco: ao quebrar, um "fantasma" do bloco encolhe girando; ao colocar, o bloco estica e assenta.
import * as THREE from 'three';
import type { BlockId } from '../data/blocks';
import type { ItemModels } from './itemModels';

interface Fx {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  kind: 'break' | 'place';
  spin: number;
}

export class BlockFx {
  private readonly list: Fx[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly models: ItemModels,
  ) {}

  broke(x: number, y: number, z: number, id: BlockId): void {
    this.spawn(x, y, z, id, 'break', 0.16);
  }

  placed(x: number, y: number, z: number, id: BlockId): void {
    this.spawn(x, y, z, id, 'place', 0.18);
  }

  private spawn(x: number, y: number, z: number, id: BlockId, kind: Fx['kind'], dur: number): void {
    const mesh = this.models.blockMesh(id);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.list.push({ mesh, t: 0, dur, kind, spin: (Math.random() - 0.5) * 6 });
    this.apply(this.list[this.list.length - 1]);
  }

  private apply(f: Fx): void {
    const k = Math.min(1, f.t / f.dur);
    if (f.kind === 'break') {
      // cresce um pouco e some encolhendo
      const s = k < 0.25 ? 1 + k * 0.4 : 1.1 * (1 - (k - 0.25) / 0.75);
      f.mesh.scale.setScalar(Math.max(0.001, s));
      f.mesh.rotation.y = f.spin * k * 0.3;
    } else {
      // começa esticado para cima, passa do ponto e assenta (fica por fora do bloco real)
      const e = 1 - Math.pow(1 - k, 3);
      const over = Math.sin(k * Math.PI) * 0.08;
      f.mesh.scale.set(1.02 + over, 1.02 + (1 - e) * 0.35 + over, 1.02 + over);
    }
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      if (f.t >= f.dur) {
        this.scene.remove(f.mesh);
        this.list.splice(i, 1);
        continue;
      }
      this.apply(f);
    }
  }
}
