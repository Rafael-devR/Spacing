// Destroços com física de microgravidade (data/physics.ts, docs/design/FISICA.md): flutuam, descem devagar,
// quicam, rolam, se empilham, ficam no chão e são chutados quando o astronauta passa por cima.
// Sem ar: nada os freia no alto; só o chão os para.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { RGB } from '../core/color';
import { AIR_DRAG, MICROGRAVITY } from '../data/physics';
import type { World } from '../world/World';
import type { Player } from './Player';

type Kind = 0 | 1;

interface DebrisItem {
  kind: Kind;
  i: number;
  size: number;
  r: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  prev: THREE.Vector3;
  rx: number;
  ry: number;
  rz: number;
  ax: number;
  ay: number;
  az: number;
  life: number;
  sleep: boolean;
  still: number;
  check: number;
  ground: boolean;
}

export interface BurstOptions {
  power?: number;
  spread?: number;
  minSize?: number;
  maxSize?: number;
  up?: number;
}

const PER_MESH = 150;
const GRAVITY = MICROGRAVITY;
const LIFE = 50;
const HALF_PI = Math.PI / 2;

function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.55, 0);
  const p = g.attributes.position;
  const seen = new Map<string, number>();
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.75 + rnd() * 0.5);
    const j = seen.get(k) ?? 1;
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.8, p.getZ(i) * j);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export class Debris {
  private readonly items: DebrisItem[] = [];
  private readonly free: number[][] = [[], []];
  private readonly meshes: THREE.InstancedMesh[];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly sv = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly grid = new Map<number, DebrisItem[]>();
  /** sons pendentes do passo atual */
  private readonly pending: { type: 'clink' | 'kick'; speed: number; x: number; y: number; z: number }[] = [];
  private soundCooldown = 0;

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    material: THREE.Material,
    private readonly events?: GameBus,
  ) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(1, 1, 1);
    this.meshes = [new THREE.BoxGeometry(1, 1, 1), shardGeometry()].map((g, k) => {
      const m = new THREE.InstancedMesh(g, material, PER_MESH);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      for (let i = 0; i < PER_MESH; i++) {
        m.setMatrixAt(i, zero);
        m.setColorAt(i, white);
        this.free[k].push(i);
      }
      scene.add(m);
      return m;
    });
  }

  get count(): number {
    return this.items.length;
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, rgb: RGB, kind: Kind = 0): void {
    let i = this.free[kind].pop();
    if (i === undefined) {
      // recicla o mais antigo do mesmo tipo
      const k = this.items.findIndex((it) => it.kind === kind);
      if (k < 0) return;
      i = this.items[k].i;
      this.items.splice(k, 1);
    }
    const r = size * (kind === 0 ? 0.5 : 0.42);
    this.items.push({
      kind, i, size, r,
      pos: pos.clone(), vel: vel.clone(), prev: pos.clone(),
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      ax: (Math.random() - 0.5) * 14, ay: (Math.random() - 0.5) * 14, az: (Math.random() - 0.5) * 14,
      life: LIFE * (0.8 + Math.random() * 0.4), sleep: false, still: 0, check: 0, ground: false,
    });
    this.c.setRGB(rgb[0], rgb[1], rgb[2]);
    this.meshes[kind].setColorAt(i, this.c);
    const ic = this.meshes[kind].instanceColor;
    if (ic) ic.needsUpdate = true;
  }

  // Explode um volume em pedaços
  /** Explode um volume em pedaços. */
  burst(
    center: THREE.Vector3,
    count: number,
    palette: RGB[],
    { power = 1.8, spread = 0.32, minSize = 0.12, maxSize = 0.3, up = 1.1 }: BurstOptions = {},
  ): void {
    const p = new THREE.Vector3(), v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const col = palette[k % palette.length];
      const shade = 0.82 + Math.random() * 0.3;
      p.set(
        center.x + (Math.random() - 0.5) * spread * 2,
        center.y + (Math.random() - 0.5) * spread * 2,
        center.z + (Math.random() - 0.5) * spread * 2,
      );
      v.subVectors(p, center).multiplyScalar(power * 2.2);
      v.x += (Math.random() - 0.5) * power;
      v.z += (Math.random() - 0.5) * power;
      v.y += up * (0.6 + Math.random() * 0.8);
      const size = minSize + Math.random() * (maxSize - minSize);
      const kind = k % palette.length > 0 || Math.random() < 0.45 ? 1 : 0;
      this.spawn(p, v, size, [col[0] * shade, col[1] * shade, col[2] * shade], kind);
    }
  }

  private solid(x: number, y: number, z: number, r: number): boolean {
    const w = this.world;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (let yy = y0; yy <= y1; yy++)
      for (let zz = z0; zz <= z1; zz++)
        for (let xx = x0; xx <= x1; xx++)
          if (w.peekBlock(xx, yy, zz) !== 0 || yy < 0) return true;
    return false;
  }

  private moveAxis(it: DebrisItem, axis: 'x' | 'y' | 'z', amount: number): boolean {
    const p = it.pos, r = it.r;
    const steps = Math.ceil(Math.abs(amount) / 0.2) || 1;
    const d = amount / steps;
    for (let s = 0; s < steps; s++) {
      p[axis] += d;
      if (!this.solid(p.x, p.y, p.z, r)) continue;
      p[axis] = d > 0 ? Math.floor(p[axis] + r) - r - 0.001 : Math.floor(p[axis] - r) + 1 + r + 0.001;
      return true;
    }
    return false;
  }

  private wake(it: DebrisItem): void {
    it.sleep = false;
    it.still = 0;
  }

  private cellKey(x: number, y: number, z: number): number {
    return (Math.floor(x * 2) * 73856093) ^ (Math.floor(y * 2) * 19349663) ^ (Math.floor(z * 2) * 83492791);
  }

  private buildGrid(): void {
    const g = this.grid;
    g.clear();
    for (const it of this.items) {
      const k = this.cellKey(it.pos.x, it.pos.y, it.pos.z);
      let a = g.get(k);
      if (!a) g.set(k, (a = []));
      a.push(it);
    }
  }

  private neighbors(it: DebrisItem, fn: (o: DebrisItem) => void): void {
    const p = it.pos;
    for (let dx = -0.5; dx <= 0.5; dx += 0.5)
      for (let dy = -0.5; dy <= 0.5; dy += 0.5)
        for (let dz = -0.5; dz <= 0.5; dz += 0.5) {
          const a = this.grid.get(this.cellKey(p.x + dx, p.y + dy, p.z + dz));
          if (a) for (const o of a) if (o !== it) fn(o);
        }
  }

  // apoio: chão de bloco ou outro destroço logo abaixo
  private supported(it: DebrisItem): boolean {
    if (this.solid(it.pos.x, it.pos.y - 0.06, it.pos.z, it.r)) return true;
    let ok = false;
    this.neighbors(it, (o) => {
      if (ok) return;
      const dy = it.pos.y - o.pos.y;
      if (dy > 0.02 && Math.hypot(it.pos.x - o.pos.x, it.pos.z - o.pos.z) < (it.r + o.r) * 0.9 && dy < it.r + o.r + 0.06) ok = true;
    });
    return ok;
  }

  update(dt: number, player: Player): void {
    this.soundCooldown -= dt;
    this.buildGrid();
    const pp = player.pos, pv = player.vel;
    const pSpeed = Math.hypot(pv.x, pv.z);
    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n];
      it.life -= dt;
      if (it.life < -0.5) {
        this.meshes[it.kind].setMatrixAt(it.i, this.m4.makeScale(0, 0, 0));
        this.free[it.kind].push(it.i);
        this.items.splice(n, 1);
        continue;
      }

      // chute do jogador
      const dx = it.pos.x - pp.x, dz = it.pos.z - pp.z;
      const dh = Math.hypot(dx, dz);
      if (dh > 80 && it.life > 0) it.life = 0;
      if (dh < 0.34 + it.r && it.pos.y > pp.y - 0.35 && it.pos.y < pp.y + 1.5) {
        const nx = dh > 1e-3 ? dx / dh : Math.random() - 0.5, nz = dh > 1e-3 ? dz / dh : Math.random() - 0.5;
        const push = 1.4 + pSpeed * 1.15;
        it.vel.set(nx * push + pv.x * 0.45, 1.1 + pSpeed * 0.35 + Math.random() * 0.9, nz * push + pv.z * 0.45);
        if (pv.y < -3 && it.pos.y < pp.y + 0.2) it.vel.y += -pv.y * 0.25; // pisou em cima
        it.ax = (Math.random() - 0.5) * 16; it.az = (Math.random() - 0.5) * 16;
        const ox = it.pos.x, oz = it.pos.z;
        it.pos.x = pp.x + nx * (0.35 + it.r);
        it.pos.z = pp.z + nz * (0.35 + it.r);
        if (this.solid(it.pos.x, it.pos.y, it.pos.z, it.r)) { it.pos.x = ox; it.pos.z = oz; }
        if (it.sleep || it.still > 0) this.pending.push({ type: 'kick', speed: push, x: it.pos.x, y: it.pos.y, z: it.pos.z });
        this.wake(it);
      }

      if (it.sleep) {
        it.check -= dt;
        if (it.check <= 0) {
          it.check = 0.25 + Math.random() * 0.1;
          if (!this.supported(it)) this.wake(it);
        }
        if (it.life < 0) this.writeMatrix(it);
        continue;
      }

      if (this.solid(it.pos.x, it.pos.y, it.pos.z, it.r)) it.pos.y = Math.floor(it.pos.y - it.r) + 1 + it.r + 0.002;

      it.prev.copy(it.pos);
      it.vel.y -= GRAVITY * dt;
      // com ar (Marte), o arrasto freia os pedaços no voo
      if (AIR_DRAG > 0) {
        const k = Math.exp(-AIR_DRAG * dt);
        it.vel.x *= k; it.vel.z *= k;
      }
      if (it.vel.y < -25) it.vel.y = -25;
      if (this.moveAxis(it, 'x', it.vel.x * dt)) { it.vel.x *= -0.5; it.az *= 0.5; }
      if (this.moveAxis(it, 'z', it.vel.z * dt)) { it.vel.z *= -0.5; it.ax *= 0.5; }
      it.ground = false;
      const vy = it.vel.y;
      if (this.moveAxis(it, 'y', vy * dt)) {
        if (vy < 0) {
          it.ground = true;
          // com pouca gravidade a queda é lenta: quica até em velocidades baixas, e o chão só faz barulho se bater
          if (vy < -0.7) {
            it.vel.y = -vy * 0.45;
            it.ax = it.ax * 0.6 + it.vel.z * 4;
            it.az = it.az * 0.6 - it.vel.x * 4;
            if (vy < -2.5) this.pending.push({ type: 'clink', speed: -vy, x: it.pos.x, y: it.pos.y, z: it.pos.z });
          } else it.vel.y = 0;
        } else it.vel.y = 0;
      }

      // colisão entre destroços
      this.neighbors(it, (o) => {
        const ddx = it.pos.x - o.pos.x, ddy = it.pos.y - o.pos.y, ddz = it.pos.z - o.pos.z;
        const sum = (it.r + o.r) * 0.92;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 >= sum * sum || d2 < 1e-8) return;
        const d = Math.sqrt(d2);
        const nx = ddx / d, ny = ddy / d, nz = ddz / d;
        const overlap = sum - d;
        const share = o.sleep ? 1 : 0.5;
        it.pos.x += nx * overlap * share; it.pos.y += ny * overlap * share; it.pos.z += nz * overlap * share;
        if (!o.sleep) { o.pos.x -= nx * overlap * 0.5; o.pos.y -= ny * overlap * 0.5; o.pos.z -= nz * overlap * 0.5; }
        const rv = (it.vel.x - o.vel.x) * nx + (it.vel.y - o.vel.y) * ny + (it.vel.z - o.vel.z) * nz;
        if (rv < 0) {
          const j = -rv * 0.6;
          it.vel.x += nx * j; it.vel.y += ny * j; it.vel.z += nz * j;
          if (o.sleep) { if (-rv > 3) { this.wake(o); o.vel.x -= nx * j; o.vel.z -= nz * j; o.vel.y += 0.8; } }
          else { o.vel.x -= nx * j; o.vel.y -= ny * j; o.vel.z -= nz * j; }
        }
        if (ny > 0.55) { it.ground = true; if (it.vel.y < 0) it.vel.y = 0; }
      });
      if (this.solid(it.pos.x, it.pos.y, it.pos.z, it.r)) it.pos.copy(it.prev);

      // atrito e rotação
      if (it.ground) {
        const f = Math.exp(-5.5 * dt);
        it.vel.x *= f; it.vel.z *= f;
        const af = Math.exp(-4 * dt);
        it.ax *= af; it.ay *= af; it.az *= af;
      }
      it.rx += it.ax * dt; it.ry += it.ay * dt; it.rz += it.az * dt;

      const speed = Math.hypot(it.vel.x, it.vel.y, it.vel.z);
      if (it.ground && speed < 0.35) {
        it.still += dt;
        // deita de forma estável
        const k = 1 - Math.exp(-10 * dt);
        it.rx += (Math.round(it.rx / HALF_PI) * HALF_PI - it.rx) * k;
        it.rz += (Math.round(it.rz / HALF_PI) * HALF_PI - it.rz) * k;
        if (it.still > 0.4) { it.sleep = true; it.vel.set(0, 0, 0); it.check = 0.3; }
      } else it.still = 0;

      this.writeMatrix(it);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;

    // limita sons
    if (this.pending.length && this.soundCooldown <= 0) {
      for (const ev of this.pending) this.events?.emit(ev.type === 'kick' ? 'debris:kick' : 'debris:clink', { speed: ev.speed, x: ev.x, y: ev.y, z: ev.z });
      this.soundCooldown = 0.07;
    }
    this.pending.length = 0;
  }

  private writeMatrix(it: DebrisItem): void {
    const fade = it.life < 0 ? Math.max(0, 1 + it.life * 2) : 1;
    const s = it.size * fade;
    this.q.setFromEuler(this.e.set(it.rx, it.ry, it.rz));
    this.m4.compose(it.pos, this.q, this.sv.set(s, s, s));
    this.meshes[it.kind].setMatrixAt(it.i, this.m4);
  }

  /** acorda tudo perto de um bloco alterado */
  disturb(x: number, y: number, z: number): void {
    for (const it of this.items) {
      if (Math.abs(it.pos.x - x - 0.5) < 1.6 && Math.abs(it.pos.y - y - 0.5) < 1.8 && Math.abs(it.pos.z - z - 0.5) < 1.6) this.wake(it);
    }
  }
}
