// Geração procedural da Lua: relevo, mares de basalto, crateras, minérios e objetos soltos.
import { createNoise2D, createNoise3D, mulberry32, hash2, fbm2, smoothstep, type Noise2D, type Noise3D } from '../core/noise';
import { BEDROCK, REGOLITH, ROCK, BASALT, ICE, IRON, CRYSTAL, type BlockId } from '../data/blocks';
import type { PropType } from '../data/props';

export const CS = 16; // largura do chunk (x, z)
export const CH = 48; // altura do mundo
export const LANDER = { x: -3, z: -2, r: 1.7 };
/** onde o astronauta começa e renasce: dentro da área pressurizada do módulo */
export const SPAWN = { x: 1.0, z: 0.8 };

export const idx = (x: number, y: number, z: number): number => x + z * CS + y * CS * CS;

/** objeto solto gerado pelo terreno */
export interface PropSpawn {
  wx: number;
  wz: number;
  y: number;
  type: PropType;
  variant: number;
  rot: number;
  scale: number;
  /** chave para o salvamento; objetos naturais usam "wx,wz" */
  key?: string;
}

export interface GeneratedChunk {
  data: Uint8Array;
  props: PropSpawn[];
  maxY: number;
}

/** o que o mundo precisa de um gerador de terreno (a Lua e Marte têm o seu) */
export interface TerrainGen {
  readonly seed: number;
  /** altura (não arredondada) do planalto do pouso */
  readonly spawnH: number;
  column(x: number, z: number): { h: number; mare: number };
  generate(cx: number, cz: number): GeneratedChunk;
}

/** Relevo de crateras numa grade: cada célula pode ter uma cratera (fundo côncavo e borda levantada). */
export function craterField(seed: number, x: number, z: number, cell: number, minR: number, maxR: number, prob: number, salt: number): number {
  const s = seed + salt;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let h = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const gx = cx + dx, gz = cz + dz;
      if (hash2(gx, gz, s) > prob) continue;
      const px = (gx + 0.15 + 0.7 * hash2(gx, gz, s + 1)) * cell;
      const pz = (gz + 0.15 + 0.7 * hash2(gx, gz, s + 2)) * cell;
      const r = minR + (maxR - minR) * Math.pow(hash2(gx, gz, s + 3), 2);
      const d = Math.hypot(x - px, z - pz) / r;
      if (d > 1.8) continue;
      if (d < 1) h -= r * 0.4 * (1 - d * d);
      h += Math.exp(-(((d - 1) / 0.24) ** 2)) * r * 0.17;
    }
  }
  return h;
}

export class Terrain implements TerrainGen {
  readonly seed: number;
  /** altura (não arredondada) do planalto do pouso */
  readonly spawnH: number;
  private readonly nBase: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nMare: Noise2D;
  private readonly nIron: Noise3D;
  private readonly nCrystal: Noise3D;

  constructor(seed: number) {
    this.seed = seed;
    const r = mulberry32(seed);
    this.nBase = createNoise2D(r);
    this.nDetail = createNoise2D(r);
    this.nMare = createNoise2D(r);
    this.nIron = createNoise3D(r);
    this.nCrystal = createNoise3D(r);
    this.spawnH = this.rawHeight(0, 0).h;
  }

  private craters(x: number, z: number, cell: number, minR: number, maxR: number, prob: number, salt: number): number {
    return craterField(this.seed, x, z, cell, minR, maxR, prob, salt);
  }

  rawHeight(x: number, z: number): { h: number; mare: number } {
    let h = 17 + fbm2(this.nBase, x * 0.008, z * 0.008, 4) * 7 + this.nDetail(x * 0.035, z * 0.035) * 1.4;
    const mare = smoothstep(0.12, 0.42, fbm2(this.nMare, x * 0.0045 + 50, z * 0.0045, 3));
    h -= mare * 3.5;
    h += this.craters(x, z, 64, 8, 28, 0.55, 101);
    h += this.craters(x, z, 22, 2.2, 7, 0.5, 202);
    return { h, mare };
  }

  // altura do bloco do topo (inteiro) e fator de "mar"
  column(x: number, z: number): { h: number; mare: number } {
    const raw = this.rawHeight(x, z);
    const mare = raw.mare;
    let h = raw.h;
    const d = Math.hypot(x, z);
    if (d < 9) h = this.spawnH + (h - this.spawnH) * smoothstep(5, 9, d); // planalto do pouso
    return { h: Math.max(3, Math.min(CH - 6, Math.floor(h))), mare };
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const data = new Uint8Array(CS * CS * CH);
    const props: PropSpawn[] = [];
    let maxY = 0;
    const s = this.seed;
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const wx = cx * CS + lx, wz = cz * CS + lz;
        const { h, mare } = this.column(wx, wz);
        if (h > maxY) maxY = h;
        const isMare = mare > 0.5;
        for (let y = 0; y <= h; y++) {
          const depth = h - y;
          let id: BlockId;
          if (y === 0) id = BEDROCK;
          else if (depth === 0) id = h <= 9 ? ICE : isMare ? BASALT : REGOLITH;
          else if (depth <= 2) id = isMare ? BASALT : h <= 9 && depth === 1 ? ICE : REGOLITH;
          else id = y < 5 ? BASALT : ROCK;
          if (y > 1 && id !== ICE) {
            const bias = depth === 0 ? 0.1 : 0;
            if (this.nIron(wx * 0.11, y * 0.14, wz * 0.11) > 0.6 + bias) id = IRON;
            else if (depth > 0 && this.nCrystal(wx * 0.17, y * 0.2, wz * 0.17) > 0.74) id = CRYSTAL;
          }
          data[idx(lx, y, lz)] = id;
        }
        // objetos soltos
        const r = hash2(wx, wz, s + 77);
        if (r < 0.013 && Math.hypot(wx - LANDER.x, wz - LANDER.z) > 4) {
          const t = hash2(wx, wz, s + 78);
          const type: PropType = t < 0.42 ? 'boulder' : t < 0.68 ? 'ilmenite' : t < 0.86 ? 'crystal' : 'gold';
          props.push({
            wx, wz, y: h + 1, type,
            variant: Math.floor(hash2(wx, wz, s + 79) * 3),
            rot: hash2(wx, wz, s + 80) * Math.PI * 2,
            scale: 0.8 + hash2(wx, wz, s + 81) * 0.45,
          });
        }
      }
    }
    return { data, props, maxY };
  }
}
