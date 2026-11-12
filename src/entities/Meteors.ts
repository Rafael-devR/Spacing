// Meteoros: aviso no chão, queda, impacto com cratera, destroços e meteorito (docs/design/METEOROS.md).
// Aqui fica a lógica (quando cai, onde, o que o impacto faz no mundo); o visual (rocha, rastro, clarão, fumaça) é do
// MeteorFx (render/meteorFx.ts) e a câmera, o tempo e o som reagem aos eventos 'meteor:incoming' e 'meteor:impact'
// (app/MeteorDirector.ts e app/Game.ts). Os números ficam em data/meteors.ts.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { RGB } from '../core/color';
import { AIR, BEDROCK, type BlockId } from '../data/blocks';
import { IMPACT_FX, METEOR } from '../data/meteors';
import { PROP_DEBRIS } from '../data/props';
import type { MeteorFx, MeteorVisual } from '../render/meteorFx';
import type { Particles } from '../render/particles';
import { blockDef } from '../world/registry';
import { CS, LANDER } from '../world/terrain';
import type { BlockEdit, World } from '../world/World';
import type { Debris } from './Debris';
import type { Player } from './Player';

const FLIGHT = METEOR.flight;
const WARN = METEOR.warn;

interface ActiveMeteor {
  id: number;
  target: THREE.Vector3;
  start: THREE.Vector3;
  /** a cabeça em voo (some até o aviso acabar); a posição dela é a do meteoro */
  head: THREE.Object3D;
  visual: MeteorVisual;
  /** sentido da queda (do céu para o alvo, unitário) */
  fwd: THREE.Vector3;
  /** tempo desde o lançamento; negativo durante o aviso */
  t: number;
  radius: number;
  meteorite: boolean;
  announced: boolean;
}

export interface LaunchOptions {
  radius?: number;
  meteorite?: boolean;
  /** segundos extras antes do aviso começar */
  delay?: number;
}

export interface MeteorsDeps {
  scene: THREE.Scene;
  world: World;
  debris: Debris;
  particles: Particles;
  player: Player;
  events: GameBus;
  fx: MeteorFx;
  /** giro da câmera (rad): o meteoro entra de lado, para cruzar a tela; sem isto, vem de qualquer lado */
  viewYaw?: () => number;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** o que um grupo de pedaços ejetados tem em comum (blocos grandes e cascalho): faixas de velocidade para fora e para cima, tamanho */
interface EjectGroup {
  out: readonly [number, number];
  up: readonly [number, number];
  size: readonly [number, number];
}

export class Meteors {
  readonly active: ActiveMeteor[] = [];
  private nextId = 1;
  /** segundos até o próximo meteoro aleatório */
  private timer = 100 + Math.random() * 60;
  private readonly pos = new THREE.Vector3();

  constructor(private readonly d: MeteorsDeps) {
    d.fx.attach(d.debris); // os destroços de explosão soltam fumaça no voo e quebram ao bater
  }

  /** Escolhe um ponto de queda perto do jogador, longe do módulo, em chunk carregado. */
  pickTarget(minD = 11, maxD = 18): THREE.Vector3 | null {
    const p = this.d.player.pos;
    const world = this.d.world;
    const yaw = this.d.viewYaw?.();
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * Math.PI * 2;
      const dd = minD + Math.random() * (maxD - minD);
      // nas primeiras tentativas, só pontos que cabem na tela; sem sorte, qualquer um (a câmera para a frente é (-sin yaw, -cos yaw))
      if (yaw !== undefined && tries < 25) {
        const depth = -Math.sin(yaw) * Math.cos(a) * dd - Math.cos(yaw) * Math.sin(a) * dd;
        const side = Math.cos(yaw) * Math.cos(a) * dd - Math.sin(yaw) * Math.sin(a) * dd;
        if (Math.abs(depth) > METEOR.viewDepth || Math.abs(side) > METEOR.viewSide) continue;
      }
      const x = Math.floor(p.x + Math.cos(a) * dd), z = Math.floor(p.z + Math.sin(a) * dd);
      if (Math.hypot(x - LANDER.x, z - LANDER.z) < 9) continue;
      // longe da base (com folga de 5 blocos)
      if (world.structures.some((st) => x >= st.box.x0 - 5 && x <= st.box.x1 + 5 && z >= st.box.z0 - 5 && z <= st.box.z1 + 5)) continue;
      const c = world.chunks.get(world.key(Math.floor(x / CS), Math.floor(z / CS)));
      if (!c || !c.mesh) continue;
      const y = world.topY(x, z) + 1;
      return new THREE.Vector3(x + 0.5, y, z + 0.5);
    }
    return null;
  }

