// A mesma cena e a mesma rampa do protótipo em Rust (src/bench.rs e src/scene.rs), em Three.js como o jogo: um Mesh por
// pedaço (uma chamada de desenho), material único com shader próprio igual ao do Rust, nada descartado. Os números têm de
// bater com os de lá; se mudar um, mude o outro.
import * as THREE from 'three';

// as mesmas constantes e a mesma busca de src/bench.rs (versão 2): sobe 60% por passo até falhar e divide ao meio, em 3 rodadas
const WARMUP_S = 0.4, MEASURE_S = 1.0, GALLOP = 1.6, BISECT_MAX = 6, ROUNDS = 3, MS_60 = 17.5, MS_120 = 8.8, MIN_HZ_120 = 100;
const DRAW_START = 16, DRAW_MAX = 16384, DRAW_CUBES = 32;
const TRIS_CHUNKS = 16, TRIS_START = 512, TRIS_MAX = 131072, CUBE_TRIS = 12;
const CHUNK = 8, SPACING = 10, DRAW_MESHES = 64;

type Kind = 0 | 1 | 2 | 3; // chamadas 60, chamadas 120, triângulos 60, triângulos 120
const isDraws = (k: Kind): boolean => k < 2;
const is120 = (k: Kind): boolean => k === 1 || k === 3;
const targetMs = (k: Kind): number => (is120(k) ? MS_120 : MS_60);
const kStart = (k: Kind): number => (isDraws(k) ? DRAW_START : TRIS_START);
const kMax = (k: Kind): number => (isDraws(k) ? DRAW_MAX : TRIS_MAX);
const at60 = (k: Kind): Kind => (isDraws(k) ? 0 : 2);
const amount = (k: Kind, level: number): number => (isDraws(k) ? level : TRIS_CHUNKS * level * CUBE_TRIS);

type Phase = 'refresh' | 'search' | 'done';
type Results = (number | null)[];

class Ramp {
  phase: Phase = 'refresh';
  kind: Kind = 0;
  round = 0;
  level = 0;
  private t = 0;
  private sum = 0;
  private frames = 0;
  lastMs = 0;
  hz = 0;
  no120 = false;
  private lo = 0;
  private hi: number | null = null;
  private iter = 0;
  private cur: Results = [null, null, null, null];
  rounds: Results[] = [];

  load(): [number, number] {
    if (this.phase !== 'search') return [0, 0];
    return isDraws(this.kind) ? [this.level, DRAW_CUBES] : [TRIS_CHUNKS, this.level];
  }

  triangles(): number {
    const [d, c] = this.load();
    return d * c * CUBE_TRIS;
  }

  /** [mediana, menor, maior] do nível que coube em `k`, entre as rodadas terminadas e a atual */
  stats(k: Kind): [number, number, number] | null {
    const v = this.rounds.map((r) => r[k]).filter((x): x is number => x !== null);
    if (this.cur[k] !== null) v.push(this.cur[k] as number);
    if (!v.length) return null;
    v.sort((a, b) => a - b);
    return [v[Math.floor(v.length / 2)], v[0], v[v.length - 1]];
  }

  private begin(k: Kind): void {
    this.phase = 'search';
    this.kind = k;
    this.lo = 0;
    this.hi = null;
    this.iter = 0;
    let start = kStart(k);
    if (is120(k)) start = Math.max(start, Math.floor((this.cur[at60(k)] ?? 0) / 6));
    this.level = Math.min(start, kMax(k));
  }

  private nextAfter(k: Kind): void {
    if (k === 3) {
      this.rounds.push(this.cur);
      this.cur = [null, null, null, null];
      this.round++;
      this.level = 0;
      this.phase = this.round >= ROUNDS ? 'done' : 'refresh';
      return;
    }
    const n = (k + 1) as Kind;
    if (is120(n) && this.no120) {
      this.cur[n] = null;
      this.nextAfter(n);
    } else this.begin(n);
  }

  private finish(k: Kind): void {
    this.cur[k] = this.lo;
    this.nextAfter(k);
  }

