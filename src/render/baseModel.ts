// Modelo 3D de um módulo da base, montado a partir do mesmo layout que gera a colisão (world/baseLayout.ts).
// Low poly como o módulo de pouso: casco branco, faixa laranja, luzes azul-gelo.
// Corte (cutaway): com o astronauta dentro, o telhado some e as paredes viradas para a câmera abaixam,
// mostrando o interior. Dentro, a câmera só vê a camada do interior (render/indoors.ts): as partes de fora
// (pernas, degrau, círculo da porta, telhado) ficam só na camada do mundo.
import * as THREE from 'three';
import type { FurnitureKind, Side } from '../data/base';
import type { ModuleLayout } from '../world/baseLayout';
import { Fabricator } from './Fabricator';
import { createStationModel, type StationModel } from './stationModels';
import type { StationId } from '../data/stations';
import { exteriorOnly, showIndoors } from './indoors';

const lam = (hex: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });
const glow = (r: number, g: number, b: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

const NORMAL: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

interface WallPart {
  side: Side;
  /** fileiras de cima: abaixam no corte */
  upper: THREE.Group;
  /** 0 = de pé, 1 = abaixada */
  lowered: number;
}

export interface FurnitureModel {
  id: string;
  kind: FurnitureKind;
  group: THREE.Group;
}

export class BaseModel {
  readonly group = new THREE.Group();
  readonly interior = new THREE.Group();
  fabricator: Fabricator | null = null;
  /** forno, eletrolisador (a bancada é o `fabricator`) */
  readonly stations = new Map<StationId, StationModel>();
  readonly furniture: FurnitureModel[] = [];
  private readonly roof = new THREE.Group();
  private readonly roofMats: THREE.Material[] = [];
  private readonly walls: WallPart[] = [];
  private readonly doorL: THREE.Mesh;
  private readonly doorR: THREE.Mesh;
  private readonly doorAxis: 'x' | 'z';
  private readonly doorFrame: THREE.Group;
  private readonly doorLamps: THREE.MeshBasicMaterial;
  private readonly padMat: THREE.MeshBasicMaterial;
  private readonly antennaLamp: THREE.Mesh;
  private readonly light: THREE.PointLight;
  private readonly stripMat: THREE.MeshBasicMaterial;
  /** 0 = porta fechada, 1 = aberta */
  door = 0;
  doorTarget = 0;
  /** 0 = visto de fora, 1 = corte completo (dentro) */
  inside = 0;
  insideTarget = 0;
  /** luz da porta: verde quando a câmara está pressurizada e liberada */
  doorGreen = false;
  /** realce do círculo de entrada (jogador perto) */
  padHighlight = 0;
  private readonly sx: number;
  private readonly sz: number;

  constructor(
    readonly layout: ModuleLayout,
    groundAt: (x: number, z: number) => number,
  ) {
    const { def, floorY } = layout;
    const box = layout.structure.box;
    const g = this.group;
    g.position.set(box.x0, floorY, box.z0);
    const SX = (this.sx = def.size.x), SZ = (this.sz = def.size.z), H = def.interiorHeight;

    const hull = lam('#e4e6ec');
    const hullDark = lam('#c3c7d2');
    const metal = lam('#8c90a0');
    const dark = lam('#4b4f60');
    const orange = lam('#ff7a2f');
    this.stripMat = glow(0.55, 1.9, 2.3);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const boxAt = (parent: THREE.Object3D, mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, shadow = true): THREE.Mesh =>
      add(parent, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, shadow);

    // ---- base, pernas e piso ----
    boxAt(g, metal, 0, 0, 0, SX, 1, SZ);
    boxAt(g, orange, -0.03, 0.78, -0.03, SX + 0.03, 0.92, SZ + 0.03, false);
    for (const [lx, lz] of [[0.5, 0.5], [SX - 0.5, 0.5], [0.5, SZ - 0.5], [SX - 0.5, SZ - 0.5], [SX / 2, 0.5], [SX / 2, SZ - 0.5]]) {
      const ground = groundAt(box.x0 + lx, box.z0 + lz) - floorY;
      if (ground < -0.05) {
        exteriorOnly(add(g, new THREE.CylinderGeometry(0.16, 0.2, -ground, 6), dark, lx, ground / 2, lz));
        exteriorOnly(add(g, new THREE.CylinderGeometry(0.34, 0.38, 0.1, 8), dark, lx, ground + 0.05, lz));
      }
    }

    // ---- paredes: fileira de baixo sempre de pé; as de cima abaixam no corte ----
    const door = layout.door;
    const dl = { x: door.x - box.x0, z: door.z - box.z0 };
    const sides: Side[] = ['north', 'south', 'west', 'east'];
    for (const side of sides) {
      const lower = new THREE.Group();
      const upper = new THREE.Group();
      upper.position.y = 2; // pivô na base das fileiras de cima
      g.add(lower, upper);
      // retângulo da parede no plano xz
      const along: 'x' | 'z' = side === 'north' || side === 'south' ? 'x' : 'z';
      const [a0, a1] = along === 'x' ? [0, SX] : [1, SZ - 1];
      const c0 = side === 'north' ? 0 : side === 'south' ? SZ - 1 : side === 'west' ? 0 : SX - 1;
      const seg = (parent: THREE.Object3D, mat: THREE.Material, s0: number, s1: number, y0: number, y1: number, inset = 0): void => {
        if (s1 - s0 <= 0.001) return;
        if (along === 'x') boxAt(parent, mat, s0, y0, c0 + inset, s1, y1, c0 + 1 - inset);
        else boxAt(parent, mat, c0 + inset, y0, s0, c0 + 1 - inset, y1, s1);
      };
      const hasDoor = door.side === side;
      const dAt = along === 'x' ? dl.x : dl.z;
      // fileira de baixo (y 1..2) e de cima (2..H+1, em coordenadas do grupo "upper": 0..H-1)
      if (hasDoor) {
        seg(lower, hull, a0, dAt, 1, 2);
        seg(lower, hull, dAt + 1, a1, 1, 2);
        seg(upper, hull, a0, dAt, 0, 1);
        seg(upper, hull, dAt + 1, a1, 0, 1);
        seg(upper, hull, a0, a1, 1, H - 1);
      } else {
        seg(lower, hull, a0, a1, 1, 2);
        seg(upper, hull, a0, a1, 0, H - 1);
      }
      // faixa laranja e nervuras por fora
      const [nx, nz] = NORMAL[side];
      const out = (v: number): number => (nx + nz > 0 ? c0 + 1 + v : c0 - v);
      const band = (parent: THREE.Object3D, s0: number, s1: number, y0: number, y1: number, mat: THREE.Material): void => {
        if (s1 - s0 <= 0.001) return;
        if (along === 'x') boxAt(parent, mat, s0, y0, Math.min(out(0), out(0.05)), s1, y1, Math.max(out(0), out(0.05)), false);
        else boxAt(parent, mat, Math.min(out(0), out(0.05)), y0, s0, Math.max(out(0), out(0.05)), y1, s1, false);
      };
      if (hasDoor) {
        band(lower, a0, dAt - 0.15, 1.62, 1.82, orange);
        band(lower, dAt + 1.15, a1, 1.62, 1.82, orange);
      } else band(lower, a0, a1, 1.62, 1.82, orange);
      for (let s = a0 + 1; s < a1; s += 2) {
        if (hasDoor && Math.abs(s - (dAt + 0.5)) < 1.2) continue;
        band(upper, s - 0.07, s + 0.07, 0, H - 1, hullDark);
      }
      // janelas (leste e oeste): faixa de luz que atravessa a parede, visível por dentro e por fora
      const windowed = side === 'east' || side === 'west';
      if (windowed) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.32, SZ - 4), this.stripMat);
        w.position.set(c0 + 0.5, 0.75, SZ / 2);
        upper.add(w);
      }
      // por dentro: luminária no alto, nervuras do casco e rodapé escuro (deixa claro que é uma sala fechada)
      const inn = (v: number): number => (nx + nz > 0 ? c0 - v : c0 + 1 + v);
      const lining = (parent: THREE.Object3D, s0: number, s1: number, y0: number, y1: number, mat: THREE.Material, depth: number): void => {
        if (s1 - s0 <= 0.001) return;
        const [p0, p1] = [Math.min(inn(0), inn(depth)), Math.max(inn(0), inn(depth))];
        if (along === 'x') boxAt(parent, mat, s0, y0, p0, s1, y1, p1, false);
        else boxAt(parent, mat, p0, y0, s0, p1, y1, s1, false);
      };
      const [i0, i1] = along === 'x' ? [1, SX - 1] : [1, SZ - 1];
      lining(upper, i0 + 0.25, i1 - 0.25, H - 1.24, H - 1.12, dark, 0.1);
      lining(upper, i0 + 0.3, i1 - 0.3, H - 1.21, H - 1.15, this.stripMat, 0.12);
      lining(lower, i0, hasDoor ? dAt : i1, 1.06, 1.2, dark, 0.03);
      if (hasDoor) lining(lower, dAt + 1, i1, 1.06, 1.2, dark, 0.03);
      if (!windowed)
        for (let s = i0 + 1; s < i1; s += 2) {
          if (hasDoor && Math.abs(s - (dAt + 0.5)) < 1.2) continue;
          if (side === 'north' && s > SX - 3.7 && s < SX - 1.5) continue; // janela da Terra
          lining(upper, s - 0.06, s + 0.06, 0, H - 1.3, hullDark, 0.06);
          lining(lower, s - 0.06, s + 0.06, 1.2, 2, hullDark, 0.06);
        }
      this.walls.push({ side, upper, lowered: 0 });
    }

    // ---- porta: batente, duas folhas que correm para dentro da parede, luzes ----
    const [dnx, dnz] = NORMAL[door.side];
    this.doorAxis = door.side === 'north' || door.side === 'south' ? 'x' : 'z';
    const dcx = dl.x + 0.5, dcz = dl.z + 0.5;
    // pivô no piso: no corte, a porta encolhe junto com a parede
    const frame = (this.doorFrame = new THREE.Group());
    frame.position.set(dcx, 1, dcz);
    if (this.doorAxis === 'z') frame.rotation.y = Math.PI / 2;
    g.add(frame);
    boxAt(frame, dark, -0.62, 0, -0.56, -0.48, 2.12, 0.56);
    boxAt(frame, dark, 0.48, 0, -0.56, 0.62, 2.12, 0.56);
    boxAt(frame, dark, -0.62, 1.98, -0.56, 0.62, 2.14, 0.56);
    const leaf = new THREE.BoxGeometry(0.5, 1.98, 0.22);
    this.doorL = add(frame, leaf, hullDark, -0.25, 1, 0);
    this.doorR = add(frame, leaf, hullDark, 0.25, 1, 0);
    for (const l of [this.doorL, this.doorR]) add(l, new THREE.BoxGeometry(0.06, 1.2, 0.24), orange, l === this.doorL ? 0.2 : -0.2, 0, 0, false);
    this.doorLamps = glow(2.2, 0.25, 0.15);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.08, 0.06);
    add(frame, lampGeo, this.doorLamps, 0, 2.24, 0.5, false);
    add(frame, lampGeo, this.doorLamps, 0, 2.24, -0.5, false);
    // degrau e círculo de entrada do lado de fora
    const stepW = exteriorOnly(new THREE.Group());
    stepW.position.set(dcx + dnx * 1.0, 0, dcz + dnz * 1.0);
    stepW.rotation.y = this.doorAxis === 'z' ? Math.PI / 2 : 0;
    g.add(stepW);
    boxAt(stepW, metal, -0.7, 0, -0.35, 0.7, 0.5, 0.35);
    boxAt(stepW, orange, -0.7, 0.5, 0.28, 0.7, 0.53, 0.35, false);
    this.padMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.8, 2.2), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28), this.padMat);
    pad.rotation.x = -Math.PI / 2;
    const ol = { x: layout.outside.x - box.x0, z: layout.outside.z - box.z0 };
    pad.position.set(ol.x, groundAt(layout.outside.x, layout.outside.z) - floorY + 0.03, ol.z);
    g.add(exteriorOnly(pad));
    // placa
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.42), new THREE.MeshBasicMaterial({ map: signTexture(def.name.toUpperCase()), transparent: true }));
    // placa na parede da porta, ao lado dela (fica nas fileiras de cima: abaixa junto no corte)
    const off = (v: number): number => (v > 0 ? 0.53 : v < 0 ? -0.53 : 0);
    sign.position.set(dcx + (this.doorAxis === 'x' ? 1.45 : 0) + dnx * 0.5 + off(dnx) * 0.06, 0.45, dcz + (this.doorAxis === 'z' ? 1.45 : 0) + dnz * 0.5 + off(dnz) * 0.06);
    sign.rotation.y = Math.atan2(dnx, dnz);
    this.walls.find((w) => w.side === door.side)?.upper.add(sign);

    // ---- telhado (some no corte) ----
    const roofMat = (m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial => {
      m.transparent = true;
      this.roofMats.push(m);
      return m;
    };
    const rHull = roofMat(lam('#e4e6ec')), rMetal = roofMat(lam('#8c90a0')), rPanel = roofMat(lam('#283157', { emissive: new THREE.Color('#121c48') }));
    g.add(exteriorOnly(this.roof));
    boxAt(this.roof, rHull, -0.05, H + 1, -0.05, SX + 0.05, H + 1.55, SZ + 0.05);
    const ridge = add(this.roof, new THREE.CylinderGeometry(1.1, 1.1, SX - 2.4, 8, 1, false, 0, Math.PI), rHull, SX / 2, H + 1.55, SZ / 2);
    ridge.rotation.z = Math.PI / 2;
    ridge.scale.set(1, 1, 0.55);
    for (const px of [1.6, SX - 1.6]) {
      const p = add(this.roof, new THREE.BoxGeometry(1.6, 0.06, 2.2), rPanel, px, H + 2.0, SZ / 2 - 0.2);
      p.rotation.x = -0.35;
      add(this.roof, new THREE.CylinderGeometry(0.05, 0.05, 0.45, 5), rMetal, px, H + 1.75, SZ / 2 - 0.2);
    }
    add(this.roof, new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), rMetal, SX - 1.2, H + 2.35, 1.0);
    this.antennaLamp = add(this.roof, new THREE.OctahedronGeometry(0.1), glow(2.4, 0.3, 0.2), SX - 1.2, H + 3.2, 1.0, false);
    boxAt(this.roof, rMetal, 1.0, H + 1.55, SZ - 1.6, 2.0, H + 1.95, SZ - 0.9);

    // ---- interior ----
    g.add(this.interior);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SX - 2, SZ - 2), new THREE.MeshLambertMaterial({ map: floorTexture(SX - 2, SZ - 2, dl.x - 1, door.side) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(SX / 2, 1.005, SZ / 2);
    floor.receiveShadow = true;
    this.interior.add(floor);
    // rodapé de luz nas paredes internas
    const skirt = (x0: number, z0: number, x1: number, z1: number): void => void boxAt(this.interior, this.stripMat, x0, 1.0, z0, x1, 1.06, z1, false);
    skirt(1, 1, SX - 1, 1.04);
    skirt(1, 1, 1.04, SZ - 1);
    skirt(SX - 1.04, 1, SX - 1, SZ - 1);
    // janela com a Terra (parede norte, por dentro)
    const north = this.walls.find((w) => w.side === 'north');
    if (north) {
      // canos da ventilação no alto da parede do fundo
      for (const [py, r] of [[H - 1.5, 0.07], [H - 1.68, 0.05]] as const) {
        const pipe = add(north.upper, new THREE.CylinderGeometry(r, r, SX - 2.4, 6), metal, SX / 2, py, 1.0 + 0.1 + r, false);
        pipe.rotation.z = Math.PI / 2;
      }
      for (const px of [1.6, SX / 2, SX - 1.6]) boxAt(north.upper, dark, px - 0.06, H - 1.78, 1.0, px + 0.06, H - 1.4, 1.26, false);
      const earth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.95), new THREE.MeshBasicMaterial({ map: earthTexture(), toneMapped: false }));
      earth.position.set(SX - 2.6, 0.55, 1.002);
      north.upper.add(earth);
    }
    this.light = new THREE.PointLight('#fff1dc', 0, 11, 1.6);
    this.light.position.set(SX / 2, H + 0.6, SZ / 2);
    // fora do grupo do interior: esconder a luz mudaria o número de luzes e recompilaria os shaders
    g.add(this.light);

    for (const f of layout.furniture) {
      const fg = new THREE.Group();
      fg.position.set(f.def.x + f.def.w / 2, 1, f.def.z + f.def.d / 2);
      fg.rotation.y = f.facing;
      this.interior.add(fg);
      const w = f.def.against === 'north' || f.def.against === 'south' ? f.def.w : f.def.d;
      const d = f.def.against === 'north' || f.def.against === 'south' ? f.def.d : f.def.w;
      if (f.def.kind === 'workbench') {
        this.fabricator = new Fabricator(fg, w, d);
      } else if (f.def.kind === 'furnace' || f.def.kind === 'electrolyzer') {
        const st = createStationModel(f.def.kind, fg);
        if (st) this.stations.set(f.def.kind, st);
      } else buildFurniture(f.def.kind, fg, w, d, { hull, hullDark, metal, dark, orange, strip: this.stripMat });
      this.furniture.push({ id: f.def.id, kind: f.def.kind, group: fg });
    }

    // dentro da base a câmera só vê esta camada (as partes de fora foram marcadas acima)
    showIndoors(g);
  }

  /** A cada quadro. `camera` = posição da câmera (para saber quais paredes estão na frente). */
  update(dt: number, t: number, camera: THREE.Vector3): void {
    const k = (rate: number): number => 1 - Math.exp(-rate * dt);
    this.door += (this.doorTarget - this.door) * k(9);
    this.inside += (this.insideTarget - this.inside) * k(5);
    const ins = this.inside;

    // porta corre para dentro da parede
    const o = this.door * 0.5;
    this.doorL.position.x = -0.25 - o;
    this.doorR.position.x = 0.25 + o;
    this.doorL.visible = this.doorR.visible = this.door < 0.97;
    const red = !this.doorGreen;
    const blink = red && this.door > 0.05 ? (Math.sin(t * 14) > 0 ? 1 : 0.2) : 1;
    this.doorLamps.color.setRGB(red ? 2.2 * blink : 0.4, red ? 0.25 * blink : 2.4, red ? 0.15 : 0.8);
    this.padMat.opacity = 0.35 + 0.25 * Math.sin(t * 3) * 0.5 + this.padHighlight * 0.5;
    this.antennaLamp.visible = Math.sin(t * 2.4) > 0.6;

    // corte: telhado some, paredes viradas para a câmera abaixam
    for (const m of this.roofMats) m.opacity = 1 - ins;
    this.roof.visible = ins < 0.98;
    const c = this.group.position;
    const vx = camera.x - (c.x + this.sx / 2), vz = camera.z - (c.z + this.sz / 2);
    const vl = Math.hypot(vx, vz) || 1;
    for (const w of this.walls) {
      const [nx, nz] = NORMAL[w.side];
      const front = (nx * vx + nz * vz) / vl > 0.2;
      const want = front ? this.insideTarget : 0;
      w.lowered += (want - w.lowered) * k(6);
      w.upper.scale.y = Math.max(0.001, 1 - w.lowered);
      w.upper.visible = w.lowered < 0.99;
      if (w.side === this.layout.door.side) this.doorFrame.scale.y = 1 - w.lowered * 0.5;
    }
    this.light.intensity = ins * 22;
    this.interior.visible = ins > 0.01 || this.door > 0.02;
    this.fabricator?.update(dt, t);
    for (const st of this.stations.values()) st.update(dt, t);
  }

  /** pula as transições (carregar salvo dentro da base) */
  snap(): void {
    this.inside = this.insideTarget;
    this.door = this.doorTarget;
    for (const w of this.walls) w.lowered = 0;
  }
}

