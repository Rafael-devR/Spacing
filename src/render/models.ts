// Modelos low poly procedurais: pedras, minérios, astronauta, módulo de pouso.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Rand } from '../core/noise';
import { PROP_TYPES, type PropType } from '../data/props';

type V3 = [number, number, number];

// Prepara geometria: sem índice, sem uv, normais planas e cor por triângulo.
function finish(geo: THREE.BufferGeometry, hex: THREE.ColorRepresentation, rand: Rand, vary = 0.16): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  for (let i = 0; i < n; i += 3) {
    const f = 1 - vary / 2 + rand() * vary;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = base.r * f;
      colors[(i + k) * 3 + 1] = base.g * f;
      colors[(i + k) * 3 + 2] = base.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function scaleColors(g: THREE.BufferGeometry, mul: number): THREE.BufferGeometry {
  const c = (g.attributes.color as THREE.BufferAttribute).array;
  for (let i = 0; i < c.length; i++) c[i] *= mul;
  return g;
}

// Pedra: icosaedro com vértices deslocados (mantendo vértices compartilhados juntos)
interface RockOpts {
  r?: number;
  detail?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  jitter?: number;
  color?: string;
  x?: number;
  y?: number;
  z?: number;
}

function rock(rand: Rand, { r = 0.5, detail = 1, sx = 1, sy = 0.8, sz = 1, jitter = 0.3, color = '#8d847b', x = 0, y = 0, z = 0 }: RockOpts): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const offsets = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 - jitter / 2 + rand() * jitter);
    const j = offsets.get(key) ?? 1;
    p.setXYZ(i, p.getX(i) * sx * j, p.getY(i) * sy * j, p.getZ(i) * sz * j);
  }
  g.computeBoundingBox();
  g.translate(x, y - (g.boundingBox?.min.y ?? 0) - r * 0.18, z);
  return finish(g, color, rand);
}

interface CrystalOpts {
  r?: number;
  h?: number;
  x?: number;
  z?: number;
  tiltX?: number;
  tiltZ?: number;
  color?: string;
}

function crystal(rand: Rand, { r = 0.12, h = 0.6, x = 0, z = 0, tiltX = 0, tiltZ = 0, color = '#8ff1ff' }: CrystalOpts): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(r * 0.96, r, h, 6, 1);
  body.translate(0, h / 2, 0);
  const tip = new THREE.ConeGeometry(r * 0.96, r * 1.6, 6, 1, true);
  tip.translate(0, h + r * 0.8, 0);
  const g = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()]);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, rand() * Math.PI, tiltZ));
  g.applyMatrix4(m);
  g.translate(x, 0, z);
  return scaleColors(finish(g, color, rand, 0.22), 1.55);
}

function nugget(rand: Rand, { r = 0.13, x, y, z, color = '#f4b63b' }: { r?: number; x: number; y: number; z: number; color?: string }): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(r, 0);
  g.rotateX(rand() * 3);
  g.rotateY(rand() * 3);
  g.translate(x, y, z);
  return scaleColors(finish(g, color, rand, 0.25), 1.1);
}

