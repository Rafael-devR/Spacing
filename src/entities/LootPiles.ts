// Itens caídos na morte: saem do astronauta com física, param no chão flutuando e brilhando,
// e voltam ao inventário quando o jogador passa perto. Ficam no salvamento até serem recolhidos.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import { ITEM_ORDER, type ItemId } from '../data/items';
import { SURVIVAL } from '../data/survival';
import type { ItemModels } from '../render/itemModels';
import type { World } from '../world/World';
import type { ItemDrops } from './ItemDrops';
import type { Player } from './Player';

/** no máximo este número de pedaços por tipo de item, para não encher a cena */
const MAX_PIECES_PER_ITEM = 4;
const GRAVITY = 9;
const HOVER = 0.38;

export interface LootSave {
  item: ItemId;
  amount: number;
  x: number;
  y: number;
  z: number;
  pile: number;
}

interface Piece {
  item: ItemId;
  amount: number;
  pile: number;
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  resting: boolean;
  /** altura do chão onde parou */
  restY: number;
  phase: number;
  /** segundos até poder ser recolhido (evita pegar de volta no instante da morte) */
  cooldown: number;
}

let haloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  haloTexture = new THREE.CanvasTexture(cv);
  return haloTexture;
}

export class LootPiles {
  private readonly pieces: Piece[] = [];
  private nextPile = 1;
  private readonly haloMat: THREE.SpriteMaterial | null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly models: ItemModels,
    private readonly world: World,
    private readonly drops: ItemDrops,
    private readonly events?: GameBus,
  ) {
    this.haloMat =
      typeof document === 'undefined'
        ? null
        : new THREE.SpriteMaterial({
            map: getHaloTexture(), color: new THREE.Color(0.5, 1.5, 1.9), transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
          });
  }

  get count(): number {
    return this.pieces.length;
  }

  /** Espalha os itens a partir de um ponto (morte). */
  drop(at: THREE.Vector3, items: Partial<Record<ItemId, number>>): void {
    const pile = this.nextPile++;
    let n = 0;
    for (const item of ITEM_ORDER) {
      const total = items[item] ?? 0;
      if (total <= 0) continue;
      const parts = Math.min(total, MAX_PIECES_PER_ITEM);
      for (let k = 0; k < parts; k++) {
        const amount = Math.floor(total / parts) + (k < total % parts ? 1 : 0);
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 2.5;
        this.add(item, amount, pile, at.clone().add(new THREE.Vector3(0, 0.9, 0)),
          new THREE.Vector3(Math.cos(a) * sp, 4 + Math.random() * 3, Math.sin(a) * sp), false);
        n++;
      }
    }
    if (n) this.events?.emit('loot:dropped', { x: at.x, y: at.y, z: at.z, pieces: n });
  }

  private add(item: ItemId, amount: number, pile: number, pos: THREE.Vector3, vel: THREE.Vector3, resting: boolean): void {
    const mesh = this.models.create(item);
    mesh.scale.setScalar(this.models.dropScale(item) * 1.15);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    const halo = new THREE.Sprite(this.haloMat ?? undefined);
    halo.scale.setScalar(1.1);
    halo.position.copy(pos);
    this.scene.add(mesh, halo);
    this.pieces.push({
      item, amount, pile, mesh, halo, pos: pos.clone(), vel, resting,
      restY: resting ? pos.y - HOVER : pos.y, phase: Math.random() * 6, cooldown: resting ? 0 : 1.2,
    });
  }

  /** `canCollect` = falso no menu inicial (o jogador ainda não está jogando). */
  update(dt: number, t: number, player: Player, canCollect = true): void {
    const pc = player.center();
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (!p.resting) {
        p.vel.y -= GRAVITY * dt;
        p.vel.x *= 1 - dt * 0.6;
        p.vel.z *= 1 - dt * 0.6;
        p.pos.addScaledVector(p.vel, dt);
        const ground = this.world.topY(Math.floor(p.pos.x), Math.floor(p.pos.z)) + 1;
        if (p.pos.y <= ground + HOVER && p.vel.y < 0) {
          if (p.vel.y < -3) {
            p.vel.y *= -0.35; // um quique
            p.pos.y = ground + HOVER;
          } else {
            p.resting = true;
            p.restY = ground;
          }
        }
      }
      if (p.resting) {
        // se o chão sumir (bloco minerado), volta a cair
        const ground = this.world.topY(Math.floor(p.pos.x), Math.floor(p.pos.z)) + 1;
        if (ground < p.restY - 0.01) {
          p.resting = false;
          p.vel.set(0, 0, 0);
        } else {
          p.restY = ground;
          p.pos.y = ground + HOVER + Math.sin(t * 2.2 + p.phase) * 0.08;
        }
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.y = t * 1.4 + p.phase;
      p.mesh.rotation.x = Math.sin(t + p.phase) * 0.3;
      p.halo.position.copy(p.pos);
      p.halo.scale.setScalar(1 + Math.sin(t * 3 + p.phase) * 0.12);

      // ímã: passar perto recolhe
      if (canCollect && p.cooldown <= 0 && !player.dead) {
        const dx = pc.x - p.pos.x, dz = pc.z - p.pos.z, dy = pc.y - p.pos.y;
        if (Math.hypot(dx, dz) < SURVIVAL.pickupRadius && Math.abs(dy) < 2) {
          this.remove(i);
          this.drops.fly(p.item, p.pos, p.amount);
        }
      }
    }
  }

  private remove(i: number): void {
    const p = this.pieces[i];
    this.scene.remove(p.mesh, p.halo);
    this.pieces.splice(i, 1);
  }

  /** Posição da pilha mais recente que ainda tem itens (para o marcador). */
  latest(): THREE.Vector3 | null {
    let best: Piece | null = null;
    for (const p of this.pieces) if (!best || p.pile > best.pile) best = p;
    if (!best) return null;
    const same = this.pieces.filter((p) => p.pile === best.pile);
    const c = new THREE.Vector3();
    for (const p of same) c.add(p.pos);
    c.divideScalar(same.length);
    c.y = best.restY;
    return c;
  }

  /** quantidade total de cada item no chão */
  totals(): Partial<Record<ItemId, number>> {
    const out: Partial<Record<ItemId, number>> = {};
    for (const p of this.pieces) out[p.item] = (out[p.item] ?? 0) + p.amount;
    return out;
  }

  serialize(): LootSave[] {
    return this.pieces.map((p) => ({
      item: p.item, amount: p.amount, pile: p.pile,
      x: p.pos.x, y: p.resting ? p.restY + HOVER : p.pos.y, z: p.pos.z,
    }));
  }

  load(list: LootSave[]): void {
    for (const l of list) {
      this.add(l.item, l.amount, l.pile, new THREE.Vector3(l.x, l.y, l.z), new THREE.Vector3(), false);
      this.nextPile = Math.max(this.nextPile, l.pile + 1);
    }
    // ao carregar, os pedaços assentam no chão sem esperar
    for (const p of this.pieces) p.cooldown = 0;
  }
}
