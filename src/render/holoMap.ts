// Mapa do tablet: holograma 3D do terreno visto de cima (docs/design/MAPA.md).
// O relevo vem do gerador (não das edições do jogador), amostrado de 2 em 2 blocos e suavizado: dá a forma da
// cratera sem mostrar o terreno de verdade. A cena é desenhada numa textura de baixa resolução (por isso fica
// embaçada) que vai na tela do tablet. Marcadores são pontos que brilham com um pino; os nomes ficam no HTML
// (app/MapDirector.ts), nítidos por cima.
import * as THREE from 'three';

/** blocos entre duas amostras do relevo */
export const MAP_STEP = 2;
/** amostras por lado (o mapa cobre MAP_CELLS × MAP_STEP blocos) */
export const MAP_CELLS = 80;
/** meia largura do mapa, em blocos */
export const MAP_RADIUS = (MAP_CELLS * MAP_STEP) / 2;
/** inclinação da câmera do mapa (rad, 90° = de cima) */
const PITCH = THREE.MathUtils.degToRad(64);
const FOV = 32;

export type MarkerKind = 'player' | 'lander' | 'base' | 'goal' | 'loot' | 'meteorite' | 'crystal' | 'gold' | 'ilmenite';

export interface MapMarker {
  kind: MarkerKind;
  x: number;
  z: number;
  /** altura do chão no ponto (se ausente, o mapa usa o relevo) */
  y?: number;
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
  ilmenite: '#b9b3c9',
};

/** marcadores com pino alto e nome (os minérios são só pontos) */
export const MARKER_PINNED: ReadonlySet<MarkerKind> = new Set<MarkerKind>(['player', 'lander', 'base', 'goal', 'loot', 'meteorite']);

/**
 * Relevo do mapa em volta de (cx, cz): MAP_CELLS+1 amostras por lado, de MAP_STEP em MAP_STEP blocos, suavizado
 * (média 3×3) para não mostrar os blocos. Puro: só depende da função de altura.
 */
export function sampleRelief(heightAt: (x: number, z: number) => number, cx: number, cz: number, cells = MAP_CELLS, step = MAP_STEP): Float32Array {
  const n = cells + 1;
  const x0 = Math.round(cx) - (cells * step) / 2, z0 = Math.round(cz) - (cells * step) / 2;
  const raw = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) raw[j * n + i] = heightAt(x0 + i * step, z0 + j * step);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          s += raw[jj * n + ii];
          c++;
        }
      out[j * n + i] = s / c;
    }
  return out;
}

