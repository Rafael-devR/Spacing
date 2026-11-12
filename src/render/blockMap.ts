// Mapa do tablet (docs/design/MAPA.md): a superfície do mundo desenhada em blocos, na mesma perspectiva da câmera
// do jogo, só onde o astronauta já andou (systems/Exploration.ts).
// Mostra o formato real do terreno (cada coluna com o seu topo e as suas paredes), mas sem detalhes: uma paleta
// própria de mapa por tipo de chão, sem minérios, sem pedras soltas, sem cavernas. As bordas do que foi descoberto
// descem numa saia que some no escuro. Desenhado numa textura do tamanho da tela, com antisserrilhado e sombras.
import * as THREE from 'three';
import { litOnlyShadows } from './materials';
import {
  BASALT, BEDROCK, CRYSTAL, DARK_SAND, GYPSUM, HEMATITE, HULL, ICE, IRON, LAVA, MARS_DUST, MARS_ROCK, OLIVINE, REGOLITH, ROCK, SEDIMENT,
  VOLCANIC, type BlockId, ANORTHOSITE, BRECCIA, NORITE, GLASSY_BASALT, ILMENITE_ORE, GOLD_ORE } from '../data/blocks';

/** blocos por lado de um chunk do mapa */
const CS = 16;
/** quantos blocos a borda do que foi descoberto desce até sumir */
export const SKIRT = 5;
/** inclinação da câmera do jogo (render/IsoRig.ts) */
const PITCH = 0.76;

export interface SurfaceCell {
  /** altura do bloco do topo */
  y: number;
  /** bloco do topo */
  id: BlockId;
}

