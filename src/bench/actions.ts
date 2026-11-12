// O que o roteiro faz em cada cenário (ações de src/data/bench.ts): anda, quebra blocos, solta meteoros, gira a câmera...
// Roda em tempo real, a cada quadro, a partir do que o cenário pede. Não conhece o DOM nem as estatísticas.
import * as THREE from 'three';
import {
  BENCH_BREAK_RADIUS, BENCH_HEADING, BENCH_ORIGIN, BENCH_ORIGIN_STEP, BENCH_SEED, type BenchActions, type BenchScenario,
} from '../data/bench';
import { ITEM_ORDER } from '../data/items';
import type { BaseDirector } from '../app/BaseDirector';
import type { MapDirector } from '../app/MapDirector';
import type { ItemDrops } from '../entities/ItemDrops';
import type { Meteors } from '../entities/Meteors';
import type { Player } from '../entities/Player';
import type { IsoRig } from '../render/IsoRig';
import type { Particles } from '../render/particles';
import type { Interaction } from '../systems/Interaction';
import type { World } from '../world/World';

export interface DriverDeps {
  world: World;
  player: Player;
  rig: IsoRig;
  interaction: Interaction;
  meteors: Meteors;
  drops: ItemDrops;
  particles: Particles;
  base: BaseDirector;
  map: MapDirector;
}

/** sorteio com semente (mulberry32): o teste quebra sempre a mesma sequência de blocos */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ponto de partida do cenário de número `index` (região fixa e virgem, longe da base e dos outros cenários). */
export function originOf(index: number): { x: number; z: number } {
  return { x: BENCH_ORIGIN.x + index * BENCH_ORIGIN_STEP, z: BENCH_ORIGIN.z + index * BENCH_ORIGIN_STEP };
}

/** distância da câmera e ângulo-padrão do teste */
export const BENCH_CAMERA = { dist: 30, yaw: Math.PI / 4 } as const;
const MAP_OPEN_FRACTION = 0.5;
/** partículas de cada estouro do `emit` */
const EMIT_BURST = 6;

export class ScenarioDriver {
  private actions: BenchActions = {};
  private rng = seeded(BENCH_SEED);
  private t = 0;
  private breakAcc = 0;
  private meteorAcc = 0;
  private itemAcc = 0;
  private emitAcc = 0;
  private cycleWait = 0;
  private launched = 0;
  private angle = 0;
  private mapOpen = false;
  private baseMode = false;
  private readonly center = new THREE.Vector2();
  private readonly pos = new THREE.Vector2();
  private readonly dir = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  constructor(private readonly d: DriverDeps) {}

  /** Começa um cenário: leva o astronauta ao ponto de partida e arruma a câmera (sempre iguais). */
  begin(sc: BenchScenario, at: { x: number; z: number }, seed: number): void {
    const { d } = this;
    this.end();
    this.actions = sc.actions;
    this.rng = seeded(BENCH_SEED + seed);
    this.t = this.breakAcc = this.meteorAcc = this.itemAcc = this.emitAcc = this.launched = this.angle = 0;
    this.cycleWait = 0.4;
    this.mapOpen = false;
    this.baseMode = sc.origin === 'base';
    this.dir.set(BENCH_HEADING.x, BENCH_HEADING.z).normalize();
    d.rig.yaw = d.rig.yawTarget = BENCH_CAMERA.yaw;
    d.rig.dist = d.rig.distTarget = BENCH_CAMERA.dist;
    if (this.baseMode) {
      d.base.leaveInstant();
      d.base.benchRun = true;
      const o = d.base.outsidePoint;
      d.player.spawn(o.x, o.z);
      this.pos.set(o.x, o.z);
    } else {
      d.player.spawn(at.x, at.z);
      this.pos.set(at.x, at.z);
    }
    this.center.copy(this.pos);
    d.player.facing = Math.atan2(this.dir.x, this.dir.y);
    d.rig.snap(this.v.set(d.player.pos.x, d.player.pos.y + 0.8, d.player.pos.z));
  }

  /** Desfaz o que o cenário ligou (mapa aberto, cena da base, mineração). */
  end(): void {
    const { d } = this;
    d.player.mining = false;
    if (this.mapOpen) {
      d.map.close(true);
      this.mapOpen = false;
    }
    if (this.baseMode) {
      d.base.benchRun = false;
      d.base.leaveInstant();
      this.baseMode = false;
    }
    this.actions = {};
  }

