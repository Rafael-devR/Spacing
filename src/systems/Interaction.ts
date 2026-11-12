// Mirar, minerar, construir e "toque para andar".
// Publica eventos (mine:hit, block:broken, prop:broken, block:placed, action:denied);
// som, tremor e HUD reagem a eles em app/Game.ts.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { RGB } from '../core/color';
import type { Input, PointerState } from '../core/Input';
import { AIR, BLOCK_DATA, HULL } from '../data/blocks';
import { ITEMS } from '../data/items';
import { PROPS, PROP_DEBRIS } from '../data/props';
import type { Debris } from '../entities/Debris';
import type { ItemDrops } from '../entities/ItemDrops';
import type { MoveInput, Player } from '../entities/Player';
import type { IsoRig } from '../render/IsoRig';
import type { Particles } from '../render/particles';
import { blockDef } from '../world/registry';
import { CH } from '../world/terrain';
import type { PropMesh, VoxelHit, World } from '../world/World';
import type { Inventory } from './Inventory';

const REACH = 4.4;

interface BlockTarget extends VoxelHit {
  kind: 'block';
  key: string;
  center: THREE.Vector3;
  hard: number;
}

interface PropTarget {
  kind: 'prop';
  mesh: PropMesh;
  key: string;
  center: THREE.Vector3;
  size: THREE.Vector3;
  hard: number;
}

export type Target = BlockTarget | PropTarget;

interface WalkGoal {
  pos: THREE.Vector3;
  /** true = parar ao ficar ao alcance; false = ir até o ponto */
  reach: boolean;
  jumps?: number;
}

export interface MiningProgress {
  /** posição na tela, em pixels */
  x: number;
  y: number;
  /** 0..1 */
  f: number;
}

/** Estado da mira para o HUD desenhar (só no toque com mira deslocada). */
export interface AimView {
  fingerX: number;
  fingerY: number;
  x: number;
  y: number;
  /** none = sem alvo; ok = ao alcance; far = longe (o astronauta vai até lá); hard = não dá para minerar (ou a broca é fraca) */
  state: 'none' | 'ok' | 'far' | 'hard';
}

export interface InteractionDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLElement;
  world: World;
  player: Player;
  rig: IsoRig;
  particles: Particles;
  debris: Debris;
  drops: ItemDrops;
  inventory: Inventory;
  events: GameBus;
  /** velocidade da broca (1 = broca inicial; cai sem bateria) */
  drillRate?: () => number;
  /** nível da broca em uso (data/drills.ts); ausente = 0 */
  drillTier?: () => number;
}

/** nível mínimo de broca que o alvo pede */
export function targetTier(t: Target): number {
  return (t.kind === 'block' ? BLOCK_DATA[t.id]?.tier : PROPS[t.mesh.userData.prop.type].tier) ?? 0;
}

/** nome do alvo para mensagens */
function targetName(t: Target): string {
  return t.kind === 'block' ? BLOCK_DATA[t.id].name : PROPS[t.mesh.userData.prop.type].name;
}