function buildProp(type: PropType, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  if (type === 'boulder') {
    parts.push(rock(rand, { r: 0.55, sy: 0.75, color: '#958b82' }));
    if (rand() > 0.4) parts.push(rock(rand, { r: 0.3, detail: 0, color: '#8a8178', x: 0.5, z: 0.25 }));
  } else if (type === 'ilmenite') {
    parts.push(rock(rand, { r: 0.42, sy: 1.15, sx: 0.85, color: '#3d3129' }));
    parts.push(rock(rand, { r: 0.3, detail: 0, color: '#33291f', x: 0.45, z: 0.15 }));
  } else if (type === 'gold') {
    parts.push(rock(rand, { r: 0.42, sy: 0.85, color: '#7d6a4c' }));
    parts.push(rock(rand, { r: 0.32, detail: 0, color: '#74603f', x: 0.5, z: 0.2 }));
    const spots: V3[] = [[0.05, 0.62, 0.2], [-0.25, 0.45, -0.15], [0.25, 0.35, -0.3], [0.55, 0.42, 0.25]];
    for (const [x, y, z] of spots) parts.push(nugget(rand, { x, y, z, r: 0.1 + rand() * 0.06 }));
  } else if (type === 'crystal') {
    parts.push(rock(rand, { r: 0.42, sy: 0.45, color: '#6a6079' }));
    parts.push(crystal(rand, { x: -0.08, z: 0.02, h: 0.75, r: 0.13, tiltX: -0.2, tiltZ: 0.15 }));
    parts.push(crystal(rand, { x: 0.15, z: 0.1, h: 0.5, r: 0.1, tiltX: 0.25, tiltZ: -0.35 }));
    parts.push(crystal(rand, { x: -0.05, z: -0.18, h: 0.42, r: 0.09, tiltX: -0.45, tiltZ: -0.1 }));
  } else if (type === 'meteorite') {
    parts.push(rock(rand, { r: 0.62, sy: 0.85, jitter: 0.42, color: '#2b2430' }));
    parts.push(rock(rand, { r: 0.34, detail: 0, color: '#241e29', x: 0.55, z: -0.2 }));
    // fendas incandescentes
    const spots: V3[] = [[0.1, 0.78, 0.25], [-0.35, 0.55, 0.2], [0.3, 0.5, -0.38], [-0.2, 0.62, -0.32], [0.45, 0.35, 0.35]];
    for (const [x, y, z] of spots) parts.push(scaleColors(nugget(rand, { x, y, z, r: 0.09 + rand() * 0.05, color: '#ff8a2a' }), 1.9));
    parts.push(crystal(rand, { x: -0.1, z: 0.05, h: 0.5, r: 0.1, tiltX: 0.1, tiltZ: 0.3 }));
    parts.push(crystal(rand, { x: 0.12, z: -0.05, h: 0.38, r: 0.08, tiltX: -0.3, tiltZ: -0.2 }));
    parts.forEach((g, i) => { if (i >= 7) g.translate(0, 0.45, 0); });
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export class PropFactory {
  /** 3 variações de geometria por tipo de objeto */
  readonly geos: Record<PropType, THREE.BufferGeometry[]>;

  constructor(private readonly material: THREE.Material) {
    this.geos = Object.fromEntries(
      PROP_TYPES.map((t) => [t, [0, 1, 2].map((v) => buildProp(t, 1000 + v * 97 + t.length * 13))]),
    ) as Record<PropType, THREE.BufferGeometry[]>;
  }

  create(type: PropType, variant = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geos[type][variant % 3], this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

// ---------------- Astronauta ----------------
function lam(hex: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export interface AstronautModel {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  bit: THREE.Mesh;
  beacon: THREE.Mesh;
  /** material do traje (para piscar ao levar dano) */
  suitMat: THREE.MeshLambertMaterial;
}

export function createAstronaut(): AstronautModel {
  const suit = lam('#f1f0ec');
  const accent = lam('#ff7a2f');
  const dark = lam('#4f5668');
  const visorMat = lam('#e9a640', { emissive: new THREE.Color('#5a2f08') });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = box(0.5, 0.52, 0.34, suit, 0, 0.78, 0);
  body.add(torso);
  body.add(box(0.22, 0.14, 0.04, accent, 0, 0.84, 0.18));
  body.add(box(0.52, 0.08, 0.36, dark, 0, 0.53, 0)); // cinto
  const pack = box(0.44, 0.5, 0.22, lam('#cfd3dc'), 0, 0.82, -0.27);
  body.add(pack);
  body.add(box(0.1, 0.36, 0.1, accent, -0.13, 0.84, -0.4));
  body.add(box(0.1, 0.36, 0.1, accent, 0.13, 0.84, -0.4));
  const antenna = box(0.025, 0.32, 0.025, dark, 0.16, 1.2, -0.3);
  body.add(antenna);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), lam('#ff3b30', { emissive: new THREE.Color('#ff2a1f') }));
  beacon.position.set(0.16, 1.38, -0.3);
  body.add(beacon);

  const head = new THREE.Group();
  head.position.set(0, 1.22, 0);
  body.add(head);
  const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), suit);
  helmet.castShadow = true;
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), visorMat);
  visor.scale.set(1.05, 0.78, 0.62);
  visor.position.set(0, 0.0, 0.16);
  head.add(visor);
  const shine = box(0.07, 0.04, 0.02, lam('#ffffff', { emissive: new THREE.Color('#ffffff') }), -0.09, 0.07, 0.29);
  shine.rotation.z = 0.5;
  shine.castShadow = false;
  head.add(shine);

  const limb = (w: number, h: number, d: number, mat: THREE.Material, px: number, py: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    const m = box(w, h, d, mat, 0, -h / 2, 0);
    pivot.add(m);
    return pivot;
  };
  const legL = limb(0.19, 0.5, 0.22, suit, -0.13, 0.52);
  const legR = limb(0.19, 0.5, 0.22, suit, 0.13, 0.52);
  legL.add(box(0.21, 0.12, 0.27, dark, 0, -0.46, 0.03));
  legR.add(box(0.21, 0.12, 0.27, dark, 0, -0.46, 0.03));
  const armL = limb(0.14, 0.44, 0.16, suit, -0.33, 0.98);
  const armR = limb(0.14, 0.44, 0.16, suit, 0.33, 0.98);
  armL.add(box(0.16, 0.1, 0.18, accent, 0, -0.42, 0));
  armR.add(box(0.16, 0.1, 0.18, accent, 0, -0.42, 0));
  // furadeira na mão direita
  const drill = new THREE.Group();
  drill.position.set(0, -0.44, 0.08);
  drill.add(box(0.1, 0.12, 0.26, dark, 0, 0, 0.08));
  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), lam('#ffb03a'));
  bit.rotation.x = Math.PI / 2;
  bit.position.set(0, 0, 0.32);
  bit.castShadow = true;
  drill.add(bit);
  armR.add(drill);
  body.add(legL, legR, armL, armR);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.receiveShadow = false;
  });
  return { root, body, head, legL, legR, armL, armR, bit, beacon, suitMat: suit };
}

