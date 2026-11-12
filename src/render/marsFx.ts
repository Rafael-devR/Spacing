// Efeitos de Marte (docs/design/MARTE.md): a poeira correndo na tempestade e os redemoinhos de poeira. Pontos simples,
// desenhados num só draw call cada; a lógica de onde estão fica aqui também, porque é só visual + um toque no jogador.
import * as THREE from 'three';
import { SKY } from './materials';

const POINT_VERT = `
  attribute float aAlpha; uniform float uSize; uniform vec2 uRes; varying float vAlpha;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uRes.y / max(1.0, -mv.z);
    vAlpha = aAlpha;
  }`;
const POINT_FRAG = `
  uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.2, 0.5, length(p))) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

function pointsMaterial(color: string, size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uSize: { value: size }, uRes: { value: SKY.res } },
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

/** Poeira levada pelo vento em volta da câmera (tempestade). */
export class DustStorm {
  private static readonly N = 900;
  private static readonly BOX = { x: 44, y: 14, z: 44 };
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly mat = pointsMaterial('#c88a5f', 0.16);

  constructor(scene: THREE.Scene) {
    const n = DustStorm.N;
    this.pos = new Float32Array(n * 3);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = Math.random() * DustStorm.BOX.x;
      this.pos[i * 3 + 1] = Math.random() * DustStorm.BOX.y;
      this.pos[i * 3 + 2] = Math.random() * DustStorm.BOX.z;
      alpha[i] = 0.35 + Math.random() * 0.65;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** `level` 0..1; o vento em blocos/s; `center` = onde a câmera olha */
  update(dt: number, level: number, wx: number, wz: number, center: THREE.Vector3): void {
    this.points.visible = level > 0.02;
    this.mat.uniforms.uOpacity.value = Math.min(1, level * 1.2) * 0.8;
    if (!this.points.visible) return;
    const B = DustStorm.BOX;
    // a caixa acompanha a câmera; cada ponto anda com o vento e dá a volta na caixa
    const ox = center.x - B.x / 2, oy = center.y - 3, oz = center.z - B.z / 2;
    const p = this.pos;
    const sx = wx * 3 * dt, sz = wz * 3 * dt;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (((p[i] + sx) % B.x) + B.x) % B.x;
      p[i + 1] = (((p[i + 1] + Math.sin(i + p[i] * 0.3) * dt * 0.6) % B.y) + B.y) % B.y;
      p[i + 2] = (((p[i + 2] + sz) % B.z) + B.z) % B.z;
    }
    this.points.position.set(ox, oy, oz);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

interface Devil {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  life: number;
  max: number;
  /** já passou pelo jogador */
  touched: boolean;
}

/** Redemoinhos de poeira que atravessam a planície. */
export class DustDevils {
  static readonly MAX = 2;
  private static readonly PER = 140;
  private static readonly HEIGHT = 9;
  readonly points: THREE.Points;
  readonly devils: Devil[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly seedA: Float32Array;
  private readonly seedH: Float32Array;
  private readonly mat = pointsMaterial('#e8c09a', 0.55);
  private spawnIn = 20;
  private t = 0;

  constructor(scene: THREE.Scene, private readonly ground: (x: number, z: number) => number) {
    const n = DustDevils.MAX * DustDevils.PER;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.seedA = new Float32Array(n);
    this.seedH = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.seedA[i] = Math.random() * Math.PI * 2;
      this.seedH[i] = Math.pow(Math.random(), 0.8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.mat.uniforms.uOpacity.value = 0.95;
    scene.add(this.points);
  }

  /**
   * Avança os redemoinhos. Devolve o redemoinho que acabou de passar pelo jogador (uma vez por redemoinho), ou null.
   * `calm` 0..1: na tempestade não nascem redemoinhos novos (a poeira já está toda no ar).
   */
  update(dt: number, player: THREE.Vector3, wx: number, wz: number, calm: number): Devil | null {
    this.t += dt;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.devils.length < DustDevils.MAX && calm > 0.6) {
      this.spawnIn = 25 + Math.random() * 30;
      // nasce contra o vento, a uns 26 blocos, e atravessa a área do jogador
      const wl = Math.hypot(wx, wz) || 1;
      const side = (Math.random() - 0.5) * 16;
      const x = player.x - (wx / wl) * 26 + (-wz / wl) * side;
      const z = player.z - (wz / wl) * 26 + (wx / wl) * side;
      const sp = 2.2 + Math.random() * 1.2;
      this.devils.push({ x, z, y: this.ground(x, z), vx: (wx / wl) * sp, vz: (wz / wl) * sp, life: 0, max: 26 + Math.random() * 10, touched: false });
    }
    let hit: Devil | null = null;
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const d = this.devils[i];
      d.life += dt;
      d.x += (d.vx + Math.sin(this.t * 0.7 + i) * 0.8) * dt;
      d.z += (d.vz + Math.cos(this.t * 0.6 + i * 2) * 0.8) * dt;
      d.y += (this.ground(d.x, d.z) - d.y) * Math.min(1, dt * 3);
      if (d.life > d.max) {
        this.devils.splice(i, 1);
        continue;
      }
      if (!d.touched && Math.hypot(player.x - d.x, player.z - d.z) < 1.9 && Math.abs(player.y - d.y) < 4) {
        d.touched = true;
        hit = d;
      }
    }
    this.draw();
    return hit;
  }

  private draw(): void {
    const per = DustDevils.PER, H = DustDevils.HEIGHT;
    for (let k = 0; k < DustDevils.MAX; k++) {
      const d = this.devils[k];
      // aparece e some devagar
      const fade = d ? Math.min(1, d.life / 3, (d.max - d.life) / 3) : 0;
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        if (!d) {
          this.alpha[i] = 0;
          continue;
        }
        const h = this.seedH[i];
        const r = 0.35 + h * 1.9;
        const a = this.seedA[i] + this.t * (5 - h * 2.5);
        this.pos[i * 3] = d.x + Math.cos(a) * r;
        this.pos[i * 3 + 1] = d.y + h * H;
        this.pos[i * 3 + 2] = d.z + Math.sin(a) * r;
        this.alpha[i] = fade * (1 - h * 0.75) * (0.5 + 0.5 * Math.sin(a * 3 + j));
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
