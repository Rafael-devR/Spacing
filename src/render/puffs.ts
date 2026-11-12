// Baforadas: sprites macios que sempre olham para a câmera, para fogo e fumaça dos efeitos (docs/design/METEOROS.md).
// As partículas de cubos (render/particles.ts) servem para lascas e poeira de bloco; fogo, clarão e coluna de fumaça pedem
// formas moles e grandes, que crescem e se apagam. Duas camadas, cada uma num desenho só (instâncias):
//   'fire'  soma luz (aditiva): clarão, bola de fogo, rastro de plasma, brasa
//   'smoke' mistura normal: poeira, fumaça
// Cada baforada guarda posição, velocidade, tamanho, cor de saída e de chegada e vida; o formato vem do shader (disco com
// borda macia e um ruído suave, para não parecer um círculo perfeito).
import * as THREE from 'three';
import type { RGB } from '../core/color';

export type PuffKind = 'fire' | 'smoke';

export interface PuffSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** diâmetro no começo (blocos) */
  size: number;
  /** quanto o diâmetro multiplica até o fim da vida (menor que 1 = encolhe) */
  growTo: number;
  /** segundos */
  life: number;
  from: RGB;
  /** cor no fim da vida (padrão: a mesma do começo) */
  to?: RGB;
  /** opacidade máxima (0 a 1; padrão 1) */
  alpha?: number;
  /** freio da velocidade por segundo (padrão 0) */
  drag?: number;
  /** blocos/s² para baixo (negativo sobe; padrão 0) */
  gravity?: number;
  /** giro (rad/s) */
  spin?: number;
}

interface Puff {
  life: number;
  max: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  growTo: number;
  from: RGB;
  to: RGB;
  alpha: number;
  drag: number;
  gravity: number;
  rot: number;
  spin: number;
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aColor;
attribute vec3 aShape; // x = diâmetro, y = giro, z = semente do ruído
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
void main() {
  vUv = uv;
  vColor = aColor;
  vSeed = aShape.z;
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float c = cos(aShape.y), s = sin(aShape.y);
  vec2 p = position.xy * aShape.x;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float cloud = vnoise(q * 3.2 + vSeed) * 0.6 + vnoise(q * 7.5 + vSeed * 1.7) * 0.4;
  float a = smoothstep(1.0, 0.2, d + (cloud - 0.5) * 0.6);
  a = a * a * (3.0 - 2.0 * a);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** uma camada: um desenho de instâncias com capacidade fixa (se encher, as novas são ignoradas) */
class PuffLayer {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly p: Puff[] = [];
  private readonly free: number[] = [];

  constructor(private readonly max: number, additive: boolean) {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.shape = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aCenter', this.center);
    this.geo.setAttribute('aColor', this.color);
    this.geo.setAttribute('aShape', this.shape);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    for (let i = 0; i < max; i++) {
      this.p.push({
        life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, growTo: 1,
        from: [1, 1, 1], to: [1, 1, 1], alpha: 1, drag: 0, gravity: 0, rot: 0, spin: 0,
      });
      this.shape.setZ(i, Math.random() * 40);
      this.free.push(max - 1 - i);
    }
  }

  get active(): number {
    return this.max - this.free.length;
  }

  spawn(s: PuffSpec): boolean {
    const i = this.free.pop();
    if (i === undefined) return false;
    const p = this.p[i];
    p.life = p.max = Math.max(0.01, s.life);
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.vx = s.vx; p.vy = s.vy; p.vz = s.vz;
    p.size = s.size;
    p.growTo = s.growTo;
    p.from = s.from;
    p.to = s.to ?? s.from;
    p.alpha = s.alpha ?? 1;
    p.drag = s.drag ?? 0;
    p.gravity = s.gravity ?? 0;
    p.rot = Math.random() * 6.28;
    p.spin = s.spin ?? (Math.random() - 0.5) * 0.8;
    this.shape.setZ(i, Math.random() * 40);
    return true;
  }

  update(dt: number): void {
    let hi = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.color.setW(i, 0);
        this.shape.setX(i, 0);
        this.free.push(i);
        continue;
      }
      hi = i + 1;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const u = 1 - p.life / p.max; // 0 nasce, 1 morre
      const grow = 1 - (1 - u) * (1 - u); // cresce rápido no começo
      const fade = Math.min(1, u / 0.1) * Math.pow(1 - u, 1.4);
      const m = Math.pow(u, 0.7);
      this.center.setXYZ(i, p.x, p.y, p.z);
      this.color.setXYZW(
        i,
        p.from[0] + (p.to[0] - p.from[0]) * m,
        p.from[1] + (p.to[1] - p.from[1]) * m,
        p.from[2] + (p.to[2] - p.from[2]) * m,
        p.alpha * fade,
      );
      this.shape.setX(i, p.size * (1 + (p.growTo - 1) * grow));
      this.shape.setY(i, p.rot);
    }
    // só desenha até a última viva
    this.geo.instanceCount = hi;
    this.center.needsUpdate = this.color.needsUpdate = this.shape.needsUpdate = true;
  }

  /** limpa tudo (nova partida, troca de mundo) */
  clear(): void {
    for (let i = 0; i < this.max; i++) {
      if (this.p[i].life > 0) {
        this.p[i].life = 0;
        this.free.push(i);
      }
      this.color.setW(i, 0);
      this.shape.setX(i, 0);
    }
    this.geo.instanceCount = 0;
    this.color.needsUpdate = this.shape.needsUpdate = true;
  }
}

export class Puffs {
  private readonly layers: Record<PuffKind, PuffLayer>;
  /** os desenhos (o teste de desempenho liga e desliga) */
  readonly meshes: THREE.Mesh[];

  constructor(scene: THREE.Scene, fireMax = 640, smokeMax = 480) {
    this.layers = { fire: new PuffLayer(fireMax, true), smoke: new PuffLayer(smokeMax, false) };
    this.meshes = [this.layers.smoke.mesh, this.layers.fire.mesh];
    for (const m of this.meshes) scene.add(m);
  }

  spawn(kind: PuffKind, spec: PuffSpec): boolean {
    return this.layers[kind].spawn(spec);
  }

  /** quantas baforadas estão vivas */
  get active(): number {
    return this.layers.fire.active + this.layers.smoke.active;
  }

  update(dt: number): void {
    // camada vazia não custa nada: o desenho já está com 0 instâncias
    if (this.layers.fire.active > 0) this.layers.fire.update(dt);
    if (this.layers.smoke.active > 0) this.layers.smoke.update(dt);
  }

  clear(): void {
    this.layers.fire.clear();
    this.layers.smoke.clear();
  }
}
