// Geração procedural da Lua (docs/design/MUNDO.md): relevo com montanhas, mares de basalto, crateras, camadas de rocha,
// minérios por profundidade, cavernas (world/caves.ts) e objetos soltos.
import { createNoise2D, createNoise3D, mulberry32, hash2, fbm2, smoothstep, type Noise2D, type Noise3D } from '../core/noise';
import {
  AIR, ANORTHOSITE, BASALT, BEDROCK, BRECCIA, CRYSTAL, GLASSY_BASALT, GOLD_ORE, HULL, ICE, ILMENITE_ORE, IRON, NORITE, REGOLITH, ROCK,
  type BlockId,
} from '../data/blocks';
import { applyBasePad, inPad, isLanding } from './basePad';
import { Caves, LINING, OPEN } from './caves';
import type { PropType } from '../data/props';

export const CS = 16; // largura do chunk (x, z)
export const CH = 96; // altura do mundo
/** versão do gerador de cada planeta: mudar o gerador muda este número, e o mundo dos salvamentos antigos é refeito */
export const WORLD_GEN = { lua: 3, marte: 2 } as const;
/** Lua: nível médio do terreno (há ~40 blocos para baixo e ~50 para cima) */
export const SEA = 44;
/** Lua: colunas com a superfície até esta altura ficam na sombra eterna e guardam gelo */
export const ICE_LEVEL = SEA - 7;
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
export function craterField(
  seed: number, x: number, z: number, cell: number, minR: number, maxR: number, prob: number, salt: number, depth = 0.4, rim = 0.17,
): number {
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
      h += crater(Math.hypot(x - px, z - pz) / r, r, depth, rim);
    }
  }
  return h;
}

function crater(d: number, r: number, depth: number, rim: number): number {
  if (d > 1.8) return 0;
  return (d < 1 ? -r * depth * (1 - d * d) : 0) + Math.exp(-(((d - 1) / 0.24) ** 2)) * r * rim;
}

/** a cratera com gelo garantida perto do pouso: distância do centro e raio */
export const HOME_CRATER = { dist: 66, r: 22, depth: 0.52 } as const;

export class Terrain implements TerrainGen {
  readonly seed: number;
  /** altura (não arredondada) do planalto do pouso */
  readonly spawnH: number;
  readonly caves: Caves;
  /** centro da cratera com gelo garantida (do lado oposto à entrada de caverna garantida) */
  readonly homeCrater: { x: number; z: number };
  private readonly nBase: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nMare: Noise2D;
  private readonly nHigh: Noise2D;
  private readonly nRidge: Noise2D;
  private readonly nOre: Noise3D;

  constructor(seed: number) {
    this.seed = seed;
    const r = mulberry32(seed);
    this.nBase = createNoise2D(r);
    this.nDetail = createNoise2D(r);
    this.nMare = createNoise2D(r);
    this.nHigh = createNoise2D(r);
    this.nRidge = createNoise2D(r);
    this.nOre = createNoise3D(r);
    this.spawnH = SEA + 1.5;
    this.caves = new Caves(seed, r, CH, (x, z) => this.column(x, z).h);
    this.homeCrater = { x: -Math.round((this.caves.homeX / Math.hypot(this.caves.homeX, this.caves.homeZ)) * HOME_CRATER.dist), z: -Math.round((this.caves.homeZ / Math.hypot(this.caves.homeX, this.caves.homeZ)) * HOME_CRATER.dist) };
  }

  /** relevo natural: `high` (0..1) é quanto o ponto está nas terras altas (montanhas de anortosito) */
  rawHeight(x: number, z: number): { h: number; mare: number; high: number } {
    let h = SEA + fbm2(this.nBase, x * 0.006, z * 0.006, 4) * 8 + this.nDetail(x * 0.035, z * 0.035) * 1.4;
    const mare = smoothstep(0.12, 0.42, fbm2(this.nMare, x * 0.0045 + 50, z * 0.0045, 3));
    h -= mare * 4;
    // terras altas: maciços com cristas (o ruído dobrado em |n| faz as arestas)
    const high = smoothstep(0.08, 0.5, fbm2(this.nHigh, x * 0.0028 - 20, z * 0.0028, 3)) * (1 - mare);
    if (high > 0) {
      const ridge = 1 - Math.abs(this.nRidge(x * 0.011, z * 0.011));
      h += high * (7 + ridge * ridge * 21 + this.nDetail(x * 0.02 + 5, z * 0.02) * 3);
    }
    h += craterField(this.seed, x, z, 210, 34, 62, 0.42, 303, 0.2, 0.1);
    h += craterField(this.seed, x, z, 64, 8, 28, 0.55, 101);
    h += craterField(this.seed, x, z, 22, 2.2, 7, 0.5, 202);
    return { h, mare, high };
  }