/** cores do mapa (topo, lateral) por tipo de chão; minérios aparecem como a rocha em volta */
const PALETTE: Record<number, [string, string]> = {
  [REGOLITH]: ['#ded5c6', '#b3a796'],
  [ROCK]: ['#a69d94', '#8a8178'],
  [IRON]: ['#a69d94', '#8a8178'],
  [BASALT]: ['#7a7286', '#5f5869'],
  [CRYSTAL]: ['#7a7286', '#5f5869'],
  [ICE]: ['#cdeef7', '#9fd2e3'],
  [BEDROCK]: ['#4a4354', '#3a3443'],
  [HULL]: ['#f2f3f7', '#cfd3de'],
  [ANORTHOSITE]: ['#ece9e2', '#c9c5bd'],
  [BRECCIA]: ['#9c918c', '#82776f'],
  [NORITE]: ['#716d78', '#57535d'],
  [ILMENITE_ORE]: ['#716d78', '#57535d'],
  [GOLD_ORE]: ['#716d78', '#57535d'],
  [GLASSY_BASALT]: ['#4d475b', '#383344'],
  // Marte: minérios aparecem como a rocha em volta; a lava aparece forte para o mapa avisar
  [MARS_DUST]: ['#c4795a', '#9a5a42'],
  [MARS_ROCK]: ['#9a5e4a', '#7c4a3a'],
  [HEMATITE]: ['#9a5e4a', '#7c4a3a'],
  [GYPSUM]: ['#c9a07c', '#a8825f'],
  [SEDIMENT]: ['#c9a07c', '#a8825f'],
  [DARK_SAND]: ['#5e4a48', '#4a3a38'],
  [VOLCANIC]: ['#6a5652', '#53423f'],
  [OLIVINE]: ['#6a5652', '#53423f'],
  [LAVA]: ['#ff7a2a', '#d84a1a'],
};
const FALLBACK: [string, string] = ['#a69d94', '#8a8178'];
const paletteCache = new Map<number, [THREE.Color, THREE.Color]>();
function colorsOf(id: BlockId): [THREE.Color, THREE.Color] {
  let c = paletteCache.get(id);
  if (!c) {
    const [t, s] = PALETTE[id] ?? FALLBACK;
    c = [new THREE.Color(t), new THREE.Color(s)];
    paletteCache.set(id, c);
  }
  return c;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Geometria de um chunk do mapa: topo de cada coluna descoberta e as paredes até a coluna vizinha (ou a saia, na
 * borda do que foi descoberto). `aGrid` leva coordenadas em blocos para o shader desenhar o contorno de cada bloco.
 * Devolve null se nada do chunk foi descoberto.
 */
export function buildMapChunk(
  cx: number,
  cz: number,
  seen: (x: number, z: number) => boolean,
  surface: (x: number, z: number) => SurfaceCell,
  refY = 0,
): THREE.BufferGeometry | null {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], grid: number[] = [], index: number[] = [];
  const c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  /** quadrilátero com a frente para `normal` (a ordem dos cantos é corrigida se precisar) */
  const quad = (p: number[][], normal: number[], cols: THREE.Color[], g: number[][]): void => {
    a.set(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    b.set(p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]);
    n.crossVectors(a, b);
    const flip = n.x * normal[0] + n.y * normal[1] + n.z * normal[2] < 0;
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const i = flip ? 3 - k : k;
      pos.push(p[i][0], p[i][1], p[i][2]);
      nor.push(normal[0], normal[1], normal[2]);
      col.push(cols[i].r, cols[i].g, cols[i].b);
      grid.push(g[i][0], g[i][1]);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  let any = false;
  for (let lz = 0; lz < CS; lz++)
    for (let lx = 0; lx < CS; lx++) {
      const x = cx * CS + lx, z = cz * CS + lz;
      if (!seen(x, z)) continue;
      any = true;
      const s = surface(x, z);
      const [top, side] = colorsOf(s.id);
      // mais claro no alto, mais escuro no fundo; um xadrez bem leve para ler os blocos
      const tint = THREE.MathUtils.clamp(0.86 + (s.y - refY) * 0.014, 0.66, 1.14) * ((x + z) & 1 ? 0.965 : 1);
      const yt = s.y + 1;
      c.copy(top).multiplyScalar(tint);
      const tc = [c.clone(), c.clone(), c.clone(), c.clone()];
      quad([[x, yt, z], [x, yt, z + 1], [x + 1, yt, z + 1], [x + 1, yt, z]], [0, 1, 0], tc, [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]]);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        const open = seen(nx, nz);
        const yb = open ? surface(nx, nz).y + 1 : yt - SKIRT;
        if (yb >= yt) continue;
        const upper = side.clone().multiplyScalar(tint * (dx !== 0 ? 0.92 : 1));
        // a saia escurece para baixo e some no fundo; uma parede de verdade só escurece um pouco
        const lower = upper.clone().multiplyScalar(open ? 0.82 : 0.12);
        // a face fica no lado do vizinho
        const fx = dx > 0 ? x + 1 : x, fz = dz > 0 ? z + 1 : z;
        const p =
          dx !== 0
            ? [[fx, yb, z], [fx, yb, z + 1], [fx, yt, z + 1], [fx, yt, z]]
            : [[x, yb, fz], [x + 1, yb, fz], [x + 1, yt, fz], [x, yt, fz]];
        quad(p, [dx, 0, dz], [lower, lower, upper, upper], [[0, yb], [1, yb], [1, yt], [0, yt]]);
      }
    }
  if (!any) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/** material dos blocos do mapa: cor por vértice, luz e sombra, e o contorno de cada bloco */
function blockMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aGrid;\nvarying vec2 vGrid;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrid = aGrid;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // contorno de cada bloco: largura fixa na tela; some devagar quando o bloco fica pequeno (longe, ou parede
        // vista de raspão), em vez de virar ruído e piscar
        vec2 gf = abs(fract(vGrid) - 0.5);
        float ge = 0.5 - max(gf.x, gf.y);
        float gw = clamp((fwidth(vGrid.x) + fwidth(vGrid.y)) * 0.75, 0.018, 0.5);
        float edge = 1.0 - smoothstep(0.0, gw, ge);
        float keep = 1.0 - smoothstep(0.2, 0.42, gw);
        diffuseColor.rgb *= 1.0 - 0.26 * edge * keep;`,
      );
    sh.fragmentShader = litOnlyShadows(sh.fragmentShader);
  };
  return m;
}

export type MarkerKind = 'player' | 'lander' | 'base' | 'goal' | 'loot' | 'meteorite' | 'crystal' | 'gold' | 'ilmenite';

export interface MapMarker {
  kind: MarkerKind;
  x: number;
  z: number;
}

/** cor de cada marcador (também usada na legenda do HTML) */
export const MARKER_COLOR: Record<MarkerKind, string> = {
  player: '#ff7a2f',
  lander: '#ffd27a',
  base: '#f4f0e8',
  goal: '#7fe7ff',
  loot: '#ff9a4a',
  meteorite: '#ffb070',
  crystal: '#8ff1ff',
  gold: '#ffd34a',
  ilmenite: '#c9c3d9',
};

/** marcadores com pino alto e nome (os minérios são só um cubinho) */
export const MARKER_PINNED: ReadonlySet<MarkerKind> = new Set<MarkerKind>(['player', 'lander', 'base', 'goal', 'loot', 'meteorite']);
const PIN_HEIGHT = 4.5;

export class BlockMap {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 900);
  readonly target: THREE.WebGLRenderTarget;
  /** centro da vista (x, z), giro (como IsoRig.yaw) e distância da câmera */
  readonly view = new THREE.Vector2();
  yaw = Math.PI / 4;
  yawTarget = Math.PI / 4;
  distance = 60;
  readonly minDistance = 18;
  readonly maxDistance = 170;
  private viewY = 0;
  private readonly world = new THREE.Group();
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly surfaces = new Map<string, { y: Int16Array; id: Uint8Array }>();
  private readonly material = blockMaterial();
  private readonly sun: THREE.DirectionalLight;
  private readonly markerGroup = new THREE.Group();
  private readonly grid: THREE.Mesh;
  private readonly player: THREE.Group;
  private readonly ring: THREE.Mesh;
  private markers: MapMarker[] = [];
  private readonly v = new THREE.Vector3();
  /**
   * A sombra do mapa só muda quando os blocos ou o sol mudam (marcadores e seta não fazem sombra). Ela é refeita só
   * nesses casos, e não a cada quadro: com o mapa parado, poupa um desenho de 2048×2048 por quadro.
   */
  private shadowKey = '';

  constructor(
    private readonly surfaceAt: (x: number, z: number) => SurfaceCell,
    private readonly seen: (x: number, z: number) => boolean,
    private readonly refY: number,
  ) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    const bg = new THREE.Color('#0a0b1a');
    this.scene.background = bg;
    // o que está longe some no escuro, como no jogo
    this.scene.fog = new THREE.Fog(bg, 80, 220);
    this.scene.add(new THREE.HemisphereLight('#c3bdf2', '#4a3e3a', 1.5));
    this.sun = new THREE.DirectionalLight('#fff0dc', 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.needsUpdate = true;
    this.scene.add(this.sun, this.sun.target);
    this.grid = groundGrid(refY - SKIRT - 1);
    this.scene.add(this.world, this.markerGroup, this.grid);

    // você: seta laranja flutuando sobre o chão, com um anel que pulsa
    this.player = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9);
    shape.lineTo(0.62, -0.62);
    shape.lineTo(0, -0.3);
    shape.lineTo(-0.62, -0.62);
    shape.closePath();
    const arrowGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    arrowGeo.rotateX(Math.PI / 2);
    arrowGeo.rotateY(Math.PI);
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.95, 0.35) }));
    arrow.position.y = 1.4;
    arrow.name = 'arrow';
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35) }),
    );
    beam.position.y = 0.65;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.player.add(arrow, beam, this.ring);
    this.scene.add(this.player);
  }

  /** Tamanho da textura: o da tela, em pixels reais (o mapa fica nítido). */
  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(4, Math.round(w)), Math.max(4, Math.round(h)));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- superfície e chunks ----------

  private surfaceChunk(cx: number, cz: number): { y: Int16Array; id: Uint8Array } {
    const k = cx + ',' + cz;
    let s = this.surfaces.get(k);
    if (!s) {
      s = { y: new Int16Array(CS * CS), id: new Uint8Array(CS * CS) };
      for (let lz = 0; lz < CS; lz++)
        for (let lx = 0; lx < CS; lx++) {
          const c = this.surfaceAt(cx * CS + lx, cz * CS + lz);
          s.y[lz * CS + lx] = c.y;
          s.id[lz * CS + lx] = c.id;
        }
      this.surfaces.set(k, s);
    }
    return s;
  }

  /** superfície (com cache por chunk) */
  surface(x: number, z: number): SurfaceCell {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const s = this.surfaceChunk(cx, cz);
    const i = (z - cz * CS) * CS + (x - cx * CS);
    return { y: s.y[i], id: s.id[i] };
  }

  /** altura do chão do mapa num ponto qualquer (para pinos e para a câmera) */
  groundAt(x: number, z: number): number {
    return this.surface(Math.floor(x), Math.floor(z)).y + 1;
  }

  /** Um bloco do mundo mudou: a superfície daquele chunk é lida de novo e o chunk refeito. */
  blockChanged(x: number, z: number): void {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    this.surfaces.delete(cx + ',' + cz);
    this.invalidate([cx + ',' + cz]);
  }

  /** Chunks a refazer (descobertos ou mudados), mais os vizinhos (a borda entre eles muda). */
  invalidate(keys: string[]): void {
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number);
      for (const [dx, dz] of [[0, 0], ...DIRS]) {
        const kk = cx + dx + ',' + (cz + dz);
        const m = this.chunkMeshes.get(kk);
        if (m) {
          this.world.remove(m);
          m.geometry.dispose();
          this.chunkMeshes.delete(kk);
          this.sun.shadow.needsUpdate = true;
        }
      }
    }
  }

  /**
   * Monta os chunks descobertos perto da vista que ainda não têm malha, do mais perto para o mais longe, parando
   * quando passa de `ms` milissegundos (o jogo não trava). Devolve quantos ainda faltam.
   */
  sync(chunks: [number, number][], ms = Infinity): number {
    const vcx = this.view.x / CS, vcz = this.view.y / CS;
    const reach = Math.ceil((this.distance * 1.8) / CS) + 3;
    const todo = chunks
      .filter(([cx, cz]) => !this.chunkMeshes.has(cx + ',' + cz) && Math.abs(cx + 0.5 - vcx) <= reach && Math.abs(cz + 0.5 - vcz) <= reach)
      .sort((p, q) => Math.hypot(p[0] + 0.5 - vcx, p[1] + 0.5 - vcz) - Math.hypot(q[0] + 0.5 - vcx, q[1] + 0.5 - vcz));
    const t0 = performance.now();
    let built = 0;
    for (const [cx, cz] of todo) {
      if (built > 0 && performance.now() - t0 > ms) break;
      const geo = buildMapChunk(cx, cz, this.seen, (x, z) => this.surface(x, z), this.refY);
      built++;
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chunkMeshes.set(cx + ',' + cz, mesh);
      this.world.add(mesh);
      this.sun.shadow.needsUpdate = true;
    }
    return todo.length - built;
  }

  /**
   * Com o mapa fechado: calcula a superfície dos chunks recém-descobertos aos pouquinhos, para a abertura do mapa
   * não ter de ler o mundo todo de uma vez. Devolve quantos ainda faltam.
   */
  prepare(keys: string[], ms: number): number {
    const t0 = performance.now();
    let i = 0;
    for (; i < keys.length; i++) {
      if (i > 0 && performance.now() - t0 > ms) break;
      const [cx, cz] = keys[i].split(',').map(Number);
      this.surfaceChunk(cx, cz);
    }
    return keys.length - i;
  }

  // ---------- marcadores ----------

  setMarkers(list: MapMarker[]): void {
    this.markers = list;
    for (const c of [...this.markerGroup.children]) this.markerGroup.remove(c);
    for (const m of list) this.markerGroup.add(this.markerMesh(m));
  }

  private markerMesh(m: MapMarker): THREE.Object3D {
    const color = new THREE.Color(MARKER_COLOR[m.kind]);
    const ground = this.groundAt(m.x, m.z);
    const g = new THREE.Group();
    g.position.set(m.x, ground, m.z);
    if (MARKER_PINNED.has(m.kind)) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, PIN_HEIGHT, 6), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.9) }));
      stick.position.y = PIN_HEIGHT / 2;
      const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8) }));
      head.position.y = PIN_HEIGHT + 0.2;
      const foot = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 20), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      foot.rotation.x = -Math.PI / 2;
      foot.position.y = 0.04;
      g.add(stick, head, foot);
    } else {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6) }));
      cube.position.y = 0.45;
      cube.rotation.y = Math.PI / 4;
      g.add(cube);
    }
    return g;
  }

  /** onde fica o topo do pino de um marcador (para pôr o nome em cima) */
  markerTop(m: MapMarker, out: THREE.Vector3): THREE.Vector3 {
    return out.set(m.x, this.groundAt(m.x, m.z) + (MARKER_PINNED.has(m.kind) ? PIN_HEIGHT + 0.7 : 1), m.z);
  }

  get markerList(): readonly MapMarker[] {
    return this.markers;
  }

  setPlayer(x: number, y: number, z: number, facing: number, time: number): void {
    this.player.position.set(x, y, z);
    this.player.getObjectByName('arrow')!.rotation.y = facing;
    const k = (time * 0.9) % 1;
    this.ring.scale.setScalar(0.7 + k * 1.8);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
  }

  // ---------- câmera e desenho ----------

  /** Ponto do mundo → posição na tela do mapa (0..1, y para baixo). null = atrás da câmera. */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = this.v.copy(p).project(this.camera);
    if (v.z > 1) return null;
    return { x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5 };
  }

  /** direita e frente da câmera no chão (para arrastar o mapa) */
  axes(): { right: THREE.Vector2; forward: THREE.Vector2 } {
    return {
      right: new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw)),
      forward: new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw)),
    };
  }

  /** blocos por pixel da tela no centro da vista */
  blocksPerPixel(screenHeight: number): number {
    return (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / screenHeight;
  }

  /** inclinação da câmera (a mesma do jogo) */
  get pitch(): number {
    return PITCH;
  }

  render(renderer: THREE.WebGLRenderer, dt: number, fov: number): void {
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-9 * dt));
    const want = this.groundAt(this.view.x, this.view.y);
    this.viewY += (want - this.viewY) * (Math.abs(want - this.viewY) > 30 ? 1 : 1 - Math.exp(-6 * dt));
    const d = this.distance, c = Math.cos(PITCH);
    const cam = this.camera;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.set(this.view.x + Math.sin(this.yaw) * c * d, this.viewY + Math.sin(PITCH) * d, this.view.y + Math.cos(this.yaw) * c * d);
    cam.lookAt(this.view.x, this.viewY, this.view.y);
    // profundidade: do mais perto que cabe ao fim da névoa (24 bits ficam bem repartidos, sem blocos brigando)
    const near = Math.max(2, d * 0.35), far = d * 4.5;
    if (Math.abs(cam.near - near) > 0.01 || Math.abs(cam.far - far) > 0.01) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 1.25;
    fog.far = d * 2.8;
    // sol com sombra seguindo a vista, do mesmo lado que no jogo
    const ext = Math.max(24, d * 1.1);
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 1;
      sc.far = ext * 4;
      sc.updateProjectionMatrix();
    }
    // a câmera da sombra anda em passos de um texel: sem isso as bordas das sombras escorregam e piscam ao mover
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(this.view.x / texel) * texel, sz = Math.round(this.view.y / texel) * texel, sy = Math.round(this.viewY / texel) * texel;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx - ext * 0.6, sy + ext * 1.6, sz + ext * 0.4);
    const key = `${sx},${sy},${sz},${ext}`;
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      this.sun.shadow.needsUpdate = true;
    }
    // a grade do chão acompanha a vista (de 8 em 8 blocos, para não escorregar)
    this.grid.position.x = Math.round(this.view.x / 8) * 8;
    this.grid.position.z = Math.round(this.view.y / 8) * 8;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prev);
  }
}

/** chão escuro com grade, embaixo de tudo: o que ainda não foi descoberto */
function groundGrid(y: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0e1024';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(127,140,220,0.28)';
  x.lineWidth = 2;
  x.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1200 / 8, 1200 / 8);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  // fundo puro: desenhado primeiro e sem teste de profundidade, então nunca cobre o terreno (antes, o plano ficava
  // acima do fundo das crateras e escondia o chão delas, cortando as paredes numa borda irregular)
  const mat = new THREE.MeshBasicMaterial({ map: t, depthTest: false, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}
