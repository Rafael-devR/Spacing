// Desenho da estufa (docs/design/ESTUFA.md): cada peça tem três aparências, escolhidas pelo estado da obra.
// holograma = ainda falta entregar (contorno ciano); baixa qualidade = entregue, aparência crua; alta qualidade = finalizada.
// Tudo é geometria simples, sem arquivo do Blender. Coordenadas locais: x e z de 0 a 7, y = 0 é a base da célula do piso.
import * as THREE from 'three';
import { GH, PART_IDS, type PartId } from '../data/greenhouse';

const N = GH.size;
const WALL_TOP = 1 + GH.wallHeight;
/** a cúpula sai do topo das paredes e sobe tanto */
const DOME = 3;

interface Look {
  holo: THREE.Group;
  low: THREE.Group;
  high: THREE.Group;
}

interface Mats {
  holoFill: THREE.MeshBasicMaterial;
  holoLine: THREE.LineBasicMaterial;
  ground: THREE.MeshLambertMaterial;
  raw: THREE.MeshLambertMaterial;
  rawDark: THREE.MeshLambertMaterial;
  rawGlass: THREE.MeshLambertMaterial;
  metal: THREE.MeshLambertMaterial;
  trim: THREE.MeshLambertMaterial;
  glass: THREE.MeshPhongMaterial;
  list: THREE.Material[];
}

function materials(ground: string): Mats {
  const holoFill = new THREE.MeshBasicMaterial({ color: '#4fd1e8', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
  const holoLine = new THREE.LineBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.9 });
  const m: Mats = {
    holoFill, holoLine,
    ground: new THREE.MeshLambertMaterial({ color: ground }),
    raw: new THREE.MeshLambertMaterial({ color: '#8f8576', flatShading: true }),
    rawDark: new THREE.MeshLambertMaterial({ color: '#5c554b', flatShading: true }),
    rawGlass: new THREE.MeshLambertMaterial({ color: '#cdd3d0', transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
    metal: new THREE.MeshLambertMaterial({ color: '#e2e6ee', flatShading: true }),
    trim: new THREE.MeshLambertMaterial({ color: '#3f9bb8', emissive: '#0e4a5e', flatShading: true }),
    glass: new THREE.MeshPhongMaterial({ color: '#9fe4f2', specular: '#ffffff', shininess: 90, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }),
    list: [],
  };
  m.list = [holoFill, holoLine, m.ground, m.raw, m.rawDark, m.rawGlass, m.metal, m.trim, m.glass];
  return m;
}

/** caixa pelo canto mínimo */
function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x + w / 2, y + h / 2, z + d / 2);
  return m;
}

/** arco meio-elíptico no plano XY (a estrutura da cúpula) */
function arch(z: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI - (i / 14) * Math.PI;
    pts.push(new THREE.Vector3(N / 2 + Math.cos(a) * (N / 2), WALL_TOP + Math.sin(a) * DOME, z));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 5), mat);
  return m;
}

/** a cúpula de vidro: um meio cilindro deitado, com as duas tampas */
function vault(mat: THREE.Material): THREE.Mesh[] {
  const side = new THREE.CylinderGeometry(1, 1, N, 28, 1, true, Math.PI / 2, Math.PI);
  side.rotateX(Math.PI / 2);
  side.scale(N / 2, DOME, 1);
  side.translate(N / 2, WALL_TOP, N / 2);
  const out: THREE.Mesh[] = [new THREE.Mesh(side, mat)];
  for (const z of [0.02, N - 0.02]) {
    const cap = new THREE.CircleGeometry(1, 28, 0, Math.PI);
    cap.scale(N / 2, DOME, 1);
    cap.translate(N / 2, WALL_TOP, z);
    out.push(new THREE.Mesh(cap, mat));
  }
  return out;
}

const group = (...objs: THREE.Object3D[]): THREE.Group => {
  const g = new THREE.Group();
  g.add(...objs);
  return g;
};

/** holograma de uma lista de malhas: o mesmo formato, preenchimento ciano e contorno */
function holoOf(meshes: THREE.Mesh[], m: Mats, edge = 25): THREE.Group {
  const g = new THREE.Group();
  for (const src of meshes) {
    const fill = new THREE.Mesh(src.geometry, m.holoFill);
    fill.position.copy(src.position);
    fill.rotation.copy(src.rotation);
    fill.scale.copy(src.scale);
    fill.renderOrder = 5;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(src.geometry, edge), m.holoLine);
    lines.position.copy(src.position);
    lines.rotation.copy(src.rotation);
    lines.scale.copy(src.scale);
    lines.renderOrder = 6;
    g.add(fill, lines);
  }
  return g;
}

