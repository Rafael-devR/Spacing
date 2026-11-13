import { describe, expect, it } from 'vitest';
import { Scene, Vector3, PerspectiveCamera } from 'three';
import { AIR, GLASSY_BASALT, ICE } from '../src/data/blocks';
import { CAVES, rampY } from '../src/world/caves';
import { CH, CS, HOME_CRATER, ICE_LEVEL, SEA, Terrain, idx } from '../src/world/terrain';
import { SKY_MAX, World } from '../src/world/World';
import { PropFactory } from '../src/render/models';
import { createMaterials } from '../src/render/materials';
import { CUT, CUT_SWITCH, isCut, setCut, skip } from '../src/render/cutaway';
import { randomSeed, seedFromSearch } from '../src/core/seed';

const SEEDS = [1, 42, 987654, 20261111, 314159];

describe('semente do mundo', () => {
  it('sorteia um inteiro positivo de 31 bits', () => {
    expect(randomSeed(() => 0)).toBe(1);
    expect(randomSeed(() => 0.999999999)).toBeLessThanOrEqual(2147483647);
    expect(new Set(Array.from({ length: 20 }, () => randomSeed())).size).toBeGreaterThan(15);
  });

  it('lê a semente do endereço e recusa lixo', () => {
    expect(seedFromSearch('?semente=123')).toBe(123);
    expect(seedFromSearch('?planeta=lua&semente=7')).toBe(7);
    expect(seedFromSearch('')).toBeNull();
    expect(seedFromSearch('?semente=abc')).toBeNull();
    expect(seedFromSearch('?semente=0')).toBeNull();
    expect(seedFromSearch('?semente=99999999999')).toBeNull();
  });
});

