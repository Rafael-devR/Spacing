// O fundo da tela de título (docs/design/TITULO.md): céu estrelado e o planeta escolhido (Lua ou Marte), feitos no Blender
// (tools/models/planet_moon.py, planet_mars.py: corpo low poly facetado com blocos por cima). Para dar tamanho, o planeta fica
// enorme e perto, cortado pela borda da tela (só a calota de cima aparece, com a curva do horizonte), e gira devagar. Em volta:
// atmosfera calculada pela distância do raio de visão ao centro (borda acesa do lado do sol; em Marte, azulada no poente),
// poeira em Marte, a Terra pequena no céu da Lua e Fobos passando no de Marte, a Via Láctea e o brilho do sol no canto.
// Nada do jogo é carregado aqui.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlanetId } from '../../data/planets';
import marsUrl from '../../assets/models/planet_mars.glb?url';
import moonUrl from '../../assets/models/planet_moon.glb?url';

const URL_OF: Record<PlanetId, string> = { lua: moonUrl, marte: marsUrl };
/** raio do planeta na cena */
const RADIUS = 16;

interface Look {
  tilt: number;
  /** giro, em radianos por segundo (devagar: coisa grande parece lenta) */
  spin: number;
  /** cor da borda iluminada e força dela; espessura da atmosfera (fração do raio) */
  atmo: string;
  atmoStrength: number;
  atmoHeight: number;
  /** cor da borda perto da noite (em Marte o poente é azulado) */
  dusk: string;
  /** véu de poeira sobre o chão (0 = nenhum) */
  dust: number;
  nebula: [string, string];
  sun: string;
  /** luz que sobra no lado da noite */
  night: string;
}

const LOOK: Record<PlanetId, Look> = {
  lua: {
    tilt: -0.6, spin: 0.012, atmo: '#a9bcff', atmoStrength: 0.35, atmoHeight: 0.03, dusk: '#6a7cff', dust: 0,
    nebula: ['#26306e', '#3b1f5c'], sun: '#fff6e8', night: '#26305a',
  },
  marte: {
    tilt: -0.85, spin: 0.014, atmo: '#ffad80', atmoStrength: 1.0, atmoHeight: 0.07, dusk: '#7fb2ff', dust: 0.32,
    nebula: ['#4a1f2e', '#20306a'], sun: '#fff1e2', night: '#3a1e2a',
  },
};

/** direção do sol (fora da tela, à esquerda, em cima, um pouco à frente) */
const SUN_DIR = new THREE.Vector3(-0.85, 0.45, 0.22).normalize();

