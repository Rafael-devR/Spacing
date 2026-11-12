// Cavernas da Lua (docs/design/MUNDO.md): tubos de lava longos, túneis que se cruzam, salões e as entradas
// (rampas de desabamento e claraboias). Tudo sai da semente: o mesmo bloco dá sempre a mesma resposta.
//
// - Tubo de lava: a linha onde um ruído 2D passa por zero. É um corredor comprido, de chão plano e teto em arco.
// - Túneis: onde dois ruídos 3D passam por zero ao mesmo tempo (uma curva no espaço). Ligam tudo, como no Minecraft.
// - Salões: onde um terceiro ruído 3D, bem lento, fica alto.
// - Entradas: uma grade de pontos, cada um encostado no tubo mais próximo. Dali sobe uma rampa até a superfície
//   (dá para descer e subir andando) e, em parte deles, uma claraboia (o teto do tubo que desabou).
import { createNoise2D, createNoise3D, hash2, smoothstep, type Noise2D, type Noise3D, type Rand } from '../core/noise';

/** resposta de `Caves.at` */
export const SOLID = 0;
export const OPEN = 1;
/** rocha na parede de um tubo de lava: vira basalto vítreo */
export const LINING = 2;

export const CAVES = {
  /** sem cavernas a menos disto do pouso (a base e o módulo ficam em chão firme); cresce até `clearTo` */
  clear: 22,
  clearTo: 34,
  /** nada é escavado abaixo disto (fica um piso sobre a rocha-mãe) */
  floor: 3,
  tube: { freq: 0.0055, halfWidth: 4.4, up: 3.7, down: 1.6, yFreq: 0.004, yAmp: 6 },
  tunnel: { freq: 0.021, squash: 1.9, radius: 0.105, roof: 6 },
  hall: { freq: 0.013, squash: 2.6, level: 0.6, roof: 9 },
  /** entradas: lado da célula da grade, chance por célula, largura e inclinação da rampa (sobe 1 a cada 2, depois de `flat` blocos planos) */
  pit: { cell: 104, chance: 0.75, ramp: 2.7, slope: 0.5, maxRamp: 80, flat: 3 },
  /** a entrada garantida perto do pouso fica a esta distância */
  home: 46,
} as const;

/** altura do chão da rampa a `s` blocos do meio do tubo: plana enquanto está dentro dele, depois sobe */
export function rampY(floor: number, s: number): number {
  return floor + Math.max(0, s - CAVES.pit.flat) * CAVES.pit.slope;
}

/** passo da grade onde os ruídos 3D são calculados (o resto é interpolado) */
const GX = 4;
const GY = 2;

export interface Pit {
  /** ponto do tubo onde a rampa chega */
  x: number;
  z: number;
  /** chão do tubo ali */
  floor: number;
  /** direção da rampa (unitária) e comprimento no plano */
  dx: number;
  dz: number;
  len: number;
  /** raio da claraboia no teto do tubo (0 = sem claraboia) e altura da superfície acima dela */
  sky: number;
  top: number;
}

interface Span {
  lo: number;
  hi: number;
}

export class Caves {
  private readonly nTube: Noise2D;
  private readonly nTubeY: Noise2D;
  private readonly nMask: Noise2D;
  private readonly nEnt: Noise2D;
  private readonly nA: Noise3D;
  private readonly nB: Noise3D;
  private readonly nHall: Noise3D;
  private readonly pits = new Map<string, Pit | null>();
  /** ponto por onde um tubo passa sempre (entrada garantida perto do pouso) */
  readonly homeX: number;
  readonly homeZ: number;
  private readonly homeBias: number;

  // grade do chunk atual
  private ox = 0;
  private oz = 0;
  private gy = 0;
  private gA = new Float32Array(0);
  private gB = new Float32Array(0);
  private gH = new Float32Array(0);
  private chunkPits: Pit[] = [];

  // coluna atual
  private clear = 0;
  private h = 0;
  private lx = 0;
  private lz = 0;
  private tubeW = -1;
  private tubeHalf = 0;
  private tubeY = 0;
  private tunnelTop = 0;
  private readonly spans: Span[] = [];
  private spanCount = 0;