describe('mundo da Lua: qualquer semente dá um começo jogável', () => {
  it.each(SEEDS)('semente %i: o pouso é uma planície sem cavernas embaixo', (seed) => {
    const t = new Terrain(seed);
    const h = t.column(0, 0).h;
    expect(h).toBe(Math.floor(SEA + 1.5));
    for (let z = -12; z <= 12; z += 3) for (let x = -12; x <= 12; x += 3) expect(Math.abs(t.column(x, z).h - h)).toBeLessThanOrEqual(2);
    // nenhum vazio debaixo da base e do módulo
    for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const c = t.generate(cx, cz);
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const wx = cx * CS + x, wz = cz * CS + z;
        if (Math.hypot(wx, wz) > CAVES.clear - 2) continue;
        for (let y = 1; y <= t.column(wx, wz).h; y++) expect(c.data[idx(x, y, z)]).not.toBe(AIR);
      }
    }
  });

  it.each(SEEDS)('semente %i: há gelo numa cratera perto do pouso', (seed) => {
    const t = new Terrain(seed);
    const { x, z } = t.homeCrater;
    expect(Math.hypot(x, z)).toBeCloseTo(HOME_CRATER.dist, 0);
    expect(t.column(x, z).h).toBeLessThanOrEqual(ICE_LEVEL);
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = t.generate(cx, cz);
    expect(c.data[idx(x - cx * CS, t.column(x, z).h, z - cz * CS)]).toBe(ICE);
  });

  it.each(SEEDS)('semente %i: há uma entrada de caverna perto do pouso, e dá para descer a rampa andando', (seed) => {
    const t = new Terrain(seed);
    const p = t.caves.homePit();
    expect(p).not.toBeNull();
    if (!p) return;
    expect(Math.hypot(p.x, p.z)).toBeLessThan(110);
    const chunks = new Map<string, Uint8Array>();
    const block = (x: number, y: number, z: number): number => {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = cx + ',' + cz;
      let d = chunks.get(k);
      if (!d) chunks.set(k, (d = t.generate(cx, cz).data));
      return d[idx(x - cx * CS, y, z - cz * CS)];
    };
    // ao longo do eixo da rampa: sempre há 3 blocos livres de altura, e o chão nunca sobe ou desce mais de 1 por passo
    let last = -1;
    for (let s = 0; s < p.len - 2; s++) {
      const x = Math.floor(p.x + 0.5 + p.dx * s), z = Math.floor(p.z + 0.5 + p.dz * s);
      let floor = (last < 0 ? p.floor : last) + 2;
      while (floor > 1 && block(x, floor, z) === AIR) floor--;
      for (let y = floor + 1; y <= floor + 3; y++) expect(block(x, y, z), `s=${s} y=${y}`).toBe(AIR);
      if (last >= 0) expect(Math.abs(floor - last), `degrau em s=${s}`).toBeLessThanOrEqual(1);
      last = floor;
    }
    // a rampa termina ao ar livre
    const ex = Math.floor(p.x + 0.5 + p.dx * (p.len - 2)), ez = Math.floor(p.z + 0.5 + p.dz * (p.len - 2));
    expect(rampY(p.floor, p.len - 2)).toBeGreaterThanOrEqual(t.column(ex, ez).h - 1);
  });

  it('as cavernas ocupam parte do subsolo, com tubos de parede vítrea, e quase todas se ligam à superfície', () => {
    const t = new Terrain(42);
    const R = 5, N = 2 * R * CS;
    const g = new Uint8Array(N * N * CH);
    const hs = new Int16Array(N * N);
    for (let cz = -R; cz < R; cz++) for (let cx = -R; cx < R; cx++) {
      const c = t.generate(cx, cz);
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
        const X = (cx + R) * CS + x, Z = (cz + R) * CS + z;
        hs[X + Z * N] = t.column(cx * CS + x, cz * CS + z).h;
        for (let y = 0; y < CH; y++) g[X + Z * N + y * N * N] = c.data[idx(x, y, z)];
      }
    }
    let cave = 0, solid = 0, glassy = 0;
    for (let i = 0; i < N * N; i++) for (let y = 1; y <= hs[i]; y++) {
      const b = g[i + y * N * N];
      if (b === AIR) cave++; else solid++;
      if (b === GLASSY_BASALT) glassy++;
    }
    expect(cave / (cave + solid)).toBeGreaterThan(0.03);
    expect(cave / (cave + solid)).toBeLessThan(0.15);
    expect(glassy).toBeGreaterThan(500);
    // inundação a partir do céu
    const seen = new Uint8Array(g.length), q: number[] = [];
    for (let i = 0; i < N * N; i++) { seen[i + (CH - 1) * N * N] = 1; q.push(i + (CH - 1) * N * N); }
    let reach = 0;
    while (q.length) {
      const j = q.pop()!;
      const y = Math.floor(j / (N * N)), r = j - y * N * N, z = Math.floor(r / N), x = r - z * N;
      if (y <= hs[r]) reach++;
      for (const k of [x > 0 ? j - 1 : -1, x < N - 1 ? j + 1 : -1, z > 0 ? j - N : -1, z < N - 1 ? j + N : -1, y > 0 ? j - N * N : -1, y < CH - 1 ? j + N * N : -1])
        if (k >= 0 && !g[k] && !seen[k]) { seen[k] = 1; q.push(k); }
    }
    expect(reach / cave).toBeGreaterThan(0.7);
  });
});