interface Mats {
  hull: THREE.Material;
  hullDark: THREE.Material;
  metal: THREE.Material;
  dark: THREE.Material;
  orange: THREE.Material;
  strip: THREE.Material;
}

/** Móveis simples (a bancada é o Fabricator). Coordenadas locais: frente para +z, w ao longo de x. */
function buildFurniture(kind: FurnitureKind, g: THREE.Group, w: number, d: number, m: Mats): void {
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  if (kind === 'bed') {
    add(new THREE.BoxGeometry(w * 0.9, 0.36, d * 0.92), m.metal, 0, 0.18, 0);
    add(new THREE.BoxGeometry(w * 0.82, 0.16, d * 0.86), lam('#4c6fd6'), 0, 0.44, 0.02);
    add(new THREE.BoxGeometry(w * 0.6, 0.12, 0.34), m.hull, 0, 0.56, -d * 0.36);
    add(new THREE.BoxGeometry(w * 0.9, 0.06, d * 0.92), m.dark, 0, 1.5, 0);
    add(new THREE.BoxGeometry(0.08, 1.5, 0.08), m.dark, -w * 0.42, 0.75, d * 0.42);
    add(new THREE.BoxGeometry(0.08, 1.5, 0.08), m.dark, w * 0.42, 0.75, d * 0.42);
    add(new THREE.BoxGeometry(w * 0.82, 0.12, d * 0.86), lam('#e8ac3c'), 0, 1.6, 0.02);
  } else if (kind === 'locker') {
    add(new THREE.BoxGeometry(w * 0.86, 1.9, d * 0.7), m.hullDark, 0, 0.95, -d * 0.12);
    add(new THREE.BoxGeometry(0.03, 1.7, 0.02), m.dark, 0, 0.95, d * 0.24);
    add(new THREE.BoxGeometry(w * 0.6, 0.06, 0.03), m.strip, 0, 1.65, d * 0.24);
    add(new THREE.BoxGeometry(w * 0.86, 0.1, d * 0.7), m.orange, 0, 0.05, -d * 0.12);
  } else if (kind === 'console') {
    add(new THREE.BoxGeometry(w * 0.86, 0.8, d * 0.6), m.hullDark, 0, 0.4, -d * 0.15);
    add(new THREE.BoxGeometry(w * 0.86, 0.06, d * 0.7), m.dark, 0, 0.83, -d * 0.1);
    const screen = add(new THREE.PlaneGeometry(w * 0.74, 0.5), new THREE.MeshBasicMaterial({ map: consoleTexture(), toneMapped: false }), 0, 1.22, -d * 0.3);
    screen.castShadow = false;
    add(new THREE.BoxGeometry(w * 0.8, 0.58, 0.04), m.dark, 0, 1.22, -d * 0.33);
  }
}