/** ruído de valor 3D barato, para poeira, nuvens e continentes nos shaders */
const NOISE_GLSL = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.15; }
`;

/** estrelas: pontos com tamanho, cor e ritmo de cintilar próprios; boa parte junto da faixa da Via Láctea */
function stars(n: number, band: THREE.Vector3): THREE.Points {
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  // base da faixa: dois vetores no plano perpendicular a `band`
  const t = new THREE.Vector3(0, 1, 0).cross(band).normalize(), b = band.clone().cross(t);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const inBand = i % 5 < 2;
    if (inBand) {
      const a = Math.random() * Math.PI * 2;
      // espalhamento estreito em volta do grande círculo
      const lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.16;
      v.copy(t).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a)).addScaledVector(band, lat).normalize();
    } else {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      v.set(Math.cos(a) * s, u, Math.sin(a) * s);
    }
    v.multiplyScalar(380 + Math.random() * 60);
    pos.set([v.x, v.y, v.z], i * 3);
    const k = Math.random();
    size[i] = inBand ? 0.7 + Math.random() * 0.9 : k > 0.985 ? 3.4 + Math.random() * 1.6 : k > 0.9 ? 2 + Math.random() : 0.9 + Math.random() * 0.9;
    seed[i] = Math.random() * 100;
    const r = Math.random();
    c.set(r < 0.15 ? '#ffd9b0' : r < 0.32 ? '#b9cbff' : '#ffffff');
    if (inBand) c.multiplyScalar(0.75);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aSeed; attribute vec3 color;
      uniform float uTime; uniform float uScale;
      varying vec3 vCol; varying float vA;
      void main() {
        vCol = color;
        vA = 0.55 + 0.45 * sin(uTime * (0.6 + fract(aSeed) * 1.8) + aSeed);
        gl_PointSize = aSize * uScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vCol, a * a * vA);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(g, m);
}

/** mancha de luz suave (nebulosa, brilho do sol): textura de gradiente radial */
function glowTexture(stops: [number, string][], size = 128): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sprite(tex: THREE.Texture, opacity: number, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(scale);
  return s;
}

/**
 * Atmosfera: uma casca maior que o planeta, desenhada só pela frente (cobre o disco todo). Para cada pixel, o raio de visão
 * passa a uma distância `b` do centro: fora do planeta (b > R) é a borda que brilha, mais forte rente ao chão; dentro, um véu que
 * engrossa perto da beira. Acende do lado do sol; perto da noite puxa para `dusk`. Em Marte, manchas de poeira passam por cima.
 */
function atmosphere(look: Look): THREE.Mesh {
  const top = RADIUS * (1 + look.atmoHeight);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(look.atmo) },
      uDusk: { value: new THREE.Color(look.dusk) },
      uStrength: { value: look.atmoStrength },
      uDust: { value: look.dust },
      uSun: { value: SUN_DIR.clone() },
      uCenter: { value: new THREE.Vector3() },
      uR: { value: RADIUS },
      uTop: { value: top },
      uTime: { value: 0 },
      uSpin: { value: new THREE.Matrix3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uDusk; uniform float uStrength; uniform float uDust; uniform vec3 uSun; uniform vec3 uCenter;
      uniform float uR; uniform float uTop; uniform float uTime; uniform mat3 uSpin;
      varying vec3 vW;
      ${NOISE_GLSL}
      void main() {
        vec3 V = normalize(vW - cameraPosition);
        vec3 oc = uCenter - cameraPosition;
        float tc = dot(oc, V);
        vec3 P = cameraPosition + V * tc;
        float b = length(P - uCenter);
        float a; vec3 n;
        if (b > uR) {
          // borda: forte rente ao chão, some no topo da atmosfera
          float k = clamp((uTop - b) / (uTop - uR), 0.0, 1.0);
          a = pow(k, 2.2);
          n = normalize(P - uCenter);
        } else {
          // véu sobre o chão: só perto da beira (onde o raio atravessa muito ar)
          float th = tc - sqrt(uR * uR - b * b);
          n = normalize(cameraPosition + V * th - uCenter);
          a = pow(b / uR, 6.0) * 0.55;
        }
        float sun = dot(n, uSun);
        float lit = smoothstep(-0.3, 0.45, sun);
        vec3 col = mix(uDusk, uColor, smoothstep(-0.1, 0.35, sun));
        float dust = 0.0;
        if (uDust > 0.0 && b < uR) {
          // poeira presa ao chão (gira com o planeta) e correndo um pouco mais rápido que ele
          vec3 q = uSpin * n;
          float d = fbm(q * 3.2 + vec3(uTime * 0.02, 0.0, uTime * 0.013));
          dust = smoothstep(0.52, 0.8, d) * uDust * lit;
        }
        float i = a * uStrength * lit;
        gl_FragColor = vec4(col * i + vec3(1.0, 0.78, 0.62) * dust * 0.55, i + dust * 0.5);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(top, 96, 64), m);
}

/** a Terra vista da Lua: oceano, continentes, nuvens e uma borda azul, acesa pelo mesmo sol */
function earth(): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vP = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vP);
        float land = smoothstep(0.55, 0.6, fbm(p * 2.2 + 4.0));
        vec3 col = mix(vec3(0.05, 0.16, 0.42), mix(vec3(0.22, 0.42, 0.18), vec3(0.55, 0.45, 0.28), vnoise(p * 6.0)), land);
        col = mix(col, vec3(0.95), smoothstep(0.82, 0.9, abs(p.y)));
        float cl = smoothstep(0.5, 0.75, fbm(p * 3.5 + vec3(uTime * 0.01, 0.0, 0.0)));
        col = mix(col, vec3(1.0), cl * 0.85);
        float l = max(dot(vN, uSun), 0.0);
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        gl_FragColor = vec4(col * (0.03 + l * 1.1) + vec3(0.35, 0.55, 1.0) * rim * smoothstep(-0.2, 0.4, dot(vN, uSun)) * 0.9, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), m);
}

/** Fobos: pedra torta, facetada, escura */
function phobos(material: THREE.Material): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + Math.sin(v.x * 3.1 + v.y * 1.7) * 0.12 + Math.sin(v.z * 4.3 - v.x * 2.2) * 0.08;
    v.multiply(new THREE.Vector3(1.35, 0.95, 1.05)).multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = 0.82 + ((i * 7919) % 13) / 60;
    cols.set([0.36 * s, 0.3 * s, 0.27 * s], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return new THREE.Mesh(g, material);
}

export class TitleScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1500);
  private readonly stars: THREE.Points;
  private readonly holder = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly sun = new THREE.DirectionalLight('#ffffff', 3.0);
  private readonly fill = new THREE.HemisphereLight('#26305a', '#0b0a12', 0.6);
  private readonly nebulae: THREE.Sprite[] = [];
  private readonly sunGlow: THREE.Sprite;
  private readonly sunCore: THREE.Sprite;
  private readonly earth = earth();
  private readonly phobos: THREE.Mesh;
  private planet: THREE.Object3D | null = null;
  private atmo: THREE.Mesh | null = null;
  private id: PlanetId | null = null;
  private loading = 0;
  private raf = 0;
  /** `?tituloT=segundos` adianta a animação (para as capturas mostrarem outro lado do planeta) */
  private t0 = performance.now() - Number(new URLSearchParams(location.search).get('tituloT') ?? 0) * 1000;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<PlanetId, THREE.Object3D>();
  /** chamado quando o planeta aparece pela primeira vez */
  onReady: (() => void) | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color('#020309');
    const band = new THREE.Vector3(0.35, 0.8, -0.5).normalize();
    this.stars = stars(3600, band);
    this.scene.add(this.stars, this.holder, this.sun, this.fill);
    this.holder.add(this.spin);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100);
    // o sol: um núcleo pequeno e um brilho grande, longe, na direção da luz (fica no canto, quase fora da tela)
    const far = SUN_DIR.clone().multiplyScalar(900);
    this.sunGlow = sprite(glowTexture([[0, 'rgba(255,236,210,0.9)'], [0.25, 'rgba(255,214,170,0.25)'], [1, 'rgba(0,0,0,0)']]), 0.55, 900);
    this.sunCore = sprite(glowTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,248,235,0.9)'], [1, 'rgba(0,0,0,0)']]), 1, 90);
    this.sunGlow.position.copy(far);
    this.sunCore.position.copy(far);
    this.scene.add(this.sunGlow, this.sunCore);
    // nebulosas fracas ao longo da Via Láctea
    const neb = glowTexture([[0, '#ffffff'], [1, 'rgba(0,0,0,0)']]);
    for (let i = 0; i < 3; i++) {
      const n = sprite(neb, 0.1, 480 + i * 120);
      this.nebulae.push(n);
      this.scene.add(n);
    }
    this.nebulae[0].position.set(-160, 170, -420);
    this.nebulae[1].position.set(260, -60, -440);
    this.nebulae[2].position.set(60, 300, -380);
    this.earth.scale.setScalar(7);
    this.earth.visible = false;
    this.phobos = phobos(this.material);
    this.phobos.visible = false;
    this.scene.add(this.earth, this.phobos);
  }

  /** Mostra o planeta (carrega o modelo na primeira vez). */
  async show(id: PlanetId): Promise<void> {
    if (this.id === id) return;
    this.id = id;
    const ticket = ++this.loading;
    let model = this.cache.get(id);
    if (!model) {
      const gltf = await this.loader.loadAsync(URL_OF[id]);
      model = gltf.scene;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          (m.material as THREE.Material).dispose();
          m.material = this.material;
        }
      });
      this.cache.set(id, model);
    }
    if (ticket !== this.loading) return;
    const look = LOOK[id];
    if (this.planet) this.spin.remove(this.planet);
    this.planet = model;
    this.spin.add(model);
    // o raio do modelo (unidades do Blender) vira RADIUS aqui; R = 15 nos scripts
    this.spin.scale.setScalar(RADIUS / 15);
    this.holder.rotation.set(look.tilt, 0, -0.2);
    this.sun.color.set(look.sun);
    this.fill.color.set(look.night);
    if (this.atmo) {
      this.atmo.removeFromParent();
      this.atmo.geometry.dispose();
      (this.atmo.material as THREE.Material).dispose();
    }
    this.atmo = atmosphere(look);
    this.scene.add(this.atmo);
    this.nebulae[0].material.color.set(look.nebula[0]);
    this.nebulae[1].material.color.set(look.nebula[1]);
    this.nebulae[2].material.color.set(look.nebula[0]);
    this.earth.visible = id === 'lua';
    this.phobos.visible = id === 'marte';
    this.onReady?.();
    this.onReady = null;
  }

  start(): void {
    if (this.raf) return;
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** ponto da tela (coordenadas de -1 a 1) a uma distância da câmera */
  private at(x: number, y: number, dist: number, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.camera;
    return out.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(dist).add(cam.position);
  }

  private frame(): void {
    const t = (performance.now() - this.t0) / 1000;
    const r = this.renderer;
    const el = r.domElement;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    const portrait = h > w;
    cam.fov = portrait ? 62 : 40;
    // a câmera respira devagar, sem girar o enquadramento
    cam.position.set(Math.sin(t * 0.05) * 0.5, Math.sin(t * 0.037) * 0.35, 0);
    cam.rotation.set(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // o planeta enorme, perto, com o centro abaixo da tela: só a calota de cima aparece (deitado: à direita; em pé: embaixo)
    if (portrait) this.at(0.15, -1.0, 34, this.holder.position);
    else this.at(0.5, -1.25, 33, this.holder.position);
    this.spin.rotation.y = t * (this.id ? LOOK[this.id].spin : 0.012);
    if (this.atmo) {
      const u = (this.atmo.material as THREE.ShaderMaterial).uniforms;
      this.atmo.position.copy(this.holder.position);
      (u.uCenter.value as THREE.Vector3).copy(this.holder.position);
      u.uTime.value = t;
      // da direção no mundo para a do planeta girando (a poeira fica presa ao chão)
      this.spin.updateMatrixWorld();
      (u.uSpin.value as THREE.Matrix3).setFromMatrix4(this.spin.matrixWorld).invert();
    }
    if (this.earth.visible) {
      // a Terra pequena no alto, do outro lado do menu
      this.at(portrait ? 0.7 : 0.62, portrait ? -0.05 : 0.6, 320, this.earth.position);
      this.earth.rotation.y = t * 0.03;
      (this.earth.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
    if (this.phobos.visible) {
      // Fobos atravessa o céu devagar, por cima do planeta (volta a cada 120 s)
      const k = (t % 120) / 120;
      this.at(1.25 - k * 2.6, portrait ? 0.35 + k * 0.2 : 0.42 + k * 0.25, 90, this.phobos.position);
      this.phobos.scale.setScalar(1.6);
      this.phobos.rotation.set(t * 0.05, t * 0.08, 0);
    }
    this.stars.rotation.y = t * 0.003;
    const sm = this.stars.material as THREE.ShaderMaterial;
    sm.uniforms.uTime.value = t;
    sm.uniforms.uScale.value = r.getPixelRatio();
    // o brilho do sol pulsa de leve
    this.sunGlow.material.opacity = 0.5 + Math.sin(t * 0.6) * 0.04;
    r.render(this.scene, cam);
  }

  dispose(): void {
    this.stop();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) {
        const map = (mat as THREE.SpriteMaterial).map;
        map?.dispose();
        mat.dispose();
      }
    });
    for (const p of this.cache.values())
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    this.material.dispose();
    this.cache.clear();
  }
}