  private bisectOrFinish(k: Kind): void {
    const hi = this.hi ?? this.level;
    if (this.iter >= BISECT_MAX || hi - this.lo <= Math.max(1, Math.floor(this.lo / 32))) this.finish(k);
    else this.level = this.lo + Math.floor((hi - this.lo) / 2);
  }

  private step(k: Kind, avg: number): void {
    const pass = avg <= targetMs(k);
    if (this.hi === null) {
      if (pass) {
        this.lo = this.level;
        if (this.level >= kMax(k)) this.finish(k);
        else this.level = Math.min(kMax(k), Math.ceil(this.level * GALLOP));
      } else {
        this.hi = this.level;
        this.iter = 0;
        this.bisectOrFinish(k);
      }
    } else {
      if (pass) this.lo = this.level;
      else this.hi = this.level;
      this.iter++;
      this.bisectOrFinish(k);
    }
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
    if (this.phase === 'refresh') {
      this.hz = 1000 / avg;
      this.no120 = this.hz < MIN_HZ_120;
      this.begin(0);
    } else this.step(this.kind, avg);
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
const fmtStat = (r: Ramp, k: Kind): string => {
  const st = r.stats(k);
  if (!st) return '-';
  const f = (l: number): string => (isDraws(k) ? String(l) : fmtTris(amount(k, l)));
  return st[1] === st[2] ? f(st[0]) : `${f(st[0])} (${f(st[1])}-${f(st[2])})`;
};

let ramp = new Ramp();
const text = document.getElementById('texto') as HTMLElement;
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = (dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL2').slice(0, 40);
addEventListener('pointerup', () => {
  if (started && ramp.phase === 'done') {
    ramp = new Ramp();
    setLoad(0, 0);
  }
});

let t0 = 0;
let last = 0;
let started = false;
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!started) return;
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
  const done = r.phase === 'done';
  const lines = [
    'SPACING - TESTE THREE.JS (NAVEGADOR)',
    `GRAFICOS: ${gpu}   TELA: ${s.x}X${s.y} (${((s.x * s.y) / 1e6).toFixed(2).replace('.', ',')} MP)`,
    r.hz ? `TAXA DA TELA: ${Math.round(r.hz)} HZ   ${done ? 'RESULTADO' : `RODADA ${r.round + 1}/${ROUNDS}`}` : 'MEDINDO A TELA...',
  ];
  if (r.hz && r.no120 && !done) lines.push('MEXA O DEDO NA TELA PARA ELA IR A 120 HZ');
  if (r.phase === 'search') {
    lines.push(
      isDraws(r.kind)
        ? `> CHAMADAS DE DESENHO: ${r.level}   (${r.lastMs.toFixed(1).replace('.', ',')} MS)`
        : `> TRIANGULOS: ${fmtTris(r.triangles())}   (${r.lastMs.toFixed(1).replace('.', ',')} MS)`,
    );
  }
  if (r.hz) {
    lines.push(`CHAMADAS 60 FPS: ${fmtStat(r, 0)}`, `CHAMADAS 120 FPS: ${fmtStat(r, 1)}`);
    lines.push(`TRIANGULOS 60 FPS: ${fmtStat(r, 2)}`, `TRIANGULOS 120 FPS: ${fmtStat(r, 3)}`);
  }
  if (done) lines.push(r.no120 ? 'TELA A 60 HZ: SEM 120 FPS. REPITA MEXENDO O DEDO' : 'TOQUE PARA REPETIR');
  text.textContent = lines.join('\n');
}
requestAnimationFrame(frame);

// começa só depois do toque, em tela cheia (como o app nativo): sem a barra do navegador a imagem tem o mesmo tamanho nas três versões
const go = document.getElementById('comecar') as HTMLButtonElement;
go.addEventListener(
  'click',
  async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* sem tela cheia (o navegador não deixou): segue assim mesmo */
    }
    go.remove();
    await new Promise((r) => setTimeout(r, 500)); // a tela termina de mudar de tamanho
    renderer.setSize(innerWidth, innerHeight);
    t0 = performance.now();
    last = 0;
    started = true;
    text.hidden = false;
  },
  { once: true },
);
