// Luz do céu e malha de um chunk, como função pura dos blocos dele e dos 8 vizinhos (docs/design/MUNDO.md). Roda na
// thread principal (editar um bloco refaz a malha na hora) e no Web Worker (chunks novos, ADR 0012): o mesmo código nos dois.
import { CH, CS, idx } from './terrain';
import { meshPadded, SKY_LEVELS, type MeshArrays } from './mesher';

/** luz do céu: nível de quem vê o céu direto; cada bloco de distância por dentro da rocha tira 1 */
export const SKY_MAX = SKY_LEVELS;

const PW = CS + 2;
const PL = PW * PW;
/** margem em volta do chunk onde a luz é calculada (a luz de um vizinho alcança até SKY_MAX blocos) */
const LM = SKY_MAX;
const LW = CS + 2 * LM;
const LL = LW * LW;

/** o que o mesher precisa de cada chunk */
export interface ChunkSource {
  data: Uint8Array;
  maxY: number;
}

export class ChunkMesher {
  private readonly pad = new Uint8Array(PL * CH);
  private readonly padLight = new Uint8Array(PL * CH);
  // região do chunk com a margem da luz: blocos, luz, topo de cada coluna e fila da propagação
  private readonly reg = new Uint8Array(LL * CH);
  private readonly regLight = new Uint8Array(LL * CH);
  private readonly regTop = new Int16Array(LL);
  private readonly queue: number[] = [];

  /**
   * Malha do chunk do meio de `nb` (os 9 chunks, na ordem de z e depois x: o do meio é o de índice 4). `light` recebe a luz
   * do céu de cada bloco do chunk (CS × CS × CH).
   */
  build(nb: readonly ChunkSource[], ox: number, oz: number, light: Uint8Array): MeshArrays {
    const { pad, padLight, reg, regLight } = this;
    let top = 0;
    for (const n of nb) if (n.maxY > top) top = n.maxY;
    const maxY = nb[4].maxY;
    // a luz precisa da altura dos vizinhos (um morro ao lado faz sombra de céu); a malha, só da do chunk
    const hh = Math.min(CH, top + 2);
    const h = Math.min(CH, maxY + 2);
    this.skyLight(nb, hh);
    for (let y = 0; y < h; y++) {
      for (let z = -1; z <= CS; z++) {
        const r = LM + z, o = (z + 1) * PW + y * PL + 1;
        for (let x = -1; x <= CS; x++) {
          const i = LM + x + r * LW + y * LL;
          pad[o + x] = reg[i];
          padLight[o + x] = regLight[i];
        }
      }
    }
    for (let y = 0; y < hh; y++)
      for (let z = 0; z < CS; z++) {
        const i = LM + (LM + z) * LW + y * LL;
        light.set(regLight.subarray(i, i + CS), idx(0, y, z));
      }
    light.fill(SKY_MAX, hh * CS * CS);
    pad.fill(0, h * PL);
    padLight.fill(SKY_MAX, h * PL);
    return meshPadded(pad, CS, CS, CH, maxY, ox, oz, true, padLight);
  }

  /**
   * Luz do céu na região do chunk do meio com a margem: quem está acima do topo da coluna vê o céu (SKY_MAX); dali a luz
   * entra pelas aberturas perdendo 1 por bloco. Preenche `reg` e `regLight`.
   */
  private skyLight(nb: readonly ChunkSource[], hh: number): void {
    const { reg, regLight, regTop, queue } = this;
    for (let z = 0; z < LW; z++) {
      const wz = z - LM, dz = wz < 0 ? 0 : wz >= CS ? 2 : 1, lz = wz - (dz - 1) * CS;
      for (let x = 0; x < LW; x++) {
        const wx = x - LM, dx = wx < 0 ? 0 : wx >= CS ? 2 : 1, lx = wx - (dx - 1) * CS;
        const n = nb[dx + dz * 3];
        const data = n.data, col = lx + lz * CS, o = x + z * LW;
        let t = Math.min(n.maxY, hh - 1);
        while (t > 0 && !data[col + t * CS * CS]) t--;
        regTop[o] = t;
        for (let y = 0; y < hh; y++) {
          reg[o + y * LL] = data[col + y * CS * CS];
          regLight[o + y * LL] = y > t ? SKY_MAX : 0;
        }
      }
    }
    // sementes: blocos de céu ao lado de uma coluna mais alta (podem iluminar uma abertura nela)
    queue.length = 0;
    for (let z = 0; z < LW; z++)
      for (let x = 0; x < LW; x++) {
        const o = x + z * LW, t = regTop[o];
        let m = t;
        if (x > 0 && regTop[o - 1] > m) m = regTop[o - 1];
        if (x < LW - 1 && regTop[o + 1] > m) m = regTop[o + 1];
        if (z > 0 && regTop[o - LW] > m) m = regTop[o - LW];
        if (z < LW - 1 && regTop[o + LW] > m) m = regTop[o + LW];
        for (let y = t + 1; y <= m; y++) queue.push(o + y * LL);
      }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const v = regLight[i] - 1;
      if (v <= 0) continue;
      const y = Math.floor(i / LL), r = i - y * LL, z = Math.floor(r / LW), x = r - z * LW;
      if (x > 0) this.spread(i - 1, v);
      if (x < LW - 1) this.spread(i + 1, v);
      if (z > 0) this.spread(i - LW, v);
      if (z < LW - 1) this.spread(i + LW, v);
      if (y > 0) this.spread(i - LL, v);
      if (y < hh - 1) this.spread(i + LL, v);
    }
  }

  private spread(i: number, v: number): void {
    if (this.reg[i] || this.regLight[i] >= v) return;
    this.regLight[i] = v;
    this.queue.push(i);
  }
}
