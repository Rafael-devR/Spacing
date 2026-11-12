// Geração procedural de Marte (docs/design/MARTE.md): planície de poeira vermelha com crateras, dunas de areia escura,
// um cânion com paredes em camadas e veios de gipsita, gelo sob a poeira e um vulcão com caldeira e rios de lava.
import { createNoise2D, createNoise3D, fbm2, hash2, mulberry32, smoothstep, type Noise2D, type Noise3D } from '../core/noise';
import {
  BEDROCK, DARK_SAND, GYPSUM, HEMATITE, ICE, LAVA, MARS_DUST, MARS_ROCK, OLIVINE, SEDIMENT, VOLCANIC, type BlockId,
} from '../data/blocks';
import type { PropType } from '../data/props';
import { CH, CS, LANDER, craterField, idx, type GeneratedChunk, type PropSpawn, type TerrainGen } from './terrain';

/** o vulcão: centro, raio da base, altura do cone acima da planície, raio da caldeira e do lago de lava */
export const VOLCANO = { x: -85, z: 75, r: 52, peak: 22, caldera: 10, lake: 7 } as const;
/** o cânion: atravessa o mapa ao sul do pouso, serpenteando */
export const CANYON = { z0: -62, amp: 24, freq: 0.011, width: 13, floor: 6 } as const;
/** direções (radianos) dos rios de lava que descem do vulcão */
const LAVA_RIVERS = [0.5, 2.35, 4.3];
const PLAIN = 16;

export interface MarsColumn {
  h: number;
  /** "mare" do gerador da Lua; aqui é a força das dunas (0..1) */
  mare: number;
  /** 0..1: quanto o ponto está dentro do vulcão (1 = topo) */
  volcano: number;
  lava: boolean;
  /** 0..1: profundidade relativa no cânion (1 = fundo) */
  canyon: number;
  /** perto do cânion: as camadas de rocha ficam à mostra nas paredes */
  strata: boolean;
}

export class MarsTerrain implements TerrainGen {
  readonly seed: number;
  readonly spawnH: number;
  private readonly nBase: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nDune: Noise2D;
  private readonly nIce: Noise2D;
  private readonly nHem: Noise3D;
  private readonly nOli: Noise3D;
  private readonly nGyp: Noise3D;

  constructor(seed: number) {
    this.seed = seed;
    const r = mulberry32(seed);
    this.nBase = createNoise2D(r);
    this.nDetail = createNoise2D(r);
    this.nDune = createNoise2D(r);
    this.nIce = createNoise2D(r);
    this.nHem = createNoise3D(r);
    this.nOli = createNoise3D(r);
    this.nGyp = createNoise3D(r);
    this.spawnH = this.raw(0, 0).h;
  }

  /** centro do cânion na coordenada x */
  canyonZ(x: number): number {
    return CANYON.z0 + Math.sin(x * CANYON.freq) * CANYON.amp + this.nDetail(x * 0.01, 7.3) * 6;
  }

  private riverAt(x: number, z: number, dv: number): boolean {
    if (dv <= VOLCANO.caldera + 0.5 || dv > VOLCANO.r * 0.78) return false;
    const a = Math.atan2(z - VOLCANO.z, x - VOLCANO.x);
    for (let i = 0; i < LAVA_RIVERS.length; i++) {
      const wobble = this.nDetail(dv * 0.07, i * 13.1) * 0.35;
      let da = a - (LAVA_RIVERS[i] + wobble);
      da = Math.atan2(Math.sin(da), Math.cos(da));
      // o rio afina descendo a encosta
      const half = 1.25 - (dv / VOLCANO.r) * 0.6;
      if (Math.abs(da) * dv < half) return true;
    }
    return false;
  }

