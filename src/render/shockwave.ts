// Ondas de choque que entortam a imagem (docs/design/METEOROS.md, ADR 0014). Cada onda é uma esfera no mundo que cresce a
// partir do impacto; na tela ela vira um anel (círculo) que empurra a imagem de trás, como a luz dobrando num filme.
// Aqui fica só a conta: de onda no mundo para centro, raio, espessura e força na tela. Quem entorta de fato é a passada
// final (render/post.ts, `FX_SHOCK`), que lê os valores daqui. Sem WebGL: dá para testar.
//   blast  onda do impacto: cresce e perde força até sumir
//   haze   ar tremendo em volta de algo em voo (o meteoro): fica do tamanho que está e some se ninguém a renovar
import * as THREE from 'three';
import { SHOCK } from '../data/meteors';

interface Wave {
  pos: THREE.Vector3;
  age: number;
  life: number;
  radius: number;
  width: number;
  strength: number;
  rim: number;
  chroma: number;
  haze: boolean;
}

export interface ShockOpts {
  life?: number;
  radius?: number;
  width?: number;
  strength?: number;
  rim?: number;
  chroma?: number;
}

/** curva de saída: sobe depressa no começo e desacelera */
const easeOut = (u: number): number => 1 - Math.pow(1 - u, 2.2);

export class ShockWaves {
  private readonly blasts: Wave[] = [];
  private readonly hazes = new Map<number, Wave>();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  /** Uma onda de impacto. `size` multiplica o raio e a força (impacto maior, onda maior). */
  add(x: number, y: number, z: number, size = 1, o: ShockOpts = {}): void {
    if (this.blasts.length >= SHOCK.max * 2) this.blasts.shift();
    this.blasts.push({
      pos: new THREE.Vector3(x, y, z), age: 0,
      life: o.life ?? SHOCK.life,
      radius: (o.radius ?? SHOCK.radius) * size,
      width: o.width ?? SHOCK.width,
      strength: (o.strength ?? SHOCK.strength) * Math.min(1.4, size),
      rim: o.rim ?? SHOCK.rim,
      chroma: o.chroma ?? SHOCK.chroma,
      haze: false,
    });
  }

  /** Ar tremendo em volta de algo em voo: chame todo quadro enquanto ele existe (`key` = quem é). */
  haze(key: number, x: number, y: number, z: number, radius: number, width: number, strength: number): void {
    let w = this.hazes.get(key);
    if (!w) {
      w = { pos: new THREE.Vector3(), age: 0, life: 0.15, radius, width, strength, rim: 0, chroma: 0, haze: true };
      this.hazes.set(key, w);
    }
    w.pos.set(x, y, z);
    w.age = 0;
    w.radius = radius;
    w.width = width;
    w.strength = strength;
  }

  update(dt: number): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const w = this.blasts[i];
      w.age += dt;
      if (w.age >= w.life) this.blasts.splice(i, 1);
    }
    for (const [k, w] of this.hazes) {
      w.age += dt;
      if (w.age >= w.life) this.hazes.delete(k);
    }
  }

  /** quantas ondas existem (de impacto e de ar tremendo) */
  get count(): number {
    return this.blasts.length + this.hazes.size;
  }

  clear(): void {
    this.blasts.length = 0;
    this.hazes.clear();
  }

  /**
   * Escreve as ondas visíveis nos vetores da passada final e devolve quantas são (no máximo `SHOCK.max`; as mais novas
   * primeiro, depois as de ar tremendo).
   *   a[i] = (x, y do centro em 0..1, raio, força)       b[i] = (espessura, brilho da borda, cor separada, 0)
   * Raio e espessura saem em fração da ALTURA da tela (a passada corrige a proporção).
   */
  fill(camera: THREE.Camera, aspect: number, a: THREE.Vector4[], b: THREE.Vector4[]): number {
    if (this.count === 0) return 0;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]).normalize();
    let n = 0;
    for (let i = this.blasts.length - 1; i >= 0 && n < SHOCK.max; i--) if (this.write(this.blasts[i], camera, aspect, a[n], b[n])) n++;
    if (n < SHOCK.max) for (const w of this.hazes.values()) if (n < SHOCK.max && this.write(w, camera, aspect, a[n], b[n])) n++;
    return n;
  }

  private write(w: Wave, camera: THREE.Camera, aspect: number, a: THREE.Vector4, b: THREE.Vector4): boolean {
    const p = this.a.copy(w.pos).project(camera);
    if (p.z > 1) return false; // atrás da câmera
    const q = this.b.copy(w.pos).addScaledVector(this.right, 1).project(camera);
    // um bloco do mundo, na tela, em fração da altura (o espaço NDC tem 2 de altura)
    const k = Math.hypot((q.x - p.x) * aspect, q.y - p.y) * 0.5;
    let r = w.radius, width = w.width, s = w.strength, rim = w.rim;
    if (!w.haze) {
      const u = Math.min(1, w.age / w.life);
      r = w.radius * easeOut(u);
      width = w.width * (0.6 + 0.8 * u);
      const fade = Math.pow(1 - u, 1.6);
      s = w.strength * fade;
      rim = w.rim * fade;
    }
    a.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, r * k, s);
    b.set(width * k, rim, w.chroma, 0);
    return true;
  }
}
