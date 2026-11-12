// Jogador: física em gravidade lunar, colisão com voxels, subida automática de degraus.
// step() roda em passo fixo; animate() roda a cada quadro e interpola a posição.
import * as THREE from 'three';
import { PLANET } from '../core/planet';
import type { GameBus } from '../app/events';
import { createAstronaut, type AstronautModel } from '../render/models';
import type { IsoRig } from '../render/IsoRig';
import { LANDER, SPAWN } from '../world/terrain';
import type { World } from '../world/World';

const HW = 0.3; // meia largura
const HEIGHT = 1.5;
/** gravidade e pulo do planeta (data/planets.ts): em Marte o pulo é mais baixo e a queda mais rápida */
const GRAVITY = PLANET.physics.gravity;
const JUMP = PLANET.physics.jump;
const SPEED = 4.6;

export interface MoveInput {
  /** -1..1, relativo à câmera */
  moveX: number;
  moveY: number;
  /** pedido de pulo; é consumido no próximo passo */
  jump: boolean;
}

type Axis = 'x' | 'y' | 'z';

export class Player {
  readonly model: AstronautModel;
  readonly pos = new THREE.Vector3(0.5, 30, 0.5);
  /** posição no passo anterior (para interpolar a renderização) */
  readonly prevPos = new THREE.Vector3(0.5, 30, 0.5);
  readonly vel = new THREE.Vector3();
  /** empurrão de fora (vento de Marte), em blocos/s; somado ao andar */
  readonly push = new THREE.Vector3();
  onGround = false;
  facing = 0;
  /** ângulo para onde olhar enquanto minera; undefined = segue o movimento */
  faceTarget: number | undefined = undefined;
  mining = false;
  /** morto: ignora a entrada e cai de costas */
  dead = false;
  /** piscando (invulnerável depois de renascer) */
  blinking = false;
  /** parado por uma cena (câmara de pressurização, descanso): ignora a entrada e a física */
  frozen = false;
  /** caminhada roteirizada (entrar e sair da base): sem física, em linha reta */
  private script: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done?: () => void } | null = null;
  private flash = 0;
  private squash = 0;
  private deadPose = 0;
  private walk = 0;
  private stepOffset = 0;
  private stepTimer = 0;
  private time = 0;
  private readonly renderPos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly events?: GameBus,
  ) {
    this.model = createAstronaut();
    scene.add(this.model.root);
  }

  spawn(x: number, z: number): void {
    this.pos.set(x, this.world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
  }

  collides(px: number, py: number, pz: number): boolean {
    const x0 = Math.floor(px - HW), x1 = Math.floor(px + HW);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT);
    const z0 = Math.floor(pz - HW), z1 = Math.floor(pz + HW);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) if (this.world.isSolid(x, y, z)) return true;
    return false;
  }

  /** move ao longo de um eixo com passos pequenos; retorna true se colidiu */
  private moveAxis(axis: Axis, amount: number): boolean {
    const p = this.pos;
    let hit = false;
    const steps = Math.ceil(Math.abs(amount) / 0.3) || 1;
    const d = amount / steps;
    for (let s = 0; s < steps; s++) {
      p[axis] += d;
      if (!this.collides(p.x, p.y, p.z)) continue;
      hit = true;
      if (axis === 'y') {
        p.y = d < 0 ? Math.floor(p.y) + 1 : Math.floor(p.y + HEIGHT) - HEIGHT - 0.001;
      } else if (d > 0) {
        p[axis] = Math.floor(p[axis] + HW) - HW - 0.001;
      } else {
        p[axis] = Math.floor(p[axis] - HW) + 1 + HW + 0.001;
      }
      break;
    }
    return hit;
  }

  private tryStep(axis: 'x' | 'z', amount: number): boolean {
    if (!this.onGround) return false;
    const p = this.pos;
    const nx = axis === 'x' ? p.x + amount : p.x;
    const nz = axis === 'z' ? p.z + amount : p.z;
    const ny = Math.floor(p.y + 0.01) + 1;
    if (ny - p.y > 1.05) return false;
    if (this.collides(nx, ny + 0.001, nz)) return false;
    this.stepOffset -= ny - p.y;
    p.y = ny + 0.001;
    p.x = nx;
    p.z = nz;
    return true;
  }

  /** Anda sozinho até `to` em `seconds` (sem física). `done` roda ao chegar. */
  walkTo(to: THREE.Vector3, seconds: number, done?: () => void): void {
    this.script = { from: this.pos.clone(), to: to.clone(), t: 0, dur: Math.max(0.05, seconds), done };
  }

  get scripted(): boolean {
    return this.script !== null || this.frozen;
  }

  /** Física de um passo fixo. */
  step(dt: number, input: MoveInput, cam: IsoRig): void {
    const p = this.pos;
    this.prevPos.copy(p);
    if (this.script || this.frozen) {
      input.jump = false;
      this.onGround = true;
      const s = this.script;
      if (!s) {
        this.vel.set(0, 0, 0);
        return;
      }
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      p.lerpVectors(s.from, s.to, k);
      this.vel.set((s.to.x - s.from.x) / s.dur, 0, (s.to.z - s.from.z) / s.dur);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.events?.emit('player:step', { x: p.x, y: p.y, z: p.z });
        this.stepTimer = 0.34;
      }
      if (k >= 1) {
        this.script = null;
        this.vel.set(0, 0, 0);
        s.done?.();
      }
      return;
    }
    // direção de movimento relativa à câmera
    const f = cam.forward(), r = cam.right();
    const mx = this.dead ? 0 : input.moveX, my = this.dead ? 0 : input.moveY;
    let dx = r.x * mx + f.x * my;
    let dz = r.z * mx + f.z * my;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }

    const accel = this.onGround ? 14 : 5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (dx * SPEED - this.vel.x) * k;
    this.vel.z += (dz * SPEED - this.vel.z) * k;

    if (input.jump && this.onGround && !this.dead) {
      this.vel.y = JUMP;
      this.onGround = false;
      this.events?.emit('player:jump', { x: p.x, y: p.y, z: p.z });
    }
    input.jump = false;
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    const ax = (this.vel.x + this.push.x) * dt, az = (this.vel.z + this.push.z) * dt;
    if (this.moveAxis('x', ax) && !this.tryStep('x', ax)) this.vel.x = 0;
    if (this.moveAxis('z', az) && !this.tryStep('z', az)) this.vel.z = 0;

    const vy = this.vel.y;
    const wasGround = this.onGround;
    this.onGround = false;
    if (this.moveAxis('y', vy * dt)) {
      if (vy < 0) {
        this.onGround = true;
        if (!wasGround && vy < -7) {
          this.squash = Math.min(1, -vy / 14);
          this.events?.emit('player:land', { x: p.x, y: p.y, z: p.z, speed: -vy });
        }
      }
      this.vel.y = 0;
    }

    // módulo de pouso: empurra para fora
    const ldx = p.x - (LANDER.x + 0.5), ldz = p.z - (LANDER.z + 0.5);
    const ld = Math.hypot(ldx, ldz);
    if (ld < LANDER.r && p.y < this.world.terrain.spawnH + 4) {
      p.x += (ldx / (ld || 1)) * (LANDER.r - ld);
      p.z += (ldz / (ld || 1)) * (LANDER.r - ld);
    }

    if (p.y < -10) this.spawn(SPAWN.x, SPAWN.z);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed > 1) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.events?.emit('player:step', { x: p.x, y: p.y, z: p.z });
        this.stepTimer = 0.34;
      }
    }
  }

  /** Animação por quadro. alpha = fração entre o passo anterior e o atual. */
  animate(dt: number, alpha = 1): void {
    this.time += dt;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.3) this.facing = lerpAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-12 * dt));
    if (this.faceTarget !== undefined) this.facing = lerpAngle(this.facing, this.faceTarget, 1 - Math.exp(-14 * dt));
    this.walk += speed * dt * 2.2;
    this.stepOffset *= Math.exp(-14 * dt);

    const m = this.model;
    const rp = this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    m.root.position.set(rp.x, rp.y + this.stepOffset, rp.z);
    m.root.rotation.y = this.facing;
    const swing = this.onGround ? Math.sin(this.walk) * Math.min(1, speed / SPEED) : 0;
    m.legL.rotation.x = this.onGround ? swing * 0.7 : -0.45;
    m.legR.rotation.x = this.onGround ? -swing * 0.7 : 0.25;
    m.armL.rotation.x = this.onGround ? -swing * 0.6 : -0.9;
    m.body.position.y = this.onGround ? Math.abs(Math.sin(this.walk)) * 0.06 * Math.min(1, speed / 2) : 0;
    if (this.mining) {
      m.armR.rotation.x = -1.35 + Math.sin(this.time * 30) * 0.12;
      m.bit.rotation.y += dt * 40;
    } else {
      m.armR.rotation.x = this.onGround ? swing * 0.6 : -0.9;
    }
    m.body.rotation.z = this.onGround ? Math.sin(this.walk) * 0.04 * Math.min(1, speed / 2) : 0;
    m.beacon.visible = Math.sin(this.time * 4) > 0;

    // achata ao pousar e volta com mola
    this.squash = Math.max(0, this.squash - dt * 5);
    const sq = Math.sin(this.squash * Math.PI) * 0.22 * this.squash;
    m.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
    // pisca vermelho ao levar dano
    this.flash = Math.max(0, this.flash - dt * 4);
    m.suitMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, this.flash * 0.05);
    // invulnerável: pisca; morto: cai de costas
    m.root.visible = !this.blinking || Math.sin(this.time * 40) > -0.3;
    this.deadPose += ((this.dead ? 1 : 0) - this.deadPose) * (1 - Math.exp(-6 * dt));
    if (this.deadPose > 0.001) {
      m.body.rotation.x = -1.35 * this.deadPose;
      m.body.position.y += 0.25 * this.deadPose;
      m.legL.rotation.x *= 1 - this.deadPose;
      m.legR.rotation.x *= 1 - this.deadPose;
    } else m.body.rotation.x = 0;
  }

  /** Retorno visual de dano. */
  hurt(): void {
    this.flash = 1;
  }

  intersectsBlock(x: number, y: number, z: number): boolean {
    const p = this.pos;
    return x + 1 > p.x - HW && x < p.x + HW && y + 1 > p.y && y < p.y + HEIGHT && z + 1 > p.z - HW && z < p.z + HW;
  }

  center(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