  /** Um quadro do cenário. `sec` = tempo do quadro (limitado: um quadro de segundos não vira um salto enorme). */
  tick(rawSec: number): void {
    const sec = Math.min(rawSec, 0.25);
    const a = this.actions;
    this.t += sec;
    if (a.walk) this.walk(a.walk, sec);
    if (a.circle) this.circle(a.circle.radius, a.circle.speed, sec);
    this.d.player.mining = (a.breakRate ?? 0) > 0;
    if (a.breakRate) this.breakBlocks(a.breakRate, sec);
    if (a.meteorEvery) this.meteors(a.meteorEvery, a.meteorCount ?? 1, sec);
    if (a.spin) this.d.rig.yaw = this.d.rig.yawTarget = BENCH_CAMERA.yaw + (2 * Math.PI * this.t) / a.spin;
    if (a.zoom) this.zoom(a.zoom);
    if (a.items) this.items(a.items.every, a.items.count, sec);
    if (a.mapEvery) this.mapToggle(a.mapEvery);
    if (a.baseCycle) this.baseCycle(sec);
    if (a.emit) this.emit(a.emit, sec);
  }

  /** o astronauta anda por posição imposta (o chão acompanha o relevo); a velocidade vai para passos, poeira e pegadas */
  private place(vx: number, vz: number): void {
    const { player, world } = this.d;
    const x = this.pos.x, z = this.pos.y;
    player.pos.set(x, world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
    player.vel.set(vx, 0, vz);
    if (vx !== 0 || vz !== 0) player.facing = Math.atan2(vx, vz);
  }

  private walk(speed: number, sec: number): void {
    this.pos.addScaledVector(this.dir, speed * sec);
    this.place(this.dir.x * speed, this.dir.y * speed);
  }

  private circle(radius: number, speed: number, sec: number): void {
    this.angle += (speed / radius) * sec;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    this.pos.set(this.center.x + radius * c, this.center.y + radius * s);
    // velocidade tangente
    this.place(-s * speed, c * speed);
  }

  private breakBlocks(rate: number, sec: number): void {
    const { world, player, interaction } = this.d;
    this.breakAcc += rate * sec;
    let n = Math.min(40, Math.floor(this.breakAcc));
    this.breakAcc -= Math.floor(this.breakAcc);
    const cx = player.pos.x, cz = player.pos.z, R = BENCH_BREAK_RADIUS;
    for (let tries = 0; n > 0 && tries < n * 6; tries++) {
      const x = Math.floor(cx + (this.rng() * 2 - 1) * R), z = Math.floor(cz + (this.rng() * 2 - 1) * R);
      const y = world.topY(x, z);
      if (y <= 2) continue;
      if (interaction.breakBlockAt(x, y, z)) n--;
    }
  }

  private meteors(every: number, count: number, sec: number): void {
    this.meteorAcc += sec;
    if (this.meteorAcc < every) return;
    this.meteorAcc -= every;
    const { meteors } = this.d;
    for (let i = 0; i < count; i++) {
      meteors.launch(meteors.pickTarget(7, 15), { radius: 1.6 + (this.launched % 3) * 0.4, meteorite: this.launched % 2 === 0 });
      this.launched++;
    }
  }

  private zoom(z: { period: number; min: number; max: number }): void {
    const mid = (z.min + z.max) / 2, amp = (z.max - z.min) / 2;
    // começa no meio e sobe: a câmera passa pelo zoom mínimo e pelo máximo
    this.d.rig.dist = this.d.rig.distTarget = mid + amp * Math.sin((2 * Math.PI * this.t) / z.period);
  }

  private items(every: number, count: number, sec: number): void {
    this.itemAcc += sec;
    if (this.itemAcc < every) return;
    this.itemAcc -= every;
    const { player, drops } = this.d;
    const per = Math.max(1, Math.ceil(count / ITEM_ORDER.length));
    this.v.set(player.pos.x + 2.5, player.pos.y + 1.2, player.pos.z);
    for (const item of ITEM_ORDER) drops.spawn(item, this.v, per);
  }

  private mapToggle(period: number): void {
    const phase = (this.t % period) / period;
    const want = phase < MAP_OPEN_FRACTION;
    if (want && !this.mapOpen) {
      this.d.map.open();
      this.mapOpen = this.d.map.active;
    } else if (!want && this.mapOpen) {
      this.d.map.close();
      this.mapOpen = false;
    }
  }

  private baseCycle(sec: number): void {
    const { base } = this.d;
    if (base.busy) return;
    this.cycleWait -= sec;
    if (this.cycleWait <= 0) {
      this.cycleWait = 0.6;
      base.benchCycle();
    }
  }

  private emit(perSecond: number, sec: number): void {
    const { particles, player } = this.d;
    this.emitAcc += perSecond * sec;
    while (this.emitAcc >= EMIT_BURST) {
      this.emitAcc -= EMIT_BURST;
      const a = this.rng() * Math.PI * 2;
      particles.burst(player.pos.x + Math.cos(a) * 3, player.pos.y + 0.6, player.pos.z + Math.sin(a) * 3, [1.8, 1.2, 0.6], EMIT_BURST, 3);
    }
  }
}