// ---------- texturas desenhadas em canvas ----------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** piso de placas metálicas, com faixa de atenção na frente da porta */
function floorTexture(w: number, d: number, doorAt: number, doorSide: Side): THREE.CanvasTexture {
  const P = 64;
  const [c, x] = canvas(w * P, d * P);
  x.fillStyle = '#b9bcc6';
  x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++) {
      x.fillStyle = (i + j) % 2 ? '#b2b5c0' : '#bec1cb';
      x.fillRect(i * P + 2, j * P + 2, P - 4, P - 4);
      x.fillStyle = '#9da1ad';
      for (const [a, b] of [[8, 8], [P - 10, 8], [8, P - 10], [P - 10, P - 10]]) x.fillRect(i * P + a, j * P + b, 2, 2);
    }
  if (doorSide === 'south') {
    const y0 = (d - 1) * P;
    for (let k = -2; k < 6; k++) {
      x.fillStyle = k % 2 ? '#2b2b33' : '#f2b233';
      x.beginPath();
      x.moveTo(doorAt * P + k * 16, y0 + P);
      x.lineTo(doorAt * P + k * 16 + 16, y0 + P);
      x.lineTo(doorAt * P + k * 16 + 32, y0 + P - 14);
      x.lineTo(doorAt * P + k * 16 + 16, y0 + P - 14);
      x.fill();
    }
  }
  return tex(c);
}

