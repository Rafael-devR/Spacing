// Itens soltos: saltam do que foi minerado e voam até o jogador.
import * as THREE from 'three';
import type { ItemId } from '../data/items';
import { MICROGRAVITY } from '../data/physics';
import type { ItemModels } from '../render/itemModels';
import type { Inventory } from '../systems/Inventory';
import type { Player } from './Player';

interface Drop {
  obj: THREE.Mesh;
  item: ItemId;
  /** quantas unidades o item entrega ao chegar */
  amount: number;
  /** negativo = ainda não saiu (saída em sequência) */
  age: number;
  vel: THREE.Vector3;
}

export class ItemDrops {
  private readonly drops: Drop[] = [];
  private readonly v = new THREE.Vector3();
  /** o que chegou e não coube no inventário (mochila cheia) */
  onOverflow: ((item: ItemId, amount: number, at: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly models: ItemModels,
    private readonly inventory: Inventory,
  ) {}

  /** itens soltos voando até o jogador agora */
  get count(): number {
    return this.drops.length;
  }

  spawn(item: ItemId, at: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      const obj = this.models.createOutlined(item);
      obj.scale.setScalar(this.models.dropScale(item));
      obj.position.copy(at);
      obj.castShadow = true;
      this.scene.add(obj);
      const a = Math.random() * Math.PI * 2;
      this.drops.push({ obj, item, amount: 1, age: -i * 0.08, vel: new THREE.Vector3(Math.cos(a) * 0.9, 1.3 + Math.random() * 0.6, Math.sin(a) * 0.9) });
    }
  }

  /** Um item que já está no chão sai voando até o jogador e entrega `amount` unidades. */
  fly(item: ItemId, from: THREE.Vector3, amount: number): void {
    const obj = this.models.createOutlined(item);
    obj.scale.setScalar(this.models.dropScale(item));
    obj.position.copy(from);
    obj.castShadow = true;
    this.scene.add(obj);
    // já pula a fase de salto: vai direto para o jogador
    this.drops.push({ obj, item, amount, age: 0.45, vel: new THREE.Vector3() });
  }

  update(dt: number, player: Player): void {
    const target = player.center();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age < 0) continue;
      const o = d.obj;
      if (d.age < 0.45) {
        d.vel.y -= MICROGRAVITY * dt;
        o.position.addScaledVector(d.vel, dt);
      } else {
        const to = this.v.subVectors(target, o.position);
        const dist = to.length();
        const sp = 4 + (d.age - 0.45) * 22;
        o.position.addScaledVector(to.normalize(), Math.min(dist, sp * dt));
        o.scale.multiplyScalar(dist < 1 ? 0.9 : 1);
        if (dist < 0.35) {
          this.scene.remove(o);
          this.drops.splice(i, 1);
          const left = this.inventory.add(d.item, d.amount);
          if (left > 0) this.onOverflow?.(d.item, left, o.position);
          continue;
        }
      }
      o.rotation.y += dt * 4;
      o.rotation.x += dt * 2;
    }
  }
}
