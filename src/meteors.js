// Meteoros: aviso no chão, rastro de fogo, impacto com cratera, destroços, tremor e meteorito.
import * as THREE from 'three';
import { AIR, BEDROCK, BLOCKS } from './blocks.js';
import { PROP_DEBRIS } from './blocks.js';
import { LANDER } from './terrain.js';

const FLIGHT = 1.7;
const WARN = 1.6;

export class Meteors {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, world, debris, particles, sfx, rig, player
    this.active = [];
    this.timer = 100 + Math.random() * 60;
    this.onImpact = null;

    this.headGeo = new THREE.IcosahedronGeometry(0.55, 0);
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.4), fog: false });
    this.trailGeo = new THREE.CylinderGeometry(0.55, 0.02, 1, 8, 1, true);
    this.trailGeo.translate(0, -0.5, 0);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 0.9, 0.3), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.ringGeo = new THREE.RingGeometry(1.7, 2.1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.light = new THREE.PointLight('#ff9a4a', 0, 22, 1.6);
    this.scene.add(this.light);
    this.flash = 0;
    this.up = new THREE.Vector3(0, 1, 0);
  }

  // escolhe um ponto de queda perto do jogador
  pickTarget(minD = 11, maxD = 18) {
    const p = this.player.pos;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (Math.hypot(x - LANDER.x, z - LANDER.z) < 9) continue;
      const c = this.world.chunks.get(this.world.key(Math.floor(x / 16), Math.floor(z / 16)));
      if (!c || !c.mesh) continue;
      const y = this.world.topY(x, z) + 1;
      return new THREE.Vector3(x + 0.5, y, z + 0.5);
    }
    return null;
  }

  launch(target, { radius = 2.3, meteorite = true, delay = 0 } = {}) {
    if (!target) return null;
    const a = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a) * 0.55, -1, Math.sin(a) * 0.55).normalize();
    const start = target.clone().addScaledVector(dir, -55);
    const head = new THREE.Mesh(this.headGeo, this.headMat);
    const trail = new THREE.Mesh(this.trailGeo, this.trailMat);
    trail.quaternion.setFromUnitVectors(this.up, dir.clone().negate());
    trail.scale.set(1, 9, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.0, 0.4, 0.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(target).add(new THREE.Vector3(0, 0.06, 0));
    head.visible = trail.visible = false;
    this.scene.add(head, trail, ring);
    const m = { target, start, dir, head, trail, ring, ringMat, t: -delay - WARN, radius, meteorite, whoosh: false };
    this.active.push(m);
    return m;
  }

  update(dt, t) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 90 + Math.random() * 80;
      this.launch(this.pickTarget(12, 22), { radius: 1.6 + Math.random() * 0.8, meteorite: Math.random() < 0.6 });
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    let lightI = this.flash * 90;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.t += dt;
      // aviso pulsante no chão
      const warnK = Math.min(1, (m.t + WARN) / WARN);
      m.ringMat.opacity = warnK * (0.45 + 0.35 * Math.sin(t * 14));
      m.ring.scale.setScalar(1.25 - 0.25 * Math.max(0, m.t / FLIGHT));
      if (m.t < 0) continue;
      if (!m.whoosh) { m.whoosh = true; this.sfx.play('whoosh'); }
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
      this.particles.spawn(hp.x, hp.y, hp.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.14, [2.5, 0.9 + Math.random() * 0.4, 0.25], 0.35, 0);
      this.particles.spawn(hp.x, hp.y, hp.z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), 0.3, [0.32, 0.28, 0.34], 1.2, -0.3, true);
      if (k >= 1) {
        this.impact(m);
        this.scene.remove(m.head, m.trail, m.ring);
        m.ringMat.dispose();
        this.active.splice(i, 1);
      }
    }
    this.light.intensity = lightI;
  }

  impact(m) {
    const T = m.target, R = m.radius;
    const world = this.world;
    const c = new THREE.Vector3(T.x, T.y - 0.2, T.z);
    // cratera
    const list = [];
    const pieces = [];
    const r = Math.ceil(R);
    for (let y = Math.floor(c.y - r); y <= Math.floor(c.y + r); y++)
      for (let z = Math.floor(c.z - r); z <= Math.floor(c.z + r); z++)
        for (let x = Math.floor(c.x - r); x <= Math.floor(c.x + r); x++) {
          const d = Math.hypot(x + 0.5 - c.x, (y + 0.5 - c.y) * 1.4, z + 0.5 - c.z);
          if (d > R) continue;
          const id = world.getBlock(x, y, z);
          if (id === AIR || id === BEDROCK) continue;
          list.push([x, y, z, AIR]);
          pieces.push([x, y, z, id]);
        }
    world.setBlocks(list);
    // objetos no raio de impacto viram destroços
    for (const pm of [...world.propMeshes]) {
      if (pm.position.distanceTo(T) < R + 1.2) {
        const pal = PROP_DEBRIS[pm.userData.prop.type] || PROP_DEBRIS.boulder;
        world.removeProp(pm);
        this.debris.burst(pm.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 8, pal, { power: 5, up: 7 });
      }
    }
    // destroços voando
    const v = new THREE.Vector3(), p = new THREE.Vector3();
    pieces.sort(() => Math.random() - 0.5);
    for (const [x, y, z, id] of pieces.slice(0, 26)) {
      const def = BLOCKS[id];
      p.set(x + 0.5, y + 0.5, z + 0.5);
      v.subVectors(p, c).normalize().multiplyScalar(4 + Math.random() * 4);
      v.y = Math.abs(v.y) + 5 + Math.random() * 5;
      const col = def.oreL && Math.random() < 0.5 ? def.oreL : Math.random() < 0.3 ? def.topL : def.sideL;
      this.debris.spawn(p, v, 0.16 + Math.random() * 0.2, col, Math.random() < 0.5 ? 1 : 0);
    }
    // poeira e brasas
    for (let k = 0; k < 34; k++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4.5;
      this.particles.spawn(T.x, T.y + 0.3, T.z, Math.cos(a) * s, 0.6 + Math.random() * 2.5, Math.sin(a) * s,
        0.35 + Math.random() * 0.4, [0.55, 0.5, 0.52], 1.4 + Math.random() * 1.2, -0.15, true);
    }
    this.particles.burst(T.x, T.y + 0.3, T.z, [2.6, 1.0, 0.3], 22, 6);
    this.flash = 1;
    this.light.position.set(T.x, T.y + 1.5, T.z);
    this.sfx.play('boom');
    const dist = this.player.pos.distanceTo(T);
    this.rig.shake(Math.max(0.15, 1.1 - dist / 30));
    if (dist < 7) {
      const push = new THREE.Vector3().subVectors(this.player.pos, T).setY(0).normalize().multiplyScalar(6 * (1 - dist / 7));
      this.player.vel.x += push.x;
      this.player.vel.z += push.z;
      this.player.vel.y = Math.max(this.player.vel.y, 4 * (1 - dist / 7));
    }
    let mesh = null;
    if (m.meteorite) {
      const wx = Math.floor(T.x), wz = Math.floor(T.z);
      mesh = world.addExtraProp({ wx, wz, type: 'meteorite', rot: Math.random() * 6.28, scale: 0.95 + Math.random() * 0.2 });
      if (mesh) {
        mesh.position.y += 2.5;
        mesh.userData.fallTo = mesh.userData.prop.y;
      }
    }
    this.onImpact?.(T, mesh);
  }
}