  constructor(
    private readonly seed: number,
    rand: Rand,
    private readonly worldHeight: number,
    /** altura (inteira) da superfície, antes das cavernas */
    private readonly surface: (x: number, z: number) => number,
  ) {
    this.nTube = createNoise2D(rand);
    this.nTubeY = createNoise2D(rand);
    this.nMask = createNoise2D(rand);
    this.nEnt = createNoise2D(rand);
    this.nA = createNoise3D(rand);
    this.nB = createNoise3D(rand);
    this.nHall = createNoise3D(rand);
    const a = hash2(11, 23, seed) * Math.PI * 2;
    this.homeX = Math.round(Math.cos(a) * CAVES.home);
    this.homeZ = Math.round(Math.sin(a) * CAVES.home);
    this.homeBias = this.nTube(this.homeX * CAVES.tube.freq, this.homeZ * CAVES.tube.freq);
  }

  /** campo do tubo: o tubo corre onde isto vale zero. Perto do pouso é empurrado para passar pelo ponto garantido. */
  private tubeField(x: number, z: number): number {
    const dx = x - this.homeX, dz = z - this.homeZ;
    return this.nTube(x * CAVES.tube.freq, z * CAVES.tube.freq) - this.homeBias * Math.exp(-(dx * dx + dz * dz) / 4900);
  }

  /** 0..1: há tubo nesta região? (os tubos têm começo e fim: trechos entupidos) */
  private tubeMask(x: number, z: number): number {
    const near = 1 - smoothstep(90, 130, Math.hypot(x, z));
    return Math.max(near, smoothstep(-0.35, -0.15, this.nMask(x * 0.0021, z * 0.0021)));
  }

  /** altura do meio do tubo */
  tubeLevel(x: number, z: number, base: number): number {
    return base + this.nTubeY(x * CAVES.tube.yFreq, z * CAVES.tube.yFreq) * CAVES.tube.yAmp;
  }

  /** altura de referência dos tubos: bem abaixo do nível médio do terreno */
  private get tubeBase(): number {
    return Math.round(this.worldHeight * 0.29);
  }

  private clearAt(x: number, z: number): number {
    return smoothstep(CAVES.clear, CAVES.clearTo, Math.hypot(x, z));
  }

  // ---------- entradas ----------

  /** Encosta um ponto no tubo mais próximo (Newton no campo do tubo). null = não achou tubo por perto. */
  private snap(x: number, z: number): { x: number; z: number; gx: number; gz: number } | null {
    for (let i = 0; i < 8; i++) {
      const n = this.tubeField(x, z);
      const gx = this.tubeField(x + 1, z) - n;
      const gz = this.tubeField(x, z + 1) - n;
      const g2 = gx * gx + gz * gz;
      if (g2 < 1e-9) return null;
      if (Math.abs(n) < 0.0015) {
        const g = Math.sqrt(g2);
        return { x, z, gx: gx / g, gz: gz / g };
      }
      // passo de Newton, limitado para não pular para outro tubo
      const g = Math.sqrt(g2);
      const step = Math.max(-24, Math.min(24, n / g));
      x -= (gx / g) * step;
      z -= (gz / g) * step;
    }
    return null;
  }

  private buildPit(px: number, pz: number, salt: number, home: boolean): Pit | null {
    const s = this.snap(px, pz);
    if (!s) return null;
    const x = Math.round(s.x), z = Math.round(s.z);
    if (Math.hypot(x, z) < CAVES.clearTo + 6) return null;
    if (this.tubeMask(x, z) < 0.99) return null;
    // o bloco do chão do tubo ali (o mesmo arredondamento de `at`)
    const floor = Math.ceil(this.tubeLevel(x, z, this.tubeBase) - CAVES.tube.down - 0.5) - 1;
    if (this.surface(x, z) - floor < 7) return null; // tubo já quase aberto: não precisa de rampa
    // a rampa sai de lado (perpendicular ao tubo); testa os dois lados e fica com o que chega à superfície
    const first = home ? (s.gx * -x + s.gz * -z > 0 ? 1 : -1) : hash2(x, z, this.seed + salt) < 0.5 ? 1 : -1;
    for (const sign of [first, -first]) {
      const dx = s.gx * sign, dz = s.gz * sign;
      for (let t = 4; t <= CAVES.pit.maxRamp; t++) {
        const ex = x + dx * t, ez = z + dz * t;
        const y = rampY(floor, t);
        if (y < this.surface(Math.round(ex), Math.round(ez)) + 1) continue;
        if (Math.hypot(ex, ez) < CAVES.clear + 4) break; // sairia em cima da base
        const sky = !home && hash2(x, z, this.seed + salt + 1) < 0.6 ? 2.3 + hash2(x, z, this.seed + salt + 2) * 1.6 : home ? 2.6 : 0;
        return { x, z, floor, dx, dz, len: t + 2, sky, top: this.surface(x, z) };
      }
    }
    return null;
  }