export class Interaction {
  target: Target | null = null;
  buildMode = false;
  /** progresso da mineração atual para o anel na tela; null = não está minerando */
  progress: MiningProgress | null = null;
  /** mira deslocada para o HUD; null = escondida */
  aim: AimView | null = null;
  /**
   * Mundo de fora travado (astronauta dentro da base): sem minerar, construir, mirar nem andar por toque.
   * O interior é um ambiente separado (docs/adr/0006-interior-da-base-como-camada-isolada.md).
   */
  private locked = false;
  private walkGoal: WalkGoal | null = null;
  private readonly mine: { key: string | null; progress: number; tick: number } = { key: null, progress: 0, tick: 0 };
  private stuck = 0;
  /** alvo para o qual já avisamos que a broca é fraca (avisa uma vez por alvo e toque) */
  private weakKey: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly v = new THREE.Vector3();
  private readonly lineMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: true });
  private readonly highlight: THREE.LineSegments;
  private readonly ghost: THREE.Mesh;

  constructor(private readonly d: InteractionDeps) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.highlight = new THREE.LineSegments(edges, this.lineMat);
    this.highlight.visible = false;
    this.highlight.renderOrder = 10;
    d.scene.add(this.highlight);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.ghost.visible = false;
    d.scene.add(this.ghost);
  }

  pick(px: number, py: number): Target | null {
    const { canvas, camera, world } = this.d;
    const r = canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const ray = this.raycaster.ray;
    const hit = world.raycast(ray.origin, ray.direction, 220);
    const ph = this.raycaster.intersectObjects(world.propMeshes, false)[0];
    if (ph && (!hit || ph.distance < hit.t)) {
      const mesh = ph.object as PropMesh;
      const box = new THREE.Box3().setFromObject(mesh);
      return {
        kind: 'prop', mesh, key: 'p' + mesh.id,
        center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()),
        hard: PROPS[mesh.userData.prop.type].hardness,
      };
    }
    if (hit) {
      return {
        kind: 'block', ...hit, key: `${hit.x},${hit.y},${hit.z}`,
        center: new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5),
        hard: blockDef(hit.id).hardness,
      };
    }
    return null;
  }

  inReach(t: Target | null): boolean {
    return !!t && this.d.player.center().distanceTo(t.center) <= REACH;
  }

  get worldLocked(): boolean {
    return this.locked;
  }

  /** Trava (true) ou libera o mundo de fora. Travar cancela o que estiver em andamento e sai do modo construir. */
  lockWorld(on: boolean): void {
    if (this.locked === on) return;
    this.locked = on;
    if (!on) return;
    this.cancel();
    this.setBuildMode(false);
    this.target = null;
    this.highlight.visible = false;
    this.ghost.visible = false;
  }

  setBuildMode(on: boolean): void {
    if (on && this.locked) return;
    if (this.buildMode === on) return;
    this.buildMode = on;
    this.d.events.emit('build:mode', { on });
  }

  /** Toque rápido ou clique: constrói, ou anda até o ponto se estiver longe. */
  tap(x: number, y: number, button: number): void {
    if (this.locked) return;
    const t = this.pick(x, y);
    if (!t) return;
    const placing = button === 2 || this.buildMode;
    if (placing && t.kind === 'block') {
      if (this.inReach(t)) this.place(t);
      else this.walkGoal = { pos: t.center.clone(), reach: true };
      return;
    }
    if (!this.inReach(t)) {
      // toque longe: anda até lá
      this.walkGoal = { pos: t.center.clone(), reach: t.kind === 'prop' || placing };
    }
  }

  private place(t: BlockTarget): void {
    if (this.locked) return;
    const { world, player, inventory, events, particles } = this.d;
    const item = inventory.selectedItem();
    if (!item) {
      events.emit('action:denied', { reason: 'emptySlot' });
      return;
    }
    const block = ITEMS[item].block;
    if (block === undefined) {
      events.emit('action:denied', { reason: 'notBlock', item });
      return;
    }
    const x = t.x + t.normal[0], y = t.y + t.normal[1], z = t.z + t.normal[2];
    const pm = world.propAt(x, z);
    if (
      y <= 0 || y >= CH || world.getBlock(x, y, z) !== AIR || player.intersectsBlock(x, y, z) || world.structureAt(x, y, z) ||
      (pm && pm.userData.prop.y === y)
    ) {
      events.emit('action:denied', { reason: 'blocked', item });
      return;
    }
    world.setBlock(x, y, z, block);
    inventory.removeSelected(1);
    particles.dust(x + 0.5, y, z + 0.5, 5, 0.5);
    events.emit('block:placed', { x, y, z, id: block });
  }

  /**
   * Quebra o bloco (x, y, z) com os mesmos efeitos de quando o jogador o mina (destroços, poeira, item, evento), sem
   * esperar a broca. Para o teste de desempenho (bench/actions.ts). Devolve false se o bloco não pode ser quebrado.
   */
  breakBlockAt(x: number, y: number, z: number): boolean {
    const id = this.d.world.getBlock(x, y, z);
    if (id === AIR || (BLOCK_DATA[id]?.hardness ?? Infinity) === Infinity) return false;
    this.breakTarget({
      kind: 'block', x, y, z, id, normal: [0, 1, 0], t: 0, key: `${x},${y},${z}`,
      center: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), hard: BLOCK_DATA[id].hardness,
    });
    return true;
  }

  private breakTarget(t: Target): void {
    if (this.locked) return;
    const { world, debris, particles, drops, events } = this.d;
    if (t.kind === 'block') {
      const def = blockDef(t.id);
      world.setBlock(t.x, t.y, t.z, AIR);
      const palette: RGB[] = def.oreL ? [def.sideL, def.oreL, def.sideL, def.topL] : [def.sideL, def.sideL, def.topL];
      debris.burst(t.center, def.oreL ? 18 : 15, palette, { power: 1.6, up: 1.1 });
      particles.dust(t.center.x, t.center.y - 0.3, t.center.z, 6, 0.4);
      if (def.drop) drops.spawn(def.drop, t.center, 1);
      events.emit('block:broken', { x: t.x, y: t.y, z: t.z, id: t.id });
    } else {
      const p = t.mesh.userData.prop;
      world.removeProp(t.mesh);
      const pal = PROP_DEBRIS[p.type] ?? PROP_DEBRIS.boulder;
      debris.burst(t.center, p.type === 'meteorite' ? 26 : 16, pal, { power: 1.8, up: 1.2, spread: 0.4, maxSize: 0.26 });
      particles.dust(t.center.x, t.center.y - 0.3, t.center.z, 8, 0.5);
      const pd = PROPS[p.type];
      drops.spawn(pd.drop, t.center, pd.amount);
      for (const [item, n] of Object.entries(pd.bonus ?? {}) as [keyof typeof ITEMS, number][]) drops.spawn(item, t.center, n);
      events.emit('prop:broken', { x: t.center.x, y: t.center.y, z: t.center.z, type: p.type });
    }
  }

  update(dt: number, input: Input): void {
    if (this.locked) return;
    const { player, particles, debris, camera, canvas, events } = this.d;
    const p: PointerState = input.pointer;
    const active = p.inside && (p.type === 'mouse' || p.down);
    // construir é por toque rápido, no ponto tocado; minerar segurando usa a mira deslocada
    let t = active ? (this.buildMode ? this.pick(p.x, p.y) : this.pick(p.aimX, p.aimY)) : null;
    // a base não é minerável nem serve de apoio para blocos: sem destaque
    if (t && t.kind === 'block' && t.id === HULL) t = null;
    this.target = t;
    const reach = this.inReach(t);
    // a broca em uso não dá conta deste alvo (pede um nível maior)
    const weak = !!t && t.hard !== Infinity && targetTier(t) > (this.d.drillTier?.() ?? 0);

    // destaque
    if (t) {
      this.highlight.visible = true;
      this.highlight.position.copy(t.center);
      if (t.kind === 'block') this.highlight.scale.setScalar(1.03);
      else this.highlight.scale.copy(t.size).multiplyScalar(1.08);
      this.lineMat.color.set(!reach || (weak && !this.buildMode) ? '#ff8f7a' : this.buildMode ? '#7fe7ff' : '#ffffff');
    } else this.highlight.visible = false;

    // fantasma do bloco a construir
    this.ghost.visible = !!t && t.kind === 'block' && reach && this.buildMode && this.d.inventory.selectedBlockItem() !== null;
    if (this.ghost.visible && t && t.kind === 'block') {
      this.ghost.position.set(t.x + t.normal[0] + 0.5, t.y + t.normal[1] + 0.5, t.z + t.normal[2] + 0.5);
    }

    // mineração (segurando)
    const holding = p.down && p.button === 0 && !this.buildMode && !!t && t.hard !== Infinity && !weak;
    if (!p.down) this.weakKey = null;
    else if (weak && t && !this.buildMode && reach && this.weakKey !== t.key) {
      this.weakKey = t.key;
      events.emit('drill:weak', { tier: targetTier(t), target: targetName(t) });
    }
    let mining = false;
    if (holding && t && reach) {
      if (this.mine.key !== t.key) {
        this.mine.key = t.key;
        this.mine.progress = 0;
      }
      this.mine.progress += (dt / t.hard) * (this.d.drillRate?.() ?? 1);
      this.mine.tick -= dt;
      mining = true;
      this.walkGoal = null;
      const c = player.center();
      player.faceTarget = Math.atan2(t.center.x - c.x, t.center.z - c.z);
      if (this.mine.tick <= 0) {
        this.mine.tick = 0.13;
        const rgb: RGB = t.kind === 'block' ? blockDef(t.id).sideL : (PROP_DEBRIS[t.mesh.userData.prop.type] ?? PROP_DEBRIS.boulder)[0];
        const n = this.v.copy(c).sub(t.center).normalize().multiplyScalar(0.55);
        const hp = t.center.clone().add(n);
        particles.burst(hp.x, hp.y, hp.z, rgb, 2, 1.4);
        // lascas que ficam no chão
        if (Math.random() < 0.5) debris.spawn(hp, n.clone().multiplyScalar(1.3).setY(0.5 + Math.random() * 0.9), 0.07 + Math.random() * 0.06, rgb, 1);
        particles.spawn(hp.x, hp.y, hp.z, n.x * 3 + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, n.z * 3 + (Math.random() - 0.5) * 2, 0.05, [2.4, 1.6, 0.6], 0.25, 6);
        events.emit('mine:hit', { x: hp.x, y: hp.y, z: hp.z, target: t.kind });
      }
      if (this.mine.progress >= 1) {
        this.breakTarget(t);
        this.mine.key = null;
        this.mine.progress = 0;
      }
    } else {
      if (holding && t && !reach && p.type !== 'mouse') this.walkGoal = { pos: t.center.clone(), reach: true };
      if (!p.down) {
        this.mine.key = null;
        this.mine.progress = 0;
      }
      player.faceTarget = undefined;
    }
    player.mining = mining;

    this.aim = input.aiming && !this.buildMode
      ? { fingerX: p.x, fingerY: p.y, x: p.aimX, y: p.aimY, state: !t ? 'none' : t.hard === Infinity || weak ? 'hard' : reach ? 'ok' : 'far' }
      : null;

    if (mining && t && this.aim) {
      // com mira deslocada, o anel de progresso fica na mira (o bloco está logo abaixo dela)
      this.progress = { x: this.aim.x, y: this.aim.y, f: Math.min(1, this.mine.progress) };
    } else if (mining && t) {
      const sp = t.center.clone().project(camera);
      const r = canvas.getBoundingClientRect();
      this.progress = {
        x: r.left + (sp.x * 0.5 + 0.5) * r.width,
        y: r.top + (-sp.y * 0.5 + 0.5) * r.height,
        f: Math.min(1, this.mine.progress),
      };
    } else this.progress = null;
  }

  /** Converte o objetivo de caminhada em entrada de movimento. */
  steer(input: MoveInput & { hasMoveInput: boolean }, dt: number): void {
    const g = this.walkGoal;
    if (!g || this.locked) return;
    if (input.hasMoveInput) {
      this.walkGoal = null;
      return;
    }
    const { player, rig } = this.d;
    const pc = player.center();
    const dx = g.pos.x - pc.x, dz = g.pos.z - pc.z;
    const flat = Math.hypot(dx, dz);
    const done = g.reach ? pc.distanceTo(g.pos) < REACH - 0.6 : flat < 0.5;
    if (done) {
      this.walkGoal = null;
      return;
    }
    const f = rig.forward(), r = rig.right();
    input.moveX = (dx * r.x + dz * r.z) / flat;
    input.moveY = (dx * f.x + dz * f.z) / flat;
    // pula se ficar preso
    const v = player.vel;
    if (Math.hypot(v.x, v.z) < 0.6 && player.onGround) {
      this.stuck += dt;
      if (this.stuck > 0.25) {
        this.stuck = 0;
        g.jumps = (g.jumps ?? 0) + 1;
        if (g.jumps > 2) this.walkGoal = null;
        else input.jump = true;
      }
    } else this.stuck = 0;
  }

  /** Cancela qualquer ação em andamento (ao pausar). */
  cancel(): void {
    this.walkGoal = null;
    this.mine.key = null;
    this.mine.progress = 0;
    this.progress = null;
    this.aim = null;
    this.d.player.mining = false;
    this.d.player.faceTarget = undefined;
  }
}