  private raw(x: number, z: number): MarsColumn {
    let h = PLAIN + fbm2(this.nBase, x * 0.007, z * 0.007, 4) * 6 + this.nDetail(x * 0.04, z * 0.04) * 1.2;
    const dune = smoothstep(0.18, 0.48, fbm2(this.nDune, x * 0.005 + 30, z * 0.005, 3));
    // dunas: partes baixas com cristas paralelas (o vento sopra sempre do mesmo lado)
    h -= dune * 2.5;
    h += dune * (Math.sin(x * 0.42 + z * 0.18 + this.nDetail(x * 0.02, z * 0.02) * 4) * 0.5 + 0.5) * 1.7;
    h += craterField(this.seed, x, z, 80, 9, 26, 0.45, 101);
    h += craterField(this.seed, x, z, 26, 2, 6, 0.35, 202);

    // cânion: paredes em degraus (as camadas aparecem)
    const cz = this.canyonZ(x);
    const w = CANYON.width + this.nDetail(x * 0.02, 3.1) * 3;
    const d = Math.abs(z - cz);
    let canyon = 0;
    if (d < w) {
      canyon = smoothstep(w, w * 0.35, d);
      const target = h * (1 - canyon) + CANYON.floor * canyon;
      h = CANYON.floor + Math.round((target - CANYON.floor) / 2) * 2;
    }
    const strata = d < w + 9;

    // vulcão: cone largo (escudo), caldeira no topo, lago e rios de lava
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    let volcano = 0;
    let lava = false;
    if (dv < VOLCANO.r) {
      const k = 1 - dv / VOLCANO.r;
      volcano = k;
      const under = h * (1 - k) + PLAIN * k;
      h = under + Math.pow(k, 1.25) * VOLCANO.peak;
      if (dv < VOLCANO.caldera) {
        const rim = PLAIN + Math.pow(1 - VOLCANO.caldera / VOLCANO.r, 1.25) * VOLCANO.peak;
        h = rim - 6 * (1 - (dv / VOLCANO.caldera) ** 2);
        if (dv < VOLCANO.lake) lava = true;
      } else if (this.riverAt(x, z, dv)) {
        h -= 1;
        lava = true;
      }
    }
    return { h, mare: dune, volcano, lava, canyon, strata };
  }

  /** a coluna inteira (com o planalto do pouso), em blocos inteiros */
  marsColumn(x: number, z: number): MarsColumn {
    const c = this.raw(x, z);
    let h = c.h;
    const d = Math.hypot(x, z);
    if (d < 9) h = this.spawnH + (h - this.spawnH) * smoothstep(5, 9, d);
    c.h = Math.max(3, Math.min(CH - 6, Math.floor(h)));
    return c;
  }

  column(x: number, z: number): { h: number; mare: number } {
    const c = this.marsColumn(x, z);
    return { h: c.h, mare: c.mare };
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const data = new Uint8Array(CS * CS * CH);
    const props: PropSpawn[] = [];
    let maxY = 0;
    const s = this.seed;
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const wx = cx * CS + lx, wz = cz * CS + lz;
        const c = this.marsColumn(wx, wz);
        const h = c.h;
        if (h > maxY) maxY = h;
        const volc = c.volcano > 0.12;
        const dune = c.mare > 0.55 && !volc;
        const iceHere = !volc && this.nIce(wx * 0.02, wz * 0.02) > 0.35;
        for (let y = 0; y <= h; y++) {
          const depth = h - y;
          let id: BlockId;
          if (y === 0) id = BEDROCK;
          else if (depth === 0) {
            if (c.lava) id = LAVA;
            else if (volc) id = c.volcano < 0.35 && hash2(wx, wz, s + 5) < 0.3 ? MARS_DUST : VOLCANIC;
            else if (c.canyon > 0.75) id = DARK_SAND;
            else if (dune) id = DARK_SAND;
            else if (c.canyon > 0.05) id = (y >> 1) & 1 ? SEDIMENT : MARS_ROCK;
            else id = MARS_DUST;
          } else if (depth <= 2) {
            if (volc) id = VOLCANIC;
            else if (dune) id = DARK_SAND;
            else if (iceHere && depth === 2) id = ICE;
            else if (c.strata) id = (y >> 1) & 1 ? SEDIMENT : MARS_ROCK;
            else id = MARS_DUST;
          } else if (y < 5 || volc) id = VOLCANIC;
          else id = c.strata ? ((y >> 1) & 1 ? SEDIMENT : MARS_ROCK) : MARS_ROCK;

          if (y > 1 && id !== LAVA && id !== ICE && id !== DARK_SAND) {
            if ((id === MARS_ROCK || id === SEDIMENT || id === MARS_DUST) && this.nHem(wx * 0.11, y * 0.14, wz * 0.11) > (depth === 0 ? 0.68 : 0.6)) id = HEMATITE;
            else if (id === VOLCANIC && depth > 0 && this.nOli(wx * 0.15, y * 0.2, wz * 0.15) > (volc ? 0.6 : 0.72)) id = OLIVINE;
            // veios de gipsita: finos e quase verticais, nas rochas sedimentares
            else if (id === SEDIMENT && this.nGyp(wx * 0.3, y * 0.06, wz * 0.3) > 0.5) id = GYPSUM;
          }
          data[idx(lx, y, lz)] = id;
        }
        // objetos soltos: pedras e esferas de hematita (nunca na lava nem na caldeira)
        const r = hash2(wx, wz, s + 77);
        if (r < 0.014 && !c.lava && c.volcano < 0.8 && Math.hypot(wx - LANDER.x, wz - LANDER.z) > 4) {
          const t = hash2(wx, wz, s + 78);
          const type: PropType = volc || t < 0.62 ? 'marsBoulder' : 'blueberries';
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