  // altura do bloco do topo (inteiro), fator de "mar" e de terras altas
  column(x: number, z: number): { h: number; mare: number; high: number } {
    const raw = this.rawHeight(x, z);
    let h = raw.h;
    const d = Math.hypot(x, z);
    // em volta do pouso o relevo é amansado: toda semente começa numa planície, com o planalto do módulo no meio
    if (d < 48) {
      const plain = this.spawnH + this.nDetail(x * 0.035, z * 0.035) * 1.2;
      h = plain + (h - plain) * smoothstep(14, 48, d);
      if (d < 9) h = this.spawnH + (h - this.spawnH) * smoothstep(5, 9, d);
    }
    const k = 1 - smoothstep(14, 48, d);
    // a cratera com gelo garantida: o relevo em volta dela também é amansado, para o fundo ficar sempre na sombra
    const c = this.homeCrater;
    const dc = Math.hypot(x - c.x, z - c.z) / HOME_CRATER.r;
    if (dc < 1.9) {
      const kc = 1 - smoothstep(1.1, 1.9, dc);
      h += (this.spawnH - h) * kc;
      h += crater(dc, HOME_CRATER.r, HOME_CRATER.depth, 0.12);
    }
    // a plataforma plana da base (world/basePad.ts): por último, para ganhar do relevo e das crateras
    h = applyBasePad(h, x, z, Math.floor(this.spawnH));
    return { h: Math.max(4, Math.min(CH - 6, Math.floor(h))), mare: raw.mare * (1 - k), high: raw.high * (1 - k) };
  }

  /** a rocha de um ponto, sem minérios nem cavernas; `wob` (-1..1) ondula as camadas de coluna para coluna */
  private strata(y: number, h: number, mare: boolean, high: number, wob: number): BlockId {
    const depth = h - y;
    if (h <= ICE_LEVEL && depth <= 1) return ICE;
    const peak = high > 0.5 && h >= SEA + 13;
    if (depth <= 2) {
      if (mare) return BASALT;
      // nos picos a rocha clara fica à mostra; mais embaixo o regolito cobre
      if (peak && (depth > 0 || h >= SEA + 18)) return ANORTHOSITE;
      return REGOLITH;
    }
    if (y < 21 + wob * 3) return NORITE;
    if (mare && depth <= 9) return BASALT;
    if (depth <= 6 + wob * 2) return BRECCIA;
    if (high > 0.35 && y > SEA - 6 + wob * 3) return ANORTHOSITE;
    return ROCK;
  }

  /**
   * Minérios, todos do mesmo ruído (um cálculo por bloco). Na ponta de cima ficam os de ferro: minério de ferro nas rochas
   * claras e ilmenita (ferro com titânio) nas escuras, como na Lua de verdade. Na ponta de baixo ficam os bolsões de
   * cristal, e no coração dos bolsões mais fundos, o ouro.
   */
  private ore(id: BlockId, wx: number, y: number, wz: number, depth: number): BlockId {
    if (id === ICE) return id;
    const n = this.nOre(wx * 0.12, y * 0.15, wz * 0.12);
    const dark = id === BASALT || id === GLASSY_BASALT || id === NORITE;
    if (n > 0) {
      if (dark) return n > 0.68 ? ILMENITE_ORE : id;
      return n > (depth === 0 ? 0.7 : 0.6) ? IRON : id;
    }
    if (id === GLASSY_BASALT || depth === 0) return id;
    if (id === NORITE && n < -0.86) return GOLD_ORE;
    // cristais: mais comuns no fundo
    return n < (y < SEA - 14 ? -0.74 : -0.79) ? CRYSTAL : id;
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const data = new Uint8Array(CS * CS * CH);
    const props: PropSpawn[] = [];
    let maxY = 0;
    const s = this.seed;
    const cols: { h: number; mare: number; high: number }[] = [];
    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const c = this.column(cx * CS + lx, cz * CS + lz);
        cols.push(c);
        if (c.h > maxY) maxY = c.h;
      }
    const caves = this.caves;
    caves.beginChunk(cx * CS, cz * CS, CS, maxY);
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const wx = cx * CS + lx, wz = cz * CS + lz;
        const { h, mare, high } = cols[lx + lz * CS];
        const isMare = mare > 0.5;
        const carve = caves.beginColumn(wx, wz, h);
        const wob = this.nDetail(wx * 0.05 + 3, wz * 0.05 - 8);
        data[idx(lx, 0, lz)] = BEDROCK;
        for (let y = 1; y <= h; y++) {
          const cave = carve ? caves.at(y) : 0;
          if (cave === OPEN) continue;
          let id = this.strata(y, h, isMare, high, wob);
          if (cave === LINING && id !== ICE) id = GLASSY_BASALT;
          if (y === h && isLanding(wx, wz)) id = HULL; // a sacada do degrau da base: metal, sem minerar
          data[idx(lx, y, lz)] = y > 1 ? this.ore(id, wx, y, wz, h - y) : id;
        }
        // objetos soltos (ficam no chão que sobrou: World.spawnProp usa o topo real da coluna)
        const r = hash2(wx, wz, s + 77);
        if (r < 0.013 && Math.hypot(wx - LANDER.x, wz - LANDER.z) > 4 && !inPad(wx, wz) && data[idx(lx, h, lz)] !== AIR) {
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
