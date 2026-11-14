// A mesma cena e a mesma rampa do protótipo em Rust (src/bench.rs e src/scene.rs), em Three.js como o jogo: um Mesh por
// pedaço (uma chamada de desenho), material único com shader próprio igual ao do Rust, nada descartado. Os números têm de
// bater com os de lá; se mudar um, mude o outro.
import * as THREE from 'three';

const WARMUP_S = 0.6, MEASURE_S = 1.5, STEP = 1.25, MS_60 = 17.5, MS_120 = 8.8;
const DRAW_START = 16, DRAW_MAX = 16384, DRAW_CUBES = 32;
const TRIS_CHUNKS = 16, TRIS_START = 512, TRIS_MAX = 131072, CUBE_TRIS = 12;
const CHUNK = 8, SPACING = 10, DRAW_MESHES = 64;

type Phase = 'refresh' | 'draws' | 'tris' | 'done';

class Ramp {
  phase: Phase = 'refresh';
  level = 0;
  private t = 0;
  private sum = 0;
  private frames = 0;
  lastMs = 0;
  hz = 0;
  draws60 = 0;
  draws120 = 0;
  tris60 = 0;
  tris120 = 0;

  load(): [number, number] {
    if (this.phase === 'draws') return [this.level, DRAW_CUBES];
    if (this.phase === 'tris') return [TRIS_CHUNKS, this.level];
    return [0, 0];
  }

  triangles(): number {
    const [d, c] = this.load();
    return d * c * CUBE_TRIS;
  }

  /** um quadro de `dt` segundos; `true` quando a carga mudou */
  frame(dt: number): boolean {
    if (this.phase === 'done') return false;
    this.t += dt;
    if (this.t < WARMUP_S) return false;
    this.sum += dt * 1000;
    this.frames++;
    if (this.t < WARMUP_S + MEASURE_S) return false;
    const avg = this.sum / this.frames;
    this.lastMs = avg;
    this.t = this.sum = this.frames = 0;
    const next = (l: number, max: number): number => Math.min(max, Math.ceil(l * STEP));
    if (this.phase === 'refresh') {
      this.hz = 1000 / avg;
      this.phase = 'draws';
      this.level = DRAW_START;
    } else if (this.phase === 'draws') {
      if (avg <= MS_120) this.draws120 = this.level;
      const n = next(this.level, DRAW_MAX);
      if (avg <= MS_60) {
        this.draws60 = this.level;
        if (n !== this.level) {
          this.level = n;
          return true;
        }
      }
      this.phase = 'tris';
      this.level = TRIS_START;
    } else if (this.phase === 'tris') {
      const tris = this.triangles();
      if (avg <= MS_120) this.tris120 = tris;
      const n = next(this.level, TRIS_MAX);
      if (avg <= MS_60) {
        this.tris60 = tris;
        if (n !== this.level) {
          this.level = n;
          return true;
        }
      }
      this.phase = 'done';
      this.level = 0;
    }
    return true;
  }
}

const FACES: [number[], number[][]][] = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/** `n` cubos num bloco de lado ⌈∛n⌉ cabendo em CHUNK unidades (igual a scene::cubes) */
function cubes(n: number, variant: number): THREE.BufferGeometry {
  const side = Math.max(1, Math.ceil(Math.cbrt(n)));
  const cell = CHUNK / side, size = cell * 0.8, shift = (variant % 7) * 0.01;
  const pos = new Float32Array(n * 24 * 3), nrm = new Int8Array(n * 24 * 4), idx = new Uint32Array(n * 36);
  let v = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const o = [(i % side) * cell - CHUNK / 2 + shift, (Math.floor(i / side) % side) * cell - CHUNK / 2, Math.floor(i / (side * side)) * cell - CHUNK / 2];
    for (const [nr, corners] of FACES) {
      const base = v;
      for (const c of corners) {
        pos.set([o[0] + c[0] * size, o[1] + c[1] * size, o[2] + c[2] * size], v * 3);
        nrm.set([nr[0] * 127, nr[1] * 127, nr[2] * 127, 0], v * 4);
        v++;
      }
      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], k);
      k += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 4, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const chunkPos = (i: number, n: number): [number, number, number] => {
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const half = ((side - 1) * SPACING) / 2;
  return [(i % side) * SPACING - half, 0, Math.floor(i / side) * SPACING - half];
};
const cameraDistance = (n: number): number => Math.max(1, Math.ceil(Math.sqrt(n))) * SPACING * 1.15 + 18;

