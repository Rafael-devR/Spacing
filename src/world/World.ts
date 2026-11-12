// Mundo em chunks: carrega/descarrega ao redor do jogador, guarda edições e objetos removidos.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { ExtraPropSave, WorldSave } from '../core/save';
import { AIR, type BlockId } from '../data/blocks';
import type { PropType } from '../data/props';
import type { Structure } from './Structure';
import type { PropFactory } from '../render/models';
import { meshPadded } from './mesher';
import { PLANET } from '../core/planet';
import { MarsTerrain } from './marsTerrain';
import { CH, CS, Terrain, idx, type PropSpawn, type TerrainGen } from './terrain';

const PW = CS + 2;
const PL = PW * PW;
/** luz do céu: nível de quem vê o céu direto; cada bloco de distância por dentro da rocha tira 1 (docs/design/MUNDO.md) */
export const SKY_MAX = 12;
/** margem em volta do chunk onde a luz é calculada (a luz de um vizinho alcança até SKY_MAX blocos) */
const LM = SKY_MAX;
const LW = CS + 2 * LM;
const LL = LW * LW;

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
  /** luz do céu de cada bloco (0..SKY_MAX), da última vez que a malha foi feita; null antes disso */
  light: Uint8Array | null;
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
  readonly terrain: TerrainGen;
  readonly chunks = new Map<string, Chunk>();
  /** chave do chunk -> Map(índice -> id) */
  private readonly edits = new Map<string, Map<number, BlockId>>();
  private readonly removedProps = new Set<string>();
  private extraProps: ExtraPropSave[] = [];
  /** todas as malhas de objetos carregadas (para o raio de mira) */
  readonly propMeshes: PropMesh[] = [];
  private readonly pad = new Uint8Array(PL * CH);
  private readonly padLight = new Uint8Array(PL * CH);
  // região do chunk com a margem da luz: blocos, luz, topo de cada coluna e fila da propagação
  private readonly reg = new Uint8Array(LL * CH);
  private readonly regLight = new Uint8Array(LL * CH);
  private readonly regTop = new Int16Array(LL);
  private readonly queue: number[] = [];
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
    private material: THREE.Material,
    readonly props: PropFactory,
    private readonly events?: GameBus,
  ) {
    this.terrain = PLANET.id === 'marte' ? new MarsTerrain(seed) : new Terrain(seed);
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
      c = { cx, cz, key: k, data: g.data, props: g.props, maxY: g.maxY, light: null, mesh: null, propMeshes: [], dirty: true };
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

  /** Troca o material de todos os chunks (o normal ou o do corte da caverna). */
  setMaterial(m: THREE.Material): void {
    if (m === this.material) return;
    this.material = m;
    for (const c of this.chunks.values()) if (c.mesh) c.mesh.material = m;
  }

  /** há rocha acima deste ponto, na mesma coluna? (teto de caverna, beiral, construção) */
  roofed(x: number, y: number, z: number): boolean {
    const bx = Math.floor(x), bz = Math.floor(z);
    const c = this.chunks.get(this.key(Math.floor(bx / CS), Math.floor(bz / CS)));
    if (!c) return false;
    const i = idx(bx - c.cx * CS, 0, bz - c.cz * CS);
    for (let yy = Math.max(1, Math.floor(y) + 1); yy <= c.maxY; yy++) if (c.data[i + yy * CS * CS]) return true;
    return false;
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
      // a luz muda mais longe que a borda quando a edição abre ou fecha um caminho para o céu
      const reach = Math.max(1, this.lightReach(x, y, z, id));
      c.data[i] = id;
      if (id && y > c.maxY) c.maxY = y;
      let ed = this.edits.get(c.key);
      if (!ed) this.edits.set(c.key, (ed = new Map()));
      ed.set(i, id);
      dirty.add(c.key);
      for (let dz = -1; dz <= 1; dz++) {
        if ((dz < 0 && lz >= reach) || (dz > 0 && lz < CS - reach)) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx < 0 && lx >= reach) || (dx > 0 && lx < CS - reach)) continue;
          if (dx || dz) dirty.add(this.key(cx + dx, cz + dz));
        }
      }
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
    const pad = this.pad, padLight = this.padLight;
    // vizinhos (garante que existam)
    const nb: Chunk[] = [];
    let top = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunk(c.cx + dx, c.cz + dz);
        nb.push(n);
        if (n.maxY > top) top = n.maxY;
      }
    }
    const t0 = this.perf ? performance.now() : 0;
    // a luz precisa da altura dos vizinhos (um morro ao lado faz sombra de céu); a malha, só da do chunk
    const hh = Math.min(CH, top + 2);
    const h = Math.min(CH, c.maxY + 2);
    this.skyLight(nb, hh);
    const light = c.light ?? (c.light = new Uint8Array(CS * CS * CH));
    const { reg, regLight } = this;
    for (let y = 0; y < h; y++) {
      for (let z = -1; z <= CS; z++) {
        const r = LM + z, o = (z + 1) * PW + y * PL + 1;
        for (let x = -1; x <= CS; x++) {
          const i = LM + x + r * LW + y * LL;
          pad[o + x] = reg[i];
          padLight[o + x] = regLight[i];
        }
      }
    }
    for (let y = 0; y < hh; y++)
      for (let z = 0; z < CS; z++) {
        const i = LM + (LM + z) * LW + y * LL;
        light.set(regLight.subarray(i, i + CS), idx(0, y, z));
      }
    light.fill(SKY_MAX, hh * CS * CS);
    pad.fill(0, h * PL);
    padLight.fill(SKY_MAX, h * PL);
    const m = meshPadded(pad, CS, CS, CH, c.maxY, ox, oz, true, padLight);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(m.edge, 2));
    geo.setAttribute('aSky', new THREE.BufferAttribute(m.sky, 1));
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

  /**
   * Luz do céu na região do chunk do meio de `nb` (os 9 chunks, em ordem de z e x) com a margem: quem está acima do
   * topo da coluna vê o céu (SKY_MAX); dali a luz entra pelas aberturas perdendo 1 por bloco. Preenche `reg` e `regLight`.
   */
  private skyLight(nb: Chunk[], hh: number): void {
    const { reg, regLight, regTop, queue } = this;
    for (let z = 0; z < LW; z++) {
      const wz = z - LM, dz = wz < 0 ? 0 : wz >= CS ? 2 : 1, lz = wz - (dz - 1) * CS;
      for (let x = 0; x < LW; x++) {
        const wx = x - LM, dx = wx < 0 ? 0 : wx >= CS ? 2 : 1, lx = wx - (dx - 1) * CS;
        const n = nb[dx + dz * 3];
        const data = n.data, col = lx + lz * CS, o = x + z * LW;
        let t = Math.min(n.maxY, hh - 1);
        while (t > 0 && !data[col + t * CS * CS]) t--;
        regTop[o] = t;
        for (let y = 0; y < hh; y++) {
          reg[o + y * LL] = data[col + y * CS * CS];
          regLight[o + y * LL] = y > t ? SKY_MAX : 0;
        }
      }
    }
    // sementes: blocos de céu ao lado de uma coluna mais alta (podem iluminar uma abertura nela)
    queue.length = 0;
    for (let z = 0; z < LW; z++)
      for (let x = 0; x < LW; x++) {
        const o = x + z * LW, t = regTop[o];
        let m = t;
        if (x > 0 && regTop[o - 1] > m) m = regTop[o - 1];
        if (x < LW - 1 && regTop[o + 1] > m) m = regTop[o + 1];
        if (z > 0 && regTop[o - LW] > m) m = regTop[o - LW];
        if (z < LW - 1 && regTop[o + LW] > m) m = regTop[o + LW];
        for (let y = t + 1; y <= m; y++) queue.push(o + y * LL);
      }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const v = regLight[i] - 1;
      if (v <= 0) continue;
      const y = Math.floor(i / LL), r = i - y * LL, z = Math.floor(r / LW), x = r - z * LW;
      if (x > 0) this.spread(i - 1, v);
      if (x < LW - 1) this.spread(i + 1, v);
      if (z > 0) this.spread(i - LW, v);
      if (z < LW - 1) this.spread(i + LW, v);
      if (y > 0) this.spread(i - LL, v);
      if (y < hh - 1) this.spread(i + LL, v);
    }
  }

  private spread(i: number, v: number): void {
    if (this.reg[i] || this.regLight[i] >= v) return;
    this.regLight[i] = v;
    this.queue.push(i);
  }

  /** luz do céu guardada de um bloco (0..SKY_MAX); -1 se o chunk ainda não foi malhado */
  private lightAt(x: number, y: number, z: number): number {
    if (y >= CH) return SKY_MAX;
    if (y < 0) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const l = this.chunks.get(this.key(cx, cz))?.light;
    return l ? l[idx(x - cx * CS, y, z - cz * CS)] : -1;
  }

  /** 0 (escuro total) a 1 (céu aberto) no bloco; 1 se ainda não se sabe */
  skyAt(x: number, y: number, z: number): number {
    const v = this.lightAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return v < 0 ? 1 : v / SKY_MAX;
  }

  /**
   * Até que distância (em blocos) trocar este bloco pode mudar a luz do céu. 0 = não muda nada além dele. Minerar no
   * chão aberto ou no escuro dá 0; furar o teto de uma caverna ou tampar uma abertura alcança longe.
   */
  private lightReach(x: number, y: number, z: number, id: BlockId): number {
    const here = this.lightAt(x, y, z);
    if (here < 0) return SKY_MAX;
    const around: [number, number, number][] = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
    const open = (p: [number, number, number]): boolean => p[1] >= CH || (p[1] > 0 && this.peekBlock(p[0], p[1], p[2]) === AIR);
    if (id === AIR) {
      let v = 0;
      if (open(around[2]) && this.lightAt(x, y + 1, z) === SKY_MAX) v = SKY_MAX;
      else for (const p of around) if (open(p)) v = Math.max(v, this.lightAt(p[0], p[1], p[2]) - 1);
      for (const p of around) if (open(p) && this.lightAt(p[0], p[1], p[2]) < v - 1) return v;
      return 0;
    }
    if (here <= 1) return 0;
    if (here === SKY_MAX && open(around[3])) return SKY_MAX;
    for (const p of around) if (open(p) && this.lightAt(p[0], p[1], p[2]) === here - 1) return here;
    return 0;
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
    // o mesmo lugar pode ter tido um objeto que foi tirado (ex.: painel desmontado e colocado de novo)
    this.extraProps = this.extraProps.filter((x) => x.key !== save.key);
    this.extraProps.push(save);
    this.removedProps.delete(save.key);
    const c = this.chunks.get(this.key(Math.floor(save.wx / CS), Math.floor(save.wz / CS)));
    if (!c) return null;
    const p: PropInstance = { ...save, y: 0 };
    c.props.push(p);
    return c.mesh ? this.spawnProp(c, p) : null;
  }

  /** objetos de um tipo colocados durante o jogo e ainda no mundo (estejam ou não carregados) */
  placedProps(type: PropType): { key: string; x: number; z: number }[] {
    return this.extraProps.filter((e) => e.type === type && !this.removedProps.has(e.key)).map((e) => ({ key: e.key, x: e.wx, z: e.wz }));
  }

  /**
   * 0 ou 1: um objeto no chão em (x, z) vê o sol na direção `sun`? null se o chunk não está carregado (não dá para
   * saber sem gerar o terreno).
   */
  sunExposure(x: number, z: number, sun: THREE.Vector3): number | null {
    if (!this.chunks.get(this.key(Math.floor(x / CS), Math.floor(z / CS)))?.mesh) return null;
    const o = new THREE.Vector3(x + 0.5, this.topY(x, z) + 1.6, z + 0.5);
    return this.raycast(o, sun.clone().normalize(), 120) ? 0 : 1;
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