describe('luz do céu', () => {
  function worldAt(seed: number, x: number, z: number): World {
    const mats = createMaterials();
    const w = new World(new Scene(), seed, mats.terrain, new PropFactory(mats.props));
    w.radius = 1;
    w.update(x, z, 99, 0);
    return w;
  }

  it('na superfície é cheia; dentro do tubo, longe da entrada, é escuro; furar o teto ilumina', () => {
    const t = new Terrain(42);
    const p = t.caves.homePit()!;
    // um ponto do tubo a ~14 blocos da entrada (ao longo do tubo, perpendicular à rampa)
    let x = p.x, z = p.z, found = false;
    const w = worldAt(42, p.x, p.z);
    for (const sign of [1, -1]) {
      x = p.x; z = p.z;
      let n = 0;
      for (; n < 16; n++) {
        const nx = Math.round(p.x - p.dz * sign * (n + 1)), nz = Math.round(p.z + p.dx * sign * (n + 1));
        if (w.getBlock(nx, p.floor + 1, nz) !== AIR) break;
        x = nx; z = nz;
      }
      if (n >= 12) { found = true; break; }
    }
    expect(found).toBe(true);
    const top = w.topY(x, z);
    expect(w.skyAt(x, top + 1, z)).toBe(1);
    expect(w.roofed(x, p.floor + 1, z)).toBe(true);
    const before = w.skyAt(x, p.floor + 1, z);
    expect(before).toBeLessThan(0.5);
    // abre um poço reto até o tubo: a luz chega ao chão
    const edits: [number, number, number, number][] = [];
    for (let y = p.floor + 1; y <= top; y++) edits.push([x, y, z, AIR]);
    w.setBlocks(edits);
    expect(w.roofed(x, p.floor + 1, z)).toBe(false);
    expect(w.skyAt(x, p.floor + 1, z)).toBe(1);
    expect(SKY_MAX).toBe(12);
  });
});

describe('corte da caverna', () => {
  it('desligado (padrão): não corta nada e a mira não pula', () => {
    expect(CUT_SWITCH.enabled).toBe(false);
    const cam = new PerspectiveCamera(30, 2, 1, 400);
    const feet = new Vector3(10, 20, 10);
    cam.position.set(20, 32.8, 20);
    cam.lookAt(10, 20.8, 10);
    cam.updateMatrixWorld();
    setCut(cam, feet, 1);
    expect(CUT.uCutR.value).toBe(0);
    expect(isCut(new Vector3(10, 26, 10))).toBe(false); // o teto continua visível
    expect(skip(new Vector3(10, 26, 10), new Vector3(0, -1, 0))).toBe(0);
  });

  it('ligado: corta só o que está entre a câmera e o astronauta, e a mira pula a parte cortada', () => {
    CUT_SWITCH.enabled = true;
    try {
      geometry();
    } finally {
      CUT_SWITCH.enabled = false;
    }
  });
});

function geometry(): void {
    const cam = new PerspectiveCamera(30, 2, 1, 400);
    const feet = new Vector3(10, 20, 10);
    cam.position.set(10 + 10, 20 + 0.8 + 12, 10 + 10);
    cam.lookAt(10, 20.8, 10);
    cam.updateMatrixWorld();
    setCut(cam, feet, 0);
    expect(isCut(new Vector3(10, 26, 10))).toBe(false); // corte fechado
    setCut(cam, feet, 1);
    expect(CUT.uCutR.value).toBeGreaterThan(5);
    expect(isCut(new Vector3(10, 26, 10))).toBe(true); // teto sobre a cabeça
    expect(isCut(new Vector3(13, 20, 13))).toBe(false); // chão na frente
    expect(isCut(new Vector3(11.5, 22.5, 11.5))).toBe(true); // parede na frente, à altura do corpo
    expect(isCut(new Vector3(4, 22, 4))).toBe(false); // parede atrás
    expect(isCut(new Vector3(40, 30, -20))).toBe(false); // fora do cilindro
    // um raio da câmera para o astronauta: sai do corte perto dele, nunca depois
    const dir = new Vector3(10, 20.8, 10).sub(cam.position).normalize();
    const t = skip(cam.position.clone(), dir);
    const d = cam.position.distanceTo(new Vector3(10, 20.8, 10));
    expect(t).toBeGreaterThan(d - 3);
    expect(t).toBeLessThan(d);
    expect(isCut(cam.position.clone().addScaledVector(dir, t + 0.01))).toBe(false);
}
