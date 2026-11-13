// O fundo da tela de título (docs/design/TITULO.md): céu estrelado e o planeta escolhido (Lua ou Marte), feitos de cubos no Blender
// (tools/models/planet_moon.py, planet_mars.py). Cinematográfico e barato: estrelas como pontos que cintilam, duas nebulosas muito
// fracas, o sol fora da tela à esquerda (o planeta fica com o lado da noite no escuro), um contorno de luz na borda, e em Marte uma
// atmosfera fina. O planeta gira devagar e a câmera respira. Nada do jogo é carregado aqui.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlanetId } from '../../data/planets';
import marsUrl from '../../assets/models/planet_mars.glb?url';
import moonUrl from '../../assets/models/planet_moon.glb?url';

const URL_OF: Record<PlanetId, string> = { lua: moonUrl, marte: marsUrl };
/** raio do planeta na cena (a câmera fica a 58) */
const RADIUS = 16;

/** como cada planeta aparece */
const LOOK: Record<PlanetId, { tilt: number; spin: number; rim: string; atmo: string | null; atmoPower: number; nebula: [string, string]; sun: string }> = {
  lua: { tilt: 0.32, spin: 0.03, rim: '#9fb4ff', atmo: '#8fa6ff', atmoPower: 0.25, nebula: ['#2a2f6e', '#3b1f5c'], sun: '#fff3e0' },
  marte: { tilt: 0.44, spin: 0.04, rim: '#ffb08a', atmo: '#ff9b6a', atmoPower: 0.9, nebula: ['#4a1f2e', '#20306a'], sun: '#fff0e2' },
};

/** estrelas: pontos com tamanho, cor e ritmo de cintilar próprios */
function stars(n: number): THREE.Points {
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    // esfera grande em volta da câmera
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 380 + Math.random() * 60;
    const s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    // poucas estrelas grandes, muitas pequenas
    const k = Math.random();
    size[i] = k > 0.985 ? 3.4 + Math.random() * 1.6 : k > 0.9 ? 2 + Math.random() : 0.9 + Math.random() * 0.9;
    seed[i] = Math.random() * 100;
    const t = Math.random();
    c.set(t < 0.15 ? '#ffd9b0' : t < 0.32 ? '#b9cbff' : '#ffffff');
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
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
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
function glowTexture(color: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sprite(tex: THREE.Texture, opacity: number, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(scale);
  return s;
}

/** brilho de borda (fresnel): uma casca um pouco maior, só a parte de trás, mais forte na beira */
function rimShell(radius: number, color: string, power: number, strength: number): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uStrength: { value: strength }, uSun: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = normalize(w.xyz);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower; uniform float uStrength; uniform vec3 uSun;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), uPower);
        // só acende do lado do sol (um pouco além, como luz que contorna a atmosfera)
        float lit = smoothstep(-0.35, 0.6, dot(vW, uSun));
        gl_FragColor = vec4(uColor * f * uStrength * lit, f * lit);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), m);
}

/** raio médio dos vértices do modelo (centro na origem) */
function meanRadius(root: THREE.Object3D): number {
  let sum = 0, n = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      sum += v.fromBufferAttribute(p, i).length();
      n++;
    }
  });
  return n ? sum / n : 1;
}

export class TitleScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1200);
  private readonly stars = stars(2600);
  private readonly holder = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly sun = new THREE.DirectionalLight('#ffffff', 2.2);
  /** luz de contorno vinda de trás, do outro lado: desenha a borda da noite */
  private readonly back = new THREE.DirectionalLight('#9fb4ff', 1.1);
  private readonly fill = new THREE.HemisphereLight('#6a78b0', '#1a1420', 1.0);
  private readonly nebulae: THREE.Sprite[] = [];
  private readonly sunGlow: THREE.Sprite;
  private planet: THREE.Object3D | null = null;
  private rim: THREE.Mesh | null = null;
  private atmo: THREE.Mesh | null = null;
  private id: PlanetId | null = null;
  private loading = 0;
  private raf = 0;
  private t0 = performance.now();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<PlanetId, THREE.Object3D>();
  /** chamado quando o planeta aparece pela primeira vez */
  onReady: (() => void) | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color('#020309');
    this.scene.add(this.stars, this.holder, this.sun, this.back, this.fill);
    this.holder.add(this.spin);
    // o sol fica fora da tela, à esquerda, em cima e à frente: a maior parte do disco acende e a noite fica na borda da direita
    this.sun.position.set(-0.62, 0.48, 0.62).multiplyScalar(100);
    this.back.position.set(0.9, 0.15, -0.7).multiplyScalar(100);
    this.sunGlow = sprite(glowTexture('rgba(255,236,210,0.9)'), 0.18, 260);
    this.sunGlow.position.set(-300, 110, -160);
    this.scene.add(this.sunGlow);
    for (let i = 0; i < 2; i++) {
      const n = sprite(glowTexture('#ffffff'), 0.12, 520);
      n.position.set(i ? 260 : -120, i ? -160 : 140, -420);
      this.nebulae.push(n);
      this.scene.add(n);
    }
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
    // o raio do modelo (cubos do Blender) vira RADIUS unidades aqui
    // (raio médio da superfície: os montes e o vulcão não entram na conta, senão a atmosfera descola do chão)
    this.spin.scale.setScalar(RADIUS / meanRadius(model));
    this.holder.rotation.set(look.tilt, 0, -0.18);
    this.sun.color.set(look.sun);
    this.back.color.set(look.rim);
    this.disposeShell(this.rim);
    this.disposeShell(this.atmo);
    this.rim = rimShell(RADIUS * 1.02, look.rim, 3.0, 1.2);
    this.holder.add(this.rim);
    this.atmo = look.atmo ? rimShell(RADIUS * 1.08, look.atmo, 2.2, look.atmoPower) : null;
    if (this.atmo) this.holder.add(this.atmo);
    const sunDir = this.sun.position.clone().normalize();
    for (const s of [this.rim, this.atmo]) if (s) ((s.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3).copy(sunDir);
    this.nebulae[0].material.color.set(look.nebula[0]);
    this.nebulae[1].material.color.set(look.nebula[1]);
    this.onReady?.();
    this.onReady = null;
  }

  private disposeShell(m: THREE.Mesh | null): void {
    if (!m) return;
    m.removeFromParent();
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
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

  private frame(): void {
    const t = (performance.now() - this.t0) / 1000;
    const r = this.renderer;
    const el = r.domElement;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    // deitado, o planeta fica à direita e grande (o menu à esquerda); em pé, embaixo
    const portrait = h > w;
    cam.fov = portrait ? 44 : 32;
    cam.updateProjectionMatrix();
    // grande, cortado pela borda: o planeta é o cenário, não um objeto no meio da tela
    if (portrait) {
      this.holder.scale.setScalar(0.7);
      this.holder.position.set(3, -17, 0);
    } else {
      this.holder.scale.setScalar(1);
      this.holder.position.set(16 * Math.min(1.35, w / h / 1.6), -5, 0);
    }
    // a câmera respira devagar
    cam.position.set(Math.sin(t * 0.07) * 1.6, 1.2 + Math.sin(t * 0.05) * 0.8, 58);
    cam.lookAt(portrait ? 0 : 3, portrait ? -3 : 0, 0);
    this.spin.rotation.y = t * (this.id ? LOOK[this.id].spin : 0.04);
    this.stars.rotation.y = t * 0.004;
    const sm = this.stars.material as THREE.ShaderMaterial;
    sm.uniforms.uTime.value = t;
    sm.uniforms.uScale.value = r.getPixelRatio();
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
