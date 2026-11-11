// Mundo em chunks: carrega/descarrega ao redor do jogador, guarda edições e objetos removidos.
import * as THREE from 'three';
import { Terrain, CS, CH, idx } from './terrain.js';
import { meshPadded } from './mesher.js';
import { AIR, BLOCKS } from './blocks.js';

const PW = CS + 2, PL = PW * PW;

export class World {
  constructor(scene, seed, terrainMaterial, propFactory) {
    this.scene = scene;
    this.terrain = new Terrain(seed);
    this.material = terrainMaterial;
    this.props = propFactory;
    this.chunks = new Map();
    this.edits = new Map(); // chave do chunk -> Map(índice -> id)
    this.removedProps = new Set();
    this.extraProps = [];
    this.propMeshes = [];
    this.onBlockChange = null;
    this.pad = new Uint8Array(PL * CH);
    this.radius = 3;
  }

  key(cx, cz) { return cx + ',' + cz; }

  chunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      const g = this.terrain.generate(cx, cz);
      c = { cx, cz, key: k, data: g.data, props: g.props, maxY: g.maxY, mesh: null, propMeshes: [], dirty: true };
      for (const e of this.extraProps) {
        if (Math.floor(e.wx / CS) === cx && Math.floor(e.wz / CS) === cz) c.props.push({ ...e });
      }
      const ed = this.edits.get(k);
      if (ed) for (const [i, id] of ed) {
        c.data[i] = id;
        const y = Math.floor(i / (CS * CS));
        if (id && y > c.maxY) c.maxY = y;
      }
      this.chunks.set(k, c);
    }
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0) return 1;
    if (y >= CH) return AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.chunk(cx, cz).data[idx(x - cx * CS, y, z - cz * CS)];
  }

  // Igual a getBlock, mas não gera chunks novos (para raios de seleção)
  peekBlock(x, y, z) {
    if (y < 0 || y >= CH) return AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    return c ? c.data[idx(x - cx * CS, y, z - cz * CS)] : AIR;
  }

  isSolid(x, y, z) { return this.getBlock(x, y, z) !== AIR; }

  topY(x, z) {
    for (let y = CH - 1; y >= 0; y--) if (this.getBlock(x, y, z) !== AIR) return y;
    return 0;
  }

  setBlock(x, y, z, id) {
    return this.setBlocks([[x, y, z, id]]) > 0;
  }

  // Altera vários blocos e reconstrói cada chunk afetado uma única vez
  setBlocks(list) {
    const dirty = new Set();
    let n = 0;
    for (const [x, y, z, id] of list) {
      if (y <= 0 || y >= CH) continue;
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      const c = this.chunk(cx, cz);
      const lx = x - cx * CS, lz = z - cz * CS;
      const i = idx(lx, y, lz);
      c.data[i] = id;
      if (id && y > c.maxY) c.maxY = y;
      let ed = this.edits.get(c.key);
      if (!ed) this.edits.set(c.key, (ed = new Map()));
      ed.set(i, id);
      dirty.add(c.key);
      const ex = lx === 0 ? -1 : lx === CS - 1 ? 1 : 0;
      const ez = lz === 0 ? -1 : lz === CS - 1 ? 1 : 0;
      if (ex) dirty.add(this.key(cx + ex, cz));
      if (ez) dirty.add(this.key(cx, cz + ez));
      if (ex && ez) dirty.add(this.key(cx + ex, cz + ez));
      n++;
    }
    for (const k of dirty) {
      const c = this.chunks.get(k);
      if (c && c.mesh) this.rebuild(c);
    }
    for (const [x, y, z, id] of list) {
      if (id === AIR) this.settleProp(x, y, z);
      this.onBlockChange?.(x, y, z, id);
    }
    return n;
  }

  rebuild(c) {
    const ox = c.cx * CS, oz = c.cz * CS;
    const pad = this.pad;
    const h = Math.min(CH, c.maxY + 2);
    // vizinhos (garante que existam)
    const nb = {};
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb[dx + ',' + dz] = this.chunk(c.cx + dx, c.cz + dz).data;
    for (let y = 0; y < h; y++) {
      for (let z = -1; z <= CS; z++) {
        const dz = z < 0 ? -1 : z >= CS ? 1 : 0;
        const lz = z - dz * CS;
        for (let x = -1; x <= CS; x++) {
          const dx = x < 0 ? -1 : x >= CS ? 1 : 0;
          pad[x + 1 + (z + 1) * PW + y * PL] = nb[dx + ',' + dz][idx(x - dx * CS, y, lz)];
        }
      }
    }
    pad.fill(0, h * PL);
    const m = meshPadded(pad, CS, CS, CH, c.maxY, ox, oz);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(m.edge, 2));
    geo.computeBoundingSphere();
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.material);
      c.mesh.position.set(ox, 0, oz);
      c.mesh.castShadow = true;
      c.mesh.receiveShadow = true;
      this.scene.add(c.mesh);
      this.spawnProps(c);
    }
    c.dirty = false;
  }

  propKey(p) { return p.key || p.wx + ',' + p.wz; }

  spawnProps(c) {
    for (const p of c.props) this.spawnProp(c, p);
  }

  spawnProp(c, p) {
    if (this.removedProps.has(this.propKey(p))) return null;
    p.y = this.topY(p.wx, p.wz) + 1;
    const mesh = this.props.create(p.type, p.variant);
    mesh.position.set(p.wx + 0.5, p.y, p.wz + 0.5);
    mesh.rotation.y = p.rot;
    mesh.scale.setScalar(p.scale);
    mesh.userData.prop = p;
    mesh.userData.chunk = c;
    p.mesh = mesh;
    c.propMeshes.push(mesh);
    this.propMeshes.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  // Objetos criados durante o jogo (ex.: meteoritos); são salvos
  addExtraProp(e) {
    const p = { ...e, key: 'x' + e.wx + ',' + e.wz + ',' + e.type, variant: e.variant || 0, rot: e.rot || 0, scale: e.scale || 1 };
    this.extraProps.push({ wx: p.wx, wz: p.wz, type: p.type, variant: p.variant, rot: p.rot, scale: p.scale, key: p.key });
    this.removedProps.delete(p.key);
    const c = this.chunks.get(this.key(Math.floor(p.wx / CS), Math.floor(p.wz / CS)));
    if (!c) return null;
    c.props.push(p);
    return c.mesh ? this.spawnProp(c, p) : null;
  }

  findProp(type) {
    return this.propMeshes.find((m) => m.userData.prop.type === type) || null;
  }

  propAt(x, z) {
    const c = this.chunks.get(this.key(Math.floor(x / CS), Math.floor(z / CS)));
    if (!c) return null;
    return c.propMeshes.find((m) => m.userData.prop.wx === x && m.userData.prop.wz === z) || null;
  }

  // Se o bloco embaixo de um objeto sumir, ele cai até o chão
  settleProp(x, y, z) {
    const m = this.propAt(x, z);
    if (!m) return;
    const p = m.userData.prop;
    if (p.y > y) {
      p.y = this.topY(x, z) + 1;
      m.userData.fallTo = p.y;
    }
  }

  removeProp(mesh) {
    const p = mesh.userData.prop;
    const c = mesh.userData.chunk;
    this.removedProps.add(this.propKey(p));
    this.scene.remove(mesh);
    c.propMeshes.splice(c.propMeshes.indexOf(mesh), 1);
    this.propMeshes.splice(this.propMeshes.indexOf(mesh), 1);
  }

  unload(c) {
    if (c.mesh) {
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    for (const m of c.propMeshes) {
      this.scene.remove(m);
      const i = this.propMeshes.indexOf(m);
      if (i >= 0) this.propMeshes.splice(i, 1);
    }
    this.chunks.delete(c.key);
  }

  update(px, pz, budget = 2, dt = 0) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const R = this.radius;
    const todo = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R + R) continue;
        const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
        if (!c || !c.mesh || c.dirty) todo.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(budget, todo.length); i++) this.rebuild(this.chunk(todo[i][1], todo[i][2]));

    // descarrega os distantes
    const far = (R + 2) * (R + 2) + R;
    for (const c of this.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > far) this.unload(c);
    }

    // objetos caindo
    for (const m of this.propMeshes) {
      if (m.userData.fallTo === undefined) continue;
      m.position.y = Math.max(m.userData.fallTo, m.position.y - dt * 8);
      if (m.position.y <= m.userData.fallTo) delete m.userData.fallTo;
    }
    return todo.length;
  }

  // Raio por voxels (DDA). Retorna bloco atingido e normal da face.
  raycast(origin, dir, maxDist = 200) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = dir.x ? Math.abs(1 / dir.x) : Infinity;
    const tdy = dir.y ? Math.abs(1 / dir.y) : Infinity;
    const tdz = dir.z ? Math.abs(1 / dir.z) : Infinity;
    let tmx = dir.x > 0 ? (x + 1 - origin.x) * tdx : dir.x < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = dir.y > 0 ? (y + 1 - origin.y) * tdy : dir.y < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = dir.z > 0 ? (z + 1 - origin.z) * tdz : dir.z < 0 ? (origin.z - z) * tdz : Infinity;
    let t = 0;
    const n = [0, 0, 0];
    for (let i = 0; i < 600 && t <= maxDist; i++) {
      if (y < CH && y >= 0) {
        const id = this.peekBlock(x, y, z);
        if (id !== AIR) return { x, y, z, id, normal: n.slice(), t };
      } else if (y < 0) return null;
      if (tmx < tmy && tmx < tmz) {
        x += sx; t = tmx; tmx += tdx; n[0] = -sx; n[1] = 0; n[2] = 0;
      } else if (tmy < tmz) {
        y += sy; t = tmy; tmy += tdy; n[0] = 0; n[1] = -sy; n[2] = 0;
      } else {
        z += sz; t = tmz; tmz += tdz; n[0] = 0; n[1] = 0; n[2] = -sz;
      }
    }
    return null;
  }

  // ---------- salvar / carregar ----------
  serialize() {
    const edits = {};
    for (const [k, m] of this.edits) edits[k] = [...m];
    return { edits, removedProps: [...this.removedProps], extraProps: this.extraProps };
  }

  load(s) {
    if (!s) return;
    for (const k in s.edits || {}) this.edits.set(k, new Map(s.edits[k]));
    for (const k of s.removedProps || []) this.removedProps.add(k);
    this.extraProps = (s.extraProps || []).filter((e) => !this.removedProps.has(e.key));
  }
}

export { CS, CH, BLOCKS };
