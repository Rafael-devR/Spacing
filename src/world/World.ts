// Mundo em chunks: carrega/descarrega ao redor do jogador, guarda edições e objetos removidos.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { ExtraPropSave, WorldSave } from '../core/save';
import { AIR, type BlockId } from '../data/blocks';
import type { PropType } from '../data/props';
import type { Structure } from './Structure';
import type { PropFactory } from '../render/models';
import { meshPadded } from './mesher';
import { CH, CS, Terrain, idx, type PropSpawn } from './terrain';

const PW = CS + 2;
const PL = PW * PW;

export type V3 = [number, number, number];

export interface PropInstance extends PropSpawn {
  mesh?: PropMesh;
}

export interface PropUserData {
  prop: PropInstance;
  chunk: Chunk;
  /** altura de destino enquanto o objeto cai */
  fallTo?: number;
}

export type PropMesh = THREE.Mesh & { userData: PropUserData };

export interface Chunk {
  cx: number;
  cz: number;
  key: string;
  data: Uint8Array;
  props: PropInstance[];
  maxY: number;
  mesh: THREE.Mesh | null;
  propMeshes: PropMesh[];
  dirty: boolean;
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  id: BlockId;
  /** normal da face atingida */
  normal: V3;
  t: number;
}

export type BlockEdit = [x: number, y: number, z: number, id: BlockId];