/** um lado de parede (com ou sem vão de porta) em baixa e em alta qualidade */
function wallLooks(m: Mats, x: number, z: number, along: 'x' | 'z', len: number, doorAt = -1): { raw: THREE.Mesh[]; high: THREE.Mesh[] } {
  const at = (a: number, b: number): [number, number] => (along === 'x' ? [x + a, z + b] : [x + b, z + a]);
  const seg = (a0: number, a1: number, y0: number, y1: number, mat: THREE.Material, thick = 1, off = 0): THREE.Mesh => {
    const [px, pz] = at(a0, off);
    return along === 'x' ? box(a1 - a0, y1 - y0, thick, px, y0, pz, mat) : box(thick, y1 - y0, a1 - a0, px, y0, pz, mat);
  };
  // trechos corridos: com porta, dois trechos e o vergalhão acima do vão
  const runs: [number, number][] = doorAt < 0 ? [[0, len]] : [[0, doorAt], [doorAt + 1, len]];
  const raw: THREE.Mesh[] = [];
  const high: THREE.Mesh[] = [];
  for (const [a, b] of runs) {
    raw.push(seg(a, b, 1, WALL_TOP, m.raw));
    raw.push(seg(a, b, 1, 1.18, m.rawDark, 1.06, -0.03));
    high.push(seg(a, b, 1, 2, m.metal));
    high.push(seg(a, b, 1.9, 2.06, m.trim, 1.04, -0.02));
    high.push(seg(a, b, 2, WALL_TOP, m.glass, 0.5, 0.25));
    for (let p = a; p <= b + 0.01; p += Math.max(1, (b - a) / Math.max(1, Math.round((b - a) / 1.75)))) high.push(seg(Math.min(p, b) - 0.04, Math.min(p, b) + 0.04, 2, WALL_TOP, m.metal, 0.12, 0.44));
  }
  if (doorAt >= 0) {
    raw.push(seg(doorAt, doorAt + 1, 3, WALL_TOP, m.raw));
    high.push(seg(doorAt, doorAt + 1, 3, WALL_TOP, m.metal));
    high.push(seg(doorAt, doorAt + 1, 2.9, 3.0, m.trim, 1.04, -0.02));
  }
  return { raw, high };
}

export class GreenhouseModel {
  readonly group = new THREE.Group();
  /** a obra feita: nome da peça → aparências */
  private readonly looks = new Map<PartId, Look>();
  private readonly m: Mats;
  private readonly label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  private readonly labelTex: THREE.CanvasTexture;
  private readonly canvas = document.createElement('canvas');
  private slab: THREE.Mesh | null = null;
  /** 0..1: pulso de luz ao finalizar */
  private flash = 0;
  private ghost = false;
  private done = false;

