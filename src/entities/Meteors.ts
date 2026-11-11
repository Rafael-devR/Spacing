// Meteoros: aviso no chão, rastro de fogo, impacto com cratera, destroços e meteorito.
// Som e tremor de câmera reagem aos eventos 'meteor:incoming' e 'meteor:impact'.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { RGB } from '../core/color';
import { AIR, BEDROCK, type BlockId } from '../data/blocks';
import { PROP_DEBRIS } from '../data/props';
import type { Particles } from '../render/particles';
import { blockDef } from '../world/registry';
import { CS, LANDER } from '../world/terrain';
import type { BlockEdit, World } from '../world/World';
import type { Debris } from './Debris';
import type { Player } from './Player';

const FLIGHT = 1.7;
const WARN = 1.6;

interface ActiveMeteor {
  id: number;
  target: THREE.Vector3;
  start: THREE.Vector3;
  head: THREE.Mesh;
  trail: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
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
}

export class Meteors {
  readonly active: ActiveMeteor[] = [];
  private nextId = 1;
  /** segundos até o próximo meteoro aleatório */
  private timer = 100 + Math.random() * 60;
  private flash = 0;
  private readonly headGeo = new THREE.IcosahedronGeometry(0.55, 0);
  private readonly headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.4), fog: false });
  private readonly trailGeo = new THREE.CylinderGeometry(0.55, 0.02, 1, 8, 1, true);
  private readonly trailMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.4, 0.9, 0.3), transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  private readonly ringGeo = new THREE.RingGeometry(1.7, 2.1, 40);
  private readonly light = new THREE.PointLight('#ff9a4a', 0, 22, 1.6);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly d: MeteorsDeps) {
    this.trailGeo.translate(0, -0.5, 0);
    this.ringGeo.rotateX(-Math.PI / 2);
    d.scene.add(this.light);
  }

  /** Escolhe um ponto de queda perto do jogador, longe do módulo, em chunk carregado. */
  pickTarget(minD = 11, maxD = 18): THREE.Vector3 | null {
    const p = this.d.player.pos;
    const world = this.d.world;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const dd = minD + Math.random() * (maxD - minD);
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
    const a = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a) * 0.55, -1, Math.sin(a) * 0.55).normalize();
    const start = target.clone().addScaledVector(dir, -55);
    const head = new THREE.Mesh(this.headGeo, this.headMat);
    const trail = new THREE.Mesh(this.trailGeo, this.trailMat);
    trail.quaternion.setFromUnitVectors(this.up, dir.clone().negate());
    trail.scale.set(1, 9, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.0, 0.4, 0.2), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(target).add(new THREE.Vector3(0, 0.06, 0));
    head.visible = trail.visible = false;
    this.d.scene.add(head, trail, ring);
    const m: ActiveMeteor = { id: this.nextId++, target, start, head, trail, ring, ringMat, t: -delay - WARN, radius, meteorite, announced: false };
    this.active.push(m);
    return m;
  }

  /** posição atual de um meteoro em voo (null se já caiu) */
  headOf(id: number): THREE.Vector3 | null {
    const m = this.active.find((a) => a.id === id);
    return m ? m.head.position : null;
  }

  update(dt: number, t: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 90 + Math.random() * 80;
      this.launch(this.pickTarget(12, 22), { radius: 1.6 + Math.random() * 0.8, meteorite: Math.random() < 0.6 });
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    let lightI = this.flash * 90;
    const particles = this.d.particles;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.t += dt;
      // aviso pulsante no chão
      const warnK = Math.min(1, (m.t + WARN) / WARN);
      m.ringMat.opacity = warnK * (0.45 + 0.35 * Math.sin(t * 14));
      m.ring.scale.setScalar(1.25 - 0.25 * Math.max(0, m.t / FLIGHT));
      if (m.t < 0) continue;
      if (!m.announced) {
        m.announced = true;
        this.d.events.emit('meteor:incoming', { id: m.id, x: m.start.x, y: m.start.y, z: m.start.z });
      }
      const k = Math.min(1, m.t / FLIGHT);
      const e = k * k * (0.4 + 0.6 * k);
      m.head.visible = m.trail.visible = true;
      m.head.position.lerpVectors(m.start, m.target, e);
      m.head.rotation.x += dt * 9;
      m.head.rotation.y += dt * 7;
      m.trail.position.copy(m.head.position);
      m.trail.scale.y = 6 + k * 8;
      lightI = Math.max(lightI, 25 * k);
      this.light.position.copy(m.head.position);
      // brasas e fumaça
      const hp = m.head.position;
      particles.spawn(hp.x, hp.y, hp.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.14, [2.5, 0.9 + Math.random() * 0.4, 0.25], 0.35, 0);
      particles.spawn(hp.x, hp.y, hp.z, Math.random() - 0.5, Math.random(), Math.random() - 0.5, 0.3, [0.32, 0.28, 0.34], 1.2, -0.3, true);
      if (k >= 1) {
        this.impact(m);
        this.d.scene.remove(m.head, m.trail, m.ring);
        m.ringMat.dispose();
        this.active.splice(i, 1);
      }
    }
    this.light.intensity = lightI;
  }

  private impact(m: ActiveMeteor): void {
    const T = m.target, R = m.radius;
    const { world, debris, particles, player } = this.d;
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
        debris.burst(pm.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 8, pal, { power: 5, up: 7 });
      }
    }
    // destroços voando
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    pieces.sort(() => Math.random() - 0.5);
    for (const [x, y, z, id] of pieces.slice(0, 26)) {
      const def = blockDef(id);
      p.set(x + 0.5, y + 0.5, z + 0.5);
      v.subVectors(p, c).normalize().multiplyScalar(4 + Math.random() * 4);
      v.y = Math.abs(v.y) + 5 + Math.random() * 5;
      const col: RGB = def.oreL && Math.random() < 0.5 ? def.oreL : Math.random() < 0.3 ? def.topL : def.sideL;
      debris.spawn(p, v, 0.16 + Math.random() * 0.2, col, Math.random() < 0.5 ? 1 : 0);
    }
    // poeira e brasas
    for (let k = 0; k < 34; k++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4.5;
      particles.spawn(T.x, T.y + 0.3, T.z, Math.cos(a) * s, 0.6 + Math.random() * 2.5, Math.sin(a) * s,
        0.35 + Math.random() * 0.4, [0.55, 0.5, 0.52], 1.4 + Math.random() * 1.2, -0.15, true);
    }
    particles.burst(T.x, T.y + 0.3, T.z, [2.6, 1.0, 0.3], 22, 6);
    this.flash = 1;
    this.light.position.set(T.x, T.y + 1.5, T.z);
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
    this.d.events.emit('meteor:impact', { id: m.id, x: T.x, y: T.y, z: T.z, distance: dist, meteorite: m.meteorite });
  }
}