  launch(target: THREE.Vector3 | null, { radius = 2.3, meteorite = true, delay = 0 }: LaunchOptions = {}): ActiveMeteor | null {
    if (!target) return null;
    // o sentido da queda, no plano do chão: para a direita ou para a esquerda da tela (a direita da câmera é (cos yaw, -sin yaw))
    const yaw = this.d.viewYaw?.();
    const a = yaw === undefined
      ? Math.random() * Math.PI * 2
      : -yaw + (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() * 2 - 1) * METEOR.sideJitter;
    const dir = new THREE.Vector3(Math.cos(a) * METEOR.tilt, -1, Math.sin(a) * METEOR.tilt).normalize();
    const start = target.clone().addScaledVector(dir, -METEOR.startDistance);
    const visual = this.d.fx.create(target, start, radius);
    const m: ActiveMeteor = {
      id: this.nextId++, target, start, head: visual.group, visual, fwd: dir, t: -delay - WARN, radius, meteorite, announced: false,
    };
    this.active.push(m);
    return m;
  }

  /** posição atual de um meteoro em voo (null se já caiu) */
  headOf(id: number): THREE.Vector3 | null {
    const m = this.active.find((a) => a.id === id);
    return m ? m.head.position : null;
  }

  /** sem novas quedas (astronauta dentro da base); as que já estão no ar terminam */
  holdSpawns = false;
  /** liga e desliga o sorteio de meteoros (o modo de teste desliga para soltar só os que pedir) */
  autoSpawn = true;

