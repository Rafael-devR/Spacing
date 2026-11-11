// Geração procedural da Lua: relevo, mares de basalto, crateras, minérios e objetos soltos.
import { createNoise2D, createNoise3D, mulberry32, hash2, hash3, fbm2, smoothstep } from './noise.js';
import { BEDROCK, REGOLITH, ROCK, BASALT, ICE, IRON, CRYSTAL } from './blocks.js';

export const CS = 16; // largura do chunk (x, z)
export const CH = 48; // altura do mundo
export const LANDER = { x: -3, z: -2, r: 1.7 };

export const idx = (x, y, z) => x + z * CS + y * CS * CS;

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    const r = mulberry32(seed);
    this.nBase = createNoise2D(r);
    this.nDetail = createNoise2D(r);
    this.nMare = createNoise2D(r);
    this.nIron = createNoise3D(r);
    this.nCrystal = createNoise3D(r);
    this.spawnH = this.rawHeight(0, 0).h;
  }

  craters(x, z, cell, minR, maxR, prob, salt) {
    const s = this.seed + salt;
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

  rawHeight(x, z) {
    let h = 17 + fbm2(this.nBase, x * 0.008, z * 0.008, 4) * 7 + this.nDetail(x * 0.035, z * 0.035) * 1.4;
    const mare = smoothstep(0.12, 0.42, fbm2(this.nMare, x * 0.0045 + 50, z * 0.0045, 3));
    h -= mare * 3.5;
    h += this.craters(x, z, 64, 8, 28, 0.55, 101);
    h += this.craters(x, z, 22, 2.2, 7, 0.5, 202);
    return { h, mare };
  }

  // altura do bloco do topo (inteiro) e fator de "mar"
  column(x, z) {
    let { h, mare } = this.rawHeight(x, z);
    const d = Math.hypot(x, z);
    if (d < 9) h = this.spawnH + (h - this.spawnH) * smoothstep(5, 9, d); // planalto do pouso
    return { h: Math.max(3, Math.min(CH - 6, Math.floor(h))), mare };
  }

  generate(cx, cz) {
    const data = new Uint8Array(CS * CS * CH);
    const props = [];
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
          let id;
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
          const type = t < 0.42 ? 'boulder' : t < 0.68 ? 'ilmenite' : t < 0.86 ? 'crystal' : 'gold';
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

export function blockVariation(wx, y, wz) {
  return 0.93 + 0.12 * hash3(wx, y, wz, 9);
}