  /** a entrada da célula (gx, gz) da grade, ou null */
  private pit(gx: number, gz: number): Pit | null {
    const k = gx + ',' + gz;
    let p = this.pits.get(k);
    if (p !== undefined) return p;
    const c = CAVES.pit.cell;
    const s = this.seed + 900;
    p = null;
    if (hash2(gx, gz, s) < CAVES.pit.chance) {
      p = this.buildPit((gx + 0.2 + 0.6 * hash2(gx, gz, s + 1)) * c, (gz + 0.2 + 0.6 * hash2(gx, gz, s + 2)) * c, 910, false);
    }
    this.pits.set(k, p);
    return p;
  }

  private homePitCache: Pit | null | undefined;
  /** a entrada garantida perto do pouso (null só se o terreno ali não deixar) */
  homePit(): Pit | null {
    if (this.homePitCache === undefined) this.homePitCache = this.buildPit(this.homeX, this.homeZ, 920, true);
    return this.homePitCache;
  }

  /** entradas que podem tocar o retângulo (em blocos) */
  pitsNear(x0: number, z0: number, x1: number, z1: number): Pit[] {
    const c = CAVES.pit.cell, reach = CAVES.pit.maxRamp + 12;
    const out: Pit[] = [];
    const touches = (p: Pit): boolean => {
      const ex = p.x + p.dx * p.len, ez = p.z + p.dz * p.len;
      const m = 12;
      return Math.max(p.x, ex) + m >= x0 && Math.min(p.x, ex) - m <= x1 && Math.max(p.z, ez) + m >= z0 && Math.min(p.z, ez) - m <= z1;
    };
    for (let gz = Math.floor((z0 - reach) / c); gz <= Math.floor((z1 + reach) / c); gz++)
      for (let gx = Math.floor((x0 - reach) / c); gx <= Math.floor((x1 + reach) / c); gx++) {
        const p = this.pit(gx, gz);
        if (p && touches(p)) out.push(p);
      }
    const h = this.homePit();
    if (h && touches(h)) out.push(h);
    return out;
  }

  // ---------- escavação ----------

  /** Prepara um chunk: calcula os ruídos 3D numa grade larga (o resto é interpolado) e separa as entradas dele. */
  beginChunk(ox: number, oz: number, size: number, top: number): void {
    this.ox = ox;
    this.oz = oz;
    const nx = size / GX + 1;
    const ny = Math.ceil(top / GY) + 2;
    this.gy = ny;
    const n = nx * nx * ny;
    if (this.gA.length < n) {
      this.gA = new Float32Array(n);
      this.gB = new Float32Array(n);
      this.gH = new Float32Array(n);
    }
    const { tunnel: T, hall: H } = CAVES;
    let i = 0;
    for (let iy = 0; iy < ny; iy++) {
      const y = iy * GY;
      for (let iz = 0; iz < nx; iz++) {
        const z = oz + iz * GX;
        for (let ix = 0; ix < nx; ix++, i++) {
          const x = ox + ix * GX;
          this.gA[i] = this.nA(x * T.freq, y * T.freq * T.squash, z * T.freq);
          this.gB[i] = this.nB(x * T.freq + 40, y * T.freq * T.squash, z * T.freq - 17);
          this.gH[i] = this.nHall(x * H.freq, y * H.freq * H.squash, z * H.freq);
        }
      }
    }
    this.chunkPits = this.pitsNear(ox, oz, ox + size - 1, oz + size - 1);
  }

