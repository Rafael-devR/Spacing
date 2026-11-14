// Exportador de vetores dourados (docs/design/PORTE_RUST.md, "paridade"). Roda o código TypeScript do jogo e grava em
// native/golden/*.json resultados de referência que o Rust (native/spacing-core) precisa reproduzir: ruído, gerador de mundo
// (Lua e Marte), cavernas, malha e luz dos chunks, animação do astronauta.
//
//   npm run golden
//
// Mudou o gerador ou a malha no TS? Rode de novo e ajuste o Rust até os testes de lá passarem.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createNoise2D, createNoise3D, hash2, hash3, mulberry32 } from '../../src/core/noise';
import { Terrain, CS, CH, idx } from '../../src/world/terrain';
import { MarsTerrain } from '../../src/world/marsTerrain';
import { ChunkMesher } from '../../src/world/chunkMesher';
import type { TerrainGen } from '../../src/world/terrain';
import { AstronautAnimator, JOINTS, type AnimState } from '../../src/render/astronautAnim';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../native/golden');

/** FNV-1a de 32 bits (igual ao native/spacing-core/src/golden.rs) */
function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SEEDS = [12345, 777, 2147480000];
/** chunks: o pouso, a cratera de gelo, entradas de caverna, longe */
const CHUNKS: [number, number][] = [[0, 0], [-1, -1], [1, -1], [3, 2], [-4, 3], [2, -5], [-6, -6], [8, 1], [-3, 9], [12, -12]];

function write(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + '\n');
}

function chunksOf(gen: TerrainGen): unknown[] {
  return CHUNKS.map(([cx, cz]) => {
    const g = gen.generate(cx, cz);
    return {
      cx, cz, maxY: g.maxY, fnv: fnv(g.data),
      props: g.props.map((p) => [p.wx, p.wz, p.y, p.type, p.variant, Number(p.rot.toFixed(9)), Number(p.scale.toFixed(9))]),
    };
  });
}

function columnsOf(gen: TerrainGen): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < 64; i++) {
    const x = Math.round(Math.sin(i * 12.9898) * 300), z = Math.round(Math.cos(i * 78.233) * 300);
    const c = gen.column(x, z);
    out.push([x, z, c.h, Number(c.mare.toFixed(9))]);
  }
  return out;
}

test('ruído', () => {
  const r = mulberry32(42);
  const rand = Array.from({ length: 20 }, () => r());
  const n2 = createNoise2D(mulberry32(7));
  const n3 = createNoise3D(mulberry32(7));
  const pts = Array.from({ length: 40 }, (_, i) => [Math.sin(i) * 37.3, Math.cos(i * 1.7) * 21.9, i * 0.73 - 9]);
  write('noise.json', {
    rand,
    // os pontos vão no arquivo: o seno do V8 e o do Rust podem diferir no último bit
    pts,
    hash2: pts.map(([x, z], i) => hash2(Math.floor(x), Math.floor(z), i * 31)),
    hash3: pts.map(([x, y, z], i) => hash3(Math.floor(x), Math.floor(y), Math.floor(z), i * 17 - 200)),
    noise2: pts.map(([x, y]) => n2(x, y)),
    noise3: pts.map(([x, y, z]) => n3(x, y, z)),
  });
});

test('gerador de mundo', () => {
  write('terrain.json', {
    CS, CH,
    lua: SEEDS.map((seed) => {
      const t = new Terrain(seed);
      return { seed, spawnH: t.spawnH, homeCrater: t.homeCrater, home: [t.caves.homeX, t.caves.homeZ], columns: columnsOf(t), chunks: chunksOf(t) };
    }),
    marte: SEEDS.map((seed) => {
      const t = new MarsTerrain(seed);
      return { seed, spawnH: t.spawnH, columns: columnsOf(t), chunks: chunksOf(t) };
    }),
  });
});

test('malha e luz', () => {
  const out: unknown[] = [];
  for (const [planet, Gen] of [['lua', Terrain], ['marte', MarsTerrain]] as const) {
    const gen = new Gen(12345);
    for (const [cx, cz] of [[0, 0], [3, 2], [-4, 3]]) {
      const nb = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(gen.generate(cx + dx, cz + dz));
      const light = new Uint8Array(CS * CS * CH);
      const m = new ChunkMesher().build(nb, cx * CS, cz * CS, light);
      const sum = (a: Float32Array): number => {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * ((i % 7) + 1);
        return s;
      };
      out.push({
        planet, cx, cz, verts: m.position.length / 3, lightFnv: fnv(light),
        pos: sum(m.position), nor: sum(m.normal), col: sum(m.color), edge: sum(m.edge), sky: sum(m.sky),
        // os primeiros vértices, para achar a diferença quando a soma não bate
        first: Array.from(m.position.slice(0, 36)), firstCol: Array.from(m.color.slice(0, 36)), firstSky: Array.from(m.sky.slice(0, 12)),
      });
    }
  }
  write('mesh.json', out);
  void idx;
});

test('animação do astronauta', () => {
  const a = new AstronautAnimator();
  const frames: unknown[] = [];
  const dt = 1 / 60;
  for (let f = 0; f < 600; f++) {
    const t = f * dt;
    const s: AnimState = {
      speed: f < 120 ? 0 : f < 300 ? Math.min(4.6, (f - 120) * 0.05) : f < 420 ? 1.5 : 0,
      maxSpeed: 4.6, onGround: !(f >= 330 && f < 370), vy: f >= 330 && f < 370 ? 7.4 - (f - 330) * 0.25 : 0,
      turn: Math.sin(t) * 2, mining: f >= 450 && f < 520, holding: f > 200, dead: f >= 580,
    };
    if (f === 330) a.jump();
    if (f === 370) a.landed(0.6);
    if (f === 430) a.play('place');
    if (f === 540) a.play('eat');
    const p = a.update(dt, s);
    if (f % 10 === 9) frames.push({ f, hipY: p.hipY, stretch: p.stretch, j: JOINTS.map((n) => [p.j[n].x, p.j[n].y, p.j[n].z]) });
  }
  write('anim.json', { joints: JOINTS, frames });
});
