// Mirar, minerar, construir, itens voando para o jogador e "toque para andar".
import * as THREE from 'three';
import { AIR, BLOCKS, ITEMS, PROPS, PROP_DEBRIS } from './blocks.js';
import { meshSingle } from './mesher.js';
import { CH } from './terrain.js';

const REACH = 4.4;

export class Interaction {
  constructor(ctx) {
    Object.assign(this, ctx); // world, player, camera, rig, particles, sfx, ui, inventory, scene, materials, canvas
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.target = null;
    this.mine = { key: null, progress: 0, tick: 0 };
    this.buildMode = false;
    this.walkGoal = null;
    this.stuck = 0;
    this.drops = [];

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.lineMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: true });
    this.highlight = new THREE.LineSegments(edges, this.lineMat);
    this.highlight.visible = false;
    this.highlight.renderOrder = 10;
    this.scene.add(this.highlight);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // geometrias dos itens soltos
    this.blockGeos = {};
    this.v = new THREE.Vector3();
  }

  blockGeo(id) {
    if (!this.blockGeos[id]) {
      const m = meshSingle(id);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
      g.setAttribute('aEdge', new THREE.BufferAttribute(m.edge, 2));
      g.translate(-0.5, -0.5, -0.5);
      this.blockGeos[id] = g;
    }
    return this.blockGeos[id];
  }

  // objeto 3D que representa um item (ícones e itens soltos)
  itemObject(item) {
    const def = ITEMS[item];
    if (def.block) return new THREE.Mesh(this.blockGeo(def.block), this.materials.terrain);
    if (def.icon.block) return new THREE.Mesh(this.blockGeo(def.icon.block), this.materials.terrain);
    const g = this.world.props.geos[def.icon.prop][0].clone();
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    return new THREE.Mesh(g, this.materials.props);
  }

  pick(px, py) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const ray = this.raycaster.ray;
    const hit = this.world.raycast(ray.origin, ray.direction, 220);
    const ph = this.raycaster.intersectObjects(this.world.propMeshes, false)[0];
    if (ph && (!hit || ph.distance < hit.t)) {
      const mesh = ph.object;
      const box = new THREE.Box3().setFromObject(mesh);
      return { kind: 'prop', mesh, key: 'p' + mesh.id, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), hard: PROPS[mesh.userData.prop.type].hardness };
    }
    if (hit) {
      return {
        kind: 'block', ...hit, key: `${hit.x},${hit.y},${hit.z}`,
        center: new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5),
        hard: BLOCKS[hit.id].hardness,
      };
    }
    return null;
  }

  inReach(t) { return t && this.player.center().distanceTo(t.center) <= REACH; }

  setBuildMode(on) {
    this.buildMode = on;
    this.ui.setBuildMode(on);
  }

  tap(x, y, button) {
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

  place(t) {
    const item = this.ui.selectedItem();
    const def = ITEMS[item];
    if (!def || !def.block) { this.ui.toast('Selecione um bloco para construir', true); this.sfx.play('deny'); return; }
    if (!this.inventory[item]) { this.ui.toast(`Sem ${def.name.toLowerCase()} no inventário`, true); this.sfx.play('deny'); return; }
    const x = t.x + t.normal[0], y = t.y + t.normal[1], z = t.z + t.normal[2];
    if (y <= 0 || y >= CH || this.world.getBlock(x, y, z) !== AIR || this.player.intersectsBlock(x, y, z)) { this.sfx.play('deny'); return; }
    const pm = this.world.propAt(x, z);
    if (pm && pm.userData.prop.y === y) { this.sfx.play('deny'); return; }
    this.world.setBlock(x, y, z, def.block);
    this.inventory[item]--;
    this.ui.updateCounts();
    this.sfx.play('place');
    this.particles.dust(x + 0.5, y, z + 0.5, 5, 0.5);
  }

  breakTarget(t) {
    if (t.kind === 'block') {
      const def = BLOCKS[t.id];
      this.world.setBlock(t.x, t.y, t.z, AIR);
      const palette = def.oreL ? [def.sideL, def.oreL, def.sideL, def.topL] : [def.sideL, def.sideL, def.topL];
      this.debris.burst(t.center, def.oreL ? 18 : 15, palette, { power: 2.4, up: 3.2 });
      this.particles.dust(t.center.x, t.center.y - 0.3, t.center.z, 6, 0.4);
      if (def.drop) this.spawnDrop(def.drop, t.center, 1);
    } else {
      const p = t.mesh.userData.prop;
      this.world.removeProp(t.mesh);
      const pal = PROP_DEBRIS[p.type] || PROP_DEBRIS.boulder;
      this.debris.burst(t.center, p.type === 'meteorite' ? 26 : 16, pal, { power: 2.8, up: 3.6, spread: 0.4, maxSize: 0.26 });
      this.particles.dust(t.center.x, t.center.y - 0.3, t.center.z, 8, 0.5);
      const d = PROPS[p.type];
      this.spawnDrop(d.drop, t.center, d.amount);
      for (const [item, n] of Object.entries(d.bonus || {})) this.spawnDrop(item, t.center, n);
      this.onPropBroken?.(p.type);
    }
    this.rig.shake(0.18);
    this.sfx.play('break');
  }

  spawnDrop(item, at, n) {
    for (let i = 0; i < n; i++) {
      const obj = this.itemObject(item);
      const s = ITEMS[item].block || ITEMS[item].icon.block ? 0.3 : 0.42;
      obj.scale.setScalar(s);
      obj.position.copy(at);
      obj.castShadow = true;
      this.scene.add(obj);
      const a = Math.random() * Math.PI * 2;
      this.drops.push({ obj, item, age: -i * 0.08, vel: new THREE.Vector3(Math.cos(a) * 1.4, 4 + Math.random(), Math.sin(a) * 1.4) });
    }
  }

  updateDrops(dt) {
    const target = this.player.center();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age < 0) continue;
      const o = d.obj;
      if (d.age < 0.45) {
        d.vel.y -= 12 * dt;
        o.position.addScaledVector(d.vel, dt);
      } else {
        const to = this.v.subVectors(target, o.position);
        const dist = to.length();
        const sp = 4 + (d.age - 0.45) * 22;
        o.position.addScaledVector(to.normalize(), Math.min(dist, sp * dt));
        o.scale.multiplyScalar(dist < 1 ? 0.9 : 1);
        if (dist < 0.35) {
          this.scene.remove(o);
          if (o.geometry !== this.blockGeos[ITEMS[d.item].block || ITEMS[d.item].icon?.block]) o.geometry.dispose();
          this.drops.splice(i, 1);
          this.inventory[d.item] = (this.inventory[d.item] || 0) + 1;
          this.ui.updateCounts(d.item);
          this.ui.pickup(d.item);
          this.sfx.play('pop');
          this.onCollect?.(d.item, 1);
          continue;
        }
      }
      o.rotation.y += dt * 4;
      o.rotation.x += dt * 2;
    }
  }

  update(dt, input) {
    const p = input.pointer;
    const active = p.inside && (p.type === 'mouse' || p.down);
    const t = active ? this.pick(p.x, p.y) : null;
    this.target = t;
    const reach = this.inReach(t);

    // destaque
    if (t) {
      this.highlight.visible = true;
      if (t.kind === 'block') {
        this.highlight.position.copy(t.center);
        this.highlight.scale.setScalar(1.03);
      } else {
        this.highlight.position.copy(t.center);
        this.highlight.scale.copy(t.size).multiplyScalar(1.08);
      }
      this.lineMat.color.set(!reach ? '#ff8f7a' : this.buildMode ? '#7fe7ff' : '#ffffff');
    } else this.highlight.visible = false;

    // fantasma do bloco a construir
    const showGhost = t && t.kind === 'block' && reach && (this.buildMode || (p.type === 'mouse' && p.down && p.button === 2));
    this.ghost.visible = !!showGhost && !!ITEMS[this.ui.selectedItem()]?.block;
    if (this.ghost.visible) this.ghost.position.set(t.x + t.normal[0] + 0.5, t.y + t.normal[1] + 0.5, t.z + t.normal[2] + 0.5);

    // mineração (segurando)
    const holding = p.down && p.button === 0 && !this.buildMode && t && t.hard !== Infinity;
    let mining = false;
    if (holding && reach) {
      if (this.mine.key !== t.key) { this.mine.key = t.key; this.mine.progress = 0; }
      this.mine.progress += dt / t.hard;
      this.mine.tick -= dt;
      mining = true;
      this.walkGoal = null;
      const c = this.player.center();
      this.player.faceTarget = Math.atan2(t.center.x - c.x, t.center.z - c.z);
      if (this.mine.tick <= 0) {
        this.mine.tick = 0.13;
        this.sfx.play('hit');
        const rgb = t.kind === 'block' ? BLOCKS[t.id].sideL : (PROP_DEBRIS[t.mesh.userData.prop.type] || PROP_DEBRIS.boulder)[0];
        const n = this.v.copy(c).sub(t.center).normalize().multiplyScalar(0.55);
        const hp = t.center.clone().add(n);
        this.particles.burst(hp.x, hp.y, hp.z, rgb, 2, 1.4);
        // lascas que ficam no chão
        if (Math.random() < 0.5) this.debris.spawn(hp, n.clone().multiplyScalar(4).setY(2 + Math.random() * 2), 0.07 + Math.random() * 0.06, rgb, 1);
        this.particles.spawn(hp.x, hp.y, hp.z, n.x * 3 + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, n.z * 3 + (Math.random() - 0.5) * 2, 0.05, [2.4, 1.6, 0.6], 0.25, 6);
        this.rig.shake(0.1);
      }
      if (this.mine.progress >= 1) {
        this.breakTarget(t);
        this.mine.key = null;
        this.mine.progress = 0;
      }
    } else {
      if (holding && !reach && p.type !== 'mouse') this.walkGoal = { pos: t.center.clone(), reach: true };
      if (!p.down) { this.mine.key = null; this.mine.progress = 0; }
      this.player.faceTarget = undefined;
    }
    this.player.mining = mining;

    if (mining) {
      const sp = t.center.clone().project(this.camera);
      const r = this.canvas.getBoundingClientRect();
      this.ui.setProgress(r.left + (sp.x * 0.5 + 0.5) * r.width, r.top + (-sp.y * 0.5 + 0.5) * r.height, Math.min(1, this.mine.progress));
    } else this.ui.setProgress(0, 0, null);

    this.updateDrops(dt);
  }

  // Converte o objetivo de caminhada em entrada de movimento
  steer(input, dt) {
    const g = this.walkGoal;
    if (!g) return;
    if (input.hasMoveInput) { this.walkGoal = null; return; }
    const pc = this.player.center();
    const dx = g.pos.x - pc.x, dz = g.pos.z - pc.z;
    const flat = Math.hypot(dx, dz);
    const done = g.reach ? pc.distanceTo(g.pos) < REACH - 0.6 : flat < 0.5;
    if (done) { this.walkGoal = null; return; }
    const f = this.rig.forward(), r = this.rig.right();
    input.moveX = (dx * r.x + dz * r.z) / flat;
    input.moveY = (dx * f.x + dz * f.z) / flat;
    // pula se ficar preso
    const v = this.player.vel;
    if (Math.hypot(v.x, v.z) < 0.6 && this.player.onGround) {
      this.stuck += dt;
      if (this.stuck > 0.25) {
        this.stuck = 0;
        g.jumps = (g.jumps || 0) + 1;
        if (g.jumps > 2) this.walkGoal = null;
        else input.jump = true;
      }
    } else this.stuck = 0;
  }
}