export class World {
  readonly terrain: Terrain;
  readonly chunks = new Map<string, Chunk>();
  /** chave do chunk -> Map(índice -> id) */
  private readonly edits = new Map<string, Map<number, BlockId>>();
  private readonly removedProps = new Set<string>();
  private extraProps: ExtraPropSave[] = [];
  /** todas as malhas de objetos carregadas (para o raio de mira) */
  readonly propMeshes: PropMesh[] = [];
  private readonly pad = new Uint8Array(PL * CH);
  /** estruturas construídas (a base); mandam nas células que ocupam */
  readonly structures: Structure[] = [];
  /** raio de chunks carregados ao redor do jogador */
  radius = 3;
  /**
   * Medição de desempenho (teste de desempenho, docs/design/BENCHMARK.md): quanto custa gerar um chunk, malhar um chunk novo e
   * refazer a malha depois de editar blocos. Desligada (null) fora do teste: o custo é uma checagem por chunk.
   */
  perf: { onGenerate(ms: number): void; onMesh(ms: number, edit: boolean): void } | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    seed: number,
    private readonly material: THREE.Material,
    readonly props: PropFactory,
    private readonly events?: GameBus,
  ) {
    this.terrain = new Terrain(seed);
  }

  key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  chunk(cx: number, cz: number): Chunk {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      const t0 = this.perf ? performance.now() : 0;
      const g = this.terrain.generate(cx, cz);
      this.perf?.onGenerate(performance.now() - t0);
      c = { cx, cz, key: k, data: g.data, props: g.props, maxY: g.maxY, mesh: null, propMeshes: [], dirty: true };
      for (const e of this.extraProps) {
        if (Math.floor(e.wx / CS) === cx && Math.floor(e.wz / CS) === cz) c.props.push({ ...e, y: 0 });
      }
      const ed = this.edits.get(k);
      if (ed) {
        for (const [i, id] of ed) {
          c.data[i] = id;
          const y = Math.floor(i / (CS * CS));
          if (id && y > c.maxY) c.maxY = y;
        }
      }
      this.chunks.set(k, c);
    }
    return c;
  }

  /** Registra uma estrutura. Chame antes de gerar os chunks da região (os objetos soltos respeitam). */
  addStructure(s: Structure): void {
    this.structures.push(s);
  }

  /** estrutura que ocupa a célula, se houver */
  structureAt(x: number, y: number, z: number): Structure | null {
    for (const s of this.structures) if (s.contains(x, y, z)) return s;
    return null;
  }

  private underStructure(x: number, z: number): boolean {
    for (const s of this.structures) if (s.coversColumn(x, z)) return true;
    return false;
  }

  /** quantos chunks estão carregados agora */
  get chunkCount(): number {
    return this.chunks.size;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return 1;
    if (y >= CH) return AIR;
    for (const s of this.structures) if (s.contains(x, y, z)) return s.block(x, y, z);
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.chunk(cx, cz).data[idx(x - cx * CS, y, z - cz * CS)];
  }

  /** Igual a getBlock, mas não gera chunks novos (para raios de seleção). */
  peekBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CH) return AIR;
    for (const s of this.structures) if (s.contains(x, y, z)) return s.block(x, y, z, true);
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    return c ? c.data[idx(x - cx * CS, y, z - cz * CS)] : AIR;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== AIR;
  }

  topY(x: number, z: number): number {
    for (let y = CH - 1; y >= 0; y--) if (this.getBlock(x, y, z) !== AIR) return y;
    return 0;
  }

  setBlock(x: number, y: number, z: number, id: BlockId): boolean {
    return this.setBlocks([[x, y, z, id]]) > 0;
  }

  /** Altera vários blocos e reconstrói cada chunk afetado uma única vez. */
  setBlocks(list: BlockEdit[]): number {
    const dirty = new Set<string>();
    const applied: BlockEdit[] = [];
    for (const e of list) {
      const [x, y, z, id] = e;
      if (y <= 0 || y >= CH) continue;
      if (this.structureAt(x, y, z)) continue; // a base não é editável bloco a bloco
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
      applied.push(e);
    }
    for (const k of dirty) {
      const c = this.chunks.get(k);
      if (c && c.mesh) this.rebuild(c, true);
    }
    for (const [x, y, z, id] of applied) {
      if (id === AIR) this.settleProp(x, y, z);
      this.events?.emit('world:blockChanged', { x, y, z, id });
    }
    return applied.length;
  }

  /** `edit`: a malha é refeita por uma edição de blocos (e não por um chunk novo); só serve para a medição */
  rebuild(c: Chunk, edit = false): void {
    const ox = c.cx * CS, oz = c.cz * CS;
    const pad = this.pad;
    const h = Math.min(CH, c.maxY + 2);
    // vizinhos (garante que existam)
    const nb: Record<string, Uint8Array> = {};
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) nb[dx + ',' + dz] = this.chunk(c.cx + dx, c.cz + dz).data;
    }
    const t0 = this.perf ? performance.now() : 0;
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
    this.perf?.onMesh(performance.now() - t0, edit);
  }

  private propKey(p: PropSpawn): string {
    return p.key || p.wx + ',' + p.wz;
  }

  private spawnProps(c: Chunk): void {
    for (const p of c.props) this.spawnProp(c, p);
  }

  private spawnProp(c: Chunk, p: PropInstance): PropMesh | null {
    if (this.removedProps.has(this.propKey(p))) return null;
    if (this.underStructure(p.wx, p.wz)) return null; // nada de pedra dentro da base
    p.y = this.topY(p.wx, p.wz) + 1;
    const mesh = this.props.create(p.type, p.variant) as PropMesh;
    mesh.position.set(p.wx + 0.5, p.y, p.wz + 0.5);
    mesh.rotation.y = p.rot;
    mesh.scale.setScalar(p.scale);
    mesh.userData = { prop: p, chunk: c };
    p.mesh = mesh;
    c.propMeshes.push(mesh);
    this.propMeshes.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  /** Objetos criados durante o jogo (ex.: meteoritos); são salvos. */
  addExtraProp(e: { wx: number; wz: number; type: PropType; variant?: number; rot?: number; scale?: number }): PropMesh | null {
    if (this.underStructure(e.wx, e.wz)) return null;
    const save: ExtraPropSave = {
      wx: e.wx,
      wz: e.wz,
      type: e.type,
      variant: e.variant || 0,
      rot: e.rot || 0,
      scale: e.scale || 1,
      key: 'x' + e.wx + ',' + e.wz + ',' + e.type,
    };
    this.extraProps.push(save);
    this.removedProps.delete(save.key);
    const c = this.chunks.get(this.key(Math.floor(save.wx / CS), Math.floor(save.wz / CS)));
    if (!c) return null;
    const p: PropInstance = { ...save, y: 0 };
    c.props.push(p);
    return c.mesh ? this.spawnProp(c, p) : null;
  }

  findProp(type: PropType): PropMesh | null {
    return this.propMeshes.find((m) => m.userData.prop.type === type) || null;
  }

  propAt(x: number, z: number): PropMesh | null {
    const c = this.chunks.get(this.key(Math.floor(x / CS), Math.floor(z / CS)));
    if (!c) return null;
    return c.propMeshes.find((m) => m.userData.prop.wx === x && m.userData.prop.wz === z) || null;
  }

  /** Se o bloco embaixo de um objeto sumir, ele cai até o chão. */
  private settleProp(x: number, y: number, z: number): void {
    const m = this.propAt(x, z);
    if (!m) return;
    const p = m.userData.prop;
    if (p.y > y) {
      p.y = this.topY(x, z) + 1;
      m.userData.fallTo = p.y;
    }
  }

  removeProp(mesh: PropMesh): void {
    const p = mesh.userData.prop;
    const c = mesh.userData.chunk;
    this.removedProps.add(this.propKey(p));
    this.scene.remove(mesh);
    c.propMeshes.splice(c.propMeshes.indexOf(mesh), 1);
    this.propMeshes.splice(this.propMeshes.indexOf(mesh), 1);
  }

  private unload(c: Chunk): void {
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

  /** Carrega e malha chunks perto de (px, pz), descarrega os distantes. Retorna quantos faltam. */
  update(px: number, pz: number, budget = 2, dt = 0): number {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const R = this.radius;
    const todo: [number, number, number][] = [];
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
      const to = m.userData.fallTo;
      if (to === undefined) continue;
      m.position.y = Math.max(to, m.position.y - dt * 8);
      if (m.position.y <= to) delete m.userData.fallTo;
    }
    return todo.length;
  }

  /** Raio por voxels (DDA). Retorna o bloco atingido e a normal da face. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 200): VoxelHit | null {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = dir.x ? Math.abs(1 / dir.x) : Infinity;
    const tdy = dir.y ? Math.abs(1 / dir.y) : Infinity;
    const tdz = dir.z ? Math.abs(1 / dir.z) : Infinity;
    let tmx = dir.x > 0 ? (x + 1 - origin.x) * tdx : dir.x < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = dir.y > 0 ? (y + 1 - origin.y) * tdy : dir.y < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = dir.z > 0 ? (z + 1 - origin.z) * tdz : dir.z < 0 ? (origin.z - z) * tdz : Infinity;
    let t = 0;
    const n: V3 = [0, 0, 0];
    for (let i = 0; i < 600 && t <= maxDist; i++) {
      if (y < CH && y >= 0) {
        const id = this.peekBlock(x, y, z);
        if (id !== AIR) return { x, y, z, id, normal: [n[0], n[1], n[2]], t };
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
  serialize(): WorldSave {
    const edits: WorldSave['edits'] = {};
    for (const [k, m] of this.edits) edits[k] = [...m];
    return { edits, removedProps: [...this.removedProps], extraProps: this.extraProps };
  }

  /** Precisa ser chamado antes de qualquer chunk ser gerado. */
  load(s: WorldSave | null | undefined): void {
    if (!s) return;
    for (const k in s.edits) this.edits.set(k, new Map(s.edits[k]));
    for (const k of s.removedProps) this.removedProps.add(k);
    this.extraProps = s.extraProps.filter((e) => !this.removedProps.has(e.key));
  }
}