// ---------------- Marcador de objetivo ----------------
export interface Waypoint {
  group: THREE.Group;
  update(t: number): void;
}

export function createWaypoint(color: [number, number, number] = [0.5, 1.6, 2.0]): Waypoint {
  const [r, g0, b] = color;
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(r, g0, b), transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 26, 10, 1, true), beamMat);
  beam.position.y = 13;
  g.add(beam);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(r * 1.4, g0 * 1.4, b * 1.3), fog: false }));
  gem.scale.y = 1.5;
  g.add(gem);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(r, g0, b), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.visible = false;
  return {
    group: g,
    update(t: number) {
      gem.position.y = 2.6 + Math.sin(t * 2.4) * 0.25;
      gem.rotation.y = t * 1.6;
      const s = 1 + ((t * 0.8) % 1) * 0.8;
      ring.scale.set(s, s, s);
      ringMat.opacity = 0.55 * (1 - ((t * 0.8) % 1));
      beamMat.opacity = 0.16 + Math.sin(t * 3) * 0.05;
    },
  };
}

// ---------------- Módulo de pouso ----------------
export interface Lander {
  group: THREE.Group;
  setRepaired(on: boolean): void;
  update(t: number): void;
}

export function createLander(): Lander {
  const g = new THREE.Group();
  const foil = lam('#e8ac3c');
  const white = lam('#e4e6ec');
  const grey = lam('#8c90a0');
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(1.15, 1.25, 1.0, 8), foil, 0, 1.55, 0);
  add(new THREE.CylinderGeometry(0.75, 1.0, 0.9, 6), white, 0, 2.5, 0);
  add(new THREE.CylinderGeometry(0.45, 0.6, 0.3, 6), grey, 0, 3.08, 0);
  add(new THREE.BoxGeometry(0.42, 0.32, 0.1), lam('#283157', { emissive: new THREE.Color('#1b2a6a') }), 0, 2.6, 0.82);
  add(new THREE.ConeGeometry(0.5, 0.6, 8, 1, true), grey, 0, 0.85, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = add(new THREE.BoxGeometry(0.12, 1.6, 0.12), grey, Math.cos(a) * 1.35, 0.85, Math.sin(a) * 1.35);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    add(new THREE.CylinderGeometry(0.32, 0.36, 0.1, 8), grey, Math.cos(a) * 1.7, 0.06, Math.sin(a) * 1.7);
  }
  // antena e bandeira
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), grey, 0.3, 3.55, 0);
  const dish = add(new THREE.ConeGeometry(0.3, 0.16, 8, 1, true), white, 0.3, 3.95, 0);
  dish.rotation.x = Math.PI;
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 5), white, 2.4, 0.9, 1.2);
  const flag = add(new THREE.BoxGeometry(0.7, 0.42, 0.03), lam('#ff7a2f'), 2.76, 1.55, 1.2);
  flag.castShadow = true;
  // luzes de status (vermelho = avariado, verde = reparado)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.15) });
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), lampMat);
    l.position.set(Math.cos(a) * 0.8, 2.98, Math.sin(a) * 0.8);
    g.add(l);
    lamps.push(l);
  }
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.4, 2.0, 0.9), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.4, 40, 10, 1, true), beamMat);
  beam.position.set(0.3, 24, 0);
  g.add(beam);
  let repaired = false;
  return {
    group: g,
    setRepaired(on) {
      repaired = on;
      lampMat.color.setRGB(on ? 0.4 : 2.2, on ? 2.4 : 0.25, on ? 0.8 : 0.15);
    },
    update(t) {
      const blink = repaired ? 0.6 + 0.4 * Math.sin(t * 3) : Math.sin(t * 5) > 0.3 ? 1 : 0.15;
      lamps.forEach((l, i) => (l.visible = repaired || blink > 0.5 || i === Math.floor(t * 2) % 3));
      beamMat.opacity = repaired ? 0.12 + 0.06 * Math.sin(t * 2) : 0;
    },
  };
}
