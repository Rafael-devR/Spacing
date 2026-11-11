// Jogador: física em gravidade lunar, colisão com voxels, subida automática de degraus.
import * as THREE from 'three';
import { createAstronaut } from './models.js';
import { LANDER } from './terrain.js';

const HW = 0.3; // meia largura
const HEIGHT = 1.5;
const GRAVITY = 15;
const JUMP = 7.4;
const SPEED = 4.6;

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.model = createAstronaut();
    scene.add(this.model.root);
    this.pos = new THREE.Vector3(0.5, 30, 0.5);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.facing = 0;
    this.walk = 0;
    this.stepOffset = 0;
    this.mining = false;
    this.stepTimer = 0;
    this.events = []; // 'step', 'land', 'jump'
    this.time = 0;
  }

  spawn(x, z) {
    this.pos.set(x, this.world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
    this.vel.set(0, 0, 0);
  }

  collides(px, py, pz) {
    const x0 = Math.floor(px - HW), x1 = Math.floor(px + HW);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT);
    const z0 = Math.floor(pz - HW), z1 = Math.floor(pz + HW);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this.world.isSolid(x, y, z)) return true;
    return false;
  }

  // move ao longo de um eixo com passos pequenos; retorna true se colidiu
  moveAxis(axis, amount) {
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

  tryStep(axis, amount) {
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

  update(dt, input, cam) {
    this.time += dt;
    const p = this.pos;
    // direção de movimento relativa à câmera
    let mx = input.moveX, mz = input.moveY;
    const f = cam.forward(), r = cam.right();
    let dx = r.x * mx + f.x * mz;
    let dz = r.z * mx + f.z * mz;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }

    const accel = this.onGround ? 14 : 5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (dx * SPEED - this.vel.x) * k;
    this.vel.z += (dz * SPEED - this.vel.z) * k;

    if (input.jump && this.onGround) {
      this.vel.y = JUMP;
      this.onGround = false;
      this.events.push('jump');
    }
    input.jump = false;
    this.vel.y -= GRAVITY * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    const ax = this.vel.x * dt, az = this.vel.z * dt;
    if (this.moveAxis('x', ax)) { if (!this.tryStep('x', ax)) this.vel.x = 0; }
    if (this.moveAxis('z', az)) { if (!this.tryStep('z', az)) this.vel.z = 0; }

    const vy = this.vel.y;
    const wasGround = this.onGround;
    this.onGround = false;
    if (this.moveAxis('y', vy * dt)) {
      if (vy < 0) {
        this.onGround = true;
        if (!wasGround && vy < -7) this.events.push('land');
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

    if (p.y < -10) this.spawn(0.5, 0.5);

    // animação
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.3) this.facing = lerpAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-12 * dt));
    if (this.faceTarget !== undefined) this.facing = lerpAngle(this.facing, this.faceTarget, 1 - Math.exp(-14 * dt));
    this.walk += speed * dt * 2.2;
    if (this.onGround && speed > 1) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.events.push('step'); this.stepTimer = 0.34; }
    }
    this.stepOffset *= Math.exp(-14 * dt);

    const m = this.model;
    m.root.position.set(p.x, p.y + this.stepOffset, p.z);
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
  }

  intersectsBlock(x, y, z) {
    const p = this.pos;
    return x + 1 > p.x - HW && x < p.x + HW && y + 1 > p.y && y < p.y + HEIGHT && z + 1 > p.z - HW && z < p.z + HW;
  }

  center() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z); }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