function signTexture(text: string): THREE.CanvasTexture {
  const [c, x] = canvas(256, 96);
  x.fillStyle = '#283157';
  x.beginPath();
  x.roundRect(4, 4, 248, 88, 12);
  x.fill();
  x.fillStyle = '#ff7a2f';
  x.fillRect(4, 70, 248, 10);
  x.fillStyle = '#f4f0e8';
  x.font = '600 40px Fredoka, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 40);
  return tex(c);
}

function earthTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 136);
  const g = x.createLinearGradient(0, 0, 0, 136);
  g.addColorStop(0, '#05040f');
  g.addColorStop(1, '#16123a');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 136);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
    x.fillRect(Math.random() * 256, Math.random() * 136, 1.5, 1.5);
  }
  const e = x.createRadialGradient(150, 60, 4, 160, 70, 34);
  e.addColorStop(0, '#9fe0ff');
  e.addColorStop(0.6, '#2f7fd8');
  e.addColorStop(1, '#173a8a');
  x.fillStyle = e;
  x.beginPath();
  x.arc(160, 70, 32, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(90,170,90,0.85)';
  x.beginPath();
  x.ellipse(152, 64, 10, 14, 0.5, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#4b4f60';
  x.lineWidth = 10;
  x.strokeRect(0, 0, 256, 136);
  return tex(c);
}

function consoleTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 160);
  x.fillStyle = '#0c1430';
  x.fillRect(0, 0, 256, 160);
  x.strokeStyle = '#7fe7ff';
  x.fillStyle = '#7fe7ff';
  x.font = '600 20px Rubik, sans-serif';
  x.fillText('HAB-01  ·  SISTEMAS OK', 14, 30);
  x.globalAlpha = 0.8;
  for (let i = 0; i < 4; i++) {
    x.fillRect(14, 50 + i * 24, 60 + ((i * 53) % 150), 10);
  }
  x.lineWidth = 2;
  x.beginPath();
  for (let i = 0; i <= 60; i++) x.lineTo(150 + i * 1.6, 120 - Math.sin(i * 0.4) * 18 - i * 0.3);
  x.stroke();
  return tex(c);
}