  /** Prepara uma coluna do chunk atual. `h` é a altura da superfície. Devolve false se nada é escavado nela. */
  beginColumn(wx: number, wz: number, h: number): boolean {
    this.h = h;
    this.lx = wx - this.ox;
    this.lz = wz - this.oz;
    this.clear = this.clearAt(wx, wz);
    this.tubeW = -1;
    this.spanCount = 0;
    if (this.clear <= 0) return false;

    // túneis: só chegam à superfície onde o ruído das entradas deixa
    const ent = this.nEnt(wx * 0.011, wz * 0.011);
    this.tunnelTop = h - CAVES.tunnel.roof * (1 - smoothstep(0.28, 0.5, ent));

    // tubo de lava
    const n = this.tubeField(wx, wz);
    if (Math.abs(n) < 0.16) {
      const gx = this.tubeField(wx + 1, wz) - n, gz = this.tubeField(wx, wz + 1) - n;
      const w = Math.abs(n) / (Math.hypot(gx, gz) || 1e-6);
      const half = CAVES.tube.halfWidth * (0.82 + 0.3 * this.nEnt(wx * 0.03 + 9, wz * 0.03)) * this.tubeMask(wx, wz) * this.clear;
      if (half > 1.2 && w < half + 1.6) {
        this.tubeW = w;
        this.tubeHalf = half;
        this.tubeY = this.tubeLevel(wx, wz, this.tubeBase);
      }
    }

    // entradas
    for (const p of this.chunkPits) {
      const rx = wx + 0.5 - (p.x + 0.5), rz = wz + 0.5 - (p.z + 0.5);
      const s = rx * p.dx + rz * p.dz;
      const w = Math.abs(rx * p.dz - rz * p.dx);
      if (s > -2.5 && s < p.len && w < CAVES.pit.ramp) {
        const fy = rampY(p.floor, s);
        this.span(Math.floor(fy) + 1, fy + 4.2 - w * w * 0.28);
      }
      if (p.sky > 0) {
        const d = Math.hypot(rx, rz);
        // funil nos 4 blocos de cima; embaixo, um poço reto até o teto do tubo
        if (d < p.sky + 5) this.span(d < p.sky ? p.floor + 1 : p.top - 4 + (d - p.sky) / 1.2, this.worldHeight);
      }
    }
    return true;
  }

  private span(lo: number, hi: number): void {
    const s = this.spans[this.spanCount] ?? (this.spans[this.spanCount] = { lo: 0, hi: 0 });
    s.lo = lo;
    s.hi = hi;
    this.spanCount++;
  }

  // pesos da interpolação na altura atual (iguais para os três ruídos)
  private si = 0;
  private sx = 0;
  private sz = 0;
  private sy = 0;

  private locate(y: number): void {
    const nx = 16 / GX + 1;
    const fx = this.lx / GX, fz = this.lz / GX, fy = y / GY;
    const ix = Math.min(nx - 2, Math.floor(fx)), iz = Math.min(nx - 2, Math.floor(fz)), iy = Math.min(this.gy - 2, Math.floor(fy));
    this.sx = fx - ix;
    this.sz = fz - iz;
    this.sy = fy - iy;
    this.si = ix + iz * nx + iy * nx * nx;
  }

  private sample(g: Float32Array): number {
    const nx = 16 / GX + 1;
    const i = this.si, dz = nx, dy = nx * nx, tx = this.sx;
    const a = g[i] + (g[i + 1] - g[i]) * tx;
    const b = g[i + dz] + (g[i + dz + 1] - g[i + dz]) * tx;
    const c = g[i + dy] + (g[i + dy + 1] - g[i + dy]) * tx;
    const d = g[i + dy + dz] + (g[i + dy + dz + 1] - g[i + dy + dz]) * tx;
    const lo = a + (b - a) * this.sz, hi = c + (d - c) * this.sz;
    return lo + (hi - lo) * this.sy;
  }

  /** O bloco (coluna atual, altura y) é rocha, vazio ou parede de tubo? Só vale depois de `beginColumn` devolver true. */
  at(y: number): number {
    if (y < CAVES.floor) return SOLID;
    for (let i = 0; i < this.spanCount; i++) if (y >= this.spans[i].lo && y <= this.spans[i].hi) return OPEN;
    let lining = false;
    if (this.tubeW >= 0) {
      const dy = y + 0.5 - this.tubeY;
      const { up, down } = CAVES.tube;
      if (dy >= -down) {
        const u = this.tubeW / this.tubeHalf, v = dy / up;
        if (u * u + v * v < 1) return OPEN;
      }
      const u = this.tubeW / (this.tubeHalf + 1.6), v = dy / (dy > 0 ? up + 1.6 : down + 1.6);
      lining = u * u + v * v < 1;
    }
    const depth = this.h - y;
    this.locate(y);
    if (y <= this.tunnelTop) {
      const a = this.sample(this.gA), b = this.sample(this.gB);
      // mais largos no fundo, mais estreitos perto da superfície
      const r = CAVES.tunnel.radius * (0.8 + 0.35 * smoothstep(4, 26, depth)) * this.clear;
      if (a * a + b * b < r * r) return OPEN;
    }
    if (depth >= CAVES.hall.roof) {
      const fade = smoothstep(CAVES.floor, CAVES.floor + 5, y) * smoothstep(CAVES.hall.roof, CAVES.hall.roof + 5, depth) * this.clear;
      if (this.sample(this.gH) * fade > CAVES.hall.level) return OPEN;
    }
    return lining ? LINING : SOLID;
  }
}