// o mesmo shader do Rust (src/scene.wgsl)
const material = new THREE.ShaderMaterial({
  uniforms: { uLight: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vTint;
    void main() {
      vN = normal;
      vec3 off = modelMatrix[3].xyz;
      float k = fract(sin(dot(off.xz, vec2(12.9898, 78.233))) * 43758.5453);
      vTint = mix(vec3(0.72, 0.68, 0.62), vec3(0.85, 0.45, 0.28), k);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uLight;
    varying vec3 vN; varying vec3 vTint;
    void main() {
      float l = max(dot(normalize(vN), uLight), 0.0);
      gl_FragColor = vec4(vTint * (0.25 + 0.75 * l), 1.0);
    }`,
});
material.side = THREE.FrontSide;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(new THREE.Color(0.02, 0.02, 0.05));
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
const drawGeos = Array.from({ length: DRAW_MESHES }, (_, v) => cubes(DRAW_CUBES, v));
let trisGeo: { cubes: number; geo: THREE.BufferGeometry } | null = null;
let draws = 0;

function setLoad(d: number, c: number): void {
  scene.clear();
  draws = Math.min(d, DRAW_MAX);
  if (!d) return;
  if (c !== DRAW_CUBES && trisGeo?.cubes !== c) {
    trisGeo?.geo.dispose();
    trisGeo = { cubes: c, geo: cubes(c, 0) };
  }
  for (let i = 0; i < draws; i++) {
    const geo = c !== DRAW_CUBES && trisGeo ? trisGeo.geo : drawGeos[i % DRAW_MESHES];
    const m = new THREE.Mesh(geo, material);
    m.position.set(...chunkPos(i, draws));
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
  }
}

const fmtTris = (t: number): string => (!t ? '-' : t >= 1e6 ? `${(t / 1e6).toFixed(1).replace('.', ',')} MI` : `${Math.floor(t / 1000)} MIL`);
const fmtDraws = (d: number): string => (d ? String(d) : '-');

let ramp = new Ramp();
const text = document.getElementById('texto') as HTMLElement;
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = (dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL2').slice(0, 40);
addEventListener('pointerup', () => {
  if (ramp.phase === 'done') {
    ramp = new Ramp();
    setLoad(0, 0);
  }
});

const t0 = performance.now();
let last = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  if (dt > 0 && ramp.frame(Math.min(dt, 0.5))) setLoad(...ramp.load());
  const t = (now - t0) / 1000;
  const dist = cameraDistance(Math.max(1, draws));
  camera.aspect = innerWidth / innerHeight;
  camera.far = dist * 4;
  camera.position.set(Math.cos(t * 0.2) * dist, dist * 0.75, Math.sin(t * 0.2) * dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const r = ramp;
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  const lines = [
    'SPACING - TESTE THREE.JS (NAVEGADOR)',
    `GRAFICOS: ${gpu}   TELA: ${s.x}X${s.y}`,
    r.hz ? `TAXA DA TELA: ${Math.round(r.hz)} HZ` : 'MEDINDO A TELA...',
  ];
  if (r.phase === 'draws') lines.push(`> CHAMADAS DE DESENHO: ${r.level}   (${r.lastMs.toFixed(1).replace('.', ',')} MS)`);
  if (r.phase === 'tris') lines.push(`> TRIANGULOS: ${fmtTris(r.triangles())}   (${r.lastMs.toFixed(1).replace('.', ',')} MS)`);
  if (r.phase === 'done') lines.push('RESULTADO');
  if (r.phase !== 'refresh') lines.push(`CHAMADAS DE DESENHO  60 FPS: ${fmtDraws(r.draws60)}   120 FPS: ${fmtDraws(r.draws120)}`);
  if (r.phase === 'tris' || r.phase === 'done') lines.push(`TRIANGULOS  60 FPS: ${fmtTris(r.tris60)}   120 FPS: ${fmtTris(r.tris120)}`);
  if (r.phase === 'done') lines.push('TOQUE PARA REPETIR');
  text.textContent = lines.join('\n');
}
requestAnimationFrame(frame);