  /** `ghost`: só o holograma, para mostrar onde a estufa assentaria (verde cabe, vermelho não) */
  constructor(ground: string, ghost = false) {
    this.ghost = ghost;
    const m = (this.m = materials(ground));
    const raw: Record<PartId, THREE.Mesh[]> = { floor: [], wallS: [], wallW: [], wallE: [], wallN: [], frame: [], glass: [] };
    const high: Record<PartId, THREE.Mesh[]> = { floor: [], wallS: [], wallW: [], wallE: [], wallN: [], frame: [], glass: [] };
    // piso: a placa por cima do chão nivelado
    raw.floor.push(box(N, 0.07, N, 0, 0.93, 0, m.raw));
    high.floor.push(box(N, 0.07, N, 0, 0.93, 0, m.metal), box(N - 0.5, 0.075, 0.08, 0.25, 0.93, N / 2 - 0.04, m.trim), box(0.08, 0.075, N - 0.5, N / 2 - 0.04, 0.93, 0.25, m.trim));
    // paredes (a sul tem o vão da porta; as da direita e da esquerda ficam entre as de norte e sul)
    const S = wallLooks(m, 0, N - 1, 'x', N, GH.doorAt);
    const Nn = wallLooks(m, 0, 0, 'x', N);
    const W = wallLooks(m, 0, 1, 'z', N - 2);
    const E = wallLooks(m, N - 1, 1, 'z', N - 2);
    raw.wallS = S.raw; high.wallS = S.high;
    raw.wallN = Nn.raw; high.wallN = Nn.high;
    raw.wallW = W.raw; high.wallW = W.high;
    raw.wallE = E.raw; high.wallE = E.high;
    // estrutura da cúpula
    for (const z of [0.2, 1.85, 3.5, 5.15, 6.8]) {
      raw.frame.push(arch(z, 0.13, m.rawDark));
      high.frame.push(arch(z, 0.085, m.metal));
    }
    raw.frame.push(box(0.16, 0.16, N, N / 2 - 0.08, WALL_TOP + DOME - 0.08, 0, m.rawDark));
    high.frame.push(box(0.12, 0.12, N, N / 2 - 0.06, WALL_TOP + DOME - 0.06, 0, m.trim));
    // vidro
    raw.glass.push(...vault(m.rawGlass));
    high.glass.push(...vault(m.glass));

    for (const id of PART_IDS) {
      const holo = holoOf(raw[id], m, id === 'glass' ? 40 : 25);
      this.looks.set(id, { holo, low: group(...raw[id]), high: group(...high[id]) });
      this.group.add(holo, this.looks.get(id)!.low, this.looks.get(id)!.high);
    }
    // o chão nivelado, sempre lá (o piso é a placa por cima dele)
    this.slab = box(N, 0.93, N, 0, 0, 0, m.ground);
    if (!ghost) this.group.add(this.slab);

    // etiqueta com o que falta
    this.canvas.width = 480;
    this.canvas.height = 210;
    this.labelTex = new THREE.CanvasTexture(this.canvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    (this.label.material as THREE.SpriteMaterial).map = this.labelTex;
    this.label.scale.set(8.4, 3.67, 1);
    // ao lado da cúpula (leste), baixo, para ficar dentro da tela
    this.label.position.set(N + 3.6, 3, N / 2 + 1);
    this.label.renderOrder = 30;
    this.label.visible = false;
    if (!ghost) this.group.add(this.label);
    this.setState([], false);
  }

  /** Coloca a obra no mundo: o canto mínimo e a altura do piso. */
  moveTo(x: number, floorY: number, z: number): void {
    this.group.position.set(x, floorY, z);
  }

  /** Cor do holograma de fantasma: verde cabe, vermelho não. */
  setValid(ok: boolean): void {
    this.m.holoFill.color.set(ok ? '#5bd66f' : '#ff6a55');
    this.m.holoLine.color.set(ok ? '#9dffb0' : '#ffb0a3');
  }

  /** Mostra cada peça na aparência do estado: entregue (baixa) ou finalizada (alta) ou holograma. */
  setState(parts: PartId[], done: boolean): void {
    const was = this.done;
    this.done = done;
    for (const id of PART_IDS) {
      const l = this.looks.get(id) as Look;
      const has = parts.includes(id) && !this.ghost;
      l.holo.visible = !has;
      l.low.visible = has && !done;
      l.high.visible = has && done;
    }
    if (done && !was && !this.ghost) this.flash = 1;
  }

  /**
   * Escreve a etiqueta, grande para ler no celular: o título, uma bolinha por peça (cheia = entregue), a próxima peça com o
   * material que ela pede e, embaixo, o que falta ou a dica.
   */
  setLabel(title: string, pips: boolean[], next: { name: string; cost: string } | null, foot = ''): void {
    const c = this.canvas.getContext('2d');
    if (!c) return;
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,24,32,0.86)';
    c.strokeStyle = 'rgba(111,231,255,0.95)';
    c.lineWidth = 4;
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 18);
    c.fill();
    c.stroke();
    /** escreve o texto cabendo na largura (diminui a letra se for preciso) */
    const put = (text: string, weight: number, size: number, color: string, y: number): void => {
      let px = size;
      c.font = `${weight} ${px}px system-ui, sans-serif`;
      while (c.measureText(text).width > W - 44 && px > 14) c.font = `${weight} ${--px}px system-ui, sans-serif`;
      c.fillStyle = color;
      c.fillText(text, 22, y);
    };
    put(title, 700, 34, '#9ff0ff', 48);
    pips.forEach((on, i) => {
      c.beginPath();
      c.arc(W - 30 - (pips.length - 1 - i) * 26, 36, 9, 0, Math.PI * 2);
      c.fillStyle = on ? '#7fe08a' : 'rgba(127,163,173,0.35)';
      c.fill();
    });
    if (next) {
      put(next.name, 600, 30, '#ffffff', 96);
      put(next.cost, 500, 26, '#bfeaf2', 134);
    }
    if (foot) {
      put(foot, 600, 25, '#ffd37a', H - 24);
    }
    this.labelTex.needsUpdate = true;
  }

  showLabel(on: boolean): void {
    this.label.visible = on && !this.ghost;
  }

  /** Brilho ao finalizar. */
  get flashing(): boolean {
    return this.flash > 0;
  }

  update(dt: number, time: number): void {
    this.m.holoFill.opacity = 0.11 + 0.06 * Math.sin(time * 2.2);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 1.4);
      this.m.trim.emissive.setRGB(0.05 + this.flash * 0.6, 0.29 + this.flash * 0.7, 0.37 + this.flash * 0.7);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      g?.dispose();
    });
    for (const mt of this.m.list) mt.dispose();
    this.labelTex.dispose();
    (this.label.material as THREE.Material).dispose();
  }
}