const TERRAIN_VERT = /* glsl */ `
  varying float vH;
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vH = w.y;
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const TERRAIN_FRAG = /* glsl */ `
  uniform float uTime, uMinH, uMaxH, uRadius;
  uniform vec2 uCenter;
  varying float vH;
  varying vec2 vXZ;
  float lineOf(float v) {
    float f = abs(fract(v) - 0.5);
    return 1.0 - smoothstep(0.0, fwidth(v) * 1.4, 0.5 - f);
  }
  void main() {
    float t = clamp((vH - uMinH) / max(1.0, uMaxH - uMinH), 0.0, 1.0);
    vec3 low = vec3(0.03, 0.22, 0.42), high = vec3(0.45, 0.95, 1.1);
    vec3 c = mix(low, high, t);
    // curvas de nível a cada 2 blocos, deslocadas meio bloco dos platôs
    float cv = vH / 2.0 + 0.25;
    // só onde o chão inclina: num trecho plano a altura pode cair bem em cima de uma curva e acender o trecho inteiro
    float contour = lineOf(cv) * smoothstep(0.0015, 0.012, fwidth(cv));
    float grid = max(lineOf(vXZ.x / 16.0), lineOf(vXZ.y / 16.0));
    float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 1.3 - uTime * 7.0);
    float flicker = 0.93 + 0.07 * sin(uTime * 23.0 + vXZ.x * 0.05);
    float d = length(vXZ - uCenter);
    float edge = smoothstep(uRadius, uRadius * 0.62, d);
    float a = (0.22 + 0.25 * t + 0.75 * contour + 0.28 * grid) * edge * scan * flicker;
    gl_FragColor = vec4(c * (0.6 + 0.9 * contour) + vec3(0.2, 0.5, 0.6) * grid * 0.4, a);
  }`;

export class HoloMap {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  readonly target: THREE.WebGLRenderTarget;
  /** centro da vista (x, z) e distância da câmera (zoom) */
  readonly view = new THREE.Vector2();
  distance = 150;
  readonly minDistance = 60;
  readonly maxDistance = 280;
  private readonly terrainGeo: THREE.PlaneGeometry;
  private readonly terrainMat: THREE.ShaderMaterial;
  private readonly terrain: THREE.Mesh;
  private readonly built = new THREE.Vector2(1e9, 1e9);
  private relief: Float32Array = new Float32Array(0);
  private readonly points: THREE.Points;
  private readonly pins: THREE.LineSegments;
  private readonly arrow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private markers: MapMarker[] = [];
  private readonly c = new THREE.Color();
  private readonly v = new THREE.Vector3();

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#020a14');

    const span = MAP_CELLS * MAP_STEP;
    this.terrainGeo = new THREE.PlaneGeometry(span, span, MAP_CELLS, MAP_CELLS);
    this.terrainGeo.rotateX(-Math.PI / 2);
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMinH: { value: 0 }, uMaxH: { value: 1 }, uRadius: { value: MAP_RADIUS }, uCenter: { value: new THREE.Vector2() } },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const terrain = (this.terrain = new THREE.Mesh(this.terrainGeo, this.terrainMat));
    terrain.frustumCulled = false;
    this.scene.add(terrain);

    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, map: dotTexture() }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.pins = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.pins.frustumCulled = false;
    this.pins.renderOrder = 2;
    // você: seta laranja que gira com o astronauta, com um anel pulsando
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 2.6);
    arrowShape.lineTo(1.7, -1.8);
    arrowShape.lineTo(0, -0.8);
    arrowShape.lineTo(-1.7, -1.8);
    arrowShape.closePath();
    const ag = new THREE.ShapeGeometry(arrowShape);
    ag.rotateX(-Math.PI / 2);
    ag.rotateY(Math.PI);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35), depthTest: false, toneMapped: false }));
    this.arrow.renderOrder = 5;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.8, 0.3), transparent: true, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 4;
    this.scene.add(this.points, this.pins, this.arrow, this.ring);
  }

  /** Tamanho da textura (em pixels). Pequena de propósito: o holograma fica macio. */
  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(4, Math.round(w)), Math.max(4, Math.round(h)));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    (this.points.material as THREE.PointsMaterial).size = Math.max(5, Math.min(w, h) * 0.03);
  }

  /** altura do relevo do mapa (suavizado) num ponto; fora da área amostrada usa o gerador */
  reliefAt(x: number, z: number): number {
    const n = MAP_CELLS + 1;
    const x0 = Math.round(this.built.x) - MAP_RADIUS, z0 = Math.round(this.built.y) - MAP_RADIUS;
    const i = Math.round((x - x0) / MAP_STEP), j = Math.round((z - z0) / MAP_STEP);
    if (i < 0 || j < 0 || i >= n || j >= n || !this.relief.length) return this.heightAt(x, z);
    return this.relief[j * n + i];
  }

  /** Centraliza a vista; refaz o relevo se andou longe do último centro. */
  center(x: number, z: number): void {
    this.view.set(x, z);
    if (Math.hypot(x - this.built.x, z - this.built.y) > MAP_RADIUS * 0.3) this.rebuild(x, z);
  }

  private rebuild(cx: number, cz: number): void {
    this.built.set(Math.round(cx), Math.round(cz));
    this.relief = sampleRelief(this.heightAt, this.built.x, this.built.y);
    const pos = this.terrainGeo.attributes.position as THREE.BufferAttribute;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < pos.count; k++) {
      // PlaneGeometry deitada: os vértices vão de -z (norte) para +z, linha por linha
      const h = this.relief[k] ?? 0;
      pos.setY(k, h);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    pos.needsUpdate = true;
    this.terrainGeo.computeBoundingSphere();
    this.terrain.position.set(this.built.x, 0, this.built.y);
    this.terrainMat.uniforms.uMinH.value = lo;
    this.terrainMat.uniforms.uMaxH.value = hi;
  }

  /** Marcadores (lugares, itens, minérios). Chamado de tempos em tempos, não a cada quadro. */
  setMarkers(list: MapMarker[]): void {
    this.markers = list.filter((m) => m.kind !== 'player');
    const pos: number[] = [], col: number[] = [], pinPos: number[] = [], pinCol: number[] = [];
    for (const m of this.markers) {
      const ground = this.reliefAt(m.x, m.z);
      const pinned = MARKER_PINNED.has(m.kind);
      const top = ground + (pinned ? 9 : 1.5);
      this.c.set(MARKER_COLOR[m.kind]).multiplyScalar(pinned ? 1.8 : 1.4);
      pos.push(m.x, top, m.z);
      col.push(this.c.r, this.c.g, this.c.b);
      if (pinned) {
        pinPos.push(m.x, ground, m.z, m.x, top, m.z);
        pinCol.push(this.c.r * 0.3, this.c.g * 0.3, this.c.b * 0.3, this.c.r, this.c.g, this.c.b);
      }
    }
    const pg = this.points.geometry;
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lg = this.pins.geometry;
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pinPos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(pinCol, 3));
  }

  /** onde fica o topo do pino de um marcador (para pôr o nome em cima) */
  markerTop(m: MapMarker, out: THREE.Vector3): THREE.Vector3 {
    return out.set(m.x, this.reliefAt(m.x, m.z) + (MARKER_PINNED.has(m.kind) ? 9 : 1.5), m.z);
  }

  /** Astronauta: posição e para onde olha (Player.facing). */
  setPlayer(x: number, z: number, facing: number, time: number): void {
    const y = this.reliefAt(x, z) + 1.2;
    this.arrow.position.set(x, y + 0.3, z);
    this.arrow.rotation.y = facing;
    this.ring.position.set(x, y, z);
    const k = (time * 0.8) % 1;
    this.ring.scale.setScalar(0.6 + k * 1.6);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
  }

  /** Ponto do mundo → posição na tela do mapa (0..1, y para baixo). null = atrás da câmera. */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = this.v.copy(p).project(this.camera);
    if (v.z > 1) return null;
    return { x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5 };
  }

  /** a vista está a quanto do centro, em blocos (para esconder nomes fora do círculo do holograma) */
  distanceFromView(x: number, z: number): number {
    return Math.hypot(x - this.built.x, z - this.built.y);
  }

  /** blocos por pixel da tela no centro da vista (para arrastar o mapa com o dedo) */
  blocksPerPixel(screenHeight: number): number {
    const d = this.distance / Math.min(1, this.camera.aspect);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / screenHeight;
  }

  render(renderer: THREE.WebGLRenderer, time: number): void {
    const cy = this.reliefAt(this.view.x, this.view.y);
    // celular em pé: afasta para a largura mostrar o mesmo tanto que a altura mostra deitado
    const d = this.distance / Math.min(1, this.camera.aspect);
    this.camera.position.set(this.view.x, cy + Math.sin(PITCH) * d, this.view.y + Math.cos(PITCH) * d);
    this.camera.lookAt(this.view.x, cy, this.view.y);
    const u = this.terrainMat.uniforms;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector2).copy(this.built);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}

let dotTex: THREE.Texture | null = null;
/** ponto redondo e macio */
function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