  update(dt: number, t: number): void {
    if (!this.holdSpawns && this.autoSpawn) this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = METEOR.everyMin + Math.random() * (METEOR.everyMax - METEOR.everyMin);
      this.launch(this.pickTarget(METEOR.pickMin, METEOR.pickMax), { radius: METEOR.radiusMin + Math.random() * (METEOR.radiusMax - METEOR.radiusMin), meteorite: Math.random() < 0.6 });
    }
    const { fx, particles } = this.d;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.t += dt;
      // aviso no chão: mira que gira e encolhe
      const warnK = Math.min(1, (m.t + WARN) / WARN);
      fx.warn(m.visual, m.radius, warnK, Math.max(0, m.t / FLIGHT), t);
      if (m.t < 0) continue;
      if (!m.announced) {
        m.announced = true;
        this.d.events.emit('meteor:incoming', { id: m.id, x: m.start.x, y: m.start.y, z: m.start.z });
      }
      const k = Math.min(1, m.t / FLIGHT);
      const e = k * k * (0.4 + 0.6 * k);
      this.pos.lerpVectors(m.start, m.target, e);
      fx.fly(m.visual, this.pos, dt, k);
      // brasas que se soltam dele (a fumaça e o fogo do rastro são do MeteorFx)
      const hp = this.pos;
      particles.spawn(hp.x, hp.y, hp.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.14, [2.5, 0.9 + Math.random() * 0.4, 0.25], 0.35, 0);
      if (k >= 1) {
        this.impact(m);
        fx.remove(m.visual);
        this.active.splice(i, 1);
      }
    }
    fx.update(dt);
  }

  private impact(m: ActiveMeteor): void {
    const T = m.target, R = m.radius;
    const { world, debris, player } = this.d;
    const c = new THREE.Vector3(T.x, T.y - 0.2, T.z);
    // cratera
    const list: BlockEdit[] = [];
    const pieces: [number, number, number, BlockId][] = [];
    const r = Math.ceil(R);
    for (let y = Math.floor(c.y - r); y <= Math.floor(c.y + r); y++)
      for (let z = Math.floor(c.z - r); z <= Math.floor(c.z + r); z++)
        for (let x = Math.floor(c.x - r); x <= Math.floor(c.x + r); x++) {
          const dd = Math.hypot(x + 0.5 - c.x, (y + 0.5 - c.y) * 1.4, z + 0.5 - c.z);
          if (dd > R) continue;
          const id = world.getBlock(x, y, z);
          if (id === AIR || id === BEDROCK) continue;
          list.push([x, y, z, AIR]);
          pieces.push([x, y, z, id]);
        }
    world.setBlocks(list);
    // objetos no raio de impacto viram destroços
    for (const pm of [...world.propMeshes]) {
      if (pm.position.distanceTo(T) < R + 1.2) {
        const pal = PROP_DEBRIS[pm.userData.prop.type] ?? PROP_DEBRIS.boulder;
        world.removeProp(pm);
        debris.burst(pm.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 8, pal, { power: 3, up: 2.6 });
      }
    }
    this.eject(c, pieces, m);
    // todo o visual do impacto: clarão, bola de fogo, onda de poeira, bolha de choque, coluna de fumaça, brasa
    this.d.fx.impact(T, R);
    const dist = player.pos.distanceTo(T);
    if (dist < 7) {
      const push = new THREE.Vector3().subVectors(player.pos, T).setY(0).normalize().multiplyScalar(6 * (1 - dist / 7));
      player.vel.x += push.x;
      player.vel.z += push.z;
      player.vel.y = Math.max(player.vel.y, 4 * (1 - dist / 7));
    }
    if (m.meteorite) {
      const wx = Math.floor(T.x), wz = Math.floor(T.z);
      const mesh = world.addExtraProp({ wx, wz, type: 'meteorite', rot: Math.random() * 6.28, scale: 0.95 + Math.random() * 0.2 });
      if (mesh) {
        mesh.position.y += 2.5;
        mesh.userData.fallTo = mesh.userData.prop.y;
      }
    }
    this.d.events.emit('meteor:impact', { id: m.id, x: T.x, y: T.y, z: T.z, distance: dist, meteorite: m.meteorite, radius: R });
  }

  /**
   * Pedaços da cratera voando: blocos grandes (saem em brasa, soltam fumaça e quebram em pedaços ao bater) e cascalho
   * rápido. Voam mais para onde o meteoro ia (impacto inclinado joga o material adiante).
   */
  private eject(c: THREE.Vector3, pieces: [number, number, number, BlockId][], m: ActiveMeteor): void {
    const { debris } = this.d;
    if (pieces.length === 0) return;
    const k = m.radius / 2.3;
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    pieces.sort(() => Math.random() - 0.5);
    const color = (id: BlockId): RGB => {
      const def = blockDef(id);
      return def.oreL && Math.random() < 0.5 ? def.oreL : Math.random() < 0.3 ? def.topL : def.sideL;
    };
    const fire = (i: number, group: EjectGroup, kind: 0 | 1, opts: { heat: number; trail?: number; splinters?: number }): void => {
      const [x, y, z, id] = pieces[i % pieces.length];
      p.set(x + 0.5 + rnd(-0.3, 0.3), y + 0.5, z + 0.5 + rnd(-0.3, 0.3));
      v.subVectors(p, c).setY(0);
      if (v.lengthSq() < 1e-4) v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      v.normalize().multiplyScalar(rnd(...group.out) * (0.8 + 0.2 * k));
      v.x += m.fwd.x * rnd(0, 2.5);
      v.z += m.fwd.z * rnd(0, 2.5);
      v.y = rnd(...group.up);
      debris.spawn(p, v, rnd(...group.size), color(id), kind, opts);
    };
    const b = IMPACT_FX.blocks, g = IMPACT_FX.gravel;
    for (let i = 0; i < b.count; i++) fire(i, b, 0, { heat: b.heat * rnd(0.8, 1.2), trail: b.trail, splinters: b.splinters });
    for (let i = 0; i < g.count; i++) fire(b.count + i, g, i % 3 === 0 ? 0 : 1, { heat: g.heat * rnd(0.7, 1.2) });
  }
}
